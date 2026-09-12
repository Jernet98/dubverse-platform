(function bootstrapAnalytics(global) {
  let pending = Promise.resolve();
  const send = (event, keepalive = false) => {
    pending = pending.then(() => fetch('/api/analytics', {
      method: 'POST', credentials: 'same-origin', keepalive,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event)
    })).catch(() => null);
    return pending;
  };

  class PlaybackAnalytics {
    constructor(episodeId) {
      this.episodeId = episodeId;
      this.playbackId = crypto.randomUUID();
      this.started = false;
      this.lastPosition = null;
      this.watchedSeconds = 0;
      this.sent = new Set();
      this.pending = Promise.resolve();
    }
    event(eventType, keepalive = false) {
      if (this.sent.has(eventType)) return;
      this.sent.add(eventType);
      const payload = { eventType, episodeId: this.episodeId, playbackId: this.playbackId };
      this.pending = this.pending.then(() => send(payload, keepalive));
    }
    start() {
      if (this.started) return;
      this.started = true;
      this.event('PLAY_START');
    }
    progress(snapshot) {
      if (!this.started || !snapshot || !Number.isFinite(Number(snapshot.duration)) || Number(snapshot.duration) <= 0) return;
      const position = Number(snapshot.position);
      if (!Number.isFinite(position) || position < 0) return;
      if (!snapshot.paused && this.lastPosition !== null) {
        const delta = position - this.lastPosition;
        // Un seek o cambio de fuente no cuenta como minutos realmente reproducidos.
        if (delta > 0 && delta <= 5) this.watchedSeconds += delta;
      }
      this.lastPosition = position;
      const ratio = this.watchedSeconds / Number(snapshot.duration);
      for (const [threshold, type] of [[.25,'PLAY_25'],[.50,'PLAY_50'],[.75,'PLAY_75'],[.90,'PLAY_90']]) {
        if (ratio >= threshold) this.event(type);
      }
      if (ratio >= .92) this.event('PLAY_COMPLETE');
    }
    complete() { if (this.started) this.event('PLAY_COMPLETE', true); }
  }

  global.DubverseAnalytics = {
    trackProject: projectId => void send({ eventType: 'PROJECT_VIEW', projectId }),
    trackEpisode: episodeId => void send({ eventType: 'EPISODE_VIEW', episodeId }),
    Playback: PlaybackAnalytics
  };
})(window);
