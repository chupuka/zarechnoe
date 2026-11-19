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

const ANIMAL_STATUSES = ['ЗДОРОВ', 'НА_ОСМОТРЕ', 'НА_КАРАНТИНЕ', 'НА_ЛЕЧЕНИИ', 'НА_ПРОДАЖЕ', 'ПРОДАН', 'ВЫБРАКОВАНО', 'ПАДЁЖ'];
const TASK_STATUSES = ['NEW', 'IN_WORK', 'DONE', 'CANCELLED'];
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'];
const MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'WRITE_OFF', 'RETURN'];
const BACKUP_STATUSES = ['RUNNING', 'OK', 'FAILED'];
const AUDIT_ACTIONS = ['LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'DENY', 'EXPORT', 'READ_PII'];
const ASSIGN_ROLES = ['VET', 'HERDSMAN', 'FOREMAN', 'ZOOTECHNIK'];

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
        'actions': 'Действия', 'actions.palette': 'Действия', 'action.search': 'Найти действие',
        'action.entity': 'Найти запись', 'action.context': 'Все операции, доступные вашей роли. Выберите действие — при необходимости появится поиск записи.',
        'action.empty': 'Ничего не найдено. Попробуйте другой запрос или проверьте права роли.',
        'action.pick': 'Выберите запись', 'action.back': '← Назад к действиям',
        'admin.block': 'Блокировка пользователя',
        'help.role': 'Справка для роли', 'help.note': 'Список ниже собран из ваших прав: действий, которых у роли нет, в нём не бывает.',
        'edit': 'Изменить', 'delete': 'Удалить', 'save': 'Сохранить',
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
        'actions': 'Actions', 'actions.palette': 'Actions', 'action.search': 'Find an action',
        'action.entity': 'Find a record', 'action.context': 'Every operation your role is allowed to run. Pick one — a record picker appears when needed.',
        'action.empty': 'Nothing found. Try another query or check your role permissions.',
        'action.pick': 'Pick a record', 'action.back': '← Back to actions',
        'admin.block': 'Block a user',
        'help.role': 'Help for role', 'help.note': 'The list below is built from your permissions: actions your role lacks are never shown.',
        'edit': 'Edit', 'delete': 'Delete', 'save': 'Save',
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
    position_name: ['Должность', 'Position'], phone_mask: ['Телефон (маска)', 'Phone (mask)'],
    has_pii: ['ПДн заполнены', 'PII filled'], assigned_count: ['Закреплений', 'Assignments'],
    assigned_names: ['Кто закреплён', 'Assigned to'], is_online: ['Онлайн', 'Online'],
    last_seen_at: ['Был(а) онлайн', 'Last seen'], blocked_reason: ['Причина блокировки', 'Block reason'],
    sessions_count: ['Сессий', 'Sessions'], accounts_count: ['Учётных записей', 'Accounts'],
    dismissed_at: ['Дата увольнения', 'Dismissed at'],
    dismissal_reason: ['Причина увольнения', 'Dismissal reason'],
    restores: ['Восстановлений', 'Restores'], origin: ['Источник', 'Origin'],
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

/* Пункты меню: data-view → [RU, EN]. Ключи совпадают с data-view из index.html. */
const NAV_LABELS = {
    home: ['Главная', 'Home'],
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
    'admin-users': ['Пользователи', 'Users'], users: ['Пользователи', 'Users'],
    roles: ['Роли и права', 'Roles & permissions'],
    'audit-log': ['Журнал аудита', 'Audit log'], audit: ['Журнал аудита', 'Audit log'],
    settings: ['Настройки', 'Settings'],
    backups: ['Резервные копии', 'Backups'], restores: ['Восстановления', 'Restores'],
    'tech-log': ['Тех. лог', 'Tech log'],
    metrics: ['Скорость БД', 'DB query speed'],
    'dba-migrations': ['Миграции схемы', 'Schema migrations'],
    'dba-history': ['История миграций', 'Migration history'],
    'dba-monitor': ['Мониторинг БД', 'DB monitoring'],
    'dba-backups': ['Копии на диске', 'Backup files']
};
const NAV_GROUP_LABELS = {
    'Обзор': ['Обзор', 'Overview'],
    'Реестры': ['Реестры', 'Registries'], 'Операции': ['Операции', 'Operations'],
    'Аналитика': ['Аналитика', 'Analytics'],
    'Администрирование': ['Администрирование', 'Administration'],
    'Технадминка': ['Технадминка', 'Tech admin'],
    'Администратор БД': ['Администратор БД', 'DB administrator']
};

/* Базовый список горячих клавиш; фактическая справка строится hotkeyRows()
   по правам текущей роли. Константа остаётся частью публичного API модуля. */
const HOTKEYS = [
    ['Ctrl+K', 'actions.palette'], ['?', 'hk.help'], ['N', 'hk.new'], ['E', 'actions.edit'],
    ['B', 'admin.block'], ['I', 'hk.receipt'], ['O', 'hk.issue'], ['W', 'hk.writeoff'],
    ['A', 'hk.assign'], ['D', 'hk.execute'], ['/', 'hk.focus'], ['R', 'hk.refresh'],
    ['G …', 'hk.goto'], ['Esc', 'hk.close']
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
    filters: {},                // активные фильтры текущего раздела (name -> строка)
    extra: {},                 // резерв: вычисленные/версионные значения
    extraEndpoint: null,      // вариант эндпоинта (склад: batches/balances)
    sort: '',
    data: [],
    series: null,
    statCards: [],            // плашка /stats/:section
    backupData: null,         // /tech/backups/overview
    perfData: null,           // /tech/metrics/perf
    herdData: null,           // /animals/herd (сводка бригадира)
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

/* ---- Декларативные фильтры раздела (рисуются в #page-tools у заголовка) ---- */
function fSel(name, label, options, extra) {
    return Object.assign({ name, label, type: 'select', options }, extra || {});
}
function fSearch(ph) { return { name: 'q', label: 'Поиск', type: 'search', ph: ph || '' }; }
function fDate(name, label, query) { return { name, label, type: 'date', query }; }
function fCheck(name, label) { return { name, label, type: 'checkbox' }; }
/** Пары [значение, подпись] → опции селекта; строка → {value,label}. */
function fPairs(values) {
    return values.map((v) => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: String(v) }));
}

