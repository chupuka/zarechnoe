'use strict';

/**
 * Закрепление сотрудников за животными (ТЗ п.3.3 — «кто отвечает за голову»).
 *
 * Правила (продублированы триггерами БД, миграция 0011):
 *   * за выбывшим животным (ПРОДАН / ПАДЁЖ / ВЫБРАКОВАНО) закрепить нельзя;
 *   * один сотрудник в одной роли не может быть закреплён за животным дважды;
 *   * при выбытии животного закрепления закрываются автоматически;
 *   * при увольнении сотрудника его закрепления закрываются вручную (сервис ниже).
 *
 * Сервис общий для маршрутов /employees и /animals — чтобы правила были в одном
 * месте, а не дублировались в двух роутерах.
 */

const { query, withTransaction } = require('./db');
const { writeAudit } = require('./audit');
const { httpError, asInt } = require('./validation');

const ROLES = ['VET', 'HERDSMAN', 'FOREMAN', 'ZOOTECHNIK'];

/** Закрепления конкретного сотрудника (активные и закрытые). */
async function listByEmployee(employeeId, { includeEnded = true, limit = 200 } = {}) {
    const where = ['aa.employee_id = $1'];
    if (!includeEnded) where.push('aa.ended_at IS NULL');
    const { rows } = await query(
        `SELECT aa.id, aa.animal_id, a.inventory_number, a.status AS animal_status,
                a.group_id, g.name AS group_name, aa.role_code,
                aa.assigned_at, aa.ended_at, aa.note,
                u.login AS assigned_by_login
           FROM animal_assignment aa
           JOIN animal a ON a.id = aa.animal_id
           LEFT JOIN animal_group g ON g.id = a.group_id
           JOIN app_user u ON u.id = aa.assigned_by
          WHERE ${where.join(' AND ')}
          ORDER BY (aa.ended_at IS NULL) DESC, aa.assigned_at DESC
          LIMIT $2::int`, [employeeId, limit]);
    return rows;
}

/** Закрепления конкретного животного (активные и закрытые). */
async function listByAnimal(animalId, { includeEnded = true, limit = 200 } = {}) {
    const where = ['aa.animal_id = $1'];
    if (!includeEnded) where.push('aa.ended_at IS NULL');
    const { rows } = await query(
        `SELECT aa.id, aa.employee_id, e.full_name AS employee_name, p.name AS position_name,
                aa.role_code, aa.assigned_at, aa.ended_at, aa.note,
                u.login AS assigned_by_login
           FROM animal_assignment aa
           JOIN employee e ON e.id = aa.employee_id
           LEFT JOIN position p ON p.id = e.position_id
           JOIN app_user u ON u.id = aa.assigned_by
          WHERE ${where.join(' AND ')}
          ORDER BY (aa.ended_at IS NULL) DESC, aa.assigned_at DESC
          LIMIT $2::int`, [animalId, limit]);
    return rows;
}

/** Проверки перед закреплением: животное активно, сотрудник работает. */
async function ensureAssignable(client, animalId, employeeId) {
    const a = await client.query(
        'SELECT id, inventory_number, status, is_deleted FROM animal WHERE id = $1', [animalId]);
    if (!a.rows.length) throw httpError(404, `Животное ${animalId} не найдено`);
    if (a.rows[0].is_deleted) throw httpError(400, 'Животное удалено из реестра');
    if (['ВЫБРАКОВАНО', 'ПАДЁЖ', 'ПРОДАН'].includes(a.rows[0].status)) {
        throw httpError(400, `Нельзя закрепить сотрудника за животным в статусе «${a.rows[0].status}»`);
    }
    const e = await client.query(
        'SELECT id, full_name, is_active, is_deleted FROM employee WHERE id = $1', [employeeId]);
    if (!e.rows.length || e.rows[0].is_deleted) {
        throw httpError(404, `Сотрудник ${employeeId} не найден`);
    }
    if (!e.rows[0].is_active) {
        throw httpError(400, `Сотрудник «${e.rows[0].full_name}» уволен — закрепление невозможно`);
    }
    return { animal: a.rows[0], employee: e.rows[0] };
}

