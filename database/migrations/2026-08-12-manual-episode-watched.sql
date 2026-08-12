-- Dubverse Social: estado manual de episodios vistos.
-- Migración aditiva y explícita. No deriva estados desde episode_history y no debe ejecutarse desde una petición web.
BEGIN;

CREATE TABLE IF NOT EXISTS episode_watched (
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  episode_id text NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_profile_id, episode_id)
);

CREATE INDEX IF NOT EXISTS episode_watched_episode_idx ON episode_watched(episode_id);

COMMIT;
