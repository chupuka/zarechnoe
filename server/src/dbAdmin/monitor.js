'use strict';

/**
 * Разведка производительности БД по системным представлениям PostgreSQL.
 *
 * Всё здесь — ЧТЕНИЕ системного каталога и pg_stat_*, без собственных счётчиков
 * времени запросов: данные даёт сама СУБД. Используется администратором БД для
 * ответа на вопросы «где узкое место» и «что будет тормозить через месяц».
 *
 * ВАЖНО: «медленные запросы» без расширения не дают историю — pg_stat_statements
 * их запоминает. Если расширение не установлено, это честно возвращается как
 * `available: false` + подсказка, а не подменяется фиктивными числами.
 */

const { query } = require('../db');

/** Сколько учтено «тяжёлых» перегрузок, чтобы не тащить в UI все 500 индексов. */
const TOP_N = 20;

async function overview() {
    const r = await query(`
        SELECT current_database()                                  AS database,
               current_user                                        AS connected_role,
               version()                                           AS server_version,
               pg_size_pretty(pg_database_size(current_database())) AS db_size_pretty,
               pg_database_size(current_database())                AS db_size_bytes,
               (SELECT setting FROM pg_settings WHERE name = 'max_connections')::int AS max_connections,
               (SELECT setting FROM pg_settings WHERE name = 'shared_buffers')       AS shared_buffers,
               (SELECT setting FROM pg_settings WHERE name = 'work_mem')             AS work_mem,
               (SELECT setting FROM pg_settings WHERE name = 'effective_cache_size') AS effective_cache_size,
               (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
               (SELECT count(*) FROM pg_stat_activity
                 WHERE datname = current_database() AND state = 'active') AS active_queries,
               (SELECT count(*) FROM pg_stat_activity
                 WHERE datname = current_database() AND wait_event_type = 'Lock')     AS blocked_queries,
               (SELECT count(*) FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_type = 'BASE TABLE')         AS tables_count,
               (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')          AS indexes_count,
               pg_postmaster_start_time()                          AS started_at,
               now() - pg_postmaster_start_time()                  AS uptime,
               (SELECT pg_size_pretty(sum(pg_total_relation_size(c.oid)))
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r')    AS data_size_pretty,
               (SELECT pg_size_pretty(sum(pg_indexes_size(c.oid)))
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r')    AS indexes_size_pretty`);
    return r.rows[0];
}

/** Кэш-хит буферов: <95% означает, что БД читает с диска (мало shared_buffers). */
async function cacheHit() {
    const r = await query(`
        SELECT sum(blks_hit)::bigint  AS hits,
               sum(blks_read)::bigint AS reads,
               CASE WHEN sum(blks_hit) + sum(blks_read) = 0 THEN NULL
                    ELSE round(100.0 * sum(blks_hit) / (sum(blks_hit) + sum(blks_read)), 2)
               END AS cache_hit_ratio,
               (SELECT round(100.0 * sum(idx_scan) / NULLIF(sum(idx_scan) + sum(seq_scan), 0), 2)
                  FROM pg_stat_user_tables) AS index_usage_ratio
        FROM pg_stat_database
        WHERE datname = current_database()`);
    const t = r.rows[0];
    return {
        ...t,
        hints: [
            ...(t.cache_hit_ratio != null && Number(t.cache_hit_ratio) < 95
                ? [`Кэш-хит ${t.cache_hit_ratio}% < 95% — увеличьте shared_buffers или working set`] : []),
            ...(t.index_usage_ratio != null && Number(t.index_usage_ratio) < 50
                ? [`Индексы используются в ${t.index_usage_ratio}% чтений — возможны лишние/неэффективные индексы`] : []),
        ],
    };
}

