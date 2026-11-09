/* ИС «Заречное» — адаптивный веб-интерфейс (Неделя 7).
 * Vanilla JS ES-модуль. Только textContent/DOM для данных (защита от XSS).
 */
'use strict';

const API = '/api/v1';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
};

const state = {
    token: sessionStorage.getItem('farm_token') || null,
    user: null, permissions: new Set(), page: 'animals',
    limit: 50, offset: 0, total: 0, rows: [], series: null,
    theme: localStorage.getItem('farm_theme') || 'light',
    lang: localStorage.getItem('farm_lang') || 'ru',
    overrideReason: '',
};

const I18N = {
    ru: { login: 'Войти', logout: 'Выйти', refresh: 'Обновить', create: '+ Создать',
          search: 'Поиск…', apply: 'Применить', reset: 'Сбросить', all: 'Все',
          empty: 'Нет данных', loading: 'Загрузка…', save: 'Сохранить', cancel: 'Отмена',
          error: 'Ошибка', export: 'Экспорт CSV', map: 'Карта участков' },
    en: { login: 'Sign in', logout: 'Sign out', refresh: 'Refresh', create: '+ New',
          search: 'Search…', apply: 'Apply', reset: 'Reset', all: 'All',
          empty: 'No data', loading: 'Loading…', save: 'Save', cancel: 'Cancel',
          error: 'Error', export: 'Export CSV', map: 'Pasture map' },
};
const t = (k) => (I18N[state.lang] || I18N.ru)[k] || k;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
async function api(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (opts.reason) headers['X-Override-Reason'] = opts.reason;
    if (state.user && state.user.role && state.user.role.type === 'TECHNICAL') {
        headers['X-Override-Reason'] = opts.reason || state.overrideReason || 'Действие технической роли (UI)';
    }
    let resp;
    try {
        resp = await fetch(API + path, { method, headers,
            body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw new Error('Сеть недоступна: ' + e.message); }
    const ctype = resp.headers.get('content-type') || '';
    let data;
    if (ctype.includes('csv') || ctype.includes('text/plain')) data = await resp.text();
    else { try { data = await resp.json(); } catch (_) { data = {}; } }
    if (!resp.ok) {
        const msg = (data && data.error) || `HTTP ${resp.status}`;
        const e = new Error(msg); e.status = resp.status; e.data = data;
        if (resp.status === 401 && state.token) doLogout(true);
        throw e;
    }
    return data;
}

function toast(msg, kind = 'info') {
    const n = el('div', 'toast toast-' + kind, msg);
    $('toast').appendChild(n);
    setTimeout(() => n.remove(), 4500);
}

// ---------------------------------------------------------------------------
// Вход / выход
// ---------------------------------------------------------------------------
function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.theme);
    $('theme-toggle').checked = state.theme === 'dark';
    $('theme-label').textContent = state.theme === 'dark' ? 'Тёмная' : 'Светлая';
    localStorage.setItem('farm_theme', state.theme);
}

async function doLogin(login, password) {
    const r = await api('POST', '/auth/login', { login, password });
    state.token = r.token;
    sessionStorage.setItem('farm_token', r.token);
    state.user = r.user;
    state.permissions = new Set(r.user.permissions || []);
    await enterApp();
}

async function enterApp() {
    if (!state.user) {
        const me = await api('GET', '/auth/me');
        state.user = me; state.permissions = new Set(me.permissions || []);
    }
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    $('user-name').textContent = state.user.full_name || state.user.login;
    $('user-role').textContent = (state.user.role && (state.user.role.name || state.user.role.code)) || '—';
    applyTheme();
    renderMenu();
    if (!location.hash || location.hash === '#') location.hash = '#/animals';
    else renderRoute();
}

function doLogout(silent) {
    if (!silent && state.token) api('POST', '/auth/logout', {}).catch(() => {});
    state.token = null; state.user = null; state.permissions = new Set();
    sessionStorage.removeItem('farm_token');
    $('app-view').hidden = true; $('login-view').hidden = false;
    $('login-error').hidden = true;
    $('password').value = '';
}

