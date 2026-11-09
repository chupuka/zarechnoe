-- =============================================================================
-- Файл 05_procedures.sql: серверная логика — хранимые процедуры и функции
-- (Неделя 4. «Написаны первые хранимые процедуры»).
-- Выполнять ПОСЛЕ 04_seed_demo.sql.
--
-- Все бизнес-проверки выполняются на стороне сервера (ТЗ п.4):
--   * атомарное списание корма с запретом ухода в минус;
--   * норма нагрузки голов/га + период отдыха участка;
--   * регламент переходов статуса животного с записью в аудит;
--   * RBAC-проверка прав внутри процедуры (матрица role_permission);
--   * автоматическая заявка на закупку при остатке ниже порога;
--   * горизонт повторяющихся задач ≤ 30 дней;
--   * закрытие периода с расчётом себестоимости и FCR.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Вспомогательные функции
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_has_permission(p_user_id BIGINT, p_code TEXT)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM app_user u
        JOIN role_permission rp ON rp.role_id = u.role_id
        JOIN permission p ON p.id = rp.permission_id
        WHERE u.id = p_user_id
          AND u.is_active AND NOT u.is_deleted
          AND p.code = p_code
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_require_user(p_user_id BIGINT)
RETURNS BIGINT AS $$
DECLARE
    v_emp BIGINT;
    v_active BOOLEAN;
BEGIN
    SELECT employee_id, is_active AND NOT is_deleted INTO v_emp, v_active
    FROM app_user WHERE id = p_user_id;
    IF v_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Пользователь % не найден или неактивен', p_user_id;
    END IF;
    IF v_emp IS NULL THEN
        -- Технические роли (Суперпользователь, Администратор БД) не участвуют
        -- в ежедневном процессе — их учётки без сотрудника (ТЗ, п.7)
        RAISE EXCEPTION 'Действие требует учётную запись сотрудника (пользователь % — техническая роль?)', p_user_id;
    END IF;
    RETURN v_emp;
END;
$$ LANGUAGE plpgsql STABLE;

