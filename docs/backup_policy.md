# Регламент резервного копирования и восстановления

> ИС «Заречное» (Вариант 11), Неделя 6. Документ описывает политику бэкапов,
> ответственность Администратора БД и пошаговую демонстрацию restore.

## 1. Цели и ответственность

- **Цель RPO** (максимальная потеря данных): 24 ч при ежедневном ночном полном бэкапе;
  при включённых инкрементальных — 1 ч.
- **Цель RTO** (время восстановления): ≤ 30 мин на демо-объёме (~30k движений).
- **Ответственный**: Администратор БД (`dba`, роль `TECHNICAL`).
  Директор (`DIRECTOR`) имеет право **просмотра** (`backup:READ`), но не запуска.
- Технические роли при любом действии обязаны передавать заголовок
  `X-Override-Reason` — запись уходит в `audit_log` с `is_elevated = TRUE`.

## 2. Регламент

| Тип | Расписание | Хранение | Кто запускает |
|---|---|---|---|
| `FULL` (`pg_dump -Fc`) | Ежедневно 02:00 (ночной полный) | 30 дней | `dba` / планировщик |
| `INCREMENTAL` (`pg_dump -Fc` + WAL-архив) | Каждый час | 7 дней | `dba` |
| Внеплановый `FULL` | Перед миграцией схемы, перед массовым импортом | 30 дней | `dba` |
| `RESTORE` | По инциденту / демонстрация на защите | — | `dba` (обязательна причина) |

- Ротация: скрипт удаляет файлы старше `retention_days` (проверка при каждом бэкапе).
- Контрольная сумма **SHA-256** записывается в `.sha256` рядом с дампом
  и в `backup_job.checksum`; перед восстановлением проверяется повторно.
- Журнал: `backup_job` / `restore_job` (БД) + `tech_log` (технические действия,
  отдельно от бизнес-аудита) + `backups/registry.jsonl` (файловый след).
- Каталог бэкапов: `WEB_Ferma/backups/` (переопределяется `FARM_BACKUP_DIR`).

## 3. API

| Метод | Путь | Право | Назначение |
|---|---|---|---|
| GET | `/api/v1/tech/backups` | `backup:READ` | Журнал копий |
| GET | `/api/v1/tech/backups/overview` | `backup:READ` | **Всё для одной страницы**: текущая копия, период, история, восстановления, файлы, планировщик |
| GET | `/api/v1/tech/backups/:id` | `backup:READ` | Карточка + восстановления |
| GET | `/api/v1/tech/backups/:id/download` | `backup:READ` | Скачать файл дампа (Bearer-токен) |
| POST | `/api/v1/tech/backups` | `backup:EXEC` | Запустить бэкап |
| GET | `/api/v1/tech/backups/schedule` | `backup:READ` | Текущие настройки периода |
| PATCH | `/api/v1/tech/backups/schedule` | `backup:EXEC` | Изменить период/хранение |
| POST | `/api/v1/tech/backups/schedule/run` | `backup:EXEC` | Выполнить плановую копию сейчас |
| GET | `/api/v1/tech/restores` | `backup:READ` | Журнал восстановлений |
| POST | `/api/v1/tech/restores` | `backup:EXEC` | Восстановить из копии |
| GET | `/api/v1/tech/log` | `tech:READ` | Технический лог |
| GET | `/api/v1/tech/metrics` | `tech:READ` | Метрики БД |
| GET | `/api/v1/tech/metrics/perf` | `tech:READ` | Скорость запросов + вердикт |
| POST | `/api/v1/tech/metrics/perf/reset` | `tech:EXEC` | Сбросить накопленные замеры |
| POST | `/api/v1/tech/maintenance` | `tech:EXEC` | VACUUM / ANALYZE / REINDEX |

Пример запуска:

```bash
curl -X POST http://localhost:3000/api/v1/tech/backups \
  -H "Authorization: Bearer <token dba>" \
  -H "X-Override-Reason: Плановый ночной бэкап, регламент п.2" \
  -H "Content-Type: application/json" \
  -d "{\"backup_type\":\"FULL\",\"retention_days\":30}"
```

Ручной запуск без сервера:

```bash
py scripts/backup_restore.py backup --type FULL --retention 30
py scripts/backup_restore.py verify --file backups/farm_FULL_....dump --checksum <sha256>
py scripts/backup_restore.py restore --file backups/farm_FULL_....dump --checksum <sha256>
```

## 4. Демонстрация инцидента и восстановления (на защите)

1. **Фиксация «до»**: `SELECT count(*) FROM animal WHERE NOT is_deleted;` → 140.
2. **Создание копии**: `POST /api/v1/tech/backups` (`FULL`) → статус `OK`,
   сохранить `id`, `file_path`, `checksum`.
3. **Моделирование инцидента** (порча данных):
   ```sql
   -- только в демонстрационной БД!
   UPDATE animal SET is_deleted = TRUE WHERE id IN (SELECT id FROM animal LIMIT 3);
   ```
   `SELECT count(*) ...` → 137.
4. **Проверка целостности копии**: `GET /api/v1/tech/backups/:id` → `status = OK`,
   `checksum` совпадает с `.sha256`-файлом.
