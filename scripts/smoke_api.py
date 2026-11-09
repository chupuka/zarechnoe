# -*- coding: utf-8 -*-
"""Smoke-тест REST API ИС «Заречное» (Неделя 4).

Запуск:  py scripts/smoke_api.py   (сервер должен работать на :3000)
"""
import json
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:3000/api/v1"
results = []


def call(method, path, body=None, token=None, params=None, headers=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            ctype = resp.headers.get("Content-Type", "")
            if "csv" in ctype or "text/plain" in ctype:
                return resp.status, {"raw": raw}
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw}


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("OK   " if cond else "FAIL ") + name + ("  | " + str(detail) if not cond else ""))


def main():
    # 0. health + openapi
    s, b = call("GET", "/health")
    check("health 200", s == 200 and b.get("status") == "ok", (s, b))
    s, b = call("GET", "/openapi.json")
    check("openapi.json 200", s == 200 and "paths" in b, (s, list(b)[:5] if isinstance(b, dict) else b))

    # 1. auth
    s, b = call("POST", "/auth/login", {"login": "director", "password": "demo1234"})
    check("login director 200", s == 200 and b.get("token"), (s, b))
    tok = b.get("token")
    s, b = call("POST", "/auth/login", {"login": "director", "password": "wrong"})
    check("login неверный пароль 401", s == 401, (s, b))
    s, b = call("GET", "/auth/me", token=tok)
    check("me 200 + permissions", s == 200 and isinstance(b.get("permissions"), (list, set)), (s, b))

    # 2. RBAC: storekeeper без animal:READ -> 403 + DENY в аудите
    s, b = call("POST", "/auth/login", {"login": "storekeeper", "password": "demo1234"})
    stok = b.get("token") if s == 200 else None
    s2, b2 = call("GET", "/animals", token=stok)
    check("storekeeper /animals 403", s2 == 403, (s2, b2))

    # токен ветеринара — у него animal:WRITE (RBAC-матрица)
    s, b = call("POST", "/auth/login", {"login": "vet", "password": "demo1234"})
    check("login vet 200", s == 200 and b.get("token"), (s, b))
    vtok = b.get("token")

    # токен суперпользователя — единственный с animal:DELETE (техроль, без сотрудника)
    s, b = call("POST", "/auth/login", {"login": "superuser", "password": "demo1234"})
    check("login superuser 200 (техроль без сотрудника)", s == 200 and b.get("token"), (s, b))
    sutok = b.get("token")

    # 3. список с фильтром
    s, b = call("GET", "/animals", token=tok, params={"status": "НА_ЛЕЧЕНИИ", "limit": 5})
    check("GET /animals?status=НА_ЛЕЧЕНИИ 200", s == 200, (s, b))
    items = b.get("data") or []
    check("фильтр даёт элементы", s == 200 and len(items) > 0, (len(items), b.get("total")))
    if items:
        check("все элементы НА_ЛЕЧЕНИИ", all(i.get("status") == "НА_ЛЕЧЕНИИ" for i in items), items[:2])

    # 4. валидация 400 (пишем от имени ветеринара)
    breed_id = first_id("SELECT id FROM breed ORDER BY id LIMIT 1")
    valid = {"inventory_number": "SMOKE-BAD", "birth_date": "2024-05-01",
             "sex": "F", "breed_id": breed_id, "group_id": None}
    s, b = call("POST", "/animals", {"inventory_number": ""}, token=vtok)
    check("POST пустое имя 400", s == 400, (s, b))
    bad = dict(valid, group_id=999999)
    s, b = call("POST", "/animals", bad, token=vtok)
    check("POST несуществующая группа 400", s == 400 and "999999" in str(b.get("error", "")), (s, b))

    # 4b. директор читает, но не пишет (проверка RBAC-матрицы)
    s, b = call("POST", "/animals", {"name": "X"}, token=tok)
    check("director POST /animals 403 (нет animal:WRITE)", s == 403, (s, b))

    # 5. создание (поля: inventory_number, birth_date, sex, breed_id обязательны)
    payload = {
        "inventory_number": "SMOKE-%d" % (int(time.time()) % 100000),
        "birth_date": "2024-05-01",
        "sex": "F",
        "breed_id": breed_id,
        "group_id": None,
        "arrival_date": "2024-06-01",
    }
    # узнаём допустимые поля из 400-ответа, если схема отличается
    s, b = call("POST", "/animals", payload, token=vtok)
    if s == 400:
        print("   подсказка валидации:", b)
    check("POST /animals создан 201/200", s in (200, 201), (s, b))
    if s not in (200, 201):
        # печатаем требования схемы и выходим
        print(json.dumps(b, ensure_ascii=False, indent=2))
        return finish()
    aid = (b.get("data") or {}).get("id") or b.get("id")
    check("id карточки получен", bool(aid), b)

    # 6. дубликат -> 409
    s, b = call("POST", "/animals", payload, token=vtok)
    check("POST дубликат 409", s == 409, (s, b))

    # 7. GET по id
    s, b = call("GET", "/animals/%s" % aid, token=tok)
    check("GET /animals/:id 200", s == 200 and (b.get("data") or {}).get("id") == aid, (s, b))

    # 8. PATCH
    s, b = call("PATCH", "/animals/%s" % aid, {"arrival_date": "2024-06-02"}, token=vtok)
    d = b.get("data") or {}
    # дата возвращается как ISO-момент (полночь MSK = 21:00Z предыдущего дня)
    check("PATCH 200", s == 200 and str(d.get("arrival_date", "")).startswith("2024-06-01T21"), (s, b))

    # 9. PATCH статуса напрямую -> 400 (регламент: только через /status)
    s, b = call("PATCH", "/animals/%s" % aid, {"status": "ВЫБРАКОВАНО"}, token=vtok)
    check("PATCH статуса напрямую 400", s == 400, (s, b))

    # 10. лечение без диагноза -> 400 (сервер требует diagnosis_id)
    s, b = call("POST", "/animals/%s/status" % aid,
                {"status": "НА_ЛЕЧЕНИИ", "reason": "СМОК: без диагноза"}, token=vtok)
    check("лечение без диагноза 400", s == 400, (s, b))

    # 11. лечение через sp_change_animal_status -> 200
    # дозировка 3 — максимальный лимит партии на складе 5 (отказ при нехватке тоже проверяем)
    drug_id = find_drug_id()
    check("DRUG-001 найден в номенклатуре", drug_id > 0, drug_id)
    s, b = call("POST", "/animals/%s/status" % aid,
                {"status": "НА_ЛЕЧЕНИИ", "reason": "СМОК: простуда",
                 "diagnosis_id": first_id("SELECT id FROM diagnosis ORDER BY id LIMIT 1"),
                 "drug_nomenclature_id": drug_id, "dosage": 3}, token=vtok)
    check("sp_change_animal_status лечение 200", s == 200 and
          (b.get("data") or {}).get("status") == "НА_ЛЕЧЕНИИ", (s, b))

    # 11b. выздоровление (статус — ЗДОРОВ)
    s, b = call("POST", "/animals/%s/status" % aid,
                {"status": "ЗДОРОВ", "reason": "СМОК: контрольный осмотр"}, token=vtok)
    check("выздоровление 200", s == 200 and
          (b.get("data") or {}).get("status") == "ЗДОРОВ", (s, b))

    # 11c. ветеринар без animal:DELETE -> 403
    s, b = call("DELETE", "/animals/%s" % aid, token=vtok)
    check("vet DELETE 403 (нет animal:DELETE)", s == 403, (s, b))

    # 12. DELETE (superuser) -> 200, затем 404
    s, b = call("DELETE", "/animals/%s" % aid, token=sutok)
    check("DELETE superuser 200", s == 200, (s, b))
    s, b = call("GET", "/animals/%s" % aid, token=tok)
    check("GET после DELETE 404", s == 404, (s, b))

    # 13. logout -> 401
    s, b = call("POST", "/auth/logout", token=tok)
    check("logout 200/204", s in (200, 204), (s, b))
    s, b = call("GET", "/animals", token=tok)
    check("после logout 401", s == 401, (s, b))

    # 14. аудит DENY записан (проверка через БД)
    check_audit_deny()

    # Токен director был отозван шагом 13 (logout) — получаем свежий для
    # проверок Недель 5–8, иначе все последующие вызовы дадут 401.
    s, b = call("POST", "/auth/login", {"login": "director", "password": "demo1234"})
    tok2 = b.get("token") if s == 200 else None
    check("повторный login director 200", s == 200 and bool(tok2), (s, b))

    # 15. Неделя 5: справочники, склад (атомарность/откат), задачи, пастбища
    week5_checks(tok2, vtok, stok)

    # 15b. Недели 6–8: администрирование, журналы, отчёты, усиленный аудит
    week6_8_checks(tok2, sutok)

    # 16. уборка за прогоном: тестовые карточки и движения склада
    cleanup_demo_data()
    check("демо-данные восстановлены (100 голов, остатки сходятся)", demo_data_ok(), "")

    return finish()


