-- =============================================================================
-- 0009_demo_extra.sql — расширенный демонстрационный набор
--
--   * 12 сотрудников (из них 3 уволенных с причиной) -> 20 всего;
--   * 40 животных (на продаже / продан / падёж / лечение / карантин);
--   * закрепления сотрудников за животными (60 записей);
--   * 4 новых учётных записи (2 заблокированы с причиной);
--   * 15 актуальных задач (часть просрочена);
--   * склад: позиции ниже минимума и с истекающим сроком;
--   * активный выпас и участок, который ещё «не отдохнул».
--
-- Скрипт идемпотентен: повторный запуск не создаёт дублей.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Сотрудники (9…20)
-- ---------------------------------------------------------------------------
INSERT INTO employee (full_name, position_id, phone, hire_date, is_active,
                      dismissed_at, dismissal_reason)
SELECT v.full_name, v.position_id, v.phone, v.hire_date, v.is_active,
       v.dismissed_at, v.dismissal_reason
FROM (VALUES
    ('Захаров Илья Николаевич',      2, '+7-916-000-00-09', DATE '2022-02-14', TRUE,  NULL::date, NULL::text),
    ('Белова Марина Игоревна',       3, '+7-916-000-00-10', DATE '2021-09-01', TRUE,  NULL, NULL),
    ('Орлов Денис Андреевич',        4, '+7-916-000-00-11', DATE '2023-04-03', TRUE,  NULL, NULL),
    ('Фомина Екатерина Львовна',     6, '+7-916-000-00-12', DATE '2024-01-15', TRUE,  NULL, NULL),
    ('Наумов Виктор Степанович',     7, '+7-916-000-00-13', DATE '2020-07-20', TRUE,  NULL, NULL),
    ('Лебедев Артём Олегович',       7, '+7-916-000-00-14', DATE '2023-11-06', TRUE,  NULL, NULL),
    ('Соколова Ирина Павловна',      5, '+7-916-000-00-15', DATE '2022-06-13', TRUE,  NULL, NULL),
    ('Гусев Роман Дмитриевич',       4, '+7-916-000-00-16', DATE '2019-03-11', FALSE,
        DATE '2026-06-30', 'Увольнение по собственному желанию'),
    ('Титова Ольга Викторовна',      6, '+7-916-000-00-17', DATE '2020-10-05', FALSE,
        DATE '2026-09-15', 'Перевод в другое хозяйство'),
    ('Морозов Пётр Сергеевич',       7, '+7-916-000-00-18', DATE '2021-05-24', FALSE,
        DATE '2026-10-01', 'Нарушение трудовой дисциплины'),
    ('Крылов Семён Игоревич',        2, '+7-916-000-00-19', DATE '2024-08-19', TRUE,  NULL, NULL),
    ('Павлова Дарья Алексеевна',     3, '+7-916-000-00-20', DATE '2025-02-10', TRUE,  NULL, NULL)
) AS v(full_name, position_id, phone, hire_date, is_active, dismissed_at, dismissal_reason)
WHERE NOT EXISTS (SELECT 1 FROM employee e WHERE e.full_name = v.full_name);

-- ---------------------------------------------------------------------------
-- 2. Животные (101…140)
-- ---------------------------------------------------------------------------
INSERT INTO animal (inventory_number, breed_id, group_id, birth_date, sex, status, arrival_date)
SELECT 'INV-' || lpad(n::text, 4, '0'),
       (n % 4) + 1,
       CASE WHEN n BETWEEN 101 AND 118 THEN NULL ELSE (n % 4) + 1 END,
       CURRENT_DATE - (300 + (n * 7) % 900),
       CASE WHEN n % 2 = 0 THEN 'F' ELSE 'M' END,
       CASE
           WHEN n BETWEEN 101 AND 110 THEN 'НА_ПРОДАЖЕ'
           WHEN n BETWEEN 111 AND 115 THEN 'ПРОДАН'
           WHEN n BETWEEN 116 AND 118 THEN 'ПАДЁЖ'
           WHEN n BETWEEN 119 AND 124 THEN 'НА_ЛЕЧЕНИИ'
           WHEN n BETWEEN 125 AND 127 THEN 'НА_КАРАНТИНЕ'
           ELSE 'ЗДОРОВ'
       END,
       CURRENT_DATE - (60 + (n * 3) % 500)
