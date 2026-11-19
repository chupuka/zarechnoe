'use strict';

/**
 * Технадминка (Неделя 6) — /api/v1/tech.
 *
 * ФИЗИЧЕСКИ И ЛОГИЧЕСКИ ОТДЕЛЕНА от бизнес-админки (routes/admin.js):
 *   * доступ только по праву tech:READ / tech:EXEC (у бизнес-ролей его нет);
 *   * все действия пишутся в tech_log (а не в бизнес-аудит) + бизнес-аудит;
 *   * технические роли обязаны передать X-Override-Reason (усиленный аудит).
 *
 * Резервное копирование: POST запускает реальный pg_dump через
 * scripts/backup_restore.py, результат (путь/размер/контрольная сумма)
 * фиксируется в backup_job. Восстановление — pg_restore в restore_job.
 *
 * Страница «Резервные копии» получила единый эндпоинт /backups/overview:
 * текущая копия, настройки периода, история и восстановления — одним ответом,
 * вместо поиска по журналу (см. ТЗ, доработка интерфейса).
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { query } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { elevated } = require('../middleware/elevated');
const { writeAudit, writeTechLog } = require('../audit');
const { httpError, asInt, validate, parsePaging } = require('../validation');
const backup = require('../backup');
const backupScheduler = require('../backupScheduler');
const perf = require('../perf');
const { BACKUP_DIR, listFiles } = require('../dbAdmin/backupFiles');

const router = express.Router();

const BACKUP_SPECS = {
    backup_type: { type: 'enum', required: true, values: ['FULL', 'INCREMENTAL'] },
    retention_days: { type: 'int', min: 1, max: 3650 },
    note: { type: 'string', max: 500, nullable: true },
};
const RESTORE_SPECS = {
    backup_job_id: { type: 'int', required: true },
    reason: { type: 'string', required: true, min: 3, max: 500 },
};
const SCHEDULE_SPECS = {
    backup_enabled: { type: 'boolean' },
    backup_schedule: { type: 'enum', values: ['DAILY', 'WEEKLY', 'OFF'] },
    backup_time: { type: 'string', pattern: /^\d{1,2}:\d{2}$/,
                   message: 'backup_time: ожидается ЧЧ:ММ' },
    backup_retention_days: { type: 'int', min: 1, max: 3650 },
    backup_keep_last: { type: 'int', min: 1, max: 500 },
};

// ============================================================================
// Резервные копии
// ============================================================================

/** GET /tech/backups — журнал резервных копий */
router.get('/backups', requirePermission('backup:READ', 'backup_job'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const status = String(req.query.status || '').trim();
        const type = String(req.query.backup_type || '').trim();
        const origin = String(req.query.origin || '').trim();
        const where = [];
        const params = [];
        if (status) { where.push(`b.status = $${params.length + 1}::text`); params.push(status); }
        if (type) { where.push(`b.backup_type = $${params.length + 1}::text`); params.push(type); }
        if (origin) { where.push(`b.origin = $${params.length + 1}::text`); params.push(origin); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT b.id, b.backup_type, b.origin, b.started_at, b.finished_at, b.status,
                    b.file_path, b.size_bytes, b.checksum, b.retention_days,
                    u.login AS initiated_by_login, COUNT(*) OVER() AS total
             FROM backup_job b JOIN app_user u ON u.id = b.initiated_by
             ${whereSql} ORDER BY b.started_at DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/**
 * GET /tech/backups/overview — всё для страницы «Резервные копии» одним ответом:
 * текущая (последняя успешная) копия, настройки периода, история и восстановления,
 * состояние планировщика и файлов на диске.
 */
router.get('/backups/overview', requirePermission('backup:READ', 'backup_job'),
    async (req, res, next) => {
        try {
            const settings = await backup.scheduleSettings();
            const current = (await query(
                `SELECT b.id, b.backup_type, b.origin, b.status, b.started_at, b.finished_at,
                        b.file_path, b.size_bytes, b.checksum, b.retention_days,
                        u.login AS initiated_by_login,
                        (SELECT count(*)::int FROM restore_job r WHERE r.backup_job_id = b.id) AS restores
                   FROM backup_job b JOIN app_user u ON u.id = b.initiated_by
                  WHERE b.status = 'OK' ORDER BY b.finished_at DESC NULLS LAST LIMIT 1`)).rows[0] || null;
            const history = (await query(
                `SELECT b.id, b.backup_type, b.origin, b.status, b.started_at, b.finished_at,
                        b.file_path, b.size_bytes, b.retention_days,
                        u.login AS initiated_by_login,
                        (SELECT count(*)::int FROM restore_job r WHERE r.backup_job_id = b.id) AS restores
                   FROM backup_job b JOIN app_user u ON u.id = b.initiated_by
                  ORDER BY b.started_at DESC LIMIT 30`)).rows;
            const restores = (await query(
                `SELECT r.id, r.backup_job_id, r.status, r.started_at, r.finished_at, r.reason,
                        u.login AS performed_by_login, b.file_path
                   FROM restore_job r
                   JOIN app_user u ON u.id = r.performed_by
                   LEFT JOIN backup_job b ON b.id = r.backup_job_id
                  ORDER BY r.started_at DESC LIMIT 20`)).rows;
            const files = listFiles(settings.retention_days);
            const lastFailure = (await query(
                `SELECT id, started_at, file_path FROM backup_job
                  WHERE status = 'FAILED' ORDER BY started_at DESC LIMIT 1`)).rows[0] || null;

            // Когда ближайшая плановая копия (для подсказки «следующая через …»).
            const due = backupScheduler.dueMoment(settings, new Date());
            res.json({
                data: {
                    current,
                    settings,
                    history,
                    restores,
                    files: backup.filesSummary(files.files),
                    backup_dir: files.backup_dir,
                    scheduler: backupScheduler.status(),
                    last_failure: lastFailure,
                    schedule_due: due,
                    generated_at: new Date().toISOString(),
                },
            });
        } catch (err) { next(err); }
    });

/** GET /tech/backups/schedule — только настройки периода. */
router.get('/backups/schedule', requirePermission('backup:READ', 'backup_job'),
    async (req, res, next) => {
        try {
            res.json({ data: await backup.scheduleSettings() });
        } catch (err) { next(err); }
    });

/** PATCH /tech/backups/schedule — изменить период/время/хранение. */
router.patch('/backups/schedule', elevated('backup:EXEC', 'backup_job'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, SCHEDULE_SPECS, { partial: true });
        if (!Object.keys(v).length) throw httpError(400, 'Нет настроек для изменения');
        const result = await backup.saveScheduleSettings(v, req.user.id);
        await writeAudit(req, {
            entityName: 'farm_settings', entityId: 0, action: 'UPDATE',
            after: { backup_schedule: v },
        });
        await writeTechLog(req, {
            actionType: 'BACKUP',
            description: `Изменены настройки расписания копий: ${Object.keys(v).join(', ')}`,
            details: v,
        });
        res.json({ data: result });
    } catch (err) { next(err); }
});

/** POST /tech/backups/schedule/run — выполнить плановую проверку немедленно. */
router.post('/backups/schedule/run', elevated('backup:EXEC', 'backup_job'),
    async (req, res, next) => {
        try {
            const result = await backupScheduler.tick(new Date());
            const message = result.created
                ? `Создана плановая копия #${result.created}`
                : (result.skipped === 'already_done'
                    ? 'Плановая копия за текущий период уже сделана'
                    : `Пропущено: ${result.skipped || result.error || 'нет условий'}`);
            await writeTechLog(req, {
                actionType: 'BACKUP',
                description: `Ручной запуск планировщика: ${message}`,
                details: result,
            });
            res.json({ data: result, message });
        } catch (err) { next(err); }
    });

/** GET /tech/backups/:id — карточка копии (+ связанные восстановления) */
router.get('/backups/:id', requirePermission('backup:READ', 'backup_job'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const b = await query(
            `SELECT b.*, u.login AS initiated_by_login FROM backup_job b
             JOIN app_user u ON u.id = b.initiated_by WHERE b.id = $1`, [id]);
        if (!b.rows.length) throw httpError(404, 'Резервная копия не найдена');
        const r = await query(
            `SELECT r.id, r.started_at, r.finished_at, r.status, r.reason, u.login AS performed_by_login
             FROM restore_job r JOIN app_user u ON u.id = r.performed_by
             WHERE r.backup_job_id = $1 ORDER BY r.started_at DESC`, [id]);
        res.json({ data: { ...b.rows[0], restores: r.rows } });
    } catch (err) { next(err); }
});