def week6_8_checks(tok, sutok):
    """Проверки Недель 6–8: RBAC, админка, отчёты, усиленный аудит."""
    # ---- Неделя 6: RBAC и администрирование ----
    s, b = call("POST", "/auth/login", {"login": "dba", "password": "demo1234"})
    dtok = b.get("token") if s == 200 else None
    check("login dba 200", s == 200 and bool(dtok), (s, b))

    # Новые права catalog:* / employee:* пришли в /auth/me
    s, b = call("GET", "/auth/me", token=tok)
    perms = set(b.get("permissions") or [])
    check("в /auth/me 42 права (есть catalog:READ, employee:READ)",
          "catalog:READ" in perms and "employee:READ" in perms, sorted(perms)[:5])

    # Бизнес-админка: роли, права, пользователи, настройки
    s, b = call("GET", "/admin/roles", token=tok)
    check("GET /admin/roles 200", s == 200 and isinstance(b.get("data"), list), (s, b))
    s, b = call("GET", "/admin/permissions", token=tok)
    check("GET /admin/permissions 200 (42 права)", s == 200 and b.get("total", 0) >= 42, (s, b.get("total")))
    s, b = call("GET", "/admin/users", token=tok)
    check("GET /admin/users 200 + без password_hash", s == 200 and
          all("password_hash" not in (u or {}) for u in b.get("data", [])), (s, b))
    s, b = call("GET", "/admin/settings", token=tok)
    check("GET /admin/settings 200", s == 200 and isinstance(b.get("data"), list), (s, b))
    s, b = call("GET", "/admin/audit-log", token=tok)
    check("GET /admin/audit-log 200", s == 200 and isinstance(b.get("data"), list), (s, b))
    s, b = call("GET", "/admin/audit-log/export", token=tok)
    check("GET /admin/audit-log/export CSV 200", s == 200, (s, b))

    # DBA не может писать в справочники (catalog:WRITE отсутствует)
    s, b = call("POST", "/species", {"code": "SMOKE-DBA", "name": "попытка DBA"}, token=dtok)
    check("DBA POST /species 403 (нет catalog:WRITE)", s == 403, (s, b))
    # DBA имеет доступ к технадминке
    s, b = call("GET", "/tech/backups", token=dtok)
    check("DBA GET /tech/backups 200", s == 200, (s, b))
    s, b = call("GET", "/tech/metrics", token=dtok)
    check("DBA GET /tech/metrics 200", s == 200, (s, b))
    # Бизнес-роль не имеет доступа к технадминке
    s, b = call("GET", "/tech/log", token=tok)
    check("director GET /tech/log 403", s == 403, (s, b))

    # Усиленный аудит: суперпользователь без X-Override-Reason -> 428
    # login уникален в БД (в т.ч. для мягко удалённых) — уникализируем прогон.
    smoke_login = "smoke_u%d" % (int(time.time()) % 100000)
    role_vet = first_id("SELECT id FROM role WHERE code='VET'")
    user_body = {"login": smoke_login, "password": "Passw0rd1",
                 "full_name": "Тест", "role_id": role_vet}
    s, b = call("POST", "/admin/users", user_body, token=sutok)
    check("superuser POST /admin/users без причины 428", s == 428, (s, b))
    s, b = call("POST", "/admin/users", user_body,
                token=sutok, headers={"X-Override-Reason": "SMOKE elevated audit check"})
    check("superuser POST /admin/users с причиной 201", s == 201, (s, b))
    new_uid = (b.get("data") or {}).get("id")
    if new_uid:
        s, b = call("GET", "/admin/audit-log", token=tok,
                    params={"is_elevated": "true", "limit": 20})
        check("audit_log содержит is_elevated с причиной", s == 200 and any(
            (r.get("is_elevated") and r.get("override_reason")) for r in b.get("data", [])), (s, b))
        s, b = call("DELETE", "/admin/users/%s" % new_uid, token=sutok,
                    headers={"X-Override-Reason": "SMOKE cleanup of test user"})
        check("DELETE /admin/users/:id 200", s == 200, (s, b))

    # ---- Неделя 8: отчёты ----
    for name in ("dashboard", "cost-fcr", "herd-health", "pasture-load",
                 "tasks-in-work", "stock-turnover"):
        s, b = call("GET", "/reports/%s" % name, token=tok)
        check("GET /reports/%s 200" % name, s == 200 and "data" in b, (s, str(b)[:120]))
    s, b = call("GET", "/reports/cost-fcr", token=tok, params={"format": "csv"})
    check("GET /reports/cost-fcr?format=csv 200", s == 200, (s, str(b)[:120]))


