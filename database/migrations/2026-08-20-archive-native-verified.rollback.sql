-- Ejecutar sólo después de volver a desplegar una versión que no lea estas columnas.
BEGIN;

DROP INDEX IF EXISTS episodes_archive_playback_mode_idx;
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_archive_native_consistency_check;
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_archive_native_url_check;
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_archive_native_status_check;
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_archive_playback_mode_check;
ALTER TABLE episodes
  DROP COLUMN IF EXISTS archive_native_verification,
  DROP COLUMN IF EXISTS archive_native_verified_at,
  DROP COLUMN IF EXISTS archive_native_url,
  DROP COLUMN IF EXISTS archive_native_status,
  DROP COLUMN IF EXISTS archive_playback_mode;

COMMIT;
