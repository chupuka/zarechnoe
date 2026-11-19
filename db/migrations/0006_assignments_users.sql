-- =============================================================================
-- 0006_assignments_users.sql — закрепление сотрудников и управление доступом
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Закрепление сотрудников за животными
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS animal_assignment (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    animal_id   BIGINT NOT NULL REFERENCES animal(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employee(id) ON DELETE RESTRICT,
    role_code   VARCHAR(24) NOT NULL
                CHECK (role_code IN ('VET','HERDSMAN','FOREMAN','ZOOTECHNIK')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by BIGINT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    ended_at    TIMESTAMPTZ,
    note        VARCHAR(200)
);

COMMENT ON TABLE animal_assignment IS
    'Закрепление сотрудников за животными (ветеринар, скотник, бригадир, зоотехник)';

CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_active
    ON animal_assignment (animal_id, employee_id, role_code) WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_assignment_employee
    ON animal_assignment (employee_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_assignment_animal
    ON animal_assignment (animal_id) WHERE ended_at IS NULL;

CREATE OR REPLACE VIEW v_animal_assignment AS
SELECT aa.id, aa.animal_id, a.inventory_number, a.group_id, g.name AS group_name,
       aa.employee_id, e.full_name AS employee_name, p.name AS position_name,
       aa.role_code, aa.assigned_at, aa.note
FROM animal_assignment aa
JOIN animal a ON a.id = aa.animal_id
LEFT JOIN animal_group g ON g.id = a.group_id
JOIN employee e ON e.id = aa.employee_id
LEFT JOIN position p ON p.id = e.position_id
WHERE aa.ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Блокировка/удаление учётных записей с причиной
-- ---------------------------------------------------------------------------
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS blocked_by BIGINT REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_app_user_active ON app_user (is_active) WHERE NOT is_deleted;

-- ---------------------------------------------------------------------------
-- 3. Активность сессии (кто сейчас в сети)
-- ---------------------------------------------------------------------------
ALTER TABLE user_session ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
UPDATE user_session SET last_seen_at = issued_at WHERE last_seen_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_user_session_online
    ON user_session (last_seen_at) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Индексы аудита (фильтр по пользователю/действию)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_audit_user_time ON audit_log (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_action_time ON audit_log (action, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Право на просмотр ПДн
-- ---------------------------------------------------------------------------
INSERT INTO permission (code, object_name, action, description)
VALUES ('employee:PII', 'employee_pii', 'READ', 'Просмотр расшифрованных персональных данных сотрудников')
ON CONFLICT (code) DO NOTHING;

-- DIRECTOR и SUPERUSER — по умолчанию; остальным выдаётся через админку.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r CROSS JOIN permission p
WHERE p.code = 'employee:PII' AND r.code IN ('DIRECTOR','SUPERUSER')
ON CONFLICT DO NOTHING;

-- DBA управляет только учётными записями (по решению пользователя),
-- но не бизнес-таблицами: user:READ + user:WRITE.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r JOIN permission p ON p.code IN ('user:READ','user:WRITE')
WHERE r.code = 'DBA'
ON CONFLICT DO NOTHING;

-- Бригадир: работа с животными и здоровьем, а не только просмотр.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r JOIN permission p ON p.code IN ('animal:WRITE','health:WRITE')
WHERE r.code = 'FOREMAN'
ON CONFLICT DO NOTHING;

-- Ветеринар ведёт справочник диагнозов/препаратов.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r JOIN permission p ON p.code = 'catalog:WRITE'
WHERE r.code = 'VET'
ON CONFLICT DO NOTHING;

-- Бригадир видит закупки; кладовщик оформляет выпуск продукции.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r JOIN permission p ON p.code = 'purchase:READ'
WHERE r.code = 'FOREMAN'
ON CONFLICT DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r JOIN permission p ON p.code = 'product:WRITE'
WHERE r.code = 'STOREKEEPER'
ON CONFLICT DO NOTHING;