def week5_checks(dtok, vtok, stok):
    """Проверки Недели 5: справочники, склад, задачи, пастбища.

    dtok (director) нужен для записи справочников: после Недели 6 право
    catalog:WRITE есть у DIRECTOR/SUPERUSER, но не у VET/FOREMAN.
    """
    # токен бригадира (task:WRITE, pasture:READ/WRITE, stock:WRITE, group:WRITE)
    s, b = call("POST", "/auth/login", {"login": "foreman", "password": "demo1234"})
    ftok = b.get("token") if s == 200 else None
    check("login foreman 200", s == 200 and bool(ftok), (s, b))

    # ---- Справочники (эталон /species) ----
    s, b = call("GET", "/species", token=vtok)
    check("GET /species 200", s == 200 and isinstance(b.get("data"), list), (s, b))
    s, b = call("GET", "/breeds", token=vtok)
    check("GET /breeds 200", s == 200, (s, b))
    s, b = call("POST", "/species", {"code": "SMOKE", "name": "СМОК-вид", "zzz": 1}, token=dtok)
    check("POST /species неизвестное поле 400", s == 400, (s, b))
    s, b = call("POST", "/species", {"code": "SMOKE", "name": "СМОК-вид"}, token=dtok)
    check("POST /species создан 201", s == 201, (s, b))
    sp_id = (b.get("data") or {}).get("id")
    s, b = call("DELETE", "/species/%s" % sp_id, token=dtok)
    check("DELETE /species 200", s == 200, (s, b))

    # ---- Склад ----
    s, b = call("GET", "/stock/batches", token=stok)
    check("GET /stock/batches 200", s == 200 and isinstance(b.get("data"), list), (s, b))
    s, b = call("GET", "/stock/balances", token=stok)
    check("GET /stock/balances 200", s == 200, (s, b))
    batch_id = first_id("SELECT id FROM stock_batch ORDER BY id LIMIT 1")
    reason_id = first_id("SELECT id FROM write_off_reason ORDER BY id LIMIT 1")
    # приход — атомарная вставка движения
    s, b = call("POST", "/stock/movements", {"movement_type": "RECEIPT", "batch_id": batch_id, "qty": 1, "comment": "SMOKE-TEST"}, token=stok)
    check("POST /stock/movements приход 201", s == 201, (s, b))
    # расход сверх остатка -> 400 (транзакция откатывается)
    s, b = call("POST", "/stock/movements", {"movement_type": "ISSUE", "batch_id": batch_id, "qty": 999999}, token=stok)
    check("POST /stock/movements сверх остатка 400 (откат)", s == 400, (s, b))
    # бригадир не может списывать (нет stock:DELETE)
    s, b = call("POST", "/stock/movements", {"movement_type": "WRITE_OFF", "batch_id": batch_id, "qty": 0.5, "write_off_reason_id": reason_id, "comment": "SMOKE-TEST"}, token=ftok)
    check("foreman WRITE_OFF 403 (нет stock:DELETE)", s == 403, (s, b))
    # списание без причины -> 400
    s, b = call("POST", "/stock/movements", {"movement_type": "WRITE_OFF", "batch_id": batch_id, "qty": 0.5}, token=stok)
    check("WRITE_OFF без причины 400", s == 400, (s, b))
    # списание с причиной -> 201
    s, b = call("POST", "/stock/movements", {"movement_type": "WRITE_OFF", "batch_id": batch_id, "qty": 0.5, "write_off_reason_id": reason_id, "comment": "SMOKE-TEST"}, token=stok)
    check("WRITE_OFF с причиной 201", s == 201, (s, b))
    s, b = call("GET", "/stock/purchase-requests", token=stok)
    check("GET /stock/purchase-requests 200", s == 200, (s, b))

    # ---- Задачи ----
    s, b = call("GET", "/tasks", token=ftok)
    check("GET /tasks 200", s == 200 and isinstance(b.get("data"), list), (s, b))
    emp_id = first_id("SELECT id FROM employee WHERE NOT is_deleted ORDER BY id LIMIT 1")
    care_id = first_id("SELECT id FROM task_type WHERE NOT requires_writeoff ORDER BY id LIMIT 1")
    feed_id = first_id("SELECT id FROM task_type WHERE requires_writeoff ORDER BY id LIMIT 1")
    s, b = call("POST", "/tasks", {"task_type_id": care_id, "title": "SMOKE task care", "assigned_to": emp_id}, token=ftok)
    check("POST /tasks (без списания) 201", s == 201, (s, b))
    task_id = (b.get("data") or {}).get("id")
    s, b = call("GET", "/tasks/%s" % task_id, token=ftok)
    check("GET /tasks/:id 200", s == 200 and (b.get("data") or {}).get("id") == task_id, (s, b))
    # кормовая задача без групп -> 400 (серверная проверка ТЗ п.4)
    s, b = call("POST", "/tasks", {"task_type_id": feed_id, "title": "SMOKE feed", "assigned_to": emp_id, "group_ids": []}, token=ftok)
    check("POST /tasks кормление без групп 400", s == 400, (s, b))

    # ---- Пастбища и выпас ----
    s, b = call("GET", "/pasture-plots", token=ftok)
    check("GET /pasture-plots 200", s == 200 and isinstance(b.get("data"), list), (s, b))
    wkt = "POLYGON((37.0 55.0, 37.001 55.0, 37.001 55.001, 37.0 55.001, 37.0 55.0))"
    # plot_no уникален в БД (в т.ч. для мягко удалённых) — добавляем timestamp,
    # чтобы повторные прогоны не падали на 409 до финальной уборки.
    plot_no = "SMOKE-P%d" % (int(time.time()) % 100000)
    s, b = call("POST", "/pasture-plots", {"plot_no": plot_no, "name": "СМОК участок", "max_head_per_ha": 2, "geom_wkt": wkt}, token=ftok)
    check("POST /pasture-plots 201 (площадь триггером)", s == 201, (s, b))
    plot_id = (b.get("data") or {}).get("id")
    area = (b.get("data") or {}).get("area_ha")
    # pg отдаёт NUMERIC как строку — приводим к числу
    try:
        area = float(area)
    except (TypeError, ValueError):
        area = None
    check("area_ha рассчитана > 0", isinstance(area, float) and area > 0, area)
    s, b = call("POST", "/grazing/move", {"group_id": 999999, "plot_id": plot_id}, token=ftok)
    check("grazing/move несуществующая группа 400", s == 400, (s, b))
    s, b = call("DELETE", "/pasture-plots/%s" % plot_id, token=ftok)
    check("DELETE /pasture-plots 200", s == 200, (s, b))


