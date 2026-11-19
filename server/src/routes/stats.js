'use strict';

/**
 * Статистика для страниц — /api/v1/stats.
 *
 * GET /stats/:section — карточки показателей для конкретного экрана
 * (main, animals, employees, users, audit, backups, pasture, stock, tasks).
 * GET /stats — какие разделы доступны текущей роли (для навигации).
 *
 * Доступ проверяется внутри stats.build по правам раздела (animal:READ,
 * employee:READ, user:READ, audit:READ, backup:READ, stock:READ, task:READ):
 * отдельного права stats:READ в матрице ролей нет намеренно — статистика
 * не новая сущность, а срез уже разрешённых данных.
 */

const express = require('express');
const stats = require('../stats');

const router = express.Router();

/** GET /stats — доступные разделы статистики для текущего пользователя. */
router.get('/', (req, res) => {
    res.json({ data: { sections: stats.availableSections(req.user) } });
});

/** GET /stats/:section — карточки раздела. */
router.get('/:section', async (req, res, next) => {
    try {
        const section = String(req.params.section || '').trim();
        const data = await stats.build(section, req.user);
        res.json({ data });
    } catch (err) { next(err); }
});

module.exports = router;
