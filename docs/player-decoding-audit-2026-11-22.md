# Auditoría y corrección de reproducción sin imagen

Fecha: 22 de noviembre de 2026, hora de México. Rama de revisión: `codex/fix-archive-video-decoding`. Base: `8b6d6b93d3836eb7e93cd5e32bbe18dabf688926`.

Las dos instantáneas públicas revisadas incluyen siete episodios y diez variantes. Cinco originales usan HEVC Main 10 de 10 bits; tres de ellos tienen derivados H.264 de 480p. El reproductor anterior no consultaba compatibilidad de decodificación ni recuperaba una fuente cuando el tiempo avanzaba sin fotogramas nuevos. Ambas carencias están corregidas. La relación entre HEVC y el fallo concreto de los móviles sigue siendo una hipótesis: las muestras disponibles de Chrome de Windows registraron fotogramas correctamente.

## Hallazgos confirmados y causas pendientes

`chooseInitialVariant()` seleccionaba por conexión, tamaño y bitrate; `MPEG4` se trataba como una fuente directa sin distinguir H.264 de HEVC. `handleStall()` comprobaba datos cargados y `handleMediaError()` requería un error explícito. Ninguna de esas rutas detectaba tiempo avanzando con cero fotogramas. Además, un error de una calidad elegida manualmente podía sustituirla automáticamente.

Los originales de Black Butler E1/E2/E3/E4 y Mikadono E3 son HEVC Main 10, 1920×1080, 30 fps y `yuv420p10le`. Los tres derivados disponibles son H.264 Main, 854×480, 30 fps y `yuv420p`. La diferencia de perfil/profundidad de bits exige comprobar soporte por dispositivo; el contenedor MP4 y el bitrate no bastan. Que cambiar a 480p resuelva el síntoma es compatible con esta hipótesis, pero también recarga el decodificador y por sí solo no prueba su causa.

Mikadono E1 y E2 son H.264 Main de 8 bits a 1080p y carecen de una segunda variante MP4 en el item público consultado. No hay evidencia para atribuirles el mismo problema HEVC ni para ofrecerles un derivado perteneciente a otro episodio.

En Chrome **157.0.8103.79 sobre Windows**, los ocho archivos de la primera instantánea avanzaron aproximadamente 4,96 segundos y registraron 150 callbacks de fotogramas por muestra, sin error multimedia. `canPlayType()` y `MediaCapabilities` declararon soporte; esta máquina admite también los originales HEVC. No se reprodujo aquí el fallo intermitente. Esta prueba nativa utiliza un `<video>` sin ArtPlayer, con audio silenciado, y no ejecuta Analytics ni inicia sesión en Dubverse. No es una prueba de Android ni Safari físicos ni una reproducción completa de cada capítulo.

La primera consulta incluía Black Butler E2/E3 y Mikadono E1/E2/E3. En la segunda instantánea de la API también aparecieron Black Butler E1/E4; se añadieron a la inspección con `ffprobe` y a la prueba de ArtPlayer. Las instantáneas quedan identificadas en el JSON; no se atribuye la diferencia a una causa sin verificarla.

La página real de episodios se probó además en un servidor local de producción con **ArtPlayer 5.4.0**, la configuración pública y los archivos reales de Archive. Se interceptaron todas las APIs de estadísticas y sesión. Los siete episodios avanzaron unos 5,1 segundos con 153–154 callbacks y sin errores JavaScript/multimedia; cada uno generó localmente una vista y un inicio de reproducción, sin enviar esos eventos a producción. Auto seleccionó 1080p en Black Butler E1/E4 y Mikadono E1/E2, y 480p en Black Butler E2/E3 y Mikadono E3. Estas selecciones no equivalen a una medición de ancho de banda ni a pruebas físicas móviles.

Se inspeccionaron visualmente capturas de Mikadono E3 a los 5 segundos y de Black Butler E1 a los 35 segundos: ambas mostraron imagen. Black Butler E1 tiene un fotograma negro en torno a 5,12 segundos, también presente al extraerlo directamente con FFmpeg; al buscar a 30 segundos y reproducir hasta 35 segundos mostró imagen a 1080p, sin cambiar de fuente ni duplicar el inicio de Analytics. Esta comprobación evita confundir ese fotograma negro del contenido con un fallo de decodificación.

