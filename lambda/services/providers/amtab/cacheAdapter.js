'use strict';

function toPositiveNumber(value, fallbackValue) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallbackValue;
}

function toNonNegativeNumber(value, fallbackValue) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallbackValue;
}

function isDefaultNegativeValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}

function isFresh(entry, nowMs) {
  return (
    entry &&
    typeof entry.expiresAt === 'number' &&
    entry.expiresAt > nowMs
  );
}

function isHardExpired(entry, nowMs) {
  return (
    !entry ||
    typeof entry.staleUntil !== 'number' ||
    entry.staleUntil <= nowMs
  );
}

function canServeStale(entry, nowMs) {
  return (
    entry &&
    typeof entry.expiresAt === 'number' &&
    entry.expiresAt <= nowMs &&
    typeof entry.staleUntil === 'number' &&
    entry.staleUntil > nowMs
  );
}

function normalizeCachePolicy(policyOrTtl, defaults) {
  if (typeof policyOrTtl === 'number') {
    return {
      ttlMs: toPositiveNumber(policyOrTtl, defaults.ttlMs),
      staleIfErrorTtlMs: defaults.staleIfErrorTtlMs,
      negativeTtlMs: defaults.negativeTtlMs,
      inFlightDedupe: defaults.inFlightDedupe,
      isNegativeValue: defaults.isNegativeValue
    };
  }

  const rawPolicy = policyOrTtl && typeof policyOrTtl === 'object' ? policyOrTtl : {};
  return {
    ttlMs: toPositiveNumber(rawPolicy.ttlMs, defaults.ttlMs),
    staleIfErrorTtlMs: toNonNegativeNumber(rawPolicy.staleIfErrorTtlMs, defaults.staleIfErrorTtlMs),
    negativeTtlMs: toNonNegativeNumber(rawPolicy.negativeTtlMs, defaults.negativeTtlMs),
    inFlightDedupe:
      rawPolicy.inFlightDedupe !== undefined ? Boolean(rawPolicy.inFlightDedupe) : defaults.inFlightDedupe,
    isNegativeValue:
      typeof rawPolicy.isNegativeValue === 'function' ? rawPolicy.isNegativeValue : defaults.isNegativeValue
  };
}

function createMemoryCacheAdapter(options = {}) {
  const defaultTtlMs =
    typeof options.defaultTtlMs === 'number' && options.defaultTtlMs > 0 ? options.defaultTtlMs : 30000;
  const defaultStaleIfErrorTtlMs =
    typeof options.defaultStaleIfErrorTtlMs === 'number' && options.defaultStaleIfErrorTtlMs >= 0
      ? options.defaultStaleIfErrorTtlMs
      : 0;
  const defaultNegativeTtlMs =
    typeof options.defaultNegativeTtlMs === 'number' && options.defaultNegativeTtlMs >= 0
      ? options.defaultNegativeTtlMs
      : 5000;
  const defaultInFlightDedupe =
    options.defaultInFlightDedupe !== undefined ? Boolean(options.defaultInFlightDedupe) : true;
  const defaultIsNegativeValue =
    typeof options.defaultIsNegativeValue === 'function' ? options.defaultIsNegativeValue : isDefaultNegativeValue;
  const logger = options.logger || console;
  const maxEntries = typeof options.maxEntries === 'number' && options.maxEntries > 0 ? options.maxEntries : 2000;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const store = new Map();
  const inFlightByKey = new Map();

  function pruneHardExpired() {
    const nowMs = now();
    for (const [key, entry] of store.entries()) {
      if (isHardExpired(entry, nowMs)) {
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
    const nowMs = now();
    if (isHardExpired(entry, nowMs)) {
      store.delete(key);
      return null;
    }
    if (!isFresh(entry, nowMs)) {
      return null;
    }
    return entry.value;
  }

  function set(key, value, ttlMsOrPolicy) {
    const policy = normalizeCachePolicy(ttlMsOrPolicy, {
      ttlMs: defaultTtlMs,
      staleIfErrorTtlMs: defaultStaleIfErrorTtlMs,
      negativeTtlMs: defaultNegativeTtlMs,
      inFlightDedupe: defaultInFlightDedupe,
      isNegativeValue: defaultIsNegativeValue
    });
    const shouldUseNegativeTtl = Boolean(policy.isNegativeValue(value, key));
    const selectedTtlMs = shouldUseNegativeTtl ? policy.negativeTtlMs : policy.ttlMs;
    const safeTtlMs = toPositiveNumber(selectedTtlMs, defaultTtlMs);
    const safeStaleIfErrorTtlMs = toNonNegativeNumber(policy.staleIfErrorTtlMs, defaultStaleIfErrorTtlMs);
    const nowMs = now();
    store.set(key, {
      value,
      isNegative: shouldUseNegativeTtl,
      expiresAt: nowMs + safeTtlMs,
      staleUntil: nowMs + safeTtlMs + safeStaleIfErrorTtlMs
    });
    pruneHardExpired();
    pruneOverflow();
    return value;
  }

  async function getOrSet(key, valueFactory, ttlMsOrPolicy) {
    if (typeof valueFactory !== 'function') {
      throw new Error('cacheAdapter.getOrSet requires valueFactory function');
    }

    const policy = normalizeCachePolicy(ttlMsOrPolicy, {
      ttlMs: defaultTtlMs,
      staleIfErrorTtlMs: defaultStaleIfErrorTtlMs,
      negativeTtlMs: defaultNegativeTtlMs,
      inFlightDedupe: defaultInFlightDedupe,
      isNegativeValue: defaultIsNegativeValue
    });
    const nowMs = now();
    let staleCandidate = null;
    const existing = store.get(key);
    if (existing) {
      if (isFresh(existing, nowMs)) {
        return existing.value;
      }
      if (canServeStale(existing, nowMs)) {
        staleCandidate = existing;
      } else if (isHardExpired(existing, nowMs)) {
        store.delete(key);
      }
    }

    if (policy.inFlightDedupe && inFlightByKey.has(key)) {
      return inFlightByKey.get(key);
    }

    const requestPromise = (async () => {
      try {
        const fresh = await valueFactory();
        return set(key, fresh, policy);
      } catch (error) {
        const fallbackEntry = staleCandidate || store.get(key);
        if (policy.staleIfErrorTtlMs > 0 && canServeStale(fallbackEntry, now())) {
          if (logger && typeof logger.warn === 'function') {
            logger.warn('[cacheAdapter] serving stale value due to upstream error', {
              key,
              code: error && error.code ? error.code : 'UNKNOWN'
            });
          }
          return fallbackEntry.value;
        }
        throw error;
      } finally {
        if (policy.inFlightDedupe) {
          inFlightByKey.delete(key);
        }
      }
    })();

    if (policy.inFlightDedupe) {
      inFlightByKey.set(key, requestPromise);
    }
    return requestPromise;
  }

  function del(key) {
    store.delete(key);
    inFlightByKey.delete(key);
  }

  function clear() {
    store.clear();
    inFlightByKey.clear();
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
