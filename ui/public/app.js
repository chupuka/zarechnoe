/* ==========================================================================
 * ИС «Заречное» — интерфейсный модуль (ES-module, vanilla JS, без библиотек)
 * --------------------------------------------------------------------------
 * REST: /api/v1, Bearer-токен, X-Override-Reason для TECHNICAL-ролей.
 * Листинги: {data, total, limit, offset}; отчёты дополнительно {series}.
 * Безопасность: пользовательские данные попадают в DOM только через
 * textContent / document.createElement / setAttribute. innerHTML не
 * используется нигде — попапы Leaflet собираются из DOM-узлов.
 * ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
 * 1. Константы
 * -------------------------------------------------------------------------- */
const API_BASE = '/api/v1';
const TOKEN_KEY = 'zarechnoe.token';
const THEME_KEY = 'zarechnoe.theme';
const LANG_KEY = 'zarechnoe.lang';
const OVERRIDE_KEY = 'zarechnoe.override';
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

const ANIMAL_STATUSES = ['ЗДОРОВ', 'НА_ОСМОТРЕ', 'НА_КАРАНТИНЕ', 'НА_ЛЕЧЕНИИ', 'ВЫБРАКОВАНО', 'ПАДЁЖ'];
const TASK_STATUSES = ['NEW', 'IN_WORK', 'CLOSED', 'CANCELLED'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'];
const MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'WRITE_OFF', 'RETURN'];
const BACKUP_STATUSES = ['RUNNING', 'OK', 'FAILED'];
const AUDIT_ACTIONS = ['LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'DENY', 'EXPORT'];

/* RU/EN словарь: все динамические подписи идут через t(). */
const I18N = {
    ru: {
        'login.submit': 'Войти', 'login.login': 'Логин', 'login.password': 'Пароль',
        'login.loginPh': 'например, director', 'login.passwordPh': '••••••••',
        'login.subtitle': 'Информационная система фермерского хозяйства',
        'login.demo': 'Демо-доступ', 'login.demoHint': 'Пароль для всех ролей:',
        'login.note': 'Технические роли (superuser, dba) при записи требуют заголовок X-Override-Reason.',
        'login.footer': 'ИС «Заречное» · REST API /api/v1 · Bearer-токен',
        'login.error': 'Не удалось войти', 'logout': 'Выйти', 'refresh': 'Обновить',
        'create': '+ Создать', 'search': 'Поиск', 'searchPh': 'Поиск…',
        'from': 'С', 'to': 'По', 'status': 'Статус', 'limit': 'На странице',
        'all': 'Все', 'apply': 'Применить', 'reset': 'Сбросить',
        'actions': 'Действия', 'edit': 'Изменить', 'delete': 'Удалить', 'save': 'Сохранить',
        'cancel': 'Отмена', 'yes': 'Да', 'no': 'Нет', 'confirmDelete': 'Удалить запись?',
        'confirmDeleteMsg': 'Запись будет удалена. Отменить действие будет невозможно.',
        'prev': '← Назад', 'next': 'Вперёд →', 'total': 'Всего',
        'loading': 'Загрузка данных…', 'empty': 'Нет данных',
        'emptyMsg': 'По текущим фильтрам записей не найдено. Измените условия или сбросьте фильтры.',
        'errorTitle': 'Не удалось загрузить раздел', 'retry': 'Повторить',
        'err.network': 'Ошибка сети: сервер недоступен', 'err.generic': 'Ошибка выполнения запроса',
        'err.400': 'Некорректные данные запроса', 'err.401': 'Сессия истекла — выполните вход заново',
        'err.403': 'Недостаточно прав для выполнения операции',
        'err.404': 'Ресурс не найден', 'err.409': 'Конфликт: такая запись уже существует',
        'err.423': 'Учётная запись временно заблокирована',
        'err.428': 'Требуется причина тех. доступа (X-Override-Reason)',
        'err.500': 'Внутренняя ошибка сервера', 'err.denied': 'Раздел недоступен для вашей роли',
        'created': 'Запись создана', 'updated': 'Запись обновлена', 'deleted': 'Запись удалена',
        'done': 'Операция выполнена', 'saved': 'Настройки сохранены',
        'table.caption': 'Данные REST API', 'table.sortHint': 'Нажмите на заголовок для сортировки',
        'actions.new': 'Новая запись', 'actions.edit': 'Редактирование',
        'override.title': 'Причина тех. доступа', 'override.required': 'Укажите причину тех. доступа',
        'override.reason': 'Причина (X-Override-Reason)', 'override.send': 'Отправить',
        'override.label': 'Причина тех. доступа (X-Override-Reason)',
        'override.ph': 'Обоснование для техроли',
        'csv.export': 'Экспорт CSV', 'csv.done': 'CSV-файл сформирован',
        'csv.noPerm': 'Нет права export:EXEC — выгружаем загруженные строки локально',
        'chart.title': 'Динамика показателей', 'chart.nodata': 'Нет данных для графика',
        'chart.series': 'Ряд', 'kpi.title': 'Ключевые показатели',
        'map.show': 'Карта', 'map.hide': 'Скрыть карту', 'map.title': 'Карта пастбищ',
        'map.legend': 'OSM · Leaflet · участки /pasture-plots',
        'map.legend.loaded': 'Занят', 'map.legend.rest': 'Отдых не завершён',
        'map.legend.free': 'Свободен', 'map.legend.over': 'Перегрузка',
        'map.legend.approx': 'Контуры загружены через /pasture-plots/:id',
        'map.noLeaflet': 'Leaflet не загрузился (проверьте сеть)',
        'map.noGeom': 'Контуры участков не получены',
        'grazing.move': 'Перевести группу', 'grazing.group': 'Группа',
        'grazing.days': 'Дней на участке', 'grazing.note': 'Активные назначения выпаса',
        'grazing.derived': 'Часть показателей вычислена из доступных REST-ресурсов',
        'stock.batches': 'Партии', 'stock.balances': 'Остатки',
        'task.execute': 'Выполнить', 'task.assign': 'Назначить',
        'animal.status': 'Сменить статус', 'tech.maintenance': 'Обслуживание БД',
        'tech.restore': 'Восстановить', 'tech.backup': 'Создать копию',
        'settings.value': 'Значение', 'help.title': 'Справка · ИС «Заречное»',
        'help.hotkeys': 'Горячие клавиши', 'help.data': 'Данные и доступ',
        'help.roles': 'Демо-роли', 'help.ok': 'Понятно', 'theme.light': 'Светлая',
        'theme.dark': 'Тёмная', 'lang.switch': 'Язык', 'toast.ok': 'Готово',
        'toast.err': 'Ошибка', 'toast.warn': 'Внимание', 'toast.info': 'Информация',
        'hk.search': 'Поиск (фокус на поле)', 'hk.help': 'Открыть справку',
        'hk.receipt': 'Приход склада (RECEIPT)', 'hk.issue': 'Расход склада (ISSUE)',
        'hk.writeoff': 'Списание склада (WRITE_OFF)', 'hk.assign': 'Назначить / перевести группу',
        'hk.execute': 'Выполнить задачу / сменить статус', 'hk.focus': 'Фокус на поиске',
        'hk.new': 'Новая карточка', 'hk.refresh': 'Обновить раздел',
        'hk.close': 'Закрыть модалку / справку / карту',
        'hk.goto': 'Быстрый переход: g a — животные, g s — склад, g d — дашборд',
        'metric.summary': 'Сводка', 'report.table': 'Детализация отчёта',
        'noSelection': 'Сначала выберите строку в таблице'
    },
    en: {
        'login.submit': 'Sign in', 'login.login': 'Login', 'login.password': 'Password',
        'login.loginPh': 'e.g. director', 'login.passwordPh': '••••••••',
        'login.subtitle': 'Farm management information system',
        'login.demo': 'Demo access', 'login.demoHint': 'Password for all roles:',
        'login.note': 'Technical roles (superuser, dba) require the X-Override-Reason header on writes.',
        'login.footer': 'IS "Zarechnoye" · REST API /api/v1 · Bearer token',
        'login.error': 'Sign in failed', 'logout': 'Sign out', 'refresh': 'Refresh',
        'create': '+ Create', 'search': 'Search', 'searchPh': 'Search…',
        'from': 'From', 'to': 'To', 'status': 'Status', 'limit': 'Rows per page',
        'all': 'All', 'apply': 'Apply', 'reset': 'Reset',
        'actions': 'Actions', 'edit': 'Edit', 'delete': 'Delete', 'save': 'Save',
        'cancel': 'Cancel', 'yes': 'Yes', 'no': 'No', 'confirmDelete': 'Delete record?',
        'confirmDeleteMsg': 'The record will be deleted. This action cannot be undone.',
        'prev': '← Prev', 'next': 'Next →', 'total': 'Total',
        'loading': 'Loading data…', 'empty': 'No data',
        'emptyMsg': 'No records match the current filters. Change conditions or reset filters.',
        'errorTitle': 'Failed to load this section', 'retry': 'Retry',
        'err.network': 'Network error: server is unreachable', 'err.generic': 'Request failed',
        'err.400': 'Invalid request data', 'err.401': 'Session expired — please sign in again',
        'err.403': 'Insufficient permissions for this operation',
        'err.404': 'Resource not found', 'err.409': 'Conflict: record already exists',
        'err.423': 'Account is temporarily locked',
        'err.428': 'Technical-role reason required (X-Override-Reason)',
        'err.500': 'Internal server error', 'err.denied': 'Section is not available for your role',
        'created': 'Record created', 'updated': 'Record updated', 'deleted': 'Record deleted',
        'done': 'Operation completed', 'saved': 'Settings saved',
        'table.caption': 'REST API data', 'table.sortHint': 'Click a header to sort',
        'actions.new': 'New record', 'actions.edit': 'Edit record',
        'override.title': 'Technical access reason', 'override.required': 'Enter the technical-role reason',
        'override.reason': 'Reason (X-Override-Reason)', 'override.send': 'Send',
        'override.label': 'Technical-role reason (X-Override-Reason)',
        'override.ph': 'Justification for technical role',
        'csv.export': 'Export CSV', 'csv.done': 'CSV file generated',
        'csv.noPerm': 'No export:EXEC permission — exporting loaded rows locally',
        'chart.title': 'Trends', 'chart.nodata': 'No data for chart',
        'chart.series': 'Series', 'kpi.title': 'Key metrics',
        'map.show': 'Map', 'map.hide': 'Hide map', 'map.title': 'Pasture map',
        'map.legend': 'OSM · Leaflet · plots /pasture-plots',
        'map.legend.loaded': 'In use', 'map.legend.rest': 'Rest incomplete',
        'map.legend.free': 'Free', 'map.legend.over': 'Overloaded',
        'map.legend.approx': 'Contours loaded via /pasture-plots/:id',
        'map.noLeaflet': 'Leaflet failed to load (check network)',
        'map.noGeom': 'Plot contours were not received',
        'grazing.move': 'Move group', 'grazing.group': 'Group',
        'grazing.days': 'Days on plot', 'grazing.note': 'Active grazing assignments',
        'grazing.derived': 'Some values are derived from available REST resources',
        'stock.batches': 'Batches', 'stock.balances': 'Balances',
        'task.execute': 'Execute', 'task.assign': 'Assign',
        'animal.status': 'Change status', 'tech.maintenance': 'DB maintenance',
        'tech.restore': 'Restore', 'tech.backup': 'Create backup',
        'settings.value': 'Value', 'help.title': 'Help · IS "Zarechnoye"',
        'help.hotkeys': 'Hotkeys', 'help.data': 'Data and access',
        'help.roles': 'Demo roles', 'help.ok': 'Got it', 'theme.light': 'Light',
        'theme.dark': 'Dark', 'lang.switch': 'Language', 'toast.ok': 'Done',
        'toast.err': 'Error', 'toast.warn': 'Warning', 'toast.info': 'Info',
        'hk.search': 'Search (focus field)', 'hk.help': 'Open help',
        'hk.receipt': 'Stock receipt (RECEIPT)', 'hk.issue': 'Stock issue (ISSUE)',
        'hk.writeoff': 'Stock write-off (WRITE_OFF)', 'hk.assign': 'Assign / move group',
        'hk.execute': 'Execute task / change status', 'hk.focus': 'Focus search',
        'hk.new': 'New record', 'hk.refresh': 'Refresh section',
        'hk.close': 'Close modal / help / map',
        'hk.goto': 'Quick nav: g a — animals, g s — stock, g d — dashboard',
        'metric.summary': 'Summary', 'report.table': 'Report details',
        'noSelection': 'Select a table row first'
    }
};

/* Подписи колонок: ключ API → [RU, EN]. Неизвестные ключи очеловечиваются. */
const COLUMN_LABELS = {
    id: ['ID', 'ID'], inventory_number: ['Инв. номер', 'Inventory no.'],
    birth_date: ['Дата рождения', 'Birth date'], sex: ['Пол', 'Sex'],
    status: ['Статус', 'Status'], arrival_date: ['Дата поступления', 'Arrival date'],
    group_id: ['ID группы', 'Group ID'], group_name: ['Группа', 'Group'],
    breed_id: ['ID породы', 'Breed ID'], breed: ['Порода', 'Breed'],
    species_id: ['ID вида', 'Species ID'], name: ['Наименование', 'Name'],
    code: ['Код', 'Code'], is_deleted: ['Удалено', 'Deleted'],
    is_active: ['Активно', 'Active'], created_at: ['Создано', 'Created'],
    updated_at: ['Обновлено', 'Updated'], avg_daily_gain: ['Ср. прирост', 'Avg. daily gain'],
    plot_no: ['№ участка', 'Plot no.'], plot_id: ['ID участка', 'Plot ID'],
    plot_name: ['Участок', 'Plot'], area_ha: ['Площадь, га', 'Area, ha'],
    max_head_per_ha: ['Норма гол/га', 'Norm head/ha'],
    active_head_count: ['Голов сейчас', 'Heads now'],
    active_heads: ['Голов сейчас', 'Heads now'],
    rest_days_required: ['Дней отдыха', 'Rest days'], rest_ok: ['Отдых пройден', 'Rested'],
    vegetation_type: ['Тип травостоя', 'Vegetation'], in_use: ['В использовании', 'In use'],
    geom_wkt: ['Контур (WKT)', 'Contour (WKT)'],
    batch_number: ['№ партии', 'Batch no.'], batch_id: ['ID партии', 'Batch ID'],
    nomenclature_id: ['ID номенклатуры', 'Nomenclature ID'],
    nomenclature: ['Номенклатура', 'Nomenclature'], sku: ['Артикул', 'SKU'],
    warehouse_id: ['ID склада', 'Warehouse ID'], warehouse: ['Склад', 'Warehouse'],
    supplier_id: ['ID поставщика', 'Supplier ID'], supplier: ['Поставщик', 'Supplier'],
    received_at: ['Принято', 'Received'], expiry_date: ['Годен до', 'Expiry'],
    unit_cost: ['Цена ед.', 'Unit cost'], initial_qty: ['Нач. кол-во', 'Initial qty'],
    qty_on_hand: ['Остаток', 'On hand'], category: ['Категория', 'Category'],
    title: ['Заголовок', 'Title'], task_type: ['Тип задачи', 'Task type'],
    task_type_id: ['ID типа задачи', 'Task type ID'], assignee: ['Исполнитель', 'Assignee'],
    assigned_to: ['ID исполнителя', 'Assignee ID'], priority: ['Приоритет', 'Priority'],
    planned_date: ['План. дата', 'Planned date'], due_at: ['Срок', 'Due at'],
    completed_at: ['Завершено', 'Completed'], requires_writeoff: ['Списание корма', 'Feed write-off'],
    full_name: ['ФИО', 'Full name'], position_id: ['ID должности', 'Position ID'],
    phone: ['Телефон', 'Phone'], hire_date: ['Дата приёма', 'Hire date'],
    login: ['Логин', 'Login'], role_id: ['ID роли', 'Role ID'],
    role_code: ['Роль', 'Role'], role_name: ['Роль', 'Role'], role_type: ['Тип роли', 'Role type'],
    employee_id: ['ID сотрудника', 'Employee ID'], employee_name: ['Сотрудник', 'Employee'],
    must_change_pw: ['Смена пароля', 'Must change pw'], failed_cnt: ['Неуд. входы', 'Failed logins'],
    locked_until: ['Блокировка до', 'Locked until'], last_login_at: ['Последний вход', 'Last login'],
    occurred_at: ['Когда', 'Occurred at'], user_id: ['ID пользователя', 'User ID'],
    entity_name: ['Сущность', 'Entity'], entity_id: ['ID сущности', 'Entity ID'],
    action: ['Действие', 'Action'], before_json: ['Было', 'Before'],
    after_json: ['Стало', 'After'], ip: ['IP', 'IP'], user_agent: ['Агент', 'User agent'],
    is_elevated: ['Тех. действие', 'Elevated'], override_reason: ['Причина', 'Reason'],
    setting_key: ['Параметр', 'Setting'], value_type: ['Тип', 'Type'],
    value_text: ['Значение', 'Value'], value_num: ['Число', 'Number'],
    description: ['Описание', 'Description'], updated_by_login: ['Изменил', 'Updated by'],
    backup_type: ['Тип копии', 'Backup type'], started_at: ['Начало', 'Started'],
    finished_at: ['Окончание', 'Finished'], file_path: ['Файл', 'File'],
    size_bytes: ['Размер, байт', 'Size, bytes'], checksum: ['Контрольная сумма', 'Checksum'],
    retention_days: ['Хранение, дней', 'Retention, days'],
    initiated_by_login: ['Инициатор', 'Initiated by'],
    performed_by_login: ['Выполнил', 'Performed by'],
    backup_job_id: ['ID копии', 'Backup job ID'], reason: ['Причина', 'Reason'],
    action_type: ['Тип события', 'Action type'], admin_login: ['Администратор', 'Admin'],
    details: ['Детали', 'Details'], animals: ['Животные', 'Animals'],
    sick: ['Больные/карантин', 'Sick / quarantine'], tasks_open: ['Открытые задачи', 'Open tasks'],
    tasks_overdue: ['Просроченные задачи', 'Overdue tasks'],
    vaccination_overdue: ['Просрочки вакцинации', 'Vaccinations overdue'],
    stock_on_hand: ['Остаток склада', 'Stock on hand'],
    stock_mismatches: ['Расхождения остатков', 'Stock mismatches'],
    active_grazings: ['Активный выпас', 'Active grazings'],
    plots_not_rested: ['Участки без отдыха', 'Plots not rested'],
    purchase_requests_new: ['Новые заявки', 'New purchase requests'],
    unread_notifications: ['Непрочитанные', 'Unread notifications'],
    elevated_actions: ['Действия техролей', 'Elevated actions'],
    denies: ['Отказы в доступе', 'Access denies'], backups_ok: ['Успешные копии', 'Backups OK'],
    database: ['База данных', 'Database'], server_version: ['Версия сервера', 'Server version'],
    connections: ['Соединения', 'Connections'], db_size: ['Размер БД', 'DB size'],
    tables: ['Таблицы', 'Tables'], tasks: ['Задачи', 'Tasks'],
    stock_movements: ['Движения склада', 'Stock movements'], audit_rows: ['Строк аудита', 'Audit rows'],
    elevated: ['Тех. действия', 'Elevated'], last_backup_at: ['Последняя копия', 'Last backup'],
    head_count: ['Голов', 'Heads'], days_on_plot: ['Дней на участке', 'Days on plot'],
    rest_status: ['Состояние', 'Condition'], load: ['Нагрузка гол/га', 'Load head/ha'],
    period_month: ['Месяц', 'Month'], feed_qty: ['Корма, кг', 'Feed qty'],
    feed_cost: ['Стоимость корма', 'Feed cost'], treatment_cost: ['Лечение', 'Treatment cost'],
    head_days: ['Голово-дней', 'Head-days'], gain_kg: ['Прирост, кг', 'Gain, kg'],
    fcr: ['FCR', 'FCR'], metric: ['Метрика', 'Metric'], count: ['Кол-во', 'Count'],
    total_heads_all_time: ['Всего голов', 'All-time heads'],
    grazing_events: ['Циклов выпаса', 'Grazing events'],
    last_grazing_end: ['Последний выпас', 'Last grazing end'],
    load_head_per_ha: ['Нагрузка гол/га', 'Load head/ha'],
    norm_head_per_ha: ['Норма гол/га', 'Norm head/ha'],
    over_limit: ['Превышение', 'Over limit'], risk: ['Риск', 'Risk'],
    is_overdue: ['Просрочено', 'Overdue'], groups_count: ['Групп', 'Groups'],
    executions_count: ['Исполнений', 'Executions'],
    min_threshold: ['Мин. порог', 'Min threshold'], on_hand: ['Остаток', 'On hand'],
    received: ['Приход', 'Received'], issued: ['Расход', 'Issued'],
    batches: ['Партий', 'Batches'], nearest_expiry: ['Ближайший срок', 'Nearest expiry'],
    below_threshold: ['Ниже порога', 'Below threshold'], turnover: ['Оборачиваемость', 'Turnover'],
    requested_qty: ['Запрошено', 'Requested qty'], requested_at: ['Создана', 'Requested at'],
    is_auto: ['Авто', 'Auto'], closed_at: ['Закрыта', 'Closed at'],
    permission_count: ['Прав', 'Permissions'], user_count: ['Пользователей', 'Users'],
    object_name: ['Объект', 'Object'],
    status_after: ['Новый статус', 'New status'], qty: ['Количество', 'Quantity'],
    movement_type: ['Тип движения', 'Movement type'], comment: ['Комментарий', 'Comment'],
    note: ['Примечание', 'Note'], actual_amount: ['Факт. расход', 'Actual amount'],
    notes: ['Примечание', 'Notes'], dosage: ['Дозировка', 'Dosage'],
    diagnosis_id: ['ID диагноза', 'Diagnosis ID'],
    drug_nomenclature_id: ['ID препарата', 'Drug ID'],
    disposal_reason_id: ['ID причины выбытия', 'Disposal reason ID'],
    write_off_reason_id: ['ID причины списания', 'Write-off reason ID'],
    group_ids: ['ID групп (через запятую)', 'Group IDs (comma-separated)'],
    password: ['Пароль', 'Password'],
    operation: ['Операция', 'Operation'], head_count_snapshot: ['Голов', 'Heads'],
    value: ['Значение', 'Value'], override: ['Причина (X-Override-Reason)', 'Reason (X-Override-Reason)']
};

/* Пункты меню: data-view → [RU, EN]. */
const NAV_LABELS = {
    animals: ['Животные', 'Animals'], groups: ['Группы', 'Groups'],
    inspections: ['Осмотры', 'Inspections'], vaccinations: ['Вакцинации', 'Vaccinations'],
    stock: ['Склад', 'Stock'], plots: ['Участки', 'Plots'], tasks: ['Задачи', 'Tasks'],
    employees: ['Сотрудники', 'Employees'], grazing: ['Выпас', 'Grazing'],
    movements: ['Движения склада', 'Stock movements'], dashboard: ['Дашборд', 'Dashboard'],
    'cost-fcr': ['Себестоимость и FCR', 'Cost & FCR'],
    'herd-health': ['Здоровье', 'Herd health'],
    'pasture-load': ['Нагрузка на пастбища', 'Pasture load'],
    'tasks-in-work': ['Задачи в работе', 'Tasks in work'],
    'stock-turnover': ['Остатки склада', 'Stock turnover'],
    users: ['Пользователи', 'Users'], roles: ['Роли и права', 'Roles & permissions'],
    audit: ['Журнал аудита', 'Audit log'], settings: ['Настройки', 'Settings'],
    backups: ['Резервные копии', 'Backups'], restores: ['Восстановления', 'Restores'],
    'tech-log': ['Тех. лог', 'Tech log'], metrics: ['Метрики', 'Metrics']
};
const NAV_GROUP_LABELS = {
    'Реестры': ['Реестры', 'Registries'], 'Операции': ['Операции', 'Operations'],
    'Аналитика': ['Аналитика', 'Analytics'],
    'Администрирование': ['Администрирование', 'Administration'],
    'Технадминка': ['Технадминка', 'Tech admin']
};

/* Горячие клавиши (>= 8). Используются и в обработчике, и в справке. */
const HOTKEYS = [
    ['Ctrl+K', 'hk.search'], ['?', 'hk.help'], ['I', 'hk.receipt'], ['O', 'hk.issue'],
    ['W', 'hk.writeoff'], ['A', 'hk.assign'], ['D', 'hk.execute'], ['/', 'hk.focus'],
    ['N', 'hk.new'], ['Esc', 'hk.close'], ['R', 'hk.refresh'], ['G …', 'hk.goto']
];

/* --------------------------------------------------------------------------
 * 2. Состояние
 * -------------------------------------------------------------------------- */
const state = {
    token: null,
    user: null,
    permissions: new Set(),
    page: '',                 // канонический id текущего раздела
    pageNo: 1,                // номер страницы пагинации (с 1)
    limit: DEFAULT_LIMIT,
    offset: 0,
    total: 0,
    filters: { q: '', from: '', to: '', status: '', limit: DEFAULT_LIMIT },
    extra: {},                // доп. фильтры раздела
    extraEndpoint: null,      // вариант эндпоинта (склад: batches/balances)
    sort: '',
    data: [],
    series: null,
    theme: 'light',
    lang: 'ru',
    overrideReason: '',
    modal: null,
    overrideResolve: null,
    requestId: 0,
    selectedRow: null,
    chartVariants: [],
    chartIndex: 0,
    chartCurrent: null,
    map: null,
    mapLayer: null,
    wktCache: new Map(),
    plotsCache: [],
    loadCache: [],
    gPending: false,
    gTimer: null
};

/* --------------------------------------------------------------------------
 * 3. Базовые утилиты
 * -------------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

function t(key) {
    const dict = I18N[state.lang] || I18N.ru;
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : (I18N.ru[key] || key);
}

function labelOf(key) {
    const pair = COLUMN_LABELS[key];
    if (pair) return state.lang === 'en' ? pair[1] : pair[0];
    return String(key).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function fieldLabelOf(key) {
    const pair = COLUMN_LABELS[key];
    if (pair) return state.lang === 'en' ? pair[1] : pair[0];
    return labelOf(key);
}

/** DOM-конструктор: только createElement / textContent / setAttribute. */
function el(tag, props, children) {
    const node = document.createElement(tag);
    const p = props || {};
    for (const [k, v] of Object.entries(p)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = String(v);
        else if (k === 'text') node.textContent = String(v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k === 'style') node.setAttribute('style', String(v));
        else if (k === 'on') {
            for (const [ev, fn] of Object.entries(v)) if (typeof fn === 'function') node.addEventListener(ev, fn);
        } else if (k === 'hidden') node.hidden = !!v;
        else if (k in node && typeof v !== 'object') {
            try { node[k] = v; } catch { node.setAttribute(k, String(v)); }
        } else node.setAttribute(k, String(v));
    }
    const kids = children === undefined ? [] : (Array.isArray(children) ? children : [children]);
    for (const c of kids) {
        if (c === null || c === undefined || c === false) continue;
        node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return node;
}

function clear(node) { if (node) while (node.firstChild) node.removeChild(node.firstChild); }
function show(node, visible) { if (node) node.hidden = !visible; }

/** Явное экранирование (для строковых атрибутов / совместимости). */
function escapeHtml(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Ячейка CSV: RFC-подобное экранирование + защита от formula injection. */
function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function humanNumber(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString(state.lang === 'en' ? 'en-GB' : 'ru-RU', { maximumFractionDigits: 3 });
}

function formatDate(v) {
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toLocaleString(state.lang === 'en' ? 'en-GB' : 'ru-RU');
    }
    return s;
}

function isTechnical() {
    const r = state.user && state.user.role;
    if (!r) return false;
    if (r.type === 'TECHNICAL') return true;
    return ['SUPERUSER', 'DBA'].includes(String(r.code || '').toUpperCase());
}

function hasPerm(code) { return !code || state.permissions.has(code); }

function debounce(fn, ms) {
    let timer = null;
    return function debounced(...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; fn.apply(this, args); }, ms);
    };
}

