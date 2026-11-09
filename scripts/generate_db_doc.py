# -*- coding: utf-8 -*-
"""Генерация документации «Структурная схема БД» (Неделя 3) из живой БД.

Использование:  py scripts/generate_db_doc.py
Выход:          docs/db_structure.md
Требует запущенный контейнер farm_pg (см. README.md).
"""
import subprocess
import sys
from pathlib import Path

CONTAINER = "farm_pg"
PSQL = ["docker", "exec", "-i", CONTAINER, "psql", "-U", "farm", "-d", "farm", "-A", "-t", "-F", "\t"]

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "db_structure.md"

# Контуры (домены) в порядке ТЗ — количество таблиц совпадает с таблицы.xlsx
DOMAINS = [
    ("A", "Доступ и RBAC", ["role", "permission", "role_permission", "app_user", "user_session", "saved_filter"]),
    ("M", "Настройки хозяйства", ["farm_settings"]),
    ("B", "Персонал", ["position", "employee"]),
    ("C", "Поголовье", ["species", "breed", "animal_group", "animal", "animal_group_history"]),
    ("D", "Здоровье", ["diagnosis", "examination", "treatment", "drug",
                       "vaccination_schedule", "vaccination_event", "disposal_reason", "disposal_event"]),
    ("E", "Кормление и рационы", ["uom", "uom_conversion", "ration", "ration_item"]),
    ("F", "Склад", ["nomenclature", "supplier", "warehouse", "stock_batch", "stock_balance",
                    "movement_type", "write_off_reason", "stock_movement", "purchase_request"]),
    ("G", "Пастбища (PostGIS)", ["farm_boundary", "pasture_plot", "grazing_event"]),
    ("H", "Задачи", ["task_type", "task_series", "task", "task_animal_group",
                     "task_status_history", "task_execution"]),
    ("I", "Продукция", ["product_type", "production_record", "animal_weighing"]),
    ("J", "Закрытие периода", ["period_closure", "period_group_cost"]),
    ("K", "Импорт", ["import_job", "import_error"]),
    ("L", "Технический контур", ["audit_log", "tech_log", "backup_job", "restore_job", "notification"]),
]

VIEW_PURPOSE = {
    "v_animal_group_head_count": "Поголовье по группам (живые, без выбывших) — производный атрибут «число голов».",
    "v_active_grazing": "Активный выпас: группа, участок, площадь, дней на участке (экран «Выпас»).",
    "v_plot_rest_status": "Статус отдыха участков: прошёл ли период отдыха после последнего выпаса.",
    "v_vaccination_overdue": "Просрочка графика вакцинаций (next_due_date < сегодня) — основание для уведомлений.",
    "v_task_overdue": "Просроченные невыполненные задачи (статус NEW/IN_WORK, срок прошёл).",
    "v_task_execution_deviation": "Отклонение фактического расхода корма от нормы рациона по исполнениям.",
    "v_stock_balance_check": "Сверка остатков: qty_on_hand против расчёта initial + приход − расход (расхождений быть не должно).",
}

TRIGGER_PURPOSE = [
    ("trg_pasture_plot_area", "pasture_plot", "fn_calc_area_ha", "Автоматический расчёт площади участка (га) по контуру полигона."),
    ("trg_farm_boundary_area", "farm_boundary", "fn_calc_area_ha", "Автоматический расчёт площади границы хозяйства (га)."),
    ("trg_stock_movement_apply", "stock_movement", "fn_stock_movement_apply", "Атомарное обновление остатка на каждое движение; уход в минус блокируется CHECK."),
    ("trg_grazing_event_rest_check", "grazing_event", "fn_check_plot_rest", "Запрет назначения выпаса на участок, не прошедший период отдыха."),
    ("trg_production_record_withdrawal", "production_record", "fn_production_withdrawal_check", "Блокировка перевода продукции в READY до истечения withdrawal period."),
    ("trg_auto_purchase_request", "stock_balance", "fn_auto_purchase_request", "Авто-заявка на закупку + уведомление кладовщику при остатке ниже порога."),
]


