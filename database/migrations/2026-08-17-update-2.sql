-- Dubverse Update 2: player, progreso, material promocional y administración de estudios.
-- Migración aditiva y explícita. No contiene seed y nunca debe ejecutarse desde una petición web.

BEGIN;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('ONGOING','UPCOMING','FINISHED','PAUSED','CANCELLED'));

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_provider_check;
ALTER TABLE episodes
  ADD CONSTRAINT episodes_provider_check
  CHECK (provider IN ('ARCHIVE','DIRECT','HLS','PIXELDRAIN','EXTERNAL','LOCAL'));

ALTER TABLE studios
  ADD COLUMN IF NOT EXISTS banner text,
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by text;

ALTER TABLE editorial_banners
  ADD COLUMN IF NOT EXISTS mobile_image_url text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS studio_memberships (
  id uuid PRIMARY KEY,
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  studio_id text NOT NULL REFERENCES studios(id) ON UPDATE CASCADE ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'ADMIN' CHECK (role IN ('OWNER','ADMIN')),
  granted_by text NOT NULL DEFAULT 'global-admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_profile_id, studio_id)
);

CREATE TABLE IF NOT EXISTS studio_follows (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  studio_id text NOT NULL REFERENCES studios(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_profile_id, studio_id)
);

CREATE TABLE IF NOT EXISTS watch_progress (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  episode_id text NOT NULL REFERENCES episodes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  position_seconds numeric(12,3) NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  duration_seconds numeric(12,3) NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_profile_id, episode_id)
);

CREATE TABLE IF NOT EXISTS project_promo_media (
  id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('TRAILER','TEASER','PV','SPECIAL')),
  provider text NOT NULL CHECK (char_length(provider) BETWEEN 2 AND 40),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  url text NOT NULL DEFAULT '' CHECK (char_length(url) <= 2000),
  provider_identifier text NOT NULL DEFAULT '' CHECK (char_length(provider_identifier) <= 200),
  provider_file text NOT NULL DEFAULT '' CHECK (char_length(provider_file) <= 1000),
  thumbnail_url text NOT NULL DEFAULT '' CHECK (char_length(thumbnail_url) <= 2000),
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE episode_comments
  ADD COLUMN IF NOT EXISTS author_studio_id text,
  ADD COLUMN IF NOT EXISTS reply_to_studio_id text;

ALTER TABLE episode_comments
  DROP CONSTRAINT IF EXISTS episode_comments_author_studio_fk,
  DROP CONSTRAINT IF EXISTS episode_comments_reply_to_studio_fk;

ALTER TABLE episode_comments
  ADD CONSTRAINT episode_comments_author_studio_fk
    FOREIGN KEY (author_studio_id) REFERENCES studios(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT episode_comments_reply_to_studio_fk
    FOREIGN KEY (reply_to_studio_id) REFERENCES studios(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- Un comentario raíz eliminado por su autor no debe arrastrar respuestas de terceros.
ALTER TABLE episode_comments DROP CONSTRAINT IF EXISTS episode_comments_parent_fk;
ALTER TABLE episode_comments
  ADD CONSTRAINT episode_comments_parent_fk
  FOREIGN KEY (parent_comment_id) REFERENCES episode_comments(id) ON DELETE SET NULL;

ALTER TABLE social_notifications
  ALTER COLUMN actor_profile_id DROP NOT NULL,
  ALTER COLUMN target_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS actor_studio_id text,
  ADD COLUMN IF NOT EXISTS studio_id text,
  ADD COLUMN IF NOT EXISTS project_id text;

ALTER TABLE social_notifications
  DROP CONSTRAINT IF EXISTS social_notifications_actor_studio_fk,
  DROP CONSTRAINT IF EXISTS social_notifications_studio_fk,
  DROP CONSTRAINT IF EXISTS social_notifications_project_fk;

ALTER TABLE social_notifications
  ADD CONSTRAINT social_notifications_actor_studio_fk
    FOREIGN KEY (actor_studio_id) REFERENCES studios(id) ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT social_notifications_studio_fk
    FOREIGN KEY (studio_id) REFERENCES studios(id) ON UPDATE CASCADE ON DELETE CASCADE,
  ADD CONSTRAINT social_notifications_project_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_type_check;
ALTER TABLE social_notifications
  ADD CONSTRAINT social_notifications_type_check
  CHECK (type IN ('FOLLOW','COMMENT_REPLY','COMMENT_LIKE','STUDIO_NEW_PROJECT','STUDIO_NEW_EPISODE'));

ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_target_type_check;
ALTER TABLE social_notifications
  ADD CONSTRAINT social_notifications_target_type_check
  CHECK (target_type IN ('PROFILE','COMMENT','STUDIO','PROJECT','EPISODE'));

CREATE INDEX IF NOT EXISTS studio_memberships_user_idx
  ON studio_memberships(user_profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS studio_memberships_studio_idx
  ON studio_memberships(studio_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS studio_follows_studio_recent_idx
  ON studio_follows(studio_id, created_at DESC);
CREATE INDEX IF NOT EXISTS watch_progress_user_recent_idx
  ON watch_progress(user_profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS project_promo_media_project_order_idx
  ON project_promo_media(project_id, is_active, position, created_at);
CREATE INDEX IF NOT EXISTS episode_comments_author_studio_recent_idx
  ON episode_comments(author_studio_id, created_at DESC)
  WHERE author_studio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS social_notifications_studio_recent_idx
  ON social_notifications(studio_id, created_at DESC)
  WHERE studio_id IS NOT NULL;

COMMIT;
