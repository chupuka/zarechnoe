# -*- coding: utf-8 -*-
"""Добавляет в openapi.json контур «Администратор БД» (/dba/*).

Идемпотентно: повторный запуск не дублирует теги/пути и не удлиняет описание.
Запуск: py scripts/sync_openapi_dba.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "server", "src", "openapi.json")

with open(P, encoding="utf-8") as f:
    d = json.load(f)

MARK = "**Администратор БД:**"
if MARK not in d["info"]["description"]:
    d["info"]["description"] += (
        "\n\n**Администратор БД:** `/dba/*` — миграции схемы (реестр версий, "
        "предварительный прогон с откатом, защита от разрушительных изменений), "
        "резервное копирование/восстановление, мониторинг производительности "
        "(`pg_stat_*`). Технический лог отделён от бизнес-аудита; права `dba:*` "
        "есть только у техролей."
    )
d["info"]["version"] = "1.3.0"

tagnames = {t["name"] for t in d["tags"]}
if "dba" not in tagnames:
    d["tags"].append({
        "name": "dba",
        "description": "Администратор БД: миграции схемы, бэкапы, мониторинг (только техроли, dba:*)",
    })

OK = {"200": {"description": "Успешно"}}
CREATED = {"201": {"description": "Создано"}}
GUARD = [
    {"401": {"description": "Не авторизован"}},
    {"403": {"description": "Нет права dba:READ / dba:EXEC"}},
    {"428": {"description": "Техроли нужен заголовок X-Override-Reason"}},
]


def merge_responses(*items):
    out = {}
    for it in items:
        if isinstance(it, list):
            for x in it:
                out.update(x)
        else:
            out.update(it)
    return out


READ = merge_responses(OK, GUARD[:2])
WRITE = merge_responses(CREATED, GUARD)


def op(summary, desc, responses, params=None, body=None):
    r = {"tags": ["dba"], "summary": summary, "description": desc, "responses": responses}
    if params:
        r["parameters"] = params
    if body:
        r["requestBody"] = {
            "required": True,
            "content": {"application/json": {"schema": {"type": "object", "properties": body}}},
        }
    return r


def get(summary, desc, params=None):
    return {"get": op(summary, desc, READ, params)}


def post(summary, desc, body=None):
    return {"post": op(summary, desc, WRITE, body=body)}


def qp(name, typ="string", desc=""):
    return {"name": name, "in": "query", "required": False,
            "schema": {"type": typ}, "description": desc}


paths = {
    "/dba/migrations": get(
        "Состояние миграций схемы",
        "Файлы db/migrations/*.sql сопоставлены с реестром schema_migration: "
        "NEW/PENDING/APPLIED/FAILED/CHANGED (CHANGED = файл изменён после применения)."),
    "/dba/migrations/history": get(
        "Реестр применённых версий",
        "Записи schema_migration: контрольная сумма, длительность, кто применил, ошибки."),
    "/dba/migrations/preflight": post(
        "Предварительный прогон (dry-run)",
        "Каждый ожидающий файл реально выполняется в транзакции и ОТКАТЫВАЕТСЯ: "
        "оператор видит результат и список объектов схемы, не меняя БД."),
    "/dba/migrations/apply": post(
        "Применить миграции",
        "Перед применением снимается полная резервная копия. Все файлы идут в ОДНОЙ "
        "транзакции (all-or-nothing). Разрушительные файлы (DROP/изменение колонок) "
        "блокируются до явного подтверждения. Событие пишется в tech_log.",
        {"version": {"type": "string", "description": "Конкретная версия (иначе все ожидающие)"},
         "create_backup": {"type": "boolean", "description": "false — без автокопии"}}),
    "/dba/migrations/rollback": post(
        "Откат схемы к резервной копии",
        "Восстановление через pg_restore; создаёт запись restore_job и пишет ROLLBACK в tech_log.",
        {"backup_job_id": {"type": "integer"}, "reason": {"type": "string"}}),
    "/dba/backups": get("Журнал резервных копий", "backup_job + связанные восстановления."),
    "/dba/backups/files": get(
        "Копии на диске",
        "Реальное содержимое каталога backups: размер, возраст, срок жизни по retention, SHA-256.",
        [qp("retention", "integer", "Срок хранения в днях (по умолчанию 30)")]),
    "/dba/backups/rotate": post(
        "Ротация копий",
        "Удаляет .dump и .sha256 старше retention дней. Выполняется Node без дочерних процессов.",
        {"retention_days": {"type": "integer"}}),
    "/dba/monitor/health": get(
        "Сводка здоровья БД",
        "pg_stat_*: соединения, кэш-хит, мёртвые строки, неиспользуемые индексы, "
        "блокировки, seq scan + интерпретация проблем (severity OK/WARNING/CRITICAL)."),
    "/dba/monitor/tables": get("Топ таблиц", "Размер, мёртвые строки, вакуум, чтения."),
    "/dba/monitor/indexes": get("Индексы", "Неиспользуемые индексы и таблицы с полным перебором."),
    "/dba/monitor/slow": get(
        "Медленные запросы",
        "История из pg_stat_statements. Если расширение не установлено — честно "
        "возвращает available:false и только текущие запросы из pg_stat_activity."),
    "/dba/monitor/locks": get("Блокировки", "pg_blocking_pids(): кто кого ждёт и события ожидания."),
    "/dba/monitor/connections": get("Соединения", "По базам, по состояниям, длинные запросы."),
    "/dba/monitor/capture": post(
        "Снять снимок метрик",
        "Пишет db_metric_sample для графиков; событие в tech_log."),
    "/dba/monitor/history": get(
        "История снимков", "db_metric_sample, последние N.",
        [qp("limit", "integer", "Кол-во записей (по умолчанию 100)")]),
    "/dba/monitor/refresh-stats": post(
        "Обслуживание БД",
        "VACUUM / ANALYZE / REINDEX. Имя таблицы проверяется по каталогу pg_class — "
        "ввод не попадает в SQL напрямую (защита от инъекций).",
        {"operation": {"type": "string", "enum": ["VACUUM", "ANALYZE", "REINDEX"]},
         "target": {"type": "string", "description": "Имя таблицы в public (необязательно)"}}),
}

for path, methods in paths.items():
    if path not in d["paths"]:
        d["paths"][path] = methods
    else:
        for verb, spec in methods.items():
            d["paths"][path].setdefault(verb, spec)

with open(P, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"OpenAPI {d['info']['version']}: {len(d['paths'])} путей, тег dba, {len(paths)} путей /dba/*")