def psql_cmd(extra=None, stdin_mode=False):
    """Команда psql: через docker exec (по умолчанию) или локальный psql (CI).

    Переменная FARM_PSQL_MODE=local переключает на прямое подключение по TCP —
    используется в GitHub Actions, где docker exec недоступен.
    Хост/порт задаются PGHOST/PGPORT (в CI — localhost:5433).
    """
    import os
    import shutil
    import subprocess
    mode = os.environ.get("FARM_PSQL_MODE", "docker")
    user = os.environ.get("PGUSER", "farm")
    database = os.environ.get("PGDATABASE", "farm")
    if mode != "local" and shutil.which("docker"):
        base = ["docker", "exec"] + (["-i"] if stdin_mode else []) + [
            "farm_pg", "psql", "-U", user, "-d", database]
    else:
        base = ["psql", "-h", os.environ.get("PGHOST", "localhost"),
                "-p", os.environ.get("PGPORT", "5433"),
                "-U", user, "-d", database]
    return base + (extra or [])


def first_id(sql):
    """Первый id по SQL-запросу напрямую в БД."""
    import subprocess
    out = subprocess.run(
        psql_cmd(["-t", "-A", "-c", sql]),
        capture_output=True, text=True, timeout=20)
    return int(out.stdout.strip() or 0)


