(function bootstrapPromotionalMediaPlayer(global) {
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const detect = value => {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { return { provider: 'INVALID', label: value ? 'URL inválida' : 'Pega una URL para detectar el proveedor' }; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { provider: 'INVALID', label: 'URL inválida' };
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const parts = url.pathname.split('/').filter(Boolean);
    const youtubeId = host === 'youtu.be' ? parts[0] : (host === 'youtube.com' || host.endsWith('.youtube.com')) ? (url.pathname === '/watch' ? url.searchParams.get('v') : /^(?:embed|shorts)$/.test(parts[0]) ? parts[1] : '') : '';
    if (/^[A-Za-z0-9_-]{6,20}$/.test(youtubeId || '')) return { provider: 'YOUTUBE', label: 'YouTube detectado' };
    if ((host === 'vimeo.com' || host.endsWith('.vimeo.com')) && parts.some(part => /^\d+$/.test(part))) return { provider: 'VIMEO', label: 'Vimeo detectado' };
    if ((host === 'tiktok.com' || host.endsWith('.tiktok.com')) && /\/(?:video|player\/v1)\/\d+/.test(url.pathname)) return { provider: 'TIKTOK', label: 'TikTok detectado' };
    if (host === 'archive.org' && /^(?:details|download|embed)\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?:\/|$)/.test(url.pathname.replace(/^\//, ''))) return { provider: 'ARCHIVE', label: 'Archive.org detectado' };
    if (/\.m3u8$/i.test(url.pathname)) return { provider: 'HLS', label: 'HLS detectado' };
    if (/\.(?:mp4|webm)$/i.test(url.pathname)) return { provider: 'DIRECT', label: 'Video directo detectado' };
    return { provider: 'OTHER', label: 'Proveedor no compatible con reproducción integrada' };
  };
  const trustedEmbed = playback => {
    let url;
    try { url = new URL(String(playback.url || '')); } catch { return false; }
    if (url.protocol !== 'https:' || url.searchParams.has('url')) return false;
    if (playback.kind === 'YOUTUBE') return url.hostname === 'www.youtube-nocookie.com' && url.pathname.startsWith('/embed/');
    if (playback.kind === 'VIMEO') return url.hostname === 'player.vimeo.com' && url.pathname.startsWith('/video/');
    if (playback.kind === 'TIKTOK') return url.hostname === 'www.tiktok.com' && url.pathname.startsWith('/player/v1/');
    if (playback.kind === 'ARCHIVE') return url.hostname === 'archive.org' && url.pathname.startsWith('/embed/');
    return false;
  };

  class PromotionalMediaPlayer {
    constructor(container, options = {}) {
      this.container = container;
      this.options = options;
      this.player = null;
      this.render();
    }

    render() {
      const playback = this.options.playback || {};
      this.container.classList.toggle('is-vertical', playback.kind === 'TIKTOK');
      const title = escapeHtml(this.options.title || 'Material promocional');
      const attribution = playback.attribution ? `<small class="promo-attribution">Contenido alojado por ${escapeHtml(playback.attribution)}</small>` : '';
      if (['YOUTUBE', 'VIMEO', 'ARCHIVE', 'TIKTOK'].includes(playback.kind) && trustedEmbed(playback)) {
        const vertical = playback.kind === 'TIKTOK' ? ' promo-player-vertical' : '';
        const allow = playback.kind === 'ARCHIVE' ? 'autoplay; fullscreen' : 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        this.container.innerHTML = `<div class="promotional-media${vertical}"><iframe src="${escapeHtml(playback.url)}" title="${title}" loading="eager" allow="${allow}" allowfullscreen></iframe>${attribution}</div>`;
        return;
      }
      if (['VIDEO', 'HLS'].includes(playback.kind) && playback.url && global.DubversePlayer) {
        this.container.innerHTML = '<div class="promotional-media-native"></div>';
        this.player = new global.DubversePlayer(this.container.querySelector('.promotional-media-native'), {
          title: this.options.title,
          poster: this.options.poster,
          playback: { source: { kind: playback.kind, url: playback.url }, fallback: null }
        });
        if (attribution) this.container.insertAdjacentHTML('beforeend', attribution);
        return;
      }
      this.container.innerHTML = `<div class="promo-unavailable" role="status"><strong>No se puede reproducir este material dentro de Dubverse.</strong><span>El proveedor no ofrece una integración compatible o la URL no es reconocida.</span>${attribution}</div>`;
    }

    destroy() {
      this.player?.destroy();
      this.player = null;
      this.container.classList.remove('is-vertical');
      this.container.innerHTML = '';
    }
  }

  PromotionalMediaPlayer.detect = detect;
  global.PromotionalMediaPlayer = PromotionalMediaPlayer;
})(window);
