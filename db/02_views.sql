-- =============================================================================
-- Файл 02_views.sql: представления (производные атрибуты, 3НФ).
-- Выполнять ПОСЛЕ 01_schema.sql.
-- =============================================================================

-- ============================== Представления (VIEW) ==============================
-- Ниже — производные атрибуты, сознательно вынесенные из таблиц ради 3НФ.

CREATE VIEW v_animal_group_head_count AS
SELECT g.id AS group_id, g.name, COUNT(a.id) AS head_count
FROM animal_group g
LEFT JOIN animal a ON a.group_id = g.id AND a.is_deleted = FALSE
    AND a.status NOT IN ('ВЫБРАКОВАНО','ПАДЁЖ')
GROUP BY g.id, g.name;

CREATE VIEW v_active_grazing AS
SELECT ge.group_id, ge.plot_id, p.name AS plot_name, p.area_ha, ge.started_at,
       now()::date - ge.started_at::date AS days_on_plot
FROM grazing_event ge
JOIN pasture_plot p ON p.id = ge.plot_id
WHERE ge.ended_at IS NULL;

CREATE VIEW v_plot_rest_status AS
SELECT p.id AS plot_id, p.plot_no, p.rest_days_required,
       lastuse.ended_at,
       CASE WHEN lastuse.ended_at IS NULL THEN TRUE
            ELSE (now() >= lastuse.ended_at + (p.rest_days_required || ' days')::interval)
       END AS is_rested
FROM pasture_plot p
LEFT JOIN LATERAL (
    SELECT ended_at FROM grazing_event
    WHERE plot_id = p.id AND ended_at IS NOT NULL
    ORDER BY ended_at DESC LIMIT 1
) lastuse ON TRUE;

CREATE VIEW v_vaccination_overdue AS
SELECT ve.animal_id, ve.nomenclature_id, ve.next_due_date
FROM vaccination_event ve
WHERE ve.next_due_date IS NOT NULL AND ve.next_due_date < CURRENT_DATE;

CREATE VIEW v_task_overdue AS
SELECT t.id AS task_id, t.title, t.due_at, t.assigned_to
FROM task t
WHERE t.status IN ('NEW','IN_WORK') AND t.due_at < now();

CREATE VIEW v_task_execution_deviation AS
SELECT te.id, te.task_id, te.group_id, te.planned_amount, te.actual_amount,
       (te.actual_amount - te.planned_amount) AS deviation
FROM task_execution te
WHERE te.planned_amount IS NOT NULL AND te.actual_amount IS NOT NULL;

CREATE VIEW v_stock_balance_check AS
SELECT b.batch_id, b.qty_on_hand AS balance_qty,
       COALESCE(sb.initial_qty, 0)
         + COALESCE(SUM(CASE WHEN mt.direction = 'IN' THEN sm.qty ELSE -sm.qty END), 0) AS calc_qty
FROM stock_balance b
JOIN stock_batch sb ON sb.id = b.batch_id
LEFT JOIN stock_movement sm ON sm.batch_id = b.batch_id
LEFT JOIN movement_type mt ON mt.id = sm.movement_type_id
GROUP BY b.batch_id, b.qty_on_hand, sb.initial_qty;
