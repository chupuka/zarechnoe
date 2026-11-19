'use strict';

/**
 * Персональные данные сотрудников (ТЗ п.7 — защита ПДн).
 *
 * Схема защиты:
 *   * в БД лежит ТОЛЬКО шифротекст (bytea) в таблице employee_pii;
 *   * ключ живёт вне БД — в переменной окружения PII_KEY (12-factor);
 *   * ключ передаётся в конкретную транзакцию через set_config(..., true),
 *     то есть на время транзакции и только на этом соединении;
 *   * в реестрах показывается маска (employee.phone_mask), полная расшифровка —
 *     отдельный эндпоинт под правом employee:PII с записью READ_PII в аудит.
 *
 * Если ключ не задан, сервер продолжает работать: списки и маски доступны,
 * а расшифровка отвечает 503 — «функция недоступна», без утечки данных.
 */

const crypto = require('crypto');
const config = require('./config');
const { withTransaction } = require('./db');

/** Ключ ПДн задан в окружении. */
function piiEnabled() {
    return Boolean(config.piiKey && config.piiKey.length >= 16);
}

/**
 * Отпечаток ключа (sha256, первые 12 символов) — чтобы администратор мог
 * сверить, что на стенде и в проде один и тот же ключ, не показывая ключ.
 */
function keyFingerprint() {
    if (!config.piiKey) return null;
    return crypto.createHash('sha256').update(config.piiKey).digest('hex').slice(0, 12);
}

/**
 * Включить ключ ПДн в текущей транзакции (set_config с is_local = true).
 * Вызывается внутри уже открытой транзакции — так ключ живёт только до COMMIT.
 */
async function applyPiiKey(client) {
    if (!piiEnabled()) return false;
    await client.query("SELECT set_config('app.pii_key', $1, true)", [config.piiKey]);
    return true;
}

/**
 * Выполнить fn(client) в транзакции, в которой доступен ключ ПДн.
 * Вне этой транзакции fn_pii_decrypt() бросает исключение — это и есть
 * защита «без ключа данные не читаются».
 */
async function withPiiKey(fn) {
    if (!piiEnabled()) {
        const e = new Error('Шифрование ПДн не настроено: задайте PII_KEY в окружении сервера');
        e.status = 503;
        e.kind = 'pii_key_missing';
        throw e;
    }
    return withTransaction(async (client) => {
        await applyPiiKey(client);
        return fn(client);
    });
}

/** Поля ПДн: код поля -> колонка в employee_pii. */
const PII_FIELDS = {
    phone: 'phone_enc',
    passport: 'passport_enc',
    address: 'address_enc',
    snils: 'snils_enc',
    inn: 'inn_enc',
    bank_account: 'bank_enc',
    emergency_contact: 'emergency_enc',
};

/**
 * Расшифровать запись ПДн сотрудника (внутри withPiiKey).
 * Возвращает { phone, passport, address, snils, inn, bank_account,
 * emergency_contact } — только непустые поля (имена совпадают с API).
 */
async function decryptRow(client, employeeId) {
    const cols = Object.entries(PII_FIELDS)
        .map(([field, col]) => `fn_pii_decrypt(${col}) AS "${field}"`)
        .join(', ');
    const { rows } = await client.query(
        `SELECT ${cols}, key_version, updated_at FROM employee_pii WHERE employee_id = $1`,
        [employeeId]
    );
    if (!rows.length) return null;
    const { key_version: keyVersion, updated_at: updatedAt, ...raw } = rows[0];
    const values = {};
    for (const [field, value] of Object.entries(raw)) {
        if (value !== null && value !== undefined) values[field] = value;
    }
    return { values, keyVersion, updatedAt };
}

/**
 * Зашифровать и записать ПДн сотрудника (upsert) внутри транзакции.
 * body — объект с полями из PII_FIELDS; отсутствующие поля не меняются,
 * null — стирает значение (право на удаление ПДн).
 *
 * ВАЖНО: и в INSERT, и в UPDATE значение обязано проходить через
 * fn_pii_encrypt(). Если записать «сырое» значение в bytea-колонку, PostgreSQL
 * приведёт текст к bytea по escape-формату — данные сохранятся, но прочитать
 * их будет нельзя («Wrong key or corrupt data»).
 */
async function upsertPii(client, employeeId, body, userId) {
    const enc = Object.entries(PII_FIELDS).filter(([field]) => body[field] !== undefined);
    if (!enc.length) {
        const e = new Error('Нет полей ПДн для сохранения');
        e.status = 400;
        throw e;
    }
    const cols = ['employee_id', 'updated_by'];
    const values = ['$1', '$2'];
    const params = [employeeId, userId];
    const sets = ['updated_by = EXCLUDED.updated_by', 'updated_at = now()'];
    for (const [field, col] of enc) {
        params.push(body[field]);
        cols.push(col);
        values.push(`fn_pii_encrypt($${params.length}::text)`);
        sets.push(`${col} = EXCLUDED.${col}`);
    }
    const { rows } = await client.query(
        `INSERT INTO employee_pii (${cols.join(', ')})
         VALUES (${values.join(', ')})
         ON CONFLICT (employee_id) DO UPDATE SET ${sets.join(', ')}
         RETURNING employee_id, updated_at`,
        params
    );
    return rows[0];
}

module.exports = {
    PII_FIELDS,
    piiEnabled,
    keyFingerprint,
    applyPiiKey,
    withPiiKey,
    decryptRow,
    upsertPii,
};