function qs(obj) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(obj || {})) {
        if (v === undefined || v === null || v === '' || v === false) continue;
        u.set(k, String(v));
    }
    return u.toString();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* --------------------------------------------------------------------------
 * 4. Конфигурация страниц (декларативно)
 * -------------------------------------------------------------------------- */
/** Описание поля формы: подпись вычисляется динамически (RU/EN). */
function F(name, type, extra) {
    return Object.assign({ name, type: type || 'text' }, extra || {});
}
function staticOpts(values) {
    return values.map((v) => ({ value: v, label: String(v) }));
}
function opt(value, ru, en) { return { value, ru, en }; }

const PAGES = {
    /* ---- Реестры ---- */
    animals: {
        endpoint: '/animals', perm: 'animal:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Животные', 'Animals'], kind: 'table',
        columns: ['id', 'inventory_number', 'breed', 'group_name', 'sex', 'birth_date', 'status', 'arrival_date'],
        sortable: ['id', 'inventory_number', 'birth_date', 'sex', 'status', 'arrival_date', 'created_at'],
        statusValues: ANIMAL_STATUSES, writePerm: 'animal:WRITE', deletePerm: 'animal:DELETE',
        extraFilters: [{ name: 'group_id', type: 'number', ph: 'group_id' }],
        crud: {
            createFields: [
                F('inventory_number', 'text', { required: true }),
                F('breed_id', 'select', { required: true, optionsFrom: '/breeds' }),
                F('group_id', 'number', { nullable: true }),
                F('birth_date', 'date', { required: true }),
                F('sex', 'select', { required: true, options: [opt('M', 'M', 'M'), opt('F', 'F', 'F')] }),
                F('arrival_date', 'date')
            ],
            editFields: [F('inventory_number', 'text'), F('breed_id', 'select', { optionsFrom: '/breeds' }), F('group_id', 'number', { nullable: true })]
        },
        rowActions: [{ key: 'status', label: ['Статус', 'Status'], perm: 'animal:WRITE', run: (row) => openAnimalStatus(row) }]
    },
    groups: {
        endpoint: '/species', perm: 'group:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Группы (виды)', 'Groups (species)'], kind: 'table',
        columns: [], sortable: ['id', 'code', 'name'], writePerm: 'catalog:WRITE', deletePerm: 'catalog:WRITE',
        crud: {
            createFields: [F('code', 'text', { required: true }), F('name', 'text', { required: true })],
            editFields: [F('code', 'text'), F('name', 'text')]
        }
    },
    inspections: {
        endpoint: '/animals', perm: 'health:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Осмотры', 'Inspections'], kind: 'table',
        columns: ['id', 'inventory_number', 'breed', 'group_name', 'status', 'birth_date'],
        sortable: ['inventory_number', 'birth_date', 'status'], statusValues: ANIMAL_STATUSES,
        preset: { status: 'НА_ОСМОТРЕ' }
    },
    vaccinations: {
        endpoint: '/animals', perm: 'health:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Вакцинации', 'Vaccinations'], kind: 'table',
        columns: ['id', 'inventory_number', 'breed', 'group_name', 'status', 'arrival_date'],
        sortable: ['inventory_number', 'arrival_date', 'status'], statusValues: ANIMAL_STATUSES,
        preset: { status: 'НА_ЛЕЧЕНИИ' }
    },
    stock: {
        endpoint: '/stock/batches', perm: 'stock:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Склад', 'Stock'], kind: 'table',
        columns: ['id', 'batch_number', 'nomenclature', 'sku', 'warehouse', 'qty_on_hand', 'received_at', 'expiry_date', 'unit_cost'],
        sortable: ['id', 'batch_number', 'received_at', 'expiry_date', 'qty_on_hand'],
        variants: [
            { key: '/stock/batches', label: 'stock.batches', columns: null },
            { key: '/stock/balances', label: 'stock.balances', columns: ['id', 'batch_id', 'batch_number', 'nomenclature', 'sku', 'warehouse', 'qty_on_hand', 'updated_at'], sortable: ['id', 'qty_on_hand', 'updated_at', 'batch_number'] }
        ],
        toolbar: [
            { key: 'receipt', label: ['Приход', 'Receipt'], hotkey: 'I', perm: 'stock:WRITE', run: () => openMovement('RECEIPT') },
            { key: 'issue', label: ['Расход', 'Issue'], hotkey: 'O', perm: 'stock:WRITE', run: () => openMovement('ISSUE') },
            { key: 'writeoff', label: ['Списание', 'Write-off'], hotkey: 'W', perm: 'stock:DELETE', run: () => openMovement('WRITE_OFF') }
        ]
    },
    plots: {
        endpoint: '/pasture-plots', perm: 'pasture:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Пастбищные участки', 'Pasture plots'], kind: 'table',
        columns: ['id', 'plot_no', 'name', 'area_ha', 'vegetation_type', 'max_head_per_ha', 'active_head_count', 'rest_days_required', 'is_active'],
        sortable: ['id', 'plot_no', 'name', 'area_ha', 'max_head_per_ha'],
        writePerm: 'pasture:WRITE', deletePerm: 'pasture:WRITE',
        crud: {
            createFields: [
                F('plot_no', 'text', { required: true }), F('name', 'text', { required: true }),
                F('max_head_per_ha', 'number', { required: true, step: '0.001' }),
                F('rest_days_required', 'number'),
                F('vegetation_type', 'select', { options: [opt('естественное', 'Естественное', 'Natural'), opt('культурное', 'Культурное', 'Cultivated')] }),
                F('is_active', 'checkbox'),
                F('geom_wkt', 'textarea', { required: true, span: true })
            ],
            editFields: null
        },
        toolbar: [{ key: 'map', label: ['Карта', 'Map'], run: () => toggleMap(true) }],
        rowActions: [{ key: 'map', label: ['Карта', 'Map'], run: () => toggleMap(true) }]
    },
    tasks: {
        endpoint: '/tasks', perm: 'task:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Задачи / наряды', 'Tasks'], kind: 'table',
        columns: ['id', 'title', 'task_type', 'assignee', 'priority', 'status', 'planned_date', 'due_at'],
        sortable: ['id', 'planned_date', 'due_at', 'priority', 'status', 'created_at'],
        statusValues: TASK_STATUSES, writePerm: 'task:WRITE', deletePerm: 'task:DELETE',
        extraFilters: [{ name: 'assigned_to', type: 'number', ph: 'assigned_to' }],
        crud: {
            createFields: [
                F('task_type_id', 'select', { required: true, optionsFrom: '/task-types' }),
                F('title', 'text', { required: true }),
                F('assigned_to', 'select', { required: true, optionsFrom: '/employees' }),
                F('planned_date', 'date'), F('due_at', 'datetime-local'),
                F('priority', 'select', { options: staticOpts(PRIORITIES) }),
                F('plot_id', 'number', { nullable: true }),
                F('group_ids', 'text', { intArray: true, span: true })
            ],
            editFields: null
        },
        toolbar: [
            { key: 'assign', label: ['Назначить', 'Assign'], hotkey: 'A', perm: 'task:WRITE', run: () => openCreate() },
            { key: 'execute', label: ['Выполнить', 'Execute'], hotkey: 'D', perm: 'task:WRITE', run: () => openTaskExecute() }
        ],
        rowActions: [{ key: 'execute', label: ['Выполнить', 'Execute'], perm: 'task:WRITE', run: (row) => openTaskExecute(row) }]
    },
    employees: {
        endpoint: '/employees', perm: 'employee:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Сотрудники', 'Employees'], kind: 'table',
        columns: ['id', 'full_name', 'position_id', 'phone', 'hire_date', 'is_active', 'is_deleted'],
        sortable: ['id', 'full_name', 'hire_date', 'is_active'],
        writePerm: 'employee:WRITE', deletePerm: 'employee:WRITE',
        crud: {
            createFields: [
                F('full_name', 'text', { required: true }),
                F('position_id', 'select', { required: true, optionsFrom: '/positions' }),
                F('phone', 'text'), F('hire_date', 'date'), F('is_active', 'checkbox')
            ],
            editFields: [F('full_name', 'text'), F('position_id', 'select', { optionsFrom: '/positions' }), F('phone', 'text'), F('hire_date', 'date'), F('is_active', 'checkbox')]
        }
    },

    /* ---- Операции ---- */
    grazing: {
        endpoint: '/pasture-plots', perm: 'pasture:WRITE', eyebrow: ['Операции', 'Operations'],
        title: ['Выпас', 'Grazing'], kind: 'grazing',
        columns: ['plot_no', 'name', 'area_ha', 'group_name', 'head_count', 'days_on_plot', 'rest_status', 'load'],
        toolbar: [
            { key: 'move', label: ['Перевести группу', 'Move group'], hotkey: 'A', perm: 'pasture:WRITE', run: () => openMoveGroup() },
            { key: 'map', label: ['Карта', 'Map'], run: () => toggleMap(true) }
        ]
    },
    movements: {
        endpoint: '/stock/balances', perm: 'stock:WRITE', eyebrow: ['Операции', 'Operations'],
        title: ['Движения склада', 'Stock movements'], kind: 'table',
        columns: ['id', 'batch_id', 'batch_number', 'nomenclature', 'sku', 'warehouse', 'qty_on_hand', 'updated_at'],
        sortable: ['id', 'qty_on_hand', 'updated_at', 'batch_number'],
        toolbar: [
            { key: 'receipt', label: ['Приход (I)', 'Receipt (I)'], hotkey: 'I', perm: 'stock:WRITE', run: () => openMovement('RECEIPT') },
            { key: 'issue', label: ['Расход (O)', 'Issue (O)'], hotkey: 'O', perm: 'stock:WRITE', run: () => openMovement('ISSUE') },
            { key: 'writeoff', label: ['Списание (W)', 'Write-off (W)'], hotkey: 'W', perm: 'stock:DELETE', run: () => openMovement('WRITE_OFF') },
            { key: 'return', label: ['Возврат', 'Return'], perm: 'stock:WRITE', run: () => openMovement('RETURN') }
        ]
    },

    /* ---- Администрирование ---- */
    'admin-users': {
        endpoint: '/admin/users', perm: 'user:READ', eyebrow: ['Администрирование', 'Administration'],
        title: ['Пользователи', 'Users'], kind: 'table',
        columns: ['id', 'login', 'full_name', 'role_code', 'employee_name', 'is_active', 'must_change_pw', 'failed_cnt', 'last_login_at'],
        sortable: ['id', 'login', 'full_name', 'last_login_at', 'is_active'],
        writePerm: 'user:WRITE', deletePerm: 'user:WRITE',
        extraFilters: [{ name: 'role_id', type: 'number', ph: 'role_id' }],
        crud: {
            createFields: [
                F('login', 'text', { required: true }),
                F('password', 'password', { required: true }),
                F('full_name', 'text', { required: true }),
                F('role_id', 'select', { required: true, optionsFrom: '/admin/roles' }),
                F('employee_id', 'number', { nullable: true }),
                F('must_change_pw', 'checkbox')
            ],
            editFields: [
                F('full_name', 'text'), F('role_id', 'select', { optionsFrom: '/admin/roles' }),
                F('employee_id', 'number', { nullable: true }),
                F('is_active', 'checkbox'), F('must_change_pw', 'checkbox')
            ]
        },
        rowActions: [
            { key: 'unlock', label: ['Разблокировать', 'Unlock'], perm: 'user:WRITE', run: (row) => customAction('POST', `/admin/users/${row.id}/unlock`, {}, 'done') },
            { key: 'reset', label: ['Сброс пароля', 'Reset password'], perm: 'user:WRITE', run: (row) => openResetPassword(row) }
        ]
    },
    roles: {
        endpoint: '/admin/roles', perm: 'user:READ', eyebrow: ['Администрирование', 'Administration'],
        title: ['Роли и права', 'Roles & permissions'], kind: 'table',
        columns: [], variants: [
            { key: '/admin/roles', label: ['Роли', 'Roles'], columns: null },
            { key: '/admin/permissions', label: ['Права', 'Permissions'], columns: ['id', 'code', 'object_name', 'action', 'description'] }
        ]
    },
    'audit-log': {
        endpoint: '/admin/audit-log', perm: 'audit:READ', eyebrow: ['Администрирование', 'Administration'],
        title: ['Журнал аудита', 'Audit log'], kind: 'table',
        columns: ['id', 'occurred_at', 'login', 'role_code', 'entity_name', 'entity_id', 'action', 'ip', 'is_elevated', 'override_reason'],
        statusValues: AUDIT_ACTIONS, statusKey: 'action', csvPath: '/admin/audit-log/export',
        extraFilters: [
            { name: 'entity_name', type: 'text', ph: 'entity_name' },
            { name: 'is_elevated', type: 'bool' }
        ]
    },
    settings: {
        endpoint: '/admin/settings', perm: 'settings:READ', eyebrow: ['Администрирование', 'Administration'],
        title: ['Настройки хозяйства', 'Farm settings'], kind: 'table',
        columns: ['id', 'setting_key', 'value_type', 'value_text', 'value_num', 'description', 'updated_at', 'updated_by_login'],
        writePerm: 'settings:WRITE',
        rowActions: [{ key: 'editSetting', label: ['Изменить', 'Edit'], perm: 'settings:WRITE', run: (row) => openSettingEdit(row) }]
    },

    /* ---- Аналитика ---- */
    dashboard: {
        endpoint: '/reports/dashboard', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Дашборд', 'Dashboard'], kind: 'dashboard'
    },
    'cost-fcr': {
        endpoint: '/reports/cost-fcr', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Себестоимость и FCR', 'Cost & FCR'], kind: 'report',
        columns: ['group_id', 'group_name', 'period_month', 'feed_qty', 'feed_cost', 'treatment_cost', 'head_days', 'gain_kg', 'fcr']
    },
    'herd-health': {
        endpoint: '/reports/herd-health', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Здоровье поголовья', 'Herd health'], kind: 'report',
        columns: ['metric', 'status', 'count', 'total_animals', 'sick_or_quarantine', 'sick_share_pct', 'healthy', 'culled', 'dead', 'vaccination_overdue', 'animals_vaccination_overdue']
    },
    'pasture-load': {
        endpoint: '/reports/pasture-load', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Нагрузка на пастбища', 'Pasture load'], kind: 'report',
        columns: ['plot_no', 'name', 'area_ha', 'active_heads', 'load_head_per_ha', 'norm_head_per_ha', 'over_limit', 'rest_ok', 'risk', 'grazing_events', 'last_grazing_end']
    },
    'tasks-in-work': {
        endpoint: '/reports/tasks-in-work', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Задачи в работе', 'Tasks in work'], kind: 'report',
        columns: ['id', 'title', 'status', 'priority', 'planned_date', 'due_at', 'task_type', 'assignee', 'is_overdue', 'groups_count', 'executions_count']
    },
    'stock-turnover': {
        endpoint: '/reports/stock-turnover', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Остатки и обороты склада', 'Stock turnover'], kind: 'report',
        columns: ['nomenclature_id', 'sku', 'name', 'category', 'uom', 'on_hand', 'min_threshold', 'received', 'issued', 'batches', 'turnover', 'risk', 'nearest_expiry']
    },

    /* ---- Технадминка ---- */
    'tech-backups': {
        endpoint: '/tech/backups', perm: 'backup:READ', eyebrow: ['Технадминка', 'Tech admin'],
        title: ['Резервные копии', 'Backups'], kind: 'table',
        columns: ['id', 'backup_type', 'status', 'started_at', 'finished_at', 'size_bytes', 'checksum', 'retention_days', 'initiated_by_login'],
        statusValues: BACKUP_STATUSES, statusKey: 'status',
        extraFilters: [{ name: 'backup_type', type: 'text', ph: 'FULL / INCREMENTAL' }],
        toolbar: [
            { key: 'backup', label: ['Создать копию', 'Create backup'], perm: 'backup:EXEC', run: () => openBackup() },
            { key: 'restore', label: ['Восстановить', 'Restore'], perm: 'backup:EXEC', run: () => openRestore() }
        ]
    },
    restores: {
        endpoint: '/tech/restores', perm: 'backup:READ', eyebrow: ['Технадминка', 'Tech admin'],
        title: ['Восстановления', 'Restores'], kind: 'table',
        columns: ['id', 'backup_job_id', 'file_path', 'status', 'started_at', 'finished_at', 'reason', 'performed_by_login'],
        toolbar: [{ key: 'restore', label: ['Восстановить', 'Restore'], perm: 'backup:EXEC', run: () => openRestore() }]
    },
    'tech-log': {
        endpoint: '/tech/log', perm: 'tech:READ', eyebrow: ['Технадминка', 'Tech admin'],
        title: ['Технический лог', 'Tech log'], kind: 'table',
        columns: ['id', 'occurred_at', 'action_type', 'description', 'details', 'admin_login'],
        extraFilters: [{ name: 'action_type', type: 'text', ph: 'BACKUP / RESTORE / …' }],
        toolbar: [{ key: 'maintenance', label: ['Обслуживание БД', 'DB maintenance'], perm: 'tech:EXEC', run: () => openMaintenance() }]
    },
    'tech-metrics': {
        endpoint: '/tech/metrics', perm: 'tech:READ', eyebrow: ['Технадминка', 'Tech admin'],
        title: ['Метрики БД', 'DB metrics'], kind: 'metrics'
    }
};