function renderMenu() {
    document.querySelectorAll('.nav-link').forEach((a) => {
        const need = a.dataset.permission;
        a.hidden = need ? !state.permissions.has(need) : false;
    });
}

// ---------------------------------------------------------------------------
// Роутер
// ---------------------------------------------------------------------------
const PAGES = {
    animals:      { title: 'Животные', endpoint: '/animals', group: 'Реестры', cols: ['id','inventory_number','breed','group_name','birth_date','sex','status'] },
    groups:       { title: 'Группы', endpoint: '/species', group: 'Реестры', cols: ['id','code','name'] },
    inspections:  { title: 'Осмотры', endpoint: '/animals', group: 'Реестры', cols: ['id','inventory_number','status'] },
    vaccinations: { title: 'Вакцинации', endpoint: '/animals', group: 'Реестры', cols: ['id','inventory_number','status'] },
    stock:        { title: 'Склад', endpoint: '/stock/batches', group: 'Реестры', cols: ['id','batch_number','nomenclature','warehouse','qty_on_hand','unit_cost'] },
    plots:        { title: 'Участки', endpoint: '/pasture-plots', group: 'Реестры', cols: ['id','plot_no','name','area_ha','max_head_per_ha','active_head_count'], map: true },
    tasks:        { title: 'Задачи', endpoint: '/tasks', group: 'Реестры', cols: ['id','title','task_type','assignee','planned_date','status','priority'] },
    employees:    { title: 'Сотрудники', endpoint: '/employees', group: 'Реестры', cols: ['id','full_name','position_id','phone','hire_date','is_active'] },
    grazing:      { title: 'Выпас', endpoint: '/pasture-plots', group: 'Операции', cols: ['plot_no','area_ha','active_head_count','rest_days_required'], map: true, grazing: true },
    movements:    { title: 'Движения склада', endpoint: '/stock/balances', group: 'Операции', cols: ['id','batch_number','nomenclature','qty_on_hand','updated_at'] },
    dashboard:    { title: 'Дашборд', endpoint: '/reports/dashboard', group: 'Аналитика', report: true, kpi: true },
    'cost-fcr':   { title: 'Себестоимость и FCR', endpoint: '/reports/cost-fcr', group: 'Аналитика', report: true },
    'herd-health':{ title: 'Здоровье поголовья', endpoint: '/reports/herd-health', group: 'Аналитика', report: true },
    'pasture-load':{ title: 'Нагрузка на пастбища', endpoint: '/reports/pasture-load', group: 'Аналитика', report: true },
    'tasks-in-work': { title: 'Задачи в работе', endpoint: '/reports/tasks-in-work', group: 'Аналитика', report: true },
    'stock-turnover': { title: 'Остатки склада', endpoint: '/reports/stock-turnover', group: 'Аналитика', report: true },
    users:        { title: 'Пользователи', endpoint: '/admin/users', group: 'Администрирование', cols: ['id','login','full_name','role_name','is_active','last_login_at'] },
    roles:        { title: 'Роли и права', endpoint: '/admin/roles', group: 'Администрирование', cols: ['id','code','name','role_type','permission_count','user_count'] },
    audit:        { title: 'Журнал аудита', endpoint: '/admin/audit-log', group: 'Администрирование', cols: ['id','occurred_at','login','entity_name','action','is_elevated','override_reason'] },
    settings:     { title: 'Настройки', endpoint: '/admin/settings', group: 'Администрирование', cols: ['setting_key','value_type','value_text','value_num','description','updated_at'] },
    backups:      { title: 'Резервные копии', endpoint: '/tech/backups', group: 'Технадминка', cols: ['id','backup_type','started_at','status','size_bytes','checksum'] },
    restores:     { title: 'Восстановления', endpoint: '/tech/restores', group: 'Технадминка', cols: ['id','backup_job_id','started_at','status','reason'] },
    'tech-log':   { title: 'Технический лог', endpoint: '/tech/log', group: 'Технадминка', cols: ['id','occurred_at','action_type','admin_login','description'] },
    metrics:      { title: 'Метрики БД', endpoint: '/tech/metrics', group: 'Технадминка', kpi: true },
};

