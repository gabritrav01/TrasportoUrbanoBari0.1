'use strict';

const { topRankedMatches } = require('../../../resolvers/transportDataResolver');

function createNoopCacheAdapter() {
  return {
    get() {
      return null;
    },
    set(_key, value) {
      return value;
    },
    async getOrSet(_key, valueFactory) {
      return valueFactory();
    }
  };
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || !item.id) {
      return false;
    }
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function createDestinationResolverAdapter(dependencies = {}) {
  const normalizer = dependencies.normalizer;
  const cacheAdapter = dependencies.cacheAdapter || createNoopCacheAdapter();
  const apiClient = dependencies.apiClient || {};
  const retryAdapter = dependencies.retryAdapter || null;
  const resolveTtlMs = typeof dependencies.resolveTtlMs === 'number' ? dependencies.resolveTtlMs : 60000;
  const rawDestinationTargets =
    Array.isArray(dependencies.catalog && dependencies.catalog.destinationTargets)
      ? dependencies.catalog.destinationTargets
      : [];
  const catalogDestinationTargets = rawDestinationTargets
    .map((destinationTarget) => normalizer.normalizeDestinationTarget(destinationTarget))
    .filter(Boolean);
  const destinationTargets = [];
  const destinationById = new Map();

  function runWithRetry(operationName, operationFn) {
    if (retryAdapter && typeof retryAdapter.execute === 'function') {
      return retryAdapter.execute(operationName, operationFn);
    }
    return operationFn();
  }

  function registerDestinationTargets(nextDestinationTargets) {
    nextDestinationTargets.forEach((destinationTarget) => {
      if (!destinationTarget || !destinationTarget.id) {
        return;
      }
      const existingIndex = destinationTargets.findIndex((entry) => entry.id === destinationTarget.id);
      if (existingIndex >= 0) {
        destinationTargets[existingIndex] = destinationTarget;
      } else {
        destinationTargets.push(destinationTarget);
      }
      destinationById.set(destinationTarget.id, destinationTarget);
    });
  }

  async function safeRemoteDestinationTargets(methodName, args) {
    const method = apiClient && apiClient[methodName];
    if (typeof method !== 'function') {
      return [];
    }

    try {
      const result = await runWithRetry(`amtab.destinationResolverAdapter.${methodName}`, () => method(...args));
      if (!Array.isArray(result)) {
        return [];
      }
      return dedupeById(result.map((entry) => normalizer.normalizeDestinationTarget(entry)).filter(Boolean));
    } catch (error) {
      console.error(`AMTAB destinationResolverAdapter remote call failed: ${methodName}`, error);
      return [];
    }
  }

  registerDestinationTargets(catalogDestinationTargets);

  async function resolveDestination(query) {
    const normalizedQuery = normalizer.searchText(query);
    if (!normalizedQuery) {
      return [];
    }

    const cacheKey = `amtab:destinations:search:${normalizedQuery}`;
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const remoteMatches = await safeRemoteDestinationTargets('resolveDestination', [query]);
        if (remoteMatches.length) {
          registerDestinationTargets(remoteMatches);
          return topRankedMatches(remoteMatches, normalizedQuery, (destinationTarget) =>
            [destinationTarget.name].concat(destinationTarget.aliases || [])
          );
        }
        return topRankedMatches(destinationTargets, normalizedQuery, (destinationTarget) =>
          [destinationTarget.name].concat(destinationTarget.aliases || [])
        );
      },
      resolveTtlMs
    );
  }

  function getDestinationById(destinationId) {
    return destinationById.get(destinationId) || null;
  }

  function listDestinationTargets() {
    return destinationTargets.slice();
  }

  return {
    resolveDestination,
    getDestinationById,
    listDestinationTargets
  };
}

module.exports = {
  createDestinationResolverAdapter
};