5. **Восстановление**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/tech/restores \
     -H "Authorization: Bearer <token dba>" \
     -H "X-Override-Reason: Демонстрация restore: порча 3 карточек животных" \
     -H "Content-Type: application/json" \
     -d "{\"backup_job_id\":<id>,\"reason\":\"Порча данных, инцидент DEMO-01\"}"
   ```
   `pg_restore --clean --if-exists` разворачивает дамп целиком.
6. **Контроль «после»**: `SELECT count(*) FROM animal WHERE NOT is_deleted;` → 140;
   `SELECT * FROM v_stock_balance_check WHERE abs(balance_qty - calc_qty) > 0.0001;` → пусто.
7. **Протокол**: `restore_job` = `OK`, `tech_log` содержит две записи
   (`BACKUP`, `RESTORE`), `audit_log` — CREATE на `restore_job` с `is_elevated`.

## 5. Проверки и тревоги

| Проверка | Ожидание | Действие при расхождении |
|---|---|---|
| `backup_job` за последние 24 ч | ≥ 1 со статусом `OK` | Немедленный внеплановый FULL |
| `checksum` дампа | Совпадает с `.sha256` | Копия признаётся повреждённой, restore запрещён |
| `v_stock_balance_check` | 0 расхождений | Сверка движений, при необходимости restore |
| Свободное место в `backups/` | ≥ 2× размер последнего FULL | Ротация / расширение диска |

## 6. Безопасность

- `pg_dump`/`pg_restore` вызываются через `child_process.execFile` **без shell** —
  аргументы не интерпретируются оболочкой (защита от инъекций).
- Пароль БД передаётся только через переменную окружения `PGPASSWORD` процесса.
- Дампы содержат персональные данные сотрудников → каталог `backups/`
  не публикуется в репозиторий (см. `.gitignore`), доступ ограничивается `dba`.
- Восстановление — разрушающая операция: обязательны причина (`reason`),
  право `backup:EXEC`, усиленный аудит и запись в `tech_log`.
- **Ключ ПДн не попадает в дамп**: `PII_KEY` живёт только в окружении сервера.
  При переносе копии на другой стенд ключ нужно передать отдельно и защищённо,
  иначе расшифровка `employee_pii` после restore станет невозможной.

## 7. Контур «Администратор БД» (`/dba/*`) и фактическая проверка

Помимо маршрутов Недели 6 (`/tech/*`), добавлен отдельный контур —
см. [db_admin.md](db_admin.md):

| Путь | Назначение |
|---|---|
| `POST /dba/backups` | снять копию (автокопия перед миграцией — обязательна) |
| `GET /dba/backups/files` | файлы на диске, возраст, срок по retention, SHA-256 |
| `POST /dba/backups/rotate` | ротация по сроку хранения |
| `POST /dba/migrations/rollback` | откат схемы к копии `backup_job` |

**Фактически выполнено 10.11.2026 на БД `farm_verify` (PostgreSQL 17.4):**

```
FARM_PSQL_MODE=local py scripts/backup_restore.py backup --type FULL --retention 30
→ 698 719 байт, checksum 05150ab0…e26c2f

py scripts/backup_restore.py verify --file ... --checksum 05150ab0…
→ {"verified": true, "archive_readable": true}

pg_restore --list <дамп>
→ Archive created at 2026-11-10 16:15:34; TOC Entries: 614; Format: CUSTOM
```

Ранее в базовой версии скрипт из технадминки не запускался: в `routes/tech.js`
путь указывал в несуществующий `server/scripts`. Путь исправлен на
`WEB_Ferma/scripts`. Если CLI Docker доступен, но демон не запущен, скрипт
пытался `docker exec` и падал — добавлен `FARM_PSQL_MODE=local` (по образцу
`smoke_api.py`) и автоопределение доступности демона.

**Ограничение окружения:** при запуске сервера в изолированной песочнице, где
политика процессов запрещает `spawn`, `POST /dba/backups` возвращает **503** с
пояснением, а `POST /dba/migrations/apply` явно помечает
`backup_status: UNAVAILABLE` в `tech_log`. Скрытого «бэкапа, которого не было»,
нет. При штатном запуске из командной строки ограничения нет.

## 8. Единая страница «Резервные копии» (v1.4.0)

Поиск по журналу бэкапов убран: страница `#/backups` получает один ответ
`GET /tech/backups/overview` и показывает:

1. **Текущая копия** — последняя успешная (`status = OK`): номер, тип, источник,
   время, размер, файл, инициатор, число восстановлений; кнопки «Скачать файл»,
   «Создать копию», «Восстановить из этой копии».
2. **Период копирования** — `enabled`, `schedule` (`DAILY`/`WEEKLY`/`OFF`), `time`,
   `retention_days`, `keep_last`. Настройки хранятся в `farm_settings`
   (`backup_enabled`, `backup_schedule`, `backup_time`, `backup_retention_days`,
   `backup_keep_last`), меняются через `PATCH /tech/backups/schedule` без пересборки.
   Кнопка «Выполнить план сейчас» вызывает `/tech/backups/schedule/run`.
3. **История копий** — все статусы (`RUNNING`/`OK`/`FAILED`), SHA-256, размер,
   срок хранения, число восстановлений и действия по строке.
4. **Восстановления** — на той же странице: копия, статус, время, причина, исполнитель.

Планировщик в процессе API (`backupScheduler.js`) читает настройки периодически
(`BACKUP_TICK_MS`) и при наступлении времени создаёт копию от имени системного
пользователя. Если последняя попытка провалилась, на странице показывается
отдельное предупреждение со ссылкой на тех. лог.