async function connections() {
    const r = await query(`
        SELECT d.datname, d.numbackends, pg_size_pretty(pg_database_size(d.datname)) AS db_size,
               (SELECT setting FROM pg_settings WHERE name = 'max_connections')::int AS max_connections
        FROM pg_stat_database d
        JOIN pg_database x ON x.datname = d.datname
        WHERE x.datistemplate = false
        ORDER BY d.numbackends DESC`);
    return {
        databases: r.rows,
        perState: (await query(`
            SELECT state, count(*)::int AS total
            FROM pg_stat_activity WHERE datname = current_database()
            GROUP BY state ORDER BY total DESC`)).rows,
        longRunning: (await query(`
            SELECT pid, usename, state,
                   now() - query_start AS duration, left(query, 160) AS query,
                   wait_event_type, wait_event
            FROM pg_stat_activity
            WHERE datname = current_database() AND state <> 'idle'
            ORDER BY query_start ASC LIMIT 10`)).rows,
    };
}

/** Топ таблиц: объём, мёртвые строки, автовакуум и «горячие» чтения. */
async function tables() {
    const r = await query(`
        SELECT st.relname                                      AS table_name,
               pg_size_pretty(pg_total_relation_size(c.oid))   AS total_size,
               pg_total_relation_size(c.oid)                   AS total_bytes,
               st.seq_scan, st.idx_scan, st.n_live_tup, st.n_dead_tup,
               CASE WHEN st.n_live_tup + st.n_dead_tup = 0 THEN 0
                    ELSE round(100.0 * st.n_dead_tup / (st.n_live_tup + st.n_dead_tup), 2) END AS dead_ratio,
               st.last_vacuum, st.last_autovacuum, st.last_analyze,
               st.n_tup_ins, st.n_tup_upd, st.n_tup_del
        FROM pg_stat_user_tables st
        JOIN pg_class c ON c.oid = st.relid
        WHERE st.schemaname = 'public'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT ${TOP_N}`);
    return {
        tables: r.rows,
        deadRows: (await query(`
            SELECT sum(n_dead_tup)::bigint AS dead_rows,
                   max(n_dead_tup)::bigint AS max_dead_rows
            FROM pg_stat_user_tables WHERE schemaname = 'public'`)).rows[0],
    };
}

/**
 * Неиспользуемые индексы — классический «найти лишнее»: индекс без чтений
 * только замедляет запись. Учитываем только таблицы, где уже было достаточно
 * чтений, иначе на маленькой базе все индексы «неиспользуемые».
 */
async function unusedIndexes() {
    const r = await query(`
        SELECT s.schemaname, s.relname AS table_name, s.indexrelname AS index_name,
               pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
               pg_relation_size(s.indexrelid) AS index_bytes,
               s.idx_scan, s.idx_tup_read
        FROM pg_stat_user_indexes s
        JOIN pg_index i ON i.indexrelid = s.indexrelid
        WHERE s.schemaname = 'public'
          AND s.idx_scan = 0
          AND NOT i.indisunique
          AND NOT i.indisprimary
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = s.indexrelid)
        ORDER BY pg_relation_size(s.indexrelid) DESC
        LIMIT ${TOP_N}`);
    return r.rows;
}

/** Потерянные индексы: последовательные чтения на больших таблицах. */
async function seqScans() {
    const r = await query(`
        SELECT relname AS table_name, seq_scan, coalesce(idx_scan, 0) AS idx_scan,
               n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
               CASE WHEN seq_scan + coalesce(idx_scan,0) = 0 THEN 0
                    ELSE round(100.0 * seq_scan / (seq_scan + coalesce(idx_scan,0)), 2) END AS seq_ratio
        FROM pg_stat_user_tables
        WHERE schemaname = 'public' AND n_live_tup > 1000 AND seq_scan > 50
        ORDER BY seq_scan DESC LIMIT ${TOP_N}`);
    return r.rows;
}

/**
 * Блокировки: `pg_blocking_pids()` штатно отвечает на «кто кого ждёт» —
 * это надёжнее, чем самому собирать условия JOIN по всем вариантам pg_locks.
 */
