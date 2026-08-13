-- Dubverse Social v1.2: follows unidireccionales y notificaciones internas.
-- Migración aditiva y explícita. No se ejecuta durante peticiones normales.

BEGIN;

CREATE TABLE IF NOT EXISTS user_follows (
  follower_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  followed_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(follower_profile_id, followed_profile_id),
  CONSTRAINT user_follows_not_self CHECK (follower_profile_id <> followed_profile_id)
);

CREATE TABLE IF NOT EXISTS social_notifications (
  id uuid PRIMARY KEY,
  recipient_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  actor_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('FOLLOW','COMMENT_REPLY','COMMENT_LIKE')),
  target_type text NOT NULL CHECK (target_type IN ('PROFILE','COMMENT')),
  target_id uuid NOT NULL,
  context_kind text CHECK (context_kind IN ('COMMENT','REPLY')),
  root_comment_id uuid REFERENCES episode_comments(id) ON DELETE CASCADE,
  episode_id text REFERENCES episodes(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS user_follows_followed_recent_idx
  ON user_follows(followed_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_follows_follower_recent_idx
  ON user_follows(follower_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS social_notifications_recipient_recent_idx
  ON social_notifications(recipient_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS social_notifications_recipient_read_recent_idx
  ON social_notifications(recipient_profile_id, read_at, created_at DESC);

COMMIT;
