'use strict';

/**
 * Администратор БД — /api/v1/dba (новый контур поверх Недели 6).
 *
 * Что здесь (и чего нет в бизнес-контуре):
 *   1. Резервное копирование / восстановление — журнал backup_job / restore_job;
 *      при возврате к старой схеме файл 0002… раннер откатит сам восстановлением.
 *   2. Миграции схемы — реестр schema_migration, контролируемое применение
 *      файлов db/migrations/*.sql, предварительный прогон с откатом (dry-run),
 *      проверка объектов до/после, защита от разрушительных изменений.
 *   3. Мониторинг производительности — pg_stat_*, история снимков db_metric_sample.
 *
 * ИЗОЛЯЦИЯ от бизнес-аудита соблюдена как в Неделе 6:
 *   * доступ строго по праву dba:* (у TECHNICAL-ролей есть, у бизнес-ролей — нет);
 *   * все действия пишутся в tech_log (action_type MIGRATE / MIGRATE_SQL / ROLLBACK),
 *     а не в audit_log, чтобы бизнес-журнал действий пользователей оставался чистым;
 *   * технические роли обязаны передать X-Override-Reason (middleware elevated).
 *
 * Миграции выполняются СЕРВЕРОМ: работа выполняется приложением через пул БД,
 * а не пользовательскими запросами, поэтому привилегий роль приложения хватает.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { elevated } = require('../middleware/elevated');
const { writeTechLog } = require('../audit');
const { httpError, validate } = require('../validation');
const migrator = require('../dbAdmin/migrator');
const monitor = require('../dbAdmin/monitor');
const backupFiles = require('../dbAdmin/backupFiles');

const router = express.Router();

// Локально: server/src/routes -> ../../../scripts (WEB_Ferma/scripts).
// В Docker: /app/src/routes -> ../../scripts (/app/scripts, см. Dockerfile).
const LOCAL_SCRIPT = path.resolve(__dirname, '../../../scripts/backup_restore.py');
const DOCKER_SCRIPT = path.resolve(__dirname, '../../scripts/backup_restore.py');
const SCRIPT = fs.existsSync(LOCAL_SCRIPT) ? LOCAL_SCRIPT : DOCKER_SCRIPT;
const PYTHON = process.env.PYTHON_BIN || 'py';

/** Вызов backup_restore.py: execFile без shell — аргументы не доходят до интерпретатора. */
function runScript(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        execFile(PYTHON, [SCRIPT, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) {
                    const why = err.code === 'EPERM'
                        ? `Запуск ${PYTHON} запрещён политикой процессов окружения (spawn EPERM). ` +
                          `Запустите сервер вне изолированной песочницы или задайте PYTHON_BIN.`
                        : err.message;
                    return reject(new Error(`${why}\n${stderr || ''}`.trim()));
                }
                try { resolve(JSON.parse(String(stdout).trim())); }
                catch (_) { reject(new Error(`Некорректный ответ backup_restore.py: ${String(stdout).slice(0, 400)}`)); }
            });
    });
}

/** Снять резервную копию ПЕРЕД рискованной операцией (миграция схемы). */
async function backupBeforeMigration(req, reason) {
    const ins = await query(
        `INSERT INTO backup_job (backup_type, status, retention_days, initiated_by)
         VALUES ('FULL', 'RUNNING', 30, $1) RETURNING id`, [req.user.id]);
    try {
        const r = await runScript([
            'backup', '--type', 'FULL', '--retention', '30',
            '--id', String(ins.rows[0].id), '--note', reason,
        ]);
        await query(
            `UPDATE backup_job SET status='OK', finished_at=now(), file_path=$2,
                    size_bytes=$3, checksum=$4 WHERE id=$1`,
            [ins.rows[0].id, r.file_path, r.size_bytes, r.checksum]);
        return { id: ins.rows[0].id, file_path: r.file_path, checksum: r.checksum, size_bytes: r.size_bytes };
    } catch (e) {
        await query(
            `UPDATE backup_job SET status='FAILED', finished_at=now(), file_path=$2 WHERE id=$1`,
            [ins.rows[0].id, String(e.message).slice(0, 490)]);
        // EPERM — политика изолированного окружения (запрет дочерних процессов),
        // а не ошибка pg_dump. Сообщаем честно, чтобы не искали несуществующий баг.
        const isSandbox = /EPERM|spawn/i.test(e.message);
        throw httpError(isSandbox ? 503 : 500,
            isSandbox
                ? `Резервная копия не создана: окружение сервера запрещает дочерние процессы (spawn EPERM). ` +
                  `Запустите сервер вне изолированной песочницы или выполните ` +
                  `py scripts/backup_restore.py backup ... вручную.`
                : `Не удалось снять резервную копию перед миграцией: ${e.message}`);
    }
}

