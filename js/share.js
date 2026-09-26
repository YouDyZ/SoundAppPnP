(function () {
  const LAYER_TYPES = window.SB.layer.LAYER_TYPES;

  const FORMAT_VERSION = '3';
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  // '.' is outside the base64url alphabet YouTube ids use, so it can join them.
  const ID_SEPARATOR = '.';
  const FLAG_LOOP = 1;
  const FLAG_SHUFFLE = 2;
  const FLAG_IS_SET = 4;
  // Separates the layer section from the action-button section.
  const SECTION_SEPARATOR = '~';
  const PROVIDER_TO_DIGIT = { youtube: '0', soundcloud: '1' };
  const DIGIT_TO_PROVIDER = { 0: 'youtube', 1: 'soundcloud' };
  const TYPE_TO_DIGIT = Object.fromEntries(LAYER_TYPES.map((t, i) => [t.value, String(i)]));
  const DIGIT_TO_TYPE = Object.fromEntries(LAYER_TYPES.map((t, i) => [String(i), t.value]));

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function encodeField(str) {
    let out = '';
    for (const ch of String(str)) {
      if (ch === '\\') out += '\\\\';
      else if (ch === ',') out += '\\c';
      else if (ch === ';') out += '\\s';
      else if (ch === SECTION_SEPARATOR) out += '\\t';
      else out += ch;
    }
    return out;
  }

  function decodeField(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '\\') {
        const next = str[i + 1];
        if (next === '\\') out += '\\';
        else if (next === 'c') out += ',';
        else if (next === 's') out += ';';
        else if (next === 't') out += SECTION_SEPARATOR;
        else if (next !== undefined) out += next;
        i++;
      } else {
        out += ch;
      }
    }
    return out;
  }

  /** Splits on an unescaped delimiter, leaving `\<delim>`/`\\` sequences intact for decodeField(). */
  function splitEscaped(str, delimiter) {
    const parts = [];
    let current = '';
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '\\') {
        current += ch + (str[i + 1] ?? '');
        i++;
      } else if (ch === delimiter) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    parts.push(current);
    return parts;
  }

  function encodeLayer(l) {
    const flags = (l.loop ? FLAG_LOOP : 0)
      | (l.shuffle ? FLAG_SHUFFLE : 0)
      | (l.isSet ? FLAG_IS_SET : 0);
    return [
      PROVIDER_TO_DIGIT[l.provider] ?? '0',
      (l.videoIds || []).join(ID_SEPARATOR),
      l.playlistId || '',
      encodeField(l.provider === 'soundcloud' ? (l.sourceUrl || '') : ''),
      TYPE_TO_DIGIT[l.type] ?? '3',
      Math.round(clamp(l.volume, 0, 100)).toString(36),
      Math.max(0, Math.round(l.startSeconds || 0)).toString(36),
      flags.toString(36),
      encodeField(l.title || ''),
    ].join(',');
  }

  function encodeAction(a) {
    return [
      PROVIDER_TO_DIGIT[a.provider] ?? '0',
      a.videoId || '',
      encodeField(a.provider === 'soundcloud' ? (a.sourceUrl || '') : ''),
      Math.round(clamp(a.volume, 0, 100)).toString(36),
      Math.max(0, Math.round(a.startSeconds || 0)).toString(36),
      a.endSeconds == null ? '' : Math.max(0, Math.round(a.endSeconds)).toString(36),
      encodeField(a.label || ''),
    ].join(',');
  }

  function encodeLayersToShareString(layers, actions = []) {
    const layerPart = layers.map(encodeLayer).join(';');
    const actionPart = (actions || []).map(encodeAction).join(';');
    return `${FORMAT_VERSION}:${layerPart}${SECTION_SEPARATOR}${actionPart}`;
  }

  /** v1 tuple: videoId,type,volume,start,title */
  function decodeLayerV1(fields) {
    if (fields.length < 5) throw new Error('malformed tuple');
    const [videoId, typeDigit, volB36, startB36, encodedName] = fields;
    if (!VIDEO_ID_RE.test(videoId)) throw new Error('bad video id');
    return {
      provider: 'youtube',
      videoIds: [videoId],
      playlistId: '',
      type: DIGIT_TO_TYPE[typeDigit] || 'other',
      volume: clamp(parseInt(volB36, 36) || 0, 0, 100),
      startSeconds: Math.max(0, parseInt(startB36, 36) || 0),
      loop: false,
      shuffle: false,
      title: decodeField(encodedName),
      sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  /** v2 tuple: videoIds,playlistId,type,volume,start,flags,title */
  function decodeLayerV2(fields) {
    if (fields.length < 7) throw new Error('malformed tuple');
    const [ids, playlistId, typeDigit, volB36, startB36, flagsB36, encodedName] = fields;
    const videoIds = ids ? ids.split(ID_SEPARATOR).filter(Boolean) : [];
    if (!playlistId && !videoIds.length) throw new Error('neither video nor playlist');
    if (videoIds.some((id) => !VIDEO_ID_RE.test(id))) throw new Error('bad video id');
    if (playlistId && !/^[A-Za-z0-9_-]{12,}$/.test(playlistId)) throw new Error('bad playlist id');
    const flags = parseInt(flagsB36, 36) || 0;
    return {
      provider: 'youtube',
      videoIds,
      playlistId,
      type: DIGIT_TO_TYPE[typeDigit] || 'other',
      volume: clamp(parseInt(volB36, 36) || 0, 0, 100),
      startSeconds: Math.max(0, parseInt(startB36, 36) || 0),
      loop: !!(flags & FLAG_LOOP),
      shuffle: !!(flags & FLAG_SHUFFLE),
      title: decodeField(encodedName),
      sourceUrl: playlistId
        ? `https://www.youtube.com/playlist?list=${playlistId}`
        : `https://www.youtube.com/watch?v=${videoIds[0]}`,
    };
  }

  /** v3 tuple: provider,videoIds,playlistId,sourceUrl,type,volume,start,flags,title */
  function decodeLayerV3(fields) {
    if (fields.length < 9) throw new Error('malformed tuple');
    const [providerDigit, ids, playlistId, encodedSource, typeDigit, volB36, startB36, flagsB36, encodedName] = fields;
    const provider = DIGIT_TO_PROVIDER[providerDigit] || 'youtube';
    const videoIds = ids ? ids.split(ID_SEPARATOR).filter(Boolean) : [];
    const sourceUrl = decodeField(encodedSource);
    const flags = parseInt(flagsB36, 36) || 0;

    if (provider === 'soundcloud') {
      if (!/^https?:\/\/[^\s]+$/.test(sourceUrl)) throw new Error('bad soundcloud url');
    } else {
      if (!playlistId && !videoIds.length) throw new Error('neither video nor playlist');
      if (videoIds.some((id) => !VIDEO_ID_RE.test(id))) throw new Error('bad video id');
      if (playlistId && !/^[A-Za-z0-9_-]{12,}$/.test(playlistId)) throw new Error('bad playlist id');
    }

    return {
      provider,
      videoIds,
      playlistId: provider === 'soundcloud' ? '' : playlistId,
      isSet: !!(flags & FLAG_IS_SET),
      type: DIGIT_TO_TYPE[typeDigit] || 'other',
      volume: clamp(parseInt(volB36, 36) || 0, 0, 100),
      startSeconds: Math.max(0, parseInt(startB36, 36) || 0),
      loop: !!(flags & FLAG_LOOP),
      shuffle: !!(flags & FLAG_SHUFFLE),
      title: decodeField(encodedName),
      sourceUrl: provider === 'soundcloud'
        ? sourceUrl
        : (playlistId
          ? `https://www.youtube.com/playlist?list=${playlistId}`
          : `https://www.youtube.com/watch?v=${videoIds[0]}`),
    };
  }

  /** action tuple: provider,videoId,sourceUrl,volume,start,end,label */
  function decodeAction(fields) {
    if (fields.length < 7) throw new Error('malformed action');
    const [providerDigit, videoId, encodedSource, volB36, startB36, endB36, encodedLabel] = fields;
    const provider = DIGIT_TO_PROVIDER[providerDigit] || 'youtube';
    const sourceUrl = decodeField(encodedSource);

    if (provider === 'soundcloud') {
      if (!/^https?:\/\/[^\s]+$/.test(sourceUrl)) throw new Error('bad soundcloud url');
    } else if (!VIDEO_ID_RE.test(videoId)) {
      throw new Error('bad video id');
    }

    const startSeconds = Math.max(0, parseInt(startB36, 36) || 0);
    const endSeconds = endB36 ? Math.max(0, parseInt(endB36, 36) || 0) : null;
    return {
      provider,
      videoId: provider === 'soundcloud' ? '' : videoId,
      sourceUrl,
      volume: clamp(parseInt(volB36, 36) || 0, 0, 100),
      startSeconds,
      endSeconds: endSeconds != null && endSeconds > startSeconds ? endSeconds : null,
      label: decodeField(encodedLabel),
      labelIsCustom: true,
    };
  }

  /** Older links stay readable: v1/v2 shares are still decoded, just never written. */
  function decodeShareString(str) {
    if (typeof str !== 'string' || !str) return { ok: false, reason: 'empty' };
    const sepIndex = str.indexOf(':');
    if (sepIndex === -1) return { ok: false, reason: 'invalid-format' };
    const version = str.slice(0, sepIndex);
    const decodeLayer = { 1: decodeLayerV1, 2: decodeLayerV2, 3: decodeLayerV3 }[version];
    if (!decodeLayer) return { ok: false, reason: 'unsupported-version' };

    const body = str.slice(sepIndex + 1);
    if (!body) return { ok: true, layers: [], actions: [] };

    // Only v3 carries an action-button section.
    const sections = version === '3' ? splitEscaped(body, SECTION_SEPARATOR) : [body];
    const layerBody = sections[0] || '';
    const actionBody = sections[1] || '';

    try {
      const layers = splitEscaped(layerBody, ';')
        .filter((tuple) => tuple.length > 0)
        .map((tuple) => decodeLayer(splitEscaped(tuple, ',')));
      const actions = splitEscaped(actionBody, ';')
        .filter((tuple) => tuple.length > 0)
        .map((tuple) => decodeAction(splitEscaped(tuple, ',')));
      return { ok: true, layers, actions };
    } catch {
      return { ok: false, reason: 'parse-error' };
    }
  }

  function buildShareUrl(layers, actions = []) {
    const compact = encodeLayersToShareString(layers, actions);
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('share', compact);
    return url.toString();
  }

  function extractShareParam() {
    const params = new URLSearchParams(window.location.search);
    return params.get('share');
  }

  function stripShareParamFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('share');
    window.history.replaceState({}, '', url.toString());
  }

  window.SB = window.SB || {};
  window.SB.share = {
    encodeLayersToShareString,
    decodeShareString,
    buildShareUrl,
    extractShareParam,
    stripShareParamFromUrl,
  };
})();
