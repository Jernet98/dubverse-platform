(function bootstrapDubversePlayer(global) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const timeLabel = value => {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
  };
  const archiveUrl = value => {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && url.hostname === 'archive.org' && url.pathname.startsWith('/download/') ? url.toString() : '';
    } catch { return ''; }
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
      this.loadToken = 0;
      this.autoQuality = this.config.provider === 'ARCHIVE';
      this.variants = this.archiveVariants();
      this.failedVariants = new Set();
      this.variantIndex = -1;
      this.wantedPlay = false;
      this.switching = false;
      this.suppressPause = false;
      this.initialGate = true;
      this.lastSwitchAt = 0;
      this.lastStallAt = 0;
      this.stallTimer = null;
      this.controlsTimer = null;
      this.upgradeTimer = null;
      this.boundVisibility = () => this.renderState(document.hidden ? 'paused' : this.video?.paused ? 'paused' : 'playing');
      this.boundKeydown = event => this.onKeydown(event);
      this.render();
    }

    archiveVariants() {
      if (this.config.provider !== 'ARCHIVE') return [];
      return (Array.isArray(this.config.variants) ? this.config.variants : [])
        .map(variant => ({ ...variant, url: archiveUrl(variant?.url) }))
        .filter(variant => variant.url)
        .sort((left, right) => this.variantMetric(left) - this.variantMetric(right));
    }

    variantMetric(variant) {
      const bitrate = Number(variant?.estimatedBitrate);
      if (Number.isFinite(bitrate) && bitrate > 0) return bitrate;
      const height = Number(variant?.height);
      if (Number.isFinite(height) && height > 0) return height * 1_000_000;
      return Number(variant?.size) || Number.MAX_SAFE_INTEGER;
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
              <select class="dv-player-quality hidden" aria-label="Calidad de reproducción"><option value="auto">Auto</option></select>
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
      this.quality = this.container.querySelector('.dv-player-quality');
      this.container.querySelector('[data-player-retry]').onclick = () => this.retry();
      this.container.querySelector('[data-player-fallback]').onclick = () => this.useFallback();
      document.addEventListener('visibilitychange', this.boundVisibility);
      this.root.addEventListener('keydown', this.boundKeydown);
      this.root.addEventListener('pointermove', () => this.showControls());
      this.root.addEventListener('pointerdown', () => this.showControls());
      this.updateQualityMenu();
      this.loadPrimary();
      if (this.variants.length > 1) this.upgradeTimer = setInterval(() => this.maybeUpgrade(), 10000);
    }

    loadPrimary() {
      let source = this.config.source;
      if (this.variants.length) {
        this.variantIndex = this.chooseInitialVariant();
        this.lastSwitchAt = Date.now();
        this.lastStallAt = Date.now();
        source = { kind: 'VIDEO', url: this.variants[this.variantIndex].url };
      }
      if (!source?.url) {
        if (this.config.fallback?.url) return this.useFallback();
        return this.showError('El episodio no tiene una fuente reproducible configurada.');
      }
      if (source.kind === 'HLS') {
        const probe = document.createElement('video');
        if (!probe.canPlayType('application/vnd.apple.mpegurl')) return this.showError('Este navegador no admite la fuente HLS de forma nativa.');
      }
      this.mountVideo(source, { restoreTime: this.initialTime, reason: 'inicio' });
    }

    chooseInitialVariant() {
      if (this.variants.length < 2) return 0;
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const downlink = Number(connection?.downlink);
      if (Number.isFinite(downlink) && downlink > 0) {
        const target = downlink * 0.58 * 1_000_000;
        const fitting = this.variants.map((variant, index) => ({ index, bitrate: Number(variant.estimatedBitrate) || Infinity })).filter(item => item.bitrate <= target);
        if (fitting.length) return fitting[fitting.length - 1].index;
        return 0;
      }
      return Math.floor((this.variants.length - 1) / 2);
    }

    mountVideo(source, { restoreTime = 0, resume = false, reason = '' } = {}) {
      const token = ++this.loadToken;
      this.switching = Boolean(this.video);
      if (this.video) {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      }
      this.stage.innerHTML = '';
      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = this.config.provider === 'ARCHIVE' ? 'auto' : 'metadata';
      video.poster = this.options.poster || '';
      video.src = source.url;
      video.setAttribute('aria-label', this.options.title || 'Reproductor de Dubverse');
      this.stage.append(video);
      this.video = video;
      this.controls.classList.remove('hidden');
      this.bindVideo(video, token);
      this.renderState('loading', reason === 'inicio' ? 'Preparando la fuente del episodio.' : 'Conservando tu posición…');
      video.addEventListener('loadedmetadata', () => {
        if (token !== this.loadToken || this.destroyed) return;
        const total = Number(video.duration) || 0;
        const position = Math.max(restoreTime, this.initialTime);
        if (position > 0 && (!total || position < total - 1)) {
          try { video.currentTime = position; } catch {}
        }
        this.initialTime = 0;
        this.updateTimeline();
        this.switching = false;
        if (resume) this.waitForBuffer(4, 10000, token).then(() => {
          if (token === this.loadToken && this.wantedPlay) video.play().catch(() => this.showError('El navegador no permitió reanudar la reproducción.'));
        });
      }, { once: true });
      video.load();
      this.updateQualityMenu();
      this.devLog('quality', { reason, variant: this.variants[this.variantIndex]?.name || source.url });
    }

    bindVideo(video, token) {
      const play = this.container.querySelector('[data-player-play]');
      const mute = this.container.querySelector('[data-player-mute]');
      const seek = this.container.querySelector('.dv-player-seek');
      const volume = this.container.querySelector('.dv-player-volume');
      const speed = this.container.querySelector('.dv-player-speed');
      const fullscreen = this.container.querySelector('[data-player-fullscreen]');
      video.addEventListener('loadedmetadata', () => this.updateTimeline());
      video.addEventListener('durationchange', () => this.updateTimeline());
      video.addEventListener('progress', () => this.updateTimeline());
      video.addEventListener('timeupdate', () => this.updateTimeline());
      video.addEventListener('canplay', () => this.renderState(video.paused ? 'ready' : 'playing'));
      video.addEventListener('playing', () => {
        this.wantedPlay = true;
        play.textContent = '❚❚';
        play.setAttribute('aria-label', 'Pausar');
        this.renderState('playing');
        this.showControls();
      });
      video.addEventListener('pause', () => {
        if (token !== this.loadToken || this.switching || this.suppressPause) return;
        this.wantedPlay = false;
        play.textContent = '▶';
        play.setAttribute('aria-label', 'Reproducir');
        this.renderState('paused');
        this.showControls(true);
        this.options.onPause?.({ position: video.currentTime, duration: video.duration });
      });
      video.addEventListener('waiting', () => this.handleStall('waiting', token));
      video.addEventListener('stalled', () => this.handleStall('stalled', token));
      video.addEventListener('seeking', () => this.renderState('buffering', 'Buscando la nueva posición…'));
      video.addEventListener('seeked', () => {
        const resume = this.wantedPlay || !video.paused;
        if (resume) {
          this.suppressPause = true;
          video.pause();
          this.suppressPause = false;
          this.wantedPlay = true;
          this.waitForBuffer(4, 10000, token).then(() => {
            if (token === this.loadToken && this.wantedPlay) video.play().catch(() => {});
          });
        } else this.renderState('paused');
        this.options.onSeek?.({ position: video.currentTime, duration: video.duration });
      });
      video.addEventListener('ended', () => {
        this.wantedPlay = false;
        this.renderState('ended');
        this.options.onEnded?.({ position: video.duration, duration: video.duration });
      });
      video.addEventListener('error', () => this.handleMediaError(token));
      play.onclick = () => video.paused ? this.requestPlay(token) : video.pause();
      this.stage.onclick = event => { if (event.target === video && matchMedia('(pointer:fine)').matches) play.click(); };
      seek.oninput = () => { if (video.duration) video.currentTime = Number(seek.value) / 1000 * video.duration; };
      volume.oninput = () => { video.volume = Number(volume.value); video.muted = video.volume === 0; mute.textContent = video.muted ? '🔇' : '🔊'; };
      mute.onclick = () => { video.muted = !video.muted; mute.textContent = video.muted ? '🔇' : '🔊'; };
      speed.onchange = () => { video.playbackRate = Number(speed.value) || 1; };
      fullscreen.onclick = () => {
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (this.root.requestFullscreen) this.root.requestFullscreen().catch(() => {});
        else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      };
      this.quality.onchange = () => {
        if (this.quality.value === 'auto') {
          this.autoQuality = true;
          const next = this.chooseInitialVariant();
          if (next !== this.variantIndex) this.switchVariant(next, 'modo Auto');
          return;
        }
        this.autoQuality = false;
        this.switchVariant(Number(this.quality.value), 'selección manual');
      };
    }

    requestPlay(token = this.loadToken) {
      if (!this.video) return;
      this.wantedPlay = true;
      const target = this.initialGate && this.config.provider === 'ARCHIVE' ? 8 : 0;
      this.waitForBuffer(target, 12000, token).then(() => {
        if (token !== this.loadToken || !this.wantedPlay || !this.video) return;
        this.initialGate = false;
        this.video.play().catch(() => this.showError('El navegador no permitió iniciar la reproducción.'));
      });
    }

    bufferAhead(video = this.video) {
      if (!video) return 0;
      const position = Number(video.currentTime) || 0;
      for (let index = 0; index < video.buffered.length; index += 1) {
        if (position >= video.buffered.start(index) - 0.25 && position <= video.buffered.end(index) + 0.25) return Math.max(0, video.buffered.end(index) - position);
      }
      return 0;
    }

    waitForBuffer(target, timeout, token) {
      if (!target || this.bufferAhead() >= target || this.video?.readyState >= 4) return Promise.resolve();
      this.renderState('buffering', `Preparando unos ${target} segundos de reproducción…`);
      const deadline = Date.now() + timeout;
      return new Promise(resolve => {
        const check = () => {
          if (this.destroyed || token !== this.loadToken || this.bufferAhead() >= target || this.video?.readyState >= 4 || Date.now() >= deadline) return resolve();
          setTimeout(check, 180);
        };
        check();
      });
    }

    handleStall(kind, token) {
      if (token !== this.loadToken || this.destroyed) return;
      this.lastStallAt = Date.now();
      this.renderState('buffering', 'La conexión está alcanzando al video…');
      this.options.onBuffering?.();
      this.devLog(kind, { bufferAhead: this.bufferAhead(), readyState: this.video?.readyState, networkState: this.video?.networkState });
      clearTimeout(this.stallTimer);
      this.stallTimer = setTimeout(() => {
        if (token === this.loadToken && this.video?.readyState < 3) this.maybeDowngrade(`${kind} prolongado`);
      }, 1500);
    }

    maybeDowngrade(reason) {
      if (!this.autoQuality || this.switching || this.variantIndex <= 0) return;
      if (Date.now() - this.lastSwitchAt < 9000) return;
      const next = this.variants.map((_, index) => index).filter(index => index < this.variantIndex && !this.failedVariants.has(index)).at(-1);
      if (Number.isInteger(next)) this.switchVariant(next, reason);
    }

    maybeUpgrade() {
      if (!this.autoQuality || this.switching || this.variantIndex < 0 || this.variantIndex >= this.variants.length - 1 || this.video?.paused) return;
      const stableFor = Date.now() - Math.max(this.lastStallAt, this.lastSwitchAt);
      const next = this.variants.map((_, index) => index).find(index => index > this.variantIndex && !this.failedVariants.has(index));
      if (Number.isInteger(next) && stableFor >= 60000 && this.bufferAhead() >= 20) this.switchVariant(next, 'reproducción estable');
    }

    switchVariant(index, reason, { force = false } = {}) {
      if (!this.variants[index] || index === this.variantIndex || this.switching) return;
      if (!force && Date.now() - this.lastSwitchAt < 9000) return;
      const position = Number(this.video?.currentTime) || this.lastPosition;
      const resume = this.wantedPlay || (this.video && !this.video.paused);
      this.variantIndex = index;
      this.lastSwitchAt = Date.now();
      this.wantedPlay = resume;
      this.devLog('quality-change', { reason, variant: this.variants[index].name, position });
      this.mountVideo({ kind: 'VIDEO', url: this.variants[index].url }, { restoreTime: position, resume, reason });
    }

    handleMediaError(token) {
      if (token !== this.loadToken || this.destroyed) return;
      this.devLog('media-error', { code: this.video?.error?.code, variant: this.variants[this.variantIndex]?.name });
      if (this.config.provider === 'ARCHIVE' && this.variantIndex >= 0) {
        this.failedVariants.add(this.variantIndex);
        const candidates = [
          ...this.variants.map((_, index) => index).filter(index => index < this.variantIndex).reverse(),
          ...this.variants.map((_, index) => index).filter(index => index > this.variantIndex)
        ];
        const next = candidates.find(index => !this.failedVariants.has(index));
        if (Number.isInteger(next)) return this.switchVariant(next, 'fuente rechazada', { force: true });
      }
      if (this.config.provider === 'ARCHIVE' && this.config.fallback?.url) return this.useFallback();
      this.showError(this.config.provider === 'ARCHIVE'
        ? 'Archive.org rechazó la fuente directa o el archivo no está disponible.'
        : 'El proveedor rechazó la fuente o el archivo no está disponible.');
    }

    updateTimeline() {
      const video = this.video;
      if (!video) return;
      const total = Number(video.duration) || 0;
      const position = Number(video.currentTime) || 0;
      this.lastPosition = position;
      const seek = this.container.querySelector('.dv-player-seek');
      seek.value = total ? String(Math.round(position / total * 1000)) : '0';
      this.container.querySelector('[data-player-current]').textContent = timeLabel(position);
      this.container.querySelector('[data-player-duration]').textContent = timeLabel(total);
      this.container.querySelector('.dv-player-buffer i').style.width = `${clamp(total ? (position + this.bufferAhead(video)) / total * 100 : 0, 0, 100)}%`;
      this.options.onProgress?.({ position, duration: total, paused: video.paused, ended: video.ended });
    }

    qualityLabel(variant, index) {
      const height = Number(variant.height);
      const bitrate = Number(variant.estimatedBitrate);
      if (height) return `${height}p`;
      if (bitrate) return `${(bitrate / 1_000_000).toFixed(1)} Mbps`;
      return variant.source === 'original' ? 'Original' : `Calidad ${index + 1}`;
    }

    updateQualityMenu() {
      if (!this.quality) return;
      this.quality.classList.toggle('hidden', this.variants.length < 2);
      this.quality.innerHTML = '<option value="auto">Auto</option>' + this.variants.map((variant, index) => `<option value="${index}">${this.qualityLabel(variant, index)}</option>`).join('');
      this.quality.value = this.autoQuality ? 'auto' : String(this.variantIndex);
    }

    showControls(force = false) {
      this.root.classList.remove('controls-hidden');
      clearTimeout(this.controlsTimer);
      if (!force && this.video && !this.video.paused && matchMedia('(pointer:fine)').matches) this.controlsTimer = setTimeout(() => this.root.classList.add('controls-hidden'), 2500);
    }

    onKeydown(event) {
      if (!this.video || event.target?.closest?.('input,select,textarea,button,[contenteditable="true"]')) return;
      const key = String(event.key || '').toLowerCase();
      if (![' ', 'enter', 'm', 'f', 'arrowleft', 'arrowright'].includes(key)) return;
      event.preventDefault();
      if (key === ' ' || key === 'enter') this.container.querySelector('[data-player-play]').click();
      if (key === 'm') this.container.querySelector('[data-player-mute]').click();
      if (key === 'f') this.container.querySelector('[data-player-fullscreen]').click();
      if (key === 'arrowleft' || key === 'arrowright') this.video.currentTime = clamp(this.video.currentTime + (key === 'arrowleft' ? -5 : 5), 0, this.video.duration || Number.MAX_SAFE_INTEGER);
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
      const position = Number(this.video?.currentTime) || this.lastPosition;
      const source = this.variants[this.variantIndex]?.url || this.config.source?.url;
      if (!source) return this.showError('No existe una fuente directa para reintentar.');
      this.error.classList.add('hidden');
      this.mountVideo({ kind: this.config.source?.kind || 'VIDEO', url: source }, { restoreTime: position, resume: this.wantedPlay, reason: 'reintento manual' });
    }

    useFallback() {
      if (this.fallbackUsed) return;
      const fallback = this.config.fallback;
      if (!fallback?.url) return this.showError('No existe un reproductor alternativo para este episodio.');
      this.fallbackUsed = true;
      this.wantedPlay = false;
      clearTimeout(this.stallTimer);
      this.video?.pause();
      this.video = null;
      this.controls.classList.add('hidden');
      this.error.classList.add('hidden');
      this.status.classList.remove('hidden');
      this.stage.innerHTML = `<iframe src="${String(fallback.url).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" title="${String(this.options.title || 'Reproductor compatible').replace(/"/g, '&quot;')}" allow="fullscreen; autoplay" allowfullscreen loading="eager"></iframe>`;
      this.root.dataset.playerState = 'fallback';
      this.devLog('fallback', { provider: this.config.provider });
      setTimeout(() => this.status.classList.add('hidden'), 700);
    }

    devLog(event, details = {}) {
      const host = String(location?.hostname || '');
      if (host === 'localhost' || host === '127.0.0.1') console.debug(`[DubversePlayer] ${event}`, details);
    }

    snapshot() {
      return { position: this.video?.currentTime || this.lastPosition || 0, duration: this.video?.duration || 0, paused: this.video?.paused ?? true };
    }

    destroy() {
      if (this.destroyed) return;
      const snapshot = this.snapshot();
      this.destroyed = true;
      this.loadToken += 1;
      clearTimeout(this.stallTimer);
      clearTimeout(this.controlsTimer);
      clearInterval(this.upgradeTimer);
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
