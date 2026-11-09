'use strict';

/**
 * Пастбища (Неделя 5): участки/загоны (PostGIS) и назначение выпаса.
 *
 * Площадь участка (area_ha) считается автоматически триггером по контуру
 * полигона (ST_Area от geography) — не вводится вручную (ТЗ п.3.4). Назначение
 * выпаса вызывает `sp_move_group_to_plot`: проверка нормы нагрузки голов/га и
 * периода отдыха участка, закрытие предыдущего активного выпаса — всё в одной
 * транзакции с откатом при нарушении.
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const PLOT_SPECS = {
    plot_no: { type: 'string', required: true, max: 16 },
    name: { type: 'string', required: true, max: 80 },
    vegetation_type: { type: 'enum', values: ['культурное', 'естественное'] },
    max_head_per_ha: { type: 'decimal', required: true, min: 0.001 },
    rest_days_required: { type: 'int' },
    is_active: { type: 'boolean' },
    geom_wkt: { type: 'string', required: true },
};

const MOVE_SPECS = {
    group_id: { type: 'int', required: true },
    plot_id: { type: 'int', required: true },
    note: { type: 'string', max: 300, nullable: true },
};

const PLOT_COLS = `p.id, p.plot_no, p.name, p.area_ha, p.vegetation_type,
                   p.max_head_per_ha, p.rest_days_required, p.is_active, p.is_deleted`;
// Для списка/карточки добавляем геометрию: UI (Leaflet) рисует полигоны из WKT.
const PLOT_COLS_FULL = `${PLOT_COLS}, ST_AsText(p.geom) AS geom_wkt,
                        ST_Y(ST_Centroid(p.geom)) AS center_lat,
                        ST_X(ST_Centroid(p.geom)) AS center_lon`;

/** GET /api/v1/pasture-plots — участки + текущая загрузка (активные головы) */
router.get('/pasture-plots', requirePermission('pasture:READ', 'pasture'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'plot_no', 'name', 'area_ha', 'max_head_per_ha']), 'plot_no');
        const q = String(req.query.q || '').trim();
        const includeDeleted = req.query.include_deleted === 'true';

        const where = [];
        const params = [];
        where.push(`($${params.length + 1}::boolean OR NOT p.is_deleted)`);
        params.push(includeDeleted);
        if (q) {
            where.push(`(p.plot_no ILIKE '%' || $${params.length + 1}::text || '%'
                        OR p.name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        const whereSql = `WHERE ${where.join(' AND ')}`;

        const { rows } = await query(
            `SELECT ${PLOT_COLS_FULL},
                    (SELECT COALESCE(SUM(head_count_snapshot), 0) FROM grazing_event ge
                      WHERE ge.plot_id = p.id AND ge.ended_at IS NULL) AS active_head_count,
                    COUNT(*) OVER() AS total
             FROM pasture_plot p
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, p.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /api/v1/pasture-plots/:id — карточка участка (+ WKT контура) */
router.get('/pasture-plots/:id', requirePermission('pasture:READ', 'pasture'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `SELECT ${PLOT_COLS_FULL},
                    (SELECT COALESCE(SUM(head_count_snapshot), 0) FROM grazing_event ge
                      WHERE ge.plot_id = p.id AND ge.ended_at IS NULL) AS active_head_count
             FROM pasture_plot p WHERE p.id = $1`, [id]);
        if (!rows.length) throw httpError(404, 'Участок не найден');
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** POST /api/v1/pasture-plots — создать участок (площадь считается триггером) */
router.post('/pasture-plots', requirePermission('pasture:WRITE', 'pasture'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, PLOT_SPECS);
        if (!/^(MULTI)?POLYGON/i.test(v.geom_wkt.trim())) {
            throw httpError(400, 'geom_wkt: ожидается WKT-полигон (POLYGON/MULTIPOLYGON)');
        }
        const { rows } = await query(
            `INSERT INTO pasture_plot (plot_no, name, geom, vegetation_type, max_head_per_ha, rest_days_required, is_active)
             VALUES ($1, $2, ST_GeomFromText($3, 4326), $4, $5, $6, $7)
             RETURNING id, plot_no, name, area_ha, vegetation_type, max_head_per_ha, rest_days_required, is_active, is_deleted`,
            [v.plot_no, v.name, v.geom_wkt.trim(), v.vegetation_type || 'естественное',
             v.max_head_per_ha, v.rest_days_required ?? 20, v.is_active ?? true]
        );
        await writeAudit(req, { entityName: 'pasture_plot', entityId: rows[0].id, action: 'CREATE', after: rows[0] });
        res.status(201).json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** DELETE /api/v1/pasture-plots/:id — мягкое удаление */
router.delete('/pasture-plots/:id', requirePermission('pasture:WRITE', 'pasture'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            'UPDATE pasture_plot SET is_deleted = TRUE WHERE id = $1 AND NOT is_deleted RETURNING id', [id]);
        if (!rows.length) throw httpError(404, 'Участок не найден');
        await writeAudit(req, { entityName: 'pasture_plot', entityId: id, action: 'DELETE', before: rows[0] });
        res.json({ data: { id, is_deleted: true } });
    } catch (err) { next(err); }
});

/**
 * POST /api/v1/grazing/move — перевод группы на участок (sp_move_group_to_plot).
 * Отдых участка + норма нагрузки проверяются на сервере; при нарушении —
 * транзакция откатывается (закрытие предыдущего выпаса тоже отменяется).
 */
router.post('/grazing/move', requirePermission('pasture:WRITE', 'pasture'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, MOVE_SPECS);
        const row = await withTransaction(async (client) => {
            const r = await client.query(
                `SELECT sp_move_group_to_plot($1, $2, $3, $4) AS event_id`,
                [v.group_id, v.plot_id, req.user.id, v.note ?? null]
            );
            return r.rows[0];
        });
        await writeAudit(req, {
            entityName: 'grazing_event', entityId: row.event_id, action: 'CREATE',
            after: { group_id: v.group_id, plot_id: v.plot_id },
        });
        res.status(201).json({ data: { event_id: row.event_id, group_id: v.group_id, plot_id: v.plot_id } });
    } catch (err) { next(err); }
});

module.exports = router;
