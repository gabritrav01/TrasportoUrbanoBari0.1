'use strict';

const { topRankedMatches } = require('../../../resolvers/transportDataResolver');
const { createResilientExecutor, logResilienceFailure } = require('./resilienceHelpers');

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

function createLinesDataSource(dependencies = {}) {
  const normalizer = dependencies.normalizer;
  const cacheAdapter = dependencies.cacheAdapter || createNoopCacheAdapter();
  const apiClient = dependencies.apiClient || {};
  const retryAdapter = dependencies.retryAdapter || null;
  const logger = dependencies.logger || console;
  const resiliencePolicy = dependencies.resiliencePolicy || {};
  const searchTtlMs = typeof dependencies.searchTtlMs === 'number' ? dependencies.searchTtlMs : 60000;
  const byStopTtlMs = typeof dependencies.byStopTtlMs === 'number' ? dependencies.byStopTtlMs : 30000;
  const searchStaleIfErrorTtlMs =
    typeof dependencies.searchStaleIfErrorTtlMs === 'number'
      ? dependencies.searchStaleIfErrorTtlMs
      : 10 * 60 * 1000;
  const byStopStaleIfErrorTtlMs =
    typeof dependencies.byStopStaleIfErrorTtlMs === 'number'
      ? dependencies.byStopStaleIfErrorTtlMs
      : 3 * 60 * 1000;
  const searchNegativeTtlMs =
    typeof dependencies.searchNegativeTtlMs === 'number' ? dependencies.searchNegativeTtlMs : 25 * 1000;
  const byStopNegativeTtlMs =
    typeof dependencies.byStopNegativeTtlMs === 'number' ? dependencies.byStopNegativeTtlMs : 15 * 1000;
  const rawLines = Array.isArray(dependencies.catalog && dependencies.catalog.lines) ? dependencies.catalog.lines : [];
  const catalogLines = rawLines.map((line) => normalizer.normalizeLine(line)).filter(Boolean);
  const lines = [];
  const lineById = new Map();
  const lineIdsByStop = new Map();
  const resilientExecutor = createResilientExecutor({
    logger,
    retryAdapter,
    resiliencePolicy
  });
  const searchCachePolicy = {
    ttlMs: searchTtlMs,
    staleIfErrorTtlMs: searchStaleIfErrorTtlMs,
    negativeTtlMs: searchNegativeTtlMs,
    inFlightDedupe: true,
    isNegativeValue: (value) => Array.isArray(value) && value.length === 0
  };
  const byStopCachePolicy = {
    ttlMs: byStopTtlMs,
    staleIfErrorTtlMs: byStopStaleIfErrorTtlMs,
    negativeTtlMs: byStopNegativeTtlMs,
    inFlightDedupe: true,
    isNegativeValue: (value) => Array.isArray(value) && value.length === 0
  };

  function rebuildStopIndex() {
    lineIdsByStop.clear();
    lines.forEach((line) => {
      (line.stopIds || []).forEach((stopId) => {
        if (!lineIdsByStop.has(stopId)) {
          lineIdsByStop.set(stopId, new Set());
        }
        lineIdsByStop.get(stopId).add(line.id);
      });
    });
  }

  function registerLines(nextLines) {
    nextLines.forEach((line) => {
      if (!line || !line.id) {
        return;
      }
      const existingIndex = lines.findIndex((entry) => entry.id === line.id);
      if (existingIndex >= 0) {
        lines[existingIndex] = line;
      } else {
        lines.push(line);
      }
      lineById.set(line.id, line);
    });
    rebuildStopIndex();
  }

  async function safeRemoteLines(methodName, args) {
    const method = apiClient && apiClient[methodName];
    if (typeof method !== 'function') {
      return [];
    }

    try {
      const result = await resilientExecutor.run({
        operationName: `amtab.linesDataSource.${methodName}`,
        category: 'staticLookup',
        executeFn: () => method(...args)
      });
      if (!Array.isArray(result)) {
        return [];
      }
      return dedupeById(result.map((entry) => normalizer.normalizeLine(entry)).filter(Boolean));
    } catch (error) {
      logResilienceFailure(
        logger,
        `[AMTAB][linesDataSource.${methodName}] remote call failed -> using catalog fallback`,
        error,
        {
          operationName: `amtab.linesDataSource.${methodName}`,
          category: 'staticLookup'
        }
      );
      return [];
    }
  }

  function listLines() {
    return lines.slice();
  }

  function getLineById(lineId) {
    return lineById.get(lineId) || null;
  }

  registerLines(catalogLines);

  async function searchLines(query) {
    const normalizedQuery = normalizer.searchText(query);
    if (!normalizedQuery) {
      return [];
    }
    const cacheKey = `amtab:lines:search:${normalizedQuery}`;
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const remoteMatches = await safeRemoteLines('searchLines', [query]);
        if (remoteMatches.length) {
          registerLines(remoteMatches);
          return topRankedMatches(remoteMatches, normalizedQuery, (line) => [line.id].concat(line.aliases || []));
        }
        return topRankedMatches(lines, normalizedQuery, (line) => [line.id].concat(line.aliases || []));
      },
      searchCachePolicy
    );
  }

  async function getLinesServingStop(stopId) {
    if (!stopId) {
      return [];
    }
    const cacheKey = `amtab:lines:stop:${stopId}`;
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const remoteLines = await safeRemoteLines('getLinesServingStop', [stopId]);
        if (remoteLines.length) {
          registerLines(remoteLines);
          return remoteLines.filter((line) => (line.stopIds || []).includes(stopId));
        }

        const lineIds = lineIdsByStop.get(stopId);
        if (!lineIds || !lineIds.size) {
          return [];
        }
        return Array.from(lineIds)
          .map((lineId) => lineById.get(lineId))
          .filter(Boolean);
      },
      byStopCachePolicy
    );
  }

  return {
    searchLines,
    getLinesServingStop,
    getLineById,
    listLines
  };
}

module.exports = {
  createLinesDataSource
};
