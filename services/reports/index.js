'use strict';

/**
 * Микросервис отчётности (Неделя 7) — отдельный процесс, порт 4000.
 *
 * Архитектура «ядро + дополнительный сервис»:
 *   ядро  = основной REST API (:3000) — бизнес-логика, запись, RBAC;
 *   сервис = reports-service (:4000) — только ЧТЕНИЕ аналитических данных
 *            и тяжёлые агрегации (не нагружает ядро), свой пул соединений.
 *
 * Взаимодействие: ядро проксирует /api/v1/reports/aggregate → :4000 (см.
 * routes/reports.js → GET /reports/aggregate), либо UI обращается напрямую.
 * Авторизация: Bearer-токен проверяется через тот же `user_session` (общая БД).
 */

const http = require('http');
const { Pool } = require('pg');
const crypto = require('crypto');

const PORT = parseInt(process.env.REPORTS_PORT || '4000', 10);
const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5433', 10),
    user: process.env.PGUSER || 'farm',
    password: process.env.PGPASSWORD || 'farm',
    database: process.env.PGDATABASE || 'farm',
    max: 4,
});

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function json(res, code, body) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                          'Access-Control-Allow-Origin': '*',
                          'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
    res.end(JSON.stringify(body));
}

/** Проверка Bearer-токена и права report:READ (общая БД с ядром). */
async function authenticate(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    if (!token) return null;
    const { rows } = await pool.query(
        `SELECT u.id, u.login, s.expires_at, s.revoked_at
         FROM user_session s JOIN app_user u ON u.id = s.user_id
         WHERE s.token_hash = $1`, [sha256(token)]);
    if (!rows.length) return null;
    const s = rows[0];
    if (s.revoked_at || new Date(s.expires_at) < new Date()) return null;
    const p = await pool.query(
        `SELECT 1 FROM role_permission rp
         JOIN permission pm ON pm.id = rp.permission_id
         JOIN app_user u ON u.id = $1 AND u.role_id = rp.role_id
         WHERE pm.code = 'report:READ'`, [s.id]);
    if (!p.rows.length) return null;
    return { id: s.id, login: s.login };
}

/** Тяжёлая агрегация: помесячная динамика по всем реестрам за период. */
async function aggregate(from, to) {
    const { rows } = await pool.query(
        `WITH months AS (
            SELECT generate_series(
                COALESCE($1::date, date_trunc('month', now()) - interval '11 months')::date,
                COALESCE($2::date, date_trunc('month', now()))::date,
                interval '1 month')::date AS m
         ),
         feed AS (
            SELECT date_trunc('month', sm.moved_at)::date AS m,
                   SUM(sm.qty) FILTER (WHERE mt.direction = 'OUT')::numeric(14,3) AS issued,
                   SUM(sm.qty) FILTER (WHERE mt.direction = 'IN')::numeric(14,3) AS received,
                   SUM(sm.qty * sb.unit_cost) FILTER (WHERE mt.direction = 'OUT')::numeric(14,2) AS cost
            FROM stock_movement sm
            JOIN movement_type mt ON mt.id = sm.movement_type_id
            JOIN stock_batch sb ON sb.id = sm.batch_id
            GROUP BY 1
         ),
         tasks AS (
            SELECT date_trunc('month', t.planned_date)::date AS m,
                   count(*)::int AS total,
                   count(*) FILTER (WHERE t.status = 'DONE')::int AS done,
                   count(*) FILTER (WHERE t.due_at < now() AND t.status IN ('NEW','IN_WORK'))::int AS overdue
            FROM task t GROUP BY 1
         ),
         prod AS (
            SELECT date_trunc('month', pr.produced_at)::date AS m,
                   SUM(pr.qty)::numeric(14,3) AS qty
            FROM production_record pr GROUP BY 1
         )
         SELECT m.m::text AS month,
                COALESCE(f.issued, 0) AS feed_issued,
                COALESCE(f.received, 0) AS feed_received,
                COALESCE(f.cost, 0) AS feed_cost,
                COALESCE(t.total, 0) AS tasks_total,
                COALESCE(t.done, 0) AS tasks_done,
                COALESCE(t.overdue, 0) AS tasks_overdue,
                COALESCE(p.qty, 0) AS production_qty
         FROM months m
         LEFT JOIN feed f ON f.m = m.m
         LEFT JOIN tasks t ON t.m = m.m
         LEFT JOIN prod p ON p.m = m.m
         ORDER BY m.m`, [from || null, to || null]);
    return rows;
}

const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    try {
        if (u.pathname === '/health') {
            await pool.query('SELECT 1');
            return json(res, 200, { status: 'ok', service: 'reports', db: 'up',
                                   ts: new Date().toISOString() });
        }
        if (req.method === 'OPTIONS') return json(res, 204, {});
        const user = await authenticate(req);
        if (!user) return json(res, 401, { error: 'Не авторизован или нет права report:READ' });
        if (u.pathname === '/aggregate' && req.method === 'GET') {
            const rows = await aggregate(u.searchParams.get('from'), u.searchParams.get('to'));
            return json(res, 200, { service: 'reports', report: 'aggregate',
                                    generated_at: new Date().toISOString(),
                                    user: user.login, total: rows.length, data: rows });
        }
        return json(res, 404, { error: 'Маршрут не найден' });
    } catch (err) {
        console.error('reports-service error:', err.message);
        return json(res, 500, { error: err.message });
    }
});

server.listen(PORT, () => console.log(`Reports microservice: http://localhost:${PORT}/aggregate`));
