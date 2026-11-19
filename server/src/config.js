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
        // Supabase pooler использует цепочку сертификатов, которую Node не доверяет.
        // PGSSLMODE остаётся валидным для pg_dump/libpq, этот флаг — только для Node/pg.
        ssl: process.env.PGSSL_NO_VERIFY === '1'
            ? { rejectUnauthorized: false }
            : undefined,
    },
    session: {
        // TTL сессии в user_session (ТЗ: «сессии — по безопасным токенам»)
        ttlHours: parseInt(process.env.SESSION_TTL_HOURS || '8', 10),
        maxFailed: 5,          // неудачных попыток до временной блокировки
        lockMinutes: 15,
    },
    // Ключ шифрования ПДн сотрудников (ТЗ п.7).
    // В БД не хранится: только окружение. Если ключ не задан, сервер работает,
    // но расшифровка ПДн недоступна (списки и маски — работают).
    piiKey: process.env.PII_KEY || '',
    // Планировщик резервного копирования (см. src/backupScheduler.js)
    backup: {
        // как часто проверять расписание (мс); сам период берётся из farm_settings
        tickMs: parseInt(process.env.BACKUP_TICK_MS || '60000', 10),
        // запускать ли авто-копии вообще (можно выключить на время демонстрации)
        enabled: process.env.BACKUP_SCHEDULER !== 'off',
    },
};