const PAGES = {
    /* ---- Обзор: главная страница по роли ---- */
    home: {
        endpoint: '/stats/main', perm: null, eyebrow: ['Обзор', 'Overview'],
        title: ['Главная', 'Home'], kind: 'home', statSection: 'main',
        noFilters: true, noPager: true
    },

    /* ---- Реестры ---- */
    animals: {
        endpoint: '/animals', perm: 'animal:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Животные', 'Animals'], kind: 'table', statSection: 'animals',
        columns: ['id', 'inventory_number', 'breed', 'group_name', 'status', 'sex', 'birth_date', 'assigned_count', 'assigned_names'],
        sortable: ['id', 'inventory_number', 'birth_date', 'sex', 'status', 'arrival_date', 'created_at'],
        filters: [
            fSearch('Инв. номер, порода'),
            fSel('status', 'Статус', fPairs(ANIMAL_STATUSES)),
            { name: 'group_id', label: 'Группа', type: 'select', optionsFrom: '/animals/herd', optionsPath: 'groups' },
            fSel('unassigned', 'Закрепление', fPairs([['true', 'Без закреплений']]))
        ],
        writePerm: 'animal:WRITE', deletePerm: 'animal:DELETE',
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
        rowActions: [
            { key: 'status', label: ['Статус', 'Status'], perm: 'animal:WRITE', run: (row) => openAnimalStatus(row) },
            { key: 'assign', label: ['Закрепить', 'Assign'], perm: 'animal:WRITE', run: (row) => openAnimalAssign(row) }
        ]
    },
    groups: {
        endpoint: '/species', perm: 'group:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Группы (виды)', 'Groups (species)'], kind: 'table',
        columns: [], sortable: ['id', 'code', 'name'], writePerm: 'catalog:WRITE', deletePerm: 'catalog:WRITE',
        filters: [fSearch('Код или название')],
        crud: {
            createFields: [F('code', 'text', { required: true }), F('name', 'text', { required: true })],
            editFields: [F('code', 'text'), F('name', 'text')]
        }
    },
    inspections: {
        endpoint: '/animals', perm: 'health:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Осмотры', 'Inspections'], kind: 'table', statSection: 'animals',
        columns: ['id', 'inventory_number', 'breed', 'group_name', 'status', 'birth_date', 'assigned_names'],
        sortable: ['inventory_number', 'birth_date', 'status'],
        filters: [fSearch('Инв. номер'), fSel('status', 'Статус', fPairs(ANIMAL_STATUSES))],
        preset: { status: 'НА_ОСМОТРЕ' },
        rowActions: [{ key: 'status', label: ['Статус', 'Status'], perm: 'animal:WRITE', run: (row) => openAnimalStatus(row) }]
    },
    vaccinations: {
        endpoint: '/animals', perm: 'health:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Вакцинации', 'Vaccinations'], kind: 'table', statSection: 'animals',
        columns: ['id', 'inventory_number', 'breed', 'group_name', 'status', 'arrival_date', 'assigned_names'],
        sortable: ['inventory_number', 'arrival_date', 'status'],
        filters: [fSearch('Инв. номер'), fSel('status', 'Статус', fPairs(ANIMAL_STATUSES))],
        preset: { status: 'НА_ЛЕЧЕНИИ' },
        rowActions: [{ key: 'status', label: ['Статус', 'Status'], perm: 'animal:WRITE', run: (row) => openAnimalStatus(row) }]
    },
    stock: {
        endpoint: '/stock/batches', perm: 'stock:READ', eyebrow: ['Реестры', 'Registries'],
        title: ['Склад', 'Stock'], kind: 'table', statSection: 'stock',
        columns: ['id', 'batch_number', 'nomenclature', 'sku', 'warehouse', 'qty_on_hand', 'received_at', 'expiry_date', 'unit_cost'],
        sortable: ['id', 'batch_number', 'received_at', 'expiry_date', 'qty_on_hand'],
        filters: [fSearch('Партия, номенклатура, SKU')],
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
        title: ['Пастбищные участки', 'Pasture plots'], kind: 'table', statSection: 'pasture',
        columns: ['id', 'plot_no', 'name', 'area_ha', 'vegetation_type', 'max_head_per_ha', 'active_head_count', 'rest_days_required', 'is_active'],
        sortable: ['id', 'plot_no', 'name', 'area_ha', 'max_head_per_ha'],
        filters: [fSearch('№ участка, название')],
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
        title: ['Задачи / наряды', 'Tasks'], kind: 'table', statSection: 'tasks',
        columns: ['id', 'title', 'task_type', 'assignee', 'priority', 'status', 'planned_date', 'due_at'],
        sortable: ['id', 'planned_date', 'due_at', 'priority', 'status', 'created_at'],
        filters: [
            fSearch('Заголовок задачи'),
            fSel('status', 'Статус', fPairs(TASK_STATUSES)),
            { name: 'assigned_to', label: 'Исполнитель', type: 'select', optionsFrom: '/employees' }
        ],
        writePerm: 'task:WRITE', deletePerm: 'task:DELETE',
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
        title: ['Сотрудники', 'Employees'], kind: 'table', statSection: 'employees',
        columns: ['id', 'full_name', 'position_name', 'phone_mask', 'hire_date', 'is_active', 'assigned_count', 'has_pii', 'is_online'],
        sortable: ['id', 'full_name', 'hire_date', 'is_active', 'assigned_count', 'position_name'],
        filters: [
            fSearch('ФИО сотрудника'),
            { name: 'position_id', label: 'Должность', type: 'select', optionsFrom: '/positions' },
            fSel('is_active', 'Работает', fPairs([['true', 'Да'], ['false', 'Уволен']])),
            fSel('pii', 'ПДн', fPairs([['yes', 'Заполнены'], ['no', 'Не заполнены']])),
            fSel('assigned', 'Закрепления', fPairs([['yes', 'Есть'], ['no', 'Нет']])),
            fCheck('include_deleted', 'С удалёнными')
        ],
        writePerm: 'employee:WRITE', deletePerm: 'employee:WRITE',
        crud: {
            createFields: [
                F('full_name', 'text', { required: true }),
                F('position_id', 'select', { required: true, optionsFrom: '/positions' }),
                F('hire_date', 'date'),
                F('phone', 'text', { hint: 'ПДн: шифруется на сервере' }),
                F('passport', 'text'), F('address', 'text'), F('snils', 'text'),
                F('inn', 'text'), F('bank_account', 'text'), F('emergency_contact', 'text')
            ],
            editFields: [F('full_name', 'text'), F('position_id', 'select', { optionsFrom: '/positions' }), F('hire_date', 'date')]
        },
        rowActions: [
            { key: 'pii', label: ['ПДн', 'PII'], perm: 'employee:PII', run: (row) => openEmployeePii(row) },
            { key: 'assign', label: ['Закрепить', 'Assign'], perm: 'employee:WRITE', run: (row) => openEmployeeAssign(row) },
            { key: 'dismiss', label: ['Уволить', 'Dismiss'], perm: 'employee:WRITE', run: (row) => openEmployeeDismiss(row) },
            { key: 'reinstate', label: ['Восстановить', 'Reinstate'], perm: 'employee:WRITE', run: (row) => openEmployeeReinstate(row) }
        ]
    },

    /* ---- Операции ---- */
    grazing: {
        endpoint: '/pasture-plots', perm: 'pasture:WRITE', eyebrow: ['Операции', 'Operations'],
        title: ['Выпас', 'Grazing'], kind: 'grazing', statSection: 'pasture',
        columns: ['plot_no', 'name', 'area_ha', 'group_name', 'head_count', 'days_on_plot', 'rest_status', 'load'],
        filters: [fSearch('№ участка, название')],
        toolbar: [
            { key: 'move', label: ['Перевести группу', 'Move group'], hotkey: 'A', perm: 'pasture:WRITE', run: () => openMoveGroup() },
            { key: 'map', label: ['Карта', 'Map'], run: () => toggleMap(true) }
        ]
    },
    movements: {
        endpoint: '/stock/balances', perm: 'stock:WRITE', eyebrow: ['Операции', 'Operations'],
        title: ['Движения склада', 'Stock movements'], kind: 'table', statSection: 'stock',
        columns: ['id', 'batch_id', 'batch_number', 'nomenclature', 'sku', 'warehouse', 'qty_on_hand', 'updated_at'],
        sortable: ['id', 'qty_on_hand', 'updated_at', 'batch_number'],
        filters: [fSearch('Партия, номенклатура, SKU')],
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
        title: ['Пользователи', 'Users'], kind: 'table', statSection: 'users',
        columns: ['id', 'login', 'full_name', 'role_code', 'employee_name', 'is_active', 'is_online', 'failed_cnt', 'must_change_pw', 'sessions_count', 'last_login_at', 'blocked_reason'],
        sortable: ['id', 'login', 'full_name', 'last_login_at', 'is_active'],
        filters: [
            fSearch('Логин, ФИО, сотрудник'),
            { name: 'role_id', label: 'Роль', type: 'select', optionsFrom: '/admin/roles' },
            fSel('state', 'Состояние', fPairs([
                ['active', 'Активные'], ['blocked', 'Заблокированы'], ['locked', 'Временная блокировка'],
                ['online', 'Онлайн'], ['no_password_change', 'Не сменили пароль']
            ])),
            fCheck('include_deleted', 'С удалёнными')
        ],
        writePerm: 'user:WRITE', deletePerm: 'user:WRITE',
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
            { key: 'block', label: ['Блокировать', 'Block'], perm: 'user:WRITE', run: (row) => openUserBlock(row) },
            { key: 'unblock', label: ['Разблокировать', 'Unblock'], perm: 'user:WRITE', run: (row) => openUserUnblock(row) },
            { key: 'genpw', label: ['Новый пароль', 'New password'], perm: 'user:WRITE', run: (row) => generateUserPassword(row) },
            { key: 'sessions', label: ['Сессии', 'Sessions'], perm: 'user:READ', run: (row) => openUserSessions(row) }
        ]
    },
    roles: {
        endpoint: '/admin/roles', perm: 'user:READ', eyebrow: ['Администрирование', 'Administration'],
        title: ['Роли и права', 'Roles & permissions'], kind: 'table', statSection: 'users',
        columns: [], variants: [
            { key: '/admin/roles', label: ['Роли', 'Roles'], columns: null },
            { key: '/admin/permissions', label: ['Права', 'Permissions'], columns: ['id', 'code', 'object_name', 'action', 'description'] }
        ],
        filters: [fSearch('Код или название роли')],
        rowActions: [{ key: 'perms', label: ['Права роли', 'Permissions'], perm: 'user:WRITE', run: (row) => openRolePermissions(row) }]
    },
    'audit-log': {
        endpoint: '/admin/audit-log', perm: 'audit:READ', eyebrow: ['Администрирование', 'Administration'],
        title: ['Журнал аудита', 'Audit log'], kind: 'table', statSection: 'audit',
        columns: ['id', 'occurred_at', 'login', 'role_code', 'entity_name', 'entity_id', 'action', 'ip', 'is_elevated', 'override_reason'],
        sortable: [],
        csvPath: '/admin/audit-log/export',
        filters: [
            fSearch('Логин, сущность, причина'),
            { name: 'user_id', label: 'Пользователь', type: 'select', optionsFrom: '/admin/audit-log/users' },
            fSel('action', 'Действие', fPairs(AUDIT_ACTIONS)),
            fSel('category', 'Отбор', fPairs([
                ['violations', 'Только нарушения (DENY)'],
                ['pii', 'Просмотр ПДн'],
                ['changes', 'Изменения данных'],
                ['auth', 'Входы в систему'],
                ['exports', 'Экспорт']
            ])),
            fDate('from', 'С', 'date_from'),
            fDate('to', 'По', 'date_to'),
            fCheck('is_elevated', 'Только тех. действия')
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
        title: ['Дашборд', 'Dashboard'], kind: 'dashboard', statSection: 'main',
        filters: [fDate('from', 'С'), fDate('to', 'По')]
    },
    'cost-fcr': {
        endpoint: '/reports/cost-fcr', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Себестоимость и FCR', 'Cost & FCR'], kind: 'report',
        columns: ['group_id', 'group_name', 'period_month', 'feed_qty', 'feed_cost', 'treatment_cost', 'head_days', 'gain_kg', 'fcr'],
        filters: [fDate('from', 'С'), fDate('to', 'По')]
    },
    'herd-health': {
        endpoint: '/reports/herd-health', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Здоровье поголовья', 'Herd health'], kind: 'report', statSection: 'animals',
        columns: ['metric', 'status', 'count', 'total_animals', 'sick_or_quarantine', 'sick_share_pct', 'healthy', 'culled', 'dead', 'vaccination_overdue', 'animals_vaccination_overdue'],
        filters: [fDate('from', 'С'), fDate('to', 'По')]
    },
    'pasture-load': {
        endpoint: '/reports/pasture-load', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Нагрузка на пастбища', 'Pasture load'], kind: 'report', statSection: 'pasture',
        columns: ['plot_no', 'name', 'area_ha', 'active_heads', 'load_head_per_ha', 'norm_head_per_ha', 'over_limit', 'rest_ok', 'risk', 'grazing_events', 'last_grazing_end'],
        filters: [fSearch('№ участка, название')]
    },
    'tasks-in-work': {
        endpoint: '/reports/tasks-in-work', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Задачи в работе', 'Tasks in work'], kind: 'report', statSection: 'tasks',
        columns: ['id', 'title', 'status', 'priority', 'planned_date', 'due_at', 'task_type', 'assignee', 'is_overdue', 'groups_count', 'executions_count'],
        filters: [fDate('from', 'С'), fDate('to', 'По')]
    },
    'stock-turnover': {
        endpoint: '/reports/stock-turnover', perm: 'report:READ', eyebrow: ['Аналитика', 'Analytics'],
        title: ['Остатки и обороты склада', 'Stock turnover'], kind: 'report', statSection: 'stock',
        columns: ['nomenclature_id', 'sku', 'name', 'category', 'uom', 'on_hand', 'min_threshold', 'received', 'issued', 'batches', 'turnover', 'risk', 'nearest_expiry'],
        filters: [fDate('from', 'С'), fDate('to', 'По')]
    },

    /* ---- Технадминка ---- */
    backups: {
        endpoint: '/tech/backups/overview', perm: 'backup:READ', eyebrow: ['Технадминка', 'Tech admin'],
        title: ['Резервные копии', 'Backups'], kind: 'backups', statSection: 'backups',
        noFilters: true, noPager: true
    },
    'tech-log': {
        endpoint: '/tech/log', perm: 'tech:READ', eyebrow: ['Технадминка', 'Tech admin'],
        title: ['Технический лог', 'Tech log'], kind: 'table',
        columns: ['id', 'occurred_at', 'action_type', 'description', 'details', 'admin_login'],
        filters: [
            fSel('action_type', 'Тип события', fPairs(['BACKUP', 'RESTORE', 'MAINTENANCE', 'INDEX', 'MIGRATION'])),
            fSearch('Описание')
        ],
        toolbar: [{ key: 'maintenance', label: ['Обслуживание БД', 'DB maintenance'], perm: 'tech:EXEC', run: () => openMaintenance() }]
    },
    metrics: {
        endpoint: '/tech/metrics/perf', perm: 'tech:READ', eyebrow: ['Технадминка', 'Tech admin'],
        title: ['Скорость запросов к БД', 'DB query speed'], kind: 'metrics-perf',
        noFilters: true, noPager: true
    },

    /* ---- Администратор БД (миграции / мониторинг / копии) ---- */
    'dba-migrations': {
        endpoint: '/dba/migrations', perm: 'dba:READ', rowsFrom: 'files', noFilters: true,
        eyebrow: ['Администратор БД', 'DB administrator'],
        title: ['Миграции схемы', 'Schema migrations'], kind: 'table',
        columns: ['version', 'filename', 'state', 'checksum', 'appliedAt', 'durationMs', 'errorMessage'],
        toolbar: [
            { key: 'preflight', label: ['Проверить (dry-run)', 'Preflight (dry-run)'], perm: 'dba:EXEC', run: () => dbaAction('preflight') },
            { key: 'apply', label: ['Применить', 'Apply migrations'], perm: 'dba:EXEC', run: () => dbaAction('apply') },
            { key: 'history', label: ['Реестр версий', 'Version registry'], perm: 'dba:READ', run: () => navigate('dba-history') }
        ]
    },
    'dba-history': {
        endpoint: '/dba/migrations/history', perm: 'dba:READ', noFilters: true,
        eyebrow: ['Администратор БД', 'DB administrator'],
        title: ['Реестр миграций', 'Migration registry'], kind: 'table',
        columns: ['version', 'filename', 'status', 'checksum', 'applied_by_login', 'started_at', 'finished_at', 'duration_ms', 'error_message']
    },
    'dba-monitor': {
        endpoint: '/dba/monitor/health', perm: 'dba:READ', noFilters: true,
        eyebrow: ['Администратор БД', 'DB administrator'],
        title: ['Мониторинг БД', 'DB monitoring'], kind: 'dba-monitor',
        toolbar: [
            { key: 'capture', label: ['Снять снимок', 'Capture snapshot'], perm: 'dba:EXEC', run: () => dbaAction('capture') },
            { key: 'analyze', label: ['ANALYZE', 'ANALYZE'], perm: 'dba:EXEC', run: () => dbaAction('refresh') }
        ]
    },
    'dba-backups': {
        endpoint: '/dba/backups/files', perm: 'dba:READ', rowsFrom: 'files', noFilters: true,
        eyebrow: ['Администратор БД', 'DB administrator'],
        title: ['Копии на диске', 'Backup files'], kind: 'table',
        columns: ['file', 'type', 'size_bytes', 'created_at', 'age_days', 'expires_in_days', 'will_expire', 'has_checksum', 'checksum'],
        toolbar: [
            { key: 'backup', label: ['Создать копию', 'Create backup'], perm: 'dba:EXEC', run: () => dbaAction('backup') },
            { key: 'rotate', label: ['Ротация (30 дн.)', 'Rotate (30 days)'], perm: 'dba:EXEC', run: () => dbaAction('rotate') }
        ]
    }
};

