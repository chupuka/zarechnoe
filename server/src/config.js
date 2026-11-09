'use strict';

// Конфигурация сервера (12-factor: переменные окружения со значениями по умолчанию
// для локального запуска рядом с контейнером farm_pg, см. ../README.md).
module.exports = {
    // PORT в окружении может быть 0/мусор — тогда берём 3000
    port: parseInt(process.env.PORT || '', 10) || 3000,
    db: {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5433', 10),
        user: process.env.PGUSER || 'farm',
        password: process.env.PGPASSWORD || 'farm',
        database: process.env.PGDATABASE || 'farm',
    },
    session: {
        // TTL сессии в user_session (ТЗ: «сессии — по безопасным токенам»)
        ttlHours: parseInt(process.env.SESSION_TTL_HOURS || '8', 10),
        maxFailed: 5,          // неудачных попыток до временной блокировки
        lockMinutes: 15,
    },
};
