-- =============================================================================
-- 0011_constraints.sql — регламентные ограничения для админки персонала
--
-- Смысл: «неактивен» — это всегда осознанное действие с причиной. Нельзя
-- просто выключить учётную запись или уволить сотрудника, не объяснив почему.
-- Требование ТЗ п.7 (аудит и обоснованность действий) на уровне схемы.
-- =============================================================================

-- Учётная запись: is_active = FALSE допустимо только с причиной блокировки
-- (или если запись помечена как удалённая — там своя причина delete_reason).
ALTER TABLE app_user DROP CONSTRAINT IF EXISTS app_user_block_reason_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_block_reason_check
    CHECK (is_active OR is_deleted OR blocked_reason IS NOT NULL);

COMMENT ON CONSTRAINT app_user_block_reason_check ON app_user IS
    'Блокировка учётной записи обязана иметь причину (blocked_reason)';

-- Сотрудник: is_active = FALSE допустимо только с датой и причиной увольнения.
ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_dismissal_reason_check;
ALTER TABLE employee ADD CONSTRAINT employee_dismissal_reason_check
    CHECK (is_active OR is_deleted
           OR (dismissed_at IS NOT NULL AND dismissal_reason IS NOT NULL));

COMMENT ON CONSTRAINT employee_dismissal_reason_check ON employee IS
    'Увольнение сотрудника обязано иметь дату и причину';

-- Закрепление: сотрудник не может быть закреплён за выбывшим животным.
CREATE OR REPLACE FUNCTION fn_assignment_animal_active() RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    SELECT status INTO v_status FROM animal WHERE id = NEW.animal_id;
    IF v_status IN ('ВЫБРАКОВАНО', 'ПАДЁЖ', 'ПРОДАН') THEN
        RAISE EXCEPTION 'Нельзя закрепить сотрудника за животным в статусе «%»', v_status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_assignment_animal_active ON animal_assignment;
CREATE TRIGGER trg_assignment_animal_active
    BEFORE INSERT ON animal_assignment
    FOR EACH ROW EXECUTE FUNCTION fn_assignment_animal_active();

COMMENT ON FUNCTION fn_assignment_animal_active() IS
    'Закрепление сотрудника допустимо только за активным животным';

-- Выбытие животного автоматически закрывает его активные закрепления:
-- держать сотрудника за проданным/павшим животным бессмысленно, а в отчётах
-- это давало «активные» закрепления за выбывшими головами.
CREATE OR REPLACE FUNCTION fn_animal_close_assignments() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('ВЫБРАКОВАНО', 'ПАДЁЖ', 'ПРОДАН')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
        UPDATE animal_assignment
           SET ended_at = now(),
               note = COALESCE(note || '; ', '') || 'закрыто автоматически: ' || NEW.status
         WHERE animal_id = NEW.id
           AND ended_at IS NULL;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_animal_close_assignments ON animal;
CREATE TRIGGER trg_animal_close_assignments
    AFTER UPDATE OF status ON animal
    FOR EACH ROW EXECUTE FUNCTION fn_animal_close_assignments();

COMMENT ON FUNCTION fn_animal_close_assignments() IS
    'При выбытии животного закрепления сотрудников закрываются автоматически';

-- Разовая зачистка: закрыть закрепления за уже выбывшими животными.
UPDATE animal_assignment aa
   SET ended_at = now(),
       note = COALESCE(aa.note || '; ', '') || 'закрыто автоматически: ' || a.status
  FROM animal a
 WHERE a.id = aa.animal_id
   AND aa.ended_at IS NULL
   AND a.status IN ('ВЫБРАКОВАНО', 'ПАДЁЖ', 'ПРОДАН');