/* Псевдонимы хешей: и канонические имена ТЗ, и реальные href из index.html. */
const ALIASES = {
    home: 'home', main: 'home', index: 'home',
    animals: 'animals', groups: 'groups', inspections: 'inspections', vaccinations: 'vaccinations',
    stock: 'stock', plots: 'plots', tasks: 'tasks', employees: 'employees',
    grazing: 'grazing', movements: 'movements',
    dashboard: 'dashboard',
    'cost-fcr': 'cost-fcr', 'herd-health': 'herd-health', 'pasture-load': 'pasture-load',
    'tasks-in-work': 'tasks-in-work', 'stock-turnover': 'stock-turnover',
    'admin-users': 'admin-users', users: 'admin-users',
    'audit-log': 'audit-log', audit: 'audit-log',
    settings: 'settings',
    backups: 'backups', 'tech-backups': 'backups', restores: 'backups',
    'tech-log': 'tech-log', metrics: 'metrics', 'tech-metrics': 'metrics',
    roles: 'roles',
    'dba-migrations': 'dba-migrations', 'dba-history': 'dba-history',
    'dba-monitor': 'dba-monitor', 'dba-backups': 'dba-backups'
};
const HASH_FOR = {
    home: '#/home',
    'admin-users': '#/users', 'audit-log': '#/audit', backups: '#/backups',
    metrics: '#/metrics', 'tech-log': '#/tech-log', settings: '#/settings',
    roles: '#/roles',
    'dba-migrations': '#/dba-migrations', 'dba-history': '#/dba-history',
    'dba-monitor': '#/dba-monitor', 'dba-backups': '#/dba-backups'
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
        for (const k of ['name', 'plot_no', 'inventory_number', 'batch_number', 'full_name', 'login', 'title', 'sku', 'setting_key', 'code']) {
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

/* --------------------------------------------------------------------------
 * 6b. Универсальная палитра действий, роль-зависимые подсказки и справка
 * -------------------------------------------------------------------------- */
function tr(v) { return Array.isArray(v) ? (state.lang === 'en' ? v[1] : v[0]) : String(v || ''); }

function roleTitle() {
    const r = (state.user && state.user.role) || {};
    return r.name || r.code || '—';
}

/** Что именно создаёт N на текущем экране (или null, если создать нельзя). */
function currentCreateAction(page) {
    page = page || currentPage();
    if (!page) return null;
    if (page.crud && page.crud.createFields && page.crud.createFields.length && hasPerm(page.writePerm)) {
        return { id: 'create-current', title: 'Создать: ' + tr(page.title), short: tr(page.title),
            hint: 'Откроется форма новой записи раздела «' + tr(page.title) + '».', run: () => openCreate() };
    }
    const primary = (page.toolbar || []).find((x) => ['receipt', 'backup', 'move', 'assign'].includes(x.key) && hasPerm(x.perm));
    if (primary) {
        return { id: 'toolbar-' + primary.key, title: tr(primary.label), short: tr(primary.label),
            hint: 'Создание операции раздела «' + tr(page.title) + '».', run: primary.run };
    }
    return null;
}

/** Понятное объяснение отказа вместо голого «403». */
function denied(perm, what) {
    toast((what || 'Действие') + ' недоступно: нужное право ' + perm
        + ' отсутствует у роли «' + roleTitle() + '».', 'warn');
}

const PICKERS = {
    user: {
        endpoint: '/admin/users', perm: 'user:READ', label: 'Пользователь',
        text: (r) => `${r.login || ''} · ${r.full_name || ''} · ${r.role_code || ''}`
    },
    employee: {
        endpoint: '/employees', perm: 'employee:READ', label: 'Сотрудник',
        text: (r) => `${r.full_name || ''} · ${r.position_name || ''}`
    },
    animal: {
        endpoint: '/animals', perm: 'animal:READ', label: 'Животное',
        text: (r) => `${r.inventory_number || ''} · ${r.group_name || ''} · ${r.status || ''}`
    },
    backup: {
        endpoint: '/tech/backups', perm: 'backup:READ', label: 'Резервная копия',
        text: (r) => `#${r.id} · ${r.backup_type || ''} · ${r.status || ''}`
    }
};

/** Все доступные роли действия: палитра и справка строятся из одного источника. */
function buildActions() {
    const out = [];
    const page = currentPage();
    const add = (a) => { if (!a.perm || hasPerm(a.perm)) out.push(a); };
    const shown = new Set();
    const addOnce = (a) => { if (shown.has(a.id)) return; shown.add(a.id); add(a); };

    const create = currentCreateAction(page);
    if (create) addOnce(Object.assign({ group: 'На этой странице', kind: 'СОЗДАТЬ' }, create));

    for (const t of ((page && page.toolbar) || [])) {
        addOnce({ id: 'toolbar-' + t.key, group: 'На этой странице', kind: 'ОПЕРАЦИЯ',
            title: tr(t.label), hint: 'Действие раздела «' + tr(page.title) + '».', perm: t.perm, run: t.run });
    }
    if (state.selectedRow && page && page.rowActions) {
        for (const a of page.rowActions) {
            if (!hasPerm(a.perm)) continue;
            addOnce({ id: 'row-' + a.key, group: 'Выбранная запись', kind: 'ЗАПИСЬ',
                title: tr(a.label), hint: 'Применить к строке, выбранной в таблице.', run: () => a.run(state.selectedRow) });
        }
    }

    /* Создание в любом доступном разделе — не только в открытом. */
    for (const [id, p] of Object.entries(PAGES)) {
        if (!p.crud || !p.crud.createFields || !p.crud.createFields.length) continue;
        if (id === state.page || !p.perm || !hasPerm(p.perm) || !hasPerm(p.writePerm)) continue;
        addOnce({ id: 'create-' + id, group: 'Создать в другом разделе', kind: 'СОЗДАТЬ',
            title: 'Создать: ' + tr(p.title), hint: 'Перейти в раздел и открыть форму создания.',
            run: () => goCreate(id) });
    }

    /* Операции всех доступных разделов: палитра одинаково полезна из любого экрана. */
    for (const [id, p] of Object.entries(PAGES)) {
        if (id === state.page || !p.perm || !hasPerm(p.perm)) continue;
        for (const t of (p.toolbar || [])) {
            if (!hasPerm(t.perm)) continue;
            addOnce({ id: 'op-' + id + '-' + t.key, group: 'Операции разделов', kind: 'ОПЕРАЦИЯ',
                title: tr(t.label) + ' · ' + tr(p.title),
                hint: 'Перейти в раздел «' + tr(p.title) + '» и выполнить операцию.',
                run: () => goAction(id, t.run) });
        }
    }

    if (hasPerm('user:READ')) {
        for (const [id, title, hint] of [
            ['admin-users', 'Пользователи', 'Аккаунты, роли, блокировки и сессии'],
            ['roles', 'Роли и права', 'Матрица разрешений ролей'],
            ['audit-log', 'Журнал аудита', 'События, отказы DENY, просмотр ПДн']
        ]) {
            addOnce({ id: 'go-' + id, group: 'Перейти', kind: 'РАЗДЕЛ', title, hint, run: () => navigate(id) });
        }
    }
    if (hasPerm('user:WRITE')) {
        for (const [id, title, hint, run] of [
            ['user-block', 'Заблокировать пользователя', 'Причина обязательна, сессии отзываются', openUserBlock],
            ['user-unblock', 'Разблокировать пользователя', 'Причина обязательна и попадает в аудит', openUserUnblock],
            ['user-password', 'Сгенерировать пароль', 'Временный пароль показывается один раз', generateUserPassword],
            ['user-sessions', 'Посмотреть сессии', 'Активные сессии и отзыв всех сессий', openUserSessions],
            ['user-edit', 'Изменить пользователя', 'ФИО, роль, employee_id, флаги учётной записи',
                (row) => openEdit(row, PAGES['admin-users'])]
        ]) {
            addOnce({ id, group: 'Пользователи', kind: 'АККАУНТ', title, hint,
                needs: 'user', perm: 'user:WRITE', run });
        }
    }
    if (hasPerm('employee:PII')) {
        addOnce({ id: 'emp-pii', group: 'Сотрудники', kind: 'ПДн', title: 'Просмотр ПДн сотрудника',
            hint: 'Расшифровка по праву employee:PII, чтение пишется в аудит READ_PII',
            needs: 'employee', perm: 'employee:PII', run: openEmployeePii });
    }
    if (hasPerm('employee:WRITE')) {
        for (const [id, title, hint, run] of [
            ['emp-dismiss', 'Уволить сотрудника', 'Закроет закрепления и заблокирует учётные записи', openEmployeeDismiss],
            ['emp-reinstate', 'Восстановить сотрудника', 'Вернёт сотрудника в активное состояние', openEmployeeReinstate],
            ['emp-assign', 'Закрепить животное за сотрудником', 'Роль закрепления: VET / HERDSMAN / FOREMAN / ZOOTECHNIK', openEmployeeAssign]
        ]) {
            addOnce({ id, group: 'Сотрудники', kind: 'СОТРУДНИК', title, hint,
                needs: 'employee', perm: 'employee:WRITE', run });
        }
    }
    if (hasPerm('animal:WRITE')) {
        for (const [id, title, hint, run] of [
            ['animal-status', 'Сменить статус животного', 'Включая НА_ПРОДАЖЕ / ПРОДАН с причиной выбытия', openAnimalStatus],
            ['animal-assign', 'Закрепить сотрудника за животным', 'Добавляет закрепление с заданной ролью', openAnimalAssign]
        ]) {
            addOnce({ id, group: 'Животные', kind: 'ЖИВОТНОЕ', title, hint,
                needs: 'animal', perm: 'animal:WRITE', run });
        }
    }
    if (hasPerm('backup:EXEC')) {
        addOnce({ id: 'backup-create', group: 'Техника', kind: 'КОПИЯ', title: 'Создать резервную копию',
            hint: 'Реальный pg_dump, результат виден на странице копий.', run: () => openBackup() });
        addOnce({ id: 'backup-restore', group: 'Техника', kind: 'КОПИЯ', title: 'Восстановить из копии',
            hint: 'Разрушающая операция: обязательны право backup:EXEC и причина.',
            needs: 'backup', perm: 'backup:EXEC', run: (row) => openRestore(row.id) });
    }
    if (hasPerm('tech:EXEC')) {
        addOnce({ id: 'perf-reset', group: 'Техника', kind: 'МЕТРИКИ', title: 'Сбросить метрики скорости',
            hint: 'Очистить накопленное окно замеров запросов к БД.',
            run: async () => { try { await api('POST', '/tech/metrics/perf/reset', {}, { silent: true }); toast(t('done'), 'ok'); if (state.page === 'metrics') loadPage(); } catch (err) { toast(err.message, 'err'); } } });
    }
    return out;
}

/** Подсказки зависят от роли и текущего раздела. */
function hotkeyRows() {
    const rows = [
        ['?', t('help.hotkeys') + ' по роли «' + roleTitle() + '»'],
        ['Ctrl K', t('actions.palette') + ' — все доступные операции'],
        ['/', t('hk.focus')], ['R', t('hk.refresh')], ['Esc', t('hk.close')]
    ];
    const create = currentCreateAction();
    if (create) rows.splice(2, 0, ['N', create.title]);
    else {
        const firstCreate = buildActions().find((a) => a.kind === 'СОЗДАТЬ');
        rows.splice(2, 0, ['N', firstCreate
            ? 'Палитра действий · ' + firstCreate.title
            : 'Палитра действий (создание недоступно для вашей роли)']);
    }
    if (state.selectedRow) rows.push(['E', 'Изменить выбранную запись']);
    if (hasPerm('user:WRITE')) rows.push(['B', 'Заблокировать пользователя (поиск по логину)']);
    if (hasPerm('stock:WRITE')) rows.push(['I / O / W', 'Приход / расход / списание склада']);
    if (hasPerm('animal:WRITE') || hasPerm('pasture:WRITE')) rows.push(['A', 'Закрепление / перевод группы']);
    if (hasPerm('task:WRITE')) rows.push(['D', 'Выполнить задачу']);
    rows.push(['G …', 'Быстрый переход: A животные · S склад · D дашборд']);
    return rows;
}

function renderHotkeyHint() {
    const box = $('hotkeys-hint');
    if (!box) return;
    clear(box);
    for (const [key, text] of hotkeyRows().slice(0, 5)) {
        box.appendChild(el('kbd', { text: key }));
        box.appendChild(document.createTextNode(' ' + text + '  '));
    }
}

/* ---- Палитра действий ---- */
function closeActionDialog() { const d = $('action-dialog'); if (d && d.open) d.close(); }

function openActionPalette(presetId) {
    if (!state.token) return;
    const d = $('action-dialog');
    if (!d) return;
    state.actionItems = buildActions();
    state.actionIndex = 0;
    state.actionCurrent = null;
    $('action-title').textContent = t('actions.palette') + ' · ' + roleTitle();
    $('action-context').textContent = t('action.context');
    $('action-search').placeholder = t('action.search');
    $('action-search-label').textContent = t('action.search');
    $('action-search').value = presetId || '';
    $('action-step-list').hidden = false;
    $('action-step-picker').hidden = true;
    renderActionList(presetId || '');
    if (!d.open) d.showModal();
    $('action-search').focus();
}

function renderActionList(query) {
    const box = $('action-list');
    clear(box);
    const q = String(query || '').trim().toLowerCase();
    const items = state.actionItems.filter((a) =>
        !q || (a.title + ' ' + a.hint + ' ' + a.group + ' ' + a.kind).toLowerCase().includes(q));
    state.actionVisible = items;
    state.actionIndex = 0;
    if (!items.length) {
        box.appendChild(el('p', { class: 'action-empty', text: t('action.empty') }));
        return;
    }
    let group = '';
    for (const a of items) {
        if (a.group !== group) {
            group = a.group;
            box.appendChild(el('div', { class: 'action-group', text: group }));
        }
        const btn = el('button', {
            class: 'action-item', type: 'button', role: 'option', dataset: { action: a.id },
            on: { click: () => runAction(a) }
        }, [
            el('span', { class: 'action-kind', text: a.kind }),
            el('span', { class: 'action-text' }, [
                el('span', { class: 'action-title', text: a.title }),
                el('span', { class: 'action-hint', text: a.hint })
            ])
        ]);
        box.appendChild(btn);
    }
    markAction(0);
}

function markAction(index) {
    const items = [...$('action-list').querySelectorAll('.action-item')];
    if (!items.length) return;
    state.actionIndex = (index + items.length) % items.length;
    items.forEach((n, i) => n.classList.toggle('is-active', i === state.actionIndex));
    items[state.actionIndex].scrollIntoView({ block: 'nearest' });
}

function runAction(action) {
    closeActionDialog();
    if (action.needs) { openEntityPicker(action); return; }
    try { action.run(); } catch (err) { toast(err.message || t('err.generic'), 'err'); }
}

/* ---- Выбор записи: пользователь, сотрудник, животное, копия ---- */
async function openEntityPicker(action) {
    const cfg = PICKERS[action.needs];
    if (!cfg) { action.run(null); return; }
    if (!hasPerm(cfg.perm)) { denied(cfg.perm, 'Выбор записи'); return; }
    state.actionCurrent = action;
    $('action-step-list').hidden = true;
    $('action-step-picker').hidden = false;
    $('action-picker-title').textContent = action.title + ' · ' + t('action.pick');
    $('action-entity-search').placeholder = t('action.entity');
    $('action-entity-search').value = '';
    try {
        if (!state.pickerCache) state.pickerCache = {};
        if (!state.pickerCache[action.needs]) {
            const res = await api('GET', cfg.endpoint, undefined, { query: { limit: MAX_LIMIT }, silent: true });
            state.pickerCache[action.needs] = Array.isArray(res && res.data) ? res.data : (Array.isArray(res) ? res : []);
        }
        renderEntityList('');
    } catch (err) { toast(err.message, 'err'); }
    const d = $('action-dialog');
    if (!d.open) d.showModal();
    $('action-entity-search').focus();
}

function renderEntityList(query) {
    const action = state.actionCurrent;
    const cfg = action && PICKERS[action.needs];
    const box = $('action-entity-list');
    clear(box);
    if (!cfg) return;
    const rows = state.pickerCache[action.needs] || [];
    const q = String(query || '').trim().toLowerCase();
    const found = rows.filter((r) => cfg.text(r).toLowerCase().includes(q)).slice(0, 40);
    state.entityVisible = found;
    state.entityIndex = 0;
    if (!found.length) {
        box.appendChild(el('p', { class: 'action-empty', text: t('action.empty') }));
        return;
    }
    found.forEach((row, i) => {
        box.appendChild(el('button', {
            class: 'action-item entity-item', type: 'button', role: 'option',
            on: { click: () => { closeActionDialog(); try { action.run(row); } catch (err) { toast(err.message, 'err'); } } }
        }, [
            el('span', { class: 'action-kind', text: '#' + (i + 1) }),
            el('span', { class: 'action-text' }, [
                el('span', { class: 'action-title', text: cfg.text(row) }),
                el('span', { class: 'action-hint', text: cfg.label })
            ])
        ]));
    });
    markEntity(0);
}

function markEntity(index) {
    const items = [...$('action-entity-list').querySelectorAll('.entity-item')];
    if (!items.length) return;
    state.entityIndex = (index + items.length) % items.length;
    items.forEach((n, i) => n.classList.toggle('is-active', i === state.entityIndex));
    items[state.entityIndex].scrollIntoView({ block: 'nearest' });
}

function backToActions() {
    state.actionCurrent = null;
    $('action-step-picker').hidden = true;
    $('action-step-list').hidden = false;
    $('action-search').focus();
}

/* ---- Умные hotkey-действия ---- */
function openCreateSmart() {
    const create = currentCreateAction();
    if (create) { create.run(); return; }
    openActionPalette('Создать');
}

function openEditSmart() {
    const page = currentPage();
    if (state.selectedRow && page && page.crud && page.crud.editFields && hasPerm(page.writePerm)) {
        openEdit(state.selectedRow); return;
    }
    if (state.page === 'admin-users' && state.selectedRow) { openEdit(state.selectedRow); return; }
    openActionPalette('Изменить');
}

function openBlockSmart() {
    if (!hasPerm('user:WRITE')) { denied('user:WRITE', 'Блокировка пользователя'); return; }
    const palette = buildActions().find((a) => a.id === 'user-block');
    if (palette) { state.actionItems = [palette]; openEntityPicker(palette); }
}

/** Перейти в раздел и сразу открыть там форму создания. */
function goCreate(pageId) {
    navigate(pageId);
    const tryOpen = (attempts) => {
        if (state.page === pageId && currentCreateAction()) { openCreate(); return; }
        if (attempts > 0) setTimeout(() => tryOpen(attempts - 1), 120);
    };
    setTimeout(() => tryOpen(12), 60);
}

/** Перейти в раздел и выполнить там кнопку тулбара (палитра действий). */
function goAction(pageId, run) {
    if (typeof run !== 'function') return;
    navigate(pageId);
    const attempt = (left) => {
        if (state.page === pageId) { run(); return; }
        if (left > 0) setTimeout(() => attempt(left - 1), 120);
    };
    setTimeout(() => attempt(12), 60);
}

function renderHelp() {
    const dlg = $('help-dialog');
    $('help-title').textContent = t('help.title') + ' · ' + roleTitle();
    $('help-ok').textContent = t('help.ok');
    $('help-role').textContent = t('help.role') + ': ' + roleTitle();
    const notes = [];
    if (isTechnical()) notes.push('Технические роли при записи обязаны указать X-Override-Reason (только ASCII).');
    else {
        if (!hasPerm('tech:READ')) notes.push('Технический контур (бэкапы, метрики, обслуживание) недоступен.');
        if (!hasPerm('user:READ')) notes.push('Управление пользователями недоступно.');
        if (!hasPerm('animal:WRITE')) notes.push('Запись в реестры животных недоступна — только чтение.');
        if (!hasPerm('employee:WRITE') && !hasPerm('employee:PII')) notes.push('Карточки ПДн сотрудников недоступны.');
    }
    $('help-note').textContent = t('help.note') + (notes.length ? ' ' + notes.join(' ') : '');
    $('help-hotkeys-title').textContent = t('help.hotkeys') + ' · ' + tr(currentPage() ? currentPage().title : '—');
    const keys = $('help-keys');
    clear(keys);
    for (const [key, text] of hotkeyRows()) {
        keys.appendChild(el('dt', {}, [el('kbd', { text: key })]));
        keys.appendChild(el('dd', { text }));
    }
    const box = $('help-actions');
    clear(box);
    const actions = buildActions();
    let group = '';
    for (const a of actions) {
        if (a.group !== group) {
            group = a.group;
            box.appendChild(el('h4', { class: 'help-action-group', text: group }));
        }
        box.appendChild(el('div', { class: 'help-action-row' }, [
            el('span', { class: 'action-kind', text: a.kind }),
            el('span', { class: 'help-action-title', text: a.title }),
            el('span', { class: 'help-action-hint', text: a.hint })
        ]));
    }
    $('help-demo').textContent = 'director, superuser, dba, vet, foreman, storekeeper — пароль demo1234. Права роли задаются в разделе «Роли и права».';
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
    const hint = document.querySelector('.login-demo-hint');
    if (hint) {
        clear(hint);
        hint.appendChild(document.createTextNode(t('login.demoHint') + ' '));
        hint.appendChild(el('code', { text: 'demo1234' }));
    }

    const pagerLimit = $('pager-limit');
    if (pagerLimit) {
        const lbl = pagerLimit.parentElement && pagerLimit.parentElement.querySelector('.field-label');
        if (lbl) lbl.textContent = t('limit');
    }

    for (const link of document.querySelectorAll('#sidebar .nav-link[data-view]')) {
        const pair = NAV_LABELS[link.dataset.view];
        if (pair) link.textContent = state.lang === 'en' ? pair[1] : pair[0];
    }
    for (const h of document.querySelectorAll('#sidebar .nav-group-title')) {
        if (!h.dataset.ru) h.dataset.ru = h.textContent.trim();
        const p = NAV_GROUP_LABELS[h.dataset.ru];
        if (p) h.textContent = state.lang === 'en' ? p[1] : p[0];
    }
    setText('#actions-btn-label', 'actions.palette');
    for (const n of document.querySelectorAll('.hotkeys-actions-label')) n.textContent = t('actions.palette');
    renderHotkeyHint();
    if ($('action-dialog') && $('action-dialog').open) renderActionList($('action-search').value);
    const langBtn = $('lang-toggle');
    if (langBtn) { langBtn.textContent = state.lang === 'ru' ? 'EN' : 'RU'; langBtn.title = t('lang.switch'); }
    $('theme-label').textContent = state.theme === 'dark' ? t('theme.dark') : t('theme.light');
    if ($('help-dialog') && $('help-dialog').open) renderHelp();
    if (state.page) { renderChrome(currentPage()); configureFilters(currentPage()); }
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
    /* Точка входа для всех ролей — «Главная»: она не требует права и собирает
       показатели только по разрешённым разделам. */
    if (PAGES.home) return 'home';
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
    state.filters = {};
    state.extra = {};
    state.extraEndpoint = null;
    state.selectedRow = null;
    state.chartVariants = [];
    state.chartCurrent = null;
    state.statCards = [];
    state.backupData = null;
    state.perfData = null;
    state.herdData = null;
    if (page.preset) Object.assign(state.filters, page.preset);
    highlightMenu();
    renderChrome(page);
    configureFilters(page);
    updatePager();
    hideChart();
    if (id !== 'plots' && id !== 'grazing') hideMap();
    loadPage();
}

function renderChrome(page) {
    const pair = (v) => Array.isArray(v) ? (state.lang === 'en' ? v[1] : v[0]) : String(v || '');
    $('page-eyebrow').textContent = pair(page.eyebrow);
    $('page-title').textContent = pair(page.title);
    state.createAction = currentCreateAction(page);
    const createBtn = $('create-btn');
    createBtn.textContent = state.createAction
        ? '+ ' + state.createAction.short + '  [N]'
        : t('actions.palette') + '  [Ctrl K]';
    createBtn.title = state.createAction ? state.createAction.hint : 'Все доступные роли действия';
    show(createBtn, !!state.createAction);

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
    renderHotkeyHint();
}

/* --------------------------------------------------------------------------
 * 8. Панель инструментов раздела: фильтры по полям (у заголовка)
 * -------------------------------------------------------------------------- */
/** Привести опции фильтра к [{value,label}] (строки, пары, объекты). */
function normalizeFilterOptions(list) {
    return (list || []).map((o) => {
        if (Array.isArray(o)) return { value: o[0], label: o[1] !== undefined ? o[1] : String(o[0]) };
        if (o && typeof o === 'object') {
            return { value: o.value, label: o.label !== undefined ? o.label : (state.lang === 'en' && o.en ? o.en : (o.ru || o.value)) };
        }
        return { value: o, label: String(o) };
    });
}

/** Догрузить опции селекта из справочника (/positions, /animals/herd, …). */
async function loadFilterOptions(f) {
    const res = await api('GET', f.optionsFrom, undefined, { query: { limit: MAX_LIMIT }, silent: true });
    let rows = Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
    if (f.optionsPath) {
        const d = res && res.data;
        rows = d && Array.isArray(d[f.optionsPath]) ? d[f.optionsPath] : [];
    }
    return rows.map((r) => ({
        value: r.id !== undefined && r.id !== null ? r.id : (r.code !== undefined ? r.code : r.setting_key),
        label: r.label || r.name || r.full_name || r.login || r.code || ('#' + r.id)
    }));
}

function configureFilters(page) {
    const box = $('page-tools');
    clear(box);
    const list = (!page.noFilters && page.filters) ? page.filters : [];
    const variants = page.variants || [];
    show(box, list.length > 0 || variants.length > 0);
    if (box.hidden) return;

    /* Переключатели варианта данных (партии / остатки, роли / права). */
    for (const v of variants) {
        const label = typeof v.label === 'string' ? t(v.label) : (state.lang === 'en' ? v.label[1] : v.label[0]);
        box.appendChild(el('button', {
            class: 'btn btn-sm ' + (state.extraEndpoint === v.key ? 'btn-primary' : 'btn-ghost'),
            type: 'button', text: label, dataset: { variant: v.key },
            on: {
                click: (ev) => {
                    state.extraEndpoint = v.key;
                    state.offset = 0; state.pageNo = 1; state.sort = '';
                    for (const b of box.querySelectorAll('[data-variant]')) {
                        b.classList.remove('btn-primary'); b.classList.add('btn-ghost');
                    }
                    ev.currentTarget.classList.add('btn-primary');
                    ev.currentTarget.classList.remove('btn-ghost');
                    loadPage();
                }
            }
        }));
    }

    for (const f of list) {
        const wrap = el('label', { class: 'field field-inline tool-field' });
        wrap.appendChild(el('span', { class: 'field-label', text: f.label || labelOf(f.name) }));
        let input;
        if (f.type === 'select') {
            input = el('select', { class: 'field-input', dataset: { filter: f.name } });
            input.appendChild(el('option', { value: '', text: t('all') }));
            for (const o of normalizeFilterOptions(f.options)) {
                input.appendChild(el('option', { value: o.value, text: o.label }));
            }
            input.value = state.filters[f.name] !== undefined ? String(state.filters[f.name]) : '';
            if (f.optionsFrom) {
                const node = input;
                loadFilterOptions(f).then((rows) => {
                    if (!node.isConnected) return;
                    const cur = node.value;
                    for (const o of rows) node.appendChild(el('option', { value: o.value, text: o.label }));
                    node.value = cur;
                }).catch(() => { /* нет права — останется «Все» */ });
            }
            input.addEventListener('change', applyFilters);
        } else if (f.type === 'checkbox') {
            input = el('input', { type: 'checkbox', dataset: { filter: f.name } });
            input.checked = state.filters[f.name] === 'true';
            input.addEventListener('change', applyFilters);
            wrap.classList.add('tool-check');
            wrap.appendChild(el('span', { class: 'checkbox' }, [input, el('span', { text: f.label || labelOf(f.name) })]));
            const lbl = wrap.querySelector(':scope > .field-label');
            if (lbl) lbl.remove();
            box.appendChild(wrap);
            continue;
        } else if (f.type === 'date') {
            input = el('input', { class: 'field-input', type: 'date', dataset: { filter: f.name } });
            input.value = state.filters[f.name] || '';
            input.addEventListener('change', applyFilters);
        } else {
            input = el('input', { class: 'field-input', type: 'search', dataset: { filter: f.name }, placeholder: f.ph || t('searchPh') });
            input.value = state.filters[f.name] || '';
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyFilters(); } });
            input.addEventListener('input', debounce(() => applyFilters(), 400));
        }
        wrap.appendChild(input);
        box.appendChild(wrap);
    }

    if (list.length) {
        box.appendChild(el('button', {
            class: 'btn btn-sm btn-ghost tool-reset', type: 'button', text: t('reset'),
            on: { click: () => resetFilters() }
        }));
    }
}

