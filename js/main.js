(function () {
  const {
    initYouTubeApi,
    createPlayer,
    destroyPlayer,
    playLayer,
    stopLayer,
    setLayerVolume,
    setLayerQueue,
    nextVideo,
    previousVideo,
    setLayerLoop,
    setLayerShuffle,
    getPlaylistPosition,
    getCurrentTime,
    getEmbedContext,
    describePlayerError,
  } = window.SB.youtubeApi;
  const { parseYouTubeUrl, PARSE_ERROR_MESSAGES } = window.SB.urlParser;
  const {
    createLayer,
    normalizeLayer,
    buildLayerElement,
    isPlaylist,
    isYouTubePlaylist,
    primaryVideoId,
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

  const state = {
    layers: [],
    activeCollectionId: null,
  };
  let isDirty = false;
  let collectionsStore = { schemaVersion: 1, collectionOrder: [], collections: {} };

  const layerRefs = new Map(); // id -> { root, refs } from buildLayerElement
  const videoTitles = new Map(); // videoId -> title, for the per-layer queue list

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
    return { activeCollectionId: state.activeCollectionId, layers: state.layers };
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

      const parsed = parseYouTubeUrl(rawUrl);
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

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
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
      refs.playerContainer,
      {
        videoIds: layer.videoIds,
        playlistId: layer.playlistId,
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
        },
        onStateChange: (event) => {
          const isPlaying = event.data === 1; // YT.PlayerState.PLAYING
          setPlayingUI(refs, isPlaying);
          // The playlist moves on by itself, so refresh which entry is loaded.
          updateTrackLabel(layer.id, refs);
        },
        onError: (event) => {
          setLayerError(refs, describePlayerError(event.data), layerWatchUrl(layer));
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

  function updateTrackLabel(id, refs) {
    const layer = layerLookup(id);
    if (!layer || !isPlaylist(layer)) return;
    const position = getPlaylistPosition(id);
    if (!position) {
      setTrackLabel(refs, '');
      return;
    }
    const counter = position.total > 0 ? `${position.index + 1}/${position.total}` : '–';
    setTrackLabel(refs, position.title ? `${counter} · ${position.title}` : counter);
  }

  function maybeFetchTitle(id, player, refs) {
    const layer = layerLookup(id);
    if (!layer || layer.titleIsCustom) return;

    // For a playlist layer the player only knows the current video's title —
    // the layer wants the playlist's own name, which oEmbed provides.
    if (!isPlaylist(layer)) {
      let title = '';
      try {
        title = player.getVideoData?.().title || '';
      } catch {
        title = '';
      }

      if (title) {
        applyFetchedTitle(id, title, refs);
        return;
      }
    }

    const watchUrl = layerWatchUrl(layer);
    fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.title) applyFetchedTitle(id, data.title, refs);
      })
      .catch(() => { /* ignore, keep fallback title */ });
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
    const layer = createLayer({
      videoIds: parsed.videoId ? [parsed.videoId] : [],
      playlistId: parsed.kind === 'playlist' ? parsed.playlistId : '',
      sourceUrl,
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
    const parsed = parseYouTubeUrl(value);
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
      const parsed = parseYouTubeUrl(els.addInput.value);
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
      if (state.layers.length === 0) {
        showToast('Keine Ebenen zum Teilen vorhanden.');
        return;
      }
      const url = buildShareUrl(state.layers);
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
    collectionsStore = updateCollectionLayers(collectionsStore, state.activeCollectionId, state.layers);
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
    loadLayersIntoWorkingArea(collection.layers, id);
  }

  function loadLayersIntoWorkingArea(rawLayers, collectionId) {
    state.layers.forEach((l) => destroyPlayer(l.id));
    state.layers = rawLayers.map(normalizeLayer);
    state.activeCollectionId = collectionId ?? null;
    isDirty = false;
    renderAllLayers();
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

    const { store, id } = createCollection(collectionsStore, name, []);
    collectionsStore = store;
    saveCollectionsStore(collectionsStore);
    loadLayersIntoWorkingArea([], id);
    showToast(`Sammlung "${name}" angelegt.`);
  }

  async function handleSaveAs() {
    const name = await promptModal('Name für die Sammlung:', {
      title: 'Sammlung speichern',
      defaultValue: '',
      confirmLabel: 'Speichern',
    });
    if (!name) return;
    const { store, id } = createCollection(collectionsStore, name, state.layers);
    collectionsStore = store;
    saveCollectionsStore(collectionsStore);
    state.activeCollectionId = id;
    isDirty = false;
    markDirty();
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

  function showShareImportModal(count) {
    return showModal({
      title: 'Geteilte Sammlung öffnen',
      message: `Dieser Link enthält ${count} Ebene(n). Wie möchtest du fortfahren?`,
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

    const choice = await showShareImportModal(decoded.layers.length);
    let loaded = false;

    if (choice === 'new') {
      const layers = decoded.layers.map(normalizeLayer);
      const name = await promptModal('Name für die neue Sammlung:', {
        title: 'Als neue Sammlung speichern',
        defaultValue: 'Geteilte Sammlung',
        confirmLabel: 'Speichern & laden',
      });
      if (name) {
        const { store, id } = createCollection(collectionsStore, name, layers);
        collectionsStore = store;
        saveCollectionsStore(collectionsStore);
        loadLayersIntoWorkingArea(layers, id);
        loaded = true;
        showToast(`Sammlung "${name}" geladen.`);
      }
    } else if (choice === 'current') {
      loadLayersIntoWorkingArea(decoded.layers, null);
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
    initYouTubeApi();

    collectionsStore = loadCollectionsStore();
    const working = loadWorkingState();
    state.layers = (working?.layers || []).map(normalizeLayer);
    state.activeCollectionId = working?.activeCollectionId ?? null;

    wireAddLayerControls();
    wireGlobalControls();
    wireSidebar();

    const importedFromShareLink = await handleShareImportIfPresent();

    if (!importedFromShareLink) renderAllLayers();
    renderSidebar();

    window.addEventListener('beforeunload', () => flushAutosave(getWorkingStateSnapshot));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAutosave(getWorkingStateSnapshot);
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
