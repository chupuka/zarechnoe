'use strict';

/**
 * Слой серверной валидации (Неделя 5).
 *
 * Декларативная проверка входящих JSON-тел: вместо дублирования if-проверок
 * в каждом маршруте описывается схема полей (тип, обязательность, enum,
 * диапазон, паттерн, nullable), а `validate()` возвращает «чистый» объект
 * только с разрешёнными полями. Неизвестные поля отклоняются (защита от
 * массового присвоения/мусора, ТЗ п.7).
 *
 * Клиентская валидация — дополнение; источник истины — здесь и в процедурах БД.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ошибка с HTTP-статусом (обрабатывается errorHandler'ом в middleware/errors.js). */
function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

/** Строгое целое из строки/числа; null/''/мусор -> null. */
function asInt(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
}

/** Десятичное число; null/''/мусор -> null. */
function asDecimal(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Является ли значение корректной датой ГГГГ-ММ-ДД. */
function isDateValid(v) {
    return typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
}

/** Сегодняшняя дата в виде ГГГГ-ММ-ДД (для проверок «не в будущем»). */
function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Привести значение одного поля по спецификации; при ошибке бросает 400.
 * Спецификация поля:
 *   type      — 'string' | 'int' | 'decimal' | 'date' | 'boolean' | 'enum' | 'intArray' | 'reject'
 *   required  — обязательно, если нет частичного режима (см. validate)
 *   nullable  — разрешает null (возвращается как null)
 *   values    — для 'enum': массив допустимых значений
 *   pattern   — RegExp для 'string'
 *   min/max   — длина (string) или границы числа (int/decimal)
 *   maxToday  — для 'date': запрет даты в будущем
 *   trim      — для 'string': тримить (по умолчанию true)
 *   default   — значение по умолчанию, если поле отсутствует
 *   message   — переопределение текста ошибки
 */
function coerce(name, val, spec) {
    const msg = (def) => spec.message || `${name}: ${def}`;
    switch (spec.type) {
        case 'reject':
            throw httpError(400, spec.message || `${name}: поле не редактируется`);
        case 'string': {
            if (typeof val !== 'string') throw httpError(400, msg('ожидается строка'));
            const s = spec.trim === false ? val : val.trim();
            if (spec.min !== undefined && s.length < spec.min) throw httpError(400, msg(`минимум ${spec.min} символов`));
            if (spec.max !== undefined && s.length > spec.max) throw httpError(400, msg(`максимум ${spec.max} символов`));
            if (spec.pattern && !spec.pattern.test(s)) throw httpError(400, msg('недопустимый формат'));
            return s;
        }
        case 'int': {
            const n = asInt(val);
            if (n === null) throw httpError(400, msg('ожидается целое число'));
            if (spec.min !== undefined && n < spec.min) throw httpError(400, msg(`не менее ${spec.min}`));
            if (spec.max !== undefined && n > spec.max) throw httpError(400, msg(`не более ${spec.max}`));
            return n;
        }
        case 'decimal': {
            const n = asDecimal(val);
            if (n === null) throw httpError(400, msg('ожидается число'));
            if (spec.min !== undefined && n < spec.min) throw httpError(400, msg(`не менее ${spec.min}`));
            if (spec.max !== undefined && n > spec.max) throw httpError(400, msg(`не более ${spec.max}`));
            return n;
        }
        case 'date': {
            if (!isDateValid(val)) throw httpError(400, msg('ожидается дата ГГГГ-ММ-ДД'));
            if (spec.maxToday && val > todayISO()) throw httpError(400, msg('дата не может быть в будущем'));
            return val;
        }
        case 'boolean': {
            if (typeof val !== 'boolean') throw httpError(400, msg('ожидается true/false'));
            return val;
        }
        case 'datetime': {
            if (typeof val !== 'string' || Number.isNaN(Date.parse(val))) {
                throw httpError(400, msg('ожидается ISO-дата/время'));
            }
            return val;
        }
        case 'enum': {
            if (!spec.values.includes(val)) {
                throw httpError(400, msg(`допустимые значения — ${spec.values.join(', ')}`));
            }
            return val;
        }
        case 'intArray': {
            if (!Array.isArray(val) || val.length === 0) throw httpError(400, msg('ожидается непустой массив'));
            return val.map((x) => {
                const n = asInt(x);
                if (n === null) throw httpError(400, msg('элементы должны быть целыми числами'));
                return n;
            });
        }
        default:
            throw new Error(`validation: неизвестный тип «${spec.type}» для поля ${name}`);
    }
}

/**
 * Проверить тело запроса по схеме `specs` (объект имя -> спецификация).
 * opts.partial — частичное обновление: required игнорируется, но присутствующие
 * поля валидируются. Возвращает объект только с разрешёнными полями.
 */
function validate(body, specs, opts = {}) {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw httpError(400, 'Тело запроса должно быть JSON-объектом');
    }
    const partial = !!opts.partial;
    for (const key of Object.keys(body)) {
        if (!(key in specs)) throw httpError(400, `Неизвестное поле: ${key}`);
    }
    const out = {};
    for (const [name, spec] of Object.entries(specs)) {
        if (body[name] === undefined) {
            if (spec.required && !partial) throw httpError(400, `${name}: обязательно`);
            if (spec.default !== undefined) out[name] = spec.default;
            continue;
        }
        if (body[name] === null) {
            if (spec.nullable) { out[name] = null; continue; }
            throw httpError(400, `${name}: не может быть null`);
        }
        out[name] = coerce(name, body[name], spec);
    }
    return out;
}

/** Разобрать limit/offset с ограничениями (пагинация реестров, ТЗ п.5). */
function parsePaging(query, opts = {}) {
    const limit = Math.min(Math.max(asInt(query.limit) || (opts.defaultLimit || 50), 1), opts.maxLimit || 200);
    const offset = Math.max(asInt(query.offset) || 0, 0);
    return { limit, offset };
}

/** Разобрать sort (поле с необязательным префиксом «-» = DESC). */
function parseSort(query, allowed, defaultField) {
    let sort = String(query.sort || defaultField);
    const desc = sort.startsWith('-');
    if (desc) sort = sort.slice(1);
    if (!allowed.has(sort)) throw httpError(400, `sort: недопустимое поле «${sort}»`);
    return { sort, desc };
}

module.exports = { httpError, asInt, asDecimal, isDateValid, DATE_RE, todayISO, validate, parsePaging, parseSort };
