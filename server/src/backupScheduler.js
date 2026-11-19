'use strict';

/**
 * Планировщик резервного копирования (ТЗ п.8 — «копии по расписанию»).
 *
 * Настройки живут в farm_settings (созданы миграцией 0007):
 *   backup_enabled        — включены ли автоматические копии;
 *   backup_schedule       — DAILY | WEEKLY | OFF;
 *   backup_time           — время запуска ЧЧ:ММ (локальное время сервера);
 *   backup_retention_days — сколько дней хранить копии;
 *   backup_keep_last      — сколько последних копий оставлять на диске.
 *
 * Планировщик не отдельный демон, а тикер внутри API-процесса: раз в минуту он
 * смотрит, наступил ли срок, и если с прошлого планового запуска успешной копии
 * не было — создаёт её. Признак «уже сделано» — запись в backup_job с
 * origin = 'SCHEDULE'. Это устойчиво к перезапускам контейнера: после рестарта
 * копия не будет делаться повторно в тот же день.
 */

const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const config = require('./config');
const { createBackup, scheduleSettings } = require('./backup');
const { listFiles } = require('./dbAdmin/backupFiles');
const { writeTechLog } = require('./audit');

let running = false;
let timer = null;
let lastError = null;
let lastRun = null;

/** «02:00» -> { h: 2, m: 0 } (мусор -> 02:00). */
function parseTime(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
    if (!m) return { h: 2, m: 0 };
    const h = Math.min(Math.max(Number(m[1]), 0), 23);
    const min = Math.min(Math.max(Number(m[2]), 0), 59);
    return { h, m: min };
}

/**
 * Ближайший прошедший плановый момент для расписания.
 * DAILY — сегодня в HH:MM (или вчера, если время ещё не наступило);
 * WEEKLY — ближайший понедельник в HH:MM не позже «сейчас».
 */
function dueMoment(settings, now = new Date()) {
    const { h, m } = parseTime(settings.time);
    const at = new Date(now);
    at.setSeconds(0, 0);
    at.setHours(h, m, 0, 0);
    if (settings.schedule === 'WEEKLY') {
        // Приводим к понедельнику той недели, затем отступаем назад, пока > now
        const shift = (at.getDay() + 6) % 7;
        at.setDate(at.getDate() - shift);
        while (at.getTime() > now.getTime()) at.setDate(at.getDate() - 7);
        return at;
    }
    if (settings.schedule === 'DAILY' || settings.schedule === '') {
        if (at.getTime() > now.getTime()) at.setDate(at.getDate() - 1);
        return at;
    }
    return null; // OFF — не планируем
}

/** Учётная запись, от имени которой пишутся автокопии (администратор БД). */
async function systemUserId() {
    const { rows } = await query(
        `SELECT u.id FROM app_user u JOIN role r ON r.id = u.role_id
          WHERE r.code = 'DBA' AND u.is_active AND NOT u.is_deleted
          ORDER BY u.id LIMIT 1`);
    if (rows.length) return rows[0].id;
    const any = await query('SELECT id FROM app_user WHERE NOT is_deleted ORDER BY id LIMIT 1');
    return any.rows.length ? any.rows[0].id : 1;
}

/** Оставить на диске только keep_last последних копий. */
function rotateByCount(keepLast) {
    if (!keepLast || keepLast <= 0) return { removed: [] };
    const { files } = listFiles(3650);
    if (files.length <= keepLast) return { removed: [] };
    const extra = files.slice(0, files.length - keepLast);
    const removed = [];
    for (const f of extra) {
        try {
            fs.unlinkSync(f.path);
            if (f.has_checksum) {
                const sum = f.path + '.sha256';
                if (fs.existsSync(sum)) fs.unlinkSync(sum);
            }
            removed.push(f.file);
        } catch (err) {
            console.error('backup rotation:', f.file, err.message);
        }
    }
    return { removed };
}

/** Один шаг планировщика: решить, нужна ли копия, и, если нужна, сделать её. */
async function tick(now = new Date()) {
    if (running) return { skipped: 'busy' };
    const settings = await scheduleSettings();
    if (!settings.enabled || settings.schedule === 'OFF') return { skipped: 'disabled' };

    const due = dueMoment(settings, now);
    if (!due) return { skipped: 'no_schedule' };

    // Была ли успешная плановая копия после планового момента?
    const { rows } = await query(
        `SELECT max(started_at) AS last FROM backup_job
          WHERE origin = 'SCHEDULE' AND status = 'OK' AND started_at >= $1`,
        [due]);
    if (rows[0].last) return { skipped: 'already_done', last: rows[0].last };

    running = true;
    try {
        const userId = await systemUserId();
        const job = await createBackup({
            userId,
            backupType: 'FULL',
            retentionDays: settings.retention_days || 30,
            note: `автоматическая копия по расписанию (${settings.schedule} ${settings.time})`,
            origin: 'SCHEDULE',
        });
        const rot = rotateByCount(settings.keep_last);
        await writeTechLog(null, {
            actionType: 'BACKUP',
            description: `Плановая копия #${job.id} создана; ротация убрала ${rot.removed.length} файл(ов)`,
            details: { job_id: job.id, kept: settings.keep_last, removed: rot.removed },
            adminUserId: userId,
        });
        lastRun = { at: new Date().toISOString(), job_id: job.id, removed: rot.removed.length };
        lastError = null;
        return { created: job.id, removed: rot.removed.length };
    } catch (err) {
        lastError = { at: new Date().toISOString(), message: err.message };
        console.error('backup scheduler:', err.message);
        await writeTechLog(null, {
            actionType: 'BACKUP',
            description: `Плановая копия НЕ создана: ${err.message}`,
            details: { status: 'FAILED', schedule: settings.schedule, time: settings.time },
            adminUserId: await systemUserId().catch(() => null),
        });
        return { error: err.message };
    } finally {
        running = false;
    }
}

/** Статус планировщика (для страницы «Резервные копии»). */
function status() {
    return {
        enabled: config.backup.enabled,
        tick_ms: config.backup.tickMs,
        running,
        last_run: lastRun,
        last_error: lastError,
        next_check_in_ms: config.backup.tickMs,
    };
}

/** Запустить тикер. Вызывается один раз из index.js. */
function start() {
    if (!config.backup.enabled) {
        console.log('Планировщик резервного копирования выключен (BACKUP_SCHEDULER=off)');
        return null;
    }
    timer = setInterval(() => { tick().catch((e) => console.error('scheduler tick:', e.message)); },
        Math.max(config.backup.tickMs, 5000));
    if (timer.unref) timer.unref();
    console.log(`Планировщик резервного копирования запущен (проверка каждые ${config.backup.tickMs} мс)`);
    return timer;
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { start, stop, tick, status, dueMoment, parseTime, rotateByCount };
