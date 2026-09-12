-- Analytics agregado desde la fecha de activación. Aplicar manualmente en una branch Preview antes de producción.
-- No convierte historial, likes ni progreso antiguos en vistas.
BEGIN;

CREATE TABLE IF NOT EXISTS analytics_events (
  id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('PROJECT_VIEW','EPISODE_VIEW','PLAY_START','PLAY_25','PLAY_50','PLAY_75','PLAY_90','PLAY_COMPLETE')),
  project_id text REFERENCES projects(id) ON UPDATE CASCADE ON DELETE SET NULL,
  episode_id text REFERENCES episodes(id) ON UPDATE CASCADE ON DELETE SET NULL,
  visitor_id uuid NOT NULL,
  session_id uuid NOT NULL,
  playback_id uuid,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Las referencias pueden volverse NULL si el contenido se elimina definitivamente.
  CHECK ((event_type = 'PROJECT_VIEW' AND episode_id IS NULL AND playback_id IS NULL)
    OR (event_type = 'EPISODE_VIEW' AND playback_id IS NULL)
    OR (event_type LIKE 'PLAY_%' AND playback_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS analytics_event_studios (
  event_id uuid NOT NULL REFERENCES analytics_events(id) ON DELETE CASCADE,
  studio_id text NOT NULL REFERENCES studios(id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (event_id, studio_id)
);

CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_type_created_idx ON analytics_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_project_created_idx ON analytics_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_episode_created_idx ON analytics_events(episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_session_created_idx ON analytics_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_visitor_created_idx ON analytics_events(visitor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_playback_idx ON analytics_events(playback_id, event_type);
CREATE INDEX IF NOT EXISTS analytics_event_studios_studio_idx ON analytics_event_studios(studio_id, event_id);

COMMIT;