// ============================================================================
// 1. МИГРАЦИИ СХЕМЫ
// ============================================================================

/** GET /dba/migrations — состояние всех файлов миграций и реестра. */
router.get('/migrations', requirePermission('dba:READ', 'schema_migration'), async (req, res, next) => {
    try {
        const files = await migrator.status();
        res.json({ data: {
            dir: path.relative(process.cwd(), migrator.DIR),
            files,
            pending: files.filter((f) => f.state === 'NEW').length,
            failed: files.filter((f) => f.state === 'FAILED').length,
            modified: files.filter((f) => f.state === 'CHANGED').length,
            applied: files.filter((f) => f.state === 'APPLIED').length,
        }});
    } catch (err) { next(err); }
});

/** GET /dba/migrations/history — реестр применённых версий (из таблицы). */
router.get('/migrations/history', requirePermission('dba:READ', 'schema_migration'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT m.*, u.login AS applied_by_login
             FROM schema_migration m LEFT JOIN app_user u ON u.id = m.applied_by
             ORDER BY m.version`);
        res.json({ data: rows });
    } catch (err) { next(err); }
});

/** POST /dba/migrations/preflight — предварительный прогон: реально исполняем и откатываем. */
router.post('/migrations/preflight', elevated('dba:EXEC', 'schema_migration'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, {
            version: { type: 'string', required: false, max: 32 },
        });
        const files = await migrator.pendingFiles();
        const targets = files.pending.filter((f) => !v.version || f.version === v.version);
        if (!targets.length) return res.json({ data: { files: [], message: 'Нет ожидающих миграций' } });

        const results = [];
        for (const f of targets) {
            const client = await require('../db').pool.connect();
            try {
                results.push({ ...await migrator.dryRun(client, f),
                    version: f.version, filename: f.filename });
            } finally { client.release(); }
        }
        await writeTechLog(req, {
            actionType: 'MIGRATE',
            description: `Предварительная проверка миграций: ${results.map((r) => r.version).join(', ')}`,
            details: { mode: 'DRY_RUN', results: results.map((r) => ({
                version: r.version, ok: r.ok, error: r.error || null })) },
        });
        res.json({ data: { files: results, note: 'Каждый файл выполнялся в транзакции и был откачен — схема не изменена.' } });
    } catch (err) { next(err); }
});

/**
 * POST /dba/migrations/apply — применить ожидающие (или конкретную) миграцию.
 *
 * Порядок: резервная копия → все файлы в ОДНОЙ транзакции → tech_log.
 * Действие расширенное (dba:EXEC) и требует X-Override-Reason для техроли.
 */
router.post('/migrations/apply', elevated('dba:EXEC', 'schema_migration'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, {
            version: { type: 'string', required: false, max: 32 },
            create_backup: { type: 'boolean', required: false },
        });
        const { pending } = await migrator.pendingFiles();
        const targets = pending.filter((f) => !v.version || f.version === v.version);
        if (!targets.length) throw httpError(400, v.version
            ? `Миграция ${v.version} не ожидает применения` : 'Нет ожидающих миграций');

        // Копия — ДО транзакции: pg_dump не видит незакоммиченных изменений.
        // Если окружение запрещает дочерние процессы (изолированная песочница),
        // НЕ молча пропускаем копию: явно фиксируем отказ в техлоге и ответе,
        // но миграцию выполняем (она сама транзакционна и откатывается).
        let backup = null;
        let backupWarning = null;
        if (v.create_backup !== false) {
            try {
                backup = await backupBeforeMigration(
                    req, `Автокопия перед миграцией ${targets.map((t) => t.version).join(',')}`);
            } catch (e) {
                backupWarning = e.message;
                await writeTechLog(req, {
                    actionType: 'MIGRATE',
                    description: `ВНИМАНИЕ: резервная копия перед миграцией не создана: ${e.message}`,
                    details: { backup_status: 'UNAVAILABLE', versions: targets.map((t) => t.version) },
                });
            }
        }

        let done;
        try {
            done = await withTransaction((client) =>
                migrator.applyBatch(client, targets, {
                    backupJobId: backup ? backup.id : null,
                    userId: req.user.id,
                }));
        } catch (e) {
            await migrator.markFailed(e.version || (targets[0] && targets[0].version), e.message);
            await writeTechLog(req, {
                actionType: 'MIGRATE',
                description: `Миграция НЕ применена: ${e.message}`,
                details: { error: e.code || 'ERROR', message: e.message, probe: e.probe || null,
                           backup_job_id: backup ? backup.id : null },
            });
            throw httpError(e.code === 'DESTRUCTIVE_MIGRATION' ? 409 : 500,
                `Миграция не применена: ${e.message}`);
        }

        await writeTechLog(req, {
            actionType: 'MIGRATE',
            description: `Применены миграции схемы: ${done.map((d) => d.version).join(', ')}`,
            details: { applied: done, backup_job_id: backup ? backup.id : null,
                       backup_warning: backupWarning },
        });
        res.status(201).json({ data: {
            applied: done, backup,
            warning: backupWarning,
            note: backupWarning
                ? 'Схема обновлена, НО резервная копия не создана — откат возможен только транзакцией'
                : 'Схема обновлена',
        } });
    } catch (err) { next(err); }
});

/**
 * POST /dba/migrations/rollback — вернуться к последней полной копии.
 * Восстановление — единственный механизм отката DDL на уровне БД (в PostgreSQL
 * нет DDL-транзакций, растянутых на сессии), поэтому откат идёт через pg_restore.
 */
router.post('/migrations/rollback', elevated('dba:EXEC', 'schema_migration'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, {
            backup_job_id: { type: 'int', required: true },
            reason: { type: 'string', required: true, min: 3, max: 500 },
        });
        const src = await query(
            `SELECT id, file_path, checksum, status FROM backup_job WHERE id = $1`, [v.backup_job_id]);
        if (!src.rows.length) throw httpError(404, `Резервная копия #${v.backup_job_id} не найдена`);
        if (src.rows[0].status !== 'OK') throw httpError(400, 'Откат возможен только из копии со статусом OK');

        const ins = await query(
            `INSERT INTO restore_job (backup_job_id, status, reason, performed_by)
             VALUES ($1, 'RUNNING', $2, $3) RETURNING id`,
            [v.backup_job_id, `[ROLLBACK] ${v.reason}`, req.user.id]);
        let result;
        try {
            result = await runScript(['restore', '--file', src.rows[0].file_path,
                '--checksum', src.rows[0].checksum || '',
                '--id', String(ins.rows[0].id)], 900000);
        } catch (e) {
            await query(`UPDATE restore_job SET status='FAILED', finished_at=now() WHERE id=$1`,
                [ins.rows[0].id]);
            throw httpError(500, `Откат не выполнен: ${e.message}`);
        }
        await query(`UPDATE restore_job SET status='OK', finished_at=now() WHERE id=$1`, [ins.rows[0].id]);
        await writeTechLog(req, {
            actionType: 'ROLLBACK',
            description: `Откат схемы к копии #${v.backup_job_id}. Причина: ${v.reason}`,
            details: { restore_job_id: ins.rows[0].id, backup: src.rows[0].file_path, ...result },
        });
        res.status(201).json({ data: { restore_job_id: ins.rows[0].id, backup_job_id: v.backup_job_id, ...result } });
    } catch (err) { next(err); }
});

