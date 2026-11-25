/* global DubversePlayer */
// Local-only diagnostics. This lab has no Analytics client, accounts or write API.
let activePlayer, episode, events = [], samples = [], playStarts = 0, started = false, device = {}, previousSample, sourceSupport;
const byId = id => document.getElementById(id);
const record = (type, detail = {}) => {
  events.push({ at: new Date().toISOString(), type, ...detail });
  if (events.length > 250) events.shift();
  byId('events').textContent = events.slice(-12).map(event => `${event.at.slice(11,19)} ${event.type}${event.message ? ': ' + event.message : ''}`).join('\n');
};
function snapshot() {
  const player = activePlayer, video = player?.video, variant = player?.variants[player.variantIndex];
  const info = variant?.video || episode?.playback.source?.video;
  let quality = null;
  try { quality = video?.getVideoPlaybackQuality?.(); } catch {}
  return {
    at: new Date().toISOString(), episodeId: episode?.id,
    mode: player?.variants.length ? (player?.autoQuality ? 'Auto' : 'Manual') : 'Fuente única', file: variant?.name || (episode?.sample ? episode.playback.source.url.split('/').at(-1) : null),
    variantIndex: player?.variantIndex,
    codec: info?.codec || 'No medido', bitDepth: info?.bitDepth || null,
    width: video?.videoWidth || info?.width || null, height: video?.videoHeight || info?.height || null,
    position: video?.currentTime || 0, paused: video?.paused ?? true,
    readyState: video?.readyState, state: player?.root?.dataset.playerState,
    seeking: video?.seeking, restoring: player?.restoring, switching: player?.switching,
    buffered: video ? Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]) : [],
    clockStallSeconds: player?.playbackWatch?.wall,
    playbackRate: video?.playbackRate, volume: video?.volume, muted: video?.muted,
    mediaError: video?.error ? { code: video.error.code, message: video.error.message } : null,
    totalVideoFrames: quality?.totalVideoFrames, droppedVideoFrames: quality?.droppedVideoFrames,
    presentedCallbacks: player?.frameMonitor?.callbacks,
    failedVariants: [...(player?.failedVariants || [])], variantSupport: sourceSupport ? [[0, sourceSupport]] : [...(player?.variantSupport || [])],
    downlink: navigator.connection?.downlink, fallbackUsed: Boolean(player?.fallbackUsed),
    playStarts
  };
}
function render() {
  if (!activePlayer) return;
  const data = snapshot(); samples.push(data); if (samples.length > 600) samples.shift();
  if (previousSample && data.variantIndex !== previousSample.variantIndex) record('QUALITY_CHANGE', { from: previousSample.file, to: data.file, mode: data.mode });
  if (previousSample && data.failedVariants.length > previousSample.failedVariants.length) record('VARIANT_EXCLUDED', { failedVariants: data.failedVariants });
  previousSample = data;
  const fields = [
    ['Dispositivo', `${device.model || device.platform || navigator.platform} · ${device.userAgent}`],
    ['Seguridad / API', `${location.protocol} · contexto seguro: ${isSecureContext ? 'sí' : 'no'} · MediaCapabilities: ${Boolean(navigator.mediaCapabilities?.decodingInfo)}`],
    ['Calidad seleccionada', `${data.mode} · ${data.height ? data.height + 'p' : 'ninguna compatible'}`],
    ['Imagen decodificada', `${activePlayer.video?.videoWidth || 0} × ${activePlayer.video?.videoHeight || 0}`],
    ['Códec / bits', `${data.codec} · ${data.bitDepth || '?'} bits`],
    ['Archivo', data.file || 'Ninguno compatible seleccionado'],
    ['Fuentes / soporte', activePlayer.variants.length ? activePlayer.variants.map((variant, index) => `${variant.video?.height || variant.height || '?'}p · ${variant.video?.codec || 'códec no medido'} · ${activePlayer.variantSupport.get(index)?.supported === false ? 'rechazada' : activePlayer.variantSupport.get(index)?.supported === true ? 'admitida por el navegador' : 'soporte desconocido'}`).join('\n') : `${data.codec} · canPlayType: ${activePlayer.video?.canPlayType(episode.playback.source?.video?.contentType || 'video/mp4') || 'rechazado'}`],
    ['Reproducción', `${Number(data.position).toFixed(1)} s · ${data.state || 'preparando'}`],
    ['Fotogramas', `${data.totalVideoFrames ?? '?'} totales · ${data.droppedVideoFrames ?? '?'} descartados · ${data.presentedCallbacks ?? '?'} callbacks`],
    ['Variantes fallidas', data.failedVariants.join(', ') || 'Ninguna'],
    ['Error del navegador', data.mediaError ? `${data.mediaError.code}: ${data.mediaError.message}` : 'Ninguno comunicado'],
    ['Inicios locales', String(data.playStarts)]
  ];
  byId('diagnostics').replaceChildren(...fields.flatMap(([label, value]) => {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; return [dt, dd];
  }));
}
async function selectEpisode(value, catalog) {
  activePlayer?.destroy();
  episode = catalog.episodes.find(item => item.id === value);
  events = []; samples = []; started = false; playStarts = 0; previousSample = null; sourceSupport = null;
  byId('visible-image').checked = false; byId('black-audio').checked = false;
  history.replaceState(null, '', `?episode=${encodeURIComponent(value)}`);
  activePlayer = new DubversePlayer(byId('dubversePlayer'), { playback: episode.playback, title: episode.title,
    onPlaying: () => { if (!started) { started = true; playStarts++; record('PLAY_START_LOCAL'); } },
    onPause: () => record('PAUSE'), onSeek: detail => record('SEEK', detail),
    onError: message => record('PLAYER_ERROR', { message }), onEnded: () => record('ENDED')
  });
  window.activePlayer = activePlayer;
  const player = activePlayer;
  await player.ready;
  if (activePlayer !== player) return;
  if (episode.sample && navigator.mediaCapabilities?.decodingInfo) {
    const source = episode.playback.source, info = source.video;
    let timer;
    try {
      const support = await Promise.race([
        navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: info.contentType, width: info.width, height: info.height, bitrate: source.estimatedBitrate, framerate: info.framerate } }),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 800); })
      ]);
      if (activePlayer !== player) return;
      if (support) sourceSupport = { supported: support.supported, smooth: support.smooth };
    } catch {} finally { clearTimeout(timer); }
  }
  activePlayer.video?.addEventListener('error', () => record('MEDIA_ERROR', { ...snapshot().mediaError }));
  record('READY', { variantSupport: [...activePlayer.variantSupport] }); render();
}
byId('download').onclick = () => {
  const payload = { capturedAt: new Date().toISOString(), lab: 'isolated-player-review', device,
    secureContext: isSecureContext, episode, result: { visibleImage: byId('visible-image').checked, blackWithAudio: byId('black-audio').checked },
    current: snapshot(), events, samples };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `dubverse-prueba-${episode.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
byId('copy').onclick = async () => {
  const current = snapshot();
  const text = JSON.stringify({ device, episodeId: episode.id, visibleImage: byId('visible-image').checked,
    blackWithAudio: byId('black-audio').checked, current, events: events.slice(-15) }, null, 2);
  try { await navigator.clipboard.writeText(text); byId('copy-status').textContent = 'Resumen copiado. Puedes pegarlo en el chat.'; }
  catch { byId('copy-status').textContent = 'El navegador no permitió copiar. Usa Descargar diagnóstico.'; }
};
(async () => {
  device = { userAgent: navigator.userAgent, platform: navigator.platform };
  try { Object.assign(device, await navigator.userAgentData?.getHighEntropyValues(['platformVersion', 'model', 'fullVersionList'])); } catch {}
  byId('secure-warning').hidden = isSecureContext;
  const response = await fetch('/catalog.json'); if (!response.ok) throw Error('No se pudo cargar la muestra pública.');
  const catalog = await response.json();
  byId('episode').replaceChildren(...catalog.episodes.map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; return option; }));
  byId('episode').onchange = () => selectEpisode(byId('episode').value, catalog);
  const requested = new URL(location.href).searchParams.get('episode');
  byId('episode').value = catalog.episodes.some(item => item.id === requested) ? requested : catalog.episodes.find(item => item.id.includes('black-butler'))?.id || catalog.episodes[0].id;
  await selectEpisode(byId('episode').value, catalog); setInterval(render, 1000);
})().catch(error => record('LAB_ERROR', { message: error.message }));
