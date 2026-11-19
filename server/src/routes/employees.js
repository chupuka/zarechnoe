'use strict';

/**
 * Сотрудники и их персональные данные — /api/v1/employees.
 *
 * Выделено из универсальной CRUD-фабрики (routes/catalog.js), потому что у
 * персонала появилась особая логика:
 *
 *   * ПДн (телефон, паспорт, адрес, СНИЛС, ИНН, счёт, экстренный контакт)
 *     лежат в employee_pii в зашифрованном виде и НЕ входят в список;
 *   * в реестре отдаётся только маска телефона (employee.phone_mask);
 *   * полная расшифровка — GET /employees/:id/pii под правом employee:PII,
 *     каждое чтение фиксируется в аудите как READ_PII (ТЗ п.7);
 *   * увольнение и удаление — только с причиной (ТЗ п.7, ограничения в БД);
 *   * увольнение закрывает закрепления и отзывает сессии учётных записей.
 *
 * Права: employee:READ (реестр), employee:WRITE (изменения), employee:PII
 * (расшифровка персональных данных).
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { elevated } = require('../middleware/elevated');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort, todayISO } = require('../validation');
const pii = require('../pii');
const assignments = require('../assignments');

const router = express.Router();

const EMPLOYEE_BASE = {
    full_name: { type: 'string', required: true, max: 120 },
    position_id: { type: 'int', required: true },
    hire_date: { type: 'date', maxToday: true },
};

const EMPLOYEE_PATCH = {
    full_name: { type: 'string', max: 120 },
    position_id: { type: 'int' },
    hire_date: { type: 'date', maxToday: true },
    is_active: { type: 'reject', message: 'Активность меняется через /dismiss и /reinstate (нужна причина)' },
    is_deleted: { type: 'reject', message: 'Удаление — через DELETE /employees/:id с причиной' },
    dismissed_at: { type: 'reject', message: 'Дата увольнения — через POST /employees/:id/dismiss' },
    dismissal_reason: { type: 'reject', message: 'Причина увольнения — через POST /employees/:id/dismiss' },
};

const PII_SPECS = {
    phone: { type: 'string', max: 24, nullable: true },
    passport: { type: 'string', max: 160, nullable: true },
    address: { type: 'string', max: 240, nullable: true },
    snils: { type: 'string', max: 24, nullable: true },
    inn: { type: 'string', max: 20, nullable: true },
    bank_account: { type: 'string', max: 40, nullable: true },
    emergency_contact: { type: 'string', max: 160, nullable: true },
};

/** Проверить должность. */
async function ensurePosition(id) {
    const { rows } = await query('SELECT id FROM position WHERE id = $1', [id]);
    if (!rows.length) throw httpError(400, `Должность ${id} не найдена`);
}

/** Маска для журнала аудита: полный текст ПДн в аудит не пишем. */
function maskPiiValue(field, value) {
    if (value == null) return null;
    const s = String(value);
    if (field === 'phone') return `${s.slice(0, 3)}***${s.slice(-2)}`;
    return `${s.slice(0, 2)}***`;
}

// ============================================================================
// Реестр и карточка
// ============================================================================

/**
 * GET /employees — реестр сотрудников.
 * Фильтры: q, position_id, is_active (true/false), pii (yes/no), assigned (yes/no),
 *          online (true), include_deleted=true. Сортировка — sort / -sort.
 */
router.get('/', requirePermission('employee:READ', 'employee'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'full_name', 'hire_date', 'is_active', 'assigned_count', 'position_name']),
            'full_name');
        const q = String(req.query.q || '').trim();
        const positionId = asInt(req.query.position_id) || 0;
        const active = req.query.is_active;
        const piiFilter = String(req.query.pii || '').trim();
        const assignedFilter = String(req.query.assigned || '').trim();
        const onlineOnly = req.query.online === 'true';
        const includeDeleted = req.query.include_deleted === 'true';

        const where = [];
        const params = [];
        const add = (sql, val) => { where.push(sql.replace('$N', `$${params.length + 1}`)); params.push(val); };

        if (!includeDeleted) where.push('NOT v.is_deleted');
        if (q) add('v.full_name ILIKE \'%\' || $N::text || \'%\'', q);
        if (positionId) add('v.position_id = $N::int', positionId);
        if (active === 'true') where.push('v.is_active');
        if (active === 'false') where.push('NOT v.is_active');
        if (piiFilter === 'yes') where.push('v.has_pii');
        if (piiFilter === 'no') where.push('NOT v.has_pii');
        if (assignedFilter === 'yes') where.push('v.assigned_count > 0');
        if (assignedFilter === 'no') where.push('v.assigned_count = 0');
        if (onlineOnly) where.push('v.is_online');

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT v.*, COUNT(*) OVER() AS total
               FROM v_employee_overview v
               ${whereSql}
              ORDER BY v.${sort} ${desc ? 'DESC' : 'ASC'} NULLS LAST, v.id ASC
              LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({
            data: rows.map(({ total: _t, ...r }) => r),
            total, limit, offset,
            pii_available: pii.piiEnabled(),
        });
    } catch (err) { next(err); }
});

/** GET /employees/:id — карточка: реквизиты, маска телефона, закрепления, учётные записи. */
router.get('/:id', requirePermission('employee:READ', 'employee'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            'SELECT * FROM v_employee_overview WHERE id = $1', [id]);
        if (!rows.length) throw httpError(404, 'Сотрудник не найден');
        const accounts = (await query(
            `SELECT id, login, full_name, role_code, role_name, is_active, is_deleted,
                    is_online, last_login_at, blocked_reason, blocked_at, delete_reason
               FROM v_user_overview WHERE employee_id = $1 ORDER BY id`, [id])).rows;
        const assign = await assignments.listByEmployee(id, { includeEnded: false });
        const recentAudit = (await query(
            `SELECT a.id, a.occurred_at, a.action, u.login
               FROM audit_log a JOIN app_user u ON u.id = a.user_id
              WHERE a.entity_name = 'employee' AND a.entity_id = $1
              ORDER BY a.occurred_at DESC LIMIT 10`, [id])).rows;
        res.json({
            data: { ...rows[0], accounts, assignments: assign, recent_audit: recentAudit,
                    pii_available: pii.piiEnabled() },
        });
    } catch (err) { next(err); }
});

// ============================================================================
// Создание и изменение
// ============================================================================

/** POST /employees — создать сотрудника (можно сразу с ПДн). */
router.post('/', elevated('employee:WRITE', 'employee'), async (req, res, next) => {
    try {
        const body = req.body || {};
        // Одна схема на всё тело: реквизиты + ПДн (иначе валидатор отклонит
        // phone/passport как «неизвестные поля»).
        const v = validate(body, {
            full_name: EMPLOYEE_BASE.full_name,
            position_id: EMPLOYEE_BASE.position_id,
            hire_date: { type: 'date', maxToday: true, default: todayISO() },
            ...PII_SPECS,
        });
        const employee = { full_name: v.full_name, position_id: v.position_id, hire_date: v.hire_date };
        const piiValues = Object.fromEntries(
            Object.keys(PII_SPECS).filter((k) => v[k] !== undefined).map((k) => [k, v[k]]));
        const hasPii = Object.keys(piiValues).length > 0;
        if (hasPii && !pii.piiEnabled()) throw httpError(503, 'Шифрование ПДн не настроено (PII_KEY)');
        await ensurePosition(employee.position_id);

        const created = await withTransaction(async (client) => {
            if (hasPii) await pii.applyPiiKey(client);
            const ins = await client.query(
                `INSERT INTO employee (full_name, position_id, hire_date)
                 VALUES ($1, $2, $3) RETURNING id, full_name, position_id, hire_date, is_active`,
                [employee.full_name, employee.position_id, employee.hire_date]);
            let piiRow = null;
            if (hasPii) {
                piiRow = await pii.upsertPii(client, ins.rows[0].id, piiValues, req.user.id);
                if (piiValues.phone) {
                    await client.query(
                        'UPDATE employee SET phone_mask = fn_phone_mask($2) WHERE id = $1',
                        [ins.rows[0].id, piiValues.phone]);
                }
            }
            return { employee: ins.rows[0], pii: piiRow };
        });

        await writeAudit(req, {
            entityName: 'employee', entityId: created.employee.id, action: 'CREATE',
            after: created.employee,
        });
        if (hasPii) {
            await writeAudit(req, {
                entityName: 'employee_pii', entityId: created.employee.id, action: 'UPDATE',
                after: Object.fromEntries(Object.entries(piiValues).map(([k, val]) => [k, maskPiiValue(k, val)])),
            });
        }
        res.status(201).json({ data: created.employee });
    } catch (err) { next(err); }
});

/** PATCH /employees/:id — реквизиты (не ПДн: для них PUT /:id/pii). */
router.patch('/:id', elevated('employee:WRITE', 'employee'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const body = req.body || {};
        const piiKeys = Object.keys(PII_SPECS).filter((k) => body[k] !== undefined);
        if (piiKeys.length) {
            throw httpError(400,
                `Персональные данные меняются через PUT /employees/${id}/pii (поля: ${piiKeys.join(', ')})`);
        }
        const v = validate(body, EMPLOYEE_PATCH, { partial: true });
        const keys = Object.keys(v);
        if (!keys.length) throw httpError(400, 'Нет полей для изменения (ПДн меняются через PUT /:id/pii)');
        if (v.position_id !== undefined) await ensurePosition(v.position_id);

        const row = await withTransaction(async (client) => {
            const cur = await client.query(
                'SELECT * FROM employee WHERE id = $1 AND NOT is_deleted FOR UPDATE', [id]);
            if (!cur.rows.length) throw httpError(404, 'Сотрудник не найден');
            const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
            const upd = await client.query(
                `UPDATE employee SET ${sets} WHERE id = $1 RETURNING *`,
                [id, ...keys.map((k) => v[k])]);
            return { before: cur.rows[0], after: upd.rows[0] };
        });
        const pick = (o) => Object.fromEntries(keys.map((k) => [k, o[k]]));
        await writeAudit(req, {
            entityName: 'employee', entityId: id, action: 'UPDATE',
            before: pick(row.before), after: pick(row.after),
        });
        res.json({ data: row.after });
    } catch (err) { next(err); }
});

// ============================================================================
// Персональные данные
// ============================================================================

/**
 * GET /employees/:id/pii — полная расшифровка ПДн.
 * Право employee:PII + обязательная запись READ_PII в аудит: видно, кто и когда
 * смотрел паспорт/телефон сотрудника (ТЗ п.7).
 */
router.get('/:id/pii', requirePermission('employee:PII', 'employee_pii'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const emp = await query(
            'SELECT id, full_name FROM employee WHERE id = $1 AND NOT is_deleted', [id]);
        if (!emp.rows.length) throw httpError(404, 'Сотрудник не найден');
        const data = await pii.withPiiKey(async (client) => pii.decryptRow(client, id));
        if (!data) throw httpError(404, 'Персональные данные не заполнены');
        await writeAudit(req, {
            entityName: 'employee_pii', entityId: id, action: 'READ_PII',
            after: { employee: emp.rows[0].full_name, fields: Object.keys(data.values) },
        });
        res.json({
            data: {
                employee_id: id,
                full_name: emp.rows[0].full_name,
                values: data.values,
                key_version: data.keyVersion,
                updated_at: data.updatedAt,
            },
        });
    } catch (err) { next(err); }
});

/** PUT /employees/:id/pii — записать/обновить ПДн (шифрование на сервере). */
router.put('/:id/pii', elevated('employee:WRITE', 'employee_pii'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const body = req.body || {};
        const v = validate(body, PII_SPECS, { partial: true });
        if (!Object.keys(v).length) throw httpError(400, 'Нет полей ПДн для сохранения');
        const emp = await query(
            'SELECT id, full_name FROM employee WHERE id = $1 AND NOT is_deleted', [id]);
        if (!emp.rows.length) throw httpError(404, 'Сотрудник не найден');

        await pii.withPiiKey(async (client) => {
            await pii.upsertPii(client, id, v, req.user.id);
            if (v.phone !== undefined) {
                await client.query(
                    'UPDATE employee SET phone_mask = fn_phone_mask($2) WHERE id = $1', [id, v.phone]);
            }
        });
        await writeAudit(req, {
            entityName: 'employee_pii', entityId: id, action: 'UPDATE',
            before: null,
            after: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, maskPiiValue(k, val)])),
        });
        res.json({ data: { employee_id: id, updated: Object.keys(v) } });
    } catch (err) { next(err); }
});

// ============================================================================
// Увольнение / восстановление / удаление
// ============================================================================

/** POST /employees/:id/dismiss — увольнение с обязательной причиной. */
router.post('/:id/dismiss', elevated('employee:WRITE', 'employee'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, {
            dismissed_at: { type: 'date', maxToday: true, default: todayISO() },
            dismissal_reason: { type: 'string', required: true, min: 3, max: 500 },
        });
        const result = await withTransaction(async (client) => {
            const cur = await client.query(
                'SELECT id, full_name, is_active FROM employee WHERE id = $1 AND NOT is_deleted FOR UPDATE', [id]);
            if (!cur.rows.length) throw httpError(404, 'Сотрудник не найден');
            if (!cur.rows[0].is_active) throw httpError(400, 'Сотрудник уже уволен');
            const upd = await client.query(
                `UPDATE employee SET is_active = FALSE, dismissed_at = $2, dismissal_reason = $3
                  WHERE id = $1 RETURNING id, full_name, is_active, dismissed_at, dismissal_reason`,
                [id, v.dismissed_at, v.dismissal_reason]);
            const closed = await assignments.closeAllForEmployee(client, id,
                `закрыто при увольнении: ${v.dismissal_reason}`);
            // Учётные записи уволенного блокируются, сессии отзываются.
            const blocked = await client.query(
                `UPDATE app_user SET is_active = FALSE, blocked_reason = $2,
                        blocked_at = now(), blocked_by = $3
                  WHERE employee_id = $1 AND NOT is_deleted AND is_active
                  RETURNING id`, [id, `сотрудник уволен: ${v.dismissal_reason}`, req.user.id]);
            if (blocked.rowCount) {
                await client.query(
                    `UPDATE user_session SET revoked_at = now()
                      WHERE user_id = ANY($1::bigint[]) AND revoked_at IS NULL`,
                    [blocked.rows.map((r) => r.id)]);
            }
            return { employee: upd.rows[0], closed, blocked: blocked.rowCount };
        });
        await writeAudit(req, {
            entityName: 'employee', entityId: id, action: 'UPDATE',
            before: { is_active: true },
            after: { is_active: false, dismissed_at: v.dismissed_at,
                     dismissal_reason: v.dismissal_reason,
                     assignments_closed: result.closed, accounts_blocked: result.blocked },
        });
        res.json({ data: { ...result.employee, assignments_closed: result.closed,
                           accounts_blocked: result.blocked } });
    } catch (err) { next(err); }
});

/** POST /employees/:id/reinstate — вернуть сотрудника в штат. */
router.post('/:id/reinstate', elevated('employee:WRITE', 'employee'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `UPDATE employee SET is_active = TRUE, dismissed_at = NULL, dismissal_reason = NULL
              WHERE id = $1 AND NOT is_deleted AND NOT is_active
              RETURNING id, full_name, is_active, hire_date`, [id]);
        if (!rows.length) throw httpError(404, 'Уволенный сотрудник не найден');
        await writeAudit(req, {
            entityName: 'employee', entityId: id, action: 'UPDATE',
            before: { is_active: false }, after: { is_active: true },
        });
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** DELETE /employees/:id — мягкое удаление с причиной. */
router.delete('/:id', elevated('employee:WRITE', 'employee'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, {
            reason: { type: 'string', required: true, min: 3, max: 500 },
        });
        const result = await withTransaction(async (client) => {
            const upd = await client.query(
                `UPDATE employee SET is_deleted = TRUE, is_active = FALSE,
                        dismissed_at = COALESCE(dismissed_at, CURRENT_DATE),
                        dismissal_reason = COALESCE(dismissal_reason, $2)
                  WHERE id = $1 AND NOT is_deleted
                  RETURNING id, full_name`, [id, v.reason]);
            if (!upd.rows.length) throw httpError(404, 'Сотрудник не найден');
            const closed = await assignments.closeAllForEmployee(client, id,
                `закрыто при удалении сотрудника: ${v.reason}`);
            const blocked = await client.query(
                `UPDATE app_user SET is_active = FALSE, is_deleted = TRUE,
                        delete_reason = $2, deleted_at = now(),
                        blocked_reason = COALESCE(blocked_reason, $2)
                  WHERE employee_id = $1 AND NOT is_deleted RETURNING id`,
                [id, `сотрудник удалён: ${v.reason}`]);
            if (blocked.rowCount) {
                await client.query(
                    `UPDATE user_session SET revoked_at = now()
                      WHERE user_id = ANY($1::bigint[]) AND revoked_at IS NULL`,
                    [blocked.rows.map((r) => r.id)]);
            }
            return { employee: upd.rows[0], closed, accounts: blocked.rowCount };
        });
        await writeAudit(req, {
            entityName: 'employee', entityId: id, action: 'DELETE',
            before: result.employee, after: { reason: v.reason, accounts_closed: result.accounts },
        });
        res.json({ data: { id, is_deleted: true, assignments_closed: result.closed,
                           accounts_closed: result.accounts } });
    } catch (err) { next(err); }
});

// ============================================================================
// Закрепления со стороны сотрудника
// ============================================================================

router.get('/:id/assignments', requirePermission('employee:READ', 'animal_assignment'),
    async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const includeEnded = req.query.include_ended !== 'false';
            const rows = await assignments.listByEmployee(id, { includeEnded });
            res.json({ data: rows, total: rows.length });
        } catch (err) { next(err); }
    });

router.post('/:id/assignments', requirePermission('employee:WRITE', 'animal_assignment'),
    async (req, res, next) => {
        try {
            const employeeId = asInt(req.params.id);
            if (employeeId == null) throw httpError(400, 'Некорректный id');
            const v = assignments.parseAssignBody({ ...(req.body || {}), employee_id: employeeId });
            const row = await assignments.assign(req, v);
            res.status(201).json({ data: row });
        } catch (err) { next(err); }
    });

module.exports = router;