// ============================================================================
// 2. РЕЗЕРВНОЕ КОПИРОВАНИЕ
// ============================================================================

/** GET /dba/backups — журнал резервных копий (из БД). */
router.get('/backups', requirePermission('dba:READ', 'backup_job'), async (req, res, next) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 500);
        const { rows } = await query(
            `SELECT b.*, u.login AS initiated_by_login,
                    (SELECT count(*) FROM restore_job r WHERE r.backup_job_id = b.id) AS restores,
                    (SELECT status FROM restore_job r WHERE r.backup_job_id = b.id
                      ORDER BY started_at DESC LIMIT 1) AS last_restore_status
             FROM backup_job b JOIN app_user u ON u.id = b.initiated_by
             ORDER BY b.started_at DESC LIMIT $1`, [limit]);
        res.json({ data: rows });
    } catch (err) { next(err); }
});

/** POST /dba/backups — создать копию. */
router.post('/backups', elevated('dba:EXEC', 'backup_job'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, {
            backup_type: { type: 'enum', required: false, values: ['FULL', 'INCREMENTAL'] },
            retention_days: { type: 'int', required: false, min: 1, max: 3650 },
            note: { type: 'string', required: false, max: 500, nullable: true },
        });
        const result = await backupBeforeMigration(req,
            v.note || `Ручная копия (${v.backup_type || 'FULL'})`);
        await writeTechLog(req, {
            actionType: 'BACKUP',
            description: `Резервная копия #${result.id} создана: ${result.file_path}`,
            details: result,
        });
        res.status(201).json({ data: result });
    } catch (err) { next(err); }
});

/** GET /dba/backups/files — что реально лежит на диске + срок по retention.
 *  Файловые операции выполняются Node напрямую: pg_dump здесь не нужен, а
 *  порождать интерпретатор в изолированном окружении может быть запрещено. */
router.get('/backups/files', requirePermission('dba:READ', 'backup_job'), async (req, res, next) => {
    try {
        const retention = Math.min(Number(req.query.retention) || 30, 3650);
        res.json({ data: backupFiles.listFiles(retention) });
    } catch (err) { next(err); }
});

