'use strict';

/**
 * Бизнес-админка (Неделя 6) — /api/v1/admin.
 *
 * Управление пользователями, ролями, правами и настройками хозяйства,
 * а также журналы (бизнес-аудит, сессии, уведомления).
 *
 * Разделение с технадминкой (routes/tech.js): здесь ТОЛЬКО бизнес-контур.
 * Технические роли при изменении обязаны передать X-Override-Reason
 * (middleware elevated) — запись уйдёт в audit_log с is_elevated = TRUE.
 *
 * Пароли — только bcrypt-хэш; password_hash никуда не отдаётся.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { elevated } = require('../middleware/elevated');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const BCRYPT_ROUNDS = 10;
const PW_RE = /^(?=.*[A-ZА-ЯЁ])(?=.*\d).{8,}$/;

/**
 * Сгенерировать временный пароль, который проходит политику PW_RE
 * (≥8 символов, заглавная буква, цифра). Символы, похожие на 0/O/1/l,
 * исключены: пароль диктуют голосом и переписывают с экрана.
 */
function generatePassword(length = 12) {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const special = '!@#$%&*';
    const all = upper + lower + digits + special;
    const pick = (set) => set[crypto.randomInt(set.length)];
    const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
    while (chars.length < length) chars.push(pick(all));
    // Перемешать (Fisher–Yates), чтобы заглавная не всегда была первой.
    for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = crypto.randomInt(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

// ============================================================================
// Роли и права (справочники RBAC)
// ============================================================================

/** GET /admin/roles — роли с числом прав и пользователей */
router.get('/roles', requirePermission('user:READ', 'role'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT r.id, r.code, r.name, r.role_type, r.is_active,
                    (SELECT count(*) FROM role_permission rp WHERE rp.role_id = r.id) AS permission_count,
                    (SELECT count(*) FROM app_user u WHERE u.role_id = r.id AND NOT u.is_deleted) AS user_count
             FROM role r ORDER BY r.id`);
        res.json({ data: rows, total: rows.length });
    } catch (err) { next(err); }
});

/** GET /admin/roles/:id — роль + её права */
router.get('/roles/:id', requirePermission('user:READ', 'role'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const r = await query('SELECT id, code, name, role_type, is_active FROM role WHERE id = $1', [id]);
        if (!r.rows.length) throw httpError(404, 'Роль не найдена');
        const p = await query(
            `SELECT p.id, p.code, p.object_name, p.action, p.description
             FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
             WHERE rp.role_id = $1 ORDER BY p.code`, [id]);
        res.json({ data: { ...r.rows[0], permissions: p.rows } });
    } catch (err) { next(err); }
});

/** GET /admin/permissions — каталог прав (матрица Роль × Право) */
router.get('/permissions', requirePermission('user:READ', 'permission'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const q = String(req.query.q || '').trim();
        const where = [];
        const params = [];
        if (q) {
            where.push(`(code ILIKE '%' || $1::text || '%' OR object_name ILIKE '%' || $1::text || '%')`);
            params.push(q);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT id, code, object_name, action, description, COUNT(*) OVER() AS total
             FROM permission ${whereSql} ORDER BY code ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

// ============================================================================
// Пользователи
// ============================================================================

const USER_COLS = `u.id, u.login, u.full_name, u.role_id, u.role_code, u.role_name,
                   u.employee_id, u.employee_name, u.is_active, u.is_deleted, u.must_change_pw,
                   u.failed_cnt, u.locked_until, u.last_login_at,
                   u.blocked_reason, u.blocked_at, u.delete_reason, u.deleted_at,
                   u.sessions_count, u.is_online, u.last_seen_at`;
const USER_FROM = 'FROM v_user_overview u';
const USER_SORTS = new Set(['id', 'login', 'full_name', 'last_login_at', 'is_active',
                            'sessions_count', 'last_seen_at']);

const USER_CREATE = {
    login: { type: 'string', required: true, max: 64, pattern: /^[A-Za-z0-9._-]{3,64}$/ },
    password: { type: 'string', required: true, min: 8, pattern: PW_RE,
                message: 'password: минимум 8 символов, хотя бы 1 заглавная и 1 цифра' },
    full_name: { type: 'string', required: true, max: 120 },
    role_id: { type: 'int', required: true },
    employee_id: { type: 'int', nullable: true },
    must_change_pw: { type: 'boolean' },
};
const USER_PATCH = {
    full_name: { type: 'string', max: 120 },
    role_id: { type: 'int' },
    employee_id: { type: 'int', nullable: true },
    is_active: { type: 'boolean' },
    must_change_pw: { type: 'boolean' },
    login: { type: 'reject', message: 'Логин не изменяется (создайте новую учётную запись)' },
    password_hash: { type: 'reject', message: 'Пароль меняется через /admin/users/:id/reset-password' },
    failed_cnt: { type: 'reject', message: 'failed_cnt меняется через /admin/users/:id/unlock' },
    locked_until: { type: 'reject', message: 'locked_until меняется через /admin/users/:id/unlock' },
    is_deleted: { type: 'reject', message: 'Удаление — через DELETE /admin/users/:id' },
};
const PASSWORD_SPECS = {
    password: { type: 'string', required: true, min: 8, pattern: PW_RE,
                message: 'password: минимум 8 символов, хотя бы 1 заглавная и 1 цифра' },
};

async function ensureRole(id) {
    const { rows } = await query('SELECT id FROM role WHERE id = $1', [id]);
    if (!rows.length) throw httpError(400, `Роль ${id} не найдена`);
}
async function ensureEmployee(id) {
    if (id == null) return;
    const { rows } = await query('SELECT id FROM employee WHERE id = $1 AND NOT is_deleted', [id]);
    if (!rows.length) throw httpError(400, `Сотрудник ${id} не найден`);
}

/** GET /admin/users — реестр учётных записей (без хэшей паролей) */
router.get('/users', requirePermission('user:READ', 'app_user'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query, USER_SORTS, 'login');
        const q = String(req.query.q || '').trim();
        const roleId = asInt(req.query.role_id) || 0;
        const includeDeleted = req.query.include_deleted === 'true';
        const state = String(req.query.state || '').trim(); // active | blocked | locked | online
        const where = [];
        const params = [];
        where.push(`($${params.length + 1}::boolean OR NOT u.is_deleted)`); params.push(includeDeleted);
        if (q) {
            where.push(`(u.login ILIKE '%' || $${params.length + 1}::text || '%'
                        OR u.full_name ILIKE '%' || $${params.length + 1}::text || '%'
                        OR COALESCE(u.employee_name, '') ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (roleId) { where.push(`u.role_id = $${params.length + 1}::int`); params.push(roleId); }
        if (state === 'active') where.push('u.is_active');
        if (state === 'blocked') where.push('NOT u.is_active');
        if (state === 'locked') where.push('u.locked_until IS NOT NULL AND u.locked_until > now()');
        if (state === 'online') where.push('u.is_online');
        if (state === 'no_password_change') where.push('u.must_change_pw');
        const { rows } = await query(
            `SELECT ${USER_COLS}, COUNT(*) OVER() AS total ${USER_FROM}
             WHERE ${where.join(' AND ')}
             ORDER BY u.${sort} ${desc ? 'DESC' : 'ASC'} NULLS LAST, u.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /admin/users/:id */
router.get('/users/:id', requirePermission('user:READ', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(`SELECT ${USER_COLS} ${USER_FROM} WHERE u.id = $1`, [id]);
        if (!rows.length) throw httpError(404, 'Пользователь не найден');
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** POST /admin/users — создать учётную запись (bcrypt-хэш) */
router.post('/users', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, USER_CREATE);
        await ensureRole(v.role_id);
        await ensureEmployee(v.employee_id);
        const hash = await bcrypt.hash(v.password, BCRYPT_ROUNDS);
        const { rows } = await query(
            `INSERT INTO app_user (login, password_hash, full_name, role_id, employee_id, must_change_pw)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, login, full_name, role_id, employee_id, is_active, must_change_pw`,
            [v.login, hash, v.full_name, v.role_id, v.employee_id ?? null, v.must_change_pw ?? true]);
        await writeAudit(req, { entityName: 'app_user', entityId: rows[0].id, action: 'CREATE', after: rows[0] });
        res.status(201).json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** PATCH /admin/users/:id — изменить реквизиты */
router.patch('/users/:id', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, USER_PATCH, { partial: true });
        const keys = Object.keys(v);
        if (!keys.length) throw httpError(400, 'Нет полей для изменения');
        if (v.role_id !== undefined) await ensureRole(v.role_id);
        if (v.employee_id !== undefined) await ensureEmployee(v.employee_id);

        const row = await withTransaction(async (client) => {
            const cur = await client.query(
                'SELECT * FROM app_user WHERE id = $1 AND NOT is_deleted FOR UPDATE', [id]);
            if (!cur.rows.length) throw httpError(404, 'Пользователь не найден');
            const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
            const upd = await client.query(
                `UPDATE app_user SET ${sets} WHERE id = $1 RETURNING *`,
                [id, ...keys.map((k) => v[k])]);
            return { before: cur.rows[0], after: upd.rows[0] };
        });
        const pick = (o) => Object.fromEntries(keys.map((k) => [k, o[k]]));
        await writeAudit(req, { entityName: 'app_user', entityId: id, action: 'UPDATE',
                                before: pick(row.before), after: pick(row.after) });
        const { password_hash: _h, ...safe } = row.after;
        res.json({ data: safe });
    } catch (err) { next(err); }
});

/** POST /admin/users/:id/reset-password — смена пароля */
router.post('/users/:id/reset-password', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, PASSWORD_SPECS);
        const hash = await bcrypt.hash(v.password, BCRYPT_ROUNDS);
        const { rows } = await query(
            `UPDATE app_user SET password_hash = $2, must_change_pw = TRUE, failed_cnt = 0, locked_until = NULL
             WHERE id = $1 AND NOT is_deleted RETURNING id, login`, [id, hash]);
        if (!rows.length) throw httpError(404, 'Пользователь не найден');
        await writeAudit(req, { entityName: 'app_user', entityId: id, action: 'UPDATE',
                                after: { password: '***', must_change_pw: true } });
        res.json({ data: rows[0], message: 'Пароль изменён; при следующем входе потребуется смена' });
    } catch (err) { next(err); }
});

/** POST /admin/users/:id/unlock — снять временную блокировку */
router.post('/users/:id/unlock', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `UPDATE app_user SET failed_cnt = 0, locked_until = NULL
             WHERE id = $1 AND NOT is_deleted RETURNING id, login`, [id]);
        if (!rows.length) throw httpError(404, 'Пользователь не найден');
        await writeAudit(req, { entityName: 'app_user', entityId: id, action: 'UPDATE',
                                after: { failed_cnt: 0, locked_until: null } });
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/**
 * POST /admin/users/:id/block — заблокировать учётную запись.
 * Причина обязательна (и на уровне API, и CHECK-ограничением в БД), сессии
 * отзываются сразу: «заблокирован» означает «прямо сейчас не работает».
 */
router.post('/users/:id/block', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        if (id === req.user.id) throw httpError(400, 'Нельзя заблокировать собственную учётную запись');
        const v = validate(req.body || {}, {
            reason: { type: 'string', required: true, min: 3, max: 500 },
        });
        const row = await withTransaction(async (client) => {
            const cur = await client.query(
                'SELECT id, login, is_active FROM app_user WHERE id = $1 AND NOT is_deleted FOR UPDATE', [id]);
            if (!cur.rows.length) throw httpError(404, 'Пользователь не найден');
            if (!cur.rows[0].is_active) throw httpError(400, 'Учётная запись уже заблокирована');
            const upd = await client.query(
                `UPDATE app_user SET is_active = FALSE, blocked_reason = $2,
                        blocked_at = now(), blocked_by = $3,
                        failed_cnt = 0, locked_until = NULL
                  WHERE id = $1 RETURNING id, login, is_active, blocked_reason, blocked_at`,
                [id, v.reason, req.user.id]);
            const ses = await client.query(
                `UPDATE user_session SET revoked_at = now()
                  WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`, [id]);
            return { user: upd.rows[0], revoked: ses.rowCount };
        });
        await writeAudit(req, {
            entityName: 'app_user', entityId: id, action: 'UPDATE',
            before: { is_active: true },
            after: { is_active: false, blocked_reason: v.reason, sessions_revoked: row.revoked },
        });
        res.json({ data: { ...row.user, sessions_revoked: row.revoked } });
    } catch (err) { next(err); }
});

/** POST /admin/users/:id/unblock — вернуть доступ (причина тоже обязательна). */
router.post('/users/:id/unblock', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, {
            reason: { type: 'string', required: true, min: 3, max: 500 },
        });
        const { rows } = await query(
            `UPDATE app_user SET is_active = TRUE, blocked_reason = NULL, blocked_at = NULL,
                    blocked_by = NULL, failed_cnt = 0, locked_until = NULL
              WHERE id = $1 AND NOT is_deleted AND NOT is_active
              RETURNING id, login, is_active`,
            [id]);
        if (!rows.length) throw httpError(404, 'Заблокированная учётная запись не найдена');
        await writeAudit(req, {
            entityName: 'app_user', entityId: id, action: 'UPDATE',
            before: { is_active: false }, after: { is_active: true, reason: v.reason },
        });
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/**
 * POST /admin/users/:id/generate-password — сгенерировать временный пароль.
 * Пароль показывается один раз в ответе и не сохраняется в аудите: запись
 * содержит только факт выдачи. Пользователь обязан сменить его при входе.
 */
router.post('/users/:id/generate-password', elevated('user:WRITE', 'app_user'),
    async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const password = generatePassword();
            const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
            const { rows } = await query(
                `UPDATE app_user SET password_hash = $2, must_change_pw = TRUE,
                        failed_cnt = 0, locked_until = NULL
                  WHERE id = $1 AND NOT is_deleted
                  RETURNING id, login, full_name`, [id, hash]);
            if (!rows.length) throw httpError(404, 'Пользователь не найден');
            await writeAudit(req, {
                entityName: 'app_user', entityId: id, action: 'UPDATE',
                after: { password: '***', generated: true, must_change_pw: true },
            });
            res.json({
                data: { ...rows[0], password, must_change_pw: true },
                message: 'Пароль сгенерирован. Передайте его сотруднику безопасным каналом — он больше не будет показан.',
            });
        } catch (err) { next(err); }
    });

/**
 * GET /admin/users/:id/sessions — сессии конкретного пользователя.
 */
router.get('/users/:id/sessions', requirePermission('user:READ', 'user_session'),
    async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const activeOnly = req.query.active_only !== 'false';
            const { rows } = await query(
                `SELECT s.id, s.ip::text AS ip, s.user_agent, s.issued_at, s.expires_at,
                        s.revoked_at, s.last_seen_at,
                        (s.revoked_at IS NULL AND s.expires_at > now()) AS is_active
                   FROM user_session s WHERE s.user_id = $1
                   ${activeOnly ? 'AND s.revoked_at IS NULL AND s.expires_at > now()' : ''}
                  ORDER BY s.issued_at DESC LIMIT 100`, [id]);
            res.json({ data: rows, total: rows.length });
        } catch (err) { next(err); }
    });

/** POST /admin/users/:id/revoke-sessions — завершить все сессии пользователя. */
router.post('/users/:id/revoke-sessions', elevated('user:WRITE', 'user_session'),
    async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const { rows } = await query(
                `UPDATE user_session SET revoked_at = now()
                  WHERE user_id = $1 AND revoked_at IS NULL
                  RETURNING id`, [id]);
            await writeAudit(req, {
                entityName: 'user_session', entityId: id, action: 'DELETE',
                before: { sessions: rows.length },
            });
            res.json({ data: { user_id: id, revoked: rows.length } });
        } catch (err) { next(err); }
    });

/** DELETE /admin/users/:id — мягкое удаление с причиной + отзыв сессий (атомарно) */
router.delete('/users/:id', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        if (id === req.user.id) throw httpError(400, 'Нельзя удалить собственную учётную запись');
        const v = validate(req.body || {}, {
            reason: { type: 'string', required: true, min: 3, max: 500 },
        });
        const row = await withTransaction(async (client) => {
            const upd = await client.query(
                `UPDATE app_user SET is_deleted = TRUE, is_active = FALSE,
                        delete_reason = $2, deleted_at = now(),
                        blocked_reason = COALESCE(blocked_reason, $2)
                  WHERE id = $1 AND NOT is_deleted
                  RETURNING id, login`, [id, v.reason]);
            if (!upd.rows.length) throw httpError(404, 'Пользователь не найден');
            const ses = await client.query(
                `UPDATE user_session SET revoked_at = now()
                 WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
            return { user: upd.rows[0], revoked: ses.rowCount };
        });
        await writeAudit(req, { entityName: 'app_user', entityId: id, action: 'DELETE',
                                before: row.user, after: { reason: v.reason, sessions_revoked: row.revoked } });
        res.json({ data: { id, is_deleted: true, sessions_revoked: row.revoked } });
    } catch (err) { next(err); }
});

// ============================================================================
// Матрица прав роли (управление доступом из интерфейса)
// ============================================================================

/** GET /admin/roles/:id/permissions — права роли в виде { granted: [...], all: [...] } */
router.get('/roles/:id/permissions', requirePermission('user:READ', 'role'),
    async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const role = await query('SELECT id, code, name, role_type FROM role WHERE id = $1', [id]);
            if (!role.rows.length) throw httpError(404, 'Роль не найдена');
            const all = (await query(
                'SELECT id, code, object_name, action, description FROM permission ORDER BY code')).rows;
            const granted = new Set((await query(
                'SELECT permission_id FROM role_permission WHERE role_id = $1', [id]))
                .rows.map((r) => Number(r.permission_id)));
            res.json({
                data: {
                    role: role.rows[0],
                    all,
                    granted: all.filter((p) => granted.has(Number(p.id))).map((p) => p.id),
                },
            });
        } catch (err) { next(err); }
    });

