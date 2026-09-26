(function () {
  const LAYER_TYPES = [
    { value: 'ambience', label: 'Ambience' },
    { value: 'music', label: 'Musik' },
    { value: 'sfx', label: 'Soundeffekt' },
    { value: 'other', label: 'Sonstiges' },
  ];

  const TYPE_VALUES = new Set(LAYER_TYPES.map((t) => t.value));

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  /**
   * A layer holds a *list* of videos. Older saves (and share links) only knew a
   * single `videoId`, so those are lifted into a one-element list here.
   */
  function normalizeVideoIds(raw) {
    const list = Array.isArray(raw.videoIds) ? raw.videoIds : [];
    const ids = list.filter((id) => typeof id === 'string' && id);
    if (ids.length) return ids;
    return raw.videoId ? [raw.videoId] : [];
  }

  /**
   * Applies defaults over a raw (possibly partial/stale) layer object.
   * Every load path (autosave restore, collection load, share import) must
   * pipe raw data through this, so new fields can be added later without a
   * breaking migration.
   */
  function normalizeLayer(raw = {}) {
    const now = new Date().toISOString();
    return {
      id: raw.id || uuid(),
      provider: raw.provider === 'soundcloud' ? 'soundcloud' : 'youtube',
      videoIds: normalizeVideoIds(raw),
      playlistId: raw.playlistId || '',
      sourceUrl: raw.sourceUrl || '',
      title: raw.title || raw.sourceUrl || 'Unbenannte Ebene',
      titleIsCustom: !!raw.titleIsCustom,
      type: TYPE_VALUES.has(raw.type) ? raw.type : 'other',
      volume: clamp(Number.isFinite(raw.volume) ? raw.volume : 80, 0, 100),
      startSeconds: Number.isFinite(raw.startSeconds) ? Math.max(0, raw.startSeconds) : 0,
      isSet: !!raw.isSet,
      loop: !!raw.loop,
      shuffle: !!raw.shuffle,
      loopEnd: raw.loopEnd ?? null,
      cuePoints: Array.isArray(raw.cuePoints) ? raw.cuePoints : [],
      isExpanded: !!raw.isExpanded,
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now,
    };
  }

  function createLayer({
    provider = 'youtube',
    videoId,
    videoIds,
    playlistId = '',
    isSet = false,
    sourceUrl,
    startSeconds = 0,
    title,
    type = 'other',
  }) {
    return normalizeLayer({
      provider, videoId, videoIds, playlistId, isSet, sourceUrl, startSeconds, title, type,
    });
  }

  function isSoundCloud(layer) {
    return layer?.provider === 'soundcloud';
  }

  function primaryVideoId(layer) {
    return (layer && layer.videoIds && layer.videoIds[0]) || '';
  }

  /**
   * True for a list the app cannot reorder: a linked YouTube playlist or a
   * SoundCloud set. Both belong to the platform, not to this layer.
   */
  function isLinkedPlaylist(layer) {
    if (isSoundCloud(layer)) return !!layer.isSet;
    return !!(layer && layer.playlistId);
  }

  /** True whenever the layer plays more than one track, either way. */
  function isPlaylist(layer) {
    return isLinkedPlaylist(layer) || (layer?.videoIds?.length || 0) > 1;
  }

  /** Canonical URL for a layer — used for links and title lookups. */
  function layerWatchUrl(layer) {
    if (isSoundCloud(layer)) return layer.sourceUrl || 'https://soundcloud.com';
    if (layer?.playlistId) return `https://www.youtube.com/playlist?list=${layer.playlistId}`;
    return `https://www.youtube.com/watch?v=${primaryVideoId(layer)}`;
  }

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
  }

  /**
   * Builds the DOM for one layer card and returns { root, refs } where refs
   * holds direct references to the sub-elements the app needs to update in
   * place later (never rebuild this element on state changes — the YT player
   * living inside refs.playerContainer must survive re-renders).
   *
   * actions: {
   *   onTitleChange(id, title), onTypeChange(id, type), onVolumeChange(id, volume),
   *   onPlayStopClick(id), onExpandToggle(id), onSetStartPoint(id), onRemove(id),
   *   onPrevVideo(id), onNextVideo(id), onToggleLoop(id), onToggleShuffle(id),
   *   onQueueAdd(id, url), onQueueRemove(id, index), onQueueMove(id, index, delta),
   * }
   */
  function buildLayerElement(layer, actions) {
    const root = document.createElement('div');
    root.className = 'layer-card';
    root.dataset.layerId = layer.id;
    root.dataset.type = layer.type;

    const bar = document.createElement('div');
    bar.className = 'layer-bar';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'layer-type-select';
    typeSelect.setAttribute('aria-label', 'Ebenen-Typ');
    LAYER_TYPES.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label;
      if (t.value === layer.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => actions.onTypeChange(layer.id, typeSelect.value));

    const playlistBadge = document.createElement('span');
    playlistBadge.className = 'layer-playlist-badge';
    playlistBadge.title = 'Diese Ebene spielt mehrere Videos nacheinander ab';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'layer-title-input';
    titleInput.value = layer.title;
    titleInput.placeholder = 'Lädt Titel…';
    titleInput.setAttribute('aria-label', 'Name der Ebene');
    titleInput.addEventListener('change', () => actions.onTitleChange(layer.id, titleInput.value));

    const volumeInput = document.createElement('input');
    volumeInput.type = 'range';
    volumeInput.className = 'layer-volume';
    volumeInput.min = '0';
    volumeInput.max = '100';
    volumeInput.value = String(layer.volume);
    volumeInput.setAttribute('aria-label', 'Lautstärke');
    const volumeValue = document.createElement('span');
    volumeValue.className = 'layer-volume-value';
    volumeValue.textContent = `${layer.volume}%`;
    volumeInput.addEventListener('input', () => {
      volumeValue.textContent = `${volumeInput.value}%`;
      actions.onVolumeChange(layer.id, Number(volumeInput.value));
    });

    const playStopBtn = document.createElement('button');
    playStopBtn.type = 'button';
    playStopBtn.className = 'btn layer-playstop-btn';
    playStopBtn.textContent = '▶ Start';
    playStopBtn.addEventListener('click', () => actions.onPlayStopClick(layer.id));

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'icon-btn-plain layer-expand-btn';
    expandBtn.setAttribute('aria-expanded', String(layer.isExpanded));
    expandBtn.title = 'Aufklappen (Video anzeigen, Startpunkt setzen)';
    expandBtn.textContent = '▾';
    expandBtn.addEventListener('click', () => actions.onExpandToggle(layer.id));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn-plain layer-remove-btn';
    removeBtn.title = 'Ebene entfernen';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => actions.onRemove(layer.id));

    bar.append(typeSelect, playlistBadge, titleInput, volumeInput, volumeValue, playStopBtn, expandBtn, removeBtn);

    const errorBadge = document.createElement('div');
    errorBadge.className = 'layer-error-badge';

    const expandedPanel = document.createElement('div');
    expandedPanel.className = 'layer-expanded-panel';

    const playerWrapper = document.createElement('div');
    playerWrapper.className = 'layer-player-wrapper collapsed';
    const playerContainer = document.createElement('div');
    playerWrapper.appendChild(playerContainer);

    const queueSection = document.createElement('div');
    queueSection.className = 'layer-queue';
    // A linked YouTube playlist is owned by YouTube — its entries cannot be
    // edited from here, so the queue editor only applies to local lists.
    queueSection.hidden = isLinkedPlaylist(layer) || isSoundCloud(layer);

    const queueList = document.createElement('ol');
    queueList.className = 'layer-queue-list';

    const queueAddRow = document.createElement('div');
    queueAddRow.className = 'layer-queue-add';

    const queueInput = document.createElement('input');
    queueInput.type = 'text';
    queueInput.className = 'layer-queue-input';
    queueInput.placeholder = 'Weiteres Video an diese Ebene anhängen…';
    queueInput.setAttribute('aria-label', 'Video an diese Ebene anhängen');

    const queueAddBtn = document.createElement('button');
    queueAddBtn.type = 'button';
    queueAddBtn.className = 'btn';
    queueAddBtn.textContent = '＋ Anhängen';

    const queueError = document.createElement('p');
    queueError.className = 'field-error layer-queue-error';
    queueError.hidden = true;

    function submitQueueAdd() {
      actions.onQueueAdd(layer.id, queueInput.value);
    }
    queueAddBtn.addEventListener('click', submitQueueAdd);
    queueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitQueueAdd();
    });

    queueAddRow.append(queueInput, queueAddBtn);
    queueSection.append(queueList, queueAddRow, queueError);

    const playlistRow = document.createElement('div');
    playlistRow.className = 'layer-playlist-row';
    playlistRow.hidden = !isPlaylist(layer);

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'btn';
    prevBtn.textContent = '⏮ Vorheriges';
    prevBtn.addEventListener('click', () => actions.onPrevVideo(layer.id));

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'btn';
    nextBtn.textContent = '⏭ Nächstes';
    nextBtn.addEventListener('click', () => actions.onNextVideo(layer.id));

    const loopBtn = document.createElement('button');
    loopBtn.type = 'button';
    loopBtn.className = 'btn toggle-btn';
    loopBtn.textContent = '🔁 Endlos';
    loopBtn.title = 'Playlist endlos wiederholen';
    loopBtn.setAttribute('aria-pressed', String(layer.loop));
    loopBtn.classList.toggle('is-active', layer.loop);
    loopBtn.addEventListener('click', () => actions.onToggleLoop(layer.id));

    const shuffleBtn = document.createElement('button');
    shuffleBtn.type = 'button';
    shuffleBtn.className = 'btn toggle-btn';
    shuffleBtn.textContent = '🔀 Zufall';
    shuffleBtn.title = 'Playlist in zufälliger Reihenfolge abspielen';
    shuffleBtn.setAttribute('aria-pressed', String(layer.shuffle));
    shuffleBtn.classList.toggle('is-active', layer.shuffle);
    shuffleBtn.addEventListener('click', () => actions.onToggleShuffle(layer.id));

    const trackLabel = document.createElement('span');
    trackLabel.className = 'layer-track-label';

    playlistRow.append(prevBtn, nextBtn, loopBtn, shuffleBtn, trackLabel);

    const startRow = document.createElement('div');
    startRow.className = 'layer-start-row';
    // A playlist has no single meaningful start point — it moves from video to
    // video — so the cue-point row only applies to single-video layers.
    startRow.hidden = isPlaylist(layer);

    const startLabel = document.createElement('span');
    startLabel.className = 'layer-start-label';
    startLabel.textContent = `Startpunkt: ${formatTime(layer.startSeconds)}`;

    const setStartBtn = document.createElement('button');
    setStartBtn.type = 'button';
    setStartBtn.className = 'btn';
    setStartBtn.textContent = 'Startpunkt hier setzen';
    setStartBtn.addEventListener('click', () => actions.onSetStartPoint(layer.id));

    startRow.append(startLabel, setStartBtn);
    expandedPanel.append(playerWrapper, queueSection, playlistRow, startRow);

    root.append(bar, errorBadge, expandedPanel);

    if (layer.isExpanded) {
      root.classList.add('expanded');
      playerWrapper.classList.remove('collapsed');
    }

    return {
      root,
      refs: {
        typeSelect,
        playlistBadge,
        titleInput,
        volumeInput,
        volumeValue,
        playStopBtn,
        expandBtn,
        errorBadge,
        playerWrapper,
        playerContainer,
        startLabel,
        startRow,
        playlistRow,
        queueSection,
        queueList,
        queueInput,
        queueError,
        prevBtn,
        nextBtn,
        loopBtn,
        shuffleBtn,
        trackLabel,
      },
    };
  }

  /**
   * Renders the per-layer error line. Passing an empty message clears it
   * (the `:empty` CSS rule then hides the badge again).
   */
  function setLayerError(refs, message, watchUrl) {
    refs.errorBadge.textContent = '';
    if (!message) return;

    const text = document.createElement('span');
    text.textContent = message;
    refs.errorBadge.appendChild(text);

    if (watchUrl) {
      const link = document.createElement('a');
      link.className = 'layer-error-link';
      link.href = watchUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Auf YouTube ansehen \u2197';
      refs.errorBadge.appendChild(link);
    }
  }

  /**
   * Redraws the per-layer video queue and everything that depends on how many
   * videos the layer holds (badge, playlist controls, start-point row).
   * `titleFor(videoId)` supplies a human-readable name where one is known.
   */
  function renderQueue(layer, refs, actions, titleFor) {
    const ids = layer.videoIds || [];
    const linked = isLinkedPlaylist(layer) || isSoundCloud(layer);

    refs.playlistBadge.hidden = !isPlaylist(layer) && !isSoundCloud(layer);
    if (isSoundCloud(layer)) {
      refs.playlistBadge.textContent = layer.isSet ? '☁ SoundCloud-Set' : '☁ SoundCloud';
    } else {
      // A YouTube playlist id only lives here until its videos are known —
      // adoptPlaylistAsQueue turns it into the layer's own queue.
      refs.playlistBadge.textContent = linked
        ? '☰ Playlist wird übernommen…'
        : `☰ Playlist (${ids.length})`;
    }
    // SoundCloud's widget offers no shuffle, so the control is hidden there
    // rather than shown as a button that silently does nothing.
    refs.shuffleBtn.hidden = isSoundCloud(layer);
    refs.playlistRow.hidden = !isPlaylist(layer);
    refs.startRow.hidden = isPlaylist(layer);
    refs.queueSection.hidden = linked;
    if (linked) return;

    refs.queueList.textContent = '';
    ids.forEach((videoId, index) => {
      const item = document.createElement('li');
      item.className = 'layer-queue-item';

      const name = document.createElement('span');
      name.className = 'layer-queue-title';
      name.textContent = titleFor?.(videoId) || videoId;
      name.title = videoId;

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'icon-btn-plain';
      up.textContent = '▲';
      up.title = 'Nach oben';
      up.disabled = index === 0;
      up.addEventListener('click', () => actions.onQueueMove(layer.id, index, -1));

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'icon-btn-plain';
      down.textContent = '▼';
      down.title = 'Nach unten';
      down.disabled = index === ids.length - 1;
      down.addEventListener('click', () => actions.onQueueMove(layer.id, index, 1));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-btn-plain';
      remove.textContent = '✕';
      remove.title = 'Video aus dieser Ebene entfernen';
      // The layer must keep at least one video — otherwise remove the layer.
      remove.disabled = ids.length <= 1;
      remove.addEventListener('click', () => actions.onQueueRemove(layer.id, index));

      item.append(name, up, down, remove);
      refs.queueList.appendChild(item);
    });
  }

  function setQueueError(refs, message) {
    refs.queueError.textContent = message || '';
    refs.queueError.hidden = !message;
  }

  function setToggleUI(button, isOn) {
    button.classList.toggle('is-active', isOn);
    button.setAttribute('aria-pressed', String(isOn));
  }

  /** Shows which video of the playlist is currently loaded. */
  function setTrackLabel(refs, text) {
    refs.trackLabel.textContent = text || '';
  }

  function updateStartLabel(refs, startSeconds) {
    refs.startLabel.textContent = `Startpunkt: ${formatTime(startSeconds)}`;
  }

  function setExpandedUI(root, refs, isExpanded) {
    root.classList.toggle('expanded', isExpanded);
    refs.expandBtn.setAttribute('aria-expanded', String(isExpanded));
    refs.playerWrapper.classList.toggle('collapsed', !isExpanded);
  }

  function setPlayingUI(refs, isPlaying) {
    refs.playStopBtn.classList.toggle('is-playing', isPlaying);
    refs.playStopBtn.textContent = isPlaying ? '⏹ Stop' : '▶ Start';
  }

  window.SB = window.SB || {};
  window.SB.layer = {
    LAYER_TYPES,
    normalizeLayer,
    createLayer,
    buildLayerElement,
    isPlaylist,
    isLinkedPlaylist,
    isSoundCloud,
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
  };
})();
