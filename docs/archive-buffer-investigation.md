# Investigación de buffering en episodios ARCHIVE

Fecha de observación: 2026-09-23

Rama y revisión inspeccionadas: `main` / `51bf3f4`

Alcance: auditoría de sólo lectura. No se modificó el reproductor, Archive.org ni la base de datos.

## Resumen ejecutivo

- **CONFIRMADO** — El runtime actual intenta reproducir ARCHIVE como `<video>` nativo mediante una URL `https://archive.org/download/...`. El iframe oficial es fallback, no el camino principal, cuando el resolver encuentra una variante.
- **CONFIRMADO** — El `player.js` desplegado es idéntico al local: ambos tienen SHA-256 `66E7A1B1B9CE9DC97725382D10831CE0974967446A7724685C66E2C98EC1BF4A`. La lógica Smart Player está activa en producción.
- **CONFIRMADO** — E002 se atasca también fuera de Dubverse. Un `<video>` nativo sin `DubversePlayer` produjo varios `waiting`; el embed oficial mostró «No se ha podido reproducir el contenido multimedia» en la prueba realizada.
- **CONFIRMADO** — E002 sale por `ia601602.us.archive.org`; una lectura Range de 1 MiB tuvo 6.326 s de TTFB, 13.120 s totales y 79,920 B/s (~0.64 Mbps), por debajo del bitrate estimado del archivo seleccionado (~1.135 Mbps). La entrega observada no podía sostener reproducción en tiempo real.
- **CONFIRMADO** — Dubverse amplifica el arranque lento: `requestPlay()` espera 8 s de buffer, hasta un máximo de 12 s. Si no alcanza la meta, reproduce de todos modos. En E002 inició con sólo ~1.36 s disponibles y volvió a entrar en `waiting`.
- **DESCARTADO para E002** — Selección accidental del primer MP4, cambio automático de calidad, reasignaciones repetidas de `src`, llamadas repetidas a `load()` o rerender causado por Analytics. E002 tiene una sola variante dentro de la familia exacta seleccionada; la traza registró un `src` y un `load()`.
- **MUY PROBABLE** — La causa primaria es la entrega lenta/inestable del item/nodo de Archive de E002. La estrategia de espera de Dubverse es un agravante independiente, no la causa primaria.

## Metodología y límites

Se inspeccionaron el código local y el asset público desplegado, se consultaron endpoints públicos de sólo lectura, metadata pública de Archive y respuestas HTTP Range. Para evitar escribir Analytics/historial en producción, las pruebas de reproducción se hicieron en una página diagnóstica local que cargó el `public/player.js` real con las configuraciones exactas devueltas por la API pública.

La instrumentación temporal registró: asignaciones de `src`, llamadas a `load()`, `readyState`, `networkState`, `currentTime`, todos los rangos `buffered`, `loadstart`, `loadedmetadata`, `durationchange`, `progress`, `suspend`, `canplay`, `canplaythrough`, `playing`, `waiting`, `stalled`, `seeking`, `seeked`, `pause`, `ended` y `error`. La página temporal no forma parte de la entrega.

- **PENDIENTE DE PRUEBA** — Android Chrome, iOS Safari y redes/regiones adicionales. La prueba de navegador se hizo con Chromium en el entorno actual.
- **PENDIENTE DE PRUEBA** — Una sesión continua superior a 60 s para observar una subida automática de calidad en E001/control. El riesgo está confirmado por código, pero no ocurrió en las ventanas observadas.
- **PENDIENTE DE PRUEBA** — Repeticiones estadísticas en varias horas. Archive distribuye entre nodos y los resultados son variables; estas cifras son evidencia puntual, no un SLA.

## Arquitectura real actual

1. `public/app.js::watch(id)` solicita `/api/episodes/{id}`.
2. `app/api/[...path]/route.js` lee `episodes` y, si `provider = 'ARCHIVE'`, llama a `resolveArchiveEpisodePlayback(row)`.
3. `lib/archive.js` consulta server-side `https://archive.org/metadata/{identifier}` con timeout de 6 s y caché en memoria de 10 min.
4. `resolveArchivePlaylist()` agrupa cada original con sus derivados y busca `archive_file` por igualdad exacta, permitiendo únicamente las normalizaciones legadas de percent-encoding y `+` por espacio.
5. `archivePlaybackVariants()` mantiene exclusivamente el original seleccionado y sus derivados. No mezcla otras familias del item.
6. La API devuelve `playback.source`, `playback.variants` y `playback.fallback`.
7. `public/app.js` crea `DubversePlayer` si existe `playback.source.url`; sólo monta el iframe inmediatamente cuando no existe fuente nativa.
8. `public/player.js` crea un `<video playsinline preload="auto">`, asigna `video.src`, llama una vez a `video.load()` y gestiona controles/buffer/calidad.

