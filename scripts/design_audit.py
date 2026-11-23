#!/usr/bin/env python3
"""Аудит дизайн-системы ИС «Заречное».

Считает контраст текстовых и нетекстовых пар в обеих темах, инвентаризует
токены, иконки, классы и keyframes, ищет паттерны AI-слопа.

Только чтение. Запуск: py scripts/design_audit.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "ui" / "public"
CSS = (PUB / "styles.css").read_text(encoding="utf-8")
HTML = (PUB / "index.html").read_text(encoding="utf-8")
JS = (PUB / "app.js").read_text(encoding="utf-8")


# ---------------------------------------------------------------- helpers ---
def css_block(css: str, selector: str) -> str:
    """Вернуть содержимое блока по селектору (с учётом вложенных скобок)."""
    m = re.search(re.escape(selector) + r"\s*\{", css)
    if not m:
        return ""
    i = m.end()
    depth = 1
    start = i
    while i < len(css) and depth:
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
        i += 1
    return css[start : i - 1]


def parse_vars(block: str) -> dict[str, str]:
    return {k: v.strip() for k, v in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block)}


def resolve(value: str, variables: dict[str, str], depth: int = 0) -> str:
    if depth > 8:
        return value
    value = value.strip()
    # И голые ссылки вида `--ink`, и var(--ink)
    if re.fullmatch(r"--[\w-]+", value):
        return resolve(variables.get(value, value), variables, depth + 1)
    def sub(m: re.Match[str]) -> str:
        return resolve(variables.get(m.group(1), m.group(0)), variables, depth + 1)
    return re.sub(r"var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)", sub, value)


def parse_color(value: str) -> tuple[float, float, float] | None:
    value = value.strip().lower()
    if value.startswith("#"):
        h = value[1:]
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        if len(h) in (6, 8):
            return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
    m = re.match(r"rgba?\(([^)]+)\)", value)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        return tuple(float(p) / 255 if not p.endswith("%") else float(p[:-1]) / 100 for p in parts[:3])
    return None


def luminance(rgb: tuple[float, float, float]) -> float:
    def ch(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: str, b: str, variables: dict[str, str]) -> float | None:
    ca, cb = parse_color(resolve(a, variables)), parse_color(resolve(b, variables))
    if not ca or not cb:
        return None
    la, lb = luminance(ca), luminance(cb)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def section(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


# ----------------------------------------------------------------- tokens ---
root = parse_vars(css_block(CSS, ":root"))
dark = parse_vars(css_block(CSS, '[data-theme="dark"]'))
light_vars = dict(root)
dark_vars = {**root, **dark}

section("1. ПРИМИТИВЫ, ПЕРЕОПРЕДЕЛЁННЫЕ ТЕМОЙ (должны быть заморожены)")
PRIMITIVES = ["--white", "--sand", "--dark", "--green", "--accent"]
for name in PRIMITIVES:
    if name in dark:
        print(f"  {name}: {root.get(name)} -> {dark.get(name)}   ПЕРЕОПРЕДЕЛЕНО")

section("2. КОНТРАСТ ПАР (порог: текст 4.5, нетекст 3.0)")
PAIRS = [
    ("ink / bg",              "--ink",        "--bg",              4.5),
    ("ink / surface",         "--ink",        "--surface",         4.5),
    ("ink / surface-raised",  "--ink",        "--surface-raised",  4.5),
    ("ink-soft / surface",    "--ink-soft",   "--surface",         4.5),
    ("ink-muted / surface",   "--ink-muted",  "--surface",         4.5),
    ("ink-muted / hover",     "--ink-muted",  "--surface-hover",   4.5),
    ("link / surface",        "--link",       "--surface",         4.5),
    ("link-hover / surface",  "--link-hover", "--surface",         4.5),
    ("accent-fg / surface",   "--accent-fg",  "--surface",         4.5),
    ("placeholder / surface", "--placeholder","--surface",         4.5),
    ("on-primary (white/green)", "--white",   "--green",           4.5),
    ("input border / surface","--line-strong","--surface",         3.0),
    ("line (decor) / surface","--line",       "--surface",         0.0),
    ("healthy / healthy-bg",  "--status-healthy",   "--status-healthy-bg",   4.5),
    ("treatment / treatment-bg", "--status-treatment", "--status-treatment-bg", 4.5),
    ("dead / dead-bg",        "--status-dead",      "--status-dead-bg",      4.5),
    ("on-danger / danger",    "--on-danger",        "--danger",              4.5),
    ("on-primary / green-700","--on-primary",       "--green-700",           4.5),
    ("nav-active / green-soft","--nav-active-fg",   "--green-soft",          4.5),
    ("link-hover / green-soft","--link-hover",      "--green-soft",          4.5),
]
for theme, variables in (("LIGHT", light_vars), ("DARK", dark_vars)):
    print(f"\n  [{theme}]")
    for label, fg, bg, need in PAIRS:
        ratio = contrast(fg, bg, variables)
        if ratio is None:
            print(f"    ?  {label:<28} не удалось вычислить ({fg} / {bg})")
            continue
        mark = "OK " if ratio >= need else "FAIL"
        print(f"    {mark} {label:<28} {ratio:5.2f}:1  (нужно {need})")

section("3. ТОКЕНЫ: определены, но не используются / используются, но не определены")
used = set(re.findall(r"var\(\s*(--[\w-]+)", CSS))
defined = set(root) | set(dark) | set(re.findall(r"(--[\w-]+)\s*:", CSS))
print(" Неиспользуемые:", ", ".join(sorted(defined - used)) or "нет")
print(" Неопределённые:", ", ".join(sorted(used - defined)) or "нет")

section("4. ИКОНКИ: symbol / use")
symbols = set(re.findall(r'<symbol\s+id="([^"]+)"', HTML))
uses = set(re.findall(r'href="#([^"]+)"', HTML + JS)) | set(re.findall(r'xlink:href="#([^"]+)"', HTML + JS))
icon_uses = {u for u in uses if u.startswith("icon-")}
print(f"  symbol определено: {len(symbols)}")
print(f"  <use> уникальных: {len(icon_uses)}")
print("  Используются, но НЕ определены:", ", ".join(sorted(icon_uses - symbols)) or "нет")
print("  Определены, но НЕ используются:", ", ".join(sorted(symbols - icon_uses)) or "нет")
print(f"  Инлайн-<svg> в app.js: {len(re.findall(r'<svg', JS))}")
print(f"  Инлайн-<svg> в index.html (кроме sprite): {len(re.findall(r'<svg', HTML)) - 1}")

section("5. EMOJI В СТРОКАХ ИНТЕРФЕЙСА")
emoji = re.findall(r"[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF\u2600-\u27BF]", JS + HTML)
print(f"  Найдено: {len(emoji)} -> {sorted(set(emoji))}")

section("6. KEYFRAMES / ANIMATION")
frames = set(re.findall(r"@keyframes\s+([\w-]+)", CSS))
anims = set(re.findall(r"animation(?:-name)?\s*:\s*([^;]+)", CSS))
anims_used = set()
for a in anims:
    anims_used |= {w.strip(" ,") for w in a.split() if w.strip(" ,") and not w.strip().startswith("var(")}
print("  keyframes:", ", ".join(sorted(frames)))
print("  animation-имена:", ", ".join(sorted(anims_used)))
print("  keyframes без использования:", ", ".join(sorted(frames - anims_used)) or "нет")

section("7. КЛАССЫ-СИРОТЫ (приблизительно: CSS-селектор без class= в HTML/JS)")
css_classes = set(re.findall(r"\.([A-Za-z][\w-]*)", re.sub(r"/\*.*?\*/", "", CSS, flags=re.S)))
# JS генерирует разметку строками, поэтому считаем «живым» любое слово,
# встречающееся в HTML или JS, — иначе будет много ложных срабатываний.
flat = set(re.findall(r"[A-Za-z][\w-]*", HTML + JS))
orphans = sorted(css_classes - flat)
print(f"  Классов в CSS: {len(css_classes)}; слов в разметке/JS: {len(flat)}")
print("  Кандидаты в сироты:", ", ".join(orphans) or "нет")

section("8. СЛОП-ЧЕКЕР (паттерны, требующие ручной проверки)")
SLOP = {
    "градиенты (всего)": r"(?:linear|radial|conic)-gradient\(",
    "gradient-text": r"background-clip:\s*text|text-fill-color",
    "backdrop-filter / glass": r"backdrop-filter",
    "blur-фильтры": r"filter:\s*blur",
    "glow / color shadow": r"box-shadow:[^;]*(?:#(?!000|1b2e14)[0-9a-f]{3,8})",
    "!important": r"!important",
    "all-caps в CSS (text-transform)": r"text-transform:\s*uppercase",
    "letter-spacing > 0.1em": r"letter-spacing:\s*0\.1[1-9]em|letter-spacing:\s*0\.[2-9]em",
    "bounce/elastic easing": r"cubic-bezier\([^)]*(?:1\.5|1\.6|-0\.)",
}
for label, pattern in SLOP.items():
    hits = re.findall(pattern, CSS, flags=re.I)
    print(f"  {label:<32}: {len(hits)}")
for kw in ("supercharge", "world-class", "революцион", "невероятн", "превосходн"):
    hits = re.findall(kw, JS + HTML, flags=re.I)
    if hits:
        print(f"  копирайтинг «{kw}»: {len(hits)}")

print("\n  Градиенты по строкам:")
for n, line in enumerate(CSS.splitlines(), 1):
    if re.search(r"(?:linear|radial|conic)-gradient\(", line):
        print(f"    styles.css:{n}: {line.strip()[:110]}")
print("\n  backdrop-filter по строкам:")
for n, line in enumerate(CSS.splitlines(), 1):
    if "backdrop-filter" in line:
        print(f"    styles.css:{n}: {line.strip()[:110]}")

print("\nАудит завершён. Скрипт только читает файлы и ничего не изменяет.")
