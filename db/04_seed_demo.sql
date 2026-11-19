-- =============================================================================
-- Файл 04_seed_demo.sql: демо/тестовые данные.
-- Выполнять последним, ПОСЛЕ 03_functions_triggers.sql.
-- Демо-доступ: логины director/superuser/dba/vet/foreman/storekeeper,
-- пароль demo1234 (bcrypt-хэш зафиксирован ниже).
-- Объём: ~100 голов, 5 групп, 8 участков (~70 га), 2 года истории
-- (~10k задач, ~30k движений склада) — для демонстрации и нагрузочных замеров.
-- =============================================================================

-- ============================ 1. Роли и права ===============================

INSERT INTO role (code, name, role_type) VALUES
 ('DIRECTOR','Директор','BUSINESS'),
 ('SUPERUSER','Суперпользователь','TECHNICAL'),
 ('DBA','Администратор БД','TECHNICAL'),
 ('VET','Зоотехник/ветеринар','BUSINESS'),
 ('FOREMAN','Бригадир','BUSINESS'),
 ('STOREKEEPER','Кладовщик','BUSINESS');

INSERT INTO permission (code, object_name, action, description) VALUES
 ('animal:READ','animal','READ','Просмотр реестра животных'),
 ('animal:WRITE','animal','WRITE','Изменение карточек животных'),
 ('animal:DELETE','animal','DELETE','Удаление карточек животных'),
 ('group:READ','group','READ','Просмотр групп'),
 ('group:WRITE','group','WRITE','Управление группами'),
 ('health:READ','health','READ','Просмотр осмотров/вакцинаций/лечений'),
 ('health:WRITE','health','WRITE','Регистрация осмотров и назначения'),
 ('health:DELETE','health','DELETE','Удаление записей здоровья'),
 ('disposal:READ','disposal','READ','Просмотр выбытий'),
 ('disposal:WRITE','disposal','WRITE','Оформление выбраковки/падежа'),
 ('ration:READ','ration','READ','Просмотр рационов'),
 ('ration:WRITE','ration','WRITE','Редактирование рационов'),
 ('stock:READ','stock','READ','Просмотр склада и остатков'),
 ('stock:WRITE','stock','WRITE','Приход/расход/возврат по складу'),
 ('stock:DELETE','stock','DELETE','Списание материалов'),
 ('purchase:READ','purchase','READ','Просмотр заявок на закупку'),
 ('purchase:WRITE','purchase','WRITE','Работа с заявками'),
 ('pasture:READ','pasture','READ','Просмотр участков и выпаса'),
 ('pasture:WRITE','pasture','WRITE','Назначение выпаса'),
 ('task:READ','task','READ','Просмотр задач'),
 ('task:WRITE','task','WRITE','Создание/выполнение задач'),
 ('task:DELETE','task','DELETE','Отмена/удаление задач'),
 ('product:READ','product','READ','Просмотр продукции и взвешиваний'),
 ('product:WRITE','product','WRITE','Учёт продукции и взвешиваний'),
 ('period:READ','period','READ','Просмотр периодов и себестоимости'),
 ('period:EXEC','period','EXEC','Закрытие периода (месяца)'),
 ('report:READ','report','READ','Доступ к отчётам и дашбордам'),
 ('import:EXEC','import','EXEC','Импорт данных'),
 ('export:EXEC','export','EXEC','Экспорт данных в CSV/PDF'),
 ('user:READ','user','READ','Просмотр пользователей'),
 ('user:WRITE','user','WRITE','Управление пользователями и ролями'),
 ('settings:READ','settings','READ','Просмотр настроек'),
 ('settings:WRITE','settings','WRITE','Изменение настроек хозяйства'),
 ('audit:READ','audit','READ','Просмотр журнала аудита'),
 ('tech:READ','tech','READ','Технический контур: просмотр'),
 ('tech:EXEC','tech','EXEC','Бэкапы/миграции/восстановление');

-- Неделя 6: выделенные права справочников, персонала и резервного копирования.
-- Технические роли изолированы от бизнес-операций: DBA получает ТОЛЬКО чтение
-- справочников/персонала и управление бэкапами, но не запись в бизнес-реестры.
INSERT INTO permission (code, object_name, action, description) VALUES
 ('catalog:READ','catalog','READ','Просмотр справочников'),
 ('catalog:WRITE','catalog','WRITE','Изменение справочников'),
 ('employee:READ','employee','READ','Просмотр сотрудников и должностей'),
 ('employee:WRITE','employee','WRITE','Управление сотрудниками и должностями'),
 ('backup:READ','backup','READ','Просмотр резервных копий и восстановлений'),
 ('backup:EXEC','backup','EXEC','Запуск резервного копирования и восстановления');

-- Администратор БД (расширение): миграции схемы и мониторинг производительности.
-- Отдельный namespace dba:* (не tech:*), чтобы расширение жило независимо
-- от прав Недели 6. Доступ — только у TECHNICAL-ролей.
INSERT INTO permission (code, object_name, action, description) VALUES
 ('dba:READ','dba','READ','Админ БД: миграции, бэкапы, мониторинг — просмотр'),
 ('dba:EXEC','dba','EXEC','Админ БД: применение миграций, откат, обслуживание');

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
JOIN (VALUES
 ('DIRECTOR', ARRAY['animal:READ','group:READ','health:READ','disposal:READ','ration:READ',
                     'stock:READ','purchase:READ','pasture:READ','pasture:WRITE','task:READ','product:READ',
                     'period:READ','period:EXEC','report:READ','export:EXEC',
                     'user:READ','user:WRITE','settings:READ','settings:WRITE','audit:READ',
                     'catalog:READ','catalog:WRITE','employee:READ','employee:WRITE','backup:READ']),
 ('SUPERUSER', ARRAY['animal:READ','animal:WRITE','animal:DELETE','group:READ','group:WRITE',
                     'health:READ','health:WRITE','health:DELETE','disposal:READ','disposal:WRITE',
                     'ration:READ','ration:WRITE','stock:READ','stock:WRITE','stock:DELETE',
                     'purchase:READ','purchase:WRITE','pasture:READ','pasture:WRITE',
                     'task:READ','task:WRITE','task:DELETE','product:READ','product:WRITE',
                     'period:READ','period:EXEC','report:READ','import:EXEC','export:EXEC',
                     'user:READ','user:WRITE','settings:READ','settings:WRITE','audit:READ',
                     'tech:READ','tech:EXEC',
                     'catalog:READ','catalog:WRITE','employee:READ','employee:WRITE',
                     'backup:READ','backup:EXEC']),
 ('DBA', ARRAY['tech:READ','tech:EXEC','audit:READ','settings:READ','user:READ','report:READ',
               'catalog:READ','employee:READ','backup:READ','backup:EXEC',
               'dba:READ','dba:EXEC']),
 ('VET', ARRAY['animal:READ','animal:WRITE','group:READ','group:WRITE',
               'health:READ','health:WRITE','health:DELETE','disposal:READ','disposal:WRITE',
               'ration:READ','ration:WRITE','stock:READ','task:READ','task:WRITE',
               'product:READ','product:WRITE','report:READ','export:EXEC',
               'catalog:READ','employee:READ']),
 ('FOREMAN', ARRAY['animal:READ','group:READ','health:READ','ration:READ',
                   'stock:READ','stock:WRITE','pasture:READ','pasture:WRITE',
                   'task:READ','task:WRITE','task:DELETE','product:WRITE','report:READ',
                   'catalog:READ','employee:READ']),
 ('STOREKEEPER', ARRAY['stock:READ','stock:WRITE','stock:DELETE','purchase:READ','purchase:WRITE',
                       'ration:READ','task:READ','report:READ','export:EXEC','settings:READ',
                       'catalog:READ','employee:READ'])
) AS g(role_code, perms) ON g.role_code = r.code
JOIN permission p ON p.code = ANY (g.perms);

-- ========================= 2. Персонал и должности ==========================

INSERT INTO position (code, name) VALUES
 ('DIR','Директор'),
 ('ZOOT','Зоотехник'),
 ('VET','Ветеринарный врач'),
 ('FRM','Бригадир'),
 ('STR','Кладовщик'),
 ('MILK','Доярка'),
 ('TRK','Тракторист-механизатор');