/* Псевдонимы хешей: и канонические имена ТЗ, и реальные href из index.html. */
const ALIASES = {
    animals: 'animals', groups: 'groups', inspections: 'inspections', vaccinations: 'vaccinations',
    stock: 'stock', plots: 'plots', tasks: 'tasks', employees: 'employees',
    grazing: 'grazing', movements: 'movements',
    dashboard: 'dashboard',
    'cost-fcr': 'cost-fcr', 'herd-health': 'herd-health', 'pasture-load': 'pasture-load',
    'tasks-in-work': 'tasks-in-work', 'stock-turnover': 'stock-turnover',
    'admin-users': 'admin-users', users: 'admin-users',
    'audit-log': 'audit-log', audit: 'audit-log',
    settings: 'settings',
    'tech-backups': 'tech-backups', backups: 'tech-backups',
    'tech-log': 'tech-log', 'tech-metrics': 'tech-metrics', metrics: 'tech-metrics',
    roles: 'roles', restores: 'restores'
};
const HASH_FOR = {
    'admin-users': '#/users', 'audit-log': '#/audit', 'tech-backups': '#/backups',
    'tech-metrics': '#/metrics', 'tech-log': '#/tech-log', settings: '#/settings',
    roles: '#/roles', restores: '#/restores'
};

