(function () {
  let apiReady = false;
  const pendingCreations = [];
  const players = new Map();
  const readyFlags = new Map();
  const pendingActions = new Map();
  const readyWatchdogs = new Map();

  /**
   * How long a player may take to report onReady before we assume YouTube
   * refused to configure it (the usual cause is error 153 — see
   * describePlayerError/153 — which paints an error *inside* the iframe
   * without ever firing onError on the JS side).
   */
  const READY_TIMEOUT_MS = 8000;

  /**
   * YouTube only plays an embed when the embedding page identifies itself via
   * an HTTP Referer (see https://support.google.com/youtube/answer/171780,
   * "Provide a HTTP Referer header to enable video playback"). A page opened
   * straight from disk (file://) sends no Referer at all and its
   * window.location.origin is the *string* "null", which is not a valid value
   * for the player's `origin` parameter — passing it along is what produces
   * "Fehler bei der Konfiguration des Videoplayers / Fehler 153".
   */
  function getEmbedContext() {
    const protocol = window.location.protocol;
    const isHttp = protocol === 'http:' || protocol === 'https:';
    const origin = window.location.origin;
    const hasUsableOrigin = isHttp && !!origin && origin !== 'null';
    return { protocol, origin, isHttp, hasUsableOrigin };
  }

  const PLAYER_ERROR_MESSAGES = {
    2: 'Ungültige Video-ID — der Link scheint nicht zu stimmen.',
    5: 'Dieses Video lässt sich im HTML5-Player nicht abspielen.',
    100: 'Video nicht gefunden — es wurde gelöscht oder ist privat.',
    101: 'Der Rechteinhaber hat die Einbettung dieses Videos deaktiviert.',
    150: 'Der Rechteinhaber hat die Einbettung dieses Videos deaktiviert.',
    153: 'Fehler 153: YouTube hat keinen HTTP-Referer bekommen. Die Seite muss über http(s) laufen (lokaler Server oder GitHub Pages) und einen Referer senden.',
  };

  function describePlayerError(code) {
    return PLAYER_ERROR_MESSAGES[code] || `Video konnte nicht geladen werden (Fehler ${code}).`;
  }

  function ensureApiScriptLoaded() {
    if (window.YT && window.YT.Player) {
      apiReady = true;
      return;
    }
    if (document.getElementById('youtube-iframe-api')) return;
    const tag = document.createElement('script');
    tag.id = 'youtube-iframe-api';
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }

  window.onYouTubeIframeAPIReady = function onYouTubeIframeAPIReady() {
    apiReady = true;
    const queued = pendingCreations.splice(0, pendingCreations.length);
    queued.forEach((fn) => fn());
  };

  function initYouTubeApi() {
    ensureApiScriptLoaded();
  }

  function flushPendingActionsFor(id, player) {
    const queue = pendingActions.get(id);
    if (!queue) return;
    pendingActions.delete(id);
    queue.forEach((fn) => fn(player));
  }

  function clearReadyWatchdog(id) {
    const timer = readyWatchdogs.get(id);
    if (timer) clearTimeout(timer);
    readyWatchdogs.delete(id);
  }

  function withPlayer(id, fn) {
    const player = players.get(id);
    if (!player) return;
    if (readyFlags.get(id)) {
      fn(player);
    } else {
      const queue = pendingActions.get(id) || [];
      queue.push(fn);
      pendingActions.set(id, queue);
    }
  }

  /**
   * Creates (or queues creation of) a YT.Player bound to containerEl for the given layer id.
   * handlers: { onReady, onStateChange, onError, onStalled } — all optional.
   * onStalled fires when the player never reported readiness within
   * READY_TIMEOUT_MS, i.e. the iframe is showing a configuration error of its
   * own that the JS API never surfaces as an onError event.
   */
  function createPlayer(id, containerEl, { videoId, startSeconds = 0, volume = 80 }, handlers = {}) {
    const build = () => {
      const context = getEmbedContext();
      const playerVars = {
        autoplay: 0,
        controls: 1,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
      };

      // Only send `origin`/`widget_referrer` when the page actually has a real
      // http(s) origin. On file:// both would be "null"/"file://…", which the
      // player rejects outright (error 153).
      if (context.hasUsableOrigin) {
        playerVars.origin = context.origin;
        playerVars.widget_referrer = window.location.href;
      }

      const player = new YT.Player(containerEl, {
        videoId,
        host: 'https://www.youtube.com',
        playerVars,
        events: {
          onReady: (event) => {
            readyFlags.set(id, true);
            clearReadyWatchdog(id);
            try { event.target.setVolume(volume); } catch { /* ignore */ }
            try {
              if (startSeconds > 0) event.target.seekTo(startSeconds, true);
            } catch { /* ignore */ }
            flushPendingActionsFor(id, event.target);
            handlers.onReady?.(event);
          },
          onStateChange: (event) => handlers.onStateChange?.(event),
          onError: (event) => {
            clearReadyWatchdog(id);
            handlers.onError?.(event);
          },
        },
      });
      players.set(id, player);

      if (handlers.onStalled) {
        clearReadyWatchdog(id);
        readyWatchdogs.set(id, setTimeout(() => {
          readyWatchdogs.delete(id);
          if (!readyFlags.get(id)) handlers.onStalled(context);
        }, READY_TIMEOUT_MS));
      }
    };

    if (apiReady && window.YT && window.YT.Player) {
      build();
    } else {
      pendingCreations.push(build);
      ensureApiScriptLoaded();
    }
  }

  function playLayer(id, startSeconds = 0) {
    withPlayer(id, (player) => {
      player.seekTo(startSeconds || 0, true);
      player.playVideo();
    });
  }

  function stopLayer(id, startSeconds = 0) {
    withPlayer(id, (player) => {
      player.pauseVideo();
      player.seekTo(startSeconds || 0, true);
    });
  }

  function setLayerVolume(id, volume) {
    withPlayer(id, (player) => player.setVolume(volume));
  }

  function getCurrentTime(id) {
    const player = players.get(id);
    if (!player || !readyFlags.get(id)) return 0;
    try {
      return player.getCurrentTime();
    } catch {
      return 0;
    }
  }

  function isLayerReady(id) {
    return !!readyFlags.get(id);
  }

  function getPlayer(id) {
    return players.get(id);
  }

  function destroyPlayer(id) {
    const player = players.get(id);
    if (player) {
      try { player.destroy(); } catch { /* ignore */ }
    }
    clearReadyWatchdog(id);
    players.delete(id);
    readyFlags.delete(id);
    pendingActions.delete(id);
  }

  window.SB = window.SB || {};
  window.SB.youtubeApi = {
    initYouTubeApi,
    createPlayer,
    playLayer,
    stopLayer,
    setLayerVolume,
    getCurrentTime,
    isLayerReady,
    getPlayer,
    destroyPlayer,
    getEmbedContext,
    describePlayerError,
  };
})();
