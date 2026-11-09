# CHANGELOG — ИС «Заречное»

Все значимые изменения проекта. Формат — [Keep a Changelog], версии по неделям.

## [v1.0.0] — Неделя 10 (релиз)

### Добавлено
- Техническая документация: `docs/tech_doc.md`, `docs/architecture.md`,
  `docs/reports.md`.
- CI/CD: `.github/workflows/ci.yml` (unit-тесты, проверки БД, smoke API).
- `docs/test_protocol.md` — протокол прохождения испытаний.
- `CHANGELOG.md`, `.gitignore`, инициализация Git-репозитория, релизный тег `v1.0.0`.

## [v0.9.0] — Неделя 9 (тестирование)

### Добавлено
- `docs/test_plan.md` (10 разделов, матрица трассируемости),
  `docs/test_cases.md` (64 тест-кейса в 12 группах).
- `tests/unit/validation.test.js` (9 тестов), `tests/unit/middleware.test.js` (7 тестов) —
  **16/16 PASS** без БД.
- `scripts/run_tests.py`, `scripts/load_test.py` (200 чтений, p95, ≥5k строк импорта).
- Fallback `FARM_PSQL_MODE=local` в `smoke_api.py` для запуска в CI без Docker CLI.

### Исправлено
- `asInt('  ')` / `asDecimal('  ')` возвращали `0` вместо `null` (добавлен trim-guard).

## [v0.8.0] — Неделя 8 (статистика и отчётность)

### Добавлено
- `server/src/routes/reports.js`: 5 отчётов + сводный дашборд,
  экспорт CSV с BOM, `series` для визуализаций.
- `/reports/aggregate` — прокси в микросервис агрегации.
- `docs/reports.md` — определения метрик (FCR, нагрузка голов/га, оборачиваемость).

## [v0.7.0] — Неделя 7 (клиент-серверное приложение)

### Добавлено
- Адаптивный веб-интерфейс `ui/public/` (3 брейкпоинта, Leaflet + OSM,
  ≥8 hotkeys, светлая/тёмная тема, RU/EN, брендбук).
- Микросервис отчётности `services/reports/` (`:4000`, свой пул, только чтение).
- `docker-compose.yml` (db + api + reports), `server/Dockerfile`, `services/reports/Dockerfile`.
- `docs/architecture.md` — схемы архитектуры, микросервисов, интерфейсов.

## [v0.6.0] — Неделя 6 (безопасность и администрирование)

### Добавлено
- 6 новых прав: `catalog:READ/WRITE`, `employee:READ/WRITE`, `backup:READ/EXEC` (итого **42**).
- `middleware/elevated.js` — обязательный `X-Override-Reason` для технических ролей (428),
  автоматическая запись `is_elevated`/`override_reason` в `audit_log`.
- Бизнес-админка `routes/admin.js`: пользователи (bcrypt, смена пароля, unlock,
  мягкое удаление + отзыв сессий), роли, права, настройки, аудит + CSV, сессии, уведомления.
- Технадминка `routes/tech.js`: бэкапы, восстановления, техлог, метрики, обслуживание.
- `scripts/backup_restore.py` (pg_dump/pg_restore, SHA-256, ротация),
  `docs/backup_policy.md`, `docs/security.md`.

### Изменено
- Справочники (`catalog.js`) переведены с прав доменов на `catalog:*` / `employee:*`.
- `db/99_checks.sql`: ожидаемое число прав 36 → 42.

## [v0.5.0] — Неделя 5 (расширенная серверная логика)

### Добавлено
- `src/validation.js` — декларативная серверная валидация.
- 14 справочников (CRUD-фабрика `routes/catalog.js`), API склада (`stock.js`),
  задач (`tasks.js`), пастбищ/выпаса (`pastures.js`).
- Транзакции с откатами (`withTransaction` + `FOR UPDATE`), тройной запрет минуса.
- `openapi.json` (19 путей), `smoke_api.py` расширен до ~50 проверок.

## [v0.4.0] — Неделя 4 (базовый сервер)

### Добавлено
- REST API: auth (bcrypt, sha256-токены), RBAC + `DENY`-аудит, CRUD животных,
  перевод статуса через `sp_change_animal_status`, централизованные ошибки,
  Swagger UI, `docs/server_api.md`.

## [v0.3.0] — Неделя 3 (БД)

### Добавлено
- 56 таблиц, 12 доменов, 93 FK, 185 индексов, 7 VIEW, 6 триггеров,
  12 процедур/функций, демо-данные (2 года), `db/99_checks.sql` (14 сценариев),
  `docs/db_structure.md`.

## [v0.2.0] — Неделя 2 (проектирование)

### Добавлено
- ER-диаграммы (key-to-key, 12 доменов), нормализация до 3НФ.

## [v0.1.0] — Неделя 1 (постановка задачи)

### Добавлено
- Выбор предметной области, формулировка целей и задач, входные/выходные данные.
