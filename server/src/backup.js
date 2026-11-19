'use strict';

/**
 * Резервное копирование — общая логика (ручной запуск, расписание, восстановление).
 *
 * Вынесено из routes/tech.js, потому что теперь копии создаются из двух мест:
 *   * кнопкой администратора (POST /tech/backups, origin = 'MANUAL');
 *   * планировщиком по настройкам farm_settings (origin = 'SCHEDULE').
 * Дублировать вызовы pg_dump в двух местах — гарантированный рассинхрон, поэтому
 * обе точки входа идут через createBackup()/createRestore().
 *
 * Скрипт запускается через child_process.execFile (без shell — нет инъекций).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const config = require('./config');
const { writeAudit, writeTechLog } = require('./audit');

// server/src -> ../../scripts/backup_restore.py (WEB_Ferma/scripts),
// в Docker-образе /app/src -> ../scripts/backup_restore.py (/app/scripts).
const SCRIPT_CANDIDATES = [
    process.env.BACKUP_SCRIPT,
    path.resolve(__dirname, '../../scripts/backup_restore.py'),
    path.resolve(__dirname, '../scripts/backup_restore.py'),
    '/app/scripts/backup_restore.py',
].filter(Boolean);
const SCRIPT = SCRIPT_CANDIDATES.find((p) => fs.existsSync(p)) || SCRIPT_CANDIDATES[0];
const PYTHON = process.env.PYTHON_BIN || 'py';

/** Вызвать scripts/backup_restore.py (execFile — аргументы не через shell). */
function runBackupScript(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        execFile(PYTHON, [SCRIPT, ...args],
            { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) {
                    return reject(new Error(`${err.message}\n${stderr || ''}`.trim()));
                }
                try {
                    resolve(JSON.parse(String(stdout).trim()));
                } catch (_) {
                    reject(new Error(
                        `Некорректный ответ backup_restore.py: ${String(stdout).slice(0, 400)}`));
                }
            });
    });
}

/** Итоговые цифры по копиям на диске (для страницы «Резервные копии»). */
function filesSummary(files) {
    const list = files || [];
    return {
        count: list.length,
        total_bytes: list.reduce((s, f) => s + Number(f.size_bytes || 0), 0),
        total_mb: Math.round((list.reduce((s, f) => s + Number(f.size_bytes || 0), 0)
            / (1024 * 1024)) * 10) / 10,
        newest: list.length ? list[list.length - 1].created_at : null,
        will_expire: list.filter((f) => f.will_expire).length,
    };
}

/**
 * Создать резервную копию.
 * Возвращает запись backup_job. Ошибка pg_dump фиксируется в БД (status FAILED)
 * и пробрасывается дальше — вызывающий сам решает, отдавать 500 или записать
 * в планировщик.
 */
async function createBackup({ userId, backupType = 'FULL', retentionDays = 30, note = '', origin = 'MANUAL' }) {
    const ins = await query(
        `INSERT INTO backup_job (backup_type, status, retention_days, initiated_by, origin)
         VALUES ($1, 'RUNNING', $2, $3, $4) RETURNING *`,
        [backupType, retentionDays, userId, origin]);

    let result;
    try {
        result = await runBackupScript([
            'backup', '--type', backupType, '--retention', String(retentionDays),
            '--id', String(ins.rows[0].id), '--note', note || '',
        ]);
    } catch (e) {
        await query(
            `UPDATE backup_job SET status = 'FAILED', finished_at = now(), file_path = $2
             WHERE id = $1`,
            [ins.rows[0].id, String(e.message).slice(0, 490)]);
        const err = new Error(`Резервное копирование не выполнено: ${e.message}`);
        err.status = 500;
        err.jobId = ins.rows[0].id;
        throw err;
    }

    const { rows } = await query(
        `UPDATE backup_job SET status = 'OK', finished_at = now(),
                file_path = $2, size_bytes = $3, checksum = $4
         WHERE id = $1 RETURNING *`,
        [ins.rows[0].id, result.file_path, result.size_bytes, result.checksum]);
    const job = rows[0];

    await writeTechLog(null, {
        actionType: 'BACKUP',
        description: `Резервная копия #${job.id} (${backupType}, ${origin}) создана: ${result.file_path}`,
        details: { size_bytes: result.size_bytes, checksum: result.checksum,
                   retention_days: retentionDays, origin },
        adminUserId: userId,
    });
    return job;
}

/**
 * Восстановление из копии.
 * reason обязателен: восстановление затирает данные, «просто так» его не делают.
 */
