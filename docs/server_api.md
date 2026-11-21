# Листинги кода серверной части — ИС «Заречное» (Неделя 4–5)

Документ сформирован скриптом `scripts/generate_server_doc.py` из исходников `server/src/`.

Сервер: Node.js 22 + Express, PostgreSQL 16 (пул `pg`), bcrypt-хэши, Bearer-токены в `user_session`.

> **Доработка v1.4.0.** Актуальный контракт API — `server/src/openapi.json` версии 1.4.0
> (94 пути). Ниже приведены листинги базовой версии (Неделя 4–5). Новые модули и
> маршруты: `pii.js` (шифрование ПДн, ключ из `PII_KEY`), `stats.js` +
> `routes/stats.js` (плашки показателей), `perf.js` (метрики скорости),
> `assignments.js` (закрепления и `/animals/herd`), `routes/employees.js`
> (ПДн, увольнение, восстановление), расширенные `routes/admin.js`
> (блокировки, пароли, сессии, права ролей, фильтры аудита) и `routes/tech.js`
> (`/backups/overview`, `/backups/schedule`, `/metrics/perf`).
> Подробности — `docs/security.md`, `docs/ui_guide.md`, `docs/backup_policy.md`.

## Оглавление

- [index.js](#indexjs)
- [config.js](#configjs)
- [db.js](#dbjs)
- [audit.js](#auditjs)
- [middleware/auth.js](#middlewareauthjs)
- [middleware/rbac.js](#middlewarerbacjs)
- [middleware/errors.js](#middlewareerrorsjs)
- [routes/auth.js](#routesauthjs)
- [routes/animals.js](#routesanimalsjs)
- [openapi.json](#openapijson)
- [middleware/elevated.js](#middlewareelevatedjs)
- [routes/admin.js](#routesadminjs)
- [routes/catalog.js](#routescatalogjs)
- [routes/pastures.js](#routespasturesjs)
- [routes/reports.js](#routesreportsjs)
- [routes/stock.js](#routesstockjs)
- [routes/tasks.js](#routestasksjs)
- [routes/tech.js](#routestechjs)
- [validation.js](#validationjs)


## `index.js`

Строк: 71

```javascript
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
```

## `config.js`

Строк: 21

```javascript
'use strict';

// Конфигурация сервера (12-factor: переменные окружения со значениями по умолчанию
// для локального запуска рядом с контейнером farm_pg, см. ../README.md).
module.exports = {
    // PORT в окружении может быть 0/мусор — тогда берём 3000
    port: parseInt(process.env.PORT || '', 10) || 3000,
    db: {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5433', 10),
        user: process.env.PGUSER || 'farm',
        password: process.env.PGPASSWORD || 'farm',
        database: process.env.PGDATABASE || 'farm',
    },
    session: {
        // TTL сессии в user_session (ТЗ: «сессии — по безопасным токенам»)
        ttlHours: parseInt(process.env.SESSION_TTL_HOURS || '8', 10),
        maxFailed: 5,          // неудачных попыток до временной блокировки
        lockMinutes: 15,
    },
};
```

## `db.js`

Строк: 42

```javascript
'use strict';

const { Pool } = require('pg');
const config = require('./config');

// Пул соединений с PostgreSQL 16 + PostGIS
const pool = new Pool({
    ...config.db,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('PG pool error:', err.message);
});

/** Выполнить запрос */
function query(text, params) {
    return pool.query(text, params);
}

/**
 * Выполнить fn в транзакции (client = подключённый клиент с begun транзакцией).
 * При исключении — откат, исключение пробрасывается дальше.
 */
async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* соединение уже умерло */ }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction };
```

## `audit.js`

Строк: 58

```javascript
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
```

## `middleware/auth.js`

Строк: 68

```javascript
'use strict';

const crypto = require('crypto');
const { query } = require('../db');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Аутентификация по Bearer-токену: токен хранится в user_session только в виде
 * sha256-хэша (ТЗ: безопасные токены), права роли загружаются из role_permission
 * на каждый запрос (серверная авторизация, не «скрытие кнопки»).
 */
async function authenticate(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
        if (!token) {
            return res.status(401).json({ error: 'Требуется авторизация (Bearer-токен)' });
        }

        const { rows } = await query(
            `SELECT s.id AS session_id, s.expires_at, s.revoked_at,
                    u.id, u.login, u.full_name, u.employee_id, u.is_active, u.is_deleted,
                    r.id AS role_id, r.code AS role_code, r.name AS role_name, r.role_type
             FROM user_session s
             JOIN app_user u ON u.id = s.user_id
             JOIN role r ON r.id = u.role_id
             WHERE s.token_hash = $1`,
            [sha256(token)]
        );
        if (!rows.length) {
            return res.status(401).json({ error: 'Неверный или отозванный токен' });
        }
        const s = rows[0];
        if (s.revoked_at) {
            return res.status(401).json({ error: 'Сессия отозвана' });
        }
        if (new Date(s.expires_at) < new Date()) {
            return res.status(401).json({ error: 'Сессия истекла' });
        }
        if (!s.is_active || s.is_deleted) {
            return res.status(401).json({ error: 'Учётная запись неактивна' });
        }

        const perms = await query(
            `SELECT p.code FROM role_permission rp
             JOIN permission p ON p.id = rp.permission_id
             WHERE rp.role_id = $1`,
            [s.role_id]
        );

        req.user = {
            id: s.id,
            login: s.login,
            full_name: s.full_name,
            employee_id: s.employee_id,
            role: { id: s.role_id, code: s.role_code, name: s.role_name, type: s.role_type },
            permissions: new Set(perms.rows.map((r) => r.code)),
            sessionId: s.session_id,
            token,
        };
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = { authenticate, sha256 };
```

## `middleware/rbac.js`

Строк: 28

```javascript
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
```

## `middleware/errors.js`

Строк: 50

```javascript
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
```

## `routes/auth.js`

Строк: 142

```javascript
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query } = require('../db');
const { writeAudit } = require('../audit');
const { authenticate, sha256 } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

/**
 * POST /api/v1/auth/login — аутентификация (ТЗ п.7): bcrypt-сравнение,
 * учёт неудачных попыток и временная блокировка, токен в user_session (sha256).
 */
router.post('/login', async (req, res, next) => {
    try {
        const { login, password } = req.body || {};
        if (!login || !password || typeof login !== 'string' || typeof password !== 'string') {
            throw httpError(400, 'Укажите логин и пароль');
        }

        const { rows } = await query(
            `SELECT u.id, u.login, u.password_hash, u.full_name, u.employee_id,
                    u.is_active, u.is_deleted, u.failed_cnt, u.locked_until,
                    r.id AS role_id, r.code AS role_code, r.name AS role_name, r.role_type
             FROM app_user u
             JOIN role r ON r.id = u.role_id
             WHERE u.login = $1`,
            [login]
        );

        if (!rows.length) {
            // Неверный логин: аудировать некого (FK на app_user) — только лог
            console.warn(`login attempt for unknown user: ${login}`);
            throw httpError(401, 'Неверный логин или пароль');
        }
        const u = rows[0];

        if (u.locked_until && new Date(u.locked_until) > new Date()) {
            throw httpError(423, `Учётная запись заблокирована до ${new Date(u.locked_until).toISOString()}`);
        }
        if (!u.is_active || u.is_deleted) {
            throw httpError(401, 'Неверный логин или пароль');
        }

        const ok = await bcrypt.compare(password, u.password_hash);
        if (!ok) {
            const failed = u.failed_cnt + 1;
            await query(
                `UPDATE app_user
                    SET failed_cnt = $2::int,
                        locked_until = CASE WHEN $2::int >= $3::int
                                            THEN now() + ($4::text || ' minutes')::interval
                                            ELSE locked_until END
                  WHERE id = $1::bigint`,
                [u.id, failed, config.session.maxFailed, String(config.session.lockMinutes)]
            );
            await writeAudit(req, {
                userId: u.id,
                entityName: 'app_user',
                entityId: u.id,
                action: 'LOGIN',
                after: { result: 'denied', failed_cnt: failed },
            });
            throw httpError(401, 'Неверный логин или пароль');
        }

        // Успех: выдаём сессионный токен (в БД — только sha256-хэш)
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + config.session.ttlHours * 3600 * 1000);
        await query(
            `INSERT INTO user_session (user_id, token_hash, ip, user_agent, issued_at, expires_at)
             VALUES ($1, $2, $3, $4, now(), $5)`,
            [u.id, sha256(token), req.ip || null, req.headers['user-agent'] || null, expiresAt]
        );
        await query(
            `UPDATE app_user SET failed_cnt = 0, last_login_at = now() WHERE id = $1`,
            [u.id]
        );

        const perms = await query(
            `SELECT p.code FROM role_permission rp
             JOIN permission p ON p.id = rp.permission_id
             WHERE rp.role_id = $1 ORDER BY p.code`,
            [u.role_id]
        );
        await writeAudit(req, {
            userId: u.id,
            entityName: 'app_user',
            entityId: u.id,
            action: 'LOGIN',
            after: { result: 'ok' },
        });

        res.json({
            token,
            expires_at: expiresAt.toISOString(),
            user: {
                id: u.id,
                login: u.login,
                full_name: u.full_name,
                employee_id: u.employee_id,
                role: { code: u.role_code, name: u.role_name, type: u.role_type },
                permissions: perms.rows.map((r) => r.code),
            },
        });
    } catch (err) {
        next(err);
    }
});

/** GET /api/v1/auth/me — текущий пользователь и его права */
router.get('/me', authenticate, (req, res) => {
    res.json({
        id: req.user.id,
        login: req.user.login,
        full_name: req.user.full_name,
        employee_id: req.user.employee_id,
        role: req.user.role,
        permissions: [...req.user.permissions].sort(),
    });
});

/** POST /api/v1/auth/logout — отзыв собственной сессии */
router.post('/logout', authenticate, async (req, res, next) => {
    try {
        await query(`UPDATE user_session SET revoked_at = now() WHERE id = $1`, [req.user.sessionId]);
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
```

## `routes/animals.js`

Строк: 212

```javascript
'use strict';

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const STATUSES = ['ЗДОРОВ', 'НА_ОСМОТРЕ', 'НА_КАРАНТИНЕ', 'НА_ЛЕЧЕНИИ', 'ВЫБРАКОВАНО', 'ПАДЁЖ'];
const SEXES = ['M', 'F'];
const SORTABLE = new Set(['id', 'inventory_number', 'birth_date', 'sex', 'status', 'arrival_date', 'created_at']);
const INV_RE = /^[A-Za-zА-Яа-яЁё0-9_-]{2,20}$/;

/** Схема валидации реквизитов животного (POST/PATCH). */
const SPECS = {
    inventory_number: { type: 'string', pattern: INV_RE, message: 'inventory_number: 2–20 символов (буквы, цифры, «_», «-»)' },
    birth_date: { type: 'date', maxToday: true },
    sex: { type: 'enum', values: SEXES, message: 'sex: допустимо только M или F' },
    breed_id: { type: 'int' },
    group_id: { type: 'int', nullable: true },
    arrival_date: { type: 'date' },
    status: { type: 'reject', message: 'Статус меняется только через POST /animals/:id/status (регламент ТЗ п.3.2)' },
    is_deleted: { type: 'reject', message: 'Поле is_deleted не редактируется напрямую (используйте DELETE)' },
};

/** Схема валидации перевода статуса. */
const STATUS_SPECS = {
    status: { type: 'enum', required: true, values: STATUSES, message: 'status: недопустимое значение' },
    reason: { type: 'string', required: true, min: 1, message: 'reason: причина перехода обязательна (регламент ТЗ п.4.4)' },
    diagnosis_id: { type: 'int', nullable: true },
    drug_nomenclature_id: { type: 'int', nullable: true },
    dosage: { type: 'decimal' },
    disposal_reason_id: { type: 'int', nullable: true },
};

async function ensureBreed(breedId) {
    if (breedId == null) throw httpError(400, 'breed_id обязателен');
    const { rows } = await query('SELECT id FROM breed WHERE id = $1', [breedId]);
    if (!rows.length) throw httpError(400, `Порода ${breedId} не найдена`);
}
async function ensureGroup(groupId) {
    if (groupId == null) return;
    const { rows } = await query(
        'SELECT id FROM animal_group WHERE id = $1 AND is_active AND NOT is_deleted', [groupId]);
    if (!rows.length) throw httpError(400, `Группа ${groupId} не найдена или неактивна`);
}

const selectAnimal = (extra = '') => `
    SELECT a.id, a.inventory_number, a.birth_date, a.sex, a.status, a.arrival_date,
           a.is_deleted, a.group_id, a.breed_id, a.created_at,
           b.name AS breed, g.name AS group_name ${extra}
    FROM animal a
    JOIN breed b ON b.id = a.breed_id
    LEFT JOIN animal_group g ON g.id = a.group_id`;

/**
 * GET /api/v1/animals — реестр с фильтрами, сортировкой, пагинацией (ТЗ п.5).
 * Query: limit (≤200, по умолчанию 50), offset, q (поиск), status, group_id,
 *        sort (inventory_number|birth_date|sex|status|arrival_date|created_at, «-» — DESC),
 *        include_deleted=true.
 */
router.get('/', requirePermission('animal:READ', 'animal'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query, { defaultLimit: 50, maxLimit: 200 });
        const { sort, desc } = parseSort(req.query, SORTABLE, 'inventory_number');
        const q = String(req.query.q || '').trim();
        const status = String(req.query.status || '');
        if (status && !STATUSES.includes(status)) throw httpError(400, 'status: недопустимое значение');
        const groupId = asInt(req.query.group_id) || 0;
        const includeDeleted = req.query.include_deleted === 'true';

        const { rows } = await query(
            `${selectAnimal(', COUNT(*) OVER() AS total')}
             WHERE ($1::boolean OR NOT a.is_deleted)
               AND ($2::text = '' OR a.inventory_number ILIKE '%' || $2::text || '%'
                    OR b.name ILIKE '%' || $2::text || '%'
                    OR COALESCE(g.name, '') ILIKE '%' || $2::text || '%')
               AND ($3::text = '' OR a.status = $3::text)
               AND ($4::int = 0 OR a.group_id = $4::int)
             ORDER BY a.${sort} ${desc ? 'DESC' : 'ASC'}, a.id ASC
             LIMIT $5::int OFFSET $6::int`,
            [includeDeleted, q, status, groupId, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({
            data: rows.map(({ total: _t, ...r }) => r),
            total, limit, offset,
        });
    } catch (err) { next(err); }
});

/** GET /api/v1/animals/:id — карточка */
router.get('/:id', requirePermission('animal:READ', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const includeDeleted = req.query.include_deleted === 'true';
        const { rows } = await query(
            `${selectAnimal()} WHERE a.id = $1::int AND ($2::boolean OR NOT a.is_deleted)`,
            [id, includeDeleted]
        );
        if (!rows.length) throw httpError(404, 'Животное не найдено');
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** POST /api/v1/animals — создание карточки */
router.post('/', requirePermission('animal:WRITE', 'animal'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, SPECS);
        await ensureBreed(v.breed_id);
        await ensureGroup(v.group_id);

        const { rows } = await query(
            `INSERT INTO animal (inventory_number, breed_id, group_id, birth_date, sex, status, arrival_date)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE))
             RETURNING id, inventory_number, birth_date, sex, status, arrival_date,
                       group_id, breed_id, is_deleted, created_at`,
            [v.inventory_number, v.breed_id, v.group_id ?? null, v.birth_date, v.sex,
             'ЗДОРОВ', v.arrival_date || null]
        );
        await writeAudit(req, {
            entityName: 'animal', entityId: rows[0].id, action: 'CREATE', after: rows[0],
        });
        res.status(201).json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** PATCH /api/v1/animals/:id — изменение реквизитов (статус — только через /status) */
router.patch('/:id', requirePermission('animal:WRITE', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, SPECS, { partial: true });
        const keys = Object.keys(v);
        if (!keys.length) throw httpError(400, 'Нет полей для изменения');
        if (v.breed_id !== undefined) await ensureBreed(v.breed_id);
        if (v.group_id !== undefined) await ensureGroup(v.group_id);

        const row = await withTransaction(async (client) => {
            const cur = await client.query(
                'SELECT * FROM animal WHERE id = $1 AND NOT is_deleted FOR UPDATE', [id]);
            if (!cur.rows.length) throw httpError(404, 'Животное не найдено');
            const sets = [];
            const params = [];
            keys.forEach((k, i) => { sets.push(`${k} = $${i + 2}`); params.push(v[k]); });
            const upd = await client.query(
                `UPDATE animal SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
                [id, ...params]
            );
            return { before: cur.rows[0], after: upd.rows[0] };
        });

        await writeAudit(req, {
            entityName: 'animal', entityId: id, action: 'UPDATE',
            before: { inventory_number: row.before.inventory_number, breed_id: row.before.breed_id,
                      group_id: row.before.group_id },
            after: { inventory_number: row.after.inventory_number, breed_id: row.after.breed_id,
                     group_id: row.after.group_id },
        });
        res.json({ data: row.after });
    } catch (err) { next(err); }
});

/** DELETE /api/v1/animals/:id — мягкое удаление (is_deleted) */
router.delete('/:id', requirePermission('animal:DELETE', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            'UPDATE animal SET is_deleted = TRUE WHERE id = $1 AND NOT is_deleted RETURNING id, inventory_number',
            [id]
        );
        if (!rows.length) throw httpError(404, 'Животное не найдено');
        await writeAudit(req, {
            entityName: 'animal', entityId: id, action: 'DELETE',
            before: { inventory_number: rows[0].inventory_number },
        });
        res.json({ data: { id, is_deleted: true } });
    } catch (err) { next(err); }
});

/**
 * POST /api/v1/animals/:id/status — регламентированный перевод статуса.
 * Вся бизнес-логика (диагноз/причина/расход препарата/withdrawal/аудит) —
 * в хранимой процедуре sp_change_animal_status (серверная валидация, ТЗ п.4).
 */
router.post('/:id/status', requirePermission('animal:WRITE', 'animal'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, STATUS_SPECS);
        if (v.dosage !== undefined && !(v.dosage > 0)) {
            throw httpError(400, 'dosage: должна быть положительной');
        }
        const { rows } = await query(
            `SELECT sp_change_animal_status($1, $2, $3, $4, $5, $6, $7, $8, $9::inet) AS new_status`,
            [
                id, v.status, req.user.id, v.reason,
                v.diagnosis_id ?? null, v.drug_nomenclature_id ?? null,
                v.dosage !== undefined ? v.dosage : null,
                v.disposal_reason_id ?? null,
                req.ip || null,
            ]
        );
        res.json({ data: { id, status: rows[0].new_status } });
    } catch (err) { next(err); }
});

module.exports = router;
```

## `openapi.json`

Строк: 2862

```json
{
  "openapi": "3.0.3",
  "info": {
    "title": "ИС «Заречное» — REST API",
    "version": "1.2.0",
    "description": "Веб-приложение для комплексного учёта фермерского хозяйства (Вариант 11).\n\n**Авторизация:** Bearer-токен (POST /auth/login). Права роли проверяются на сервере по матрице `role_permission`; запрещённые вызовы возвращают 403 и фиксируются в аудите (`action=DENY`).\n\n**Валидация:** все проверки (бизнес-правила ТЗ) выполняются на стороне сервера — в HTTP-слое (src/validation.js) и в хранимых процедурах PostgreSQL.\n\n**Справочники** (Неделя 5) делят единую сигнатуру CRUD: `GET /{path}` (пагинация/поиск/сортировка), `GET /{path}/{id}`, `POST /{path}`, `PATCH /{path}/{id}`, `DELETE /{path}/{id}`. Пример эталона — `/species`.\n\n**Неделя 6:** `/admin/*` (бизнес-админка), `/tech/*` (технадминка), усиленный аудит технических ролей (заголовок `X-Override-Reason`).\n\n**Неделя 7:** адаптивный UI на `/app`, микросервис отчётности `:4000`.\n\n**Неделя 8:** 5 отчётов + дашборд с экспортом CSV."
  },
  "servers": [
    {
      "url": "/api/v1",
      "description": "Текущий сервер"
    }
  ],
  "security": [
    {
      "bearerAuth": []
    }
  ],
  "tags": [
    {
      "name": "auth",
      "description": "Аутентификация и сессии"
    },
    {
      "name": "animals",
      "description": "Реестр животных (эталонный CRUD Недели 4)"
    },
    {
      "name": "catalogs",
      "description": "Справочники (CRUD): species, breeds, positions, employees, diagnoses, drugs, uoms, movement-types, write-off-reasons, disposal-reasons, task-types, suppliers, warehouses, product-types"
    },
    {
      "name": "stock",
      "description": "Склад: партии, остатки, движения, заявки на закупку"
    },
    {
      "name": "tasks",
      "description": "Задачи/наряды и их выполнение"
    },
    {
      "name": "pastures",
      "description": "Пастбищные участки и назначение выпаса"
    },
    {
      "name": "system",
      "description": "Служебные"
    },
    {
      "name": "admin",
      "description": "Бизнес-админка: пользователи, роли, права, настройки, журналы"
    },
    {
      "name": "tech",
      "description": "Технадминка: бэкапы, восстановления, техлог, метрики, обслуживание"
    },
    {
      "name": "reports",
      "description": "Статистика и отчётность (5 отчётов + дашборд + агрегация)"
    }
  ],
  "paths": {
    "/health": {
      "get": {
        "tags": [
          "system"
        ],
        "security": [],
        "summary": "Проверка доступности сервера и БД",
        "responses": {
          "200": {
            "description": "OK"
          },
          "503": {
            "description": "База данных недоступна"
          }
        }
      }
    },
    "/auth/login": {
      "post": {
        "tags": [
          "auth"
        ],
        "security": [],
        "summary": "Вход в систему",
        "description": "bcrypt-сравнение пароля; неудачные попытки учитываются (5 → блокировка на 15 мин, фиксируется в аудите).",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/LoginRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Успешный вход",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/LoginResponse"
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "description": "Неверный логин или пароль"
          },
          "423": {
            "description": "Учётная запись временно заблокирована"
          }
        }
      }
    },
    "/auth/me": {
      "get": {
        "tags": [
          "auth"
        ],
        "summary": "Текущий пользователь и его права",
        "responses": {
          "200": {
            "description": "Профиль + массив прав"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/auth/logout": {
      "post": {
        "tags": [
          "auth"
        ],
        "summary": "Выход (отзыв текущей сессии)",
        "responses": {
          "200": {
            "description": "Сессия отозвана"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          }
        }
      }
    },
    "/animals": {
      "get": {
        "tags": [
          "animals"
        ],
        "summary": "Список животных (пагинация/фильтры/сортировка)",
        "description": "Требуется право `animal:READ`.",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50,
              "maximum": 200
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "q",
            "in": "query",
            "description": "Поиск по инвентарному номеру/породе/группе",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "status",
            "in": "query",
            "schema": {
              "$ref": "#/components/schemas/AnimalStatus"
            }
          },
          {
            "name": "group_id",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "sort",
            "in": "query",
            "description": "inventory_number|birth_date|sex|status|arrival_date|created_at; префикс «-» — DESC",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "include_deleted",
            "in": "query",
            "schema": {
              "type": "boolean"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Страница списка",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/AnimalList"
                }
              }
            }
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "post": {
        "tags": [
          "animals"
        ],
        "summary": "Создать карточку животного",
        "description": "Требуется право `animal:WRITE`. Новое животное всегда получает статус ЗДОРОВ; дальнейшие переходы — только через POST /animals/{id}/status.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/AnimalCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Создано",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "$ref": "#/components/schemas/Animal"
                    }
                  }
                }
              }
            }
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "description": "Животное с таким инвентарным номером уже существует"
          }
        }
      }
    },
    "/animals/{id}": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "get": {
        "tags": [
          "animals"
        ],
        "summary": "Карточка животного",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      },
      "patch": {
        "tags": [
          "animals"
        ],
        "summary": "Изменить реквизиты (inventory_number, breed_id, group_id)",
        "description": "Статус и is_deleted через PATCH недоступны — сервер отвечает 400. Требуется право `animal:WRITE`. Изменение пишется в аудит (до/после).",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/AnimalPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Обновлено"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "404": {
            "description": "Не найдено"
          },
          "409": {
            "description": "Конфликт уникальности"
          }
        }
      },
      "delete": {
        "tags": [
          "animals"
        ],
        "summary": "Мягкое удаление (is_deleted = true)",
        "description": "Требуется право `animal:DELETE`.",
        "responses": {
          "200": {
            "description": "Удалено (мягко)"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      }
    },
    "/animals/{id}/status": {
      "post": {
        "tags": [
          "animals"
        ],
        "summary": "Регламентированный перевод статуса животного",
        "description": "Вызывает хранимую процедуру `sp_change_animal_status`: диагноз/причина обязательны; для «НА_ЛЕЧЕНИИ» — препарат списывается со склада атомарно и фиксируется withdrawal period; выбраковка/падёж требуют причины и подтверждения. Всё фиксируется в аудите.",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "integer"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/StatusChangeRequest"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Статус изменён"
          },
          "400": {
            "description": "Нарушение регламента (бизнес-правило)",
            "content": {
              "application/json": {
                "schema": {
                  "$ref": "#/components/schemas/Error"
                }
              }
            }
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      }
    },
    "/species": {
      "get": {
        "tags": [
          "catalogs"
        ],
        "summary": "Справочник «виды» — список (эталон сигнатуры справочников)",
        "description": "Все справочники (breeds, positions, employees, diagnoses, drugs, uoms, movement-types, write-off-reasons, disposal-reasons, task-types, suppliers, warehouses, product-types) имеют те же методы и формат ответа.",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50,
              "maximum": 200
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "q",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "sort",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Список"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "post": {
        "tags": [
          "catalogs"
        ],
        "summary": "Создать вид",
        "responses": {
          "201": {
            "description": "Создано"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "409": {
            "description": "Дубликат по уникальному реквизиту"
          }
        }
      }
    },
    "/species/{id}": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "get": {
        "tags": [
          "catalogs"
        ],
        "summary": "Карточка справочника",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      },
      "patch": {
        "tags": [
          "catalogs"
        ],
        "summary": "Изменить запись справочника",
        "responses": {
          "200": {
            "description": "Обновлено"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      },
      "delete": {
        "tags": [
          "catalogs"
        ],
        "summary": "Удалить запись справочника",
        "responses": {
          "200": {
            "description": "Удалено"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      }
    },
    "/stock/batches": {
      "get": {
        "tags": [
          "stock"
        ],
        "summary": "Партии склада с остатками",
        "description": "Требуется право `stock:READ`. Фильтры: q, nomenclature_id, warehouse_id.",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "q",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "nomenclature_id",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          },
          {
            "name": "warehouse_id",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "Список партий"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/stock/balances": {
      "get": {
        "tags": [
          "stock"
        ],
        "summary": "Остатки по партиям",
        "description": "Требуется право `stock:READ`.",
        "responses": {
          "200": {
            "description": "Список остатков"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/stock/movements": {
      "post": {
        "tags": [
          "stock"
        ],
        "summary": "Движение склада (приход/расход/списание/возврат)",
        "description": "Атомарная операция в транзакции: при недостатке остатка для расхода/списания сервер отклоняет запрос (400) и откатывает транзакцию. Списание (WRITE_OFF) требует право `stock:DELETE` и причину `write_off_reason_id`; прочие типы — `stock:WRITE`.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/StockMovementRequest"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Движение проведено, остаток обновлён"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/stock/purchase-requests": {
      "get": {
        "tags": [
          "stock"
        ],
        "summary": "Заявки на закупку",
        "description": "Требуется право `purchase:READ`. Фильтры: status, nomenclature_id, q.",
        "responses": {
          "200": {
            "description": "Список заявок"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/tasks": {
      "get": {
        "tags": [
          "tasks"
        ],
        "summary": "Реестр задач",
        "description": "Требуется право `task:READ`. Фильтры: status, assigned_to, q.",
        "responses": {
          "200": {
            "description": "Список задач"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "post": {
        "tags": [
          "tasks"
        ],
        "summary": "Создать разовую задачу",
        "description": "Требуется право `task:WRITE`. Для кормовой задачи (task_type с requires_writeoff) обязательны `group_ids` и активный рацион у каждой группы (серверная проверка ТЗ п.4).",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/TaskCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Создано"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/tasks/{id}": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "get": {
        "tags": [
          "tasks"
        ],
        "summary": "Карточка задачи (+ группы и исполнения)",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      }
    },
    "/tasks/{id}/execute": {
      "post": {
        "tags": [
          "tasks"
        ],
        "summary": "Выполнить задачу (sp_execute_task)",
        "description": "Факт по группе + FIFO-списание корма по рациону в одной транзакции; при нехватке остатка — откат. Требуется право `task:WRITE` и учётная запись сотрудника.",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": {
              "type": "integer"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/TaskExecute"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Выполнено"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      }
    },
    "/pasture-plots": {
      "get": {
        "tags": [
          "pastures"
        ],
        "summary": "Участки/загоны (+ текущая загрузка головами)",
        "description": "Требуется право `pasture:READ`. area_ha считается автоматически по контуру полигона.",
        "responses": {
          "200": {
            "description": "Список участков"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "post": {
        "tags": [
          "pastures"
        ],
        "summary": "Создать участок (WKT-полигон, площадь — триггером)",
        "description": "Требуется право `pasture:WRITE`.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PlotCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Создано, area_ha рассчитана"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/pasture-plots/{id}": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "get": {
        "tags": [
          "pastures"
        ],
        "summary": "Карточка участка (+ WKT контура)",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      },
      "delete": {
        "tags": [
          "pastures"
        ],
        "summary": "Мягкое удаление участка",
        "responses": {
          "200": {
            "description": "Удалено"
          },
          "404": {
            "description": "Не найдено"
          }
        }
      }
    },
    "/grazing/move": {
      "post": {
        "tags": [
          "pastures"
        ],
        "summary": "Перевести группу на участок (sp_move_group_to_plot)",
        "description": "Проверка периода отдыха участка и нормы нагрузки голов/га; закрытие предыдущего активного выпаса — в одной транзакции с откатом при нарушении. Требуется право `pasture:WRITE`.",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/GrazingMove"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Выпас назначен"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/roles": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Список ролей с числом прав и пользователей",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/roles/{id}": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Роль и её права",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/permissions": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Каталог прав (42)",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/users": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Реестр учётных записей (без хэшей паролей)",
        "description": "Фильтры: q, role_id, include_deleted; сортировка и пагинация.",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "q",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "role_id",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Создать пользователя (bcrypt)",
        "description": "Для технических ролей обязателен X-Override-Reason.",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/UserCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Создано"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/users/{id}": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Карточка пользователя",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "patch": {
        "tags": [
          "admin"
        ],
        "summary": "Изменить реквизиты (роль, активность, сотрудник)",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/UserPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "delete": {
        "tags": [
          "admin"
        ],
        "summary": "Мягкое удаление + отзыв всех сессий в одной транзакции",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/users/{id}/reset-password": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Смена пароля (bcrypt, must_change_pw)",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/PasswordReset"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/users/{id}/unlock": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "post": {
        "tags": [
          "admin"
        ],
        "summary": "Снять временную блокировку",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/settings": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Настройки хозяйства (farm_settings)",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/settings/{key}": {
      "parameters": [
        {
          "name": "key",
          "in": "path",
          "required": true,
          "schema": {
            "type": "string"
          }
        }
      ],
      "patch": {
        "tags": [
          "admin"
        ],
        "summary": "Изменить настройку (тип NUM/BOOL/DATE/TEXT контролируется БД)",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/SettingPatch"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/audit-log": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Журнал бизнес-аудита",
        "description": "Фильтры: user_id, entity_name, action, q, date_from, date_to, is_elevated.",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "action",
            "in": "query",
            "schema": {
              "type": "string"
            }
          },
          {
            "name": "is_elevated",
            "in": "query",
            "schema": {
              "type": "boolean"
            }
          },
          {
            "name": "date_from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/audit-log/export": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Выгрузка аудита в CSV (BOM, разделитель ;)",
        "description": "Требует export:EXEC; факт выгрузки пишется в аудит.",
        "responses": {
          "200": {
            "description": "text/csv"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/sessions": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Активные сессии (без token_hash)",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "user_id",
            "in": "query",
            "schema": {
              "type": "integer"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/notifications": {
      "get": {
        "tags": [
          "admin"
        ],
        "summary": "Уведомления текущего пользователя",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "unread_only",
            "in": "query",
            "schema": {
              "type": "boolean"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/admin/notifications/{id}/read": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "patch": {
        "tags": [
          "admin"
        ],
        "summary": "Пометить уведомление прочитанным (только своё)",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/tech/backups": {
      "get": {
        "tags": [
          "tech"
        ],
        "summary": "Журнал резервных копий",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "status",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "post": {
        "tags": [
          "tech"
        ],
        "summary": "Создать резервную копию (pg_dump -Fc, SHA-256)",
        "description": "Требует backup:EXEC + X-Override-Reason; пишется в tech_log.",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/BackupCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Создано"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/tech/backups/{id}": {
      "parameters": [
        {
          "name": "id",
          "in": "path",
          "required": true,
          "schema": {
            "type": "integer"
          }
        }
      ],
      "get": {
        "tags": [
          "tech"
        ],
        "summary": "Карточка копии + связанные восстановления",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/tech/restores": {
      "get": {
        "tags": [
          "tech"
        ],
        "summary": "Журнал восстановлений",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      },
      "post": {
        "tags": [
          "tech"
        ],
        "summary": "Восстановление из копии (pg_restore --clean)",
        "description": "Разрушающая операция: обязательна причина, проверка checksum, tech_log.",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/RestoreCreate"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Создано"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/tech/log": {
      "get": {
        "tags": [
          "tech"
        ],
        "summary": "Технический лог (отдельно от бизнес-аудита)",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 50
            }
          },
          {
            "name": "offset",
            "in": "query",
            "schema": {
              "type": "integer",
              "default": 0
            }
          },
          {
            "name": "action_type",
            "in": "query",
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/tech/metrics": {
      "get": {
        "tags": [
          "tech"
        ],
        "summary": "Метрики БД: соединения, размер, счётчики",
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/tech/maintenance": {
      "post": {
        "tags": [
          "tech"
        ],
        "summary": "VACUUM / ANALYZE / REINDEX",
        "description": "Вне транзакции; результат пишется в tech_log.",
        "parameters": [
          {
            "name": "X-Override-Reason",
            "in": "header",
            "required": false,
            "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
            "schema": {
              "type": "string",
              "maxLength": 500
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/Maintenance"
              }
            }
          }
        },
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/reports/cost-fcr": {
      "get": {
        "tags": [
          "reports"
        ],
        "summary": "Себестоимость и конверсия корма (FCR) по группам и месяцам",
        "description": "Доступ: report:READ; CSV-экспорт дополнительно требует export:EXEC.",
        "parameters": [
          {
            "name": "format",
            "in": "query",
            "description": "json (по умолчанию) | csv",
            "schema": {
              "type": "string",
              "enum": [
                "json",
                "csv"
              ]
            }
          },
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/reports/herd-health": {
      "get": {
        "tags": [
          "reports"
        ],
        "summary": "Здоровье поголовья: доля больных, выбраковка, просрочки вакцинаций",
        "description": "Доступ: report:READ; CSV-экспорт дополнительно требует export:EXEC.",
        "parameters": [
          {
            "name": "format",
            "in": "query",
            "description": "json (по умолчанию) | csv",
            "schema": {
              "type": "string",
              "enum": [
                "json",
                "csv"
              ]
            }
          },
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/reports/pasture-load": {
      "get": {
        "tags": [
          "reports"
        ],
        "summary": "Нагрузка на пастбища: голов/га, период отдыха, риск перевыпаса",
        "description": "Доступ: report:READ; CSV-экспорт дополнительно требует export:EXEC.",
        "parameters": [
          {
            "name": "format",
            "in": "query",
            "description": "json (по умолчанию) | csv",
            "schema": {
              "type": "string",
              "enum": [
                "json",
                "csv"
              ]
            }
          },
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/reports/tasks-in-work": {
      "get": {
        "tags": [
          "reports"
        ],
        "summary": "Задачи в работе: просрочки, загрузка бригады",
        "description": "Доступ: report:READ; CSV-экспорт дополнительно требует export:EXEC.",
        "parameters": [
          {
            "name": "format",
            "in": "query",
            "description": "json (по умолчанию) | csv",
            "schema": {
              "type": "string",
              "enum": [
                "json",
                "csv"
              ]
            }
          },
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/reports/stock-turnover": {
      "get": {
        "tags": [
          "reports"
        ],
        "summary": "Остатки склада и обороты: дефицит, неликвид",
        "description": "Доступ: report:READ; CSV-экспорт дополнительно требует export:EXEC.",
        "parameters": [
          {
            "name": "format",
            "in": "query",
            "description": "json (по умолчанию) | csv",
            "schema": {
              "type": "string",
              "enum": [
                "json",
                "csv"
              ]
            }
          },
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/reports/dashboard": {
      "get": {
        "tags": [
          "reports"
        ],
        "summary": "Сводный дашборд (KPI + динамика склада за 12 месяцев)",
        "description": "Доступ: report:READ; CSV-экспорт дополнительно требует export:EXEC.",
        "parameters": [
          {
            "name": "format",
            "in": "query",
            "description": "json (по умолчанию) | csv",
            "schema": {
              "type": "string",
              "enum": [
                "json",
                "csv"
              ]
            }
          },
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    },
    "/reports/aggregate": {
      "get": {
        "tags": [
          "reports"
        ],
        "summary": "Помесячная агрегация в микросервисе отчётности (reports-service :4000)",
        "description": "Доступ: report:READ; CSV-экспорт дополнительно требует export:EXEC.",
        "parameters": [
          {
            "name": "format",
            "in": "query",
            "description": "json (по умолчанию) | csv",
            "schema": {
              "type": "string",
              "enum": [
                "json",
                "csv"
              ]
            }
          },
          {
            "name": "from",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          },
          {
            "name": "to",
            "in": "query",
            "schema": {
              "type": "string",
              "format": "date"
            }
          }
        ],
        "responses": {
          "200": {
            "description": "ОК"
          },
          "400": {
            "$ref": "#/components/responses/BadRequest"
          },
          "401": {
            "$ref": "#/components/responses/Unauthorized"
          },
          "403": {
            "$ref": "#/components/responses/Forbidden"
          }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "description": "Токен из POST /auth/login"
      }
    },
    "responses": {
      "BadRequest": {
        "description": "Ошибка валидации или бизнес-правило",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/Error"
            }
          }
        }
      },
      "Unauthorized": {
        "description": "Нет токена / сессия истекла"
      },
      "Forbidden": {
        "description": "Недостаточно прав (запись в аудит action=DENY)"
      }
    },
    "schemas": {
      "Error": {
        "type": "object",
        "properties": {
          "error": {
            "type": "string"
          },
          "kind": {
            "type": "string",
            "enum": [
              "business_rule",
              "conflict",
              "forbidden",
              "invalid_input",
              "foreign_key",
              "check_violation",
              "server",
              "precondition_required"
            ]
          },
          "detail": {
            "type": "string"
          }
        }
      },
      "AnimalStatus": {
        "type": "string",
        "enum": [
          "ЗДОРОВ",
          "НА_ОСМОТРЕ",
          "НА_КАРАНТИНЕ",
          "НА_ЛЕЧЕНИИ",
          "ВЫБРАКОВАНО",
          "ПАДЁЖ"
        ]
      },
      "LoginRequest": {
        "type": "object",
        "required": [
          "login",
          "password"
        ],
        "properties": {
          "login": {
            "type": "string",
            "example": "vet"
          },
          "password": {
            "type": "string",
            "example": "demo1234"
          }
        }
      },
      "LoginResponse": {
        "type": "object",
        "properties": {
          "token": {
            "type": "string"
          },
          "expires_at": {
            "type": "string",
            "format": "date-time"
          },
          "user": {
            "type": "object",
            "properties": {
              "id": {
                "type": "integer"
              },
              "login": {
                "type": "string"
              },
              "full_name": {
                "type": "string"
              },
              "employee_id": {
                "type": "integer",
                "nullable": true
              },
              "role": {
                "type": "object",
                "properties": {
                  "code": {
                    "type": "string"
                  },
                  "name": {
                    "type": "string"
                  },
                  "type": {
                    "type": "string",
                    "enum": [
                      "BUSINESS",
                      "TECHNICAL"
                    ]
                  }
                }
              },
              "permissions": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            }
          }
        }
      },
      "Animal": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer"
          },
          "inventory_number": {
            "type": "string"
          },
          "birth_date": {
            "type": "string",
            "format": "date"
          },
          "sex": {
            "type": "string",
            "enum": [
              "M",
              "F"
            ]
          },
          "status": {
            "$ref": "#/components/schemas/AnimalStatus"
          },
          "arrival_date": {
            "type": "string",
            "format": "date"
          },
          "group_id": {
            "type": "integer",
            "nullable": true
          },
          "breed_id": {
            "type": "integer"
          },
          "breed": {
            "type": "string"
          },
          "group_name": {
            "type": "string",
            "nullable": true
          },
          "is_deleted": {
            "type": "boolean"
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      },
      "AnimalCreate": {
        "type": "object",
        "required": [
          "inventory_number",
          "breed_id",
          "birth_date",
          "sex"
        ],
        "properties": {
          "inventory_number": {
            "type": "string",
            "maxLength": 20,
            "example": "INV-0101"
          },
          "breed_id": {
            "type": "integer",
            "example": 1
          },
          "group_id": {
            "type": "integer",
            "nullable": true,
            "example": 36
          },
          "birth_date": {
            "type": "string",
            "format": "date",
            "example": "2025-04-12"
          },
          "sex": {
            "type": "string",
            "enum": [
              "M",
              "F"
            ]
          },
          "arrival_date": {
            "type": "string",
            "format": "date"
          }
        }
      },
      "AnimalPatch": {
        "type": "object",
        "properties": {
          "inventory_number": {
            "type": "string"
          },
          "breed_id": {
            "type": "integer"
          },
          "group_id": {
            "type": "integer",
            "nullable": true
          }
        }
      },
      "AnimalList": {
        "type": "object",
        "properties": {
          "data": {
            "type": "array",
            "items": {
              "$ref": "#/components/schemas/Animal"
            }
          },
          "total": {
            "type": "integer"
          },
          "limit": {
            "type": "integer"
          },
          "offset": {
            "type": "integer"
          }
        }
      },
      "StatusChangeRequest": {
        "type": "object",
        "required": [
          "status",
          "reason"
        ],
        "properties": {
          "status": {
            "$ref": "#/components/schemas/AnimalStatus"
          },
          "reason": {
            "type": "string",
            "description": "Причина/диагноз — обязательна регламентом"
          },
          "diagnosis_id": {
            "type": "integer",
            "description": "Обязателен для НА_ЛЕЧЕНИИ и НА_КАРАНТИНЕ"
          },
          "drug_nomenclature_id": {
            "type": "integer",
            "description": "Обязателен для НА_ЛЕЧЕНИИ; препарат списывается со склада"
          },
          "dosage": {
            "type": "number",
            "description": "Дозировка (> 0)"
          },
          "disposal_reason_id": {
            "type": "integer",
            "description": "Обязателен для ВЫБРАКОВАНО/ПАДЁЖ"
          }
        }
      },
      "StockMovementRequest": {
        "type": "object",
        "required": [
          "movement_type",
          "batch_id",
          "qty"
        ],
        "properties": {
          "movement_type": {
            "type": "string",
            "enum": [
              "RECEIPT",
              "ISSUE",
              "WRITE_OFF",
              "RETURN"
            ]
          },
          "batch_id": {
            "type": "integer"
          },
          "qty": {
            "type": "number",
            "description": "Положительное количество"
          },
          "write_off_reason_id": {
            "type": "integer",
            "description": "Обязателен для WRITE_OFF"
          },
          "comment": {
            "type": "string",
            "maxLength": 300
          }
        }
      },
      "TaskCreate": {
        "type": "object",
        "required": [
          "task_type_id",
          "title",
          "assigned_to"
        ],
        "properties": {
          "task_type_id": {
            "type": "integer"
          },
          "title": {
            "type": "string",
            "maxLength": 200
          },
          "plot_id": {
            "type": "integer",
            "nullable": true
          },
          "assigned_to": {
            "type": "integer",
            "description": "employee.id"
          },
          "planned_date": {
            "type": "string",
            "format": "date"
          },
          "due_at": {
            "type": "string",
            "format": "date-time"
          },
          "priority": {
            "type": "string",
            "enum": [
              "LOW",
              "NORMAL",
              "HIGH"
            ]
          },
          "group_ids": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          }
        }
      },
      "TaskExecute": {
        "type": "object",
        "required": [
          "group_id"
        ],
        "properties": {
          "group_id": {
            "type": "integer"
          },
          "actual_amount": {
            "type": "number",
            "description": "Фактический расход корма (для кормовых задач)"
          },
          "notes": {
            "type": "string"
          }
        }
      },
      "PlotCreate": {
        "type": "object",
        "required": [
          "plot_no",
          "name",
          "max_head_per_ha",
          "geom_wkt"
        ],
        "properties": {
          "plot_no": {
            "type": "string",
            "maxLength": 16
          },
          "name": {
            "type": "string",
            "maxLength": 80
          },
          "vegetation_type": {
            "type": "string",
            "enum": [
              "культурное",
              "естественное"
            ]
          },
          "max_head_per_ha": {
            "type": "number"
          },
          "rest_days_required": {
            "type": "integer"
          },
          "is_active": {
            "type": "boolean"
          },
          "geom_wkt": {
            "type": "string",
            "description": "POLYGON(...) в SRID 4326"
          }
        }
      },
      "GrazingMove": {
        "type": "object",
        "required": [
          "group_id",
          "plot_id"
        ],
        "properties": {
          "group_id": {
            "type": "integer"
          },
          "plot_id": {
            "type": "integer"
          },
          "note": {
            "type": "string",
            "maxLength": 300
          }
        }
      },
      "UserCreate": {
        "type": "object",
        "required": [
          "login",
          "password",
          "full_name",
          "role_id"
        ],
        "properties": {
          "login": {
            "type": "string",
            "example": "new_user"
          },
          "password": {
            "type": "string",
            "description": "≥8 символов, ≥1 заглавной, ≥1 цифры"
          },
          "full_name": {
            "type": "string"
          },
          "role_id": {
            "type": "integer"
          },
          "employee_id": {
            "type": "integer",
            "nullable": true
          },
          "must_change_pw": {
            "type": "boolean"
          }
        }
      },
      "UserPatch": {
        "type": "object",
        "properties": {
          "full_name": {
            "type": "string"
          },
          "role_id": {
            "type": "integer"
          },
          "employee_id": {
            "type": "integer",
            "nullable": true
          },
          "is_active": {
            "type": "boolean"
          },
          "must_change_pw": {
            "type": "boolean"
          }
        }
      },
      "PasswordReset": {
        "type": "object",
        "required": [
          "password"
        ],
        "properties": {
          "password": {
            "type": "string"
          }
        }
      },
      "SettingPatch": {
        "type": "object",
        "properties": {
          "value": {
            "type": "string"
          },
          "description": {
            "type": "string"
          }
        }
      },
      "BackupCreate": {
        "type": "object",
        "required": [
          "backup_type"
        ],
        "properties": {
          "backup_type": {
            "type": "string",
            "enum": [
              "FULL",
              "INCREMENTAL"
            ]
          },
          "retention_days": {
            "type": "integer",
            "default": 30
          },
          "note": {
            "type": "string"
          }
        }
      },
      "RestoreCreate": {
        "type": "object",
        "required": [
          "backup_job_id",
          "reason"
        ],
        "properties": {
          "backup_job_id": {
            "type": "integer"
          },
          "reason": {
            "type": "string",
            "description": "Причина инцидента"
          }
        }
      },
      "Maintenance": {
        "type": "object",
        "required": [
          "operation"
        ],
        "properties": {
          "operation": {
            "type": "string",
            "enum": [
              "VACUUM",
              "ANALYZE",
              "REINDEX"
            ]
          },
          "note": {
            "type": "string"
          }
        }
      },
      "ReportRow": {
        "type": "object",
        "description": "Строка отчёта (набор полей зависит от отчёта)",
        "additionalProperties": true
      }
    }
  }
}
```

## `middleware/elevated.js`

Строк: 57

```javascript
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
```

## `routes/admin.js`

Строк: 461

```javascript
'use strict';

/**
 * Бизнес-админка (Неделя 6) — /api/v1/admin.
 *
 * Управление пользователями, ролями, правами и настройками хозяйства,
 * а также журналы (бизнес-аудит, сессии, уведомления).
 *
 * Разделение с технадминкой (routes/tech.js): здесь ТОЛЬКО бизнес-контур.
 * Технические роли при изменении обязаны передать X-Override-Reason
 * (middleware elevated) — запись уйдёт в audit_log с is_elevated = TRUE.
 *
 * Пароли — только bcrypt-хэш; password_hash никуда не отдаётся.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { elevated } = require('../middleware/elevated');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const BCRYPT_ROUNDS = 10;
const PW_RE = /^(?=.*[A-ZА-ЯЁ])(?=.*\d).{8,}$/;

// ============================================================================
// Роли и права (справочники RBAC)
// ============================================================================

/** GET /admin/roles — роли с числом прав и пользователей */
router.get('/roles', requirePermission('user:READ', 'role'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT r.id, r.code, r.name, r.role_type, r.is_active,
                    (SELECT count(*) FROM role_permission rp WHERE rp.role_id = r.id) AS permission_count,
                    (SELECT count(*) FROM app_user u WHERE u.role_id = r.id AND NOT u.is_deleted) AS user_count
             FROM role r ORDER BY r.id`);
        res.json({ data: rows, total: rows.length });
    } catch (err) { next(err); }
});

/** GET /admin/roles/:id — роль + её права */
router.get('/roles/:id', requirePermission('user:READ', 'role'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const r = await query('SELECT id, code, name, role_type, is_active FROM role WHERE id = $1', [id]);
        if (!r.rows.length) throw httpError(404, 'Роль не найдена');
        const p = await query(
            `SELECT p.id, p.code, p.object_name, p.action, p.description
             FROM role_permission rp JOIN permission p ON p.id = rp.permission_id
             WHERE rp.role_id = $1 ORDER BY p.code`, [id]);
        res.json({ data: { ...r.rows[0], permissions: p.rows } });
    } catch (err) { next(err); }
});

/** GET /admin/permissions — каталог прав (матрица Роль × Право) */
router.get('/permissions', requirePermission('user:READ', 'permission'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const q = String(req.query.q || '').trim();
        const where = [];
        const params = [];
        if (q) {
            where.push(`(code ILIKE '%' || $1::text || '%' OR object_name ILIKE '%' || $1::text || '%')`);
            params.push(q);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT id, code, object_name, action, description, COUNT(*) OVER() AS total
             FROM permission ${whereSql} ORDER BY code ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

// ============================================================================
// Пользователи
// ============================================================================

const USER_COLS = `u.id, u.login, u.full_name, u.role_id, r.code AS role_code, r.name AS role_name,
                   r.role_type, u.employee_id, e.full_name AS employee_name, u.is_active,
                   u.is_deleted, u.must_change_pw, u.failed_cnt, u.locked_until, u.last_login_at`;
const USER_FROM = `FROM app_user u
                   JOIN role r ON r.id = u.role_id
                   LEFT JOIN employee e ON e.id = u.employee_id`;

const USER_CREATE = {
    login: { type: 'string', required: true, max: 64, pattern: /^[A-Za-z0-9._-]{3,64}$/ },
    password: { type: 'string', required: true, min: 8, pattern: PW_RE,
                message: 'password: минимум 8 символов, хотя бы 1 заглавная и 1 цифра' },
    full_name: { type: 'string', required: true, max: 120 },
    role_id: { type: 'int', required: true },
    employee_id: { type: 'int', nullable: true },
    must_change_pw: { type: 'boolean' },
};
const USER_PATCH = {
    full_name: { type: 'string', max: 120 },
    role_id: { type: 'int' },
    employee_id: { type: 'int', nullable: true },
    is_active: { type: 'boolean' },
    must_change_pw: { type: 'boolean' },
    login: { type: 'reject', message: 'Логин не изменяется (создайте новую учётную запись)' },
    password_hash: { type: 'reject', message: 'Пароль меняется через /admin/users/:id/reset-password' },
    failed_cnt: { type: 'reject', message: 'failed_cnt меняется через /admin/users/:id/unlock' },
    locked_until: { type: 'reject', message: 'locked_until меняется через /admin/users/:id/unlock' },
    is_deleted: { type: 'reject', message: 'Удаление — через DELETE /admin/users/:id' },
};
const PASSWORD_SPECS = {
    password: { type: 'string', required: true, min: 8, pattern: PW_RE,
                message: 'password: минимум 8 символов, хотя бы 1 заглавная и 1 цифра' },
};

async function ensureRole(id) {
    const { rows } = await query('SELECT id FROM role WHERE id = $1', [id]);
    if (!rows.length) throw httpError(400, `Роль ${id} не найдена`);
}
async function ensureEmployee(id) {
    if (id == null) return;
    const { rows } = await query('SELECT id FROM employee WHERE id = $1 AND NOT is_deleted', [id]);
    if (!rows.length) throw httpError(400, `Сотрудник ${id} не найден`);
}

/** GET /admin/users — реестр учётных записей (без хэшей паролей) */
router.get('/users', requirePermission('user:READ', 'app_user'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'login', 'full_name', 'last_login_at', 'is_active']), 'login');
        const q = String(req.query.q || '').trim();
        const roleId = asInt(req.query.role_id) || 0;
        const includeDeleted = req.query.include_deleted === 'true';
        const where = [];
        const params = [];
        where.push(`($${params.length + 1}::boolean OR NOT u.is_deleted)`); params.push(includeDeleted);
        if (q) {
            where.push(`(u.login ILIKE '%' || $${params.length + 1}::text || '%'
                        OR u.full_name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (roleId) { where.push(`u.role_id = $${params.length + 1}::int`); params.push(roleId); }
        const { rows } = await query(
            `SELECT ${USER_COLS}, COUNT(*) OVER() AS total ${USER_FROM}
             WHERE ${where.join(' AND ')}
             ORDER BY u.${sort} ${desc ? 'DESC' : 'ASC'}, u.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /admin/users/:id */
router.get('/users/:id', requirePermission('user:READ', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(`SELECT ${USER_COLS} ${USER_FROM} WHERE u.id = $1`, [id]);
        if (!rows.length) throw httpError(404, 'Пользователь не найден');
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** POST /admin/users — создать учётную запись (bcrypt-хэш) */
router.post('/users', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, USER_CREATE);
        await ensureRole(v.role_id);
        await ensureEmployee(v.employee_id);
        const hash = await bcrypt.hash(v.password, BCRYPT_ROUNDS);
        const { rows } = await query(
            `INSERT INTO app_user (login, password_hash, full_name, role_id, employee_id, must_change_pw)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, login, full_name, role_id, employee_id, is_active, must_change_pw`,
            [v.login, hash, v.full_name, v.role_id, v.employee_id ?? null, v.must_change_pw ?? true]);
        await writeAudit(req, { entityName: 'app_user', entityId: rows[0].id, action: 'CREATE', after: rows[0] });
        res.status(201).json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** PATCH /admin/users/:id — изменить реквизиты */
router.patch('/users/:id', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, USER_PATCH, { partial: true });
        const keys = Object.keys(v);
        if (!keys.length) throw httpError(400, 'Нет полей для изменения');
        if (v.role_id !== undefined) await ensureRole(v.role_id);
        if (v.employee_id !== undefined) await ensureEmployee(v.employee_id);

        const row = await withTransaction(async (client) => {
            const cur = await client.query(
                'SELECT * FROM app_user WHERE id = $1 AND NOT is_deleted FOR UPDATE', [id]);
            if (!cur.rows.length) throw httpError(404, 'Пользователь не найден');
            const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
            const upd = await client.query(
                `UPDATE app_user SET ${sets} WHERE id = $1 RETURNING *`,
                [id, ...keys.map((k) => v[k])]);
            return { before: cur.rows[0], after: upd.rows[0] };
        });
        const pick = (o) => Object.fromEntries(keys.map((k) => [k, o[k]]));
        await writeAudit(req, { entityName: 'app_user', entityId: id, action: 'UPDATE',
                                before: pick(row.before), after: pick(row.after) });
        const { password_hash: _h, ...safe } = row.after;
        res.json({ data: safe });
    } catch (err) { next(err); }
});

/** POST /admin/users/:id/reset-password — смена пароля */
router.post('/users/:id/reset-password', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, PASSWORD_SPECS);
        const hash = await bcrypt.hash(v.password, BCRYPT_ROUNDS);
        const { rows } = await query(
            `UPDATE app_user SET password_hash = $2, must_change_pw = TRUE, failed_cnt = 0, locked_until = NULL
             WHERE id = $1 AND NOT is_deleted RETURNING id, login`, [id, hash]);
        if (!rows.length) throw httpError(404, 'Пользователь не найден');
        await writeAudit(req, { entityName: 'app_user', entityId: id, action: 'UPDATE',
                                after: { password: '***', must_change_pw: true } });
        res.json({ data: rows[0], message: 'Пароль изменён; при следующем входе потребуется смена' });
    } catch (err) { next(err); }
});

/** POST /admin/users/:id/unlock — снять временную блокировку */
router.post('/users/:id/unlock', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `UPDATE app_user SET failed_cnt = 0, locked_until = NULL
             WHERE id = $1 AND NOT is_deleted RETURNING id, login`, [id]);
        if (!rows.length) throw httpError(404, 'Пользователь не найден');
        await writeAudit(req, { entityName: 'app_user', entityId: id, action: 'UPDATE',
                                after: { failed_cnt: 0, locked_until: null } });
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** DELETE /admin/users/:id — мягкое удаление + отзыв всех сессий (атомарно) */
router.delete('/users/:id', elevated('user:WRITE', 'app_user'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        if (id === req.user.id) throw httpError(400, 'Нельзя удалить собственную учётную запись');
        const row = await withTransaction(async (client) => {
            const upd = await client.query(
                `UPDATE app_user SET is_deleted = TRUE, is_active = FALSE
                 WHERE id = $1 AND NOT is_deleted RETURNING id, login`, [id]);
            if (!upd.rows.length) throw httpError(404, 'Пользователь не найден');
            const ses = await client.query(
                `UPDATE user_session SET revoked_at = now()
                 WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
            return { user: upd.rows[0], revoked: ses.rowCount };
        });
        await writeAudit(req, { entityName: 'app_user', entityId: id, action: 'DELETE',
                                before: row.user, after: { sessions_revoked: row.revoked } });
        res.json({ data: { id, is_deleted: true, sessions_revoked: row.revoked } });
    } catch (err) { next(err); }
});

// ============================================================================
// Настройки хозяйства
// ============================================================================

/** GET /admin/settings */
router.get('/settings', requirePermission('settings:READ', 'farm_settings'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT s.id, s.setting_key, s.value_type, s.value_text, s.value_num, s.description,
                    s.updated_at, u.login AS updated_by_login
             FROM farm_settings s JOIN app_user u ON u.id = s.updated_by
             ORDER BY s.setting_key`);
        res.json({ data: rows, total: rows.length });
    } catch (err) { next(err); }
});

/** PATCH /admin/settings/:key — изменение параметра (тип контролируется БД) */
router.patch('/settings/:key', elevated('settings:WRITE', 'farm_settings'), async (req, res, next) => {
    try {
        const key = String(req.params.key || '').trim();
        if (!key) throw httpError(400, 'Не указан ключ настройки');
        const v = validate(req.body || {}, {
            value: { type: 'string', required: false },
            description: { type: 'string', max: 500 },
        }, { partial: true });
        if (v.value === undefined && v.description === undefined) throw httpError(400, 'Нет полей для изменения');

        const cur = await query('SELECT * FROM farm_settings WHERE setting_key = $1 FOR UPDATE', [key]);
        if (!cur.rows.length) throw httpError(404, `Настройка «${key}» не найдена`);
        const s = cur.rows[0];
        let textVal = s.value_text;
        let numVal = s.value_num;
        if (v.value !== undefined) {
            if (s.value_type === 'NUM') {
                const n = Number(v.value);
                if (!Number.isFinite(n)) throw httpError(400, `Настройка «${key}» имеет тип NUM — ожидается число`);
                numVal = n; textVal = null;
            } else {
                if (s.value_type === 'BOOL' && !['true', 'false', '1', '0'].includes(v.value.toLowerCase())) {
                    throw httpError(400, `Настройка «${key}» имеет тип BOOL — ожидается true/false`);
                }
                if (s.value_type === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(v.value)) {
                    throw httpError(400, `Настройка «${key}» имеет тип DATE — ожидается ГГГГ-ММ-ДД`);
                }
                textVal = v.value; numVal = null;
            }
        }
        const sets = ['value_text = $2', 'value_num = $3', 'updated_by = $4', 'updated_at = now()'];
        const params = [key, textVal, numVal, req.user.id];
        if (v.description !== undefined) { sets.push(`description = $${params.length + 1}`); params.push(v.description); }
        const upd = await query(
            `UPDATE farm_settings SET ${sets.join(', ')} WHERE setting_key = $1 RETURNING *`, params);
        await writeAudit(req, { entityName: 'farm_settings', entityId: upd.rows[0].id, action: 'UPDATE',
                                before: { value_text: s.value_text, value_num: s.value_num },
                                after: { value_text: textVal, value_num: numVal } });
        res.json({ data: upd.rows[0] });
    } catch (err) { next(err); }
});

// ============================================================================
// Журналы и уведомления
// ============================================================================

/** Сборка WHERE для audit_log (переиспользуется списком и CSV-экспортом). */
function auditWhere(req) {
    const where = [];
    const params = [];
    const add = (sql, val) => { where.push(sql.replace('$N', `$${params.length + 1}`)); params.push(val); };
    const userId = asInt(req.query.user_id) || 0;
    const entity = String(req.query.entity_name || '').trim();
    const action = String(req.query.action || '').trim();
    const q = String(req.query.q || '').trim();
    const dateFrom = String(req.query.date_from || '').trim();
    const dateTo = String(req.query.date_to || '').trim();
    const elevatedOnly = req.query.is_elevated === 'true';
    if (userId) add('a.user_id = $N::int', userId);
    if (entity) add('a.entity_name = $N::text', entity);
    if (action) add('a.action = $N::text', action);
    if (q) add(`(a.override_reason ILIKE '%' || $N::text || '%'
                OR u.login ILIKE '%' || $N::text || '%')`, q);
    if (dateFrom) add('a.occurred_at >= $N::timestamptz', dateFrom);
    if (dateTo) add('a.occurred_at < ($N::timestamptz + interval \'1 day\')', dateTo);
    if (elevatedOnly) where.push('a.is_elevated');
    return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const AUDIT_SELECT = `SELECT a.id, a.occurred_at, a.user_id, u.login, u.full_name,
                             r.code AS role_code, a.entity_name, a.entity_id, a.action,
                             a.before_json, a.after_json, a.ip::text AS ip, a.user_agent,
                             a.is_elevated, a.override_reason
                      FROM audit_log a
                      JOIN app_user u ON u.id = a.user_id
                      JOIN role r ON r.id = u.role_id`;

/** GET /admin/audit-log — журнал бизнес-аудита */
router.get('/audit-log', requirePermission('audit:READ', 'audit_log'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { whereSql, params } = auditWhere(req);
        const { rows } = await query(
            `${AUDIT_SELECT}, COUNT(*) OVER() AS total ${whereSql.replace(/^(WHERE)/, '$1')}
             ORDER BY a.occurred_at DESC, a.id DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** CSV-экранирование (RFC 4180 + BOM для Excel). */
function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}

/** GET /admin/audit-log/export — выгрузка журнала в CSV */
router.get('/audit-log/export', requirePermission('export:EXEC', 'audit_log'), async (req, res, next) => {
    try {
        const { whereSql, params } = auditWhere(req);
        const { rows } = await query(
            `${AUDIT_SELECT} ${whereSql} ORDER BY a.occurred_at DESC, a.id DESC LIMIT 10000`, params);
        const head = ['id', 'occurred_at', 'login', 'full_name', 'role_code', 'entity_name',
                      'entity_id', 'action', 'before_json', 'after_json', 'ip', 'user_agent',
                      'is_elevated', 'override_reason'];
        const lines = [head.join(';')];
        for (const r of rows) lines.push(head.map((h) => csvCell(r[h])).join(';'));
        await writeAudit(req, { entityName: 'audit_log', entityId: 0, action: 'EXPORT',
                                after: { rows: rows.length, format: 'csv' } });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
        res.send('\uFEFF' + lines.join('\r\n'));
    } catch (err) { next(err); }
});

/** GET /admin/sessions — активные сессии (без token_hash) */
router.get('/sessions', requirePermission('user:READ', 'user_session'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const userId = asInt(req.query.user_id) || 0;
        const activeOnly = req.query.active_only !== 'false';
        const where = [];
        const params = [];
        if (userId) { where.push(`s.user_id = $${params.length + 1}::int`); params.push(userId); }
        if (activeOnly) where.push('s.revoked_at IS NULL AND s.expires_at > now()');
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT s.id, s.user_id, u.login, s.ip::text AS ip, s.user_agent,
                    s.issued_at, s.expires_at, s.revoked_at, COUNT(*) OVER() AS total
             FROM user_session s JOIN app_user u ON u.id = s.user_id
             ${whereSql} ORDER BY s.issued_at DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /admin/notifications — уведомления ТЕКУЩЕГО пользователя */
router.get('/notifications', async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const unreadOnly = req.query.unread_only === 'true';
        const where = ['n.user_id = $1'];
        const params = [req.user.id];
        if (unreadOnly) where.push('NOT n.is_read');
        const { rows } = await query(
            `SELECT n.id, n.type, n.message, n.related_entity, n.related_id,
                    n.is_read, n.created_at, COUNT(*) OVER() AS total
             FROM notification n WHERE ${where.join(' AND ')}
             ORDER BY n.created_at DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** PATCH /admin/notifications/:id/read — пометить прочитанным (только своё) */
router.patch('/notifications/:id/read', async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `UPDATE notification SET is_read = TRUE WHERE id = $1 AND user_id = $2
             RETURNING id, is_read`, [id, req.user.id]);
        if (!rows.length) throw httpError(404, 'Уведомление не найдено');
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

module.exports = router;
```

## `routes/catalog.js`

Строк: 311

```javascript
'use strict';

/**
 * Справочники (Неделя 5) — универсальная CRUD-фабрика + конфигурации.
 *
 * Каждый справочник описывается декларативной конфигурацией и получает единый
 * набор маршрутов: список (пагинация/поиск/сортировка), карточка, создание,
 * изменение, удаление (жёсткое или мягкое). Валидация — через src/validation.js,
 * write-операции идут в транзакции, изменения пишутся в audit_log.
 *
 * Маппинг прав (Неделя 6): справочники используют выделенные `catalog:READ/WRITE`,
 * персонал — `employee:READ/WRITE`. Технические роли изолированы: DBA имеет только
 * чтение справочников/персонала, но не запись в бизнес-реестры.
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

/** Проверить существование FK-ссылок (для полей, переданных в теле). */
async function checkFks(fks, v) {
    if (!fks) return;
    for (const fk of fks) {
        if (v[fk.field] === undefined || v[fk.field] === null) continue;
        const { rows } = await query(`SELECT 1 FROM ${fk.table} WHERE id = $1`, [v[fk.field]]);
        if (!rows.length) throw httpError(400, `${fk.label || fk.table} ${v[fk.field]} не найден`);
    }
}

/**
 * cfg = {
 *   table, label, read, write, delete?, softDelete?, fields, fks?,
 *   search? (столбцы ILIKE), sortable?, defaultSort?
 * }
 */
function makeCatalog(cfg) {
    const router = express.Router();
    const table = cfg.table;
    const pk = cfg.pk || 'id';
    const label = cfg.label || table;
    const soft = cfg.softDelete || null;
    const searchCols = cfg.search || ['code', 'name'];
    const sortable = cfg.sortable || new Set([pk, 'code', 'name']);
    const defaultSort = cfg.defaultSort || 'code';

    // ---- Список -------------------------------------------------------------
    router.get('/', requirePermission(cfg.read, label), async (req, res, next) => {
        try {
            const { limit, offset } = parsePaging(req.query);
            const { sort, desc } = parseSort(req.query, sortable, defaultSort);
            const q = String(req.query.q || '').trim();
            const includeDeleted = req.query.include_deleted === 'true';

            const where = [];
            const params = [];
            if (soft) {
                where.push(`($${params.length + 1}::boolean OR NOT ${soft})`);
                params.push(includeDeleted);
            }
            if (q) {
                const terms = searchCols.map(() => `$${params.length + 1}::text`);
                where.push(`(${searchCols.map((c, i) => `${c}::text ILIKE '%' || ${terms[i]} || '%'`).join(' OR ')})`);
                params.push(q);
            }
            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const { rows } = await query(
                `SELECT *, COUNT(*) OVER() AS total FROM ${table}
                 ${whereSql}
                 ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, ${pk} ASC
                 LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
                [...params, limit, offset]
            );
            const total = rows.length ? Number(rows[0].total) : 0;
            res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
        } catch (err) { next(err); }
    });

    // ---- Карточка -----------------------------------------------------------
    router.get('/:id', requirePermission(cfg.read, label), async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const { rows } = await query(`SELECT * FROM ${table} WHERE ${pk} = $1`, [id]);
            if (!rows.length) throw httpError(404, `${label} не найден`);
            res.json({ data: rows[0] });
        } catch (err) { next(err); }
    });

    // ---- Создание -----------------------------------------------------------
    router.post('/', requirePermission(cfg.write, label), async (req, res, next) => {
        try {
            const v = validate(req.body || {}, cfg.fields);
            await checkFks(cfg.fks, v);
            const cols = Object.keys(v);
            if (!cols.length) throw httpError(400, 'Нет полей для создания');
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
            const { rows } = await query(
                `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
                cols.map((c) => v[c])
            );
            await writeAudit(req, { entityName: table, entityId: rows[0][pk], action: 'CREATE', after: rows[0] });
            res.status(201).json({ data: rows[0] });
        } catch (err) { next(err); }
    });

    // ---- Изменение (транзакция + FOR UPDATE) --------------------------------
    router.patch('/:id', requirePermission(cfg.write, label), async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const v = validate(req.body || {}, cfg.fields, { partial: true });
            const keys = Object.keys(v);
            if (!keys.length) throw httpError(400, 'Нет полей для изменения');
            await checkFks(cfg.fks, v);

            const row = await withTransaction(async (client) => {
                const cur = await client.query(
                    `SELECT * FROM ${table} WHERE ${pk} = $1${soft ? ` AND NOT ${soft}` : ''} FOR UPDATE`, [id]);
                if (!cur.rows.length) throw httpError(404, `${label} не найден`);
                const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
                const upd = await client.query(
                    `UPDATE ${table} SET ${sets} WHERE ${pk} = $1 RETURNING *`,
                    [id, ...keys.map((k) => v[k])]
                );
                return { before: cur.rows[0], after: upd.rows[0] };
            });

            const before = keys.reduce((o, k) => { o[k] = row.before[k]; return o; }, {});
            const after = keys.reduce((o, k) => { o[k] = row.after[k]; return o; }, {});
            await writeAudit(req, { entityName: table, entityId: id, action: 'UPDATE', before, after });
            res.json({ data: row.after });
        } catch (err) { next(err); }
    });

    // ---- Удаление (мягкое или жёсткое) --------------------------------------
    router.delete('/:id', requirePermission(cfg.delete || cfg.write, label), async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            if (soft) {
                const { rows } = await query(
                    `UPDATE ${table} SET ${soft} = TRUE WHERE ${pk} = $1 AND NOT ${soft} RETURNING ${pk}`, [id]);
                if (!rows.length) throw httpError(404, `${label} не найден`);
                await writeAudit(req, { entityName: table, entityId: id, action: 'DELETE', before: rows[0] });
                res.json({ data: { id, [soft]: true } });
            } else {
                const { rows } = await query(
                    `DELETE FROM ${table} WHERE ${pk} = $1 RETURNING ${pk}`, [id]);
                if (!rows.length) throw httpError(404, `${label} не найден`);
                await writeAudit(req, { entityName: table, entityId: id, action: 'DELETE', before: rows[0] });
                res.json({ data: { id, deleted: true } });
            }
        } catch (err) { next(err); }
    });

    return router;
}

/** Препараты — подтип nomenclature (shared PK): только чтение с JOIN. */
function drugRouter() {
    const router = express.Router();
    const SELECT = `SELECT d.nomenclature_id AS id, d.withdrawal_days, d.withdrawal_milk_days,
                           d.is_vaccine, d.storage_note, n.sku, n.name, n.category, n.uom_id`;

    router.get('/', requirePermission('health:READ', 'препарат'), async (req, res, next) => {
        try {
            const { limit, offset } = parsePaging(req.query);
            const q = String(req.query.q || '').trim();
            const where = [];
            const params = [];
            if (q) {
                where.push(`(n.name ILIKE '%' || $1::text || '%' OR n.sku ILIKE '%' || $1::text || '%')`);
                params.push(q);
            }
            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const { rows } = await query(
                `${SELECT}, COUNT(*) OVER() AS total
                 FROM drug d JOIN nomenclature n ON n.id = d.nomenclature_id
                 ${whereSql}
                 ORDER BY n.name ASC, d.nomenclature_id ASC
                 LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
                [...params, limit, offset]
            );
            const total = rows.length ? Number(rows[0].total) : 0;
            res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
        } catch (err) { next(err); }
    });

    router.get('/:id', requirePermission('health:READ', 'препарат'), async (req, res, next) => {
        try {
            const id = asInt(req.params.id);
            if (id == null) throw httpError(400, 'Некорректный id');
            const { rows } = await query(
                `${SELECT} FROM drug d JOIN nomenclature n ON n.id = d.nomenclature_id WHERE d.nomenclature_id = $1`, [id]);
            if (!rows.length) throw httpError(404, 'Препарат не найден');
            res.json({ data: rows[0] });
        } catch (err) { next(err); }
    });

    return router;
}

// ============================================================================
// Конфигурации справочников
// ============================================================================

const catalogs = [
    { path: '/species', table: 'species', label: 'вид', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 16, pattern: /^[A-Za-z0-9_-]{1,16}$/ },
          name: { type: 'string', required: true, max: 64 },
      } },
    { path: '/breeds', table: 'breed', label: 'порода', read: 'catalog:READ', write: 'catalog:WRITE',
      search: ['name'], sortable: new Set(['id', 'name']), defaultSort: 'name',
      fields: {
          species_id: { type: 'int', required: true },
          name: { type: 'string', required: true, max: 80 },
          avg_daily_gain: { type: 'decimal', nullable: true },
      },
      fks: [{ field: 'species_id', table: 'species', label: 'Вид' }] },
    { path: '/positions', table: 'position', label: 'должность', read: 'employee:READ', write: 'employee:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 80 },
      } },
    { path: '/employees', table: 'employee', label: 'сотрудник', read: 'employee:READ', write: 'employee:WRITE',
      softDelete: 'is_deleted',
      search: ['full_name', 'phone'], sortable: new Set(['id', 'full_name', 'hire_date', 'is_active']), defaultSort: 'full_name',
      fields: {
          full_name: { type: 'string', required: true, max: 120 },
          position_id: { type: 'int', required: true },
          phone: { type: 'string', max: 24, nullable: true },
          hire_date: { type: 'date', maxToday: true },
          is_active: { type: 'boolean' },
      },
      fks: [{ field: 'position_id', table: 'position', label: 'Должность' }] },
    { path: '/diagnoses', table: 'diagnosis', label: 'диагноз', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 160 },
          category: { type: 'string', max: 64, nullable: true },
      } },
    { path: '/uoms', table: 'uom', label: 'единица измерения', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 16, pattern: /^[A-Za-z0-9_-]{1,16}$/ },
          name: { type: 'string', required: true, max: 48 },
          uom_type: { type: 'enum', required: true, values: ['MASS', 'VOLUME', 'COUNT'] },
      } },
    { path: '/movement-types', table: 'movement_type', label: 'тип движения', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 64 },
          direction: { type: 'enum', required: true, values: ['IN', 'OUT'] },
      } },
    { path: '/write-off-reasons', table: 'write_off_reason', label: 'причина списания', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 120 },
      } },
    { path: '/disposal-reasons', table: 'disposal_reason', label: 'причина выбытия', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 120 },
          reason_type: { type: 'enum', required: true, values: ['CULLING', 'DEATH'] },
      } },
    { path: '/task-types', table: 'task_type', label: 'тип задачи', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 80 },
          requires_writeoff: { type: 'boolean' },
          default_priority: { type: 'int' },
      } },
    { path: '/suppliers', table: 'supplier', label: 'поставщик', read: 'catalog:READ', write: 'catalog:WRITE',
      softDelete: 'is_deleted',
      search: ['name', 'contact_person', 'email'], sortable: new Set(['id', 'name']), defaultSort: 'name',
      fields: {
          name: { type: 'string', required: true, max: 160 },
          contact_person: { type: 'string', max: 120, nullable: true },
          phone: { type: 'string', max: 24, nullable: true },
          email: { type: 'string', max: 120, nullable: true },
      } },
    { path: '/warehouses', table: 'warehouse', label: 'склад', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 16, pattern: /^[A-Za-z0-9_-]{1,16}$/ },
          name: { type: 'string', required: true, max: 80 },
          is_active: { type: 'boolean' },
      } },
    { path: '/product-types', table: 'product_type', label: 'вид продукции', read: 'catalog:READ', write: 'catalog:WRITE',
      fields: {
          code: { type: 'string', required: true, max: 24, pattern: /^[A-Za-z0-9_-]{1,24}$/ },
          name: { type: 'string', required: true, max: 80 },
          uom_id: { type: 'int', required: true },
      },
      fks: [{ field: 'uom_id', table: 'uom', label: 'Единица измерения' }] },
];

/** Зарегистрировать все справочники. Возвращает карту table -> path. */
function registerCatalogs(app, basePath = '/api/v1') {
    const routes = {};
    for (const cfg of catalogs) {
        app.use(`${basePath}${cfg.path}`, makeCatalog(cfg));
        routes[cfg.table] = cfg.path;
    }
    app.use(`${basePath}/drugs`, drugRouter());
    routes.drug = '/drugs';
    return routes;
}

module.exports = { makeCatalog, drugRouter, registerCatalogs, catalogs };
```

## `routes/pastures.js`

Строк: 146

```javascript
'use strict';

/**
 * Пастбища (Неделя 5): участки/загоны (PostGIS) и назначение выпаса.
 *
 * Площадь участка (area_ha) считается автоматически триггером по контуру
 * полигона (ST_Area от geography) — не вводится вручную (ТЗ п.3.4). Назначение
 * выпаса вызывает `sp_move_group_to_plot`: проверка нормы нагрузки голов/га и
 * периода отдыха участка, закрытие предыдущего активного выпаса — всё в одной
 * транзакции с откатом при нарушении.
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const PLOT_SPECS = {
    plot_no: { type: 'string', required: true, max: 16 },
    name: { type: 'string', required: true, max: 80 },
    vegetation_type: { type: 'enum', values: ['культурное', 'естественное'] },
    max_head_per_ha: { type: 'decimal', required: true, min: 0.001 },
    rest_days_required: { type: 'int' },
    is_active: { type: 'boolean' },
    geom_wkt: { type: 'string', required: true },
};

const MOVE_SPECS = {
    group_id: { type: 'int', required: true },
    plot_id: { type: 'int', required: true },
    note: { type: 'string', max: 300, nullable: true },
};

const PLOT_COLS = `p.id, p.plot_no, p.name, p.area_ha, p.vegetation_type,
                   p.max_head_per_ha, p.rest_days_required, p.is_active, p.is_deleted`;

/** GET /api/v1/pasture-plots — участки + текущая загрузка (активные головы) */
router.get('/pasture-plots', requirePermission('pasture:READ', 'pasture'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'plot_no', 'name', 'area_ha', 'max_head_per_ha']), 'plot_no');
        const q = String(req.query.q || '').trim();
        const includeDeleted = req.query.include_deleted === 'true';

        const where = [];
        const params = [];
        where.push(`($${params.length + 1}::boolean OR NOT p.is_deleted)`);
        params.push(includeDeleted);
        if (q) {
            where.push(`(p.plot_no ILIKE '%' || $${params.length + 1}::text || '%'
                        OR p.name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        const whereSql = `WHERE ${where.join(' AND ')}`;

        const { rows } = await query(
            `SELECT ${PLOT_COLS},
                    (SELECT COALESCE(SUM(head_count_snapshot), 0) FROM grazing_event ge
                      WHERE ge.plot_id = p.id AND ge.ended_at IS NULL) AS active_head_count,
                    COUNT(*) OVER() AS total
             FROM pasture_plot p
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, p.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /api/v1/pasture-plots/:id — карточка участка (+ WKT контура) */
router.get('/pasture-plots/:id', requirePermission('pasture:READ', 'pasture'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `SELECT ${PLOT_COLS}, ST_AsText(p.geom) AS geom_wkt,
                    (SELECT COALESCE(SUM(head_count_snapshot), 0) FROM grazing_event ge
                      WHERE ge.plot_id = p.id AND ge.ended_at IS NULL) AS active_head_count
             FROM pasture_plot p WHERE p.id = $1`, [id]);
        if (!rows.length) throw httpError(404, 'Участок не найден');
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** POST /api/v1/pasture-plots — создать участок (площадь считается триггером) */
router.post('/pasture-plots', requirePermission('pasture:WRITE', 'pasture'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, PLOT_SPECS);
        if (!/^(MULTI)?POLYGON/i.test(v.geom_wkt.trim())) {
            throw httpError(400, 'geom_wkt: ожидается WKT-полигон (POLYGON/MULTIPOLYGON)');
        }
        const { rows } = await query(
            `INSERT INTO pasture_plot (plot_no, name, geom, vegetation_type, max_head_per_ha, rest_days_required, is_active)
             VALUES ($1, $2, ST_GeomFromText($3, 4326), $4, $5, $6, $7)
             RETURNING id, plot_no, name, area_ha, vegetation_type, max_head_per_ha, rest_days_required, is_active, is_deleted`,
            [v.plot_no, v.name, v.geom_wkt.trim(), v.vegetation_type || 'естественное',
             v.max_head_per_ha, v.rest_days_required ?? 20, v.is_active ?? true]
        );
        await writeAudit(req, { entityName: 'pasture_plot', entityId: rows[0].id, action: 'CREATE', after: rows[0] });
        res.status(201).json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** DELETE /api/v1/pasture-plots/:id — мягкое удаление */
router.delete('/pasture-plots/:id', requirePermission('pasture:WRITE', 'pasture'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            'UPDATE pasture_plot SET is_deleted = TRUE WHERE id = $1 AND NOT is_deleted RETURNING id', [id]);
        if (!rows.length) throw httpError(404, 'Участок не найден');
        await writeAudit(req, { entityName: 'pasture_plot', entityId: id, action: 'DELETE', before: rows[0] });
        res.json({ data: { id, is_deleted: true } });
    } catch (err) { next(err); }
});

/**
 * POST /api/v1/grazing/move — перевод группы на участок (sp_move_group_to_plot).
 * Отдых участка + норма нагрузки проверяются на сервере; при нарушении —
 * транзакция откатывается (закрытие предыдущего выпаса тоже отменяется).
 */
router.post('/grazing/move', requirePermission('pasture:WRITE', 'pasture'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, MOVE_SPECS);
        const row = await withTransaction(async (client) => {
            const r = await client.query(
                `SELECT sp_move_group_to_plot($1, $2, $3, $4) AS event_id`,
                [v.group_id, v.plot_id, req.user.id, v.note ?? null]
            );
            return r.rows[0];
        });
        await writeAudit(req, {
            entityName: 'grazing_event', entityId: row.event_id, action: 'CREATE',
            after: { group_id: v.group_id, plot_id: v.plot_id },
        });
        res.status(201).json({ data: { event_id: row.event_id, group_id: v.group_id, plot_id: v.plot_id } });
    } catch (err) { next(err); }
});

module.exports = router;
```

## `routes/reports.js`

Строк: 321

```javascript
'use strict';

/**
 * Подсистема статистики и отчётности (Неделя 8) — /api/v1/reports.
 *
 * Управленческие: cost-fcr, herd-health, pasture-load.
 * Операционные: tasks-in-work, stock-turnover.
 * Каждый отчёт: ?format=json (по умолчанию) | csv; ?from= / ?to= — период.
 * series — готовые данные для визуализаций (диаграммы/графики), экспорт CSV.
 * Доступ: report:READ; экспорт дополнительно требует export:EXEC.
 */

const express = require('express');
const http = require('http');
const { query } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError } = require('../validation');

const router = express.Router();

function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
}
function toCsv(rows) {
    if (!rows.length) return '';
    const head = Object.keys(rows[0]);
    return [head.join(';'), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(';'))].join('\r\n');
}
async function respond(req, res, next, name, rows, series) {
    try {
        const fmt = String(req.query.format || 'json').toLowerCase();
        if (fmt === 'csv') {
            if (!req.user.permissions.has('export:EXEC')) {
                return res.status(403).json({ error: 'Экспорт требует право export:EXEC', kind: 'forbidden' });
            }
            await writeAudit(req, { entityName: 'report', entityId: 0, action: 'EXPORT',
                                    after: { report: name, format: 'csv', rows: rows.length } });
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
            return res.send('\uFEFF' + toCsv(rows));
        }
        if (fmt !== 'json') throw httpError(400, 'format: допустимо json или csv');
        res.json({ report: name, params: { from: req.query.from || null, to: req.query.to || null,
                                          group_id: req.query.group_id || null },
                   total: rows.length, data: rows, ...(series ? { series } : {}) });
    } catch (err) { next(err); }
}

/** Период по умолчанию — последние 12 месяцев. */
function period(req) {
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    return { from: from || null, to: to || null };
}
const P = (req) => [period(req).from, period(req).to];

// ---------------------------------------------------------------------------
// 1. Себестоимость и конверсия корма (FCR)
// ---------------------------------------------------------------------------
router.get('/cost-fcr', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT pgc.group_id, g.name AS group_name,
                    pc.period_month,
                    pgc.feed_qty, pgc.feed_cost, pgc.treatment_cost,
                    pgc.head_days, pgc.gain_kg, pgc.fcr
             FROM period_group_cost pgc
             JOIN period_closure pc ON pc.id = pgc.period_closure_id
             JOIN animal_group g ON g.id = pgc.group_id
             WHERE ($1::date IS NULL OR pc.period_month >= $1::date)
               AND ($2::date IS NULL OR pc.period_month <= $2::date)
               AND ($3::int = 0 OR pgc.group_id = $3::int)
             ORDER BY pc.period_month DESC, g.name`,
            [...P(req), Number(req.query.group_id) || 0]);
        const byMonth = {};
        for (const r of rows) {
            const k = String(r.period_month).slice(0, 7);
            byMonth[k] = byMonth[k] || { period: k, feed_cost: 0, feed_qty: 0, gain_kg: 0 };
            byMonth[k].feed_cost += Number(r.feed_cost);
            byMonth[k].feed_qty += Number(r.feed_qty);
            byMonth[k].gain_kg += Number(r.gain_kg);
        }
        const series = Object.values(byMonth).sort((a, b) => a.period.localeCompare(b.period));
        await respond(req, res, next, 'cost-fcr', rows, { by_month: series });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 2. Здоровье поголовья
// ---------------------------------------------------------------------------
router.get('/herd-health', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT a.id, a.inventory_number, a.status, a.group_id, g.name AS group_name,
                    b.name AS breed, a.birth_date, a.arrival_date
             FROM animal a
             JOIN breed b ON b.id = a.breed_id
             LEFT JOIN animal_group g ON g.id = a.group_id
             WHERE NOT a.is_deleted
             ORDER BY a.status, a.inventory_number`);
        const byStatus = {};
        for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        const { rows: vac } = await query(
            `SELECT count(*)::int AS total_overdue,
                    count(DISTINCT animal_id)::int AS animals_overdue
             FROM v_vaccination_overdue`);
        const { rows: disp } = await query(
            `SELECT dr.reason_type, count(*)::int AS cnt
             FROM disposal_event de JOIN disposal_reason dr ON dr.id = de.reason_id
             GROUP BY dr.reason_type`);
        const total = rows.length || 1;
        const sick = (byStatus['НА_ЛЕЧЕНИИ'] || 0) + (byStatus['НА_ОСМОТРЕ'] || 0)
                   + (byStatus['НА_КАРАНТИНЕ'] || 0);
        const summary = {
            total_animals: rows.length,
            sick_or_quarantine: sick,
            sick_share_pct: +(sick * 100 / total).toFixed(2),
            healthy: byStatus['ЗДОРОВ'] || 0,
            culled: byStatus['ВЫБРАКОВАНО'] || 0,
            dead: byStatus['ПАДЁЖ'] || 0,
            vaccination_overdue: vac[0].total_overdue,
            animals_vaccination_overdue: vac[0].animals_overdue,
        };
        const series = { by_status: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
                         by_disposal: disp };
        const out = [{ metric: 'summary', ...summary }].concat(
            Object.entries(byStatus).map(([status, count]) => ({ metric: 'status', status, count })));
        await respond(req, res, next, 'herd-health', out, { ...series, summary });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 3. Нагрузка на пастбища
// ---------------------------------------------------------------------------
router.get('/pasture-load', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT p.id AS plot_id, p.plot_no, p.name, p.area_ha, p.max_head_per_ha,
                    p.rest_days_required, p.vegetation_type,
                    COALESCE(SUM(CASE WHEN ge.ended_at IS NULL THEN ge.head_count_snapshot END), 0)::int AS active_heads,
                    bool_or(ge.ended_at IS NULL) AS in_use,
                    MAX(ge.ended_at) AS last_grazing_end,
                    COALESCE(SUM(ge.head_count_snapshot), 0)::int AS total_heads_all_time,
                    COUNT(ge.id)::int AS grazing_events
             FROM pasture_plot p
             LEFT JOIN grazing_event ge ON ge.plot_id = p.id
             WHERE NOT p.is_deleted
             GROUP BY p.id, p.plot_no, p.name, p.area_ha, p.max_head_per_ha,
                      p.rest_days_required, p.vegetation_type
             ORDER BY p.plot_no`);
        const { rows: rest } = await query('SELECT plot_id, ended_at, is_rested FROM v_plot_rest_status');
        const restMap = Object.fromEntries(rest.map((r) => [r.plot_id, r]));
        const data = rows.map((r) => {
            const load = r.area_ha > 0 ? r.active_heads / Number(r.area_ha) : 0;
            const norm = Number(r.max_head_per_ha);
            const st = restMap[r.plot_id];
            return { ...r, load_head_per_ha: +load.toFixed(3),
                     norm_head_per_ha: norm,
                     over_limit: load > norm,
                     rest_ok: st ? st.is_rested : true,
                     risk: load > norm ? 'OVERGRAZING'
                         : (st && st.is_rested === false ? 'REST_NOT_COMPLETE' : 'OK') };
        });
        await respond(req, res, next, 'pasture-load', data,
            { bars: data.map((r) => ({ plot: r.plot_no, active_heads: r.active_heads,
                                       load_head_per_ha: r.load_head_per_ha,
                                       norm_head_per_ha: r.norm_head_per_ha })) });
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 4. Задачи в работе (операционный)
// ---------------------------------------------------------------------------
router.get('/tasks-in-work', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT t.id, t.title, t.status, t.priority, t.planned_date, t.due_at,
                    tt.name AS task_type, e.full_name AS assignee,
                    (t.due_at < now() AND t.status IN ('NEW','IN_WORK')) AS is_overdue,
                    (SELECT count(*)::int FROM task_animal_group tag WHERE tag.task_id = t.id) AS groups_count,
                    (SELECT count(*)::int FROM task_execution te WHERE te.task_id = t.id) AS executions_count
             FROM task t
             JOIN task_type tt ON tt.id = t.task_type_id
             JOIN employee e ON e.id = t.assigned_to
             WHERE t.status IN ('NEW','IN_WORK')
               AND ($1::date IS NULL OR t.planned_date >= $1::date)
               AND ($2::date IS NULL OR t.planned_date <= $2::date)
             ORDER BY t.due_at, t.id
             LIMIT 500`, P(req));
        const byStatus = {}, byAssignee = {};
        for (const r of rows) {
            byStatus[r.status] = (byStatus[r.status] || 0) + 1;
            byAssignee[r.assignee] = (byAssignee[r.assignee] || 0) + 1;
        }
        const series = {
            by_status: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
            by_assignee: Object.entries(byAssignee).map(([assignee, count]) => ({ assignee, count })),
        };
        await respond(req, res, next, 'tasks-in-work', rows, series);
    } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 5. Остатки склада и обороты (операционный)
// ---------------------------------------------------------------------------
router.get('/stock-turnover', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT n.id AS nomenclature_id, n.sku, n.name, n.category,
                    n.min_threshold, u.code AS uom,
                    COALESCE(SUM(sb.qty_on_hand), 0) AS on_hand,
                    COALESCE(SUM(CASE WHEN mt.direction = 'IN' THEN sm.qty ELSE 0 END), 0) AS received,
                    COALESCE(SUM(CASE WHEN mt.direction = 'OUT' THEN sm.qty ELSE 0 END), 0) AS issued,
                    COUNT(DISTINCT sb.batch_id)::int AS batches,
                    MIN(sb.expiry_date) AS nearest_expiry
             FROM nomenclature n
             JOIN uom u ON u.id = n.uom_id
             LEFT JOIN stock_batch sb ON sb.nomenclature_id = n.id
             LEFT JOIN stock_balance bl ON bl.batch_id = sb.id
             LEFT JOIN stock_movement sm ON sm.batch_id = sb.id
             LEFT JOIN movement_type mt ON mt.id = sm.movement_type_id
             WHERE NOT n.is_deleted
               AND ($1::date IS NULL OR sm.moved_at IS NULL OR sm.moved_at >= $1::date)
               AND ($2::date IS NULL OR sm.moved_at IS NULL OR sm.moved_at < ($2::date + interval '1 day'))
             GROUP BY n.id, n.sku, n.name, n.category, n.min_threshold, u.code
             ORDER BY n.sku`);
        const data = rows.map((r) => {
            const onHand = Number(r.on_hand);
            const min = Number(r.min_threshold);
            return { ...r, below_threshold: min > 0 && onHand < min,
                     turnover: onHand > 0 ? +(Number(r.issued) / onHand).toFixed(3) : 0,
                     risk: min > 0 && onHand < min ? 'DEFICIT'
                         : (Number(r.issued) === 0 && onHand > 0 ? 'NON_LIQUID' : 'OK') };
        });
        await respond(req, res, next, 'stock-turnover', data,
            { bars: data.map((r) => ({ sku: r.sku, on_hand: Number(r.on_hand),
                                       min_threshold: Number(r.min_threshold),
                                       issued: Number(r.issued) })) });
    } catch (err) { next(err); }
});

const REPORTS_SERVICE = {
    host: process.env.REPORTS_HOST || '127.0.0.1',
    port: parseInt(process.env.REPORTS_PORT || '4000', 10),
};

/** Вызов микросервиса отчётности (Неделя 7): ядро → reports-service. */
function callAggregate(token, from, to) {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return new Promise((resolve, reject) => {
        const r = http.get({
            host: REPORTS_SERVICE.host, port: REPORTS_SERVICE.port,
            path: `/aggregate?${qs.toString()}`,
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15000,
        }, (resp) => {
            let raw = '';
            resp.on('data', (c) => { raw += c; });
            resp.on('end', () => {
                try { resolve({ status: resp.statusCode, body: JSON.parse(raw) }); }
                catch (e) { reject(new Error(`reports-service: некорректный ответ (${resp.statusCode})`)); }
            });
        });
        r.on('timeout', () => r.destroy(new Error('reports-service: таймаут')));
        r.on('error', reject);
    });
}

/** GET /reports/aggregate — тяжёлая агрегация в отдельном микросервисе. */
router.get('/aggregate', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        let out;
        try {
            out = await callAggregate(req.user.token, req.query.from, req.query.to);
        } catch (e) {
            throw httpError(503, `Микросервис отчётности недоступен: ${e.message}`);
        }
        if (out.status !== 200) throw httpError(out.status, out.body.error || 'Ошибка reports-service');
        res.json(out.body);
    } catch (err) { next(err); }
});

/** GET /reports/dashboard — сводный дашборд (все 5 отчётов одной кнопкой) */
router.get('/dashboard', requirePermission('report:READ', 'report'), async (req, res, next) => {
    try {
        const { rows } = await query(
            `SELECT
               (SELECT count(*)::int FROM animal WHERE NOT is_deleted
                  AND status NOT IN ('ВЫБРАКОВАНО','ПАДЁЖ')) AS animals,
               (SELECT count(*)::int FROM animal WHERE status IN ('НА_ЛЕЧЕНИИ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ')
                  AND NOT is_deleted) AS sick,
               (SELECT count(*)::int FROM task WHERE status IN ('NEW','IN_WORK')) AS tasks_open,
               (SELECT count(*)::int FROM v_task_overdue) AS tasks_overdue,
               (SELECT count(*)::int FROM v_vaccination_overdue) AS vaccination_overdue,
               (SELECT COALESCE(sum(qty_on_hand), 0) FROM stock_balance) AS stock_on_hand,
               (SELECT count(*)::int FROM v_stock_balance_check WHERE abs(balance_qty - calc_qty) > 0.0001) AS stock_mismatches,
               (SELECT count(*)::int FROM v_active_grazing) AS active_grazings,
               (SELECT count(*)::int FROM v_plot_rest_status WHERE NOT is_rested) AS plots_not_rested,
               (SELECT count(*)::int FROM purchase_request WHERE status = 'NEW') AS purchase_requests_new,
               (SELECT count(*)::int FROM notification WHERE NOT is_read) AS unread_notifications,
               (SELECT count(*)::int FROM audit_log WHERE is_elevated) AS elevated_actions,
               (SELECT count(*)::int FROM audit_log WHERE action = 'DENY') AS denies,
               (SELECT count(*)::int FROM backup_job WHERE status = 'OK') AS backups_ok`);
        const { rows: trend } = await query(
            `SELECT to_char(sm.moved_at, 'YYYY-MM') AS month,
                    sum(CASE WHEN mt.direction = 'OUT' THEN sm.qty ELSE 0 END) AS issued,
                    sum(CASE WHEN mt.direction = 'IN' THEN sm.qty ELSE 0 END) AS received
             FROM stock_movement sm JOIN movement_type mt ON mt.id = sm.movement_type_id
             WHERE sm.moved_at >= now() - interval '12 months'
             GROUP BY 1 ORDER BY 1`);
        await respond(req, res, next, 'dashboard', rows, { stock_trend: trend });
    } catch (err) { next(err); }
});

module.exports = router;
```

## `routes/stock.js`

Строк: 204

```javascript
'use strict';

/**
 * Склад (Неделя 5): партии, остатки, движения, заявки на закупку.
 *
 * Движения склада — атомарные: выполняются в транзакции, списание сверх остатка
 * отклоняется на сервере ДО вставки (FOR UPDATE), а также страхуется триггером
 * `trg_stock_movement_apply` + CHECK (qty_on_hand >= 0) на уровне СУБД — при
 * любом нарушении транзакция откатывается целиком (нет «полусписанного» корма).
 * Списание (WRITE_OFF) требует право stock:DELETE и причину write_off_reason_id.
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const MOVE_SPECS = {
    movement_type: { type: 'string', required: true, max: 24 },
    batch_id: { type: 'int', required: true },
    qty: { type: 'decimal', required: true, min: 0.000001, message: 'qty: должна быть положительной' },
    write_off_reason_id: { type: 'int', nullable: true },
    comment: { type: 'string', max: 300, nullable: true },
};

/** GET /api/v1/stock/batches — партии с остатками и номенклатурой */
router.get('/batches', requirePermission('stock:READ', 'stock'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'batch_number', 'received_at', 'expiry_date', 'qty_on_hand']), 'received_at');
        const q = String(req.query.q || '').trim();
        const nomenclatureId = asInt(req.query.nomenclature_id) || 0;
        const warehouseId = asInt(req.query.warehouse_id) || 0;

        const where = [];
        const params = [];
        if (q) {
            where.push(`(b.batch_number ILIKE '%' || $${params.length + 1}::text || '%'
                        OR n.sku ILIKE '%' || $${params.length + 1}::text || '%'
                        OR n.name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (nomenclatureId) { where.push(`b.nomenclature_id = $${params.length + 1}::int`); params.push(nomenclatureId); }
        if (warehouseId) { where.push(`b.warehouse_id = $${params.length + 1}::int`); params.push(warehouseId); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await query(
            `SELECT b.id, b.nomenclature_id, b.warehouse_id, b.supplier_id, b.batch_number,
                    b.received_at, b.expiry_date, b.unit_cost, b.initial_qty,
                    n.sku, n.name AS nomenclature, n.category,
                    w.name AS warehouse, s.name AS supplier,
                    COALESCE(sb.qty_on_hand, 0) AS qty_on_hand,
                    COUNT(*) OVER() AS total
             FROM stock_batch b
             JOIN nomenclature n ON n.id = b.nomenclature_id
             JOIN warehouse w ON w.id = b.warehouse_id
             LEFT JOIN supplier s ON s.id = b.supplier_id
             LEFT JOIN stock_balance sb ON sb.batch_id = b.id
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, b.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /api/v1/stock/balances — остатки по партиям */
router.get('/balances', requirePermission('stock:READ', 'stock'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'qty_on_hand', 'updated_at', 'batch_number']), 'updated_at');
        const q = String(req.query.q || '').trim();
        const warehouseId = asInt(req.query.warehouse_id) || 0;

        const where = [];
        const params = [];
        if (q) {
            where.push(`(b.batch_number ILIKE '%' || $${params.length + 1}::text || '%'
                        OR n.sku ILIKE '%' || $${params.length + 1}::text || '%'
                        OR n.name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (warehouseId) { where.push(`b.warehouse_id = $${params.length + 1}::int`); params.push(warehouseId); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await query(
            `SELECT sb.id, sb.batch_id, sb.qty_on_hand, sb.updated_at,
                    b.batch_number, b.nomenclature_id, n.sku, n.name AS nomenclature,
                    n.category, w.name AS warehouse,
                    COUNT(*) OVER() AS total
             FROM stock_balance sb
             JOIN stock_batch b ON b.id = sb.batch_id
             JOIN nomenclature n ON n.id = b.nomenclature_id
             JOIN warehouse w ON w.id = b.warehouse_id
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, sb.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

/** POST /api/v1/stock/movements — приход/расход/списание/возврат (атомарно) */
router.post('/movements', requirePermission('stock:WRITE', 'stock'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, MOVE_SPECS);

        const mt = await query('SELECT id, code, direction FROM movement_type WHERE code = $1', [v.movement_type]);
        if (!mt.rows.length) throw httpError(400, `Тип движения «${v.movement_type}» не найден`);
        const { id: mtId, code: mtCode, direction } = mt.rows[0];

        // Списание — привилегия кладовщика (stock:DELETE) + обязательная причина
        if (mtCode === 'WRITE_OFF' && !req.user.permissions.has('stock:DELETE')) {
            await writeAudit(req, {
                entityName: 'stock', entityId: v.batch_id, action: 'DENY',
                after: { required_permission: 'stock:DELETE', path: `${req.method} ${req.originalUrl}` },
            });
            return res.status(403).json({ error: 'Недостаточно прав: списание требует stock:DELETE', kind: 'forbidden' });
        }
        if (mtCode === 'WRITE_OFF' && !v.write_off_reason_id) {
            throw httpError(400, 'Списание требует указания причины (write_off_reason_id, ТЗ п.3.3)');
        }
        if (v.write_off_reason_id) {
            const wr = await query('SELECT id FROM write_off_reason WHERE id = $1', [v.write_off_reason_id]);
            if (!wr.rows.length) throw httpError(400, `Причина списания ${v.write_off_reason_id} не найдена`);
        }

        const row = await withTransaction(async (client) => {
            const b = await client.query(
                `SELECT b.id, n.uom_id, n.sku
                 FROM stock_batch b JOIN nomenclature n ON n.id = b.nomenclature_id
                 WHERE b.id = $1 AND NOT n.is_deleted
                 FOR UPDATE OF b`, [v.batch_id]);
            if (!b.rows.length) throw httpError(400, `Партия ${v.batch_id} не найдена`);
            const { uom_id, sku } = b.rows[0];

            if (direction === 'OUT') {
                const bal = await client.query(
                    'SELECT qty_on_hand FROM stock_balance WHERE batch_id = $1 FOR UPDATE', [v.batch_id]);
                const onHand = bal.rows.length ? Number(bal.rows[0].qty_on_hand) : 0;
                if (onHand < v.qty) {
                    throw httpError(400, `Недостаточно остатка партии (${sku}): есть ${onHand}, требуется ${v.qty}`);
                }
            }

            const ins = await client.query(
                `INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at, created_by, write_off_reason_id, comment)
                 VALUES ($1, $2, $3, $4, now(), $5, $6, $7) RETURNING *`,
                [mtId, v.batch_id, v.qty, uom_id, req.user.id, v.write_off_reason_id ?? null, v.comment ?? null]
            );
            return ins.rows[0];
        });

        await writeAudit(req, { entityName: 'stock_movement', entityId: row.id, action: 'CREATE', after: row });
        res.status(201).json({ data: row });
    } catch (err) { next(err); }
});

/** GET /api/v1/stock/purchase-requests — заявки на закупку */
router.get('/purchase-requests', requirePermission('purchase:READ', 'purchase'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'requested_at', 'status', 'requested_qty']), 'requested_at');
        const q = String(req.query.q || '').trim();
        const status = String(req.query.status || '');
        const nomenclatureId = asInt(req.query.nomenclature_id) || 0;

        const where = [];
        const params = [];
        if (q) {
            where.push(`(n.sku ILIKE '%' || $${params.length + 1}::text || '%' OR n.name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (status) { where.push(`pr.status = $${params.length + 1}::text`); params.push(status); }
        if (nomenclatureId) { where.push(`pr.nomenclature_id = $${params.length + 1}::int`); params.push(nomenclatureId); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await query(
            `SELECT pr.id, pr.nomenclature_id, pr.requested_qty, pr.status, pr.is_auto,
                    pr.requested_by, pr.requested_at, pr.closed_at, n.sku, n.name AS nomenclature,
                    COUNT(*) OVER() AS total
             FROM purchase_request pr
             JOIN nomenclature n ON n.id = pr.nomenclature_id
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, pr.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

module.exports = router;
```

## `routes/tasks.js`

Строк: 187

```javascript
'use strict';

/**
 * Задачи (Неделя 5): реестр задач, создание разовой задачи и выполнение.
 *
 * Выполнение вызывает хранимую процедуру `sp_execute_task` (FIFO-списание корма
 * по активному рациону группы, статус-флоу, журнал), которая работает в рамках
 * транзакции с откатом при нехватке остатка. Создание кормовой задачи
 * (requires_writeoff) проверяет на сервере, что у каждой группы есть активный
 * рацион (ТЗ п.4).
 */

const express = require('express');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../audit');
const { httpError, asInt, validate, parsePaging, parseSort } = require('../validation');

const router = express.Router();

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'];

const TASK_SPECS = {
    task_type_id: { type: 'int', required: true },
    title: { type: 'string', required: true, max: 200 },
    plot_id: { type: 'int', nullable: true },
    assigned_to: { type: 'int', required: true },
    planned_date: { type: 'date' },
    due_at: { type: 'datetime' },
    priority: { type: 'enum', values: PRIORITIES },
    group_ids: { type: 'intArray' },
};

const EXECUTE_SPECS = {
    group_id: { type: 'int', required: true },
    actual_amount: { type: 'decimal', nullable: true },
    notes: { type: 'string', max: 1000, nullable: true },
};

/** GET /api/v1/tasks — реестр задач */
router.get('/', requirePermission('task:READ', 'task'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { sort, desc } = parseSort(req.query,
            new Set(['id', 'planned_date', 'due_at', 'priority', 'status', 'created_at']), 'planned_date');
        const q = String(req.query.q || '').trim();
        const status = String(req.query.status || '');
        const assignedTo = asInt(req.query.assigned_to) || 0;

        const where = [];
        const params = [];
        if (q) {
            where.push(`(t.title ILIKE '%' || $${params.length + 1}::text || '%'
                        OR e.full_name ILIKE '%' || $${params.length + 1}::text || '%')`);
            params.push(q);
        }
        if (status) { where.push(`t.status = $${params.length + 1}::text`); params.push(status); }
        if (assignedTo) { where.push(`t.assigned_to = $${params.length + 1}::int`); params.push(assignedTo); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await query(
            `SELECT t.id, t.task_type_id, t.series_id, t.title, t.plot_id, t.assigned_to,
                    t.planned_date, t.due_at, t.priority, t.status, t.created_by, t.created_at, t.completed_at,
                    tt.name AS task_type, tt.requires_writeoff,
                    e.full_name AS assignee, p.name AS plot_name,
                    COUNT(*) OVER() AS total
             FROM task t
             JOIN task_type tt ON tt.id = t.task_type_id
             JOIN employee e ON e.id = t.assigned_to
             LEFT JOIN pasture_plot p ON p.id = t.plot_id
             ${whereSql}
             ORDER BY ${sort} ${desc ? 'DESC' : 'ASC'}, t.id ASC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]
        );
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...r }) => r), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /api/v1/tasks/:id — карточка задачи (+ группы и исполнения) */
router.get('/:id', requirePermission('task:READ', 'task'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const { rows } = await query(
            `SELECT t.*, tt.name AS task_type, tt.requires_writeoff,
                    e.full_name AS assignee, p.name AS plot_name
             FROM task t
             JOIN task_type tt ON tt.id = t.task_type_id
             JOIN employee e ON e.id = t.assigned_to
             LEFT JOIN pasture_plot p ON p.id = t.plot_id
             WHERE t.id = $1`, [id]);
        if (!rows.length) throw httpError(404, 'Задача не найдена');

        const [groups, executions] = await Promise.all([
            query(`SELECT g.id, g.name FROM task_animal_group tag
                   JOIN animal_group g ON g.id = tag.group_id WHERE tag.task_id = $1 ORDER BY g.id`, [id]),
            query(`SELECT * FROM task_execution WHERE task_id = $1 ORDER BY id`, [id]),
        ]);
        res.json({ data: { ...rows[0], groups: groups.rows, executions: executions.rows } });
    } catch (err) { next(err); }
});

/** POST /api/v1/tasks — создание разовой задачи (+ привязка групп) */
router.post('/', requirePermission('task:WRITE', 'task'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, TASK_SPECS);

        const tt = await query('SELECT id, requires_writeoff, default_priority FROM task_type WHERE id = $1', [v.task_type_id]);
        if (!tt.rows.length) throw httpError(400, `Тип задачи ${v.task_type_id} не найден`);
        const { requires_writeoff, default_priority } = tt.rows[0];

        const emp = await query('SELECT id FROM employee WHERE id = $1 AND NOT is_deleted', [v.assigned_to]);
        if (!emp.rows.length) throw httpError(400, `Сотрудник ${v.assigned_to} не найден`);

        if (v.plot_id) {
            const pl = await query('SELECT id FROM pasture_plot WHERE id = $1 AND NOT is_deleted', [v.plot_id]);
            if (!pl.rows.length) throw httpError(400, `Участок ${v.plot_id} не найден`);
        }

        const groupIds = v.group_ids || [];
        // ТЗ п.4: кормление — только для активной группы с назначенным рационом
        if (requires_writeoff && !groupIds.length) {
            throw httpError(400, 'Для кормовой задачи требуется хотя бы одна группа (group_ids)');
        }
        const plannedDate = v.planned_date || new Date().toISOString().slice(0, 10);
        for (const gid of groupIds) {
            const g = await query(
                'SELECT id FROM animal_group WHERE id = $1 AND is_active AND NOT is_deleted', [gid]);
            if (!g.rows.length) throw httpError(400, `Группа ${gid} не найдена или неактивна`);
            if (requires_writeoff) {
                const r = await query(
                    `SELECT 1 FROM ration r
                     WHERE r.group_id = $1 AND r.is_active AND NOT r.is_deleted
                       AND r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to >= $2::date)`,
                    [gid, plannedDate]);
                if (!r.rows.length) throw httpError(400, `У группы ${gid} нет активного рациона на ${plannedDate}`);
            }
        }

        const priority = v.priority || (default_priority === 1 ? 'HIGH' : default_priority >= 5 ? 'LOW' : 'NORMAL');
        const dueAt = v.due_at || `${plannedDate}T12:00:00.000Z`;

        const created = await withTransaction(async (client) => {
            const ins = await client.query(
                `INSERT INTO task (task_type_id, title, plot_id, assigned_to, planned_date, due_at, priority, status, created_by)
                 VALUES ($1, $2, $3, $4, $5::date, $6::timestamptz, $7, 'NEW', $8) RETURNING *`,
                [v.task_type_id, v.title, v.plot_id ?? null, v.assigned_to, plannedDate, dueAt, priority, req.user.id]
            );
            const task = ins.rows[0];
            for (const gid of groupIds) {
                await client.query('INSERT INTO task_animal_group (task_id, group_id) VALUES ($1, $2)', [task.id, gid]);
            }
            return task;
        });

        await writeAudit(req, { entityName: 'task', entityId: created.id, action: 'CREATE', after: created });
        res.status(201).json({ data: created });
    } catch (err) { next(err); }
});

/**
 * POST /api/v1/tasks/:id/execute — выполнение задачи (sp_execute_task).
 * Факт по группе + FIFO-списание корма со склада; при нехватке остатка —
 * транзакция откатывается (нет частичного списания).
 */
router.post('/:id/execute', requirePermission('task:WRITE', 'task'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const v = validate(req.body || {}, EXECUTE_SPECS);

        const row = await withTransaction(async (client) => {
            const r = await client.query(
                `SELECT sp_execute_task($1, $2, $3, $4, $5) AS execution_id`,
                [id, v.group_id, v.actual_amount ?? null, req.user.id, v.notes ?? null]
            );
            return r.rows[0];
        });

        await writeAudit(req, { entityName: 'task', entityId: id, action: 'UPDATE', after: { group_id: v.group_id, execution_id: row.execution_id } });
        res.json({ data: { task_id: id, group_id: v.group_id, execution_id: row.execution_id } });
    } catch (err) { next(err); }
});

module.exports = router;
```

## `routes/tech.js`

Строк: 264

```javascript
'use strict';

/**
 * Технадминка (Неделя 6) — /api/v1/tech.
 *
 * ФИЗИЧЕСКИ И ЛОГИЧЕСКИ ОТДЕЛЕНА от бизнес-админки (routes/admin.js):
 *   * доступ только по праву tech:READ / tech:EXEC (у бизнес-ролей его нет);
 *   * все действия пишутся в tech_log (а не в бизнес-аудит) +-duty аудит;
 *   * технические роли обязаны передать X-Override-Reason (усиленный аудит).
 *
 * Резервное копирование: POST запускает реальный pg_dump через
 * scripts/backup_restore.py, результат (путь/размер/контрольная сумма)
 * фиксируется в backup_job. Восстановление — pg_restore в restore_job.
 * Скрипт вызывается через child_process.execFile (БЕЗ shell → нет инъекций).
 */

const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const { query, withTransaction } = require('../db');
const { requirePermission } = require('../middleware/rbac');
const { elevated } = require('../middleware/elevated');
const { writeAudit, writeTechLog } = require('../audit');
const { httpError, asInt, validate, parsePaging } = require('../validation');

const router = express.Router();

const BACKUP_SPECS = {
    backup_type: { type: 'enum', required: true, values: ['FULL', 'INCREMENTAL'] },
    retention_days: { type: 'int', min: 1, max: 3650 },
    note: { type: 'string', max: 500, nullable: true },
};
const RESTORE_SPECS = {
    backup_job_id: { type: 'int', required: true },
    reason: { type: 'string', required: true, min: 3, max: 500 },
};

const SCRIPT = path.resolve(__dirname, '../../scripts/backup_restore.py');
const PYTHON = process.env.PYTHON_BIN || 'py';

/** Вызвать scripts/backup_restore.py (execFile — аргументы не через shell). */
function runBackupScript(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        execFile(PYTHON, [SCRIPT, ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) return reject(new Error(`${err.message}\n${stderr || ''}`.trim()));
                try { resolve(JSON.parse(String(stdout).trim())); }
                catch (e) { reject(new Error(`Некорректный ответ backup_restore.py: ${String(stdout).slice(0, 400)}`)); }
            });
    });
}

// ============================================================================
// Резервные копии
// ============================================================================

/** GET /tech/backups — журнал резервных копий */
router.get('/backups', requirePermission('backup:READ', 'backup_job'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const status = String(req.query.status || '').trim();
        const type = String(req.query.backup_type || '').trim();
        const where = [];
        const params = [];
        if (status) { where.push(`b.status = $${params.length + 1}::text`); params.push(status); }
        if (type) { where.push(`b.backup_type = $${params.length + 1}::text`); params.push(type); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT b.id, b.backup_type, b.started_at, b.finished_at, b.status,
                    b.file_path, b.size_bytes, b.checksum, b.retention_days,
                    u.login AS initiated_by_login, COUNT(*) OVER() AS total
             FROM backup_job b JOIN app_user u ON u.id = b.initiated_by
             ${whereSql} ORDER BY b.started_at DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /tech/backups/:id — карточка копии (+ связанные восстановления) */
router.get('/backups/:id', requirePermission('backup:READ', 'backup_job'), async (req, res, next) => {
    try {
        const id = asInt(req.params.id);
        if (id == null) throw httpError(400, 'Некорректный id');
        const b = await query(
            `SELECT b.*, u.login AS initiated_by_login FROM backup_job b
             JOIN app_user u ON u.id = b.initiated_by WHERE b.id = $1`, [id]);
        if (!b.rows.length) throw httpError(404, 'Резервная копия не найдена');
        const r = await query(
            `SELECT r.id, r.started_at, r.finished_at, r.status, r.reason, u.login AS performed_by_login
             FROM restore_job r JOIN app_user u ON u.id = r.performed_by
             WHERE r.backup_job_id = $1 ORDER BY r.started_at DESC`, [id]);
        res.json({ data: { ...b.rows[0], restores: r.rows } });
    } catch (err) { next(err); }
});

/**
 * POST /tech/backups — создать резервную копию.
 * Вся операция транзакционна: запись RUNNING → pg_dump → OK/FAILED.
 */
router.post('/backups', elevated('backup:EXEC', 'backup_job'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, BACKUP_SPECS);
        const retention = v.retention_days || 30;
        const ins = await query(
            `INSERT INTO backup_job (backup_type, status, retention_days, initiated_by)
             VALUES ($1, 'RUNNING', $2, $3) RETURNING *`,
            [v.backup_type, retention, req.user.id]);

        let result;
        try {
            result = await runBackupScript([
                'backup', '--type', v.backup_type, '--retention', String(retention),
                '--id', String(ins.rows[0].id), '--note', v.note || '',
            ]);
        } catch (e) {
            await query(
                `UPDATE backup_job SET status = 'FAILED', finished_at = now(), file_path = $2
                 WHERE id = $1`, [ins.rows[0].id, String(e.message).slice(0, 490)]);
            await writeTechLog(req, { actionType: 'BACKUP', description: `Бэкап #${ins.rows[0].id} НЕ выполнен: ${e.message}`, details: { status: 'FAILED' } });
            throw httpError(500, `Резервное копирование не выполнено: ${e.message}`);
        }

        const done = await query(
            `UPDATE backup_job SET status = 'OK', finished_at = now(),
                    file_path = $2, size_bytes = $3, checksum = $4
             WHERE id = $1 RETURNING *`,
            [ins.rows[0].id, result.file_path, result.size_bytes, result.checksum]);

        await writeTechLog(req, { actionType: 'BACKUP',
            description: `Резервная копия #${done.rows[0].id} (${v.backup_type}) создана: ${result.file_path}`,
            details: { size_bytes: result.size_bytes, checksum: result.checksum, retention_days: retention } });
        await writeAudit(req, { entityName: 'backup_job', entityId: done.rows[0].id, action: 'CREATE',
                                after: { backup_type: v.backup_type, file: result.file_path } });
        res.status(201).json({ data: done.rows[0] });
    } catch (err) { next(err); }
});

// ============================================================================
// Восстановление
// ============================================================================

/** GET /tech/restores — журнал восстановлений */
router.get('/restores', requirePermission('backup:READ', 'restore_job'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const { rows } = await query(
            `SELECT r.id, r.backup_job_id, b.file_path, b.checksum, r.started_at, r.finished_at,
                    r.status, r.reason, u.login AS performed_by_login, COUNT(*) OVER() AS total
             FROM restore_job r
             JOIN backup_job b ON b.id = r.backup_job_id
             JOIN app_user u ON u.id = r.performed_by
             ORDER BY r.started_at DESC
             LIMIT $1::int OFFSET $2::int`, [limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** POST /tech/restores — восстановление из копии (демонстрация инцидента) */
router.post('/restores', elevated('backup:EXEC', 'restore_job'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, RESTORE_SPECS);
        const src = await query(
            `SELECT id, file_path, checksum, status FROM backup_job WHERE id = $1`, [v.backup_job_id]);
        if (!src.rows.length) throw httpError(404, `Резервная копия ${v.backup_job_id} не найдена`);
        if (src.rows[0].status !== 'OK') throw httpError(400, 'Восстановление возможно только из копии со статусом OK');

        const ins = await query(
            `INSERT INTO restore_job (backup_job_id, status, reason, performed_by)
             VALUES ($1, 'RUNNING', $2, $3) RETURNING *`,
            [v.backup_job_id, v.reason, req.user.id]);

        let result;
        try {
            result = await runBackupScript(['restore', '--file', src.rows[0].file_path,
                                           '--checksum', src.rows[0].checksum || '',
                                           '--id', String(ins.rows[0].id)]);
        } catch (e) {
            await query(`UPDATE restore_job SET status = 'FAILED', finished_at = now() WHERE id = $1`, [ins.rows[0].id]);
            await writeTechLog(req, { actionType: 'RESTORE', description: `Восстановление #${ins.rows[0].id} НЕ выполнено: ${e.message}`, details: { status: 'FAILED' } });
            throw httpError(500, `Восстановление не выполнено: ${e.message}`);
        }

        const done = await query(
            `UPDATE restore_job SET status = 'OK', finished_at = now() WHERE id = $1 RETURNING *`,
            [ins.rows[0].id]);
        await writeTechLog(req, { actionType: 'RESTORE',
            description: `Восстановление #${done.rows[0].id} из копии #${v.backup_job_id} выполнено. Причина: ${v.reason}`,
            details: { file: src.rows[0].file_path, verified: true } });
        await writeAudit(req, { entityName: 'restore_job', entityId: done.rows[0].id, action: 'CREATE',
                                after: { backup_job_id: v.backup_job_id, reason: v.reason } });
        res.status(201).json({ data: done.rows[0], verification: result });
    } catch (err) { next(err); }
});

// ============================================================================
// Технический лог и метрики
// ============================================================================

/** GET /tech/log — технический лог (отдельно от бизнес-аудита) */
router.get('/log', requirePermission('tech:READ', 'tech_log'), async (req, res, next) => {
    try {
        const { limit, offset } = parsePaging(req.query);
        const actionType = String(req.query.action_type || '').trim();
        const where = [];
        const params = [];
        if (actionType) { where.push(`t.action_type = $${params.length + 1}::text`); params.push(actionType); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const { rows } = await query(
            `SELECT t.id, t.occurred_at, t.action_type, t.description, t.details,
                    u.login AS admin_login, COUNT(*) OVER() AS total
             FROM tech_log t JOIN app_user u ON u.id = t.admin_user_id
             ${whereSql} ORDER BY t.occurred_at DESC
             LIMIT $${params.length + 1}::int OFFSET $${params.length + 2}::int`,
            [...params, limit, offset]);
        const total = rows.length ? Number(rows[0].total) : 0;
        res.json({ data: rows.map(({ total: _t, ...x }) => x), total, limit, offset });
    } catch (err) { next(err); }
});

/** GET /tech/metrics — метрики БД (здоровье, размер, активность) */
router.get('/metrics', requirePermission('tech:READ', 'tech_log'), async (req, res, next) => {
    try {
        const { rows } = await query(`
            SELECT current_database() AS database,
                   version() AS server_version,
                   (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
                   pg_size_pretty(pg_database_size(current_database())) AS db_size,
                   (SELECT count(*) FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
                   (SELECT count(*) FROM animal WHERE NOT is_deleted) AS animals,
                   (SELECT count(*) FROM task) AS tasks,
                   (SELECT count(*) FROM stock_movement) AS stock_movements,
                   (SELECT count(*) FROM audit_log) AS audit_rows,
                   (SELECT count(*) FROM audit_log WHERE action = 'DENY') AS denies,
                   (SELECT count(*) FROM audit_log WHERE is_elevated) AS elevated,
                   (SELECT count(*) FROM backup_job WHERE status = 'OK') AS backups_ok,
                   (SELECT max(finished_at) FROM backup_job WHERE status = 'OK') AS last_backup_at`);
        res.json({ data: rows[0] });
    } catch (err) { next(err); }
});

/** POST /tech/maintenance — обслуживание (VACUUM ANALYZE / REINDEX), пишется в tech_log */
router.post('/maintenance', elevated('tech:EXEC', 'tech_log'), async (req, res, next) => {
    try {
        const v = validate(req.body || {}, {
            operation: { type: 'enum', required: true, values: ['VACUUM', 'ANALYZE', 'REINDEX'] },
            note: { type: 'string', max: 500, nullable: true },
        });
        // VACUUM/REINDEX не могут выполняться внутри транзакции → вне withTransaction.
        const sql = v.operation === 'REINDEX'
            ? 'REINDEX TABLE public.stock_movement'
            : (v.operation === 'ANALYZE' ? 'ANALYZE' : 'VACUUM (ANALYZE)');
        await query(sql);
        await writeTechLog(req, { actionType: v.operation === 'REINDEX' ? 'INDEX' : 'MAINTENANCE',
            description: `Обслуживание БД: ${v.operation}${v.note ? ' — ' + v.note : ''}`,
            details: { sql, operation: v.operation } });
        res.json({ data: { operation: v.operation, status: 'OK' } });
    } catch (err) { next(err); }
});

module.exports = router;
```

## `validation.js`

Строк: 170

```javascript
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
```
