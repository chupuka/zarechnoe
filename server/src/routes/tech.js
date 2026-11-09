'use strict';

/**
 * Технадминка (Неделя 6) — /api/v1/tech.
 *
 * ФИЗИЧЕСКИ И ЛОГИЧЕСКИ ОТДЕЛЕНА от бизнес-админки (routes/admin.js):
 *   * доступ только по праву tech:READ / tech:EXEC (у бизнес-ролей его нет);
 *   * все действия пишутся в tech_log (а не в бизнес-аудит) +-duty аудит;
 *   * технические роли обязаны передать X-Override-Reason (усиленный аудит).
 *
 * Резервное копирование: POST запускает реальный pg_dump через
 * scripts/backup_restore.py, результат (путь/размер/контрольная сумма)
 * фиксируется в backup_job. Восстановление — pg_restore в restore_job.
 * Скрипт вызывается через child_process.execFile (БЕЗ shell → нет инъекций).
 */

const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { elevated } = require('../middleware/elevated');
const { writeAudit, writeTechLog } = require('../audit');
const { httpError, asInt, validate, parsePaging } = require('../validation');

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

const SCRIPT = path.resolve(__dirname, '../../scripts/backup_restore.py');
const PYTHON = process.env.PYTHON_BIN || 'py';

/** Вызвать scripts/backup_restore.py (execFile — аргументы не через shell). */
function runBackupScript(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        execFile(PYTHON, [SCRIPT, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) return reject(new Error(`${err.message}\n${stderr || ''}`.trim()));
                try { resolve(JSON.parse(String(stdout).trim())); }
                catch (e) { reject(new Error(`Некорректный ответ backup_restore.py: ${String(stdout).slice(0, 400)}`)); }
            });
    });
}

// ============================================================================
// Резервные копии
// ============================================================================

/** GET /tech/backups — журнал резервных копий */
router.get('/backups', requirePermission('backup:READ', 'backup_job'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const status = String(req.query.status || '').trim();
        const type = String(req.query.backup_type || '').trim();
        const where = [];
        const params = [];
        if (status) { where.push(`b.status = $${params.length + 1}::text`); params.push(status); }
        if (type) { where.push(`b.backup_type = $${params.length + 1}::text`); params.push(type); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT b.id, b.backup_type, b.started_at, b.finished_at, b.status,
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
 * POST /tech/backups — создать резервную копию.
 * Вся операция транзакционна: запись RUNNING → pg_dump → OK/FAILED.
 */
router.post('/backups', elevated('backup:EXEC', 'backup_job'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, BACKUP_SPECS);
        const retention = v.retention_days || 30;
        const ins = await query(
            `INSERT INTO backup_job (backup_type, status, retention_days, initiated_by)
             VALUES ($1, 'RUNNING', $2, $3) RETURNING *`,
            [v.backup_type, retention, req.user.id]);

        let result;
        try {
            result = await runBackupScript([
                'backup', '--type', v.backup_type, '--retention', String(retention),
                '--id', String(ins.rows[0].id), '--note', v.note || '',
            ]);
        } catch (e) {
            await query(
                `UPDATE backup_job SET status = 'FAILED', finished_at = now(), file_path = $2
                 WHERE id = $1`, [ins.rows[0].id, String(e.message).slice(0, 490)]);
            await writeTechLog(req, { actionType: 'BACKUP', description: `Бэкап #${ins.rows[0].id} НЕ выполнен: ${e.message}`, details: { status: 'FAILED' } });
            throw httpError(500, `Резервное копирование не выполнено: ${e.message}`);
        }

        const done = await query(
            `UPDATE backup_job SET status = 'OK', finished_at = now(),
                    file_path = $2, size_bytes = $3, checksum = $4
             WHERE id = $1 RETURNING *`,
            [ins.rows[0].id, result.file_path, result.size_bytes, result.checksum]);

        await writeTechLog(req, { actionType: 'BACKUP',
            description: `Резервная копия #${done.rows[0].id} (${v.backup_type}) создана: ${result.file_path}`,
            details: { size_bytes: result.size_bytes, checksum: result.checksum, retention_days: retention } });
        await writeAudit(req, { entityName: 'backup_job', entityId: done.rows[0].id, action: 'CREATE',
                                after: { backup_type: v.backup_type, file: result.file_path } });
        res.status(201).json({ data: done.rows[0] });
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
             JOIN backup_job b ON b.id = r.backup_job_id
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
        const src = await query(
            `SELECT id, file_path, checksum, status FROM backup_job WHERE id = $1`, [v.backup_job_id]);
        if (!src.rows.length) throw httpError(404, `Резервная копия ${v.backup_job_id} не найдена`);
        if (src.rows[0].status !== 'OK') throw httpError(400, 'Восстановление возможно только из копии со статусом OK');

        const ins = await query(
            `INSERT INTO restore_job (backup_job_id, status, reason, performed_by)
             VALUES ($1, 'RUNNING', $2, $3) RETURNING *`,
            [v.backup_job_id, v.reason, req.user.id]);

        let result;
        try {
            result = await runBackupScript(['restore', '--file', src.rows[0].file_path,
                                           '--checksum', src.rows[0].checksum || '',
                                           '--id', String(ins.rows[0].id)]);
        } catch (e) {
            await query(`UPDATE restore_job SET status = 'FAILED', finished_at = now() WHERE id = $1`, [ins.rows[0].id]);
            await writeTechLog(req, { actionType: 'RESTORE', description: `Восстановление #${ins.rows[0].id} НЕ выполнено: ${e.message}`, details: { status: 'FAILED' } });
            throw httpError(500, `Восстановление не выполнено: ${e.message}`);
        }

        const done = await query(
            `UPDATE restore_job SET status = 'OK', finished_at = now() WHERE id = $1 RETURNING *`,
            [ins.rows[0].id]);
        await writeTechLog(req, { actionType: 'RESTORE',
            description: `Восстановление #${done.rows[0].id} из копии #${v.backup_job_id} выполнено. Причина: ${v.reason}`,
            details: { file: src.rows[0].file_path, verified: true } });
        await writeAudit(req, { entityName: 'restore_job', entityId: done.rows[0].id, action: 'CREATE',
                                after: { backup_job_id: v.backup_job_id, reason: v.reason } });
        res.status(201).json({ data: done.rows[0], verification: result });
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
