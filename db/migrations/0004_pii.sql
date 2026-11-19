-- =============================================================================
-- 0004_pii.sql — шифрование персональных данных сотрудников (pgcrypto)
--
-- Ключ НЕ хранится в БД: приложение передаёт его на время транзакции через
--   SELECT set_config('app.pii_key', $1, true);
-- Без ключа расшифровка невозможна (функция падает), поэтому дамп БД
-- безопасен: в нём только bytea.
--
-- employee.phone остаётся на месте до 0010 (после переноса значений в
-- employee_pii он обнуляется скриптом scripts/seed_pii.js и затем удаляется).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE employee ADD COLUMN IF NOT EXISTS phone_mask VARCHAR(24);
ALTER TABLE employee ADD COLUMN IF NOT EXISTS dismissed_at DATE;
ALTER TABLE employee ADD COLUMN IF NOT EXISTS dismissal_reason TEXT;

CREATE TABLE IF NOT EXISTS employee_pii (
    employee_id    BIGINT PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
    phone_enc      BYTEA,
    passport_enc   BYTEA,
    address_enc    BYTEA,
    snils_enc      BYTEA,
    inn_enc        BYTEA,
    bank_enc       BYTEA,
    emergency_enc  BYTEA,
    key_version    INT NOT NULL DEFAULT 1,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by     BIGINT REFERENCES app_user(id) ON DELETE SET NULL
);

COMMENT ON TABLE employee_pii IS
    'Персональные данные сотрудников, зашифрованные pgp_sym_encrypt (AES-256)';
COMMENT ON COLUMN employee_pii.key_version IS
    'Версия ключа PII_KEY — для ротации без потери данных';

-- Ключ из сессии. Отдельная функция, чтобы сообщение об ошибке было понятным.
CREATE OR REPLACE FUNCTION fn_pii_key() RETURNS TEXT AS $$
DECLARE
    k TEXT;
BEGIN
    k := current_setting('app.pii_key', true);
    IF k IS NULL OR length(k) < 16 THEN
        RAISE EXCEPTION 'Ключ PII не установлен: выполните set_config(''app.pii_key'', ..., true)';
    END IF;
    RETURN k;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_pii_encrypt(p_text TEXT) RETURNS BYTEA AS $$
BEGIN
    IF p_text IS NULL OR btrim(p_text) = '' THEN
        RETURN NULL;
    END IF;
    RETURN pgp_sym_encrypt(p_text, fn_pii_key(), 'cipher-algo=aes256');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_pii_decrypt(p_data BYTEA) RETURNS TEXT AS $$
BEGIN
    IF p_data IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN pgp_sym_decrypt(p_data, fn_pii_key());
END;
$$ LANGUAGE plpgsql;

-- Маска телефона: +7-916-000-00-01 -> +7-***-***-00-01
CREATE OR REPLACE FUNCTION fn_phone_mask(p_phone TEXT) RETURNS TEXT AS $$
DECLARE
    s TEXT;
BEGIN
    IF p_phone IS NULL OR btrim(p_phone) = '' THEN
        RETURN NULL;
    END IF;
    s := regexp_replace(p_phone, '[^0-9+]', '', 'g');
    IF length(s) >= 6 THEN
        RETURN left(s, 2) || '-***-***-' || right(s, 4);
    END IF;
    RETURN '***';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION fn_pii_encrypt(TEXT) IS 'Шифрование ПДн ключом из app.pii_key';
COMMENT ON FUNCTION fn_pii_decrypt(BYTEA) IS 'Расшифровка ПДн ключом из app.pii_key';
COMMENT ON FUNCTION fn_phone_mask(TEXT) IS 'Маска телефона для списков (без расшифровки)';

CREATE INDEX IF NOT EXISTS ix_employee_dismissed_at ON employee (dismissed_at);
CREATE INDEX IF NOT EXISTS ix_employee_active ON employee (is_active) WHERE NOT is_deleted;
