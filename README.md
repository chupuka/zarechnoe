# WEB_Ferma — ИС учёта фермерского хозяйства «Заречное»

Комплексный учёт фермерского хозяйства (курсовой проект, **Вариант 11**, 10 недель).
**Статус: все недели 1–10 реализованы**, версия `v1.4.0` (шифрование ПДн, статистика на страницах, расширенная админка, единая страница бэкапов и метрики скорости БД).

PostgreSQL 16 + PostGIS · Node.js 22/Express · адаптивный веб-UI · микросервис отчётности · Docker Compose · CI.

| Параметр | Значение |
|---|---|
| БД | 61 таблица в `public` (в т.ч. технические `schema_migration`, `db_metric_sample`), 99 FK, 13 VIEW, 6 ролей, 45 прав, 12 применённых миграций; ПДн шифруются в `employee_pii` через `pgcrypto` |
| RBAC | 6 ролей, **45 прав** (включая `employee:PII`, `dba:READ`, `dba:EXEC`); DBA — только техника и управление пользователями |
| API | **94 пути** в OpenAPI (в т.ч. `/stats/*`, `/employees/*`, `/animals/herd`, `/tech/backups/overview`, `/tech/metrics/perf`), 2 процесса (ядро :3000 + reports :4000) |
| UI | `/app` — 3 брейкпоинта, Leaflet/OSM, ≥8 hotkeys, темы, RU/EN; плашка показателей `/stats/:section`, фильтры у заголовка, размер страницы в пагинации |
| Тесты | 16 unit + 78 smoke + **22 SQL-проверки** (`db/99_checks.sql`) + нагрузочный + 64 ручных кейса |

## Структура проекта

```
WEB_Ferma/
├── db/                       # БД (порядок загрузки важен)
│   ├── 01_schema.sql             # 56 таблиц, индексы, FK
│   ├── 02_views.sql              # 7 представлений (3НФ)
│   ├── 03_functions_triggers.sql # 6 триггеров
│   ├── 04_seed_demo.sql          # демо-данные (2 года истории)
│   ├── 05_procedures.sql         # 12 процедур/функций
│   ├── migrations/               # 0001…0011 — версионируемые миграции схемы
│   │   ├── 0008_pii_encryption.sql  # pgcrypto, ПДн в employee_pii
│   │   ├── 0010_demo_extra.sql      # дополнительные демо-данные
│   │   └── 0011_constraints.sql     # авто-закрытие закреплений при выбытии
│   └── 99_checks.sql             # 22 проверки (BEGIN…ROLLBACK)
├── server/src/               # Ядро REST API
│   ├── validation.js             # слой серверной валидации
│   ├── pii.js                    # шифрование/расшифровка ПДн, ключ из PII_KEY
│   ├── perf.js                   # метрики скорости запросов к БД
│   ├── stats.js                  # карточки показателей по правам роли
│   ├── assignments.js            # закрепление сотрудников, сводка выпаса
│   ├── middleware/               # auth, rbac, elevated (усиленный аудит), errors
│   ├── routes/                   # auth, animals, employees, catalog, stock, tasks,
│   │                             # pastures, admin, tech, reports, stats, dba
│   ├── openapi.json              # спецификация (94 пути, v1.4.0)
│   └── index.js                  # точка входа + раздача UI
├── services/reports/         # Микросервис аналитики (:4000)
├── ui/public/                # index.html, styles.css, app.js (vanilla JS)
├── scripts/                  # генераторы доков, smoke, unit, нагрузка, бэкапы
├── tests/unit/               # 16 unit-тестов (node:test)
├── docs/                     # db_structure, server_api, security, backup_policy,
│                             # ui_guide, demo_scenarios, architecture, reports,
│                             # tech_doc, test_*
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

# Проверочные сценарии (22 проверки, ROLLBACK — данные не меняются):
docker exec -i farm_pg psql -U farm -d farm -v ON_ERROR_STOP=1 < db/99_checks.sql

cd server && npm ci && npm start                 # ядро :3000
cd ../services/reports && npm ci && npm start   # микросервис :4000 (второе окно)
```

## Группы API