INSERT INTO employee (full_name, position_id, phone, hire_date) VALUES
 ('Бортников Артём Павлович',   (SELECT id FROM position WHERE code='DIR'),  '+7-916-000-00-01', '2019-03-01'),
 ('Ковалёв Сергей Иванович',    (SELECT id FROM position WHERE code='ZOOT'), '+7-916-000-00-02', '2020-05-12'),
 ('Мельникова Анна Петровна',   (SELECT id FROM position WHERE code='VET'),  '+7-916-000-00-03', '2021-01-20'),
 ('Сидоров Пётр Алексеевич',    (SELECT id FROM position WHERE code='FRM'),  '+7-916-000-00-04', '2018-08-15'),
 ('Гаврилова Ольга Николаевна', (SELECT id FROM position WHERE code='STR'),  '+7-916-000-00-05', '2022-02-01'),
 ('Ткачук Игорь Валерьевич',   (SELECT id FROM position WHERE code='TRK'),  '+7-916-000-00-06', '2020-09-10'),
 ('Романова Татьяна Сергеевна', (SELECT id FROM position WHERE code='MILK'), '+7-916-000-00-07', '2021-06-05'),
 ('Кузнецов Алексей Викторович',(SELECT id FROM position WHERE code='TRK'),  '+7-916-000-00-08', '2023-04-17');

-- ========================= 3. Справочники предметной области =================

INSERT INTO species (code, name) VALUES ('CATTLE','КРС');

INSERT INTO breed (species_id, name, avg_daily_gain) VALUES
 ((SELECT id FROM species WHERE code='CATTLE'), 'Чёрно-пёстрая',     0.800),
 ((SELECT id FROM species WHERE code='CATTLE'), 'Голландская',      0.900),
 ((SELECT id FROM species WHERE code='CATTLE'), 'Симментальская',   1.000),
 ((SELECT id FROM species WHERE code='CATTLE'), 'Айрширская',       0.750);

INSERT INTO uom (code, name, uom_type) VALUES
 ('KG','килограмм','MASS'), ('L','литр','VOLUME'),
 ('PC','штука','COUNT'), ('G','грамм','MASS');

INSERT INTO uom_conversion (from_uom_id, to_uom_id, factor) VALUES
 ((SELECT id FROM uom WHERE code='KG'), (SELECT id FROM uom WHERE code='G'), 1000),
 ((SELECT id FROM uom WHERE code='G'),  (SELECT id FROM uom WHERE code='KG'), 0.001);

INSERT INTO movement_type (code, name, direction) VALUES
 ('RECEIPT','Приход','IN'), ('ISSUE','Расход','OUT'),
 ('WRITE_OFF','Списание','OUT'), ('RETURN','Возврат','IN');

INSERT INTO write_off_reason (code, name) VALUES
 ('SPOILAGE','Порча/истечение срока годности'),
 ('LOSS','Недостача'),
 ('OTHER','Прочее');

INSERT INTO diagnosis (code, name, category) VALUES
 ('MAST','Мастит','Воспалительные'),
 ('LAM','Хромота (ламинит)','Опорно-двигательные'),
 ('RES','Респираторное заболевание','Инфекционные'),
 ('PAR','Паразитарная инвазия','Паразитарные'),
 ('DIG','Желудочно-кишечное расстройство','Пищеварительные'),
 ('TRM','Травма','Травмы'),
 ('NUT','Гипотрофия','Обменные'),
 ('TRN','Отравление','Токсикологические');

INSERT INTO disposal_reason (code, name, reason_type) VALUES
 ('LOW_PROD','Низкая продуктивность','CULLING'),
 ('DISEASE','Выбытие по заключению врача','CULLING'),
 ('MORT','Падёж','DEATH'),
 ('TRAUMA','Падёж вследствие травмы','DEATH');

INSERT INTO task_type (code, name, requires_writeoff, default_priority) VALUES
 ('FEEDING','Кормление', TRUE, 1),
 ('GRAZING','Выпас', FALSE, 2),
 ('CARE','Уход и чистка', FALSE, 3),
 ('TREATMENT','Лечение', TRUE, 1),
 ('OTHER','Прочее', FALSE, 5);

INSERT INTO product_type (code, name, uom_id) VALUES
 ('MILK','Молоко', (SELECT id FROM uom WHERE code='L')),
 ('GAIN','Прирост массы', (SELECT id FROM uom WHERE code='KG'));

INSERT INTO warehouse (code, name, is_active) VALUES
 ('WH1','Кормовой склад', TRUE),
 ('WH2','Ветаптека', TRUE);

INSERT INTO supplier (name, contact_person, phone, email) VALUES
 ('ООО «Агрокорм-Юг»', 'Иванов И.И.', '+7-495-111-22-33', 'sales@agrokorm.example'),
 ('АО «Ветфарм-Центр»', 'Петрова А.С.', '+7-495-222-33-44', 'info@vetfarm.example'),
 ('ИП Смирнов К.А.', 'Смирнов К.А.', '+7-903-444-55-66', 'smirnov@example');

-- ==================== 4. Номенклатура, препараты, графики ====================

INSERT INTO nomenclature (sku, name, category, uom_id, min_threshold, shelf_life_days) VALUES
 ('FEED-001','Силос кукурузный',            'FEED',     (SELECT id FROM uom WHERE code='KG'), 5000, 180),
 ('FEED-002','Сено луговое',                'FEED',     (SELECT id FROM uom WHERE code='KG'), 3000, 365),
 ('FEED-003','Концентрат КК-100',           'FEED',     (SELECT id FROM uom WHERE code='KG'), 2000, 180),
 ('FEED-004','Премикс витаминный П-2',      'FEED',     (SELECT id FROM uom WHERE code='KG'),  500, 365),
 ('DRUG-001','Окситетрацилин 10%',          'DRUG',     (SELECT id FROM uom WHERE code='L'),     1, 730),
 ('DRUG-002','Новокаин 0,5%',               'DRUG',     (SELECT id FROM uom WHERE code='L'),     1, 540),
 ('VACC-001','Вакцина против бруцеллёза',   'VACCINE',  (SELECT id FROM uom WHERE code='PC'),   50, 540),
 ('VACC-002','Вакцина против ящура',        'VACCINE',  (SELECT id FROM uom WHERE code='PC'),   50, 730),
 ('INV-001','Ведро ёмкостью 12 л',          'INVENTORY',(SELECT id FROM uom WHERE code='PC'),    5, NULL),
 ('INV-002','Шприц одноразовый 20 мл',      'INVENTORY',(SELECT id FROM uom WHERE code='PC'),   20, 1095),
 ('INV-003','Ошейник идентификационный',    'INVENTORY',(SELECT id FROM uom WHERE code='PC'),   30, NULL),
 ('INV-004','Скоба ушная',                  'INVENTORY',(SELECT id FROM uom WHERE code='PC'),   50, NULL);

INSERT INTO drug (nomenclature_id, withdrawal_days, withdrawal_milk_days, is_vaccine, storage_note)
SELECT id,
       CASE sku WHEN 'DRUG-001' THEN 20 WHEN 'DRUG-002' THEN 10 ELSE 0 END,
       CASE sku WHEN 'DRUG-001' THEN 10 WHEN 'DRUG-002' THEN  5 ELSE 0 END,
       category = 'VACCINE',
       CASE WHEN category = 'VACCINE' THEN 'Хранить при +2..+8' ELSE 'Хранить при комнатной температуре' END
FROM nomenclature WHERE category IN ('DRUG','VACCINE');

INSERT INTO vaccination_schedule (species_id, nomenclature_id, periodicity_days, first_age_days, is_active)
SELECT (SELECT id FROM species WHERE code='CATTLE'), n.id, 365,
       CASE n.sku WHEN 'VACC-001' THEN 120 ELSE 90 END, TRUE
FROM nomenclature n WHERE n.sku IN ('VACC-001','VACC-002');

-- ========================= 5. Пользователи и сессии =========================

INSERT INTO app_user (login, password_hash, full_name, role_id, employee_id, must_change_pw, last_login_at)
SELECT u.login,
       '$2a$10$elNKVjwnRSwx27mqcUqv6OoYEEY/af1nGKDK8X3b.8BebC6zk42n2',
       u.full_name, r.id, e.id, FALSE,
       now() - ((u.n * 3) || ' days')::interval
