'use strict';

const { Pool } = require('pg');
const config = require('./config');
const perf = require('./perf');

// Пул соединений с PostgreSQL 16 + PostGIS
const pool = new Pool({
    ...config.db,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('PG pool error:', err.message);
});

/**
 * Выполнить запрос.
 *
 * Каждый запрос замеряется (см. src/perf.js): страница «Метрики» должна
 * показывать реальную скорость БД, а не только размеры таблиц. Замер — это
 * два обращения к монотонным часам, накладные расходы пренебрежимо малы.
 */
async function query(text, params) {
    const started = process.hrtime.bigint();
    try {
        const result = await pool.query(text, params);
        perf.record(text, Number(process.hrtime.bigint() - started) / 1e6, true);
        return result;
    } catch (err) {
        perf.record(text, Number(process.hrtime.bigint() - started) / 1e6, false);
        throw err;
    }
}

/**
 * Выполнить fn в транзакции (client = подключённый клиент с begun транзакцией).
 * При исключении — откат, исключение пробрасывается дальше.
 *
 * Длительность всей транзакции тоже попадает в метрику: она показывает
 * «стоимость» бизнес-операции целиком, а не отдельного SELECT.
 */
async function withTransaction(fn) {
    const client = await pool.connect();
    const started = process.hrtime.bigint();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        perf.record('BEGIN/COMMIT транзакция', Number(process.hrtime.bigint() - started) / 1e6, true);
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* соединение уже умерло */ }
        perf.record('BEGIN/ROLLBACK транзакция', Number(process.hrtime.bigint() - started) / 1e6, false);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction };
