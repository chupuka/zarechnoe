'use strict';

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');
const assignments = require('../assignments');

const router = express.Router();

const STATUSES = ['ЗДОРОВ', 'НА_ОСМОТРЕ', 'НА_КАРАНТИНЕ', 'НА_ЛЕЧЕНИИ', 'НА_ПРОДАЖЕ',
                  'ПРОДАН', 'ВЫБРАКОВАНО', 'ПАДЁЖ'];
const SEXES = ['M', 'F'];
const SORTABLE = new Set(['id', 'inventory_number', 'birth_date', 'sex', 'status', 'arrival_date', 'created_at']);
const INV_RE = /^[A-Za-zА-Яа-яЁё0-9_-]{2,20}$/;

/** Схема валидации реквизитов животного (POST/PATCH). */
const SPECS = {
    inventory_number: { type: 'string', pattern: INV_RE, message: 'inventory_number: 2–20 символов (буквы, цифры, «_», «-»)' },
    birth_date: { type: 'date', maxToday: true },
    sex: { type: 'enum', values: SEXES, message: 'sex: допустимо только M или F' },
    breed_id: { type: 'int' },
    group_id: { type: 'int', nullable: true },
    arrival_date: { type: 'date' },
    status: { type: 'reject', message: 'Статус меняется только через POST /animals/:id/status (регламент ТЗ п.3.2)' },
    is_deleted: { type: 'reject', message: 'Поле is_deleted не редактируется напрямую (используйте DELETE)' },
};

/** Схема валидации перевода статуса. */
const STATUS_SPECS = {
    status: { type: 'enum', required: true, values: STATUSES, message: 'status: недопустимое значение' },
    reason: { type: 'string', required: true, min: 1, message: 'reason: причина перехода обязательна (регламент ТЗ п.4.4)' },
    diagnosis_id: { type: 'int', nullable: true },
    drug_nomenclature_id: { type: 'int', nullable: true },
    dosage: { type: 'decimal' },
    disposal_reason_id: { type: 'int', nullable: true },
};

async function ensureBreed(breedId) {
    if (breedId == null) throw httpError(400, 'breed_id обязателен');
    const { rows } = await query('SELECT id FROM breed WHERE id = $1', [breedId]);
    if (!rows.length) throw httpError(400, `Порода ${breedId} не найдена`);
}
async function ensureGroup(groupId) {
    if (groupId == null) return;
    const { rows } = await query(
        'SELECT id FROM animal_group WHERE id = $1 AND is_active AND NOT is_deleted', [groupId]);
    if (!rows.length) throw httpError(400, `Группа ${groupId} не найдена или неактивна`);
}

const selectAnimal = (extra = '') => `
    SELECT a.id, a.inventory_number, a.birth_date, a.sex, a.status, a.arrival_date,
           a.is_deleted, a.group_id, a.breed_id, a.created_at,
           b.name AS breed, g.name AS group_name,
           (SELECT count(*)::int FROM animal_assignment aa
             WHERE aa.animal_id = a.id AND aa.ended_at IS NULL) AS assigned_count,
           (SELECT string_agg(DISTINCT e.full_name, ', ')
              FROM animal_assignment aa JOIN employee e ON e.id = aa.employee_id
             WHERE aa.animal_id = a.id AND aa.ended_at IS NULL) AS assigned_names
           ${extra}
    FROM animal a
    JOIN breed b ON b.id = a.breed_id
    LEFT JOIN animal_group g ON g.id = a.group_id`;

/**
 * GET /api/v1/animals — реестр с фильтрами, сортировкой, пагинацией (ТЗ п.5).
 * Query: limit (≤200, по умолчанию 50), offset, q (поиск), status, group_id,
 *        sort (inventory_number|birth_date|sex|status|arrival_date|created_at, «-» — DESC),
 *        include_deleted=true.
 */
router.get('/', requirePermission('animal:READ', 'animal'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query, { defaultLimit: 50, maxLimit: 200 });
        const { sort, desc } = parseSort(req.query, SORTABLE, 'inventory_number');
        const q = String(req.query.q || '').trim();
        // status может быть один или несколько через запятую: «НА_ПРОДАЖЕ,ПРОДАН»
        const statuses = String(req.query.status || '')
            .split(',').map((s) => s.trim()).filter(Boolean);
        for (const s of statuses) {
            if (!STATUSES.includes(s)) throw httpError(400, `status: недопустимое значение «${s}»`);
        }
        const groupId = asInt(req.query.group_id) || 0;
        const breedId = asInt(req.query.breed_id) || 0;
        const includeDeleted = req.query.include_deleted === 'true';
        const unassignedOnly = req.query.unassigned === 'true';

        const { rows } = await query(
            `${selectAnimal(', COUNT(*) OVER() AS total')}
             WHERE ($1::boolean OR NOT a.is_deleted)
               AND ($2::text = '' OR a.inventory_number ILIKE '%' || $2::text || '%'
                    OR b.name ILIKE '%' || $2::text || '%'
                    OR COALESCE(g.name, '') ILIKE '%' || $2::text || '%')
               AND ($3::text[] IS NULL OR a.status = ANY($3::text[]))
               AND ($4::int = 0 OR a.group_id = $4::int)
               AND ($5::int = 0 OR a.breed_id = $5::int)
               AND (NOT $6::boolean OR NOT EXISTS (
                     SELECT 1 FROM animal_assignment aa
                      WHERE aa.animal_id = a.id AND aa.ended_at IS NULL))
             ORDER BY a.${sort} ${desc ? 'DESC' : 'ASC'}, a.id ASC
             LIMIT $7::int OFFSET $8::int`,
            [includeDeleted, q, statuses.length ? statuses : null, groupId, breedId,
             unassignedOnly, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({
            data: rows.map(({ total: _t, ...r }) => r),
            total, limit, offset,
        });
    } catch (err) { next(err); }
});

/**
 * GET /api/v1/animals/herd — сводка «кто за кем смотрит» для бригадира:
 * группы с участками выпаса, животные без закрепления, нагрузка по сотрудникам.
 */
router.get('/herd', requirePermission('animal:READ', 'animal'), async (req, res, next) => {
    try {
        const data = await assignments.herdOverview();
        const herd = (await query('SELECT * FROM v_herd_stats')).rows[0] || {};
        res.json({ data: { ...data, herd } });
    } catch (err) { next(err); }
});

