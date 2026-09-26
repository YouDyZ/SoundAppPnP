(function () {
  const API_SRC = 'https://w.soundcloud.com/player/api.js';

  let apiReady = false;
  const pendingCreations = [];
  const widgets = new Map();
  const readyFlags = new Map();
  const pendingActions = new Map();
  const positions = new Map(); // id -> seconds, kept fresh by PLAY_PROGRESS
  const settings = new Map(); // id -> { loop, volume, sourceUrl }

  /**
   * The SoundCloud widget has no loop/shuffle of its own, so "Endlos" is done
   * here: when a sound finishes and the layer wants to loop, it is restarted.
   */
  function ensureApiScriptLoaded() {
    if (window.SC && window.SC.Widget) {
      apiReady = true;
      flushPendingCreations();
      return;
    }
    if (document.getElementById('soundcloud-widget-api')) return;
    const tag = document.createElement('script');
    tag.id = 'soundcloud-widget-api';
    tag.src = API_SRC;
    tag.addEventListener('load', () => {
      apiReady = true;
      flushPendingCreations();
    });
    document.head.appendChild(tag);
  }

  function flushPendingCreations() {
    const queued = pendingCreations.splice(0, pendingCreations.length);
    queued.forEach((fn) => fn());
  }

  function initApi() {
    ensureApiScriptLoaded();
  }

  function flushPendingActionsFor(id, widget) {
    const queue = pendingActions.get(id);
    if (!queue) return;
    pendingActions.delete(id);
    queue.forEach((fn) => fn(widget));
  }

  function withWidget(id, fn) {
    const widget = widgets.get(id);
    if (!widget) return;
    if (readyFlags.get(id)) {
      fn(widget);
    } else {
      const queue = pendingActions.get(id) || [];
      queue.push(fn);
      pendingActions.set(id, queue);
    }
  }

  function widgetUrl(sourceUrl) {
    const params = new URLSearchParams({
      url: sourceUrl,
      auto_play: 'false',
      hide_related: 'true',
      show_comments: 'false',
      show_user: 'true',
      show_teaser: 'false',
      visual: 'false',
    });
    return `https://w.soundcloud.com/player/?${params.toString()}`;
  }

  /**
   * Creates the widget iframe inside containerEl.
   * handlers: { onReady, onStateChange, onError, onStalled } — mirrors the
   * YouTube wrapper so both providers are interchangeable for the app.
   * onStateChange receives { playing: boolean }.
   */
  function createPlayer(id, containerEl, { sourceUrl, startSeconds = 0, volume = 80, loop = false }, handlers = {}) {
    settings.set(id, { loop: !!loop, volume, sourceUrl });

    const build = () => {
      const iframe = document.createElement('iframe');
      iframe.className = 'sc-widget';
      iframe.allow = 'autoplay';
      iframe.setAttribute('scrolling', 'no');
      iframe.setAttribute('frameborder', 'no');
      iframe.src = widgetUrl(sourceUrl);
      containerEl.replaceWith(iframe);

      const widget = window.SC.Widget(iframe);
      widgets.set(id, widget);

      widget.bind(window.SC.Widget.Events.READY, () => {
        readyFlags.set(id, true);
        try { widget.setVolume(volume); } catch { /* ignore */ }
        if (startSeconds > 0) {
          try { widget.seekTo(startSeconds * 1000); } catch { /* ignore */ }
        }
        flushPendingActionsFor(id, widget);
        handlers.onReady?.({ target: widget });
      });

      widget.bind(window.SC.Widget.Events.PLAY, () => handlers.onStateChange?.({ playing: true }));
      widget.bind(window.SC.Widget.Events.PAUSE, () => handlers.onStateChange?.({ playing: false }));
      widget.bind(window.SC.Widget.Events.FINISH, () => {
        handlers.onStateChange?.({ playing: false });
        if (settings.get(id)?.loop) {
          try {
            widget.seekTo(0);
            widget.play();
          } catch { /* ignore */ }
        }
      });
      widget.bind(window.SC.Widget.Events.PLAY_PROGRESS, (data) => {
        positions.set(id, (data?.currentPosition || 0) / 1000);
      });
      widget.bind(window.SC.Widget.Events.ERROR, () => {
        handlers.onError?.({ data: 'soundcloud' });
      });
    };

    if (apiReady && window.SC && window.SC.Widget) {
      build();
    } else {
      pendingCreations.push(build);
      ensureApiScriptLoaded();
    }
  }

  function playLayer(id, startSeconds = 0, { isPlaylist = false } = {}) {
    withWidget(id, (widget) => {
      if (!isPlaylist && startSeconds > 0) {
        try { widget.seekTo(startSeconds * 1000); } catch { /* ignore */ }
      }
      try { widget.play(); } catch { /* ignore */ }
    });
  }

  function stopLayer(id, startSeconds = 0, { isPlaylist = false } = {}) {
    withWidget(id, (widget) => {
      try { widget.pause(); } catch { /* ignore */ }
      if (!isPlaylist) {
        try { widget.seekTo((startSeconds || 0) * 1000); } catch { /* ignore */ }
        positions.set(id, startSeconds || 0);
      }
    });
  }

  function setLayerVolume(id, volume) {
    const current = settings.get(id);
    if (current) current.volume = volume;
    withWidget(id, (widget) => {
      try { widget.setVolume(volume); } catch { /* ignore */ }
    });
  }

  function nextVideo(id) {
    withWidget(id, (widget) => {
      try { widget.next(); } catch { /* ignore */ }
    });
  }

  function previousVideo(id) {
    withWidget(id, (widget) => {
      try { widget.prev(); } catch { /* ignore */ }
    });
  }

  function setLayerLoop(id, enabled) {
    const current = settings.get(id);
    if (current) current.loop = !!enabled;
  }

  /** The widget exposes no shuffle; the app hides the control for SoundCloud. */
  function setLayerShuffle() { /* not supported */ }

  function setLayerQueue() { /* SoundCloud sets are owned by SoundCloud */ }

  /**
   * Position is only available through callbacks, so the newest PLAY_PROGRESS
   * value is cached and returned synchronously — same contract as YouTube's.
   */
  function getCurrentTime(id) {
    return positions.get(id) || 0;
  }

  function isLayerReady(id) {
    return !!readyFlags.get(id);
  }

  function getPlayer(id) {
    return widgets.get(id);
  }

  /**
   * Asks the widget for the current track's title. Async by nature, so the
   * result is handed back through a callback instead of a return value.
   */
  function fetchCurrentTitle(id, callback) {
    withWidget(id, (widget) => {
      try {
        widget.getCurrentSound((sound) => {
          if (!sound) return callback('');
          const artist = sound.user?.username ? `${sound.user.username} – ` : '';
          callback(sound.title ? `${artist}${sound.title}` : '');
        });
      } catch {
        callback('');
      }
    });
  }

  function getPlaylistPosition(id, callback) {
    withWidget(id, (widget) => {
      try {
        widget.getSounds((sounds) => {
          widget.getCurrentSoundIndex((index) => {
            widget.getCurrentSound((sound) => {
              callback({
                title: sound?.title || '',
                index: typeof index === 'number' ? index : -1,
                total: Array.isArray(sounds) ? sounds.length : 0,
              });
            });
          });
        });
      } catch {
        callback(null);
      }
    });
  }

  function destroyPlayer(id) {
    const widget = widgets.get(id);
    if (widget) {
      try { widget.unbind(window.SC.Widget.Events.PLAY_PROGRESS); } catch { /* ignore */ }
    }
    widgets.delete(id);
    readyFlags.delete(id);
    pendingActions.delete(id);
    positions.delete(id);
    settings.delete(id);
  }

  /** Plays a one-shot sound from `startSeconds`, stopping again at `endSeconds`. */
  function playOnce(id, { startSeconds = 0, endSeconds = null, volume = 80 } = {}) {
    withWidget(id, (widget) => {
      try {
        widget.setVolume(volume);
        widget.seekTo((startSeconds || 0) * 1000);
        widget.play();
      } catch { /* ignore */ }
      if (endSeconds == null || endSeconds <= startSeconds) return;
      // The widget has no end point, so playback is stopped by the clock.
      const stopAfterMs = (endSeconds - startSeconds) * 1000;
      setTimeout(() => {
        try { widget.pause(); } catch { /* ignore */ }
      }, stopAfterMs);
    });
  }

  window.SB = window.SB || {};
  window.SB.soundcloudApi = {
    initApi,
    createPlayer,
    playLayer,
    stopLayer,
    playOnce,
    setLayerVolume,
    setLayerQueue,
    nextVideo,
    previousVideo,
    setLayerLoop,
    setLayerShuffle,
    getPlaylistPosition,
    fetchCurrentTitle,
    getCurrentTime,
    isLayerReady,
    getPlayer,
    destroyPlayer,
  };
})();
