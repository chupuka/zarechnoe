-- =============================================================================
-- 0005_animal_sales.sql — статусы «НА_ПРОДАЖЕ» и «ПРОДАН»
--
-- * расширяет CHECK-ограничения animal / animal_status_history;
-- * разрешает тип причины выбытия SALE;
-- * обновляет триггер статус-флоу и процедуру sp_change_animal_status;
-- * «активное поголовье» больше не включает проданных животных.
-- =============================================================================

ALTER TABLE animal DROP CONSTRAINT IF EXISTS animal_status_check;
ALTER TABLE animal ADD CONSTRAINT animal_status_check
    CHECK (status IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                      'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ','ПРОДАН'));

ALTER TABLE examination DROP CONSTRAINT IF EXISTS examination_status_after_check;
ALTER TABLE examination ADD CONSTRAINT examination_status_after_check
    CHECK (status_after IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                            'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ','ПРОДАН'));

ALTER TABLE disposal_reason DROP CONSTRAINT IF EXISTS disposal_reason_reason_type_check;
ALTER TABLE disposal_reason ADD CONSTRAINT disposal_reason_reason_type_check
    CHECK (reason_type IN ('CULLING','DEATH','SALE'));

ALTER TABLE disposal_event DROP CONSTRAINT IF EXISTS disposal_event_disposal_type_check;
ALTER TABLE disposal_event ADD CONSTRAINT disposal_event_disposal_type_check
    CHECK (disposal_type IN ('CULLING','DEATH','SALE'));

