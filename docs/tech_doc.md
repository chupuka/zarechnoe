# Техническая часть — ИС «Заречное»

> Курсовой проект, Неделя 10. Стек, окружения, отладка, защитное
> программирование, DevOps, характеристики программы.

## 1. Инструментальные средства

| Слой | Технология | Назначение |
|---|---|---|
| СУБД | PostgreSQL 16.4 + PostGIS 3.4 | 56 таблиц, 12 доменов, 93 FK, полигоны участков (SRID 4326) |
| Сервер | Node.js 22, Express 4, `pg`, `bcryptjs` | REST API, RBAC, транзакции, аудит |
| Микросервис | Node.js 22 (`http` + `pg`) | Тяжёлая аналитика `:4000`, свой пул (только чтение) |
| Клиент | Vanilla JS (ES-модули), Leaflet 1.9.4 + OSM | Адаптивный UI, карта, canvas-графики |
| Документирование | OpenAPI 3.0.3 + Swagger UI | `/api/v1/docs` |
| Тестирование | `node:test`, Python (`smoke_api.py`, `load_test.py`), SQL (`99_checks.sql`) | 16 unit + ~50 API + 14 SQL + нагрузка |
| Контейнеризация | Docker, docker-compose | `db` + `api` + `reports` |
| CI | GitHub Actions | 3 job: unit / db-checks / api-smoke |
| Разработка | VS Code, draw.io (ER), DBeaver/psql | — |

## 2. Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│ Браузер (ui/public, /app) — adaptive 3 брейкпоинта           │
│   Leaflet/OSM карта · реестры · отчёты · hotkeys · тема       │
└───────────────┬──────────────────────────┬──────────────────┘
                │ Bearer + X-Override-Reason│
        ┌───────▼────────┐          ┌───────▼─────────┐
        │  ЯДРО :3000    │──HTTP───▶│ REPORTS :4000   │
        │  Express REST  │ /aggregate│ (только чтение)│
        │  RBAC · audit  │          └───────┬─────────┘
        └───────┬────────┘                  │
                └──────────┬───────────────┘
                   ┌───────▼────────┐
                   │ PostgreSQL 16  │  farm_pg :5433
                   │ + PostGIS      │  56 tables / 7 VIEW
                   └────────────────┘
```

**Ядро + дополнительный сервис** (ТЗ п.7): агрегации вынесены в отдельный процесс,
чтобы отчёты не конкурировали за соединения с транзакционной нагрузкой.
Сервис проверяет тот же Bearer-токен через общую таблицу `user_session`
(единая точка аутентификации, без дублирования логики).

## 3. Окружения

| Окружение | БД | Запуск | Примечание |
|---|---|---|---|
| Локальное (разработка) | `docker start farm_pg` :5433 | `cd server && npm start` | UI на `/app`, Swagger на `/docs` |
| CI | service `postgis:16-3.4` :5432/5433 | GitHub Actions | `FARM_PSQL_MODE=local` |
| Контейнерное | `docker compose up --build` | 3 сервиса | `/db` монтируется в initdb |
| Демо/защита | локальное | + `scripts/backup_restore.py` | restore по регламенту |

Переменные окружения: `PORT`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
`PGDATABASE`, `SESSION_TTL_HOURS`, `REPORTS_HOST`, `REPORTS_PORT`,
`REPORTS_SERVICE`, `PYTHON_BIN`, `FARM_BACKUP_DIR`, `FARM_PSQL_MODE`.

## 4. Инструкция развёртывания

```bash
# Вариант А — docker-compose (рекомендуется)
cd WEB_Ferma
docker compose up --build -d
# БД инициализируется скриптами из ./db автоматически
curl http://localhost:3000/api/v1/health

# Вариант Б — вручную
docker run -d --name farm_pg -e POSTGRES_USER=farm -e POSTGRES_PASSWORD=farm \
  -e POSTGRES_DB=farm -p 5433:5432 postgis/postgis:16-3.4
# дождаться «init process complete» в docker logs
for f in 01_schema 02_views 03_functions_triggers 04_seed_demo 05_procedures; do
  docker exec -i farm_pg psql -U farm -d farm -v ON_ERROR_STOP=1 -1 < db/$f.sql
done
cd server && npm ci && npm start
cd ../services/reports && npm ci && npm start   # второе окно
```

Интерфейс: `http://localhost:3000/app/`; Swagger: `http://localhost:3000/api/v1/docs`.

## 5. Защитное программирование

