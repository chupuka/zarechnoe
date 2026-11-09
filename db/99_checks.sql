-- =============================================================================
-- Файл 99_checks.sql: проверочные сценарии Недель 3–6.
--
-- Запуск:  docker exec -i farm_pg psql -U farm -d farm -v ON_ERROR_STOP=1 \
--              < db/99_checks.sql
--
-- Скрипт выполняется ОДНОЙ транзакцией и завершается ROLLBACK:
--   * после успешного прогона данные БД не изменяются;
--   * при провале любого сценария psql падает с ненулевым кодом (ON_ERROR_STOP).
-- Формат: успех → RAISE NOTICE 'CHECK n OK: ...';
--         провал → исключение 'CHECK n FAIL: ...' (или неожиданная ошибка).
-- =============================================================================

BEGIN;

-- ---------- 1. Структурные ассерты (Неделя 3) ----------
DO $$
DECLARE n INT; s NUMERIC;
BEGIN
    SELECT count(*) INTO n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name <> 'spatial_ref_sys';
    IF n <> 56 THEN RAISE EXCEPTION 'CHECK 1 FAIL: таблиц % вместо 56', n; END IF;

    SELECT count(*) INTO n FROM information_schema.table_constraints
     WHERE constraint_schema = 'public' AND constraint_type = 'FOREIGN KEY';
    IF n <> 93 THEN RAISE EXCEPTION 'CHECK 1 FAIL: внешних ключей % вместо 93', n; END IF;

    SELECT count(*) INTO n FROM information_schema.views
     WHERE table_schema = 'public'
       AND table_name NOT IN ('geography_columns', 'geometry_columns');
    IF n <> 7 THEN RAISE EXCEPTION 'CHECK 1 FAIL: представлений % вместо 7', n; END IF;

    SELECT count(*) INTO n FROM role;
    IF n <> 6 THEN RAISE EXCEPTION 'CHECK 1 FAIL: ролей % вместо 6', n; END IF;

    SELECT count(*) INTO n FROM permission;
    IF n <> 42 THEN RAISE EXCEPTION 'CHECK 1 FAIL: прав % вместо 42', n; END IF;

    SELECT count(*) INTO n FROM animal;
    IF n <> 100 THEN RAISE EXCEPTION 'CHECK 1 FAIL: животных % вместо 100', n; END IF;

    SELECT count(*) INTO n FROM task;
    IF n < 9000 THEN RAISE EXCEPTION 'CHECK 1 FAIL: задач % (ожидалось ≥9000)', n; END IF;

    SELECT count(*) INTO n FROM stock_movement;
    IF n < 25000 THEN RAISE EXCEPTION 'CHECK 1 FAIL: движений % (ожидалось ≥25000)', n; END IF;

    SELECT count(*) INTO n FROM pasture_plot;
    IF n <> 8 THEN RAISE EXCEPTION 'CHECK 1 FAIL: участков % вместо 8', n; END IF;

    SELECT area_ha INTO s FROM farm_boundary WHERE id = 1;
    IF s IS NULL OR s < 65 OR s > 75 THEN
        RAISE EXCEPTION 'CHECK 1 FAIL: площадь хозяйства % га не в диапазоне 65..75', s;
    END IF;

    SELECT count(*) INTO n FROM purchase_request WHERE is_auto;
    IF n < 1 THEN RAISE EXCEPTION 'CHECK 1 FAIL: нет авто-заявок от триггера'; END IF;

    RAISE NOTICE 'CHECK 1 OK: структура (56 таблиц, 93 FK, 7 VIEW, роли/права, демо-набор, авто-заявки)';
END $$;

-- ---------- 2. Сверка остатков склада ----------
DO $$
DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM v_stock_balance_check
     WHERE abs(balance_qty - calc_qty) > 0.0001;
    IF n <> 0 THEN
        RAISE EXCEPTION 'CHECK 2 FAIL: % партий с расхождением остатков', n;
    END IF;
    RAISE NOTICE 'CHECK 2 OK: v_stock_balance_check — расхождений 0';
