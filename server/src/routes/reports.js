'use strict';

/**
 * Подсистема статистики и отчётности (Неделя 8) — /api/v1/reports.
 *
 * Управленческие: cost-fcr, herd-health, pasture-load.
 * Операционные: tasks-in-work, stock-turnover.
 * Каждый отчёт: ?format=json (по умолчанию) | csv; ?from= / ?to= — период.
 * series — готовые данные для визуализаций (диаграммы/графики), экспорт CSV.
 * Доступ: report:READ; экспорт дополнительно требует export:EXEC.
 */

const express = require('express');
const http = require('http');
const { query } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError } = require('../validation');

const router = express.Router();

function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}
function toCsv(rows) {
    if (!rows.length) return '';
    const head = Object.keys(rows[0]);
    return [head.join(';'), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(';'))].join('\r\n');
}
async function respond(req, res, next, name, rows, series) {
    try {
        const fmt = String(req.query.format || 'json').toLowerCase();
        if (fmt === 'csv') {
            if (!req.user.permissions.has('export:EXEC')) {
                return res.status(403).json({ error: 'Экспорт требует право export:EXEC', kind: 'forbidden' });
            }
            await writeAudit(req, { entityName: 'report', entityId: 0, action: 'EXPORT',
                                    after: { report: name, format: 'csv', rows: rows.length } });
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
            return res.send('\uFEFF' + toCsv(rows));
        }
        if (fmt !== 'json') throw httpError(400, 'format: допустимо json или csv');
        res.json({ report: name, params: { from: req.query.from || null, to: req.query.to || null,
                                          group_id: req.query.group_id || null },
                   total: rows.length, data: rows, ...(series ? { series } : {}) });
    } catch (err) { next(err); }
}

/** Период по умолчанию — последние 12 месяцев. */
function period(req) {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    return { from: from || null, to: to || null };
}
const P = (req) => [period(req).from, period(req).to];

// ---------------------------------------------------------------------------
// 1. Себестоимость и конверсия корма (FCR)
// ---------------------------------------------------------------------------
router.get('/cost-fcr', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT pgc.group_id, g.name AS group_name,
                    pc.period_month,
                    pgc.feed_qty, pgc.feed_cost, pgc.treatment_cost,
                    pgc.head_days, pgc.gain_kg, pgc.fcr
             FROM period_group_cost pgc
             JOIN period_closure pc ON pc.id = pgc.period_closure_id
             JOIN animal_group g ON g.id = pgc.group_id
             WHERE ($1::date IS NULL OR pc.period_month >= $1::date)
               AND ($2::date IS NULL OR pc.period_month <= $2::date)
               AND ($3::int = 0 OR pgc.group_id = $3::int)
             ORDER BY pc.period_month DESC, g.name`,
            [...P(req), Number(req.query.group_id) || 0]);
        const byMonth = {};
        for (const r of rows) {
            const k = String(r.period_month).slice(0, 7);
            byMonth[k] = byMonth[k] || { period: k, feed_cost: 0, feed_qty: 0, gain_kg: 0 };
            byMonth[k].feed_cost += Number(r.feed_cost);
            byMonth[k].feed_qty += Number(r.feed_qty);
            byMonth[k].gain_kg += Number(r.gain_kg);
        }
        const series = Object.values(byMonth).sort((a, b) => a.period.localeCompare(b.period));
        await respond(req, res, next, 'cost-fcr', rows, { by_month: series });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 2. Здоровье поголовья
// ---------------------------------------------------------------------------
router.get('/herd-health', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT a.id, a.inventory_number, a.status, a.group_id, g.name AS group_name,
                    b.name AS breed, a.birth_date, a.arrival_date
             FROM animal a
             JOIN breed b ON b.id = a.breed_id
             LEFT JOIN animal_group g ON g.id = a.group_id
             WHERE NOT a.is_deleted
             ORDER BY a.status, a.inventory_number`);
        const byStatus = {};
        for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        const { rows: vac } = await query(
            `SELECT count(*)::int AS total_overdue,
                    count(DISTINCT animal_id)::int AS animals_overdue
             FROM v_vaccination_overdue`);
        const { rows: disp } = await query(
            `SELECT dr.reason_type, count(*)::int AS cnt
             FROM disposal_event de JOIN disposal_reason dr ON dr.id = de.reason_id
             GROUP BY dr.reason_type`);
        const total = rows.length || 1;
        const sick = (byStatus['НА_ЛЕЧЕНИИ'] || 0) + (byStatus['НА_ОСМОТРЕ'] || 0)
                   + (byStatus['НА_КАРАНТИНЕ'] || 0);
        const summary = {
            total_animals: rows.length,
            sick_or_quarantine: sick,
            sick_share_pct: +(sick * 100 / total).toFixed(2),
            healthy: byStatus['ЗДОРОВ'] || 0,
            culled: byStatus['ВЫБРАКОВАНО'] || 0,
            dead: byStatus['ПАДЁЖ'] || 0,
            vaccination_overdue: vac[0].total_overdue,
            animals_vaccination_overdue: vac[0].animals_overdue,
        };
        const series = { by_status: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
                         by_disposal: disp };
        const out = [{ metric: 'summary', ...summary }].concat(
            Object.entries(byStatus).map(([status, count]) => ({ metric: 'status', status, count })));
        await respond(req, res, next, 'herd-health', out, { ...series, summary });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 3. Нагрузка на пастбища
