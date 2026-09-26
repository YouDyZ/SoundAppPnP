(function () {
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

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
  }

  /**
   * Reads a time the user typed: "1:07", "67" and "1m7s" all mean 67 seconds.
   * Anything unreadable falls back to `fallback`, so a typo never silently
   * turns into 0.
   */
  function parseTimeInput(value, fallback = 0) {
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;

    const colon = /^(\d+):([0-5]?\d)$/.exec(raw);
    if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);

    if (/^\d+(?:[.,]\d+)?$/.test(raw)) return Math.round(parseFloat(raw.replace(',', '.')));

    const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
    if (units && (units[1] || units[2] || units[3])) {
      return parseInt(units[1] || '0', 10) * 3600
        + parseInt(units[2] || '0', 10) * 60
        + parseInt(units[3] || '0', 10);
    }

    return fallback;
  }

  window.SB = window.SB || {};
  window.SB.util = { uuid, clamp, formatTime, parseTimeInput };
})();
