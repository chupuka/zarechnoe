-- =============================================================================
-- 0003_indexes_analyze.sql — миграция-пример: индексы под частые запросы
--
-- Демонстрирует штатное изменение схемы на живой БД после релиза:
--   * GIN-индекс по audit_log.after_json — фильтрация аудита по содержимому;
--   * составной индекс под ленту техлога по типу события и времени.
-- Все операции с IF NOT EXISTS — миграция идемпотентна и безопасна для повтора.
-- =============================================================================

CREATE INDEX IF NOT EXISTS ix_audit_log_after_json_gin
    ON audit_log USING GIN (after_json);

CREATE INDEX IF NOT EXISTS ix_tech_log_action_time
    ON tech_log (action_type, occurred_at DESC);

COMMENT ON INDEX ix_audit_log_after_json_gin IS 'Поиск в бизнес-аудите по содержимому изменений (миграция 0003)';
COMMENT ON INDEX ix_tech_log_action_time IS 'Лента техлога по типу события (миграция 0003)';
