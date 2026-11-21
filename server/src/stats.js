'use strict';

/**
 * Статистика для страниц интерфейса (ТЗ п.5 — «показатели на каждом экране»).
 *
 * Один эндпоинт GET /api/v1/stats/:section отдаёт набор карточек для конкретной
 * страницы: руководитель видит картину хозяйства, бригадир — выпас, кладовщик —
 * склад, администратор — пользователей и нарушения. Карточки, к которым у роли
 * нет прав, не отдаются вовсе (не «нули», а именно отсутствие данных —
 * меньше шума и никакой утечки).
 *
 * Каждая карточка: { key, label, value, unit?, hint?, tone? }.
 * tone: ok | warn | bad | info | null — им интерфейс красит значение.
 */

const { query } = require('./db');

/** Собрать карточку (короткая запись). */
const card = (key, label, value, opts = {}) => ({
    key,
    label,
    value: value === null || value === undefined ? '—' : value,
    unit: opts.unit || null,
    hint: opts.hint || null,
    tone: opts.tone || null,
});

/** Русское склонение по числу: 1 сотрудник, 2 сотрудника, 5 сотрудников. */
function plural(n, one, few, many) {
    const v = Math.abs(Number(n) || 0);
    const last = v % 10;
    const last2 = v % 100;
    if (last === 1 && last2 !== 11) return one;
    if (last >= 2 && last <= 4 && (last2 < 12 || last2 > 14)) return few;
    return many;
}

/** Скалярный запрос: вернуть первое значение первой строки. */
async function scalar(sql, params = []) {
    const { rows } = await query(sql, params);
    if (!rows.length) return null;
    return rows[0][Object.keys(rows[0])[0]];
}

/** Сколько записей удовлетворяют условию (универсальный помощник). */
async function countOf(table, where = '', params = []) {
    const sql = `SELECT count(*)::int AS n FROM ${table}` + (where ? ` WHERE ${where}` : '');
    return scalar(sql, params);
}

// ============================================================================
// Разделы
// ============================================================================

/** Главная: сводка по хозяйству (то, что нужно видеть при входе). */
async function mainCards(user) {
    const cards = [];
    if (user.permissions.has('animal:READ')) {
        const herd = (await query('SELECT * FROM v_herd_stats')).rows[0] || {};
        cards.push(card('herd_total', 'Поголовье', herd.total || 0, {
            unit: 'гол.',
            hint: `здоровых ${herd.healthy || 0}`,
        }));
        cards.push(card('herd_sick', 'Требуют внимания', herd.needs_attention || 0, {
            unit: 'гол.',
            tone: (herd.needs_attention || 0) > 0 ? 'warn' : 'ok',
            hint: 'лечение, осмотр, карантин',
        }));
        if ((herd.for_sale || 0) > 0) {
            cards.push(card('herd_sale', 'На продаже', herd.for_sale, { unit: 'гол.', tone: 'info' }));
        }
    }
    if (user.permissions.has('task:READ')) {
        const t = (await query(
            `SELECT count(*) FILTER (WHERE status = 'NEW')::int AS new_cnt,
                    count(*) FILTER (WHERE status = 'IN_WORK')::int AS in_work,
                    count(*) FILTER (WHERE status = 'NEW' AND planned_date < CURRENT_DATE)::int AS overdue
             FROM task`
        )).rows[0];
        cards.push(card('tasks_open', 'Задачи в работе', t.new_cnt + t.in_work, {
            unit: 'шт.',
            tone: t.overdue > 0 ? 'warn' : 'ok',
            hint: t.overdue > 0 ? `просрочено ${t.overdue}` : 'просроченных нет',
        }));
    }
    if (user.permissions.has('stock:READ')) {
        const low = await scalar(
            `SELECT count(*)::int AS n FROM (
                SELECT n.id, n.min_threshold, coalesce(sum(sb.qty_on_hand), 0) AS qty
                  FROM nomenclature n
                  LEFT JOIN stock_batch b ON b.nomenclature_id = n.id
                  LEFT JOIN stock_balance sb ON sb.batch_id = b.id
                 WHERE NOT n.is_deleted AND coalesce(n.min_threshold, 0) > 0
                 GROUP BY n.id, n.min_threshold
                HAVING coalesce(sum(sb.qty_on_hand), 0) < n.min_threshold
             ) x`);
        cards.push(card('stock_low', 'Позиции ниже минимума', low || 0, {
            unit: 'шт.',
            tone: (low || 0) > 0 ? 'warn' : 'ok',
        }));
    }
    if (user.permissions.has('backup:READ')) {
        const b = (await query(
            `SELECT max(finished_at) FILTER (WHERE status = 'OK') AS last_ok,
                    count(*) FILTER (WHERE status = 'FAILED'
                                       AND started_at > now() - interval '7 days')::int AS failed
             FROM backup_job`
        )).rows[0];
        const age = b.last_ok ? Math.floor((Date.now() - new Date(b.last_ok).getTime()) / 3600000) : null;
        cards.push(card('backup_last', 'Последняя копия', age === null ? 'нет' : `${age} ч назад`, {
            tone: age === null ? 'bad' : (age > 48 ? 'warn' : 'ok'),
            hint: b.failed ? `ошибок за неделю: ${b.failed}` : null,
        }));
    }
    if (user.permissions.has('audit:READ')) {
        const denies = await scalar(
            `SELECT count(*)::int FROM audit_log
              WHERE action = 'DENY' AND occurred_at > now() - interval '7 days'`);
        cards.push(card('audit_denies', 'Отказов в доступе', denies || 0, {
            unit: 'за 7 дн.',
            tone: (denies || 0) > 0 ? 'warn' : 'ok',
        }));
    }
    return cards;
}

