-- =============================================================================
-- demo_week4_5.sql — живая демонстрация требований недель 4–5.
--
-- Заголовки шагов намеренно латиницей: русский текст в \echo ломается
-- в консоли Windows при смене кодовой страницы. Данные из БД выводятся нормально.
--
-- Запуск на docker-стенде (рекомендуется, без пароля):
--   type scripts\demo_week4_5.sql | docker exec -i farm_pg psql -U farm -d farm
--
-- или на локальной БД:
--   psql -h 127.0.0.1 -p 5432 -U postgres -d farm_demo -f scripts/demo_week4_5.sql
--
-- Всё, что меняет данные, выполняется внутри BEGIN…ROLLBACK:
-- после прогона БД остаётся в исходном состоянии.
-- =============================================================================

\echo ''
\echo '=== 1. VIEW (week 4) — head count is calculated, not stored ==='
SELECT * FROM v_animal_group_head_count ORDER BY group_id;

\echo ''
\echo '=== 2. TRANSACTION + ROLLBACK (week 5) — 100 -> 101 -> 100 ==='
BEGIN;
SELECT count(*) AS animals_before FROM animal;
INSERT INTO animal (inventory_number, breed_id, group_id, birth_date, sex, status)
VALUES ('DEMO-ROLLBACK', 1, 1, '2024-01-01', 'F', 'ЗДОРОВ');
SELECT count(*) AS animals_inside_tx FROM animal;
ROLLBACK;
SELECT count(*) AS animals_after_rollback FROM animal;

\echo ''
\echo '=== 3. STORED PROCEDURE (weeks 4-5) — rights + capacity + rest ==='
BEGIN;
SELECT sp_move_group_to_plot(4, 3, 1, 'демонстрация на защите') AS new_grazing_event_id;
SELECT group_id, plot_id, started_at, ended_at
FROM grazing_event WHERE group_id = 4 ORDER BY id DESC LIMIT 3;
ROLLBACK;
SELECT count(*) AS events_after_rollback FROM grazing_event;

\echo ''
\echo '=== 4. TRIGGER (week 5) — plot 5 has not rested, insert must fail ==='
INSERT INTO grazing_event (group_id, plot_id, head_count_snapshot, moved_by)
VALUES (4, 5, 15, 1);

\echo ''
\echo '=== 5. CHECK CONSTRAINT (week 5) — negative stock is impossible ==='
BEGIN;
UPDATE stock_balance SET qty_on_hand = -1 WHERE batch_id = 193;
ROLLBACK;

\echo ''
\echo 'Done. All changes are rolled back, database is unchanged.'