/**
 * GET /tech/backups/:id/download — скачать файл копии.
 * Отдаём только файл, который реально создан этим заданием и лежит в каталоге
 * копий: путь из БД проверяется по префиксу каталога (защита от path traversal).
 */
router.get('/backups/:id/download', requirePermission('backup:READ', 'backup_job'),
    async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const { rows } = await query(
                `SELECT id, file_path, status, checksum FROM backup_job WHERE id = $1`, [id]);
            if (!rows.length) throw httpError(404, 'Резервная копия не найдена');
            if (rows[0].status !== 'OK' || !rows[0].file_path) {
                throw httpError(400, 'У копии нет файла (статус не OK)');
            }
            const abs = path.resolve(rows[0].file_path);
            const root = path.resolve(BACKUP_DIR) + path.sep;
            if (!abs.startsWith(root)) throw httpError(403, 'Файл вне каталога резервных копий');
            if (!fs.existsSync(abs)) throw httpError(404, 'Файл копии не найден на диске');
            await writeAudit(req, {
                entityName: 'backup_job', entityId: id, action: 'EXPORT',
                after: { file: path.basename(abs), action: 'download' },
            });
            res.download(abs, path.basename(abs));
        } catch (err) { next(err); }
    });

/**
 * POST /tech/backups — создать резервную копию.
 * Вся операция: запись RUNNING → pg_dump → OK/FAILED (см. src/backup.js).
 */