/** Животные. */
async function animalCards() {
    const herd = (await query('SELECT * FROM v_herd_stats')).rows[0] || {};
    const assign = (await query(
        `SELECT count(*)::int AS total,
                count(DISTINCT animal_id)::int AS covered,
                count(DISTINCT employee_id)::int AS employees
           FROM animal_assignment WHERE ended_at IS NULL`)).rows[0];
    return [
        card('total', 'Всего голов', herd.total || 0, { unit: 'гол.' }),
        card('healthy', 'Здоровые', herd.healthy || 0, { unit: 'гол.', tone: 'ok' }),
        card('attention', 'Требуют внимания', herd.needs_attention || 0, {
            unit: 'гол.', tone: (herd.needs_attention || 0) > 0 ? 'warn' : 'ok',
        }),
        card('for_sale', 'На продаже', herd.for_sale || 0, { unit: 'гол.', tone: 'info' }),
        card('sold', 'Продано', herd.sold || 0, { unit: 'гол.' }),
        card('dead', 'Падёж', herd.dead || 0, { unit: 'гол.', tone: (herd.dead || 0) > 0 ? 'bad' : 'ok' }),
        card('culled', 'Выбраковано', herd.culled || 0, { unit: 'гол.' }),
        card('assigned', 'Под присмотром', `${assign.covered}/${herd.total || 0}`, {
            unit: 'гол.',
            hint: `${assign.employees} ${plural(assign.employees, 'сотрудник', 'сотрудника', 'сотрудников')}, закреплений ${assign.total}`,
            tone: assign.covered === herd.total ? 'ok' : 'warn',
        }),
    ];
}

/** Сотрудники. */
async function employeeCards() {
    const e = (await query(
        `SELECT count(*) FILTER (WHERE is_active AND NOT is_deleted)::int AS active,
                count(*) FILTER (WHERE NOT is_active AND NOT is_deleted)::int AS dismissed,
                count(*) FILTER (WHERE NOT is_deleted)::int AS total,
                count(*) FILTER (WHERE is_active AND NOT is_deleted
                                   AND has_pii)::int AS with_pii,
                count(*) FILTER (WHERE is_online)::int AS online
           FROM v_employee_overview`)).rows[0];
    const assigned = await scalar(
        `SELECT count(DISTINCT employee_id)::int FROM animal_assignment WHERE ended_at IS NULL`);
    return [
        card('active', 'Работают', e.active, { unit: 'чел.', tone: 'ok' }),
        card('dismissed', 'Уволены', e.dismissed, { unit: 'чел.' }),
        card('online', 'Онлайн сейчас', e.online, { unit: 'чел.', tone: e.online ? 'info' : null,
            hint: 'активность за последние 15 минут' }),
        card('with_pii', 'ПДн заполнены', `${e.with_pii}/${e.active}`, {
            unit: 'чел.',
            tone: e.with_pii === e.active ? 'ok' : 'warn',
            hint: e.with_pii === e.active ? 'все данные зашифрованы' : 'есть сотрудники без ПДн',
        }),
        card('assigned', 'Закреплены за животными', `${assigned || 0}`, {
            unit: 'из ' + e.active,
        }),
    ];
}

