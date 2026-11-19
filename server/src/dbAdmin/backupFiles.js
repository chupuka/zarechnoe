'use strict';

/**
 * Операции с файлами резервных копий (ротация, список) — нативная реализация.
 *
 * Зачем не через backup_restore.py: этим операциям не нужен pg_dump, а запуск
 * интерпретатора через child_process в ряде окружений (в т.ч. изолированный
 * запуск сервера) запрещён политикой процессов (spawn EPERM). Чтение каталога
 * и удаление файлов делаются средствами Node — надёжнее и без внешних зависимостей.
 *
 * Контракт намеренно совпадает с scripts/backup_restore.py:
 *   * тот же каталог: FARM_BACKUP_DIR или <WEB_Ferma>/backups;
 *   * формат имён: farm_<TYPE>_<YYYYmmdd_HHMMSS>_<id|manual>.dump (+ .sha256);
 *   * тот же registry.jsonl (построчно JSON) для ручных запусков.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');           // WEB_Ferma (в репозитории) / /app (в образе)
/**
 * Каталог копий: FARM_BACKUP_DIR, иначе первый существующий из кандидатов.
 * В репозитории это WEB_Ferma/backups, в Docker-образе — /app/backups
 * (см. server/Dockerfile и docker-compose.yml). Без перебора кандидатов
 * контейнер искал бы копии в /backups и показывал «0 файлов».
 */
const CANDIDATES = [
    process.env.FARM_BACKUP_DIR,
    path.join(ROOT, 'backups'),
    path.resolve(__dirname, '../../../backups'),
    '/app/backups',
].filter(Boolean);
const BACKUP_DIR = CANDIDATES.find((p) => fs.existsSync(p)) || CANDIDATES[0];

function ensureDir() {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    return BACKUP_DIR;
}

/** Распарсить имя дампа: farm_FULL_20261110_153000_12.dump */
function parseName(name) {
    const m = /^farm_(FULL|INCREMENTAL)_(\d{8})_(\d{6})_(.+)\.dump$/.exec(name);
    if (!m) return null;
    const d = `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6, 8)}`;
    const t = `${m[3].slice(0, 2)}:${m[3].slice(2, 4)}:${m[3].slice(4, 6)}`;
    return { type: m[1], createdAt: new Date(`${d}T${t}`), tag: m[4] };
}

/** Список копий на диске (не из БД!) с расчётом срока жизни по retention. */
function listFiles(retentionDays = 30) {
    ensureDir();
    const now = Date.now();
    const files = [];
    for (const name of fs.readdirSync(BACKUP_DIR).sort()) {
        if (!name.endsWith('.dump')) continue;
        const meta = parseName(name);
        const full = path.join(BACKUP_DIR, name);
        let st;
        try { st = fs.statSync(full); } catch (_) { continue; }
        if (!st.isFile()) continue;
        const ageDays = (now - st.mtimeMs) / 86400000;
        files.push({
            file: name,
            path: full,
            size_bytes: st.size,
            created_at: new Date(st.mtimeMs).toISOString(),
            created_from_name: meta ? meta.createdAt.toISOString() : null,
            type: meta ? meta.type : null,
            age_days: Math.round(ageDays * 100) / 100,
            expires_in_days: Math.round((retentionDays - ageDays) * 100) / 100,
            will_expire: ageDays >= retentionDays,
            has_checksum: fs.existsSync(full + '.sha256'),
            checksum: fs.existsSync(full + '.sha256')
                ? fs.readFileSync(full + '.sha256', 'utf8').trim().split(/\s+/)[0] : null,
        });
    }
    return {
        files,
        count: files.length,
        total_bytes: files.reduce((s, f) => s + f.size_bytes, 0),
        backup_dir: BACKUP_DIR,
        retention_days: retentionDays,
    };
}

/** Удалить копии (и их .sha256) старше retention дней. */
function rotate(retentionDays = 30) {
    ensureDir();
    const cutoff = Date.now() - retentionDays * 86400000;
    const removed = [];
    for (const name of fs.readdirSync(BACKUP_DIR)) {
        if (!(name.endsWith('.dump') || name.endsWith('.sha256'))) continue;
        const full = path.join(BACKUP_DIR, name);
        let st;
        try { st = fs.statSync(full); } catch (_) { continue; }
        if (!st.isFile() || st.mtimeMs >= cutoff) continue;
        fs.unlinkSync(full);
        removed.push(name);
    }
    appendRegistry({ action: 'rotate', retention_days: retentionDays, removed,
                     ts: new Date().toISOString() });
    return { removed, removed_count: removed.length, retention_days: retentionDays };
}

function appendRegistry(entry) {
    ensureDir();
    fs.appendFileSync(path.join(BACKUP_DIR, 'registry.jsonl'),
        JSON.stringify(entry) + '\n', 'utf8');
}

module.exports = { BACKUP_DIR, ensureDir, listFiles, rotate, appendRegistry, parseName };