/** Считать значения фильтров из #page-tools (пустые не сохраняем). */
function readFilters() {
    const next = {};
    for (const node of $('page-tools').querySelectorAll('[data-filter]')) {
        const k = node.dataset.filter;
        const v = node.type === 'checkbox' ? (node.checked ? 'true' : '') : String(node.value || '').trim();
        if (v) next[k] = v;
    }
    const page = currentPage();
    if (page && page.preset) Object.assign(next, page.preset);
    state.filters = next;
    state.offset = (state.pageNo - 1) * state.limit;
}

function queryFor(page) {
    const q = { limit: state.limit, offset: state.offset };
    const decls = (page && page.filters) || [];
    for (const [k, v] of Object.entries(state.filters || {})) {
        if (v === '' || v === null || v === undefined) continue;
        const decl = decls.find((f) => f.name === k);
        let key = (decl && decl.query) ? decl.query : k;
        if (k === 'status' && page && page.statusKey) key = page.statusKey;
        q[key] = v;
    }
    if (state.sort) q.sort = state.sort;
    return q;
}

function applyFilters() { readFilters(); state.pageNo = 1; state.offset = 0; loadPage(); }

function resetFilters() {
    const page = currentPage();
    state.filters = page && page.preset ? Object.assign({}, page.preset) : {};
    state.extraEndpoint = null;
    state.pageNo = 1; state.offset = 0; state.sort = '';
    configureFilters(page);
    loadPage();
}

