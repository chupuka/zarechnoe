# -*- coding: utf-8 -*-
"""Сборка листингов самого веб-приложения в один Markdown-файл.

Скрипт обходит исходники ИС «Заречное» и собирает их в
`Приложение_А_Код.md` — текст программы для пояснительной записки.

Включаются ТОЛЬКО исходники приложения:
    db/**/*.sql                  схема, представления, триггеры, процедуры,
                                 демо-данные, проверки и миграции
    server/src/**                ядро REST API (JS, JSON, HTML)
    server/Dockerfile            образ ядра
    server/package.json         зависимости ядра
    services/reports/**         микросервис отчётности
    ui/public/**                клиентская часть (HTML, CSS, JS)
    docker-compose.yml          запуск стека

Исключаются: файлы окружения (.env*), node_modules, виртуальные окружения,
кэши, логи, бэкапы, тесты, вспомогательные скрипты, документация, lock-файлы
и любые другие файлы, не относящиеся к исходному коду веб-приложения.

Запуск:
    py scripts/generate_app_code.py
    py scripts/generate_app_code.py --out path/to/Приложение_А_Код.md
"""
import argparse
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Разрешённые каталоги исходников (относительный путь от ROOT).
INCLUDE_DIRS = (
    "db",
    "server/src",
    "services/reports",
    "ui/public",
)

# Разрешённые одиночные файлы (конфигурация запуска приложения).
INCLUDE_FILES = (
    "docker-compose.yml",
    "server/Dockerfile",
    "server/package.json",
    "services/reports/Dockerfile",
    "services/reports/package.json",
    "services/reports/index.js",
)

# Категорически исключённые имена каталогов.
EXCLUDE_DIRS = {
    "node_modules", "__pycache__", ".git", ".idea", ".vscode",
    ".venv", "venv", "env", ".env", "dist", "build", "coverage",
    "tmp", "tmp_test", "temp", "logs", "backups", "docs",
    "scripts", "tests", "uploads", ".pytest_cache", ".mypy_cache",
}

# Исключённые шаблоны имён файлов (файлы окружения, секреты, мусор, lock-файлы).
EXCLUDE_NAMES = {
    ".env", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    ".DS_Store", "Thumbs.db", "debug.log", "README.md", "CHANGELOG.md",
    ".gitignore", ".dockerignore",
}
EXCLUDE_PREFIXES = (".env.", "env.", "secrets.", "local.")
EXCLUDE_SUFFIXES = (
    ".env", ".log", ".dump", ".sha256", ".bak", ".pyc", ".pyo",
    ".tmp", ".swp", ".zip", ".gz", ".tar", ".png", ".jpg", ".jpeg",
    ".gif", ".ico", ".pdf", ".docx", ".xlsx", ".db", ".sqlite",
)

LANG = {
    ".sql": "sql", ".js": "javascript", ".mjs": "javascript",
    ".json": "json", ".html": "html", ".css": "css",
    ".yml": "yaml", ".yaml": "yaml", ".sh": "bash",
}

# Порядок разделов documentary-сборки.
SECTIONS = (
    ("База данных (схема, представления, триггеры, процедуры, миграции)", "db/"),
    ("Серверное ядро REST API (Node.js + Express)", "server/"),
    ("Микросервис отчётности", "services/reports/"),
    ("Веб-интерфейс (vanilla JS)", "ui/public/"),
    ("Конфигурация запуска", ""),
)


def is_excluded_dir(name):
    return name in EXCLUDE_DIRS or name.startswith(".")


def is_excluded_file(name):
    low = name.lower()
    if low in EXCLUDE_NAMES:
        return True
    if low.startswith(EXCLUDE_PREFIXES):
        return True
    if low.endswith(EXCLUDE_SUFFIXES):
        return True
    return False


def collect_files():
    """Возвращает отсортированный список разрешённых файлов (относительные пути)."""
    found = set()

    for rel_dir in INCLUDE_DIRS:
        base = os.path.join(ROOT, *rel_dir.split("/"))
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if not is_excluded_dir(d)]
            dirnames.sort()
            for name in sorted(filenames):
                if is_excluded_file(name):
                    continue
                rel = os.path.relpath(os.path.join(dirpath, name), ROOT).replace("\\", "/")
                found.add(rel)

    for rel in INCLUDE_FILES:
        if os.path.isfile(os.path.join(ROOT, *rel.split("/"))) and not is_excluded_file(os.path.basename(rel)):
            found.add(rel)

    # services/reports/index.js уже попадает через каталог, дубль не нужен
    return sorted(found)


def section_of(rel):
    if rel.startswith("db/"):
        return 0
    if rel.startswith("server/src/") or rel.startswith("server/"):
        return 1
    if rel.startswith("services/reports/"):
        return 2
    if rel.startswith("ui/public/"):
        return 3
    return 4


def anchor_for(rel):
    return "".join(ch for ch in rel.lower() if ch.isalnum())


def build(files):
    out = io.StringIO()
    out.write("# ПРИЛОЖЕНИЕ А. Текст программы\n\n")
    out.write("Исходный код информационной системы «Заречное» (курсовой проект, вариант 11). ")
    out.write("Файл собран скриптом `scripts/generate_app_code.py` **только из исходников веб-приложения**: ")
    out.write("база данных, серверное ядро, микросервис отчётности, клиентская часть и конфигурация запуска.\n\n")
    out.write("Стек: PostgreSQL 16 + PostGIS + pgcrypto · Node.js 22 + Express + pg + bcryptjs · ")
    out.write("vanilla JS + Leaflet/OpenStreetMap · Docker Compose.\n\n")
    out.write(f"Всего файлов: **{len(files)}**.\n\n")

    # Оглавление
    out.write("## Оглавление\n\n")
    for idx, (title, _) in enumerate(SECTIONS):
        group = [f for f in files if section_of(f) == idx]
        if not group:
            continue
        out.write(f"- {title} ({len(group)})\n")
        for f in group:
            out.write(f"  - [{f}](#{anchor_for(f)})\n")
    out.write("\n")

    # Листинги
    for idx, (title, _) in enumerate(SECTIONS):
        group = [f for f in files if section_of(f) == idx]
        if not group:
            continue
        out.write(f"\n## {title}\n\n")
        for rel in group:
            path = os.path.join(ROOT, *rel.split("/"))
            ext = os.path.splitext(rel)[1].lower()
            lang = LANG.get(ext, "")
            with io.open(path, "r", encoding="utf-8", errors="replace") as fh:
                code = fh.read().rstrip("\n")
            nlines = code.count("\n") + 1
            out.write(f"### Файл: `{rel}`\n\n")
            out.write(f"Строк: {nlines}\n\n")
            out.write(f"```{lang}\n{code}\n```\n\n")
    return out.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Сборка листингов веб-приложения в один Markdown")
    parser.add_argument(
        "--out", default=os.path.join(os.path.dirname(ROOT), "Приложение_А_Код.md"),
        help="путь к выходному Markdown-файлу",
    )
    args = parser.parse_args()

    files = collect_files()
    text = build(files)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with io.open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"OK: {args.out}")
    print(f"Файлов: {len(files)} | строк: {text.count(chr(10))} | символов: {len(text)}")


if __name__ == "__main__":
    main()