`playback_url` no existe en el esquema ni en el runtime actual. La persistencia usa `video_url`; la URL nativa se calcula en `playback.source.url`.

### Fallback iframe

- Item con una sola familia audiovisual: `/embed/{identifier}`.
- Item con varias familias: `/embed/{identifier}/{orig-codificado}`.
- No se usa `?orig=` en esta implementación.
- E001 tiene una familia (original + derivado) y usa el embed del item.
- E002 tiene tres originales independientes y el fallback apunta al archivo exacto `-stream.mp4` mediante el path.

## Datos reales observados

### Black Butler E001

- ID Dubverse: `black-butler-book-of-circus-s01-e001`
- `archive_identifier`: `dubverse-black-butler-book-of-circus-s01-e001`
- `archive_file` actual: `dubverse-black-butler-book-of-circus-s01-e001.ia.mp4`
- `video_url`: `https://archive.org/embed/dubverse-black-butler-book-of-circus-s01-e001`
- fuente nativa actual: `https://archive.org/download/dubverse-black-butler-book-of-circus-s01-e001/dubverse-black-butler-book-of-circus-s01-e001.ia.mp4`
- variante derivada: 142,217,939 bytes, 854×480, ~0.771 Mbps.
- original asociado: 292,139,780 bytes, 1920×1080, ~1.584 Mbps.

**CONFIRMADO** — Aunque la descripción inicial mencionaba el original, producción usa hoy el `.ia.mp4`. El resolver reconoce que ese derivado pertenece al original correcto y devuelve ambas variantes de esa misma familia.

### Black Butler E002

- ID Dubverse: `black-butler-book-of-circus-s01-e002`
- `archive_identifier`: `dubverse-black-butler-book-of-circus-s01-e002`
- `archive_file` actual: `dubverse-black-butler-book-of-circus-s01-e002-stream.mp4`
- `video_url`: `https://archive.org/embed/dubverse-black-butler-book-of-circus-s01-e002/dubverse-black-butler-book-of-circus-s01-e002-stream.mp4`
- fuente nativa actual: `https://archive.org/download/dubverse-black-butler-book-of-circus-s01-e002/dubverse-black-butler-book-of-circus-s01-e002-stream.mp4`
- archivo seleccionado: 210,409,719 bytes, 1280×720, ~1.135 Mbps.

El item contiene tres originales separados:

1. `Dubverse-Black-Butler-Book-Of-Circus-S01-E002.mp4` — 350,356,004 bytes, 1080p.
2. `dubverse-black-butler-book-of-circus-s01-e002-stream.mp4` — 210,409,719 bytes, 720p.
3. `dubverse-black-butler-book-of-circus-s01-e002.mp4` — 250,180,111 bytes, 1080p.

**CONFIRMADO** — La comparación es sensible a mayúsculas/minúsculas y `archive_file` coincide exactamente con el segundo. Como los tres tienen `source = original`, son tres familias distintas. El resolver no elige el primero por orden de metadata ni incluye las otras dos como calidades de E002.

### Control sano: Uruwashi E001

- ID Dubverse: `uruwashi-no-yoi-no-tsuki-s01-e001`
- `archive_identifier`: `dubverse-uruwashi-no-yoi-no-tsuki-s01-e001-e004`
- `archive_file`: `dubverse-uruwashi-no-yoi-no-tsuki-s01-e001.mp4`
- fuente nativa preferida: `https://archive.org/download/dubverse-uruwashi-no-yoi-no-tsuki-s01-e001-e004/dubverse-uruwashi-no-yoi-no-tsuki-s01-e001.ia.mp4`
- fuente probada: 401,866,594 bytes, 1080p, ~2.231 Mbps.

## Evidencia HTTP/Range

Todas las lecturas pequeñas válidas devolvieron `206 Partial Content`, `Content-Type: video/mp4` y un `Content-Range` exacto tanto al inicio como en la mitad. El endpoint inicial anunció `Accept-Ranges: bytes` y `Access-Control-Allow-Origin: *` antes del redirect.

| Archivo | Rango | Nodo final | Resultado |
|---|---:|---|---|
| E001 `.ia.mp4` | `0-1023` | `ia903104` | `206`, 1.251 s |
| E001 `.ia.mp4` | mitad | `ia803104` | `206`, 0.890 s |
| E001 `.ia.mp4` | 1 MiB mitad | `ia803104` | TTFB 0.851 s, total 1.414 s, 741,661 B/s |
| E002 `-stream.mp4` | `0-1023` | `ia601602` | `206`, 7.601 s |
| E002 `-stream.mp4` | mitad | `ia601602` | `206`, 6.865 s |
| E002 `-stream.mp4` | 1 MiB mitad | `ia601602` | TTFB 6.326 s, total 13.120 s, 79,920 B/s |
| E002 original minúsculas | 1 MiB mitad | `ia601602` | TTFB 6.369 s, total 13.789 s, 76,044 B/s |
| E002 original con mayúsculas | 1 MiB mitad | sin redirect útil | `503` en esa prueba |
| Control `.ia.mp4` | inicio/mitad pequeños | `ia601801` | `206`, 1.003/0.846 s |

