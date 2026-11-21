# Структурная схема БД ИС «Заречное»

> Документ сформирован автоматически из метаданных PostgreSQL 16 + PostGIS
> скриптом `scripts/generate_db_doc.py` (дата формирования — дата запуска).
> Источник схемы: `db/01_schema.sql` … `db/04_seed_demo.sql`.

## 1. Обзор

| Параметр | Значение |
|---|---|
| СУБД | PostgreSQL 16.4 + PostGIS 3.4 |
| Таблицы | 56 |
| Внешние ключи | 93 |
| Ограничения (PK/UK/CHECK) | 136 |
| Представления (VIEW) | 7 |
| Индексы | 185 |
| Триггеры | 6 |
| Процедуры/функции | 12 |

ER-диаграмма (ключ-к-лючу): `vrodOK/farm_er_keys.drawio`, пофамильные схемы доменов: `vrodOK/домены/*.drawio`.

## 2. Распределение таблиц по доменам (12 контуров)

| Контур | Домен | Таблиц | Таблицы |
|---|---|---|---|
| A | Доступ и RBAC | 6 | `role`, `permission`, `role_permission`, `app_user`, `user_session`, `saved_filter` |
| M | Настройки хозяйства | 1 | `farm_settings` |
| B | Персонал | 2 | `position`, `employee` |
| C | Поголовье | 5 | `species`, `breed`, `animal_group`, `animal`, `animal_group_history` |
| D | Здоровье | 8 | `diagnosis`, `examination`, `treatment`, `drug`, `vaccination_schedule`, `vaccination_event`, `disposal_reason`, `disposal_event` |
| E | Кормление и рационы | 4 | `uom`, `uom_conversion`, `ration`, `ration_item` |
| F | Склад | 9 | `nomenclature`, `supplier`, `warehouse`, `stock_batch`, `stock_balance`, `movement_type`, `write_off_reason`, `stock_movement`, `purchase_request` |
| G | Пастбища (PostGIS) | 3 | `farm_boundary`, `pasture_plot`, `grazing_event` |
| H | Задачи | 6 | `task_type`, `task_series`, `task`, `task_animal_group`, `task_status_history`, `task_execution` |
| I | Продукция | 3 | `product_type`, `production_record`, `animal_weighing` |
| J | Закрытие периода | 2 | `period_closure`, `period_group_cost` |
| K | Импорт | 2 | `import_job`, `import_error` |
| L | Технический контур | 5 | `audit_log`, `tech_log`, `backup_job`, `restore_job`, `notification` |
| — | **Итого** | **56** | |

## 3. Перечень таблиц (объём данных демо)

| # | Таблица | Колонок | Строк (демо) | Комментарий |
|---|---|---|---|---|
| 1 | `role` | 5 | 6 | Роли — фиксированный набор из 6 (Директор, Суперпользователь, Администратор БД, Зоотехник, Бригадир, Кладовщик) |
| 2 | `permission` | 5 | 36 | Права доступа в формате объект:действие |
| 3 | `role_permission` | 4 | 102 | Матрица Роль × Право [M:M] |
| 4 | `app_user` | 12 | 6 | Учётные записи пользователей |
| 5 | `user_session` | 8 | 6 | Сессии/токены пользователей |
| 6 | `saved_filter` | 7 | 4 | Сохранённые пользовательские фильтры реестров |
| 7 | `farm_settings` | 8 | 4 | Настраиваемые параметры хозяйства (норма га/голову, дни отдыха участка по умолчанию и т.п.) |
| 8 | `position` | 3 | 7 | Должности |
| 9 | `employee` | 7 | 8 | Сотрудники хозяйства |
| 10 | `species` | 3 | 1 | Виды животных |
| 11 | `breed` | 4 | 4 | Породы |
| 12 | `animal_group` | 6 | 5 | Группы животных. head_count — производный атрибут, см. VIEW v_animal_group_head_count |
| 13 | `animal` | 10 | 100 | Животные — индивидуальные карточки |
| 14 | `animal_group_history` | 7 | 26 | Журнал переводов животных между группами |
| 15 | `diagnosis` | 4 | 8 | Диагнозы |
| 16 | `examination` | 7 | 66 | Осмотры / история болезни |
| 17 | `treatment` | 9 | 15 | Назначение лечения [1:1 к осмотру]. withdrawal_until — снимок на момент назначения |
| 18 | `drug` | 5 | 4 | Препараты — подтип nomenclature [1:1, shared PK] |
| 19 | `vaccination_schedule` | 6 | 2 | График вакцинаций по видам |
| 20 | `vaccination_event` | 8 | 150 | Факт вакцинации. next_due_date — снимок, см. VIEW v_vaccination_overdue |
| 21 | `disposal_reason` | 4 | 4 | Причины выбраковки/падежа |
| 22 | `disposal_event` | 9 | 2 | Выбытие животного [1:1 к животному] |
| 23 | `uom` | 4 | 4 | Единицы измерения |
| 24 | `uom_conversion` | 4 | 2 | Пересчёт единиц измерения [M:M] |
| 25 | `ration` | 6 | 5 | Рационы (нормы кормления) по группам |
| 26 | `ration_item` | 6 | 20 | Состав рациона [M:M] |
| 27 | `nomenclature` | 9 | 12 | Номенклатура (корма/препараты/инвентарь) |
| 28 | `supplier` | 6 | 3 | Поставщики |
| 29 | `warehouse` | 4 | 2 | Склады (корма / ветаптека) |
| 30 | `stock_batch` | 9 | 214 | Партии склада |
| 31 | `stock_balance` | 4 | 214 | Остатки по партиям [агрегат, 1:1]. Сверка — VIEW v_stock_balance_check |
| 32 | `movement_type` | 4 | 4 | Типы движений склада |
| 33 | `write_off_reason` | 3 | 3 | Причины списания |
| 34 | `stock_movement` | 12 | 29727 | Движения склада (атомарно). Основание списания/расхода — не более одного из 4 FK |
| 35 | `purchase_request` | 8 | 12 | Заявки на закупку (is_auto — создана автоматически по порогу остатка) |
| 36 | `farm_boundary` | 6 | 1 | Граница хозяйства — ровно одна строка (singleton) |
| 37 | `pasture_plot` | 10 | 8 | Пастбищные участки/загоны |
| 38 | `grazing_event` | 8 | 100 | История выпаса [M:M группа↔участок]. Ровно один активный (ended_at IS NULL) на группу — см. индекс ниже |
| 39 | `task_type` | 5 | 5 | Типы задач |
| 40 | `task_series` | 12 | 1 | Шаблоны повторяющихся задач — горизонт не более 30 дней |
| 41 | `task` | 13 | 9321 | Задачи/наряды. is_overdue — см. VIEW v_task_overdue |
| 42 | `task_animal_group` | 3 | 8591 | Задача ↔ группы [M:M] — групповое кормление нескольких групп одной задачей |
| 43 | `task_status_history` | 7 | 9321 | Журнал смены статусов задачи |
| 44 | `task_execution` | 9 | 8550 | Факт выполнения (план/факт). deviation — см. VIEW v_task_execution_deviation |
| 45 | `product_type` | 4 | 2 | Виды продукции |
| 46 | `production_record` | 9 | 213 | Продукция (привес/молоко и т.п.). Ровно один субъект — животное или группа |
| 47 | `animal_weighing` | 7 | 145 | Взвешивания — база для расчёта FCR |
| 48 | `period_closure` | 6 | 7 | Периоды (месяц) и их закрытие |
| 49 | `period_group_cost` | 9 | 30 | Себестоимость и FCR по группам за период (снимок) |
| 50 | `import_job` | 10 | 3 | Задания импорта |
| 51 | `import_error` | 6 | 16 | Ошибки импорта по строкам |
| 52 | `audit_log` | 12 | 100 | Журнал бизнес-аудита. Действия Суперпользователя обязаны иметь причину |
| 53 | `tech_log` | 6 | 72 | Технический лог действий Администратора БД |
| 54 | `backup_job` | 10 | 14 | Резервные копии |
| 55 | `restore_job` | 7 | 1 | Восстановления из резервной копии |
| 56 | `notification` | 8 | 106 | Уведомления пользователям |

