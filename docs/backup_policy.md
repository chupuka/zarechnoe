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
| GET | `/api/v1/tech/backups/:id` | `backup:READ` | Карточка + восстановления |
| POST | `/api/v1/tech/backups` | `backup:EXEC` | Запустить бэкап |
| GET | `/api/v1/tech/restores` | `backup:READ` | Журнал восстановлений |
| POST | `/api/v1/tech/restores` | `backup:EXEC` | Восстановить из копии |
| GET | `/api/v1/tech/log` | `tech:READ` | Технический лог |
| GET | `/api/v1/tech/metrics` | `tech:READ` | Метрики БД |
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

1. **Фиксация «до»**: `SELECT count(*) FROM animal WHERE NOT is_deleted;` → 100.
2. **Создание копии**: `POST /api/v1/tech/backups` (`FULL`) → статус `OK`,
   сохранить `id`, `file_path`, `checksum`.
3. **Моделирование инцидента** (порча данных):
   ```sql
   -- только в демонстрационной БД!
   UPDATE animal SET is_deleted = TRUE WHERE id IN (SELECT id FROM animal LIMIT 3);
   ```
   `SELECT count(*) ...` → 97.
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
6. **Контроль «после»**: `SELECT count(*) FROM animal WHERE NOT is_deleted;` → 100;
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
