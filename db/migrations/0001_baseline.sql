-- =============================================================================
-- 0001_baseline.sql — базовая линия версионирования схемы
--
-- Файл НЕ содержит DDL: он фиксирует состояние схемы, уже созданное файлами
-- 01_schema … 05_procedures, как версию 1. Применяется один раз к уже
-- существующей БД (или автоматически пропускается на fresh install, где таблица
-- schema_migration уже заполняется runner'ом --baseline).
--
-- Дальше все изменения схемы идут ТОЛЬКО файлами 0002_*.sql, 0003_*.sql …
-- Правило изменения: НЕ править применённый файл — добавить новый.
-- =============================================================================

-- Технический лог (Неделя 6) допускает действия администратора БД по схеме.
ALTER TABLE tech_log DROP CONSTRAINT IF EXISTS tech_log_action_type_check;

ALTER TABLE tech_log ADD CONSTRAINT tech_log_action_type_check
    CHECK (action_type IN ('MIGRATION','BACKUP','RESTORE','MAINTENANCE',
                           'VACUUM','INDEX','MIGRATE','MIGRATE_SQL','ROLLBACK'));

COMMENT ON CONSTRAINT tech_log_action_type_check ON tech_log
    IS 'Типы технических событий: бэкап/restore/обслуживание + миграции схемы (изолированы от бизнес-аудита)';
