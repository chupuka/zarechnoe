-- =============================================================================
-- 0008_perf_overview.sql — служебное: индексы, представления для экранов,
--                          пороги производительности
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Индексы под фильтры интерфейса
-- ---------------------------------------------------------------------------
-- «Нарушения» в аудите — отдельный частичный индекс: таких записей мало,
-- а ищем их часто.
CREATE INDEX IF NOT EXISTS ix_audit_deny_time
    ON audit_log (occurred_at DESC) WHERE action = 'DENY';

CREATE INDEX IF NOT EXISTS ix_audit_entity_time
    ON audit_log (entity_name, occurred_at DESC);

-- Животные: фильтры «статус», «без закрепления», «на продажу».
CREATE INDEX IF NOT EXISTS ix_animal_status_active
    ON animal (status) WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS ix_employee_active_pos
    ON employee (position_id, is_active) WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS ix_app_user_online
    ON user_session (user_id, last_seen_at DESC) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Пороги «быстро/медленно» для страницы метрик
-- ---------------------------------------------------------------------------
INSERT INTO farm_settings (setting_key, value_type, value_num, description, updated_by)
SELECT 'perf_slow_ms', 'NUM', 300, 'Порог «медленного» запроса к БД, мс',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'perf_slow_ms');

INSERT INTO farm_settings (setting_key, value_type, value_num, description, updated_by)
SELECT 'perf_p95_ok_ms', 'NUM', 100, 'p95 SQL, до которого БД считается быстрой, мс',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'perf_p95_ok_ms');

INSERT INTO farm_settings (setting_key, value_type, value_num, description, updated_by)
SELECT 'perf_p95_warn_ms', 'NUM', 300, 'p95 SQL, после которого требуется оптимизация, мс',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'perf_p95_warn_ms');

INSERT INTO farm_settings (setting_key, value_type, value_num, description, updated_by)
SELECT 'online_window_min', 'NUM', 15, 'Окно «сейчас в сети», минуты',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'online_window_min');

-- ---------------------------------------------------------------------------
-- 3. Представление сотрудников: маска телефона, закрепления, онлайн
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_employee_overview AS
SELECT e.id,
       e.full_name,
       e.position_id,
       p.name                                   AS position_name,
       p.code                                   AS position_code,
       e.phone_mask,
       e.hire_date,
       e.is_active,
       e.is_deleted,
       e.dismissed_at,
       e.dismissal_reason,
       (SELECT count(*)::int FROM animal_assignment aa
         WHERE aa.employee_id = e.id AND aa.ended_at IS NULL)  AS assigned_count,
       EXISTS (SELECT 1 FROM app_user u
                 JOIN user_session s ON s.user_id = u.id
                WHERE u.employee_id = e.id
                  AND u.is_active AND NOT u.is_deleted
                  AND s.revoked_at IS NULL AND s.expires_at > now()
                  AND s.last_seen_at > now() - interval '15 minutes') AS is_online,
       (SELECT max(s.last_seen_at) FROM app_user u
          JOIN user_session s ON s.user_id = u.id
         WHERE u.employee_id = e.id)                       AS last_seen_at,
       EXISTS (SELECT 1 FROM employee_pii pi WHERE pi.employee_id = e.id) AS has_pii,
       (SELECT count(*)::int FROM app_user u
         WHERE u.employee_id = e.id AND NOT u.is_deleted)  AS accounts_count
FROM employee e
LEFT JOIN position p ON p.id = e.position_id;

COMMENT ON VIEW v_employee_overview IS
    'Сотрудники для реестра: маска телефона, число закреплений, признак «в сети»';

-- ---------------------------------------------------------------------------
-- 4. Представление учётных записей: роль, блокировка, онлайн, сессии
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_user_overview AS
SELECT u.id,
       u.login,
       u.full_name,
       u.role_id,
       r.code                                   AS role_code,
       r.name                                   AS role_name,
       u.employee_id,
       e.full_name                              AS employee_name,
       u.is_active,
       u.is_deleted,
       u.must_change_pw,
       u.failed_cnt,
       u.locked_until,
       u.last_login_at,
       u.blocked_reason,
       u.blocked_at,
       u.deleted_at,
       u.delete_reason,
       (SELECT count(*)::int FROM user_session s
         WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now())
                                                AS sessions_count,
       EXISTS (SELECT 1 FROM user_session s
                WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now()
                  AND s.last_seen_at > now() - interval '15 minutes') AS is_online,
       (SELECT max(s.last_seen_at) FROM user_session s WHERE s.user_id = u.id) AS last_seen_at
FROM app_user u
JOIN role r ON r.id = u.role_id
LEFT JOIN employee e ON e.id = u.employee_id;

COMMENT ON VIEW v_user_overview IS
    'Учётные записи для админки: роль, блокировка с причиной, онлайн, число сессий';

-- ---------------------------------------------------------------------------
-- 5. Представление состояния парка животных — для полосы статистики
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_herd_stats AS
SELECT count(*) FILTER (WHERE NOT is_deleted)::int                       AS total,
       count(*) FILTER (WHERE NOT is_deleted AND status = 'ЗДОРОВ')::int  AS healthy,
       count(*) FILTER (WHERE NOT is_deleted AND status IN ('НА_ЛЕЧЕНИИ','НА_ОСМОТРЕ','НА_КАРАНТИНЕ'))::int AS needs_attention,
       count(*) FILTER (WHERE NOT is_deleted AND status = 'НА_ПРОДАЖЕ')::int AS for_sale,
       count(*) FILTER (WHERE NOT is_deleted AND status = 'ПРОДАН')::int  AS sold,
       count(*) FILTER (WHERE NOT is_deleted AND status = 'ПАДЁЖ')::int   AS dead,
       count(*) FILTER (WHERE NOT is_deleted AND status = 'ВЫБРАКОВАНО')::int AS culled
FROM animal;

COMMENT ON VIEW v_herd_stats IS 'Сводка по статусам животных для плашки статистики';