function pageIdFromHash() {
    const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
    return ALIASES[raw] || (Object.prototype.hasOwnProperty.call(PAGES, raw) ? raw : '');
}
function currentPage() { return PAGES[state.page] || null; }
function endpointOf(page) { return state.extraEndpoint || page.endpoint; }

/* --------------------------------------------------------------------------
 * 5. API-слой
 * -------------------------------------------------------------------------- */
class ApiError extends Error {
    constructor(status, message, kind, payload) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.kind = kind || null;
        this.payload = payload;
    }
}

function extractError(payload, status) {
    let msg = '';
    if (typeof payload === 'string') msg = payload.trim();
    else if (payload && typeof payload === 'object') {
        msg = String(payload.error || payload.message || '');
        if (payload.detail) msg += ' — ' + String(payload.detail);
    }
    if (msg) return msg.slice(0, 500);
    switch (status) {
        case 400: return t('err.400');
        case 401: return t('err.401');
        case 403: return t('err.403');
        case 404: return t('err.404');
        case 409: return t('err.409');
        case 423: return t('err.423');
        case 428: return t('err.428');
        case 500: case 502: case 503: return t('err.500');
        default: return t('err.generic');
    }
}

/**
 * Универсальный вызов REST.
 * @param {string} method GET/POST/PATCH/DELETE
 * @param {string} path   путь внутри /api/v1
 * @param {object|null} body
 * @param {object} opts   {query, reason, raw, silent, _retry}
 */
async function api(method, path, body, opts) {
    const o = opts || {};
    const query = Object.assign({}, o.query || {});
    const url = API_BASE + path + (Object.keys(query).length ? '?' + qs(query) : '');
    const headers = { Accept: query.format === 'csv' ? 'text/csv' : 'application/json' };
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    if (state.token) headers.Authorization = 'Bearer ' + state.token;

    const reason = o.reason !== undefined ? o.reason : (isTechnical() ? state.overrideReason : '');
    if (reason) headers['X-Override-Reason'] = String(reason).slice(0, 500);

    let resp;
    try {
        resp = await fetch(url, {
            method, headers,
            body: body === undefined || body === null ? undefined : JSON.stringify(body),
            credentials: 'same-origin'
        });
    } catch (e) {
        const err = new ApiError(0, t('err.network'), 'network', null);
        if (!o.silent) toast(err.message, 'err');
        throw err;
    }

    const ct = resp.headers.get('content-type') || '';
    let payload = null;
    if (o.raw || ct.includes('text/csv')) payload = await resp.text();
    else {
        const txt = await resp.text();
        if (txt) {
            try { payload = JSON.parse(txt); } catch { payload = txt; }
        }
    }

    /* 428: техроль не передала причину — запрашиваем её и повторяем один раз. */
    if (resp.status === 428 && !o._retry && !state.modal) {
        const r = await promptOverrideReason(t('err.428'));
        if (r) {
            state.overrideReason = r;
            try { sessionStorage.setItem(OVERRIDE_KEY, r); } catch { /* ignore */ }
            return api(method, path, body, Object.assign({}, o, { reason: r, _retry: true }));
        }
    }

    if (!resp.ok) {
        const err = new ApiError(resp.status, extractError(payload, resp.status),
            payload && typeof payload === 'object' ? payload.kind : null, payload);
        if (resp.status === 401) forceLogout(err.message);
        else if (!o.silent) toast(err.message, 'err');
        throw err;
    }
    return payload;
}

/** Скачивание CSV (?format=csv) через Blob. */
async function downloadCsv(path, filename, query) {
    const text = await api('GET', path, undefined, {
        query: Object.assign({}, query || {}, { format: 'csv' }), raw: true, silent: true
    });
    saveCsv(String(text || ''), filename);
    toast(t('csv.done'), 'ok');
}

function saveCsv(text, filename) {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename || 'export.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function rowsToCsv(rows) {
    if (!rows || !rows.length) return '';
    const keys = [];
    for (const row of rows) {
        for (const k of Object.keys(row || {})) if (k !== 'total' && !keys.includes(k)) keys.push(k);
    }
    const lines = [keys.join(';')];
    for (const row of rows) lines.push(keys.map((k) => csvCell(row ? row[k] : null)).join(';'));
    return lines.join('\r\n');
}

/** Загрузка справочника для <select>. Не шумит при отсутствии права. */
async function loadOptions(path) {
    const res = await api('GET', path, undefined, { query: { limit: MAX_LIMIT }, silent: true });
    const rows = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
    return rows.map((r) => {
        const id = r.id !== undefined ? r.id : (r.setting_key || r.code || r.nomenclature_id);
        let text = '';
        for (const k of ['name', 'plot_no', 'batch_number', 'full_name', 'login', 'title', 'sku', 'setting_key', 'code']) {
            if (r[k] !== undefined && r[k] !== null && String(r[k]).trim()) { text = String(r[k]); break; }
        }
        if (!text) text = '#' + String(id);
        else if (r.plot_no && r.name) text = r.plot_no + ' · ' + r.name;
        else if (r.batch_number && r.nomenclature) text = r.batch_number + ' · ' + r.nomenclature;
        else if (r.batch_number && r.sku) text = r.batch_number + ' · ' + r.sku;
        if (r.status && path.includes('backups')) text += ' [' + r.status + ']';
        return { value: id, label: text };
    });
}

/* --------------------------------------------------------------------------
 * 6. Тосты, модалка, справка
 * -------------------------------------------------------------------------- */
function toast(message, kind) {
    const k = kind || 'info';
    const box = $('toast');
    if (!box) return;
    const titles = { ok: 'toast.ok', err: 'toast.err', warn: 'toast.warn', info: 'toast.info' };
    const node = el('div', { class: 'toast toast-' + k }, [
        el('div', { class: 'grow' }, [
            el('div', { class: 'toast-title', text: t(titles[k] || 'toast.info') }),
            el('div', { class: 'toast-msg', text: String(message) })
        ]),
        el('button', { class: 'toast-close', type: 'button', 'aria-label': '×', text: '×',
            on: { click: () => remove() } })
    ]);
    const remove = () => {
        if (!node.parentNode) return;
        node.classList.add('is-leaving');
        setTimeout(() => { if (node.parentNode) node.parentNode.removeChild(node); }, 220);
    };
    box.appendChild(node);
    setTimeout(remove, 5200);
}

function showModalError(msg) {
    const box = $('modal-error');
    box.textContent = String(msg || t('err.generic'));
    show(box, true);
}

let modalSubmitHandler = null;

async function openModal(cfg) {
    state.modal = cfg;
    modalSubmitHandler = cfg.onSubmit || null;
    $('modal-title').textContent = cfg.title || '';
    $('modal-submit').textContent = cfg.submitLabel || t('save');
    $('modal-submit').classList.toggle('btn-danger', !!cfg.danger);
    $('modal-submit').classList.toggle('btn-primary', !cfg.danger);
    show($('modal-error'), false);
    show($('override-reason-field'), isTechnical() && !cfg.reasonFromField);
    $('override-reason').value = state.overrideReason || '';
    $('override-reason').placeholder = t('override.ph');
    const label = $('override-reason-field').querySelector('.field-label');
    if (label) label.textContent = t('override.label');

    const holder = $('modal-fields');
    clear(holder);
    if (cfg.note) holder.appendChild(el('p', { class: 'notice', text: cfg.note }));
    holder.appendChild(el('p', { class: 'text-muted', text: t('loading') }));

    show($('modal'), true);
    document.body.classList.add('has-modal');

    const fields = cfg.fields || [];
    const resolved = await resolveFieldOptions(fields);
    if (state.modal !== cfg) return; // модалку уже закрыли
    cfg.resolvedFields = resolved;
    clear(holder);
    if (cfg.note) holder.appendChild(el('p', { class: 'notice', text: cfg.note }));
    for (const spec of resolved) holder.appendChild(buildField(spec, (cfg.values || {})[spec.name]));
    const first = holder.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
}

async function resolveFieldOptions(fields) {
    const out = [];
    for (const f of fields) {
        const copy = Object.assign({}, f);
        if (f.optionsFrom) {
            try { copy.options = await loadOptions(f.optionsFrom); }
            catch { copy.options = []; }
        }
        out.push(copy);
    }
    return out;
}

function buildField(spec, value) {
    const name = spec.name;
    const labelText = spec.label || fieldLabelOf(name);
    const labelNode = el('span', { class: 'field-label' }, [labelText, spec.required ? el('span', { class: 'req', text: ' *' }) : null]);
    const wrap = el('label', { class: 'field', dataset: { fieldWrap: name } });
    const hint = spec.hint ? el('span', { class: 'field-hint', text: spec.hint }) : null;
    let input;

    if (spec.type === 'checkbox') {
        wrap.appendChild(el('span', { class: 'checkbox' }, [
            el('input', { type: 'checkbox', dataset: { name }, checked: value === true || value === 1 || value === 'true' }),
            labelNode
        ]));
        if (hint) wrap.appendChild(hint);
        return wrap;
    }

    if (spec.type === 'select') {
        input = el('select', { class: 'field-input', dataset: { name } });
        input.appendChild(el('option', { value: '', text: '—' }));
        for (const o of (spec.options || [])) {
            const lbl = o.label !== undefined ? o.label : (state.lang === 'en' && o.en ? o.en : (o.ru || o.value));
            const n = el('option', { value: o.value === undefined ? '' : o.value, text: lbl });
            if (String(o.value) === String(value)) n.selected = true;
            input.appendChild(n);
        }
        if (value === undefined || value === null || value === '') input.value = '';
    } else if (spec.type === 'textarea') {
        input = el('textarea', { class: 'field-input', rows: '3', dataset: { name }, placeholder: spec.ph || '' });
        input.value = value === undefined || value === null ? '' : String(value);
    } else {
        const attrs = {
            class: 'field-input', type: spec.type === 'datetime-local' ? 'datetime-local' : spec.type,
            dataset: { name }, placeholder: spec.ph || ''
        };
        if (spec.type === 'number') attrs.step = spec.step || 'any';
        if (spec.type === 'date' && spec.maxToday) attrs.max = new Date().toISOString().slice(0, 10);
        input = el('input', attrs);
        if (value !== undefined && value !== null) input.value = String(value);
        if (spec.type === 'date' && !input.value && spec.required) input.value = new Date().toISOString().slice(0, 10);
    }
    if (spec.required) input.setAttribute('required', '');
    if (spec.readonly) input.disabled = true;
    if (spec.span) wrap.style.gridColumn = '1 / -1';

    wrap.appendChild(labelNode);
    wrap.appendChild(input);
    if (hint) wrap.appendChild(hint);
    return wrap;
}

function collectForm(mode) {
    const out = {};
    const specs = (state.modal && state.modal.resolvedFields) || [];
    const byName = new Map(specs.map((s) => [s.name, s]));
    for (const node of $('modal-fields').querySelectorAll('[data-name]')) {
        const name = node.dataset.name;
        const spec = byName.get(name) || {};
        let v;
        if (node.type === 'checkbox') v = node.checked;
        else v = String(node.value).trim();

        if (v === '' || v === undefined) {
            if (node.type === 'checkbox') out[name] = v;
            else if (spec.nullable && mode === 'edit') out[name] = null;
            continue;
        }
        if (node.type === 'checkbox') { out[name] = !!v; continue; }
        if (spec.intArray) {
            const arr = String(v).split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
            if (arr.length) out[name] = arr;
            continue;
        }
        if (spec.type === 'number' || /_id$/.test(name) || ['qty', 'dosage', 'actual_amount', 'retention_days', 'rest_days_required', 'max_head_per_ha', 'area_ha'].includes(name)) {
            const n = Number(v);
            out[name] = Number.isFinite(n) ? n : v;
        } else out[name] = v;
    }
    return out;
}

function closeModal() {
    show($('modal'), false);
    document.body.classList.remove('has-modal');
    state.modal = null;
    modalSubmitHandler = null;
    const r = state.overrideResolve;
    state.overrideResolve = null;
    if (r) r(null);
}

async function onModalSubmit(e) {
    e.preventDefault();
    const cfg = state.modal;
    if (!cfg || !modalSubmitHandler) return;
    const btn = $('modal-submit');
    show($('modal-error'), false);

    if (!cfg.resolvedFields) cfg.resolvedFields = await resolveFieldOptions(cfg.fields || []);
    const payload = collectForm(cfg.mode || 'create');

    let reason = '';
    if (isTechnical()) {
        if (cfg.reasonFromField) {
            reason = String(payload[cfg.reasonFromField] || '').trim() || $('override-reason').value.trim() || state.overrideReason || '';
        } else {
            reason = $('override-reason').value.trim() || state.overrideReason || '';
        }
        if (!reason) { showModalError(t('override.required')); $('override-reason').focus(); return; }
        state.overrideReason = reason;
        try { sessionStorage.setItem(OVERRIDE_KEY, reason); } catch { /* ignore */ }
    } else if ($('override-reason').value.trim()) {
        reason = $('override-reason').value.trim();
    }

    btn.disabled = true;
    try {
        await modalSubmitHandler(payload, reason);
        if (state.modal === cfg) closeModal();
    } catch (err) {
        showModalError(err && err.message ? err.message : t('err.generic'));
    } finally {
        btn.disabled = false;
    }
}

/** Подтверждение удаления — та же модалка. */
function openConfirm(title, message, onYes) {
    return openModal({
        title, note: message, fields: [], danger: true,
        submitLabel: t('delete'), onSubmit: async (payload, reason) => { await onYes(reason); }
    });
}

/** Отдельный запрос причины при 428 (когда модалка ещё не открыта). */
function promptOverrideReason(message) {
    return new Promise((resolve) => {
        state.overrideResolve = resolve;
        openModal({
            title: t('override.title'), note: message, reasonFromField: 'override',
            fields: [F('override', 'textarea', { required: true, span: true })],
            submitLabel: t('override.send'),
            onSubmit: async (p, reason) => {
                const val = reason || String(p.override || '').trim();
                const r = state.overrideResolve;
                state.overrideResolve = null;
                if (r) r(val);
            }
        });
    });
}

function renderHelp() {
    const dlg = $('help-dialog');
    const heads = dlg.querySelectorAll('.help-body h3');
    if (heads[0]) heads[0].textContent = t('help.hotkeys');
    if (heads[1]) heads[1].textContent = t('help.data');
    if (heads[2]) heads[2].textContent = t('help.roles');
    $('help-title').textContent = t('help.title');
    $('help-ok').textContent = t('help.ok');
    const dl = dlg.querySelector('.help-keys');
    clear(dl);
    for (const [keys, textKey] of HOTKEYS) {
        dl.appendChild(el('dt', {}, [el('kbd', { text: keys })]));
        dl.appendChild(el('dd', { text: t(textKey) }));
    }
}
function openHelp() { renderHelp(); const d = $('help-dialog'); if (!d.open) d.showModal(); }
function closeHelp() { const d = $('help-dialog'); if (d && d.open) d.close(); }