function renderRoute() {
    const key = (location.hash || '#/animals').replace(/^#\/?/, '') || 'animals';
    const page = PAGES[key] || PAGES.animals;
    state.page = key; state.offset = 0; state.rows = []; state.series = null;
    $('page-title').textContent = page.title;
    $('page-eyebrow').textContent = page.group;
    document.querySelectorAll('.nav-link').forEach((a) =>
        a.classList.toggle('active', a.dataset.view === key));
    $('filters-extra').hidden = !page.grazing;
    $('create-btn').hidden = !!page.report || key === 'metrics' || key === 'audit';
    if (page.grazing) buildGrazingExtra();
    loadData();
}

function buildGrazingExtra() {
    const box = $('filters-extra'); box.replaceChildren();
    box.appendChild(el('span', 'hint', 'Перевод группы на отдохнувший участок:'));
    const inp = el('input', 'field-input'); inp.type = 'number'; inp.id = 'graze-group';
    inp.placeholder = 'ID группы';
    const sel = el('select', 'field-input'); sel.id = 'graze-plot';
    for (const r of state.rows) {
        const o = el('option', null, `${r.plot_no} · ${r.area_ha || '?'} га`);
        o.value = r.id; sel.appendChild(o);
    }
    const btn = el('button', 'btn btn-primary', 'Перевести');
    btn.type = 'button';
    btn.onclick = moveGroup;
    box.append(inp, sel, btn);
}

async function moveGroup() {
    const gid = Number($('graze-group').value), pid = Number($('graze-plot').value);
    if (!gid || !pid) return toast('Укажите группу и участок', 'warn');
    try {
        await api('POST', '/grazing/move', { group_id: gid, plot_id: pid },
                  { reason: 'Назначение выпаса из интерфейса' });
        toast('Группа переведена на участок', 'ok'); loadData();
    } catch (e) { toast(e.message, 'err'); }
}

function queryString() {
    const p = new URLSearchParams();
    p.set('limit', String(state.limit)); p.set('offset', String(state.offset));
    const q = $('filter-search').value.trim(); if (q) p.set('q', q);
    const from = $('filter-from').value; if (from) p.set('from', from);
    const to = $('filter-to').value; if (to) p.set('to', to);
    const st = $('filter-status').value; if (st) p.set('status', st);
    return p.toString();
}

async function loadData() {
    const page = PAGES[state.page] || PAGES.animals;
    const view = $('view');
    view.setAttribute('aria-busy', 'true');
    view.replaceChildren(el('div', 'loading', t('loading')));
    $('map-container').hidden = true;
    $('chart-panel').hidden = true;
    try {
        const r = await api('GET', page.endpoint + '?' + queryString());
        state.rows = Array.isArray(r.data) ? r.data : (r.data ? [r.data] : []);
        state.total = r.total != null ? r.total : state.rows.length;
        state.series = r.series || null;
        if (page.report || page.kpi) renderReport(page, r);
        else renderTable(page);
        if (page.map) renderMap();
        if (page.grazing) buildGrazingExtra();
        updatePager();
    } catch (e) {
        view.replaceChildren(el('div', 'empty-state', e.message));
    } finally {
        view.setAttribute('aria-busy', 'false');
    }
}

function renderTable(page) {
    const view = $('view'); view.replaceChildren();
    if (!state.rows.length) { view.appendChild(el('div', 'empty-state', t('empty'))); return; }
    const wrap = el('div', 'table-wrap');
    const table = el('table', 'data-table');
    const cols = page.cols || Object.keys(state.rows[0]).filter((k) => k !== 'total').slice(0, 10);
    const thead = el('thead'); const hr = el('tr');
    cols.forEach((c) => hr.appendChild(el('th', null, c)));
    hr.appendChild(el('th', null, '···'));
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of state.rows) {
        const tr = el('tr');
        cols.forEach((c) => {
            const td = el('td');
            const v = row[c];
            if (c === 'status' && v) td.appendChild(el('span', 'badge status-' + String(v).toLowerCase(), v));
            else if (typeof v === 'boolean') td.appendChild(el('span', 'badge', v ? 'да' : 'нет'));
            else if (v === null || v === undefined || v === '') td.textContent = '—';
            else td.textContent = typeof v === 'object' ? JSON.stringify(v) : String(v);
            td.dataset.label = c;
            tr.appendChild(td);
        });
        const act = el('td');
        const b = el('button', 'btn btn-ghost btn-sm', '✎'); b.type = 'button';
        b.onclick = () => openModal(row);
        act.appendChild(b); tr.appendChild(act);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody); wrap.appendChild(table); view.appendChild(wrap);
}