/** Закрепить сотрудника за животным. */
async function assign(req, { animalId, employeeId, roleCode = 'HERDSMAN', note = null }) {
    if (!ROLES.includes(roleCode)) {
        throw httpError(400, `role_code: допустимые значения — ${ROLES.join(', ')}`);
    }
    const row = await withTransaction(async (client) => {
        const { animal, employee } = await ensureAssignable(client, animalId, employeeId);
        const existing = await client.query(
            `SELECT id FROM animal_assignment
              WHERE animal_id = $1 AND employee_id = $2 AND role_code = $3 AND ended_at IS NULL`,
            [animalId, employeeId, roleCode]);
        if (existing.rows.length) {
            throw httpError(409, `«${employee.full_name}» уже закреплён за животным ${animal.inventory_number} в роли ${roleCode}`);
        }
        const ins = await client.query(
            `INSERT INTO animal_assignment (animal_id, employee_id, role_code, assigned_by, note)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [animalId, employeeId, roleCode, req.user.id, note]);
        return { row: ins.rows[0], animal, employee };
    });
    await writeAudit(req, {
        entityName: 'animal_assignment', entityId: row.row.id, action: 'CREATE',
        after: { animal_id: animalId, employee_id: employeeId, role_code: roleCode },
    });
    return row.row;
}

/** Снять закрепление (закрыть, а не удалить — история остаётся). */
async function unassign(req, assignmentId, reason) {
    const { rows } = await query(
        `UPDATE animal_assignment
            SET ended_at = now(),
                note = COALESCE(NULLIF(note, '') || '; ', '') || $2
          WHERE id = $1 AND ended_at IS NULL
          RETURNING id, animal_id, employee_id, role_code`, [assignmentId, reason]);
    if (!rows.length) throw httpError(404, 'Активное закрепление не найдено');
    await writeAudit(req, {
        entityName: 'animal_assignment', entityId: assignmentId, action: 'UPDATE',
        before: { active: true }, after: { active: false, reason },
    });
    return rows[0];
}

/** Закрыть все закрепления сотрудника (например, при увольнении). */
async function closeAllForEmployee(client, employeeId, reason) {
    const { rows } = await client.query(
        `UPDATE animal_assignment
            SET ended_at = now(),
                note = COALESCE(NULLIF(note, '') || '; ', '') || $2
          WHERE employee_id = $1 AND ended_at IS NULL
          RETURNING id`, [employeeId, reason]);
    return rows.length;
}

/**
 * Сводка «кто за кем смотрит» для страницы бригадира:
 *   * группы с участками выпаса и поголовьем;
 *   * животные без активного закрепления;
 *   * сотрудники с числом закреплённых голов.
 */
async function herdOverview() {
    const groups = (await query(
        `SELECT g.id, g.name, g.is_active,
                (SELECT count(*)::int FROM animal a
                  WHERE a.group_id = g.id AND NOT a.is_deleted) AS animals,
                (SELECT count(*)::int FROM animal a
                  WHERE a.group_id = g.id AND NOT a.is_deleted AND a.status = 'ЗДОРОВ') AS healthy,
                p.plot_no, p.plot_name, p.area_ha, p.started_at,
                CASE WHEN p.started_at IS NULL THEN NULL
                     ELSE (CURRENT_DATE - p.started_at::date) END AS days_on_plot
           FROM animal_group g
           LEFT JOIN LATERAL (
                SELECT pp.plot_no, pp.name AS plot_name, pp.area_ha, ge.started_at
                  FROM grazing_event ge JOIN pasture_plot pp ON pp.id = ge.plot_id
                 WHERE ge.group_id = g.id AND ge.ended_at IS NULL
                 ORDER BY ge.started_at DESC LIMIT 1) p ON TRUE
          WHERE NOT g.is_deleted
          ORDER BY g.name`)).rows;

    const unassigned = (await query(
        `SELECT a.id, a.inventory_number, a.status, g.name AS group_name
           FROM animal a
           LEFT JOIN animal_group g ON g.id = a.group_id
          WHERE NOT a.is_deleted
            AND a.status NOT IN ('ВЫБРАКОВАНО', 'ПАДЁЖ', 'ПРОДАН')
            AND NOT EXISTS (SELECT 1 FROM animal_assignment aa
                             WHERE aa.animal_id = a.id AND aa.ended_at IS NULL)
          ORDER BY a.inventory_number
          LIMIT 100`)).rows;

    const employees = (await query(
        `SELECT e.id, e.full_name, p.name AS position_name,
                (SELECT count(*)::int FROM animal_assignment aa
                  WHERE aa.employee_id = e.id AND aa.ended_at IS NULL) AS assigned
           FROM employee e
           LEFT JOIN position p ON p.id = e.position_id
          WHERE e.is_active AND NOT e.is_deleted
          ORDER BY assigned DESC, e.full_name
          LIMIT 100`)).rows;

    const stats = (await query(
        `SELECT (SELECT count(*)::int FROM animal_assignment WHERE ended_at IS NULL) AS assignments,
                (SELECT count(DISTINCT animal_id)::int FROM animal_assignment WHERE ended_at IS NULL) AS animals_covered,
                (SELECT count(*)::int FROM animal
                  WHERE NOT is_deleted
                    AND status NOT IN ('ВЫБРАКОВАНО','ПАДЁЖ','ПРОДАН')) AS animals_active`)).rows[0];

    return { groups, unassigned, employees, stats };
}

/** Разобрать тело запроса закрепления (общая валидация для двух роутеров). */
function parseAssignBody(body) {
    const animalId = asInt(body.animal_id);
    const employeeId = asInt(body.employee_id);
    if (animalId == null) throw httpError(400, 'animal_id: обязательно целое число');
    if (employeeId == null) throw httpError(400, 'employee_id: обязательно целое число');
    const roleCode = body.role_code ? String(body.role_code).toUpperCase() : 'HERDSMAN';
    const note = body.note == null ? null : String(body.note).slice(0, 200);
    return { animalId, employeeId, roleCode, note };
}

module.exports = {
    ROLES, listByEmployee, listByAnimal, assign, unassign,
    closeAllForEmployee, herdOverview, parseAssignBody,
};
