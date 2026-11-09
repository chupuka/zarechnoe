'use strict';

/**
 * Склад (Неделя 5): партии, остатки, движения, заявки на закупку.
 *
 * Движения склада — атомарные: выполняются в транзакции, списание сверх остатка
 * отклоняется на сервере ДО вставки (FOR UPDATE), а также страхуется триггером
 * `trg_stock_movement_apply` + CHECK (qty_on_hand >= 0) на уровне СУБД — при
 * любом нарушении транзакция откатывается целиком (нет «полусписанного» корма).
 * Списание (WRITE_OFF) требует право stock:DELETE и причину write_off_reason_id.
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const MOVE_SPECS = {
    movement_type: { type: 'string', required: true, max: 24 },
    batch_id: { type: 'int', required: true },
    qty: { type: 'decimal', required: true, min: 0.000001, message: 'qty: должна быть положительной' },
    write_off_reason_id: { type: 'int', nullable: true },
    comment: { type: 'string', max: 300, nullable: true },
};

/** GET /api/v1/stock/batches — партии с остатками и номенклатурой */
router.get('/batches', requirePermission('stock:READ', 'stock'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'batch_number', 'received_at', 'expiry_date', 'qty_on_hand']), 'received_at');
        const q = String(req.query.q || '').trim();
        const nomenclatureId = asInt(req.query.nomenclature_id) || 0;
        const warehouseId = asInt(req.query.warehouse_id) || 0;

        const where = [];
        const params = [];
        if (q) {
            where.push(`(b.batch_number ILIKE '%' || $${params.length + 1}::text || '%'
                        OR n.sku ILIKE '%' || $${params.length + 1}::text || '%'
                        OR n.name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (nomenclatureId) { where.push(`b.nomenclature_id = $${params.length + 1}::int`); params.push(nomenclatureId); }
        if (warehouseId) { where.push(`b.warehouse_id = $${params.length + 1}::int`); params.push(warehouseId); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await query(
            `SELECT b.id, b.nomenclature_id, b.warehouse_id, b.supplier_id, b.batch_number,
                    b.received_at, b.expiry_date, b.unit_cost, b.initial_qty,
                    n.sku, n.name AS nomenclature, n.category,
                    w.name AS warehouse, s.name AS supplier,
                    COALESCE(sb.qty_on_hand, 0) AS qty_on_hand,
                    COUNT(*) OVER() AS total
             FROM stock_batch b
             JOIN nomenclature n ON n.id = b.nomenclature_id
             JOIN warehouse w ON w.id = b.warehouse_id
             LEFT JOIN supplier s ON s.id = b.supplier_id
             LEFT JOIN stock_balance sb ON sb.batch_id = b.id
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, b.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /api/v1/stock/balances — остатки по партиям */
router.get('/balances', requirePermission('stock:READ', 'stock'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'qty_on_hand', 'updated_at', 'batch_number']), 'updated_at');
        const q = String(req.query.q || '').trim();
        const warehouseId = asInt(req.query.warehouse_id) || 0;

        const where = [];
        const params = [];
        if (q) {
            where.push(`(b.batch_number ILIKE '%' || $${params.length + 1}::text || '%'
                        OR n.sku ILIKE '%' || $${params.length + 1}::text || '%'
                        OR n.name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (warehouseId) { where.push(`b.warehouse_id = $${params.length + 1}::int`); params.push(warehouseId); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await query(
            `SELECT sb.id, sb.batch_id, sb.qty_on_hand, sb.updated_at,
                    b.batch_number, b.nomenclature_id, n.sku, n.name AS nomenclature,
                    n.category, w.name AS warehouse,
                    COUNT(*) OVER() AS total
             FROM stock_balance sb
             JOIN stock_batch b ON b.id = sb.batch_id
             JOIN nomenclature n ON n.id = b.nomenclature_id
             JOIN warehouse w ON w.id = b.warehouse_id
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, sb.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

/** POST /api/v1/stock/movements — приход/расход/списание/возврат (атомарно) */
router.post('/movements', requirePermission('stock:WRITE', 'stock'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, MOVE_SPECS);

        const mt = await query('SELECT id, code, direction FROM movement_type WHERE code = $1', [v.movement_type]);
        if (!mt.rows.length) throw httpError(400, `Тип движения «${v.movement_type}» не найден`);
        const { id: mtId, code: mtCode, direction } = mt.rows[0];

        // Списание — привилегия кладовщика (stock:DELETE) + обязательная причина
        if (mtCode === 'WRITE_OFF' && !req.user.permissions.has('stock:DELETE')) {
            await writeAudit(req, {
                entityName: 'stock', entityId: v.batch_id, action: 'DENY',
                after: { required_permission: 'stock:DELETE', path: `${req.method} ${req.originalUrl}` },
            });
            return res.status(403).json({ error: 'Недостаточно прав: списание требует stock:DELETE', kind: 'forbidden' });
        }
        if (mtCode === 'WRITE_OFF' && !v.write_off_reason_id) {
            throw httpError(400, 'Списание требует указания причины (write_off_reason_id, ТЗ п.3.3)');
        }
        if (v.write_off_reason_id) {
            const wr = await query('SELECT id FROM write_off_reason WHERE id = $1', [v.write_off_reason_id]);
            if (!wr.rows.length) throw httpError(400, `Причина списания ${v.write_off_reason_id} не найдена`);
        }

        const row = await withTransaction(async (client) => {
            const b = await client.query(
                `SELECT b.id, n.uom_id, n.sku
                 FROM stock_batch b JOIN nomenclature n ON n.id = b.nomenclature_id
                 WHERE b.id = $1 AND NOT n.is_deleted
                 FOR UPDATE OF b`, [v.batch_id]);
            if (!b.rows.length) throw httpError(400, `Партия ${v.batch_id} не найдена`);
            const { uom_id, sku } = b.rows[0];

            if (direction === 'OUT') {
                const bal = await client.query(
                    'SELECT qty_on_hand FROM stock_balance WHERE batch_id = $1 FOR UPDATE', [v.batch_id]);
                const onHand = bal.rows.length ? Number(bal.rows[0].qty_on_hand) : 0;
                if (onHand < v.qty) {
                    throw httpError(400, `Недостаточно остатка партии (${sku}): есть ${onHand}, требуется ${v.qty}`);
                }
            }

            const ins = await client.query(
                `INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at, created_by, write_off_reason_id, comment)
                 VALUES ($1, $2, $3, $4, now(), $5, $6, $7) RETURNING *`,
                [mtId, v.batch_id, v.qty, uom_id, req.user.id, v.write_off_reason_id ?? null, v.comment ?? null]
            );
            return ins.rows[0];
        });

        await writeAudit(req, { entityName: 'stock_movement', entityId: row.id, action: 'CREATE', after: row });
        res.status(201).json({ data: row });
    } catch (err) { next(err); }
});

/** GET /api/v1/stock/purchase-requests — заявки на закупку */
router.get('/purchase-requests', requirePermission('purchase:READ', 'purchase'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'requested_at', 'status', 'requested_qty']), 'requested_at');
        const q = String(req.query.q || '').trim();
        const status = String(req.query.status || '');
        const nomenclatureId = asInt(req.query.nomenclature_id) || 0;

        const where = [];
        const params = [];
        if (q) {
            where.push(`(n.sku ILIKE '%' || $${params.length + 1}::text || '%' OR n.name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (status) { where.push(`pr.status = $${params.length + 1}::text`); params.push(status); }
        if (nomenclatureId) { where.push(`pr.nomenclature_id = $${params.length + 1}::int`); params.push(nomenclatureId); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await query(
            `SELECT pr.id, pr.nomenclature_id, pr.requested_qty, pr.status, pr.is_auto,
                    pr.requested_by, pr.requested_at, pr.closed_at, n.sku, n.name AS nomenclature,
                    COUNT(*) OVER() AS total
             FROM purchase_request pr
             JOIN nomenclature n ON n.id = pr.nomenclature_id
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, pr.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

module.exports = router;
