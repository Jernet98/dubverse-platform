-- Rollback destructivo de Dubverse Social v1.
-- Úsalo sólo antes de producción o después de exportar los datos sociales que deban conservarse.
BEGIN;

ALTER TABLE IF EXISTS user_profiles DROP CONSTRAINT IF EXISTS user_profiles_avatar_media_fk;
ALTER TABLE IF EXISTS user_profiles DROP CONSTRAINT IF EXISTS user_profiles_banner_media_fk;
DROP TABLE IF EXISTS content_reports;
DROP TABLE IF EXISTS project_reviews;
DROP TABLE IF EXISTS episode_comments;
DROP TABLE IF EXISTS user_media_uploads;
DROP TABLE IF EXISTS episode_history;
DROP TABLE IF EXISTS watch_later;
DROP TABLE IF EXISTS favorites;
DROP TABLE IF EXISTS episode_likes;
DROP TABLE IF EXISTS project_likes;
DROP TABLE IF EXISTS social_rate_limits;
DROP TABLE IF EXISTS user_profiles;
DROP TABLE IF EXISTS auth_rate_limits;
DROP TABLE IF EXISTS auth_verifications;
DROP TABLE IF EXISTS auth_accounts;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_users;

COMMIT;