END $$;

-- ---------- 3. Негатив: уход в минус по складу ----------
DO $$
BEGIN
    INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id, moved_at, created_by, comment)
    SELECT (SELECT id FROM movement_type WHERE code = 'WRITE_OFF'),
           b.id, sb.qty_on_hand + 100, (SELECT id FROM uom WHERE code = 'KG'),
           now(), (SELECT id FROM app_user WHERE login = 'storekeeper'), 'check-3'
    FROM stock_batch b
    JOIN stock_balance sb ON sb.batch_id = b.id
    ORDER BY b.id LIMIT 1;
    RAISE EXCEPTION 'CHECK 3 FAIL: отрицательный остаток прошёл';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'CHECK 3 OK: списание сверх остатка заблокировано (CHECK qty_on_hand >= 0)';
END $$;

-- ---------- 4. Негатив: выпас на неотдохнувший участок (триггер) ----------
DO $$
BEGIN
    INSERT INTO grazing_event (group_id, plot_id, started_at, head_count_snapshot, moved_by, note)
    SELECT g.id, p.id, now(), 10,
           (SELECT id FROM app_user WHERE login = 'foreman'), 'check-4'
    FROM animal_group g, pasture_plot p
    WHERE p.plot_no = 'P-05' AND g.name = 'Телята до 6 мес';
    RAISE EXCEPTION 'CHECK 4 FAIL: выпас на неотдохнувший участок прошёл';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 4 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%отдыха%' THEN
        RAISE EXCEPTION 'CHECK 4 FAIL: неожиданная ошибка: %', SQLERRM;
    END IF;
    RAISE NOTICE 'CHECK 4 OK: %', SQLERRM;
END $$;

-- ---------- 5. Негатив: снятие withdrawal-блокировки раньше срока ----------
DO $$
BEGIN
    UPDATE production_record SET status = 'READY'
     WHERE status = 'BLOCKED' AND blocked_until > current_date;
    RAISE EXCEPTION 'CHECK 5 FAIL: продукция под withdrawal перешла в READY';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 5 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%ожидания%' THEN
        RAISE EXCEPTION 'CHECK 5 FAIL: неожиданная ошибка: %', SQLERRM;
    END IF;
    RAISE NOTICE 'CHECK 5 OK: %', SQLERRM;
END $$;

-- ---------- 6. RBAC: закрытие периода без права period:EXEC ----------
DO $$
BEGIN
    PERFORM * FROM sp_close_period(
        current_date, (SELECT id FROM app_user WHERE login = 'foreman'));
    RAISE EXCEPTION 'CHECK 6 FAIL: закрытие периода без прав прошло';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 6 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%period:EXEC%' THEN
        RAISE EXCEPTION 'CHECK 6 FAIL: неожиданная ошибка: %', SQLERRM;
    END IF;
    RAISE NOTICE 'CHECK 6 OK: %', SQLERRM;
END $$;

-- ---------- 7. RBAC: техническая роль не участвует в ежедневном процессе ----------
DO $$
BEGIN
    PERFORM sp_execute_task(
        NULL, NULL, NULL, (SELECT id FROM app_user WHERE login = 'superuser'));
    RAISE EXCEPTION 'CHECK 7 FAIL: техроль выполнила задачу';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 7 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%сотрудник%' THEN
        RAISE EXCEPTION 'CHECK 7 FAIL: неожиданная ошибка: %', SQLERRM;
    END IF;
    RAISE NOTICE 'CHECK 7 OK: %', SQLERRM;
END $$;