FROM (VALUES
  ('director',    'Бортников Артём Павлович',    'DIRECTOR',   'Бортников Артём Павлович',   1),
  ('superuser',   'Суперпользователь (техн.)',   'SUPERUSER',  NULL,                          2),
  ('dba',         'Администратор БД (техн.)',    'DBA',        NULL,                          3),
  ('vet',         'Мельникова Анна Петровна',    'VET',        'Мельникова Анна Петровна',    4),
  ('foreman',     'Сидоров Пётр Алексеевич',     'FOREMAN',    'Сидоров Пётр Алексеевич',     5),
  ('storekeeper', 'Гаврилова Ольга Николаевна',  'STOREKEEPER','Гаврилова Ольга Николаевна',  6)
) AS u(login, full_name, role_code, emp_name, n)
JOIN role r ON r.code = u.role_code
LEFT JOIN employee e ON e.full_name = u.emp_name;

INSERT INTO user_session (user_id, token_hash, ip, user_agent, issued_at, expires_at)
SELECT id, md5(login || ':session'), ('192.168.1.' || (20 + id))::inet,
       'demo-client', now() - interval '1 hour', now() + interval '7 days'
FROM app_user;

INSERT INTO saved_filter (user_id, registry_code, name, filter_json, is_default)
SELECT id, 'animals', 'Больные и на лечении',
       '{"status":["НА_ЛЕЧЕНИИ","НА_КАРАНТИНЕ"]}'::jsonb, TRUE
FROM app_user WHERE login = 'vet';

INSERT INTO saved_filter (user_id, registry_code, name, filter_json, is_default)
SELECT id, 'tasks', 'Мои просроченные задачи', '{"overdue":true}'::jsonb, TRUE
FROM app_user WHERE login = 'foreman';

INSERT INTO saved_filter (user_id, registry_code, name, filter_json, is_default)
SELECT id, 'stock', 'Остатки ниже порога', '{"below_threshold":true}'::jsonb, TRUE
FROM app_user WHERE login = 'storekeeper';

INSERT INTO saved_filter (user_id, registry_code, name, filter_json, is_default)
SELECT id, 'vaccinations', 'Просрочка вакцинации', '{"overdue":true}'::jsonb, FALSE
FROM app_user WHERE login = 'vet';

-- ===================== 6. Группы и поголовье (100 голов) ====================

INSERT INTO animal_group (name, species_id) VALUES
 ('КРС-1 (дойные)',      (SELECT id FROM species WHERE code='CATTLE')),
 ('КРС-2 (дойные)',      (SELECT id FROM species WHERE code='CATTLE')),
 ('КРС-3 (сухостой)',    (SELECT id FROM species WHERE code='CATTLE')),
 ('Телята до 6 мес',     (SELECT id FROM species WHERE code='CATTLE')),
 ('Быки-откорм',         (SELECT id FROM species WHERE code='CATTLE'));

DO $$
DECLARE
  v_g int[] := ARRAY(SELECT id FROM animal_group ORDER BY id);
  v_br int[] := ARRAY(SELECT id FROM breed ORDER BY id);
  v_foreman int;
  i int; gi int; v_sex char(1); v_status text; v_birth date; v_group int;
BEGIN
  SELECT id INTO v_foreman FROM app_user WHERE login = 'foreman';

  FOR i IN 1..100 LOOP
    gi := CASE WHEN i <= 30 THEN 1 WHEN i <= 60 THEN 2
               WHEN i <= 75 THEN 3 WHEN i <= 90 THEN 4 ELSE 5 END;
    v_group := v_g[gi];
    v_sex := CASE WHEN gi IN (1,2,3) THEN 'F'
                  WHEN gi = 5 THEN 'M'
                  ELSE CASE WHEN i % 2 = 0 THEN 'M' ELSE 'F' END END;
    v_status := 'ЗДОРОВ';
    IF i IN (7, 18, 55) THEN v_status := 'НА_ЛЕЧЕНИИ';
    ELSIF i IN (23, 61) THEN v_status := 'НА_КАРАНТИНЕ';
    ELSIF i = 34 THEN v_status := 'НА_ОСМОТРЕ';
    ELSIF i = 97 THEN v_status := 'ВЫБРАКОВАНО';
    ELSIF i = 99 THEN v_status := 'ПАДЁЖ';
    END IF;
    v_birth := current_date - (120 + ((i * 17) % 1080));

    INSERT INTO animal (inventory_number, breed_id, group_id, birth_date, sex, status, arrival_date)
    VALUES ('INV-' || lpad(i::text, 4, '0'),
            v_br[1 + (i % 4)], v_group, v_birth, v_sex, v_status,
            v_birth + ((i % 60) || ' days')::interval);
  END LOOP;

  -- Журнал переводов (для части поголовья, дата в прошлом)
  FOR i IN 3..100 BY 3 LOOP
    CONTINUE WHEN 120 + ((i * 17) % 1080) <= 320;
    INSERT INTO animal_group_history (animal_id, from_group_id, to_group_id, moved_at, reason, moved_by)
    SELECT a.id, NULL, a.group_id,
           a.birth_date + interval '300 days',
           'Перевод по зоотехническому плану', v_foreman
    FROM animal a WHERE a.inventory_number = 'INV-' || lpad(i::text, 4, '0');
  END LOOP;
END $$;

-- Выбраковка и падёж (животные уже имеют статус ВЫБРАКОВАНО/ПАДЁЖ)
INSERT INTO disposal_event (animal_id, reason_id, disposal_type, disposed_at, weight_kg, confirmed_by, confirmed_at, notes)
SELECT a.id, r.id, r.reason_type, current_date - 15, 512.00, e.id, current_date - 15,
       'Выбытие по решению комиссии (демо)'
FROM animal a
JOIN disposal_reason r ON r.code = 'LOW_PROD'
JOIN employee e ON e.full_name = 'Мельникова Анна Петровна'
WHERE a.inventory_number = 'INV-0097';

INSERT INTO disposal_event (animal_id, reason_id, disposal_type, disposed_at, weight_kg, confirmed_by, confirmed_at, notes)
SELECT a.id, r.id, r.reason_type, current_date - 40, 85.00, e.id, current_date - 40,
       'Падёж вследствие травмы (демо)'
FROM animal a
JOIN disposal_reason r ON r.code = 'TRAUMA'
JOIN employee e ON e.full_name = 'Мельникова Анна Петровна'
WHERE a.inventory_number = 'INV-0099';

-- ============================ 7. Рационы ====================================

INSERT INTO ration (group_id, valid_from, valid_to, is_active)
SELECT g.id, DATE '2024-01-01', NULL, TRUE FROM animal_group g;

INSERT INTO ration_item (ration_id, nomenclature_id, norm_amount, uom_id, freq_per_day)
SELECT r.ration_id, n.id,
       CASE n.sku WHEN 'FEED-001' THEN 4.000 WHEN 'FEED-002' THEN 3.000
                  WHEN 'FEED-003' THEN 2.500 ELSE 0.500 END,
       (SELECT id FROM uom WHERE code='KG'), 2
FROM (SELECT id AS ration_id, group_id FROM ration) r
JOIN animal_group g ON g.id = r.group_id
JOIN nomenclature n ON n.category = 'FEED'
ORDER BY r.ration_id, n.sku;

-- ============ 8. Склад: партии, остатки, приходы (2 года истории) ===========

-- Помесячные партии кормов/препаратов/вакцин
INSERT INTO stock_batch (nomenclature_id, warehouse_id, supplier_id, batch_number, received_at, expiry_date, unit_cost, initial_qty)
SELECT n.id,
       (SELECT id FROM warehouse WHERE code = CASE WHEN n.category IN ('DRUG','VACCINE') THEN 'WH2' ELSE 'WH1' END),
       (SELECT id FROM supplier ORDER BY id OFFSET (n.id % 3) LIMIT 1),
       n.sku || '-' || to_char(m, 'YYYYMM'),
       m,
       CASE WHEN n.shelf_life_days IS NOT NULL THEN (m + make_interval(days => n.shelf_life_days))::date END,
       CASE n.sku WHEN 'FEED-001' THEN 8.00 WHEN 'FEED-002' THEN 12.00
                  WHEN 'FEED-003' THEN 25.00 WHEN 'FEED-004' THEN 120.00
                  WHEN 'DRUG-001' THEN 850.00 WHEN 'DRUG-002' THEN 320.00
                  WHEN 'VACC-001' THEN 95.00 ELSE 140.00 END,
       0
