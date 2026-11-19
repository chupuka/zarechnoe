-- =============================================================================
-- 0012_audit_read_pii.sql — разрешить аудит просмотра персональных данных
--
-- Проблема: GET /employees/:id/pii пишет в audit_log действие READ_PII, но
-- базовый CHECK action IN (...) его не пропускал. В итоге чтение ПДн отдавало
-- данные клиенту, а запись в аудит молча падала ("audit write failed"), т.е.
-- требование ТЗ п.7 (подотчётность просмотра ПДн) не выполнялось.
--
-- Решение: расширить список допустимых действий. Имя ограничения сохраняется,
-- поэтому миграция считается аддитивной (в снимке схемы объект не исчезает).
-- =============================================================================

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'EXPORT',
                      'OVERRIDE', 'DENY', 'READ_PII'));

COMMENT ON CONSTRAINT audit_log_action_check ON audit_log IS
    'Допустимые действия аудита, включая READ_PII — просмотр зашифрованных ПДн';

-- Проверка условия: новая версия ограничения действительно содержит READ_PII.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'audit_log_action_check'
           AND pg_get_constraintdef(oid) LIKE '%READ_PII%'
    ) THEN
        RAISE EXCEPTION 'READ_PII не добавлен в audit_log_action_check';
    END IF;
END;
$$;
