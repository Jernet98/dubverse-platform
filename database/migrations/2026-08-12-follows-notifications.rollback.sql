-- Rollback manual de Dubverse Social v1.2.
-- ADVERTENCIA: elimina de forma irreversible follows y notificaciones v1.2.

BEGIN;

DROP TABLE IF EXISTS social_notifications;
DROP TABLE IF EXISTS user_follows;

COMMIT;
