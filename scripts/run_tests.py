#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Unit-тесты серверной логики (Неделя 9): validation.js, errors.js, elevated.js.

Запускаются БЕЗ БД и БЕЗ запущенного сервера — проверяют чистые функции
и middleware через mock-объекты req/res/next (Node.js + встроенный node:test).

Запуск:  node --test tests/unit/*.test.js
       или py scripts/run_tests.py --unit
"""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = os.environ.get("NODE_BIN", "node")


def main():
    tests = os.path.join(ROOT, "tests", "unit")
    if not os.path.isdir(tests):
        print(f"Нет каталога тестов: {tests}")
        return 1
    # Запускаем КАЖДЫЙ файл отдельным процессом в одном процессе Python:
    # `node --test <dir>` спавнит дочерние node-процессы, что блокируется
    # в изолированных окружениях (EPERM). Прямой запуск даёт тот же TAP-отчёт.
    files = sorted(f for f in os.listdir(tests) if f.endswith(".test.js"))
    failed = 0
    for f in files:
        path = os.path.join(tests, f)
        print(f"--- {f} ---")
        r = subprocess.run([NODE, path], cwd=ROOT)
        if r.returncode != 0:
            failed += 1
    print(f"\n=== UNIT: {len(files) - failed}/{len(files)} файлов успешно ===")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