/** Пользователи. */
async function userCards() {
    const u = (await query(
        `SELECT count(*) FILTER (WHERE NOT is_deleted)::int AS total,
                count(*) FILTER (WHERE NOT is_deleted AND is_active)::int AS active,
                count(*) FILTER (WHERE NOT is_deleted AND NOT is_active)::int AS blocked,
                count(*) FILTER (WHERE NOT is_deleted AND is_online)::int AS online,
                count(*) FILTER (WHERE NOT is_deleted AND locked_until > now())::int AS locked,
                count(*) FILTER (WHERE NOT is_deleted AND must_change_pw)::int AS must_change
           FROM v_user_overview`)).rows[0];
    return [
        card('total', 'Всего учётных записей', u.total, { unit: 'шт.' }),
        card('active', 'Активные', u.active, { unit: 'шт.', tone: 'ok' }),
        card('blocked', 'Заблокированы', u.blocked, { unit: 'шт.', tone: u.blocked ? 'warn' : 'ok' }),
        card('locked', 'Временная блокировка', u.locked, { unit: 'шт.', tone: u.locked ? 'warn' : 'ok',
            hint: 'после неудачных входов' }),
        card('online', 'Онлайн', u.online, { unit: 'шт.', tone: u.online ? 'info' : null }),
        card('must_change', 'Сменить пароль', u.must_change, { unit: 'шт.' }),
    ];
}

/** Аудит и нарушения. */
async function auditCards() {
    const a = (await query(
        `SELECT count(*) FILTER (WHERE occurred_at > now() - interval '1 day')::int AS day,
                count(*) FILTER (WHERE action = 'DENY')::int AS denies,
                count(*) FILTER (WHERE action = 'DENY'
                                   AND occurred_at > now() - interval '1 day')::int AS denies_day,
                count(*) FILTER (WHERE is_elevated)::int AS elevated,
                count(*) FILTER (WHERE action = 'READ_PII')::int AS pii_reads,
                count(DISTINCT user_id)::int AS users
           FROM audit_log`)).rows[0];
    return [
        card('day', 'Событий за сутки', a.day, { unit: 'шт.' }),
        card('denies', 'Отказов в доступе', a.denies, {
            unit: 'всего',
            tone: a.denies_day > 0 ? 'bad' : 'ok',
            hint: `за сутки ${a.denies_day}`,
        }),
        card('pii_reads', 'Просмотры ПДн', a.pii_reads, {
            unit: 'шт.', tone: a.pii_reads > 0 ? 'info' : null,
            hint: 'расшифровка телефонов, паспортов',
        }),
        card('elevated', 'Действия с повышением', a.elevated, { unit: 'шт.',
            hint: 'технические роли с причиной' }),
        card('users', 'Активных пользователей', a.users, { unit: 'чел.' }),
    ];
}

