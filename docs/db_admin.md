# Администратор БД: миграции, резервные копии, мониторинг

> Расширение курсового проекта «ИС «Заречное» (Вариант 11)».
> Контур `/api/v1/dba/*` — технический, **логически и физически отделён от бизнес-аудита**.

---

## 1. Постановка и границы

Требуется реализовать роль **Администратор БД** с четырьмя обязанностями:

| Обязанность | Где реализовано | Инструмент (существующий, не самописный) |
|---|---|---|
| Резервное копирование / восстановление | `server/src/routes/dba.js`, `scripts/backup_restore.py` | `pg_dump -Fc` / `pg_restore`, SHA-256 |
| Миграции схемы | `db/migrations/*.sql`, `server/src/dbAdmin/migrator.js` | DDL-транзакции PostgreSQL, `information_schema`, `pg_constraint` |
| Мониторинг производительности | `server/src/dbAdmin/monitor.js` | `pg_stat_activity`, `pg_stat_database`, `pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_stat_statements`, `pg_blocking_pids()` |
| Технический лог отдельно от бизнес-аудита | `tech_log` vs `audit_log`, `server/src/audit.js` | Разные таблицы, разные права, разные CHECK |

**Ключевая идея:** изобретать ничего не пришлось — всё это штатные возможности PostgreSQL
и уже существующие в проекте механизмы (RBAC, `elevated`, `writeTechLog`, `backup_job`).
Новый контур — это тонкая обвязка над ними, а не параллельная подсистема.

---

## 2. Разделение журналов (главное требование ТЗ)

| | `audit_log` (бизнес-аудит) | `tech_log` (технический лог) |
|---|---|---|
| Что пишет | действия пользователей с сущностями: CREATE/UPDATE/DELETE/LOGIN/EXPORT/DENY/OVERRIDE | BACKUP, RESTORE, MAINTENANCE, VACUUM, INDEX, MIGRATION, **MIGRATE**, **MIGRATE_SQL**, **ROLLBACK** |
| Кто | любая авторизованная роль | только `dba:*` / `tech:*` |
| Поля | `user_id`, `entity_name`, `entity_id`, `before_json`, `after_json`, `ip`, `user_agent`, `is_elevated`, `override_reason` | `admin_user_id`, `action_type`, `description`, `details`, `occurred_at` |
| Право на чтение | `audit:READ` (в т.ч. директор) | `tech:READ` / `dba:READ` |

Проверено на живой БД: после серии действий администратора БД (capture, ANALYZE,
preflight, rotate) `SELECT count(*) FROM audit_log` **не изменился** (283 → 283),
при этом в `tech_log` появились новые записи. Бизнес-журнал не засорён техническими
событиями — ровно то, что требует задание.

**Усиленный аудит сохранён:** все изменяющие ручки идут через `elevated()` — для
TECHNICAL-роли обязателен заголовок `X-Override-Reason` (иначе **428**), причина
попадает в `audit_log.is_elevated/override_reason`. Проверено: 3/3 POST без заголовка
вернули 428.

---

## 3. Изоляция доступа

Добавлены 2 права (в сиде `04_seed_demo.sql`, итого **44** вместо 42):

- `dba:READ` — просмотр миграций, копий, метрик;
- `dba:EXEC` — применение, откат, ротация, обслуживание.

Они выданы **только** роли `DBA`. Проверено на живой БД (`99_checks.sql`, CHECK 18):
у `DIRECTOR/VET/FOREMAN/STOREKEEPER` прав `dba:*` **ноль**.

| Проверка | Результат |
|---|---|
| `GET /dba/migrations` без токена | **401** |
| `GET /dba/migrations` под `director` | **403** |
| `GET /dba/migrations` под `dba` | **200** |
| `POST /dba/*` под `dba` без `X-Override-Reason` | **428** |
| `POST /dba/*` под `dba` с причиной | **200/201** |

---

## 4. Миграции схемы

### 4.1. Файлы