/* --------------------------------------------------------------------------
 * 8b. Плашка показателей раздела (GET /stats/:section)
 * -------------------------------------------------------------------------- */
async function loadStats(page) {
    if (!page || !page.statSection) return null;
    try {
        const res = await api('GET', '/stats/' + page.statSection, undefined, { silent: true });
        return (res && res.data && Array.isArray(res.data.cards)) ? res.data : null;
    } catch { return null; }
}

function renderStatStrip(data) {
    const box = $('stat-strip');
    clear(box);
    const cards = (data && data.cards) || [];
    if (!cards.length) { show(box, false); return; }
    for (const c of cards) {
        const value = (typeof c.value === 'number') ? humanNumber(c.value) : String(c.value === null || c.value === undefined ? '—' : c.value);
        box.appendChild(el('div', {
            class: 'stat-card' + (c.tone ? ' tone-' + c.tone : ''),
            title: c.hint || c.label
        }, [
            el('span', { class: 'stat-label', text: c.label }),
            el('span', { class: 'stat-value' }, [
                document.createTextNode(value),
                c.unit ? el('span', { class: 'stat-unit', text: ' ' + c.unit }) : null
            ]),
            c.hint ? el('span', { class: 'stat-hint', text: c.hint }) : null
        ]));
    }
    show(box, true);
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
    const statsPromise = loadStats(page);
    try {
        let result;
        if (page.kind === 'home') {
            result = { rows: [], total: 0 };
        } else if (page.kind === 'grazing') {
            result = await loadGrazing();
        } else if (page.kind === 'backups') {
            result = await loadBackups();
        } else if (page.kind === 'metrics-perf') {
            result = await loadPerf();
        } else {
            result = await loadGeneric(page);
        }
        const stats = await statsPromise;
        if (ticket !== state.requestId) return;
        state.statCards = (stats && stats.cards) || [];
        renderStatStrip(stats);
        state.data = result.rows || [];
        state.total = Number(result.total !== undefined ? result.total : state.data.length) || 0;
        state.series = result.series || null;
        state.plotsCache = result.plots || [];
        state.loadCache = result.load || [];
        state.backupData = result.backup || null;
        state.perfData = result.perf || null;
        state.herdData = result.herd || null;
        $('view').setAttribute('aria-busy', 'false');
        renderView(page, result);
    } catch (err) {
        if (ticket !== state.requestId) return;
        $('view').setAttribute('aria-busy', 'false');
        setEmpty(err && err.message ? err.message : t('err.generic'));
    }
}

/** Экран «Резервные копии»: текущая копия, период, история и восстановления. */
async function loadBackups() {
    const res = await api('GET', '/tech/backups/overview', undefined, { silent: true });
    return { rows: [], total: 0, backup: (res && res.data) || {} };
}

/** Экран «Скорость запросов к БД». */
async function loadPerf() {
    const res = await api('GET', '/tech/metrics/perf', undefined, { silent: true });
    return { rows: [], total: 0, perf: (res && res.data) || {} };
}

async function loadGeneric(page) {
    const res = await api('GET', endpointOf(page), undefined, { query: queryFor(page) });
    let rows = [];
    // rowsFrom: для контура администратора БД ответы имеют вложенные массивы
    // (напр. {data: {files: [...]}}), а не плоский {data: [...]}.
    if (page.rowsFrom && res && res.data) {
        const nested = res.data[page.rowsFrom];
        if (Array.isArray(nested)) rows = nested;
        else if (res.data[page.rowsFrom] && typeof res.data[page.rowsFrom] === 'object') {
            const inner = Object.values(res.data[page.rowsFrom]).find(Array.isArray);
            rows = inner || [res.data[page.rowsFrom]];
        }
    }
    if (!rows.length) {
        if (Array.isArray(res)) rows = res;
        else if (res && Array.isArray(res.data)) rows = res.data;
        else if (res && typeof res.data === 'object' && res.data !== null) rows = [res.data];
        else if (res && typeof res === 'object' && !res.data) rows = [res];
    }
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
        api('GET', '/animals/herd', undefined, { silent: true }).catch(() => null),
        hasPerm('audit:READ')
            ? api('GET', '/admin/audit-log', undefined, {
                query: { entity_name: 'grazing_event', action: 'CREATE', limit: 100 }, silent: true
            }).catch(() => null)
            : Promise.resolve(null)
    ];
    const [plotsRes, loadRes, animalsRes, herdRes, auditRes] = await Promise.all(requests);
    const plots = plotsRes && Array.isArray(plotsRes.data) ? plotsRes.data : [];
    const load = loadRes && Array.isArray(loadRes.data) ? loadRes.data : [];
    const animals = animalsRes && Array.isArray(animalsRes.data) ? animalsRes.data : [];
    const loadByPlot = new Map(load.map((r) => [String(r.plot_id || r.id), r]));

    const groupNames = new Map();
    for (const a of animals) {
        if (a.group_id !== undefined && a.group_id !== null && a.group_name) groupNames.set(String(a.group_id), a.group_name);
    }

    /* Источник активных назначений: аудит CREATE (grazing_event) → отчёт по нагрузке. */
    let events = [];
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
    return { rows, total: rows.length, plots, load, herd: (herdRes && herdRes.data) || null };
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
    const page = currentPage();
    const total = state.total;
    const pages = Math.max(1, Math.ceil(total / state.limit));
    if (state.pageNo > pages) { state.pageNo = pages; state.offset = (pages - 1) * state.limit; }
    const pager = $('pager');
    if (page && page.noPager) { show(pager, false); return; }
    show(pager, true);
    $('pager-info').textContent = t('total') + ': ' + humanNumber(total);
    $('pager-page').textContent = state.pageNo + ' / ' + pages;
    $('pager-prev').disabled = state.pageNo <= 1;
    $('pager-next').disabled = state.pageNo >= pages;
    const lim = $('pager-limit');
    if (lim) lim.value = String(state.limit);
}

function renderView(page, result) {
    const holder = $('view');
    clear(holder);
    holder.setAttribute('aria-busy', 'false');

    if (page.kind === 'home') {
        renderHome(page);
    } else if (page.kind === 'backups') {
        renderBackups(result.backup || {});
    } else if (page.kind === 'metrics-perf') {
        renderPerf(result.perf || {});
    } else if (page.kind === 'dashboard') {
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
    } else if (page.kind === 'dba-monitor') {
        renderDbaMonitor(result.rows[0] || {});
        hideChart();
    } else if (page.kind === 'grazing') {
        renderGrazing(page, result);
    } else {
        renderTable(page, result.rows, endpointOf(page));
        if (page.csvPath) addExportButton(page);
    }
    updatePager();
}

/** Мониторинг БД: сводка + список проблем + диагностические таблицы. */
function renderDbaMonitor(h) {
    const holder = $('view');
    const ov = h.overview || {}, cache = h.cache || {}, vac = h.vacuum || {};
    const pair = (ru, en) => state.lang === 'en' ? en : ru;

    const severityClass = h.severity === 'CRITICAL' ? 'is-warn' : (h.severity === 'WARNING' ? 'is-warn' : '');
    const kpis = [
        [pair('Состояние', 'Status'), h.severity || '—'],
        [pair('База', 'Database'), ov.database || '—'],
        [pair('Размер', 'Size'), ov.db_size_pretty || '—'],
        [pair('Таблиц / индексов', 'Tables / indexes'), `${ov.tables_count || 0} / ${ov.indexes_count || 0}`],
        [pair('Соединения', 'Connections'), `${ov.connections || 0} / ${ov.max_connections || 0}`],
        [pair('Активные / заблок.', 'Active / blocked'), `${ov.active_queries || 0} / ${ov.blocked_queries || 0}`],
        [pair('Кэш-хит', 'Cache hit'), `${cache.cache_hit_ratio != null ? cache.cache_hit_ratio + '%' : '—'}`],
        [pair('Использ. индексов', 'Index usage'), `${cache.index_usage_ratio != null ? cache.index_usage_ratio + '%' : '—'}`],
        [pair('Мёртвые строки', 'Dead rows'), h.deadRows != null ? humanNumber(h.deadRows) : '—'],
        [pair('Не вакуумир. таблиц', 'Stale tables'), vac.totals ? vac.totals.stale_tables : '—'],
        [pair('Неиспольз. индексов', 'Unused indexes'), (h.unusedIndexes || []).length],
        [pair('Полных переборов', 'Seq scans'), (h.seqScans || []).length],
        [pair('Версия', 'Version'), (ov.server_version || '').split(' on ')[0].split(',')[0]],
        [pair('Аптайм', 'Uptime'), formatUptime(ov.uptime)],
    ];
    const grid = el('div', { class: 'kpi-grid' });
    for (const [label, val] of kpis) {
        grid.appendChild(el('div', { class: 'kpi-card' + (label === pair('Состояние', 'Status') && severityClass ? ' ' + severityClass : '') }, [
            el('span', { class: 'kpi-label', text: label }),
            el('span', { class: 'kpi-value', text: String(val == null ? '—' : val) })
        ]));
    }
    holder.appendChild(grid);

    holder.appendChild(el('h3', { class: 'mt-3 mb-2', text: pair('Диагностика', 'Diagnostics') }));
    const problems = h.problems || [];
    holder.appendChild(el(problems.length ? 'ul' : 'p', {
        class: problems.length ? 'notice' : 'notice',
        text: problems.length ? '' : pair('Проблем не обнаружено', 'No problems detected')
    }, problems.map((p) => el('li', { text: p }))));

    if (!h.slowQueries || !h.slowQueries.available) {
        holder.appendChild(el('p', { class: 'hint', text: (h.slowQueries && h.slowQueries.note) || '' }));
    }

    const sections = [
        [pair('Таблица', 'Table'), pair('Мёртвые', 'Dead'), pair('Доля мёртвых', 'Dead ratio'), pair('Строк', 'Live rows'), pair('Посл. вакуум', 'Last vacuum')],
        ...(vac.tables || []).slice(0, 10).map((t) => [
            t.table_name, String(t.n_dead_tup), String(t.dead_ratio) + '%',
            String(t.n_live_tup), t.last_autovacuum ? String(t.last_autovacuum).slice(0, 19) : '—'
        ]),
    ];
    if (vac.tables && vac.tables.length) {
        holder.appendChild(el('h3', { class: 'mt-3 mb-2', text: pair('Обслуживание таблиц', 'Table maintenance') }));
        holder.appendChild(simpleDbaTable(sections));
    }
    const idx = h.unusedIndexes || [];
    if (idx.length) {
        holder.appendChild(el('h3', { class: 'mt-3 mb-2', text: pair('Неиспользуемые индексы', 'Unused indexes') }));
        holder.appendChild(simpleDbaTable([
            [pair('Индекс', 'Index'), pair('Таблица', 'Table'), pair('Размер', 'Size'), pair('Сканирований', 'Scans')],
            ...idx.slice(0, 10).map((i) => [i.index_name, i.table_name, i.index_size, String(i.idx_scan)])
        ]));
    }
    const seq = h.seqScans || [];
    if (seq.length) {
        holder.appendChild(el('h3', { class: 'mt-3 mb-2', text: pair('Последовательные чтения', 'Sequential scans') }));
        holder.appendChild(simpleDbaTable([
            [pair('Таблица', 'Table'), 'Seq scan', 'Idx scan', pair('Строк', 'Rows'), pair('Доля seq', 'Seq ratio')],
            ...seq.slice(0, 10).map((s) => [s.table_name, String(s.seq_scan), String(s.idx_scan), String(s.n_live_tup), String(s.seq_ratio) + '%'])
        ]));
    }
    if (h.blocked && h.blocked.length) {
        holder.appendChild(el('h3', { class: 'mt-3 mb-2', text: pair('Блокировки', 'Locks') }));
        holder.appendChild(simpleDbaTable([
            ['PID', pair('Кем заблокирован', 'Blocked by'), pair('Запрос', 'Query')],
            ...h.blocked.map((b) => [String(b.pid), String(b.blocker_pids || ''), String(b.blocked_query || '').slice(0, 90)])
        ]));
    }
}