FROM nomenclature n
CROSS JOIN LATERAL generate_series(date_trunc('month', current_date - 730) - interval '1 month',
                                   current_date, interval '1 month') m
WHERE n.category IN ('FEED','DRUG','VACCINE');

-- Разовые партии инвентаря
INSERT INTO stock_batch (nomenclature_id, warehouse_id, supplier_id, batch_number, received_at, unit_cost, initial_qty)
SELECT n.id, w.id, (SELECT id FROM supplier ORDER BY id LIMIT 1),
       n.sku || '-OPEN', (date_trunc('month', current_date - 730) - interval '1 month')::date,
       CASE n.sku WHEN 'INV-001' THEN 180.00 WHEN 'INV-002' THEN 45.00
                  WHEN 'INV-003' THEN 60.00 ELSE 25.00 END,
       0
FROM nomenclature n, warehouse w
WHERE n.category = 'INVENTORY' AND w.code = 'WH1';

-- Партии с начальным остатком (остаток на начало учёта)
INSERT INTO stock_batch (nomenclature_id, warehouse_id, supplier_id, batch_number, received_at, unit_cost, initial_qty)
SELECT n.id, w.id, (SELECT id FROM supplier ORDER BY id LIMIT 1),
       n.sku || '-BASE', (date_trunc('month', current_date - 730) - interval '2 month')::date,
       CASE n.sku WHEN 'FEED-001' THEN 9.00 ELSE 13.00 END,
       CASE n.sku WHEN 'FEED-001' THEN 5000.000 ELSE 3000.000 END
FROM nomenclature n, warehouse w
WHERE n.sku IN ('FEED-001','FEED-002') AND w.code = 'WH1';

INSERT INTO stock_balance (batch_id, qty_on_hand)
SELECT id, initial_qty FROM stock_batch WHERE batch_number LIKE '%-BASE';

-- Приходы по накладным (на все партии с initial_qty = 0)
INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at, created_by, comment)
SELECT (SELECT id FROM movement_type WHERE code='RECEIPT'),
       b.id,
       CASE n.sku WHEN 'FEED-001' THEN 14000.000 WHEN 'FEED-002' THEN 10000.000
                  WHEN 'FEED-003' THEN  8500.000 WHEN 'FEED-004' THEN  1800.000
                  WHEN 'DRUG-001' THEN     5.000 WHEN 'DRUG-002' THEN     5.000
                  WHEN 'VACC-001' THEN    50.000 WHEN 'VACC-002' THEN    50.000
                  WHEN 'INV-001' THEN   500.000 WHEN 'INV-002' THEN   400.000
                  WHEN 'INV-003' THEN   300.000 ELSE 600.000 END,
       n.uom_id, b.received_at,
       (SELECT id FROM app_user WHERE login = 'storekeeper'),
       'Приход по накладной (демо)'
FROM stock_batch b
JOIN nomenclature n ON n.id = b.nomenclature_id
WHERE b.initial_qty = 0;

-- ====================== 9. Границы, участки, выпас ==========================

INSERT INTO farm_boundary (id, farm_name, geom, updated_by)
VALUES (1, 'Заречное',
        ST_GeomFromText('POLYGON((37.600 55.750, 37.620 55.750, 37.620 55.755, 37.600 55.755, 37.600 55.750))', 4326),
        (SELECT id FROM app_user WHERE login = 'director'));

INSERT INTO pasture_plot (plot_no, name, geom, vegetation_type, max_head_per_ha, rest_days_required)
SELECT 'P-' || lpad(n::text, 2, '0'),
       CASE WHEN n <= 6 THEN 'Загон №' || n ELSE 'Луговой участок ' || n END,
       ST_MakeEnvelope(
           37.600 + ((n - 1) % 4) * 0.005,
           55.750 + ((n - 1) / 4) * 0.0025,
           37.600 + ((n - 1) % 4) * 0.005 + 0.005,
           55.750 + ((n - 1) / 4) * 0.0025 + 0.0025,
           4326),
       CASE WHEN n <= 6 THEN 'культурное' ELSE 'естественное' END,
       CASE WHEN n <= 6 THEN 3.500 ELSE 1.000 END,
       20
FROM generate_series(1, 8) n;

-- История выпаса: 4 группы на выпасе («Телята до 6 мес» — в помещении),
-- стойка 30 дней, два набора по 4 участка: пока одна половина занята,
-- другая отдыхает 30 дней (> 20 по умолчанию). 24 завершённых цикла + текущий.
WITH gs AS (
    SELECT g.id,
           row_number() OVER (ORDER BY g.id) - 1 AS gi,
           COALESCE(h.head_count, 20) AS heads
    FROM animal_group g
    LEFT JOIN v_animal_group_head_count h ON h.group_id = g.id
    WHERE g.name <> 'Телята до 6 мес'
),
cycles AS (
    SELECT c.m,
           (current_date - 729 + (c.m * 30))::date AS sdate,
           (c.m < 24) AS completed
    FROM generate_series(0, 24) AS c(m)
),
pl AS (SELECT id AS pid, row_number() OVER (ORDER BY id) - 1 AS pi FROM pasture_plot)
INSERT INTO grazing_event (group_id, plot_id, started_at, ended_at, head_count_snapshot, moved_by, note)
SELECT gs.id, pl.pid, cy.sdate::timestamp,
       CASE WHEN cy.completed THEN cy.sdate + 30 END,
       gs.heads, (SELECT id FROM app_user WHERE login = 'foreman'),
       'Ротация выпаса (демо)'
FROM gs
JOIN cycles cy ON TRUE
JOIN pl ON pl.pi = (gs.gi + (cy.m % 2) * 4);

-- ========================= 10. Настройки хозяйства =========================

INSERT INTO farm_settings (setting_key, value_type, value_text, value_num, description, updated_by) VALUES
 ('max_head_per_ha_default','NUM', NULL, 3.500,
  'Норма нагрузки голов/га по умолчанию (параметр хозяйства)', (SELECT id FROM app_user WHERE login='director')),
 ('rest_days_default','NUM', NULL, 20,
  'Минимальный период отдыха участка, дней', (SELECT id FROM app_user WHERE login='director')),
 ('farm_area_ha','NUM', NULL, 70.000,
  'Площадь хозяйства, га (считается по контуру)', (SELECT id FROM app_user WHERE login='director')),
 ('period_close_day','NUM', NULL, 5,
  'День месяца для закрытия периода', (SELECT id FROM app_user WHERE login='director'));

-- ==================== 11. Задачи: 2 года суточного цикла ====================

DO $$
DECLARE
  v_uom_kg int;
  v_mt_issue int;
  v_ft_feed int; v_ft_graze int; v_ft_care int; v_ft_treat int;
  v_user_foreman int; v_emp_foreman int;
  v_feed_nom int[];
  v_pct numeric[] := ARRAY[0.40, 0.30, 0.25, 0.05];
  d date;
  rec record;
  v_perhead numeric; v_amt numeric; v_planned numeric; v_actual numeric; v_dev numeric;
  v_half int; v_task int; v_exec int; v_series int;
  v_batch int; v_qty numeric; v_nom int; v_plot int; v_gid int;
  k int; j int;