/* --------------------------------------------------------------------------
 * 7. Тема, язык, авторизация, меню
 * -------------------------------------------------------------------------- */
function applyTheme() {
    document.body.dataset.theme = state.theme;
    const cb = $('theme-toggle');
    if (cb) cb.checked = state.theme === 'dark';
    $('theme-label').textContent = state.theme === 'dark' ? t('theme.dark') : t('theme.light');
    try { localStorage.setItem(THEME_KEY, state.theme); } catch { /* ignore */ }
    if (state.chartCurrent) drawChart($('chart-canvas'), state.chartCurrent);
}

function applyLang() {
    document.documentElement.lang = state.lang;
    try { localStorage.setItem(LANG_KEY, state.lang); } catch { /* ignore */ }

    const setText = (sel, key) => { const n = document.querySelector(sel); if (n) n.textContent = t(key); };
    setText('#login-submit', 'login.submit');
    setText('#logout-btn', 'logout');
    setText('#refresh-btn', 'refresh');
    setText('#filters-apply', 'apply');
    setText('#filters-reset', 'reset');
    setText('#pager-prev', 'prev');
    setText('#pager-next', 'next');
    setText('.login-subtitle', 'login.subtitle');
    setText('.login-demo-title', 'login.demo');
    setText('.login-demo-note', 'login.note');
    setText('.login-footer', 'login.footer');
    const createBtn = $('create-btn');
    if (createBtn) createBtn.textContent = t('create');
    const labels = document.querySelectorAll('#login-form .field-label');
    if (labels[0]) labels[0].textContent = t('login.login');
    if (labels[1]) labels[1].textContent = t('login.password');
    $('login').placeholder = t('login.loginPh');
    $('password').placeholder = t('login.passwordPh');
    $('filter-search').placeholder = t('searchPh');
    const hint = document.querySelector('.login-demo-hint');
    if (hint) {
        clear(hint);
        hint.appendChild(document.createTextNode(t('login.demoHint') + ' '));
        hint.appendChild(el('code', { text: 'demo1234' }));
    }

    const filterLabels = document.querySelectorAll('.filters-row .field-label');
    const keys = ['search', 'from', 'to', 'status', 'limit'];
    filterLabels.forEach((n, i) => { if (keys[i]) n.textContent = t(keys[i]); });

    for (const link of document.querySelectorAll('#sidebar .nav-link[data-view]')) {
        const pair = NAV_LABELS[link.dataset.view];
        if (pair) link.textContent = state.lang === 'en' ? pair[1] : pair[0];
    }
    for (const h of document.querySelectorAll('#sidebar .nav-group-title')) {
        if (!h.dataset.ru) h.dataset.ru = h.textContent.trim();
        const p = NAV_GROUP_LABELS[h.dataset.ru];
        if (p) h.textContent = state.lang === 'en' ? p[1] : p[0];
    }
    const hotkeyHint = document.querySelector('.hotkeys-hint');
    if (hotkeyHint) {
        clear(hotkeyHint);
        const parts = [['?', t('hk.help')], ['/', t('hk.focus')], ['n', t('hk.new')], ['r', t('hk.refresh')], ['Esc', t('hk.close')]];
        parts.forEach(([k, txt], i) => {
            if (i) hotkeyHint.appendChild(document.createTextNode(' · '));
            hotkeyHint.appendChild(el('kbd', { text: k }));
            hotkeyHint.appendChild(document.createTextNode(' ' + txt));
        });
    }
    const langBtn = $('lang-toggle');
    if (langBtn) { langBtn.textContent = state.lang === 'ru' ? 'EN' : 'RU'; langBtn.title = t('lang.switch'); }
    $('theme-label').textContent = state.theme === 'dark' ? t('theme.dark') : t('theme.light');
    const helpTitle = $('help-title');
    if (helpTitle) helpTitle.textContent = t('help.title');
    if (state.page) renderChrome(currentPage());
}

function showLogin(message) {
    show($('app-view'), false);
    show($('login-view'), true);
    const box = $('login-error');
    if (message) { box.textContent = message; show(box, true); }
    else { box.textContent = ''; show(box, false); }
    setTimeout(() => $('login').focus(), 40);
}

function forceLogout(message) {
    state.token = null; state.user = null; state.permissions = new Set();
    state.overrideReason = '';
    try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(OVERRIDE_KEY); } catch { /* ignore */ }
    renderMenu();
    showLogin(message || t('err.401'));
}

async function doLogout() {
    try { await api('POST', '/auth/logout', {}, { silent: true }); } catch { /* сессия уже отозвана */ }
    forceLogout('');
    toast(t('done'), 'ok');
}

async function doLogin(e) {
    e.preventDefault();
    const box = $('login-error');
    show(box, false);
    const btn = $('login-submit');
    btn.disabled = true;
    const login = $('login').value.trim();
    const password = $('password').value;
    try {
        /* Публичный эндпоинт: без Bearer и без X-Override-Reason. */
        const res = await fetch(API_BASE + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ login, password })
        });
        const txt = await res.text();
        let payload = null;
        try { payload = txt ? JSON.parse(txt) : null; } catch { payload = null; }
        if (!res.ok) throw new Error(extractError(payload, res.status));
        if (!payload || !payload.token) throw new Error(t('err.generic'));

        state.token = payload.token;
        try { sessionStorage.setItem(TOKEN_KEY, payload.token); } catch { /* ignore */ }
        const perms = payload.permissions || (payload.user && payload.user.permissions) || [];
        state.user = payload.user || null;
        state.permissions = new Set(perms);

        /* ТЗ: обязательная загрузка /auth/me. */
        const me = await api('GET', '/auth/me', undefined, { silent: true });
        if (me && typeof me === 'object') {
            state.user = Object.assign({}, state.user || {}, me);
            if (Array.isArray(me.permissions)) state.permissions = new Set(me.permissions);
        }
        state.overrideReason = (() => { try { return sessionStorage.getItem(OVERRIDE_KEY) || ''; } catch { return ''; } })();

        renderMenu();
        show($('login-view'), false);
        show($('app-view'), true);
        $('password').value = '';
        updateUserChip();
        const target = pageIdFromHash();
        if (target && PAGES[target] && hasPerm(PAGES[target].perm)) route();
        else navigate(defaultPage());
        toast(t('done'), 'ok');
    } catch (err) {
        box.textContent = err && err.message ? err.message : t('login.error');
        show(box, true);
    } finally {
        btn.disabled = false;
    }
}

function updateUserChip() {
    const u = state.user || {};
    $('user-name').textContent = u.full_name || u.login || '—';
    const role = u.role || {};
    const code = role.code || '—';
    const name = role.name || '';
    $('user-role').textContent = name ? (code + ' · ' + name) : code;
    $('user-role').title = role.type === 'TECHNICAL' ? 'TECHNICAL' : 'BUSINESS';
}

/** Скрыть пункты меню, права на которые отсутствуют (data-permission). */
function renderMenu() {
    for (const link of document.querySelectorAll('#sidebar .nav-link[data-permission]')) {
        const li = link.closest('li');
        if (li) li.hidden = !hasPerm(link.dataset.permission);
    }
    for (const group of document.querySelectorAll('#sidebar .nav-group')) {
        const visible = [...group.querySelectorAll('.nav-link')].some((a) => {
            const li = a.closest('li');
            return li ? !li.hidden : true;
        });
        group.hidden = !visible;
    }
    highlightMenu();
}

function highlightMenu() {
    for (const link of document.querySelectorAll('#sidebar .nav-link[data-view]')) {
        const active = ALIASES[link.dataset.view] === state.page;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    }
}

function defaultPage() {
    const first = document.querySelector('#sidebar .nav-link[data-permission]');
    if (first) {
        const li = first.closest('li');
        if (li && !li.hidden) {
            const p = ALIASES[first.dataset.view];
            if (p && PAGES[p]) return p;
        }
    }
    return Object.keys(PAGES).find((id) => hasPerm(PAGES[id].perm)) || 'dashboard';
}

function navigate(pageId) {
    const hash = HASH_FOR[pageId] || ('#/' + pageId);
    if (location.hash === hash) route();
    else location.hash = hash;
}

/* --------------------------------------------------------------------------
 * 8. Роутер, фильтры, загрузка данных
 * -------------------------------------------------------------------------- */
function route() {
    if (!state.token) return;
    const id = pageIdFromHash();
    if (!id || !PAGES[id]) { navigate(defaultPage()); return; }
    const page = PAGES[id];
    if (!hasPerm(page.perm)) { toast(t('err.denied'), 'warn'); navigate(defaultPage()); return; }

    state.page = id;
    state.pageNo = 1;
    state.offset = 0;
    state.sort = '';
    state.extra = {};
    state.extraEndpoint = null;
    state.selectedRow = null;
    state.chartVariants = [];
    state.chartCurrent = null;
    if (page.preset) Object.assign(state.extra, page.preset);
    highlightMenu();
    renderChrome(page);
    configureFilters(page);
    hideChart();
    if (id !== 'plots' && id !== 'grazing') hideMap();
    loadPage();
}

function renderChrome(page) {
    const pair = (v) => Array.isArray(v) ? (state.lang === 'en' ? v[1] : v[0]) : String(v || '');
    $('page-eyebrow').textContent = pair(page.eyebrow);
    $('page-title').textContent = pair(page.title);
    $('create-btn').textContent = t('create');
    show($('create-btn'), !!(page.crud && page.crud.createFields && hasPerm(page.writePerm)));

    const bar = $('page-actions');
    for (const n of [...bar.querySelectorAll('.js-toolbar')]) n.remove();
    for (const action of (page.toolbar || [])) {
        if (!hasPerm(action.perm)) continue;
        bar.appendChild(el('button', {
            class: 'btn btn-ghost js-toolbar', type: 'button',
            text: pair(action.label) + (action.hotkey ? ' [' + action.hotkey + ']' : ''),
            title: action.hotkey || '', on: { click: () => action.run() }
        }));
    }
    updateUserChip();
}

function configureFilters(page) {
    $('filter-search').value = state.filters.q || '';
    $('filter-from').value = state.filters.from || '';
    $('filter-to').value = state.filters.to || '';
    $('filter-limit').value = String(state.limit);

    const st = $('filter-status');
    clear(st);
    st.appendChild(el('option', { value: '', text: t('all') }));
    for (const v of (page.statusValues || [])) st.appendChild(el('option', { value: v, text: v }));
    st.value = state.filters.status || '';
    st.dataset.key = page.statusKey || 'status';

    const datesRelevant = ['report', 'dashboard'].includes(page.kind)
        || page.endpoint.includes('audit-log') || page.endpoint.includes('/tech/');
    show($('filter-from').parentElement, datesRelevant);
    show($('filter-to').parentElement, datesRelevant);
    show(st.parentElement, !!(page.statusValues && page.statusValues.length));

    const extra = $('filters-extra');
    clear(extra);
    for (const v of (page.variants || [])) {
        const label = typeof v.label === 'string' ? t(v.label) : (state.lang === 'en' ? v.label[1] : v.label[0]);
        extra.appendChild(el('button', {
            class: 'btn ' + (state.extraEndpoint === v.key ? 'btn-primary' : 'btn-ghost'),
            type: 'button', text: label, dataset: { variant: v.key },
            on: {
                click: (ev) => {
                    state.extraEndpoint = v.key;
                    state.offset = 0; state.pageNo = 1; state.sort = '';
                    for (const b of extra.querySelectorAll('[data-variant]')) b.classList.remove('btn-primary');
                    ev.currentTarget.classList.add('btn-primary');
                    loadPage();
                }
            }
        }));
    }
    for (const f of (page.extraFilters || [])) {
        extra.appendChild(el('span', { class: 'hint', text: labelOf(f.name) }));
        const input = el('input', {
            class: 'field-input',
            type: f.type === 'number' ? 'number' : (f.type === 'bool' ? 'checkbox' : 'text'),
            placeholder: f.ph || '', dataset: { extra: f.name }
        });
        if (f.type === 'bool') { input.classList.remove('field-input'); input.style.width = 'auto'; }
        if (state.extra[f.name] !== undefined) {
            if (f.type === 'bool') input.checked = state.extra[f.name] === 'true' || state.extra[f.name] === true;
            else input.value = String(state.extra[f.name]);
        }
        extra.appendChild(input);
    }
    show(extra, extra.childNodes.length > 0);
}

function readFilters() {
    state.filters = {
        q: $('filter-search').value.trim(),
        from: $('filter-from').value,
        to: $('filter-to').value,
        status: $('filter-status').value,
        limit: Number($('filter-limit').value) || DEFAULT_LIMIT
    };
    state.limit = Math.min(Math.max(1, state.filters.limit), MAX_LIMIT);
    state.offset = (state.pageNo - 1) * state.limit;
    const extra = {};
    for (const node of $('filters-extra').querySelectorAll('[data-extra]')) {
        const k = node.dataset.extra;
        const v = node.type === 'checkbox' ? (node.checked ? 'true' : '') : String(node.value).trim();
        if (v) extra[k] = v;
    }
    const page = currentPage();
    if (page && page.preset) Object.assign(extra, page.preset);
    state.extra = extra;
}

function queryFor(page) {
    const q = {
        limit: state.limit, offset: state.offset,
        q: state.filters.q || '', from: state.filters.from || '', to: state.filters.to || ''
    };
    if (state.filters.status) q[page.statusKey || 'status'] = state.filters.status;
    if (state.sort) q.sort = state.sort;
    for (const [k, v] of Object.entries(state.extra || {})) {
        if (v === '' || v === null || v === undefined) continue;
        q[k] = v;
    }
    if (page.endpoint.includes('/admin/audit-log')) {
        if (state.filters.from) q.date_from = state.filters.from;
        if (state.filters.to) q.date_to = state.filters.to;
        delete q.from; delete q.to;
    }
    return q;
}

function applyFilters() { readFilters(); state.pageNo = 1; state.offset = 0; loadPage(); }
function resetFilters() {
    state.filters = { q: '', from: '', to: '', status: '', limit: DEFAULT_LIMIT };
    state.extra = currentPage() && currentPage().preset ? Object.assign({}, currentPage().preset) : {};
    state.limit = DEFAULT_LIMIT; state.pageNo = 1; state.offset = 0; state.sort = '';
    state.extraEndpoint = null;
    configureFilters(currentPage());
    loadPage();
}

function setLoading() {
    const v = $('view');
    clear(v);
    v.setAttribute('aria-busy', 'true');
    v.appendChild(el('div', { class: 'loading', text: t('loading') }));
}

function setEmpty(errorText) {
    const v = $('view');
    clear(v);
    v.setAttribute('aria-busy', 'false');
    const box = el('div', { class: 'empty-state' }, [
        el('p', { class: 'empty-state-title', text: errorText ? t('errorTitle') : t('empty') }),
        el('p', { text: errorText || t('emptyMsg') })
    ]);
    if (errorText) box.appendChild(el('button', { class: 'btn btn-ghost', type: 'button', text: t('retry'), on: { click: () => loadPage() } }));
    v.appendChild(box);
}