## 4. Внешние ключи (связи таблиц)

| # | Дочерняя таблица (колонка) | Родительская таблица (колонка) | ON DELETE |
|---|---|---|---|
| 1 | `animal.breed_id` | `breed.id` | RESTRICT |
| 2 | `animal.group_id` | `animal_group.id` | RESTRICT |
| 3 | `animal_group.species_id` | `species.id` | RESTRICT |
| 4 | `animal_group_history.animal_id` | `animal.id` | RESTRICT |
| 5 | `animal_group_history.from_group_id` | `animal_group.id` | RESTRICT |
| 6 | `animal_group_history.moved_by` | `app_user.id` | RESTRICT |
| 7 | `animal_group_history.to_group_id` | `animal_group.id` | RESTRICT |
| 8 | `animal_weighing.animal_id` | `animal.id` | RESTRICT |
| 9 | `animal_weighing.group_id` | `animal_group.id` | RESTRICT |
| 10 | `animal_weighing.weighed_by` | `employee.id` | RESTRICT |
| 11 | `app_user.employee_id` | `employee.id` | RESTRICT |
| 12 | `app_user.role_id` | `role.id` | RESTRICT |
| 13 | `audit_log.user_id` | `app_user.id` | RESTRICT |
| 14 | `backup_job.initiated_by` | `app_user.id` | RESTRICT |
| 15 | `breed.species_id` | `species.id` | RESTRICT |
| 16 | `disposal_event.animal_id` | `animal.id` | RESTRICT |
| 17 | `disposal_event.confirmed_by` | `employee.id` | RESTRICT |
| 18 | `disposal_event.reason_id` | `disposal_reason.id` | RESTRICT |
| 19 | `employee.position_id` | `"position".id` | RESTRICT |
| 20 | `examination.animal_id` | `animal.id` | RESTRICT |
| 21 | `examination.diagnosis_id` | `diagnosis.id` | RESTRICT |
| 22 | `examination.examined_by` | `employee.id` | RESTRICT |
| 23 | `farm_boundary.updated_by` | `app_user.id` | RESTRICT |
| 24 | `farm_settings.updated_by` | `app_user.id` | RESTRICT |
| 25 | `grazing_event.group_id` | `animal_group.id` | RESTRICT |
| 26 | `grazing_event.moved_by` | `app_user.id` | RESTRICT |
| 27 | `grazing_event.plot_id` | `pasture_plot.id` | RESTRICT |
| 28 | `import_error.import_job_id` | `import_job.id` | CASCADE |
| 29 | `import_job.created_by` | `app_user.id` | RESTRICT |
| 30 | `nomenclature.uom_id` | `uom.id` | RESTRICT |
| 31 | `notification.user_id` | `app_user.id` | RESTRICT |
| 32 | `period_closure.closed_by` | `app_user.id` | RESTRICT |
| 33 | `period_group_cost.group_id` | `animal_group.id` | RESTRICT |
| 34 | `period_group_cost.period_closure_id` | `period_closure.id` | RESTRICT |
| 35 | `product_type.uom_id` | `uom.id` | RESTRICT |
| 36 | `production_record.animal_id` | `animal.id` | RESTRICT |
| 37 | `production_record.group_id` | `animal_group.id` | RESTRICT |
| 38 | `production_record.product_type_id` | `product_type.id` | RESTRICT |
| 39 | `production_record.released_by` | `app_user.id` | RESTRICT |
| 40 | `purchase_request.nomenclature_id` | `nomenclature.id` | RESTRICT |
| 41 | `purchase_request.requested_by` | `app_user.id` | RESTRICT |
| 42 | `ration.group_id` | `animal_group.id` | RESTRICT |
| 43 | `ration_item.nomenclature_id` | `nomenclature.id` | CASCADE |
| 44 | `ration_item.ration_id` | `ration.id` | CASCADE |
| 45 | `ration_item.uom_id` | `uom.id` | CASCADE |
| 46 | `restore_job.backup_job_id` | `backup_job.id` | RESTRICT |
| 47 | `restore_job.performed_by` | `app_user.id` | RESTRICT |
| 48 | `role_permission.permission_id` | `permission.id` | CASCADE |
| 49 | `role_permission.role_id` | `role.id` | CASCADE |
| 50 | `saved_filter.user_id` | `app_user.id` | RESTRICT |
| 51 | `stock_balance.batch_id` | `stock_batch.id` | CASCADE |
| 52 | `stock_batch.nomenclature_id` | `nomenclature.id` | RESTRICT |
| 53 | `stock_batch.supplier_id` | `supplier.id` | RESTRICT |
| 54 | `stock_batch.warehouse_id` | `warehouse.id` | RESTRICT |
| 55 | `stock_movement.batch_id` | `stock_batch.id` | RESTRICT |
| 56 | `stock_movement.created_by` | `app_user.id` | RESTRICT |
| 57 | `stock_movement.movement_type_id` | `movement_type.id` | RESTRICT |
| 58 | `stock_movement.purchase_request_id` | `purchase_request.id` | RESTRICT |
| 59 | `stock_movement.task_execution_id` | `task_execution.id` | RESTRICT |
| 60 | `stock_movement.treatment_id` | `treatment.id` | RESTRICT |
| 61 | `stock_movement.uom_id` | `uom.id` | RESTRICT |
| 62 | `stock_movement.write_off_reason_id` | `write_off_reason.id` | RESTRICT |
| 63 | `task.assigned_to` | `employee.id` | RESTRICT |
| 64 | `task.created_by` | `app_user.id` | RESTRICT |
| 65 | `task.plot_id` | `pasture_plot.id` | RESTRICT |
| 66 | `task.series_id` | `task_series.id` | RESTRICT |
| 67 | `task.task_type_id` | `task_type.id` | RESTRICT |
| 68 | `task_animal_group.group_id` | `animal_group.id` | CASCADE |
| 69 | `task_animal_group.task_id` | `task.id` | CASCADE |
| 70 | `task_execution.actual_uom_id` | `uom.id` | RESTRICT |
| 71 | `task_execution.executed_by` | `employee.id` | RESTRICT |
| 72 | `task_execution.group_id` | `animal_group.id` | RESTRICT |
| 73 | `task_execution.task_id` | `task.id` | CASCADE |
| 74 | `task_series.created_by` | `app_user.id` | RESTRICT |
| 75 | `task_series.ration_id` | `ration.id` | RESTRICT |
| 76 | `task_series.task_type_id` | `task_type.id` | RESTRICT |
| 77 | `task_series.uom_id` | `uom.id` | RESTRICT |
| 78 | `task_status_history.changed_by` | `app_user.id` | CASCADE |
| 79 | `task_status_history.task_id` | `task.id` | CASCADE |
| 80 | `tech_log.admin_user_id` | `app_user.id` | RESTRICT |
| 81 | `treatment.examination_id` | `examination.id` | RESTRICT |
| 82 | `treatment.nomenclature_id` | `nomenclature.id` | RESTRICT |
| 83 | `treatment.prescribed_by` | `employee.id` | RESTRICT |
| 84 | `treatment.uom_id` | `uom.id` | RESTRICT |
| 85 | `uom_conversion.from_uom_id` | `uom.id` | CASCADE |
| 86 | `uom_conversion.to_uom_id` | `uom.id` | CASCADE |
| 87 | `user_session.user_id` | `app_user.id` | RESTRICT |
| 88 | `vaccination_event.animal_id` | `animal.id` | RESTRICT |
| 89 | `vaccination_event.nomenclature_id` | `nomenclature.id` | RESTRICT |
| 90 | `vaccination_event.performed_by` | `employee.id` | RESTRICT |
| 91 | `vaccination_event.schedule_id` | `vaccination_schedule.id` | RESTRICT |
| 92 | `vaccination_schedule.nomenclature_id` | `nomenclature.id` | RESTRICT |
| 93 | `vaccination_schedule.species_id` | `species.id` | RESTRICT |