/** pg даёт interval объектом {days,hours,minutes,...} или строкой — показываем читаемо. */
function formatUptime(v) {
    if (!v) return '—';
    if (typeof v === 'object') {
        const d = Number(v.days || 0), h = Number(v.hours || 0), m = Number(v.minutes || 0);
        return (d ? d + ' дн. ' : '') + h + ' ч. ' + m + ' мин.';
    }
    return String(v).slice(0, 21);
}

function simpleDbaTable(rows) {
    const wrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'data-table' });
    const head = el('thead');
    const hr = el('tr');
    for (const c of rows[0]) hr.appendChild(el('th', { text: c }));
    head.appendChild(hr); table.appendChild(head);
    const body = el('tbody');
    for (const r of rows.slice(1)) {
        const tr = el('tr');
        for (const c of r) tr.appendChild(el('td', { text: c }));
        body.appendChild(tr);
    }
    table.appendChild(body); wrap.appendChild(table);
    return wrap;
}

/** Панель с заголовком и (необязательными) действиями справа. */
function panel(title, actions) {
    const box = el('section', { class: 'panel' });
    const head = el('header', { class: 'panel-head' }, [el('h2', { class: 'panel-title', text: title })]);
    /* Действия собираются условно (по правам): null-заглушки просто не добавляем. */
    for (const a of (actions || [])) if (a) head.appendChild(a);
    box.appendChild(head);
    return box;
}

function humanBytes(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + ' ГБ';
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' МБ';
    if (n >= 1024) return (n / 1024).toFixed(1) + ' КБ';
    return n + ' Б';
}

/* ---- Главная: вход по роли ---- */
const HOME_LINKS = [
    ['animals', 'Животные', 'animal:READ'], ['tasks', 'Задачи', 'task:READ'],
    ['grazing', 'Выпас', 'pasture:WRITE'], ['employees', 'Сотрудники', 'employee:READ'],
    ['stock', 'Склад', 'stock:READ'], ['dashboard', 'Дашборд', 'report:READ'],
    ['audit-log', 'Журнал аудита', 'audit:READ'], ['admin-users', 'Пользователи', 'user:READ'],
    ['backups', 'Резервные копии', 'backup:READ'], ['metrics', 'Скорость БД', 'tech:READ']
];

function renderHome(page) {
    const holder = $('view');
    const u = state.user || {};
    const role = (u.role && (u.role.name || u.role.code)) || '—';
    const hour = new Date().getHours();
    const greet = hour < 6 ? 'Доброй ночи' : (hour < 12 ? 'Доброе утро' : (hour < 18 ? 'Добрый день' : 'Добрый вечер'));

    const hero = el('section', { class: 'home-hero' });
    hero.appendChild(el('h2', { class: 'home-greet', text: `${greet}, ${u.full_name || u.login || 'коллега'}` }));
    hero.appendChild(el('p', { class: 'home-role', text: `Роль: ${role} · ${new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}` }));
    if (!state.statCards.length) {
        hero.appendChild(el('p', { class: 'hint', text: 'Показатели появятся, как только у роли будут права на данные разделов.' }));
    } else {
        const warn = state.statCards.filter((c) => c.tone === 'warn' || c.tone === 'bad');
        hero.appendChild(el('p', {
            class: warn.length ? 'notice' : 'notice notice-ok',
            text: warn.length
                ? 'Требует внимания: ' + warn.map((c) => `${c.label} — ${c.value}${c.unit ? ' ' + c.unit : ''}`).join('; ')
                : 'Срочных отклонений нет — показатели в норме.'
        }));
    }
    holder.appendChild(hero);

    const links = HOME_LINKS.filter(([, , perm]) => hasPerm(perm));
    const grid = el('div', { class: 'quick-grid' });
    for (const [id, label] of links) {
        grid.appendChild(el('button', {
            class: 'quick-link', type: 'button', text: label,
            on: { click: () => navigate(id) }
        }));
    }
    const box = panel('Быстрый переход');
    box.appendChild(grid);
    holder.appendChild(box);

    holder.appendChild(el('p', {
        class: 'hint',
        text: 'Плашка показателей на каждом экране строится из /stats/:section — только по данным, разрешённым роли.'
    }));
    hideChart();
}

/* ---- Резервные копии: текущая копия + период + история + восстановления ---- */
function renderBackups(data) {
    const holder = $('view');
    const cur = data.current || null;
    const s = data.settings || {};
    const history = data.history || [];
    const restores = data.restores || [];
    const scheduler = data.scheduler || {};

    const currentBox = el('section', { class: 'backup-current' + (cur ? '' : ' is-empty') });
    if (cur) {
        currentBox.appendChild(el('div', { class: 'backup-current-head' }, [
            el('span', { class: 'backup-badge', text: cur.status || 'OK' }),
            el('h2', { class: 'panel-title', text: 'Текущая резервная копия' })
        ]));
        const rows = [
            ['Копия', '#' + cur.id + ' · ' + cur.backup_type + (cur.origin ? ' · ' + cur.origin : '')],
            ['Создана', formatDate(cur.finished_at || cur.started_at)],
            ['Размер', humanBytes(cur.size_bytes)],
            ['Файл', cur.file_path || '—'],
            ['Инициатор', cur.initiated_by_login || '—'],
            ['Восстановлений', String(cur.restores || 0)]
        ];
        const dl = el('div', { class: 'backup-facts' });
        for (const [k, v] of rows) {
            dl.appendChild(el('div', { class: 'backup-fact' }, [
                el('span', { class: 'backup-fact-key', text: k }),
                el('span', { class: 'backup-fact-val', text: v })
            ]));
        }
        currentBox.appendChild(dl);
        const actions = el('div', { class: 'backup-actions' });
        if (hasPerm('backup:READ')) {
            actions.appendChild(el('button', {
                class: 'btn btn-ghost btn-sm', type: 'button', text: 'Скачать файл',
                on: { click: () => downloadBackupFile(cur) }
            }));
        }
        if (hasPerm('backup:EXEC')) {
            actions.appendChild(el('button', {
                class: 'btn btn-primary btn-sm', type: 'button', text: 'Создать копию',
                on: { click: () => openBackup() }
            }));
            actions.appendChild(el('button', {
                class: 'btn btn-ghost btn-sm', type: 'button', text: 'Восстановить из этой копии',
                on: { click: () => openRestore(cur.id) }
            }));
        }
        currentBox.appendChild(actions);
    } else {
        currentBox.appendChild(el('h2', { class: 'panel-title', text: 'Текущая резервная копия' }));
        currentBox.appendChild(el('p', { class: 'notice notice-bad', text: 'Успешных копий ещё нет — создайте первой же кнопкой ниже.' }));
        if (hasPerm('backup:EXEC')) {
            currentBox.appendChild(el('button', {
                class: 'btn btn-primary', type: 'button', text: 'Создать копию',
                on: { click: () => openBackup() }
            }));
        }
    }
    holder.appendChild(currentBox);

    /* Настройки периода */
    const sched = panel('Период копирования', []);
    const form = el('div', { class: 'backup-schedule' });
    const addField = (labelText, node) => form.appendChild(el('label', { class: 'field field-inline' }, [
        el('span', { class: 'field-label', text: labelText }), node
    ]));

    const enabled = el('input', { type: 'checkbox' });
    enabled.checked = s.enabled !== false;
    const schedule = el('select', { class: 'field-input' });
    for (const [v, l] of [['DAILY', 'Ежедневно'], ['WEEKLY', 'Еженедельно'], ['OFF', 'Выключено']]) {
        schedule.appendChild(el('option', { value: v, text: l }));
    }
    schedule.value = String(s.schedule || 'DAILY');
    const time = el('input', { class: 'field-input', type: 'text', placeholder: 'ЧЧ:ММ' });
    time.value = s.time || '02:00';
    const retention = el('input', { class: 'field-input', type: 'number', min: '1', max: '3650' });
    retention.value = String(s.retention_days || 30);
    const keepLast = el('input', { class: 'field-input', type: 'number', min: '1', max: '500' });
    keepLast.value = String(s.keep_last || 10);

    addField('Включено', enabled);
    addField('Частота', schedule);
    addField('Время', time);
    addField('Хранение, дней', retention);
    addField('Хранить копий', keepLast);
    sched.appendChild(form);

    const schedActions = el('div', { class: 'backup-actions' });
    if (data.schedule_due) {
        schedActions.appendChild(el('span', { class: 'hint', text: 'Следующая плановая: ' + formatDate(data.schedule_due) }));
    }
    if (scheduler && scheduler.lastTickAt) {
        schedActions.appendChild(el('span', { class: 'hint', text: 'Планировщик: ' + (scheduler.enabled ? 'включён' : 'выключен') + ', проверка ' + formatDate(scheduler.lastTickAt) }));
    }
    if (hasPerm('backup:EXEC')) {
        schedActions.appendChild(el('button', {
            class: 'btn btn-primary btn-sm', type: 'button', text: 'Сохранить период',
            on: {
                click: async () => {
                    try {
                        await api('PATCH', '/tech/backups/schedule', {
                            backup_enabled: enabled.checked,
                            backup_schedule: schedule.value,
                            backup_time: time.value.trim(),
                            backup_retention_days: Number(retention.value) || 30,
                            backup_keep_last: Number(keepLast.value) || 10
                        }, { silent: true });
                        toast(t('saved'), 'ok');
                        loadPage();
                    } catch (err) { toast(err.message, 'err'); }
                }
            }
        }));
        schedActions.appendChild(el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Выполнить план сейчас',
            on: {
                click: async () => {
                    try {
                        const r = await api('POST', '/tech/backups/schedule/run', {}, { silent: true });
                        toast((r && r.message) || t('done'), 'ok');
                        loadPage();
                    } catch (err) { toast(err.message, 'err'); }
                }
            }
        }));
    }
    if (!hasPerm('backup:EXEC')) {
        enabled.disabled = schedule.disabled = time.disabled = retention.disabled = keepLast.disabled = true;
    }
    sched.appendChild(schedActions);
    holder.appendChild(sched);

    if (data.last_failure) {
        holder.appendChild(el('p', {
            class: 'notice notice-bad',
            text: `Последняя ошибка копирования: #${data.last_failure.id} · ${formatDate(data.last_failure.started_at)} — проверьте тех. лог.`
        }));
    }

    /* История копий */
    const histBox = panel('История копий');
    const wrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'data-table' });
    const head = el('tr');
    for (const c of ['Копия', 'Тип', 'Статус', 'Создана', 'Размер', 'Хранение, дн.', 'Восстановлений', 'Инициатор', '']) head.appendChild(el('th', { text: c }));
    table.appendChild(el('thead', {}, [head]));
    const body = el('tbody');
    for (const b of history) {
        const tr = el('tr');
        tr.appendChild(el('td', { text: '#' + b.id }));
        tr.appendChild(el('td', { text: b.backup_type || '—' }));
        tr.appendChild(el('td', {}, [statusBadge(b.status || '—')]));
        tr.appendChild(el('td', { text: formatDate(b.finished_at || b.started_at) }));
        tr.appendChild(el('td', { class: 'num', text: humanBytes(b.size_bytes) }));
        tr.appendChild(el('td', { class: 'num', text: String(b.retention_days || '—') }));
        tr.appendChild(el('td', { class: 'num', text: String(b.restores || 0) }));
        tr.appendChild(el('td', { text: b.initiated_by_login || '—' }));
        const td = el('td', { class: 'cell-actions' });
        if (b.status === 'OK') {
            td.appendChild(el('button', {
                class: 'btn btn-ghost btn-sm', type: 'button', text: 'Скачать',
                on: { click: () => downloadBackupFile(b) }
            }));
            if (hasPerm('backup:EXEC')) {
                td.appendChild(el('button', {
                    class: 'btn btn-ghost btn-sm', type: 'button', text: 'Восстановить',
                    on: { click: () => openRestore(b.id) }
                }));
            }
        }
        tr.appendChild(td);
        body.appendChild(tr);
    }
    if (!history.length) {
        body.appendChild(el('tr', {}, [el('td', { colspan: '9' }, [el('div', { class: 'table-empty' }, [
            el('div', { class: 'big', text: t('empty') }), el('div', { text: 'Копии ещё не создавались.' })
        ])])]));
    }
    table.appendChild(body);
    wrap.appendChild(table);
    histBox.appendChild(wrap);
    holder.appendChild(histBox);

    /* Восстановления — там же, где копии */
    const restBox = panel('Восстановления');
    const rwrap = el('div', { class: 'table-wrap' });
    const rtable = el('table', { class: 'data-table' });
    const rhead = el('tr');
    for (const c of ['#', 'Копия', 'Статус', 'Начато', 'Завершено', 'Причина', 'Выполнил']) rhead.appendChild(el('th', { text: c }));
    rtable.appendChild(el('thead', {}, [rhead]));
    const rbody = el('tbody');
    for (const r of restores) {
        const tr = el('tr');
        tr.appendChild(el('td', { text: '#' + r.id }));
        tr.appendChild(el('td', { text: r.backup_job_id ? '#' + r.backup_job_id : '—' }));
        tr.appendChild(el('td', {}, [statusBadge(r.status || '—')]));
        tr.appendChild(el('td', { text: formatDate(r.started_at) }));
        tr.appendChild(el('td', { text: formatDate(r.finished_at) }));
        tr.appendChild(el('td', { text: r.reason || '—' }));
        tr.appendChild(el('td', { text: r.performed_by_login || '—' }));
        rbody.appendChild(tr);
    }
    if (!restores.length) {
        rbody.appendChild(el('tr', {}, [el('td', { colspan: '7' }, [el('div', { class: 'table-empty' }, [
            el('div', { class: 'big', text: t('empty') }), el('div', { text: 'Восстановлений не было.' })
        ])])]));
    }
    rtable.appendChild(rbody);
    rwrap.appendChild(rtable);
    restBox.appendChild(rwrap);
    holder.appendChild(restBox);

    if (data.files) {
        holder.appendChild(el('p', { class: 'hint', text: `Каталог копий: ${data.backup_dir || '—'} · файлов на диске: ${data.files.count || 0} · объём ${humanBytes(data.files.bytes)}` }));
    }
    hideChart();
}

