# WEB_Ferma — ИС учёта фермерского хозяйства «Заречное»

Комплексный учёт фермерского хозяйства (курсовой проект, **Вариант 11**, 10 недель).
**Статус: все недели 1–10 реализованы**, версия `v1.0.0`.

PostgreSQL 16 + PostGIS · Node.js 22/Express · адаптивный веб-UI · микросервис отчётности · Docker Compose · CI.

| Параметр | Значение |
|---|---|
| БД | 56 таблиц, 12 доменов, 93 FK, 7 VIEW, 6 триггеров, 12 процедур/функций, 185 индексов |
| RBAC | 6 ролей, **42 права** |
| API | 46 путей в OpenAPI, 2 процесса (ядро :3000 + reports :4000) |
| UI | `/app` — 3 брейкпоинта, Leaflet/OSM, ≥8 hotkeys, темы, RU/EN |
| Тесты | 16 unit + ~75 smoke + **17 SQL-сценариев** + нагрузочный + 64 ручных кейса |

## Структура проекта

```
WEB_Ferma/
├── db/                       # БД (порядок загрузки важен)
│   ├── 01_schema.sql             # 56 таблиц, индексы, FK
│   ├── 02_views.sql              # 7 представлений (3НФ)
│   ├── 03_functions_triggers.sql # 6 триггеров
│   ├── 04_seed_demo.sql          # демо-данные (2 года истории)
│   ├── 05_procedures.sql         # 12 процедур/функций
│   └── 99_checks.sql             # 17 сценариев (BEGIN…ROLLBACK)
├── server/src/               # Ядро REST API
│   ├── validation.js             # слой серверной валидации
│   ├── middleware/               # auth, rbac, elevated (усиленный аудит), errors
│   ├── routes/                   # auth, animals, catalog(14 справочников), stock,
│   │                             # tasks, pastures, admin, tech, reports
│   ├── openapi.json              # спецификация (46 путей)
│   └── index.js                  # точка входа + раздача UI
├── services/reports/         # Микросервис аналитики (:4000)
├── ui/public/                # index.html, styles.css, app.js (vanilla JS)
├── scripts/                  # генераторы доков, smoke, unit, нагрузка, бэкапы
├── tests/unit/               # 16 unit-тестов (node:test)
├── docs/                     # db_structure, server_api, security, backup_policy,
│                             # architecture, reports, tech_doc, test_*
├── .github/workflows/ci.yml  # CI: unit / db-checks / api-smoke
├── docker-compose.yml        # db + api + reports
├── CHANGELOG.md
└── README.md
```

## Быстрый старт

### Вариант А — Docker Compose (рекомендуется)

```bash
cd WEB_Ferma
docker compose up --build -d
# БД инициализируется скриптами из ./db автоматически
curl http://localhost:3000/api/v1/health
```

Интерфейс: <http://localhost:3000/app/> · Swagger UI: <http://localhost:3000/api/v1/docs>

### Вариант Б — вручную

```bash
docker run -d --name farm_pg \
  -e POSTGRES_USER=farm -e POSTGRES_PASSWORD=farm -e POSTGRES_DB=farm \
  -p 5433:5432 postgis/postgis:16-3.4
# ВАЖНО: дождаться «init process complete» в docker logs -f farm_pg

for f in 01_schema 02_views 03_functions_triggers 04_seed_demo 05_procedures; do
  docker exec -i farm_pg psql -U farm -d farm -v ON_ERROR_STOP=1 -1 < db/$f.sql
done

# Проверочные сценарии (17 проверок, ROLLBACK — данные не меняются):
docker exec -i farm_pg psql -U farm -d farm -v ON_ERROR_STOP=1 < db/99_checks.sql

cd server && npm ci && npm start                 # ядро :3000
cd ../services/reports && npm ci && npm start   # микросервис :4000 (второе окно)
```

## Группы API

