'use strict';

/**
 * Усиленный аудит действий технических ролей (Неделя 6, ТЗ п.7).
 *
 * Технические роли (SUPERUSER, DBA) логически отделены от бизнес-ролей и не должны
 * использоваться для повседневных операций. Любое их действие, обходящее обычные
 * бизнес-правила, обязано иметь ЯВНУЮ ПРИЧИНУ:
 *   - заголовок `X-Override-Reason` (непустая строка, ≤ 500 символов);
 *   - в audit_log пишется is_elevated = TRUE и override_reason = <причина>.
 *
 * CHECK в БД: `NOT is_elevated OR override_reason IS NOT NULL` — страховка на
 * уровне СУБД. Без причины запрос техроли отклоняется (428 Precondition Required).
 *
 * Бизнес-роли middleware пропускает без дополнительных требований.
 */

const { httpError } = require('../validation');

const HEADER = 'x-override-reason';
const MAX_LEN = 500;

/** Пометить запрос как «усиленный» и проверить причину для TECHNICAL-роли. */
function requireOverrideReason(req, res, next) {
    try {
        const isTechnical = req.user && req.user.role && req.user.role.type === 'TECHNICAL';
        if (!isTechnical) {
            req.audit = { isElevated: false, reason: null };
            return next();
        }
        const raw = req.headers[HEADER];
        const reason = typeof raw === 'string' ? raw.trim() : '';
        if (!reason) {
            throw httpError(428, `Действие технической роли требует заголовок ${HEADER} (причина обязательна)`);
        }
        if (reason.length > MAX_LEN) {
            throw httpError(400, `${HEADER}: не более ${MAX_LEN} символов`);
        }
        req.audit = { isElevated: true, reason };
        next();
    } catch (err) { next(err); }
}

/** Вспомогательная обёртка: проверить право + (для техролей) причину. */
function elevated(code, entityName) {
    const { requirePermission } = require('./rbac');
    const check = requirePermission(code, entityName);
    return async (req, res, next) => {
        // Сначала RBAC, затем причина (чтобы DENY не засорялся 428-ми).
        return check(req, res, (err) => {
            if (err) return next(err);
            return requireOverrideReason(req, res, next);
        });
    };
}

module.exports = { requireOverrideReason, elevated, HEADER, MAX_LEN };