```
db/migrations/
  0001_baseline.sql           расширяет CHECK tech_log.action_type (MIGRATE/ROLLBACK)
  0002_db_admin.sql           schema_migration + db_metric_sample + индексы
  0003_indexes_analyze.sql    пример реального DDL: GIN по audit_log.after_json и составной индекс
```

Именование `NNNN_описание.sql`, версия = префикс. **Правило:** применённый файл не
правится — добавляется новый. Контрольная сумма SHA-256 хранится в реестре; если файл
изменили после применения, статус становится `CHANGED` (защита от «тихой» правки истории).

### 4.2. Реестр `schema_migration`

`version` (UNIQUE), `filename`, `checksum`, `status` (PENDING/APPLIED/FAILED/SKIPPED),
`applied_by`, `started_at`, `finished_at`, `duration_ms`, `backup_job_id`,
`objects_after`, `error_message`.

### 4.3. Как обеспечивается безопасность (три уровня)

1. **Dry-run = реальный прогон с откатом.** `POST /dba/migrations/preflight` исполняет
   файл в `BEGIN … ROLLBACK` и снимает инвентаризацию объектов до/после. Это не
   «эмуляция разбора SQL»: PostgreSQL сам выполнил DDL, а потом откатил его. Оператор
   видит настоящие ошибки и настоящий список новых индексов/таблиц.
2. **Защита от потери данных.** Перед применением та же проверка идёт в `SAVEPOINT`;
   если файл удаляет объекты или меняет число колонок — возвращается **409
   DESTRUCTIVE_MIGRATION** с перечнем объектов. Проверено: `DROP TABLE notification;`
   заблокирован, таблиц осталось 68 → 68.
3. **Атомарность.** Все файлы пачки и записи реестра идут в **одной** транзакции.
   Проверено: файл с `SELECT 1/0` после `CREATE TABLE` откатился целиком — ни
   таблицы, ни «мусорной» записи в реестре.

### 4.4. Связь с резервными копиями

`POST /dba/migrations/apply` перед транзакцией снимает полный `pg_dump` (копия не видит
незакоммиченных изменений) и сохраняет `backup_job_id` в реестре. Откат схемы —
`POST /dba/migrations/rollback` → `pg_restore` по этой копии → запись `restore_job` →
событие `ROLLBACK` в `tech_log`.

> Если окружение запрещает дочерние процессы (изолированная песочница), сервер
> **не скрывает** это: возвращает 503 с пояснением и пишет `backup_status: UNAVAILABLE`
> в техлог. Миграция при этом всё равно транзакционна. Штатный запуск из cmd —
> без ограничений.

### 4.5. Результат живого прогона

```
DRY 0001: ok=true  added=0  destructive=false
DRY 0002: ok=true  added=2  destructive=false
DRY 0003: ok=true  added=2  destructive=false
APPLY: 0001 (2 мс), 0002 (3 мс), 0003 (7 мс) → STATUS 0001/0002/0003: APPLIED
Схема: 68 таблиц, 2 новых индекса, CHECK tech_log расширен до 9 типов событий
```

---

## 5. Резервное копирование

| Операция | Путь | Инструмент |
|---|---|---|
| Создать копию | `POST /dba/backups` | `pg_dump -Fc` |
| Журнал копий (БД) | `GET /dba/backups` | `backup_job` |
| Файлы на диске | `GET /dba/backups/files` | чтение каталога (Node) |
| Ротация | `POST /dba/backups/rotate` | удаление по mtime (Node) |
| Верификация | `py scripts/backup_restore.py verify` | SHA-256 + `pg_restore --list` |
| Восстановление / откат | `POST /dba/migrations/rollback` | `pg_restore --clean --if-exists` |

**Реально проверено** (не «по регламенту», а выполнено на `farm_verify`):

