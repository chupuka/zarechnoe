-- =============================================================================
-- 0002_db_admin.sql — Администратор БД (инструментальные таблицы)
--
-- Добавляет только ТЕХНИЧЕСКИЙ контур (не бизнес-модель):
--   * schema_migration — реестр миграций и результатов предварительной проверки;
--   * db_metric_sample — история снимков производительности БД (для графиков).
--
-- Реестр schema_migration создаётся здесь, поэтому на чистой БД этот файл
-- первым создаёт таблицу, а 0001_baseline.sql добавляет лишь расширение
-- списка action_type в tech_log.
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migration (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    version         VARCHAR(32)  NOT NULL,
    filename        VARCHAR(255) NOT NULL,
    checksum        CHAR(64)     NOT NULL,
    status          VARCHAR(12)  NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPLIED','FAILED','SKIPPED')),
    applied_by      BIGINT,
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    duration_ms     INT,
    backup_job_id   BIGINT,
    -- Результат предварительной проверки в транзакции-«сухом прогоне»
    -- (probe): ключевые объекты схемы после применения файла.
    objects_after   JSONB,
    error_message   TEXT,
    UNIQUE (version)
);
COMMENT ON TABLE schema_migration IS 'Реестр миграций схемы БД: версия, файл, контрольная сумма, результат, кто применил';

CREATE TABLE IF NOT EXISTS db_metric_sample (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    db_size_bytes       BIGINT,
    tables_count        INT,
    indexes_count       INT,
    connections         INT,
    max_connections     INT,
    active_queries      INT,
    blocked_queries     INT,
    cache_hit_ratio     NUMERIC(5,2),
    tps                 NUMERIC(12,2),
    longest_query_ms    BIGINT,
    seq_scan_ratio      NUMERIC(5,2),
    dead_rows           BIGINT,
    vacuum_lag_hours    NUMERIC(10,2),
    is_healthy          BOOLEAN
);
COMMENT ON TABLE db_metric_sample IS 'История снимков производительности БД (мониторинг администратора БД)';

CREATE INDEX IF NOT EXISTS ix_schema_migration_status ON schema_migration (status, version);
CREATE INDEX IF NOT EXISTS ix_db_metric_sample_captured_at ON db_metric_sample (captured_at DESC);