def q(sql: str) -> list[list[str]]:
    res = subprocess.run(PSQL + ["-c", sql], capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        print(res.stderr, file=sys.stderr)
        sys.exit(1)
    rows = [line.split("\t") for line in res.stdout.splitlines()]
    return [r for r in rows if any(c != "" for c in r)]


def main() -> None:
    tables = q("""
        SELECT c.relname, COALESCE(obj_description(c.oid), ''),
               (SELECT count(*) FROM information_schema.columns k
                 WHERE k.table_schema='public' AND k.table_name=c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r' AND c.relname <> 'spatial_ref_sys'
        ORDER BY c.relname
    """)
    table_names = [t[0] for t in tables]

    # Точные счётчики строк одним запросом
    counts_sql = " UNION ALL ".join(
        f"SELECT '{t}' AS tbl, count(*) AS n FROM \"{t}\"" for t in table_names)
    counts = {r[0]: int(r[1]) for r in q(counts_sql)}

    columns = q("""
        SELECT table_name, column_name, data_type,
               CASE character_maximum_length WHEN NULL THEN '' ELSE '(' || character_maximum_length || ')' END,
               is_nullable, COALESCE(column_default, ''),
               CASE WHEN is_nullable = 'NO' THEN 'YES' ELSE '' END
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name <> 'spatial_ref_sys'
        ORDER BY table_name, ordinal_position
    """)
    col_by_table: dict[str, list] = {}
    for c in columns:
        col_by_table.setdefault(c[0], []).append(c)

    constraints = q("""
        SELECT conrelid::regclass::text, contype, conname, pg_get_constraintdef(oid)
        FROM pg_constraint
        WHERE connamespace = 'public'::regnamespace AND contype IN ('p','u','c')
        ORDER BY contype, conrelid::regclass::text, conname
    """)
    pk_cols: dict[str, str] = {}
    con_by_table: dict[str, list] = {}
    for tbl, ctype, cname, cdef in constraints:
        con_by_table.setdefault(tbl, []).append((ctype, cname, cdef))
        if ctype == "p":
            pk_cols[tbl] = cdef

    fks = q("""
        SELECT conrelid::regclass::text || '.' || a.attname,
               confrelid::regclass::text || '.' || b.attname,
               confdeltype,
               pg_get_constraintdef(oid)
        FROM pg_constraint c
        JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS ka(attnum, ord) ON TRUE
        JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS kb(attnum, ord) ON ka.ord = kb.ord
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ka.attnum
        JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = kb.attnum
        WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f'
        ORDER BY 1
    """)
    views = q("""
        SELECT viewname FROM pg_views
        WHERE schemaname='public'
          AND viewname NOT IN ('geography_columns', 'geometry_columns')
        ORDER BY viewname
    """)
    indexes = q("""
        SELECT tablename, indexname FROM pg_indexes
        WHERE schemaname='public' AND tablename <> 'spatial_ref_sys'
        ORDER BY tablename, indexname
    """)
    functions = q("""
        SELECT CASE WHEN p.proname LIKE 'sp\\_%' THEN 'procedure' ELSE 'function' END AS kind,
               p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
               pg_get_function_result(p.oid),
               COALESCE(d.description, '')
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        LEFT JOIN pg_description d ON d.objoid = p.oid AND d.classoid = 'pg_proc'::regclass
        WHERE n.nspname = 'public'
          AND (p.proname LIKE 'sp\\_%' OR p.proname LIKE 'fn\\_%')
        ORDER BY kind, p.proname
    """)
    idx_by_table: dict[str, list] = {}
    for tbl, idx in indexes:
        idx_by_table.setdefault(tbl, []).append(idx)

    delete_actions = {"a": "NO ACTION", "r": "RESTRICT", "c": "CASCADE", "n": "SET NULL", "d": "SET DEFAULT"}

    out: list[str] = []
    a = out.append

    a("# Структурная схема БД ИС «Заречное»")
    a("")
    a("> Документ сформирован автоматически из метаданных PostgreSQL 16 + PostGIS")
    a("> скриптом `scripts/generate_db_doc.py` (дата формирования — дата запуска).")
    a("> Источник схемы: `db/01_schema.sql` … `db/04_seed_demo.sql`.")
    a("")
    a("## 1. Обзор")
    a("")
    a("| Параметр | Значение |")
    a("|---|---|")
    a(f"| СУБД | PostgreSQL 16.4 + PostGIS 3.4 |")
    a(f"| Таблицы | {len(table_names)} |")
    a(f"| Внешние ключи | {len(fks)} |")
    a(f"| Ограничения (PK/UK/CHECK) | {len(constraints)} |")
    a(f"| Представления (VIEW) | {len(views)} |")
    a(f"| Индексы | {len(indexes)} |")
    a(f"| Триггеры | {len(TRIGGER_PURPOSE)} |")
    a(f"| Процедуры/функции | {len([f for f in functions if f[0] in ('procedure', 'function')])} |")
    a("")
    a("ER-диаграмма (ключ-к-лючу): `vrodOK/farm_er_keys.drawio`, пофамильные схемы доменов: `vrodOK/домены/*.drawio`.")
    a("")

    a("## 2. Распределение таблиц по доменам (12 контуров)")
    a("")
    a("| Контур | Домен | Таблиц | Таблицы |")
    a("|---|---|---|---|")
    for code, name, tables_list in DOMAINS:
        a(f"| {code} | {name} | {len(tables_list)} | {', '.join(f'`{t}`' for t in tables_list)} |")
    a(f"| — | **Итого** | **{len(table_names)}** | |")
    a("")

    a("## 3. Перечень таблиц (объём данных демо)")
    a("")
    a("| # | Таблица | Колонок | Строк (демо) | Комментарий |")
    a("|---|---|---|---|---|")
    comment_map = {t[0]: t[1] for t in tables}
    colcnt_map = {t[0]: t[2] for t in tables}
    for i, t in enumerate(sorted(table_names, key=lambda x: next(
            (di * 100 + ti for di, (_, _, tl) in enumerate(DOMAINS) for ti, tt in enumerate(tl) if tt == x), 999)), 1):
        a(f"| {i} | `{t}` | {colcnt_map[t]} | {counts.get(t, 0)} | {comment_map.get(t, '')} |")
    a("")

    a("## 4. Внешние ключи (связи таблиц)")
    a("")
    a("| # | Дочерняя таблица (колонка) | Родительская таблица (колонка) | ON DELETE |")
    a("|---|---|---|---|")
    for i, (child, parent, deltype, _cdef) in enumerate(fks, 1):
        a(f"| {i} | `{child}` | `{parent}` | {delete_actions.get(deltype, deltype)} |")
    a("")

    a("## 5. Ограничения целостности (PK / UNIQUE / CHECK)")
    a("")
    a("| Таблица | Тип | Определение |")
    a("|---|---|---|")
    ttype = {"p": "PRIMARY KEY", "u": "UNIQUE", "c": "CHECK"}
    for tbl, ctype, _cname, cdef in constraints:
        a(f"| `{tbl}` | {ttype[ctype]} | `{cdef}` |")
    a("")

    a("## 6. Каталог таблиц (колонки)")
    a("")
    for t in sorted(table_names):
        a(f"### `{t}`")
        a("")
        a(f"_{comment_map.get(t, '')}_")
        a("")
        a("| Колонка | Тип | NULL | По умолчанию |")
        a("|---|---|---|---|")
        for c in col_by_table.get(t, []):
            _tbl, name, dtype, lens, nullable, default, notnull = c
            typ = f"{dtype}{lens}"
            a(f"| {name} | {typ} | {'нет' if nullable == 'NO' else 'да'} | `{default}` |")
        a("")

    a("## 7. Представления (VIEW)")
    a("")
    for v in views:
        name = v[0]
        a(f"### `{name}`")
        a("")
        a(VIEW_PURPOSE.get(name, ""))
        a("")

    a("## 8. Функции, триггеры и хранимые процедуры (серверная логика)")
    a("")
    a("### 8.1. Триггеры (бизнес-правила на стороне СУБД)")
    a("")
    a("| Триггер | Таблица | Функция | Назначение |")
    a("|---|---|---|---|")
    for trg, tbl, fn, purpose in TRIGGER_PURPOSE:
        a(f"| `{trg}` | `{tbl}` | `{fn}` | {purpose} |")
    a("")
    a("### 8.2. Хранимые процедуры и функции")
    a("")
    a("| Тип | Объявление | Возвращает | Назначение |")
    a("|---|---|---|---|")
    for kind, decl, result, descr in functions:
        a(f"| {kind} | `{decl}` | `{result}` | {descr} |")
    a("")
    a("Полные листинги: `db/03_functions_triggers.sql`, `db/05_procedures.sql`;")
    a("проверка работы — `db/99_checks.sql` (14 сценариев).")
    a("")

    a("## 9. Индексы")
    a("")
    for t in sorted(idx_by_table):
        a(f"- **{t}**: " + ", ".join(f"`{i}`" for i in idx_by_table[t]))
    a("")

    a("---")
    a("*Как пересгенерировать: `py scripts/generate_db_doc.py` при запущенном контейнере `farm_pg`.*")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"OK: {OUT} ({len(out)} строк)")


if __name__ == "__main__":
    main()
