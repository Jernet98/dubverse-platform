-- Esquema objetivo para Neon PostgreSQL. Mantiene la misma forma lógica que el prototipo SQLite.
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  legacy_key text,
  type text NOT NULL CHECK (type IN ('SERIES','MOVIE','OVA','SPECIAL')),
  title text NOT NULL,
  alternate_title text NOT NULL DEFAULT '',
  synopsis text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ONGOING' CHECK (status IN ('ONGOING','FINISHED','PAUSED','CANCELLED')),
  genres jsonb NOT NULL DEFAULT '[]'::jsonb,
  poster text,
  banner text,
  published boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  legacy_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studios (
  id text PRIMARY KEY,
  name text NOT NULL,
  director text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  logo text,
  socials jsonb NOT NULL DEFAULT '{}'::jsonb,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_studios (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  studio_id text NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'Fandoblaje',
  notes text NOT NULL DEFAULT '',
  PRIMARY KEY(project_id, studio_id)
);

CREATE TABLE IF NOT EXISTS episodes (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  season integer NOT NULL DEFAULT 1,
  number integer NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  provider text NOT NULL DEFAULT 'ARCHIVE' CHECK (provider IN ('ARCHIVE','PIXELDRAIN','EXTERNAL','LOCAL')),
  video_url text NOT NULL DEFAULT '',
  archive_identifier text,
  archive_file text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','UPLOADING','PROCESSING','READY','PUBLISHED','ERROR','RETIRED')),
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, season, number)
);

CREATE INDEX IF NOT EXISTS projects_visibility_idx ON projects(published, featured);
CREATE INDEX IF NOT EXISTS episodes_project_idx ON episodes(project_id, season, number);
CREATE INDEX IF NOT EXISTS episodes_archive_idx ON episodes(archive_identifier);
