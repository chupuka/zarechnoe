'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const { query } = require('./db');
const { authenticate } = require('./middleware/auth');
const { errorHandler, notFound } = require('./middleware/errors');
const authRoutes = require('./routes/auth');
const animalsRoutes = require('./routes/animals');
const employeesRoutes = require('./routes/employees');
const { registerCatalogs } = require('./routes/catalog');
const stockRoutes = require('./routes/stock');
const tasksRoutes = require('./routes/tasks');
const pasturesRoutes = require('./routes/pastures');
const adminRoutes = require('./routes/admin');
const techRoutes = require('./routes/tech');
const dbaRoutes = require('./routes/dba');
const reportsRoutes = require('./routes/reports');
const statsRoutes = require('./routes/stats');
const backupScheduler = require('./backupScheduler');
const openapi = require('./openapi.json');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// CORS: GitHub Pages (продакшен) и локальная разработка.
// Авторизация Bearer, cookie не используются — credentials не нужны.
const CORS_ORIGINS = new Set(['https://chupuka.github.io', 'http://localhost:3000']);
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Override-Reason');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
});

// Access-log (метод, путь, статус, длительность)
app.use((req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
        console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - t} ms)`);
    });
    next();
});

// ---- Публичные маршруты ----------------------------------------------------
app.get('/api/v1/health', async (req, res, next) => {
    try {
        const { rows } = await query('SELECT current_database() AS db, now() AS ts');
        res.json({ status: 'ok', db: 'up', database: rows[0].db, ts: rows[0].ts });
    } catch (err) {
        res.status(503).json({ status: 'degraded', db: 'down', error: err.message });
    }
});
app.get('/api/v1/openapi.json', (req, res) => res.json(openapi));
app.get('/api/v1/docs', (req, res) =>
    res.sendFile(path.join(__dirname, 'docs.html')));
app.use('/api/v1/auth', authRoutes);

// ---- Всё остальное — только с Bearer-токеном --------------------------------
app.use('/api/v1', authenticate);
app.use('/api/v1/animals', animalsRoutes);
// Сотрудники с ПДн — отдельный роутер (шифрование, увольнение, закрепления)
app.use('/api/v1/employees', employeesRoutes);

// Неделя 5: справочники, склад, задачи, пастбища
registerCatalogs(app);
app.use('/api/v1/stock', stockRoutes);
app.use('/api/v1/tasks', tasksRoutes);
app.use('/api/v1', pasturesRoutes);

// Неделя 6: бизнес-админка, технадминка; Неделя 8: отчёты и аналитика
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/tech', techRoutes);
// Неделя 11 (расширение): администратор БД — миграции, бэкапы, мониторинг
app.use('/api/v1/dba', dbaRoutes);
app.use('/api/v1/reports', reportsRoutes);
// Статистика для плашек на страницах (срезы уже разрешённых данных)
app.use('/api/v1/stats', statsRoutes);

// Неделя 7: адаптивный веб-интерфейс (статические файлы, без авторизации на раздачу).
// Путь зависит от раскладки: в репозитории server/src -> WEB_Ferma/ui/public,
// в Docker-образе src -> /app/ui/public (см. server/Dockerfile).
const UI_DIR = [
    path.join(__dirname, '../../ui/public'),
    path.join(__dirname, '../ui/public'),
].find((dir) => fs.existsSync(path.join(dir, 'index.html')))
    || path.join(__dirname, '../../ui/public');
app.use('/app', express.static(UI_DIR));

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
    console.log(`ИС «Заречное» — REST API: http://localhost:${config.port}/api/v1`);
    console.log(`OpenAPI-документация:   http://localhost:${config.port}/api/v1/docs`);
    console.log(`ПДн сотрудников:        ${config.piiKey ? 'ключ задан' : 'КЛЮЧ НЕ ЗАДАН (PII_KEY)'}`);
    backupScheduler.start();
});

module.exports = app;