## Episodios y variantes verificadas

Los enlaces se obtuvieron de la configuración pública de cada episodio, no de una búsqueda por nombre. `ffprobe` terminó con código 0 para las diez variantes. Todas contienen audio AAC LC. Las tasas de la tabla son las tasas medias de vídeo de `ffprobe`, en Mbps decimales; los vídeos declaran 30 fps y 4:2:0.

| Episodio | Item de Archive | Archivo original exacto | Original | Derivado del mismo original |
| --- | --- | --- | --- | --- |
| Black Butler T1 E1 | [`1-el-mayordomo-a-su-servicio`](https://archive.org/metadata/1-el-mayordomo-a-su-servicio) | `1 El Mayordomo, A Su Servicio.mp4` | HEVC Main 10, nivel 4.0, 1080p, 10 bits, 1,416 Mbps | Sin otro MP4 resuelto para este episodio |
| Black Butler T1 E2 | [`amen-67`](https://archive.org/metadata/amen-67) | `Amen67.mp4` | HEVC Main 10, nivel 4.0, 1080p, 10 bits, 1,319 Mbps | `Amen67.ia.mp4`: H.264 Main, nivel 3.0, 480p, 8 bits, 0,692 Mbps |
| Black Butler T1 E3 | [`dubverse-black-butler-book-of-circus-s01-e003`](https://archive.org/metadata/dubverse-black-butler-book-of-circus-s01-e003) | `dubverse-black-butler-book-of-circus-s01-e003.mp4` | HEVC Main 10, nivel 4.0, 1080p, 10 bits, 1,523 Mbps | `dubverse-black-butler-book-of-circus-s01-e003.ia.mp4`: H.264 Main, nivel 3.0, 480p, 8 bits, 0,690 Mbps |
| Black Butler T1 E4 | Mismo item que E1 | `4 El Mayordomo, Compañero.mp4` | HEVC Main 10, nivel 4.0, 1080p, 10 bits, 1,308 Mbps | Sin otro MP4 resuelto para este episodio |
| Mikadono T1 E1 | [`dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e001-e002`](https://archive.org/metadata/dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e001-e002) | `dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e001.mp4` | H.264 Main, nivel 4.0, 1080p, 8 bits, 0,903 Mbps | Sin otro MP4 publicado para este episodio |
| Mikadono T1 E2 | Mismo item que E1 | `dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e002.mp4` | H.264 Main, nivel 4.0, 1080p, 8 bits, 1,060 Mbps | Sin otro MP4 publicado para este episodio |
| Mikadono T1 E3 | [`dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e003`](https://archive.org/metadata/dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e003) | `dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e003.mp4` | HEVC Main 10, nivel 4.0, 1080p, 10 bits, 1,608 Mbps | `dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e003.ia.mp4`: H.264 Main, nivel 3.0, 480p, 8 bits, 0,686 Mbps |

Las peticiones `Range: bytes=0-4095` devolvieron **206** con `Content-Range` coherente en los diez archivos. Los redireccionamientos llevaron a servidores `*.us.archive.org`. En estas respuestas no se recibió `Access-Control-Allow-Origin`; la inspección del códec se realiza en servidor y no necesita leer el MP4 desde JavaScript del navegador. No se observaron 404/416 en estas muestras; esto no garantiza el comportamiento futuro ni el ancho de banda de Archive.

La relación `original` de Archive y el resolver local mantuvieron cada derivado unido a su episodio. Los items compartidos de Mikadono E1/E2 y Black Butler E1/E4 tienen dos entradas cada uno y se conserva el archivo exacto. Los datos completos, URLs, hashes MD5, perfiles, bitrate, FPS, respuestas HTTP y resultados de reproducción están en [el registro JSON](player-media-audit-2026-11-22.json). Los valores de `level` son los enteros de FFmpeg: HEVC 120 corresponde a nivel 4.0; H.264 30/40, a 3.0/4.0.

## Funcionamiento de Automático y recuperación

1. El servidor lee cajas MP4 `avcC`/`hvcC` y tiempos `mdhd`/`stts` mediante peticiones Range acotadas. Una petición de **4 KiB** obtuvo perfil, nivel, profundidad y FPS por archivo; una pasada de las ocho variantes iniciales midió entre **233 y 846 ms** por variante. El resultado técnico se añade a la respuesta de reproducción y se cachea; no se modifica Archive ni la base de datos.
2. El navegador consulta el códec exacto con `canPlayType()` y, si dispone de dimensiones, FPS y bitrate, `MediaCapabilities.decodingInfo()`. La consulta de capacidades tiene un límite de 800 ms. Un rechazo explícito excluye esa variante de Auto; la falta de información no la convierte en incompatible.
3. Auto elige la mayor resolución fluida y soportada que cabe en la estimación de conexión. Conserva el ahorro de datos. El indicador `powerEfficient` no elimina una calidad que el dispositivo puede reproducir. No hay una regla que fuerce permanentemente 480p.
4. Durante reproducción Archive se comparan callbacks de presentación y contadores de fotogramas con el tiempo multimedia. Después de un margen inicial de dos segundos, seis segundos de avance sin fotogramas y al menos tres segundos de tiempo multimedia constituyen evidencia para intentar otra variante en Auto, siempre con datos suficientes. Se conservan el elemento de vídeo, posición, volumen, silencio y velocidad. La variante fallida queda excluida de los intentos automáticos de esa instancia.
5. Pausa, búsqueda, cargas, pestaña oculta, vídeo fuera del viewport u oculto por otra interfaz, PiP, AirPlay y contenidos con una cadencia conocida inferior a 1 fps no disparan la recuperación. No se inspecciona brillo ni color: una escena negra codificada sigue presentando fotogramas.
6. Una selección manual no se cambia silenciosamente. Ante un fallo se ofrece **Recuperar imagen** o **Probar otra calidad**; el visitante decide. Si no existen métricas fiables, se ofrece la acción sin adivinar una avería. **Recuperar imagen** también permanece en Ajustes para problemas visuales en los que los contadores siguen avanzando.
7. Cada variante fallida se visita como máximo una vez de forma automática. Agotar opciones ofrece recuperación o el iframe exacto de Archive; no crea una nueva sesión de Analytics. Reintentar expresamente puede volver a probar una fuente. Cambiar de episodio o destruir el reproductor cancela timers y callbacks pendientes.

`requestVideoFrameCallback()` indica presentación y los contadores pueden incluir fotogramas descartados; por eso el monitor contrasta ambas señales y descuenta los descartados/corruptos. Estas APIs no verifican el contenido visible de cada píxel ni todos los fallos de GPU. Referencias: [MediaCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo), [callbacks de fotogramas](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback), [calidad de reproducción](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/getVideoPlaybackQuality).

## Archivos modificados

| Archivo | Motivo |
| --- | --- |
| `lib/media-probe.js` | Leer metadatos técnicos MP4 con límites de tiempo, peticiones y memoria. No requiere FFmpeg en producción. |
| `lib/archive.js` | Enriquecer sólo las variantes del episodio resuelto y cachear su descripción técnica sin persistir cambios. |
| `public/player.js` | Selección compatible, monitor de fotogramas, recuperación acotada, respeto de calidad manual y restauración explícita de volumen/silencio/velocidad. |
| `public/styles.css` | Estilo del aviso de recuperación relacionado con el fallo; conserva el resto de la interfaz. |
| `tests/player-adapter.test.js`, `tests/media-probe.test.js` | Compatibilidad, cabeceras reales, Range, recuperación, falso positivo, bucles, callbacks y destrucción. |
| `tests/browser/player.spec.js` | Probar compatibilidad y ausencia de fotogramas simuladas sobre la página real con medios sintéticos, además de las regresiones existentes. |
| `tests/fixtures/archive-decoding.json`, tres archivos `.header` | Datos públicos de los episodios y cabeceras de 4 KiB reproducibles, sin incluir los vídeos completos. |
| `scripts/audit-player-media.mjs` | Repetir consultas públicas, `ffprobe` opcional y prueba nativa de Chrome sin enviar Analytics reales. |
| `docs/episode-player.md`, este informe y registro JSON | Contrato actualizado, resultados y límites de la auditoría. |

Se conserva `public/app.js`: los callbacks siguen conectados al mismo episodio. No cambian dependencias, cuentas, historial, R2, fuentes persistidas ni archivos en Archive. `lib/.vscode/settings.json` sigue siendo un archivo local ajeno a esta corrección y no se incluye en el commit.

## Pruebas y revisión antes de producción

La base tenía 141 pruebas aprobadas. La corrección añade 20 pruebas unitarias y cuatro escenarios de navegador ejecutados en cada configuración. Los dobles de decodificador/compositor simulan rechazo de HEVC y cero fotogramas mientras un MP4 H.264 sintético sigue avanzando; esos casos comprueban la recuperación, no reproducen un dispositivo móvil real.

- `npm test`: **161/161** aprobadas. Incluye selección de códecs, API ausente/fallida, Range y presupuesto, silencio/volumen/velocidad, posición cerca del final, nivel manual HLS, falsos positivos y prevención de bucles.
- `npm run build`: compilación de producción correcta.
- `npm run test:player:browser`: **44/44** aprobadas en Chrome de Windows, con escritorio, Android, iPhone y tablet emulados. Se mantienen MP4/HLS, subtítulos, controles, iframe, navegación, Analytics y progreso.
- Se repitieron **6/6** casos de recuperación/iframe en escritorio e iPhone emulado tras afinar la ventana de observación y la acción visible.
- Pruebas reales de Archive: diez variantes inspeccionadas con `ffprobe` y Range, ocho muestras de vídeo nativo y siete muestras con ArtPlayer en la página local de episodios.
- `git diff --check`: sin errores.

Quedan pendientes Android y Safari/iPhone físicos, reproducción prolongada, búsqueda a mitad del episodio, suspensión/reactivación y el caso del visitante que reportó el fallo. El iframe automatizado comprueba la URL y liberación de recursos usando una respuesta simulada; no acredita reproducción de un capítulo completo dentro de Archive. No se auditó el resto del catálogo.

## Copias compatibles a 1080p

No se confirmó corrupción de los originales ni necesidad de reemplazarlos en dispositivos que admiten HEVC. Para ampliar compatibilidad sin depender exclusivamente de los tres derivados de 480p, los cinco originales HEVC identificados pueden tener una copia H.264 a 1080p de 8 bits preparada y validada por separado. Black Butler E1/E4 no tienen otra variante MP4 resuelta en la instantánea examinada.

El siguiente ejemplo presupone material SDR; el tratamiento del color debe validarse antes de usarlo:

```sh
ffmpeg -i "original.mp4" -map 0:v:0 -map 0:a:0? -c:v libx264 -profile:v high -level:v 4.1 -pix_fmt yuv420p -preset slow -crf 18 -c:a aac -b:a 160k -movflags +faststart "compatible-1080p.mp4"
ffprobe -v error -show_streams -show_format -of json "compatible-1080p.mp4"
```

Los archivos son `1 El Mayordomo, A Su Servicio.mp4`, `Amen67.mp4`, `dubverse-black-butler-book-of-circus-s01-e003.mp4`, `4 El Mayordomo, Compañero.mp4` y `dubverse-mikadono-sanshimai-wa-angai-choroi-s01-e003.mp4`. Deben comprobarse duración, color, sincronía, subtítulos y visualización en los dispositivos de destino antes de decidir su publicación y vinculación con el episodio. La recodificación es con pérdida y su tamaño puede aumentar. No se ha ejecutado esta recodificación ni se han sustituido o publicado archivos. Mikadono E1/E2 ya usan H.264 Main de 8 bits y no justifican una recodificación por esta hipótesis.

## Repetir la auditoría

```sh
node scripts/audit-player-media.mjs --ffprobe /ruta/a/ffprobe --browser --output .codex-player-audit-report.json
node scripts/audit-player-media.mjs --player-url http://127.0.0.1:3000 --output .codex-player-audit-player.json
npm test
npm run build
npm run test:player:browser
```

`ffprobe` es opcional y se obtiene por separado; `--browser` utiliza Chrome instalado (o `PLAYER_BROWSER_CHANNEL`). `--player-url` requiere un servidor local iniciado con `npm start`; abre la página real de episodios, intercepta todas las APIs de sesión/estadísticas y guarda capturas locales ignoradas por Git. `--episode id1,id2` acota la muestra. El script sólo consulta APIs públicas y fuentes multimedia. La entrega queda en una rama local, sin push, fusión ni despliegue. Para producción sigue siendo necesaria una revisión explícita de esta rama.
