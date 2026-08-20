-- Persistencia aditiva para fuentes Archive verificadas fuera del playback.
-- Debe ejecutarse antes de desplegar el código que lee estas columnas.
BEGIN;

ALTER TABLE episodes
  ADD COLUMN IF NOT EXISTS archive_playback_mode text NOT NULL DEFAULT 'ARCHIVE_EMBED',
  ADD COLUMN IF NOT EXISTS archive_native_status text NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS archive_native_url text,
  ADD COLUMN IF NOT EXISTS archive_native_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_native_verification jsonb;

ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_archive_playback_mode_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_archive_playback_mode_check
  CHECK (archive_playback_mode IN ('ARCHIVE_EMBED','ARCHIVE_NATIVE_VERIFIED'));
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_archive_native_status_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_archive_native_status_check
  CHECK (archive_native_status IN ('UNVERIFIED','NATIVE_OK','EMBED_ONLY','INVALID'));
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_archive_native_consistency_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_archive_native_consistency_check CHECK (
  (archive_playback_mode = 'ARCHIVE_NATIVE_VERIFIED') = (archive_native_status = 'NATIVE_OK')
  AND (archive_playback_mode <> 'ARCHIVE_NATIVE_VERIFIED'
    OR (provider = 'ARCHIVE' AND archive_native_url IS NOT NULL
      AND archive_native_verified_at IS NOT NULL AND archive_native_verification IS NOT NULL))
);
ALTER TABLE episodes DROP CONSTRAINT IF EXISTS episodes_archive_native_url_check;
ALTER TABLE episodes ADD CONSTRAINT episodes_archive_native_url_check CHECK (
  archive_native_url IS NULL
  OR (archive_identifier IS NOT NULL
    AND position('https://archive.org/download/' || archive_identifier || '/' IN archive_native_url) = 1
    AND archive_native_url ~ '^https://archive[.]org/download/[A-Za-z0-9][A-Za-z0-9._-]{0,99}/[^?#]+$')
);

CREATE INDEX IF NOT EXISTS episodes_archive_playback_mode_idx ON episodes(archive_playback_mode)
  WHERE provider = 'ARCHIVE' AND published = true AND deleted_at IS NULL;

COMMIT;
