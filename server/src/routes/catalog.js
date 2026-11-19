'use strict';

/**
 * Справочники (Неделя 5) — универсальная CRUD-фабрика + конфигурации.
 *
 * Каждый справочник описывается декларативной конфигурацией и получает единый
 * набор маршрутов: список (пагинация/поиск/сортировка), карточка, создание,
 * изменение, удаление (жёсткое или мягкое). Валидация — через src/validation.js,
 * write-операции идут в транзакции, изменения пишутся в audit_log.
 *
 * Маппинг прав (Неделя 6): справочники используют выделенные `catalog:READ/WRITE`,
 * персонал — `employee:READ/WRITE`. Технические роли изолированы: DBA имеет только
 * чтение справочников/персонала, но не запись в бизнес-реестры.
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

/** Проверить существование FK-ссылок (для полей, переданных в теле). */
async function checkFks(fks, v) {
    if (!fks) return;
    for (const fk of fks) {
        if (v[fk.field] === undefined || v[fk.field] === null) continue;
        const { rows } = await query(`SELECT 1 FROM ${fk.table} WHERE id = $1`, [v[fk.field]]);
        if (!rows.length) throw httpError(400, `${fk.label || fk.table} ${v[fk.field]} не найден`);
    }
}

/**
 * cfg = {
 *   table, label, read, write, delete?, softDelete?, fields, fks?,
 *   search? (столбцы ILIKE), sortable?, defaultSort?
 * }
 */
function makeCatalog(cfg) {
    const router = express.Router();
    const table = cfg.table;
    const pk = cfg.pk || 'id';
    const label = cfg.label || table;
    const soft = cfg.softDelete || null;
    const searchCols = cfg.search || ['code', 'name'];
    const sortable = cfg.sortable || new Set([pk, 'code', 'name']);
    const defaultSort = cfg.defaultSort || 'code';

    // ---- Список -------------------------------------------------------------
    router.get('/', requirePermission(cfg.read, label), async (req, res, next) => {
        try {
            const { limit, offset } = parsePaging(req.query);
            const { sort, desc } = parseSort(req.query, sortable, defaultSort);
            const q = String(req.query.q || '').trim();
            const includeDeleted = req.query.include_deleted === 'true';

            const where = [];
            const params = [];
            if (soft) {
                where.push(`($${params.length + 1}::boolean OR NOT ${soft})`);
                params.push(includeDeleted);
            }
            if (q) {
                const terms = searchCols.map(() => `$${params.length + 1}::text`);
                where.push(`(${searchCols.map((c, i) => `${c}::text ILIKE '%' || ${terms[i]} || '%'`).join(' OR ')})`);
                params.push(q);
            }
            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const { rows } = await query(
                `SELECT *, COUNT(*) OVER() AS total FROM ${table}
                 ${whereSql}
                 ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, ${pk} ASC
                 LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
                [...params, limit, offset]
            );
            const total = rows.length ? Number(rows[0].total) : 0;
            res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
        } catch (err) { next(err); }
    });

    // ---- Карточка -----------------------------------------------------------
    router.get('/:id', requirePermission(cfg.read, label), async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const { rows } = await query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [id]);
            if (!rows.length) throw httpError(404, `${label} не найден`);
            res.json({ data: rows[0] });
        } catch (err) { next(err); }
    });

    // ---- Создание -----------------------------------------------------------
    router.post('/', requirePermission(cfg.write, label), async (req, res, next) => {
        try {
            const v = validate(req.body || {}, cfg.fields);
            await checkFks(cfg.fks, v);
            const cols = Object.keys(v);
            if (!cols.length) throw httpError(400, 'Нет полей для создания');
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            const { rows } = await query(
                `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
                cols.map((c) => v[c])
            );
            await writeAudit(req, { entityName: table, entityId: rows[0][pk], action: 'CREATE', after: rows[0] });
            res.status(201).json({ data: rows[0] });
        } catch (err) { next(err); }
    });

    // ---- Изменение (транзакция + FOR UPDATE) --------------------------------
    router.patch('/:id', requirePermission(cfg.write, label), async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const v = validate(req.body || {}, cfg.fields, { partial: true });
            const keys = Object.keys(v);
            if (!keys.length) throw httpError(400, 'Нет полей для изменения');
            await checkFks(cfg.fks, v);

            const row = await withTransaction(async (client) => {
                const cur = await client.query(
                    `SELECT * FROM ${table} WHERE ${pk} = $1${soft ? ` AND NOT ${soft}` : ''} FOR UPDATE`, [id]);
                if (!cur.rows.length) throw httpError(404, `${label} не найден`);
                const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
                const upd = await client.query(
                    `UPDATE ${table} SET ${sets} WHERE ${pk} = $1 RETURNING *`,
                    [id, ...keys.map((k) => v[k])]
                );
                return { before: cur.rows[0], after: upd.rows[0] };
            });

            const before = keys.reduce((o, k) => { o[k] = row.before[k]; return o; }, {});
            const after = keys.reduce((o, k) => { o[k] = row.after[k]; return o; }, {});
            await writeAudit(req, { entityName: table, entityId: id, action: 'UPDATE', before, after });
            res.json({ data: row.after });
        } catch (err) { next(err); }
    });

    // ---- Удаление (мягкое или жёсткое) --------------------------------------
    router.delete('/:id', requirePermission(cfg.delete || cfg.write, label), async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            if (soft) {
                const { rows } = await query(
                    `UPDATE ${table} SET ${soft} = TRUE WHERE ${pk} = $1 AND NOT ${soft} RETURNING ${pk}`, [id]);
                if (!rows.length) throw httpError(404, `${label} не найден`);
                await writeAudit(req, { entityName: table, entityId: id, action: 'DELETE', before: rows[0] });
                res.json({ data: { id, [soft]: true } });
            } else {
                const { rows } = await query(
                    `DELETE FROM ${table} WHERE ${pk} = $1 RETURNING ${pk}`, [id]);
                if (!rows.length) throw httpError(404, `${label} не найден`);
                await writeAudit(req, { entityName: table, entityId: id, action: 'DELETE', before: rows[0] });
                res.json({ data: { id, deleted: true } });
            }
        } catch (err) { next(err); }
    });

    return router;
}

