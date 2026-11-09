'use strict';

const { writeAudit } = require('../audit');

/**
 * Серверная RBAC-проверка по матрице role_permission (ТЗ п.1, п.7):
 * клиентское «скрыть кнопку» недостаточно — каждый запрос проверяется здесь.
 * Запрещённые вызовы: корректный 403 + запись в аудит с action='DENY' (ТЗ п.9).
 */
function requirePermission(code, entityName) {
    return async (req, res, next) => {
        if (!req.user || !req.user.permissions.has(code)) {
            await writeAudit(req, {
                entityName: entityName || 'api',
                entityId: Number(req.params.id) || 0,
                action: 'DENY',
                after: { required_permission: code, path: req.method + ' ' + req.originalUrl },
            });
            return res.status(403).json({
                error: `Недостаточно прав: требуется ${code}`,
                kind: 'forbidden',
            });
        }
        next();
    };
}

module.exports = { requirePermission };