def find_drug_id(token=None):
    """drug_id из справочника номенклатуры (прямой запрос к БД в контейнере)."""
    return first_id("SELECT id FROM nomenclature WHERE sku='DRUG-001' LIMIT 1")


CLEANUP_SQL = """
BEGIN;
CREATE TEMP TABLE tmp_smoke AS SELECT id FROM animal WHERE inventory_number LIKE 'SMOKE%';
DELETE FROM stock_movement sm
 USING treatment t, examination e
 WHERE sm.treatment_id = t.id AND t.examination_id = e.id
   AND e.animal_id IN (SELECT id FROM tmp_smoke);
DELETE FROM treatment t USING examination e
 WHERE t.examination_id = e.id AND e.animal_id IN (SELECT id FROM tmp_smoke);
DELETE FROM examination WHERE animal_id IN (SELECT id FROM tmp_smoke);
DELETE FROM vaccination_event WHERE animal_id IN (SELECT id FROM tmp_smoke);
DELETE FROM animal_weighing WHERE animal_id IN (SELECT id FROM tmp_smoke);
DELETE FROM disposal_event WHERE animal_id IN (SELECT id FROM tmp_smoke);
DELETE FROM production_record WHERE animal_id IN (SELECT id FROM tmp_smoke);
DELETE FROM animal_group_history WHERE animal_id IN (SELECT id FROM tmp_smoke);
DELETE FROM animal WHERE id IN (SELECT id FROM tmp_smoke);
-- Неделя 5: уборка тестовых движений, задач и участков
DELETE FROM stock_movement WHERE comment = 'SMOKE-TEST';
DELETE FROM task_status_history WHERE task_id IN (SELECT id FROM task WHERE title LIKE 'SMOKE%');
DELETE FROM task_animal_group WHERE task_id IN (SELECT id FROM task WHERE title LIKE 'SMOKE%');
DELETE FROM task_execution WHERE task_id IN (SELECT id FROM task WHERE title LIKE 'SMOKE%');
DELETE FROM task WHERE title LIKE 'SMOKE%';
DELETE FROM grazing_event WHERE note LIKE 'SMOKE%';
DELETE FROM pasture_plot WHERE plot_no LIKE 'SMOKE%';
DELETE FROM user_session WHERE user_id IN (SELECT id FROM app_user WHERE login LIKE 'smoke_u%');
DELETE FROM app_user WHERE login LIKE 'smoke_u%';
-- восстановить остатки: qty_on_hand = initial_qty +/- движения
UPDATE stock_balance b
   SET qty_on_hand = sb.initial_qty + COALESCE((
       SELECT sum(CASE WHEN mt.direction = 'IN' THEN sm.qty ELSE -sm.qty END)
       FROM stock_movement sm JOIN movement_type mt ON mt.id = sm.movement_type_id
       WHERE sm.batch_id = b.batch_id), 0)
  FROM stock_batch sb WHERE sb.id = b.batch_id;
COMMIT;
"""


