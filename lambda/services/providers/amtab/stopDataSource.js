'use strict';

const { topRankedMatches, haversineDistanceMeters } = require('../../../resolvers/transportDataResolver');

function toCoordinatesKey(lat, lon, limit) {
  const latKey = Math.round(lat * 10000) / 10000;
  const lonKey = Math.round(lon * 10000) / 10000;
  return `amtab:stops:nearest:${latKey}:${lonKey}:${limit}`;
}

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

function dedupeNearestEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry || !entry.stop || !entry.stop.id) {
      return false;
    }
    if (seen.has(entry.stop.id)) {
      return false;
    }
    seen.add(entry.stop.id);
    return true;
  });
}

function createStopDataSource(dependencies = {}) {
  const normalizer = dependencies.normalizer;
  const cacheAdapter = dependencies.cacheAdapter || createNoopCacheAdapter();
  const apiClient = dependencies.apiClient || {};
  const retryAdapter = dependencies.retryAdapter || null;
  const defaultLimit = typeof dependencies.defaultLimit === 'number' ? dependencies.defaultLimit : 5;
  const searchTtlMs = typeof dependencies.searchTtlMs === 'number' ? dependencies.searchTtlMs : 60000;
  const nearestTtlMs = typeof dependencies.nearestTtlMs === 'number' ? dependencies.nearestTtlMs : 15000;
  const rawStops = Array.isArray(dependencies.catalog && dependencies.catalog.stops) ? dependencies.catalog.stops : [];
  const catalogStops = rawStops.map((stop) => normalizer.normalizeStop(stop)).filter(Boolean);
  const stops = [];
  const stopById = new Map();

  function runWithRetry(operationName, operationFn) {
    if (retryAdapter && typeof retryAdapter.execute === 'function') {
      return retryAdapter.execute(operationName, operationFn);
    }
    return operationFn();
  }

  function registerStops(nextStops) {
    nextStops.forEach((stop) => {
      if (!stop || !stop.id) {
        return;
      }
      const existingIndex = stops.findIndex((entry) => entry.id === stop.id);
      if (existingIndex >= 0) {
        stops[existingIndex] = stop;
      } else {
        stops.push(stop);
      }
      stopById.set(stop.id, stop);
    });
  }

  async function safeRemoteArray(methodName, args, mapper) {
    const method = apiClient && apiClient[methodName];
    if (typeof method !== 'function') {
      return [];
    }

    try {
      const result = await runWithRetry(`amtab.stopDataSource.${methodName}`, () => method(...args));
      if (!Array.isArray(result)) {
        return [];
      }
      return result.map((entry) => mapper(entry)).filter(Boolean);
    } catch (error) {
      console.error(`AMTAB stopDataSource remote call failed: ${methodName}`, error);
      return [];
    }
  }

  function normalizeNearestEntry(entry, lat, lon) {
    if (!entry) {
      return null;
    }

    const candidateStop =
      entry.stop && typeof entry.distanceMeters !== 'undefined' ? normalizer.normalizeStop(entry.stop) : normalizer.normalizeStop(entry);
    if (!candidateStop) {
      return null;
    }

    const distanceMeters =
      typeof entry.distanceMeters === 'number'
        ? entry.distanceMeters
        : Math.round(
            haversineDistanceMeters(lat, lon, candidateStop.coordinates.lat, candidateStop.coordinates.lon)
          );

    if (!Number.isFinite(distanceMeters)) {
      return null;
    }

    return {
      stop: candidateStop,
      distanceMeters: Math.max(0, Math.round(distanceMeters))
    };
  }

  registerStops(catalogStops);

  async function searchStops(query) {
    const normalizedQuery = normalizer.searchText(query);
    if (!normalizedQuery) {
      return [];
    }
    const cacheKey = `amtab:stops:search:${normalizedQuery}`;
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const remoteMatches = await safeRemoteArray('searchStops', [query], (entry) => normalizer.normalizeStop(entry));
        if (remoteMatches.length) {
          registerStops(remoteMatches);
          return topRankedMatches(remoteMatches, normalizedQuery, (stop) => [stop.name].concat(stop.aliases || []));
        }

        return topRankedMatches(stops, normalizedQuery, (stop) => [stop.name].concat(stop.aliases || []));
      },
      searchTtlMs
    );
  }

  async function nearestStops(lat, lon, limit) {
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return [];
    }
    const safeLimit = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : defaultLimit;
    const cacheKey = toCoordinatesKey(lat, lon, safeLimit);
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const remoteNearest = await safeRemoteArray(
          'nearestStops',
          [lat, lon, safeLimit],
          (entry) => normalizeNearestEntry(entry, lat, lon)
        );
        if (remoteNearest.length) {
          registerStops(remoteNearest.map((entry) => entry.stop));
          return dedupeNearestEntries(
            remoteNearest
              .filter((entry) => Number.isFinite(entry.distanceMeters))
              .sort((a, b) => a.distanceMeters - b.distanceMeters)
          )
            .sort((a, b) => a.distanceMeters - b.distanceMeters)
            .slice(0, safeLimit);
        }

        return stops
          .filter(
            (stop) =>
              stop.coordinates &&
              typeof stop.coordinates.lat === 'number' &&
              typeof stop.coordinates.lon === 'number'
          )
          .map((stop) => ({
            stop,
            distanceMeters: Math.round(
              haversineDistanceMeters(lat, lon, stop.coordinates.lat, stop.coordinates.lon)
            )
          }))
          .sort((a, b) => a.distanceMeters - b.distanceMeters)
          .slice(0, safeLimit);
      },
      nearestTtlMs
    );
  }

  function getStopById(stopId) {
    return stopById.get(stopId) || null;
  }

  function listStops() {
    return stops.slice();
  }

  return {
    searchStops,
    nearestStops,
    getStopById,
    listStops
  };
}

module.exports = {
  createStopDataSource
};
