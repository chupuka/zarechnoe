-- =============================================================================
-- 0010_drop_phone.sql — открытый телефон сотрудника больше не хранится
--
-- К этому моменту все значения перенесены в employee_pii (шифр) и
-- employee.phone_mask (маска), см. scripts/seed_pii.js.
-- Удаление колонки — гарантия того, что открытый телефон не вернётся
-- случайным INSERT/UPDATE.
-- =============================================================================

UPDATE employee
   SET phone_mask = COALESCE(phone_mask, fn_phone_mask(phone))
 WHERE phone IS NOT NULL;

ALTER TABLE employee DROP COLUMN IF EXISTS phone;

COMMENT ON COLUMN employee.phone_mask IS
    'Маска телефона для списков (+7-***-***-00-01); полный номер — только в employee_pii';