```
$ py scripts/backup_restore.py backup --type FULL --retention 30
{"size_bytes": 698719, "checksum": "05150ab0…e26c2f"}

$ py scripts/backup_restore.py verify --file ... --checksum 05150ab0…
{"verified": true, "archive_readable": true, "size_bytes": 698719}

$ pg_restore --list <дамп>
; Archive created at 2026-11-10 16:15:34
;     dbname: farm_verify
;     TOC Entries: 614
;     Format: CUSTOM
```

Контрольная сумма из `.sha256` и из UI (`/dba/backups`) совпала.
Ротация, список файлов и чтение `.sha256` вынесены в `server/src/dbAdmin/backupFiles.js`
на Node: этим операциям не нужен `pg_dump`, и они работают даже там, где политика
процессов запрещает `spawn`.

**Исправлен реальный баг проекта:** в `routes/tech.js` путь к `backup_restore.py`
указывал в `server/scripts` (несуществующий каталог) вместо `WEB_Ferma/scripts`.
Именно поэтому в `Context.md` значилось «на живом pg_dump не прогонялся».
Также добавлен `FARM_PSQL_MODE=local` (по образцу `smoke_api.py`), чтобы скрипт не
пытался `docker exec`, когда демон Docker не запущен.

---

## 6. Мониторинг производительности

Всё берётся из системных представлений PostgreSQL — собственных счётчиков нет:

| Раздел | Источник | Что показывает |
|---|---|---|
| `/dba/monitor/health` | сводка по всем ниже | severity OK/WARNING/CRITICAL + **текстовый список проблем** |
| `/dba/monitor/tables` | `pg_stat_user_tables`, `pg_total_relation_size` | топ таблиц, мёртвые строки, последний вакуум |
| `/dba/monitor/indexes` | `pg_stat_user_indexes`, `pg_index` | неиспользуемые индексы (лишняя нагрузка на запись), seq scan |
| `/dba/monitor/slow` | `pg_stat_statements` | топ запросов по `total_exec_time`, `%` от нагрузки |
| `/dba/monitor/locks` | `pg_blocking_pids()` | кто кого блокирует + `wait_event` |
| `/dba/monitor/connections` | `pg_stat_activity`, `pg_stat_database` | соединения, состояния, длинные запросы |
| `/dba/monitor/history` | `db_metric_sample` | история снимков для графиков |
| `POST /dba/monitor/capture` | — | фиксирует снимок в историю |
| `POST /dba/monitor/refresh-stats` | `VACUUM/ANALYZE/REINDEX` | обслуживание, имя таблицы проверяется по `pg_class` |

**Честность данных.** Если `pg_stat_statements` не установлен, ручка возвращает
`available: false`, список *текущих* запросов из `pg_stat_activity` и инструкцию по
включению расширения — вместо выдуманных «медленных запросов». Это важно: на защите
легко проверить, что система не врёт.

**Пример реального вывода** (`farm_verify`, PostgreSQL 17.4):

```
SEVERITY: WARNING
DB: farm_verify | 36 MB | 59 таблиц | 193 индекса
conn: 7/100 | active: 1 | blocked: 0
cache_hit: 99.94% | index_usage: 98.88%
dead_rows: 241 | stale_tables: 52 | unused_idx: 20 | seq_heavy: 2
PROBLEMS:
  - 52 таблиц не вакуумировались сутки (мёртвых строк: 241)
  - pg_stat_statements не установлен — истории медленных запросов нет
```

**Защита от инъекций:** `target` в `refresh-stats` не подставляется в SQL строкой,
а ищется в `pg_class`; несуществующее имя (в т.ч. `animal; DROP TABLE animal`) даёт
**404**. Проверено.

---

## 7. Веб-интерфейс

В `ui/public/index.html` добавлена группа навигации **«Администратор БД»**
(видна только при `dba:READ`):

- `#/dba-migrations` — таблица версий, кнопки *Проверить (dry-run)*, *Применить*,
  *Реестр версий*;
- `#/dba-monitor` — 14 KPI, список проблем, таблицы обслуживания/индексов/seq scan/блокировок;
- `#/dba-backups` — файлы на диске с возрастом, сроком жизни и SHA-256.