/** Препараты — подтип nomenclature (shared PK): только чтение с JOIN. */
function drugRouter() {
    const router = express.Router();
    const SELECT = `SELECT d.nomenclature_id AS id, d.withdrawal_days, d.withdrawal_milk_days,
                           d.is_vaccine, d.storage_note, n.sku, n.name, n.category, n.uom_id`;

    router.get('/', requirePermission('health:READ', 'препарат'), async (req, res, next) => {
        try {
            const { limit, offset } = parsePaging(req.query);
            const q = String(req.query.q || '').trim();
            const where = [];
            const params = [];
            if (q) {
                where.push(`(n.name ILIKE '%' || $1::text || '%' OR n.sku ILIKE '%' || $1::text || '%')`);
                params.push(q);
            }
            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const { rows } = await query(
                `${SELECT}, COUNT(*) OVER() AS total
                 FROM drug d JOIN nomenclature n ON n.id = d.nomenclature_id
                 ${whereSql}
                 ORDER BY n.name ASC, d.nomenclature_id ASC
                 LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
                [...params, limit, offset]
            );
            const total = rows.length ? Number(rows[0].total) : 0;
            res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
        } catch (err) { next(err); }
    });

    router.get('/:id', requirePermission('health:READ', 'препарат'), async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const { rows } = await query(
                `${SELECT} FROM drug d JOIN nomenclature n ON n.id = d.nomenclature_id WHERE d.nomenclature_id = $1`, [id]);
            if (!rows.length) throw httpError(404, 'Препарат не найден');
            res.json({ data: rows[0] });
        } catch (err) { next(err); }
    });

    return router;
}

// ============================================================================
// Конфигурации справочников
// ============================================================================

const catalogs = [
    { path: '/species', table: 'species', label: 'вид', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 16, pattern: /^[A-Za-z0-9_-]{1,16}$/ },
          name: { type: 'string', required: true, max: 64 },
      } },
    { path: '/breeds', table: 'breed', label: 'порода', read: 'catalog:READ', write: 'catalog:WRITE',
      search: ['name'], sortable: new Set(['id', 'name']), defaultSort: 'name',
      fields: {
          species_id: { type: 'int', required: true },
          name: { type: 'string', required: true, max: 80 },
          avg_daily_gain: { type: 'decimal', nullable: true },
      },
      fks: [{ field: 'species_id', table: 'species', label: 'Вид' }] },
    { path: '/positions', table: 'position', label: 'должность', read: 'employee:READ', write: 'employee:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 80 },
      } },
    // Сотрудники вынесены в routes/employees.js: у них появились ПДн (шифрование),
    // увольнение с причиной и закрепления за животными — CRUD-фабрике это не по силам.
    { path: '/diagnoses', table: 'diagnosis', label: 'диагноз', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 160 },
          category: { type: 'string', max: 64, nullable: true },
      } },
    { path: '/uoms', table: 'uom', label: 'единица измерения', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 16, pattern: /^[A-Za-z0-9_-]{1,16}$/ },
          name: { type: 'string', required: true, max: 48 },
          uom_type: { type: 'enum', required: true, values: ['MASS', 'VOLUME', 'COUNT'] },
      } },
    { path: '/movement-types', table: 'movement_type', label: 'тип движения', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 64 },
          direction: { type: 'enum', required: true, values: ['IN', 'OUT'] },
      } },
    { path: '/write-off-reasons', table: 'write_off_reason', label: 'причина списания', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 120 },
      } },
    { path: '/disposal-reasons', table: 'disposal_reason', label: 'причина выбытия', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 120 },
          reason_type: { type: 'enum', required: true, values: ['CULLING', 'DEATH', 'SALE'] },
      } },
    { path: '/task-types', table: 'task_type', label: 'тип задачи', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 80 },
          requires_writeoff: { type: 'boolean' },
          default_priority: { type: 'int' },
      } },
    { path: '/suppliers', table: 'supplier', label: 'поставщик', read: 'catalog:READ', write: 'catalog:WRITE',
      softDelete: 'is_deleted',
      search: ['name', 'contact_person', 'email'], sortable: new Set(['id', 'name']), defaultSort: 'name',
      fields: {
          name: { type: 'string', required: true, max: 160 },
          contact_person: { type: 'string', max: 120, nullable: true },
          phone: { type: 'string', max: 24, nullable: true },
          email: { type: 'string', max: 120, nullable: true },
      } },
    { path: '/warehouses', table: 'warehouse', label: 'склад', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 16, pattern: /^[A-Za-z0-9_-]{1,16}$/ },
          name: { type: 'string', required: true, max: 80 },
          is_active: { type: 'boolean' },
      } },
    { path: '/product-types', table: 'product_type', label: 'вид продукции', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 80 },
          uom_id: { type: 'int', required: true },
      },
      fks: [{ field: 'uom_id', table: 'uom', label: 'Единица измерения' }] },
];

/** Зарегистрировать все справочники. Возвращает карту table -> path. */
function registerCatalogs(app, basePath = '/api/v1') {
    const routes = {};
    for (const cfg of catalogs) {
        app.use(`${basePath}${cfg.path}`, makeCatalog(cfg));
        routes[cfg.table] = cfg.path;
    }
    app.use(`${basePath}/drugs`, drugRouter());
    routes.drug = '/drugs';
    return routes;
}

module.exports = { makeCatalog, drugRouter, registerCatalogs, catalogs };
