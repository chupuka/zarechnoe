# -*- coding: utf-8 -*-
"""Генератор документации серверной части (Неделя 4–5).

Собирает листинги исходников `server/src/**` в единый файл
`docs/server_api.md` с оглавлением и разметкой.

Запуск:  py scripts/generate_server_doc.py
"""
import os
import io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "server", "src")
OUT = os.path.join(ROOT, "docs", "server_api.md")

ORDER = [
    "index.js",
    "config.js",
    "db.js",
    "audit.js",
    "middleware/auth.js",
    "middleware/rbac.js",
    "middleware/errors.js",
    "routes/auth.js",
    "routes/animals.js",
    "openapi.json",
]

LANG = {".js": "javascript", ".json": "json", ".html": "html"}


def list_files():
    found = []
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames.sort()
        for fn in sorted(filenames):
            rel = os.path.relpath(os.path.join(dirpath, fn), SRC).replace("\\", "/")
            found.append(rel)
    ordered = [f for f in ORDER if f in found]
    ordered += sorted(f for f in found if f not in ORDER and f != "docs.html")
    return ordered


def main():
    files = list_files()
    out = io.StringIO()
    out.write("# Листинги кода серверной части — ИС «Заречное» (Неделя 4–5)\n\n")
    out.write("Документ сформирован скриптом `scripts/generate_server_doc.py` "
              "из исходников `server/src/`.\n\n")
    out.write("Сервер: Node.js 22 + Express, PostgreSQL 16 (пул `pg`), "
              "bcrypt-хэши, Bearer-токены в `user_session`.\n\n")
    out.write("## Оглавление\n\n")
    for f in files:
        anchor = f.replace("/", "").replace(".", "").replace("_", "").lower()
        out.write(f"- [{f}](#{anchor})\n")
    out.write("\n")

    for f in files:
        path = os.path.join(SRC, f)
        ext = os.path.splitext(f)[1]
        lang = LANG.get(ext, "")
        with io.open(path, "r", encoding="utf-8") as fh:
            code = fh.read().rstrip("\n")
        nlines = code.count("\n") + 1
        out.write(f"\n## `{f}`\n\n")
        out.write(f"Строк: {nlines}\n\n")
        out.write(f"```{lang}\n{code}\n```\n")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8") as fh:
        fh.write(out.getvalue())
    print(f"OK: {OUT} ({out.getvalue().count(chr(10))} строк, файлов: {len(files)})")


if __name__ == "__main__":
    main()
