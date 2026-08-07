export async function ensureSchema(sql) {
  await sql.transaction([
    sql`CREATE TABLE IF NOT EXISTS settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL
    )`,

    sql`CREATE TABLE IF NOT EXISTS projects (
      id text PRIMARY KEY,
      legacy_key text,
      type text NOT NULL CHECK (type IN ('SERIES','MOVIE','OVA','SPECIAL','MANGA_COMIC_DUB')),
      title text NOT NULL,
      alternate_title text NOT NULL DEFAULT '',
      synopsis text NOT NULL DEFAULT '',
      project_director text NOT NULL DEFAULT '',
      dubbing_info text NOT NULL DEFAULT '',
      credits text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'ONGOING' CHECK (status IN ('ONGOING','FINISHED','PAUSED','CANCELLED')),
      genres jsonb NOT NULL DEFAULT '[]'::jsonb,
      poster text,
      banner text,
      published boolean NOT NULL DEFAULT false,
      featured boolean NOT NULL DEFAULT false,
      legacy_path text,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    sql`CREATE TABLE IF NOT EXISTS studios (
      id text PRIMARY KEY,
      name text NOT NULL,
      director text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      logo text,
      socials jsonb NOT NULL DEFAULT '{}'::jsonb,
      published boolean NOT NULL DEFAULT true,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    sql`CREATE TABLE IF NOT EXISTS project_studios (
      project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      studio_id text NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'Fandoblaje',
      notes text NOT NULL DEFAULT '',
      PRIMARY KEY(project_id, studio_id)
    )`,

    sql`CREATE TABLE IF NOT EXISTS episodes (
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
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(project_id, season, number)
    )`,

    sql`CREATE TABLE IF NOT EXISTS admin_login_attempts (
      key_hash text PRIMARY KEY,
      failures integer NOT NULL DEFAULT 0,
      locked_until timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,

    sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
    sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_director text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS dubbing_info text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS credits text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE studios ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
    sql`ALTER TABLE episodes ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,

    sql`DO $migration$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'projects'::regclass
            AND conname = 'projects_type_check'
            AND pg_get_constraintdef(oid) NOT LIKE '%MANGA_COMIC_DUB%'
        ) THEN
          ALTER TABLE projects DROP CONSTRAINT projects_type_check;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = 'projects'::regclass
            AND conname = 'projects_type_check'
        ) THEN
          ALTER TABLE projects
            ADD CONSTRAINT projects_type_check
            CHECK (type IN ('SERIES','MOVIE','OVA','SPECIAL','MANGA_COMIC_DUB'));
        END IF;
      END
    $migration$`,

    sql`CREATE INDEX IF NOT EXISTS projects_visibility_idx ON projects(published, featured)`,
    sql`CREATE INDEX IF NOT EXISTS projects_deleted_idx ON projects(deleted_at)`,
    sql`CREATE INDEX IF NOT EXISTS studios_deleted_idx ON studios(deleted_at)`,
    sql`CREATE INDEX IF NOT EXISTS episodes_project_idx ON episodes(project_id, season, number)`,
    sql`CREATE INDEX IF NOT EXISTS episodes_archive_idx ON episodes(archive_identifier)`,
    sql`CREATE INDEX IF NOT EXISTS episodes_deleted_idx ON episodes(deleted_at)`,
    sql`CREATE INDEX IF NOT EXISTS admin_login_attempts_updated_idx ON admin_login_attempts(updated_at)`
  ]);
}
