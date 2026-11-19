#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Резервное копирование и восстановление ИС «Заречное» (Неделя 6).

Вызывается сервером (routes/tech.js) через execFile — БЕЗ shell, аргументы
не интерпретируются оболочкой (защита от инъекций). Может запускаться и вручную:

    py scripts/backup_restore.py backup --type FULL --retention 30
    py scripts/backup_restore.py restore --file backups/farm_FULL_20261109_180000.dump
    py scripts/backup_restore.py verify --file ... --checksum <sha256>

Формат: custom-дамп pg_dump -Fc, совместим с pg_restore (восстановление
селективно/полное). Контрольная сумма SHA-256 сохраняется рядом (.sha256).
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.environ.get("FARM_BACKUP_DIR", os.path.join(ROOT, "backups"))

# Параметры подключения к БД (совпадают с server/src/config.js)
DB = {
    "host": os.environ.get("PGHOST", "localhost"),
    "port": os.environ.get("PGPORT", "5433"),
    "user": os.environ.get("PGUSER", "farm"),
    "password": os.environ.get("PGPASSWORD", "farm"),
    "database": os.environ.get("PGDATABASE", "farm"),
}
CONTAINER = os.environ.get("FARM_PG_CONTAINER", "farm_pg")
# Как в scripts/smoke_api.py: local — утилиты PostgreSQL в PATH (без Docker CLI),
# docker — pg_dump/pg_restore внутри контейнера. Если переменная не задана,
# Docker выбирается только когда он реально доступен (демон отвечает).
MODE = os.environ.get("FARM_PSQL_MODE", "").lower()


def _env():
    e = os.environ.copy()
    e["PGPASSWORD"] = DB["password"]
    return e


def _docker_available():
    if MODE == "local":
        return False
    if MODE == "docker":
        return True
    if not shutil.which("docker"):
        return False
    try:
        r = subprocess.run(["docker", "info", "--format", "{{.ServerVersion}}"],
                           capture_output=True, text=True, timeout=8)
        return r.returncode == 0
    except Exception:
        return False


_DOCKER_OK = None


def _use_docker():
    global _DOCKER_OK
    if _DOCKER_OK is None:
        _DOCKER_OK = _docker_available()
    return _DOCKER_OK


def _psql_base():
    """psql/pg_dump внутри Docker-контейнера или локально — по доступности."""
    return ["docker", "exec", "-i", CONTAINER] if _use_docker() else []


def _dump_base():
    return ["docker", "exec", CONTAINER] if _use_docker() else []


def _run(cmd, *, env=None, input_text=None, timeout=600):
    r = subprocess.run(cmd, env=env or _env(), input=input_text,
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])}...: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_backup(args):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = f"farm_{args.type}_{ts}_{args.id or 'manual'}.dump"
    fpath = os.path.join(BACKUP_DIR, fname)

    cmd = _dump_base() + [
        "pg_dump", "-Fc", "-h", DB["host"], "-p", DB["port"],
        "-U", DB["user"], "-d", DB["database"], "-f", fpath,
    ]
    if not _dump_base():
        # pg_dump локально: вывод в файл через stdout
        cmd = ["pg_dump", "-Fc", "-h", DB["host"], "-p", DB["port"],
               "-U", DB["user"], "-d", DB["database"]]
        r = subprocess.run(cmd, env=_env(), capture_output=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.decode("utf-8", "replace"))
        with open(fpath, "wb") as fh:
            fh.write(r.stdout)
    else:
        _run(cmd, timeout=600)

    checksum = _sha256(fpath)
    with open(fpath + ".sha256", "w", encoding="utf-8") as fh:
        fh.write(checksum + "  " + fname + "\n")

    # Ротация: удаляем копии старше retention дней
    removed = _rotate(args.retention)
    _append_registry({"action": "backup", "file": fname, "type": args.type,
                      "size_bytes": os.path.getsize(fpath), "checksum": checksum,
                      "retention_days": args.retention, "note": args.note,
                      "ts": dt.datetime.now().isoformat(timespec="seconds"),
                      "removed_expired": removed})
    return {"file_path": fpath, "size_bytes": os.path.getsize(fpath),
            "checksum": checksum, "type": args.type, "removed_expired": removed}


def _rotate(retention_days):
    cutoff = dt.datetime.now() - dt.timedelta(days=retention_days)
    removed = []
    for name in os.listdir(BACKUP_DIR):
        p = os.path.join(BACKUP_DIR, name)
        if not os.path.isfile(p) or not (name.endswith(".dump") or name.endswith(".sha256")):
            continue
        if dt.datetime.fromtimestamp(os.path.getmtime(p)) < cutoff:
            os.remove(p)
            removed.append(name)
    return removed


