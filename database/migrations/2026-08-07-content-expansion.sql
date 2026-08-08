-- Migración aditiva para la primera ampliación de contenido de Dubverse.
-- No ejecuta seed, no cambia IDs y no modifica registros existentes.
BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_director text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS dubbing_info text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS credits text NOT NULL DEFAULT '';

DO $migration$
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
$migration$;

COMMIT;
