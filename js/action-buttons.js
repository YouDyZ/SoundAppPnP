(function () {
  const { uuid, clamp, formatTime, parseTimeInput } = window.SB.util;

  /**
   * An action button is a one-shot sound: pressing it plays the sound once,
   * from its start point to its (optional) end point, and that is it — unlike a
   * layer, which keeps running until it is stopped. Buttons live in the working
   * state next to the layers and are saved, loaded and shared with them.
   */
  function normalizeAction(raw = {}) {
    const now = new Date().toISOString();
    const startSeconds = Number.isFinite(raw.startSeconds) ? Math.max(0, raw.startSeconds) : 0;
    const rawEnd = Number.isFinite(raw.endSeconds) ? Math.max(0, raw.endSeconds) : null;
    return {
      id: raw.id || uuid(),
      provider: raw.provider === 'soundcloud' ? 'soundcloud' : 'youtube',
      videoId: raw.videoId || '',
      sourceUrl: raw.sourceUrl || '',
      label: raw.label || 'Sound',
      labelIsCustom: !!raw.labelIsCustom,
      volume: clamp(Number.isFinite(raw.volume) ? raw.volume : 80, 0, 100),
      startSeconds,
      // An end point before the start point would never stop playback.
      endSeconds: rawEnd != null && rawEnd > startSeconds ? rawEnd : null,
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now,
    };
  }

  function createAction({ provider = 'youtube', videoId = '', sourceUrl = '', label, startSeconds = 0 }) {
    return normalizeAction({ provider, videoId, sourceUrl, label, startSeconds });
  }

  function actionSourceUrl(action) {
    if (action.provider === 'soundcloud') return action.sourceUrl || 'https://soundcloud.com';
    return `https://www.youtube.com/watch?v=${action.videoId}`;
  }

  /**
   * Builds one button plus its (collapsed) settings panel.
   * actions: { onTrigger(id), onEditToggle(id), onLabelChange(id, label),
   *            onVolumeChange(id, volume), onRangeChange(id, {start, end}),
   *            onUseCurrentTime(id, field), onRemove(id) }
   */
  function buildActionElement(action, handlers) {
    const root = document.createElement('div');
    root.className = 'action-item';
    root.dataset.actionId = action.id;

    const triggerRow = document.createElement('div');
    triggerRow.className = 'action-trigger-row';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'action-btn';
    trigger.textContent = action.label;
    trigger.title = 'Einmal abspielen';
    trigger.addEventListener('click', () => handlers.onTrigger(action.id));

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn-plain action-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Einstellungen';
    editBtn.setAttribute('aria-expanded', 'false');
    editBtn.addEventListener('click', () => handlers.onEditToggle(action.id));

    triggerRow.append(trigger, editBtn);

    const panel = document.createElement('div');
    panel.className = 'action-panel';
    panel.hidden = true;

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'action-label-input';
    labelInput.value = action.label;
    labelInput.setAttribute('aria-label', 'Beschriftung');
    labelInput.addEventListener('change', () => handlers.onLabelChange(action.id, labelInput.value));

    const volumeInput = document.createElement('input');
    volumeInput.type = 'range';
    volumeInput.min = '0';
    volumeInput.max = '100';
    volumeInput.value = String(action.volume);
    volumeInput.className = 'action-volume';
    volumeInput.setAttribute('aria-label', 'Lautstärke');
    const volumeValue = document.createElement('span');
    volumeValue.className = 'action-volume-value';
    volumeValue.textContent = `${action.volume}%`;
    volumeInput.addEventListener('input', () => {
      volumeValue.textContent = `${volumeInput.value}%`;
      handlers.onVolumeChange(action.id, Number(volumeInput.value));
    });

    const startInput = document.createElement('input');
    startInput.type = 'text';
    startInput.className = 'action-time-input';
    startInput.value = formatTime(action.startSeconds);
    startInput.setAttribute('aria-label', 'Startpunkt');

    const endInput = document.createElement('input');
    endInput.type = 'text';
    endInput.className = 'action-time-input';
    endInput.value = action.endSeconds == null ? '' : formatTime(action.endSeconds);
    endInput.placeholder = 'bis Ende';
    endInput.setAttribute('aria-label', 'Endpunkt');

    function commitRange() {
      handlers.onRangeChange(action.id, { start: startInput.value, end: endInput.value });
    }
    startInput.addEventListener('change', commitRange);
    endInput.addEventListener('change', commitRange);

    const grabStart = document.createElement('button');
    grabStart.type = 'button';
    grabStart.className = 'btn';
    grabStart.textContent = 'Start ⟵ jetzt';
    grabStart.title = 'Aktuelle Position als Startpunkt übernehmen';
    grabStart.addEventListener('click', () => handlers.onUseCurrentTime(action.id, 'start'));

    const grabEnd = document.createElement('button');
    grabEnd.type = 'button';
    grabEnd.className = 'btn';
    grabEnd.textContent = 'Ende ⟵ jetzt';
    grabEnd.title = 'Aktuelle Position als Endpunkt übernehmen';
    grabEnd.addEventListener('click', () => handlers.onUseCurrentTime(action.id, 'end'));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = 'Entfernen';
    removeBtn.addEventListener('click', () => handlers.onRemove(action.id));

    const timeRow = document.createElement('div');
    timeRow.className = 'action-time-row';
    const fromLabel = document.createElement('span');
    fromLabel.textContent = 'von';
    const toLabel = document.createElement('span');
    toLabel.textContent = 'bis';
    timeRow.append(fromLabel, startInput, toLabel, endInput, grabStart, grabEnd);

    const volumeRow = document.createElement('div');
    volumeRow.className = 'action-volume-row';
    volumeRow.append(volumeInput, volumeValue);

    const sourceLink = document.createElement('a');
    sourceLink.className = 'action-source-link';
    sourceLink.href = actionSourceUrl(action);
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener';
    sourceLink.textContent = action.provider === 'soundcloud' ? 'Auf SoundCloud ↗' : 'Auf YouTube ↗';

    const footRow = document.createElement('div');
    footRow.className = 'action-foot-row';
    footRow.append(sourceLink, removeBtn);

    const error = document.createElement('p');
    error.className = 'field-error';
    error.hidden = true;

    // The hidden player for this sound lives here, so it is created once and
    // reused on every press instead of being rebuilt per trigger.
    const playerHost = document.createElement('div');
    playerHost.className = 'action-player-host';
    const playerContainer = document.createElement('div');
    playerHost.appendChild(playerContainer);

    panel.append(labelInput, volumeRow, timeRow, playerHost, footRow, error);
    root.append(triggerRow, panel);

    return {
      root,
      refs: { trigger, editBtn, panel, labelInput, volumeInput, volumeValue, startInput, endInput, error, playerHost, playerContainer },
    };
  }

  function setActionEditing(refs, isEditing) {
    refs.panel.hidden = !isEditing;
    refs.editBtn.setAttribute('aria-expanded', String(isEditing));
  }

  function setActionPlaying(refs, isPlaying) {
    refs.trigger.classList.toggle('is-firing', isPlaying);
  }

  function setActionError(refs, message) {
    refs.error.textContent = message || '';
    refs.error.hidden = !message;
  }

  function updateActionLabel(refs, label) {
    refs.trigger.textContent = label;
    if (refs.labelInput.value !== label) refs.labelInput.value = label;
  }

  function updateActionRange(refs, action) {
    refs.startInput.value = formatTime(action.startSeconds);
    refs.endInput.value = action.endSeconds == null ? '' : formatTime(action.endSeconds);
  }

  /** Reads the two time fields, returning null for an empty end point. */
  function readRange({ start, end }, current) {
    const startSeconds = parseTimeInput(start, current.startSeconds);
    const parsedEnd = String(end || '').trim() ? parseTimeInput(end, null) : null;
    return {
      startSeconds,
      endSeconds: parsedEnd != null && parsedEnd > startSeconds ? parsedEnd : null,
    };
  }

  window.SB = window.SB || {};
  window.SB.actionButtons = {
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
  };
})();
