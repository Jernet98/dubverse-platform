(function bootstrapDubversePlayer(global) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const finite = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const assets = {
    art: '/vendor/player/artplayer-5.4.0.js',
    es: '/vendor/player/artplayer-es-5.4.0.js',
    hls: '/vendor/player/hls-1.7.4.js'
  };
  const scripts = new Map();
  function loadScript(url) {
    if (!scripts.has(url)) {
      const pending = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => { script.remove(); reject(new Error('No se pudo cargar el reproductor.')); };
        document.head.append(script);
      }).catch(error => { scripts.delete(url); throw error; });
      scripts.set(url, pending);
    }
    return scripts.get(url);
  }
  const svg = path => `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  const skipIcon = forward => svg(`<path d="${forward ? 'M4 5v14l9-7zM14 5v14l9-7z' : 'M20 5v14l-9-7zM10 5v14l-9-7z'}"/>`);
  function archiveUrl(value, identifier) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:' || url.hostname !== 'archive.org' || !url.pathname.startsWith('/download/')) return '';
      if (identifier && decodeURIComponent(url.pathname.split('/')[2]) !== identifier) return '';
      return url.toString();
    } catch { return ''; }
  }

  class DubversePlayer {
    constructor(container, options = {}) {
      if (!container) throw new Error('DubversePlayer requiere un contenedor.');
      this.container = container;
      this.options = options;
      this.config = options.playback || {};
      this.initialTime = finite(options.initialTime);
      this.lastPosition = this.initialTime;
      this.lastDuration = 0;
      this.loadToken = 0;
      this.variantIndex = -1;
      this.failedVariants = new Set();
      this.variantSupport = new Map();
      this.variants = this.archiveVariants();
      this.autoQuality = this.config.provider === 'ARCHIVE';
      this.cleanups = [];
      this.render();
      this.ready = this.initialize().catch(() => this.showError('No se pudo cargar el reproductor. Reintenta para cargar sus componentes.'));
    }

    archiveVariants() {
      if (this.config.provider !== 'ARCHIVE') return [];
      return [...new Map((this.config.variants || []).map(variant => {
        const url = archiveUrl(variant?.url, this.config.identifier);
        return [url, { ...variant, url }];
      }).filter(([url]) => url)).values()].sort((a, b) => this.variantMetric(a) - this.variantMetric(b));
    }

    variantMetric(variant) {
      return Number(variant.estimatedBitrate) || Number(variant.height) * 1_000_000 || Number(variant.size) || Number.MAX_SAFE_INTEGER;
    }

    render() {
      this.container.innerHTML = `<div class="dv-player" data-player-state="loading">
        <div class="dv-player-stage"></div>
        <div class="dv-player-status" role="status"><span class="dv-player-spinner" aria-hidden="true"></span><strong>Cargando video…</strong><small>Preparando la fuente del episodio.</small></div>
        <div class="dv-player-error hidden" role="alert"><strong>No pudimos reproducir este video.</strong><span data-player-error-message></span><div><button type="button" data-player-retry>Reintentar</button><button class="hidden" type="button" data-player-recover>Probar otra calidad</button><button class="hidden" type="button" data-player-fallback>Usar reproductor compatible</button></div></div>
        <div class="dv-player-recovery hidden" role="status"><span data-recovery-message></span><button type="button" data-recover-image>Recuperar imagen</button><button class="${this.config.fallback?.url ? '' : 'hidden'}" type="button" data-recovery-fallback>Usar reproductor compatible</button><button type="button" data-dismiss-recovery aria-label="Cerrar aviso">Cerrar</button></div>
      </div>`;
      this.root = this.container.querySelector('.dv-player');
      this.stage = this.root.querySelector('.dv-player-stage');
      this.stage.inert = true;
      this.status = this.root.querySelector('.dv-player-status');
      this.error = this.root.querySelector('.dv-player-error');
      this.recoveryNotice = this.root.querySelector('.dv-player-recovery');
      this.root.querySelector('[data-player-retry]').onclick = () => this.retry();
      this.root.querySelector('[data-player-fallback]').onclick = () => this.useFallback();
      this.root.querySelector('[data-player-recover]').onclick = () => this.recoverImage();
      this.root.querySelector('[data-recover-image]').onclick = () => this.recoverImage();
      this.root.querySelector('[data-recovery-fallback]').onclick = () => this.useFallback();
      this.root.querySelector('[data-dismiss-recovery]').onclick = () => this.hideVideoRecovery();
    }

    async initialize() {
      if (!global.Artplayer) await loadScript(assets.art);
      if (!global.artplayerI18nEs) await loadScript(assets.es);
      if (this.destroyed || this.fallbackUsed) return;
      const Artplayer = global.Artplayer;
      // The adapter owns bounded recovery and restoration; ArtPlayer's separate
      // source-reload loop would otherwise race fallbacks and lose position.
      Artplayer.RECONNECT_TIME_MAX = 0;
      Artplayer.SETTING_ITEM_HEIGHT = 44;
      // Keep web fullscreen inside the host so the scoped theme and keys apply.
      Artplayer.FULLSCREEN_WEB_IN_BODY = false;
      this.art = new Artplayer({
        container: this.stage, url: '', poster: this.options.poster || '',
        theme: '#e7232d', lang: 'es', i18n: { es: global.artplayerI18nEs },
        autoplay: false, playsInline: true, setting: true, playbackRate: true,
        fullscreen: true, fullscreenWeb: true, hotkey: false, gesture: true,
        autoOrientation: true, autoPlayback: false, miniProgressBar: false,
        moreVideoAttr: { preload: this.config.provider === 'ARCHIVE' ? 'auto' : 'metadata' },
        controls: [-10, 10].map((seconds, index) => ({
          name: seconds < 0 ? 'backward' : 'forward', position: 'left', index: 11 + index,
          html: `<button class="dv-skip" type="button" aria-label="${seconds < 0 ? 'Retroceder' : 'Adelantar'} 10 segundos">${skipIcon(seconds > 0)}</button>`,
          tooltip: `${seconds < 0 ? '−' : '+'}10 s`, click: () => this.seekBy(seconds)
        }))
      });
      this.video = this.art.video;
      this.video.setAttribute('aria-label', this.options.title || 'Reproductor de Dubverse');
      this.setupControls();
      this.setupBuffer();
      this.setupSubtitles();
      this.art.setting.add({ name: 'dv-recover-image', html: 'Recuperar imagen', tooltip: 'Audio sin imagen', onClick: () => { this.recoverImage(); return ''; } });
      await this.prepareVariantSupport();
      if (this.destroyed || this.fallbackUsed) return;
      this.stage.inert = false;
      this.loadPrimary();
    }

    listen(target, event, handler) {
      target.addEventListener(event, handler);
      this.cleanups.push(() => target.removeEventListener(event, handler));
    }

    setupControls() {
      const player = this.art.template.$player;
      player.setAttribute('tabindex', '0');
      player.setAttribute('aria-label', 'Reproductor de video');
      this.listen(player, 'keydown', event => { this.keyboardMode = true; this.onKeydown(event); });
      const controls = this.art.template.$bottom;
      const keepVisible = () => { if (this.keyboardMode) this.controlsInteracting = true; this.showControls(); };
      const finish = () => {
        if (!this.controlsInteracting) return;
        this.controlsInteracting = false; this.showControls();
      };
      this.listen(controls, 'pointerdown', () => { this.keyboardMode = false; this.controlsInteracting = true; this.showControls(); });
      this.listen(global, 'pointerup', finish);
      this.listen(global, 'pointercancel', finish);
      this.listen(controls, 'focusin', keepVisible);
      this.listen(controls, 'focusout', finish);
      this.listen(player, 'pointermove', () => this.showControls());
      this.art.on('control', shown => {
        if (!shown && (this.controlsInteracting || this.art.setting.show || this.keyboardMode && controls.contains(document.activeElement))) this.art.controls.show = true;
      });
      this.art.on('setting', shown => { if (shown) this.showControls(); });
      const settings = this.art.template.$setting;
      const decorateSettings = () => settings.querySelectorAll('.art-setting-item').forEach(item => {
        item.setAttribute('tabindex', '0'); item.setAttribute('role', 'button');
      });
      const observer = new MutationObserver(decorateSettings);
      observer.observe(settings, { childList: true, subtree: true });
      this.cleanups.push(() => observer.disconnect());
      decorateSettings();
      this.listen(settings, 'keydown', event => {
        const item = event.target.closest('.art-setting-item');
        if (item && ['Enter', ' '].includes(event.key)) { event.preventDefault(); item.click(); }
      });
      for (const [name, label] of [['playAndPause', 'Reproducir o pausar'], ['volume', 'Volumen y silencio'], ['setting', 'Ajustes de reproducción'], ['fullscreen', 'Pantalla completa'], ['fullscreenWeb', 'Ampliar reproductor']]) {
        const control = this.art.controls[name];
        if (!control) continue;
        control.setAttribute('role', 'button');
        control.setAttribute('tabindex', '0');
        control.setAttribute('aria-label', label);
        this.listen(control, 'keydown', event => {
          if (event.target === control && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            if (name === 'volume') this.video.muted = !this.video.muted;
            else control.click();
          }
        });
      }
    }

    showControls() {
      if (!this.art || this.destroyed) return;
      this.art.controls.show = true;
      clearTimeout(this.controlsTimer);
      if (this.video && !this.video.paused) this.controlsTimer = setTimeout(() => {
        if (!this.controlsInteracting && !this.art.setting.show && !(this.keyboardMode && this.art.template.$bottom.contains(document.activeElement))) this.art.controls.show = false;
      }, 2500);
    }

    setupBuffer() {
      const progress = this.art.template.$progress;
      this.bufferLayer = document.createElement('div');
      this.bufferLayer.className = 'dv-buffer-ranges';
      this.bufferLayer.setAttribute('aria-hidden', 'true');
      progress.querySelector('.art-control-progress-inner').prepend(this.bufferLayer);
      progress.setAttribute('role', 'slider');
      progress.setAttribute('tabindex', '0');
      progress.setAttribute('aria-label', 'Posición del video');
      progress.setAttribute('aria-valuemin', '0');
      this.listen(progress, 'keydown', event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key === 'Home') this.video.currentTime = 0;
          else if (event.key === 'End' && finite(this.video.duration)) this.video.currentTime = this.video.duration;
          else this.seekBy(event.key === 'ArrowLeft' ? -5 : 5);
        }
      });
    }

    updateBuffer() {
      if (!this.video || !this.bufferLayer) return;
      const duration = finite(this.video.duration);
      const ranges = [];
      if (duration) for (let i = 0; i < this.video.buffered.length; i += 1) {
        const start = clamp(this.video.buffered.start(i) / duration * 100, 0, 100);
        const end = clamp(this.video.buffered.end(i) / duration * 100, start, 100);
        ranges.push(`<i style="left:${start}%;width:${end - start}%"></i>`);
      }
      this.bufferLayer.innerHTML = ranges.join('');
      const progress = this.art.template.$progress;
      progress.setAttribute('aria-valuemax', String(duration));
      progress.setAttribute('aria-valuenow', String(finite(this.video.currentTime)));
    }

    async prepareVariantSupport() {
      await Promise.all(this.variants.map(async (variant, index) => {
        const video = variant.video;
        const support = { supported: null, smooth: null };
        if (video?.hasVideo === false) support.supported = false;
        else if (video?.contentType && video.codec) {
          try {
            support.supported = Boolean(this.video.canPlayType(video.contentType));
            const width = Number(video.width || variant.width), height = Number(video.height || variant.height);
            const bitrate = Number(variant.estimatedBitrate), framerate = Number(video.framerate);
            if (support.supported && navigator.mediaCapabilities?.decodingInfo && width > 0 && height > 0 && bitrate > 0 && framerate > 0) {
              let timer;
              const result = await Promise.race([
                navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: video.contentType, width, height, bitrate, framerate } }),
                new Promise(resolve => { timer = setTimeout(() => resolve(null), 800); })
              ]).finally(() => clearTimeout(timer));
              if (result) { support.supported = result.supported; support.smooth = result.smooth; }
            }
          } catch { /* A missing/invalid capability response is unknown, not a codec ban. */ }
        }
        if (!this.destroyed) this.variantSupport.set(index, support);
      }));
    }

    playableVariants() {
      return this.variants.map((_, index) => index).filter(index => !this.failedVariants.has(index) && this.variantSupport?.get(index)?.supported !== false);
    }

    chooseInitialVariant() {
      const candidates = this.playableVariants().sort((a, b) =>
        Number(this.variants[a].video?.height || this.variants[a].height || 0) - Number(this.variants[b].video?.height || this.variants[b].height || 0)
        || this.variantMetric(this.variants[a]) - this.variantMetric(this.variants[b]));
      const smooth = candidates.filter(index => this.variantSupport?.get(index)?.smooth !== false);
      const pool = smooth.length ? smooth : candidates;
      if (!pool.length) return -1;
      const cheapest = () => [...pool].sort((a, b) => this.variantMetric(this.variants[a]) - this.variantMetric(this.variants[b]))[0];
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const downlink = Number(connection?.downlink);
      if (connection?.saveData) return cheapest();
      if (downlink > 0) {
        const fitting = pool.filter(index => (Number(this.variants[index].estimatedBitrate) || Infinity) <= downlink * .58 * 1_000_000);
        return fitting.at(-1) ?? cheapest();
      }
      return pool.at(-1);
    }

    loadPrimary() {
      let source = this.config.source;
      if (this.variants.length) {
        this.variantIndex = this.chooseInitialVariant();
        if (this.variantIndex < 0) return this.config.fallback?.url ? this.useFallback() : this.showError('No hay una variante compatible con este navegador.');
        source = { kind: 'VIDEO', url: this.variants[this.variantIndex].url };
      }
      if (!source?.url) return this.config.fallback?.url ? this.useFallback() : this.showError('El episodio no tiene una fuente reproducible configurada.');
      if (source.kind === 'IFRAME') return this.useFallback(source);
      this.mountVideo(source, { restoreTime: this.initialTime });
    }

    mountVideo(source, { restoreTime = 0, resume = false } = {}) {
      if (this.destroyed || this.fallbackUsed) return;
      const token = ++this.loadToken;
      this.stopFrameMonitor();
      this.hideVideoRecovery();
      this.mediaAbort?.abort();
      this.mediaAbort = new AbortController();
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
      clearTimeout(this.recoveryTimer);
      this.switching = true;
      this.restoring = restoreTime > 0;
      this.wantedPlay = resume;
      this.savedRate = this.video.playbackRate;
      this.savedVolume = this.video.volume;
      this.savedMuted = this.video.muted;
      this.video.pause();
      this.savedHlsLevel = this.hls && this.source?.url === source.url && !this.hls.autoLevelEnabled ? this.hls.loadLevel : null;
      this.hls?.destroy();
      this.hls = null;
      this.source = source;
      this.lastPosition = restoreTime;
      this.renderState('loading', restoreTime ? 'Conservando tu posición…' : 'Preparando la fuente del episodio.');
      this.art.template.$player.classList.remove('art-error');
      this.bindVideo(token, restoreTime);
      this.attachSource(source, token).catch(() => {
        if (token === this.loadToken && !this.destroyed) this.handleMediaError(token);
      });
      this.updateQualityMenu();
    }

    async attachSource(source, token) {
      const video = this.video;
      const hlsSource = source.kind === 'HLS' || /\.m3u8(?:$|[?#])/i.test(source.url);
      const nativeHls = Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
      const appleBrowser = navigator.vendor === 'Apple Computer, Inc.' || /iPad|iPhone|iPod/.test(navigator.userAgent || '');
      if (!hlsSource || nativeHls && appleBrowser) {
        this.art.url = source.url;
        return;
      }
      if (!global.Hls) await loadScript(assets.hls);
      if (this.destroyed || token !== this.loadToken || this.fallbackUsed) return;
      const Hls = global.Hls;
      if (!Hls.isSupported()) {
        if (nativeHls) { this.art.url = source.url; return; }
        return this.showError('Este navegador no admite esta fuente HLS.');
      }
      // Retain hls.js buffer/retry defaults. ABR applies only to manifest levels.
      const hls = this.hls = new Hls();
      let networkRecovery = false;
      let mediaRecovery = false;
      const active = () => !this.destroyed && token === this.loadToken && this.hls === hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!active()) return;
        if (this.savedHlsLevel !== null && this.savedHlsLevel >= 0 && this.savedHlsLevel < hls.levels.length) hls.loadLevel = this.savedHlsLevel;
        this.updateQualityMenu();
      });
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => { if (active()) this.updateSubtitleMenu(); });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!active() || !data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !networkRecovery) {
          networkRecovery = true;
          this.renderState('buffering', 'Reintentando la conexión…');
          this.recoveryTimer = setTimeout(() => { if (active()) hls.startLoad(); }, 1000);
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRecovery) {
          mediaRecovery = true;
          hls.recoverMediaError();
        } else this.handleMediaError(token);
      });
      hls.loadSource(source.url);
      hls.attachMedia(video);
    }

    bindVideo(token, restoreTime) {
      const video = this.video;
      const active = () => token === this.loadToken && !this.destroyed && !this.fallbackUsed;
      const on = (name, handler) => video.addEventListener(name, () => { if (active()) handler(); }, { signal: this.mediaAbort.signal });
      on('loadedmetadata', () => {
        this.lastDuration = finite(video.duration);
        video.playbackRate = this.savedRate || 1;
        if (Number.isFinite(this.savedVolume)) video.volume = this.savedVolume;
        if (typeof this.savedMuted === 'boolean') video.muted = this.savedMuted;
        if (restoreTime > 0) {
          const position = this.lastDuration ? Math.min(restoreTime, Math.max(0, this.lastDuration - .05)) : restoreTime;
          try { video.currentTime = position; } catch { this.restoring = false; }
        } else this.restoring = false;
        this.initialTime = 0;
        this.switching = false;
        this.updateBuffer();
        this.updateSubtitleMenu();
        this.renderState(video.paused ? 'ready' : 'playing');
        if (this.wantedPlay) this.requestPlay();
      });
      on('durationchange', () => { this.lastDuration = finite(video.duration); this.updateBuffer(); });
      on('progress', () => this.updateBuffer());
      on('timeupdate', () => {
        if (this.switching || this.restoring || video.seeking || video.error) return;
        this.lastPosition = finite(video.currentTime);
        this.updateBuffer();
        this.options.onProgress?.(this.snapshot());
      });
      on('play', () => { this.wantedPlay = true; });
      on('canplay', () => {
        this.frameWaiting = false;
        clearTimeout(this.stallTimer);
        this.stallTimer = null;
        this.renderState(video.paused ? 'ready' : 'playing');
      });
      on('playing', () => {
        this.frameWaiting = false;
        this.startFrameMonitor(token);
        clearTimeout(this.stallTimer);
        this.stallTimer = null;
        this.wantedPlay = true;
        this.renderState('playing');
        this.showControls();
        this.options.onPlaying?.();
      });
      on('pause', () => {
        if (this.switching || video.ended) return;
        this.wantedPlay = false;
        this.stopFrameMonitor();
        clearTimeout(this.stallTimer);
        this.stallTimer = null;
        this.renderState('paused');
        this.showControls();
        this.options.onPause?.(this.snapshot());
      });
      on('waiting', () => { this.frameWaiting = true; this.handleStall('waiting', token); });
      on('stalled', () => this.handleStall('stalled', token));
      on('seeking', () => {
        this.stopFrameMonitor();
        if (this.switching || this.restoring) return;
        this.renderState('buffering', 'Buscando la nueva posición…');
        // Reset Analytics' baseline so even a short seek is not watched time.
        this.options.onProgress?.({ ...this.snapshot(), paused: true });
      });
      on('seeked', () => {
        if (!video.paused) this.startFrameMonitor(token);
        if (this.restoring) { this.restoring = false; return; }
        if (this.switching) return;
        this.lastPosition = finite(video.currentTime);
        this.renderState(video.paused ? 'paused' : 'playing');
        this.options.onSeek?.(this.snapshot());
      });
      on('ended', () => {
        this.stopFrameMonitor();
        this.wantedPlay = false;
        this.renderState('ended');
        this.options.onEnded?.({ ...this.snapshot(), position: finite(video.duration) });
      });
      on('error', () => { if (!this.hls && video.error?.code !== 1) this.handleMediaError(token); });
    }

    requestPlay() {
      if (!this.video || this.destroyed || this.fallbackUsed) return;
      this.wantedPlay = true;
      const token = this.loadToken;
      // Immediate play preserves mobile user activation; no forced buffer gate.
      this.video.play().catch(error => {
        if (token !== this.loadToken || this.destroyed || error.name === 'AbortError') return;
        this.wantedPlay = false;
        if (error.name === 'NotAllowedError') { this.renderState('paused'); this.showControls(); }
        else this.showError('No se pudo iniciar el video. Reintenta la reproducción.');
      });
    }

    bufferAhead() {
      if (!this.video) return 0;
      const position = this.video.currentTime;
      for (let i = 0; i < this.video.buffered.length; i += 1) {
        if (position >= this.video.buffered.start(i) && position <= this.video.buffered.end(i)) return this.video.buffered.end(i) - position;
      }
      return 0;
    }

    frameCount() {
      try {
        const quality = this.video.getVideoPlaybackQuality?.();
        if (quality && Number.isFinite(quality.totalVideoFrames) && Number.isFinite(quality.droppedVideoFrames)) {
          return Math.max(0, quality.totalVideoFrames - quality.droppedVideoFrames - (Number(quality.corruptedVideoFrames) || 0));
        }
        if (Number.isFinite(this.video.webkitDecodedFrameCount)) return this.video.webkitDecodedFrameCount;
      } catch {}
      return null;
    }

    startFrameMonitor(token) {
      this.stopFrameMonitor();
      if (this.config.provider !== 'ARCHIVE' || !this.variants.length || this.video.paused) return;
      const video = this.video, now = Date.now();
      const state = this.frameMonitor = { token, warmUntil: now + 2000, lastNow: now, lastTime: video.currentTime, lastFrames: this.frameCount(), callbacks: 0, lastCallbacks: 0, wall: 0, media: 0, handled: false };
      const active = () => !this.destroyed && token === this.loadToken && this.frameMonitor === state;
      if (video.requestVideoFrameCallback) {
        const presented = () => {
          if (!active()) return;
          state.callbacks += 1;
          this.frameCallback = video.requestVideoFrameCallback(presented);
        };
        this.frameCallback = video.requestVideoFrameCallback(presented);
      }
      const sample = () => {
        if (!active()) return;
        this.checkVideoFrames();
        if (active()) this.frameTimer = setTimeout(sample, 1000);
      };
      this.frameTimer = setTimeout(sample, 1000);
    }

    checkVideoFrames(now = Date.now()) {
      const state = this.frameMonitor, video = this.video;
      if (!state || state.token !== this.loadToken || this.destroyed || !video) return;
      const frames = this.frameCount(), elapsed = (now - state.lastNow) / 1000;
      const advance = video.currentTime - state.lastTime;
      const progressed = state.callbacks > state.lastCallbacks || frames !== null && state.lastFrames !== null && frames > state.lastFrames;
      const rect = video.getBoundingClientRect?.();
      const inViewport = !rect || rect.bottom > 0 && rect.right > 0 && rect.top < (global.innerHeight || Infinity) && rect.left < (global.innerWidth || Infinity);
      const center = rect && document.elementFromPoint?.(clamp(rect.left + rect.width / 2, 0, (global.innerWidth || Infinity) - 1), clamp(rect.top + rect.height / 2, 0, (global.innerHeight || Infinity) - 1));
      const visible = !document.hidden && inViewport && (!center || this.root?.contains?.(center)) && this.root?.isConnected !== false && (!video.getClientRects || video.getClientRects().length > 0);
      const framerate = Number(this.variants[this.variantIndex]?.video?.framerate);
      const ready = visible && !document.pictureInPictureElement && !video.webkitCurrentPlaybackTargetIsWireless
        && !video.paused && !video.ended && !video.seeking && !video.error && !this.switching && !this.restoring && !this.frameWaiting
        && !(framerate > 0 && framerate < 1) && video.readyState >= 3 && (this.bufferAhead() >= 1 || video.readyState >= 4);
      if (!ready || elapsed > 2.5 || advance < 0 || advance > elapsed * (video.playbackRate || 1) + 2 || frames !== null && state.lastFrames !== null && frames < state.lastFrames) {
        state.warmUntil = now + 2000; state.wall = 0; state.media = 0;
      } else if (progressed) {
        state.wall = 0; state.media = 0; this.hideVideoRecovery();
      } else if (now >= state.warmUntil && advance > .01) {
        const observed = Math.max(0, (now - Math.max(state.lastNow, state.warmUntil)) / 1000);
        state.wall += observed; state.media += elapsed > 0 ? advance * observed / elapsed : 0;
      }
      state.lastNow = now; state.lastTime = video.currentTime; state.lastFrames = frames; state.lastCallbacks = state.callbacks;
      if (!state.handled && state.wall >= 6 && state.media >= 3) {
        state.handled = true;
        // No pixel sampling: a dark scene still presents frames. Counter failure
        // or compositor-only ambiguity offers an action, never a guessed switch.
        const variant = this.variants[this.variantIndex];
        const confirmed = frames !== null && (Number(video.videoWidth) > 0 || variant?.video?.hasVideo === true || Number(variant?.height) > 0);
        if (confirmed) this.failedVariants.add(this.variantIndex);
        const next = confirmed && this.autoQuality ? this.chooseInitialVariant() : -1;
        if (next >= 0 && next !== this.variantIndex) this.switchVariant(next);
        else this.showVideoRecovery(confirmed ? 'El audio avanza, pero no se registran fotogramas nuevos. Puedes recuperar la imagen.' : 'Si escuchas audio pero no ves imagen, prueba recuperar la reproducción.');
      }
    }

    stopFrameMonitor() {
      clearTimeout(this.frameTimer);
      if (this.frameCallback !== undefined) this.video?.cancelVideoFrameCallback?.(this.frameCallback);
      this.frameCallback = undefined;
      this.frameMonitor = null;
    }

    hideVideoRecovery() { this.recoveryNotice?.classList.add('hidden'); }

    showVideoRecovery(message) {
      if (this.destroyed || this.fallbackUsed || !this.recoveryNotice) return;
      this.recoveryNotice.querySelector('[data-recovery-message]').textContent = message;
      this.recoveryNotice.classList.remove('hidden');
      this.showControls();
    }

    recoverImage() {
      if (!this.video || this.destroyed || this.fallbackUsed) return;
      this.failedVariants.add(this.variantIndex);
      const next = this.chooseInitialVariant();
      if (next >= 0 && next !== this.variantIndex) this.switchVariant(next);
      else if (this.config.fallback?.url && this.video.error) this.useFallback();
      else this.retry();
      if (this.art) this.art.setting.show = false;
    }

    handleStall(kind, token) {
      // stalled can fire while the browser has plenty of playable media.
      if (!this.video || this.video.paused || this.video.ended || this.switching || this.bufferAhead() >= 1) return;
      this.renderState('buffering', 'Esperando datos del proveedor…');
      this.options.onBuffering?.();
      if (this.stallTimer) return;
      this.stallTimer = setTimeout(() => {
        this.stallTimer = null;
        if (token !== this.loadToken || this.destroyed || this.video?.paused || this.video?.readyState >= 3 || this.bufferAhead() >= 1) return;
        if (this.autoQuality && this.variantIndex > 0 && Date.now() - (this.lastSwitchAt || 0) >= 15000) {
          const next = this.playableVariants().filter(i => i < this.variantIndex).at(-1);
          if (next !== undefined) this.switchVariant(next, `${kind} prolongado`);
        }
      }, 6000);
    }

    switchVariant(index) {
      if (!this.variants[index] || index === this.variantIndex) return;
      const snapshot = this.snapshot();
      const resume = this.wantedPlay || !snapshot.paused;
      this.variantIndex = index;
      this.lastSwitchAt = Date.now();
      this.networkRetried = false;
      this.mountVideo({ kind: 'VIDEO', url: this.variants[index].url }, { restoreTime: snapshot.position, resume });
    }

    handleMediaError(token) {
      if (token !== this.loadToken || this.destroyed || this.fallbackUsed) return;
      const code = this.video?.error?.code;
      if (code === 2 && !this.networkRetried) {
        this.networkRetried = true;
        const snapshot = this.snapshot();
        const resume = this.wantedPlay || !snapshot.paused;
        this.renderState('buffering', 'Reintentando la conexión…');
        this.recoveryTimer = setTimeout(() => {
          if (token === this.loadToken && !this.destroyed) this.mountVideo(this.source, { restoreTime: snapshot.position, resume });
        }, 1000);
        return;
      }
      if (this.variants.length) {
        this.failedVariants.add(this.variantIndex);
        if (!this.autoQuality) return this.showError('La calidad seleccionada falló. Reintenta o elige otra calidad en Ajustes; también puedes usar el reproductor compatible.');
        const next = this.chooseInitialVariant();
        if (next >= 0) return this.switchVariant(next);
      }
      if (this.config.provider === 'ARCHIVE' && this.config.fallback?.url) return this.useFallback();
      this.showError('El proveedor rechazó la fuente o el archivo no está disponible.');
    }

    qualityLabel(variant, index) {
      return variant.height ? `${variant.height}p` : variant.estimatedBitrate ? `${(variant.estimatedBitrate / 1_000_000).toFixed(1)} Mbps` : variant.source === 'original' ? 'Original' : `Calidad ${index + 1}`;
    }

    updateQualityMenu() {
      if (!this.art) return;
      const hls = this.hls;
      let selector;
      if (hls?.levels.length > 1) selector = [
        { html: 'Auto', value: -1, default: hls.autoLevelEnabled },
        ...hls.levels.map((level, i) => ({ html: this.qualityLabel({ height: level.height, estimatedBitrate: level.bitrate }, i), value: i, default: !hls.autoLevelEnabled && hls.loadLevel === i }))
      ];
      else if (this.variants.length > 1) selector = [
        { html: 'Auto · MP4', value: -1, default: this.autoQuality },
        ...this.variants.map((variant, i) => ({ html: this.qualityLabel(variant, i), value: i, default: !this.autoQuality && this.variantIndex === i }))
      ];
      if (!selector) return;
      this.art.setting.update({
        name: 'dv-quality', html: 'Calidad', tooltip: selector.find(item => item.default)?.html || 'Auto', selector,
        onSelect: item => {
          if (this.hls) this.hls.loadLevel = Number(item.value); // keep buffered media
          else {
            this.autoQuality = Number(item.value) === -1;
            const next = this.autoQuality ? this.chooseInitialVariant() : Number(item.value);
            if (next >= 0) this.switchVariant(next);
            else this.showError('No hay otra variante compatible disponible. Prueba el reproductor compatible.');
          }
          return item.html;
        }
      });
    }

    setupSubtitles() {
      // Explicit tracks only. Never guess filenames from multi-episode items.
      for (const [index, track] of (this.config.subtitles || []).entries()) {
        let url;
        try { url = new URL(track.url, location.href); } catch { continue; }
        if (!['https:', 'http:'].includes(url.protocol)) continue;
        const node = document.createElement('track');
        node.kind = 'subtitles'; node.src = url.href;
        node.label = String(track.label || track.language || `Subtítulo ${index + 1}`);
        node.srclang = String(track.language || 'es');
        this.video.append(node);
      }
      this.listen(this.video.textTracks, 'addtrack', () => this.updateSubtitleMenu());
      this.updateSubtitleMenu();
    }

    updateSubtitleMenu() {
      if (!this.art || !this.video) return;
      const hlsTracks = this.hls?.subtitleTracks || [];
      const tracks = hlsTracks.length ? hlsTracks : [...this.video.textTracks].filter(track => ['subtitles', 'captions'].includes(track.kind));
      if (!tracks.length) return;
      const selected = hlsTracks.length ? this.hls.subtitleTrack : tracks.findIndex(track => track.mode === 'showing');
      this.art.setting.update({ name: 'dv-subtitles', html: 'Subtítulos', tooltip: selected < 0 ? 'Desactivados' : this.escapeLabel(tracks[selected]?.name || tracks[selected]?.label || 'Activados'),
        selector: [{ html: 'Desactivados', value: -1, default: selected < 0 }, ...tracks.map((track, i) => ({ html: this.escapeLabel(track.name || track.label || track.lang || `Pista ${i + 1}`), value: i, default: selected === i }))],
        onSelect: item => {
          if (hlsTracks.length) { this.hls.subtitleTrack = Number(item.value); this.hls.subtitleDisplay = Number(item.value) >= 0; }
          else tracks.forEach((track, i) => { track.mode = i === Number(item.value) ? 'showing' : 'disabled'; });
          return item.html;
        }
      });
    }

    escapeLabel(value) {
      const node = document.createElement('span'); node.textContent = String(value); return node.innerHTML;
    }

    seekBy(seconds) {
      if (this.video && finite(this.video.duration)) this.video.currentTime = clamp(this.video.currentTime + seconds, 0, this.video.duration);
    }

    onKeydown(event) {
      if (event.key === 'Escape' && this.art?.fullscreenWeb) {
        event.preventDefault(); this.art.fullscreenWeb = false; return;
      }
      if (!this.video || event.target.closest('input,select,textarea,button,[role="button"],[role="slider"],[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (![' ', 'enter', 'm', 'f', 'arrowleft', 'arrowright'].includes(key)) return;
      event.preventDefault();
      if (key === ' ' || key === 'enter') this.video.paused ? this.requestPlay() : this.video.pause();
      if (key === 'm') this.video.muted = !this.video.muted;
      if (key === 'arrowleft' || key === 'arrowright') this.seekBy(key === 'arrowleft' ? -5 : 5);
      if (key === 'f') {
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
        else if (this.video.webkitEnterFullscreen) this.video.webkitEnterFullscreen();
        else this.art.fullscreen = !this.art.fullscreen;
      }
      this.showControls();
    }

    renderState(state, message) {
      if (this.destroyed || this.fallbackUsed) return;
      this.root.dataset.playerState = state;
      this.status.classList.toggle('hidden', !['loading', 'buffering'].includes(state));
      this.status.querySelector('strong').textContent = state === 'buffering' ? 'Cargando video…' : 'Preparando video…';
      if (message) this.status.querySelector('small').textContent = message;
      this.error.classList.add('hidden');
    }

    showError(message) {
      if (this.destroyed || this.fallbackUsed) return;
      this.stopFrameMonitor();
      clearTimeout(this.stallTimer);
      this.root.dataset.playerState = 'error';
      this.status.classList.add('hidden');
      this.error.classList.remove('hidden');
      this.error.querySelector('[data-player-error-message]').textContent = message;
      this.error.querySelector('[data-player-fallback]').classList.toggle('hidden', !this.config.fallback?.url);
      this.error.querySelector('[data-player-recover]').classList.toggle('hidden', !this.video || !this.playableVariants().some(index => index !== this.variantIndex));
      this.options.onError?.(message);
    }

    retry() {
      if (this.destroyed || this.fallbackUsed) return;
      if (!this.art) { this.ready = this.initialize().catch(() => this.showError('No se pudo cargar el reproductor. Comprueba tu conexión.')); return; }
      this.networkRetried = false;
      this.failedVariants.clear();
      if (this.source) this.mountVideo(this.source, { restoreTime: this.snapshot().position, resume: this.wantedPlay });
      else this.loadPrimary();
    }

    releaseMedia() {
      this.stopFrameMonitor();
      ++this.loadToken;
      this.mediaAbort?.abort();
      clearTimeout(this.stallTimer);
      clearTimeout(this.recoveryTimer);
      clearTimeout(this.controlsTimer);
      this.cleanups.splice(0).forEach(cleanup => cleanup());
      this.hls?.destroy();
      this.hls = null;
      if (this.video) {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      }
      if (this.art?.fullscreenWeb) this.art.fullscreenWeb = false;
      this.art?.destroy();
      this.art = null;
      this.video = null;
    }

    useFallback(fallback = this.config.fallback) {
      if (this.destroyed || this.fallbackUsed) return;
      if (!fallback?.url) return this.showError('No existe un reproductor alternativo para este episodio.');
      const snapshot = this.snapshot();
      this.lastPosition = snapshot.position;
      this.lastDuration = snapshot.duration;
      this.fallbackUsed = true;
      this.wantedPlay = false;
      this.options.onPause?.(snapshot);
      this.releaseMedia();
      this.stage.replaceChildren();
      this.stage.inert = false;
      const iframe = document.createElement('iframe');
      iframe.src = fallback.url;
      iframe.title = this.options.title || 'Reproductor compatible';
      iframe.allow = 'fullscreen; autoplay';
      iframe.allowFullscreen = true;
      this.stage.append(iframe);
      this.root.dataset.playerState = 'fallback';
      this.status.classList.add('hidden');
      this.error.classList.add('hidden');
    }

    snapshot() {
      return { position: this.switching || this.restoring || this.video?.error ? this.lastPosition : finite(this.video?.currentTime ?? this.lastPosition), duration: finite(this.video?.duration) || this.lastDuration, paused: this.video?.paused ?? true, ended: this.video?.ended ?? false };
    }

    destroy() {
      if (this.destroyed) return;
      const snapshot = this.snapshot();
      this.destroyed = true;
      this.releaseMedia();
      this.options.onDestroy?.(snapshot);
      this.container.replaceChildren();
    }
  }

  global.DubversePlayer = DubversePlayer;
  global.DUBVERSE_WATCH_COMPLETE_THRESHOLD = 0.92;
})(window);