BEGIN
  SELECT id INTO v_uom_kg      FROM uom WHERE code = 'KG';
  SELECT id INTO v_mt_issue    FROM movement_type WHERE code = 'ISSUE';
  SELECT id INTO v_ft_feed     FROM task_type WHERE code = 'FEEDING';
  SELECT id INTO v_ft_graze    FROM task_type WHERE code = 'GRAZING';
  SELECT id INTO v_ft_care     FROM task_type WHERE code = 'CARE';
  SELECT id INTO v_ft_treat    FROM task_type WHERE code = 'TREATMENT';
  SELECT id INTO v_user_foreman FROM app_user WHERE login = 'foreman';
  SELECT id INTO v_emp_foreman FROM employee WHERE full_name = 'Сидоров Пётр Алексеевич';
  SELECT array_agg(id ORDER BY id) INTO v_feed_nom FROM nomenclature WHERE category = 'FEED';

  -- Суточный цикл: 730 дней назад — вчера
  FOR d IN SELECT generate_series(current_date - 730, current_date - 1, '1 day')::date LOOP
    FOR rec IN
      SELECT g.id AS gid, g.name AS gname, COALESCE(h.head_count, 0) AS heads
      FROM animal_group g
      LEFT JOIN v_animal_group_head_count h ON h.group_id = g.id
      ORDER BY g.id
    LOOP
      CONTINUE WHEN rec.heads = 0;
      v_perhead := CASE WHEN rec.gname LIKE '%дойн%' THEN 12
                        WHEN rec.gname LIKE '%сухостой%' THEN 9
                        WHEN rec.gname LIKE '%Телят%' THEN 4
                        ELSE 11 END;
      v_amt := rec.heads * v_perhead;

      FOR v_half IN 0..1 LOOP
        v_planned := round(v_amt * (CASE WHEN v_half = 0 THEN 0.55 ELSE 0.45 END), 3);
        v_dev := 1 + (((extract(day from d)::int + rec.gid + v_half) % 5) - 2) * 0.01;
        v_actual := round(v_planned * v_dev, 3);

        INSERT INTO task (task_type_id, title, planned_date, due_at, priority, status,
                          created_by, created_at, completed_at, assigned_to)
        VALUES (v_ft_feed, 'Кормление: ' || rec.gname, d,
                d::timestamp + (CASE WHEN v_half = 0 THEN interval '8 hours' ELSE interval '17 hours' END),
                'NORMAL', 'DONE', v_user_foreman,
                d::timestamp - interval '1 day',
                d::timestamp + (CASE WHEN v_half = 0 THEN interval '8 hours 40 min' ELSE interval '17 hours 30 min' END),
                v_emp_foreman)
        RETURNING id INTO v_task;

        INSERT INTO task_animal_group (task_id, group_id) VALUES (v_task, rec.gid);

        INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
        VALUES (v_task, 'NEW', 'DONE', d::timestamp + interval '8 hours', v_user_foreman);

        INSERT INTO task_execution (task_id, group_id, executed_at, planned_amount,
                                    actual_amount, actual_uom_id, executed_by)
        VALUES (v_task, rec.gid, d::timestamp + interval '8 hours', v_planned, v_actual, v_uom_kg, v_emp_foreman)
        RETURNING id INTO v_exec;

        -- Списание корма по видам корма (FIFO, с проверкой остатка)
        FOR k IN 1..array_length(v_feed_nom, 1) LOOP
          v_nom := v_feed_nom[k];
          v_qty := round(v_actual * v_pct[k], 3);
          SELECT b.id INTO v_batch
          FROM stock_batch b
          JOIN stock_balance sb ON sb.batch_id = b.id
          WHERE b.nomenclature_id = v_nom
            AND b.received_at::date <= d
            AND sb.qty_on_hand >= v_qty
          ORDER BY b.received_at, b.id
          LIMIT 1;
          IF v_batch IS NULL THEN
            RAISE EXCEPTION 'Seed: нет остатка корма (номенклатура %) на %', v_nom, d;
          END IF;
          INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at,
                                      created_by, task_execution_id, comment)
          VALUES (v_mt_issue, v_batch, v_qty, v_uom_kg,
                  d::timestamp + interval '9 hours', v_user_foreman, v_exec, 'Кормление (суточный цикл)');
        END LOOP;
      END LOOP;

      -- Задача «Выпас» в сезон (май–сентябрь)
      IF extract(month from d) BETWEEN 5 AND 9 THEN
        SELECT ge.plot_id INTO v_plot
        FROM grazing_event ge
        WHERE ge.group_id = rec.gid
          AND ge.started_at::date <= d
          AND (ge.ended_at IS NULL OR ge.ended_at::date > d)
        ORDER BY ge.started_at DESC
        LIMIT 1;
        IF v_plot IS NOT NULL THEN
          INSERT INTO task (task_type_id, title, plot_id, planned_date, due_at, priority, status,
                            created_by, created_at, completed_at, assigned_to)
          VALUES (v_ft_graze, 'Выпас: ' || rec.gname, v_plot, d,
                  d::timestamp + interval '6 hours', 'NORMAL', 'DONE',
                  v_user_foreman, d::timestamp - interval '1 day',
                  d::timestamp + interval '14 hours', v_emp_foreman)
          RETURNING id INTO v_task;
          INSERT INTO task_animal_group (task_id, group_id) VALUES (v_task, rec.gid);
          INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
          VALUES (v_task, 'NEW', 'DONE', d::timestamp + interval '14 hours', v_user_foreman);
          INSERT INTO task_execution (task_id, group_id, executed_at, planned_amount,
                                      actual_amount, actual_uom_id, executed_by)
          VALUES (v_task, rec.gid, d::timestamp + interval '14 hours', NULL, NULL, NULL, v_emp_foreman);
        END IF;
      END IF;
    END LOOP;

    -- Ежедневная задача «Уход и чистка»
    INSERT INTO task (task_type_id, title, planned_date, due_at, priority, status,
                      created_by, created_at, completed_at, assigned_to)
    VALUES (v_ft_care, 'Уход и чистка загонов', d, d::timestamp + interval '12 hours',
            'LOW', 'DONE', v_user_foreman, d::timestamp - interval '1 day',
            d::timestamp + interval '13 hours', v_emp_foreman)
    RETURNING id INTO v_task;
    INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
    VALUES (v_task, 'NEW', 'DONE', d::timestamp + interval '13 hours', v_user_foreman);
  END LOOP;

  -- Наряды на лечение (60 шт. за 2 года)
  FOR k IN 1..60 LOOP
    d := current_date - 730 + ((k * 11) % 715);
    SELECT id INTO v_gid FROM animal_group ORDER BY id OFFSET (k % 5) LIMIT 1;
    INSERT INTO task (task_type_id, title, planned_date, due_at, priority, status,
                      created_by, created_at, completed_at, assigned_to)
    VALUES (v_ft_treat, 'Лечение животных (наряд №' || k || ')', d, d::timestamp + interval '10 hours',
            'HIGH', 'DONE', v_user_foreman, d::timestamp - interval '1 day',
            d::timestamp + interval '12 hours', v_emp_foreman)
    RETURNING id INTO v_task;
    INSERT INTO task_animal_group (task_id, group_id) VALUES (v_task, v_gid);
    INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
    VALUES (v_task, 'NEW', 'DONE', d::timestamp + interval '12 hours', v_user_foreman);
    IF k % 2 = 0 THEN
      INSERT INTO task_execution (task_id, group_id, executed_at, planned_amount,
                                  actual_amount, actual_uom_id, executed_by)
      VALUES (v_task, v_gid, d::timestamp + interval '12 hours', NULL, NULL, NULL, v_emp_foreman);
    END IF;
  END LOOP;

  -- Просроченные задачи (для демо вьюхи v_task_overdue)
  FOR k IN 1..3 LOOP
    SELECT id INTO v_gid FROM animal_group ORDER BY id OFFSET (k - 1) LIMIT 1;
    INSERT INTO task (task_type_id, title, planned_date, due_at, priority, status,
                      created_by, created_at, assigned_to)
    VALUES (v_ft_feed, 'Кормление (просрочено): группа №' || k, current_date - 2,
            (current_date - 2)::timestamp + interval '17 hours', 'HIGH', 'NEW',
            v_user_foreman, current_date - 3, v_emp_foreman)
    RETURNING id INTO v_task;
    INSERT INTO task_animal_group (task_id, group_id) VALUES (v_task, v_gid);
    INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
    VALUES (v_task, 'NEW', 'NEW', (current_date - 3)::timestamp, v_user_foreman);
  END LOOP;

  -- Задачи на сегодня (не выполнены)
  FOR k IN 1..5 LOOP
    SELECT id INTO v_gid FROM animal_group ORDER BY id OFFSET (k - 1) LIMIT 1;
    INSERT INTO task (task_type_id, title, planned_date, due_at, priority, status,
                      created_by, created_at, assigned_to)
    VALUES (v_ft_feed, 'Кормление (сегодня, утро): группа №' || k, current_date,
            current_date::timestamp + interval '8 hours', 'HIGH', 'NEW',
            v_user_foreman, current_date - 1, v_emp_foreman)
    RETURNING id INTO v_task;
    INSERT INTO task_animal_group (task_id, group_id) VALUES (v_task, v_gid);
    INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
    VALUES (v_task, 'NEW', 'NEW', (current_date - 1)::timestamp, v_user_foreman);
  END LOOP;

  -- Шаблон повторяющихся задач (горизонт 14 дней ≤ 30 по ТЗ)
  INSERT INTO task_series (task_type_id, title, recurrence, interval_days, start_date, end_date,
                           planned_amount, uom_id, ration_id, created_by, is_active)
  VALUES (v_ft_feed, 'Кормление по рациону (шаблон)', 'DAILY', 1,
          current_date, current_date + 13, 120.000, v_uom_kg,
          (SELECT id FROM ration ORDER BY id LIMIT 1), v_user_foreman, TRUE)
  RETURNING id INTO v_series;

  FOR j IN 1..3 LOOP
    SELECT id INTO v_gid FROM animal_group ORDER BY id LIMIT 1;
    INSERT INTO task (task_type_id, series_id, title, planned_date, due_at, priority, status,
                      created_by, created_at, assigned_to)
    VALUES (v_ft_feed, v_series, 'Кормление (шаблон), день +' || j, current_date + j,
            (current_date + j)::timestamp + interval '8 hours', 'NORMAL', 'NEW',
            v_user_foreman, current_date, v_emp_foreman)
    RETURNING id INTO v_task;
    INSERT INTO task_animal_group (task_id, group_id) VALUES (v_task, v_gid);
    INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
    VALUES (v_task, 'NEW', 'NEW', current_date::timestamp, v_user_foreman);
  END LOOP;