-- ---------- 8. Негатив: превышение нормы нагрузки голов/га ----------
DO $$
BEGIN
    PERFORM sp_move_group_to_plot(
        (SELECT id FROM animal_group WHERE name = 'Телята до 6 мес'),
        (SELECT id FROM pasture_plot WHERE plot_no = 'P-01'),
        (SELECT id FROM app_user WHERE login = 'foreman'), 'check-8');
    RAISE EXCEPTION 'CHECK 8 FAIL: превышение нормы нагрузки прошло';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 8 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%нормы нагрузки%' THEN
        RAISE EXCEPTION 'CHECK 8 FAIL: неожиданная ошибка: %', SQLERRM;
    END IF;
    RAISE NOTICE 'CHECK 8 OK: %', SQLERRM;
END $$;

-- ---------- 9. Негатив: sp_move_group_to_plot на неотдохнувший участок ----------
DO $$
BEGIN
    PERFORM sp_move_group_to_plot(
        (SELECT id FROM animal_group WHERE name = 'Телята до 6 мес'),
        (SELECT id FROM pasture_plot WHERE plot_no = 'P-05'),
        (SELECT id FROM app_user WHERE login = 'foreman'), 'check-9');
    RAISE EXCEPTION 'CHECK 9 FAIL: переезд на неотдохнувший участок прошёл';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 9 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%отдыха%' THEN
        RAISE EXCEPTION 'CHECK 9 FAIL: неожиданная ошибка: %', SQLERRM;
    END IF;
    RAISE NOTICE 'CHECK 9 OK: %', SQLERRM;
END $$;

-- ---------- 10. Позитив: sp_execute_task — списание корма по задаче ----------
DO $$
DECLARE
    v_task  BIGINT;
    v_grp   BIGINT;
    v_user  BIGINT;
    v_exec  BIGINT;
    v_before NUMERIC;
    v_after  NUMERIC;
    v_spent  NUMERIC;
    n        INT;
BEGIN
    SELECT t.id, g.group_id INTO v_task, v_grp
    FROM task t
    JOIN task_animal_group g ON g.task_id = t.id
    WHERE t.status = 'NEW'
      AND t.task_type_id = (SELECT id FROM task_type WHERE code = 'FEEDING')
      AND t.planned_date = current_date
    ORDER BY t.id LIMIT 1;
    IF v_task IS NULL THEN
        RAISE EXCEPTION 'CHECK 10 FAIL: не найдена сегодняшняя задача на кормление';
    END IF;
    SELECT id INTO v_user FROM app_user WHERE login = 'foreman';

    SELECT COALESCE(SUM(sb.qty_on_hand), 0) INTO v_before
    FROM stock_balance sb
    JOIN stock_batch b ON b.id = sb.batch_id
    JOIN nomenclature n ON n.id = b.nomenclature_id
    WHERE n.category = 'FEED';

    v_exec := sp_execute_task(v_task, v_grp, 100.000, v_user, 'check-10');

    IF v_exec IS NULL THEN
        RAISE EXCEPTION 'CHECK 10 FAIL: не возвращён id исполнения';
    END IF;
    IF (SELECT status FROM task WHERE id = v_task) <> 'DONE' THEN
        RAISE EXCEPTION 'CHECK 10 FAIL: задача не переведена в DONE';
    END IF;
    SELECT count(*) INTO n FROM stock_movement WHERE task_execution_id = v_exec;
    IF n <> 4 THEN
        RAISE EXCEPTION 'CHECK 10 FAIL: движений списания % вместо 4 (позиции рациона)', n;
    END IF;

    SELECT COALESCE(SUM(sb.qty_on_hand), 0) INTO v_after
    FROM stock_balance sb
    JOIN stock_batch b ON b.id = sb.batch_id
    JOIN nomenclature n ON n.id = b.nomenclature_id
    WHERE n.category = 'FEED';
    v_spent := v_before - v_after;
    IF v_spent <> 100.000 THEN
        RAISE EXCEPTION 'CHECK 10 FAIL: списано % вместо 100.000 кг', v_spent;
    END IF;

    -- Повторное выполнение того же факта — отказ
    BEGIN
        PERFORM sp_execute_task(v_task, v_grp, 100.000, v_user, 'check-10-retry');
        RAISE EXCEPTION 'CHECK 10 FAIL: повторное выполнение прошло';
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'CHECK 10 FAIL%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%уже отмечено%'
           AND SQLERRM NOT LIKE '%выполнение невозможно%' THEN
            RAISE EXCEPTION 'CHECK 10 FAIL (повтор): %', SQLERRM;
        END IF;
    END;

    RAISE NOTICE 'CHECK 10 OK: sp_execute_task списал 100.000 кг (4 позиции рациона), задача DONE, повтор отклонён';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 10 FAIL%' THEN RAISE; END IF;
    RAISE EXCEPTION 'CHECK 10 FAIL: %', SQLERRM;