-- ---------------------------------------------------------------------------
-- 1. Выполнение задачи с атомарным списанием корма (ТЗ п.3.1)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sp_execute_task(
    p_task_id       BIGINT,
    p_group_id      BIGINT,
    p_actual_amount NUMERIC,   -- фактически выдано корма, кг (NULL — без списания)
    p_user_id       BIGINT,    -- app_user, от лица которого фиксируется
    p_notes         TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_task          task%ROWTYPE;
    v_emp           BIGINT;
    v_prev_status   VARCHAR(10);
    v_ration_id     BIGINT;
    v_head          INT;
    v_total_norm    NUMERIC;
    v_freq          INT;
    v_planned       NUMERIC;
    v_exec_id       BIGINT;
    v_uom_kg        BIGINT;
    v_mt_issue      BIGINT;
    v_req_writeoff  BOOLEAN;
    item            RECORD;
    v_qty           NUMERIC;
    v_batch         BIGINT;
    v_sku           VARCHAR;
BEGIN
    v_emp := fn_require_user(p_user_id);

    IF NOT fn_has_permission(p_user_id, 'task:WRITE') THEN
        RAISE EXCEPTION 'Недостаточно прав: требуется право task:WRITE';
    END IF;

    -- Блокируем задачу от конкурентного выполнения
    SELECT * INTO v_task FROM task WHERE id = p_task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Задача % не найдена', p_task_id;
    END IF;
    IF v_task.status NOT IN ('NEW', 'IN_WORK') THEN
        RAISE EXCEPTION 'Задача % в статусе «%» — выполнение невозможно', p_task_id, v_task.status;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM task_animal_group
                   WHERE task_id = p_task_id AND group_id = p_group_id) THEN
        RAISE EXCEPTION 'Группа % не привязана к задаче %', p_group_id, p_task_id;
    END IF;
    IF EXISTS (SELECT 1 FROM task_execution
               WHERE task_id = p_task_id AND group_id = p_group_id) THEN
        RAISE EXCEPTION 'Выполнение задачи % по группе % уже отмечено', p_task_id, p_group_id;
    END IF;

    SELECT t.requires_writeoff INTO v_req_writeoff
    FROM task_type t WHERE id = v_task.task_type_id;

    SELECT COALESCE(h.head_count, 0) INTO v_head
    FROM animal_group g
    LEFT JOIN v_animal_group_head_count h ON h.group_id = g.id
    WHERE g.id = p_group_id AND g.is_active AND NOT g.is_deleted;
    IF v_head IS NULL OR v_head = 0 THEN
        RAISE EXCEPTION 'Группа % не найдена или неактивна', p_group_id;
    END IF;

    -- Активный рацион группы на дату задачи
    SELECT id INTO v_ration_id
    FROM ration
    WHERE group_id = p_group_id
      AND is_active AND NOT is_deleted
      AND valid_from <= v_task.planned_date
      AND (valid_to IS NULL OR valid_to >= v_task.planned_date)
    ORDER BY valid_from DESC
    LIMIT 1;

    IF v_req_writeoff THEN
        -- ТЗ п.4: задача на кормление — только для активной группы с рационом
        IF v_ration_id IS NULL THEN
            RAISE EXCEPTION 'У группы % нет активного рациона на % — кормление не может быть выполнено',
                p_group_id, v_task.planned_date;
        END IF;
        IF p_actual_amount IS NULL OR p_actual_amount <= 0 THEN
            RAISE EXCEPTION 'Для задачи со списанием требуется фактический расход корма';
        END IF;
        SELECT COALESCE(SUM(norm_amount), 0), MAX(freq_per_day)
        INTO v_total_norm, v_freq
        FROM ration_item WHERE ration_id = v_ration_id;
        IF v_total_norm IS NULL OR v_total_norm <= 0 THEN
            RAISE EXCEPTION 'Рацион % не содержит позиций', v_ration_id;
        END IF;
        v_planned := ROUND(v_total_norm * v_head / GREATEST(v_freq, 1), 3);
    ELSE
        v_planned := NULL;
        IF p_actual_amount IS NOT NULL THEN
            RAISE EXCEPTION 'Задача типа «%» не предусматривает списание корма',
                (SELECT name FROM task_type WHERE id = v_task.task_type_id);
        END IF;
    END IF;

    -- 1) Факт выполнения
    INSERT INTO task_execution (task_id, group_id, executed_at, planned_amount,
                                actual_amount, actual_uom_id, executed_by, notes)
    VALUES (p_task_id, p_group_id, now(), v_planned, p_actual_amount,
            CASE WHEN p_actual_amount IS NOT NULL
                 THEN (SELECT id FROM uom WHERE code = 'KG') END,
            v_emp, p_notes)
    RETURNING id INTO v_exec_id;

    -- 2) Атомарное списание по видам корма (FIFO, пропорционально нормам рациона)
    IF v_req_writeoff THEN
        SELECT id INTO v_uom_kg FROM uom WHERE code = 'KG';
        SELECT id INTO v_mt_issue FROM movement_type WHERE code = 'ISSUE';

        FOR item IN
            SELECT nomenclature_id, norm_amount
            FROM ration_item WHERE ration_id = v_ration_id
            ORDER BY id
        LOOP
            v_qty := ROUND(p_actual_amount * item.norm_amount / v_total_norm, 3);
            SELECT b.id, n.sku INTO v_batch, v_sku
            FROM stock_batch b
            JOIN stock_balance sb ON sb.batch_id = b.id
            JOIN nomenclature n ON n.id = b.nomenclature_id
            WHERE b.nomenclature_id = item.nomenclature_id
              AND b.received_at <= now()
              AND sb.qty_on_hand >= v_qty
            ORDER BY b.received_at, b.id
            LIMIT 1;
            IF v_batch IS NULL THEN
                -- Ошибка → вся транзакция (факт + списания) откатывается
                RAISE EXCEPTION 'Недостаточно остатка: номенклатура % (%), требуется %',
                    v_sku, item.nomenclature_id, v_qty;
            END IF;
            INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id,
                                        moved_at, created_by, task_execution_id, comment)
            VALUES (v_mt_issue, v_batch, v_qty, v_uom_kg, now(), p_user_id,
                    v_exec_id, 'Списание по задаче #' || p_task_id);
        END LOOP;
    END IF;

    -- 3) Статус задачи и журнал
    v_prev_status := v_task.status;
    IF v_prev_status = 'NEW' THEN
        UPDATE task SET status = 'IN_WORK' WHERE id = p_task_id;
        INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
        VALUES (p_task_id, 'NEW', 'IN_WORK', now(), p_user_id);
        v_prev_status := 'IN_WORK';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM task_animal_group g
        WHERE g.task_id = p_task_id
          AND NOT EXISTS (SELECT 1 FROM task_execution e
                          WHERE e.task_id = p_task_id AND e.group_id = g.group_id)
    ) THEN
        UPDATE task SET status = 'DONE', completed_at = now() WHERE id = p_task_id;
        INSERT INTO task_status_history (task_id, status_from, status_to, changed_at, changed_by)
        VALUES (p_task_id, v_prev_status, 'DONE', now(), p_user_id);
    END IF;

    RETURN v_exec_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Назначение выпаса: отдых участка + норма нагрузки (ТЗ п.3.4, п.4.5)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sp_move_group_to_plot(
    p_group_id BIGINT,
    p_plot_id  BIGINT,
    p_user_id  BIGINT,
    p_note     TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
    v_head       INT;
    v_area       NUMERIC;
    v_max        NUMERIC;
    v_occupied   INT;
    v_after      INT;
    v_cur_plot   BIGINT;
    v_event_id   BIGINT;
    v_gname      VARCHAR(80);
BEGIN
    IF NOT fn_has_permission(p_user_id, 'pasture:WRITE') THEN
        RAISE EXCEPTION 'Недостаточно прав: требуется право pasture:WRITE';
    END IF;

    SELECT g.name, COALESCE(h.head_count, 0) INTO v_gname, v_head
    FROM animal_group g
    LEFT JOIN v_animal_group_head_count h ON h.group_id = g.id
    WHERE g.id = p_group_id AND g.is_active AND NOT g.is_deleted;
    IF NOT FOUND OR v_head = 0 THEN
        RAISE EXCEPTION 'Группа % не найдена или неактивна', p_group_id;
    END IF;

    SELECT p.area_ha, p.max_head_per_ha, p.name INTO v_area, v_max, v_gname
    FROM pasture_plot p
    WHERE p.id = p_plot_id AND p.is_active AND NOT p.is_deleted
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Участок % не найден или неактивен', p_plot_id;
    END IF;
    IF v_area IS NULL OR v_area <= 0 THEN
        RAISE EXCEPTION 'Участок % не имеет рассчитанной площади', p_plot_id;
    END IF;

    SELECT ge.plot_id INTO v_cur_plot
    FROM grazing_event ge
    WHERE ge.group_id = p_group_id AND ge.ended_at IS NULL;
    IF v_cur_plot IS NOT NULL AND v_cur_plot = p_plot_id THEN
        RAISE EXCEPTION 'Группа % уже находится на участке %', p_group_id, p_plot_id;
    END IF;

    -- Норма нагрузки: суммарная численность ВСЕХ групп на участке (+переезжающая)
    SELECT COALESCE(SUM(head_count_snapshot), 0) INTO v_occupied
    FROM grazing_event
    WHERE plot_id = p_plot_id AND ended_at IS NULL;

    v_after := v_occupied + v_head;
    IF v_after > v_max * v_area THEN
        RAISE EXCEPTION 'Превышение нормы нагрузки: % голов на % га = % голов/га при норме % (участок %)',
            v_after, ROUND(v_area, 2), ROUND(v_after / v_area, 2), v_max, p_plot_id;
    END IF;

    -- Закрываем текущий выпас; затем вставка → триггер проверяет период отдыха.
    -- При ошибке — вся транзакция откатывается (в т.ч. закрытие).
    UPDATE grazing_event SET ended_at = now()
    WHERE group_id = p_group_id AND ended_at IS NULL;

    INSERT INTO grazing_event (group_id, plot_id, started_at, ended_at,
                               head_count_snapshot, moved_by, note)
    VALUES (p_group_id, p_plot_id, now(), NULL, v_head, p_user_id,
            COALESCE(p_note, 'Назначение выпаса (sp_move_group_to_plot)'))
    RETURNING id INTO v_event_id;

    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. Переход статуса животного по регламенту (ТЗ п.3.2, п.4.4)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sp_change_animal_status(
    p_animal_id            BIGINT,
    p_new_status           VARCHAR,
    p_user_id              BIGINT,
    p_reason               TEXT,
    p_diagnosis_id         BIGINT DEFAULT NULL,
    p_drug_nomenclature_id BIGINT DEFAULT NULL,
    p_dosage               NUMERIC DEFAULT NULL,
    p_disposal_reason_id   BIGINT DEFAULT NULL,
    p_ip                   INET DEFAULT NULL
) RETURNS VARCHAR AS $$
DECLARE
    v_old         VARCHAR;
    v_emp         BIGINT;
    v_allowed     BOOLEAN;
    v_exam_id     BIGINT;
    v_tr_id       BIGINT;
    v_withdrawal  DATE;
    v_wd_days     INT;
    v_batch       BIGINT;
    v_sku         VARCHAR;
    v_group_id    BIGINT;
    v_rtype       VARCHAR;
    v_mt_issue    BIGINT;
BEGIN
    v_emp := fn_require_user(p_user_id);

    IF NOT fn_has_permission(p_user_id, 'animal:WRITE') THEN
        RAISE EXCEPTION 'Недостаточно прав: требуется право animal:WRITE';
    END IF;
    IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'Перевод статуса требует указания причины (регламент, ТЗ п.4.4)';
    END IF;

    SELECT a.status, a.group_id INTO v_old, v_group_id
    FROM animal a WHERE a.id = p_animal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Животное % не найдено', p_animal_id;
    END IF;
    IF v_old = p_new_status THEN
        RAISE EXCEPTION 'Животное % уже в статусе «%»', p_animal_id, p_new_status;
    END IF;
    IF p_new_status NOT IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ','ВЫБРАКОВАНО','ПАДЁЖ') THEN
        RAISE EXCEPTION 'Недопустимый статус «%»', p_new_status;
    END IF;

    -- Матрица допустимых переходов (ВЫБРАКОВАНО/ПАДЁЖ — терминальные)
    v_allowed := CASE v_old
        WHEN 'ЗДОРОВ'      THEN p_new_status IN ('НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_ОСМОТРЕ'  THEN p_new_status IN ('ЗДОРОВ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_КАРАНТИНЕ' THEN p_new_status IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_ЛЕЧЕНИИ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_ЛЕЧЕНИИ'  THEN p_new_status IN ('ЗДОРОВ','НА_КАРАНТИНЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        ELSE FALSE
    END;
    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Переход «%» → «%» запрещён регламентом', v_old, p_new_status;
    END IF;

    IF p_new_status = 'НА_ЛЕЧЕНИИ' THEN
        -- Лечение требует диагноза и назначенного препарата (списывается со склада)
        IF p_diagnosis_id IS NULL OR NOT EXISTS (SELECT 1 FROM diagnosis WHERE id = p_diagnosis_id) THEN
            RAISE EXCEPTION 'Перевод «на лечении» требует диагноза';
        END IF;
        IF p_drug_nomenclature_id IS NULL OR p_dosage IS NULL OR p_dosage <= 0 THEN
            RAISE EXCEPTION 'Перевод «на лечении» требует назначенного препарата и дозировки';
        END IF;
        SELECT d.withdrawal_days, n.sku INTO v_wd_days, v_sku
        FROM drug d JOIN nomenclature n ON n.id = d.nomenclature_id
        WHERE d.nomenclature_id = p_drug_nomenclature_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Номенклатура % не является препаратом', p_drug_nomenclature_id;
        END IF;
    ELSIF p_new_status IN ('НА_КАРАНТИНЕ') THEN
        IF p_diagnosis_id IS NULL OR NOT EXISTS (SELECT 1 FROM diagnosis WHERE id = p_diagnosis_id) THEN
            RAISE EXCEPTION 'Перевод «на карантин» требует диагноза/основания';
        END IF;
    ELSIF p_new_status IN ('ВЫБРАКОВАНО', 'ПАДЁЖ') THEN
        -- Выбраковка/падёж требует причины и подтверждения зоотехником/ветеринаром
        IF p_disposal_reason_id IS NULL THEN
            RAISE EXCEPTION 'Выбытие требует причины (disposal_reason)';
        END IF;
        SELECT reason_type INTO v_rtype FROM disposal_reason WHERE id = p_disposal_reason_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Причина выбытия % не найдена', p_disposal_reason_id;
        END IF;
        IF (p_new_status = 'ВЫБРАКОВАНО' AND v_rtype <> 'CULLING')
           OR (p_new_status = 'ПАДЁЖ' AND v_rtype <> 'DEATH') THEN
            RAISE EXCEPTION 'Тип причины (%) не соответствует статусу «%»', v_rtype, p_new_status;
        END IF;
        IF EXISTS (SELECT 1 FROM disposal_event WHERE animal_id = p_animal_id) THEN
            RAISE EXCEPTION 'По животному % уже оформлено выбытие', p_animal_id;
        END IF;
    END IF;

    -- 1) Осмотр как факт обращения (для лечебных статусов)
    IF p_new_status IN ('НА_ЛЕЧЕНИИ','НА_КАРАНТИНЕ','НА_ОСМОТРЕ') THEN
        INSERT INTO examination (animal_id, examined_by, examined_at, diagnosis_id, notes, status_after)
        VALUES (p_animal_id, v_emp, now(), p_diagnosis_id, p_reason, p_new_status)
        RETURNING id INTO v_exam_id;
    END IF;

    -- 2) Назначение лечения + расход препарата + withdrawal period
    IF p_new_status = 'НА_ЛЕЧЕНИИ' THEN
        v_withdrawal := CASE WHEN v_wd_days > 0
                             THEN current_date + v_wd_days END;
        INSERT INTO treatment (examination_id, nomenclature_id, dosage, uom_id,
                               started_at, withdrawal_until, prescribed_by)
        VALUES (v_exam_id, p_drug_nomenclature_id, p_dosage,
                (SELECT uom_id FROM nomenclature WHERE id = p_drug_nomenclature_id),
                now(), v_withdrawal, v_emp)
        RETURNING id INTO v_tr_id;

        -- Атомарный расход препарата (FIFO, отказ при нехватке)
        SELECT b.id, n.sku INTO v_batch, v_sku
        FROM stock_batch b
        JOIN stock_balance sb ON sb.batch_id = b.id
        JOIN nomenclature n ON n.id = b.nomenclature_id
        WHERE b.nomenclature_id = p_drug_nomenclature_id
          AND sb.qty_on_hand >= p_dosage
        ORDER BY b.received_at, b.id
        LIMIT 1;
        IF v_batch IS NULL THEN
            RAISE EXCEPTION 'Недостаточно остатка препарата % (требуется %)', v_sku, p_dosage;
        END IF;
        SELECT id INTO v_mt_issue FROM movement_type WHERE code = 'ISSUE';
        INSERT INTO stock_movement (movement_type_id, batch_id, qty, uom_id,
                                    moved_at, created_by, treatment_id, comment)
        VALUES (v_mt_issue, v_batch, p_dosage,
                (SELECT uom_id FROM nomenclature WHERE id = p_drug_nomenclature_id),
                now(), p_user_id, v_tr_id, 'Расход по назначению лечения (животное #' || p_animal_id || ')');

        -- Система «помнит» срок ожидания: блокируем уже учтённую продукцию
        -- (будущая продукция блокируется триггером при попытке отметить READY)
        IF v_withdrawal IS NOT NULL AND v_withdrawal > current_date THEN
            UPDATE production_record
            SET status = 'BLOCKED', blocked_until = v_withdrawal
            WHERE status = 'READY'
              AND (animal_id = p_animal_id OR group_id = v_group_id)
              AND produced_at::date >= current_date - 1;
        END IF;
    END IF;

    -- 3) Выбраковка/падёж: оформление выбытия
    IF p_new_status IN ('ВЫБРАКОВАНО','ПАДЁЖ') THEN
        INSERT INTO disposal_event (animal_id, reason_id, disposal_type, disposed_at,
                                    confirmed_by, confirmed_at, notes)
        VALUES (p_animal_id, p_disposal_reason_id,
                CASE p_new_status WHEN 'ВЫБРАКОВАНО' THEN 'CULLING' ELSE 'DEATH' END,
                now(), v_emp, now(), p_reason);
    END IF;

    -- 4) Выход из лечения: закрываем незавершённые назначения
    IF p_new_status = 'ЗДОРОВ' THEN
        UPDATE treatment SET ended_at = now()
        WHERE ended_at IS NULL
          AND examination_id IN (SELECT id FROM examination WHERE animal_id = p_animal_id);
    END IF;

    -- 5) Собственно смена статуса + аудит «кто/когда/что изменил (до/после)»
    UPDATE animal SET status = p_new_status WHERE id = p_animal_id;

    INSERT INTO audit_log (user_id, entity_name, entity_id, action,
                           before_json, after_json, occurred_at, ip, is_elevated)
    VALUES (p_user_id, 'animal', p_animal_id, 'UPDATE',
            jsonb_build_object('status', v_old),
            jsonb_build_object('status', p_new_status, 'reason', p_reason,
                               'diagnosis_id', p_diagnosis_id),
            now(), p_ip, FALSE);

    RETURN p_new_status;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 4. Создание шаблона повторяющихся задач (ТЗ п.3.1: горизонт ≤ 30 дней)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sp_create_task_series(
    p_title        TEXT,
    p_task_type_id BIGINT,
    p_recurrence   VARCHAR,
    p_interval_days INT,
    p_start_date   DATE,
    p_end_date     DATE,
    p_group_ids    BIGINT[],
    p_planned_amount NUMERIC DEFAULT NULL,
    p_user_id      BIGINT DEFAULT NULL,
    p_assigned_to  BIGINT DEFAULT NULL  -- employee.id
) RETURNS BIGINT AS $$
DECLARE
    v_series_id  BIGINT;
    v_writeoff   BOOLEAN;
    v_prio       VARCHAR(6);
    v_d          DATE;
    v_g          BIGINT;
    v_step       INT;
    v_emp        BIGINT;
    v_uom_kg     BIGINT;