function renderReport(page, r) {
    const view = $('view'); view.replaceChildren();
    const data = r.data || [];
    if (page.kpi) {
        const grid = el('div', 'kpi-grid');
        const src = Array.isArray(data) && data.length === 1 && typeof data[0] === 'object'
            ? Object.entries(data[0]) : (r.series && r.series.summary ? Object.entries(r.series.summary) : []);
        for (const [k, v] of src.slice(0, 12)) {
            const card = el('div', 'kpi-card');
            card.append(el('span', 'kpi-label', k), el('strong', 'kpi-value',
                typeof v === 'object' ? JSON.stringify(v) : String(v)));
            grid.appendChild(card);
        }
        view.appendChild(grid);
    }
    if (Array.isArray(data) && data.length && typeof data[0] === 'object' && !page.kpi) {
        const page2 = { cols: Object.keys(data[0]).filter((k) => typeof data[0][k] !== 'object').slice(0, 9) };
        state.total = data.length;
        renderTable(page2);
        const box = $('view');
        const btn = el('button', 'btn btn-ghost', t('export'));
        btn.type = 'button';
        btn.onclick = () => exportCsv(page.endpoint);
        box.appendChild(btn);
    }
    // График
    const s = r.series || {};
    const series = s.by_month || s.stock_trend || s.bars || s.by_status || s.by_assignee || null;
    if (series && series.length) drawChart(series, page.title);
}