Причину `X-Override-Reason` UI запрашивает сам (существующий `promptOverrideReason`
в `api()` при ответе 428). Проверено в браузере под `dba`: все 3 страницы
отрисовались, **консоль без ошибок**.

---

## 8. Регресс: что проверено после внедрения

| Проверка | Результат |
|---|---|
| `db/99_checks.sql` | **18/18 PASS** (добавлен CHECK 18; CHECK 1 теперь допускает 56..58 таблиц) |
| `scripts/run_tests.py` (unit) | **16/16 PASS**, 2/2 файла |
| `scripts/smoke_api.py` | **78/78 PASS** — регрессии в старом API нет |
| `node --check` всех новых файлов | OK |
| `py_compile` скриптов | OK |
| HTTP: 401 / 403 / 428 / 200 / 201 / 404 / 503 | все коды на своих местах |
| `audit_log` до/после действий DBA | 283 → 283 (не тронут) |
| Реальный `pg_dump` + `verify` + `pg_restore --list` | 614 TOC, SHA-256 совпал |
| Dry-run, защита от DROP, атомарный откат | 3/3 сценария пройдены |
| UI в браузере (Playwright) | 3 страницы, ошибок в консоли нет |

---

## 9. Файлы изменений

| Файл | Назначение |
|---|---|
| `db/migrations/0001_baseline.sql` | базовая линия + CHECK tech_log |
| `db/migrations/0002_db_admin.sql` | `schema_migration`, `db_metric_sample` |
| `db/migrations/0003_indexes_analyze.sql` | пример DDL-миграции |
| `server/src/dbAdmin/migrator.js` | раннер: dry-run, probe, защита, реестр |
| `server/src/dbAdmin/monitor.js` | разведка `pg_stat_*` |
| `server/src/dbAdmin/backupFiles.js` | список/ротация копий без дочерних процессов |
| `server/src/routes/dba.js` | 17 маршрутов `/dba/*` |
| `server/src/routes/tech.js` | исправлен путь к `backup_restore.py` |
| `server/src/index.js` | монтирование `/api/v1/dba` |
| `scripts/backup_restore.py` | `FARM_PSQL_MODE`, `rotate`, `list` |
| `scripts/sync_openapi_dba.py` | генерация 17 путей OpenAPI (идемпотентно) |
| `server/src/openapi.json` | v1.3.0, 63 пути |
| `db/04_seed_demo.sql` | права `dba:READ` / `dba:EXEC` (44 права) |
| `db/99_checks.sql` | CHECK 18, допуск 56..58 таблиц, 44 права |
| `ui/public/index.html`, `ui/public/app.js` | 4 страницы + рендер мониторинга |
| `docs/db_admin.md` | этот документ |

---

## 10. Что сказать на защите

1. «Инструменты уже были — я их не изобретал: `pg_dump/pg_restore`, DDL-транзакции
   PostgreSQL, `pg_stat_*`, `information_schema`. Обвязка тонкая, ~1000 строк».
2. «Миграции безопасны по построению: предварительный прогон — это реальное
   выполнение с откатом, а не симуляция. Разрушительный файл блокируется, упавший —
   откатывается атомарно вместе с записью в реестре».
3. «Техлог **физически** отдельная таблица и **логически** отдельные права. Под
   директором новый контур вообще не виден (403), а действия DBA не попадают в
   бизнес-аудит — проверил счётчиком строк до и после».
4. «Бэкап теперь реально работает: снял дамп, проверил SHA-256, открыл оглавление
   `pg_restore --list` — 614 объектов. Заодно починил путь к скрипту, из-за которого
   в базовой версии он не запускался».
5. «Мониторинг не врёт: где нет `pg_stat_statements`, система прямо говорит
   `available: false` и объясняет, как включить, вместо липовых цифр».
6. «Регресс закрыт: 18 SQL-проверок, 16 unit, 78 smoke — всё зелёное».