async function createRestore({ userId, backupJobId, reason }) {
    const src = await query(
        'SELECT id, file_path, checksum, status FROM backup_job WHERE id = $1', [backupJobId]);
    if (!src.rows.length) {
        const e = new Error(`Резервная копия ${backupJobId} не найдена`);
        e.status = 404;
        throw e;
    }
    if (src.rows[0].status !== 'OK') {
        const e = new Error('Восстановление возможно только из копии со статусом OK');
        e.status = 400;
        throw e;
    }

    const ins = await query(
        `INSERT INTO restore_job (backup_job_id, status, reason, performed_by, source_file)
         VALUES ($1, 'RUNNING', $2, $3, $4) RETURNING *`,
        [backupJobId, reason, userId, src.rows[0].file_path]);

    let result;
    try {
        result = await runBackupScript(['restore', '--file', src.rows[0].file_path,
            '--checksum', src.rows[0].checksum || '', '--id', String(ins.rows[0].id)]);
    } catch (e) {
        await query('UPDATE restore_job SET status = \'FAILED\', finished_at = now() WHERE id = $1',
            [ins.rows[0].id]);
        await writeTechLog(null, {
            actionType: 'RESTORE',
            description: `Восстановление #${ins.rows[0].id} НЕ выполнено: ${e.message}`,
            details: { status: 'FAILED' },
            adminUserId: userId,
        });
        const err = new Error(`Восстановление не выполнено: ${e.message}`);
        err.status = 500;
        throw err;
    }

    const done = await query(
        `UPDATE restore_job SET status = 'OK', finished_at = now() WHERE id = $1 RETURNING *`,
        [ins.rows[0].id]);
    await writeTechLog(null, {
        actionType: 'RESTORE',
        description: `Восстановление #${done.rows[0].id} из копии #${backupJobId} выполнено. Причина: ${reason}`,
        details: { file: src.rows[0].file_path, verified: true },
        adminUserId: userId,
    });
    return { job: done.rows[0], verification: result };
}

/** Текущие настройки расписания из farm_settings (ключи созданы миграцией 0007). */
async function scheduleSettings() {
    const { rows } = await query(
        `SELECT setting_key, value_type, value_text, value_num
           FROM farm_settings
          WHERE setting_key IN ('backup_enabled','backup_schedule','backup_time',
                                'backup_retention_days','backup_keep_last')`);
    const map = {};
    for (const r of rows) {
        map[r.setting_key] = r.value_type === 'NUM' ? Number(r.value_num || 0)
            : (r.value_type === 'BOOL' ? (Number(r.value_num) === 1 || r.value_text === 'true') : r.value_text);
    }
    return {
        enabled: map.backup_enabled !== undefined ? Boolean(map.backup_enabled) : true,
        schedule: map.backup_schedule || 'DAILY',
        time: map.backup_time || '02:00',
        retention_days: map.backup_retention_days || 30,
        keep_last: map.backup_keep_last || 10,
    };
}

/** Сохранить настройки расписания (PATCH /tech/backups/schedule). */
async function saveScheduleSettings(patch, userId) {
    const allowed = {
        backup_enabled: 'BOOL',
        backup_schedule: 'TEXT',
        backup_time: 'TEXT',
        backup_retention_days: 'NUM',
        backup_keep_last: 'NUM',
    };
    const changed = [];
    for (const [key, value] of Object.entries(patch)) {
        const type = allowed[key];
        if (!type) {
            const e = new Error(`Неизвестная настройка расписания: ${key}`);
            e.status = 400;
            throw e;
        }
        const num = type === 'NUM' || type === 'BOOL'
            ? Number(value === true ? 1 : value === false ? 0 : value) : null;
        if ((type === 'NUM' || type === 'BOOL') && !Number.isFinite(num)) {
            const e = new Error(`${key}: ожидается число`);
            e.status = 400;
            throw e;
        }
        await query(
            `UPDATE farm_settings
                SET value_text = $2, value_num = $3, updated_by = $4, updated_at = now()
              WHERE setting_key = $1`,
            [key, type === 'TEXT' ? String(value) : null,
             (type === 'TEXT') ? null : num, userId]);
        changed.push({ key, value });
    }
    return { changed, schedule: await scheduleSettings() };
}

module.exports = {
    SCRIPT, PYTHON, runBackupScript, filesSummary,
    createBackup, createRestore, scheduleSettings, saveScheduleSettings,
    schedulerEnabled: () => config.backup.enabled,
};
