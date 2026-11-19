-- =============================================================================
-- ИС учёта фермерского хозяйства «Заречное» (Вариант 11, ~75 га)
-- Файл 01_schema.sql: расширения, таблицы, индексы, внешние ключи.
-- PostgreSQL 16 + PostGIS. 56 таблиц, 12 доменов, 93 FK.
-- Порядок выполнения: 01_schema -> 02_views -> 03_functions_triggers -> 04_seed_demo
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;


-- ============================== Контур A. Доступ и RBAC ==============================

CREATE TABLE role (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL,
    role_type VARCHAR(16) NOT NULL CHECK (role_type IN ('BUSINESS','TECHNICAL')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (code)
);
COMMENT ON TABLE role IS 'Роли — фиксированный набор из 6 (Директор, Суперпользователь, Администратор БД, Зоотехник, Бригадир, Кладовщик)';

CREATE TABLE permission (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(64) NOT NULL,
    object_name VARCHAR(64) NOT NULL,
    action VARCHAR(16) NOT NULL CHECK (action IN ('READ','WRITE','DELETE','EXEC')),
    description TEXT,
    UNIQUE (code)
);
COMMENT ON TABLE permission IS 'Права доступа в формате объект:действие';

CREATE TABLE role_permission (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_id BIGINT NOT NULL,
    permission_id BIGINT NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (role_id, permission_id)
);
COMMENT ON TABLE role_permission IS 'Матрица Роль × Право [M:M]';

CREATE TABLE app_user (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    login VARCHAR(64) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    role_id BIGINT NOT NULL,
    employee_id BIGINT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    must_change_pw BOOLEAN NOT NULL DEFAULT TRUE,
    failed_cnt INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    UNIQUE (login)
);
COMMENT ON TABLE app_user IS 'Учётные записи пользователей';

CREATE TABLE user_session (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL,
    token_hash VARCHAR(128) NOT NULL,
    ip INET,
    user_agent TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    UNIQUE (token_hash)
);
COMMENT ON TABLE user_session IS 'Сессии/токены пользователей';

CREATE TABLE saved_filter (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL,
    registry_code VARCHAR(48) NOT NULL,
    name VARCHAR(80) NOT NULL,
    filter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE saved_filter IS 'Сохранённые пользовательские фильтры реестров';


-- ============================== Контур M. Настройки ==============================

CREATE TABLE farm_settings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    setting_key VARCHAR(64) NOT NULL,
    value_type VARCHAR(8) NOT NULL CHECK (value_type IN ('TEXT','NUM','BOOL','DATE')),
    value_text TEXT,
    value_num NUMERIC(12,3),
    description TEXT,
    updated_by BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (setting_key)
);
COMMENT ON TABLE farm_settings IS 'Настраиваемые параметры хозяйства (норма га/голову, дни отдыха участка по умолчанию и т.п.)';


-- ============================== Контур B. Персонал ==============================

CREATE TABLE position (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(24) NOT NULL,
    name VARCHAR(80) NOT NULL,
    UNIQUE (code)
);
COMMENT ON TABLE position IS 'Должности';

CREATE TABLE employee (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    position_id BIGINT NOT NULL,
    phone VARCHAR(24),
    hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);
COMMENT ON TABLE employee IS 'Сотрудники хозяйства';


-- ============================== Контур C. Поголовье ==============================

CREATE TABLE species (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(16) NOT NULL,
    name VARCHAR(64) NOT NULL,
    UNIQUE (code)
);
COMMENT ON TABLE species IS 'Виды животных';

CREATE TABLE breed (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    species_id BIGINT NOT NULL,
    name VARCHAR(80) NOT NULL,
    avg_daily_gain NUMERIC(6,3),
    UNIQUE (species_id, name)
);
COMMENT ON TABLE breed IS 'Породы';

CREATE TABLE animal_group (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    species_id BIGINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (name)
);
COMMENT ON TABLE animal_group IS 'Группы животных. head_count — производный атрибут, см. VIEW v_animal_group_head_count';

CREATE TABLE animal (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inventory_number VARCHAR(20) NOT NULL,
    breed_id BIGINT NOT NULL,
    group_id BIGINT,
    birth_date DATE NOT NULL,
    sex CHAR(1) NOT NULL CHECK (sex IN ('M','F')),
    status VARCHAR(20) NOT NULL DEFAULT 'ЗДОРОВ' CHECK (status IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ','ВЫБРАКОВАНО','ПАДЁЖ')),
    arrival_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (inventory_number)
);
COMMENT ON TABLE animal IS 'Животные — индивидуальные карточки';

CREATE TABLE animal_group_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_id BIGINT NOT NULL,
    from_group_id BIGINT,
    to_group_id BIGINT NOT NULL,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason VARCHAR(200),
    moved_by BIGINT NOT NULL,
    UNIQUE (animal_id, moved_at)
);
COMMENT ON TABLE animal_group_history IS 'Журнал переводов животных между группами';


-- ============================== Контур D. Здоровье ==============================

CREATE TABLE diagnosis (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(24) NOT NULL,
    name VARCHAR(160) NOT NULL,
    category VARCHAR(64),
    UNIQUE (code)
);
COMMENT ON TABLE diagnosis IS 'Диагнозы';

CREATE TABLE examination (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_id BIGINT NOT NULL,
    examined_by BIGINT NOT NULL,
    examined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    diagnosis_id BIGINT,
    notes TEXT,
    status_after VARCHAR(20) NOT NULL CHECK (status_after IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ','ВЫБРАКОВАНО','ПАДЁЖ'))
);
COMMENT ON TABLE examination IS 'Осмотры / история болезни';

CREATE TABLE treatment (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    examination_id BIGINT NOT NULL,
    nomenclature_id BIGINT NOT NULL,
    dosage NUMERIC(10,3) NOT NULL,
    uom_id BIGINT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    withdrawal_until DATE,
    prescribed_by BIGINT NOT NULL,
    UNIQUE (examination_id)
);
COMMENT ON TABLE treatment IS 'Назначение лечения [1:1 к осмотру]. withdrawal_until — снимок на момент назначения';

CREATE TABLE drug (
    nomenclature_id BIGINT PRIMARY KEY,
    withdrawal_days INT NOT NULL DEFAULT 0,
    withdrawal_milk_days INT NOT NULL DEFAULT 0,
    is_vaccine BOOLEAN NOT NULL DEFAULT FALSE,
    storage_note VARCHAR(200)
);
COMMENT ON TABLE drug IS 'Препараты — подтип nomenclature [1:1, shared PK]';

CREATE TABLE vaccination_schedule (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    species_id BIGINT NOT NULL,
    nomenclature_id BIGINT NOT NULL,
    periodicity_days INT NOT NULL,
    first_age_days INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE vaccination_schedule IS 'График вакцинаций по видам';

CREATE TABLE vaccination_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_id BIGINT NOT NULL,
    schedule_id BIGINT,
    nomenclature_id BIGINT NOT NULL,
    dose NUMERIC(8,3) NOT NULL,
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_due_date DATE,
    performed_by BIGINT NOT NULL
);
COMMENT ON TABLE vaccination_event IS 'Факт вакцинации. next_due_date — снимок, см. VIEW v_vaccination_overdue';

CREATE TABLE disposal_reason (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(24) NOT NULL,
    name VARCHAR(120) NOT NULL,
    reason_type VARCHAR(10) NOT NULL CHECK (reason_type IN ('CULLING','DEATH')),
    UNIQUE (code)
);
COMMENT ON TABLE disposal_reason IS 'Причины выбраковки/падежа';

CREATE TABLE disposal_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_id BIGINT NOT NULL,
    reason_id BIGINT NOT NULL,
    disposal_type VARCHAR(10) NOT NULL CHECK (disposal_type IN ('CULLING','DEATH')),
    disposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    weight_kg NUMERIC(8,2),
    confirmed_by BIGINT NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,
    UNIQUE (animal_id)
);
COMMENT ON TABLE disposal_event IS 'Выбытие животного [1:1 к животному]';


-- ============================== Контур E. Кормление и рационы ==============================

CREATE TABLE uom (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(16) NOT NULL,
    name VARCHAR(48) NOT NULL,
    uom_type VARCHAR(10) NOT NULL CHECK (uom_type IN ('MASS','VOLUME','COUNT')),
    UNIQUE (code)
);
COMMENT ON TABLE uom IS 'Единицы измерения';

CREATE TABLE uom_conversion (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    from_uom_id BIGINT NOT NULL,
    to_uom_id BIGINT NOT NULL,
    factor NUMERIC(12,6) NOT NULL CHECK (factor > 0),
    UNIQUE (from_uom_id, to_uom_id)
);
COMMENT ON TABLE uom_conversion IS 'Пересчёт единиц измерения [M:M]';

CREATE TABLE ration (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id BIGINT NOT NULL,
    valid_from DATE NOT NULL,
    valid_to DATE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (group_id, valid_from),
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
COMMENT ON TABLE ration IS 'Рационы (нормы кормления) по группам';

CREATE TABLE ration_item (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ration_id BIGINT NOT NULL,
    nomenclature_id BIGINT NOT NULL,
    norm_amount NUMERIC(10,3) NOT NULL CHECK (norm_amount > 0),
    uom_id BIGINT NOT NULL,
    freq_per_day INT NOT NULL DEFAULT 1,
    UNIQUE (ration_id, nomenclature_id)
);
COMMENT ON TABLE ration_item IS 'Состав рациона [M:M]';


-- ============================== Контур F. Склад ==============================

CREATE TABLE nomenclature (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sku VARCHAR(32) NOT NULL,
    name VARCHAR(160) NOT NULL,
    category VARCHAR(16) NOT NULL CHECK (category IN ('FEED','DRUG','INVENTORY','VACCINE')),
    uom_id BIGINT NOT NULL,
    min_threshold NUMERIC(10,3) NOT NULL DEFAULT 0,
    shelf_life_days INT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (sku)
);
COMMENT ON TABLE nomenclature IS 'Номенклатура (корма/препараты/инвентарь)';

CREATE TABLE supplier (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    contact_person VARCHAR(120),
    phone VARCHAR(24),
    email VARCHAR(120),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);
COMMENT ON TABLE supplier IS 'Поставщики';

CREATE TABLE warehouse (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(16) NOT NULL,
    name VARCHAR(80) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (code)
);
COMMENT ON TABLE warehouse IS 'Склады (корма / ветаптека)';

CREATE TABLE stock_batch (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nomenclature_id BIGINT NOT NULL,
    warehouse_id BIGINT NOT NULL,
    supplier_id BIGINT,
    batch_number VARCHAR(32) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expiry_date DATE,
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    initial_qty NUMERIC(10,3) NOT NULL CHECK (initial_qty >= 0),
    UNIQUE (nomenclature_id, warehouse_id, batch_number)
);
COMMENT ON TABLE stock_batch IS 'Партии склада';

CREATE TABLE stock_balance (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    qty_on_hand NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (batch_id)
);
COMMENT ON TABLE stock_balance IS 'Остатки по партиям [агрегат, 1:1]. Сверка — VIEW v_stock_balance_check';

CREATE TABLE movement_type (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(24) NOT NULL,
    name VARCHAR(64) NOT NULL,
    direction VARCHAR(3) NOT NULL CHECK (direction IN ('IN','OUT')),
    UNIQUE (code)
);
COMMENT ON TABLE movement_type IS 'Типы движений склада';

CREATE TABLE write_off_reason (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(24) NOT NULL,
    name VARCHAR(120) NOT NULL,
    UNIQUE (code)
);
COMMENT ON TABLE write_off_reason IS 'Причины списания';

CREATE TABLE stock_movement (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    movement_type_id BIGINT NOT NULL,
    batch_id BIGINT NOT NULL,
    qty NUMERIC(10,3) NOT NULL CHECK (qty > 0),
    uom_id BIGINT NOT NULL,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by BIGINT NOT NULL,
    write_off_reason_id BIGINT,
    task_execution_id BIGINT,
    treatment_id BIGINT,
    purchase_request_id BIGINT,
    comment VARCHAR(300),
    CHECK (num_nonnulls(write_off_reason_id, task_execution_id, treatment_id, purchase_request_id) <= 1)
);
COMMENT ON TABLE stock_movement IS 'Движения склада (атомарно). Основание списания/расхода — не более одного из 4 FK';

CREATE TABLE purchase_request (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nomenclature_id BIGINT NOT NULL,
    requested_qty NUMERIC(10,3) NOT NULL CHECK (requested_qty > 0),
    status VARCHAR(12) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','IN_WORK','CLOSED','CANCELLED')),
    is_auto BOOLEAN NOT NULL DEFAULT FALSE,
    requested_by BIGINT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);
COMMENT ON TABLE purchase_request IS 'Заявки на закупку (is_auto — создана автоматически по порогу остатка)';


-- ============================== Контур G. Пастбища (PostGIS) ==============================

CREATE TABLE farm_boundary (
    id BIGINT PRIMARY KEY,
    farm_name VARCHAR(120) NOT NULL,
    geom geometry(Polygon,4326) NOT NULL,
    area_ha NUMERIC(8,3),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by BIGINT NOT NULL,
    CHECK (id = 1)
);
COMMENT ON TABLE farm_boundary IS 'Граница хозяйства — ровно одна строка (singleton)';

CREATE TABLE pasture_plot (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plot_no VARCHAR(16) NOT NULL,
    name VARCHAR(80) NOT NULL,
    geom geometry(Polygon,4326) NOT NULL,
    area_ha NUMERIC(8,3),
    vegetation_type VARCHAR(20) NOT NULL DEFAULT 'естественное' CHECK (vegetation_type IN ('культурное','естественное')),
    max_head_per_ha NUMERIC(6,3) NOT NULL,
    rest_days_required INT NOT NULL DEFAULT 20,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (plot_no)
);
COMMENT ON TABLE pasture_plot IS 'Пастбищные участки/загоны';

CREATE TABLE grazing_event (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id BIGINT NOT NULL,
    plot_id BIGINT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    head_count_snapshot INT NOT NULL CHECK (head_count_snapshot > 0),
    moved_by BIGINT NOT NULL,
    note VARCHAR(300)
);
COMMENT ON TABLE grazing_event IS 'История выпаса [M:M группа↔участок]. Ровно один активный (ended_at IS NULL) на группу — см. индекс ниже';


-- ============================== Контур H. Задачи ==============================

CREATE TABLE task_type (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(24) NOT NULL,
    name VARCHAR(80) NOT NULL,
    requires_writeoff BOOLEAN NOT NULL DEFAULT FALSE,
    default_priority INT NOT NULL DEFAULT 2,
    UNIQUE (code)
);
COMMENT ON TABLE task_type IS 'Типы задач';

CREATE TABLE task_series (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_type_id BIGINT NOT NULL,
    title VARCHAR(160) NOT NULL,
    recurrence VARCHAR(14) NOT NULL CHECK (recurrence IN ('DAILY','WEEKLY','EVERY_N_DAYS')),
    interval_days INT NOT NULL DEFAULT 1 CHECK (interval_days > 0),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    planned_amount NUMERIC(10,3),
    uom_id BIGINT,
    ration_id BIGINT,
    created_by BIGINT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (end_date >= start_date),
    CHECK ((end_date - start_date) <= 30)
);
COMMENT ON TABLE task_series IS 'Шаблоны повторяющихся задач — горизонт не более 30 дней';

CREATE TABLE task (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_type_id BIGINT NOT NULL,
    series_id BIGINT,
    title VARCHAR(200) NOT NULL,
    plot_id BIGINT,
    assigned_to BIGINT NOT NULL,
    planned_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_at TIMESTAMPTZ NOT NULL,
    priority VARCHAR(6) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH')),
    status VARCHAR(10) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','IN_WORK','DONE','CANCELLED')),
    created_by BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
COMMENT ON TABLE task IS 'Задачи/наряды. is_overdue — см. VIEW v_task_overdue';

CREATE TABLE task_animal_group (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id BIGINT NOT NULL,
    group_id BIGINT NOT NULL,
    UNIQUE (task_id, group_id)
);
COMMENT ON TABLE task_animal_group IS 'Задача ↔ группы [M:M] — групповое кормление нескольких групп одной задачей';

CREATE TABLE task_status_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id BIGINT NOT NULL,
    status_from VARCHAR(10),
    status_to VARCHAR(10) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by BIGINT NOT NULL,
    comment VARCHAR(300)
);
COMMENT ON TABLE task_status_history IS 'Журнал смены статусов задачи';

CREATE TABLE task_execution (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id BIGINT NOT NULL,
    group_id BIGINT NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    planned_amount NUMERIC(10,3),
    actual_amount NUMERIC(10,3),
    actual_uom_id BIGINT,
    executed_by BIGINT NOT NULL,
    notes TEXT,
    UNIQUE (task_id, group_id)
);
COMMENT ON TABLE task_execution IS 'Факт выполнения (план/факт). deviation — см. VIEW v_task_execution_deviation';


-- ============================== Контур I. Продукция ==============================

CREATE TABLE product_type (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(24) NOT NULL,
    name VARCHAR(80) NOT NULL,
    uom_id BIGINT NOT NULL,
    UNIQUE (code)
);
COMMENT ON TABLE product_type IS 'Виды продукции';

CREATE TABLE production_record (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_id BIGINT,
    group_id BIGINT,
    product_type_id BIGINT NOT NULL,
    produced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    qty NUMERIC(10,3) NOT NULL CHECK (qty > 0),
    status VARCHAR(10) NOT NULL DEFAULT 'BLOCKED' CHECK (status IN ('BLOCKED','READY','SOLD')),
    blocked_until DATE,
    released_by BIGINT,
    CHECK (num_nonnulls(animal_id, group_id) = 1)
);
COMMENT ON TABLE production_record IS 'Продукция (привес/молоко и т.п.). Ровно один субъект — животное или группа';

CREATE TABLE animal_weighing (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_id BIGINT,
    group_id BIGINT,
    weighed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    weight_kg NUMERIC(8,2) NOT NULL CHECK (weight_kg > 0),
    method VARCHAR(12) NOT NULL CHECK (method IN ('INDIVIDUAL','GROUP_AVG')),
    weighed_by BIGINT NOT NULL,
    CHECK (num_nonnulls(animal_id, group_id) = 1)
);
COMMENT ON TABLE animal_weighing IS 'Взвешивания — база для расчёта FCR';


-- ============================== Контур J. Закрытие периода ==============================

CREATE TABLE period_closure (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_month DATE NOT NULL,
    status VARCHAR(8) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSING','CLOSED')),
    closed_by BIGINT,
    closed_at TIMESTAMPTZ,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (period_month)
);
COMMENT ON TABLE period_closure IS 'Периоды (месяц) и их закрытие';

CREATE TABLE period_group_cost (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_closure_id BIGINT NOT NULL,
    group_id BIGINT NOT NULL,
    feed_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
    feed_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    treatment_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    head_days INT NOT NULL DEFAULT 0,
    gain_kg NUMERIC(10,2) NOT NULL DEFAULT 0,
    fcr NUMERIC(8,3),
    UNIQUE (period_closure_id, group_id)
);
COMMENT ON TABLE period_group_cost IS 'Себестоимость и FCR по группам за период (снимок)';


-- ============================== Контур K. Импорт ==============================

CREATE TABLE import_job (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_code VARCHAR(48) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    total_rows INT NOT NULL DEFAULT 0,
    ok_rows INT NOT NULL DEFAULT 0,
    error_rows INT NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','OK','FAILED','ROLLED_BACK')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    created_by BIGINT NOT NULL
);
COMMENT ON TABLE import_job IS 'Задания импорта';

CREATE TABLE import_error (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    import_job_id BIGINT NOT NULL,
    row_no INT NOT NULL,
    field_name VARCHAR(64),
    message TEXT NOT NULL,
    raw_value TEXT
);
COMMENT ON TABLE import_error IS 'Ошибки импорта по строкам';


-- ============================== Контур L. Технический контур ==============================

CREATE TABLE audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL,
    entity_name VARCHAR(64) NOT NULL,
    entity_id BIGINT NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','LOGIN','EXPORT','OVERRIDE','DENY','READ_PII')),
    before_json JSONB,
    after_json JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip INET,
    user_agent TEXT,
    is_elevated BOOLEAN NOT NULL DEFAULT FALSE,
    override_reason VARCHAR(500),
    CHECK (NOT is_elevated OR override_reason IS NOT NULL)
);
COMMENT ON TABLE audit_log IS 'Журнал бизнес-аудита. Действия Суперпользователя обязаны иметь причину';

CREATE TABLE tech_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_user_id BIGINT NOT NULL,
    action_type VARCHAR(12) NOT NULL CHECK (action_type IN ('MIGRATION','BACKUP','RESTORE','MAINTENANCE','VACUUM','INDEX')),
    description TEXT NOT NULL,
    details JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE tech_log IS 'Технический лог действий Администратора БД';

CREATE TABLE backup_job (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    backup_type VARCHAR(11) NOT NULL CHECK (backup_type IN ('FULL','INCREMENTAL')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(10) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','OK','FAILED')),
    file_path VARCHAR(500),
    size_bytes BIGINT,
    checksum VARCHAR(128),
    retention_days INT NOT NULL DEFAULT 30,
    initiated_by BIGINT NOT NULL
);
COMMENT ON TABLE backup_job IS 'Резервные копии';

CREATE TABLE restore_job (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    backup_job_id BIGINT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(10) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','OK','FAILED')),
    reason VARCHAR(500) NOT NULL,
    performed_by BIGINT NOT NULL
);
COMMENT ON TABLE restore_job IS 'Восстановления из резервной копии';

CREATE TABLE notification (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL,
    type VARCHAR(16) NOT NULL CHECK (type IN ('VACCINE_OVERDUE','LOW_STOCK','TASK_OVERDUE','PLOT_REST','REST_END')),
    message TEXT NOT NULL,
    related_entity VARCHAR(64),
    related_id BIGINT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE notification IS 'Уведомления пользователям';

-- ============================== Индексы ==============================

CREATE INDEX ix_role_permission_role_id ON role_permission (role_id);
CREATE INDEX ix_role_permission_permission_id ON role_permission (permission_id);
CREATE INDEX ix_app_user_role_id ON app_user (role_id);
CREATE INDEX ix_app_user_employee_id ON app_user (employee_id);
CREATE INDEX ix_user_session_user_id ON user_session (user_id);
CREATE INDEX ix_saved_filter_user_id ON saved_filter (user_id);
CREATE INDEX ix_farm_settings_updated_by ON farm_settings (updated_by);
CREATE INDEX ix_employee_position_id ON employee (position_id);
CREATE INDEX ix_breed_species_id ON breed (species_id);
CREATE INDEX ix_animal_group_species_id ON animal_group (species_id);
CREATE INDEX ix_animal_breed_id ON animal (breed_id);
CREATE INDEX ix_animal_group_id ON animal (group_id);
CREATE INDEX ix_animal_group_history_animal_id ON animal_group_history (animal_id);
CREATE INDEX ix_animal_group_history_from_group_id ON animal_group_history (from_group_id);
CREATE INDEX ix_animal_group_history_to_group_id ON animal_group_history (to_group_id);
CREATE INDEX ix_animal_group_history_moved_by ON animal_group_history (moved_by);
CREATE INDEX ix_examination_animal_id ON examination (animal_id);
CREATE INDEX ix_examination_examined_by ON examination (examined_by);
CREATE INDEX ix_examination_diagnosis_id ON examination (diagnosis_id);
CREATE INDEX ix_treatment_examination_id ON treatment (examination_id);
CREATE INDEX ix_treatment_nomenclature_id ON treatment (nomenclature_id);
CREATE INDEX ix_treatment_uom_id ON treatment (uom_id);
CREATE INDEX ix_treatment_prescribed_by ON treatment (prescribed_by);
CREATE INDEX ix_vaccination_schedule_species_id ON vaccination_schedule (species_id);
CREATE INDEX ix_vaccination_schedule_nomenclature_id ON vaccination_schedule (nomenclature_id);
CREATE INDEX ix_vaccination_event_animal_id ON vaccination_event (animal_id);
CREATE INDEX ix_vaccination_event_schedule_id ON vaccination_event (schedule_id);
CREATE INDEX ix_vaccination_event_nomenclature_id ON vaccination_event (nomenclature_id);
CREATE INDEX ix_vaccination_event_performed_by ON vaccination_event (performed_by);
CREATE INDEX ix_disposal_event_animal_id ON disposal_event (animal_id);
CREATE INDEX ix_disposal_event_reason_id ON disposal_event (reason_id);
CREATE INDEX ix_disposal_event_confirmed_by ON disposal_event (confirmed_by);
CREATE INDEX ix_uom_conversion_from_uom_id ON uom_conversion (from_uom_id);
CREATE INDEX ix_uom_conversion_to_uom_id ON uom_conversion (to_uom_id);
CREATE INDEX ix_ration_group_id ON ration (group_id);
CREATE INDEX ix_ration_item_ration_id ON ration_item (ration_id);
CREATE INDEX ix_ration_item_nomenclature_id ON ration_item (nomenclature_id);
CREATE INDEX ix_ration_item_uom_id ON ration_item (uom_id);
CREATE INDEX ix_nomenclature_uom_id ON nomenclature (uom_id);
CREATE INDEX ix_stock_batch_nomenclature_id ON stock_batch (nomenclature_id);
CREATE INDEX ix_stock_batch_warehouse_id ON stock_batch (warehouse_id);
CREATE INDEX ix_stock_batch_supplier_id ON stock_batch (supplier_id);
CREATE INDEX ix_stock_balance_batch_id ON stock_balance (batch_id);
CREATE INDEX ix_stock_movement_movement_type_id ON stock_movement (movement_type_id);
CREATE INDEX ix_stock_movement_batch_id ON stock_movement (batch_id);
CREATE INDEX ix_stock_movement_uom_id ON stock_movement (uom_id);
CREATE INDEX ix_stock_movement_created_by ON stock_movement (created_by);
CREATE INDEX ix_stock_movement_write_off_reason_id ON stock_movement (write_off_reason_id);
CREATE INDEX ix_stock_movement_task_execution_id ON stock_movement (task_execution_id);
CREATE INDEX ix_stock_movement_treatment_id ON stock_movement (treatment_id);
CREATE INDEX ix_stock_movement_purchase_request_id ON stock_movement (purchase_request_id);
CREATE INDEX ix_purchase_request_nomenclature_id ON purchase_request (nomenclature_id);
CREATE INDEX ix_purchase_request_requested_by ON purchase_request (requested_by);
CREATE INDEX ix_farm_boundary_updated_by ON farm_boundary (updated_by);
CREATE INDEX ix_grazing_event_group_id ON grazing_event (group_id);
CREATE INDEX ix_grazing_event_plot_id ON grazing_event (plot_id);
CREATE INDEX ix_grazing_event_moved_by ON grazing_event (moved_by);
CREATE INDEX ix_task_series_task_type_id ON task_series (task_type_id);
CREATE INDEX ix_task_series_uom_id ON task_series (uom_id);
CREATE INDEX ix_task_series_ration_id ON task_series (ration_id);
CREATE INDEX ix_task_series_created_by ON task_series (created_by);
CREATE INDEX ix_task_task_type_id ON task (task_type_id);
CREATE INDEX ix_task_series_id ON task (series_id);
CREATE INDEX ix_task_plot_id ON task (plot_id);
CREATE INDEX ix_task_assigned_to ON task (assigned_to);
CREATE INDEX ix_task_created_by ON task (created_by);
CREATE INDEX ix_task_animal_group_task_id ON task_animal_group (task_id);
CREATE INDEX ix_task_animal_group_group_id ON task_animal_group (group_id);
CREATE INDEX ix_task_status_history_task_id ON task_status_history (task_id);
CREATE INDEX ix_task_status_history_changed_by ON task_status_history (changed_by);
CREATE INDEX ix_task_execution_task_id ON task_execution (task_id);
CREATE INDEX ix_task_execution_group_id ON task_execution (group_id);
CREATE INDEX ix_task_execution_actual_uom_id ON task_execution (actual_uom_id);
CREATE INDEX ix_task_execution_executed_by ON task_execution (executed_by);
CREATE INDEX ix_product_type_uom_id ON product_type (uom_id);
CREATE INDEX ix_production_record_animal_id ON production_record (animal_id);
CREATE INDEX ix_production_record_group_id ON production_record (group_id);
CREATE INDEX ix_production_record_product_type_id ON production_record (product_type_id);
CREATE INDEX ix_production_record_released_by ON production_record (released_by);
CREATE INDEX ix_animal_weighing_animal_id ON animal_weighing (animal_id);
CREATE INDEX ix_animal_weighing_group_id ON animal_weighing (group_id);
CREATE INDEX ix_animal_weighing_weighed_by ON animal_weighing (weighed_by);
CREATE INDEX ix_period_closure_closed_by ON period_closure (closed_by);
CREATE INDEX ix_period_group_cost_period_closure_id ON period_group_cost (period_closure_id);
CREATE INDEX ix_period_group_cost_group_id ON period_group_cost (group_id);
CREATE INDEX ix_import_job_created_by ON import_job (created_by);
CREATE INDEX ix_import_error_import_job_id ON import_error (import_job_id);
CREATE INDEX ix_audit_log_user_id ON audit_log (user_id);
CREATE INDEX ix_tech_log_admin_user_id ON tech_log (admin_user_id);
CREATE INDEX ix_backup_job_initiated_by ON backup_job (initiated_by);
CREATE INDEX ix_restore_job_backup_job_id ON restore_job (backup_job_id);
CREATE INDEX ix_restore_job_performed_by ON restore_job (performed_by);
CREATE INDEX ix_notification_user_id ON notification (user_id);

-- Пространственные индексы PostGIS
CREATE INDEX ix_pasture_plot_geom ON pasture_plot USING GIST (geom);
CREATE INDEX ix_farm_boundary_geom ON farm_boundary USING GIST (geom);

-- Партиционное правило: не более одного активного (ended_at IS NULL) выпаса на группу
CREATE UNIQUE INDEX ux_grazing_event_active_group ON grazing_event (group_id) WHERE ended_at IS NULL;

-- ============================== Внешние ключи ==============================

ALTER TABLE role_permission ADD CONSTRAINT fk_role_permission_role_id FOREIGN KEY (role_id) REFERENCES role (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE role_permission ADD CONSTRAINT fk_role_permission_permission_id FOREIGN KEY (permission_id) REFERENCES permission (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE app_user ADD CONSTRAINT fk_app_user_role_id FOREIGN KEY (role_id) REFERENCES role (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE app_user ADD CONSTRAINT fk_app_user_employee_id FOREIGN KEY (employee_id) REFERENCES employee (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE user_session ADD CONSTRAINT fk_user_session_user_id FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE saved_filter ADD CONSTRAINT fk_saved_filter_user_id FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE farm_settings ADD CONSTRAINT fk_farm_settings_updated_by FOREIGN KEY (updated_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE employee ADD CONSTRAINT fk_employee_position_id FOREIGN KEY (position_id) REFERENCES position (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE breed ADD CONSTRAINT fk_breed_species_id FOREIGN KEY (species_id) REFERENCES species (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal_group ADD CONSTRAINT fk_animal_group_species_id FOREIGN KEY (species_id) REFERENCES species (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal ADD CONSTRAINT fk_animal_breed_id FOREIGN KEY (breed_id) REFERENCES breed (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal ADD CONSTRAINT fk_animal_group_id FOREIGN KEY (group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal_group_history ADD CONSTRAINT fk_animal_group_history_animal_id FOREIGN KEY (animal_id) REFERENCES animal (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal_group_history ADD CONSTRAINT fk_animal_group_history_from_group_id FOREIGN KEY (from_group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal_group_history ADD CONSTRAINT fk_animal_group_history_to_group_id FOREIGN KEY (to_group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal_group_history ADD CONSTRAINT fk_animal_group_history_moved_by FOREIGN KEY (moved_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE examination ADD CONSTRAINT fk_examination_animal_id FOREIGN KEY (animal_id) REFERENCES animal (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE examination ADD CONSTRAINT fk_examination_examined_by FOREIGN KEY (examined_by) REFERENCES employee (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE examination ADD CONSTRAINT fk_examination_diagnosis_id FOREIGN KEY (diagnosis_id) REFERENCES diagnosis (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE treatment ADD CONSTRAINT fk_treatment_examination_id FOREIGN KEY (examination_id) REFERENCES examination (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE treatment ADD CONSTRAINT fk_treatment_nomenclature_id FOREIGN KEY (nomenclature_id) REFERENCES nomenclature (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE treatment ADD CONSTRAINT fk_treatment_uom_id FOREIGN KEY (uom_id) REFERENCES uom (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE treatment ADD CONSTRAINT fk_treatment_prescribed_by FOREIGN KEY (prescribed_by) REFERENCES employee (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE vaccination_schedule ADD CONSTRAINT fk_vaccination_schedule_species_id FOREIGN KEY (species_id) REFERENCES species (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE vaccination_schedule ADD CONSTRAINT fk_vaccination_schedule_nomenclature_id FOREIGN KEY (nomenclature_id) REFERENCES nomenclature (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE vaccination_event ADD CONSTRAINT fk_vaccination_event_animal_id FOREIGN KEY (animal_id) REFERENCES animal (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE vaccination_event ADD CONSTRAINT fk_vaccination_event_schedule_id FOREIGN KEY (schedule_id) REFERENCES vaccination_schedule (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE vaccination_event ADD CONSTRAINT fk_vaccination_event_nomenclature_id FOREIGN KEY (nomenclature_id) REFERENCES nomenclature (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE vaccination_event ADD CONSTRAINT fk_vaccination_event_performed_by FOREIGN KEY (performed_by) REFERENCES employee (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE disposal_event ADD CONSTRAINT fk_disposal_event_animal_id FOREIGN KEY (animal_id) REFERENCES animal (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE disposal_event ADD CONSTRAINT fk_disposal_event_reason_id FOREIGN KEY (reason_id) REFERENCES disposal_reason (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE disposal_event ADD CONSTRAINT fk_disposal_event_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES employee (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE uom_conversion ADD CONSTRAINT fk_uom_conversion_from_uom_id FOREIGN KEY (from_uom_id) REFERENCES uom (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE uom_conversion ADD CONSTRAINT fk_uom_conversion_to_uom_id FOREIGN KEY (to_uom_id) REFERENCES uom (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ration ADD CONSTRAINT fk_ration_group_id FOREIGN KEY (group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE ration_item ADD CONSTRAINT fk_ration_item_ration_id FOREIGN KEY (ration_id) REFERENCES ration (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ration_item ADD CONSTRAINT fk_ration_item_nomenclature_id FOREIGN KEY (nomenclature_id) REFERENCES nomenclature (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ration_item ADD CONSTRAINT fk_ration_item_uom_id FOREIGN KEY (uom_id) REFERENCES uom (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE nomenclature ADD CONSTRAINT fk_nomenclature_uom_id FOREIGN KEY (uom_id) REFERENCES uom (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_batch ADD CONSTRAINT fk_stock_batch_nomenclature_id FOREIGN KEY (nomenclature_id) REFERENCES nomenclature (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_batch ADD CONSTRAINT fk_stock_batch_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES warehouse (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_batch ADD CONSTRAINT fk_stock_batch_supplier_id FOREIGN KEY (supplier_id) REFERENCES supplier (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_balance ADD CONSTRAINT fk_stock_balance_batch_id FOREIGN KEY (batch_id) REFERENCES stock_batch (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE stock_movement ADD CONSTRAINT fk_stock_movement_movement_type_id FOREIGN KEY (movement_type_id) REFERENCES movement_type (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movement ADD CONSTRAINT fk_stock_movement_batch_id FOREIGN KEY (batch_id) REFERENCES stock_batch (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movement ADD CONSTRAINT fk_stock_movement_uom_id FOREIGN KEY (uom_id) REFERENCES uom (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movement ADD CONSTRAINT fk_stock_movement_created_by FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movement ADD CONSTRAINT fk_stock_movement_write_off_reason_id FOREIGN KEY (write_off_reason_id) REFERENCES write_off_reason (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movement ADD CONSTRAINT fk_stock_movement_task_execution_id FOREIGN KEY (task_execution_id) REFERENCES task_execution (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movement ADD CONSTRAINT fk_stock_movement_treatment_id FOREIGN KEY (treatment_id) REFERENCES treatment (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE stock_movement ADD CONSTRAINT fk_stock_movement_purchase_request_id FOREIGN KEY (purchase_request_id) REFERENCES purchase_request (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchase_request ADD CONSTRAINT fk_purchase_request_nomenclature_id FOREIGN KEY (nomenclature_id) REFERENCES nomenclature (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE purchase_request ADD CONSTRAINT fk_purchase_request_requested_by FOREIGN KEY (requested_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE farm_boundary ADD CONSTRAINT fk_farm_boundary_updated_by FOREIGN KEY (updated_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE grazing_event ADD CONSTRAINT fk_grazing_event_group_id FOREIGN KEY (group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE grazing_event ADD CONSTRAINT fk_grazing_event_plot_id FOREIGN KEY (plot_id) REFERENCES pasture_plot (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE grazing_event ADD CONSTRAINT fk_grazing_event_moved_by FOREIGN KEY (moved_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task_series ADD CONSTRAINT fk_task_series_task_type_id FOREIGN KEY (task_type_id) REFERENCES task_type (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task_series ADD CONSTRAINT fk_task_series_uom_id FOREIGN KEY (uom_id) REFERENCES uom (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task_series ADD CONSTRAINT fk_task_series_ration_id FOREIGN KEY (ration_id) REFERENCES ration (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task_series ADD CONSTRAINT fk_task_series_created_by FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task ADD CONSTRAINT fk_task_task_type_id FOREIGN KEY (task_type_id) REFERENCES task_type (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task ADD CONSTRAINT fk_task_series_id FOREIGN KEY (series_id) REFERENCES task_series (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task ADD CONSTRAINT fk_task_plot_id FOREIGN KEY (plot_id) REFERENCES pasture_plot (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task ADD CONSTRAINT fk_task_assigned_to FOREIGN KEY (assigned_to) REFERENCES employee (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task ADD CONSTRAINT fk_task_created_by FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task_animal_group ADD CONSTRAINT fk_task_animal_group_task_id FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE task_animal_group ADD CONSTRAINT fk_task_animal_group_group_id FOREIGN KEY (group_id) REFERENCES animal_group (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE task_status_history ADD CONSTRAINT fk_task_status_history_task_id FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE task_status_history ADD CONSTRAINT fk_task_status_history_changed_by FOREIGN KEY (changed_by) REFERENCES app_user (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE task_execution ADD CONSTRAINT fk_task_execution_task_id FOREIGN KEY (task_id) REFERENCES task (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE task_execution ADD CONSTRAINT fk_task_execution_group_id FOREIGN KEY (group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task_execution ADD CONSTRAINT fk_task_execution_actual_uom_id FOREIGN KEY (actual_uom_id) REFERENCES uom (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE task_execution ADD CONSTRAINT fk_task_execution_executed_by FOREIGN KEY (executed_by) REFERENCES employee (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE product_type ADD CONSTRAINT fk_product_type_uom_id FOREIGN KEY (uom_id) REFERENCES uom (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE production_record ADD CONSTRAINT fk_production_record_animal_id FOREIGN KEY (animal_id) REFERENCES animal (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE production_record ADD CONSTRAINT fk_production_record_group_id FOREIGN KEY (group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE production_record ADD CONSTRAINT fk_production_record_product_type_id FOREIGN KEY (product_type_id) REFERENCES product_type (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE production_record ADD CONSTRAINT fk_production_record_released_by FOREIGN KEY (released_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal_weighing ADD CONSTRAINT fk_animal_weighing_animal_id FOREIGN KEY (animal_id) REFERENCES animal (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal_weighing ADD CONSTRAINT fk_animal_weighing_group_id FOREIGN KEY (group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE animal_weighing ADD CONSTRAINT fk_animal_weighing_weighed_by FOREIGN KEY (weighed_by) REFERENCES employee (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE period_closure ADD CONSTRAINT fk_period_closure_closed_by FOREIGN KEY (closed_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE period_group_cost ADD CONSTRAINT fk_period_group_cost_period_closure_id FOREIGN KEY (period_closure_id) REFERENCES period_closure (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE period_group_cost ADD CONSTRAINT fk_period_group_cost_group_id FOREIGN KEY (group_id) REFERENCES animal_group (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE import_job ADD CONSTRAINT fk_import_job_created_by FOREIGN KEY (created_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE import_error ADD CONSTRAINT fk_import_error_import_job_id FOREIGN KEY (import_job_id) REFERENCES import_job (id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_log_user_id FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE tech_log ADD CONSTRAINT fk_tech_log_admin_user_id FOREIGN KEY (admin_user_id) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE backup_job ADD CONSTRAINT fk_backup_job_initiated_by FOREIGN KEY (initiated_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE restore_job ADD CONSTRAINT fk_restore_job_backup_job_id FOREIGN KEY (backup_job_id) REFERENCES backup_job (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE restore_job ADD CONSTRAINT fk_restore_job_performed_by FOREIGN KEY (performed_by) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE notification ADD CONSTRAINT fk_notification_user_id FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE RESTRICT ON UPDATE CASCADE;
