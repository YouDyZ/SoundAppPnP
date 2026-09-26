(function () {
  const LAYER_TYPES = window.SB.layer.LAYER_TYPES;

  const FORMAT_VERSION = '2';
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  // '.' is outside the base64url alphabet YouTube ids use, so it can join them.
  const ID_SEPARATOR = '.';
  const FLAG_LOOP = 1;
  const FLAG_SHUFFLE = 2;
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

  function encodeLayersToShareString(layers) {
    const body = layers
      .map((l) => {
        const flags = (l.loop ? FLAG_LOOP : 0) | (l.shuffle ? FLAG_SHUFFLE : 0);
        return [
          (l.videoIds || []).join(ID_SEPARATOR),
          l.playlistId || '',
          TYPE_TO_DIGIT[l.type] ?? '3',
          Math.round(clamp(l.volume, 0, 100)).toString(36),
          Math.max(0, Math.round(l.startSeconds || 0)).toString(36),
          flags.toString(36),
          encodeField(l.title || ''),
        ].join(',');
      })
      .join(';');
    return `${FORMAT_VERSION}:${body}`;
  }

  /** v1 tuple: videoId,type,volume,start,title */
  function decodeLayerV1(fields) {
    if (fields.length < 5) throw new Error('malformed tuple');
    const [videoId, typeDigit, volB36, startB36, encodedName] = fields;
    if (!VIDEO_ID_RE.test(videoId)) throw new Error('bad video id');
    return {
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

  /** Older links stay readable: v1 shares are still decoded, just never written. */
  function decodeShareString(str) {
    if (typeof str !== 'string' || !str) return { ok: false, reason: 'empty' };
    const sepIndex = str.indexOf(':');
    if (sepIndex === -1) return { ok: false, reason: 'invalid-format' };
    const version = str.slice(0, sepIndex);
    const decodeLayer = version === '1' ? decodeLayerV1 : version === '2' ? decodeLayerV2 : null;
    if (!decodeLayer) return { ok: false, reason: 'unsupported-version' };
    const body = str.slice(sepIndex + 1);
    if (!body) return { ok: true, layers: [] };

    try {
      const layers = splitEscaped(body, ';')
        .filter((tuple) => tuple.length > 0)
        .map((tuple) => decodeLayer(splitEscaped(tuple, ',')));
      return { ok: true, layers };
    } catch {
      return { ok: false, reason: 'parse-error' };
    }
  }

  function buildShareUrl(layers) {
    const compact = encodeLayersToShareString(layers);
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