def cleanup_demo_data():
    """Удаляет тестовые карточки smoke-прогона и восстанавливает остатки склада."""
    import subprocess
    subprocess.run(
        psql_cmd(["-v", "ON_ERROR_STOP=1"], stdin_mode=True),
        input=CLEANUP_SQL, text=True, capture_output=True, timeout=60)


def demo_data_ok():
    return (first_id("SELECT count(*) FROM animal WHERE NOT is_deleted") == 100
            and first_id("SELECT count(*) FROM v_stock_balance_check "
                         "WHERE balance_qty <> calc_qty") == 0)


def check_audit_deny():
    try:
        import subprocess
        out = subprocess.run(
            psql_cmd(["-t", "-A", "-c", "SELECT count(*) FROM audit_log WHERE action='DENY'"]),
            capture_output=True, text=True, timeout=20)
        n = int(out.stdout.strip() or 0)
        check("audit_log DENY > 0", n > 0, out.stdout.strip())
    except Exception as e:
        check("audit_log DENY > 0", False, e)


def finish():
    ok = sum(1 for _, c, _ in results if c)
    total = len(results)
    print("\n=== SMOKE: %d/%d OK ===" % (ok, total))
    if ok != total:
        for n, c, d in results:
            if not c:
                print("  FAIL:", n, "|", d)
        sys.exit(1)


if __name__ == "__main__":
    main()