## 5. Ограничения целостности (PK / UNIQUE / CHECK)

| Таблица | Тип | Определение |
|---|---|---|
| `animal` | CHECK | `CHECK ((sex = ANY (ARRAY['M'::bpchar, 'F'::bpchar])))` |
| `animal` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['ЗДОРОВ'::character varying, 'НА_ОСМОТРЕ'::character varying, 'НА_КАРАНТИНЕ'::character varying, 'НА_ЛЕЧЕНИИ'::character varying, 'ВЫБРАКОВАНО'::character varying, 'ПАДЁЖ'::character varying])::text[])))` |
| `animal_weighing` | CHECK | `CHECK ((num_nonnulls(animal_id, group_id) = 1))` |
| `animal_weighing` | CHECK | `CHECK (((method)::text = ANY ((ARRAY['INDIVIDUAL'::character varying, 'GROUP_AVG'::character varying])::text[])))` |
| `animal_weighing` | CHECK | `CHECK ((weight_kg > (0)::numeric))` |
| `audit_log` | CHECK | `CHECK (((action)::text = ANY ((ARRAY['CREATE'::character varying, 'UPDATE'::character varying, 'DELETE'::character varying, 'LOGIN'::character varying, 'EXPORT'::character varying, 'OVERRIDE'::character varying])::text[])))` |
| `audit_log` | CHECK | `CHECK (((NOT is_elevated) OR (override_reason IS NOT NULL)))` |
| `backup_job` | CHECK | `CHECK (((backup_type)::text = ANY ((ARRAY['FULL'::character varying, 'INCREMENTAL'::character varying])::text[])))` |
| `backup_job` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['RUNNING'::character varying, 'OK'::character varying, 'FAILED'::character varying])::text[])))` |
| `disposal_event` | CHECK | `CHECK (((disposal_type)::text = ANY ((ARRAY['CULLING'::character varying, 'DEATH'::character varying])::text[])))` |
| `disposal_reason` | CHECK | `CHECK (((reason_type)::text = ANY ((ARRAY['CULLING'::character varying, 'DEATH'::character varying])::text[])))` |
| `examination` | CHECK | `CHECK (((status_after)::text = ANY ((ARRAY['ЗДОРОВ'::character varying, 'НА_ОСМОТРЕ'::character varying, 'НА_КАРАНТИНЕ'::character varying, 'НА_ЛЕЧЕНИИ'::character varying, 'ВЫБРАКОВАНО'::character varying, 'ПАДЁЖ'::character varying])::text[])))` |
| `farm_boundary` | CHECK | `CHECK ((id = 1))` |
| `farm_settings` | CHECK | `CHECK (((value_type)::text = ANY ((ARRAY['TEXT'::character varying, 'NUM'::character varying, 'BOOL'::character varying, 'DATE'::character varying])::text[])))` |
| `grazing_event` | CHECK | `CHECK ((head_count_snapshot > 0))` |
| `import_job` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['RUNNING'::character varying, 'OK'::character varying, 'FAILED'::character varying, 'ROLLED_BACK'::character varying])::text[])))` |
| `movement_type` | CHECK | `CHECK (((direction)::text = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying])::text[])))` |
| `nomenclature` | CHECK | `CHECK (((category)::text = ANY ((ARRAY['FEED'::character varying, 'DRUG'::character varying, 'INVENTORY'::character varying, 'VACCINE'::character varying])::text[])))` |
| `notification` | CHECK | `CHECK (((type)::text = ANY ((ARRAY['VACCINE_OVERDUE'::character varying, 'LOW_STOCK'::character varying, 'TASK_OVERDUE'::character varying, 'PLOT_REST'::character varying, 'REST_END'::character varying])::text[])))` |
| `pasture_plot` | CHECK | `CHECK (((vegetation_type)::text = ANY ((ARRAY['культурное'::character varying, 'естественное'::character varying])::text[])))` |
| `period_closure` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'CLOSING'::character varying, 'CLOSED'::character varying])::text[])))` |
| `permission` | CHECK | `CHECK (((action)::text = ANY ((ARRAY['READ'::character varying, 'WRITE'::character varying, 'DELETE'::character varying, 'EXEC'::character varying])::text[])))` |
| `production_record` | CHECK | `CHECK ((num_nonnulls(animal_id, group_id) = 1))` |
| `production_record` | CHECK | `CHECK ((qty > (0)::numeric))` |
| `production_record` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['BLOCKED'::character varying, 'READY'::character varying, 'SOLD'::character varying])::text[])))` |
| `purchase_request` | CHECK | `CHECK ((requested_qty > (0)::numeric))` |
| `purchase_request` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['NEW'::character varying, 'IN_WORK'::character varying, 'CLOSED'::character varying, 'CANCELLED'::character varying])::text[])))` |
| `ration` | CHECK | `CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))` |
| `ration_item` | CHECK | `CHECK ((norm_amount > (0)::numeric))` |
| `restore_job` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['RUNNING'::character varying, 'OK'::character varying, 'FAILED'::character varying])::text[])))` |
| `role` | CHECK | `CHECK (((role_type)::text = ANY ((ARRAY['BUSINESS'::character varying, 'TECHNICAL'::character varying])::text[])))` |
| `spatial_ref_sys` | CHECK | `CHECK (((srid > 0) AND (srid <= 998999)))` |
| `stock_balance` | CHECK | `CHECK ((qty_on_hand >= (0)::numeric))` |
| `stock_batch` | CHECK | `CHECK ((initial_qty >= (0)::numeric))` |
| `stock_batch` | CHECK | `CHECK ((unit_cost >= (0)::numeric))` |
| `stock_movement` | CHECK | `CHECK ((num_nonnulls(write_off_reason_id, task_execution_id, treatment_id, purchase_request_id) <= 1))` |
| `stock_movement` | CHECK | `CHECK ((qty > (0)::numeric))` |
| `task` | CHECK | `CHECK (((priority)::text = ANY ((ARRAY['LOW'::character varying, 'NORMAL'::character varying, 'HIGH'::character varying])::text[])))` |
| `task` | CHECK | `CHECK (((status)::text = ANY ((ARRAY['NEW'::character varying, 'IN_WORK'::character varying, 'DONE'::character varying, 'CANCELLED'::character varying])::text[])))` |
| `task_series` | CHECK | `CHECK ((end_date >= start_date))` |
| `task_series` | CHECK | `CHECK (((end_date - start_date) <= 30))` |
| `task_series` | CHECK | `CHECK ((interval_days > 0))` |
| `task_series` | CHECK | `CHECK (((recurrence)::text = ANY ((ARRAY['DAILY'::character varying, 'WEEKLY'::character varying, 'EVERY_N_DAYS'::character varying])::text[])))` |
| `tech_log` | CHECK | `CHECK (((action_type)::text = ANY ((ARRAY['MIGRATION'::character varying, 'BACKUP'::character varying, 'RESTORE'::character varying, 'MAINTENANCE'::character varying, 'VACUUM'::character varying, 'INDEX'::character varying])::text[])))` |
| `uom` | CHECK | `CHECK (((uom_type)::text = ANY ((ARRAY['MASS'::character varying, 'VOLUME'::character varying, 'COUNT'::character varying])::text[])))` |
| `uom_conversion` | CHECK | `CHECK ((factor > (0)::numeric))` |
| `animal` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `animal_group` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `animal_group_history` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `animal_weighing` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `app_user` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `audit_log` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `backup_job` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `breed` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `diagnosis` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `disposal_event` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `disposal_reason` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `drug` | PRIMARY KEY | `PRIMARY KEY (nomenclature_id)` |
| `employee` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `examination` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `farm_boundary` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `farm_settings` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `grazing_event` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `import_error` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `import_job` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `movement_type` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `nomenclature` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `notification` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `pasture_plot` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `period_closure` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `period_group_cost` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `permission` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `"position"` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `production_record` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `product_type` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `purchase_request` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `ration` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `ration_item` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `restore_job` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `role` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `role_permission` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `saved_filter` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `spatial_ref_sys` | PRIMARY KEY | `PRIMARY KEY (srid)` |
| `species` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `stock_balance` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `stock_batch` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `stock_movement` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `supplier` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `task` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `task_animal_group` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `task_execution` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `task_series` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `task_status_history` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `task_type` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `tech_log` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `treatment` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `uom` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `uom_conversion` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `user_session` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `vaccination_event` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `vaccination_schedule` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `warehouse` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `write_off_reason` | PRIMARY KEY | `PRIMARY KEY (id)` |
| `animal` | UNIQUE | `UNIQUE (inventory_number)` |
| `animal_group` | UNIQUE | `UNIQUE (name)` |
| `animal_group_history` | UNIQUE | `UNIQUE (animal_id, moved_at)` |
| `app_user` | UNIQUE | `UNIQUE (login)` |
| `breed` | UNIQUE | `UNIQUE (species_id, name)` |
| `diagnosis` | UNIQUE | `UNIQUE (code)` |
| `disposal_event` | UNIQUE | `UNIQUE (animal_id)` |
| `disposal_reason` | UNIQUE | `UNIQUE (code)` |
| `farm_settings` | UNIQUE | `UNIQUE (setting_key)` |
| `movement_type` | UNIQUE | `UNIQUE (code)` |
| `nomenclature` | UNIQUE | `UNIQUE (sku)` |
| `pasture_plot` | UNIQUE | `UNIQUE (plot_no)` |
| `period_closure` | UNIQUE | `UNIQUE (period_month)` |
| `period_group_cost` | UNIQUE | `UNIQUE (period_closure_id, group_id)` |
| `permission` | UNIQUE | `UNIQUE (code)` |
| `"position"` | UNIQUE | `UNIQUE (code)` |
| `product_type` | UNIQUE | `UNIQUE (code)` |
| `ration` | UNIQUE | `UNIQUE (group_id, valid_from)` |
| `ration_item` | UNIQUE | `UNIQUE (ration_id, nomenclature_id)` |
| `role` | UNIQUE | `UNIQUE (code)` |
| `role_permission` | UNIQUE | `UNIQUE (role_id, permission_id)` |
| `species` | UNIQUE | `UNIQUE (code)` |
| `stock_balance` | UNIQUE | `UNIQUE (batch_id)` |
| `stock_batch` | UNIQUE | `UNIQUE (nomenclature_id, warehouse_id, batch_number)` |
| `task_animal_group` | UNIQUE | `UNIQUE (task_id, group_id)` |
| `task_execution` | UNIQUE | `UNIQUE (task_id, group_id)` |
| `task_type` | UNIQUE | `UNIQUE (code)` |
| `treatment` | UNIQUE | `UNIQUE (examination_id)` |
| `uom` | UNIQUE | `UNIQUE (code)` |
| `uom_conversion` | UNIQUE | `UNIQUE (from_uom_id, to_uom_id)` |
| `user_session` | UNIQUE | `UNIQUE (token_hash)` |
| `warehouse` | UNIQUE | `UNIQUE (code)` |
| `write_off_reason` | UNIQUE | `UNIQUE (code)` |

## 6. Каталог таблиц (колонки)

### `animal`

_Животные — индивидуальные карточки_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| inventory_number | character varying(20) | нет | `` |
| breed_id | bigint | нет | `` |
| group_id | bigint | да | `` |
| birth_date | date | нет | `` |
| sex | character(1) | нет | `` |
| status | character varying(20) | нет | `'ЗДОРОВ'::character varying` |
| arrival_date | date | нет | `CURRENT_DATE` |
| is_deleted | boolean | нет | `false` |
| created_at | timestamp with time zone | нет | `now()` |

### `animal_group`

_Группы животных. head_count — производный атрибут, см. VIEW v_animal_group_head_count_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| name | character varying(80) | нет | `` |
| species_id | bigint | нет | `` |
| is_active | boolean | нет | `true` |
| created_at | timestamp with time zone | нет | `now()` |
| is_deleted | boolean | нет | `false` |

### `animal_group_history`

_Журнал переводов животных между группами_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| animal_id | bigint | нет | `` |
| from_group_id | bigint | да | `` |
| to_group_id | bigint | нет | `` |
| moved_at | timestamp with time zone | нет | `now()` |
| reason | character varying(200) | да | `` |
| moved_by | bigint | нет | `` |

### `animal_weighing`

_Взвешивания — база для расчёта FCR_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| animal_id | bigint | да | `` |
| group_id | bigint | да | `` |
| weighed_at | timestamp with time zone | нет | `now()` |
| weight_kg | numeric | нет | `` |
| method | character varying(12) | нет | `` |
| weighed_by | bigint | нет | `` |

### `app_user`

_Учётные записи пользователей_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| login | character varying(64) | нет | `` |
| password_hash | character varying(255) | нет | `` |
| full_name | character varying(120) | нет | `` |
| role_id | bigint | нет | `` |
| employee_id | bigint | да | `` |
| is_active | boolean | нет | `true` |
| is_deleted | boolean | нет | `false` |
| must_change_pw | boolean | нет | `true` |
| failed_cnt | integer | нет | `0` |
| locked_until | timestamp with time zone | да | `` |
| last_login_at | timestamp with time zone | да | `` |

### `audit_log`

_Журнал бизнес-аудита. Действия Суперпользователя обязаны иметь причину_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| user_id | bigint | нет | `` |
| entity_name | character varying(64) | нет | `` |
| entity_id | bigint | нет | `` |
| action | character varying(10) | нет | `` |
| before_json | jsonb | да | `` |
| after_json | jsonb | да | `` |
| occurred_at | timestamp with time zone | нет | `now()` |
| ip | inet | да | `` |
| user_agent | text | да | `` |
| is_elevated | boolean | нет | `false` |
| override_reason | character varying(500) | да | `` |

### `backup_job`

_Резервные копии_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| backup_type | character varying(11) | нет | `` |
| started_at | timestamp with time zone | нет | `now()` |
| finished_at | timestamp with time zone | да | `` |
| status | character varying(10) | нет | `'RUNNING'::character varying` |
| file_path | character varying(500) | да | `` |
| size_bytes | bigint | да | `` |
| checksum | character varying(128) | да | `` |
| retention_days | integer | нет | `30` |
| initiated_by | bigint | нет | `` |

### `breed`

_Породы_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| species_id | bigint | нет | `` |
| name | character varying(80) | нет | `` |
| avg_daily_gain | numeric | да | `` |

### `diagnosis`

_Диагнозы_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(24) | нет | `` |
| name | character varying(160) | нет | `` |
| category | character varying(64) | да | `` |

### `disposal_event`

_Выбытие животного [1:1 к животному]_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| animal_id | bigint | нет | `` |
| reason_id | bigint | нет | `` |
| disposal_type | character varying(10) | нет | `` |
| disposed_at | timestamp with time zone | нет | `now()` |
| weight_kg | numeric | да | `` |
| confirmed_by | bigint | нет | `` |
| confirmed_at | timestamp with time zone | нет | `now()` |
| notes | text | да | `` |

### `disposal_reason`

_Причины выбраковки/падежа_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(24) | нет | `` |
| name | character varying(120) | нет | `` |
| reason_type | character varying(10) | нет | `` |

### `drug`

_Препараты — подтип nomenclature [1:1, shared PK]_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| nomenclature_id | bigint | нет | `` |
| withdrawal_days | integer | нет | `0` |
| withdrawal_milk_days | integer | нет | `0` |
| is_vaccine | boolean | нет | `false` |
| storage_note | character varying(200) | да | `` |

### `employee`

_Сотрудники хозяйства_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| full_name | character varying(120) | нет | `` |
| position_id | bigint | нет | `` |
| phone | character varying(24) | да | `` |
| hire_date | date | нет | `CURRENT_DATE` |
| is_active | boolean | нет | `true` |
| is_deleted | boolean | нет | `false` |

### `examination`

_Осмотры / история болезни_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| animal_id | bigint | нет | `` |
| examined_by | bigint | нет | `` |
| examined_at | timestamp with time zone | нет | `now()` |
| diagnosis_id | bigint | да | `` |
| notes | text | да | `` |
| status_after | character varying(20) | нет | `` |

### `farm_boundary`

_Граница хозяйства — ровно одна строка (singleton)_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| farm_name | character varying(120) | нет | `` |
| geom | USER-DEFINED | нет | `` |
| area_ha | numeric | да | `` |
| updated_at | timestamp with time zone | нет | `now()` |
| updated_by | bigint | нет | `` |

### `farm_settings`

_Настраиваемые параметры хозяйства (норма га/голову, дни отдыха участка по умолчанию и т.п.)_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| setting_key | character varying(64) | нет | `` |
| value_type | character varying(8) | нет | `` |
| value_text | text | да | `` |
| value_num | numeric | да | `` |
| description | text | да | `` |
| updated_by | bigint | нет | `` |
| updated_at | timestamp with time zone | нет | `now()` |

### `grazing_event`

_История выпаса [M:M группа↔участок]. Ровно один активный (ended_at IS NULL) на группу — см. индекс ниже_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| group_id | bigint | нет | `` |
| plot_id | bigint | нет | `` |
| started_at | timestamp with time zone | нет | `now()` |
| ended_at | timestamp with time zone | да | `` |
| head_count_snapshot | integer | нет | `` |
| moved_by | bigint | нет | `` |
| note | character varying(300) | да | `` |

### `import_error`

_Ошибки импорта по строкам_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| import_job_id | bigint | нет | `` |
| row_no | integer | нет | `` |
| field_name | character varying(64) | да | `` |
| message | text | нет | `` |
| raw_value | text | да | `` |

### `import_job`

_Задания импорта_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| entity_code | character varying(48) | нет | `` |
| file_name | character varying(255) | нет | `` |
| total_rows | integer | нет | `0` |
| ok_rows | integer | нет | `0` |
| error_rows | integer | нет | `0` |
| status | character varying(12) | нет | `'RUNNING'::character varying` |
| started_at | timestamp with time zone | нет | `now()` |
| finished_at | timestamp with time zone | да | `` |
| created_by | bigint | нет | `` |

### `movement_type`

_Типы движений склада_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(24) | нет | `` |
| name | character varying(64) | нет | `` |
| direction | character varying(3) | нет | `` |

### `nomenclature`

_Номенклатура (корма/препараты/инвентарь)_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| sku | character varying(32) | нет | `` |
| name | character varying(160) | нет | `` |
| category | character varying(16) | нет | `` |
| uom_id | bigint | нет | `` |
| min_threshold | numeric | нет | `0` |
| shelf_life_days | integer | да | `` |
| is_active | boolean | нет | `true` |
| is_deleted | boolean | нет | `false` |

### `notification`

_Уведомления пользователям_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| user_id | bigint | нет | `` |
| type | character varying(16) | нет | `` |
| message | text | нет | `` |
| related_entity | character varying(64) | да | `` |
| related_id | bigint | да | `` |
| is_read | boolean | нет | `false` |
| created_at | timestamp with time zone | нет | `now()` |

### `pasture_plot`

_Пастбищные участки/загоны_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| plot_no | character varying(16) | нет | `` |
| name | character varying(80) | нет | `` |
| geom | USER-DEFINED | нет | `` |
| area_ha | numeric | да | `` |
| vegetation_type | character varying(20) | нет | `'естественное'::character varying` |
| max_head_per_ha | numeric | нет | `` |
| rest_days_required | integer | нет | `20` |
| is_active | boolean | нет | `true` |
| is_deleted | boolean | нет | `false` |

### `period_closure`

_Периоды (месяц) и их закрытие_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| period_month | date | нет | `` |
| status | character varying(8) | нет | `'OPEN'::character varying` |
| closed_by | bigint | да | `` |
| closed_at | timestamp with time zone | да | `` |
| is_locked | boolean | нет | `false` |

### `period_group_cost`

_Себестоимость и FCR по группам за период (снимок)_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| period_closure_id | bigint | нет | `` |
| group_id | bigint | нет | `` |
| feed_qty | numeric | нет | `0` |
| feed_cost | numeric | нет | `0` |
| treatment_cost | numeric | нет | `0` |
| head_days | integer | нет | `0` |
| gain_kg | numeric | нет | `0` |
| fcr | numeric | да | `` |

### `permission`

_Права доступа в формате объект:действие_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(64) | нет | `` |
| object_name | character varying(64) | нет | `` |
| action | character varying(16) | нет | `` |
| description | text | да | `` |

### `position`

_Должности_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(24) | нет | `` |
| name | character varying(80) | нет | `` |

### `product_type`

_Виды продукции_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(24) | нет | `` |
| name | character varying(80) | нет | `` |
| uom_id | bigint | нет | `` |

### `production_record`

_Продукция (привес/молоко и т.п.). Ровно один субъект — животное или группа_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| animal_id | bigint | да | `` |
| group_id | bigint | да | `` |
| product_type_id | bigint | нет | `` |
| produced_at | timestamp with time zone | нет | `now()` |
| qty | numeric | нет | `` |
| status | character varying(10) | нет | `'BLOCKED'::character varying` |
| blocked_until | date | да | `` |
| released_by | bigint | да | `` |

### `purchase_request`

_Заявки на закупку (is_auto — создана автоматически по порогу остатка)_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| nomenclature_id | bigint | нет | `` |
| requested_qty | numeric | нет | `` |
| status | character varying(12) | нет | `'NEW'::character varying` |
| is_auto | boolean | нет | `false` |
| requested_by | bigint | нет | `` |
| requested_at | timestamp with time zone | нет | `now()` |
| closed_at | timestamp with time zone | да | `` |

### `ration`

_Рационы (нормы кормления) по группам_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| group_id | bigint | нет | `` |
| valid_from | date | нет | `` |
| valid_to | date | да | `` |
| is_active | boolean | нет | `true` |
| is_deleted | boolean | нет | `false` |

### `ration_item`

_Состав рациона [M:M]_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| ration_id | bigint | нет | `` |
| nomenclature_id | bigint | нет | `` |
| norm_amount | numeric | нет | `` |
| uom_id | bigint | нет | `` |
| freq_per_day | integer | нет | `1` |

### `restore_job`

_Восстановления из резервной копии_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| backup_job_id | bigint | нет | `` |
| started_at | timestamp with time zone | нет | `now()` |
| finished_at | timestamp with time zone | да | `` |
| status | character varying(10) | нет | `'RUNNING'::character varying` |
| reason | character varying(500) | нет | `` |
| performed_by | bigint | нет | `` |

### `role`

_Роли — фиксированный набор из 6 (Директор, Суперпользователь, Администратор БД, Зоотехник, Бригадир, Кладовщик)_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(32) | нет | `` |
| name | character varying(64) | нет | `` |
| role_type | character varying(16) | нет | `` |
| is_active | boolean | нет | `true` |

### `role_permission`

_Матрица Роль × Право [M:M]_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| role_id | bigint | нет | `` |
| permission_id | bigint | нет | `` |
| granted_at | timestamp with time zone | нет | `now()` |

### `saved_filter`

_Сохранённые пользовательские фильтры реестров_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| user_id | bigint | нет | `` |
| registry_code | character varying(48) | нет | `` |
| name | character varying(80) | нет | `` |
| filter_json | jsonb | нет | `'{}'::jsonb` |
| is_default | boolean | нет | `false` |
| created_at | timestamp with time zone | нет | `now()` |

### `species`

_Виды животных_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(16) | нет | `` |
| name | character varying(64) | нет | `` |

### `stock_balance`

_Остатки по партиям [агрегат, 1:1]. Сверка — VIEW v_stock_balance_check_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| batch_id | bigint | нет | `` |
| qty_on_hand | numeric | нет | `0` |
| updated_at | timestamp with time zone | нет | `now()` |

### `stock_batch`

_Партии склада_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| nomenclature_id | bigint | нет | `` |
| warehouse_id | bigint | нет | `` |
| supplier_id | bigint | да | `` |
| batch_number | character varying(32) | нет | `` |
| received_at | timestamp with time zone | нет | `now()` |
| expiry_date | date | да | `` |
| unit_cost | numeric | нет | `` |
| initial_qty | numeric | нет | `` |

### `stock_movement`

_Движения склада (атомарно). Основание списания/расхода — не более одного из 4 FK_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| movement_type_id | bigint | нет | `` |
| batch_id | bigint | нет | `` |
| qty | numeric | нет | `` |
| uom_id | bigint | нет | `` |
| moved_at | timestamp with time zone | нет | `now()` |
| created_by | bigint | нет | `` |
| write_off_reason_id | bigint | да | `` |
| task_execution_id | bigint | да | `` |
| treatment_id | bigint | да | `` |
| purchase_request_id | bigint | да | `` |
| comment | character varying(300) | да | `` |

### `supplier`

_Поставщики_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| name | character varying(160) | нет | `` |
| contact_person | character varying(120) | да | `` |
| phone | character varying(24) | да | `` |
| email | character varying(120) | да | `` |
| is_deleted | boolean | нет | `false` |

### `task`

_Задачи/наряды. is_overdue — см. VIEW v_task_overdue_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| task_type_id | bigint | нет | `` |
| series_id | bigint | да | `` |
| title | character varying(200) | нет | `` |
| plot_id | bigint | да | `` |
| assigned_to | bigint | нет | `` |
| planned_date | date | нет | `CURRENT_DATE` |
| due_at | timestamp with time zone | нет | `` |
| priority | character varying(6) | нет | `'NORMAL'::character varying` |
| status | character varying(10) | нет | `'NEW'::character varying` |
| created_by | bigint | нет | `` |
| created_at | timestamp with time zone | нет | `now()` |
| completed_at | timestamp with time zone | да | `` |

### `task_animal_group`

_Задача ↔ группы [M:M] — групповое кормление нескольких групп одной задачей_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| task_id | bigint | нет | `` |
| group_id | bigint | нет | `` |

### `task_execution`

_Факт выполнения (план/факт). deviation — см. VIEW v_task_execution_deviation_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| task_id | bigint | нет | `` |
| group_id | bigint | нет | `` |
| executed_at | timestamp with time zone | нет | `now()` |
| planned_amount | numeric | да | `` |
| actual_amount | numeric | да | `` |
| actual_uom_id | bigint | да | `` |
| executed_by | bigint | нет | `` |
| notes | text | да | `` |

### `task_series`

_Шаблоны повторяющихся задач — горизонт не более 30 дней_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| task_type_id | bigint | нет | `` |
| title | character varying(160) | нет | `` |
| recurrence | character varying(14) | нет | `` |
| interval_days | integer | нет | `1` |
| start_date | date | нет | `` |
| end_date | date | нет | `` |
| planned_amount | numeric | да | `` |
| uom_id | bigint | да | `` |
| ration_id | bigint | да | `` |
| created_by | bigint | нет | `` |
| is_active | boolean | нет | `true` |

### `task_status_history`

_Журнал смены статусов задачи_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| task_id | bigint | нет | `` |
| status_from | character varying(10) | да | `` |
| status_to | character varying(10) | нет | `` |
| changed_at | timestamp with time zone | нет | `now()` |
| changed_by | bigint | нет | `` |
| comment | character varying(300) | да | `` |

### `task_type`

_Типы задач_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(24) | нет | `` |
| name | character varying(80) | нет | `` |
| requires_writeoff | boolean | нет | `false` |
| default_priority | integer | нет | `2` |

### `tech_log`

_Технический лог действий Администратора БД_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| admin_user_id | bigint | нет | `` |
| action_type | character varying(12) | нет | `` |
| description | text | нет | `` |
| details | jsonb | да | `` |
| occurred_at | timestamp with time zone | нет | `now()` |

### `treatment`

_Назначение лечения [1:1 к осмотру]. withdrawal_until — снимок на момент назначения_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| examination_id | bigint | нет | `` |
| nomenclature_id | bigint | нет | `` |
| dosage | numeric | нет | `` |
| uom_id | bigint | нет | `` |
| started_at | timestamp with time zone | нет | `now()` |
| ended_at | timestamp with time zone | да | `` |
| withdrawal_until | date | да | `` |
| prescribed_by | bigint | нет | `` |

### `uom`

_Единицы измерения_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(16) | нет | `` |
| name | character varying(48) | нет | `` |
| uom_type | character varying(10) | нет | `` |

### `uom_conversion`

_Пересчёт единиц измерения [M:M]_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| from_uom_id | bigint | нет | `` |
| to_uom_id | bigint | нет | `` |
| factor | numeric | нет | `` |

### `user_session`

_Сессии/токены пользователей_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| user_id | bigint | нет | `` |
| token_hash | character varying(128) | нет | `` |
| ip | inet | да | `` |
| user_agent | text | да | `` |
| issued_at | timestamp with time zone | нет | `now()` |
| expires_at | timestamp with time zone | нет | `` |
| revoked_at | timestamp with time zone | да | `` |

### `vaccination_event`

_Факт вакцинации. next_due_date — снимок, см. VIEW v_vaccination_overdue_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| animal_id | bigint | нет | `` |
| schedule_id | bigint | да | `` |
| nomenclature_id | bigint | нет | `` |
| dose | numeric | нет | `` |
| performed_at | timestamp with time zone | нет | `now()` |
| next_due_date | date | да | `` |
| performed_by | bigint | нет | `` |

### `vaccination_schedule`

_График вакцинаций по видам_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| species_id | bigint | нет | `` |
| nomenclature_id | bigint | нет | `` |
| periodicity_days | integer | нет | `` |
| first_age_days | integer | нет | `0` |
| is_active | boolean | нет | `true` |

### `warehouse`

_Склады (корма / ветаптека)_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(16) | нет | `` |
| name | character varying(80) | нет | `` |
| is_active | boolean | нет | `true` |

### `write_off_reason`

_Причины списания_

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| id | bigint | нет | `` |
| code | character varying(24) | нет | `` |
| name | character varying(120) | нет | `` |

## 7. Представления (VIEW)

### `v_active_grazing`

Активный выпас: группа, участок, площадь, дней на участке (экран «Выпас»).

### `v_animal_group_head_count`

Поголовье по группам (живые, без выбывших) — производный атрибут «число голов».

### `v_plot_rest_status`

Статус отдыха участков: прошёл ли период отдыха после последнего выпаса.

### `v_stock_balance_check`

Сверка остатков: qty_on_hand против расчёта initial + приход − расход (расхождений быть не должно).

### `v_task_execution_deviation`

Отклонение фактического расхода корма от нормы рациона по исполнениям.

### `v_task_overdue`

Просроченные невыполненные задачи (статус NEW/IN_WORK, срок прошёл).

### `v_vaccination_overdue`

Просрочка графика вакцинаций (next_due_date < сегодня) — основание для уведомлений.

## 8. Функции, триггеры и хранимые процедуры (серверная логика)

### 8.1. Триггеры (бизнес-правила на стороне СУБД)

| Триггер | Таблица | Функция | Назначение |
|---|---|---|---|
| `trg_pasture_plot_area` | `pasture_plot` | `fn_calc_area_ha` | Автоматический расчёт площади участка (га) по контуру полигона. |
| `trg_farm_boundary_area` | `farm_boundary` | `fn_calc_area_ha` | Автоматический расчёт площади границы хозяйства (га). |
| `trg_stock_movement_apply` | `stock_movement` | `fn_stock_movement_apply` | Атомарное обновление остатка на каждое движение; уход в минус блокируется CHECK. |
| `trg_grazing_event_rest_check` | `grazing_event` | `fn_check_plot_rest` | Запрет назначения выпаса на участок, не прошедший период отдыха. |
| `trg_production_record_withdrawal` | `production_record` | `fn_production_withdrawal_check` | Блокировка перевода продукции в READY до истечения withdrawal period. |
| `trg_auto_purchase_request` | `stock_balance` | `fn_auto_purchase_request` | Авто-заявка на закупку + уведомление кладовщику при остатке ниже порога. |

### 8.2. Хранимые процедуры и функции

| Тип | Объявление | Возвращает | Назначение |
|---|---|---|---|
| function | `fn_auto_purchase_request()` | `trigger` | Триггер: при падении остатка ниже min_threshold автоматически создаётся заявка на закупку кладовщику (is_auto) + уведомление |
| function | `fn_calc_area_ha()` | `trigger` |  |
| function | `fn_check_plot_rest()` | `trigger` |  |
| function | `fn_has_permission(p_user_id bigint, p_code text)` | `boolean` | Серверная авторизация: есть ли у пользователя право из матрицы role_permission |
| function | `fn_production_withdrawal_check()` | `trigger` |  |
| function | `fn_require_user(p_user_id bigint)` | `bigint` | Возвращает id сотрудника учётной записи; исключение, если это не сотрудник |
| function | `fn_stock_movement_apply()` | `trigger` |  |
| procedure | `sp_change_animal_status(p_animal_id bigint, p_new_status character varying, p_user_id bigint, p_reason text, p_diagnosis_id bigint, p_drug_nomenclature_id bigint, p_dosage numeric, p_disposal_reason_id bigint, p_ip inet)` | `character varying` | Регламентированный перевод статуса животного: диагноз/причина обязательны, лечение создаёт осмотр+назначение+расход препарата+withdrawal, выбытие — причина+подтверждение; всё в аудит |
| procedure | `sp_close_period(p_period date, p_user_id bigint)` | `TABLE(grp_id bigint, feed_qty numeric, feed_cost numeric, treatment_cost numeric, head_days integer, gain_kg numeric, fcr numeric)` | Закрытие периода: RBAC (право period:EXEC), расчёт фактического расхода корма/себестоимости/FCR по группам за месяц, статус CLOSED |
| procedure | `sp_create_task_series(p_title text, p_task_type_id bigint, p_recurrence character varying, p_interval_days integer, p_start_date date, p_end_date date, p_group_ids bigint[], p_planned_amount numeric, p_user_id bigint, p_assigned_to bigint)` | `bigint` | Шаблон повторяющихся задач (DAILY/WEEKLY/EVERY_N_DAYS) на срок до 30 дней вперёд; для кормления проверяет активный рацион у каждой группы |
| procedure | `sp_execute_task(p_task_id bigint, p_group_id bigint, p_actual_amount numeric, p_user_id bigint, p_notes text)` | `bigint` | Отметка выполнения задачи бригадиром: факт по группе + атомарное списание корма со склада (FIFO), отказ при нехватке остатка |
| procedure | `sp_move_group_to_plot(p_group_id bigint, p_plot_id bigint, p_user_id bigint, p_note text)` | `bigint` | Перевод группы на участок: проверка периода отдыха (триггер) и нормы нагрузки голов/га (процедура); закрывает предыдущий активный выпас |

Полные листинги: `db/03_functions_triggers.sql`, `db/05_procedures.sql`;
проверка работы — `db/99_checks.sql` (14 сценариев).

## 9. Индексы

- **animal**: `animal_inventory_number_key`, `animal_pkey`, `ix_animal_breed_id`, `ix_animal_group_id`
- **animal_group**: `animal_group_name_key`, `animal_group_pkey`, `ix_animal_group_species_id`
- **animal_group_history**: `animal_group_history_animal_id_moved_at_key`, `animal_group_history_pkey`, `ix_animal_group_history_animal_id`, `ix_animal_group_history_from_group_id`, `ix_animal_group_history_moved_by`, `ix_animal_group_history_to_group_id`
- **animal_weighing**: `animal_weighing_pkey`, `ix_animal_weighing_animal_id`, `ix_animal_weighing_group_id`, `ix_animal_weighing_weighed_by`
- **app_user**: `app_user_login_key`, `app_user_pkey`, `ix_app_user_employee_id`, `ix_app_user_role_id`
- **audit_log**: `audit_log_pkey`, `ix_audit_log_user_id`
- **backup_job**: `backup_job_pkey`, `ix_backup_job_initiated_by`
- **breed**: `breed_pkey`, `breed_species_id_name_key`, `ix_breed_species_id`
- **diagnosis**: `diagnosis_code_key`, `diagnosis_pkey`
- **disposal_event**: `disposal_event_animal_id_key`, `disposal_event_pkey`, `ix_disposal_event_animal_id`, `ix_disposal_event_confirmed_by`, `ix_disposal_event_reason_id`
- **disposal_reason**: `disposal_reason_code_key`, `disposal_reason_pkey`
- **drug**: `drug_pkey`
- **employee**: `employee_pkey`, `ix_employee_position_id`
- **examination**: `examination_pkey`, `ix_examination_animal_id`, `ix_examination_diagnosis_id`, `ix_examination_examined_by`
- **farm_boundary**: `farm_boundary_pkey`, `ix_farm_boundary_geom`, `ix_farm_boundary_updated_by`
- **farm_settings**: `farm_settings_pkey`, `farm_settings_setting_key_key`, `ix_farm_settings_updated_by`
- **grazing_event**: `grazing_event_pkey`, `ix_grazing_event_group_id`, `ix_grazing_event_moved_by`, `ix_grazing_event_plot_id`, `ux_grazing_event_active_group`
- **import_error**: `import_error_pkey`, `ix_import_error_import_job_id`
- **import_job**: `import_job_pkey`, `ix_import_job_created_by`
- **movement_type**: `movement_type_code_key`, `movement_type_pkey`
- **nomenclature**: `ix_nomenclature_uom_id`, `nomenclature_pkey`, `nomenclature_sku_key`
- **notification**: `ix_notification_user_id`, `notification_pkey`
- **pasture_plot**: `ix_pasture_plot_geom`, `pasture_plot_pkey`, `pasture_plot_plot_no_key`
- **period_closure**: `ix_period_closure_closed_by`, `period_closure_period_month_key`, `period_closure_pkey`
- **period_group_cost**: `ix_period_group_cost_group_id`, `ix_period_group_cost_period_closure_id`, `period_group_cost_period_closure_id_group_id_key`, `period_group_cost_pkey`
- **permission**: `permission_code_key`, `permission_pkey`
- **position**: `position_code_key`, `position_pkey`
- **product_type**: `ix_product_type_uom_id`, `product_type_code_key`, `product_type_pkey`
- **production_record**: `ix_production_record_animal_id`, `ix_production_record_group_id`, `ix_production_record_product_type_id`, `ix_production_record_released_by`, `production_record_pkey`
- **purchase_request**: `ix_purchase_request_nomenclature_id`, `ix_purchase_request_requested_by`, `purchase_request_pkey`
- **ration**: `ix_ration_group_id`, `ration_group_id_valid_from_key`, `ration_pkey`
- **ration_item**: `ix_ration_item_nomenclature_id`, `ix_ration_item_ration_id`, `ix_ration_item_uom_id`, `ration_item_pkey`, `ration_item_ration_id_nomenclature_id_key`
- **restore_job**: `ix_restore_job_backup_job_id`, `ix_restore_job_performed_by`, `restore_job_pkey`
- **role**: `role_code_key`, `role_pkey`
- **role_permission**: `ix_role_permission_permission_id`, `ix_role_permission_role_id`, `role_permission_pkey`, `role_permission_role_id_permission_id_key`
- **saved_filter**: `ix_saved_filter_user_id`, `saved_filter_pkey`
- **species**: `species_code_key`, `species_pkey`
- **stock_balance**: `ix_stock_balance_batch_id`, `stock_balance_batch_id_key`, `stock_balance_pkey`
- **stock_batch**: `ix_stock_batch_nomenclature_id`, `ix_stock_batch_supplier_id`, `ix_stock_batch_warehouse_id`, `stock_batch_nomenclature_id_warehouse_id_batch_number_key`, `stock_batch_pkey`
- **stock_movement**: `ix_stock_movement_batch_id`, `ix_stock_movement_created_by`, `ix_stock_movement_movement_type_id`, `ix_stock_movement_purchase_request_id`, `ix_stock_movement_task_execution_id`, `ix_stock_movement_treatment_id`, `ix_stock_movement_uom_id`, `ix_stock_movement_write_off_reason_id`, `stock_movement_pkey`
- **supplier**: `supplier_pkey`
- **task**: `ix_task_assigned_to`, `ix_task_created_by`, `ix_task_plot_id`, `ix_task_series_id`, `ix_task_task_type_id`, `task_pkey`
- **task_animal_group**: `ix_task_animal_group_group_id`, `ix_task_animal_group_task_id`, `task_animal_group_pkey`, `task_animal_group_task_id_group_id_key`
- **task_execution**: `ix_task_execution_actual_uom_id`, `ix_task_execution_executed_by`, `ix_task_execution_group_id`, `ix_task_execution_task_id`, `task_execution_pkey`, `task_execution_task_id_group_id_key`
- **task_series**: `ix_task_series_created_by`, `ix_task_series_ration_id`, `ix_task_series_task_type_id`, `ix_task_series_uom_id`, `task_series_pkey`
- **task_status_history**: `ix_task_status_history_changed_by`, `ix_task_status_history_task_id`, `task_status_history_pkey`
- **task_type**: `task_type_code_key`, `task_type_pkey`
- **tech_log**: `ix_tech_log_admin_user_id`, `tech_log_pkey`
- **treatment**: `ix_treatment_examination_id`, `ix_treatment_nomenclature_id`, `ix_treatment_prescribed_by`, `ix_treatment_uom_id`, `treatment_examination_id_key`, `treatment_pkey`
- **uom**: `uom_code_key`, `uom_pkey`
- **uom_conversion**: `ix_uom_conversion_from_uom_id`, `ix_uom_conversion_to_uom_id`, `uom_conversion_from_uom_id_to_uom_id_key`, `uom_conversion_pkey`
- **user_session**: `ix_user_session_user_id`, `user_session_pkey`, `user_session_token_hash_key`
- **vaccination_event**: `ix_vaccination_event_animal_id`, `ix_vaccination_event_nomenclature_id`, `ix_vaccination_event_performed_by`, `ix_vaccination_event_schedule_id`, `vaccination_event_pkey`
- **vaccination_schedule**: `ix_vaccination_schedule_nomenclature_id`, `ix_vaccination_schedule_species_id`, `vaccination_schedule_pkey`
- **warehouse**: `warehouse_code_key`, `warehouse_pkey`
- **write_off_reason**: `write_off_reason_code_key`, `write_off_reason_pkey`

---
*Как пересгенерировать: `py scripts/generate_db_doc.py` при запущенном контейнере `farm_pg`.*