| Группа | Маршруты | Права |
|---|---|---|
| health/docs | `GET /health`, `/openapi.json`, `/docs` | публичные |
| auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | — |
| animals | `GET/POST /animals`, `GET/PATCH/DELETE /animals/:id`, `POST /animals/:id/status` | `animal:*` |
| catalogs | 14 справочников (`/species`, `/breeds`, `/employees`, `/uoms`, …) | `catalog:*`, `employee:*` |
| stock | `/stock/batches`, `/stock/balances`, `POST /stock/movements`, `/stock/purchase-requests` | `stock:*`, `purchase:READ` |
| tasks | `/tasks`, `/tasks/:id`, `POST /tasks/:id/execute` | `task:*` |
| pastures | `/pasture-plots`, `/grazing/move` | `pasture:*` |
| admin | `/admin/users`, `/admin/roles`, `/admin/permissions`, `/admin/settings`, `/admin/audit-log` (+ CSV), `/admin/sessions`, `/admin/notifications` | `user:*`, `audit:READ`, `settings:*` |
| tech | `/tech/backups`, `/tech/restores`, `/tech/log`, `/tech/metrics`, `/tech/maintenance` | `backup:*`, `tech:*` |
| reports | `/reports/dashboard`, `cost-fcr`, `herd-health`, `pasture-load`, `tasks-in-work`, `stock-turnover`, `aggregate` | `report:READ`, `export:EXEC` |

**Усиленный аудит:** действия технических ролей (`superuser`, `dba`) требуют
заголовок `X-Override-Reason` (иначе 428) и пишутся в `audit_log`
с `is_elevated = TRUE` и причиной.

## Демо-доступ

`director`, `superuser`, `dba`, `vet`, `foreman`, `storekeeper` — пароль **`demo1234`**.
Демо-объём: 100 голов в 5 группах, 8 участков (~70 га), ~9.3k задач,
~29.7k движений склада за 2 года.

## Тестирование

```bash
py scripts/run_tests.py                        # 16 unit-тестов (без БД)
py scripts/smoke_api.py                        # ~75 HTTP-проверок (нужны БД + сервер)
py scripts/load_test.py --reads 200 --concurrency 20   # p95 < 2000 мс, ≥5k строк импорта
docker exec -i farm_pg psql -U farm -d farm -v ON_ERROR_STOP=1 < db/99_checks.sql

# В CI без docker exec:
FARM_PSQL_MODE=local PGPORT=5433 py scripts/smoke_api.py
```

Unit-тесты запускаются каждым файлом отдельно (`node tests/unit/*.test.js`) — это
совместимо с изолированными окружениями, где `node --test <dir>` спавнит подпроцессы.

## Резервное копирование

```bash
py scripts/backup_restore.py backup --type FULL --retention 30
py scripts/backup_restore.py verify --file backups/farm_FULL_*.dump --checksum <sha256>
```
Через API: `POST /tech/backups`, `POST /tech/restores` (обязательна причина).
Регламент и демонстрация инцидента — [docs/backup_policy.md](docs/backup_policy.md).

## Документация

```bash
py scripts/generate_db_doc.py       # docs/db_structure.md (нужна живая БД)
py scripts/generate_server_doc.py   # docs/server_api.md   (без БД)
py scripts/sync_openapi.py          # пересборка openapi.json (Недели 6–8)
```

| Документ | Содержание |
|---|---|
| [db_structure.md](docs/db_structure.md) | Структурная схема БД |
| [server_api.md](docs/server_api.md) | Листинги кода (19 файлов) |
| [security.md](docs/security.md) | Механизмы защиты, матрица ролей |
| [backup_policy.md](docs/backup_policy.md) | Регламент бэкапов/restore |
| [architecture.md](docs/architecture.md) | Архитектура, микросервисы, схемы UI |
| [reports.md](docs/reports.md) | Метрики и определения отчётов |
| [tech_doc.md](docs/tech_doc.md) | Техническая часть (Неделя 10) |
| [test_plan.md](docs/test_plan.md), [test_cases.md](docs/test_cases.md), [test_protocol.md](docs/test_protocol.md) | Тест-пакет |

## Проверочные запросы

```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE';      -- 56 + системные
SELECT * FROM v_stock_balance_check WHERE balance_qty <> calc_qty;  -- пусто
SELECT * FROM v_active_grazing;
SELECT * FROM v_plot_rest_status;
```
