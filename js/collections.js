(function () {
  const PREFIX = 'pnp-soundboard:';
  const COLLECTIONS_KEY = `${PREFIX}collections`;
  const SCHEMA_VERSION = 1;

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function loadCollectionsStore() {
    try {
      const raw = localStorage.getItem(COLLECTIONS_KEY);
      if (!raw) return { schemaVersion: SCHEMA_VERSION, collectionOrder: [], collections: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad store');
      const collections = parsed.collections && typeof parsed.collections === 'object' ? parsed.collections : {};
      const collectionOrder = Array.isArray(parsed.collectionOrder) ? parsed.collectionOrder : Object.keys(collections);
      return { schemaVersion: parsed.schemaVersion || SCHEMA_VERSION, collectionOrder, collections };
    } catch {
      return { schemaVersion: SCHEMA_VERSION, collectionOrder: [], collections: {} };
    }
  }

  function saveCollectionsStore(store) {
    try {
      localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(store));
      return true;
    } catch (err) {
      console.warn('Sammlungen konnten nicht gespeichert werden:', err);
      return false;
    }
  }

  function createCollection(store, name, layers) {
    const id = uuid();
    const now = new Date().toISOString();
    const next = {
      ...store,
      collectionOrder: [...store.collectionOrder, id],
      collections: {
        ...store.collections,
        [id]: { id, name, layers, createdAt: now, updatedAt: now },
      },
    };
    return { store: next, id };
  }

  function updateCollectionLayers(store, id, layers) {
    const existing = store.collections[id];
    if (!existing) return store;
    return {
      ...store,
      collections: {
        ...store.collections,
        [id]: { ...existing, layers, updatedAt: new Date().toISOString() },
      },
    };
  }

  function renameCollection(store, id, name) {
    const existing = store.collections[id];
    if (!existing) return store;
    return {
      ...store,
      collections: {
        ...store.collections,
        [id]: { ...existing, name, updatedAt: new Date().toISOString() },
      },
    };
  }

  function deleteCollection(store, id) {
    const { [id]: _removed, ...rest } = store.collections;
    return {
      ...store,
      collectionOrder: store.collectionOrder.filter((cid) => cid !== id),
      collections: rest,
    };
  }

  /**
   * Renders the sidebar list. handlers: { onLoad(id), onRename(id), onDelete(id) }
   */
  function renderCollectionsSidebar(listEl, store, activeId, handlers) {
    listEl.innerHTML = '';

    if (store.collectionOrder.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'collections-empty';
      empty.textContent = 'Noch keine gespeicherten Sammlungen.';
      listEl.appendChild(empty);
      return;
    }

    store.collectionOrder.forEach((id) => {
      const collection = store.collections[id];
      if (!collection) return;

      const li = document.createElement('li');
      li.className = `collection-item${id === activeId ? ' active' : ''}`;

      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'collection-name';
      nameBtn.textContent = collection.name;
      nameBtn.title = `${collection.layers.length} Ebene(n) laden`;
      nameBtn.addEventListener('click', () => handlers.onLoad(id));

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'icon-btn';
      renameBtn.title = 'Umbenennen';
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', () => handlers.onRename(id));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn';
      deleteBtn.title = 'Löschen';
      deleteBtn.textContent = '🗑';
      deleteBtn.addEventListener('click', () => handlers.onDelete(id));

      li.append(nameBtn, renameBtn, deleteBtn);
      listEl.appendChild(li);
    });
  }

  window.SB = window.SB || {};
  window.SB.collections = {
    loadCollectionsStore,
    saveCollectionsStore,
    createCollection,
    updateCollectionLayers,
    renameCollection,
    deleteCollection,
    renderCollectionsSidebar,
  };
})();
