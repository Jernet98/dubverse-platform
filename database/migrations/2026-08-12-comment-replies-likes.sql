-- Dubverse Social v1.1: respuestas y likes de comentarios.
-- Migración aditiva y explícita. No se ejecuta durante peticiones normales.

BEGIN;

ALTER TABLE episode_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid,
  ADD COLUMN IF NOT EXISTS reply_to_profile_id uuid;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'episode_comments'::regclass
      AND conname = 'episode_comments_parent_fk'
  ) THEN
    ALTER TABLE episode_comments
      ADD CONSTRAINT episode_comments_parent_fk
      FOREIGN KEY (parent_comment_id) REFERENCES episode_comments(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'episode_comments'::regclass
      AND conname = 'episode_comments_reply_to_profile_fk'
  ) THEN
    ALTER TABLE episode_comments
      ADD CONSTRAINT episode_comments_reply_to_profile_fk
      FOREIGN KEY (reply_to_profile_id) REFERENCES user_profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'episode_comments'::regclass
      AND conname = 'episode_comments_not_own_parent'
  ) THEN
    ALTER TABLE episode_comments
      ADD CONSTRAINT episode_comments_not_own_parent
      CHECK (parent_comment_id IS NULL OR parent_comment_id <> id);
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS comment_likes (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES episode_comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_profile_id, comment_id)
);

CREATE INDEX IF NOT EXISTS episode_comments_root_recent_idx
  ON episode_comments(episode_id, created_at DESC)
  WHERE parent_comment_id IS NULL;

CREATE INDEX IF NOT EXISTS episode_comments_replies_recent_idx
  ON episode_comments(parent_comment_id, created_at ASC)
  WHERE parent_comment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS episode_comments_reply_to_profile_idx
  ON episode_comments(reply_to_profile_id, created_at DESC)
  WHERE reply_to_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS comment_likes_comment_idx
  ON comment_likes(comment_id);

COMMIT;
