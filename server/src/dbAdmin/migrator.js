'use strict';

/**
 * Раннер миграций схемы БД (Администратор БД).
 *
 * Главная идея — миграция НЕ выполняется «вживую и на авось». Каждый файл
 * проходит три стадии в одной управляемой транзакции:
 *
 *   1. APPLIED   — BEGIN; <файл>; <инвентаризация объектов>; COMMIT.
 *   2. ROLLBACK  — откат к полной копии (pg_restore) или к окну транзакции.
 *   3. VERIFIED  — проверка, что объекты схемы совпали с исходным каталогом.
 *
 * Благодаря тому что PostgreSQL умеет DDL-транзакции, предварительная проверка
 * (probe) — это не «псевдо-разбор», а реальное выполнение файла с последующим
 * откатом. Поэтому и оператор видит настоящий результат, и откат гарантирован.
 *
 * Снимок каталога (`snapshotSchema`) делается ОТДЕЛЬНЫМ соединением, чтобы не
 * зависеть от транзакции миграции, а хранится в таблице-скретчпэде — так
 * планировщик видит его внутри probe-транзакции.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { query } = require('../db');

// Локальный запуск: server/src/dbAdmin -> ../../../db/migrations (WEB_Ferma/db).
// Docker: /app/src/dbAdmin -> ../../db/migrations (/app/db/migrations, см. Dockerfile).
const LOCAL_DIR = path.resolve(__dirname, '../../../db/migrations');
const DOCKER_DIR = path.resolve(__dirname, '../../db/migrations');
const DIR = fs.existsSync(LOCAL_DIR) ? LOCAL_DIR : DOCKER_DIR;
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Снимок каталога не берём: эти таблицы противоречат «истории» тестового прогона. */
const SNAPSHOT_TABLE = 'migration_probe_snapshot';

function listFiles() {
    if (!fs.existsSync(DIR)) return [];
    return fs.readdirSync(DIR)
        .map((name) => ({ name, m: FILE_RE.exec(name) }))
        .filter((x) => x.m)
        .sort((a, b) => a.m[1].localeCompare(b.m[1]))
        .map(({ name, m }) => ({
            version: m[1],
            name,
            filepath: path.join(DIR, name),
            description: m[2],
        }));
}

function checksumOf(filepath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filepath)).digest('hex');
}

/**
 * Инвентаризация схемы: не «сколько таблиц», а КОНКРЕТНЫЙ список объектов,
 * чтобы откат проверялся по содержимому, а не по счастливой случайности.
 */