/**
 * PUT /admin/roles/:id/permissions — заменить набор прав роли.
 * Тело: { permission_ids: [1,2,3], reason?: '...' }.
 * Ограничение: роль DBA управляет только учётными записями (решение по проекту),
 * поэтому выдать ей бизнес-права нельзя даже через API.
 */
router.put('/roles/:id/permissions', elevated('user:WRITE', 'role'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, {
            permission_ids: { type: 'intArray', required: true },
            reason: { type: 'string', max: 500, nullable: true },
        });
        const role = await query('SELECT id, code FROM role WHERE id = $1', [id]);
        if (!role.rows.length) throw httpError(404, 'Роль не найдена');
        const codes = (await query(
            'SELECT id, code FROM permission WHERE id = ANY($1::bigint[])', [v.permission_ids])).rows;
        if (codes.length !== v.permission_ids.length) {
            throw httpError(400, 'Среди permission_ids есть несуществующие права');
        }
        if (role.rows[0].code === 'DBA') {
            // Администратор БД управляет учётными записями и техникой; бизнес-данные
            // (животные, сотрудники, склад, задачи…) он может только читать.
            const TECH_OBJECTS = new Set(['user', 'tech', 'dba', 'backup']);
            const forbidden = codes.filter((p) => {
                const [object, action] = String(p.code).split(':');
                if (TECH_OBJECTS.has(object)) return false;
                return action !== 'READ';
            });
            if (forbidden.length) {
                throw httpError(400,
                    'Роль DBA не ведёт бизнес-данные: допустимы только чтение бизнес-объектов и полные права на user/tech/dba/backup. '
                    + `Лишние права: ${forbidden.map((p) => p.code).join(', ')}`);
            }
        }
        const before = (await query(
            `SELECT p.code FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
              WHERE rp.role_id = $1 ORDER BY p.code`, [id])).rows.map((r) => r.code);

        await withTransaction(async (client) => {
            await client.query('DELETE FROM role_permission WHERE role_id = $1', [id]);
            await client.query(
                `INSERT INTO role_permission (role_id, permission_id)
                 SELECT $1, unnest($2::bigint[])`, [id, v.permission_ids]);
        });
        await writeAudit(req, {
            entityName: 'role', entityId: id, action: 'UPDATE',
            before: { permissions: before },
            after: { permissions: codes.map((p) => p.code).sort(), reason: v.reason || null },
        });
        res.json({ data: { role_id: id, granted: codes.map((p) => p.code).sort() } });
    } catch (err) { next(err); }
});