async function loadPage() {
    const page = currentPage();
    if (!page || !state.token) return;
    const ticket = ++state.requestId;
    setLoading();
    try {
        const result = page.kind === 'grazing' ? await loadGrazing() : await loadGeneric(page);
        if (ticket !== state.requestId) return;
        state.data = result.rows || [];
        state.total = Number(result.total !== undefined ? result.total : state.data.length) || 0;
        state.series = result.series || null;
        state.plotsCache = result.plots || [];
        state.loadCache = result.load || [];
        $('view').setAttribute('aria-busy', 'false');
        renderView(page, result);
    } catch (err) {
        if (ticket !== state.requestId) return;
        $('view').setAttribute('aria-busy', 'false');
        setEmpty(err && err.message ? err.message : t('err.generic'));
    }
}

async function loadGeneric(page) {
    const res = await api('GET', endpointOf(page), undefined, { query: queryFor(page) });
    let rows = [];
    if (Array.isArray(res)) rows = res;
    else if (res && Array.isArray(res.data)) rows = res.data;
    else if (res && typeof res.data === 'object' && res.data !== null) rows = [res.data];
    else if (res && typeof res === 'object' && !res.data) rows = [res];
    const total = res && res.total !== undefined ? res.total : rows.length;
    const series = res && res.series ? res.series : null;
    return { rows, total, series };
}

/** Экран «Выпас»: активные участки + группа/головы/дни. */
async function loadGrazing() {
    const requests = [
        api('GET', '/pasture-plots', undefined, { query: { limit: MAX_LIMIT }, silent: true }).catch(() => null),
        api('GET', '/reports/pasture-load', undefined, { query: { limit: MAX_LIMIT }, silent: true }).catch(() => null),
        api('GET', '/animals', undefined, { query: { limit: MAX_LIMIT }, silent: true }).catch(() => null),
        api('GET', '/grazing/active', undefined, { query: { limit: MAX_LIMIT }, silent: true }).catch(() => null),
        api('GET', '/admin/audit-log', undefined, {
            query: { entity_name: 'grazing_event', action: 'CREATE', limit: 100 }, silent: true
        }).catch(() => null)
    ];
    const [plotsRes, loadRes, animalsRes, activeRes, auditRes] = await Promise.all(requests);
    const plots = plotsRes && Array.isArray(plotsRes.data) ? plotsRes.data : [];
    const load = loadRes && Array.isArray(loadRes.data) ? loadRes.data : [];
    const animals = animalsRes && Array.isArray(animalsRes.data) ? animalsRes.data : [];
    const loadByPlot = new Map(load.map((r) => [String(r.plot_id || r.id), r]));

    const groupNames = new Map();
    for (const a of animals) {
        if (a.group_id !== undefined && a.group_id !== null && a.group_name) groupNames.set(String(a.group_id), a.group_name);
    }

    /* Источник активных назначений: /grazing/active → аудит CREATE → отчёт по нагрузке. */
    let events = [];
    const activeRows = activeRes && Array.isArray(activeRes.data) ? activeRes.data : [];
    if (activeRows.length) {
        events = activeRows.map((r) => ({
            plot_id: r.plot_id, group_id: r.group_id,
            group_name: r.group_name || groupNames.get(String(r.group_id)) || '',
            head_count: r.head_count || r.head_count_snapshot || r.active_heads || 0,
            days: r.days_on_plot !== undefined ? r.days_on_plot : daysSince(r.started_at)
        }));
    } else {
        const auditRows = auditRes && Array.isArray(auditRes.data) ? auditRes.data : [];
        const seen = new Set();
        for (const r of auditRows) {
            const after = r.after_json || {};
            const gid = after.group_id !== undefined ? after.group_id : null;
            const pid = after.plot_id !== undefined ? after.plot_id : null;
            if (gid === null || pid === null || seen.has(String(gid))) continue;
            seen.add(String(gid));
            events.push({
                plot_id: pid, group_id: gid,
                group_name: groupNames.get(String(gid)) || '',
                head_count: 0, days: daysSince(r.occurred_at)
            });
        }
        if (!events.length) {
            events = load.filter((r) => r.in_use || Number(r.active_heads) > 0).map((r) => ({
                plot_id: r.plot_id || r.id, group_id: null, group_name: '',
                head_count: r.active_heads || 0, days: null
            }));
        }
    }

    const plotsById = new Map(plots.map((p) => [String(p.id), p]));
    const rows = events.map((ev) => {
        const p = plotsById.get(String(ev.plot_id)) || {};
        const lr = loadByPlot.get(String(ev.plot_id)) || {};
        const area = Number(p.area_ha || lr.area_ha || 0);
        const heads = Number(ev.head_count || lr.active_heads || 0);
        const norm = Number(p.max_head_per_ha || lr.norm_head_per_ha || 0);
        const loadVal = area > 0 ? +(heads / area).toFixed(2) : 0;
        return {
            plot_id: ev.plot_id,
            plot_no: p.plot_no || lr.plot_no || ('#' + ev.plot_id),
            name: p.name || lr.name || '',
            area_ha: area,
            group_id: ev.group_id,
            group_name: ev.group_name || '',
            head_count: heads,
            days_on_plot: ev.days === null || ev.days === undefined ? '—' : ev.days,
            rest_status: lr.rest_ok === false ? t('map.legend.rest') : (lr.risk === 'OVERGRAZING' ? t('map.legend.over') : (heads > 0 ? t('map.legend.loaded') : t('map.legend.free'))),
            load: norm > 0 ? (loadVal.toFixed(2) + ' / ' + norm.toFixed(2)) : String(loadVal),
            rest_ok: lr.rest_ok !== false,
            _over: loadVal > norm && norm > 0
        };
    });
    return { rows, total: rows.length, plots, load };
}

function daysSince(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

/* --------------------------------------------------------------------------
 * 9. Рендер таблиц, KPI, действий
 * -------------------------------------------------------------------------- */
function columnsFor(page, rows) {
    const variant = (page.variants || []).find((v) => v.key === state.extraEndpoint);
    let cols = (variant && variant.columns) ? variant.columns : page.columns;
    if (!cols || !cols.length) {
        const first = rows.find((r) => r && typeof r === 'object') || {};
        cols = Object.keys(first).filter((k) => k !== 'total');
    }
    return cols.slice(0, 14);
}

function sortableFor(page) {
    const variant = (page.variants || []).find((v) => v.key === state.extraEndpoint);
    return (variant && variant.sortable) ? variant.sortable : (page.sortable || []);
}

function statusBadge(value) {
    const slug = String(value).toLowerCase().replace(/\s+/g, '_');
    return el('span', { class: 'badge status-' + slug, dataset: { status: String(value) }, text: String(value) });
}

function cellContent(value, key) {
    if (value === null || value === undefined || value === '') return el('span', { class: 'muted', text: '—' });
    if (typeof value === 'boolean') {
        return el('span', { class: 'badge ' + (value ? 'status-ok' : 'badge-neutral'), text: value ? t('yes') : t('no') });
    }
    if (typeof value === 'object') {
        const s = JSON.stringify(value);
        return el('span', { class: 'muted', title: s, text: s.length > 160 ? s.slice(0, 157) + '…' : s });
    }
    if (['status', 'risk', 'action', 'priority', 'backup_type', 'action_type', 'role_code', 'movement_type', 'rest_status'].includes(key)) return statusBadge(value);
    if (typeof value === 'number') return el('span', { text: humanNumber(value) });
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(String(value))) return el('span', { text: formatDate(value) });
    return el('span', { text: String(value) });
}

function isNumericKey(key) {
    return /(_qty|_count|_cost|_ha|_kg|_pct|_days|_bytes|qty|count|cost|area_ha|gain_kg|fcr|load|turnover|issued|received|on_hand|head_count|days_on_plot)$/.test(key)
        || ['id', 'total', 'fcr', 'feed_cost', 'active_heads', 'head_days'].includes(key);
}