**CONFIRMADO** — Range y seek HTTP básico funcionan. No se observó que el servidor transformara una petición Range válida en una descarga completa `200`.

**CONFIRMADO en el navegador probado** — CORS no bloqueó `<video>`: E001, E002 y el control cargaron como media cross-origin. El reproductor no establece `crossorigin`, por lo que no intenta leer pixels/canvas; la ausencia de una cabecera CORS repetida en el 206 final no fue la causa del fallo observado.

**MUY PROBABLE** — El problema afecta al item/nodo E002 y no sólo al filename `-stream`: el original minúsculo del mismo item tuvo prácticamente la misma latencia y throughput.

**PENDIENTE DE PRUEBA** — El control sufrió un timeout de conexión en una repetición posterior, lo que confirma variabilidad general de Archive. Se necesitan muestras en otras regiones antes de convertir estas mediciones en una regla permanente.

### Estructura MP4

Se leyó únicamente el primer MiB de cada archivo. Los tres colocan `moov` inmediatamente después de `ftyp`, en offset 32:

- E001: `moov` de 1,589,628 bytes.
- E002 stream: `moov` de 1,258,573 bytes.
- Control: `moov` de 2,354,889 bytes.

**DESCARTADO** — E002 no está esperando un `moov` situado al final del archivo. Tiene estructura fast-start equivalente a los controles.

## Evidencia de navegador

### E002 directo, sin DubversePlayer

En una carga fría con query de diagnóstico:

- `loadedmetadata`: 13.155 s.
- primer `playing`: 13.303 s.
- `waiting` a `currentTime` 1.85 s.
- nuevo `waiting` a 5.83 s.
- nuevo `waiting` a 7.97 s.
- el evento `playing` reapareció entre cortes conforme llegaron datos.

**CONFIRMADO** — El mismo archivo se atasca fuera de Dubverse.

### E002 dentro de DubversePlayer

- `src` asignado una vez al `-stream.mp4` exacto.
- `load()` llamado una vez.
- `loadedmetadata`: 15.883 s.
- inicio con sólo ~1.36 s de rango disponible después de agotar la espera de `requestPlay()`.
- `waiting` a 1.85, 5.83, 7.97 y 10.67 s.
- `stalled` durante dos de esos cortes.
- no hubo cambio de calidad, recreación del elemento ni reasignación de fuente.

**CONFIRMADO** — El texto «La conexión está alcanzando al video…» es consecuencia de los eventos nativos `waiting`/`stalled`; no es un timer que pause por sí solo. En E002, `maybeDowngrade()` no puede actuar porque `variantIndex = 0` y sólo hay una variante.

### E002 embed oficial

El iframe cargó el reproductor oficial con el archivo exacto `-stream.mp4`; después de intentar reproducir mostró «No se ha podido reproducir el contenido multimedia».

**CONFIRMADO para la sesión observada** — El iframe tampoco resolvió el problema de E002. Esto refuerza que no es exclusivamente un bug visual de Dubverse.

### E001 y control sano

E001 directo alcanzó metadata en 1.554 s, `readyState = 4`, ~53.89 s de buffer y no produjo `waiting` durante la ventana observada. En Dubverse, metadata llegó en 1.364 s, se seleccionó `.ia.mp4`, hubo un solo `src`/`load()` y no hubo cortes.

El control directo alcanzó metadata en 1.518 s y ~25.96 s de buffer; con Dubverse llegó en 1.739 s y ~25.85 s. Ninguno produjo `waiting` durante la ventana observada. Su embed oficial también inició sin mostrar error.

## Comportamiento propio de Dubverse

El código activo proviene del commit `ec3bda4` («Add smart Archive player») y contiene equivalentes directos del prototipo Smart Player v2:

- `initialGate` y `requestPlay()`.
- espera inicial de 8 s con timeout de 12 s.
- espera de 4 s después de un seek, con timeout de 10 s.
- `waiting`/`stalled` y `maybeDowngrade()` a los 1.5 s.
- `maybeUpgrade()` cada 10 s; puede subir tras 60 s estables y 20 s de buffer.
- `switchVariant()` elimina `src`, llama `load()` sobre el video viejo, crea otro `<video>`, restaura `currentTime` y vuelve a esperar buffer.

**CONFIRMADO** — Un seek mientras el usuario quería reproducir provoca una pausa manual y espera posterior. Esto no causó los cortes iniciales analizados, pero es un comportamiento de riesgo independiente.

