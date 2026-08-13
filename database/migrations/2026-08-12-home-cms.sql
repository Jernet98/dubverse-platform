-- Dubverse Home CMS v1: configuración editorial aditiva para la portada.
-- Migración explícita. No se ejecuta durante peticiones normales.

BEGIN;

CREATE TABLE IF NOT EXISTS site_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  site_name text NOT NULL DEFAULT '' CHECK (char_length(site_name) <= 80),
  footer_slogan text NOT NULL DEFAULT '' CHECK (char_length(footer_slogan) <= 240),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  public_email text NOT NULL DEFAULT '' CHECK (char_length(public_email) <= 254),
  copyright_text text NOT NULL DEFAULT '' CHECK (char_length(copyright_text) <= 240),
  socials jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(socials) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_sections (
  id uuid PRIMARY KEY,
  section_key text NOT NULL UNIQUE CHECK (section_key ~ '^[a-z0-9_-]{2,60}$'),
  section_type text NOT NULL CHECK (section_type IN (
    'HERO','FEATURED_PROJECTS','FEATURED_STUDIOS','AUTO_STATUS','AUTO_TYPE','RECENT','CURATED','RECOMMENDED'
  )),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  subtitle text NOT NULL DEFAULT '' CHECK (char_length(subtitle) <= 300),
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  max_items smallint NOT NULL DEFAULT 6 CHECK (max_items BETWEEN 1 AND 12),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_featured_projects (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_featured_studios (
  studio_id text PRIMARY KEY REFERENCES studios(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_hero_projects (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  weight smallint NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS home_curated_projects (
  section_id uuid NOT NULL REFERENCES home_sections(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(section_id, project_id)
);

CREATE TABLE IF NOT EXISTS editorial_banners (
  id uuid PRIMARY KEY,
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 40),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  image_url text NOT NULL DEFAULT '' CHECK (char_length(image_url) <= 2000),
  link_url text NOT NULL DEFAULT '' CHECK (char_length(link_url) <= 2000),
  button_text text NOT NULL DEFAULT '' CHECK (char_length(button_text) <= 60),
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10000),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_banners_date_order CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS home_sections_order_idx
  ON home_sections(enabled, position);

CREATE INDEX IF NOT EXISTS home_featured_projects_order_idx
  ON home_featured_projects(enabled, position);

CREATE INDEX IF NOT EXISTS home_featured_studios_order_idx
  ON home_featured_studios(enabled, position);

CREATE INDEX IF NOT EXISTS home_hero_projects_order_idx
  ON home_hero_projects(enabled, position);

CREATE INDEX IF NOT EXISTS home_curated_projects_order_idx
  ON home_curated_projects(section_id, enabled, position);

CREATE INDEX IF NOT EXISTS editorial_banners_schedule_idx
  ON editorial_banners(enabled, position, starts_at, ends_at);

COMMIT;
