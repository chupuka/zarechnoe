'use strict';

/** Централизованный обработчик ошибок: коды PostgreSQL → HTTP-ответы. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    // Ошибки бизнес-правил (RAISE EXCEPTION в процедурах/триггерах) — 400
    if (err.code === 'P0001') {
        return res.status(400).json({ error: err.message, kind: 'business_rule' });
    }
    switch (err.code) {
        case '23505': // нарушение уникальности
            return res.status(409).json({
                error: 'Конфликт: запись с такими реквизитами уже существует',
                kind: 'conflict',
                detail: err.detail,
            });
        case '23503': // внешний ключ
            return res.status(400).json({
                error: 'Ссылка на несуществующую или недопустимую запись',
                kind: 'foreign_key',
                detail: err.detail,
            });
        case '23514': // CHECK
            return res.status(400).json({
                error: 'Нарушено ограничение целостности данных',
                kind: 'check_violation',
                detail: err.detail,
            });
        case '22P02': // неверный синтаксис типа
        case '22007': // некорректная дата
        case '22008':
            return res.status(400).json({ error: 'Некорректный формат данных', kind: 'invalid_input' });
        case '42P01': // нет таблицы
            return res.status(500).json({ error: 'Ошибка схемы БД', kind: 'server' });
        default:
            break;
    }
    if (err.status) {
        return res.status(err.status).json({ error: err.message });
    }
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера', kind: 'server' });
}

/** 404 для неизвестных маршрутов API */
function notFound(req, res) {
    res.status(404).json({ error: `Маршрут не найден: ${req.method} ${req.originalUrl}` });
}

module.exports = { errorHandler, notFound };
