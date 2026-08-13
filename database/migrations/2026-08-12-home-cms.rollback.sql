-- Rollback manual de Dubverse Home CMS v1.
-- ADVERTENCIA: elimina de forma irreversible toda la configuración editorial de portada y sitio.

BEGIN;

DROP TABLE IF EXISTS editorial_banners;
DROP TABLE IF EXISTS home_curated_projects;
DROP TABLE IF EXISTS home_hero_projects;
DROP TABLE IF EXISTS home_featured_studios;
DROP TABLE IF EXISTS home_featured_projects;
DROP TABLE IF EXISTS home_sections;
DROP TABLE IF EXISTS site_settings;

COMMIT;