END $$;

-- ================== 12. Здоровье: осмотры, лечение, вакцинация ==============

DO $$
DECLARE
  v_vet_emp int; v_zoot_emp int;
  v_uom_l int; v_uom_pc int;
  v_mt_issue int;
  v_drug1 int; v_drug2 int;
  v_sched1 int; v_sched2 int;
  v_batch int;
  v_exam int; v_tr int;
  k int; j int; n int;
  v_performed date; v_next date; v_dose numeric;
  ar record;
BEGIN
  SELECT id INTO v_vet_emp   FROM employee WHERE full_name = 'Мельникова Анна Петровна';
  SELECT id INTO v_zoot_emp  FROM employee WHERE full_name = 'Ковалёв Сергей Иванович';
  SELECT id INTO v_uom_l     FROM uom WHERE code = 'L';
  SELECT id INTO v_uom_pc    FROM uom WHERE code = 'PC';
  SELECT id INTO v_mt_issue  FROM movement_type WHERE code = 'ISSUE';
  SELECT id INTO v_drug1     FROM nomenclature WHERE sku = 'DRUG-001';
  SELECT id INTO v_drug2     FROM nomenclature WHERE sku = 'DRUG-002';
  SELECT vs.id INTO v_sched1    FROM vaccination_schedule vs
    JOIN nomenclature n ON n.id = vs.nomenclature_id WHERE n.sku = 'VACC-001';
  SELECT vs.id INTO v_sched2    FROM vaccination_schedule vs
    JOIN nomenclature n ON n.id = vs.nomenclature_id WHERE n.sku = 'VACC-002';

  -- Текущие осмотры животных в статусах «на лечении/карантине/осмотре»
  FOR k IN 1..6 LOOP
    INSERT INTO examination (animal_id, examined_by, examined_at, diagnosis_id, notes, status_after)
    SELECT a.id, v_vet_emp, current_date - 3,
           (SELECT id FROM diagnosis ORDER BY id OFFSET (k % 8) LIMIT 1),
           'Плановый осмотр, назначена терапия (демо)',
           a.status
    FROM animal a
    WHERE a.inventory_number = (ARRAY['INV-0007','INV-0018','INV-0055','INV-0023','INV-0061','INV-0034'])[k]
      AND a.status IN ('НА_ЛЕЧЕНИИ','НА_КАРАНТИНЕ','НА_ОСМОТРЕ')
    RETURNING id INTO v_exam;

    IF v_exam IS NOT NULL AND k <= 3 THEN
      INSERT INTO treatment (examination_id, nomenclature_id, dosage, uom_id, started_at,
                             ended_at, withdrawal_until, prescribed_by)
      VALUES (v_exam,
              CASE WHEN k = 2 THEN v_drug2 ELSE v_drug1 END,
              CASE WHEN k = 2 THEN 0.050 ELSE 0.020 END,
              v_uom_l, current_date - 3,
              NULL,
              CASE WHEN k = 1 THEN current_date + 17
                   WHEN k = 2 THEN current_date + 7
                   ELSE current_date - 10 END,
              v_vet_emp)
      RETURNING id INTO v_tr;

      -- Расход препарата по назначению лечения
      SELECT b.id INTO v_batch
      FROM stock_batch b JOIN stock_balance sb ON sb.batch_id = b.id
      WHERE b.nomenclature_id = (SELECT nomenclature_id FROM treatment WHERE id = v_tr)
        AND sb.qty_on_hand >= 0.100
      ORDER BY b.received_at, b.id LIMIT 1;
      INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at,
                                  created_by, treatment_id, comment)
      VALUES (v_mt_issue, v_batch, 0.050, v_uom_l, current_date - 3,
              (SELECT id FROM app_user WHERE login = 'vet'), v_tr, 'Расход по назначению лечения');
    END IF;
  END LOOP;

  -- Исторические осмотры (2 года), часть с назначением лечения
  FOR k IN 1..60 LOOP
    INSERT INTO examination (animal_id, examined_by, examined_at, diagnosis_id, notes, status_after)
    SELECT a.id,
           CASE WHEN k % 2 = 0 THEN v_vet_emp ELSE v_zoot_emp END,
           current_date - (30 + ((k * 13) % 700)),
           (SELECT id FROM diagnosis ORDER BY id OFFSET (k % 8) LIMIT 1),
           'Историческая запись осмотра (демо)',
           'ЗДОРОВ'
    FROM animal a
    WHERE a.inventory_number = 'INV-' || lpad(((k * 7) % 96 + 1)::text, 4, '0')
    RETURNING id INTO v_exam;

    IF k % 5 = 0 AND v_exam IS NOT NULL THEN
      INSERT INTO treatment (examination_id, nomenclature_id, dosage, uom_id, started_at,
                             ended_at, withdrawal_until, prescribed_by)
      VALUES (v_exam, CASE WHEN k % 10 = 0 THEN v_drug1 ELSE v_drug2 END,
              0.040, v_uom_l,
              current_date - (30 + ((k * 13) % 700)),
              current_date - (25 + ((k * 13) % 700)),
              current_date - (25 + ((k * 13) % 700)) + 14,
              v_vet_emp)
      RETURNING id INTO v_tr;

      SELECT b.id INTO v_batch
      FROM stock_batch b JOIN stock_balance sb ON sb.batch_id = b.id
      WHERE b.nomenclature_id = (SELECT nomenclature_id FROM treatment WHERE id = v_tr)
        AND sb.qty_on_hand >= 0.100
      ORDER BY b.received_at, b.id LIMIT 1;
      INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at,
                                  created_by, treatment_id, comment)
      VALUES (v_mt_issue, v_batch, 0.040, v_uom_l,
              current_date - (30 + ((k * 13) % 700)),
              (SELECT id FROM app_user WHERE login = 'vet'), v_tr, 'Расход по назначению лечения');
    END IF;
  END LOOP;

  -- Вакцинация: 1–2 события на животное, ~7% с просроченным next_due_date
  FOR ar IN SELECT id FROM animal ORDER BY id LOOP
    n := 1 + (ar.id % 2);
    FOR j IN 1..n LOOP
      v_performed := current_date - (40 + ((ar.id * 13 + j * 100) % 620))::int;
      v_next := current_date + (((ar.id * 7 + j * 31) % 400)::int - 30);
      v_dose := 1 + ((ar.id + j) % 2);
      INSERT INTO vaccination_event (animal_id, schedule_id, nomenclature_id, dose,
                                     performed_at, next_due_date, performed_by)
      VALUES (ar.id,
              CASE WHEN j = 1 THEN v_sched1 ELSE v_sched2 END,
              (SELECT nomenclature_id FROM vaccination_schedule WHERE id =
                   (CASE WHEN j = 1 THEN v_sched1 ELSE v_sched2 END)),
              v_dose, v_performed::timestamp, v_next, v_vet_emp);

      -- Расход вакцины со склада
      SELECT b.id INTO v_batch
      FROM stock_batch b JOIN stock_balance sb ON sb.batch_id = b.id
      WHERE b.nomenclature_id = (SELECT nomenclature_id FROM vaccination_schedule WHERE id =
                                     (CASE WHEN j = 1 THEN v_sched1 ELSE v_sched2 END))
        AND sb.qty_on_hand >= v_dose
      ORDER BY b.received_at, b.id LIMIT 1;
      INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at, created_by, comment)
      VALUES (v_mt_issue, v_batch, v_dose, v_uom_pc,
              v_performed::timestamp + interval '11 hours',
              (SELECT id FROM app_user WHERE login = 'vet'), 'Расход вакцины (плановая иммунизация)');
    END LOOP;
  END LOOP;
