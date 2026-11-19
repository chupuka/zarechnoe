'use strict';

/**
 * register_migrations.js — записать применённые «вручную» миграции в реестр
 * schema_migration (чтобы страница «Миграции схемы» показывала реальную
 * историю, а не список «NEW»).
 *
 * Используется только тогда, когда файл применён через psql (например, на
 * стенде без доступа к API). Штатный путь — POST /api/v1/dba/migrations/apply.
 *
 *   $env:NODE_PATH = "server/node_modules"
 *   node scripts/register_migrations.js 0004 0005 ... 0010
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const DIR = path.resolve(__dirname, '../db/migrations');
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const versions = process.argv.slice(2);
const files = fs.readdirSync(DIR)
    .map((name) => ({ name, m: FILE_RE.exec(name) }))
    .filter((x) => x.m)
    .map(({ name, m }) => ({ version: m[1], name }))
    .filter((f) => !versions.length || versions.includes(f.version))
    .sort((a, b) => a.version.localeCompare(b.version));

async function main() {
    const client = new Client({
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5433', 10),
        user: process.env.PGUSER || 'farm',
        password: process.env.PGPASSWORD || 'farm',
        database: process.env.PGDATABASE || 'farm',
    });
    await client.connect();
    for (const f of files) {
        const sum = crypto.createHash('sha256')
            .update(fs.readFileSync(path.join(DIR, f.name))).digest('hex');
        await client.query(
            `INSERT INTO schema_migration
                (version, filename, checksum, status, applied_by, started_at, finished_at, duration_ms)
             VALUES ($1, $2, $3, 'APPLIED', 1, now(), now(), 0)
             ON CONFLICT (version) DO UPDATE SET
                 filename = EXCLUDED.filename,
                 checksum = EXCLUDED.checksum,
                 status = 'APPLIED',
                 finished_at = now(),
                 error_message = NULL`,
            [f.version, f.name, sum]);
        console.log(`${f.version}  ${f.name}  ${sum.slice(0, 12)}`);
    }
    const { rows } = await client.query('SELECT count(*)::int AS n FROM schema_migration');
    console.log('Записей в реестре миграций:', rows[0].n);
    await client.end();
}

main().catch((err) => { console.error('Ошибка:', err.message); process.exit(1); });
