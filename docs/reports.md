# Подсистема статистики и отчётности

> ИС «Заречное» (Вариант 11), Неделя 8. Все отчёты доступны по
> `GET /api/v1/reports/<name>?format=json|csv&from=ГГГГ-ММ-ДД&to=ГГГГ-ММ-ДД`.
> Экспорт CSV требует право `export:EXEC`, чтение — `report:READ`.

## 1. Управленческие отчёты (≥3)

### 1.1. Себестоимость и конверсия корма — `/reports/cost-fcr`

**Метрики**: `feed_qty` (кг), `feed_cost` (руб.), `treatment_cost` (руб.),
`head_days` (голово-дни), `gain_kg` (привес), `fcr` (Feed Conversion Ratio).

**Определение FCR** (отраслевая метрика): `fcr = расход корма / привес`,
сколько кг корма ушло на 1 кг привеса. Источник — снимок `period_group_cost`,
формируемый `sp_close_period` при закрытии месяца.

**Фильтры**: `from`, `to` (по `period_month`), `group_id`.
**Визуализация**: `series.by_month` — динамика расхода и себестоимости (линия/столбцы).

### 1.2. Здоровье поголовья — `/reports/herd-health`

**Метрики**: всего животных, доля больных/на карантине (`sick_share_pct`),
здоровые, выбраковка, падёж, просрочки графика вакцинации
(`v_vaccination_overdue`), частота выбраковки (`disposal_event`).

**Фильтры**: нет (срез «на сейчас»).
**Визуализация**: `series.by_status` (круговая), `series.by_disposal` (столбцы).

### 1.3. Нагрузка на пастбища — `/reports/pasture-load`

**Метрики**: `active_heads`, `load_head_per_ha = active_heads / area_ha`,
`norm_head_per_ha` (из `pasture_plot.max_head_per_ha`), `rest_ok`
(из `v_plot_rest_status`), `risk` = `OVERGRAZING | REST_NOT_COMPLETE | OK`.

Площадь `area_ha` вычисляется **автоматически по WKT-полигону** триггером
`trg_pasture_plot_area` (`ST_Area(geography(geom))/10000`) — не вводится вручную.

**Визуализация**: `series.bars` — сравнение фактической нагрузки с нормой.

## 2. Операционные отчёты (≥2)

### 2.1. Задачи в работе — `/reports/tasks-in-work`

Открытые задачи (`NEW`, `IN_WORK`) с признаком `is_overdue` (`due_at < now()`),
числом групп и исполнений, загрузкой по исполнителям (`series.by_assignee`),
распределением по статусам (`series.by_status`). Лимит 500 строк.

### 2.2. Остатки склада и обороты — `/reports/stock-turnover`

По каждой номенклатуре: `on_hand`, `received`, `issued`, `batches`,
`nearest_expiry`, `turnover = issued / on_hand`, риск
`DEFICIT` (ниже `min_threshold`) / `NON_LIQUID` (нет расхода) / `OK`.

## 3. Сводный дашборд — `/reports/dashboard`

KPI: поголовье, больные, открытые/просроченные задачи, просрочки вакцинаций,
остаток склада, расхождения остатков, активные выпасы, участки без отдыха,
новые заявки на закупку, непрочитанные уведомления, усиленные действия, отказы,
успешные бэкапы. `series.stock_trend` — приход/расход по месяцам за 12 мес.

## 4. Микросервис аналитики (Неделя 7)

`GET /api/v1/reports/aggregate` проксирует в `reports-service` (`:4000`) —
помесячная агрегация расхода корма, задач и продукции за период.
Сервис имеет собственный пул соединений (`max: 4`) и не нагружает ядро.

## 5. Экспорт

| Формат | Как получить |
|---|---|
| CSV | `?format=csv` → `Content-Disposition: attachment`, BOM (`\uFEFF`), разделитель `;` |
| PNG | Графики рисуются на `<canvas>` в UI, кнопка «Сохранить PNG» → `canvas.toDataURL()` |
| JSON | по умолчанию (`data` + `series`) |

Все выгрузки фиксируются в `audit_log` (`action='EXPORT'`).

## 6. Проверяемость метрик

| Метрика | Проверка |
|---|---|
| `fcr` | `SELECT * FROM period_group_cost` после `sp_close_period` |
| `load_head_per_ha` | `v_active_grazing` + `ST_Area(geography(geom))` |
| `on_hand` | `v_stock_balance_check`: расхождений 0 |
| `tasks_overdue` | `v_task_overdue` |
| `vaccination_overdue` | `v_vaccination_overdue` |