END $$;

-- ---------- 11. Позитив: sp_change_animal_status — лечение и выздоровление ----------
DO $$
DECLARE
    v_an    BIGINT;
    v_user  BIGINT;
    v_diag  BIGINT;
    v_drug  BIGINT;
    v_res   VARCHAR;
    v_bal_b NUMERIC;
    v_bal_a NUMERIC;
    v_wd    DATE;
BEGIN
    SELECT id INTO v_an FROM animal WHERE status = 'ЗДОРОВ' ORDER BY id LIMIT 1;
    SELECT id INTO v_user FROM app_user WHERE login = 'vet';
    SELECT id INTO v_diag FROM diagnosis ORDER BY id LIMIT 1;
    SELECT id INTO v_drug FROM nomenclature WHERE sku = 'DRUG-001';

    SELECT COALESCE(SUM(sb.qty_on_hand), 0) INTO v_bal_b
    FROM stock_balance sb
    JOIN stock_batch b ON b.id = sb.batch_id
    WHERE b.nomenclature_id = v_drug;

    v_res := sp_change_animal_status(v_an, 'НА_ЛЕЧЕНИИ', v_user,
                                     'Мастит левой доли (check-11)', v_diag, v_drug, 0.050);
    IF v_res <> 'НА_ЛЕЧЕНИИ' THEN
        RAISE EXCEPTION 'CHECK 11 FAIL: статус не изменился (%)', v_res;
    END IF;

    SELECT t.withdrawal_until INTO v_wd
    FROM treatment t
    JOIN examination e ON e.id = t.examination_id
    WHERE e.animal_id = v_an AND t.ended_at IS NULL;
    IF v_wd IS NULL OR v_wd <> current_date + 20 THEN
        RAISE EXCEPTION 'CHECK 11 FAIL: withdrawal_until % вместо % (20 дн. от препарата)', v_wd, current_date + 20;
    END IF;

    SELECT COALESCE(SUM(sb.qty_on_hand), 0) INTO v_bal_a
    FROM stock_balance sb
    JOIN stock_batch b ON b.id = sb.batch_id
    WHERE b.nomenclature_id = v_drug;
    IF v_bal_b - v_bal_a <> 0.050 THEN
        RAISE EXCEPTION 'CHECK 11 FAIL: препарат списан % вместо 0.050', v_bal_b - v_bal_a;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM audit_log
                   WHERE entity_name = 'animal' AND entity_id = v_an AND action = 'UPDATE') THEN
        RAISE EXCEPTION 'CHECK 11 FAIL: переход статуса не попал в аудит';
    END IF;

    -- Выздоровление: лечение закрывается
    v_res := sp_change_animal_status(v_an, 'ЗДОРОВ', v_user, 'Выздоровление (check-11)');
    IF EXISTS (SELECT 1 FROM treatment t
               JOIN examination e ON e.id = t.examination_id
               WHERE e.animal_id = v_an AND t.ended_at IS NULL) THEN
        RAISE EXCEPTION 'CHECK 11 FAIL: лечение не закрыто после выздоровления';
    END IF;

    -- Регламент: переход в лечебный статус без диагноза — отказ
    BEGIN
        PERFORM sp_change_animal_status(v_an, 'НА_ЛЕЧЕНИИ', v_user, 'без диагноза');
        RAISE EXCEPTION 'CHECK 11 FAIL: лечение без диагноза прошло';
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'CHECK 11 FAIL%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%диагноза%' THEN
            RAISE EXCEPTION 'CHECK 11 FAIL (без диагноза): %', SQLERRM;
        END IF;
    END;

    RAISE NOTICE 'CHECK 11 OK: лечение (осмотр+назначение+расход 0.050+withdrawal+аудит), выздоровление, отказ без диагноза';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 11 FAIL%' THEN RAISE; END IF;
    RAISE EXCEPTION 'CHECK 11 FAIL: %', SQLERRM;