/** Скачать файл копии (Bearer-токен, ответ — octet-stream). */
async function downloadBackupFile(job) {
    try {
        const resp = await fetch(API_BASE + '/tech/backups/' + job.id + '/download', {
            headers: { Authorization: 'Bearer ' + state.token }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: 'backup_' + job.id + '.dump' });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
        toast('Не удалось скачать файл: ' + err.message, 'err');
    }
}

/* ---- Скорость БД: вердикт, перцентили, корзины, медленные запросы ---- */
function renderPerf(p) {
    const holder = $('view');
    const v = p.verdict || { level: 'UNKNOWN', label: 'Нет данных', text: '' };

    const banner = el('section', { class: 'verdict verdict-' + String(v.level || 'UNKNOWN').toLowerCase() });
    banner.appendChild(el('span', { class: 'verdict-label', text: v.label || '—' }));
    banner.appendChild(el('strong', { class: 'verdict-text', text: v.text || '' }));
    const thr = p.thresholds || {};
    banner.appendChild(el('span', {
        class: 'verdict-thresholds',
        text: `Пороги: норма p95 ≤ ${thr.perf_p95_ok_ms || 100} мс, внимание ≤ ${thr.perf_p95_warn_ms || 300} мс`
    }));
    holder.appendChild(banner);

    const cards = [
        ['Замеров в окне', p.samples, p.window ? 'из ' + p.window : ''],
        ['Среднее', p.avg_ms, 'мс'],
        ['Медиана (p50)', p.p50_ms, 'мс'],
        ['95-й перцентиль', p.p95_ms, 'мс'],
        ['99-й перцентиль', p.p99_ms, 'мс'],
        ['Максимум', p.max_ms, 'мс'],
        ['Медленных (≥300 мс)', p.slow_count, 'шт.'],
        ['Ошибок', p.error_count, 'шт.'],
        ['Запросов в минуту', p.per_minute, ''],
        ['Уникальных запросов', p.statements, '']
    ];
    const grid = el('div', { class: 'stat-strip stat-strip-inline' });
    for (const [label, value, unit] of cards) {
        const warn = (label.startsWith('Медленных') && Number(value) > 0) || (label === 'Ошибок' && Number(value) > 0);
        grid.appendChild(el('div', { class: 'stat-card' + (warn ? ' tone-warn' : '') }, [
            el('span', { class: 'stat-label', text: label }),
            el('span', { class: 'stat-value' }, [
                document.createTextNode(typeof value === 'number' ? humanNumber(value) : String(value == null ? '—' : value)),
                unit ? el('span', { class: 'stat-unit', text: ' ' + unit }) : null
            ])
        ]));
    }
    holder.appendChild(grid);

    /* Распределение по корзинам */
    const bucketBox = panel('Распределение по времени ответа');
    const bars = el('div', { class: 'bucket-list' });
    for (const b of (p.buckets || [])) {
        const row = el('div', { class: 'bucket-row' }, [
            el('span', { class: 'bucket-label', text: b.label }),
            el('span', { class: 'bucket-track' }, [
                el('span', {
                    class: 'bucket-fill' + (b.label === '>300 мс' && b.count ? ' is-bad' : ''),
                    style: 'width:' + Math.max(1, Number(b.share) || 0) + '%'
                })
            ]),
            el('span', { class: 'bucket-value', text: `${b.count} · ${b.share}%` })
        ]);
        bars.appendChild(row);
    }
    if (!(p.buckets || []).length) bars.appendChild(el('p', { class: 'hint', text: 'Замеров пока нет — выполните несколько запросов и обновите страницу.' }));
    bucketBox.appendChild(bars);
    holder.appendChild(bucketBox);

    /* Самые медленные запросы */
    const slowBox = panel('Самые медленные запросы', [
        hasPerm('tech:EXEC') ? el('button', {
            class: 'btn btn-ghost btn-sm', type: 'button', text: 'Сбросить статистику',
            on: {
                click: async () => {
                    try {
                        await api('POST', '/tech/metrics/perf/reset', {}, { silent: true });
                        toast(t('done'), 'ok');
                        loadPage();
                    } catch (err) { toast(err.message, 'err'); }
                }
            }
        }) : null
    ]);
    const wrap = el('div', { class: 'table-wrap' });
    const table = el('table', { class: 'data-table' });
    const head = el('tr');
    for (const c of ['Запрос', 'Вызовов', 'Среднее, мс', 'Максимум, мс', 'Медленных']) head.appendChild(el('th', { text: c }));
    table.appendChild(el('thead', {}, [head]));
    const body = el('tbody');
    for (const q of (p.slowest || [])) {
        const tr = el('tr');
        tr.appendChild(el('td', {}, [el('code', { class: 'sql', text: q.sql })]));
        tr.appendChild(el('td', { class: 'num', text: String(q.count) }));
        tr.appendChild(el('td', { class: 'num', text: String(q.avg_ms) }));
        tr.appendChild(el('td', { class: 'num', text: String(q.max_ms) }));
        tr.appendChild(el('td', { class: 'num', text: String(q.slow) }));
        body.appendChild(tr);
    }
    if (!(p.slowest || []).length) {
        body.appendChild(el('tr', {}, [el('td', { colspan: '5' }, [el('div', { class: 'table-empty' }, [
            el('div', { class: 'big', text: t('empty') }), el('div', { text: 'Ещё не накоплено данных.' })
        ])])]));
    }
    table.appendChild(body);
    wrap.appendChild(table);
    slowBox.appendChild(wrap);
    holder.appendChild(slowBox);

    /* Состояние БД */
    const db = p.db || {};
    const dbBox = panel('Состояние базы данных');
    const dl = el('div', { class: 'backup-facts' });
    for (const [k, val] of [
        ['Размер БД', db.db_size || '—'],
        ['Соединения', `${db.connections || 0} / ${db.max_connections || 0}`],
        ['Кэш-хит', db.cache_hit_ratio != null ? db.cache_hit_ratio + '%' : '—'],
        ['Операций записи', humanNumber(db.write_ops || 0)]
    ]) {
        dl.appendChild(el('div', { class: 'backup-fact' }, [
            el('span', { class: 'backup-fact-key', text: k }),
            el('span', { class: 'backup-fact-val', text: String(val) })
        ]));
    }
    dbBox.appendChild(dl);
    if ((p.slow_tables || []).length) {
        const twrap = el('div', { class: 'table-wrap mt-2' });
        const ttable = el('table', { class: 'data-table' });
        const th = el('tr');
        for (const c of ['Таблица', 'Seq scan', 'Index scan', 'Строк', 'Доля seq, %']) th.appendChild(el('th', { text: c }));
        ttable.appendChild(el('thead', {}, [th]));
        const tb = el('tbody');
        for (const s of p.slow_tables) {
            const tr = el('tr');
            tr.appendChild(el('td', { text: s.table_name }));
            tr.appendChild(el('td', { class: 'num', text: String(s.seq_scan) }));
            tr.appendChild(el('td', { class: 'num', text: String(s.idx_scan) }));
            tr.appendChild(el('td', { class: 'num', text: humanNumber(s.n_live_tup) }));
            tr.appendChild(el('td', { class: 'num', text: String(s.seq_scan_pct) }));
            tb.appendChild(tr);
        }
        ttable.appendChild(tb);
        twrap.appendChild(ttable);
        dbBox.appendChild(twrap);
    }
    holder.appendChild(dbBox);
    holder.appendChild(el('p', { class: 'hint', text: 'Пороги меняются в настройках хозяйства: perf_p95_ok_ms, perf_p95_warn_ms, perf_slow_ms.' }));
    hideChart();
}