/** GET /api/v1/animals/:id — карточка */
router.get('/:id', requirePermission('animal:READ', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const includeDeleted = req.query.include_deleted === 'true';
        const { rows } = await query(
            `${selectAnimal()} WHERE a.id = $1::int AND ($2::boolean OR NOT a.is_deleted)`,
            [id, includeDeleted]
        );
        if (!rows.length) throw httpError(404, 'Животное не найдено');
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** POST /api/v1/animals — создание карточки */
router.post('/', requirePermission('animal:WRITE', 'animal'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, SPECS);
        await ensureBreed(v.breed_id);
        await ensureGroup(v.group_id);

        const { rows } = await query(
            `INSERT INTO animal (inventory_number, breed_id, group_id, birth_date, sex, status, arrival_date)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE))
             RETURNING id, inventory_number, birth_date, sex, status, arrival_date,
                       group_id, breed_id, is_deleted, created_at`,
            [v.inventory_number, v.breed_id, v.group_id ?? null, v.birth_date, v.sex,
             'ЗДОРОВ', v.arrival_date || null]
        );
        await writeAudit(req, {
            entityName: 'animal', entityId: rows[0].id, action: 'CREATE', after: rows[0],
        });
        res.status(201).json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** PATCH /api/v1/animals/:id — изменение реквизитов (статус — только через /status) */
router.patch('/:id', requirePermission('animal:WRITE', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, SPECS, { partial: true });
        const keys = Object.keys(v);
        if (!keys.length) throw httpError(400, 'Нет полей для изменения');
        if (v.breed_id !== undefined) await ensureBreed(v.breed_id);
        if (v.group_id !== undefined) await ensureGroup(v.group_id);

        const row = await withTransaction(async (client) => {
            const cur = await client.query(
                'SELECT * FROM animal WHERE id = $1 AND NOT is_deleted FOR UPDATE', [id]);
            if (!cur.rows.length) throw httpError(404, 'Животное не найдено');
            const sets = [];
            const params = [];
            keys.forEach((k, i) => { sets.push(`${k} = $${i + 2}`); params.push(v[k]); });
            const upd = await client.query(
                `UPDATE animal SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
                [id, ...params]
            );
            return { before: cur.rows[0], after: upd.rows[0] };
        });

        await writeAudit(req, {
            entityName: 'animal', entityId: id, action: 'UPDATE',
            before: { inventory_number: row.before.inventory_number, breed_id: row.before.breed_id,
                      group_id: row.before.group_id },
            after: { inventory_number: row.after.inventory_number, breed_id: row.after.breed_id,
                     group_id: row.after.group_id },
        });
        res.json({ data: row.after });
    } catch (err) { next(err); }
});

/** DELETE /api/v1/animals/:id — мягкое удаление (is_deleted) */
router.delete('/:id', requirePermission('animal:DELETE', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            'UPDATE animal SET is_deleted = TRUE WHERE id = $1 AND NOT is_deleted RETURNING id, inventory_number',
            [id]
        );
        if (!rows.length) throw httpError(404, 'Животное не найдено');
        await writeAudit(req, {
            entityName: 'animal', entityId: id, action: 'DELETE',
            before: { inventory_number: rows[0].inventory_number },
        });
        res.json({ data: { id, is_deleted: true } });
    } catch (err) { next(err); }
});

/**
 * POST /api/v1/animals/:id/status — регламентированный перевод статуса.
 * Вся бизнес-логика (диагноз/причина/расход препарата/withdrawal/аудит) —
 * в хранимой процедуре sp_change_animal_status (серверная валидация, ТЗ п.4).
 *
 * Статусы «НА_ПРОДАЖЕ» и «ПРОДАН» добавлены вместе с причинами SALE
 * (миграция 0005): продажа обязана ссылаться на причину типа SALE.
 */
router.post('/:id/status', requirePermission('animal:WRITE', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, STATUS_SPECS);
        if (v.dosage !== undefined && !(v.dosage > 0)) {
            throw httpError(400, 'dosage: должна быть положительной');
        }
        if (v.status === 'ПРОДАН' && v.disposal_reason_id == null) {
            throw httpError(400, 'Для продажи обязательна причина выбытия (disposal_reason_id типа SALE)');
        }
        const { rows } = await query(
            `SELECT sp_change_animal_status($1, $2, $3, $4, $5, $6, $7, $8, $9::inet) AS new_status`,
            [
                id, v.status, req.user.id, v.reason,
                v.diagnosis_id ?? null, v.drug_nomenclature_id ?? null,
                v.dosage !== undefined ? v.dosage : null,
                v.disposal_reason_id ?? null,
                req.ip || null,
            ]
        );
        res.json({ data: { id, status: rows[0].new_status } });
    } catch (err) { next(err); }
});

/**
 * GET /api/v1/animals/:id/assignments — кто закреплён за животным.
 */
router.get('/:id/assignments', requirePermission('animal:READ', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const includeEnded = req.query.include_ended !== 'false';
        const rows = await assignments.listByAnimal(id, { includeEnded });
        res.json({ data: rows, total: rows.length });
    } catch (err) { next(err); }
});

/** POST /api/v1/animals/:id/assignments — закрепить сотрудника за животным. */
router.post('/:id/assignments', requirePermission('animal:WRITE', 'animal'), async (req, res, next) => {
    try {
        const animalId = asInt(req.params.id);
        if (animalId == null) throw httpError(400, 'Некорректный id');
        const v = assignments.parseAssignBody({ ...(req.body || {}), animal_id: animalId });
        const row = await assignments.assign(req, v);
        res.status(201).json({ data: row });
    } catch (err) { next(err); }
});

/** DELETE /api/v1/animals/:id/assignments/:assignmentId — снять закрепление. */
router.delete('/:id/assignments/:assignmentId', requirePermission('animal:WRITE', 'animal'),
    async (req, res, next) => {
        try {
            const animalId = asInt(req.params.id);
            const assignmentId = asInt(req.params.assignmentId);
            if (animalId == null || assignmentId == null) throw httpError(400, 'Некорректный id');
            const reason = String((req.body && req.body.reason) || 'снято администратором').slice(0, 200);
            const row = await assignments.unassign(req, assignmentId, reason);
            if (Number(row.animal_id) !== animalId) throw httpError(404, 'Закрепление не относится к животному');
            res.json({ data: row });
        } catch (err) { next(err); }
    });

module.exports = router;
