-- Adapta únicamente los índices de búsqueda al modelo simple title + alternate_title.
-- No modifica datos ni elimina columnas.
BEGIN;

CREATE INDEX IF NOT EXISTS projects_title_search_trgm_idx ON projects USING gin
  ((btrim(regexp_replace(translate(lower(title), 'áéíóúüñ''’', 'aeiouun  '), '\s+', ' ', 'g'))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS projects_alternate_title_search_trgm_idx ON projects USING gin
  ((btrim(regexp_replace(translate(lower(alternate_title), 'áéíóúüñ''’', 'aeiouun  '), '\s+', ' ', 'g'))) gin_trgm_ops);

-- La búsqueda runtime ya no consulta original_title, alternate_titles ni search_aliases.
-- Los índices nuevos existen antes de retirar el índice amplio anterior.
DROP INDEX IF EXISTS projects_search_trgm_idx;

COMMIT;
