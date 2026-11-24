# Revisión final del reproductor y auditoría pública ampliada

Fecha local: 24 de noviembre de 2026, México. Rama: `codex/fix-archive-video-decoding`. Base de `main`: `8b6d6b93d3836eb7e93cd5e32bbe18dabf688926`.

Revisión: [Pull Request #5, en borrador](https://github.com/Jernet98/dubverse-platform/pull/5). Prueba independiente: [laboratorio HTTPS temporal](https://exclusively-shower-confident-easy.trycloudflare.com), disponible mientras este equipo y su túnel estén abiertos.

La solución requiere dos entregas: corregir la selección/recuperación del reproductor y disponer de archivos compatibles. El código, el laboratorio y el procedimiento de preparación están en esta rama. La publicación de copias completas, las correcciones de fuentes y el despliegue siguen pendientes de autorización. El incidente no se considera cerrado por aprobar las pruebas automatizadas.

## Comprobaciones en teléfonos reales

El propietario probó el laboratorio HTTPS desde un **Infinix Note 50 Pro con Chrome** y un **iPhone con Safari**. Son resultados comunicados por el propietario; las pruebas automatizadas de tamaños móviles siguen siendo emulación en Chrome de Windows.

- Infinix, Black Butler E1/E4: aparece el mensaje de que hace falta una copia compatible. El navegador rechaza la única variante HEVC Main 10 antes de solicitar ese MP4. No hay una variante H.264 a la que cambiar automáticamente.
- iPhone, Black Butler E1: el diagnóstico recibido declara `supported: true`, `smooth: false`, `readyState: 4`, `paused: false`, tiempo **0**, un fotograma total, dos callbacks y ningún error multimedia, varios minutos después de iniciar. El UA recibido contiene `iPhone OS 18_7` y `Version/27.2`; no se deduce de él un modelo de iPhone.

Este segundo caso confirma un hueco adicional: el reloj puede quedar detenido aunque se haya emitido `playing`. El monitor anterior requería avance de tiempo y no detectaba ese estado. Se añadió una comprobación de progreso con límite de 20 segundos. Los datos no permiten atribuir por sí solos ese bloqueo a Archive, GPU o decodificador.

La comprobación física de la nueva recuperación y de las copias H.264 figura en el registro de pruebas. Las versiones completas requieren una nueva revisión de reproducción, color, audio y continuidad antes de publicarse.

## Alcance de la auditoría

Se consultaron las APIs públicas de los **58 proyectos y 265 episodios**. Hay 264 episodios Archive y uno Pixeldrain. Los episodios Archive resolubles reúnen **431 URLs MP4 únicas**; ocho referencias adicionales son repeticiones entre registros de episodios. Se obtuvo una descripción de códec para las 431 URLs mediante metadatos MP4 acotados o evidencia anterior con MD5/tamaño iguales en los metadatos consultados de nuevo. No quedan familias de códec desconocidas en esas variantes.

El [registro completo](player-catalog-audit-2026-11-24.json) conserva cada archivo exacto, perfil, nivel, bits cuando se pudieron verificar, dimensiones, FPS disponibles, respuesta Range y procedencia de la evidencia. No todos los archivos contienen sus tablas completas de tiempos en los primeros KiB; un FPS ausente queda desconocido. `ffprobe` verificó además los once originales VP9 de PUPA, el H.264 High 10 de Under the Dog y un HEVC Main de 8 bits. La auditoría anterior ya incluye `ffprobe` de los cinco HEVC de Black Butler/Mikadono.

Las lecturas del catálogo son de metadatos y rangos acotados. No se descargaron capítulos completos. Los fragmentos de prueba se prepararon con un presupuesto separado de 16 MiB de lectura por original.

### Códecs y calidades que necesitan atención

- **35 registros de episodio** apuntan a HEVC: 34 Main 10 y uno Main de 8 bits. Son 32 archivos HEVC distintos, porque tres capítulos de Mao repiten el archivo del anterior. HEVC no se prohíbe globalmente: se conserva cuando el dispositivo declara soporte y puede reproducirlo.
- **Under the Dog E1**: AVC/H.264 **High 10**, 1080p, `avc1.6E0028`, `yuv420p10le`; dispone de un derivado H.264 de 480p. Un MP4 H.264 también puede necesitar una alternativa de 8 bits.
- **PUPA E1–E11**: originales **VP9 Profile 0 en MP4**, 720p, `vp09.00.31.08`, con derivados H.264 de 480p. Se añadió lectura `vpcC` para consultar compatibilidad real y no tratar estos MP4 como AVC desconocido.
- **A Pizza Me!**: original AVC High nivel 5.1, 3840×2158, aproximadamente 43,9 Mbps calculados a partir de tamaño/duración. Se conserva para dispositivos/conexiones capaces. Una copia hasta 1080p permitiría evitar saltar directamente a 480p cuando ese original no es adecuado.
- Otros archivos AVC tienen niveles 5.0/5.1, cadencias elevadas o FPS todavía no medidos. Son candidatos a revisión física, no fallos confirmados ni órdenes automáticas de recodificación.

HEVC fuera de Black Butler/Mikadono aparece en Aiura E2, Blend S E1, Bloom Into You E2, los dos arcos de Danganronpa 3 E1, Dororo E24, Eureka Seven E1, Grendizer U E1, Kinsou no Vermeil E8, varios capítulos de Mao, Mebius Dust E1, Nazo no Kanojo X E5, Uruwashi E5, Watashi o Tabetai E1 y Winx T8 E1. El JSON conserva la correspondencia y los perfiles exactos; Kinsou E8 es el caso Main de 8 bits.

### Fuentes incorrectas y no disponibles

Se confirmaron cinco asignaciones que apuntan al archivo de otro capítulo, aunque Archive enumera el archivo correspondiente:

| Registro | Archivo configurado | Archivo propuesto en el mismo item |
| --- | --- | --- |
| Mao E18 | `dubverse-mao-2026-s01-e017.mp4` | `dubverse-mao-2026-s01-e018.mp4` |
| Mao E20 | `dubverse-mao-2026-s01-e019.mp4` | `dubverse-mao-2026-s01-e020.mp4` |
| Mao E22 | `dubverse-mao-2026-s01-e021.mp4` | `dubverse-mao-2026-s01-e022.mp4` |
| Uma Musume E2 | `dubverse-uma-musume-pretty-derby-s01-e001.mp4` | `dubverse-uma-musume-pretty-derby-s01-e002.mp4` |
| Uma Musume E3 | `dubverse-uma-musume-pretty-derby-s01-e001.mp4` | `dubverse-uma-musume-pretty-derby-s01-e003.mp4` |

El [plan de corrección](player-source-corrections-2026-11-24.json) contiene item, nombre exacto y MD5 comprobado. La revisión del contenido y el cambio de los registros publicados requieren autorización. No se adivina el capítulo a partir del primer archivo de un item compartido.

No hubo lista pública de video resuelta para Bananya E1, Dragon Ball Super: Beerus E1/E2/E3 e IDOLiSH7 E1/E2. Eso no demuestra corrupción ni permite asegurar que el archivo esté eliminado: hay que revisar disponibilidad/permisos con el propietario. Sugar Apple Fairy Tale E2, alojado en Pixeldrain, respondió **404** en su URL multimedia. Estos siete episodios necesitan restaurar o aportar una fuente autorizada. El código no puede generar video a partir de una fuente ausente.

## Funcionamiento de la corrección

1. `lib/media-probe.js` lee `avcC`, SPS, `hvcC` y `vpcC`. Distingue AVC de 8/10 bits, HEVC y VP9. Normalmente usa 4 KiB; si faltan los tiempos, puede ampliar a 16 KiB. Conserva el códec ya verificado si falla esa ampliación. Siguen vigentes los límites de tiempo, seis peticiones y 2 MiB de `moov`; rechaza servidores que ignoren Range.
2. Auto consulta `canPlayType()` y, con datos suficientes, `MediaCapabilities.decodingInfo()`. Excluye rechazos explícitos y prefiere opciones fluidas dentro de la estimación de conexión. No bloquea las resoluciones altas por nombre de códec ni por `powerEfficient: false`.
3. El monitor de fotogramas detecta tiempo avanzando sin nuevas imágenes. El nuevo monitor del reloj detecta carga o reproducción sin avance durante **20 segundos visibles de intención de reproducir**, incluido `readyState: 4`/`playing`. Pausa, background, PiP y AirPlay no consumen ese presupuesto. El monitor del reloj se aplica también a video directo fuera de Archive; HLS conserva su recuperación propia.
4. Auto marca una fuente fallida y prueba otra compatible del mismo episodio una sola vez por instancia. Conserva posición, volumen, silencio, velocidad y el mismo elemento de video. Una calidad manual no se sustituye silenciosamente. Agotar alternativas detiene el audio y muestra un error persistente con acciones explícitas.
5. El iframe sigue disponible como alternativa elegida por el visitante. No se presenta como prueba de compatibilidad: Archive puede utilizar el mismo original HEVC. Entrar al iframe cancela los monitores y retira los avisos anteriores.
6. `public/app.js` presenta un error cuando el resolver devuelve `UNRESOLVED`; no deja que el caso conocido sin fuentes pase automáticamente al iframe. **Reintentar** puede reconsultar la API una vez, con límite de 20 segundos y sin crear otra sesión de Analytics ni otra vista del episodio.
7. El adaptador controla las promesas de los botones de reproducción. Cambiar una fuente cuyo `play()` aún está pendiente puede producir `AbortError`; se maneja dentro del adaptador, sin rechazos globales de ArtPlayer.

Las escenas oscuras conservan fotogramas y no disparan recuperación por brillo. El monitor no lee píxeles. Estas señales no acreditan por sí solas sincronía, color correcto ni todos los defectos de GPU; por eso hay pruebas visuales en teléfonos.

## Archivos y validación

| Archivo | Cambio |
| --- | --- |
| `public/player.js` | Compatibilidad, recuperación de imagen/reloj, errores persistentes, promesas de reproducción y reconsulta de fuentes. |
| `public/app.js` | Manejar fuentes no resueltas y mantener los mismos callbacks de Analytics/progreso. |
| `lib/media-probe.js`, `lib/archive.js` | Metadatos verificados, caché y asociación explícita de copias del mismo episodio. |
| `config/archive-compatible-variants.js` | Cinco entradas iniciales desactivadas; exigir MD5 tanto del original como de la copia. |
| `public/styles.css` | Avisos relacionados con el fallo y error desplazable en pantallas pequeñas. |
| `scripts/audit-player-media.mjs`, `scripts/lib/audit-fetch.mjs` | Auditoría pública con límites, reanudación y verificación de MD5 antes de reutilizar evidencia. |
| `scripts/plan-compatible-media.mjs`, `scripts/prepare-compatible-media.mjs` | Plan del catálogo y preparación local; no incluyen publicación ni escrituras en base de datos. |
| `scripts/preview-player.mjs`, `preview/player/` | Laboratorio aislado y diagnóstico legible/exportable en el teléfono. |
| Pruebas y nuevas cabeceras `.header` | AVC High 10, VP9, carga pendiente, reloj detenido, controles y sesiones. |
| `vercel.json` | Impedir el despliegue automático de esta rama de revisión; el laboratorio es independiente. |

- `npm test`: **170/170** aprobadas.
- `npm run build`: compilación de producción correcta.
- `npm run test:player:browser`: **60/60** aprobadas en escritorio, Android, iPhone y tablet emulados en Chrome de Windows. Incluyen MP4/HLS, iframe, calidades, carga que nunca responde, imagen sin fotogramas, reloj detenido, progreso, Analytics y navegación.
- Dos fragmentos reales H.264 de Black Butler E1/E4: **1080p**, aproximadamente cinco segundos de reproducción observada, 153–154 fotogramas y sin error en Chrome de Windows a través del laboratorio HTTPS.

También se probó la preparación por lotes con un clip sintético HEVC de 10 bits: salieron cinco copias H.264 de 8 bits, sin sobrescribir entradas ni salidas existentes. Esos cinco archivos sintéticos no son capítulos de DUBVERSE.

No se modificaron Neon, R2, cuentas, metadatos publicados ni archivos de Archive. Se conserva fuera del commit `lib/.vscode/settings.json`, que ya existía antes del trabajo.

## Preparar e incorporar copias completas

El [manifiesto de preparación](compatible-media-plan-2026-11-24.json) propone **31 copias** para cubrir diferencias de compatibilidad a la resolución disponible: 19 de originales HEVC, 11 VP9 y una AVC High 10. Incluye aparte **44 revisiones** de nivel/FPS/metadatos, que no se ejecutan como trabajos de conversión. Doce registros quedan bloqueados por las cinco asignaciones incorrectas y las siete fuentes no disponibles. Los otros 178 tienen una variante AVC de 8 bits que satisface el criterio técnico conservador del plan; esto no equivale a certificación en todos los teléfonos.

### Preparación local

1. Confirmar autorización y reunir los originales exactos en `<carpeta>/<identifier>/<original>`. El manifiesto contiene los nombres y hashes. Los archivos no disponibles deben aportarse o restaurarse antes; los mal asignados deben revisarse antes de decidir su conversión.
2. Revisar el plan sin convertir:

```powershell
node scripts/prepare-compatible-media.mjs --manifest docs/compatible-media-plan-2026-11-24.json
```

3. Para una conversión local explícitamente aprobada, ejecutar con las rutas reales de archivos y herramientas:

```powershell
node scripts/prepare-compatible-media.mjs --manifest docs/compatible-media-plan-2026-11-24.json --source-root C:/DUBVERSE-media/originales --output-root C:/DUBVERSE-media/compatibles --ffmpeg C:/herramientas/ffmpeg.exe --ffprobe C:/herramientas/ffprobe.exe --encode
```

El script verifica todos los inputs y sus MD5 antes de empezar. Genera AVC High nivel 4.1, `yuv420p` de 8 bits, AAC estéreo y `faststart`, hasta 1920×1080 sin aumentar la resolución original, con aspecto correcto y hasta 30 fps. Las copias de fuentes de 720p permanecen en 720p; un original de 60/120 fps se conserva junto a la copia de hasta 30 fps. El codificador actual exige FPS de entrada comprobable y como máximo 60; un archivo de 120 fps requiere revisión y una adaptación aprobada antes de entrar al lote.

Se detiene ante HDR, subtítulos embebidos o color SDR desconocido. `--assume-sdr` sólo procede después de revisar material con metadatos de color ausentes; no elude el bloqueo HDR. El informe de salida incluye `ffprobe`, duración y MD5. Se verifica imagen, color, sincronía, subtítulos y reproducción prolongada. La recodificación tiene pérdida y puede aumentar el tamaño; los originales se conservan.

### Publicación posterior, con autorización

4. Añadir cada copia al **mismo item de Archive con un nombre nuevo**. Ejemplos preparados: `bb-s01-e001-h264-1080p.mp4` y `bb-s01-e004-h264-1080p.mp4` dentro de `1-el-mayordomo-a-su-servicio`. No reutilizar los nombres de los originales. El CLI oficial permite subir archivos a un identificador existente; un ejemplo para el propietario autenticado sería:

```sh
ia upload 1-el-mayordomo-a-su-servicio bb-s01-e001-h264-1080p.mp4
```

Este comando de publicación no se ha ejecutado. La sintaxis procede de la [documentación oficial de Archive](https://archive.org/developers/internetarchive/cli.html#upload). No se falsifica `original` ni se renombra una copia como `.ia.mp4` para simular un derivado.

5. Consultar los metadatos y comprobar nombre, tamaño, MD5 de la copia y MD5 intacto del original. Una subida separada aparece como otro original de Archive: el resolver no debe asociarla automáticamente por similitud de nombres.
6. Incorporar la entrada revisada del manifiesto a `config/archive-compatible-variants.js`, rellenar el MD5 real de la copia y habilitarla **después de su prueba y de aprobar ese cambio**. El código exige coincidencia de episodio, item, original, ambos hashes y duración con diferencia máxima de un segundo. Un fragmento de prueba no puede activarse como variante de un capítulo completo. Esperar a que Archive exponga la duración de la copia antes de habilitarla. Mantener `archive_file` apuntando al original permite conservar HEVC/4K junto con la copia H.264 sin migrar ni escribir el esquema de Neon.
7. Probar en el entorno independiente y en los dos teléfonos. Revisar el commit de activación y autorizar el despliegue por separado. Las fuentes erróneas tienen su propio plan de corrección de datos; no se ocultan mediante la lista de copias.

Referencias técnicas: [parámetros de códec](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/codecs_parameter), [VP9 en MP4](https://www.webmproject.org/vp9/mp4/), [FFmpeg](https://ffmpeg.org/ffmpeg.html), [MediaCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo).

## Probar desde el celular

El laboratorio sirve sólo una lista explícita de recursos públicos y, opcionalmente, dos fragmentos locales. No monta Next, `.env`, APIs de cuenta, escritura ni Analytics de producción. Los diagnósticos se quedan en el navegador hasta que el propietario decide copiarlos o descargarlos.

```powershell
node scripts/prepare-player-samples.mjs --prepare --ffmpeg C:/herramientas/ffmpeg.exe --ffprobe C:/herramientas/ffprobe.exe
node scripts/preview-player.mjs --samples --port 4173
```

La preparación de muestras sólo lee rangos de dos originales, con un máximo de 16 MiB por archivo y fragmentos de 12 segundos. La ejecución de esta revisión leyó 3.878.930 y 3.977.234 bytes respectivamente. Los MP4 locales y las herramientas descargadas están ignorados por Git; para clonar el PR y usar `--samples` hay que prepararlos o usar la URL de prueba activa.

Un túnel HTTPS temporal permite probar MediaCapabilities desde el teléfono. No cambia la configuración del sitio de producción. La URL de la sesión y los resultados físicos se entregan en el PR/chat; el equipo debe permanecer encendido y el servidor/túnel abiertos. Para un alojamiento duradero, exportar con `--export` y alojar únicamente esa carpeta estática en un proyecto independiente sin variables de producción.

En Infinix/Chrome y iPhone/Safari:

1. Probar Auto en Black Butler E1/E4 y Mikadono E1/E2/E3, con la imagen visible al menos 45 segundos. Black Butler E1 contiene imagen negra al principio; comprobar también después de 30 segundos.
2. Probar los fragmentos **H.264 1080p de 12 segundos**. Deben mostrar `avc1.640029`, 8 bits y 1920×1080. Son una comparación de codificación con contenido real; no certifican un capítulo completo ni sustituyen la publicación pendiente.
3. Confirmar que el tiempo avanza, hay imagen y audio sincronizados; después probar pausa/reanudación, búsqueda, orientación, pantalla completa y background/reactivación.
4. Marcar el resultado visual y usar **Copiar resumen** o **Descargar diagnóstico**. El informe recoge UA, códec, calidad, soporte declarado, fotogramas, buffers, estado de búsqueda y eventos. Un contador que avance no prueba por sí solo la imagen.

Quedan pendientes la reproducción prolongada de las copias completas, la validación de todos los archivos propuestos y las operaciones de publicación/datos/despliegue autorizadas. La conectividad del 23 de noviembre impidió mediciones; el registro incompleto de esa fecha se conserva y queda superado por esta consulta del catálogo del día 24.