/** Резервные копии. */
async function backupCards() {
    const b = (await query(
        `SELECT count(*) FILTER (WHERE status = 'OK')::int AS ok,
                count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
                count(*) FILTER (WHERE status = 'RUNNING')::int AS running,
                max(finished_at) FILTER (WHERE status = 'OK') AS last_ok,
                coalesce(sum(size_bytes) FILTER (WHERE status = 'OK'), 0)::bigint AS bytes
           FROM backup_job`)).rows[0];
    const r = (await query(
        `SELECT count(*)::int AS n, max(finished_at) AS last_at FROM restore_job WHERE status = 'OK'`)).rows[0];
    const failed24 = await scalar(
        `SELECT count(*)::int FROM backup_job
          WHERE status = 'FAILED' AND started_at > now() - interval '1 day'`);
    const age = b.last_ok ? Math.floor((Date.now() - new Date(b.last_ok).getTime()) / 3600000) : null;
    return [
        card('ok', 'Успешных копий', b.ok, { unit: 'шт.', tone: 'ok' }),
        card('last', 'Последняя копия', age === null ? 'нет' : `${age} ч назад`, {
            tone: age === null ? 'bad' : (age > 48 ? 'warn' : 'ok'),
            hint: b.last_ok ? new Date(b.last_ok).toLocaleString('ru-RU') : null,
        }),
        card('size', 'Объём копий',
            `${(Number(b.bytes) / (1024 * 1024)).toFixed(1)} МБ`, {}),
        card('failed', 'Ошибки за сутки', failed24 || 0, {
            unit: 'шт.', tone: (failed24 || 0) > 0 ? 'bad' : 'ok',
        }),
        card('restores', 'Восстановлений', r.n, {
            unit: 'шт.', hint: r.last_at ? `последнее ${new Date(r.last_at).toLocaleString('ru-RU')}` : 'не выполнялось',
        }),
    ];
}

/** Выпас (бригадир). */
async function pastureCards() {
    const g = (await query(
        `SELECT count(*)::int AS groups_on,
                coalesce(sum(days_on_plot), 0)::int AS days
           FROM v_active_grazing`)).rows[0];
    // Нагрузка = головы группы на активном участке / (площадь × норма голов на га).
    const loads = (await query(
        `SELECT max(ratio) AS max_ratio, count(*) FILTER (WHERE ratio > 1)::int AS over
           FROM (
             SELECT hc.head_count::numeric
                    / (p.area_ha * p.max_head_per_ha) AS ratio
               FROM v_active_grazing g
               JOIN pasture_plot p ON p.id = g.plot_id
               JOIN v_animal_group_head_count hc ON hc.group_id = g.group_id
           ) x`)).rows[0];
    const rest = await scalar(
        `SELECT count(*)::int FROM v_plot_rest_status r
          JOIN pasture_plot p ON p.id = r.plot_id
         WHERE r.is_rested AND p.is_active AND NOT p.is_deleted
           AND NOT EXISTS (SELECT 1 FROM grazing_event ge
                            WHERE ge.plot_id = p.id AND ge.ended_at IS NULL)`);
    const tasks = (await query(
        `SELECT count(*) FILTER (WHERE status = 'NEW')::int AS new_cnt,
                count(*) FILTER (WHERE status = 'NEW' AND planned_date < CURRENT_DATE)::int AS overdue
           FROM task`)).rows[0];
    return [
        card('groups', 'Групп на выпасе', g.groups_on, { unit: 'шт.' }),
        card('days', 'Суммарно дней выпаса', g.days, { unit: 'дн.' }),
        card('plots_ready', 'Участков готовы', rest || 0, {
            unit: 'шт.', tone: (rest || 0) > 0 ? 'ok' : 'warn',
            hint: 'прошёл период отдыха',
        }),
        card('overload', 'Перегрузка участков', loads.over, {
            unit: 'шт.',
            tone: loads.over > 0 ? 'bad' : 'ok',
            hint: loads.max_ratio ? `макс. нагрузка ${Number(loads.max_ratio).toFixed(2)}` : null,
        }),
        card('tasks', 'Задачи на сегодня', tasks.new_cnt, {
            unit: 'шт.', tone: tasks.overdue > 0 ? 'warn' : 'ok',
            hint: tasks.overdue > 0 ? `просрочено ${tasks.overdue}` : null,
        }),
    ];
}

