-- ROLLBACK DESTRUCTIVO: elimina el historial de aliases y las URLs antiguas dejarán de resolver.
-- Revisar y respaldar project_slug_aliases, studio_slug_aliases y episode_slug_aliases antes de ejecutarlo.
-- No ejecutar mientras existan despliegues que utilicen la herramienta Cambiar ID / slug.

BEGIN;

DROP FUNCTION IF EXISTS dubverse_rename_project_slug(text, text);
DROP FUNCTION IF EXISTS dubverse_rename_studio_slug(text, text);
DROP FUNCTION IF EXISTS dubverse_rename_episode_slug(text, text);

DROP TRIGGER IF EXISTS projects_slug_namespace_guard ON projects;
DROP TRIGGER IF EXISTS project_aliases_slug_namespace_guard ON project_slug_aliases;
DROP TRIGGER IF EXISTS studios_slug_namespace_guard ON studios;
DROP TRIGGER IF EXISTS studio_aliases_slug_namespace_guard ON studio_slug_aliases;
DROP TRIGGER IF EXISTS episodes_slug_namespace_guard ON episodes;
DROP TRIGGER IF EXISTS episode_aliases_slug_namespace_guard ON episode_slug_aliases;

DROP FUNCTION IF EXISTS enforce_project_slug_namespace();
DROP FUNCTION IF EXISTS enforce_studio_slug_namespace();
DROP FUNCTION IF EXISTS enforce_episode_slug_namespace();

DROP TABLE IF EXISTS project_slug_aliases;
DROP TABLE IF EXISTS studio_slug_aliases;
DROP TABLE IF EXISTS episode_slug_aliases;

ALTER TABLE project_studios
  DROP CONSTRAINT project_studios_project_id_fkey,
  ADD CONSTRAINT project_studios_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  DROP CONSTRAINT project_studios_studio_id_fkey,
  ADD CONSTRAINT project_studios_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE;

ALTER TABLE episodes DROP CONSTRAINT episodes_project_id_fkey,
  ADD CONSTRAINT episodes_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_likes DROP CONSTRAINT project_likes_project_id_fkey,
  ADD CONSTRAINT project_likes_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE episode_likes DROP CONSTRAINT episode_likes_episode_id_fkey,
  ADD CONSTRAINT episode_likes_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
ALTER TABLE favorites DROP CONSTRAINT favorites_project_id_fkey,
  ADD CONSTRAINT favorites_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE watch_later DROP CONSTRAINT watch_later_project_id_fkey,
  ADD CONSTRAINT watch_later_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE episode_history DROP CONSTRAINT episode_history_episode_id_fkey,
  ADD CONSTRAINT episode_history_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
ALTER TABLE episode_comments DROP CONSTRAINT episode_comments_episode_id_fkey,
  ADD CONSTRAINT episode_comments_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
ALTER TABLE project_reviews DROP CONSTRAINT project_reviews_project_id_fkey,
  ADD CONSTRAINT project_reviews_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE social_notifications DROP CONSTRAINT social_notifications_episode_id_fkey,
  ADD CONSTRAINT social_notifications_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
ALTER TABLE episode_watched DROP CONSTRAINT episode_watched_episode_id_fkey,
  ADD CONSTRAINT episode_watched_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;
ALTER TABLE home_featured_projects DROP CONSTRAINT home_featured_projects_project_id_fkey,
  ADD CONSTRAINT home_featured_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE home_featured_studios DROP CONSTRAINT home_featured_studios_studio_id_fkey,
  ADD CONSTRAINT home_featured_studios_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE;
ALTER TABLE home_hero_projects DROP CONSTRAINT home_hero_projects_project_id_fkey,
  ADD CONSTRAINT home_hero_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE home_curated_projects DROP CONSTRAINT home_curated_projects_project_id_fkey,
  ADD CONSTRAINT home_curated_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

COMMIT;
