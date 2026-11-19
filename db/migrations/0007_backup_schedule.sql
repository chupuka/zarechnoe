-- =============================================================================
-- 0007_backup_schedule.sql — расписание резервного копирования
-- =============================================================================

ALTER TABLE backup_job ADD COLUMN IF NOT EXISTS origin VARCHAR(12) NOT NULL DEFAULT 'MANUAL'
    CHECK (origin IN ('MANUAL','SCHEDULE'));
ALTER TABLE restore_job ADD COLUMN IF NOT EXISTS source_file VARCHAR(500);

CREATE INDEX IF NOT EXISTS ix_backup_job_started ON backup_job (started_at DESC);
CREATE INDEX IF NOT EXISTS ix_restore_job_started ON restore_job (started_at DESC);

-- Настройки расписания (редактируются на странице «Резервные копии»)
INSERT INTO farm_settings (setting_key, value_type, value_num, description, updated_by)
SELECT 'backup_enabled', 'BOOL', 1, 'Автоматическое резервное копирование включено (1/0)',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'backup_enabled');

INSERT INTO farm_settings (setting_key, value_type, value_text, description, updated_by)
SELECT 'backup_schedule', 'TEXT', 'DAILY', 'Периодичность копий: DAILY / WEEKLY',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'backup_schedule');

INSERT INTO farm_settings (setting_key, value_type, value_text, description, updated_by)
SELECT 'backup_time', 'TEXT', '02:00', 'Время запуска копии (HH:MM)',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'backup_time');

INSERT INTO farm_settings (setting_key, value_type, value_num, description, updated_by)
SELECT 'backup_retention_days', 'NUM', 30, 'Срок хранения резервных копий, дней',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'backup_retention_days');

INSERT INTO farm_settings (setting_key, value_type, value_num, description, updated_by)
SELECT 'backup_keep_last', 'NUM', 10, 'Минимум последних копий, которые не удаляются',
       (SELECT id FROM app_user WHERE login = 'director')
WHERE NOT EXISTS (SELECT 1 FROM farm_settings WHERE setting_key = 'backup_keep_last');

COMMENT ON COLUMN backup_job.origin IS 'Кто инициировал копию: MANUAL — человек, SCHEDULE — планировщик';
