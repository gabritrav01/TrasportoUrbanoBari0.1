'use strict';

const { sortByEta, normalizeText } = require('../resolvers/transportDataResolver');
const {
  SOURCE_TYPES,
  PREDICTION_TYPES,
  normalizeSource,
  normalizePredictionType,
  clampConfidence
} = require('./providers/domain/providerShapes');

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

function mergeReliabilityBand(bands) {
  const list = Array.isArray(bands) ? bands.map((band) => normalizeReliabilityBand(band)) : [];
  if (list.includes('discard')) {
    return 'discard';
  }
  if (list.includes('disclaimer')) {
    return 'disclaimer';
  }
  return 'direct';
}

function normalizeReliabilityBand(value) {
  if (value === 'direct' || value === 'disclaimer' || value === 'discard') {
    return value;
  }
  // Prudente: assenza o valore non valido non viene promosso a "direct".
  return 'disclaimer';
}

function toFreshness(value) {
  if (!value || typeof value !== 'object') {
    return {
      ageSec: null,
      freshnessScore: 0.5,
      bucket: 'unknown'
    };
  }

  return {
    ageSec: typeof value.ageSec === 'number' && Number.isFinite(value.ageSec) ? value.ageSec : null,
    freshnessScore:
      typeof value.freshnessScore === 'number' && Number.isFinite(value.freshnessScore)
        ? Math.max(0, Math.min(1, value.freshnessScore))
        : 0.5,
    bucket: typeof value.bucket === 'string' && value.bucket ? value.bucket : 'unknown'
  };
}

function toSourceName(value, fallbackValue) {
  if (typeof value !== 'string') {
    return fallbackValue;
  }
  const normalized = value.trim();
  return normalized || fallbackValue;
}

function sanitizeArrivalRecord(arrival, overrides = {}) {
  const base = arrival && typeof arrival === 'object' ? arrival : {};
  const predictionType = normalizePredictionType(
    overrides.predictionType !== undefined ? overrides.predictionType : base.predictionType,
    PREDICTION_TYPES.INFERRED
  );
  let source = normalizeSource(
    overrides.source !== undefined ? overrides.source : base.source,
    SOURCE_TYPES.FALLBACK
  );

  if (predictionType === PREDICTION_TYPES.INFERRED && source === SOURCE_TYPES.OFFICIAL) {
    source = SOURCE_TYPES.PUBLIC;
  }

  const confidence = clampConfidence(
    overrides.confidence !== undefined ? overrides.confidence : base.confidence,
    0.55
  );
  const reliabilityBand = normalizeReliabilityBand(
    overrides.reliabilityBand !== undefined ? overrides.reliabilityBand : base.reliabilityBand
  );

  return {
    ...base,
    source,
    sourceName: toSourceName(
      overrides.sourceName !== undefined ? overrides.sourceName : base.sourceName,
      source === SOURCE_TYPES.OFFICIAL ? 'amtab_primary' : 'transport_fallback'
    ),
    predictionType,
    confidence,
    freshness: toFreshness(
      overrides.freshness !== undefined ? overrides.freshness : base.freshness
    ),
    reliabilityBand
  };
}