async function locks() {
    const r = await query(`
        SELECT a.pid, a.usename, a.application_name,
               now() - a.query_start AS blocked_for,
               left(a.query, 160) AS blocked_query,
               pg_blocking_pids(a.pid) AS blocker_pids,
               (SELECT string_agg(b.usename, ', ')
                  FROM pg_stat_activity b WHERE b.pid = ANY(pg_blocking_pids(a.pid))) AS blocker_users,
               (SELECT string_agg(left(b.query, 120), ' | ')
                  FROM pg_stat_activity b WHERE b.pid = ANY(pg_blocking_pids(a.pid))) AS blocker_queries,
               a.wait_event_type, a.wait_event
        FROM pg_stat_activity a
        WHERE a.datname = current_database()
          AND cardinality(pg_blocking_pids(a.pid)) > 0
        ORDER BY a.query_start ASC
        LIMIT ${TOP_N}`);
    const waits = await query(`
        SELECT wait_event_type, wait_event, count(*)::int AS total
        FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type IS NOT NULL
        GROUP BY 1, 2 ORDER BY total DESC`);
    return {
        blocked: r.rows,
        waitingCount: r.rows.length,
        waitEvents: waits.rows,
    };
}

/**
 * Медленные запросы. Единственный честный источник — pg_stat_statements.
 * Без него даём «дыру» через pg_stat_activity (сейчас выполняющиеся) и явный флаг.
 */
async function slowQueries() {
    const ext = await query(
        `SELECT installed_version FROM pg_available_extensions
         WHERE name = 'pg_stat_statements'`, []);
    const installed = ext.rows.length > 0 && ext.rows[0].installed_version !== null;
    const available = ext.rows.length > 0;

    if (!installed) {
        const current = await query(`
            SELECT pid, usename, now() - query_start AS duration,
               left(query, 200) AS query
            FROM pg_stat_activity
            WHERE datname = current_database() AND state = 'active' AND query_start IS NOT NULL
            ORDER BY query_start ASC LIMIT ${TOP_N}`);
        return {
            available: false, availableToInstall: available, rows: current.rows,
            note: available
                ? 'pg_stat_statements доступен в образе, но расширение не создано. ' +
                  'Активация: ALTER SYSTEM SET shared_preload_libraries=\'pg_stat_statements\'; и перезапуск PostgreSQL.'
                : 'pg_stat_statements недоступен в этом сервере. Показаны только запросы, ' +
                  'выполняющиеся прямо сейчас (pg_stat_activity) — без истории и без счётчика времени.',
        };
    }
    const r = await query(`
        SELECT queryid, calls,
               round(total_exec_time::numeric, 2) AS total_ms,
               round(mean_exec_time::numeric, 2)  AS mean_ms,
               round(max_exec_time::numeric, 2)   AS max_ms,
               round(100.0 * total_exec_time / NULLIF(sum(total_exec_time) OVER (), 0), 2) AS pct_total,
               rows, left(query, 300) AS query
        FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        ORDER BY total_exec_time DESC
        LIMIT ${TOP_N}`);
    return { available: true, rows: r.rows, note: null };
}

/** Вакуум и рост: кто не вакуумируется и сколько «мёртвых» строк накопилось. */
async function vacuum() {
    const r = await query(`
        SELECT * FROM (
            SELECT relname AS table_name, n_live_tup, n_dead_tup,
                   CASE WHEN n_live_tup + n_dead_tup = 0 THEN 0
                        ELSE round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2) END AS dead_ratio,
                   last_vacuum, last_autovacuum,
                   CASE WHEN last_autovacuum IS NULL THEN NULL
                        ELSE round(EXTRACT(EPOCH FROM (now() - last_autovacuum)) / 3600.0, 1) END AS hours_since_autovacuum
            FROM pg_stat_user_tables
            WHERE schemaname = 'public'
        ) s
        WHERE n_dead_tup > 1000 OR dead_ratio > 10
        ORDER BY n_dead_tup DESC LIMIT ${TOP_N}`);
    return {
        tables: r.rows,
        totals: (await query(`
            SELECT coalesce(sum(n_dead_tup),0)::bigint AS dead_rows,
                   -- «запущенные» таблицы: были изменения, но автовакуум давно не проходил.
                   -- Таблицы без изменений (n_tup_ins+upd+del = 0) вакуумировать не нужно —
                   -- иначе на свежей базе получим ложную тревогу по всем 50+ справочникам.
                   count(*) FILTER (WHERE (n_tup_ins + n_tup_upd + n_tup_del) > 0
                                      AND (last_autovacuum IS NULL OR
                                           now() - last_autovacuum > interval '24 hours')) AS stale_tables,
                   count(*) FILTER (WHERE n_dead_tup > 1000) AS tables_with_dead_rows
            FROM pg_stat_user_tables WHERE schemaname = 'public'`)).rows[0],
    };
}

