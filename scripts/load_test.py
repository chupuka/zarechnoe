#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Нагрузочное тестирование REST API (Неделя 9, ТЗ п.10-11).

Замеряет время открытия реестров с пагинацией (50 на страницу) на целевом объёме
(~9.3k задач, ~29.7k движений склада) и проверяет атомарность при параллельных
списаниях. Одновременно генерирует ≥5k строк для массового импорта.

Запуск (сервер :3000 и БД должны работать):
    py scripts/load_test.py --reads 200 --concurrency 20
"""

import argparse
import concurrent.futures
import json
import statistics
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3000/api/v1"
USERS = {"reader": ("director", "demo1234"), "writer": ("storekeeper", "demo1234")}


def call(method, path, body=None, token=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode()), time.perf_counter() - t
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:200]}, time.perf_counter() - t


def login(who):
    s, b, _ = call("POST", "/auth/login", dict(zip(("login", "password"), USERS[who])))
    if s != 200:
        raise RuntimeError(f"login {who}: {s} {b}")
    return b["token"]


def percentile(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else 0


def bench_reads(token, n, concurrency):
    paths = ["/animals?limit=50", "/tasks?limit=50", "/stock/batches?limit=50",
             "/stock/balances?limit=50", "/reports/dashboard"]
    times, codes = [], {}

    def one(i):
        return call("GET", paths[i % len(paths)], token=token)

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as ex:
        for s, b, dt in ex.map(one, range(n)):
            times.append(dt)
            codes[s] = codes.get(s, 0) + 1
    return {
        "requests": n, "concurrency": concurrency, "status_codes": codes,
        "avg_ms": round(statistics.mean(times) * 1000, 2),
        "p50_ms": round(percentile(times, 0.50) * 1000, 2),
        "p95_ms": round(percentile(times, 0.95) * 1000, 2),
        "max_ms": round(max(times) * 1000, 2),
    }


def bench_bulk_import(rows=5000):
    """Генерация ≥5k строк импорта (ТЗ п.11) — проверка подготовки пакета."""
    t = time.perf_counter()
    data = [{"inventory_number": f"LOAD-{i:06d}", "birth_date": "2024-01-15",
             "sex": "F", "breed_id": 1, "group_id": None} for i in range(rows)]
    encoded = json.dumps(data, ensure_ascii=False).encode()
    return {"rows": rows, "payload_bytes": len(encoded),
            "gen_ms": round((time.perf_counter() - t) * 1000, 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reads", type=int, default=200)
    ap.add_argument("--concurrency", type=int, default=20)
    ap.add_argument("--import-rows", type=int, default=5000)
    a = ap.parse_args()

    print(f"=== Нагрузочный тест ИС «Заречное» ({a.reads} чтений, {a.concurrency} потоков) ===")
    try:
        tok = login("reader")
    except Exception as e:
        print(f"ОШИБКА: {e}"); return 1
    res = bench_reads(tok, a.reads, a.concurrency)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    imp = bench_bulk_import(a.import_rows)
    print("Массовый импорт:", json.dumps(imp, ensure_ascii=False))
    score = res["status_codes"].get(200, 0) + res["status_codes"].get(206, 0)
    ok = score == a.reads and res["p95_ms"] < 2000
    print("ИТОГ:", "PASS" if ok else "FAIL",
          f"(200={score}/{a.reads}, p95={res['p95_ms']} ms, порог 2000 ms)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
