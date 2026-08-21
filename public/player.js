(function bootstrapDubversePlayer(global) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const timeLabel = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
  };

  class DubversePlayer {
    constructor(container, options = {}) {
      if (!container) throw new Error('DubversePlayer requiere un contenedor.');
      this.container = container;
      this.options = options;
      this.config = options.playback || {};
      this.initialTime = Math.max(0, Number(options.initialTime) || 0);
      this.video = null;
      this.fallbackUsed = false;
      this.destroyed = false;
      this.lastPosition = 0;
      this.boundVisibility = () => this.renderState(document.hidden ? 'paused' : this.video?.paused ? 'paused' : 'playing');
      this.boundKeydown = event => this.onKeydown(event);
      this.render();
    }

    render() {
      this.container.innerHTML = `
        <div class="dv-player" data-player-state="loading" tabindex="0" aria-label="Reproductor de video">
          <div class="dv-player-stage"></div>
          <div class="dv-player-status" role="status"><span class="dv-player-spinner" aria-hidden="true"></span><strong>Cargando video…</strong><small>Preparando la fuente del episodio.</small></div>
          <div class="dv-player-error hidden" role="alert"><strong>No pudimos reproducir este video.</strong><span data-player-error-message>Comprueba tu conexión e inténtalo otra vez.</span><div><button type="button" data-player-retry>Reintentar</button><button class="hidden" type="button" data-player-fallback>Usar reproductor compatible</button></div></div>
          <div class="dv-player-controls hidden">
            <div class="dv-player-buffer" aria-hidden="true"><i></i></div>
            <input class="dv-player-seek" type="range" min="0" max="1000" value="0" aria-label="Posición del video">
            <div class="dv-player-control-row">
              <button type="button" data-player-play aria-label="Reproducir">▶</button>
              <button type="button" data-player-mute aria-label="Silenciar">🔊</button>
              <input class="dv-player-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volumen">
              <span class="dv-player-time"><span data-player-current>0:00</span> / <span data-player-duration>0:00</span></span>
              <select class="dv-player-speed" aria-label="Velocidad de reproducción"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
              <button type="button" data-player-fullscreen aria-label="Pantalla completa">⛶</button>
            </div>
          </div>
        </div>`;
      this.root = this.container.querySelector('.dv-player');
      this.stage = this.container.querySelector('.dv-player-stage');
      this.status = this.container.querySelector('.dv-player-status');
      this.error = this.container.querySelector('.dv-player-error');
      this.controls = this.container.querySelector('.dv-player-controls');
      this.container.querySelector('[data-player-retry]').onclick = () => this.retry();
      this.container.querySelector('[data-player-fallback]').onclick = () => this.useFallback();
      document.addEventListener('visibilitychange', this.boundVisibility);
      this.root.addEventListener('keydown', this.boundKeydown);
      this.loadPrimary();
    }

    loadPrimary() {
      const source = this.config.source;
      if (!source?.url) {
        if (this.config.fallback?.url) return this.useFallback();
        return this.showError('El episodio no tiene una fuente reproducible configurada.');
      }
      if (source.kind === 'HLS') {
        const probe = document.createElement('video');
        if (!probe.canPlayType('application/vnd.apple.mpegurl')) {
          return this.showError('Este navegador no admite la fuente HLS de forma nativa.');
        }
      }
      this.mountVideo(source);
    }

    mountVideo(source) {
      this.stage.innerHTML = '';
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'metadata';
      video.poster = this.options.poster || '';
      video.src = source.url;
      video.setAttribute('aria-label', this.options.title || 'Reproductor de Dubverse');
      this.stage.append(video);
      this.video = video;
      this.controls.classList.remove('hidden');
      this.bindVideo();
      video.load();
    }

    bindVideo() {
      const video = this.video;
      const play = this.container.querySelector('[data-player-play]');
      const mute = this.container.querySelector('[data-player-mute]');
      const seek = this.container.querySelector('.dv-player-seek');
      const volume = this.container.querySelector('.dv-player-volume');
      const speed = this.container.querySelector('.dv-player-speed');
      const fullscreen = this.container.querySelector('[data-player-fullscreen]');
      const current = this.container.querySelector('[data-player-current]');
      const duration = this.container.querySelector('[data-player-duration]');
      const buffered = this.container.querySelector('.dv-player-buffer i');

      const updateTimeline = () => {
        const total = Number(video.duration) || 0;
        const position = Number(video.currentTime) || 0;
        this.lastPosition = position;
        seek.value = total ? String(Math.round(position / total * 1000)) : '0';
        current.textContent = timeLabel(position);
        duration.textContent = timeLabel(total);
        let end = 0;
        if (total && video.buffered.length) end = video.buffered.end(video.buffered.length - 1) / total * 100;
        buffered.style.width = `${clamp(end, 0, 100)}%`;
        this.options.onProgress?.({ position, duration: total, paused: video.paused, ended: video.ended });
      };
      const setInitialTime = () => {
        const total = Number(video.duration) || 0;
        if (this.initialTime > 0 && (!total || this.initialTime < total - 5)) video.currentTime = this.initialTime;
        this.initialTime = 0;
        updateTimeline();
      };
      const recoverableState = message => {
        this.renderState('buffering', message);
        this.options.onBuffering?.();
      };
      video.addEventListener('loadedmetadata', setInitialTime, { once: true });
      video.addEventListener('durationchange', updateTimeline);
      video.addEventListener('progress', updateTimeline);
      video.addEventListener('timeupdate', updateTimeline);
      video.addEventListener('canplay', () => this.renderState(video.paused ? 'ready' : 'playing'));
      video.addEventListener('playing', () => { play.textContent = '❚❚'; play.setAttribute('aria-label', 'Pausar'); this.renderState('playing'); });
      video.addEventListener('pause', () => { play.textContent = '▶'; play.setAttribute('aria-label', 'Reproducir'); this.renderState('paused'); this.options.onPause?.({ position: video.currentTime, duration: video.duration }); });
      video.addEventListener('waiting', () => recoverableState('La conexión está alcanzando al video…'));
      video.addEventListener('stalled', () => recoverableState('El proveedor tardó en responder. Seguimos intentando…'));
      video.addEventListener('seeking', () => recoverableState('Buscando la nueva posición…'));
      video.addEventListener('seeked', () => { this.renderState(video.paused ? 'paused' : 'playing'); this.options.onSeek?.({ position: video.currentTime, duration: video.duration }); });
      video.addEventListener('ended', () => { this.renderState('ended'); this.options.onEnded?.({ position: video.duration, duration: video.duration }); });
      video.addEventListener('error', () => this.showError('El proveedor rechazó la fuente o el archivo no está disponible.'));
      play.onclick = () => video.paused ? video.play().catch(() => this.showError('El navegador no permitió iniciar la reproducción.')) : video.pause();
      this.stage.onclick = event => { if (event.target === video) play.click(); };
      seek.oninput = () => { if (video.duration) video.currentTime = Number(seek.value) / 1000 * video.duration; };
      volume.oninput = () => { video.volume = Number(volume.value); video.muted = video.volume === 0; mute.textContent = video.muted ? '🔇' : '🔊'; };
      mute.onclick = () => { video.muted = !video.muted; mute.textContent = video.muted ? '🔇' : '🔊'; };
      speed.onchange = () => { video.playbackRate = Number(speed.value) || 1; };
      fullscreen.onclick = () => {
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (this.root.requestFullscreen) this.root.requestFullscreen().catch(() => {});
        else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      };
    }

    onKeydown(event) {
      if (!this.video || event.target?.closest?.('input,select,textarea,button,[contenteditable="true"]')) return;
      const key = String(event.key || '').toLowerCase();
      if (![' ', 'enter', 'm', 'f', 'arrowleft', 'arrowright'].includes(key)) return;
      event.preventDefault();
      if (key === ' ' || key === 'enter') this.container.querySelector('[data-player-play]').click();
      if (key === 'm') this.container.querySelector('[data-player-mute]').click();
      if (key === 'f') this.container.querySelector('[data-player-fullscreen]').click();
      if (key === 'arrowleft' || key === 'arrowright') {
        this.video.currentTime = clamp(this.video.currentTime + (key === 'arrowleft' ? -5 : 5), 0, this.video.duration || Number.MAX_SAFE_INTEGER);
      }
    }

    renderState(state, message = '') {
      if (this.destroyed) return;
      this.root.dataset.playerState = state;
      const visible = ['loading', 'buffering'].includes(state);
      this.status.classList.toggle('hidden', !visible);
      if (message) this.status.querySelector('small').textContent = message;
      this.error.classList.add('hidden');
    }

    showError(message) {
      if (this.destroyed) return;
      this.root.dataset.playerState = 'error';
      this.status.classList.add('hidden');
      this.error.classList.remove('hidden');
      this.error.querySelector('[data-player-error-message]').textContent = message;
      const fallback = this.error.querySelector('[data-player-fallback]');
      fallback.classList.toggle('hidden', !this.config.fallback?.url || this.fallbackUsed);
      this.options.onError?.(message);
    }

    retry() {
      if (this.fallbackUsed) return;
      this.error.classList.add('hidden');
      this.renderState('loading', 'Reintentando la fuente del episodio…');
      if (this.video) {
        const position = this.video.currentTime || this.lastPosition;
        this.initialTime = position;
        this.video.removeAttribute('src');
        this.video.load();
      }
      this.loadPrimary();
    }

    useFallback() {
      if (this.fallbackUsed) return;
      const fallback = this.config.fallback;
      if (!fallback?.url) return this.showError('No existe un reproductor alternativo para este episodio.');
      this.fallbackUsed = true;
      this.video?.pause();
      this.video = null;
      this.controls.classList.add('hidden');
      this.error.classList.add('hidden');
      this.status.classList.remove('hidden');
      this.stage.innerHTML = `<iframe src="${String(fallback.url).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" title="${String(this.options.title || 'Reproductor compatible').replace(/"/g, '&quot;')}" allow="fullscreen; autoplay" allowfullscreen loading="eager"></iframe>`;
      this.root.dataset.playerState = 'fallback';
      setTimeout(() => this.status.classList.add('hidden'), 700);
    }

    snapshot() {
      return { position: this.video?.currentTime || this.lastPosition || 0, duration: this.video?.duration || 0, paused: this.video?.paused ?? true };
    }

    destroy() {
      if (this.destroyed) return;
      const snapshot = this.snapshot();
      this.destroyed = true;
      document.removeEventListener('visibilitychange', this.boundVisibility);
      this.root.removeEventListener('keydown', this.boundKeydown);
      this.video?.pause();
      this.video?.removeAttribute('src');
      this.video?.load();
      this.options.onDestroy?.(snapshot);
      this.container.innerHTML = '';
    }
  }

  global.DubversePlayer = DubversePlayer;
  global.DUBVERSE_WATCH_COMPLETE_THRESHOLD = 0.92;
})(window);