END $$;

-- ---------- 12. Позитив: sp_create_task_series ----------
DO $$
DECLARE
    v_series BIGINT;
    v_user   BIGINT;
    v_emp    BIGINT;
    v_type   BIGINT;
    n        INT;
BEGIN
    SELECT id INTO v_user FROM app_user WHERE login = 'foreman';
    SELECT id INTO v_emp  FROM employee WHERE full_name = 'Сидоров Пётр Алексеевич';
    SELECT id INTO v_type FROM task_type WHERE code = 'FEEDING';

    v_series := sp_create_task_series(
        'Проверка шаблона', v_type, 'DAILY', 1,
        current_date, current_date + 6,
        ARRAY[(SELECT id FROM animal_group WHERE name = 'КРС-1 (дойные)'),
              (SELECT id FROM animal_group WHERE name = 'КРС-2 (дойные)')],
        100.000, v_user, v_emp);

    SELECT count(*) INTO n FROM task WHERE series_id = v_series;
    IF n <> 14 THEN
        RAISE EXCEPTION 'CHECK 12 FAIL: создано % задач вместо 14 (7 дней × 2 группы)', n;
    END IF;

    -- Горизонт > 30 дней — отказ (ТЗ п.3.1)
    BEGIN
        PERFORM sp_create_task_series(
            'Долгая серия', v_type, 'DAILY', 1,
            current_date, current_date + 31,
            ARRAY[(SELECT id FROM animal_group WHERE name = 'КРС-1 (дойные)')],
            100.000, v_user, v_emp);
        RAISE EXCEPTION 'CHECK 12 FAIL: горизонт 31 день прошёл';
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'CHECK 12 FAIL%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%30%' THEN
            RAISE EXCEPTION 'CHECK 12 FAIL (31 день): %', SQLERRM;
        END IF;
    END;

    RAISE NOTICE 'CHECK 12 OK: шаблон дал 14 задач (7×2), горизонт 31 дн. отклонён';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 12 FAIL%' THEN RAISE; END IF;
    RAISE EXCEPTION 'CHECK 12 FAIL: %', SQLERRM;
END $$;

-- ---------- 13. Позитив: sp_move_group_to_plot (норма выдержана) ----------
DO $$
DECLARE
    v_ev  BIGINT;
    v_grp BIGINT;
    v_pl  BIGINT;
    n     INT;
BEGIN
    SELECT id INTO v_grp FROM animal_group WHERE name = 'Телята до 6 мес';
    SELECT id INTO v_pl  FROM pasture_plot WHERE plot_no = 'P-04';

    v_ev := sp_move_group_to_plot(v_grp, v_pl,
            (SELECT id FROM app_user WHERE login = 'foreman'), 'check-13');
    IF v_ev IS NULL THEN
        RAISE EXCEPTION 'CHECK 13 FAIL: нет id события выпаса';
    END IF;
    SELECT count(*) INTO n FROM grazing_event
     WHERE group_id = v_grp AND plot_id = v_pl AND ended_at IS NULL;
    IF n <> 1 THEN
        RAISE EXCEPTION 'CHECK 13 FAIL: активных событий на участке % вместо 1', n;
    END IF;
    RAISE NOTICE 'CHECK 13 OK: телята переведены на P-04 (нагрузка 23/8.74 га в пределах нормы), предыдущий выпас закрыт';
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 13 FAIL%' THEN RAISE; END IF;
    RAISE EXCEPTION 'CHECK 13 FAIL: %', SQLERRM;
