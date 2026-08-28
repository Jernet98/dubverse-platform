-- Clasificación, metadata de búsqueda y anuncios. Migración aditiva; ejecutar manualmente una vez.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS original_title text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS alternate_titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS search_aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS age_rating text NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN IF NOT EXISTS content_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE projects SET original_title = '' WHERE original_title IS NULL;
UPDATE projects SET alternate_titles = '[]'::jsonb WHERE alternate_titles IS NULL;
UPDATE projects SET search_aliases = '[]'::jsonb WHERE search_aliases IS NULL;
UPDATE projects SET content_warnings = '[]'::jsonb WHERE content_warnings IS NULL;
UPDATE projects SET age_rating = 'GENERAL' WHERE age_rating IS NULL OR btrim(age_rating) = '';

ALTER TABLE projects
  ALTER COLUMN original_title SET DEFAULT '',
  ALTER COLUMN original_title SET NOT NULL,
  ALTER COLUMN alternate_titles SET DEFAULT '[]'::jsonb,
  ALTER COLUMN alternate_titles SET NOT NULL,
  ALTER COLUMN search_aliases SET DEFAULT '[]'::jsonb,
  ALTER COLUMN search_aliases SET NOT NULL,
  ALTER COLUMN age_rating SET DEFAULT 'GENERAL',
  ALTER COLUMN age_rating SET NOT NULL,
  ALTER COLUMN content_warnings SET DEFAULT '[]'::jsonb,
  ALTER COLUMN content_warnings SET NOT NULL;

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM projects WHERE jsonb_typeof(alternate_titles) <> 'array') THEN
    RAISE EXCEPTION 'projects.alternate_titles contiene valores que no son arrays';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE jsonb_typeof(search_aliases) <> 'array') THEN
    RAISE EXCEPTION 'projects.search_aliases contiene valores que no son arrays';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE jsonb_typeof(content_warnings) <> 'array') THEN
    RAISE EXCEPTION 'projects.content_warnings contiene valores que no son arrays';
  END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE age_rating NOT IN ('GENERAL','AGE_13','AGE_16','AGE_18')) THEN
    RAISE EXCEPTION 'projects.age_rating contiene valores no reconocidos';
  END IF;
END
$migration$;

UPDATE projects
SET alternate_titles = alternate_titles || jsonb_build_array(btrim(alternate_title))
WHERE btrim(alternate_title) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(alternate_titles) value
    WHERE lower(btrim(value)) = lower(btrim(alternate_title))
  );

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_age_rating_check;
ALTER TABLE projects ADD CONSTRAINT projects_age_rating_check
  CHECK (age_rating IN ('GENERAL','AGE_13','AGE_16','AGE_18'));

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_alternate_titles_array_check;
ALTER TABLE projects ADD CONSTRAINT projects_alternate_titles_array_check CHECK (jsonb_typeof(alternate_titles) = 'array');
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_search_aliases_array_check;
ALTER TABLE projects ADD CONSTRAINT projects_search_aliases_array_check CHECK (jsonb_typeof(search_aliases) = 'array');
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_content_warnings_array_check;
ALTER TABLE projects ADD CONSTRAINT projects_content_warnings_array_check CHECK (jsonb_typeof(content_warnings) = 'array');

