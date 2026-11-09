'use strict';

const { Pool } = require('pg');
const config = require('./config');

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

/** Выполнить запрос */
function query(text, params) {
    return pool.query(text, params);
}

/**
 * Выполнить fn в транзакции (client = подключённый клиент с begun транзакцией).
 * При исключении — откат, исключение пробрасывается дальше.
 */
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* соединение уже умерло */ }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction };
