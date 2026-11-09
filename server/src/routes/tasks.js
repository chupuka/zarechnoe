'use strict';

/**
 * Задачи (Неделя 5): реестр задач, создание разовой задачи и выполнение.
 *
 * Выполнение вызывает хранимую процедуру `sp_execute_task` (FIFO-списание корма
 * по активному рациону группы, статус-флоу, журнал), которая работает в рамках
 * транзакции с откатом при нехватке остатка. Создание кормовой задачи
 * (requires_writeoff) проверяет на сервере, что у каждой группы есть активный
 * рацион (ТЗ п.4).
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'];

const TASK_SPECS = {
    task_type_id: { type: 'int', required: true },
    title: { type: 'string', required: true, max: 200 },
    plot_id: { type: 'int', nullable: true },
    assigned_to: { type: 'int', required: true },
    planned_date: { type: 'date' },
    due_at: { type: 'datetime' },
    priority: { type: 'enum', values: PRIORITIES },
    group_ids: { type: 'intArray' },
};

const EXECUTE_SPECS = {
    group_id: { type: 'int', required: true },
    actual_amount: { type: 'decimal', nullable: true },
    notes: { type: 'string', max: 1000, nullable: true },
};

/** GET /api/v1/tasks — реестр задач */
router.get('/', requirePermission('task:READ', 'task'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'planned_date', 'due_at', 'priority', 'status', 'created_at']), 'planned_date');
        const q = String(req.query.q || '').trim();
        const status = String(req.query.status || '');
        const assignedTo = asInt(req.query.assigned_to) || 0;

        const where = [];
        const params = [];
        if (q) {
            where.push(`(t.title ILIKE '%' || $${params.length + 1}::text || '%'
                        OR e.full_name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (status) { where.push(`t.status = $${params.length + 1}::text`); params.push(status); }
        if (assignedTo) { where.push(`t.assigned_to = $${params.length + 1}::int`); params.push(assignedTo); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await query(
            `SELECT t.id, t.task_type_id, t.series_id, t.title, t.plot_id, t.assigned_to,
                    t.planned_date, t.due_at, t.priority, t.status, t.created_by, t.created_at, t.completed_at,
                    tt.name AS task_type, tt.requires_writeoff,
                    e.full_name AS assignee, p.name AS plot_name,
                    COUNT(*) OVER() AS total
             FROM task t
             JOIN task_type tt ON tt.id = t.task_type_id
             JOIN employee e ON e.id = t.assigned_to
             LEFT JOIN pasture_plot p ON p.id = t.plot_id
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, t.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /api/v1/tasks/:id — карточка задачи (+ группы и исполнения) */
router.get('/:id', requirePermission('task:READ', 'task'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `SELECT t.*, tt.name AS task_type, tt.requires_writeoff,
                    e.full_name AS assignee, p.name AS plot_name
             FROM task t
             JOIN task_type tt ON tt.id = t.task_type_id
             JOIN employee e ON e.id = t.assigned_to
             LEFT JOIN pasture_plot p ON p.id = t.plot_id
             WHERE t.id = $1`, [id]);
        if (!rows.length) throw httpError(404, 'Задача не найдена');

        const [groups, executions] = await Promise.all([
            query(`SELECT g.id, g.name FROM task_animal_group tag
                   JOIN animal_group g ON g.id = tag.group_id WHERE tag.task_id = $1 ORDER BY g.id`, [id]),
            query(`SELECT * FROM task_execution WHERE task_id = $1 ORDER BY id`, [id]),
        ]);
        res.json({ data: { ...rows[0], groups: groups.rows, executions: executions.rows } });
    } catch (err) { next(err); }
});

/** POST /api/v1/tasks — создание разовой задачи (+ привязка групп) */
router.post('/', requirePermission('task:WRITE', 'task'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, TASK_SPECS);

        const tt = await query('SELECT id, requires_writeoff, default_priority FROM task_type WHERE id = $1', [v.task_type_id]);
        if (!tt.rows.length) throw httpError(400, `Тип задачи ${v.task_type_id} не найден`);
        const { requires_writeoff, default_priority } = tt.rows[0];

        const emp = await query('SELECT id FROM employee WHERE id = $1 AND NOT is_deleted', [v.assigned_to]);
        if (!emp.rows.length) throw httpError(400, `Сотрудник ${v.assigned_to} не найден`);

        if (v.plot_id) {
            const pl = await query('SELECT id FROM pasture_plot WHERE id = $1 AND NOT is_deleted', [v.plot_id]);
            if (!pl.rows.length) throw httpError(400, `Участок ${v.plot_id} не найден`);
        }

        const groupIds = v.group_ids || [];
        // ТЗ п.4: кормление — только для активной группы с назначенным рационом
        if (requires_writeoff && !groupIds.length) {
            throw httpError(400, 'Для кормовой задачи требуется хотя бы одна группа (group_ids)');
        }
        const plannedDate = v.planned_date || new Date().toISOString().slice(0, 10);
        for (const gid of groupIds) {
            const g = await query(
                'SELECT id FROM animal_group WHERE id = $1 AND is_active AND NOT is_deleted', [gid]);
            if (!g.rows.length) throw httpError(400, `Группа ${gid} не найдена или неактивна`);
            if (requires_writeoff) {
                const r = await query(
                    `SELECT 1 FROM ration r
                     WHERE r.group_id = $1 AND r.is_active AND NOT r.is_deleted
                       AND r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to >= $2::date)`,
                    [gid, plannedDate]);
                if (!r.rows.length) throw httpError(400, `У группы ${gid} нет активного рациона на ${plannedDate}`);
            }
        }

        const priority = v.priority || (default_priority === 1 ? 'HIGH' : default_priority >= 5 ? 'LOW' : 'NORMAL');
        const dueAt = v.due_at || `${plannedDate}T12:00:00.000Z`;

        const created = await withTransaction(async (client) => {
            const ins = await client.query(
                `INSERT INTO task (task_type_id, title, plot_id, assigned_to, planned_date, due_at, priority, status, created_by)
                 VALUES ($1, $2, $3, $4, $5::date, $6::timestamptz, $7, 'NEW', $8) RETURNING *`,
                [v.task_type_id, v.title, v.plot_id ?? null, v.assigned_to, plannedDate, dueAt, priority, req.user.id]
            );
            const task = ins.rows[0];
            for (const gid of groupIds) {
                await client.query('INSERT INTO task_animal_group (task_id, group_id) VALUES ($1, $2)', [task.id, gid]);
            }
            return task;
        });

        await writeAudit(req, { entityName: 'task', entityId: created.id, action: 'CREATE', after: created });
        res.status(201).json({ data: created });
    } catch (err) { next(err); }
});

/**
 * POST /api/v1/tasks/:id/execute — выполнение задачи (sp_execute_task).
 * Факт по группе + FIFO-списание корма со склада; при нехватке остатка —
 * транзакция откатывается (нет частичного списания).
 */
router.post('/:id/execute', requirePermission('task:WRITE', 'task'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, EXECUTE_SPECS);

        const row = await withTransaction(async (client) => {
            const r = await client.query(
                `SELECT sp_execute_task($1, $2, $3, $4, $5) AS execution_id`,
                [id, v.group_id, v.actual_amount ?? null, req.user.id, v.notes ?? null]
            );
            return r.rows[0];
        });

        await writeAudit(req, { entityName: 'task', entityId: id, action: 'UPDATE', after: { group_id: v.group_id, execution_id: row.execution_id } });
        res.json({ data: { task_id: id, group_id: v.group_id, execution_id: row.execution_id } });
    } catch (err) { next(err); }
});

module.exports = router;