END $$;

-- ============ 13. Прочие движения склада: списания, возврат, инвентарь =======

DO $$
DECLARE
  v_mt_writeoff int; v_mt_return int; v_mt_issue int;
  v_feed_nom int[];
  v_inv_nom int[];
  v_uom_kg int; v_uom_pc int;
  v_reason_spoil int;
  k int; v_batch int; v_nom int; v_qty numeric; v_day date;
BEGIN
  SELECT id INTO v_mt_writeoff FROM movement_type WHERE code = 'WRITE_OFF';
  SELECT id INTO v_mt_return   FROM movement_type WHERE code = 'RETURN';
  SELECT id INTO v_mt_issue    FROM movement_type WHERE code = 'ISSUE';
  SELECT id INTO v_uom_kg      FROM uom WHERE code = 'KG';
  SELECT id INTO v_uom_pc      FROM uom WHERE code = 'PC';
  SELECT id INTO v_reason_spoil FROM write_off_reason WHERE code = 'SPOILAGE';
  SELECT array_agg(id ORDER BY id) INTO v_feed_nom FROM nomenclature WHERE category = 'FEED';
  SELECT array_agg(id ORDER BY id) INTO v_inv_nom  FROM nomenclature WHERE category = 'INVENTORY';

  -- Списания (порча): 80 операций за последний месяц
  -- (окно ограничено жизненным циклом помесячной партии ~30 дней,
  --  чтобы партия с текущим остатком существовала и на дату списания)
  FOR k IN 1..80 LOOP
    v_nom := v_feed_nom[1 + (k % 4)];
    v_qty := 20 + ((k * 7) % 40);
    v_day := current_date - ((k * 9) % 30);
    SELECT b.id INTO v_batch
    FROM stock_batch b JOIN stock_balance sb ON sb.batch_id = b.id
    WHERE b.nomenclature_id = v_nom
      AND b.received_at::date <= v_day
      AND sb.qty_on_hand >= v_qty
    ORDER BY b.received_at, b.id LIMIT 1;
    IF v_batch IS NULL THEN
      RAISE EXCEPTION 'Seed: нет остатка для списания (номенклатура %)', v_nom;
    END IF;
    INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at,
                                created_by, write_off_reason_id, comment)
    VALUES (v_mt_writeoff, v_batch, v_qty, v_uom_kg, v_day::timestamp + interval '10 hours',
            (SELECT id FROM app_user WHERE login = 'storekeeper'), v_reason_spoil,
            'Списание по причине «Порча» (демо)');
  END LOOP;

  -- Возвраты от бригады: 40 операций
  FOR k IN 1..40 LOOP
    v_nom := v_feed_nom[1 + (k % 4)];
    v_qty := 10 + ((k * 5) % 25);
    SELECT id INTO v_batch FROM stock_batch
    WHERE nomenclature_id = v_nom
    ORDER BY received_at DESC, id LIMIT 1;
    INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at, created_by, comment)
    VALUES (v_mt_return, v_batch, v_qty, v_uom_kg,
            (current_date - ((k * 17) % 400))::timestamp + interval '16 hours',
            (SELECT id FROM app_user WHERE login = 'storekeeper'), 'Возврат неизрасходованного корма');
  END LOOP;

  -- Расход инвентаря: 30 операций
  FOR k IN 1..30 LOOP
    v_nom := v_inv_nom[1 + (k % 4)];
    SELECT b.id INTO v_batch
    FROM stock_batch b JOIN stock_balance sb ON sb.batch_id = b.id
    WHERE b.nomenclature_id = v_nom AND sb.qty_on_hand >= 5
    ORDER BY b.received_at, b.id LIMIT 1;
    INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at, created_by, comment)
    VALUES (v_mt_issue, v_batch, 5, v_uom_pc,
            (current_date - ((k * 23) % 500))::timestamp + interval '9 hours',
            (SELECT id FROM app_user WHERE login = 'foreman'), 'Расход инвентаря на задачи');
  END LOOP;
END $$;

-- ================= 14. Продукция и взвешивания (база для FCR) ===============

INSERT INTO production_record (group_id, product_type_id, produced_at, qty, status, released_by)
SELECT g.group_id,
       (SELECT id FROM product_type WHERE code = 'MILK'),
       w.wk::timestamp,
       round(g.heads * (52 + ((g.rn * 3 + extract(week from w.wk)::int) % 8))::numeric, 1),
       'READY',
       (SELECT id FROM app_user WHERE login = 'vet')
FROM (SELECT h.group_id, h.head_count AS heads, row_number() OVER (ORDER BY h.group_id) AS rn
      FROM v_animal_group_head_count h
      WHERE h.name LIKE '%дойн%') g
CROSS JOIN LATERAL (SELECT generate_series(current_date - 728, current_date, '7 days')::date AS wk) w;

-- Демо withdrawal period: заблокированная и разблокированная продукция
INSERT INTO production_record (group_id, product_type_id, produced_at, qty, status, blocked_until, released_by)
SELECT g.id, (SELECT id FROM product_type WHERE code = 'MILK'), (current_date - 1)::timestamp,
       850.000, 'BLOCKED', current_date + 12, (SELECT id FROM app_user WHERE login = 'vet')
FROM animal_group g ORDER BY g.id LIMIT 1;

INSERT INTO production_record (group_id, product_type_id, produced_at, qty, status, blocked_until, released_by)
SELECT g.id, (SELECT id FROM product_type WHERE code = 'MILK'), (current_date - 1)::timestamp,
       790.000, 'BLOCKED', current_date + 5, (SELECT id FROM app_user WHERE login = 'vet')
FROM animal_group g ORDER BY g.id OFFSET 1 LIMIT 1;

INSERT INTO production_record (group_id, product_type_id, produced_at, qty, status, blocked_until, released_by)
SELECT g.id, (SELECT id FROM product_type WHERE code = 'MILK'), (current_date - 10)::timestamp,
       820.000, 'READY', current_date - 2, (SELECT id FROM app_user WHERE login = 'vet')
FROM animal_group g ORDER BY g.id LIMIT 1;

-- Групповые взвешивания ежемесячно (24 месяца × 5 групп)
INSERT INTO animal_weighing (group_id, weighed_at, weight_kg, method, weighed_by)
SELECT g.id, m.m, round((300 + g.ri * 60 + ((m.idx * 7) % 50))::numeric, 1),
       'GROUP_AVG', (SELECT id FROM employee WHERE full_name = 'Ковалёв Сергей Иванович')
FROM (SELECT id, row_number() OVER (ORDER BY id) AS ri FROM animal_group) g
CROSS JOIN LATERAL (SELECT m, row_number() OVER () AS idx
                    FROM generate_series(date_trunc('month', current_date) - interval '23 months',
                                         date_trunc('month', current_date),
                                         interval '1 month') AS m) m;

-- Индивидуальные взвешивания (25 голов, недавние)
INSERT INTO animal_weighing (animal_id, weighed_at, weight_kg, method, weighed_by)
SELECT a.id, (current_date - 7)::timestamp, (380 + (a.id * 11) % 260)::numeric(8,2),
       'INDIVIDUAL', (SELECT id FROM employee WHERE full_name = 'Ковалёв Сергей Иванович')
FROM animal a
WHERE a.inventory_number <= 'INV-0025' AND a.status NOT IN ('ВЫБРАКОВАНО','ПАДЁЖ');

-- ===================== 15. Закрытие периодов и себестоимость ================

