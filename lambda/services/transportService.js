'use strict';

const { sortByEta, normalizeText } = require('../resolvers/transportDataResolver');

function uniqueById(items) {
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

function dedupeByKey(items, keySelector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keySelector(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

class TransportService {
  constructor({ primaryProvider, fallbackProvider }) {
    this.primaryProvider = primaryProvider;
    this.fallbackProvider = fallbackProvider;

    this.stopById = new Map();
    this.destinationById = new Map();
    this.lineById = new Map();

    this._indexProviderCatalog(this.primaryProvider);
    this._indexProviderCatalog(this.fallbackProvider);
  }

  _indexProviderCatalog(provider) {
    if (!provider || typeof provider.getCatalog !== 'function') {
      return;
    }

    const catalog = provider.getCatalog();
    const stops = catalog && Array.isArray(catalog.stops) ? catalog.stops : [];
    const destinations =
      catalog && Array.isArray(catalog.destinationTargets) ? catalog.destinationTargets : [];
    const lines = catalog && Array.isArray(catalog.lines) ? catalog.lines : [];

    stops.forEach((stop) => {
      if (stop && stop.id && !this.stopById.has(stop.id)) {
        this.stopById.set(stop.id, stop);
      }
    });

    destinations.forEach((destinationTarget) => {
      if (destinationTarget && destinationTarget.id && !this.destinationById.has(destinationTarget.id)) {
        this.destinationById.set(destinationTarget.id, destinationTarget);
      }
    });

    lines.forEach((line) => {
      if (line && line.id && !this.lineById.has(line.id)) {
        this.lineById.set(line.id, line);
      }
    });
  }

  async _safeArrayCall(provider, methodName, args) {
    if (!provider || typeof provider[methodName] !== 'function') {
      return [];
    }

    try {
      const result = await provider[methodName](...args);
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error(`Transport provider call failed: ${provider.providerName}.${methodName}`, error);
      return [];
    }
  }

  async _callPreferPrimaryArray(methodName, args) {
    const primaryData = await this._safeArrayCall(this.primaryProvider, methodName, args);
    if (primaryData.length) {
      return primaryData;
    }
    return this._safeArrayCall(this.fallbackProvider, methodName, args);
  }

  async searchStops(query) {
    const stops = await this._callPreferPrimaryArray('searchStops', [query]);
    return uniqueById(stops);
  }

  async nearestStops(lat, lon) {
    const nearest = await this._callPreferPrimaryArray('nearestStops', [lat, lon]);
    return nearest
      .filter((entry) => entry && entry.stop && typeof entry.distanceMeters === 'number')
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  async getLinesServingStop(stopId) {
    const lines = await this._callPreferPrimaryArray('getLinesServingStop', [stopId]);
    return uniqueById(lines);
  }

  async resolveDestination(query) {
    const destinationTargets = await this._callPreferPrimaryArray('resolveDestination', [query]);
    return uniqueById(destinationTargets);
  }

  async findRoutes(originStopIds, destinationTargetIds) {
    const routes = await this._callPreferPrimaryArray('findRoutes', [originStopIds, destinationTargetIds]);
    return dedupeByKey(routes, (route) => route.id || `${route.originStopId}:${route.destinationTargetId}:${route.lineIds}`);
  }

  async getRealtimePredictions(stopId, lineId) {
    const primaryRealtime = await this._safeArrayCall(this.primaryProvider, 'getRealtimePredictions', [stopId, lineId]);
    if (primaryRealtime.length) {
      return sortByEta(primaryRealtime);
    }
    const fallbackRealtime = await this._safeArrayCall(this.fallbackProvider, 'getRealtimePredictions', [stopId, lineId]);
    return sortByEta(fallbackRealtime);
  }

  async getScheduledArrivals(stopId, lineId) {
    const primaryScheduled = await this._safeArrayCall(this.primaryProvider, 'getScheduledArrivals', [stopId, lineId]);
    if (primaryScheduled.length) {
      return sortByEta(primaryScheduled);
    }
    const fallbackScheduled = await this._safeArrayCall(this.fallbackProvider, 'getScheduledArrivals', [stopId, lineId]);
    return sortByEta(fallbackScheduled);
  }

  async getStopArrivals(stopId) {
    const direct = await this._callPreferPrimaryArray('getStopArrivals', [stopId]);
    if (direct.length) {
      return sortByEta(direct);
    }

    const lines = await this.getLinesServingStop(stopId);
    const fallbackArrivals = [];
    for (const line of lines) {
      const realtime = await this.getRealtimePredictions(stopId, line.id);
      if (realtime.length) {
        fallbackArrivals.push(...realtime);
      } else {
        const scheduled = await this.getScheduledArrivals(stopId, line.id);
        fallbackArrivals.push(...scheduled);
      }
    }
    return sortByEta(fallbackArrivals);
  }

  async searchLines(query) {
    const fromPrimary = await this._safeArrayCall(this.primaryProvider, 'searchLines', [query]);
    if (fromPrimary.length) {
      return uniqueById(fromPrimary);
    }

    const fromFallback = await this._safeArrayCall(this.fallbackProvider, 'searchLines', [query]);
    if (fromFallback.length) {
      return uniqueById(fromFallback);
    }

    const normalizedQuery = normalizeText(query);
    return Array.from(this.lineById.values()).filter((line) => {
      const candidates = [line.id].concat(line.aliases || []).map(normalizeText);
      return candidates.some((candidate) => candidate === normalizedQuery || candidate.includes(normalizedQuery));
    });
  }

  getStopById(stopId) {
    return this.stopById.get(stopId) || null;
  }

  getDestinationById(destinationId) {
    return this.destinationById.get(destinationId) || null;
  }

  getLineById(lineId) {
    return this.lineById.get(lineId) || null;
  }

  // Compatibility methods used by existing handlers/resolvers.
  async findStopCandidates(query) {
    return this.searchStops(query);
  }

  async findDestinationCandidates(query) {
    return this.resolveDestination(query);
  }

  async findLineCandidates(query) {
    return this.searchLines(query);
  }

  async findNearestStop(lat, lon) {
    const nearest = await this.nearestStops(lat, lon);
    if (!nearest.length) {
      return null;
    }
    return nearest[0];
  }

  async getNextArrivalsByStop({ stopId, lineId }) {
    const arrivals = await this.getStopArrivals(stopId);
    const filtered = lineId ? arrivals.filter((arrival) => arrival.lineId === lineId) : arrivals;

    const grouped = new Map();
    filtered.forEach((arrival) => {
      if (!grouped.has(arrival.lineId)) {
        grouped.set(arrival.lineId, {
          lineId: arrival.lineId,
          destinationName: arrival.destinationName,
          minutes: []
        });
      }
      grouped.get(arrival.lineId).minutes.push(arrival.etaMinutes);
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        lineId: entry.lineId,
        destinationName: entry.destinationName,
        minutes: entry.minutes.sort((a, b) => a - b).slice(0, 3)
      }))
      .filter((entry) => entry.minutes.length > 0)
      .sort((a, b) => a.minutes[0] - b.minutes[0]);
  }

  async getRoutesToDestination({ destinationId, fromStopId }) {
    const originStopIds = fromStopId ? [fromStopId] : Array.from(this.stopById.keys());
    const routes = await this.findRoutes(originStopIds, [destinationId]);
    const destination = this.getDestinationById(destinationId);
    const destinationName = destination ? destination.name : 'destinazione';

    return dedupeByKey(
      routes.map((route) => ({
        lineId: Array.isArray(route.lineIds) && route.lineIds.length ? route.lineIds[0] : 'N/A',
        destinationName
      })),
      (route) => route.lineId
    );
  }

  async getLineDirectionArrivals({ lineId, destinationId, stopId }) {
    const line = this.getLineById(lineId);
    if (!line) {
      return [];
    }

    if (destinationId && line.destinationTargetId !== destinationId) {
      return [];
    }

    const candidateStopId = stopId || (Array.isArray(line.stopIds) && line.stopIds.length ? line.stopIds[0] : null);
    if (!candidateStopId) {
      return [];
    }

    const realtime = await this.getRealtimePredictions(candidateStopId, line.id);
    const arrivals = realtime.length ? realtime : await this.getScheduledArrivals(candidateStopId, line.id);
    const minutes = arrivals.map((arrival) => arrival.etaMinutes).filter((eta) => typeof eta === 'number').slice(0, 3);
    if (!minutes.length) {
      return [];
    }

    return [
      {
        lineId: line.id,
        destinationName: line.destinationName,
        minutes
      }
    ];
  }
}

function createTransportService({ primaryProvider, fallbackProvider }) {
  return new TransportService({ primaryProvider, fallbackProvider });
}

module.exports = {
  TransportService,
  createTransportService
};
