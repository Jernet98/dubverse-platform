# Reproductor de episodios

`public/player.js` conserva `window.DubversePlayer`, `snapshot()`, `destroy()` y los callbacks que consume `watch()` en `public/app.js`: `onPlaying`, `onProgress`, `onPause`, `onSeek`, `onEnded`, `onDestroy`, además de los estados opcionales `onBuffering` y `onError`. La instancia de Analytics sigue perteneciendo al episodio; cambiar de fuente no crea otra.

## Dependencias locales

ArtPlayer 5.4.0 y hls.js 1.7.4 están fijados en `package-lock.json`. `predev` y `prebuild` ejecutan `scripts/build-player-assets.mjs`, que copia las distribuciones UMD de los paquetes instalados a `public/vendor/player/`. Es una salida generada e ignorada por Git. Los scripts se solicitan al mismo origen y se reutilizan entre episodios. hls.js se carga sólo para HLS cuando se necesita; su distribución incluye el worker. No se instala Video.js ni se requiere un CDN de scripts durante la reproducción.

Referencias de implementación: [ArtPlayer](https://github.com/zhw2590582/ArtPlayer), [opciones de ArtPlayer](https://artplayer.org/document/en/start/option), [hls.js](https://github.com/video-dev/hls.js).

## Fuentes y recuperación

- MP4 y otras fuentes directas siguen usando el elemento HTMLMediaElement. Cambiar de calidad conserva el mismo video, posición, volumen, silencio, velocidad e intención de reproducir. Elegir la calidad actual no recarga la fuente. La elección manual no tiene el periodo de espera de los cambios automáticos.
- Archive utiliza únicamente las variantes que ya resolvió el servidor para el archivo original del episodio. No cambia identificadores, URLs persistidas ni datos de la base. `lib/archive.js` conserva el resolver y sus pruebas.
- `Auto · MP4` elige inicialmente según la información de conexión disponible y puede bajar de variante después de una espera real sostenida sin datos. No es ABR por segmentos: cambiar de archivo requiere otra petición. Se eliminan las subidas periódicas especulativas que descargaban otra fuente durante una reproducción estable.
- El inicio y la búsqueda no imponen ocho/cuatro segundos de buffer ni pausan para esperar. Un evento `stalled` con datos suficientes no provoca un cambio de fuente. Los errores de red directos reciben un reintento acotado; las variantes rechazadas se descartan antes del iframe oficial de Archive.
- HLS prefiere la reproducción nativa en navegadores Apple compatibles. En otros navegadores utiliza hls.js con MSE y sus valores de buffer/reintento predeterminados; si MSE no existe, intenta HLS nativo cuando esté disponible. El menú manual y Auto de hls.js utiliza las variantes reales del manifiesto. Safari controla internamente la adaptación de HLS nativo y no expone esos niveles al adaptador.
- Al cambiar de episodio, entrar al iframe o destruir el reproductor se cancelan listeners, timers y la instancia HLS, se libera la fuente y se destruye ArtPlayer. No se inventan eventos de reproducción dentro de un iframe de otro origen.

## Interfaz

Controles SVG de ArtPlayer con tema rojo, reproducción/pausa, saltos de diez segundos, volumen/silencio, velocidad, pantalla completa y ampliación. Mantiene la barra y el indicador de tiempo de ArtPlayer, reemplazando su carga continua por todos los rangos reales de `video.buffered`: rojo reproducido, gris claro cargado y gris oscuro restante. Los huecos entre rangos no se rellenan.

La interfaz tiene gestos horizontales de ArtPlayer para buscar, controles táctiles de 44 px, ajustes desplazables y soporte de teclado. Los controles permanecen visibles durante una interacción, en un menú abierto o con foco de teclado. Las miniaturas se omiten al no existir recursos verificados.

Se admiten pistas explícitas `playback.subtitles: [{ url, label, language }]`, pistas nativas de subtítulos/captions y pistas de HLS. Los archivos externos requieren permisos CORS del proveedor. No se adivinan nombres de subtítulos de otros episodios de un mismo item.

## Validación reproducible

```sh
npm ci
npm test
npm run build
npm run test:player:browser
```

Las pruebas de navegador arrancan el build de producción y abren `/ver/player-ep-1`, la página real de episodios. Interceptan las APIs con datos de prueba y sirven medios sintéticos locales con respuestas HTTP Range; no escriben en Neon ni envían estadísticas reales. La configuración predeterminada usa Chrome instalado. Se puede usar Edge con `PLAYER_BROWSER_CHANNEL=msedge`, o Chromium de Playwright con `PLAYER_BROWSER_CHANNEL=chromium` después de instalarlo mediante `npx playwright install chromium`.

Los proyectos Android, iPhone y tablet comprueban tamaños, entradas táctiles y navegación mediante emulación en Chromium. No equivalen a pruebas físicas en Android/iOS ni a ejecutar Safari. La selección de HLS nativo y la recuperación fatal de hls.js también se verifican con dobles de prueba en `tests/player-adapter.test.js`.

Resultados del 29 de octubre de 2026:

- Base antes de modificar: 129 pruebas existentes aprobadas.
- `npm test`: 141/141 aprobadas, incluidas Archive, Analytics y las 12 pruebas nuevas del adaptador.
- Playwright: 28/28 escenarios aprobados en Chrome de Windows con los cuatro tamaños/configuraciones. Incluyen reproducción con medios reales sintéticos, pausa, búsqueda, velocidad, subtítulos, calidades MP4/HLS, Auto HLS, reintento, iframe, gestos, controles y navegación. Las APIs externas están simuladas.
- Prueba adicional de escritorio aprobada después de ajustar la ampliación web: conserva el tema, cubre el encabezado y sale con Escape. También se comprueba pantalla completa nativa.
- `npm run build`: producción compilada correctamente con los recursos locales del reproductor.
- `git diff --check`: sin errores.

## Límites y revisión manual

Archive controla ancho de banda, latencia, disponibilidad, soporte de rangos y codificación. La barra muestra lo recibido; JavaScript no puede garantizar la eliminación de cortes ni aumentar la velocidad del servidor. El iframe oficial conserva el archivo exacto y ofrece su experiencia propia, sin acceso a progreso/Analytics desde Dubverse.

Comprobar en dispositivos físicos iPhone/Safari y Android: pantalla completa, orientación, audio, gestos, subtítulos y continuidad después de bloquear/desbloquear la pantalla. Comprobar episodios reales de Archive con archivos individuales y múltiples en conexiones lentas, así como un HLS real del proveedor. Los fallbacks del navegador automatizado utilizan un iframe simulado para verificar el contrato y la URL exacta, no la disponibilidad del servidor externo.

`npm audit` detectó siete avisos en dependencias previas: Better Auth y Next (críticos), Sharp, Zod y source-map-js/PostCSS (altos), y los adaptadores Drizzle/Kysely de Better Auth (bajos). El diff del lockfile no cambia esas versiones; ArtPlayer y hls.js no añaden avisos. Requieren una actualización separada con sus propias pruebas.

El archivo local preexistente `lib/.vscode/settings.json` (tres líneas de configuración de Python) se conserva fuera del commit del reproductor.
