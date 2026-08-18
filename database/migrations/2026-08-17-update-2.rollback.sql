-- ROLLBACK DESTRUCTIVO de Dubverse Update 2.
-- No ejecutar sin respaldar progreso, membresías, follows, material promocional e identidades de estudio.

BEGIN;

DO $rollback$
BEGIN
  IF EXISTS (SELECT 1 FROM projects WHERE status = 'UPCOMING') THEN
    RAISE EXCEPTION 'No se puede revertir: existen proyectos UPCOMING.';
  END IF;
  IF EXISTS (SELECT 1 FROM episodes WHERE provider IN ('DIRECT','HLS')) THEN
    RAISE EXCEPTION 'No se puede revertir: existen episodios DIRECT/HLS.';
  END IF;
  IF EXISTS (SELECT 1 FROM episode_comments WHERE author_studio_id IS NOT NULL OR reply_to_studio_id IS NOT NULL) THEN
    RAISE EXCEPTION 'No se puede revertir: existen comentarios con identidad de estudio.';
  END IF;
  IF EXISTS (SELECT 1 FROM social_notifications WHERE type IN ('STUDIO_NEW_PROJECT','STUDIO_NEW_EPISODE')) THEN
    RAISE EXCEPTION 'No se puede revertir: existen notificaciones de estudios.';
  END IF;
END
$rollback$;

ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_project_fk;
ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_studio_fk;
ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_actor_studio_fk;
ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_type_check;
ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_target_type_check;
ALTER TABLE social_notifications
  ADD CONSTRAINT social_notifications_type_check CHECK (type IN ('FOLLOW','COMMENT_REPLY','COMMENT_LIKE')),
  ADD CONSTRAINT social_notifications_target_type_check CHECK (target_type IN ('PROFILE','COMMENT'));
ALTER TABLE social_notifications DROP COLUMN project_id, DROP COLUMN studio_id, DROP COLUMN actor_studio_id;
ALTER TABLE social_notifications ALTER COLUMN actor_profile_id SET NOT NULL, ALTER COLUMN target_id SET NOT NULL;

ALTER TABLE episode_comments DROP CONSTRAINT IF EXISTS episode_comments_author_studio_fk;
ALTER TABLE episode_comments DROP CONSTRAINT IF EXISTS episode_comments_reply_to_studio_fk;
ALTER TABLE episode_comments DROP CONSTRAINT IF EXISTS episode_comments_parent_fk;
ALTER TABLE episode_comments
  ADD CONSTRAINT episode_comments_parent_fk FOREIGN KEY (parent_comment_id) REFERENCES episode_comments(id) ON DELETE CASCADE;
ALTER TABLE episode_comments DROP COLUMN author_studio_id, DROP COLUMN reply_to_studio_id;

DROP TABLE IF EXISTS project_promo_media;
DROP TABLE IF EXISTS watch_progress;
DROP TABLE IF EXISTS studio_follows;
DROP TABLE IF EXISTS studio_memberships;

ALTER TABLE editorial_banners DROP COLUMN mobile_image_url;
ALTER TABLE studios DROP COLUMN verified_by, DROP COLUMN verified_at, DROP COLUMN is_verified, DROP COLUMN banner;

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_provider_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_provider_check CHECK (provider IN ('ARCHIVE','PIXELDRAIN','EXTERNAL','LOCAL'));
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN ('ONGOING','FINISHED','PAUSED','CANCELLED'));

COMMIT;
