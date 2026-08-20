# ARCHIVE_NATIVE_VERIFIED (propuesta, no aplicada)

El modo activo continúa siendo `ARCHIVE_EMBED`: usa el iframe oficial y no inventa progreso exacto. La resolución canónica se valida mediante la inspección administrativa y queda persistida en `episodes.archive_file` y `episodes.video_url`; el playback normal no consulta metadata remota.

El esquema actual no tiene un lugar correcto para guardar evidencia de que una fuente nativa fue verificada. Antes de habilitarla se propone una migración aditiva con `archive_playback_mode` (`ARCHIVE_EMBED` por defecto o `ARCHIVE_NATIVE_VERIFIED`), `archive_native_url`, `archive_native_verified_at` y `archive_native_verification jsonb`. El JSON debe registrar el `orig`, derivado elegido, Content-Type, CORS, Range Requests, tamaño, metadata y resultado de una prueba de seek.

Sólo una herramienta administrativa o de mantenimiento podría marcar el modo verificado. En ese modo `DubversePlayer` usaría `<video>`, `watch_progress` y restauración de `currentTime`, con un único fallback al iframe si el arranque falla. No debe haber selección remota en caliente, retries adicionales ni activación masiva. Esta tarea no incluye ni ejecuta esa migración.