function drawChart(series, title) {
    const canvas = $('chart-canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, pad = 44;
    ctx.clearRect(0, 0, W, H);
    const keys = Object.keys(series[0]).filter((k) => typeof series[0][k] === 'number');
    if (!keys.length) return;
    const key = keys.includes('issued') ? 'issued' : keys[0];
    const vals = series.map((p) => Number(p[key]) || 0);
    const max = Math.max(...vals, 1), min = Math.min(...vals, 0);
    const span = max - min || 1;
    ctx.strokeStyle = '#2E7D32'; ctx.lineWidth = 2; ctx.beginPath();
    series.forEach((p, i) => {
        const x = pad + (W - 2 * pad) * (series.length === 1 ? 0.5 : i / (series.length - 1));
        const y = H - pad - (H - 2 * pad) * ((Number(p[key]) || 0) - min) / span;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        ctx.fillStyle = '#1B5E20'; ctx.fillRect(x - 2, y - 2, 4, 4);
    });
    ctx.stroke();
    ctx.fillStyle = '#555'; ctx.font = '12px system-ui';
    ctx.fillText(String(key), pad, 18);
    ctx.fillText(String(max), 4, pad); ctx.fillText(String(min), 4, H - pad);
    $('chart-title').textContent = title + ' · ' + key;
    $('chart-meta').textContent = `${series.length} точек`;
    $('chart-panel').hidden = false;
}

async function exportCsv(endpoint) {
    try {
        const text = await api('GET', endpoint + '?format=csv&' + queryString());
        const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = endpoint.split('/').pop() + '.csv';
        a.click(); URL.revokeObjectURL(a.href);
        toast('CSV выгружен', 'ok');
    } catch (e) { toast(e.message, 'err'); }
}

// ---------------------------------------------------------------------------
// Карта хозяйства (Leaflet + OSM)
// ---------------------------------------------------------------------------
let map = null, mapLayer = null;
function renderMap() {
    $('map-container').hidden = false;
    if (typeof L === 'undefined') {
        $('map').replaceChildren(el('div', 'empty-state', 'Leaflet не загрузился (нет сети) — карта недоступна'));
        return;
    }
    if (!map) {
        map = L.map('map').setView([55.0, 37.0], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { attribution: '© OpenStreetMap', maxZoom: 18 }).addTo(map);
        mapLayer = L.layerGroup().addTo(map);
    } else { mapLayer.clearLayers(); setTimeout(() => map.invalidateSize(), 50); }
    let bounds = null;
    for (const p of state.rows) {
        if (!p.geom_wkt) continue;
        const m = String(p.geom_wkt).match(/POLYGON\s*\(\(([^)]+)\)\)/i);
        if (!m) continue;
        const latlngs = m[1].split(',').map((pair) => {
            const [lon, lat] = pair.trim().split(/\s+/).map(Number);
            return [lat, lon];
        }).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
        if (latlngs.length < 3) continue;
        const over = p.over_limit || p.risk === 'OVERGRAZING';
        const polygon = L.polygon(latlngs, {
            color: over ? '#C62828' : '#2E7D32', weight: 2,
            fillColor: over ? '#EF9A9A' : '#A5D6A7', fillOpacity: 0.45,
        }).addTo(mapLayer);
        polygon.bindPopup(`${p.plot_no || ''} · ${p.area_ha ?? '?'} га` +
            (p.active_head_count != null ? ` · ${p.active_head_count} гол.` : ''));
        bounds = bounds ? bounds.extend(polygon.getBounds()) : polygon.getBounds();
    }
    if (bounds) map.fitBounds(bounds, { padding: [24, 24] });
}

// ---------------------------------------------------------------------------
// Модалка создания/редактирования
// ---------------------------------------------------------------------------
let modalCtx = null;
function openModal(row) {
    const page = PAGES[state.page] || PAGES.animals;
    modalCtx = { row, endpoint: page.endpoint };
    $('modal-title').textContent = row && row.id ? `Редактирование #${row.id}` : t('create');
    $('modal-fields').replaceChildren();
    $('modal-error').hidden = true;
    const spec = row && row.id
        ? Object.entries(row).filter(([k, v]) => !['id','total','created_at','updated_at','breed','group_name','task_type','assignee','nomenclature','warehouse','plot_name','role_name','admin_login','updated_by_login','file_path','checksum'].includes(k)
            && (v === null || ['string','number','boolean'].includes(typeof v))).slice(0, 8)
        : (page.cols || ['name']).filter((c) => c !== 'id').slice(0, 6).map((c) => [c, '']);
    for (const [k, v] of spec) {
        const label = el('label', 'field'); label.appendChild(el('span', 'field-label', k));
        const input = el('input', 'field-input'); input.name = k;
        input.value = v === null || v === undefined ? '' : String(v);
        if (typeof v === 'boolean') { input.type = 'checkbox'; input.checked = !!v; }
        label.appendChild(input); $('modal-fields').appendChild(label);
    }
    const technical = state.user && state.user.role && state.user.role.type === 'TECHNICAL';
    $('override-reason-field').hidden = !technical;
    $('modal').hidden = false;
}

function closeModal() { $('modal').hidden = true; modalCtx = null; }

