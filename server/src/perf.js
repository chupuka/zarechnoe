'use strict';

/**
 * Метрики скорости работы с БД (ТЗ п.9 — «быстро ли выполняются запросы»).
 *
 * Каждый вызов db.query() замеряется здесь: длительность, успех/ошибка и
 * нормализованный текст SQL. Данные хранятся в памяти процесса в скользящем
 * окне (последние WINDOW запросов) — этого достаточно, чтобы ответить на
 * главный вопрос страницы «Метрики»: БД отвечает быстро или пора
 * оптимизировать запросы/индексы.
 *
 * Пороговые значения берутся из farm_settings (perf_p95_ok_ms, perf_p95_warn_ms,
 * perf_slow_ms): администратор может менять их без пересборки сервера.
 * Наблюдатель обязан быть «дешёвым»: сам замер — это два вызова hrtime.
 */

const WINDOW = 500;
/** Запрос дольше этого считаем «медленным» независимо от настроек. */
const HARD_SLOW_MS = 300;

const samples = [];          // { ms, ok, at, sql }
const statements = new Map(); // нормализованный SQL -> { count, total, max, slow }

/** Привести SQL к виду, пригодному для группировки (без литералов). */
function normalize(text) {
    return String(text)
        .replace(/\s+/g, ' ')
        .replace(/\$\d+/g, '?')
        .replace(/'[^']*'/g, "'?'")
        .replace(/\b\d+(\.\d+)?\b/g, 'N')
        .trim()
        .slice(0, 160);
}

/** Зафиксировать выполнение запроса. */
function record(text, ms, ok) {
    const at = Date.now();
    const sql = normalize(text);
    samples.push({ ms, ok, at, sql });
    if (samples.length > WINDOW) samples.shift();

    const st = statements.get(sql) || { count: 0, total: 0, max: 0, slow: 0 };
    st.count += 1;
    st.total += ms;
    st.max = Math.max(st.max, ms);
    if (ms >= HARD_SLOW_MS) st.slow += 1;
    statements.set(sql, st);
    // Не даём карте расти бесконечно на нетипичных запросах.
    if (statements.size > 200) {
        const oldest = statements.keys().next().value;
        statements.delete(oldest);
    }
}

/** Перцентиль по уже отсортированному массиву чисел. */
function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}

/**
 * Снимок метрик: сколько запросов, насколько быстро, что тормозит.
 * Возвращает также распределение по «корзинам» — удобно рисовать полосками.
 */
function snapshot() {
    const n = samples.length;
    if (!n) {
        return {
            samples: 0, window: WINDOW, avg_ms: 0, p50_ms: 0, p95_ms: 0,
            p99_ms: 0, max_ms: 0, slow_count: 0, error_count: 0,
            per_minute: 0, buckets: [], slowest: [], statements: 0,
        };
    }
    const times = samples.map((s) => s.ms).sort((a, b) => a - b);
    const total = samples.reduce((acc, s) => acc + s.ms, 0);
    const slow = samples.filter((s) => s.ms >= HARD_SLOW_MS).length;
    const errors = samples.filter((s) => !s.ok).length;

    const first = samples[0].at;
    const spanMin = Math.max((Date.now() - first) / 60000, 1 / 60);

    const buckets = [
        { label: '≤20 мс', to: 20 },
        { label: '20–50 мс', to: 50 },
        { label: '50–100 мс', to: 100 },
        { label: '100–300 мс', to: 300 },
        { label: '>300 мс', to: Infinity },
    ].map((b, i, arr) => {
        const from = i === 0 ? 0 : arr[i - 1].to;
        const count = times.filter((t) => (i === 0 ? t <= b.to : t > from && t <= b.to)).length;
        return { label: b.label, count, share: Math.round((count / n) * 100) };
    });

    const slowest = [...statements.entries()]
        .map(([sql, st]) => ({ sql, count: st.count, avg_ms: Math.round(st.total / st.count),
                               max_ms: Math.round(st.max), slow: st.slow }))
        .sort((a, b) => b.max_ms - a.max_ms)
        .slice(0, 8);

    return {
        samples: n,
        window: WINDOW,
        avg_ms: Math.round(total / n),
        p50_ms: Math.round(percentile(times, 50)),
        p95_ms: Math.round(percentile(times, 95)),
        p99_ms: Math.round(percentile(times, 99)),
        max_ms: Math.round(times[times.length - 1]),
        slow_count: slow,
        error_count: errors,
        per_minute: Math.round((n / spanMin) * 10) / 10,
        buckets,
        slowest,
        statements: statements.size,
    };
}

/**
 * Вердикт по порогам из farm_settings.
 *   OK   — p95 в норме, оптимизация не нужна;
 *   WARN — есть что подкрутить (индексы, тяжёлые отчёты);
 *   BAD  — запросы медленные, оптимизация обязательна.
 */
function verdict(snap, thresholds = {}) {
    const ok = Number(thresholds.perf_p95_ok_ms || 100);
    const warn = Number(thresholds.perf_p95_warn_ms || 300);
    const p95 = snap.p95_ms;
    if (!snap.samples) {
        return { level: 'UNKNOWN', label: 'Нет данных', text: 'Ещё не выполнено ни одного запроса.' };
    }
    if (p95 <= ok) {
        return {
            level: 'OK',
            label: 'Быстро',
            text: `95% запросов укладываются в ${p95} мс при норме ${ok} мс — база отвечает быстро, оптимизация не требуется.`,
        };
    }
    if (p95 <= warn) {
        return {
            level: 'WARN',
            label: 'Приемлемо',
            text: `95-й перцентиль ${p95} мс превышает норму ${ok} мс. Стоит проверить медленные запросы и статистику.`,
        };
    }
    return {
        level: 'BAD',
        label: 'Медленно',
        text: `95-й перцентиль ${p95} мс выше порога ${warn} мс — нужна оптимизация: индексы, планы запросов, тяжёлые отчёты.`,
    };
}

/** Сбросить накопленную статистику (кнопка «Сбросить» на странице метрик). */
function reset() {
    samples.length = 0;
    statements.clear();
}

module.exports = { record, snapshot, verdict, reset, HARD_SLOW_MS };