**CONFIRMADO** — En E001/control existen dos variantes y Auto podría recrear el video en un downgrade/upgrade. No ocurrió durante las ventanas medidas. En E002 no puede ocurrir porque sólo se devolvió una variante.

**CONFIRMADO** — `preload="auto"` hace que la descarga comience antes del click. `Cargando video…` existe desde el render inicial. `La conexión está alcanzando al video…` sólo aparece tras `waiting` o `stalled`.

## Analytics, progreso y navegación

- Analytics recibe snapshots y envía requests; no escribe `src`, no llama `load()` y no renderiza el player.
- `watch_progress` se limita por tiempo/distancia y se envía de forma asíncrona. No altera el elemento de video.
- `episode_watched` sólo cambia al marcar manualmente o al completar según la API; no remonta por milestones.
- No hay `MutationObserver` en el runtime público del player o la SPA.
- `watch()` destruye el player anterior antes de crear uno nuevo. La navegación SPA y `popstate` no dejan dos players activos.
- Una reconciliación real de sesión puede ejecutar de nuevo la ruta, pero primero destruye la instancia existente; no hay reproducción simultánea. En el flujo normal `loadBase()` ya espera la sesión, por lo que `pageshow` no vuelve a montar si la identidad no cambió.
- Acciones deliberadas como editar/comentar/dar like sí llaman `watch(id, false)` y recrean la página/player; no están relacionadas con los eventos de buffering ni con Analytics.

**DESCARTADO** — PLAY_START/25/50/75/90/COMPLETE, historial y progreso como causa de cambios de fuente o cortes.

## Causa raíz demostrada

1. **CONFIRMADO — entrega insuficiente de E002 desde Archive.** El throughput medido (~0.64 Mbps) quedó por debajo del bitrate del archivo (~1.135 Mbps); el MP4 directo y el embed también fallaron o se cortaron.
2. **CONFIRMADO — espera inicial de Dubverse que agrava la percepción.** Dubverse puede retener el inicio hasta 12 s buscando 8 s de buffer. Si la red no alcanza esa meta, termina iniciando sin reserva suficiente y no evita los cortes.
3. **CONFIRMADO — estrategia Smart Player con riesgo adicional.** En episodios con varias variantes, los eventos de stall y el upgrade periódico pueden reemplazar el `<video>` y volver a descargar/seekear. No fue la causa de E002, pero sí puede explicar reinicios en otros episodios.
4. **DESCARTADO para el caso actual — selección equivocada de E002.** La API respetó exactamente `archive_file = ...-stream.mp4` pese a que el item contiene otros dos MP4.
5. **DESCARTADO — índice MP4 al final, falta de Range, CORS básico, Analytics o rerender duplicado** como explicación principal de E002.

## Solución permanente propuesta — no implementada

### Reproductor

1. Para MP4 progresivo, dejar que el navegador decida cuándo iniciar: retirar `initialGate`/`waitForBuffer` del play inicial en vez de aumentar timeouts.
2. No pausar manualmente después de cada seek; restaurar el comportamiento nativo salvo que una prueba reproducible demuestre que necesita intervención.
3. Elegir una fuente una vez al montar. No hacer downgrade/upgrade automático entre MP4 independientes; mantener calidad manual o cambiar sólo ante un error de media definitivo.
4. Si se conserva fallback, activarlo una sola vez por error real, no por un `waiting` transitorio.
5. Mantener instrumentación opt-in sólo en desarrollo para registrar nodo final, `src`, ranges y eventos sin telemetría de producción.

### Item E002

El cambio del player no puede convertir una entrega de ~0.64 Mbps en una reproducción estable de ~1.135 Mbps. Antes de modificar producción se debe repetir el test desde Preview/móvil y resolver el item en Archive: solicitar reparación/rederivación del item o, si Archive no lo corrige, volver a subir el mismo archivo byte-identical a un item limpio de Archive y verificar su nodo/rangos antes de cambiar `archive_identifier`/`archive_file`. Esto conserva proveedor y contenido; no requiere recodificar, pero es una operación separada que no se realizó.

## Riesgos de regresión

- Eliminar gates puede mostrar un `waiting` más temprano en redes lentas, aunque reduce la espera artificial.
- Desactivar Auto cambia expectativas del selector de calidad; necesita tests de DIRECT/HLS y Archive con una/dos variantes.
- Cambiar el item E002 altera URLs y requiere verificar embed, historial y enlaces persistidos.
- Archive puede redirigir a nodos diferentes por región/hora; una prueba única no garantiza estabilidad global.
- Deben repetirse reproducción inicial, seek medio, fullscreen y background/foreground en Android Chrome e iOS Safari antes de cualquier cambio de player.
