FROM node:22-alpine
WORKDIR /app

# pg_dump/pg_restore нужны для резервного копирования (routes/tech.js),
# python3 — для scripts/backup_restore.py. Без них копии падают с 503.
# Клиент PostgreSQL должен быть той же мажорной версии, что и сервер Supabase (17).
RUN apk add --no-cache postgresql17-client python3

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY server/src ./src
COPY ui/public ./ui/public
COPY scripts ./scripts
# Миграции нужны раннеру Администратора БД (server/src/dbAdmin/migrator.js):
# из /app/src/dbAdmin путь ../../../db/migrations указывает на /app/db/migrations.
COPY db/migrations ./db/migrations

# pg_dump/pg_restore берём из PATH контейнера (Docker CLI внутри образа нет),
# интерпретатор — python3. Ключ ПДн (PII_KEY) задаётся в docker-compose/.env.
ENV PORT=3000 \
    PYTHON_BIN=python3 \
    FARM_PSQL_MODE=local \
    FARM_BACKUP_DIR=/app/backups

EXPOSE 3000
CMD ["node", "src/index.js"]