function renderTable(page, rows, captionText) {
    const holder = $('view');
    const wrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'data-table' });
    const cols = columnsFor(page, rows);
    const sortable = sortableFor(page);
    const canEdit = !!(page.crud && page.crud.editFields && page.crud.editFields.length && hasPerm(page.writePerm));
    const canDelete = !!(page.crud && hasPerm(page.deletePerm));
    const custom = page.rowActions || [];

    const thead = el('thead');
    const hrow = el('tr');
    for (const key of cols) {
        const th = el('th', { scope: 'col', text: labelOf(key) });
        if (sortable.includes(key) || (!page.sortable && !page.variants)) {
            th.classList.add('sortable');
            th.dataset.sort = key;
            const cur = state.sort.replace(/^-/, '');
            if (cur === key) th.appendChild(el('span', { class: 'sort-ind', text: state.sort.startsWith('-') ? '▼' : '▲' }));
            th.addEventListener('click', () => onSort(key));
        }
        hrow.appendChild(th);
    }
    if (canEdit || canDelete || custom.length) hrow.appendChild(el('th', { scope: 'col', text: t('actions') }));
    thead.appendChild(hrow);
    table.appendChild(thead);

    const tbody = el('tbody');
    if (!rows.length) {
        const td = el('td', { colspan: String(cols.length + 1) }, [el('div', { class: 'table-empty' }, [
            el('div', { class: 'big', text: t('empty') }), el('div', { text: t('emptyMsg') })
        ])]);
        tbody.appendChild(el('tr', {}, [td]));
    }
    for (const row of rows) {
        const tr = el('tr');
        tr.addEventListener('click', () => {
            state.selectedRow = row;
            for (const s of tbody.querySelectorAll('tr.is-selected')) s.classList.remove('is-selected');
            tr.classList.add('is-selected');
        });
        for (const key of cols) {
            const td = el('td', { dataset: { label: labelOf(key) } });
            const v = row ? row[key] : null;
            if ((typeof v === 'number') || (isNumericKey(key) && v !== null && v !== undefined && !Number.isNaN(Number(v)))) td.classList.add('num');
            td.appendChild(cellContent(v, key));
            tr.appendChild(td);
        }
        if (canEdit || canDelete || custom.length) {
            const td = el('td', { class: 'cell-actions' });
            if (canEdit) td.appendChild(el('button', {
                class: 'btn btn-ghost btn-sm', type: 'button', text: t('edit'),
                on: { click: (e) => { e.stopPropagation(); openEdit(row); } }
            }));
            for (const a of custom) {
                if (!hasPerm(a.perm)) continue;
                const lbl = Array.isArray(a.label) ? (state.lang === 'en' ? a.label[1] : a.label[0]) : String(a.label || a.key);
                td.appendChild(el('button', {
                    class: 'btn btn-ghost btn-sm', type: 'button', text: lbl,
                    on: { click: (e) => { e.stopPropagation(); a.run(row); } }
                }));
            }
            if (canDelete) td.appendChild(el('button', {
                class: 'btn btn-danger btn-sm', type: 'button', text: t('delete'),
                on: { click: (e) => { e.stopPropagation(); openDelete(row); } }
            }));
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    table.appendChild(el('caption', { text: (captionText || t('table.caption')) + ' · ' + t('table.sortHint') }));
    wrap.appendChild(table);
    holder.appendChild(wrap);
    if (state.selectedRow) {
        const idx = rows.indexOf(state.selectedRow);
        if (idx >= 0 && tbody.children[idx]) tbody.children[idx].classList.add('is-selected');
    }
}

function onSort(key) {
    const page = currentPage();
    const serverSortable = sortableFor(page);
    const cur = state.sort.replace(/^-/, '');
    state.sort = cur === key ? (state.sort.startsWith('-') ? key : '-' + key) : key;
    if (serverSortable.includes(key)) { loadPage(); return; }
    /* Клиентская сортировка для отчётов/журналов (сервер sort не поддерживает). */
    const field = state.sort.replace(/^-/, '');
    const dir = state.sort.startsWith('-') ? -1 : 1;
    const rows = [...state.data].sort((a, b) => {
        const x = a ? a[field] : null, y = b ? b[field] : null;
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        const nx = Number(x), ny = Number(y);
        const cmp = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : String(x).localeCompare(String(y));
        return cmp * dir;
    });
    state.data = rows;
    renderView(page, { rows, total: state.total, series: state.series });
}

function renderKpi(rows, keys) {
    const obj = (rows && rows[0]) || {};
    const list = keys || Object.keys(obj).filter((k) => k !== 'total');
    const grid = el('div', { class: 'kpi-grid' });
    for (const k of list) {
        if (!(k in obj)) continue;
        const v = obj[k];
        const warn = ['sick', 'tasks_overdue', 'vaccination_overdue', 'stock_mismatches', 'plots_not_rested', 'denies', 'elevated_actions', 'unread_notifications', 'purchase_requests_new'].includes(k) && Number(v) > 0;
        grid.appendChild(el('div', { class: 'kpi-card' + (warn ? ' is-warn' : '') }, [
            el('div', { class: 'kpi-label', text: labelOf(k) }),
            el('div', { class: 'kpi-value', text: typeof v === 'number' ? humanNumber(v) : (v === null || v === undefined ? '—' : String(v)) }),
            el('div', { class: 'kpi-foot', text: k })
        ]));
    }
    $('view').appendChild(grid);
}

function updatePager() {
    const total = state.total;
    const pages = Math.max(1, Math.ceil(total / state.limit));
    if (state.pageNo > pages) { state.pageNo = pages; state.offset = (pages - 1) * state.limit; }
    $('pager-info').textContent = t('total') + ': ' + humanNumber(total) + ' · ' + t('limit') + ': ' + state.limit;
    $('pager-page').textContent = state.pageNo + ' / ' + pages;
    $('pager-prev').disabled = state.pageNo <= 1;
    $('pager-next').disabled = state.pageNo >= pages;
}

function renderView(page, result) {
    const holder = $('view');
    clear(holder);
    holder.setAttribute('aria-busy', 'false');

    if (page.kind === 'dashboard') {
        const kpiKeys = ['animals', 'sick', 'tasks_open', 'tasks_overdue', 'vaccination_overdue', 'stock_on_hand', 'stock_mismatches', 'active_grazings', 'plots_not_rested', 'purchase_requests_new', 'unread_notifications', 'elevated_actions', 'denies', 'backups_ok'];
        renderKpi(result.rows, kpiKeys);
        holder.appendChild(el('h3', { class: 'mt-3 mb-2', text: t('metric.summary') }));
        renderTable(Object.assign({}, page, { columns: [], crud: null, rowActions: [] }), result.rows, t('metric.summary'));
        setupChart(result.series, page);
    } else if (page.kind === 'metrics') {
        renderKpi(result.rows);
        renderTable(Object.assign({}, page, { crud: null, rowActions: [] }), result.rows, t('metric.summary'));
        hideChart();
    } else if (page.kind === 'report') {
        renderTable(page, result.rows, t('report.table'));
        setupChart(result.series, page);
        addExportButton(page);
    } else if (page.kind === 'grazing') {
        renderGrazing(page, result);
    } else {
        renderTable(page, result.rows, endpointOf(page));
        if (page.csvPath) addExportButton(page);
    }
    updatePager();
}

function renderGrazing(page, result) {
    const holder = $('view');
    holder.appendChild(el('p', { class: 'notice', text: t('grazing.note') + '. ' + t('grazing.derived') + '.' }));
    renderTable(Object.assign({}, page, { crud: null, rowActions: [] }), result.rows, t('grazing.note'));
    holder.appendChild(el('button', {
        class: 'btn btn-primary', type: 'button', text: t('grazing.move'),
        on: { click: () => openMoveGroup() }
    }));
    hideChart();
    state.plotsCache = result.plots || [];
    state.loadCache = result.load || [];
}

/* --------------------------------------------------------------------------
 * 10. CRUD и бизнес-действия (все через модалку)
 * -------------------------------------------------------------------------- */
async function mutation(method, path, body, reason, successMsg) {
    await api(method, path, body, { reason, silent: true });
    toast(t(successMsg || 'done'), 'ok');
    await loadPage();
}

function openCreate() {
    const page = currentPage();
    if (!page || !page.crud || !page.crud.createFields || !hasPerm(page.writePerm)) return;
    const title = Array.isArray(page.title) ? (state.lang === 'en' ? page.title[1] : page.title[0]) : page.title;
    openModal({
        title: t('actions.new') + ' · ' + title,
        fields: page.crud.createFields, mode: 'create',
        onSubmit: async (payload, reason) => {
            await mutation('POST', endpointOf(page), payload, reason, 'created');
        }
    });
}

function openEdit(row) {
    const page = currentPage();
    if (!page || !page.crud || !hasPerm(page.writePerm)) return;
    const fields = page.crud.editFields;
    if (!fields || !fields.length) { toast(t('err.403'), 'warn'); return; }
    openModal({
        title: t('actions.edit'), fields, values: row, mode: 'edit',
        onSubmit: async (payload, reason) => {
            if (!Object.keys(payload).length) throw new Error(t('err.400'));
            await mutation('PATCH', endpointOf(page) + '/' + row.id, payload, reason, 'updated');
        }
    });
}

function openDelete(row) {
    const page = currentPage();
    if (!page || !hasPerm(page.deletePerm)) return;
    openConfirm(t('confirmDelete'), t('confirmDeleteMsg'), async (reason) => {
        await api('DELETE', endpointOf(page) + '/' + row.id, undefined, { reason, silent: true });
        toast(t('deleted'), 'ok');
        await loadPage();
    });
}

async function customAction(method, path, body, msg) {
    try { await mutation(method, path, body, undefined, msg); }
    catch (err) { toast(err.message, 'err'); }
}

/* POST /stock/movements — приход / расход / списание / возврат */
function openMovement(preset) {
    if (!hasPerm('stock:WRITE')) { toast(t('err.403'), 'warn'); return; }
    const isWriteOff = preset === 'WRITE_OFF';
    const fields = [
        F('movement_type', 'select', { required: true, options: staticOpts(MOVEMENT_TYPES) }),
        F('batch_id', 'select', { required: true, optionsFrom: '/stock/batches' }),
        F('qty', 'number', { required: true, step: '0.001' }),
        F('write_off_reason_id', 'select', { optionsFrom: '/write-off-reasons' }),
        F('comment', 'text')
    ];
    const titles = {
        RECEIPT: ['Приход склада', 'Stock receipt'], ISSUE: ['Расход склада', 'Stock issue'],
        WRITE_OFF: ['Списание склада', 'Stock write-off'], RETURN: ['Возврат на склад', 'Stock return']
    };
    openModal({
        title: (titles[preset] || titles.RECEIPT)[state.lang === 'en' ? 1 : 0],
        fields, mode: 'create',
        values: { movement_type: preset || 'RECEIPT', write_off_reason_id: isWriteOff ? undefined : '' },
        onSubmit: async (payload, reason) => {
            const body = Object.assign({}, payload);
            if (!isWriteOff) delete body.write_off_reason_id;
            await mutation('POST', '/stock/movements', body, reason, 'done');
        }
    });
}

/* POST /tasks/:id/execute */
function openTaskExecute(row) {
    const target = row || state.selectedRow || (state.page === 'tasks' ? state.data[0] : null);
    if (!hasPerm('task:WRITE')) { toast(t('err.403'), 'warn'); return; }
    if (!target || !target.id) { toast(t('noSelection'), 'warn'); return; }
    openModal({
        title: t('task.execute') + ' #' + target.id,
        fields: [
            F('group_id', 'number', { required: true }),
            F('actual_amount', 'number', { step: '0.001' }),
            F('notes', 'textarea', { span: true })
        ],
        values: { group_id: target.group_id || '' },
        onSubmit: async (payload, reason) => {
            await mutation('POST', '/tasks/' + target.id + '/execute', payload, reason, 'done');
        }
    });
}

/* POST /animals/:id/status */
function openAnimalStatus(row) {
    if (!hasPerm('animal:WRITE')) { toast(t('err.403'), 'warn'); return; }
    openModal({
        title: t('animal.status') + ' · ' + (row.inventory_number || row.id),
        fields: [
            F('status', 'select', { required: true, options: staticOpts(ANIMAL_STATUSES) }),
            F('reason', 'textarea', { required: true, span: true }),
            F('diagnosis_id', 'number'), F('drug_nomenclature_id', 'number'),
            F('dosage', 'number', { step: '0.001' }), F('disposal_reason_id', 'number')
        ],
        onSubmit: async (payload, reason) => {
            await mutation('POST', '/animals/' + row.id + '/status', payload, reason, 'done');
        }
    });
}

/* POST /grazing/move — перевод группы */
function openMoveGroup() {
    if (!hasPerm('pasture:WRITE')) { toast(t('err.403'), 'warn'); return; }
    const groupIds = new Map();
    for (const a of (state.data || [])) {
        if (a.group_id !== undefined && a.group_id !== null) groupIds.set(String(a.group_id), a.group_name || ('#' + a.group_id));
    }
    const groupOptions = [...groupIds.entries()].map(([v, l]) => ({ value: Number(v), label: l }));
    openModal({
        title: t('grazing.move'),
        fields: [
            F('group_id', groupOptions.length ? 'select' : 'number', { required: true, options: groupOptions }),
            F('plot_id', 'select', { required: true, optionsFrom: '/pasture-plots' }),
            F('note', 'textarea', { span: true })
        ],
        onSubmit: async (payload, reason) => {
            await mutation('POST', '/grazing/move', payload, reason, 'done');
        }
    });
}

/* PATCH /admin/settings/:key */
function openSettingEdit(row) {
    openModal({
        title: t('actions.edit') + ' · ' + row.setting_key,
        fields: [
            F('value', 'text', { required: true, hint: row.value_type || '' }),
            F('description', 'textarea', { span: true })
        ],
        values: { value: row.value_num !== null && row.value_num !== undefined ? String(row.value_num) : (row.value_text || ''), description: row.description || '' },
        onSubmit: async (payload, reason) => {
            await mutation('PATCH', '/admin/settings/' + encodeURIComponent(row.setting_key), payload, reason, 'saved');
        }
    });
}

function openResetPassword(row) {
    openModal({
        title: t('actions.edit') + ' · ' + row.login,
        fields: [F('password', 'password', { required: true })],
        onSubmit: async (payload, reason) => {
            await mutation('POST', '/admin/users/' + row.id + '/reset-password', { password: payload.password }, reason, 'done');
        }
    });
}

/* POST /tech/backups */
function openBackup() {
    openModal({
        title: t('tech.backup'),
        fields: [
            F('backup_type', 'select', { required: true, options: staticOpts(['FULL', 'INCREMENTAL']) }),
            F('retention_days', 'number'), F('note', 'textarea', { span: true })
        ],
        values: { backup_type: 'FULL', retention_days: 30 },
        onSubmit: async (payload, reason) => { await mutation('POST', '/tech/backups', payload, reason, 'done'); }
    });
}

/* POST /tech/restores */
function openRestore() {
    openModal({
        title: t('tech.restore'),
        fields: [
            F('backup_job_id', 'select', { required: true, optionsFrom: '/tech/backups' }),
            F('reason', 'textarea', { required: true, span: true })
        ],
        onSubmit: async (payload, reason) => { await mutation('POST', '/tech/restores', payload, reason, 'done'); }
    });
}

/* POST /tech/maintenance */
function openMaintenance() {
    openModal({
        title: t('tech.maintenance'),
        fields: [
            F('operation', 'select', { required: true, options: staticOpts(['VACUUM', 'ANALYZE', 'REINDEX']) }),
            F('note', 'textarea', { span: true })
        ],
        values: { operation: 'VACUUM' },
        onSubmit: async (payload, reason) => { await mutation('POST', '/tech/maintenance', payload, reason, 'done'); }
    });
}

/* --------------------------------------------------------------------------
 * 11. Карта хозяйства (Leaflet + OSM)
 * -------------------------------------------------------------------------- */
/** Простой RegExp-парсер WKT POLYGON / MULTIPOLYGON: "lon lat" → [lat, lon]. */
function parseWkt(wkt) {
    if (!wkt || typeof wkt !== 'string') return [];
    const m = wkt.match(/POLYGON\s*\(\(([^)]*)\)\)/i) || wkt.match(/POLYGON\s*\(([^)]*)\)/i);
    if (!m) return [];
    const rings = [];
    for (const chunk of m[1].split(/\)\s*,\s*\(/)) {
        const ring = [];
        for (const pair of chunk.split(',')) {
            const nums = pair.trim().match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
            if (nums) ring.push([Number(nums[2]), Number(nums[1])]);
        }
        if (ring.length >= 3) rings.push(ring);
    }
    return rings;
}

function coordsFromPlot(plot) {
    if (!plot) return [];
    const raw = plot.geom_wkt || plot.wkt || plot.geom || plot.geometry;
    if (typeof raw === 'string') return parseWkt(raw);
    if (Array.isArray(raw) && raw.length) {
        if (typeof raw[0] === 'number' && raw.length >= 2) {
            return [raw.map((p) => Array.isArray(p) ? [Number(p[1]), Number(p[0])] : null).filter(Boolean)];
        }
        if (Array.isArray(raw[0])) return raw.map((ring) => ring.map((p) => [Number(p[1]), Number(p[0])])).filter((r) => r.length >= 3);
    }
    if (raw && Array.isArray(raw.coordinates)) {
        return raw.coordinates.map((ring) => ring.map((p) => [Number(p[1]), Number(p[0])])).filter((r) => r.length >= 3);
    }
    if (Array.isArray(plot.coordinates) && plot.coordinates.length) {
        return [plot.coordinates.map((p) => [Number(p[1]), Number(p[0])])];
    }
    return [];
}

async function waitForLeaflet(tries) {
    for (let i = 0; i < (tries || 12); i++) {
        if (window.L && window.L.map) return true;
        await sleep(250);
    }
    return false;
}

async function toggleMap(forceShow) {
    const box = $('map-container');
    if (forceShow === false || (!box.hidden && forceShow !== true)) { hideMap(); return; }
    show(box, true);
    const ok = await waitForLeaflet();
    if (!ok) { toast(t('map.noLeaflet'), 'err'); return; }
    let plots = state.plotsCache.length ? state.plotsCache : state.data;
    if (!plots.length) {
        try {
            const r = await api('GET', '/pasture-plots', undefined, { query: { limit: MAX_LIMIT }, silent: true });
            plots = (r && r.data) || [];
        } catch { plots = []; }
    }
    /* Список может не содержать WKT — догружаем контуры через /:id. */
    const withGeom = await Promise.all(plots.slice(0, 30).map(async (p) => {
        if (coordsFromPlot(p).length) return p;
        if (state.wktCache.has(String(p.id))) return Object.assign({}, p, { geom_wkt: state.wktCache.get(String(p.id)) });
        try {
            const r = await api('GET', '/pasture-plots/' + p.id, undefined, { silent: true });
            const wkt = r && r.data && r.data.geom_wkt;
            if (wkt) { state.wktCache.set(String(p.id), wkt); return Object.assign({}, p, { geom_wkt: wkt }); }
        } catch { /* нет права или нет контура */ }
        return p;
    }));
    renderMap(withGeom);
}

function hideMap() {
    show($('map-container'), false);
    if (state.map) { try { state.map.remove(); } catch { /* ignore */ } state.map = null; state.mapLayer = null; }
}

function plotColor(plot) {
    const lr = state.loadCache.find((r) => String(r.plot_id || r.id) === String(plot.id)) || {};
    const heads = Number(plot.active_head_count || lr.active_heads || 0);
    const area = Number(plot.area_ha || lr.area_ha || 0);
    const norm = Number(plot.max_head_per_ha || lr.norm_head_per_ha || 0);
    if (norm > 0 && area > 0 && heads / area > norm) return '#B3261E';       // перегрузка
    if (lr.rest_ok === false || lr.risk === 'REST_NOT_COMPLETE') return '#FF8F00'; // отдых не завершён
    if (heads > 0 || lr.in_use) return '#2E7D32';                              // занят
    return '#2C5D7C';                                                            // свободен
}

function renderLegend(hasGeom) {
    const p = $('map-container').querySelector('.map-legend');
    if (!p) return;
    clear(p);
    p.appendChild(document.createTextNode(t('map.legend') + ' · '));
    const items = [
        ['#2E7D32', 'map.legend.loaded'], ['#FF8F00', 'map.legend.rest'],
        ['#2C5D7C', 'map.legend.free'], ['#B3261E', 'map.legend.over']
    ];
    for (const [color, key] of items) {
        p.appendChild(el('span', {}, [el('i', { style: 'background:' + color }), document.createTextNode(t(key))]));
    }
    if (hasGeom) p.appendChild(document.createTextNode(' · ' + t('map.legend.approx')));
}

/** Попап собирается из DOM-узлов (никакого innerHTML с данными). */
function popupNode(plot) {
    const box = el('div', { style: 'min-width:180px' });
    box.appendChild(el('strong', { text: (plot.plot_no || '#' + plot.id) + ' · ' + (plot.name || '') }));
    const rows = [
        [labelOf('area_ha'), plot.area_ha], [labelOf('active_head_count'), plot.active_head_count],
        [labelOf('max_head_per_ha'), plot.max_head_per_ha], [labelOf('vegetation_type'), plot.vegetation_type],
        [labelOf('rest_days_required'), plot.rest_days_required]
    ];
    for (const [k, v] of rows) {
        const line = el('div');
        line.appendChild(el('strong', { text: k + ': ' }));
        line.appendChild(document.createTextNode(v === null || v === undefined ? '—' : String(v)));
        box.appendChild(line);
    }
    return box;
}

function renderMap(plots) {
    const L = window.L;
    if (!L) return;
    if (state.map) { try { state.map.remove(); } catch { /* ignore */ } state.map = null; }
    const canvas = $('map');
    clear(canvas);
    const map = L.map(canvas, { scrollWheelZoom: true }).setView([55.7525, 37.610], 14);
    state.map = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    }).addTo(map);

    const layer = L.layerGroup().addTo(map);
    state.mapLayer = layer;
    const bounds = [];
    let geometries = 0;
    for (const plot of plots) {
        const rings = coordsFromPlot(plot);
        if (!rings.length) continue;
        geometries++;
        const color = plotColor(plot);
        const style = { color, weight: 2, fillColor: color, fillOpacity: 0.28 };
        const latlngs = rings[0]; // первый внешний контур
        const poly = L.polygon(latlngs, style).addTo(layer);
        poly.bindPopup(popupNode(plot));
        poly.on('mouseover', () => poly.setStyle({ weight: 3, fillOpacity: 0.45 }));
        poly.on('mouseout', () => poly.setStyle(style));
        for (const pt of latlngs) {
            if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) bounds.push(pt);
        }
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    renderLegend(geometries > 0);
    if (!geometries) toast(t('map.noGeom'), 'warn');
    setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 80);
}

