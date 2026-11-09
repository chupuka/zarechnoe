# -*- coding: utf-8 -*-
"""Синхронизация openapi.json с Неделями 6–8 (администрирование, отчёты, микросервис).

Запуск: py scripts/sync_openapi.py
Добавляет теги и пути, сохраняя уже описанные (auth/animals/неделя 5).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "server", "src", "openapi.json")

with open(P, encoding="utf-8") as f:
    d = json.load(f)

d["info"]["version"] = "1.2.0"
d["info"]["description"] += (
    "\n\n**Неделя 6:** `/admin/*` (бизнес-админка), `/tech/*` (технадминка), "
    "усиленный аудит технических ролей (заголовок `X-Override-Reason`)."
    "\n\n**Неделя 7:** адаптивный UI на `/app`, микросервис отчётности `:4000`."
    "\n\n**Неделя 8:** 5 отчётов + дашборд с экспортом CSV."
)

tagnames = {t["name"] for t in d["tags"]}
for t in [
    {"name": "admin", "description": "Бизнес-админка: пользователи, роли, права, настройки, журналы"},
    {"name": "tech", "description": "Технадминка: бэкапы, восстановления, техлог, метрики, обслуживание"},
    {"name": "reports", "description": "Статистика и отчётность (5 отчётов + дашборд + агрегация)"},
    {"name": "catalogs", "description": "14 справочников (CRUD-фабрика, выделенные права catalog:*)"},
]:
    if t["name"] not in tagnames:
        d["tags"].append(t)


def op(tag, summary, desc=None, params=None, body=None, responses=None, security=None):
    o = {"tags": [tag], "summary": summary}
    if desc:
        o["description"] = desc
    if security is not None:
        o["security"] = security
    if params:
        o["parameters"] = params
    if body:
        o["requestBody"] = {"required": True, "content": {"application/json": {
            "schema": {"$ref": f"#/components/schemas/{body}"}}}}
    o["responses"] = responses or {
        "200": {"description": "ОК"},
        "400": {"$ref": "#/components/responses/BadRequest"},
        "401": {"$ref": "#/components/responses/Unauthorized"},
        "403": {"$ref": "#/components/responses/Forbidden"},
    }
    return o


def created():
    return {"201": {"description": "Создано"},
            "400": {"$ref": "#/components/responses/BadRequest"},
            "401": {"$ref": "#/components/responses/Unauthorized"},
            "403": {"$ref": "#/components/responses/Forbidden"}}


ID = {"name": "id", "in": "path", "required": True, "schema": {"type": "integer"}}
KEY = {"name": "key", "in": "path", "required": True, "schema": {"type": "string"}}
COMMON = [
    {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 50}},
    {"name": "offset", "in": "query", "schema": {"type": "integer", "default": 0}},
]
REASON = {"name": "X-Override-Reason", "in": "header", "required": False,
          "description": "ОБЯЗАТЕЛЕН для TECHNICAL-ролей (SUPERUSER, DBA): причина действия, ≤500 символов",
          "schema": {"type": "string", "maxLength": 500}}

paths = d["paths"]

# ---- Бизнес-админка --------------------------------------------------------
paths["/admin/roles"] = {"get": op("admin", "Список ролей с числом прав и пользователей")}
paths["/admin/roles/{id}"] = {"parameters": [ID], "get": op("admin", "Роль и её права")}
paths["/admin/permissions"] = {"get": op("admin", "Каталог прав (42)", params=COMMON)}
paths["/admin/users"] = {
    "get": op("admin", "Реестр учётных записей (без хэшей паролей)",
              "Фильтры: q, role_id, include_deleted; сортировка и пагинация.",
              params=COMMON + [{"name": "q", "in": "query", "schema": {"type": "string"}},
                              {"name": "role_id", "in": "query", "schema": {"type": "integer"}}]),
    "post": op("admin", "Создать пользователя (bcrypt)",
               "Для технических ролей обязателен X-Override-Reason.",
               body="UserCreate", responses=created(), params=[REASON]),
}
paths["/admin/users/{id}"] = {
    "parameters": [ID],
    "get": op("admin", "Карточка пользователя"),
    "patch": op("admin", "Изменить реквизиты (роль, активность, сотрудник)",
                body="UserPatch", params=[REASON]),
    "delete": op("admin", "Мягкое удаление + отзыв всех сессий в одной транзакции",
                 params=[REASON]),
}
paths["/admin/users/{id}/reset-password"] = {"parameters": [ID],
    "post": op("admin", "Смена пароля (bcrypt, must_change_pw)",
               body="PasswordReset", params=[REASON])}
paths["/admin/users/{id}/unlock"] = {"parameters": [ID],
    "post": op("admin", "Снять временную блокировку", params=[REASON])}
paths["/admin/settings"] = {"get": op("admin", "Настройки хозяйства (farm_settings)")}
paths["/admin/settings/{key}"] = {"parameters": [KEY],
    "patch": op("admin", "Изменить настройку (тип NUM/BOOL/DATE/TEXT контролируется БД)",
                body="SettingPatch", params=[REASON])}
paths["/admin/audit-log"] = {"get": op("admin", "Журнал бизнес-аудита",
    "Фильтры: user_id, entity_name, action, q, date_from, date_to, is_elevated.",
    params=COMMON + [
        {"name": "action", "in": "query", "schema": {"type": "string"}},
        {"name": "is_elevated", "in": "query", "schema": {"type": "boolean"}},
        {"name": "date_from", "in": "query", "schema": {"type": "string", "format": "date"}},
    ])}
paths["/admin/audit-log/export"] = {"get": op("admin", "Выгрузка аудита в CSV (BOM, разделитель ;)",
    "Требует export:EXEC; факт выгрузки пишется в аудит.",
    responses={"200": {"description": "text/csv"},
               "403": {"$ref": "#/components/responses/Forbidden"}})}
paths["/admin/sessions"] = {"get": op("admin", "Активные сессии (без token_hash)",
    params=COMMON + [{"name": "user_id", "in": "query", "schema": {"type": "integer"}}])}
paths["/admin/notifications"] = {"get": op("admin", "Уведомления текущего пользователя",
    params=COMMON + [{"name": "unread_only", "in": "query", "schema": {"type": "boolean"}}])}
paths["/admin/notifications/{id}/read"] = {"parameters": [ID],
    "patch": op("admin", "Пометить уведомление прочитанным (только своё)")}

# ---- Технадминка -----------------------------------------------------------
paths["/tech/backups"] = {
    "get": op("tech", "Журнал резервных копий", params=COMMON + [
        {"name": "status", "in": "query", "schema": {"type": "string"}}]),
    "post": op("tech", "Создать резервную копию (pg_dump -Fc, SHA-256)",
               "Требует backup:EXEC + X-Override-Reason; пишется в tech_log.",
               body="BackupCreate", responses=created(), params=[REASON]),
}
paths["/tech/backups/{id}"] = {"parameters": [ID],
    "get": op("tech", "Карточка копии + связанные восстановления")}
paths["/tech/restores"] = {
    "get": op("tech", "Журнал восстановлений", params=COMMON),
    "post": op("tech", "Восстановление из копии (pg_restore --clean)",
               "Разрушающая операция: обязательна причина, проверка checksum, tech_log.",
               body="RestoreCreate", responses=created(), params=[REASON]),
}
paths["/tech/log"] = {"get": op("tech", "Технический лог (отдельно от бизнес-аудита)",
    params=COMMON + [{"name": "action_type", "in": "query", "schema": {"type": "string"}}])}
paths["/tech/metrics"] = {"get": op("tech", "Метрики БД: соединения, размер, счётчики")}
paths["/tech/maintenance"] = {"post": op("tech", "VACUUM / ANALYZE / REINDEX",
    "Вне транзакции; результат пишется в tech_log.",
    body="Maintenance", params=[REASON])}

# ---- Отчёты ----------------------------------------------------------------
REPORT_PARAMS = [
    {"name": "format", "in": "query", "description": "json (по умолчанию) | csv",
     "schema": {"type": "string", "enum": ["json", "csv"]}},
    {"name": "from", "in": "query", "schema": {"type": "string", "format": "date"}},
    {"name": "to", "in": "query", "schema": {"type": "string", "format": "date"}},
]
reports = {
    "cost-fcr": "Себестоимость и конверсия корма (FCR) по группам и месяцам",
    "herd-health": "Здоровье поголовья: доля больных, выбраковка, просрочки вакцинаций",
    "pasture-load": "Нагрузка на пастбища: голов/га, период отдыха, риск перевыпаса",
    "tasks-in-work": "Задачи в работе: просрочки, загрузка бригады",
    "stock-turnover": "Остатки склада и обороты: дефицит, неликвид",
    "dashboard": "Сводный дашборд (KPI + динамика склада за 12 месяцев)",
    "aggregate": "Помесячная агрегация в микросервисе отчётности (reports-service :4000)",
}
for name, desc in reports.items():
    paths[f"/reports/{name}"] = {"get": op("reports", desc,
        "Доступ: report:READ; CSV-экспорт дополнительно требует export:EXEC.",
        params=REPORT_PARAMS)}

# ---- Схемы -----------------------------------------------------------------
s = d["components"]["schemas"]
s["UserCreate"] = {"type": "object", "required": ["login", "password", "full_name", "role_id"],
    "properties": {
        "login": {"type": "string", "example": "new_user"},
        "password": {"type": "string", "description": "≥8 символов, ≥1 заглавной, ≥1 цифры"},
        "full_name": {"type": "string"},
        "role_id": {"type": "integer"},
        "employee_id": {"type": "integer", "nullable": True},
        "must_change_pw": {"type": "boolean"}}}
s["UserPatch"] = {"type": "object", "properties": {
    "full_name": {"type": "string"}, "role_id": {"type": "integer"},
    "employee_id": {"type": "integer", "nullable": True},
    "is_active": {"type": "boolean"}, "must_change_pw": {"type": "boolean"}}}
s["PasswordReset"] = {"type": "object", "required": ["password"],
                       "properties": {"password": {"type": "string"}}}
s["SettingPatch"] = {"type": "object", "properties": {
    "value": {"type": "string"}, "description": {"type": "string"}}}
s["BackupCreate"] = {"type": "object", "required": ["backup_type"],
    "properties": {
        "backup_type": {"type": "string", "enum": ["FULL", "INCREMENTAL"]},
        "retention_days": {"type": "integer", "default": 30},
        "note": {"type": "string"}}}
s["RestoreCreate"] = {"type": "object", "required": ["backup_job_id", "reason"],
    "properties": {"backup_job_id": {"type": "integer"},
                   "reason": {"type": "string", "description": "Причина инцидента"}}}
s["Maintenance"] = {"type": "object", "required": ["operation"],
    "properties": {"operation": {"type": "string", "enum": ["VACUUM", "ANALYZE", "REINDEX"]},
                   "note": {"type": "string"}}}
s["ReportRow"] = {"type": "object", "description": "Строка отчёта (набор полей зависит от отчёта)",
                  "additionalProperties": True}
# kind для 428
s["Error"]["properties"]["kind"]["enum"].append("precondition_required")

with open(P, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
    f.write("\n")

print(f"OK: {P}\n  путей: {len(d['paths'])}, тегов: {len(d['tags'])}, схем: {len(s)}")
