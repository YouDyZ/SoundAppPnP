(function () {
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  // Playlists YouTube lets third parties embed: user playlists (PL), channel
  // uploads (UU), auto-generated album/chart lists (OL) and the legacy
  // favourites//topic variants (FL/TL/UL).
  const PLAYLIST_ID_RE = /^(?:PL|UU|OL|FL|TL|UL)[A-Za-z0-9_-]{10,}$/;
  // "Watch later" and "Liked videos" are per-account and never embeddable.
  const PRIVATE_LIST_RE = /^(?:WL|LL)/;
  // RD… are auto-generated mixes/radios; YouTube refuses them in embeds.
  const MIX_LIST_RE = /^RD/;

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

  /**
   * Classifies a `list=` value: 'playlist' (embeddable), 'private' (WL/LL),
   * 'mix' (auto-generated RD…) or 'invalid'.
   */
  function classifyListId(listId) {
    if (!listId) return 'invalid';
    if (PRIVATE_LIST_RE.test(listId)) return 'private';
    if (MIX_LIST_RE.test(listId)) return 'mix';
    if (PLAYLIST_ID_RE.test(listId)) return 'playlist';
    return 'invalid';
  }

  function extractStartSeconds(searchParams) {
    const raw = searchParams.get('t') ?? searchParams.get('start');
    const parsed = parseDurationParam(raw);
    return parsed == null ? 0 : parsed;
  }

  /**
   * Parses a pasted string into a YouTube reference.
   * Returns one of
   *   { ok: true, kind: 'video', videoId, startSeconds }
   *   { ok: true, kind: 'playlist', playlistId, videoId, startSeconds }
   * or { ok: false, reason }.
   *
   * A link that carries BOTH a video and a usable `list=` becomes a playlist
   * starting at that video. If the `list=` is one YouTube won't embed (a mix,
   * "watch later", garbage) but a video id is present, the video wins — pasting
   * a normal watch URL that happens to trail a mix parameter must keep working.
   *
   * reason is one of: empty | invalid-url | unsupported-host | no-video-id |
   * invalid-video-id | playlist-private | playlist-mix | invalid-playlist-id
   */
  function parseYouTubeUrl(input) {
    const trimmed = (input ?? '').trim();
    if (!trimmed) return { ok: false, reason: 'empty' };

    if (VIDEO_ID_RE.test(trimmed)) {
      return { ok: true, kind: 'video', videoId: trimmed, startSeconds: 0 };
    }
    if (PLAYLIST_ID_RE.test(trimmed)) {
      return { ok: true, kind: 'playlist', playlistId: trimmed, videoId: '', startSeconds: 0 };
    }

    let url;
    try {
      url = new URL(trimmed);
    } catch {
      return { ok: false, reason: 'invalid-url' };
    }

    const host = url.hostname.toLowerCase();
    const listId = url.searchParams.get('list');
    const listKind = listId ? classifyListId(listId) : null;
    const startSeconds = extractStartSeconds(url.searchParams);

    /** Playlist result when the list is usable, otherwise the plain video. */
    function withList(videoId) {
      if (listKind === 'playlist') {
        return { ok: true, kind: 'playlist', playlistId: listId, videoId: videoId || '', startSeconds };
      }
      return { ok: true, kind: 'video', videoId, startSeconds };
    }

    /** No video id to fall back on — an unusable list is a hard error here. */
    function listOnly() {
      if (listKind === 'playlist') {
        return { ok: true, kind: 'playlist', playlistId: listId, videoId: '', startSeconds };
      }
      if (listKind === 'private') return { ok: false, reason: 'playlist-private' };
      if (listKind === 'mix') return { ok: false, reason: 'playlist-mix' };
      if (listKind === 'invalid') return { ok: false, reason: 'invalid-playlist-id' };
      return { ok: false, reason: 'no-video-id' };
    }

    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      if (!id) return listOnly();
      if (!VIDEO_ID_RE.test(id)) return { ok: false, reason: 'invalid-video-id' };
      return withList(id);
    }

    if (!ALLOWED_HOSTS.has(host)) {
      return { ok: false, reason: 'unsupported-host' };
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const firstSegment = segments[0] || '';

    if (firstSegment === 'playlist') {
      return listOnly();
    }

    if (firstSegment === 'watch' || url.pathname === '/watch') {
      const v = url.searchParams.get('v');
      if (!v) return listOnly();
      if (!VIDEO_ID_RE.test(v)) return { ok: false, reason: 'invalid-video-id' };
      return withList(v);
    }

    if (PATH_ID_SEGMENTS.has(firstSegment)) {
      const id = segments[1];
      if (!id) return listOnly();
      if (!VIDEO_ID_RE.test(id)) return { ok: false, reason: 'invalid-video-id' };
      return withList(id);
    }

    if (listId) return listOnly();

    return { ok: false, reason: 'no-video-id' };
  }

  const SOUNDCLOUD_HOSTS = new Set([
    'soundcloud.com',
    'www.soundcloud.com',
    'm.soundcloud.com',
    'on.soundcloud.com',
  ]);

  // Profile-level and editorial paths that are not a playable track/set.
  const SOUNDCLOUD_RESERVED = new Set([
    'discover', 'search', 'stream', 'upload', 'you', 'charts', 'tags', 'people', 'pages', 'settings',
  ]);

  /**
   * SoundCloud is addressed by its permalink URL — the widget resolves it
   * server-side, so no id extraction and no API key is needed here.
   * Returns { ok: true, provider: 'soundcloud', kind: 'track'|'playlist', sourceUrl, startSeconds }
   */
  function parseSoundCloudUrl(url, trimmed) {
    const segments = url.pathname.split('/').filter(Boolean);

    // on.soundcloud.com/xxxx short links carry no structure to validate.
    if (url.hostname.toLowerCase() === 'on.soundcloud.com') {
      if (!segments.length) return { ok: false, reason: 'sc-no-track' };
      return { ok: true, provider: 'soundcloud', kind: 'track', sourceUrl: trimmed, startSeconds: 0 };
    }

    if (!segments.length) return { ok: false, reason: 'sc-no-track' };
    if (SOUNDCLOUD_RESERVED.has(segments[0].toLowerCase())) return { ok: false, reason: 'sc-no-track' };
    // /artist alone is a profile, not something that can be played.
    if (segments.length < 2) return { ok: false, reason: 'sc-profile-only' };

    const isSet = segments[1].toLowerCase() === 'sets';
    if (isSet && segments.length < 3) return { ok: false, reason: 'sc-no-track' };

    // Strip tracking noise but keep the permalink (and ?in= for a track in a set).
    const clean = new URL(url.toString());
    clean.hash = '';
    [...clean.searchParams.keys()].forEach((key) => {
      if (key !== 'in') clean.searchParams.delete(key);
    });

    return {
      ok: true,
      provider: 'soundcloud',
      kind: isSet ? 'playlist' : 'track',
      sourceUrl: clean.toString(),
      startSeconds: 0,
    };
  }

  /**
   * Front door for anything pasted into the app: dispatches to the YouTube or
   * the SoundCloud parser and tags the result with its provider.
   */
  function parseSourceUrl(input) {
    const trimmed = (input ?? '').trim();
    if (!trimmed) return { ok: false, reason: 'empty' };

    let host = '';
    try {
      host = new URL(trimmed).hostname.toLowerCase();
    } catch { /* not a URL — fall through to the YouTube parser's id handling */ }

    if (SOUNDCLOUD_HOSTS.has(host)) {
      return parseSoundCloudUrl(new URL(trimmed), trimmed);
    }

    const parsed = parseYouTubeUrl(trimmed);
    return parsed.ok ? { ...parsed, provider: 'youtube' } : parsed;
  }

  const PARSE_ERROR_MESSAGES = {
    empty: '',
    'invalid-url': 'Das ist keine gültige URL.',
    'unsupported-host': 'Unterstützt werden YouTube-, YouTube-Music- und SoundCloud-Links.',
    'no-video-id': 'In diesem Link konnte keine Video-ID gefunden werden.',
    'invalid-video-id': 'Die Video-ID sieht ungültig aus.',
    'playlist-private': 'Private Listen („Später ansehen", „Gefällt mir") lassen sich nicht einbetten.',
    'playlist-mix': 'Automatische Mixe/Radios lassen sich nicht einbetten — nimm eine richtige Playlist oder ein einzelnes Video.',
    'invalid-playlist-id': 'Die Playlist-ID sieht ungültig aus.',
    'sc-no-track': 'In diesem SoundCloud-Link steckt kein Track — verlinke einen Track oder ein Set.',
    'sc-profile-only': 'Das ist ein SoundCloud-Profil, kein Track — öffne einen einzelnen Track oder ein Set.',
  };

  window.SB = window.SB || {};
  window.SB.urlParser = {
    parseSourceUrl,
    parseYouTubeUrl,
    classifyListId,
    PARSE_ERROR_MESSAGES,
  };
})();