// ============================================================================
// Настройки хозяйства
// ============================================================================

/** GET /admin/settings */
router.get('/settings', requirePermission('settings:READ', 'farm_settings'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT s.id, s.setting_key, s.value_type, s.value_text, s.value_num, s.description,
                    s.updated_at, u.login AS updated_by_login
             FROM farm_settings s JOIN app_user u ON u.id = s.updated_by
             ORDER BY s.setting_key`);
        res.json({ data: rows, total: rows.length });
    } catch (err) { next(err); }
});

/** PATCH /admin/settings/:key — изменение параметра (тип контролируется БД) */
router.patch('/settings/:key', elevated('settings:WRITE', 'farm_settings'), async (req, res, next) => {
    try {
        const key = String(req.params.key || '').trim();
        if (!key) throw httpError(400, 'Не указан ключ настройки');
        const v = validate(req.body || {}, {
            value: { type: 'string', required: false },
            description: { type: 'string', max: 500 },
        }, { partial: true });
        if (v.value === undefined && v.description === undefined) throw httpError(400, 'Нет полей для изменения');

        const cur = await query('SELECT * FROM farm_settings WHERE setting_key = $1 FOR UPDATE', [key]);
        if (!cur.rows.length) throw httpError(404, `Настройка «${key}» не найдена`);
        const s = cur.rows[0];
        let textVal = s.value_text;
        let numVal = s.value_num;
        if (v.value !== undefined) {
            if (s.value_type === 'NUM') {
                const n = Number(v.value);
                if (!Number.isFinite(n)) throw httpError(400, `Настройка «${key}» имеет тип NUM — ожидается число`);
                numVal = n; textVal = null;
            } else {
                if (s.value_type === 'BOOL' && !['true', 'false', '1', '0'].includes(v.value.toLowerCase())) {
                    throw httpError(400, `Настройка «${key}» имеет тип BOOL — ожидается true/false`);
                }
                if (s.value_type === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(v.value)) {
                    throw httpError(400, `Настройка «${key}» имеет тип DATE — ожидается ГГГГ-ММ-ДД`);
                }
                textVal = v.value; numVal = null;
            }
        }
        const sets = ['value_text = $2', 'value_num = $3', 'updated_by = $4', 'updated_at = now()'];
        const params = [key, textVal, numVal, req.user.id];
        if (v.description !== undefined) { sets.push(`description = $${params.length + 1}`); params.push(v.description); }
        const upd = await query(
            `UPDATE farm_settings SET ${sets.join(', ')} WHERE setting_key = $1 RETURNING *`, params);
        await writeAudit(req, { entityName: 'farm_settings', entityId: upd.rows[0].id, action: 'UPDATE',
                                before: { value_text: s.value_text, value_num: s.value_num },
                                after: { value_text: textVal, value_num: numVal } });
        res.json({ data: upd.rows[0] });
    } catch (err) { next(err); }
});

// ============================================================================
// Журналы и уведомления
// ============================================================================

/** Категории журнала: быстрые срезы вместо ручного набора фильтров. */
const AUDIT_CATEGORIES = {
    // некорректные/подозрительные действия — то, что проверяет аудитор
    violations: `(a.action = 'DENY' OR a.is_elevated OR a.action = 'READ_PII')`,
    // работа с персональными данными
    pii: `a.entity_name = 'employee_pii'`,
    // изменения данных (без чтений и отказов)
    changes: `a.action IN ('CREATE', 'UPDATE', 'DELETE')`,
    // вход/выход и работа с учётными записями
    auth: `a.entity_name IN ('app_user', 'user_session', 'auth')`,
    exports: `a.action = 'EXPORT'`,
};

/** Сборка WHERE для audit_log (переиспользуется списком и CSV-экспортом). */
function auditWhere(req) {
    const where = [];
    const params = [];
    const add = (sql, val) => { where.push(sql.replace('$N', `$${params.length + 1}`)); params.push(val); };
    const userId = asInt(req.query.user_id) || 0;
    const entity = String(req.query.entity_name || '').trim();
    const action = String(req.query.action || '').trim();
    const q = String(req.query.q || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const elevatedOnly = req.query.is_elevated === 'true';
    const category = String(req.query.category || '').trim();
    const violations = req.query.violations === 'true';
    if (userId) add('a.user_id = $N::int', userId);
    if (entity) add('a.entity_name = $N::text', entity);
    if (action) add('a.action = $N::text', action);
    if (q) add(`(a.override_reason ILIKE '%' || $N::text || '%'
                OR u.login ILIKE '%' || $N::text || '%'
                OR a.entity_name ILIKE '%' || $N::text || '%')`, q);
    if (dateFrom) add('a.occurred_at >= $N::timestamptz', dateFrom);
    if (dateTo) add('a.occurred_at < ($N::timestamptz + interval \'1 day\')', dateTo);
    if (elevatedOnly) where.push('a.is_elevated');
    if (violations) where.push(AUDIT_CATEGORIES.violations);
    if (category && AUDIT_CATEGORIES[category]) where.push(AUDIT_CATEGORIES[category]);
    return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const AUDIT_COLS = `a.id, a.occurred_at, a.user_id, u.login, u.full_name,
                    r.code AS role_code, a.entity_name, a.entity_id, a.action,
                    a.before_json, a.after_json, a.ip::text AS ip, a.user_agent,
                    a.is_elevated, a.override_reason`;
const AUDIT_FROM = `FROM audit_log a
                    JOIN app_user u ON u.id = a.user_id
                    JOIN role r ON r.id = u.role_id`;

/** GET /admin/audit-log — журнал бизнес-аудита */
router.get('/audit-log', requirePermission('audit:READ', 'audit_log'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { whereSql, params } = auditWhere(req);
        const { rows } = await query(
            `SELECT ${AUDIT_COLS}, COUNT(*) OVER() AS total ${AUDIT_FROM} ${whereSql}
             ORDER BY a.occurred_at DESC, a.id DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /admin/audit-log/users — пользователи, встречающиеся в журнале (для фильтра). */
router.get('/audit-log/users', requirePermission('audit:READ', 'audit_log'),
    async (req, res, next) => {
        try {
            const { rows } = await query(
                `SELECT u.id, u.login, u.full_name, r.code AS role_code,
                        count(*)::int AS events,
                        count(*) FILTER (WHERE a.action = 'DENY')::int AS denies,
                        max(a.occurred_at) AS last_event_at
                   FROM audit_log a
                   JOIN app_user u ON u.id = a.user_id
                   JOIN role r ON r.id = u.role_id
                  GROUP BY u.id, u.login, u.full_name, r.code
                  ORDER BY denies DESC, events DESC`);
            res.json({ data: rows, total: rows.length });
        } catch (err) { next(err); }
    });

/**
 * GET /admin/audit-log/violations — сводка «некорректных действий» для панели
 * над журналом: отказы в доступе, действия с повышением прав, чтение ПДн.
 */
router.get('/audit-log/violations', requirePermission('audit:READ', 'audit_log'),
    async (req, res, next) => {
        try {
            const { rows } = await query(
                `SELECT
                    count(*) FILTER (WHERE action = 'DENY')::int AS denies,
                    count(*) FILTER (WHERE action = 'DENY'
                                       AND occurred_at > now() - interval '1 day')::int AS denies_day,
                    count(*) FILTER (WHERE is_elevated)::int AS elevated,
                    count(*) FILTER (WHERE action = 'READ_PII')::int AS pii_reads,
                    count(DISTINCT user_id) FILTER (WHERE action = 'DENY')::int AS deny_users,
                    max(occurred_at) FILTER (WHERE action = 'DENY') AS last_deny_at
                 FROM audit_log`);
            const top = await query(
                `SELECT u.login, u.full_name, count(*)::int AS denies
                   FROM audit_log a JOIN app_user u ON u.id = a.user_id
                  WHERE a.action = 'DENY'
                  GROUP BY u.login, u.full_name
                  ORDER BY denies DESC LIMIT 5`);
            res.json({ data: { ...rows[0], top_deny_users: top.rows } });
        } catch (err) { next(err); }
    });

/** CSV-экранирование (RFC 4180 + BOM для Excel). */
function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}

/** GET /admin/audit-log/export — выгрузка журнала в CSV */
router.get('/audit-log/export', requirePermission('export:EXEC', 'audit_log'), async (req, res, next) => {
    try {
        const { whereSql, params } = auditWhere(req);
        const { rows } = await query(
            `SELECT ${AUDIT_COLS} ${AUDIT_FROM} ${whereSql} ORDER BY a.occurred_at DESC, a.id DESC LIMIT 10000`, params);
        const head = ['id', 'occurred_at', 'login', 'full_name', 'role_code', 'entity_name',
                      'entity_id', 'action', 'before_json', 'after_json', 'ip', 'user_agent',
                      'is_elevated', 'override_reason'];
        const lines = [head.join(';')];
        for (const r of rows) lines.push(head.map((h) => csvCell(r[h])).join(';'));
        await writeAudit(req, { entityName: 'audit_log', entityId: 0, action: 'EXPORT',
                                after: { rows: rows.length, format: 'csv' } });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
        res.send('\uFEFF' + lines.join('\r\n'));
    } catch (err) { next(err); }
});

/** GET /admin/sessions — активные сессии (без token_hash) */
router.get('/sessions', requirePermission('user:READ', 'user_session'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const userId = asInt(req.query.user_id) || 0;
        const activeOnly = req.query.active_only !== 'false';
        const where = [];
        const params = [];
        if (userId) { where.push(`s.user_id = $${params.length + 1}::int`); params.push(userId); }
        if (activeOnly) where.push('s.revoked_at IS NULL AND s.expires_at > now()');
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT s.id, s.user_id, u.login, s.ip::text AS ip, s.user_agent,
                    s.issued_at, s.expires_at, s.revoked_at, COUNT(*) OVER() AS total
             FROM user_session s JOIN app_user u ON u.id = s.user_id
             ${whereSql} ORDER BY s.issued_at DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /admin/notifications — уведомления ТЕКУЩЕГО пользователя */
router.get('/notifications', async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const unreadOnly = req.query.unread_only === 'true';
        const where = ['n.user_id = $1'];
        const params = [req.user.id];
        if (unreadOnly) where.push('NOT n.is_read');
        const { rows } = await query(
            `SELECT n.id, n.type, n.message, n.related_entity, n.related_id,
                    n.is_read, n.created_at, COUNT(*) OVER() AS total
             FROM notification n WHERE ${where.join(' AND ')}
             ORDER BY n.created_at DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** PATCH /admin/notifications/:id/read — пометить прочитанным (только своё) */
router.patch('/notifications/:id/read', async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `UPDATE notification SET is_read = TRUE WHERE id = $1 AND user_id = $2
             RETURNING id, is_read`, [id, req.user.id]);
        if (!rows.length) throw httpError(404, 'Уведомление не найдено');
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

module.exports = router;