INSERT INTO period_closure (period_month, status, closed_by, closed_at, is_locked)
SELECT (date_trunc('month', current_date) - (n || ' month')::interval)::date,
       'CLOSED', u.id, now() - ((6 - n) || ' month')::interval, TRUE
FROM generate_series(1, 6) n
JOIN app_user u ON u.login = 'director';

INSERT INTO period_closure (period_month, status)
VALUES (current_date - (extract(day from current_date) - 1)::int, 'OPEN');

INSERT INTO period_group_cost (period_closure_id, group_id, feed_qty, feed_cost,
                               treatment_cost, head_days, gain_kg, fcr)
SELECT pc.id, g.id,
       900 + (g.id * 37) % 400,
       round((900 + (g.id * 37) % 400) * 18.50, 2),
       1500.00 + (g.id * 777) % 4000,
       30 * COALESCE(h.head_count, 0),
       round((30 * COALESCE(h.head_count, 0) * 0.65)::numeric, 2),
       round((6.5 + g.id * 0.7)::numeric, 2)
FROM period_closure pc
CROSS JOIN animal_group g
LEFT JOIN v_animal_group_head_count h ON h.group_id = g.id
WHERE pc.status = 'CLOSED';

-- ===================== 16. Заявки на закупку ================================

INSERT INTO purchase_request (nomenclature_id, requested_qty, status, is_auto, requested_by, requested_at, closed_at)
SELECT n.id, v.qty, v.status, v.is_auto,
       (SELECT id FROM app_user WHERE login = 'storekeeper'),
       now() - (v.days || ' days')::interval,
       CASE WHEN v.status IN ('CLOSED','CANCELLED') THEN now() - ((v.days - 3) || ' days')::interval END
FROM (VALUES
  ('FEED-001', 20000.000, 'NEW',       FALSE, 2),
  ('VACC-001',   200.000, 'NEW',       FALSE, 5),
  ('DRUG-001',    10.000, 'IN_WORK',   FALSE, 9),
  ('FEED-003',  5000.000, 'CLOSED',    FALSE, 40),
  ('INV-002',    100.000, 'CLOSED',    FALSE, 60),
  ('FEED-004',   800.000, 'CANCELLED', FALSE, 75)
) AS v(sku, qty, status, is_auto, days)
JOIN nomenclature n ON n.sku = v.sku;

-- ================ 17. Технический контур: аудит, логи, бэкапы ===============

DO $$
DECLARE
  v_entities text[] := ARRAY['animal','task','stock_movement','ration','pasture_plot','nomenclature','employee'];
  v_actions  text[] := ARRAY['CREATE','UPDATE','DELETE','LOGIN','EXPORT','OVERRIDE'];
  k int; v_elevated boolean;
BEGIN
  FOR k IN 1..100 LOOP
    v_elevated := (k % 6 = 5) OR (k % 25 = 0);
    INSERT INTO audit_log (user_id, entity_name, entity_id, action, before_json, after_json,
                           occurred_at, ip, user_agent, is_elevated, override_reason)
    VALUES (
      (SELECT id FROM app_user ORDER BY id OFFSET (k % 6) LIMIT 1),
      v_entities[1 + (k % 7)],
      1 + ((k * 13) % 900),
      v_actions[1 + (k % 6)],
      CASE WHEN k % 2 = 0 THEN jsonb_build_object('status', 'OLD', 'qty', k) END,
      jsonb_build_object('status', 'NEW', 'qty', k + 1),
      now() - (((k * 7) % 180) || ' days')::interval - (((k * 37) % 24) || ' hours')::interval,
      ('192.168.1.' || (10 + k % 40))::inet,
      'demo-client/1.0',
      v_elevated,
      CASE WHEN v_elevated THEN 'Аварийная корректировка силами Суперпользователя (демо)' END);
  END LOOP;
END $$;

INSERT INTO tech_log (admin_user_id, action_type, description, details, occurred_at)
SELECT u.id, v.t, v.d, jsonb_build_object('duration_ms', 100 + (n * 37) % 900),
       now() - ((n * 5) || ' days')::interval
FROM generate_series(1, 12) n
CROSS JOIN (VALUES
  ('MIGRATION','Применена миграция схемы farm_v1'),
  ('BACKUP','Ночное инкрементальное резервное копирование'),
  ('MAINTENANCE','ANALYZE по таблицам склада и задач'),
  ('BACKUP','Ночное полное резервное копирование'),
  ('VACUUM','VACUUM ANALYZE audit_log'),
  ('INDEX','Перестроение индексов ix_stock_movement_batch_id')
) AS v(t, d)
JOIN app_user u ON u.login = 'dba';

INSERT INTO backup_job (backup_type, started_at, finished_at, status, file_path, size_bytes, checksum, retention_days, initiated_by)
SELECT CASE WHEN n % 4 = 1 THEN 'FULL' ELSE 'INCREMENTAL' END,
       now() - ((n - 1) || ' days')::interval - interval '2 hours',
       now() - ((n - 1) || ' days')::interval - interval '2 hours 12 minutes',
       'OK',
       '/var/backups/farm/farm_' || to_char(now() - (n || ' days')::interval, 'YYYYMMDD_HH24MI') || '.dump',
       52428800 + ((n * 7919) % 200000000),
       md5('backup' || n), 30,
       (SELECT id FROM app_user WHERE login = 'dba')
FROM generate_series(1, 14) n;

INSERT INTO restore_job (backup_job_id, started_at, finished_at, status, reason, performed_by)
SELECT b.id, now() - interval '3 days', now() - interval '3 days 9 minutes', 'OK',
       'Плановая проверка восстановления (демо)',
       (SELECT id FROM app_user WHERE login = 'dba')
FROM backup_job b ORDER BY b.started_at DESC LIMIT 1;

-- ========================= 18. Импорт и уведомления ========================

INSERT INTO import_job (entity_code, file_name, total_rows, ok_rows, error_rows, status, finished_at, created_by)
SELECT v.entity, v.file, v.total, v.ok, v.err, v.status,
       now() - (v.days || ' days')::interval,
       (SELECT id FROM app_user WHERE login = 'director')
FROM (VALUES
  ('animals',    'pogolovie_2026.csv',   100, 100, 0, 'OK',         30),
  ('stock',      'ostatki_sklad.csv',     50,   0, 50, 'FAILED',    25),
  ('rations',    'raciyony.csv',          50,  48, 2, 'OK',         20)
) AS v(entity, file, total, ok, err, status, days);

INSERT INTO import_error (import_job_id, row_no, field_name, message, raw_value)
SELECT j.id, e.row_no, e.field, e.msg, e.raw
FROM import_job j
CROSS JOIN (VALUES
  (3,  'birth_date',  'Некорректная дата: «31.02.2026»', '31.02.2026'),
  (7,  'inventory_number', 'Дубликат инвентарного номера', 'INV-0042'),
  (12, 'sex',         'Допустимо только M или F', 'X'),
  (19, 'breed',       'Порода не найдена в справочнике', 'Кросс «Голландия-2»'),
  (23, 'group',       'Группа не активна', 'КРС-4 (расформирована)'),
  (31, 'ration',      'Нет единицы измерения «ц»', 'ц'),
  (44, 'norm_amount', 'Норма должна быть больше 0', '-1'),
  (47, 'nomenclature','SKU не найден', 'FEED-999')
) AS e(row_no, field, msg, raw)
WHERE j.file_name IN ('ostatki_sklad.csv','raciyony.csv');

INSERT INTO notification (user_id, type, message, related_entity, related_id, is_read, created_at)
SELECT u.id, v.type, v.msg, v.entity, v.eid, (n % 3 = 0),
       now() - ((n * 3) || ' hours')::interval
FROM generate_series(1, 20) n
CROSS JOIN (VALUES
  ('VACCINE_OVERDUE', 'Просрочка графика вакцинации у N животных', 'animal', 1),
  ('LOW_STOCK',       'Остаток корма ниже порога: сено луговое', 'nomenclature', 2),
  ('TASK_OVERDUE',    'Есть невыполненные задачи за вчера', 'task', 3),
  ('PLOT_REST',       'Участок P-05 прошёл период отдыха', 'pasture_plot', 5),
  ('REST_END',        'Участок P-06 готов к повторному выпасу', 'pasture_plot', 6)
) AS v(type, msg, entity, eid)
JOIN app_user u ON u.id = 1 + (n % 6);