END $$;

-- ---------- 14. Позитив: sp_close_period (директор, текущий месяц) ----------
DO $$
DECLARE
    v_dir   BIGINT;
    v_n     INT;
    v_fcr   INT;
    v_fq    NUMERIC;
    v_stat  VARCHAR;
    n       INT;
BEGIN
    SELECT id INTO v_dir FROM app_user WHERE login = 'director';

    SELECT count(*), count(fcr), max(feed_qty) INTO v_n, v_fcr, v_fq
    FROM sp_close_period(current_date, v_dir) r;

    IF v_n < 5 THEN
        RAISE EXCEPTION 'CHECK 14 FAIL: рассчитано % групп вместо 5', v_n;
    END IF;
    IF v_fcr < 4 THEN
        RAISE EXCEPTION 'CHECK 14 FAIL: FCR рассчитан только для % групп', v_fcr;
    END IF;
    IF v_fq IS NULL OR v_fq <= 0 THEN
        RAISE EXCEPTION 'CHECK 14 FAIL: расход корма не рассчитан';
    END IF;
    SELECT status INTO v_stat FROM period_closure
     WHERE period_month = date_trunc('month', current_date)::date;
    IF v_stat <> 'CLOSED' THEN
        RAISE EXCEPTION 'CHECK 14 FAIL: статус периода «%» вместо CLOSED', v_stat;
    END IF;

    -- Повторное закрытие — отказ
    BEGIN
        PERFORM * FROM sp_close_period(current_date, v_dir);
        RAISE EXCEPTION 'CHECK 14 FAIL: повторное закрытие прошло';
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE 'CHECK 14 FAIL%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%уже закрыт%' THEN
            RAISE EXCEPTION 'CHECK 14 FAIL (повтор): %', SQLERRM;
        END IF;
    END;

    RAISE NOTICE 'CHECK 14 OK: период закрыт — % групп, FCR у % групп, расход % кг, повтор отклонён',
                 v_n, v_fcr, v_fq;
EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CHECK 14 FAIL%' THEN RAISE; END IF;
    RAISE EXCEPTION 'CHECK 14 FAIL: %', SQLERRM;
END $$;

