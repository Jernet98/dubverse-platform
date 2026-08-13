-- Rollback manual de Dubverse Social v1.1.
-- ADVERTENCIA: elimina de forma irreversible los likes de comentarios y la relación
-- de respuestas. Antes de usarlo, exporta esos datos si necesitas conservarlos.

BEGIN;

DROP TABLE IF EXISTS comment_likes;

DROP INDEX IF EXISTS episode_comments_root_recent_idx;
DROP INDEX IF EXISTS episode_comments_replies_recent_idx;
DROP INDEX IF EXISTS episode_comments_reply_to_profile_idx;

ALTER TABLE episode_comments
  DROP CONSTRAINT IF EXISTS episode_comments_not_own_parent,
  DROP CONSTRAINT IF EXISTS episode_comments_reply_to_profile_fk,
  DROP CONSTRAINT IF EXISTS episode_comments_parent_fk,
  DROP COLUMN IF EXISTS reply_to_profile_id,
  DROP COLUMN IF EXISTS parent_comment_id;

COMMIT;
