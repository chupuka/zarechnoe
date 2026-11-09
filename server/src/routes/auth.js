'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../db');
const { writeAudit } = require('../audit');
const { authenticate, sha256 } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

/**
 * POST /api/v1/auth/login — аутентификация (ТЗ п.7): bcrypt-сравнение,
 * учёт неудачных попыток и временная блокировка, токен в user_session (sha256).
 */
router.post('/login', async (req, res, next) => {
    try {
        const { login, password } = req.body || {};
        if (!login || !password || typeof login !== 'string' || typeof password !== 'string') {
            throw httpError(400, 'Укажите логин и пароль');
        }

        const { rows } = await query(
            `SELECT u.id, u.login, u.password_hash, u.full_name, u.employee_id,
                    u.is_active, u.is_deleted, u.failed_cnt, u.locked_until,
                    r.id AS role_id, r.code AS role_code, r.name AS role_name, r.role_type
             FROM app_user u
             JOIN role r ON r.id = u.role_id
             WHERE u.login = $1`,
            [login]
        );

        if (!rows.length) {
            // Неверный логин: аудировать некого (FK на app_user) — только лог
            console.warn(`login attempt for unknown user: ${login}`);
            throw httpError(401, 'Неверный логин или пароль');
        }
        const u = rows[0];

        if (u.locked_until && new Date(u.locked_until) > new Date()) {
            throw httpError(423, `Учётная запись заблокирована до ${new Date(u.locked_until).toISOString()}`);
        }
        if (!u.is_active || u.is_deleted) {
            throw httpError(401, 'Неверный логин или пароль');
        }

        const ok = await bcrypt.compare(password, u.password_hash);
        if (!ok) {
            const failed = u.failed_cnt + 1;
            await query(
                `UPDATE app_user
                    SET failed_cnt = $2::int,
                        locked_until = CASE WHEN $2::int >= $3::int
                                            THEN now() + ($4::text || ' minutes')::interval
                                            ELSE locked_until END
                  WHERE id = $1::bigint`,
                [u.id, failed, config.session.maxFailed, String(config.session.lockMinutes)]
            );
            await writeAudit(req, {
                userId: u.id,
                entityName: 'app_user',
                entityId: u.id,
                action: 'LOGIN',
                after: { result: 'denied', failed_cnt: failed },
            });
            throw httpError(401, 'Неверный логин или пароль');
        }

        // Успех: выдаём сессионный токен (в БД — только sha256-хэш)
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + config.session.ttlHours * 3600 * 1000);
        await query(
            `INSERT INTO user_session (user_id, token_hash, ip, user_agent, issued_at, expires_at)
             VALUES ($1, $2, $3, $4, now(), $5)`,
            [u.id, sha256(token), req.ip || null, req.headers['user-agent'] || null, expiresAt]
        );
        await query(
            `UPDATE app_user SET failed_cnt = 0, last_login_at = now() WHERE id = $1`,
            [u.id]
        );

        const perms = await query(
            `SELECT p.code FROM role_permission rp
             JOIN permission p ON p.id = rp.permission_id
             WHERE rp.role_id = $1 ORDER BY p.code`,
            [u.role_id]
        );
        await writeAudit(req, {
            userId: u.id,
            entityName: 'app_user',
            entityId: u.id,
            action: 'LOGIN',
            after: { result: 'ok' },
        });

        res.json({
            token,
            expires_at: expiresAt.toISOString(),
            user: {
                id: u.id,
                login: u.login,
                full_name: u.full_name,
                employee_id: u.employee_id,
                role: { code: u.role_code, name: u.role_name, type: u.role_type },
                permissions: perms.rows.map((r) => r.code),
            },
        });
    } catch (err) {
        next(err);
    }
});

/** GET /api/v1/auth/me — текущий пользователь и его права */
router.get('/me', authenticate, (req, res) => {
    res.json({
        id: req.user.id,
        login: req.user.login,
        full_name: req.user.full_name,
        employee_id: req.user.employee_id,
        role: req.user.role,
        permissions: [...req.user.permissions].sort(),
    });
});

/** POST /api/v1/auth/logout — отзыв собственной сессии */
router.post('/logout', authenticate, async (req, res, next) => {
    try {
        await query(`UPDATE user_session SET revoked_at = now() WHERE id = $1`, [req.user.sessionId]);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