| Приём | Где |
|---|---|
| Параметризованные запросы `$1..$n`, whitelist для `sort` | все роуты, `validation.js::parseSort` |
| Декларативная валидация + отбраковка неизвестных полей | `validation.js::validate` |
| `reject`-поля (`status`, `is_deleted`, `password_hash`) | `animals.js`, `admin.js` |
| Маппинг SQLSTATE → HTTP, без утечки стека | `middleware/errors.js` |
| Транзакции `withTransaction` + `FOR UPDATE` | все write-операции |
| Тройной запрет отрицательных остатков | API-проверка, триггер, CHECK |
| bcrypt + sha256-токены + блокировка | `auth.js`, `admin.js` |
| `execFile` без shell при бэкапах | `tech.js`, `backup_restore.py` |
| Усиленный аудит техролей (`X-Override-Reason`) | `middleware/elevated.js` |
| Экранирование вывода в UI (`textContent`) | `ui/public/app.js` |

## 6. Отладка

1. **Лог доступа**: каждое обращение пишется в stdout (`METHOD path -> status (ms)`).
2. **Ошибки**: `errorHandler` логирует необработанные `Unhandled error`, клиенту — 500 без стека.
3. **Аудит**: `GET /admin/audit-log?action=DENY&is_elevated=true` + CSV-выгрузка.
4. **Техлог**: `GET /tech/log` (бэкапы, VACUUM, restore).
5. **Метрики**: `GET /tech/metrics` (соединения, размер БД, счётчики).
6. **SQL**: `EXPLAIN (ANALYZE, BUFFERS)` на реестрах (индексы `ix_*`, 185 шт.),
   `db/99_checks.sql` — 14 сценариев в `BEGIN…ROLLBACK`.
7. **Типовые симптомы**: 401 → истёк токен/отозвана сессия; 403 → нет права (см. DENY);
   428 → техроль без `X-Override-Reason`; 409 → дубликат уникального реквизита;
   400 `business_rule` → `RAISE EXCEPTION` в процедуре/триггере.

## 7. Стратегия Git

- Ветки: `main` (релиз), `develop` (интеграция), `feature/week-N-*` (по неделям).
- Коммиты: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Релизные теги: `v0.4.0` (Неделя 4), …, `v1.0.0` (Неделя 10).
- PR → ревью → зелёный CI (`ci.yml`) → merge.
- Бинарные артефакты и `backups/`, `node_modules/`, `.env` — в `.gitignore`.

## 8. CI/CD

`.github/workflows/ci.yml`: 3 job — unit-тесты (синтаксис + 16 тестов + валидация JSON),
db-checks (загрузка схемы + 14 сценариев + генерация `db_structure.md`),
api-smoke (подъём API + ~50 HTTP-проверок). Триггеры: push/PR/`workflow_dispatch`.

## 9. Характеристики программы

| Параметр | Значение |
|---|---|
| Таблиц / FK / VIEW / индексов | 56 / 93 / 7 / 185 |
| Триггеров / процедур и функций | 6 / 12 |
| Ролей / прав | 6 / 42 |
| Эндпоинтов REST | 40+ (19+ в OpenAPI), 2 процесса |
| Демо-объём | 100 голов, ~9.3k задач, ~29.7k движений, 2 года |
| Целевой объём (ТЗ п.10) | ≥ 20–50k записей в реестрах |
| Пагинация | 50 на страницу, максимум 200 |
| Время открытия реестра (цель) | p95 < 2000 мс при 20 параллельных |
| Сессия | 8 ч, sha256-хэш в БД |
| Покрытие тестами | 16 unit + ~50 API + 14 SQL + 64 ручных кейса |
| Размер UI | 3 брейкпоинта, ≥8 hotkeys, светлая/тёмная тема, RU/EN |

## 10. Состав документации

| Документ | Содержание |
|---|---|
| `README.md` | Быстрый старт, структура, команды |
| `Context.md` (корень проекта) | Сводка состояния по неделям |
| `docs/db_structure.md` | Структурная схема БД (генерируется из живой БД) |
| `docs/server_api.md` | Листинги серверной части (генерируется) |
| `docs/security.md` | Механизмы защиты, матрица ролей |
| `docs/backup_policy.md` | Регламент бэкапов и restore |
| `docs/reports.md` | Описание отчётов и метрик |
| `docs/architecture.md` | Архитектура и схемы интерфейсов |
| `docs/tech_doc.md` | Настоящий документ |
| `docs/test_plan.md`, `test_cases.md`, `test_protocol.md` | Тест-пакет |
| `server/src/openapi.json` | Спецификация API |
| `CHANGELOG.md` | История релизов |
