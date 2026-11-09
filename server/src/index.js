'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const { query } = require('./db');
const { authenticate } = require('./middleware/auth');
const { errorHandler, notFound } = require('./middleware/errors');
const authRoutes = require('./routes/auth');
const animalsRoutes = require('./routes/animals');
const { registerCatalogs } = require('./routes/catalog');
const stockRoutes = require('./routes/stock');
const tasksRoutes = require('./routes/tasks');
const pasturesRoutes = require('./routes/pastures');
const adminRoutes = require('./routes/admin');
const techRoutes = require('./routes/tech');
const reportsRoutes = require('./routes/reports');
const openapi = require('./openapi.json');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

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

// Неделя 5: справочники, склад, задачи, пастбища
registerCatalogs(app);
app.use('/api/v1/stock', stockRoutes);
app.use('/api/v1/tasks', tasksRoutes);
app.use('/api/v1', pasturesRoutes);

// Неделя 6: бизнес-админка, технадминка; Неделя 8: отчёты и аналитика
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/tech', techRoutes);
app.use('/api/v1/reports', reportsRoutes);

// Неделя 7: адаптивный веб-интерфейс (статические файлы, без авторизации на раздачу)
app.use('/app', express.static(path.join(__dirname, '../../ui/public')));

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
    console.log(`ИС «Заречное» — REST API: http://localhost:${config.port}/api/v1`);
    console.log(`OpenAPI-документация:   http://localhost:${config.port}/api/v1/docs`);
});
