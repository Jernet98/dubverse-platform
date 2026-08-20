# ARCHIVE_NATIVE_VERIFIED (propuesta, no aplicada)

El modo activo continúa siendo `ARCHIVE_EMBED`: usa el iframe oficial y no inventa progreso exacto. La resolución canónica se valida mediante la inspección administrativa y queda persistida en `episodes.archive_file` y `episodes.video_url`; el playback normal no consulta metadata remota.

La migración preparada añade `archive_playback_mode`, `archive_native_status`, `archive_native_url`, `archive_native_verified_at` y `archive_native_verification jsonb`. El JSON registra el `orig`, derivado elegido, Content-Type, modo CORS, Range Requests, tamaño y resultado de una prueba de seek.

`scripts/audit-archive-native.mjs` es READ-ONLY por defecto. Sólo `--execute`, junto con `DATABASE_URL` y después de aplicar la migración, persiste el resultado. En modo verificado `DubversePlayer` usa `<video>`, `watch_progress` y restauración de `currentTime`, con un único fallback automático al iframe si el arranque falla o excede 8 segundos. No hay selección remota en caliente ni retries de playback. La migración no se ejecuta desde la aplicación.