FROM generate_series(101, 140) AS n
ON CONFLICT (inventory_number) DO NOTHING;

-- Оформленное выбытие для проданных и павших (без него статус нелегитимен).
INSERT INTO disposal_event (animal_id, reason_id, disposal_type, disposed_at,
                            weight_kg, confirmed_by, confirmed_at, notes)
SELECT a.id, r.id,
       CASE WHEN a.status = 'ПРОДАН' THEN 'SALE' ELSE 'DEATH' END,
       now() - interval '12 days',
       CASE WHEN a.status = 'ПРОДАН' THEN 480.00 ELSE NULL END,
       3, now() - interval '12 days',
       CASE WHEN a.status = 'ПРОДАН' THEN 'Продажа по договору поставки (демо)'
            ELSE 'Падёж, причина подтверждена ветеринарным врачом (демо)' END
FROM animal a
JOIN disposal_reason r
  ON r.code = CASE WHEN a.status = 'ПРОДАН' THEN 'SALE_PLAN' ELSE 'MORT' END
WHERE a.id > 100
  AND a.status IN ('ПРОДАН', 'ПАДЁЖ')
ON CONFLICT (animal_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Закрепление сотрудников за животными (60 записей)
-- ---------------------------------------------------------------------------
INSERT INTO animal_assignment (animal_id, employee_id, role_code, assigned_by, note)
SELECT a.id,
       CASE WHEN a.id % 3 = 0 THEN 3 ELSE 4 END,
       CASE WHEN a.id % 3 = 0 THEN 'VET' ELSE 'HERDSMAN' END,
       1,
       'Плановое закрепление (демо)'
FROM animal a
WHERE NOT a.is_deleted
  AND a.status NOT IN ('ВЫБРАКОВАНО', 'ПАДЁЖ', 'ПРОДАН')
ORDER BY a.id
LIMIT 60
ON CONFLICT (animal_id, employee_id, role_code) WHERE ended_at IS NULL DO NOTHING;

-- Второй ветеринар закреплён за животными на лечении.
INSERT INTO animal_assignment (animal_id, employee_id, role_code, assigned_by, note)
SELECT a.id, e.id, 'VET', 1, 'Наблюдение за лечением (демо)'
FROM animal a
CROSS JOIN employee e
WHERE a.status IN ('НА_ЛЕЧЕНИИ', 'НА_КАРАНТИНЕ')
  AND e.full_name = 'Белова Марина Игоревна'
ORDER BY a.id
LIMIT 10
ON CONFLICT (animal_id, employee_id, role_code) WHERE ended_at IS NULL DO NOTHING;

-- Зоотехник закреплён за молодняком (группа 4).
INSERT INTO animal_assignment (animal_id, employee_id, role_code, assigned_by, note)
SELECT a.id, e.id, 'ZOOTECHNIK', 1, 'Зоотехнический контроль (демо)'
FROM animal a
CROSS JOIN employee e
WHERE a.group_id = 4 AND a.status = 'ЗДОРОВ'
  AND e.full_name = 'Захаров Илья Николаевич'
ORDER BY a.id
LIMIT 10
ON CONFLICT (animal_id, employee_id, role_code) WHERE ended_at IS NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Учётные записи (+4, две заблокированы с причиной)
--    Пароль всех демо-логинов — demo1234 (bcrypt).
-- ---------------------------------------------------------------------------
INSERT INTO app_user (login, password_hash, full_name, role_id, employee_id,
                      is_active, must_change_pw)
SELECT 'vet2', '$2a$10$elNKVjwnRSwx27mqcUqv6OoYEEY/af1nGKDK8X3b.8BebC6zk42n2',
       'Белова Марина Игоревна', r.id,
       (SELECT id FROM employee WHERE full_name = 'Белова Марина Игоревна'),
       TRUE, TRUE
FROM role r WHERE r.code = 'VET'
ON CONFLICT (login) DO NOTHING;

INSERT INTO app_user (login, password_hash, full_name, role_id, employee_id,
                      is_active, must_change_pw)
SELECT 'foreman2', '$2a$10$elNKVjwnRSwx27mqcUqv6OoYEEY/af1nGKDK8X3b.8BebC6zk42n2',
       'Орлов Денис Андреевич', r.id,
       (SELECT id FROM employee WHERE full_name = 'Орлов Денис Андреевич'),
       TRUE, TRUE
FROM role r WHERE r.code = 'FOREMAN'
ON CONFLICT (login) DO NOTHING;

INSERT INTO app_user (login, password_hash, full_name, role_id, employee_id,
                      is_active, must_change_pw)
SELECT 'storekeeper2', '$2a$10$elNKVjwnRSwx27mqcUqv6OoYEEY/af1nGKDK8X3b.8BebC6zk42n2',
       'Соколова Ирина Павловна', r.id,
       (SELECT id FROM employee WHERE full_name = 'Соколова Ирина Павловна'),
       TRUE, TRUE
FROM role r WHERE r.code = 'STOREKEEPER'
ON CONFLICT (login) DO NOTHING;

-- Заблокированные учётные записи: блокировка всегда с причиной.
INSERT INTO app_user (login, password_hash, full_name, role_id, employee_id,
                      is_active, must_change_pw, blocked_reason, blocked_at, blocked_by)
SELECT 'dba2', '$2a$10$elNKVjwnRSwx27mqcUqv6OoYEEY/af1nGKDK8X3b.8BebC6zk42n2',
       'Оператор БД (техн., резерв)', r.id, NULL, FALSE, FALSE,
       'Доступ приостановлен: резервная учётная запись не используется',
       now() - interval '5 days', 1
FROM role r WHERE r.code = 'DBA'
ON CONFLICT (login) DO NOTHING;

INSERT INTO app_user (login, password_hash, full_name, role_id, employee_id,
                      is_active, must_change_pw, blocked_reason, blocked_at, blocked_by)
SELECT 'temp.operator', '$2a$10$elNKVjwnRSwx27mqcUqv6OoYEEY/af1nGKDK8X3b.8BebC6zk42n2',
       'Временный оператор (архив)', r.id,
       (SELECT id FROM employee WHERE full_name = 'Павлова Дарья Алексеевна'),
       FALSE, FALSE,
       'Учётная запись уволенного сотрудника: доступ отозван',
       now() - interval '20 days', 1
FROM role r WHERE r.code = 'FOREMAN'
ON CONFLICT (login) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Актуальные задачи (+15, часть просрочена)
-- ---------------------------------------------------------------------------
INSERT INTO task (task_type_id, title, plot_id, assigned_to, planned_date, due_at,
                  priority, status, created_by)
SELECT v.task_type_id, v.title, v.plot_id, e.id,
       v.planned_date, v.due_at, v.priority, v.status, 1
FROM (VALUES
    (1, 'Раздать силос: группа 1',            1, 'Сидоров Пётр Алексеевич',     CURRENT_DATE,        now() + interval '6 hours',  'NORMAL', 'NEW'),
    (1, 'Раздать силос: группа 2',            2, 'Орлов Денис Андреевич',       CURRENT_DATE,        now() + interval '7 hours',  'NORMAL', 'IN_WORK'),
    (1, 'Проверить остаток концентрата',    NULL, 'Соколова Ирина Павловна',     CURRENT_DATE,        now() - interval '2 days',   'HIGH',   'NEW'),
    (2, 'Перегнать группу 4 на загон №5',     5, 'Сидоров Пётр Алексеевич',     CURRENT_DATE,        now() + interval '1 day',    'HIGH',   'IN_WORK'),
    (2, 'Осмотреть состояние травостоя P-07', 7, 'Орлов Денис Андреевич',       CURRENT_DATE + 1,    now() + interval '2 days',   'LOW',    'NEW'),
    (3, 'Чистка поилок: коровник 1',        NULL, 'Фомина Екатерина Львовна',    CURRENT_DATE,        now() + interval '4 hours',  'NORMAL', 'NEW'),
    (3, 'Чистка поилок: коровник 2',        NULL, 'Фомина Екатерина Львовна',    CURRENT_DATE,        now() + interval '5 hours',  'NORMAL', 'NEW'),
    (4, 'Обработать животных на лечении',   NULL, 'Белова Марина Игоревна',      CURRENT_DATE,        now() + interval '3 hours',  'HIGH',   'IN_WORK'),
    (4, 'Вакцинация молодняка (группа 4)',  NULL, 'Мельникова Анна Петровна',    CURRENT_DATE + 2,    now() + interval '3 days',   'HIGH',   'NEW'),
    (4, 'Взять пробы на исследования',      NULL, 'Павлова Дарья Алексеевна',    CURRENT_DATE + 1,    now() + interval '2 days',   'NORMAL', 'NEW'),
    (5, 'Инвентаризация ветаптеки',         NULL, 'Соколова Ирина Павловна',     CURRENT_DATE + 3,    now() + interval '4 days',   'NORMAL', 'NEW'),
    (5, 'Сверить накладные поставщика',     NULL, 'Соколова Ирина Павловна',     CURRENT_DATE - 1,    now() - interval '1 day',    'NORMAL', 'NEW'),
    (1, 'Заготовка сена: участок P-07',        7, 'Наумов Виктор Степанович',    CURRENT_DATE + 2,    now() + interval '3 days',   'NORMAL', 'NEW'),
    (1, 'Заготовка сена: участок P-08',        8, 'Лебедев Артём Олегович',      CURRENT_DATE + 3,    now() + interval '4 days',   'LOW',    'NEW'),
    (3, 'Ремонт изгороди загона №6',           6, 'Лебедев Артём Олегович',      CURRENT_DATE - 2,    now() - interval '2 days',   'HIGH',   'NEW')
) AS v(task_type_id, title, plot_id, assignee, planned_date, due_at, priority, status)
JOIN employee e ON e.full_name = v.assignee
WHERE NOT EXISTS (SELECT 1 FROM task t WHERE t.title = v.title);

-- ---------------------------------------------------------------------------
-- 6. Склад: ниже минимума и с истекающим сроком
-- ---------------------------------------------------------------------------
-- ВАЖНО: initial_qty остаётся 0, а приход оформляется движением RECEIPT.
-- Так же устроены демо-партии из baseline: v_stock_balance_check считает
-- расчётный остаток как initial_qty + движения, поэтому дублировать объём
-- в обеих колонках нельзя (иначе остаток удваивается).
WITH v (nomenclature_id, warehouse_id, supplier_id, batch_number,
        received_at, expiry_date, unit_cost, qty) AS (
    VALUES
        (3,  1, 1, 'DEMO-LOW-001', now() - interval '20 days', NULL,               18.50,  120),
        (5,  2, 2, 'DEMO-LOW-002', now() - interval '40 days', CURRENT_DATE + 45,  320.00, 0.4),
        (7,  2, 2, 'DEMO-LOW-003', now() - interval '30 days', CURRENT_DATE + 20,  95.00,  12),
        (10, 2, 2, 'DEMO-LOW-004', now() - interval '15 days', CURRENT_DATE + 300, 12.00,  8),
        (5,  2, 2, 'DEMO-EXP-001', now() - interval '10 days', CURRENT_DATE + 7,   420.00, 8),
        (6,  2, 2, 'DEMO-EXP-002', now() - interval '12 days', CURRENT_DATE + 14,  90.00,  5),
        (7,  2, 2, 'DEMO-EXP-003', now() - interval '8 days',  CURRENT_DATE + 21,  1250.00, 90),
        (8,  2, 2, 'DEMO-EXP-004', now() - interval '6 days',  CURRENT_DATE + 25,  1300.00, 70),
        (2,  1, 1, 'DEMO-EXP-005', now() - interval '5 days',  CURRENT_DATE + 28,  4200.00, 3500)
), b AS (
    INSERT INTO stock_batch (nomenclature_id, warehouse_id, supplier_id, batch_number,
                             received_at, expiry_date, unit_cost, initial_qty)
    SELECT v.nomenclature_id, v.warehouse_id, v.supplier_id, v.batch_number,
           v.received_at, v.expiry_date, v.unit_cost, 0
    FROM v
    ON CONFLICT (nomenclature_id, warehouse_id, batch_number) DO NOTHING
    RETURNING id, batch_number
)
INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at,
                            created_by, comment)
SELECT 1, b.id, v.qty, n.uom_id, v.received_at, 1,
       'Демо: начальный остаток партии'
FROM b
JOIN v ON v.batch_number = b.batch_number
JOIN nomenclature n ON n.id = v.nomenclature_id;

-- ---------------------------------------------------------------------------
-- 7. Выпас
--    Активные события уже созданы базовым демо-набором (группы 1, 2, 3, 5).
--    Участки №5…№8 освободились 2026-11-08, поэтому по правилу отдыха
--    (20 дней) новый перевод на них до 2026-11-28 запрещён — это и есть
--    демонстрация контроля периода отдыха. Ничего не добавляем.
-- ---------------------------------------------------------------------------
