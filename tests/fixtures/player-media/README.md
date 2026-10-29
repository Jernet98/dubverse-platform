# Medios de prueba del reproductor

Video y tono sintéticos de 24 segundos, generados con FFmpeg; no contienen contenido de terceros ni requieren conectarse a Archive.org.

`episode.mp4` y los segmentos `segment-*` son H.264/AAC, 320×180. Los segmentos `high-segment-*` son una segunda representación de 640×360. `master.m3u8` declara ambas variantes; las listas son VOD y utilizan MP4 fragmentado. `captions.vtt` es una pista de prueba en español.

Para regenerarlos, desde la raíz del repositorio con FFmpeg disponible:

```sh
ffmpeg -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 24 -c:v libx264 -preset veryfast -crf 32 -pix_fmt yuv420p -g 48 -c:a aac -b:a 32k -movflags +faststart tests/fixtures/player-media/episode.mp4
ffmpeg -i tests/fixtures/player-media/episode.mp4 -c copy -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_segment_filename tests/fixtures/player-media/segment-%02d.m4s tests/fixtures/player-media/low.m3u8
ffmpeg -i tests/fixtures/player-media/episode.mp4 -vf scale=640:360 -c:v libx264 -preset veryfast -crf 32 -g 48 -c:a copy -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_fmp4_init_filename high-init.mp4 -hls_segment_filename tests/fixtures/player-media/high-segment-%02d.m4s tests/fixtures/player-media/high.m3u8
```

FFmpeg es necesario únicamente para regenerar estos archivos, no para ejecutar las pruebas ni para reproducir episodios.
