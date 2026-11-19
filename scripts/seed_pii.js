'use strict';

/**
 * seed_pii.js — перенос персональных данных сотрудников в зашифрованное
 * хранилище `employee_pii` (pgcrypto, AES-256).
 *
 * Запуск (из каталога WEB_Ferma, рядом с контейнером farm_pg):
 *
 *   $env:NODE_PATH = "server/node_modules"
 *   $env:PII_KEY   = "zarechnoe-pii-key-2026-demo-32chars-min"
 *   node scripts/seed_pii.js
 *
 * Ключ НЕ хранится в базе: он передаётся в транзакцию через
 * set_config('app.pii_key', ..., true) и живёт только на время транзакции.
 * После переноса открытая колонка employee.phone обнуляется, а миграция
 * 0010_drop_phone.sql удаляет её окончательно.
 *
 * Скрипт идемпотентен: повторный запуск перешифровывает те же данные
 * текущим ключом (полезно после ротации ключа).
 */

const crypto = require('crypto');
const { Client } = require('pg');

const KEY = process.env.PII_KEY || '';
if (KEY.length < 16) {
    console.error('PII_KEY не задан или короче 16 символов — отказ от запуска.');
    process.exit(1);
}

const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5433', 10),
    user: process.env.PGUSER || 'farm',
    password: process.env.PGPASSWORD || 'farm',
    database: process.env.PGDATABASE || 'farm',
});

/** Синтетические, но правдоподобные ПДн для демонстрации. */
function syntheticPii(emp) {
    const id = Number(emp.id);
    const pad = (n, w) => String(n).padStart(w, '0');

    const phone = emp.phone || ('+7-916-' + pad(100 + (id % 800), 3) + '-' +
        pad(id % 100, 2) + '-' + pad((id * 7) % 100, 2));

    const passport = pad(60 + (id % 9), 2) + ' ' + pad(10 + (id % 80), 2) + ' ' +
        pad(100000 + (id * 137) % 899999, 6);
    const passportBy = 'ГУ МВД России по Ростовской области, ' +
        pad(1 + (id % 28), 2) + '.' + pad(1 + (id % 12), 2) + '.20' + pad(15 + (id % 9), 2);

    const streets = ['ул. Ленина', 'ул. Садовая', 'пер. Степной', 'ул. Заречная', 'ул. Мира'];
    const address = 'Ростовская обл., г. Ростов-на-Дону, ' +
        streets[id % streets.length] + ', д. ' + (1 + (id * 3) % 90) +
        ', кв. ' + (1 + (id * 5) % 120);

    const snils = pad(100 + (id * 31) % 899, 3) + '-' + pad(100 + (id * 17) % 899, 3) + '-' +
        pad(100 + (id * 53) % 899, 3) + ' ' + pad(id % 100, 2);
    const inn = '61' + pad((id * 7919) % 10000000000, 10);
    const bank = '40817810' + pad((id * 3571) % 100000000, 8) + pad((id * 911) % 100000, 5);
    const emergency = 'Контакт для экстренной связи: ' +
        ['Иванова М.П.', 'Смирнов А.В.', 'Петрова Е.С.', 'Кузнецов Д.Н.'][id % 4] +
        ', +7-900-' + pad((id * 37) % 1000, 3) + '-' + pad((id * 11) % 100, 2) + '-' +
        pad((id * 13) % 100, 2);

    return { phone, passport, passportBy, address, snils, inn, bank, emergency };
}

async function main() {
    await client.connect();
    console.log('Подключено к БД:', client.host + ':' + client.port + '/' + client.database);

    const { rows: hasPhoneCol } = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'employee' AND column_name = 'phone'`);
    const phoneExpr = hasPhoneCol.length ? 'phone' : 'NULL::varchar AS phone';

    const { rows: employees } = await client.query(
        `SELECT id, full_name, ${phoneExpr} FROM employee WHERE NOT is_deleted ORDER BY id`);

    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.pii_key', $1, true)`, [KEY]);

    let done = 0;
    for (const emp of employees) {
        const p = syntheticPii(emp);
        const passportFull = p.passport + ' выдан: ' + p.passportBy;

        await client.query(
            `INSERT INTO employee_pii
                (employee_id, phone_enc, passport_enc, address_enc, snils_enc,
                 inn_enc, bank_enc, emergency_enc, key_version, updated_at, updated_by)
             VALUES ($1,
                     fn_pii_encrypt($2), fn_pii_encrypt($3), fn_pii_encrypt($4),
                     fn_pii_encrypt($5), fn_pii_encrypt($6), fn_pii_encrypt($7),
                     fn_pii_encrypt($8), 1, now(), 1)
             ON CONFLICT (employee_id) DO UPDATE SET
                 phone_enc     = EXCLUDED.phone_enc,
                 passport_enc  = EXCLUDED.passport_enc,
                 address_enc   = EXCLUDED.address_enc,
                 snils_enc     = EXCLUDED.snils_enc,
                 inn_enc       = EXCLUDED.inn_enc,
                 bank_enc      = EXCLUDED.bank_enc,
                 emergency_enc = EXCLUDED.emergency_enc,
                 updated_at    = now(),
                 updated_by    = 1`,
            [emp.id, p.phone, passportFull, p.address, p.snils, p.inn, p.bank, p.emergency]);

        // Маска остаётся открытой — нужна для списков без права employee:PII.
        await client.query(
            `UPDATE employee SET phone_mask = fn_phone_mask($2), phone = NULL WHERE id = $1`,
            [emp.id, p.phone]);
        done += 1;
    }

    await client.query('COMMIT');
    console.log(`Зашифровано записей: ${done}`);

    // --- Проверка -----------------------------------------------------------
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.pii_key', $1, true)`, [KEY]);
    const { rows: check } = await client.query(
        `SELECT count(*)::int AS rows,
                count(*) FILTER (WHERE phone_enc IS NOT NULL)::int AS phones,
                count(*) FILTER (WHERE octet_length(phone_enc) > 40)::int AS encrypted
           FROM employee_pii`);
    const { rows: sample } = await client.query(
        `SELECT employee_id,
                fn_pii_decrypt(phone_enc) AS phone,
                fn_pii_decrypt(passport_enc) AS passport,
                fn_pii_decrypt(snils_enc) AS snils
           FROM employee_pii ORDER BY employee_id LIMIT 1`);
    await client.query('COMMIT');

    console.log('employee_pii:', check[0]);
    console.log('Пример расшифровки:', sample[0]);

    const digest = crypto.createHash('sha256').update(KEY).digest('hex').slice(0, 12);
    console.log('Отпечаток ключа (sha256, первые 12):', digest);

    await client.end();
}

main().catch(async (err) => {
    try { await client.query('ROLLBACK'); } catch (_) { /* соединение уже закрыто */ }
    console.error('Ошибка:', err.message);
    process.exitCode = 1;
    try { await client.end(); } catch (_) { /* noop */ }
});
