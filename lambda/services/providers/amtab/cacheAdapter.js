'use strict';

function isExpired(entry, nowMs) {
  return entry && typeof entry.expiresAt === 'number' && entry.expiresAt <= nowMs;
}

function createMemoryCacheAdapter(options = {}) {
  const defaultTtlMs =
    typeof options.defaultTtlMs === 'number' && options.defaultTtlMs > 0 ? options.defaultTtlMs : 30000;
  const maxEntries = typeof options.maxEntries === 'number' && options.maxEntries > 0 ? options.maxEntries : 2000;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const store = new Map();

  function pruneExpired() {
    const nowMs = now();
    for (const [key, entry] of store.entries()) {
      if (isExpired(entry, nowMs)) {
        store.delete(key);
      }
    }
  }

  function pruneOverflow() {
    if (store.size <= maxEntries) {
      return;
    }
    const toDelete = store.size - maxEntries;
    let removed = 0;
    for (const key of store.keys()) {
      store.delete(key);
      removed += 1;
      if (removed >= toDelete) {
        break;
      }
    }
  }

  function get(key) {
    const entry = store.get(key);
    if (!entry) {
      return null;
    }
    if (isExpired(entry, now())) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }

  function set(key, value, ttlMs) {
    const safeTtlMs = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : defaultTtlMs;
    store.set(key, {
      value,
      expiresAt: now() + safeTtlMs
    });
    pruneExpired();
    pruneOverflow();
    return value;
  }

  async function getOrSet(key, valueFactory, ttlMs) {
    const cached = get(key);
    if (cached !== null) {
      return cached;
    }
    const fresh = await valueFactory();
    return set(key, fresh, ttlMs);
  }

  function del(key) {
    store.delete(key);
  }

  function clear() {
    store.clear();
  }

  return {
    get,
    set,
    getOrSet,
    delete: del,
    clear
  };
}

module.exports = {
  createMemoryCacheAdapter
};
