(function () {
  const {
    initAll: initPlayers,
    createPlayer,
    destroyPlayer,
    playLayer,
    stopLayer,
    playOnce,
    setLayerVolume,
    setLayerQueue,
    resolvePlaylistEntries,
    nextVideo,
    previousVideo,
    setLayerLoop,
    setLayerShuffle,
    fetchTitle,
    fetchPlaylistPosition,
    getCurrentTime,
  } = window.SB.players;
  const { describePlayerError, getEmbedContext } = window.SB.youtubeApi;
  const { parseSourceUrl, PARSE_ERROR_MESSAGES } = window.SB.urlParser;
  const {
    createLayer,
    normalizeLayer,
    buildLayerElement,
    isPlaylist,
    isLinkedPlaylist,
    layerWatchUrl,
    renderQueue,
    setQueueError,
    setToggleUI,
    setTrackLabel,
    setLayerError,
    updateStartLabel,
    setExpandedUI,
    setPlayingUI,
  } = window.SB.layer;
  const { loadWorkingState, scheduleAutosave, flushAutosave } = window.SB.storage;
  const {
    loadCollectionsStore,
    saveCollectionsStore,
    createCollection,
    updateCollectionLayers,
    renameCollection,
    deleteCollection,
    renderCollectionsSidebar,
  } = window.SB.collections;
  const {
    buildShareUrl,
    extractShareParam,
    decodeShareString,
    stripShareParamFromUrl,
  } = window.SB.share;
  const { showModal, confirmModal, promptModal } = window.SB.modal;
  const { formatTime, parseTimeInput } = window.SB.util;
  const {
    normalizeAction,
    createAction,
    actionSourceUrl,
    buildActionElement,
    setActionEditing,
    setActionPlaying,
    setActionError,
    updateActionLabel,
    updateActionRange,
    readRange,
  } = window.SB.actionButtons;

  const state = {
    layers: [],
    actions: [],
    activeCollectionId: null,
  };
  let isDirty = false;
  let collectionsStore = { schemaVersion: 1, collectionOrder: [], collections: {} };

  const layerRefs = new Map(); // id -> { root, refs } from buildLayerElement
  const videoTitles = new Map(); // videoId -> title, for the per-layer queue list
  const actionRefs = new Map(); // action id -> { root, refs } from buildActionElement

  const els = {
    layersList: document.getElementById('layers-list'),
    emptyHint: document.getElementById('empty-hint'),
    addInput: document.getElementById('add-url-input'),
    addBtn: document.getElementById('add-url-btn'),
    addError: document.getElementById('add-url-error'),
    playAllBtn: document.getElementById('play-all-btn'),
    stopAllBtn: document.getElementById('stop-all-btn'),
    copyShareBtn: document.getElementById('copy-share-btn'),
    collectionsList: document.getElementById('collections-list'),
    saveBtn: document.getElementById('save-btn'),
    saveAsBtn: document.getElementById('save-as-btn'),
    newCollectionBtn: document.getElementById('new-collection-btn'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    sidebarBackdrop: document.getElementById('sidebar-backdrop'),
    toastRoot: document.getElementById('toast-root'),
    envWarning: document.getElementById('env-warning'),
    actionsList: document.getElementById('actions-list'),
    actionsEmpty: document.getElementById('actions-empty'),
    addActionInput: document.getElementById('add-action-input'),
    addActionBtn: document.getElementById('add-action-btn'),
    addActionError: document.getElementById('add-action-error'),
    app: document.getElementById('app'),
  };

  function showToast(message, timeout = 3500) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    els.toastRoot.appendChild(toast);
    setTimeout(() => toast.remove(), timeout);
  }

  function markDirty() {
    isDirty = true;
    scheduleAutosave(getWorkingStateSnapshot);
  }

  function getWorkingStateSnapshot() {
    return {
      activeCollectionId: state.activeCollectionId,
      layers: state.layers,
      actions: state.actions,
    };
  }

  function layerLookup(id) {
    return state.layers.find((l) => l.id === id);
  }

  function updateEmptyHint() {
    els.emptyHint.hidden = state.layers.length > 0;
  }

  /* ---------------- Layer lifecycle ---------------- */

  const layerActions = {
    onTitleChange(id, title) {
      const layer = layerLookup(id);
      if (!layer) return;
      const trimmed = title.trim();
      layer.title = trimmed || layer.title;
      layer.titleIsCustom = true;
      markDirty();
    },
    onTypeChange(id, type) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry) return;
      layer.type = type;
      entry.root.dataset.type = type;
      markDirty();
    },
    onVolumeChange(id, volume) {
      const layer = layerLookup(id);
      if (!layer) return;
      layer.volume = volume;
      setLayerVolume(id, volume);
      markDirty();
    },
    onPlayStopClick(id) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry) return;
      const isPlaying = entry.refs.playStopBtn.classList.contains('is-playing');
      const opts = { isPlaylist: isPlaylist(layer) };
      if (isPlaying) {
        stopLayer(id, layer.startSeconds, opts);
      } else {
        playLayer(id, layer.startSeconds, opts);
      }
    },
    onPrevVideo(id) {
      previousVideo(id);
    },
    onNextVideo(id) {
      nextVideo(id);
    },
    onToggleLoop(id) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry) return;
      layer.loop = !layer.loop;
      setLayerLoop(id, layer.loop);
      setToggleUI(entry.refs.loopBtn, layer.loop);
      markDirty();
    },
    onToggleShuffle(id) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry) return;
      layer.shuffle = !layer.shuffle;
      setLayerShuffle(id, layer.shuffle);
      setToggleUI(entry.refs.shuffleBtn, layer.shuffle);
      markDirty();
    },
    onExpandToggle(id) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry) return;
      layer.isExpanded = !layer.isExpanded;
      setExpandedUI(entry.root, entry.refs, layer.isExpanded);
      markDirty();
    },
    onSetStartPoint(id) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry) return;
      const t = getCurrentTime(id);
      layer.startSeconds = Math.round(t || 0);
      updateStartLabel(entry.refs, layer.startSeconds);
      markDirty();
      showToast(`Startpunkt gesetzt: ${formatTime(layer.startSeconds)}`);
    },
    onQueueAdd(id, rawUrl) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry) return;

      // A per-layer queue is a YouTube construct (playerVars.playlist), so
      // only YouTube videos can be appended here.
      const parsed = parseSourceUrl(rawUrl);
      if (parsed.ok && parsed.provider === 'soundcloud') {
        setQueueError(entry.refs, 'SoundCloud lässt sich hier nicht anhängen — lege dafür eine eigene Ebene an.');
        return;
      }
      if (!parsed.ok) {
        setQueueError(entry.refs, PARSE_ERROR_MESSAGES[parsed.reason] || 'Link konnte nicht gelesen werden.');
        return;
      }
      if (parsed.kind === 'playlist') {
        setQueueError(entry.refs, 'Eine ganze Playlist lässt sich nicht anhängen — füge sie als eigene Ebene hinzu.');
        return;
      }
      if (layer.videoIds.includes(parsed.videoId)) {
        setQueueError(entry.refs, 'Dieses Video ist in der Ebene schon enthalten.');
        return;
      }

      layer.videoIds = [...layer.videoIds, parsed.videoId];
      entry.refs.queueInput.value = '';
      setQueueError(entry.refs, '');
      fetchVideoTitle(parsed.videoId).then(() => refreshQueue(id));
      applyQueueChange(layer, entry);
    },
    onQueueRemove(id, index) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry || layer.videoIds.length <= 1) return;
      layer.videoIds = layer.videoIds.filter((_, i) => i !== index);
      setQueueError(entry.refs, '');
      applyQueueChange(layer, entry);
    },
    onQueueMove(id, index, delta) {
      const layer = layerLookup(id);
      const entry = layerRefs.get(id);
      if (!layer || !entry) return;
      const target = index + delta;
      if (target < 0 || target >= layer.videoIds.length) return;
      const next = [...layer.videoIds];
      [next[index], next[target]] = [next[target], next[index]];
      layer.videoIds = next;
      applyQueueChange(layer, entry);
    },
    onRemove(id) {
      unmountLayer(id);
      state.layers = state.layers.filter((l) => l.id !== id);
      updateEmptyHint();
      markDirty();
    },
  };

  /** Pushes a changed queue into the running player and redraws the card. */
  function applyQueueChange(layer, entry) {
    setLayerQueue(layer.id, layer.videoIds, { loop: layer.loop, shuffle: layer.shuffle });
    renderQueue(layer, entry.refs, layerActions, titleForVideo);
    markDirty();
  }

  function refreshQueue(id) {
    const layer = layerLookup(id);
    const entry = layerRefs.get(id);
    if (!layer || !entry) return;
    renderQueue(layer, entry.refs, layerActions, titleForVideo);
  }

  function titleForVideo(videoId) {
    return videoTitles.get(videoId) || '';
  }

  /** Resolves a video's title via oEmbed; failures keep the raw id as label. */
  function fetchVideoTitle(videoId) {
    if (!videoId || videoTitles.has(videoId)) return Promise.resolve(videoTitles.get(videoId) || '');
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    return fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.title) videoTitles.set(videoId, data.title);
        return data?.title || '';
      })
      .catch(() => '');
  }

  function mountLayer(layer) {
    const { root, refs } = buildLayerElement(layer, layerActions);
    els.layersList.appendChild(root);
    layerRefs.set(layer.id, { root, refs });
    renderQueue(layer, refs, layerActions, titleForVideo);
    layer.videoIds.forEach((videoId) => {
      fetchVideoTitle(videoId).then((title) => {
        if (title) refreshQueue(layer.id);
      });
    });

    createPlayer(
      layer.id,
      layer.provider,
      refs.playerContainer,
      {
        videoIds: layer.videoIds,
        playlistId: layer.playlistId,
        sourceUrl: layer.sourceUrl,
        startSeconds: layer.startSeconds,
        volume: layer.volume,
        loop: layer.loop,
        shuffle: layer.shuffle,
      },
      {
        onReady: (event) => {
          setLayerError(refs, '');
          maybeFetchTitle(layer.id, event.target, refs);
          updateTrackLabel(layer.id, refs);
          adoptPlaylistAsQueue(layer.id, refs);
        },
        onStateChange: (event) => {
          // YouTube reports numeric states, SoundCloud a plain flag.
          const isPlaying = typeof event.playing === 'boolean' ? event.playing : event.data === 1;
          setPlayingUI(refs, isPlaying);
          // The playlist moves on by itself, so refresh which entry is loaded.
          updateTrackLabel(layer.id, refs);
        },
        onError: (event) => {
          const message = event.data === 'soundcloud'
            ? 'SoundCloud konnte diesen Track nicht laden — ist er noch öffentlich?'
            : describePlayerError(event.data);
          setLayerError(refs, message, layerWatchUrl(layer));
        },
        onStalled: (context) => {
          // The player never reported readiness. When the page has no usable
          // origin/referrer this is error 153 being painted inside the iframe
          // without the JS API ever telling us about it.
          setLayerError(
            refs,
            context.hasUsableOrigin
              ? 'Der Player hat sich nicht gemeldet — prüfe deine Verbindung oder ob ein Blocker youtube.com blockiert.'
              : describePlayerError(153),
            layerWatchUrl(layer)
          );
        },
      }
    );
  }

  function unmountLayer(id) {
    destroyPlayer(id);
    layerRefs.get(id)?.root.remove();
    layerRefs.delete(id);
  }

  /**
   * A pasted YouTube playlist is only a way to *name* a set of videos — the app
   * turns it into the layer's own queue as soon as the player can name its
   * entries. From then on the list behaves like any hand-built one: sortable,
   * trimmable, extendable. The playlist id is dropped so nothing stays tied to
   * YouTube's own ordering.
   */
  function adoptPlaylistAsQueue(id, refs) {
    const layer = layerLookup(id);
    if (!layer || !layer.playlistId) return;

    resolvePlaylistEntries(id).then((entries) => {
      const current = layerLookup(id);
      if (!current || !current.playlistId) return;

      if (!entries.length) {
        setLayerError(
          refs,
          'Die Playlist konnte nicht in eine Queue übernommen werden — sie ist vermutlich privat oder leer.',
          layerWatchUrl(current)
        );
        return;
      }

      current.videoIds = entries;
      current.playlistId = '';
      // Hand the running player the explicit list, so it no longer depends on
      // YouTube's playlist mode.
      setLayerQueue(id, entries, { loop: current.loop, shuffle: current.shuffle });
      renderQueue(current, refs, layerActions, titleForVideo);
      entries.forEach((videoId) => {
        fetchVideoTitle(videoId).then((title) => {
          if (title) refreshQueue(id);
        });
      });
      markDirty();
    });
  }

  function updateTrackLabel(id, refs) {
    const layer = layerLookup(id);
    if (!layer || !isPlaylist(layer)) return;
    // SoundCloud answers through callbacks, YouTube synchronously — the
    // players façade normalises both into a promise.
    fetchPlaylistPosition(id).then((position) => {
      if (!position) {
        setTrackLabel(refs, '');
        return;
      }
      const counter = position.total > 0 ? `${position.index + 1}/${position.total}` : '–';
      setTrackLabel(refs, position.title ? `${counter} · ${position.title}` : counter);
    });
  }

  function maybeFetchTitle(id, player, refs) {
    const layer = layerLookup(id);
    if (!layer || layer.titleIsCustom) return;

    // For a linked playlist the player only knows the current track's title —
    // the layer wants the list's own name, which oEmbed provides.
    const askPlayerFirst = !isLinkedPlaylist(layer);
    // Captured now: adoptPlaylistAsQueue may clear the playlist id while this
    // is in flight, and then the layer would be named after its first video
    // instead of the playlist it came from.
    const sourceUrl = layerWatchUrl(layer);
    const fromPlayer = askPlayerFirst ? fetchTitle(id, player) : Promise.resolve('');

    fromPlayer.then((title) => {
      if (title) {
        applyFetchedTitle(id, title, refs);
        return;
      }
      fetchOEmbedTitle(sourceUrl, layer.provider).then((fetched) => {
        if (fetched) applyFetchedTitle(id, fetched, refs);
      });
    });
  }

  /** oEmbed endpoints of both providers, used where the player has no title. */
  function fetchOEmbedTitle(sourceUrl, provider) {
    const endpoint = provider === 'soundcloud'
      ? `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(sourceUrl)}`
      : `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`;
    return fetch(endpoint)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data?.title || '')
      .catch(() => '');
  }

  function applyFetchedTitle(id, title, refs) {
    const layer = layerLookup(id);
    if (!layer || layer.titleIsCustom) return;
    layer.title = title;
    refs.titleInput.value = title;
    refs.titleInput.placeholder = '';
    markDirty();
  }

  function addLayerFromParsed(parsed, sourceUrl) {
    const isSoundCloudSource = parsed.provider === 'soundcloud';
    const layer = createLayer({
      provider: parsed.provider || 'youtube',
      videoIds: parsed.videoId ? [parsed.videoId] : [],
      playlistId: !isSoundCloudSource && parsed.kind === 'playlist' ? parsed.playlistId : '',
      isSet: isSoundCloudSource && parsed.kind === 'playlist',
      sourceUrl: isSoundCloudSource ? parsed.sourceUrl : sourceUrl,
      startSeconds: parsed.kind === 'playlist' ? 0 : parsed.startSeconds,
    });
    state.layers.push(layer);
    mountLayer(layer);
    updateEmptyHint();
    markDirty();
    return layer;
  }

  function renderAllLayers() {
    // Tear down what is currently mounted first — otherwise the YT players of
    // the old cards keep living in the players map while their DOM is dropped.
    Array.from(layerRefs.keys()).forEach(unmountLayer);
    els.layersList.innerHTML = '';
    layerRefs.clear();
    state.layers.forEach(mountLayer);
    updateEmptyHint();
  }


  /* ---------------- Action buttons (one-shot sounds) ---------------- */

  function actionLookup(id) {
    return state.actions.find((a) => a.id === id);
  }

  const actionHandlers = {
    /** One press = the sound plays exactly once, from start to end point. */
    onTrigger(id) {
      const action = actionLookup(id);
      if (!action) return;
      playOnce(id, {
        videoId: action.videoId,
        startSeconds: action.startSeconds,
        endSeconds: action.endSeconds,
        volume: action.volume,
      });
    },
    onEditToggle(id) {
      const entry = actionRefs.get(id);
      if (!entry) return;
      setActionEditing(entry.refs, entry.refs.panel.hidden);
    },
    onLabelChange(id, label) {
      const action = actionLookup(id);
      const entry = actionRefs.get(id);
      if (!action || !entry) return;
      const trimmed = label.trim();
      if (!trimmed) {
        updateActionLabel(entry.refs, action.label);
        return;
      }
      action.label = trimmed;
      action.labelIsCustom = true;
      updateActionLabel(entry.refs, trimmed);
      markDirty();
    },
    onVolumeChange(id, volume) {
      const action = actionLookup(id);
      if (!action) return;
      action.volume = volume;
      // Also push it into the running player — otherwise a change only took
      // effect the next time the button was pressed.
      setLayerVolume(id, volume);
      markDirty();
    },
    onRangeChange(id, raw) {
      const action = actionLookup(id);
      const entry = actionRefs.get(id);
      if (!action || !entry) return;
      const { startSeconds, endSeconds } = readRange(raw, action);
      action.startSeconds = startSeconds;
      action.endSeconds = endSeconds;
      updateActionRange(entry.refs, action);
      setActionError(
        entry.refs,
        String(raw.end || '').trim() && endSeconds == null
          ? 'Der Endpunkt muss hinter dem Startpunkt liegen — er wurde verworfen.'
          : ''
      );
      markDirty();
    },
    /** Takes the preview player's position, so a cut can be set by ear. */
    onUseCurrentTime(id, field) {
      const action = actionLookup(id);
      const entry = actionRefs.get(id);
      if (!action || !entry) return;
      const now = Math.max(0, Math.round(getCurrentTime(id) || 0));
      if (field === 'start') {
        action.startSeconds = now;
        if (action.endSeconds != null && action.endSeconds <= now) action.endSeconds = null;
      } else if (now > action.startSeconds) {
        action.endSeconds = now;
      } else {
        setActionError(entry.refs, 'Der Endpunkt muss hinter dem Startpunkt liegen.');
        return;
      }
      setActionError(entry.refs, '');
      updateActionRange(entry.refs, action);
      markDirty();
      showToast(`${field === 'start' ? 'Startpunkt' : 'Endpunkt'} gesetzt: ${formatTime(now)}`);
    },
    onRemove(id) {
      unmountAction(id);
      state.actions = state.actions.filter((a) => a.id !== id);
      updateActionsEmptyHint();
      markDirty();
    },
  };

  function mountAction(action) {
    const { root, refs } = buildActionElement(action, actionHandlers);
    els.actionsList.appendChild(root);
    actionRefs.set(action.id, { root, refs });

    createPlayer(
      action.id,
      action.provider,
      refs.playerContainer,
      {
        videoIds: action.videoId ? [action.videoId] : [],
        sourceUrl: action.sourceUrl,
        startSeconds: action.startSeconds,
        volume: action.volume,
      },
      {
        onReady: (event) => {
          setActionError(refs, '');
          maybeFetchActionLabel(action.id, event.target, refs);
        },
        onStateChange: (event) => {
          const isPlaying = typeof event.playing === 'boolean' ? event.playing : event.data === 1;
          setActionPlaying(refs, isPlaying);
        },
        onError: (event) => {
          setActionError(
            refs,
            event.data === 'soundcloud'
              ? 'SoundCloud konnte diesen Sound nicht laden.'
              : describePlayerError(event.data)
          );
        },
      }
    );
  }

  function unmountAction(id) {
    destroyPlayer(id);
    actionRefs.get(id)?.root.remove();
    actionRefs.delete(id);
  }

  function maybeFetchActionLabel(id, player, refs) {
    const action = actionLookup(id);
    if (!action || action.labelIsCustom) return;
    fetchTitle(id, player).then((title) => {
      if (title) return applyActionLabel(id, title, refs);
      return fetchOEmbedTitle(actionSourceUrl(action), action.provider)
        .then((fetched) => { if (fetched) applyActionLabel(id, fetched, refs); });
    });
  }

  function applyActionLabel(id, label, refs) {
    const action = actionLookup(id);
    if (!action || action.labelIsCustom) return;
    action.label = label;
    updateActionLabel(refs, label);
    markDirty();
  }

  function renderAllActions() {
    Array.from(actionRefs.keys()).forEach(unmountAction);
    els.actionsList.textContent = '';
    actionRefs.clear();
    state.actions.forEach(mountAction);
    updateActionsEmptyHint();
  }

  function updateActionsEmptyHint() {
    els.actionsEmpty.hidden = state.actions.length > 0;
  }

  function hideAddActionError() {
    els.addActionError.hidden = true;
    els.addActionError.textContent = '';
  }

  function tryAddActionFromInput({ silent }) {
    const value = els.addActionInput.value;
    const parsed = parseSourceUrl(value);
    if (!parsed.ok) {
      if (!silent) {
        const msg = PARSE_ERROR_MESSAGES[parsed.reason];
        if (msg) {
          els.addActionError.textContent = msg;
          els.addActionError.hidden = false;
        } else {
          hideAddActionError();
        }
      }
      return false;
    }
    if (parsed.kind === 'playlist') {
      els.addActionError.textContent = 'Ein Action-Button spielt einen einzelnen Sound — bitte keinen Playlist-Link.';
      els.addActionError.hidden = false;
      return false;
    }

    const action = createAction({
      provider: parsed.provider || 'youtube',
      videoId: parsed.videoId || '',
      sourceUrl: parsed.provider === 'soundcloud' ? parsed.sourceUrl : value.trim(),
      startSeconds: parsed.startSeconds || 0,
    });
    state.actions.push(action);
    mountAction(action);
    updateActionsEmptyHint();
    markDirty();
    els.addActionInput.value = '';
    hideAddActionError();
    return true;
  }

  let addActionDebounce = null;

  function wireActionControls() {
    els.addActionInput.addEventListener('input', () => {
      hideAddActionError();
      clearTimeout(addActionDebounce);
      addActionDebounce = setTimeout(() => tryAddActionFromInput({ silent: true }), 200);
    });
    els.addActionBtn.addEventListener('click', () => tryAddActionFromInput({ silent: false }));
    els.addActionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryAddActionFromInput({ silent: false });
    });
  }

  /* ---------------- Add-layer input wiring ---------------- */

  function hideAddError() {
    els.addError.hidden = true;
    els.addError.textContent = '';
  }

  function showAddError(reason) {
    const msg = PARSE_ERROR_MESSAGES[reason];
    if (!msg) {
      hideAddError();
      return;
    }
    els.addError.textContent = msg;
    els.addError.hidden = false;
  }

  function tryAddFromInput({ silent }) {
    const value = els.addInput.value;
    const parsed = parseSourceUrl(value);
    if (parsed.ok) {
      addLayerFromParsed(parsed, value.trim());
      els.addInput.value = '';
      hideAddError();
      els.addInput.focus();
      return true;
    }
    if (!silent) showAddError(parsed.reason);
    return false;
  }

  let addInputDebounce = null;

  function wireAddLayerControls() {
    els.addInput.addEventListener('input', () => {
      hideAddError();
      clearTimeout(addInputDebounce);
      addInputDebounce = setTimeout(() => {
        tryAddFromInput({ silent: true });
      }, 200);
    });

    els.addInput.addEventListener('blur', () => {
      if (!els.addInput.value.trim()) {
        hideAddError();
        return;
      }
      const parsed = parseSourceUrl(els.addInput.value);
      if (!parsed.ok) showAddError(parsed.reason);
    });

    els.addBtn.addEventListener('click', () => tryAddFromInput({ silent: false }));

    els.addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryAddFromInput({ silent: false });
    });
  }

  /* ---------------- Universal controls ---------------- */

  function wireGlobalControls() {
    els.playAllBtn.addEventListener('click', () => {
      for (const layer of state.layers) {
        playLayer(layer.id, layer.startSeconds, { isPlaylist: isPlaylist(layer) });
      }
    });

    els.stopAllBtn.addEventListener('click', () => {
      for (const layer of state.layers) {
        stopLayer(layer.id, layer.startSeconds, { isPlaylist: isPlaylist(layer) });
      }
    });

    els.copyShareBtn.addEventListener('click', async () => {
      if (state.layers.length === 0 && state.actions.length === 0) {
        showToast('Nichts zum Teilen vorhanden.');
        return;
      }
      const url = buildShareUrl(state.layers, state.actions);
      try {
        await navigator.clipboard.writeText(url);
        showToast('Link kopiert!');
      } catch {
        await showModal({
          title: 'Link teilen',
          message: url,
          buttons: [{ label: 'Schließen', value: true, variant: 'primary' }],
        });
      }
    });
  }

  /* ---------------- Sidebar / collections ---------------- */

  function renderSidebar() {
    renderCollectionsSidebar(els.collectionsList, collectionsStore, state.activeCollectionId, {
      onLoad: handleLoadCollection,
      onRename: handleRenameCollection,
      onDelete: handleDeleteCollection,
    });
    els.saveBtn.hidden = !state.activeCollectionId;
  }

  function handleSave() {
    if (!state.activeCollectionId) return;
    collectionsStore = updateCollectionLayers(
      collectionsStore, state.activeCollectionId, state.layers, state.actions
    );
    saveCollectionsStore(collectionsStore);
    isDirty = false;
    showToast('Änderungen gespeichert.');
  }

  async function handleLoadCollection(id) {
    if (id === state.activeCollectionId) return;
    if (isDirty) {
      const proceed = await confirmModal(
        'Ungespeicherte Änderungen gehen verloren. Trotzdem laden?',
        { title: 'Ungespeicherte Änderungen', confirmLabel: 'Laden', cancelLabel: 'Abbrechen' }
      );
      if (!proceed) return;
    }
    const collection = collectionsStore.collections[id];
    if (!collection) return;
    loadLayersIntoWorkingArea(collection.layers, id, collection.actions);
  }

  function loadLayersIntoWorkingArea(rawLayers, collectionId, rawActions = []) {
    state.layers.forEach((l) => destroyPlayer(l.id));
    state.actions.forEach((a) => destroyPlayer(a.id));
    state.layers = rawLayers.map(normalizeLayer);
    state.actions = (rawActions || []).map(normalizeAction);
    state.activeCollectionId = collectionId ?? null;
    isDirty = false;
    renderAllLayers();
    renderAllActions();
    renderSidebar();
    flushAutosave(getWorkingStateSnapshot);
  }

  /**
   * Starts a fresh, empty collection: asks for a name, stores it right away and
   * clears the working area, so collections can be created without having to
   * build up layers first.
   */
  async function handleNewCollection() {
    if (isDirty) {
      const proceed = await confirmModal(
        'Ungespeicherte Änderungen gehen verloren. Trotzdem eine neue Sammlung anlegen?',
        { title: 'Ungespeicherte Änderungen', confirmLabel: 'Neue Sammlung', cancelLabel: 'Abbrechen' }
      );
      if (!proceed) return;
    }
    const name = await promptModal('Name für die neue Sammlung:', {
      title: 'Neue Sammlung',
      defaultValue: '',
      confirmLabel: 'Anlegen',
    });
    if (!name) return;

    const { store, id } = createCollection(collectionsStore, name, [], []);
    collectionsStore = store;
    saveCollectionsStore(collectionsStore);
    loadLayersIntoWorkingArea([], id, []);
    showToast(`Sammlung "${name}" angelegt.`);
  }

  async function handleSaveAs() {
    const name = await promptModal('Name für die Sammlung:', {
      title: 'Sammlung speichern',
      defaultValue: '',
      confirmLabel: 'Speichern',
    });
    if (!name) return;
    const { store, id } = createCollection(collectionsStore, name, state.layers, state.actions);
    collectionsStore = store;
    saveCollectionsStore(collectionsStore);
    state.activeCollectionId = id;
    isDirty = false;
    // Persist the new active collection without marking the state dirty again —
    // right after "Speichern unter…" nothing is unsaved, so the app must not
    // warn about lost changes on the next collection switch.
    flushAutosave(getWorkingStateSnapshot);
    renderSidebar();
    showToast(`Sammlung "${name}" gespeichert.`);
  }

  async function handleRenameCollection(id) {
    const collection = collectionsStore.collections[id];
    if (!collection) return;
    const name = await promptModal('Neuer Name:', {
      title: 'Sammlung umbenennen',
      defaultValue: collection.name,
      confirmLabel: 'Umbenennen',
    });
    if (!name) return;
    collectionsStore = renameCollection(collectionsStore, id, name);
    saveCollectionsStore(collectionsStore);
    renderSidebar();
  }

  async function handleDeleteCollection(id) {
    const collection = collectionsStore.collections[id];
    if (!collection) return;
    const proceed = await confirmModal(`Sammlung "${collection.name}" wirklich löschen?`, {
      title: 'Sammlung löschen',
      confirmLabel: 'Löschen',
      cancelLabel: 'Abbrechen',
      danger: true,
    });
    if (!proceed) return;
    collectionsStore = deleteCollection(collectionsStore, id);
    saveCollectionsStore(collectionsStore);
    if (state.activeCollectionId === id) state.activeCollectionId = null;
    renderSidebar();
  }

  function wireSidebar() {
    els.saveBtn.addEventListener('click', handleSave);
    els.saveAsBtn.addEventListener('click', handleSaveAs);
    els.newCollectionBtn.addEventListener('click', handleNewCollection);

    els.sidebarToggle.addEventListener('click', () => {
      const isOpen = els.app.classList.toggle('sidebar-open');
      els.sidebarToggle.setAttribute('aria-expanded', String(isOpen));
    });
    els.sidebarBackdrop.addEventListener('click', () => {
      els.app.classList.remove('sidebar-open');
      els.sidebarToggle.setAttribute('aria-expanded', 'false');
    });
  }

  /* ---------------- Share import ---------------- */

  function showShareImportModal(layerCount, actionCount) {
    const parts = [`${layerCount} Ebene(n)`];
    if (actionCount > 0) parts.push(`${actionCount} Action-Button(s)`);
    return showModal({
      title: 'Geteilte Sammlung öffnen',
      message: `Dieser Link enthält ${parts.join(' und ')}. Wie möchtest du fortfahren?`,
      buttons: [
        { label: 'Abbrechen', value: 'cancel' },
        { label: 'In aktuelle Arbeitsfläche laden', value: 'current' },
        { label: 'Als neue Sammlung speichern & laden', value: 'new', variant: 'primary' },
      ],
    });
  }

  /** Resolves true when it already loaded (and thus rendered) layers. */
  async function handleShareImportIfPresent() {
    const shareParam = extractShareParam();
    if (!shareParam) return false;

    const decoded = decodeShareString(shareParam);
    if (!decoded.ok) {
      showToast('Der Link konnte nicht gelesen werden.');
      stripShareParamFromUrl();
      return false;
    }

    const choice = await showShareImportModal(decoded.layers.length, (decoded.actions || []).length);
    let loaded = false;

    if (choice === 'new') {
      const layers = decoded.layers.map(normalizeLayer);
      const actions = (decoded.actions || []).map(normalizeAction);
      const name = await promptModal('Name für die neue Sammlung:', {
        title: 'Als neue Sammlung speichern',
        defaultValue: 'Geteilte Sammlung',
        confirmLabel: 'Speichern & laden',
      });
      if (name) {
        const { store, id } = createCollection(collectionsStore, name, layers, actions);
        collectionsStore = store;
        saveCollectionsStore(collectionsStore);
        loadLayersIntoWorkingArea(layers, id, actions);
        loaded = true;
        showToast(`Sammlung "${name}" geladen.`);
      }
    } else if (choice === 'current') {
      loadLayersIntoWorkingArea(decoded.layers, null, decoded.actions || []);
      loaded = true;
      showToast('Geteilte Ebenen geladen.');
    }

    stripShareParamFromUrl();
    return loaded;
  }

  /* ---------------- Embed environment check ---------------- */

  /**
   * YouTube refuses to configure an embedded player when the page cannot send
   * it an HTTP Referer — the "Fehler bei der Konfiguration des Videoplayers /
   * Fehler 153" screen. Opening index.html straight from disk (file://) is the
   * common way to hit this, so say so before the user stares at four broken
   * players. See https://support.google.com/youtube/answer/171780
   */
  function renderEnvWarning() {
    const context = getEmbedContext();
    const box = els.envWarning;
    box.textContent = '';

    if (context.hasUsableOrigin) {
      box.hidden = true;
      return;
    }

    box.hidden = false;

    const title = document.createElement('strong');
    title.textContent = 'Wiedergabe über file:// nicht möglich (YouTube-Fehler 153)';

    const text = document.createElement('p');
    text.textContent =
      'YouTube spielt eingebettete Videos nur ab, wenn die Seite einen HTTP-Referer sendet. '
      + 'Direkt geöffnete Dateien (file://) können das nicht. Starte die App stattdessen über einen '
      + 'lokalen Server oder GitHub Pages:';

    const code = document.createElement('code');
    code.className = 'env-warning-code';
    code.textContent = 'python3 -m http.server 8000';

    const after = document.createElement('p');
    after.textContent = 'Danach http://localhost:8000 im Browser öffnen.';

    const link = document.createElement('a');
    link.href = 'https://support.google.com/youtube/answer/171780';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Mehr dazu bei YouTube \u2197';

    box.append(title, text, code, after, link);
  }

  /* ---------------- Boot ---------------- */

  async function boot() {
    renderEnvWarning();
    initPlayers();

    collectionsStore = loadCollectionsStore();
    const working = loadWorkingState();
    state.layers = (working?.layers || []).map(normalizeLayer);
    state.actions = (working?.actions || []).map(normalizeAction);
    state.activeCollectionId = working?.activeCollectionId ?? null;

    wireAddLayerControls();
    wireActionControls();
    wireGlobalControls();
    wireSidebar();

    const importedFromShareLink = await handleShareImportIfPresent();

    if (!importedFromShareLink) {
      renderAllLayers();
      renderAllActions();
    }
    renderSidebar();

    window.addEventListener('beforeunload', () => flushAutosave(getWorkingStateSnapshot));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAutosave(getWorkingStateSnapshot);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
