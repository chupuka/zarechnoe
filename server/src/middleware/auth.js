'use strict';

const crypto = require('crypto');
const { query } = require('../db');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Аутентификация по Bearer-токену: токен хранится в user_session только в виде
 * sha256-хэша (ТЗ: безопасные токены), права роли загружаются из role_permission
 * на каждый запрос (серверная авторизация, не «скрытие кнопки»).
 */
async function authenticate(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
        if (!token) {
            return res.status(401).json({ error: 'Требуется авторизация (Bearer-токен)' });
        }

        const { rows } = await query(
            `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.last_seen_at,
                    u.id, u.login, u.full_name, u.employee_id, u.is_active, u.is_deleted,
                    r.id AS role_id, r.code AS role_code, r.name AS role_name, r.role_type
             FROM user_session s
             JOIN app_user u ON u.id = s.user_id
             JOIN role r ON r.id = u.role_id
             WHERE s.token_hash = $1`,
            [sha256(token)]
        );
        if (!rows.length) {
            return res.status(401).json({ error: 'Неверный или отозванный токен' });
        }
        const s = rows[0];
        if (s.revoked_at) {
            return res.status(401).json({ error: 'Сессия отозвана' });
        }
        if (new Date(s.expires_at) < new Date()) {
            return res.status(401).json({ error: 'Сессия истекла' });
        }
        if (!s.is_active || s.is_deleted) {
            return res.status(401).json({ error: 'Учётная запись неактивна' });
        }

        const perms = await query(
            `SELECT p.code FROM role_permission rp
             JOIN permission p ON p.id = rp.permission_id
             WHERE rp.role_id = $1`,
            [s.role_id]
        );

        // Отметка активности для индикатора «онлайн» (см. v_user_overview /
        // v_employee_overview: онлайн = активность за последние 15 минут).
        // Обновляем не чаще раза в минуту, чтобы не писать в БД на каждый запрос.
        const seen = new Date(s.last_seen_at || 0).getTime();
        if (!seen || Date.now() - seen > 60000) {
            query('UPDATE user_session SET last_seen_at = now() WHERE id = $1', [s.session_id])
                .catch((err) => console.error('last_seen update:', err.message));
        }

        req.user = {
            id: s.id,
            login: s.login,
            full_name: s.full_name,
            employee_id: s.employee_id,
            role: { id: s.role_id, code: s.role_code, name: s.role_name, type: s.role_type },
            permissions: new Set(perms.rows.map((r) => r.code)),
            sessionId: s.session_id,
            token,
        };
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = { authenticate, sha256 };