def cmd_rotate(args):
    """Ротация вручную: удалить копии старше retention дней (с .sha256-спутниками).

    Не удаляет только что созданный .dump, если тот оказался старше порога не
    должен — mtime всегда = момент записи, так что это безопасно.
    """
    removed = _rotate(args.retention)
    _append_registry({"action": "rotate", "retention_days": args.retention,
                      "removed": removed,
                      "ts": dt.datetime.now().isoformat(timespec="seconds")})
    return {"removed": removed, "removed_count": len(removed),
            "retention_days": args.retention}


def cmd_list(args):
    """Список копий на диске: имя, размер, mtime, срок до удаления по retention."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    now = dt.datetime.now()
    items = []
    for name in sorted(os.listdir(BACKUP_DIR)):
        if not name.endswith(".dump"):
            continue
        p = os.path.join(BACKUP_DIR, name)
        mtime = dt.datetime.fromtimestamp(os.path.getmtime(p))
        age_days = (now - mtime).total_seconds() / 86400.0
        items.append({
            "file": name, "path": p, "size_bytes": os.path.getsize(p),
            "created_at": mtime.isoformat(timespec="seconds"),
            "age_days": round(age_days, 2),
            "expires_in_days": round(args.retention - age_days, 2),
            "will_expire": age_days >= args.retention,
            "has_checksum": os.path.isfile(p + ".sha256"),
        })
    total = sum(i["size_bytes"] for i in items)
    return {"files": items, "count": len(items), "total_bytes": total,
            "backup_dir": BACKUP_DIR, "retention_days": args.retention}


def _append_registry(entry):
    reg = os.path.join(BACKUP_DIR, "registry.jsonl")
    with open(reg, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def cmd_verify(args):
    if not os.path.isfile(args.file):
        raise RuntimeError(f"Файл не найден: {args.file}")
    actual = _sha256(args.file)
    if args.checksum and actual != args.checksum:
        raise RuntimeError("Контрольная сумма НЕ совпала — дамп повреждён, восстановление запрещено")
    _run(_dump_base() + ["pg_restore", "--list", args.file], timeout=120)
    return {"file": args.file, "checksum": actual, "verified": True,
            "archive_readable": True, "size_bytes": os.path.getsize(args.file)}


def cmd_restore(args):
    v = cmd_verify(argparse.Namespace(file=args.file, checksum=args.checksum))
    # Полное восстановление: сначала очищаем схему, затем разворачиваем дамп.
    # ВАЖНО: --clean --if-exists в pg_restore удалит объекты перед созданием.
    cmd = _dump_base() + [
        "pg_restore", "-h", DB["host"], "-p", DB["port"], "-U", DB["user"],
        "-d", DB["database"], "--clean", "--if-exists", "--no-owner", args.file,
    ]
    _run(cmd, timeout=900)
    _append_registry({"action": "restore", "file": os.path.basename(args.file),
                      "restore_id": args.id, "checksum": args.checksum,
                      "ts": dt.datetime.now().isoformat(timespec="seconds")})
    return {**v, "restored": True, "reason_logged": True}


def main():
    ap = argparse.ArgumentParser(description="Бэкап/восстановление ИС «Заречное»")
    sub = ap.add_subparsers(dest="command", required=True)

    b = sub.add_parser("backup")
    b.add_argument("--type", choices=["FULL", "INCREMENTAL"], default="FULL")
    b.add_argument("--retention", type=int, default=30)
    b.add_argument("--id", default="")
    b.add_argument("--note", default="")
    b.set_defaults(func=cmd_backup)

    v = sub.add_parser("verify")
    v.add_argument("--file", required=True)
    v.add_argument("--checksum", default="")
    v.set_defaults(func=cmd_verify)

    r = sub.add_parser("restore")
    r.add_argument("--file", required=True)
    r.add_argument("--checksum", default="")
    r.add_argument("--id", default="")
    r.set_defaults(func=cmd_restore)

    rot = sub.add_parser("rotate")
    rot.add_argument("--retention", type=int, default=30)
    rot.set_defaults(func=cmd_rotate)

    ls = sub.add_parser("list")
    ls.add_argument("--retention", type=int, default=30)
    ls.set_defaults(func=cmd_list)

    a = ap.parse_args()
    try:
        print(json.dumps(a.func(a), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
