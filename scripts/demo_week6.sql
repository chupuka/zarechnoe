-- =============================================================================
-- demo_week6.sql — безопасность и администрирование (неделя 6).
--
-- Заголовки латиницей: русский текст в \echo ломается в консоли Windows.
--
-- Запуск на docker-стенде:
--   type scripts\demo_week6.sql | docker exec -i farm_pg psql -U farm -d farm 2>&1
--
-- Только чтение — данные не меняются.
-- =============================================================================

\echo ''
\echo '=== 1. RBAC: 6 roles, 44 permissions, 2 levels (BUSINESS / TECHNICAL) ==='
SELECT r.code, r.name, r.role_type, count(rp.permission_id) AS permissions
FROM role r
LEFT JOIN role_permission rp ON rp.role_id = r.id
GROUP BY r.code, r.name, r.role_type
ORDER BY r.role_type, permissions DESC;

\echo ''
\echo '--- key permissions of each role ---'
SELECT r.code,
       string_agg(p.code, ', ' ORDER BY p.code) AS key_permissions
FROM role r
JOIN role_permission rp ON rp.role_id = r.id
JOIN permission p ON p.id = rp.permission_id
WHERE p.code IN ('animal:DELETE','animal:WRITE','stock:DELETE','stock:WRITE',
                 'period:EXEC','tech:EXEC','backup:EXEC','dba:EXEC',
                 'catalog:WRITE','employee:WRITE')
GROUP BY r.code
ORDER BY r.code;

\echo ''
\echo '=== 2. PASSWORDS: bcrypt only, no plaintext ==='
SELECT login, left(password_hash, 7) AS hash_prefix, length(password_hash) AS hash_len
FROM app_user ORDER BY id;

\echo ''
\echo '=== 3. AUDIT LOG: who / what / before-after / IP / elevated ==='
SELECT id, action, entity_name, entity_id, is_elevated, ip, occurred_at
FROM audit_log ORDER BY id DESC LIMIT 8;

\echo ''
\echo '--- DENY entries: forbidden actions are logged too ---'
SELECT id, action, entity_name, entity_id, occurred_at
FROM audit_log WHERE action = 'DENY' ORDER BY id DESC LIMIT 3;

\echo ''
\echo '=== 4. TECH LOG: separate from business audit ==='
SELECT action_type, count(*) FROM tech_log GROUP BY action_type ORDER BY 2 DESC;

\echo ''
\echo '=== 5. SESSIONS: only sha256 hashes are stored ==='
SELECT login, left(token_hash, 12) AS token_hash_prefix, issued_at, expires_at, revoked_at
FROM user_session JOIN app_user ON app_user.id = user_session.user_id
ORDER BY user_session.id DESC LIMIT 5;