/** Склад. */
async function stockCards() {
    const low = await scalar(
        `SELECT count(*)::int FROM (
            SELECT n.id, n.min_threshold, coalesce(sum(sb.qty_on_hand), 0) AS qty
              FROM nomenclature n
              LEFT JOIN stock_batch b ON b.nomenclature_id = n.id
              LEFT JOIN stock_balance sb ON sb.batch_id = b.id
             WHERE NOT n.is_deleted AND coalesce(n.min_threshold, 0) > 0
             GROUP BY n.id, n.min_threshold
            HAVING coalesce(sum(sb.qty_on_hand), 0) < n.min_threshold
         ) x`);
    const exp = await scalar(
        `SELECT count(*)::int FROM stock_batch b
          WHERE b.expiry_date IS NOT NULL
            AND b.expiry_date <= CURRENT_DATE + 30
            AND EXISTS (SELECT 1 FROM stock_balance sb WHERE sb.batch_id = b.id AND sb.qty_on_hand > 0)`);
    const pr = (await query(
        `SELECT count(*) FILTER (WHERE status = 'NEW')::int AS open,
                count(*) FILTER (WHERE is_auto AND status = 'NEW')::int AS auto
           FROM purchase_request`)).rows[0];
    const mv = await scalar(
        `SELECT count(*)::int FROM stock_movement WHERE moved_at > now() - interval '1 day'`);
    return [
        card('low', 'Ниже минимума', low || 0, { unit: 'поз.', tone: (low || 0) > 0 ? 'warn' : 'ok' }),
        card('expiring', 'Истекает за 30 дней', exp || 0, { unit: 'партий',
            tone: (exp || 0) > 0 ? 'warn' : 'ok' }),
        card('requests', 'Заявки на закупку', pr.open, { unit: 'шт.',
            hint: pr.auto ? `автоматических ${pr.auto}` : null }),
        card('movements', 'Движений за сутки', mv || 0, { unit: 'шт.' }),
    ];
}

/** Задачи. */
async function taskCards() {
    const t = (await query(
        `SELECT count(*) FILTER (WHERE status = 'NEW')::int AS new_cnt,
                count(*) FILTER (WHERE status = 'IN_WORK')::int AS work,
                count(*) FILTER (WHERE status = 'DONE')::int AS done,
                count(*) FILTER (WHERE status = 'NEW' AND planned_date < CURRENT_DATE)::int AS overdue,
                count(*) FILTER (WHERE planned_date = CURRENT_DATE)::int AS today
           FROM task`)).rows[0];
    return [
        card('today', 'На сегодня', t.today, { unit: 'шт.' }),
        card('new', 'Новые', t.new_cnt, { unit: 'шт.', tone: t.new_cnt ? 'info' : null }),
        card('work', 'В работе', t.work, { unit: 'шт.' }),
        card('overdue', 'Просрочены', t.overdue, { unit: 'шт.', tone: t.overdue ? 'bad' : 'ok' }),
        card('done', 'Выполнено', t.done, { unit: 'шт.', tone: 'ok' }),
    ];
}

const SECTIONS = {
    main: { perm: null, build: mainCards },
    animals: { perm: 'animal:READ', build: animalCards },
    employees: { perm: 'employee:READ', build: employeeCards },
    users: { perm: 'user:READ', build: userCards },
    audit: { perm: 'audit:READ', build: auditCards },
    backups: { perm: 'backup:READ', build: backupCards },
    pasture: { perm: 'animal:READ', build: pastureCards },
    stock: { perm: 'stock:READ', build: stockCards },
    tasks: { perm: 'task:READ', build: taskCards },
};

/** Список разделов, доступных роли (для навигации/подсказок UI). */
function availableSections(user) {
    return Object.entries(SECTIONS)
        .filter(([name, cfg]) => name !== 'main' && (!cfg.perm || user.permissions.has(cfg.perm)))
        .map(([name]) => name);
}

/** Построить статистику раздела. */
async function build(section, user) {
    const cfg = SECTIONS[section];
    if (!cfg) {
        const e = new Error(`Неизвестный раздел статистики: ${section}`);
        e.status = 404;
        throw e;
    }
    if (cfg.perm && !user.permissions.has(cfg.perm)) {
        const e = new Error(`Недостаточно прав для статистики «${section}»`);
        e.status = 403;
        throw e;
    }
    const cards = await cfg.build(user);
    return { section, cards, generated_at: new Date().toISOString() };
}

module.exports = { build, availableSections, SECTIONS };
