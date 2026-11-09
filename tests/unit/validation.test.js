'use strict';

/** Unit-тесты слоя валидации (Неделя 9). node --test tests/unit/validation.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../../server/src/validation');

test('asInt: корректные целые и мусор', () => {
    assert.equal(v.asInt('42'), 42);
    assert.equal(v.asInt(7), 7);
    assert.equal(v.asInt('  '), null);
    assert.equal(v.asInt(''), null);
    assert.equal(v.asInt(null), null);
    assert.equal(v.asInt(undefined), null);
    assert.equal(v.asInt('3.5'), null);
    assert.equal(v.asInt('abc'), null);
});

test('asDecimal: числа и мусор', () => {
    assert.equal(v.asDecimal('0.5'), 0.5);
    assert.equal(v.asDecimal(3), 3);
    assert.equal(v.asDecimal('NaN'), null);
    assert.equal(v.asDecimal(''), null);
});

test('isDateValid: формат ГГГГ-ММ-ДД', () => {
    assert.equal(v.isDateValid('2026-11-09'), true);
    assert.equal(v.isDateValid('2026-13-01'), false);
    assert.equal(v.isDateValid('09.11.2026'), false);
    assert.equal(v.isDateValid(20261109), false);
});

test('validate: обязательные поля и unknown field', () => {
    const spec = { name: { type: 'string', required: true, max: 10 } };
    assert.deepEqual(v.validate({ name: '  ox  ' }, spec), { name: 'ox' });
    assert.throws(() => v.validate({}, spec), (e) => e.status === 400 && /обязательно/.test(e.message));
    assert.throws(() => v.validate({ name: 'x', extra: 1 }, spec),
        (e) => e.status === 400 && /Неизвестное поле: extra/.test(e.message));
});

test('validate: типы, enum, nullable, reject', () => {
    const spec = {
        sex: { type: 'enum', values: ['M', 'F'] },
        group_id: { type: 'int', nullable: true },
        status: { type: 'reject', message: 'статус только через /status' },
    };
    assert.deepEqual(v.validate({ sex: 'M', group_id: null }, spec),
        { sex: 'M', group_id: null });
    assert.throws(() => v.validate({ sex: 'X' }, spec), (e) => e.status === 400);
    assert.throws(() => v.validate({ status: 'ЗДОРОВ' }, spec),
        (e) => e.status === 400 && /статус только через/.test(e.message));
});

test('validate: partial-режим не требует поля, но валидирует переданные', () => {
    const spec = { name: { type: 'string', required: true, min: 2 } };
    assert.deepEqual(v.validate({}, spec, { partial: true }), {});
    assert.throws(() => v.validate({ name: 'a' }, spec, { partial: true }), (e) => e.status === 400);
});

test('validate: intArray, date maxToday, boolean, datetime', () => {
    const spec = {
        ids: { type: 'intArray' },
        birth: { type: 'date', maxToday: true },
        active: { type: 'boolean' },
        due: { type: 'datetime' },
    };
    assert.deepEqual(v.validate({ ids: ['1', '2'], active: true, due: '2026-11-09T12:00:00Z' }, spec),
        { ids: [1, 2], active: true, due: '2026-11-09T12:00:00Z' });
    assert.throws(() => v.validate({ ids: [] }, spec), (e) => e.status === 400);
    assert.throws(() => v.validate({ birth: '2999-01-01' }, spec), (e) => e.status === 400 && /будущем/.test(e.message));
    assert.throws(() => v.validate({ active: 'yes' }, spec), (e) => e.status === 400);
    assert.throws(() => v.validate({ due: 'не дата' }, spec), (e) => e.status === 400);
});

test('parsePaging / parseSort: границы и whitelist', () => {
    assert.deepEqual(v.parsePaging({ limit: '999', offset: '-5' }, { maxLimit: 200 }), { limit: 200, offset: 0 });
    assert.deepEqual(v.parseSort({ sort: '-name' }, new Set(['id', 'name']), 'id'), { sort: 'name', desc: true });
    assert.throws(() => v.parseSort({ sort: 'password_hash' }, new Set(['id', 'name']), 'id'),
        (e) => e.status === 400 && /недопустимое поле/.test(e.message));
});

test('httpError: статус и сообщение', () => {
    const e = v.httpError(409, 'дубликат');
    assert.equal(e.status, 409);
    assert.equal(e.message, 'дубликат');
});
