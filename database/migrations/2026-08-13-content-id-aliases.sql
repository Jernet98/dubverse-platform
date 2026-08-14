-- Dubverse: cambio seguro de IDs/slugs y aliases históricos.
-- Migración explícita. Debe ejecutarse manualmente antes de habilitar la herramienta administrativa.

BEGIN;

-- Las PK se renombran en su tabla original. Estas FKs propagan el cambio sin borrar registros.
ALTER TABLE project_studios
  DROP CONSTRAINT project_studios_project_id_fkey,
  ADD CONSTRAINT project_studios_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE,
  DROP CONSTRAINT project_studios_studio_id_fkey,
  ADD CONSTRAINT project_studios_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES studios(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE episodes
  DROP CONSTRAINT episodes_project_id_fkey,
  ADD CONSTRAINT episodes_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE project_likes
  DROP CONSTRAINT project_likes_project_id_fkey,
  ADD CONSTRAINT project_likes_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE episode_likes
  DROP CONSTRAINT episode_likes_episode_id_fkey,
  ADD CONSTRAINT episode_likes_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE favorites
  DROP CONSTRAINT favorites_project_id_fkey,
  ADD CONSTRAINT favorites_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE watch_later
  DROP CONSTRAINT watch_later_project_id_fkey,
  ADD CONSTRAINT watch_later_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE episode_history
  DROP CONSTRAINT episode_history_episode_id_fkey,
  ADD CONSTRAINT episode_history_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE episode_comments
  DROP CONSTRAINT episode_comments_episode_id_fkey,
  ADD CONSTRAINT episode_comments_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE project_reviews
  DROP CONSTRAINT project_reviews_project_id_fkey,
  ADD CONSTRAINT project_reviews_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE social_notifications
  DROP CONSTRAINT social_notifications_episode_id_fkey,
  ADD CONSTRAINT social_notifications_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE episode_watched
  DROP CONSTRAINT episode_watched_episode_id_fkey,
  ADD CONSTRAINT episode_watched_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE home_featured_projects
  DROP CONSTRAINT home_featured_projects_project_id_fkey,
  ADD CONSTRAINT home_featured_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE home_featured_studios
  DROP CONSTRAINT home_featured_studios_studio_id_fkey,
  ADD CONSTRAINT home_featured_studios_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES studios(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE home_hero_projects
  DROP CONSTRAINT home_hero_projects_project_id_fkey,
  ADD CONSTRAINT home_hero_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE home_curated_projects
  DROP CONSTRAINT home_curated_projects_project_id_fkey,
  ADD CONSTRAINT home_curated_projects_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE TABLE project_slug_aliases (
  alias text PRIMARY KEY CHECK (alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  project_id text NOT NULL REFERENCES projects(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE studio_slug_aliases (
  alias text PRIMARY KEY CHECK (alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  studio_id text NOT NULL REFERENCES studios(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE episode_slug_aliases (
  alias text PRIMARY KEY CHECK (alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  episode_id text NOT NULL REFERENCES episodes(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_slug_aliases_target_idx ON project_slug_aliases(project_id);
CREATE INDEX studio_slug_aliases_target_idx ON studio_slug_aliases(studio_id);
CREATE INDEX episode_slug_aliases_target_idx ON episode_slug_aliases(episode_id);

-- Un ID vigente y un alias nunca pueden ocupar el mismo namespace.
-- El advisory lock hace que la comprobación también sea segura ante escrituras concurrentes.
CREATE FUNCTION enforce_project_slug_namespace() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dubverse:project-slugs', 0));
  IF TG_TABLE_NAME = 'projects' THEN
    IF EXISTS (SELECT 1 FROM project_slug_aliases WHERE alias = NEW.id) THEN
      RAISE EXCEPTION 'El ID de proyecto % ya existe como alias histórico.', NEW.id USING ERRCODE = '23505';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM projects WHERE id = NEW.alias) THEN
    RAISE EXCEPTION 'El alias de proyecto % ya existe como ID vigente.', NEW.alias USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION enforce_studio_slug_namespace() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dubverse:studio-slugs', 0));
  IF TG_TABLE_NAME = 'studios' THEN
    IF EXISTS (SELECT 1 FROM studio_slug_aliases WHERE alias = NEW.id) THEN
      RAISE EXCEPTION 'El ID de estudio % ya existe como alias histórico.', NEW.id USING ERRCODE = '23505';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM studios WHERE id = NEW.alias) THEN
    RAISE EXCEPTION 'El alias de estudio % ya existe como ID vigente.', NEW.alias USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION enforce_episode_slug_namespace() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dubverse:episode-slugs', 0));
  IF TG_TABLE_NAME = 'episodes' THEN
    IF EXISTS (SELECT 1 FROM episode_slug_aliases WHERE alias = NEW.id) THEN
      RAISE EXCEPTION 'El ID de episodio % ya existe como alias histórico.', NEW.id USING ERRCODE = '23505';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM episodes WHERE id = NEW.alias) THEN
    RAISE EXCEPTION 'El alias de episodio % ya existe como ID vigente.', NEW.alias USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER projects_slug_namespace_guard
  BEFORE INSERT OR UPDATE OF id ON projects
  FOR EACH ROW EXECUTE FUNCTION enforce_project_slug_namespace();
CREATE TRIGGER project_aliases_slug_namespace_guard
  BEFORE INSERT OR UPDATE OF alias ON project_slug_aliases
  FOR EACH ROW EXECUTE FUNCTION enforce_project_slug_namespace();

CREATE TRIGGER studios_slug_namespace_guard
  BEFORE INSERT OR UPDATE OF id ON studios
  FOR EACH ROW EXECUTE FUNCTION enforce_studio_slug_namespace();
CREATE TRIGGER studio_aliases_slug_namespace_guard
  BEFORE INSERT OR UPDATE OF alias ON studio_slug_aliases
  FOR EACH ROW EXECUTE FUNCTION enforce_studio_slug_namespace();

CREATE TRIGGER episodes_slug_namespace_guard
  BEFORE INSERT OR UPDATE OF id ON episodes
  FOR EACH ROW EXECUTE FUNCTION enforce_episode_slug_namespace();
CREATE TRIGGER episode_aliases_slug_namespace_guard
  BEFORE INSERT OR UPDATE OF alias ON episode_slug_aliases
  FOR EACH ROW EXECUTE FUNCTION enforce_episode_slug_namespace();

-- Cada función bloquea su namespace, valida y ejecuta UPDATE + alias como una sola transacción.
-- Si cualquier constraint o INSERT falla, PostgreSQL revierte también el cambio de PK y sus cascadas.
CREATE FUNCTION dubverse_rename_project_slug(p_current_id text, p_new_id text) RETURNS text LANGUAGE plpgsql AS $function$
BEGIN
  IF p_new_id IS NULL OR char_length(p_new_id) > 160 OR p_new_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR p_new_id = p_current_id THEN
    RAISE EXCEPTION 'El nuevo ID de proyecto no tiene un formato válido o no representa un cambio.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dubverse:project-slugs', 0));
  PERFORM 1 FROM projects WHERE id = p_current_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El proyecto con ID % no existe.', p_current_id USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM projects WHERE id = p_new_id) THEN
    RAISE EXCEPTION 'El ID de proyecto % ya está vigente.', p_new_id USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM project_slug_aliases WHERE alias = p_new_id) THEN
    RAISE EXCEPTION 'El ID de proyecto % está reservado como alias.', p_new_id USING ERRCODE = '23505';
  END IF;
  UPDATE projects SET id = p_new_id, updated_at = now() WHERE id = p_current_id;
  INSERT INTO project_slug_aliases (alias, project_id) VALUES (p_current_id, p_new_id);
  RETURN p_new_id;
END
$function$;

CREATE FUNCTION dubverse_rename_studio_slug(p_current_id text, p_new_id text) RETURNS text LANGUAGE plpgsql AS $function$
BEGIN
  IF p_new_id IS NULL OR char_length(p_new_id) > 160 OR p_new_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR p_new_id = p_current_id THEN
    RAISE EXCEPTION 'El nuevo ID de estudio no tiene un formato válido o no representa un cambio.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dubverse:studio-slugs', 0));
  PERFORM 1 FROM studios WHERE id = p_current_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El estudio con ID % no existe.', p_current_id USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM studios WHERE id = p_new_id) THEN
    RAISE EXCEPTION 'El ID de estudio % ya está vigente.', p_new_id USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM studio_slug_aliases WHERE alias = p_new_id) THEN
    RAISE EXCEPTION 'El ID de estudio % está reservado como alias.', p_new_id USING ERRCODE = '23505';
  END IF;
  UPDATE studios SET id = p_new_id, updated_at = now() WHERE id = p_current_id;
  INSERT INTO studio_slug_aliases (alias, studio_id) VALUES (p_current_id, p_new_id);
  RETURN p_new_id;
END
$function$;

CREATE FUNCTION dubverse_rename_episode_slug(p_current_id text, p_new_id text) RETURNS text LANGUAGE plpgsql AS $function$
BEGIN
  IF p_new_id IS NULL OR char_length(p_new_id) > 160 OR p_new_id !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR p_new_id = p_current_id THEN
    RAISE EXCEPTION 'El nuevo ID de episodio no tiene un formato válido o no representa un cambio.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dubverse:episode-slugs', 0));
  PERFORM 1 FROM episodes WHERE id = p_current_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El episodio con ID % no existe.', p_current_id USING ERRCODE = 'P0002'; END IF;
  IF EXISTS (SELECT 1 FROM episodes WHERE id = p_new_id) THEN
    RAISE EXCEPTION 'El ID de episodio % ya está vigente.', p_new_id USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM episode_slug_aliases WHERE alias = p_new_id) THEN
    RAISE EXCEPTION 'El ID de episodio % está reservado como alias.', p_new_id USING ERRCODE = '23505';
  END IF;
  UPDATE episodes SET id = p_new_id, updated_at = now() WHERE id = p_current_id;
  INSERT INTO episode_slug_aliases (alias, episode_id) VALUES (p_current_id, p_new_id);
  RETURN p_new_id;
END
$function$;

COMMENT ON TABLE project_slug_aliases IS 'Historial de IDs públicos anteriores de proyectos.';
COMMENT ON TABLE studio_slug_aliases IS 'Historial de IDs públicos anteriores de estudios.';
COMMENT ON TABLE episode_slug_aliases IS 'Historial de IDs públicos anteriores de episodios.';

COMMIT;