/* --------------------------------------------------------------------------
 * 12. Canvas-графики (без библиотек)
 * -------------------------------------------------------------------------- */
const CHART_COLORS = ['#2E7D32', '#FF8F00', '#2C5D7C', '#B3261E', '#6A1B9A', '#00838F'];
const LABEL_KEYS = ['period', 'month', 'period_month', 'plot', 'plot_no', 'sku', 'status', 'assignee', 'reason_type', 'name', 'label', 'group_name'];

function seriesToVariants(series, page) {
    const out = [];
    if (!series || typeof series !== 'object') return out;
    const entries = Object.entries(series);
    /* dashboard: предпочитаем stock_trend. */
    if (series.stock_trend && Array.isArray(series.stock_trend)) {
        entries.sort((a, b) => (a[0] === 'stock_trend' ? -1 : (b[0] === 'stock_trend' ? 1 : 0)));
    }
    for (const [key, arr] of entries) {
        if (!Array.isArray(arr) || !arr.length || typeof arr[0] !== 'object' || arr[0] === null) continue;
        const first = arr[0];
        const labelKey = LABEL_KEYS.find((k) => k in first) || Object.keys(first).find((k) => typeof first[k] === 'string') || Object.keys(first)[0];
        const numKeys = Object.keys(first).filter((k) => k !== labelKey && (typeof first[k] === 'number' || (!Number.isNaN(Number(first[k])) && first[k] !== '' && first[k] !== null))).slice(0, 4);
        if (!numKeys.length) continue;
        const isLine = /trend|month|by_month|period/i.test(key) || page.kind === 'dashboard';
        out.push({
            name: key,
            title: labelOf(key) + ' · ' + labelOf(labelKey),
            labels: arr.map((r, i) => String(r[labelKey] !== undefined && r[labelKey] !== null ? r[labelKey] : i + 1)),
            type: isLine ? 'line' : 'bar',
            series: numKeys.map((k, i) => ({
                name: labelOf(k), key: k, color: CHART_COLORS[i % CHART_COLORS.length],
                values: arr.map((r) => { const n = Number(r[k]); return Number.isFinite(n) ? n : 0; })
            }))
        });
    }
    return out;
}

function setupChart(series, page) {
    const meta = $('chart-meta');
    const variants = seriesToVariants(series, page);
    state.chartVariants = variants;
    state.chartIndex = 0;
    clear(meta);
    if (!variants.length) { hideChart(); return; }
    show($('chart-panel'), true);
    $('chart-title').textContent = t('chart.title');

    if (variants.length > 1) {
        const sel = el('select', { class: 'field-input', 'aria-label': t('chart.series') });
        sel.style.width = 'auto';
        variants.forEach((v, i) => sel.appendChild(el('option', { value: String(i), text: v.name })));
        sel.addEventListener('change', () => { state.chartIndex = Number(sel.value) || 0; showChartVariant(); });
        meta.appendChild(sel);
    } else meta.appendChild(el('span', { text: variants[0].name }));

    /* series.summary → KPI-карточки здоровья стада. */
    if (series && series.summary && typeof series.summary === 'object') {
        const grid = el('div', { class: 'kpi-grid' });
        for (const [k, v] of Object.entries(series.summary)) {
            grid.appendChild(el('div', { class: 'kpi-card' }, [
                el('div', { class: 'kpi-label', text: labelOf(k) }),
                el('div', { class: 'kpi-value', text: humanNumber(v) })
            ]));
        }
        $('view').insertBefore(grid, $('view').firstChild);
    }
    showChartVariant();
}

function hideChart() {
    show($('chart-panel'), false);
    state.chartCurrent = null;
    const wrap = $('chart-panel').querySelector('.chart-wrap');
    if (wrap) for (const n of [...wrap.querySelectorAll('.chart-legend')]) n.remove();
}

function showChartVariant() {
    const v = state.chartVariants[state.chartIndex];
    if (!v) { hideChart(); return; }
    state.chartCurrent = v;
    $('chart-title').textContent = v.title;
    drawChart($('chart-canvas'), v);
    const wrap = $('chart-panel').querySelector('.chart-wrap');
    for (const n of [...wrap.querySelectorAll('.chart-legend')]) n.remove();
    const legend = el('div', { class: 'chart-legend' });
    for (const s of v.series) {
        legend.appendChild(el('span', {}, [el('i', { style: 'background:' + s.color }), document.createTextNode(s.name)]));
    }
    wrap.appendChild(legend);
}

function drawChart(canvas, variant) {
    if (!canvas || !variant) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || 960));
    const h = Math.max(180, Math.round(rect.height || w / 3));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#FFFDF7';
    ctx.fillRect(0, 0, w, h);

    const labels = variant.labels || [];
    const sets = variant.series || [];
    const all = sets.flatMap((s) => s.values || []);
    if (!labels.length || !all.length) {
        ctx.fillStyle = '#7C8770';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(t('chart.nodata'), w / 2, h / 2);
        return;
    }
    const pad = { l: 62, r: 16, t: 18, b: 40 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const maxV = Math.max(1, ...all.map((n) => Number(n) || 0));
    const minV = Math.min(0, ...all.map((n) => Number(n) || 0));
    const span = (maxV - minV) || 1;
    const yOf = (v) => pad.t + ph - ((Number(v) - minV) / span) * ph;

    /* Сетка и подписи значений. */
    ctx.strokeStyle = '#E4E0D2';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#7C8770';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const y = pad.t + (ph / 4) * i;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
        ctx.fillText(humanNumber(minV + span * (1 - i / 4)), pad.l - 8, y + 4);
    }
    ctx.strokeStyle = '#C4BBA1';
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ph); ctx.lineTo(w - pad.r, pad.t + ph); ctx.stroke();

    /* Подписи категорий (прореживаем, чтобы не накладывались). */
    const step = Math.max(1, Math.ceil(labels.length / Math.max(4, Math.floor(pw / 90))));
    ctx.textAlign = 'center';
    ctx.fillStyle = '#53604A';
    for (let i = 0; i < labels.length; i += step) {
        const x = pad.l + (variant.type === 'bar' ? (i + 0.5) * pw / labels.length : (labels.length === 1 ? pw / 2 : i * pw / (labels.length - 1)));
        const txt = String(labels[i]);
        ctx.fillText(txt.length > 12 ? txt.slice(0, 11) + '…' : txt, x, h - pad.b + 18);
    }

    if (variant.type === 'bar') {
        const groupW = pw / labels.length;
        const bw = Math.max(2, Math.min(28, groupW / (sets.length + 1.5)));
        sets.forEach((s, si) => {
            ctx.fillStyle = s.color;
            s.values.forEach((v, i) => {
                const x = pad.l + i * groupW + groupW / 2 + (si - (sets.length - 1) / 2) * bw;
                const y = yOf(v);
                ctx.fillRect(x - bw / 2, y, bw, Math.max(1, pad.t + ph - y));
            });
        });
    } else {
        sets.forEach((s) => {
            ctx.strokeStyle = s.color;
            ctx.fillStyle = s.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            s.values.forEach((v, i) => {
                const x = pad.l + (s.values.length === 1 ? pw / 2 : i * pw / (s.values.length - 1));
                const y = yOf(v);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            s.values.forEach((v, i) => {
                const x = pad.l + (s.values.length === 1 ? pw / 2 : i * pw / (s.values.length - 1));
                ctx.beginPath(); ctx.arc(x, yOf(v), 3, 0, Math.PI * 2); ctx.fill();
            });
        });
    }
}

/* --------------------------------------------------------------------------
 * 13. Экспорт CSV
 * -------------------------------------------------------------------------- */
function addExportButton(page) {
    $('view').appendChild(el('button', {
        class: 'btn btn-secondary', type: 'button', text: t('csv.export'),
        on: { click: () => exportPageCsv(page) }
    }));
}

async function exportPageCsv(page) {
    /* Отчёты и аудит: серверный ?format=csv (требует export:EXEC). */
    if (page.kind === 'report' || page.csvPath) {
        if (!hasPerm('export:EXEC')) {
            toast(t('csv.noPerm'), 'warn');
            saveCsv(rowsToCsv(state.data), (page.csvPath ? 'audit-log' : state.page) + '.csv');
            return;
        }
        try {
            const q = queryFor(page);
            delete q.limit; delete q.offset; delete q.sort;
            if (page.csvPath) await downloadCsv(page.csvPath, 'audit-log.csv', q);
            else await downloadCsv(page.endpoint, state.page + '.csv', q);
            return;
        } catch (err) {
            toast(err.message, 'warn');
        }
    }
    /* Остальные разделы: локальная выгрузка загруженных строк. */
    saveCsv(rowsToCsv(state.data), state.page + '.csv');
    toast(t('csv.done'), 'ok');
}

/* --------------------------------------------------------------------------
 * 14. Горячие клавиши и события
 * -------------------------------------------------------------------------- */
function focusSearch() {
    const n = $('filter-search');
    if (!n || $('app-view').hidden) return;
    n.focus(); n.select();
}

function openAssign() {
    const page = currentPage();
    if (!page) return;
    if (state.page === 'grazing') { openMoveGroup(); return; }
    if (state.page === 'tasks') { openCreate(); return; }
    if (page.toolbar) {
        const a = page.toolbar.find((x) => x.key === 'assign' || x.key === 'move');
        if (a && hasPerm(a.perm)) { a.run(); return; }
    }
    openCreate();
}

function openExecute() {
    if (state.page === 'tasks') { openTaskExecute(); return; }
    if (state.page === 'animals' && state.selectedRow) { openAnimalStatus(state.selectedRow); return; }
    if (currentPage() && currentPage().toolbar) {
        const a = currentPage().toolbar.find((x) => x.key === 'execute');
        if (a && hasPerm(a.perm)) { a.run(); return; }
    }
    toast(t('noSelection'), 'warn');
}

function handleKey(e) {
    const target = e.target || document.body;
    const tag = String(target.tagName || '').toLowerCase();
    const typing = ['input', 'textarea', 'select'].includes(tag) || target.isContentEditable;

    if (e.key === 'Escape') {
        if (state.modal) closeModal();
        else { closeHelp(); hideMap(); $('sidebar').classList.remove('open'); }
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); focusSearch(); return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !state.token) return;

    if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); openHelp(); return; }
    if (e.key === '/') { e.preventDefault(); focusSearch(); return; }

    const k = e.key.toLowerCase();
    if (state.gPending) {
        state.gPending = false;
        if (state.gTimer) { clearTimeout(state.gTimer); state.gTimer = null; }
        const map = { a: 'animals', s: 'stock', d: 'dashboard', t: 'tasks', p: 'plots', e: 'employees', g: 'grazing' };
        if (map[k]) { e.preventDefault(); navigate(map[k]); return; }
    }
    if (k === 'g') {
        state.gPending = true;
        state.gTimer = setTimeout(() => { state.gPending = false; state.gTimer = null; }, 1200);
        return;
    }
    const actions = {
        n: () => openCreate(), r: () => loadPage(),
        i: () => openMovement('RECEIPT'), o: () => openMovement('ISSUE'),
        w: () => openMovement('WRITE_OFF'), a: () => openAssign(), d: () => openExecute()
    };
    if (actions[k]) { e.preventDefault(); actions[k](); }
}

function bindEvents() {
    $('login-form').addEventListener('submit', doLogin);
    $('logout-btn').addEventListener('click', doLogout);
    $('theme-toggle').addEventListener('change', () => {
        state.theme = $('theme-toggle').checked ? 'dark' : 'light';
        applyTheme();
    });

    /* Переключатель языка RU/EN (в index.html его нет — создаём здесь). */
    const langBtn = el('button', { class: 'btn btn-ghost', id: 'lang-toggle', type: 'button', title: t('lang.switch') });
    langBtn.addEventListener('click', () => {
        state.lang = state.lang === 'ru' ? 'en' : 'ru';
        applyLang();
        if (state.page) { renderChrome(currentPage()); configureFilters(currentPage()); loadPage(); }
    });
    $('app-header').insertBefore(langBtn, document.querySelector('.theme-switch'));

    $('sidebar-toggle').addEventListener('click', () => {
        const open = $('sidebar').classList.toggle('open');
        $('sidebar-toggle').setAttribute('aria-expanded', String(open));
    });
    $('sidebar').addEventListener('click', (e) => {
        if (e.target.closest('.nav-link')) {
            $('sidebar').classList.remove('open');
            $('sidebar-toggle').setAttribute('aria-expanded', 'false');
        }
    });
    $('refresh-btn').addEventListener('click', () => loadPage());
    $('create-btn').addEventListener('click', () => openCreate());
    $('filters-apply').addEventListener('click', applyFilters);
    $('filters-reset').addEventListener('click', resetFilters);
    $('filter-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyFilters(); } });
    $('filter-search').addEventListener('input', debounce(applyFilters, 350));
    $('filter-status').addEventListener('change', applyFilters);
    $('filter-limit').addEventListener('change', applyFilters);
    $('filter-from').addEventListener('change', applyFilters);
    $('filter-to').addEventListener('change', applyFilters);
    $('pager-prev').addEventListener('click', () => { if (state.pageNo > 1) { state.pageNo--; state.offset = (state.pageNo - 1) * state.limit; loadPage(); } });
    $('pager-next').addEventListener('click', () => { state.pageNo++; state.offset = (state.pageNo - 1) * state.limit; loadPage(); });

    $('map-close').addEventListener('click', () => hideMap());
    $('modal').addEventListener('click', (e) => { if (e.target.closest('[data-modal-close]')) closeModal(); });
    $('modal-form').addEventListener('submit', onModalSubmit);
    $('help-open').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', closeHelp);
    $('help-ok').addEventListener('click', closeHelp);
    $('help-dialog').addEventListener('click', (e) => { if (e.target.id === 'help-dialog') closeHelp(); });

    window.addEventListener('hashchange', route);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', debounce(() => {
        if (state.chartCurrent) drawChart($('chart-canvas'), state.chartCurrent);
        if (state.map) { try { state.map.invalidateSize(); } catch { /* ignore */ } }
    }, 220));
}

/* --------------------------------------------------------------------------
 * 15. Bootstrap
 * -------------------------------------------------------------------------- */
async function bootstrap() {
    try { state.theme = localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch { /* ignore */ }
    try { state.lang = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ru'; } catch { /* ignore */ }
    try { state.overrideReason = sessionStorage.getItem(OVERRIDE_KEY) || ''; } catch { /* ignore */ }
    bindEvents();
    applyTheme();
    applyLang();
    renderMenu();

    let token = null;
    try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
    if (!token) { showLogin(''); return; }

    state.token = token;
    try {
        const me = await api('GET', '/auth/me', undefined, { silent: true });
        if (!me || typeof me !== 'object') throw new Error(t('err.401'));
        state.user = me;
        state.permissions = new Set(Array.isArray(me.permissions) ? me.permissions : []);
        renderMenu();
        updateUserChip();
        show($('login-view'), false);
        show($('app-view'), true);
        const target = pageIdFromHash();
        if (target && PAGES[target] && hasPerm(PAGES[target].perm)) route();
        else navigate(defaultPage());
    } catch {
        if (!state.token) return; // api() уже выполнил forceLogout()
        forceLogout('');
    }
}

/* Публичный API модуля (для консоли/тестов). */
export { API_BASE, state, api, PAGES, HOTKEYS, toast, loadPage, navigate, bootstrap };

bootstrap();