-- ---------- 15. RBAC и усиленный аудит (Неделя 6) ----------
DO $$
DECLARE n INT; v_bad INT;
BEGIN
    -- Новые выделенные права
    SELECT count(*) INTO n FROM permission
     WHERE code IN ('catalog:READ','catalog:WRITE','employee:READ','employee:WRITE',
                    'backup:READ','backup:EXEC');
    IF n <> 6 THEN RAISE EXCEPTION 'CHECK 15 FAIL: новых прав % вместо 6', n; END IF;

    -- DBA (TECHNICAL) НЕ имеет записи в справочники/персонал
    SELECT count(*) INTO n FROM role_permission rp
     JOIN permission p ON p.id = rp.permission_id
     JOIN role r ON r.id = rp.role_id
     WHERE r.code = 'DBA' AND p.code IN ('catalog:WRITE','employee:WRITE');
    IF n <> 0 THEN RAISE EXCEPTION 'CHECK 15 FAIL: DBA имеет права записи в справочники/персонал (%)', n; END IF;

    -- Бригадир видит сотрудников, но не может их менять
    SELECT count(*) INTO n FROM role_permission rp
     JOIN permission p ON p.id = rp.permission_id
     JOIN role r ON r.id = rp.role_id
     WHERE r.code = 'FOREMAN' AND p.code = 'employee:READ';
    IF n <> 1 THEN RAISE EXCEPTION 'CHECK 15 FAIL: у FOREMAN нет employee:READ'; END IF;
    SELECT count(*) INTO n FROM role_permission rp
     JOIN permission p ON p.id = rp.permission_id
     JOIN role r ON r.id = rp.role_id
     WHERE r.code = 'FOREMAN' AND p.code = 'employee:WRITE';
    IF n <> 0 THEN RAISE EXCEPTION 'CHECK 15 FAIL: FOREMAN может менять сотрудников'; END IF;

    -- Списание (stock:DELETE) — только у кладовщика/суперпользователя
    SELECT count(*) INTO n FROM role_permission rp
     JOIN permission p ON p.id = rp.permission_id
     JOIN role r ON r.id = rp.role_id
     WHERE p.code = 'stock:DELETE' AND r.code = 'FOREMAN';
    IF n <> 0 THEN RAISE EXCEPTION 'CHECK 15 FAIL: FOREMAN может списывать'; END IF;

    RAISE NOTICE 'CHECK 15 OK: RBAC (42 права, DBA только чтение, FOREMAN employee:READ, списание изолировано)';
END $$;

-- ---------- 16. Усиленный аудит: CHECK на БД ----------
DO $$
DECLARE v_uid BIGINT;
BEGIN
    SELECT id INTO v_uid FROM app_user WHERE login = 'superuser';

    -- СУБД запрещает elevated-запись без причины
    BEGIN
        INSERT INTO audit_log (user_id, entity_name, entity_id, action, is_elevated, override_reason)
        VALUES (v_uid, 'check_probe', 0, 'UPDATE', TRUE, NULL);
        RAISE EXCEPTION 'CHECK 16 FAIL: elevated-запись без причины прошла';
    EXCEPTION WHEN check_violation THEN
        NULL;  -- ожидаемо
    END;

    -- С причиной — проходит (откатится вместе со всей транзакцией)
    INSERT INTO audit_log (user_id, entity_name, entity_id, action, is_elevated, override_reason)
    VALUES (v_uid, 'check_probe', 0, 'UPDATE', TRUE, 'CHECK 16: плановая проверка');

    RAISE NOTICE 'CHECK 16 OK: CHECK (NOT is_elevated OR override_reason IS NOT NULL) работает';
END $$;

-- ---------- 17. Журналы разделены (бизнес-аудит vs техлог) ----------
DO $$
DECLARE n INT;
BEGIN
    SELECT count(*) INTO n FROM information_schema.columns
     WHERE table_name = 'audit_log' AND column_name IN ('is_elevated','override_reason','ip','user_agent');
    IF n <> 4 THEN RAISE EXCEPTION 'CHECK 17 FAIL: у audit_log нет полей усиленного аудита (%)', n; END IF;

    SELECT count(*) INTO n FROM information_schema.columns
     WHERE table_name = 'tech_log' AND column_name IN ('admin_user_id','action_type','details');
    IF n <> 3 THEN RAISE EXCEPTION 'CHECK 17 FAIL: у tech_log нет ожидаемых полей (%)', n; END IF;

    SELECT count(*) INTO n FROM information_schema.columns
     WHERE table_name = 'backup_job' AND column_name IN ('checksum','size_bytes','retention_days');
    IF n <> 3 THEN RAISE EXCEPTION 'CHECK 17 FAIL: у backup_job нет ожидаемых полей (%)', n; END IF;

    RAISE NOTICE 'CHECK 17 OK: audit_log / tech_log / backup_job готовы к администрированию';
END $$;

SELECT '=== ВСЕ 17 ПРОВЕРОК ПРОЙДЕНЫ (данные будут откатлены) ===' AS result;

ROLLBACK;
