(function bootstrapDubversePlayer(global) {
  const AUTO_HIDE_MS = 2800;
  const METADATA_TIMEOUT_MS = 10000;
  const EMBED_TIMEOUT_MS = 12000;
  const ARCHIVE_MODES = Object.freeze({
    DIRECT: 'DIRECT_ARCHIVE',
    FILE_EMBED: 'ARCHIVE_FILE_EMBED',
    ITEM_EMBED: 'ARCHIVE_ITEM_EMBED',
    FAILED: 'FAILED'
  });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const timeLabel = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
  };
  const icon = name => ({
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-2-3.16v6.32a3.5 3.5 0 0 0 2-3.16zm-2-7.45v2.08a6 6 0 0 1 0 10.74v2.08a8 8 0 0 0 0-14.9z"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.2-2.2-1.4-1.4-2.2 2.2L13 8.4 11.6 9.8l2.2 2.2-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4z"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zm4 10h2v6h-6v-2h4zM4 14h2v4h4v2H4z"/></svg>'
  }[name] || '');
  const isEditableTarget = target => Boolean(target?.closest?.('input,select,textarea,button,[contenteditable="true"]'));
  const isArchiveEmbed = value => {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol)
        && url.hostname.toLowerCase().replace(/^www\./, '') === 'archive.org'
        && url.pathname.startsWith('/embed/');
    } catch { return false; }
  };

  class DubversePlayer {
    constructor(container, options = {}) {
      if (!container) throw new Error('DubversePlayer requiere un contenedor.');
      this.container = container;
      this.options = options;
      this.config = options.playback || {};
      this.initialTime = Math.max(0, Number(options.initialTime) || 0);
      this.video = null;
      this.frame = null;
      this.destroyed = false;
      this.lastPosition = this.initialTime;
      this.lastDuration = 0;
      this.lastVolume = 1;
      this.seeking = false;
      this.controlsTimer = 0;
      this.sourceTimer = 0;
      this.archiveAttempts = new Set();
      this.playbackMode = null;
      this.lastStagePointerType = '';
      this.touchMode = Boolean(global.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
      this.boundVisibility = () => {
        if (document.hidden) this.showControls(false);
        else this.renderState(this.video?.paused ? 'paused' : this.video ? 'playing' : this.root.dataset.playerState);
      };
      this.boundKeydown = event => this.onKeydown(event);
      this.render();
    }

    render() {
      this.container.innerHTML = `
        <div class="dv-player" data-player-state="loading" data-controls="visible" tabindex="0" aria-label="Reproductor de video">
          <div class="dv-player-stage"></div>
          <div class="dv-player-status" role="status"><span class="dv-player-spinner" aria-hidden="true"></span><strong>Cargando video…</strong><small>Preparando la fuente del episodio.</small></div>
          <div class="dv-player-error hidden" role="alert"><strong>No pudimos reproducir este episodio.</strong><span data-player-error-message>Comprueba tu conexión e inténtalo otra vez.</span><div><button type="button" data-player-retry>Reintentar</button><button type="button" data-player-report>Reportar problema</button></div></div>
          <button class="dv-player-center hidden" type="button" data-player-center aria-label="Reproducir">${icon('play')}</button>
          <div class="dv-player-controls hidden">
            <div class="dv-player-timeline">
              <div class="dv-player-buffer" aria-hidden="true"><i></i></div>
              <input class="dv-player-seek" type="range" min="0" max="1000" value="0" aria-label="Posición del video">
            </div>
            <div class="dv-player-control-row">
              <button type="button" data-player-play aria-label="Reproducir">${icon('play')}</button>
              <div class="dv-player-volume-group">
                <button type="button" data-player-mute aria-label="Silenciar">${icon('volume')}</button>
                <input class="dv-player-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volumen">
              </div>
              <span class="dv-player-time"><span data-player-current>0:00</span><span aria-hidden="true"> / </span><span data-player-duration>0:00</span></span>
              <select class="dv-player-speed" aria-label="Velocidad de reproducción"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
              <button type="button" data-player-fullscreen aria-label="Pantalla completa">${icon('fullscreen')}</button>
            </div>
          </div>
        </div>`;
      this.root = this.container.querySelector('.dv-player');
      this.stage = this.container.querySelector('.dv-player-stage');
      this.status = this.container.querySelector('.dv-player-status');
      this.error = this.container.querySelector('.dv-player-error');
      this.controls = this.container.querySelector('.dv-player-controls');
      this.center = this.container.querySelector('[data-player-center]');
      this.retryButton = this.container.querySelector('[data-player-retry]');
      this.reportButton = this.container.querySelector('[data-player-report]');
      this.retryButton.onclick = () => this.retry();
      this.reportButton.onclick = () => this.options.onReport?.({ mode: this.playbackMode, message: this.error.querySelector('[data-player-error-message]').textContent });
      this.reportButton.classList.toggle('hidden', typeof this.options.onReport !== 'function');
      this.root.addEventListener('pointermove', event => {
        if (event.pointerType === 'mouse') this.noteInteraction();
      });
      this.root.addEventListener('keydown', this.boundKeydown);
      this.controls.addEventListener('pointerdown', event => { event.stopPropagation(); this.showControls(false); });
      this.controls.addEventListener('click', event => event.stopPropagation());
      this.center.addEventListener('click', event => { event.stopPropagation(); this.togglePlayback(); });
      this.stage.addEventListener('pointerdown', event => { this.lastStagePointerType = event.pointerType || ''; });
      this.stage.addEventListener('click', event => this.onStageClick(event));
      document.addEventListener('visibilitychange', this.boundVisibility);
      this.loadPrimary();
    }

    archiveFallbacks() {
      const configured = Array.isArray(this.config.fallbacks) && this.config.fallbacks.length
        ? this.config.fallbacks
        : this.config.fallback?.url ? [this.config.fallback] : [];
      return configured.filter(candidate => candidate?.kind === 'IFRAME' && isArchiveEmbed(candidate.url));
    }

    loadPrimary() {
      this.clearSourceTimer();
      const source = this.config.source;
      if (!source?.url) {
        if (String(this.config.provider || '').toUpperCase() === 'ARCHIVE' && this.archiveFallbacks().length) return this.advanceArchiveFallback();
        if (this.config.fallback?.url) return this.useFallback();
        return this.showFinalError('El episodio no tiene una fuente reproducible configurada.');
      }
      if (source.kind === 'HLS') {
        const probe = document.createElement('video');
        if (!probe.canPlayType('application/vnd.apple.mpegurl')) {
          return this.showFinalError('Este navegador no admite la fuente HLS de forma nativa.');
        }
      }
      this.playbackMode = source.mode || (this.config.provider === 'ARCHIVE' ? ARCHIVE_MODES.DIRECT : source.kind);
      this.mountVideo(source);
    }

    releaseVideo() {
      const previous = this.video;
      this.video = null;
      if (!previous) return;
      try { previous.pause(); } catch {}
      previous.removeAttribute('src');
      try { previous.load(); } catch {}
    }

    mountVideo(source) {
      this.releaseVideo();
      this.frame = null;
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
      this.bindVideo(video);
      this.showControls(false);
      video.load();
      if (this.playbackMode === ARCHIVE_MODES.DIRECT) {
        this.sourceTimer = global.setTimeout(() => {
          if (this.video === video && video.readyState < 1) this.handleVideoFailure();
        }, METADATA_TIMEOUT_MS);
      }
    }

    bindVideo(video) {
      const play = this.container.querySelector('[data-player-play]');
      const mute = this.container.querySelector('[data-player-mute]');
      const seek = this.container.querySelector('.dv-player-seek');
      const volume = this.container.querySelector('.dv-player-volume');
      const speed = this.container.querySelector('.dv-player-speed');
      const fullscreen = this.container.querySelector('[data-player-fullscreen]');
      const current = this.container.querySelector('[data-player-current]');
      const duration = this.container.querySelector('[data-player-duration]');
      const buffered = this.container.querySelector('.dv-player-buffer i');
      volume.hidden = this.touchMode;

      const updateTimeline = () => {
        if (this.video !== video) return;
        const total = Number(video.duration) || 0;
        const position = Number(video.currentTime) || 0;
        this.lastPosition = position;
        if (total) this.lastDuration = total;
        seek.value = total ? String(Math.round(position / total * 1000)) : '0';
        current.textContent = timeLabel(position);
        duration.textContent = timeLabel(total);
        let end = 0;
        if (total && video.buffered.length) end = video.buffered.end(video.buffered.length - 1) / total * 100;
        buffered.style.width = `${clamp(end, 0, 100)}%`;
        this.options.onProgress?.({ position, duration: total, paused: video.paused, ended: video.ended });
      };
      const setInitialTime = () => {
        if (this.video !== video) return;
        this.clearSourceTimer();
        const total = Number(video.duration) || 0;
        if (this.initialTime > 0 && (!total || this.initialTime < total - 5)) video.currentTime = this.initialTime;
        this.initialTime = 0;
        updateTimeline();
      };
      const recoverableState = message => {
        if (this.video !== video) return;
        this.renderState('buffering', message);
        this.options.onBuffering?.();
      };
      video.addEventListener('loadedmetadata', setInitialTime, { once: true });
      video.addEventListener('durationchange', updateTimeline);
      video.addEventListener('progress', updateTimeline);
      video.addEventListener('timeupdate', updateTimeline);
      video.addEventListener('canplay', () => { if (this.video === video) this.renderState(video.paused ? 'ready' : 'playing'); });
      video.addEventListener('playing', () => {
        if (this.video !== video) return;
        this.setPlaybackIcons(true);
        this.renderState('playing');
      });
      video.addEventListener('pause', () => {
        if (this.video !== video) return;
        this.setPlaybackIcons(false);
        this.renderState('paused');
        this.options.onPause?.({ position: video.currentTime, duration: video.duration });
      });
      video.addEventListener('waiting', () => recoverableState('La conexión está alcanzando al video…'));
      video.addEventListener('stalled', () => recoverableState('El proveedor tardó en responder. Seguimos intentando…'));
      video.addEventListener('seeking', () => { this.seeking = true; recoverableState('Buscando la nueva posición…'); });
      video.addEventListener('seeked', () => {
        if (this.video !== video) return;
        this.seeking = false;
        this.renderState(video.paused ? 'paused' : 'playing');
        this.options.onSeek?.({ position: video.currentTime, duration: video.duration });
      });
      video.addEventListener('ended', () => {
        if (this.video !== video) return;
        this.setPlaybackIcons(false);
        this.renderState('ended');
        this.options.onEnded?.({ position: video.duration, duration: video.duration });
      });
      video.addEventListener('error', () => { if (this.video === video) this.handleVideoFailure(); });
      play.onclick = () => this.togglePlayback();
      seek.addEventListener('pointerdown', () => { this.seeking = true; this.showControls(false); });
      seek.addEventListener('input', () => {
        this.showControls(false);
        if (video.duration) video.currentTime = Number(seek.value) / 1000 * video.duration;
      });
      const finishSeek = () => { this.seeking = false; this.noteInteraction(); };
      seek.addEventListener('change', finishSeek);
      seek.addEventListener('pointerup', finishSeek);
      volume.oninput = () => {
        const next = clamp(volume.value, 0, 1);
        video.volume = next;
        video.muted = next === 0;
        if (next > 0) this.lastVolume = next;
        this.setVolumeIcon(video.muted || next === 0);
        this.noteInteraction();
      };
      mute.onclick = () => {
        if (video.muted || video.volume === 0) {
          video.muted = false;
          if (video.volume === 0) video.volume = this.lastVolume || 1;
        } else {
          this.lastVolume = video.volume || this.lastVolume || 1;
          video.muted = true;
        }
        volume.value = String(video.muted ? 0 : video.volume);
        this.setVolumeIcon(video.muted);
        this.noteInteraction();
      };
      speed.onchange = () => { video.playbackRate = Number(speed.value) || 1; this.noteInteraction(); };
      fullscreen.onclick = () => this.toggleFullscreen();
    }

    onStageClick(event) {
      if (!this.video || ![this.video, this.stage].includes(event.target)) return;
      const touchInteraction = event.pointerType === 'touch' || this.lastStagePointerType === 'touch'
        || (this.touchMode && !event.pointerType && !this.lastStagePointerType);
      this.lastStagePointerType = '';
      if (!touchInteraction) return this.togglePlayback();
      if (this.root.dataset.controls === 'visible' && !this.video.paused && !this.seeking) this.hideControls();
      else this.noteInteraction();
    }

    onKeydown(event) {
      if (isEditableTarget(event.target) || !this.video) return;
      const key = event.key.toLowerCase();
      if (![' ', 'enter', 'm', 'f', 'arrowleft', 'arrowright'].includes(key)) return;
      event.preventDefault();
      this.noteInteraction();
      if (key === ' ' || key === 'enter') this.togglePlayback();
      if (key === 'm') this.container.querySelector('[data-player-mute]').click();
      if (key === 'f') this.toggleFullscreen();
      if (key === 'arrowleft' || key === 'arrowright') {
        this.video.currentTime = clamp(this.video.currentTime + (key === 'arrowleft' ? -5 : 5), 0, this.video.duration || Number.MAX_SAFE_INTEGER);
      }
    }

    togglePlayback() {
      const video = this.video;
      if (!video) return;
      this.showControls(false);
      if (video.paused) video.play().catch(() => this.showFinalError('El navegador no permitió iniciar la reproducción.'));
      else video.pause();
    }

    setPlaybackIcons(playing) {
      const markup = icon(playing ? 'pause' : 'play');
      for (const button of [this.container.querySelector('[data-player-play]'), this.center]) {
        button.innerHTML = markup;
        button.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
      }
    }

    setVolumeIcon(muted) {
      const button = this.container.querySelector('[data-player-mute]');
      button.innerHTML = icon(muted ? 'mute' : 'volume');
      button.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar');
    }

    noteInteraction() {
      this.showControls(false);
      this.scheduleControlsHide();
    }

    showControls(restartTimer = true) {
      global.clearTimeout(this.controlsTimer);
      this.root.dataset.controls = 'visible';
      this.controls.setAttribute('aria-hidden', 'false');
      this.controls.inert = false;
      const mayShowCenter = Boolean(this.video && !['loading', 'error', 'fallback'].includes(this.root.dataset.playerState));
      this.center.classList.toggle('hidden', !mayShowCenter);
      this.center.inert = !mayShowCenter;
      if (restartTimer) this.scheduleControlsHide();
    }

    scheduleControlsHide() {
      global.clearTimeout(this.controlsTimer);
      if (!this.video || this.video.paused || this.video.ended || this.seeking || this.root.dataset.playerState !== 'playing') return;
      this.controlsTimer = global.setTimeout(() => this.hideControls(), AUTO_HIDE_MS);
    }

    hideControls() {
      if (!this.video || this.video.paused || this.video.ended || this.seeking || this.root.dataset.playerState !== 'playing') return;
      global.clearTimeout(this.controlsTimer);
      this.root.dataset.controls = 'hidden';
      this.controls.setAttribute('aria-hidden', 'true');
      this.controls.inert = true;
      this.center.classList.add('hidden');
      this.center.inert = true;
    }

    renderState(state, message = '') {
      if (this.destroyed) return;
      this.root.dataset.playerState = state;
      const statusVisible = ['loading', 'buffering', 'switching'].includes(state);
      this.status.classList.toggle('hidden', !statusVisible);
      if (message) this.status.querySelector('small').textContent = message;
      this.error.classList.add('hidden');
      if (['paused', 'ready', 'buffering', 'seeking', 'ended', 'error'].includes(state)) this.showControls(false);
      if (state === 'playing') {
        this.status.classList.add('hidden');
        this.showControls(false);
        this.scheduleControlsHide();
      }
      if (state === 'fallback') {
        this.controls.classList.add('hidden');
        this.center.classList.add('hidden');
      }
    }

    handleVideoFailure() {
      if (this.destroyed) return;
      this.clearSourceTimer();
      if (String(this.config.provider || '').toUpperCase() === 'ARCHIVE') {
        const progress = this.snapshot();
        if (progress.position > 0 && progress.duration > 0) this.options.onPause?.(progress);
        this.renderState('switching', 'Cambiando a reproductor compatible…');
        return this.advanceArchiveFallback();
      }
      this.showFinalError('No se pudo abrir la fuente de este episodio.');
    }

    advanceArchiveFallback() {
      const next = this.archiveFallbacks().find(candidate => !this.archiveAttempts.has(candidate.url));
      if (!next) {
        this.playbackMode = ARCHIVE_MODES.FAILED;
        return this.showFinalError('Ninguna de las alternativas disponibles pudo abrir el episodio.');
      }
      this.archiveAttempts.add(next.url);
      this.playbackMode = next.mode || (this.archiveAttempts.size === 1 ? ARCHIVE_MODES.FILE_EMBED : ARCHIVE_MODES.ITEM_EMBED);
      this.renderState('switching', 'Cambiando a reproductor compatible…');
      this.mountArchiveIframe(next);
    }

    mountArchiveIframe(candidate) {
      this.clearSourceTimer();
      this.releaseVideo();
      this.stage.innerHTML = '';
      this.controls.classList.add('hidden');
      this.center.classList.add('hidden');
      const frame = document.createElement('iframe');
      frame.title = this.options.title || 'Reproductor compatible de Archive.org';
      frame.allow = 'fullscreen; autoplay';
      frame.allowFullscreen = true;
      frame.loading = 'eager';
      frame.onload = () => {
        if (this.frame !== frame) return;
        this.clearSourceTimer();
        this.renderState('fallback');
      };
      frame.onerror = () => { if (this.frame === frame) this.advanceArchiveFallback(); };
      frame.src = candidate.url;
      this.frame = frame;
      this.stage.append(frame);
      this.sourceTimer = global.setTimeout(() => {
        if (this.frame === frame) this.advanceArchiveFallback();
      }, EMBED_TIMEOUT_MS);
    }

    showFinalError(message) {
      if (this.destroyed) return;
      this.clearSourceTimer();
      global.clearTimeout(this.controlsTimer);
      this.root.dataset.playerState = 'error';
      this.status.classList.add('hidden');
      this.error.classList.remove('hidden');
      this.error.querySelector('[data-player-error-message]').textContent = message;
      this.showControls(false);
      this.options.onError?.(message);
    }

    retry() {
      this.clearSourceTimer();
      this.archiveAttempts.clear();
      this.playbackMode = null;
      this.initialTime = this.lastPosition || this.initialTime;
      this.error.classList.add('hidden');
      this.frame = null;
      this.stage.innerHTML = '';
      this.renderState('loading', 'Reintentando el episodio…');
      this.loadPrimary();
    }

    useFallback() {
      if (String(this.config.provider || '').toUpperCase() === 'ARCHIVE') return this.advanceArchiveFallback();
      const fallback = this.config.fallback;
      if (!fallback?.url) return this.showFinalError('No existe un reproductor alternativo para este episodio.');
      this.stage.innerHTML = '';
      const frame = document.createElement('iframe');
      frame.src = fallback.url;
      frame.title = this.options.title || 'Reproductor compatible';
      frame.allow = 'fullscreen; autoplay';
      frame.allowFullscreen = true;
      this.frame = frame;
      this.stage.append(frame);
      this.renderState('fallback');
    }

    toggleFullscreen() {
      if (document.fullscreenElement && document.exitFullscreen) return document.exitFullscreen().catch(() => {});
      if (this.root.requestFullscreen) return this.root.requestFullscreen().catch(() => {});
      if (this.video?.webkitEnterFullscreen) this.video.webkitEnterFullscreen();
    }

    clearSourceTimer() {
      global.clearTimeout(this.sourceTimer);
      this.sourceTimer = 0;
    }

    snapshot() {
      return {
        position: this.video?.currentTime || this.lastPosition || 0,
        duration: this.video?.duration || this.lastDuration || 0,
        paused: this.video?.paused ?? true
      };
    }

    destroy() {
      if (this.destroyed) return;
      const snapshot = this.snapshot();
      this.destroyed = true;
      this.clearSourceTimer();
      global.clearTimeout(this.controlsTimer);
      document.removeEventListener('visibilitychange', this.boundVisibility);
      this.root.removeEventListener('keydown', this.boundKeydown);
      this.releaseVideo();
      this.frame = null;
      this.options.onDestroy?.(snapshot);
      this.container.innerHTML = '';
    }
  }

  global.DubversePlayer = DubversePlayer;
  global.DUBVERSE_WATCH_COMPLETE_THRESHOLD = 0.92;
})(window);