function markScheduledFallback(arrival) {
  return sanitizeArrivalRecord(arrival, {
    source: SOURCE_TYPES.FALLBACK,
    sourceName: `${toSourceName(arrival.sourceName, 'transport_fallback')}:scheduled_fallback`,
    predictionType: PREDICTION_TYPES.SCHEDULED,
    confidence: Math.min(clampConfidence(arrival.confidence, 0.7), 0.74),
    reliabilityBand: 'disclaimer'
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
      return sortByEta(primaryRealtime.map((arrival) => sanitizeArrivalRecord(arrival)));
    }
    const fallbackRealtime = await this._safeArrayCall(this.fallbackProvider, 'getRealtimePredictions', [stopId, lineId]);
    return sortByEta(fallbackRealtime.map((arrival) => sanitizeArrivalRecord(arrival)));
  }

  async getScheduledArrivals(stopId, lineId) {
    const primaryScheduled = await this._safeArrayCall(this.primaryProvider, 'getScheduledArrivals', [stopId, lineId]);
    if (primaryScheduled.length) {
      return sortByEta(primaryScheduled.map((arrival) => sanitizeArrivalRecord(arrival)));
    }
    const fallbackScheduled = await this._safeArrayCall(this.fallbackProvider, 'getScheduledArrivals', [stopId, lineId]);
    return sortByEta(fallbackScheduled.map((arrival) => sanitizeArrivalRecord(arrival)));
  }

  async getStopArrivals(stopId) {
    const direct = await this._callPreferPrimaryArray('getStopArrivals', [stopId]);
    if (direct.length) {
      return sortByEta(direct.map((arrival) => sanitizeArrivalRecord(arrival)));
    }

    const lines = await this.getLinesServingStop(stopId);
    const fallbackArrivals = [];
    for (const line of lines) {
      const realtime = await this.getRealtimePredictions(stopId, line.id);
      if (realtime.length) {
        fallbackArrivals.push(...realtime);
      } else {
        const scheduled = await this.getScheduledArrivals(stopId, line.id);
        fallbackArrivals.push(...scheduled.map((arrival) => markScheduledFallback(arrival)));
      }
    }
    return sortByEta(fallbackArrivals.map((arrival) => sanitizeArrivalRecord(arrival)));
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
    const filtered = (lineId ? arrivals.filter((arrival) => arrival.lineId === lineId) : arrivals)
      .map((arrival) => sanitizeArrivalRecord(arrival));

    const grouped = new Map();
    filtered.forEach((arrival) => {
      if (!grouped.has(arrival.lineId)) {
        grouped.set(arrival.lineId, {
          lineId: arrival.lineId,
          destinationName: arrival.destinationName,
          minutes: [],
          reliabilityBands: [],
          confidences: [],
          freshnessScores: [],
          sources: [],
          sourceNames: [],
          predictionTypes: []
        });
      }
      grouped.get(arrival.lineId).minutes.push(arrival.etaMinutes);
      grouped.get(arrival.lineId).reliabilityBands.push(arrival.reliabilityBand);
      grouped.get(arrival.lineId).confidences.push(arrival.confidence);
      grouped.get(arrival.lineId).freshnessScores.push(arrival.freshness.freshnessScore);
      grouped.get(arrival.lineId).sources.push(arrival.source);
      grouped.get(arrival.lineId).sourceNames.push(arrival.sourceName);
      grouped.get(arrival.lineId).predictionTypes.push(arrival.predictionType);
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        lineId: entry.lineId,
        destinationName: entry.destinationName,
        minutes: entry.minutes.sort((a, b) => a - b).slice(0, 3),
        reliabilityBand: mergeReliabilityBand(entry.reliabilityBands),
        confidence: entry.confidences.length ? Math.min(...entry.confidences) : 0.55,
        freshness: {
          ageSec: null,
          freshnessScore: entry.freshnessScores.length ? Math.min(...entry.freshnessScores) : 0.5,
          bucket: 'aggregated'
        },
        source: entry.sources.includes(SOURCE_TYPES.FALLBACK)
          ? SOURCE_TYPES.FALLBACK
          : entry.sources.includes(SOURCE_TYPES.PUBLIC)
            ? SOURCE_TYPES.PUBLIC
            : SOURCE_TYPES.OFFICIAL,
        sourceName: Array.from(new Set(entry.sourceNames)).filter(Boolean).join(','),
        predictionType: entry.predictionTypes.includes(PREDICTION_TYPES.REALTIME)
          ? PREDICTION_TYPES.REALTIME
          : entry.predictionTypes.includes(PREDICTION_TYPES.SCHEDULED)
            ? PREDICTION_TYPES.SCHEDULED
            : PREDICTION_TYPES.INFERRED
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
    const arrivals = realtime.length
      ? realtime
      : (await this.getScheduledArrivals(candidateStopId, line.id)).map((arrival) =>
        markScheduledFallback(arrival)
      );
    const minutes = arrivals.map((arrival) => arrival.etaMinutes).filter((eta) => typeof eta === 'number').slice(0, 3);
    if (!minutes.length) {
      return [];
    }
    const reliabilityBand = mergeReliabilityBand(arrivals.map((arrival) => arrival.reliabilityBand));

    return [
      {
        lineId: line.id,
        destinationName: line.destinationName,
        minutes,
        reliabilityBand,
        confidence: arrivals.length
          ? Math.min(...arrivals.map((arrival) => arrival.confidence))
          : 0.55,
        freshness: {
          ageSec: null,
          freshnessScore: arrivals.length
            ? Math.min(...arrivals.map((arrival) => arrival.freshness.freshnessScore))
            : 0.5,
          bucket: 'aggregated'
        },
        source: arrivals.some((arrival) => arrival.source === SOURCE_TYPES.FALLBACK)
          ? SOURCE_TYPES.FALLBACK
          : arrivals.some((arrival) => arrival.source === SOURCE_TYPES.PUBLIC)
            ? SOURCE_TYPES.PUBLIC
            : SOURCE_TYPES.OFFICIAL,
        sourceName: Array.from(new Set(arrivals.map((arrival) => arrival.sourceName))).filter(Boolean).join(','),
        predictionType: realtime.length ? PREDICTION_TYPES.REALTIME : PREDICTION_TYPES.SCHEDULED
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