BEGIN
    v_emp := fn_require_user(p_user_id);

    IF NOT fn_has_permission(p_user_id, 'task:WRITE') THEN
        RAISE EXCEPTION 'Недостаточно прав: требуется право task:WRITE';
    END IF;
    IF p_recurrence NOT IN ('DAILY','WEEKLY','EVERY_N_DAYS') THEN
        RAISE EXCEPTION 'Недопустимый тип повтора «%»', p_recurrence;
    END IF;
    IF p_interval_days IS NULL OR p_interval_days < 1 THEN
        RAISE EXCEPTION 'Интервал повтора должен быть ≥ 1 дня';
    END IF;
    IF p_end_date < p_start_date THEN
        RAISE EXCEPTION 'Дата окончания раньше даты начала';
    END IF;
    IF (p_end_date - p_start_date) > 30 THEN
        RAISE EXCEPTION 'Горизонт шаблона % дн. превышает 30 дней (ТЗ п.3.1)', (p_end_date - p_start_date);
    END IF;
    IF p_group_ids IS NULL OR array_length(p_group_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'Не указаны группы';
    END IF;
    SELECT t.requires_writeoff, CASE t.default_priority WHEN 1 THEN 'HIGH' WHEN 5 THEN 'LOW' ELSE 'NORMAL' END
    INTO v_writeoff, v_prio
    FROM task_type t WHERE id = p_task_type_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Тип задачи % не найден', p_task_type_id;
    END IF;
    IF p_assigned_to IS NULL OR NOT EXISTS (SELECT 1 FROM employee WHERE id = p_assigned_to) THEN
        RAISE EXCEPTION 'Не указан исполнитель (сотрудник)';
    END IF;

    -- ТЗ п.4: кормление — только для активной группы с назначенным рационом
    IF v_writeoff THEN
        FOREACH v_g IN ARRAY p_group_ids LOOP
            IF NOT EXISTS (
                SELECT 1 FROM ration r
                WHERE r.group_id = v_g AND r.is_active AND NOT r.is_deleted
                  AND r.valid_from <= p_start_date
                  AND (r.valid_to IS NULL OR r.valid_to >= p_start_date)
            ) THEN
                RAISE EXCEPTION 'У группы % нет активного рациона', v_g;
            END IF;
        END LOOP;
        IF p_planned_amount IS NULL OR p_planned_amount <= 0 THEN
            RAISE EXCEPTION 'Для кормления требуется норма (planned_amount)';
        END IF;
        SELECT id INTO v_uom_kg FROM uom WHERE code = 'KG';
    END IF;

    INSERT INTO task_series (task_type_id, title, recurrence, interval_days,
                             start_date, end_date, planned_amount, uom_id, created_by, is_active)
    VALUES (p_task_type_id, p_title, p_recurrence, p_interval_days,
            p_start_date, p_end_date, p_planned_amount, v_uom_kg, p_user_id, TRUE)
    RETURNING id INTO v_series_id;

    v_step := CASE p_recurrence WHEN 'WEEKLY' THEN 7 ELSE GREATEST(p_interval_days, 1) END;
    FOR v_d IN SELECT generate_series(p_start_date, p_end_date, (v_step || ' days')::interval)::date LOOP
        FOREACH v_g IN ARRAY p_group_ids LOOP
            INSERT INTO task (task_type_id, series_id, title, planned_date, due_at,
                              priority, status, created_by, created_at, assigned_to)
            VALUES (p_task_type_id, v_series_id,
                    p_title || ' — ' || (SELECT name FROM animal_group WHERE id = v_g),
                    v_d, v_d::timestamp + interval '12 hours',
                    v_prio, 'NEW', p_user_id, now(), p_assigned_to);
        END LOOP;
    END LOOP;

    RETURN v_series_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 5. Закрытие периода (месяца): себестоимость и FCR по группам (ТЗ п.3.1, п.8)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sp_close_period(
    p_period  DATE,
    p_user_id BIGINT
) RETURNS TABLE (
    grp_id         BIGINT,
    feed_qty       NUMERIC(12,3),
    feed_cost      NUMERIC(12,2),
    treatment_cost NUMERIC(12,2),
    head_days      INT,
    gain_kg        NUMERIC(10,2),
    fcr            NUMERIC(8,3)
) AS $$
DECLARE
    v_month    DATE;
    v_start    TIMESTAMPTZ;
    v_end      TIMESTAMPTZ;
    v_days     INT;
    v_pc_id    BIGINT;
    v_status   VARCHAR(8);
    v_locked   BOOLEAN;
BEGIN
    -- Серверная авторизация: закрытие периода — привилегия Директора
    IF NOT fn_has_permission(p_user_id, 'period:EXEC') THEN
        RAISE EXCEPTION 'Недостаточно прав: требуется право period:EXEC';
    END IF;

    v_month := date_trunc('month', p_period)::date;
    v_start := v_month::timestamp;
    v_end   := (v_month + interval '1 month')::timestamp;
    v_days  := ((v_month + interval '1 month')::date - v_month)::int;

    SELECT id, status, is_locked INTO v_pc_id, v_status, v_locked
    FROM period_closure WHERE period_month = v_month FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO period_closure (period_month, status)
        VALUES (v_month, 'OPEN')
        RETURNING id, status, is_locked INTO v_pc_id, v_status, v_locked;
    END IF;
    IF v_status = 'CLOSED' OR v_locked THEN
        RAISE EXCEPTION 'Период % уже закрыт — повторное закрытие запрещено', v_month;
    END IF;

    DELETE FROM period_group_cost WHERE period_closure_id = v_pc_id;

    WITH feed AS (
        -- Расход корма через исполнения задач (к группе), по факту движений
        SELECT te.group_id,
               SUM(sm.qty)::NUMERIC(12,3)              AS qty,
               SUM(sm.qty * sb.unit_cost)::NUMERIC(12,2) AS cost
        FROM stock_movement sm
        JOIN movement_type mt ON mt.id = sm.movement_type_id AND mt.direction = 'OUT'
        JOIN stock_batch sb   ON sb.id = sm.batch_id
        JOIN task_execution te ON te.id = sm.task_execution_id
        WHERE sm.moved_at >= v_start AND sm.moved_at < v_end
        GROUP BY te.group_id
    ),
    treat AS (
        -- Затраты на лечение (лекарства) — к группе животного
        SELECT a.group_id,
               SUM(sm.qty * sb.unit_cost)::NUMERIC(12,2) AS cost
        FROM stock_movement sm
        JOIN movement_type mt ON mt.id = sm.movement_type_id AND mt.direction = 'OUT'
        JOIN stock_batch sb   ON sb.id = sm.batch_id
        JOIN treatment t      ON t.id = sm.treatment_id
        JOIN examination e    ON e.id = t.examination_id
        JOIN animal a         ON a.id = e.animal_id
        WHERE sm.moved_at >= v_start AND sm.moved_at < v_end
          AND a.group_id IS NOT NULL
        GROUP BY a.group_id
    ),
    wg AS (
        -- Привес: последнее групповое взвешивание в периоде минус последнее до него
        SELECT w.group_id,
               (SELECT w2.weight_kg FROM animal_weighing w2
                 WHERE w2.group_id = w.group_id AND w2.method = 'GROUP_AVG'
                   AND w2.weighed_at >= v_start AND w2.weighed_at < v_end
                 ORDER BY w2.weighed_at DESC LIMIT 1) AS last_in,
               (SELECT w3.weight_kg FROM animal_weighing w3
                 WHERE w3.group_id = w.group_id AND w3.method = 'GROUP_AVG'
                   AND w3.weighed_at < v_start
                 ORDER BY w3.weighed_at DESC LIMIT 1) AS before_in
        FROM animal_weighing w
        WHERE w.group_id IS NOT NULL AND w.method = 'GROUP_AVG'
        GROUP BY w.group_id
    )
    INSERT INTO period_group_cost (period_closure_id, group_id, feed_qty, feed_cost,
                                   treatment_cost, head_days, gain_kg, fcr)
    SELECT v_pc_id, g.id,
           COALESCE(f.qty, 0),
           COALESCE(f.cost, 0),
           COALESCE(tr.cost, 0),
           v_days * COALESCE(h.head_count, 0),
           CASE WHEN wg.last_in IS NOT NULL
                THEN ROUND(wg.last_in - COALESCE(wg.before_in, wg.last_in), 2)
                ELSE 0 END,
           CASE WHEN wg.last_in IS NOT NULL
                     AND wg.last_in - COALESCE(wg.before_in, wg.last_in) > 0
                THEN ROUND(COALESCE(f.qty, 0) /
                           (wg.last_in - COALESCE(wg.before_in, wg.last_in)), 3)
           END
    FROM animal_group g
    LEFT JOIN v_animal_group_head_count h ON h.group_id = g.id
    LEFT JOIN feed f  ON f.group_id  = g.id
    LEFT JOIN treat tr ON tr.group_id = g.id
    LEFT JOIN wg ON wg.group_id = g.id
    WHERE g.is_active AND NOT g.is_deleted;

    UPDATE period_closure
    SET status = 'CLOSED', closed_by = p_user_id, closed_at = now(), is_locked = TRUE
    WHERE id = v_pc_id;

    RETURN QUERY
    SELECT pgc.group_id, pgc.feed_qty, pgc.feed_cost, pgc.treatment_cost,
           pgc.head_days, pgc.gain_kg, pgc.fcr
    FROM period_group_cost pgc
    WHERE pgc.period_closure_id = v_pc_id
    ORDER BY pgc.group_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Комментарии функций (видны в pg_description, используются генератором docs)
-- ---------------------------------------------------------------------------

COMMENT ON FUNCTION fn_has_permission(BIGINT, TEXT) IS
    'Серверная авторизация: есть ли у пользователя право из матрицы role_permission';

COMMENT ON FUNCTION fn_require_user(BIGINT) IS 'Возвращает id сотрудника учётной записи; исключение, если это не сотрудник';

COMMENT ON FUNCTION sp_execute_task(BIGINT, BIGINT, NUMERIC, BIGINT, TEXT) IS
    'Отметка выполнения задачи бригадиром: факт по группе + атомарное списание корма со склада (FIFO), отказ при нехватке остатка';

COMMENT ON FUNCTION sp_move_group_to_plot(BIGINT, BIGINT, BIGINT, TEXT) IS
    'Перевод группы на участок: проверка периода отдыха (триггер) и нормы нагрузки голов/га (процедура); закрывает предыдущий активный выпас';

COMMENT ON FUNCTION sp_change_animal_status(BIGINT, VARCHAR, BIGINT, TEXT, BIGINT, BIGINT, NUMERIC, BIGINT, INET) IS
    'Регламентированный перевод статуса животного: диагноз/причина обязательны, лечение создаёт осмотр+назначение+расход препарата+withdrawal, выбытие — причина+подтверждение; всё в аудит';

COMMENT ON FUNCTION sp_create_task_series(TEXT, BIGINT, VARCHAR, INT, DATE, DATE, BIGINT[], NUMERIC, BIGINT, BIGINT) IS
    'Шаблон повторяющихся задач (DAILY/WEEKLY/EVERY_N_DAYS) на срок до 30 дней вперёд; для кормления проверяет активный рацион у каждой группы';

COMMENT ON FUNCTION sp_close_period(DATE, BIGINT) IS
    'Закрытие периода: RBAC (право period:EXEC), расчёт фактического расхода корма/себестоимости/FCR по группам за месяц, статус CLOSED';

