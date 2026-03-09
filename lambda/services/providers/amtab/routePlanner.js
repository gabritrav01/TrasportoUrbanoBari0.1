'use strict';

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

function safeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function createRoutePlanner(dependencies = {}) {
  const normalizer = dependencies.normalizer;
  const cacheAdapter = dependencies.cacheAdapter || createNoopCacheAdapter();
  const apiClient = dependencies.apiClient || {};
  const retryAdapter = dependencies.retryAdapter || null;
  const linesDataSource = dependencies.linesDataSource;
  const providerName = dependencies.providerName || 'amtab-provider';

  function runWithRetry(operationName, operationFn) {
    if (retryAdapter && typeof retryAdapter.execute === 'function') {
      return retryAdapter.execute(operationName, operationFn);
    }
    return operationFn();
  }

  async function safeRemoteRoutes(originStopIds, destinationTargetIds) {
    const method = apiClient && apiClient.findRoutes;
    if (typeof method !== 'function') {
      return [];
    }

    try {
      const result = await runWithRetry('amtab.routePlanner.findRoutes', () => method(originStopIds, destinationTargetIds));
      if (!Array.isArray(result)) {
        return [];
      }
      return dedupeById(
        result
          .map((route) => normalizer.normalizeRouteOption(route, { source: providerName }))
          .filter(Boolean)
      );
    } catch (error) {
      console.error('AMTAB routePlanner remote call failed: findRoutes', error);
      return [];
    }
  }

  function buildDirectRoutes(originStopIds, destinationTargetIds) {
    if (!linesDataSource || typeof linesDataSource.listLines !== 'function') {
      return [];
    }

    const lines = linesDataSource.listLines();
    const routes = [];

    originStopIds.forEach((originStopId) => {
      destinationTargetIds.forEach((destinationTargetId) => {
        lines
          .filter(
            (line) =>
              line.destinationTargetId === destinationTargetId &&
              Array.isArray(line.stopIds) &&
              line.stopIds.includes(originStopId)
          )
          .forEach((line) => {
            const normalized = normalizer.normalizeRouteOption(
              {
                id: `route:${originStopId}:${destinationTargetId}:${line.id}`,
                originStopId,
                destinationTargetId,
                lineIds: [line.id],
                transfers: 0,
                estimatedMinutes: null,
                source: providerName
              },
              { source: providerName }
            );
            if (normalized) {
              routes.push(normalized);
            }
          });
      });
    });

    return dedupeById(routes);
  }

  async function findRoutes(originStopIds, destinationTargetIds) {
    const safeOriginStopIds = safeStringArray(originStopIds);
    const safeDestinationTargetIds = safeStringArray(destinationTargetIds);

    if (!safeOriginStopIds.length || !safeDestinationTargetIds.length) {
      return [];
    }

    const cacheKey = `amtab:routes:${safeOriginStopIds.sort().join(',')}:${safeDestinationTargetIds.sort().join(',')}`;
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const remoteRoutes = await safeRemoteRoutes(safeOriginStopIds, safeDestinationTargetIds);
        if (remoteRoutes.length) {
          return remoteRoutes;
        }
        return buildDirectRoutes(safeOriginStopIds, safeDestinationTargetIds);
      },
      30000
    );
  }

  return {
    findRoutes
  };
}

module.exports = {
  createRoutePlanner
};
