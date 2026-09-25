(function () {
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  const ALLOWED_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
  ]);

  const PATH_ID_SEGMENTS = new Set(['embed', 'shorts', 'live']);

  function parseDurationParam(value) {
    if (value == null) return null;
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
    if (!match || (!match[1] && !match[2] && !match[3])) return null;
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  function extractStartSeconds(searchParams) {
    const raw = searchParams.get('t') ?? searchParams.get('start');
    const parsed = parseDurationParam(raw);
    return parsed == null ? 0 : parsed;
  }

  /**
   * Parses a pasted string into a YouTube video reference.
   * Returns { ok: true, videoId, startSeconds } or { ok: false, reason }.
   * reason is one of: empty | invalid-url | unsupported-host | no-video-id | invalid-video-id | playlist-only
   */
  function parseYouTubeUrl(input) {
    const trimmed = (input ?? '').trim();
    if (!trimmed) return { ok: false, reason: 'empty' };

    if (VIDEO_ID_RE.test(trimmed)) {
      return { ok: true, videoId: trimmed, startSeconds: 0 };
    }

    let url;
    try {
      url = new URL(trimmed);
    } catch {
      return { ok: false, reason: 'invalid-url' };
    }

    const host = url.hostname.toLowerCase();

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (!id) return { ok: false, reason: 'no-video-id' };
      if (!VIDEO_ID_RE.test(id)) return { ok: false, reason: 'invalid-video-id' };
      return { ok: true, videoId: id, startSeconds: extractStartSeconds(url.searchParams) };
    }

    if (!ALLOWED_HOSTS.has(host)) {
      return { ok: false, reason: 'unsupported-host' };
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const firstSegment = segments[0] || '';

    if (firstSegment === 'watch' || url.pathname === '/watch') {
      const v = url.searchParams.get('v');
      if (!v) {
        if (url.searchParams.get('list')) return { ok: false, reason: 'playlist-only' };
        return { ok: false, reason: 'no-video-id' };
      }
      if (!VIDEO_ID_RE.test(v)) return { ok: false, reason: 'invalid-video-id' };
      return { ok: true, videoId: v, startSeconds: extractStartSeconds(url.searchParams) };
    }

    if (PATH_ID_SEGMENTS.has(firstSegment)) {
      const id = segments[1];
      if (!id) return { ok: false, reason: 'no-video-id' };
      if (!VIDEO_ID_RE.test(id)) return { ok: false, reason: 'invalid-video-id' };
      return { ok: true, videoId: id, startSeconds: extractStartSeconds(url.searchParams) };
    }

    if (firstSegment === 'playlist') {
      return { ok: false, reason: 'playlist-only' };
    }

    return { ok: false, reason: 'no-video-id' };
  }

  const PARSE_ERROR_MESSAGES = {
    empty: '',
    'invalid-url': 'Das ist keine gültige URL.',
    'unsupported-host': 'Nur YouTube- oder YouTube-Music-Links werden unterstützt.',
    'no-video-id': 'In diesem Link konnte keine Video-ID gefunden werden.',
    'invalid-video-id': 'Die Video-ID sieht ungültig aus.',
    'playlist-only': 'Playlists werden nicht unterstützt — bitte verlinke ein einzelnes Video.',
  };

  window.SB = window.SB || {};
  window.SB.urlParser = { parseYouTubeUrl, PARSE_ERROR_MESSAGES };
})();
