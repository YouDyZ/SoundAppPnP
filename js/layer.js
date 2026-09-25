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
   * Applies defaults over a raw (possibly partial/stale) layer object.
   * Every load path (autosave restore, collection load, share import) must
   * pipe raw data through this, so new fields can be added later without a
   * breaking migration.
   */
  function normalizeLayer(raw = {}) {
    const now = new Date().toISOString();
    return {
      id: raw.id || uuid(),
      videoId: raw.videoId || '',
      sourceUrl: raw.sourceUrl || '',
      title: raw.title || raw.sourceUrl || 'Unbenannte Ebene',
      titleIsCustom: !!raw.titleIsCustom,
      type: TYPE_VALUES.has(raw.type) ? raw.type : 'other',
      volume: clamp(Number.isFinite(raw.volume) ? raw.volume : 80, 0, 100),
      startSeconds: Number.isFinite(raw.startSeconds) ? Math.max(0, raw.startSeconds) : 0,
      loopEnd: raw.loopEnd ?? null,
      cuePoints: Array.isArray(raw.cuePoints) ? raw.cuePoints : [],
      isExpanded: !!raw.isExpanded,
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now,
    };
  }

  function createLayer({ videoId, sourceUrl, startSeconds = 0, title, type = 'other' }) {
    return normalizeLayer({ videoId, sourceUrl, startSeconds, title, type });
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

    bar.append(typeSelect, titleInput, volumeInput, volumeValue, playStopBtn, expandBtn, removeBtn);

    const errorBadge = document.createElement('div');
    errorBadge.className = 'layer-error-badge';

    const expandedPanel = document.createElement('div');
    expandedPanel.className = 'layer-expanded-panel';

    const playerWrapper = document.createElement('div');
    playerWrapper.className = 'layer-player-wrapper collapsed';
    const playerContainer = document.createElement('div');
    playerWrapper.appendChild(playerContainer);

    const startRow = document.createElement('div');
    startRow.className = 'layer-start-row';

    const startLabel = document.createElement('span');
    startLabel.className = 'layer-start-label';
    startLabel.textContent = `Startpunkt: ${formatTime(layer.startSeconds)}`;

    const setStartBtn = document.createElement('button');
    setStartBtn.type = 'button';
    setStartBtn.className = 'btn';
    setStartBtn.textContent = 'Startpunkt hier setzen';
    setStartBtn.addEventListener('click', () => actions.onSetStartPoint(layer.id));

    startRow.append(startLabel, setStartBtn);
    expandedPanel.append(playerWrapper, startRow);

    root.append(bar, errorBadge, expandedPanel);

    if (layer.isExpanded) {
      root.classList.add('expanded');
      playerWrapper.classList.remove('collapsed');
    }

    return {
      root,
      refs: {
        typeSelect,
        titleInput,
        volumeInput,
        volumeValue,
        playStopBtn,
        expandBtn,
        errorBadge,
        playerWrapper,
        playerContainer,
        startLabel,
      },
    };
  }

  /**
   * Renders the per-layer error line. Passing an empty message clears it
   * (the `:empty` CSS rule then hides the badge again).
   */
  function setLayerError(refs, message, videoId) {
    refs.errorBadge.textContent = '';
    if (!message) return;

    const text = document.createElement('span');
    text.textContent = message;
    refs.errorBadge.appendChild(text);

    if (videoId) {
      const link = document.createElement('a');
      link.className = 'layer-error-link';
      link.href = `https://www.youtube.com/watch?v=${videoId}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Auf YouTube ansehen \u2197';
      refs.errorBadge.appendChild(link);
    }
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
    setLayerError,
    updateStartLabel,
    setExpandedUI,
    setPlayingUI,
  };
})();