router.post('/backups', elevated('backup:EXEC', 'backup_job'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, BACKUP_SPECS);
        const retention = v.retention_days || (await backup.scheduleSettings()).retention_days || 30;
        let job;
        try {
            job = await backup.createBackup({
                userId: req.user.id,
                backupType: v.backup_type,
                retentionDays: retention,
                note: v.note || '',
                origin: 'MANUAL',
            });
        } catch (e) {
            await writeTechLog(req, {
                actionType: 'BACKUP',
                description: `Бэкап НЕ выполнен: ${e.message}`,
                details: { status: 'FAILED' },
            });
            throw e;
        }
        await writeAudit(req, {
            entityName: 'backup_job', entityId: job.id, action: 'CREATE',
            after: { backup_type: v.backup_type, file: job.file_path },
        });
        res.status(201).json({ data: job });
    } catch (err) { next(err); }
});

// ============================================================================
// Восстановление
// ============================================================================

/** GET /tech/restores — журнал восстановлений */
router.get('/restores', requirePermission('backup:READ', 'restore_job'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { rows } = await query(
            `SELECT r.id, r.backup_job_id, b.file_path, b.checksum, r.started_at, r.finished_at,
                    r.status, r.reason, u.login AS performed_by_login, COUNT(*) OVER() AS total
             FROM restore_job r
             LEFT JOIN backup_job b ON b.id = r.backup_job_id
             JOIN app_user u ON u.id = r.performed_by
             ORDER BY r.started_at DESC
             LIMIT $1::int OFFSET $2::int`, [limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** POST /tech/restores — восстановление из копии (демонстрация инцидента) */
router.post('/restores', elevated('backup:EXEC', 'restore_job'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, RESTORE_SPECS);
        const { job, verification } = await backup.createRestore({
            userId: req.user.id,
            backupJobId: v.backup_job_id,
            reason: v.reason,
        });
        await writeAudit(req, {
            entityName: 'restore_job', entityId: job.id, action: 'CREATE',
            after: { backup_job_id: v.backup_job_id, reason: v.reason },
        });
        res.status(201).json({ data: job, verification });
    } catch (err) { next(err); }
});

// ============================================================================
// Технический лог и метрики
// ============================================================================

/** GET /tech/log — технический лог (отдельно от бизнес-аудита) */
router.get('/log', requirePermission('tech:READ', 'tech_log'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const actionType = String(req.query.action_type || '').trim();
        const where = [];
        const params = [];
        if (actionType) { where.push(`t.action_type = $${params.length + 1}::text`); params.push(actionType); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT t.id, t.occurred_at, t.action_type, t.description, t.details,
                    u.login AS admin_login, COUNT(*) OVER() AS total
             FROM tech_log t JOIN app_user u ON u.id = t.admin_user_id
             ${whereSql} ORDER BY t.occurred_at DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /tech/metrics — метрики БД (здоровье, размер, активность) */
router.get('/metrics', requirePermission('tech:READ', 'tech_log'), async (req, res, next) => {
    try {
        const { rows } = await query(`
            SELECT current_database() AS database,
                   version() AS server_version,
                   (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
                   pg_size_pretty(pg_database_size(current_database())) AS db_size,
                   (SELECT count(*) FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
                   (SELECT count(*) FROM animal WHERE NOT is_deleted) AS animals,
                   (SELECT count(*) FROM task) AS tasks,
                   (SELECT count(*) FROM stock_movement) AS stock_movements,
                   (SELECT count(*) FROM audit_log) AS audit_rows,
                   (SELECT count(*) FROM audit_log WHERE action = 'DENY') AS denies,
                   (SELECT count(*) FROM audit_log WHERE is_elevated) AS elevated,
                   (SELECT count(*) FROM backup_job WHERE status = 'OK') AS backups_ok,
                   (SELECT max(finished_at) FROM backup_job WHERE status = 'OK') AS last_backup_at`);
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** Пороговые значения скорости из farm_settings (их можно менять без пересборки). */
async function perfThresholds() {
    const { rows } = await query(
        `SELECT setting_key, value_num FROM farm_settings
          WHERE setting_key IN ('perf_p95_ok_ms', 'perf_p95_warn_ms', 'perf_slow_ms')`);
    const map = {};
    for (const r of rows) map[r.setting_key] = Number(r.value_num || 0);
    return map;
}

/**
 * GET /tech/metrics/perf — скорость запросов к БД и вердикт «нужна ли оптимизация».
 *
 * Это ответ на требование «показывать, быстро ли выполняются запросы»: в ответе
 * не только цифры, но и готовая формулировка (verdict) и список самых медленных
 * запросов — то есть сигнал к действию, а не сырые данные.
 */
router.get('/metrics/perf', requirePermission('tech:READ', 'tech_log'), async (req, res, next) => {
    try {
        const thresholds = await perfThresholds();
        const snap = perf.snapshot();
        const verdict = perf.verdict(snap, thresholds);
        const db = (await query(
            `SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
                    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
                    pg_size_pretty(pg_database_size(current_database())) AS db_size,
                    (SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint
                       FROM pg_stat_user_tables) AS write_ops,
                    (SELECT round(100.0 * sum(heap_blks_hit)
                                  / greatest(sum(heap_blks_hit) + sum(heap_blks_read), 1), 2)
                       FROM pg_statio_user_tables) AS cache_hit_ratio`)).rows[0];
        const slowTables = (await query(
            `SELECT relname AS table_name, seq_scan, idx_scan, n_live_tup,
                    round(100.0 * seq_scan / greatest(seq_scan + idx_scan, 1), 1) AS seq_scan_pct
               FROM pg_stat_user_tables
              WHERE seq_scan + idx_scan > 0
              ORDER BY seq_scan_pct DESC, n_live_tup DESC
              LIMIT 5`)).rows;
        res.json({
            data: {
                ...snap,
                thresholds,
                verdict,
                db,
                slow_tables: slowTables,
                reset_at: new Date().toISOString(),
            },
        });
    } catch (err) { next(err); }
});

/** POST /tech/metrics/perf/reset — начать замер заново (например, после оптимизации). */
router.post('/metrics/perf/reset', elevated('tech:EXEC', 'tech_log'), async (req, res, next) => {
    try {
        perf.reset();
        await writeTechLog(req, {
            actionType: 'MAINTENANCE',
            description: 'Сброшена статистика скорости запросов (страница «Метрики»)',
            details: { action: 'perf_reset' },
        });
        res.json({ data: { reset: true, at: new Date().toISOString() } });
    } catch (err) { next(err); }
});

/** POST /tech/maintenance — обслуживание (VACUUM ANALYZE / REINDEX), пишется в tech_log */
router.post('/maintenance', elevated('tech:EXEC', 'tech_log'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, {
            operation: { type: 'enum', required: true, values: ['VACUUM', 'ANALYZE', 'REINDEX'] },
            note: { type: 'string', max: 500, nullable: true },
        });
        // VACUUM/REINDEX не могут выполняться внутри транзакции → вне withTransaction.
        const sql = v.operation === 'REINDEX'
            ? 'REINDEX TABLE public.stock_movement'
            : (v.operation === 'ANALYZE' ? 'ANALYZE' : 'VACUUM (ANALYZE)');
        await query(sql);
        await writeTechLog(req, { actionType: v.operation === 'REINDEX' ? 'INDEX' : 'MAINTENANCE',
            description: `Обслуживание БД: ${v.operation}${v.note ? ' — ' + v.note : ''}`,
            details: { sql, operation: v.operation } });
        res.json({ data: { operation: v.operation, status: 'OK' } });
    } catch (err) { next(err); }
});

module.exports = router;