CREATE INDEX IF NOT EXISTS projects_search_trgm_idx ON projects USING gin
  ((lower(title || ' ' || original_title || ' ' || alternate_title || ' ' || alternate_titles::text || ' ' || search_aliases::text)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS studios_name_trgm_idx ON studios USING gin ((lower(name)) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS age_confirmations (
  user_profile_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE age_confirmations
  ADD COLUMN IF NOT EXISTS user_profile_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz NOT NULL DEFAULT now();

DO $migration$
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid='user_profiles'::regclass AND a.attname='id' AND NOT a.attisdropped) <> 'uuid' THEN
    RAISE EXCEPTION 'user_profiles.id debe ser uuid';
  END IF;
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid='age_confirmations'::regclass AND a.attname='user_profile_id' AND NOT a.attisdropped) <> 'uuid' THEN
    RAISE EXCEPTION 'age_confirmations.user_profile_id debe ser uuid';
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.conrelid='age_confirmations'::regclass AND c.contype='p' AND array_length(c.conkey,1)=1 AND a.attname='user_profile_id') THEN
    ALTER TABLE age_confirmations ADD CONSTRAINT age_confirmations_pkey PRIMARY KEY (user_profile_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.conrelid='age_confirmations'::regclass AND c.contype='f' AND c.confrelid='user_profiles'::regclass
      AND array_length(c.conkey,1)=1 AND a.attname='user_profile_id' AND c.confdeltype='c') THEN
    ALTER TABLE age_confirmations ADD CONSTRAINT age_confirmations_user_profile_fk FOREIGN KEY (user_profile_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
  END IF;
END
$migration$;

ALTER TABLE social_notifications
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS link_url text;

DO $migration$
BEGIN
  IF (SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a WHERE a.attrelid='projects'::regclass AND a.attname='alternate_titles' AND NOT a.attisdropped) <> 'jsonb'
    OR (SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a WHERE a.attrelid='projects'::regclass AND a.attname='search_aliases' AND NOT a.attisdropped) <> 'jsonb'
    OR (SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a WHERE a.attrelid='projects'::regclass AND a.attname='content_warnings' AND NOT a.attisdropped) <> 'jsonb' THEN
    RAISE EXCEPTION 'Las columnas de listas de projects deben ser jsonb';
  END IF;
  IF (SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a WHERE a.attrelid='social_notifications'::regclass AND a.attname='title' AND NOT a.attisdropped) <> 'text'
    OR (SELECT format_type(a.atttypid,a.atttypmod) FROM pg_attribute a WHERE a.attrelid='social_notifications'::regclass AND a.attname='message' AND NOT a.attisdropped) <> 'text' THEN
    RAISE EXCEPTION 'Las columnas de contenido de social_notifications deben ser text';
  END IF;
END
$migration$;

ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_type_check;
ALTER TABLE social_notifications ADD CONSTRAINT social_notifications_type_check CHECK (type IN (
  'FOLLOW','COMMENT_REPLY','COMMENT_LIKE','STUDIO_NEW_PROJECT','STUDIO_NEW_EPISODE',
  'GLOBAL_NEW_STUDIO','GLOBAL_NEW_PROJECT','CONTENT_NEW_EPISODE','ADMIN_ANNOUNCEMENT'
));

ALTER TABLE social_notifications DROP CONSTRAINT IF EXISTS social_notifications_target_type_check;
ALTER TABLE social_notifications ADD CONSTRAINT social_notifications_target_type_check
  CHECK (target_type IN ('PROFILE','COMMENT','STUDIO','PROJECT','EPISODE','ANNOUNCEMENT'));

CREATE TABLE IF NOT EXISTS admin_announcements (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  image_url text NOT NULL DEFAULT '',
  link_url text NOT NULL DEFAULT '',
  audience_type text NOT NULL CHECK (audience_type IN ('ALL','STUDIO_FOLLOWERS','PROJECT_FOLLOWERS','USER')),
  audience_id text NOT NULL DEFAULT '',
  dedupe_key text NOT NULL UNIQUE,
  recipient_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Una ejecución parcial previa puede haber creado las tablas/columnas sin terminar el resto.
ALTER TABLE admin_announcements
  ADD COLUMN IF NOT EXISTS id uuid,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS link_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS audience_type text,
  ADD COLUMN IF NOT EXISTS audience_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS recipient_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $migration$
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a WHERE a.attrelid='admin_announcements'::regclass AND a.attname='id' AND NOT a.attisdropped) <> 'uuid' THEN
    RAISE EXCEPTION 'admin_announcements.id debe ser uuid';
  END IF;
  IF EXISTS (SELECT 1 FROM admin_announcements WHERE title IS NULL OR message IS NULL OR audience_type IS NULL OR dedupe_key IS NULL) THEN
    RAISE EXCEPTION 'admin_announcements contiene filas parciales incompletas';
  END IF;
END
$migration$;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
    WHERE c.conrelid='admin_announcements'::regclass AND c.contype='p' AND array_length(c.conkey,1)=1 AND a.attname='id') THEN
    ALTER TABLE admin_announcements ADD CONSTRAINT admin_announcements_pkey PRIMARY KEY (id);
  END IF;
END
$migration$;

ALTER TABLE admin_announcements
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN message SET NOT NULL,
  ALTER COLUMN audience_type SET NOT NULL,
  ALTER COLUMN dedupe_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS admin_announcements_dedupe_key_uidx ON admin_announcements(dedupe_key);
ALTER TABLE admin_announcements DROP CONSTRAINT IF EXISTS admin_announcements_title_length_check;
ALTER TABLE admin_announcements ADD CONSTRAINT admin_announcements_title_length_check CHECK (char_length(title) BETWEEN 1 AND 120);
ALTER TABLE admin_announcements DROP CONSTRAINT IF EXISTS admin_announcements_message_length_check;
ALTER TABLE admin_announcements ADD CONSTRAINT admin_announcements_message_length_check CHECK (char_length(message) BETWEEN 1 AND 1000);
ALTER TABLE admin_announcements DROP CONSTRAINT IF EXISTS admin_announcements_audience_type_check;
ALTER TABLE admin_announcements ADD CONSTRAINT admin_announcements_audience_type_check CHECK (audience_type IN ('ALL','STUDIO_FOLLOWERS','PROJECT_FOLLOWERS','USER'));
ALTER TABLE admin_announcements DROP CONSTRAINT IF EXISTS admin_announcements_recipient_count_check;
ALTER TABLE admin_announcements ADD CONSTRAINT admin_announcements_recipient_count_check CHECK (recipient_count >= 0);

COMMIT;
