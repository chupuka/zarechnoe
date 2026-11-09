-- =============================================================================
-- Файл 03_functions_triggers.sql: функции и триггеры (бизнес-правила ТЗ).
-- Выполнять ПОСЛЕ 02_views.sql (некоторые триггеры читают VIEW).
-- =============================================================================

-- ============================== Триггеры ==============================

-- 5.1 Автоматический расчёт площади участка/границы хозяйства из геометрии
CREATE OR REPLACE FUNCTION fn_calc_area_ha() RETURNS TRIGGER AS $$
BEGIN
    NEW.area_ha := ST_Area(geography(NEW.geom)) / 10000.0;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pasture_plot_area
BEFORE INSERT OR UPDATE OF geom ON pasture_plot
FOR EACH ROW EXECUTE FUNCTION fn_calc_area_ha();

CREATE TRIGGER trg_farm_boundary_area
BEFORE INSERT OR UPDATE OF geom ON farm_boundary
FOR EACH ROW EXECUTE FUNCTION fn_calc_area_ha();

-- 5.2 Атомарное обновление остатка при каждом движении склада,
--     с запретом ухода в минус (бизнес-правило п.4.2 ТЗ)
CREATE OR REPLACE FUNCTION fn_stock_movement_apply() RETURNS TRIGGER AS $$
DECLARE
    v_dir VARCHAR(3);
    v_delta NUMERIC(10,3);
BEGIN
    SELECT direction INTO v_dir FROM movement_type WHERE id = NEW.movement_type_id;
    v_delta := CASE WHEN v_dir = 'IN' THEN NEW.qty ELSE -NEW.qty END;

    UPDATE stock_balance
       SET qty_on_hand = qty_on_hand + v_delta, updated_at = now()
     WHERE batch_id = NEW.batch_id;
    IF NOT FOUND THEN
        INSERT INTO stock_balance (batch_id, qty_on_hand, updated_at)
        VALUES (NEW.batch_id, v_delta, now());
    END IF;
    -- Отрицательный остаток отклоняется constraint'ом CHECK (qty_on_hand >= 0)
    -- на самой таблице stock_balance — INSERT/UPDATE выше упадёт с ошибкой,
    -- и вся транзакция (включая эту вставку в stock_movement) будет отменена.
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_movement_apply
AFTER INSERT ON stock_movement
FOR EACH ROW EXECUTE FUNCTION fn_stock_movement_apply();

-- 5.3 Правило ротации выпаса: запрет назначения на неотдохнувший участок
--     (бизнес-правило п.3.4.3 / п.4.5 ТЗ)
CREATE OR REPLACE FUNCTION fn_check_plot_rest() RETURNS TRIGGER AS $$
DECLARE
    v_last_end TIMESTAMPTZ;
    v_rest_days INT;
BEGIN
    -- Проверяем последний ЗАКРЫТЫЙ выпас участка, завершившийся ДО начала нового.
    -- Привязка к NEW.started_at (а не к now()) делает проверку устойчивой
    -- к порядку вставки исторических/импортируемых данных.
    SELECT p.rest_days_required INTO v_rest_days
    FROM pasture_plot p WHERE p.id = NEW.plot_id;

    SELECT ge.ended_at INTO v_last_end
    FROM grazing_event ge
    WHERE ge.plot_id = NEW.plot_id
      AND ge.ended_at IS NOT NULL
      AND ge.ended_at <= NEW.started_at
    ORDER BY ge.ended_at DESC
    LIMIT 1;

    IF v_last_end IS NOT NULL
       AND NEW.started_at < v_last_end + make_interval(days => v_rest_days) THEN
        RAISE EXCEPTION 'Участок % ещё не прошёл период отдыха (последний выпас до %, требуется % дн.)',
            NEW.plot_id, v_last_end, v_rest_days;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_grazing_event_rest_check
BEFORE INSERT ON grazing_event
FOR EACH ROW EXECUTE FUNCTION fn_check_plot_rest();

-- 5.4 Блокировка продукции по сроку ожидания (withdrawal period, п.3.2.4 / п.4.6 ТЗ)
CREATE OR REPLACE FUNCTION fn_production_withdrawal_check() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'READY' AND NEW.blocked_until IS NOT NULL AND NEW.blocked_until > CURRENT_DATE THEN
        RAISE EXCEPTION 'Продукция заблокирована сроком ожидания до %', NEW.blocked_until;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_production_record_withdrawal
BEFORE INSERT OR UPDATE OF status ON production_record
FOR EACH ROW EXECUTE FUNCTION fn_production_withdrawal_check();

-- ---------------------------------------------------------------------------
-- 4. Автоматическая заявка на закупку при остатке ниже порога (ТЗ п.3.3)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_auto_purchase_request()
RETURNS TRIGGER AS $$
DECLARE
    v_min NUMERIC;
    v_nom BIGINT;
    v_sku VARCHAR;
    v_store BIGINT;
BEGIN
    SELECT n.min_threshold, n.id, n.sku INTO v_min, v_nom, v_sku
    FROM stock_batch b
    JOIN nomenclature n ON n.id = b.nomenclature_id
    WHERE b.id = NEW.batch_id;

    IF v_min IS NULL OR v_min <= 0 OR NEW.qty_on_hand >= v_min THEN
        RETURN NEW;
    END IF;

    -- Не плодим дубли: открытая авто-заявка по номенклатуре уже есть
    IF EXISTS (SELECT 1 FROM purchase_request
               WHERE nomenclature_id = v_nom AND is_auto
                 AND status IN ('NEW','IN_WORK')) THEN
        RETURN NEW;
    END IF;

    SELECT id INTO v_store FROM app_user WHERE login = 'storekeeper' LIMIT 1;
    IF v_store IS NULL THEN
        RETURN NEW;  -- складских учёток нет (например, частичная загрузка)
    END IF;

    INSERT INTO purchase_request (nomenclature_id, requested_qty, status, is_auto,
                                  requested_by, requested_at)
    VALUES (v_nom, v_min, 'NEW', TRUE, v_store, now());

    INSERT INTO notification (user_id, type, message, related_entity, related_id)
    VALUES (v_store, 'LOW_STOCK',
            'Остаток «' || v_sku || '» ниже порога (' || NEW.qty_on_hand || ' < ' || v_min ||
            ') — создана автоматическая заявка на закупку',
            'nomenclature', v_nom);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_purchase_request ON stock_balance;
CREATE TRIGGER trg_auto_purchase_request
    AFTER INSERT OR UPDATE OF qty_on_hand ON stock_balance
    FOR EACH ROW EXECUTE FUNCTION fn_auto_purchase_request();

COMMENT ON FUNCTION fn_auto_purchase_request() IS
    'Триггер: при падении остатка ниже min_threshold автоматически создаётся заявка на закупку кладовщику (is_auto) + уведомление';
