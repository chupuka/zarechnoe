'use strict';

/** Unit-тесты middleware RBAC / elevated / errors (Неделя 9). */
const test = require('node:test');
const assert = require('node:assert/strict');

// Подменяем модули БД/аудита ДО require тестируемых middleware.
const Module = require('node:module');
const origLoad = Module._load;
const auditCalls = [];
Module._load = function (request, parent, isMain) {
    if (request === '../audit' || request === '../../audit') {
        return { writeAudit: async (...a) => auditCalls.push(a), writeTechLog: async () => {} };
    }
    if (request === '../db' || request === '../../db' || request === './db') {
        return { query: async () => ({ rows: [] }), withTransaction: async (f) => f({ query: async () => ({ rows: [] }) }) };
    }
    return origLoad.apply(this, arguments);
};

const { requirePermission } = require('../../server/src/middleware/rbac');
const { requireOverrideReason, HEADER } = require('../../server/src/middleware/elevated');
const { errorHandler } = require('../../server/src/middleware/errors');
Module._load = origLoad;

function mockRes() {
    return {
        code: null, body: null,
        status(c) { this.code = c; return this; },
        json(b) { this.body = b; return this; },
    };
}
function mockReq(over = {}) {
    return {
        user: { id: 1, permissions: new Set(['animal:READ']) },
        params: {}, originalUrl: '/test', method: 'GET', ip: '127.0.0.1',
        headers: {}, ...over,
    };
}

test('requirePermission: есть право → next()', async () => {
    const req = mockReq();
    const res = mockRes();
    let called = false;
    await requirePermission('animal:READ', 'animal')(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(res.code, null);
});

test('requirePermission: нет права → 403 + DENY в аудите', async () => {
    auditCalls.length = 0;
    const req = mockReq();
    const res = mockRes();
    await requirePermission('animal:DELETE', 'animal')(req, res, () => { throw new Error('не должен вызываться'); });
    assert.equal(res.code, 403);
    assert.equal(res.body.kind, 'forbidden');
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0][1].action, 'DENY');
});

test('requireOverrideReason: бизнес-роль проходит без заголовка', async () => {
    const req = mockReq({ user: { id: 1, role: { type: 'BUSINESS' } } });
    let called = false;
    requireOverrideReason(req, mockRes(), () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.audit.isElevated, false);
});

test('requireOverrideReason: техроль без X-Override-Reason → ошибка 428', () => {
    const req = mockReq({ user: { id: 2, role: { type: 'TECHNICAL' } } });
    let err = null;
    requireOverrideReason(req, mockRes(), (e) => { err = e; });
    assert.ok(err, 'ошибка должна передаваться в next()');
    assert.equal(err.status, 428);
    assert.match(err.message, new RegExp(HEADER));
});

test('requireOverrideReason: техроль с причиной → isElevated', () => {
    const req = mockReq({ user: { id: 2, role: { type: 'TECHNICAL' } }, headers: { [HEADER]: '  Плановый бэкап  ' } });
    let called = false;
    requireOverrideReason(req, mockRes(), () => { called = true; });
    assert.equal(called, true);
    assert.equal(req.audit.isElevated, true);
    assert.equal(req.audit.reason, 'Плановый бэкап');
});

test('requireOverrideReason: причина > 500 → ошибка 400', () => {
    const req = mockReq({ user: { id: 2, role: { type: 'TECHNICAL' } }, headers: { [HEADER]: 'x'.repeat(501) } });
    let err = null;
    requireOverrideReason(req, mockRes(), (e) => { err = e; });
    assert.ok(err);
    assert.equal(err.status, 400);
});

test('errorHandler: SQLSTATE → HTTP-коды', () => {
    const cases = [
        ['P0001', 400, 'business_rule'], ['23505', 409, 'conflict'],
        ['23503', 400, 'foreign_key'], ['23514', 400, 'check_violation'],
        ['22P02', 400, 'invalid_input'], ['42P01', 500, 'server'],
    ];
    for (const [code, status, kind] of cases) {
        const res = mockRes();
        errorHandler({ code, message: 'm', detail: 'd', status: undefined }, mockReq(), res, () => {});
        assert.equal(res.code, status, code);
        assert.equal(res.body.kind, kind, code);
    }
    const res2 = mockRes();
    errorHandler({ message: 'x', status: 404 }, mockReq(), res2, () => {});
    assert.equal(res2.code, 404);
});
