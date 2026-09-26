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
  function createPlayer(
    id,
    containerEl,
    { videoIds = [], playlistId = '', startSeconds = 0, volume = 80, loop = false, shuffle = false },
    handlers = {}
  ) {
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

      // With listType/list the player loads a whole playlist; YouTube ignores
      // `videoId` in that case, so the requested start video is selected after
      // the playlist is known (see applyPlaylistSettings).
      if (playlistId) {
        playerVars.listType = 'playlist';
        playerVars.list = playlistId;
      } else if (videoIds.length > 1) {
        // A list assembled in the app: the first video is the player's video,
        // the rest go into the documented `playlist` parameter and are played
        // after it — which also makes next/previous, loop and shuffle work.
        playerVars.playlist = videoIds.slice(1).join(',');
      }

      const player = new YT.Player(containerEl, {
        videoId: playlistId ? undefined : videoIds[0],
        host: 'https://www.youtube.com',
        playerVars,
        events: {
          onReady: (event) => {
            readyFlags.set(id, true);
            clearReadyWatchdog(id);
            try { event.target.setVolume(volume); } catch { /* ignore */ }
            if (playlistId || videoIds.length > 1) {
              applyPlaylistSettings(event.target, {
                playlistId,
                videoId: playlistId ? videoIds[0] : '',
                loop,
                shuffle,
              });
            } else {
              try {
                if (startSeconds > 0) event.target.seekTo(startSeconds, true);
              } catch { /* ignore */ }
            }
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

  /**
   * Applies loop/shuffle and, when the source link pointed at one particular
   * video of the playlist, re-cues the playlist at that entry. cuePlaylist()
   * loads without starting playback, which is what the soundboard wants — the
   * user decides when a layer starts.
   */
  function applyPlaylistSettings(player, { playlistId, videoId, loop, shuffle }) {
    try { player.setLoop(!!loop); } catch { /* ignore */ }
    try { player.setShuffle(!!shuffle); } catch { /* ignore */ }
    if (!videoId) return;
    try {
      const entries = player.getPlaylist?.() || [];
      const index = entries.indexOf(videoId);
      if (index > 0) {
        player.cuePlaylist({ list: playlistId, listType: 'playlist', index });
      }
    } catch { /* ignore — playlist simply starts at its first entry */ }
  }

  /**
   * Swaps the videos a locally assembled layer plays. cuePlaylist() loads the
   * new list without starting playback; loop/shuffle are re-applied because
   * cueing resets them.
   */
  function setLayerQueue(id, videoIds, { loop = false, shuffle = false } = {}) {
    withPlayer(id, (player) => {
      try {
        if (videoIds.length > 1) {
          player.cuePlaylist({ playlist: videoIds });
        } else if (videoIds.length === 1) {
          player.cueVideoById(videoIds[0]);
        }
      } catch { /* ignore */ }
      try { player.setLoop(!!loop); } catch { /* ignore */ }
      try { player.setShuffle(!!shuffle); } catch { /* ignore */ }
    });
  }

  function nextVideo(id) {
    withPlayer(id, (player) => {
      try { player.nextVideo(); } catch { /* ignore */ }
    });
  }

  function previousVideo(id) {
    withPlayer(id, (player) => {
      try { player.previousVideo(); } catch { /* ignore */ }
    });
  }

  function setLayerLoop(id, enabled) {
    withPlayer(id, (player) => {
      try { player.setLoop(!!enabled); } catch { /* ignore */ }
    });
  }

  function setLayerShuffle(id, enabled) {
    withPlayer(id, (player) => {
      try { player.setShuffle(!!enabled); } catch { /* ignore */ }
    });
  }

  /** { title, index, total } of the video a playlist layer currently holds. */
  function getPlaylistPosition(id) {
    const player = players.get(id);
    if (!player || !readyFlags.get(id)) return null;
    try {
      const entries = player.getPlaylist?.() || [];
      const index = player.getPlaylistIndex?.() ?? -1;
      const title = player.getVideoData?.().title || '';
      if (index < 0 || !entries.length) return title ? { title, index: -1, total: 0 } : null;
      return { title, index, total: entries.length };
    } catch {
      return null;
    }
  }

  function playLayer(id, startSeconds = 0, { isPlaylist = false } = {}) {
    withPlayer(id, (player) => {
      // Seeking a playlist layer would jump inside whichever video happens to
      // be loaded, so the start point stays a single-video feature.
      if (!isPlaylist) player.seekTo(startSeconds || 0, true);
      player.playVideo();
    });
  }

  function stopLayer(id, startSeconds = 0, { isPlaylist = false } = {}) {
    withPlayer(id, (player) => {
      player.pauseVideo();
      if (!isPlaylist) player.seekTo(startSeconds || 0, true);
    });
  }

  /**
   * Plays a one-shot sound: loadVideoById with an end point starts playback at
   * `startSeconds` and stops it again at `endSeconds`, so an effect can be cut
   * out of a longer video and never runs on.
   */
  function playOnce(id, { videoId, startSeconds = 0, endSeconds = null, volume = 80 } = {}) {
    withPlayer(id, (player) => {
      try {
        player.setVolume(volume);
        const request = { videoId, startSeconds: startSeconds || 0 };
        if (endSeconds != null && endSeconds > (startSeconds || 0)) request.endSeconds = endSeconds;
        player.loadVideoById(request);
      } catch { /* ignore */ }
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
    playOnce,
    setLayerVolume,
    setLayerQueue,
    nextVideo,
    previousVideo,
    setLayerLoop,
    setLayerShuffle,
    getPlaylistPosition,
    getCurrentTime,
    isLayerReady,
    getPlayer,
    destroyPlayer,
    getEmbedContext,
    describePlayerError,
  };
})();