function renderGrazing(page, result) {
    const holder = $('view');
    const herd = result.herd || null;

    if (herd) {
        const stats = herd.stats || {};
        const strip = el('div', { class: 'stat-strip stat-strip-inline' });
        for (const [label, value, unit] of [
            ['Закреплений', stats.assignments, 'шт.'],
            ['Покрыто животными', `${stats.animals_covered || 0}/${stats.animals_active || 0}`, 'гол.'],
            ['Сотрудников с закреплениями', (herd.employees || []).filter((e) => Number(e.assigned) > 0).length, 'чел.'],
            ['Без закрепления', (herd.unassigned || []).length, 'гол.']
        ]) {
            strip.appendChild(el('div', { class: 'stat-card' + (label === 'Без закрепления' && Number((herd.unassigned || []).length) ? ' tone-warn' : '') }, [
                el('span', { class: 'stat-label', text: label }),
                el('span', { class: 'stat-value' }, [document.createTextNode(String(value)), el('span', { class: 'stat-unit', text: ' ' + unit })])
            ]));
        }
        holder.appendChild(strip);

        const groupsBox = panel('Группы и участки', [
            hasPerm('animal:WRITE') ? el('button', {
                class: 'btn btn-ghost btn-sm', type: 'button', text: 'Закрепить сотрудника',
                on: { click: () => openAssignEmployee() }
            }) : null
        ]);
        const gwrap = el('div', { class: 'table-wrap' });
        const gtable = el('table', { class: 'data-table' });
        const gh = el('tr');
        for (const c of ['Группа', 'Животных', 'Здоровых', 'Участок', 'Дней на участке', 'Площадь, га']) gh.appendChild(el('th', { text: c }));
        gtable.appendChild(el('thead', {}, [gh]));
        const gb = el('tbody');
        for (const g of (herd.groups || [])) {
            const tr = el('tr');
            tr.appendChild(el('td', { text: g.name || ('#' + g.id) }));
            tr.appendChild(el('td', { class: 'num', text: humanNumber(g.animals) }));
            tr.appendChild(el('td', { class: 'num', text: humanNumber(g.healthy) }));
            tr.appendChild(el('td', { text: g.plot_no ? g.plot_no + (g.plot_name ? ' · ' + g.plot_name : '') : '—' }));
            tr.appendChild(el('td', { class: 'num', text: g.days_on_plot === null || g.days_on_plot === undefined ? '—' : String(g.days_on_plot) }));
            tr.appendChild(el('td', { class: 'num', text: g.area_ha === null || g.area_ha === undefined ? '—' : String(g.area_ha) }));
            gb.appendChild(tr);
        }
        if (!(herd.groups || []).length) gb.appendChild(el('tr', {}, [el('td', { colspan: '6', text: t('empty') })]));
        gtable.appendChild(gb);
        gwrap.appendChild(gtable);
        groupsBox.appendChild(gwrap);
        holder.appendChild(groupsBox);

        if ((herd.unassigned || []).length) {
            const unBox = panel('Животные без закрепления');
            const list = el('div', { class: 'chip-list' });
            for (const a of (herd.unassigned || []).slice(0, 24)) {
                list.appendChild(el('span', { class: 'chip', text: `${a.inventory_number}${a.group_name ? ' · ' + a.group_name : ''}` }));
            }
            if (herd.unassigned.length > 24) list.appendChild(el('span', { class: 'chip', text: `и ещё ${herd.unassigned.length - 24}` }));
            unBox.appendChild(list);
            holder.appendChild(unBox);
        }

        if ((herd.employees || []).length) {
            const empBox = panel('Кто за кем смотрит');
            const list = el('div', { class: 'chip-list' });
            for (const e of (herd.employees || []).slice(0, 16)) {
                list.appendChild(el('span', { class: 'chip', text: `${e.full_name} · ${e.assigned} гол.` }));
            }
            empBox.appendChild(list);
            holder.appendChild(empBox);
        }
    }

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

function openEdit(row, pageArg) {
    const page = pageArg || currentPage();
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
        note: 'Для статусов «ПРОДАН», «ПАДЁЖ», «ВЫБРАКОВАНО» укажите причину выбытия — закрепления за животным закроются автоматически.',
        fields: [
            F('status', 'select', { required: true, options: staticOpts(ANIMAL_STATUSES) }),
            F('reason', 'textarea', { required: true, span: true }),
            F('disposal_reason_id', 'select', { optionsFrom: '/disposal-reasons' }),
            F('diagnosis_id', 'select', { optionsFrom: '/diagnoses' }),
            F('drug_nomenclature_id', 'number'), F('dosage', 'number', { step: '0.001' })
        ],
        values: { status: row.status },
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

/* ---- Пользователи: блокировка, пароль, сессии ---- */
function openUserBlock(row) {
    openModal({
        title: 'Блокировка · ' + row.login,
        note: 'Блокировка отзывает все активные сессии учётной записи. Причина обязательна и попадёт в аудит.',
        danger: true, submitLabel: 'Заблокировать',
        fields: [F('reason', 'textarea', { required: true, span: true })],
        onSubmit: async (payload, reason) => {
            await mutation('POST', `/admin/users/${row.id}/block`, { reason: payload.reason }, reason, 'done');
        }
    });
}

function openUserUnblock(row) {
    openModal({
        title: 'Разблокировка · ' + row.login,
        note: row.blocked_reason ? 'Причина блокировки: ' + row.blocked_reason : 'Учётная запись будет снова доступна для входа.',
        fields: [F('reason', 'textarea', { required: true, span: true })],
        onSubmit: async (payload, reason) => {
            await mutation('POST', `/admin/users/${row.id}/unblock`, { reason: payload.reason }, reason, 'done');
        }
    });
}

async function generateUserPassword(row) {
    try {
        const res = await api('POST', `/admin/users/${row.id}/generate-password`, {}, { silent: true });
        const pwd = (res && res.data && res.data.password) || '';
        openModal({
            title: 'Временный пароль · ' + row.login,
            note: 'Пароль показывается один раз и не сохраняется в журнале. Передайте его сотруднику безопасным каналом: при входе потребуется смена.',
            fields: [F('password', 'text', { readonly: true })],
            values: { password: pwd },
            submitLabel: t('help.ok'),
            onSubmit: async () => { /* просто закрыть */ }
        });
    } catch (err) { toast(err.message, 'err'); }
}

async function openUserSessions(row) {
    let rows = [];
    try {
        const res = await api('GET', `/admin/users/${row.id}/sessions`, undefined, { silent: true });
        rows = Array.isArray(res && res.data) ? res.data : [];
    } catch (err) { toast(err.message, 'err'); return; }
    const lines = rows.length
        ? rows.map((s) => `#${s.id} · ${s.ip || '—'} · вход ${formatDate(s.issued_at)} · до ${formatDate(s.expires_at)}`)
        : ['Активных сессий нет.'];
    openModal({
        title: 'Сессии · ' + row.login,
        note: lines.join('\n'),
        fields: [],
        danger: rows.length > 0,
        submitLabel: rows.length && hasPerm('user:WRITE') ? 'Отозвать все сессии' : t('help.ok'),
        onSubmit: async (payload, reason) => {
            if (!rows.length || !hasPerm('user:WRITE')) return;
            await mutation('POST', `/admin/users/${row.id}/revoke-sessions`, {}, reason, 'done');
        }
    });
}

/* ---- Роли: матрица прав ---- */
async function openRolePermissions(row) {
    let data;
    try {
        const res = await api('GET', `/admin/roles/${row.id}/permissions`, undefined, { silent: true });
        data = (res && res.data) || {};
    } catch (err) { toast(err.message, 'err'); return; }
    const all = data.all || [];
    const granted = new Set((data.granted || []).map(Number));
    const fields = all.map((p) => F('perm_' + p.id, 'checkbox', { label: p.code, hint: p.description || '' }));
    const values = {};
    for (const p of all) values['perm_' + p.id] = granted.has(Number(p.id));
    openModal({
        title: 'Права роли · ' + (row.code || row.name || row.id),
        note: 'Отметьте разрешения роли. Для DBA допустимо только чтение бизнес-объектов и полные права на user/tech/dba/backup.',
        fields,
        values,
        submitLabel: t('save'),
        onSubmit: async (payload, reason) => {
            const ids = Object.keys(payload)
                .filter((k) => k.startsWith('perm_') && payload[k])
                .map((k) => Number(k.slice(5)))
                .filter((n) => Number.isFinite(n));
            await api('PUT', `/admin/roles/${row.id}/permissions`, { permission_ids: ids, reason: reason || null });
            toast(t('saved'), 'ok');
            await loadPage();
        }
    });
}

/* ---- Сотрудники: ПДн, увольнение, восстановление, закрепления ---- */
async function openEmployeePii(row) {
    if (!hasPerm('employee:PII')) { toast(t('err.403'), 'warn'); return; }
    let values = {};
    try {
        const res = await api('GET', `/employees/${row.id}/pii`, undefined, { silent: true });
        values = (res && res.data && res.data.values) || {};
    } catch (err) {
        if (!err || err.status !== 404) { toast(err.message, 'err'); return; }
    }
    const fields = [
        F('phone', 'text', { nullable: true }),
        F('passport', 'text', { nullable: true }),
        F('address', 'text', { nullable: true, span: true }),
        F('snils', 'text', { nullable: true }),
        F('inn', 'text', { nullable: true }),
        F('bank_account', 'text', { nullable: true }),
        F('emergency_contact', 'text', { nullable: true, span: true })
    ];
    openModal({
        title: 'Персональные данные · ' + row.full_name,
        note: 'ПДн хранятся в БД в зашифрованном виде (pgcrypto, ключ только в окружении сервера). Каждое чтение пишется в аудит как READ_PII.',
        fields,
        values,
        onSubmit: async (payload, reason) => {
            if (!Object.keys(payload).length) throw new Error(t('err.400'));
            await mutation('PUT', `/employees/${row.id}/pii`, payload, reason, 'saved');
        }
    });
}

function openEmployeeDismiss(row) {
    openModal({
        title: 'Увольнение · ' + row.full_name,
        note: 'Увольнение закрывает все закрепления за животными и блокирует связанные учётные записи с отзывом сессий. Причина обязательна.',
        danger: true, submitLabel: 'Уволить',
        fields: [
            F('dismissed_at', 'date'),
            F('dismissal_reason', 'textarea', { required: true, span: true, label: 'Причина увольнения' })
        ],
        onSubmit: async (payload, reason) => {
            const body = { dismissal_reason: payload.dismissal_reason };
            if (payload.dismissed_at) body.dismissed_at = payload.dismissed_at;
            await mutation('POST', `/employees/${row.id}/dismiss`, body, reason, 'done');
        }
    });
}

function openEmployeeReinstate(row) {
    openModal({
        title: 'Восстановление · ' + row.full_name,
        fields: [F('reason', 'textarea', { required: true, span: true })],
        onSubmit: async (payload, reason) => {
            await mutation('POST', `/employees/${row.id}/reinstate`, {}, reason, 'done');
        }
    });
}

function openAnimalAssign(row) {
    openModal({
        title: 'Закрепить сотрудника · ' + (row.inventory_number || ('#' + row.id)),
        fields: [
            F('employee_id', 'select', { required: true, optionsFrom: '/employees' }),
            F('role_code', 'select', { required: true, options: fPairs(ASSIGN_ROLES) }),
            F('note', 'text')
        ],
        values: { role_code: 'HERDSMAN' },
        onSubmit: async (payload, reason) => {
            await mutation('POST', `/animals/${row.id}/assignments`, payload, reason, 'done');
        }
    });
}

function openEmployeeAssign(row) {
    openModal({
        title: 'Закрепить животное · ' + row.full_name,
        fields: [
            F('animal_id', 'select', { required: true, optionsFrom: '/animals' }),
            F('role_code', 'select', { required: true, options: fPairs(ASSIGN_ROLES) }),
            F('note', 'text')
        ],
        values: { role_code: 'HERDSMAN' },
        onSubmit: async (payload, reason) => {
            await mutation('POST', `/employees/${row.id}/assignments`, payload, reason, 'done');
        }
    });
}

/** Закрепление из сводки бригадира: сотрудник + животное + роль. */
function openAssignEmployee() {
    openModal({
        title: 'Закрепить сотрудника за животным',
        fields: [
            F('employee_id', 'select', { required: true, optionsFrom: '/employees' }),
            F('animal_id', 'select', { required: true, optionsFrom: '/animals' }),
            F('role_code', 'select', { required: true, options: fPairs(ASSIGN_ROLES) }),
            F('note', 'text')
        ],
        values: { role_code: 'HERDSMAN' },
        onSubmit: async (payload, reason) => {
            await mutation('POST', `/animals/${payload.animal_id}/assignments`, payload, reason, 'done');
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
function openRestore(backupJobId) {
    openModal({
        title: t('tech.restore'),
        note: 'Восстановление перезаписывает текущую БД содержимым выбранной копии. Действие фиксируется в тех. логе и аудите.',
        danger: true, submitLabel: t('tech.restore'),
        fields: [
            F('backup_job_id', 'select', { required: true, optionsFrom: '/tech/backups' }),
            F('reason', 'textarea', { required: true, span: true })
        ],
        values: backupJobId ? { backup_job_id: backupJobId } : {},
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
 * 10b. Администратор БД: действия миграций, копий и мониторинга.
 * Причину X-Override-Reason api() запрашивает сам (модалка при 428).
 * -------------------------------------------------------------------------- */
async function dbaAction(kind) {
    const reload = () => loadPage();
    try {
        let r;
        switch (kind) {
            case 'preflight':
                r = await api('POST', '/dba/migrations/preflight', {});
                toast('Dry-run: ' + ((r.data && r.data.files || []).map((f) => f.version + (f.ok ? ' OK' : ' FAIL')).join(', ') || t('done')), 'ok');
                return;
            case 'apply': {
                const pending = state.data.filter((x) => x.state === 'NEW' || x.state === 'FAILED');
                if (!pending.length) { toast(t('empty'), 'warn'); return; }
                // Причину X-Override-Reason api() запросит сам при ответе 428
                // и повторит запрос (см. promptOverrideReason).
                r = await api('POST', '/dba/migrations/apply', {});
                toast((r.data && r.data.applied || []).map((x) => x.version).join(', ') + ' · ' + t('done'), 'ok');
                break;
            }
            case 'capture':
                r = await api('POST', '/dba/monitor/capture', {});
                toast(t('done') + ' · #' + (r.data && r.data.id), 'ok');
                break;
            case 'refresh':
                r = await api('POST', '/dba/monitor/refresh-stats', { operation: 'ANALYZE' });
                toast(t('done') + ' · ' + (r.data && r.data.duration_ms) + ' ms', 'ok');
                break;
            case 'backup':
                r = await api('POST', '/dba/backups', { backup_type: 'FULL', retention_days: 30 });
                toast(t('done') + ' · ' + (r.data && r.data.file_path || ''), 'ok');
                break;
            case 'rotate':
                r = await api('POST', '/dba/backups/rotate', { retention_days: 30 });
                toast(t('done') + ' · ' + (r.data && r.data.removed_count) + ' удалено', 'ok');
                break;
            default: return;
        }
        if (r && r.data && r.data.warning) toast(r.data.warning, 'warn');
        reload();
    } catch (err) {
        toast(err && err.message ? err.message : t('err.generic'), 'warn');
    }
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
    const n = $('page-tools').querySelector('input[type="search"]');
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
        e.preventDefault(); openActionPalette(); return;
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
        n: () => openCreateSmart(), e: () => openEditSmart(), b: () => openBlockSmart(),
        r: () => loadPage(),
        i: () => hasPerm('stock:WRITE') ? openMovement('RECEIPT') : denied('stock:WRITE', 'Приход склада'),
        o: () => hasPerm('stock:WRITE') ? openMovement('ISSUE') : denied('stock:WRITE', 'Расход склада'),
        w: () => hasPerm('stock:DELETE') ? openMovement('WRITE_OFF') : denied('stock:DELETE', 'Списание склада'),
        a: () => openAssign(), d: () => openExecute()
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
    $('create-btn').addEventListener('click', () => {
        if (state.createAction) state.createAction.run(); else openCreateSmart();
    });
    $('pager-prev').addEventListener('click', () => { if (state.pageNo > 1) { state.pageNo--; state.offset = (state.pageNo - 1) * state.limit; loadPage(); } });
    $('pager-next').addEventListener('click', () => { state.pageNo++; state.offset = (state.pageNo - 1) * state.limit; loadPage(); });
    $('pager-limit').addEventListener('change', () => {
        state.limit = Math.min(Math.max(1, Number($('pager-limit').value) || DEFAULT_LIMIT), MAX_LIMIT);
        state.pageNo = 1; state.offset = 0;
        loadPage();
    });

    $('map-close').addEventListener('click', () => hideMap());
    $('modal').addEventListener('click', (e) => { if (e.target.closest('[data-modal-close]')) closeModal(); });
    $('modal-form').addEventListener('submit', onModalSubmit);
    $('help-open').addEventListener('click', openHelp);
    $('help-close').addEventListener('click', closeHelp);
    $('help-ok').addEventListener('click', closeHelp);
    $('help-dialog').addEventListener('click', (e) => { if (e.target.id === 'help-dialog') closeHelp(); });

    /* Универсальная палитра действий (Ctrl+K, кнопки в шапке и футере). */
    for (const id of ['actions-btn', 'hotkeys-actions-btn']) {
        const btn = $(id);
        if (btn) btn.addEventListener('click', () => openActionPalette());
    }
    $('action-close').addEventListener('click', closeActionDialog);
    $('action-cancel').addEventListener('click', closeActionDialog);
    $('action-dialog').addEventListener('click', (e) => { if (e.target.id === 'action-dialog') closeActionDialog(); });
    $('action-search').addEventListener('input', (e) => renderActionList(e.target.value));
    $('action-entity-search').addEventListener('input', (e) => renderEntityList(e.target.value));
    $('action-picker-back').addEventListener('click', backToActions);
    $('action-dialog').addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const picker = !$('action-step-picker').hidden;
            if (picker) markEntity(state.entityIndex + (e.key === 'ArrowDown' ? 1 : -1));
            else markAction(state.actionIndex + (e.key === 'ArrowDown' ? 1 : -1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (!$('action-step-picker').hidden) {
                const row = state.entityVisible && state.entityVisible[state.entityIndex];
                if (row && state.actionCurrent) { closeActionDialog(); state.actionCurrent.run(row); }
            } else {
                const a = state.actionVisible && state.actionVisible[state.actionIndex];
                if (a) runAction(a);
            }
        }
    });

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