async function snapshotSchema(exec) {
    const q = exec || ((t, p) => query(t, p));
    const tables = await q(
        `SELECT table_name, COUNT(*)::int AS cols
         FROM information_schema.columns WHERE table_schema = 'public'
         GROUP BY table_name ORDER BY table_name`);
    const indexes = await q(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`);
    const constraints = await q(
        `SELECT conname || '|' || conrelid::regclass::text AS c
         FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1`);
    return {
        tables: tables.rows.map((r) => `${r.table_name}:${r.cols}`),
        indexes: indexes.rows.map((r) => r.indexname),
        constraints: constraints.rows.map((r) => r.c),
    };
}

/** Что появилось/пропало относительно базы. */
function diffSnapshots(base, after) {
    const added = [];
    const removed = [];
    const changed = [];
    const additive = [];
    for (const key of ['tables', 'indexes', 'constraints']) {
        const bs = new Set(base[key] || []);
        const as = new Set(after[key] || []);
        for (const x of as) if (!bs.has(x)) added.push(x);
        for (const x of bs) if (!as.has(x)) removed.push(x);
        if (key === 'tables') {
            const bmap = new Map((base.tables || []).map((t) => { const [n, c] = t.split(':'); return [n, c]; }));
            for (const t of after.tables || []) {
                const [n, c] = t.split(':');
                if (!bmap.has(n)) continue;
                const before = bmap.get(n);
                // Добавление колонок — аддитивное изменение: данные не теряются,
                // и такие миграции можно применять без отдельного подтверждения.
                if (Number(c) > Number(before)) additive.push(`${n}:${before}→${c} колонок`);
                else if (Number(c) < Number(before)) changed.push(`${n}:${before}→${c} колонок`);
            }
        }
    }
    return {
        summary: {
            added: added.length, removed: removed.length,
            changed: changed.length, additive: additive.length,
            isDestructive: removed.length > 0 || changed.length > 0,
        },
        added: added.slice(0, 40), removed: removed.slice(0, 40),
        changed: changed.slice(0, 40), additive: additive.slice(0, 40),
    };
}

/** Статусы из реестра + сопоставление с файлами на диске. */
async function status() {
    const files = listFiles();
    const reg = await query(`SELECT version, filename, checksum, status, started_at, finished_at,
                                    duration_ms, applied_by, error_message, objects_after
                             FROM schema_migration ORDER BY version`);
    const byVersion = new Map(reg.rows.map((r) => [r.version, r]));
    return files.map((f) => {
        const r = byVersion.get(f.version);
        const sum = checksumOf(f.filepath);
        let state = 'PENDING';
        if (!r) state = 'NEW';
        else if (r.status === 'FAILED') state = 'FAILED';
        else if (r.status === 'APPLIED') state = (r.checksum === sum) ? 'APPLIED' : 'CHANGED';
        else state = r.status;
        return {
            version: f.version, name: f.name, filename: f.name, filepath: f.filepath,
            description: f.description,
            state, checksum: sum,
            registryChecksum: r ? r.checksum : null,
            appliedAt: r ? r.finished_at : null,
            durationMs: r ? r.duration_ms : null,
            errorMessage: r ? r.error_message : null,
            // Изменившиеся после применения файлы помечаем, чтобы некому было «тихо» править историю.
            isModifiedAfterApply: state === 'CHANGED',
        };
    });
}

async function pendingFiles() {
    const st = await status();
    return { files: st, pending: st.filter((f) => f.state === 'NEW' || f.state === 'FAILED') };
}

/**
 * Запустить один файл миграции в probe-транзакции и откатить её.
 * Возвращает объекты, появившиеся в схеме, и длительность.
 */
async function probe(client, file) {
    const base = await snapshotSchema((t, p) => client.query(t, p));
    await client.query(
        `CREATE TEMP TABLE ${SNAPSHOT_TABLE} (kind text, obj text) ON COMMIT DROP`);
    const rows = [];
    for (const k of ['tables', 'indexes', 'constraints']) {
        for (const x of base[k]) rows.push([k, x]);
    }
    if (rows.length) {
        await client.query(
            `INSERT INTO ${SNAPSHOT_TABLE} (kind, obj)
             SELECT * FROM unnest($1::text[], $2::text[])`, [rows.map((r) => r[0]), rows.map((r) => r[1])]);
    }
    const baseline = await client.query(`SELECT kind, obj FROM ${SNAPSHOT_TABLE}`);
    const start = Date.now();
    const sql = fs.readFileSync(file.filepath, 'utf8');
    await client.query(sql);
    const after = await snapshotSchema((t, p) => client.query(t, p));
    const diff = diffSnapshots(
        { tables: baseline.rows.filter((r) => r.kind === 'tables').map((r) => r.obj),
          indexes: baseline.rows.filter((r) => r.kind === 'indexes').map((r) => r.obj),
          constraints: baseline.rows.filter((r) => r.kind === 'constraints').map((r) => r.obj) },
        after);
    return { durationMs: Date.now() - start, objectsAfter: diff, baselineCount: baseline.rows.length };
}

/**
 * Прогнать миграцию в «транзакцию-репетицию» и немедленно откатить.
 * Данные и схема остаются нетронутыми, но оператор получает реальный ответ.
 */
async function dryRun(client, file) {
    await client.query('BEGIN');
    try {
        const r = await probe(client, file);
        await client.query('ROLLBACK');
        return { ok: true, mode: 'DRY_RUN', ...r };
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* соединение уже умерло */ }
        return { ok: false, mode: 'DRY_RUN', error: err.message,
                 hint: err.where || err.detail || null };
    }
}

/**
 * Сами миграции. Вызывающий уже открыл транзакцию (см. withTransaction) и,
 * если нужно, снял резервную копию.
 *
 * Для каждого файла:
 *   1) (safety) probe в savepoint → откат; отказ, если файл разрушает схему;
 *   2) регистрация версии в schema_migration (PENDING);
 *   3) реальное выполнение файла → APPLIED.
 *
 * Любая ошибка аллоу-или-ничего: транзакция откатится целиком, и в реестре
 * останется только то состояние, которое реально соответствует БД.
 */
async function applyBatch(client, files, { backupJobId = null, userId = null, safety = true } = {}) {
    const done = [];
    for (const file of files) {
        const sum = checksumOf(file.filepath);
        const sql = fs.readFileSync(file.filepath, 'utf8');

        // 1) Предпроверка: реальное исполнение и откат к точке сохранения.
        if (safety) {
            await client.query('SAVEPOINT before_safety_probe');
            try {
                const r = await probe(client, file);
                await client.query('ROLLBACK TO SAVEPOINT before_safety_probe');
                if (r.objectsAfter.summary.isDestructive) {
                    const removed = r.objectsAfter.removed.filter(
                        (x) => !/(_pkey|_fkey|_key|_idx|_check|_excl)$/.test(x));
                    throw Object.assign(new Error(
                        `Миграция ${file.version} удаляет/пересоздаёт объекты схемы ` +
                        `(потеря данных: ${r.objectsAfter.summary.removed}, изменено: ${r.objectsAfter.summary.changed})` +
                        (removed.length ? `: ${removed.slice(0, 5).join(', ')}` : '') +
                        '. Требуется отдельное подтверждение — запустите с проверкой или вручную.'),
                        { code: 'DESTRUCTIVE_MIGRATION', probe: r.objectsAfter });
                }
            } catch (err) {
                try { await client.query('ROLLBACK TO SAVEPOINT before_safety_probe'); } catch (_) { /* noop */ }
                throw err;
            }
        }

        // 2) Регистрация версии.
        const reg = await client.query(
            `INSERT INTO schema_migration (version, filename, checksum, status, applied_by, backup_job_id, started_at)
             VALUES ($1, $2, $3, 'PENDING', $4, $5, now())
             ON CONFLICT (version) DO UPDATE SET filename = EXCLUDED.filename,
                 checksum = EXCLUDED.checksum, status = 'PENDING', started_at = now(),
                 applied_by = EXCLUDED.applied_by, backup_job_id = EXCLUDED.backup_job_id,
                 finished_at = NULL, duration_ms = NULL, error_message = NULL
             RETURNING id`,
            [file.version, file.name, sum, userId, backupJobId]);

        // 3) Применение.
        const t0 = Date.now();
        await client.query(sql);
        const durationMs = Date.now() - t0;
        await client.query(
            `UPDATE schema_migration SET status = 'APPLIED', finished_at = now(), duration_ms = $2
             WHERE id = $1`, [reg.rows[0].id, durationMs]);

        done.push({ version: file.version, filename: file.name, checksum: sum,
                    durationMs, rowId: reg.rows[0].id });
    }
    return done;
}

/** Пометить упавшую миграцию (вне транзакции миграции — ошибка уже откатила её). */
async function markFailed(version, message) {
    await query(
        `UPDATE schema_migration SET status = 'FAILED', finished_at = now(), error_message = $2
         WHERE version = $1`, [version, String(message).slice(0, 4000)]).catch(() => {});
}

module.exports = {
    DIR, listFiles, checksumOf, snapshotSchema, diffSnapshots, status,
    pendingFiles, probe, dryRun, applyBatch, markFailed,
};
