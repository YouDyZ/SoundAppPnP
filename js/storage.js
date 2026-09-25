(function () {
  const PREFIX = 'pnp-soundboard:';
  const WORKING_KEY = `${PREFIX}workingState`;
  const SCHEMA_VERSION = 1;

  function loadWorkingState() {
    try {
      const raw = localStorage.getItem(WORKING_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.layers)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveWorkingStateNow(state) {
    try {
      const payload = {
        schemaVersion: SCHEMA_VERSION,
        activeCollectionId: state.activeCollectionId ?? null,
        layers: state.layers,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(WORKING_KEY, JSON.stringify(payload));
      return true;
    } catch (err) {
      console.warn('Autosave fehlgeschlagen:', err);
      return false;
    }
  }

  let debounceTimer = null;

  function scheduleAutosave(getState, delay = 500) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      saveWorkingStateNow(getState());
    }, delay);
  }

  function flushAutosave(getState) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    saveWorkingStateNow(getState());
  }

  window.SB = window.SB || {};
  window.SB.storage = { loadWorkingState, saveWorkingStateNow, scheduleAutosave, flushAutosave };
})();