async function submitModal(ev) {
    ev.preventDefault();
    if (!modalCtx) return;
    const body = {};
    $('modal-fields').querySelectorAll('input').forEach((i) => {
        if (i.type === 'checkbox') body[i.name] = i.checked;
        else if (i.value !== '') body[i.name] = isNaN(Number(i.value)) || i.value.trim() === ''
            ? i.value : Number(i.value);
    });
    const reason = $('override-reason').value.trim() || state.overrideReason;
    if ($('override-reason-field').hidden === false && !reason) {
        $('modal-error').textContent = 'Укажите причину действия технической роли';
        $('modal-error').hidden = false; return;
    }
    try {
        const id = modalCtx.row && modalCtx.row.id;
        await api(id ? 'PATCH' : 'POST', modalCtx.endpoint + (id ? '/' + id : ''),
                  body, { reason });
        toast('Сохранено', 'ok'); closeModal(); loadData();
    } catch (e) {
        $('modal-error').textContent = e.message;
        $('modal-error').hidden = false;
    }
}

// ---------------------------------------------------------------------------
// Пагинация, фильтры, hotkeys
// ---------------------------------------------------------------------------
function updatePager() {
    const pages = Math.max(1, Math.ceil(state.total / state.limit));
    const cur = Math.floor(state.offset / state.limit) + 1;
    $('pager-info').textContent = `Всего: ${state.total}`;
    $('pager-page').textContent = `${cur} / ${pages}`;
    $('pager-prev').disabled = state.offset <= 0;
    $('pager-next').disabled = cur >= pages;
}
$('pager-prev').onclick = () => { state.offset = Math.max(0, state.offset - state.limit); loadData(); };
$('pager-next').onclick = () => { state.offset += state.limit; loadData(); };
$('filters-apply').onclick = () => { state.offset = 0; loadData(); };
$('filters-reset').onclick = () => {
    ['filter-search','filter-from','filter-to','filter-status'].forEach((id) => { $(id).value = ''; });
    state.offset = 0; loadData();
};
$('filter-limit').onchange = (e) => { state.limit = Number(e.target.value) || 50; state.offset = 0; loadData(); };
$('filter-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { state.offset = 0; loadData(); } });
$('refresh-btn').onclick = loadData;
$('create-btn').onclick = () => openModal(null);
$('modal-close').onclick = closeModal;
$('modal-form').onsubmit = submitModal;
$('modal').addEventListener('click', (e) => { if (e.target === $('modal') || e.target.dataset.modalClose) closeModal(); });
$('map-close').onclick = () => { $('map-container').hidden = true; };
$('logout-btn').onclick = () => doLogout(false);
$('theme-toggle').onchange = () => { state.theme = $('theme-toggle').checked ? 'dark' : 'light'; applyTheme(); };
$('help-open').onclick = () => $('help-dialog').showModal();
$('help-close').onclick = () => $('help-dialog').close();
$('help-ok').onclick = () => $('help-dialog').close();
$('sidebar-toggle').onclick = () => $('sidebar').classList.toggle('open');

$('login-form').onsubmit = async (e) => {
    e.preventDefault();
    $('login-error').hidden = true;
    try { await doLogin($('login').value.trim(), $('password').value); }
    catch (err) { $('login-error').textContent = err.message; $('login-error').hidden = false; }
};

document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select') && e.key !== 'Escape') return;
    if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('filter-search').focus(); return; }
    if (e.key === '?') { e.preventDefault(); $('help-dialog').showModal(); return; }
    if (e.key === 'Escape') { closeModal(); if ($('help-dialog').open) $('help-dialog').close(); return; }
    if (e.key === '/') { e.preventDefault(); $('filter-search').focus(); return; }
    const map2 = { n: 'create-btn', r: 'refresh-btn', d: 'filters-apply',
                   i: 'filters-apply', o: 'filters-apply', w: 'filters-apply', a: 'filters-apply' };
    const id = map2[e.key.toLowerCase()];
    if (id && $(id) && !$(id).hidden) { e.preventDefault(); $(id).click(); }
});

window.addEventListener('hashchange', renderRoute);
applyTheme();
if (state.token) enterApp().catch(() => doLogout(true));
