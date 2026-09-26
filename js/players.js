(function () {
  /**
   * One façade over the YouTube and SoundCloud wrappers so the app can treat a
   * layer the same way whatever it plays. Every call takes the layer id; the
   * provider is remembered from createPlayer, so callers never dispatch by hand.
   *
   * The YouTube wrapper is the reference shape — the SoundCloud one mirrors it,
   * with the differences that cannot be papered over exposed through
   * `supports()`: SoundCloud has no shuffle, and its sets are not editable here.
   */
  const providers = {
    youtube: () => window.SB.youtubeApi,
    soundcloud: () => window.SB.soundcloudApi,
  };

  const CAPABILITIES = {
    youtube: { shuffle: true, editableQueue: true, startPoint: true },
    soundcloud: { shuffle: false, editableQueue: false, startPoint: true },
  };

  const playerProviders = new Map(); // id -> provider name

  function providerOf(id) {
    const name = playerProviders.get(id);
    return name ? providers[name]?.() : null;
  }

  function supports(providerName, capability) {
    return !!CAPABILITIES[providerName]?.[capability];
  }

  function initAll() {
    window.SB.youtubeApi.initYouTubeApi();
    window.SB.soundcloudApi.initApi();
  }

  function createPlayer(id, provider, containerEl, options, handlers) {
    playerProviders.set(id, provider);
    const api = providers[provider]?.();
    if (!api) return;
    api.createPlayer(id, containerEl, options, handlers);
  }

  function destroyPlayer(id) {
    providerOf(id)?.destroyPlayer(id);
    playerProviders.delete(id);
  }

  /** Forwards a call to whichever wrapper owns this id. */
  function forward(method) {
    return (id, ...args) => {
      const api = providerOf(id);
      return api && typeof api[method] === 'function' ? api[method](id, ...args) : undefined;
    };
  }

  /**
   * Titles arrive differently per provider: YouTube can answer synchronously
   * from the player, SoundCloud only through a callback. Both are normalised
   * into a promise here.
   */
  function fetchTitle(id, player) {
    const name = playerProviders.get(id);
    if (name === 'soundcloud') {
      return new Promise((resolve) => {
        window.SB.soundcloudApi.fetchCurrentTitle(id, (title) => resolve(title || ''));
      });
    }
    try {
      return Promise.resolve(player?.getVideoData?.().title || '');
    } catch {
      return Promise.resolve('');
    }
  }

  /**
   * Resolves a linked playlist into plain video ids. Only YouTube can do this
   * (through the loaded player); SoundCloud sets stay with the widget.
   */
  function resolvePlaylistEntries(id) {
    if (playerProviders.get(id) !== 'youtube') return Promise.resolve([]);
    return new Promise((resolve) => {
      window.SB.youtubeApi.resolvePlaylistEntries(id, (entries) => resolve(entries || []));
    });
  }

  /** Same normalisation for the "which entry of the list is playing" readout. */
  function fetchPlaylistPosition(id) {
    const name = playerProviders.get(id);
    if (name === 'soundcloud') {
      return new Promise((resolve) => {
        window.SB.soundcloudApi.getPlaylistPosition(id, (position) => resolve(position || null));
      });
    }
    return Promise.resolve(window.SB.youtubeApi.getPlaylistPosition(id));
  }

  window.SB = window.SB || {};
  window.SB.players = {
    initAll,
    createPlayer,
    destroyPlayer,
    supports,
    fetchTitle,
    fetchPlaylistPosition,
    resolvePlaylistEntries,
    providerOf: (id) => playerProviders.get(id) || '',
    playLayer: forward('playLayer'),
    stopLayer: forward('stopLayer'),
    playOnce: forward('playOnce'),
    setLayerVolume: forward('setLayerVolume'),
    setLayerQueue: forward('setLayerQueue'),
    nextVideo: forward('nextVideo'),
    previousVideo: forward('previousVideo'),
    setLayerLoop: forward('setLayerLoop'),
    setLayerShuffle: forward('setLayerShuffle'),
    getCurrentTime: forward('getCurrentTime'),
    describeState: forward('describeState'),
    isLayerReady: forward('isLayerReady'),
    getPlayer: forward('getPlayer'),
  };
})();
