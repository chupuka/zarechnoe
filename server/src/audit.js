'use strict';

const { query } = require('./db');

/**
 * Запись в журнал бизнес-аудита (ТЗ п.7): кто/когда/что изменил (до/после),
 * IP/UA; DENY — зафиксированная попытка запрещённого действия (ТЗ п.9).
 *
 * Неделя 6: если middleware `requireOverrideReason` пометил запрос как действие
 * технической роли, `is_elevated`/`override_reason` подставляются автоматически —
 * ни один write-путь не может «забыть» причину. Явные аргументы имеют приоритет.
 *
 * Ошибка аудита не должна ронять запрос — логируем в консоль.
 */
async function writeAudit(req, { userId, entityName, entityId = 0, action, before = null, after = null, isElevated, reason, elevatedUser } = {}) {
    const ctx = (req && req.audit) || {};
    const elevatedFlag = isElevated !== undefined ? isElevated : !!ctx.isElevated;
    const overrideReason = reason !== undefined ? reason : (ctx.reason || null);
    try {
        await query(
            `INSERT INTO audit_log (user_id, entity_name, entity_id, action,
                                    before_json, after_json, ip, user_agent, is_elevated, override_reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                userId !== undefined ? userId : (req && req.user ? req.user.id : (elevatedUser || null)),
                entityName,
                entityId,
                action,
                before,
                after,
                (req && req.ip) || null,
                (req && req.headers ? req.headers['user-agent'] : null) || null,
                elevatedFlag,
                overrideReason,
            ]
        );
    } catch (err) {
        console.error('audit write failed:', err.message);
    }
}

/**
 * Запись в ТЕХНИЧЕСКИЙ лог (отдельно от бизнес-аудита, ТЗ п.7).
 * Используется действиями Администратора БД: бэкапы, миграции, обслуживание.
 */
async function writeTechLog(req, { actionType, description, details = null, adminUserId } = {}) {
    try {
        await query(
            `INSERT INTO tech_log (admin_user_id, action_type, description, details)
             VALUES ($1, $2, $3, $4)`,
            [adminUserId || (req && req.user ? req.user.id : null), actionType, description, details]
        );
    } catch (err) {
        console.error('tech log write failed:', err.message);
    }
}

module.exports = { writeAudit, writeTechLog };