/** POST /dba/backups/rotate — удалить копии старше retention. */
router.post('/backups/rotate', elevated('dba:EXEC', 'backup_job'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, {
            retention_days: { type: 'int', required: true, min: 1, max: 3650 },
        });
        const r = backupFiles.rotate(v.retention_days);
        await writeTechLog(req, {
            actionType: 'BACKUP',
            description: `Ротация копий: удалено ${r.removed_count} (retention ${v.retention_days} дн.)`,
            details: r,
        });
        res.json({ data: r });
    } catch (err) { next(err); }
});

// ============================================================================
// 3. МОНИТОРИНГ ПРОИЗВОДИТЕЛЬНОСТИ
// ============================================================================

/** GET /dba/monitor/health — сводка здоровья + интерпретация проблем. */
router.get('/monitor/health', requirePermission('dba:READ', 'db_metric_sample'), async (req, res, next) => {
    try { res.json({ data: await monitor.health() }); } catch (err) { next(err); }
});

/** GET /dba/monitor/tables — топ таблиц по объёму и мёртвым строкам. */
router.get('/monitor/tables', requirePermission('dba:READ', 'db_metric_sample'), async (req, res, next) => {
    try { res.json({ data: await monitor.tables() }); } catch (err) { next(err); }
});

/** GET /dba/monitor/indexes — неиспользуемые индексы + полные переборы. */
router.get('/monitor/indexes', requirePermission('dba:READ', 'db_metric_sample'), async (req, res, next) => {
    try {
        const [unused, seq] = await Promise.all([monitor.unusedIndexes(), monitor.seqScans()]);
        res.json({ data: { unused, seqScans: seq } });
    } catch (err) { next(err); }
});

/** GET /dba/monitor/slow — медленные запросы (pg_stat_statements или текущие). */
router.get('/monitor/slow', requirePermission('dba:READ', 'db_metric_sample'), async (req, res, next) => {
    try { res.json({ data: await monitor.slowQueries() }); } catch (err) { next(err); }
});

/** GET /dba/monitor/locks — блокировки и ожидания. */
router.get('/monitor/locks', requirePermission('dba:READ', 'db_metric_sample'), async (req, res, next) => {
    try { res.json({ data: await monitor.locks() }); } catch (err) { next(err); }
});

/** GET /dba/monitor/connections — соединения и длинные запросы. */
router.get('/monitor/connections', requirePermission('dba:READ', 'db_metric_sample'), async (req, res, next) => {
    try { res.json({ data: await monitor.connections() }); } catch (err) { next(err); }
});

/** POST /dba/monitor/capture — снять снимок метрик в историю (для графиков). */
router.post('/monitor/capture', elevated('dba:EXEC', 'db_metric_sample'), async (req, res, next) => {
    try {
        const row = await monitor.capture();
        await writeTechLog(req, {
            actionType: 'MAINTENANCE',
            description: 'Снят снимок производительности БД',
            details: { sample_id: row.id, is_healthy: row.is_healthy },
        });
        res.status(201).json({ data: row });
    } catch (err) { next(err); }
});

/** GET /dba/monitor/history — история снимков. */
router.get('/monitor/history', requirePermission('dba:READ', 'db_metric_sample'), async (req, res, next) => {
    try {
        const n = Math.min(Number(req.query.limit) || 100, 1000);
        res.json({ data: await monitor.history(n) });
    } catch (err) { next(err); }
});

/** POST /dba/monitor/refresh-stats — ANALYZE / VACUUM / REINDEX по объектам. */
router.post('/monitor/refresh-stats', elevated('dba:EXEC', 'db_metric_sample'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, {
            operation: { type: 'enum', required: true, values: ['VACUUM', 'ANALYZE', 'REINDEX'] },
            target: { type: 'string', required: false, max: 64, nullable: true },
        });
        // Идентификатор таблицы — только из каталога, не из ввода: никаких инъекций.
        let rel = null;
        if (v.target) {
            const t = await query(
                `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = $1`, [v.target]);
            if (!t.rows.length) throw httpError(404, `Таблица public.${v.target} не найдена`);
            rel = `public."${t.rows[0].relname.replace(/"/g, '""')}"`;
        }
        const sql = v.operation === 'REINDEX'
            ? `REINDEX TABLE ${rel || 'public.stock_movement'}`
            : `${v.operation === 'ANALYZE' ? 'ANALYZE' : 'VACUUM (ANALYZE)'} ${rel || ''}`.trim();
        const t0 = Date.now();
        await query(sql);
        const durationMs = Date.now() - t0;
        await writeTechLog(req, {
            actionType: v.operation === 'REINDEX' ? 'INDEX' : 'VACUUM',
            description: `Обслуживание БД: ${v.operation} ${rel || 'всей БД'}`,
            details: { sql, duration_ms: durationMs },
        });
        res.json({ data: { operation: v.operation, target: rel, duration_ms: durationMs } });
    } catch (err) { next(err); }
});

module.exports = router;
