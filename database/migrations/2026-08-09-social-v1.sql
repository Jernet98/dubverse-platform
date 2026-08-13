-- Dubverse Social v1.
-- Migración aditiva y explícita. No contiene seed y nunca debe ejecutarse desde una petición web.
-- Better Auth 1.6.26 usa las cinco tablas auth_*; el resto pertenece al dominio social de Dubverse.
BEGIN;

CREATE TABLE IF NOT EXISTS auth_users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_accounts (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_id, account_id)
);

CREATE TABLE IF NOT EXISTS auth_verifications (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY,
  auth_user_id text NOT NULL UNIQUE REFERENCES auth_users(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  avatar_media_id uuid,
  banner_media_id uuid,
  bio text NOT NULL DEFAULT '' CHECK (char_length(bio) <= 500),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_username_ci_unique ON user_profiles(lower(username));
CREATE INDEX IF NOT EXISTS user_profiles_status_idx ON user_profiles(status);

CREATE TABLE IF NOT EXISTS project_likes (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_profile_id, project_id)
);

CREATE TABLE IF NOT EXISTS episode_likes (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  episode_id text NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_profile_id, episode_id)
);

CREATE TABLE IF NOT EXISTS favorites (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_profile_id, project_id)
);

CREATE TABLE IF NOT EXISTS watch_later (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_profile_id, project_id)
);

CREATE TABLE IF NOT EXISTS episode_history (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  episode_id text NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  first_viewed_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  view_count integer NOT NULL DEFAULT 1 CHECK (view_count > 0),
  PRIMARY KEY(user_profile_id, episode_id)
);

CREATE TABLE IF NOT EXISTS user_media_uploads (
  id uuid PRIMARY KEY,
  owner_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('AVATAR','BANNER','COMMENT')),
  target_id uuid,
  source_object_key text NOT NULL UNIQUE,
  object_key text UNIQUE,
  public_url text,
  requested_content_type text NOT NULL,
  validated_content_type text,
  byte_size bigint,
  width integer,
  height integer,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','REJECTED','DELETED')),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS episode_comments (
  id uuid PRIMARY KEY,
  episode_id text NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  author_profile_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1500),
  image_media_id uuid UNIQUE REFERENCES user_media_uploads(id) ON DELETE SET NULL,
  moderation_status text NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_status IN ('VISIBLE','HIDDEN','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS project_reviews (
  id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_profile_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  moderation_status text NOT NULL DEFAULT 'VISIBLE' CHECK (moderation_status IN ('VISIBLE','HIDDEN','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(author_profile_id, project_id)
);

CREATE TABLE IF NOT EXISTS content_reports (
  id uuid PRIMARY KEY,
  reporter_profile_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('COMMENT','REVIEW')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('SPAM','HARASSMENT','INAPPROPRIATE','SPOILER','OTHER')),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 500),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','DISMISSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text NOT NULL DEFAULT '' CHECK (char_length(resolution_note) <= 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS content_reports_reporter_target_unique
  ON content_reports(reporter_profile_id, target_type, target_id)
  WHERE reporter_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS social_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_profiles'::regclass AND conname = 'user_profiles_avatar_media_fk') THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_avatar_media_fk
      FOREIGN KEY (avatar_media_id) REFERENCES user_media_uploads(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'user_profiles'::regclass AND conname = 'user_profiles_banner_media_fk') THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_banner_media_fk
      FOREIGN KEY (banner_media_id) REFERENCES user_media_uploads(id) ON DELETE SET NULL;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_accounts_user_idx ON auth_accounts(user_id);
CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx ON auth_verifications(identifier);
CREATE INDEX IF NOT EXISTS project_likes_project_idx ON project_likes(project_id);
CREATE INDEX IF NOT EXISTS episode_likes_episode_idx ON episode_likes(episode_id);
CREATE INDEX IF NOT EXISTS favorites_project_idx ON favorites(project_id);
CREATE INDEX IF NOT EXISTS watch_later_user_created_idx ON watch_later(user_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS episode_history_user_recent_idx ON episode_history(user_profile_id, last_viewed_at DESC);
CREATE INDEX IF NOT EXISTS episode_comments_episode_recent_idx ON episode_comments(episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS episode_comments_author_idx ON episode_comments(author_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_reviews_project_recent_idx ON project_reviews(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_reviews_author_idx ON project_reviews(author_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_status_created_idx ON content_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_media_uploads_owner_status_idx ON user_media_uploads(owner_profile_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS user_media_uploads_pending_idx ON user_media_uploads(created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS social_rate_limits_expires_idx ON social_rate_limits(expires_at);

COMMIT;