/**
 * Единый снимок для дашборда: всё нужное разом, включая вычисляемый интерпретатор.
 * Возвращает и «сырые» цифры, и список текстовых проблем — чтобы фронт показывал
 * конкретно «что не так», а не зелёную галочку «всё ок».
 */
async function health() {
    const [ov, cache, seq, unused, vac, locksInfo, slow] = await Promise.all([
        overview(), cacheHit(), seqScans(), unusedIndexes(), vacuum(), locks(), slowQueries(),
    ]);

    const problems = [];
    const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : null);

    const connPct = pct(ov.connections, ov.max_connections);
    if (connPct != null && connPct > 80) problems.push(
        `Занято ${connPct}% соединений (${ov.connections}/${ov.max_connections}) — риск отказа новых подключений`);

    if (ov.blocked_queries > 0) problems.push(`${ov.blocked_queries} запросов ждут блокировку`);

    if (cache.cache_hit_ratio != null && Number(cache.cache_hit_ratio) < 95) problems.push(
        `Кэш-хит ${cache.cache_hit_ratio}% — чтение идёт с диска`);

    if (vac.totals.stale_tables > 0) problems.push(
        `${vac.totals.stale_tables} таблиц не вакуумировались сутки (мёртвых строк: ${vac.totals.dead_rows})`);

    const bigUnused = unused.filter((x) => Number(x.index_bytes) > 1024 * 1024);
    if (bigUnused.length) problems.push(
        `${bigUnused.length} неиспользуемых индексов > 1 МБ (${bigUnused.slice(0, 3).map((x) => x.index_name).join(', ')})`);

    const heavySeq = seq.filter((x) => Number(x.seq_ratio) > 70);
    if (heavySeq.length) problems.push(
        `${heavySeq.length} таблиц читаются полным перебором > 70% (${heavySeq.slice(0, 3).map((x) => x.table_name).join(', ')})`);

    if (!slow.available) problems.push(
        'pg_stat_statements не установлен — истории медленных запросов нет');

    return {
        checkedAt: new Date().toISOString(),
        overview: ov,
        cache,
        connections: { total: ov.connections, max: ov.max_connections, percent: connPct,
                       blocked: ov.blocked_queries, perState: undefined },
        blocked: locksInfo.blocked,
        seqScans: seq,
        unusedIndexes: unused,
        vacuum: vac,
        slowQueries: slow,
        deadRows: Number(vac.totals.dead_rows),
        problems,
        severity: problems.length === 0 ? 'OK' : (problems.length > 3 ? 'CRITICAL' : 'WARNING'),
    };
}

/** Записать снимок метрик в историю (для графиков). */
async function capture() {
    const h = await health();
    const slowestActive = h.slowQueries.rows
        .map((q) => Number(String(q.duration || '0').split(' ')[0]) * 1000)
        .filter(Number.isFinite);
    const r = await query(
        `INSERT INTO db_metric_sample
             (db_size_bytes, tables_count, indexes_count, connections, max_connections,
              active_queries, blocked_queries, cache_hit_ratio, tps,
              longest_query_ms, seq_scan_ratio, dead_rows, vacuum_lag_hours, is_healthy)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [h.overview.db_size_bytes, h.overview.tables_count, h.overview.indexes_count,
         h.overview.connections, h.overview.max_connections, h.overview.active_queries,
         h.overview.blocked_queries, h.cache.cache_hit_ratio,
         null,
         slowestActive.length ? Math.round(Math.max(...slowestActive)) : null,
         h.cache.index_usage_ratio, h.deadRows, null,
         h.severity === 'OK']);
    return r.rows[0];
}

async function history(limit = 100) {
    const r = await query(
        `SELECT * FROM db_metric_sample ORDER BY captured_at DESC LIMIT $1`, [limit]);
    return r.rows;
}

module.exports = { overview, cacheHit, connections, tables, unusedIndexes, seqScans,
                   locks, slowQueries, vacuum, health, capture, history };