// ---------------------------------------------------------------------------
router.get('/pasture-load', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT p.id AS plot_id, p.plot_no, p.name, p.area_ha, p.max_head_per_ha,
                    p.rest_days_required, p.vegetation_type,
                    COALESCE(SUM(CASE WHEN ge.ended_at IS NULL THEN ge.head_count_snapshot END), 0)::int AS active_heads,
                    bool_or(ge.ended_at IS NULL) AS in_use,
                    MAX(ge.ended_at) AS last_grazing_end,
                    COALESCE(SUM(ge.head_count_snapshot), 0)::int AS total_heads_all_time,
                    COUNT(ge.id)::int AS grazing_events
             FROM pasture_plot p
             LEFT JOIN grazing_event ge ON ge.plot_id = p.id
             WHERE NOT p.is_deleted
             GROUP BY p.id, p.plot_no, p.name, p.area_ha, p.max_head_per_ha,
                      p.rest_days_required, p.vegetation_type
             ORDER BY p.plot_no`);
        const { rows: rest } = await query('SELECT plot_id, ended_at, is_rested FROM v_plot_rest_status');
        const restMap = Object.fromEntries(rest.map((r) => [r.plot_id, r]));
        const data = rows.map((r) => {
            const load = r.area_ha > 0 ? r.active_heads / Number(r.area_ha) : 0;
            const norm = Number(r.max_head_per_ha);
            const st = restMap[r.plot_id];
            return { ...r, load_head_per_ha: +load.toFixed(3),
                     norm_head_per_ha: norm,
                     over_limit: load > norm,
                     rest_ok: st ? st.is_rested : true,
                     risk: load > norm ? 'OVERGRAZING'
                         : (st && st.is_rested === false ? 'REST_NOT_COMPLETE' : 'OK') };
        });
        await respond(req, res, next, 'pasture-load', data,
            { bars: data.map((r) => ({ plot: r.plot_no, active_heads: r.active_heads,
                                       load_head_per_ha: r.load_head_per_ha,
                                       norm_head_per_ha: r.norm_head_per_ha })) });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 4. Задачи в работе (операционный)
// ---------------------------------------------------------------------------
router.get('/tasks-in-work', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT t.id, t.title, t.status, t.priority, t.planned_date, t.due_at,
                    tt.name AS task_type, e.full_name AS assignee,
                    (t.due_at < now() AND t.status IN ('NEW','IN_WORK')) AS is_overdue,
                    (SELECT count(*)::int FROM task_animal_group tag WHERE tag.task_id = t.id) AS groups_count,
                    (SELECT count(*)::int FROM task_execution te WHERE te.task_id = t.id) AS executions_count
             FROM task t
             JOIN task_type tt ON tt.id = t.task_type_id
             JOIN employee e ON e.id = t.assigned_to
             WHERE t.status IN ('NEW','IN_WORK')
               AND ($1::date IS NULL OR t.planned_date >= $1::date)
               AND ($2::date IS NULL OR t.planned_date <= $2::date)
             ORDER BY t.due_at, t.id
             LIMIT 500`, P(req));
        const byStatus = {}, byAssignee = {};
        for (const r of rows) {
            byStatus[r.status] = (byStatus[r.status] || 0) + 1;
            byAssignee[r.assignee] = (byAssignee[r.assignee] || 0) + 1;
        }
        const series = {
            by_status: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
            by_assignee: Object.entries(byAssignee).map(([assignee, count]) => ({ assignee, count })),
        };
        await respond(req, res, next, 'tasks-in-work', rows, series);
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 5. Остатки склада и обороты (операционный)
// ---------------------------------------------------------------------------
router.get('/stock-turnover', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT n.id AS nomenclature_id, n.sku, n.name, n.category,
                    n.min_threshold, u.code AS uom,
                    COALESCE(SUM(sb.qty_on_hand), 0) AS on_hand,
                    COALESCE(SUM(CASE WHEN mt.direction = 'IN' THEN sm.qty ELSE 0 END), 0) AS received,
                    COALESCE(SUM(CASE WHEN mt.direction = 'OUT' THEN sm.qty ELSE 0 END), 0) AS issued,
                    COUNT(DISTINCT sb.batch_id)::int AS batches,
                    MIN(sb.expiry_date) AS nearest_expiry
             FROM nomenclature n
             JOIN uom u ON u.id = n.uom_id
             LEFT JOIN stock_batch sb ON sb.nomenclature_id = n.id
             LEFT JOIN stock_balance bl ON bl.batch_id = sb.id
             LEFT JOIN stock_movement sm ON sm.batch_id = sb.id
             LEFT JOIN movement_type mt ON mt.id = sm.movement_type_id
             WHERE NOT n.is_deleted
               AND ($1::date IS NULL OR sm.moved_at IS NULL OR sm.moved_at >= $1::date)
               AND ($2::date IS NULL OR sm.moved_at IS NULL OR sm.moved_at < ($2::date + interval '1 day'))
             GROUP BY n.id, n.sku, n.name, n.category, n.min_threshold, u.code
             ORDER BY n.sku`);
        const data = rows.map((r) => {
            const onHand = Number(r.on_hand);
            const min = Number(r.min_threshold);
            return { ...r, below_threshold: min > 0 && onHand < min,
                     turnover: onHand > 0 ? +(Number(r.issued) / onHand).toFixed(3) : 0,
                     risk: min > 0 && onHand < min ? 'DEFICIT'
                         : (Number(r.issued) === 0 && onHand > 0 ? 'NON_LIQUID' : 'OK') };
        });
        await respond(req, res, next, 'stock-turnover', data,
            { bars: data.map((r) => ({ sku: r.sku, on_hand: Number(r.on_hand),
                                       min_threshold: Number(r.min_threshold),
                                       issued: Number(r.issued) })) });
    } catch (err) { next(err); }
});

const REPORTS_SERVICE = {
    host: process.env.REPORTS_HOST || '127.0.0.1',
    port: parseInt(process.env.REPORTS_PORT || '4000', 10),
};

/** Вызов микросервиса отчётности (Неделя 7): ядро → reports-service. */
function callAggregate(token, from, to) {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return new Promise((resolve, reject) => {
        const r = http.get({
            host: REPORTS_SERVICE.host, port: REPORTS_SERVICE.port,
            path: `/aggregate?${qs.toString()}`,
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15000,
        }, (resp) => {
            let raw = '';
            resp.on('data', (c) => { raw += c; });
            resp.on('end', () => {
                try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
                catch (e) { reject(new Error(`reports-service: некорректный ответ (${resp.statusCode})`)); }
            });
        });
        r.on('timeout', () => r.destroy(new Error('reports-service: таймаут')));
        r.on('error', reject);
    });
}

/** GET /reports/aggregate — тяжёлая агрегация в отдельном микросервисе. */
router.get('/aggregate', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        let out;
        try {
            out = await callAggregate(req.user.token, req.query.from, req.query.to);
        } catch (e) {
            throw httpError(503, `Микросервис отчётности недоступен: ${e.message}`);
        }
        if (out.status !== 200) throw httpError(out.status, out.body.error || 'Ошибка reports-service');
        res.json(out.body);
    } catch (err) { next(err); }
});

/** GET /reports/dashboard — сводный дашборд (все 5 отчётов одной кнопкой) */
router.get('/dashboard', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT
               (SELECT count(*)::int FROM animal WHERE NOT is_deleted
                  AND status NOT IN ('ВЫБРАКОВАНО','ПАДЁЖ')) AS animals,
               (SELECT count(*)::int FROM animal WHERE status IN ('НА_ЛЕЧЕНИИ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ')
                  AND NOT is_deleted) AS sick,
               (SELECT count(*)::int FROM task WHERE status IN ('NEW','IN_WORK')) AS tasks_open,
               (SELECT count(*)::int FROM v_task_overdue) AS tasks_overdue,
               (SELECT count(*)::int FROM v_vaccination_overdue) AS vaccination_overdue,
               (SELECT COALESCE(sum(qty_on_hand), 0) FROM stock_balance) AS stock_on_hand,
               (SELECT count(*)::int FROM v_stock_balance_check WHERE abs(balance_qty - calc_qty) > 0.0001) AS stock_mismatches,
               (SELECT count(*)::int FROM v_active_grazing) AS active_grazings,
               (SELECT count(*)::int FROM v_plot_rest_status WHERE NOT is_rested) AS plots_not_rested,
               (SELECT count(*)::int FROM purchase_request WHERE status = 'NEW') AS purchase_requests_new,
               (SELECT count(*)::int FROM notification WHERE NOT is_read) AS unread_notifications,
               (SELECT count(*)::int FROM audit_log WHERE is_elevated) AS elevated_actions,
               (SELECT count(*)::int FROM audit_log WHERE action = 'DENY') AS denies,
               (SELECT count(*)::int FROM backup_job WHERE status = 'OK') AS backups_ok`);
        const { rows: trend } = await query(
            `SELECT to_char(sm.moved_at, 'YYYY-MM') AS month,
                    sum(CASE WHEN mt.direction = 'OUT' THEN sm.qty ELSE 0 END) AS issued,
                    sum(CASE WHEN mt.direction = 'IN' THEN sm.qty ELSE 0 END) AS received
             FROM stock_movement sm JOIN movement_type mt ON mt.id = sm.movement_type_id
             WHERE sm.moved_at >= now() - interval '12 months'
             GROUP BY 1 ORDER BY 1`);
        await respond(req, res, next, 'dashboard', rows, { stock_trend: trend });
    } catch (err) { next(err); }
});

module.exports = router;