INSERT INTO disposal_reason (code, name, reason_type) VALUES
    ('SALE_PLAN',    'Продажа (плановая)',              'SALE'),
    ('SALE_BREEDING','Продажа племенного молодняка',    'SALE'),
    ('SALE_CULL',    'Продажа выбракованного скота',    'SALE')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Триггер статус-флоу
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_animal_status_flow_check() RETURNS TRIGGER AS $$
DECLARE
    v_allowed BOOLEAN;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    v_allowed := CASE OLD.status
        WHEN 'ЗДОРОВ'       THEN NEW.status IN ('НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                                                'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_ОСМОТРЕ'   THEN NEW.status IN ('ЗДОРОВ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                                                'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_КАРАНТИНЕ' THEN NEW.status IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_ЛЕЧЕНИИ',
                                                'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_ЛЕЧЕНИИ'   THEN NEW.status IN ('ЗДОРОВ','НА_КАРАНТИНЕ',
                                                'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_ПРОДАЖЕ'   THEN NEW.status IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                                                'ПРОДАН','ВЫБРАКОВАНО','ПАДЁЖ')
        ELSE FALSE          -- ПРОДАН / ВЫБРАКОВАНО / ПАДЁЖ — терминальные
    END;

    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Переход статуса «%» → «%» запрещён регламентом (используйте sp_change_animal_status)',
            OLD.status, NEW.status;
    END IF;

    IF NEW.status IN ('НА_ЛЕЧЕНИИ','НА_КАРАНТИНЕ') THEN
        IF NOT EXISTS (
            SELECT 1 FROM examination e
             WHERE e.animal_id = NEW.id AND e.diagnosis_id IS NOT NULL
               AND e.status_after = NEW.status
               AND e.examined_at >= now() - interval '1 minute'
        ) THEN
            RAISE EXCEPTION 'Перевод в «%» требует осмотра с диагнозом (examination)', NEW.status;
        END IF;
    ELSIF NEW.status IN ('ВЫБРАКОВАНО','ПАДЁЖ','ПРОДАН') THEN
        IF NOT EXISTS (SELECT 1 FROM disposal_event d WHERE d.animal_id = NEW.id) THEN
            RAISE EXCEPTION 'Выбытие животного требует оформленной причины (disposal_event)';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_animal_status_flow ON animal;
CREATE TRIGGER trg_animal_status_flow
    BEFORE UPDATE OF status ON animal
    FOR EACH ROW EXECUTE FUNCTION fn_animal_status_flow_check();

-- ---------------------------------------------------------------------------
-- Процедура перехода статуса
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
    IF p_new_status NOT IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                            'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ','ПРОДАН') THEN
        RAISE EXCEPTION 'Недопустимый статус «%»', p_new_status;
    END IF;

    v_allowed := CASE v_old
        WHEN 'ЗДОРОВ'      THEN p_new_status IN ('НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                                                 'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_ОСМОТРЕ'  THEN p_new_status IN ('ЗДОРОВ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                                                 'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_КАРАНТИНЕ' THEN p_new_status IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_ЛЕЧЕНИИ',
                                                  'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_ЛЕЧЕНИИ'  THEN p_new_status IN ('ЗДОРОВ','НА_КАРАНТИНЕ',
                                                 'НА_ПРОДАЖЕ','ВЫБРАКОВАНО','ПАДЁЖ')
        WHEN 'НА_ПРОДАЖЕ'  THEN p_new_status IN ('ЗДОРОВ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ','НА_ЛЕЧЕНИИ',
                                                 'ПРОДАН','ВЫБРАКОВАНО','ПАДЁЖ')
        ELSE FALSE
    END;
    IF NOT v_allowed THEN
        RAISE EXCEPTION 'Переход «%» → «%» запрещён регламентом', v_old, p_new_status;
    END IF;

    IF p_new_status = 'НА_ЛЕЧЕНИИ' THEN
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
    ELSIF p_new_status IN ('ВЫБРАКОВАНО', 'ПАДЁЖ', 'ПРОДАН') THEN
        IF p_disposal_reason_id IS NULL THEN
            RAISE EXCEPTION 'Выбытие/продажа требует причины (disposal_reason)';
        END IF;
        SELECT reason_type INTO v_rtype FROM disposal_reason WHERE id = p_disposal_reason_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Причина выбытия % не найдена', p_disposal_reason_id;
        END IF;
        IF (p_new_status = 'ВЫБРАКОВАНО' AND v_rtype <> 'CULLING')
           OR (p_new_status = 'ПАДЁЖ' AND v_rtype <> 'DEATH')
           OR (p_new_status = 'ПРОДАН' AND v_rtype <> 'SALE') THEN
            RAISE EXCEPTION 'Тип причины (%) не соответствует статусу «%»', v_rtype, p_new_status;
        END IF;
        IF EXISTS (SELECT 1 FROM disposal_event WHERE animal_id = p_animal_id) THEN
            RAISE EXCEPTION 'По животному % уже оформлено выбытие', p_animal_id;
        END IF;
    END IF;

    IF p_new_status IN ('НА_ЛЕЧЕНИИ','НА_КАРАНТИНЕ','НА_ОСМОТРЕ') THEN
        INSERT INTO examination (animal_id, examined_by, examined_at, diagnosis_id, notes, status_after)
        VALUES (p_animal_id, v_emp, now(), p_diagnosis_id, p_reason, p_new_status)
        RETURNING id INTO v_exam_id;
    END IF;

    IF p_new_status = 'НА_ЛЕЧЕНИИ' THEN
        v_withdrawal := CASE WHEN v_wd_days > 0
                             THEN current_date + v_wd_days END;
        INSERT INTO treatment (examination_id, nomenclature_id, dosage, uom_id,
                               started_at, withdrawal_until, prescribed_by)
        VALUES (v_exam_id, p_drug_nomenclature_id, p_dosage,
                (SELECT uom_id FROM nomenclature WHERE id = p_drug_nomenclature_id),
                now(), v_withdrawal, v_emp)
        RETURNING id INTO v_tr_id;

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

        IF v_withdrawal IS NOT NULL AND v_withdrawal > current_date THEN
            UPDATE production_record
            SET status = 'BLOCKED', blocked_until = v_withdrawal
            WHERE status = 'READY'
              AND (animal_id = p_animal_id OR group_id = v_group_id)
              AND produced_at::date >= current_date - 1;
        END IF;
    END IF;

    IF p_new_status IN ('ВЫБРАКОВАНО','ПАДЁЖ','ПРОДАН') THEN
        INSERT INTO disposal_event (animal_id, reason_id, disposal_type, disposed_at,
                                    confirmed_by, confirmed_at, notes)
        VALUES (p_animal_id, p_disposal_reason_id,
                CASE p_new_status WHEN 'ВЫБРАКОВАНО' THEN 'CULLING'
                                  WHEN 'ПАДЁЖ' THEN 'DEATH' ELSE 'SALE' END,
                now(), v_emp, now(), p_reason);
    END IF;

    IF p_new_status = 'ЗДОРОВ' THEN
        UPDATE treatment SET ended_at = now()
        WHERE ended_at IS NULL
          AND examination_id IN (SELECT id FROM examination WHERE animal_id = p_animal_id);
    END IF;

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
-- VIEW: активное поголовье без проданных/выбывших
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_animal_group_head_count AS
SELECT g.id AS group_id, g.name, COUNT(a.id) AS head_count
FROM animal_group g
LEFT JOIN animal a ON a.group_id = g.id
    AND NOT a.is_deleted
    AND a.status NOT IN ('ВЫБРАКОВАНО','ПАДЁЖ','ПРОДАН')
WHERE NOT g.is_deleted
GROUP BY g.id, g.name;

COMMENT ON VIEW v_animal_group_head_count IS
    'Поголовье по группам (без выбывших и проданных животных)';