| Группа | Маршруты | Права |
|---|---|---|
| health/docs | `GET /health`, `/openapi.json`, `/docs` | публичные |
| auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | — |
| stats | `GET /stats`, `GET /stats/:section` — показатели страницы по правам роли | по правам раздела |
| animals | `GET/POST /animals`, `GET/PATCH/DELETE /animals/:id`, `POST /animals/:id/status`, `GET /animals/herd`, закрепления | `animal:*` |
| employees | `GET/POST /employees`, `/pii`, `/dismiss`, `/reinstate`, `/assignments` | `employee:READ/WRITE/PII` |
| catalogs | 14 справочников (`/species`, `/breeds`, `/positions`, `/uoms`, …) | `catalog:*`, `employee:*` |
| stock | `/stock/batches`, `/stock/balances`, `POST /stock/movements`, `/stock/purchase-requests` | `stock:*`, `purchase:READ` |
| tasks | `/tasks`, `/tasks/:id`, `POST /tasks/:id/execute` | `task:*` |
| pastures | `/pasture-plots`, `/grazing/move` | `pasture:*` |
| admin | `/admin/users` (+ block/unblock/generate-password/sessions), `/admin/roles/:id/permissions`, `/admin/permissions`, `/admin/settings`, `/admin/audit-log` (+ CSV, `/users`, `/violations`), `/admin/sessions`, `/admin/notifications` | `user:*`, `audit:READ`, `settings:*` |
| tech | `/tech/backups/overview`, `/tech/backups/schedule(/run)`, `/tech/backups/:id/download`, `/tech/restores`, `/tech/log`, `/tech/metrics/perf(/reset)`, `/tech/maintenance` | `backup:*`, `tech:*` |
| **dba** | `/dba/migrations`, `/preflight`, `/apply`, `/rollback`, `/dba/backups`, `/dba/monitor/*` (17 путей) | **`dba:READ` / `dba:EXEC`** |
| reports | `/reports/dashboard`, `cost-fcr`, `herd-health`, `pasture-load`, `tasks-in-work`, `stock-turnover`, `aggregate` | `report:READ`, `export:EXEC` |

**Усиленный аудит:** действия технических ролей (`superuser`, `dba`) требуют
заголовок `X-Override-Reason` (иначе 428) и пишутся в `audit_log`
с `is_elevated = TRUE` и причиной.

**Администратор БД** — отдельный контур: миграции схемы с предварительным прогоном
(реальное выполнение + ROLLBACK), защитой от разрушительных DDL и атомарным
применением; резервные копии `pg_dump`/`pg_restore`; мониторинг `pg_stat_*`.
Все технические события идут в `tech_log`, а **не** в бизнес-аудит. Подробнее —
[docs/db_admin.md](docs/db_admin.md).

## Демо-доступ

**Работающий проект:** <https://chupuka.github.io/zarechnoe/>

Вход только через форму на странице (параметр `?demo=` не поддерживается).
**Пароль для всех ролей: `demo1234`.**

| Логин | Роль | Что доступно |
|---|---|---|
| `director` | Директор | отчёты, аудит, пользователи, карта пастбищ с редактором |
| `superuser` | Суперпользователь | полный доступ (нужен `X-Override-Reason` при записи) |
| `dba` | Администратор БД | технадминка, миграции, бэкапы (нужен `X-Override-Reason`) |
| `vet` | Зоотехник/ветеринар | животные, здоровье, вакцинации |
| `foreman` | Бригадир | выпас, задачи, склад, состояние участков |
| `storekeeper` | Кладовщик | склад, остатки, движения |
| `vet2`, `foreman2`, `storekeeper2` | Доп. демо-пользователи | те же права, что и основные роли |

Заблокированные учётные записи: `dba2`, `temp.operator`.
Демо-объём: 21 сотрудник в 20 ПДн-записях, 140 голов в 5 группах, 80 закреплений,
11 пользователей, 9340 задач, 29736 движений склада за 2 года.
Ключ ПДн стенда передаётся только в окружении (`PII_KEY`), в БД не хранится.

Дополнительные сервисы: API <https://api.zarechnoe.dpdns.org/api/v1>,
Swagger <https://api.zarechnoe.dpdns.org/api/v1/docs>,
Reports <https://reports.zarechnoe.dpdns.org/health>.
Полная памятка — `../ДЕМО_ДОСТУПЫ.txt`.

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
py scripts/generate_app_code.py     # ../Приложение_А_Код.md — листинги исходников приложения
py scripts/sync_openapi.py          # пересборка openapi.json (Недели 6–8)
```

| Документ | Содержание |
|---|---|
| [db_structure.md](docs/db_structure.md) | Структурная схема БД |
| [server_api.md](docs/server_api.md) | Листинги кода (19 файлов) |
| `../Приложение_А_Код.md` | Текст программы: все исходники приложения (59 файлов, без окружения и вспомогательных файлов) |
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
