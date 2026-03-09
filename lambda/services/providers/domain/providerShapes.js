'use strict';

const {
  RELIABILITY_BANDS,
  normalizeReliabilityBand,
  normalizeFreshness,
  scoreProviderResultQuality
} = require('./qualityScoring');

const SOURCE_TYPES = Object.freeze({
  OFFICIAL: 'official',
  PUBLIC: 'public',
  FALLBACK: 'fallback'
});

const PREDICTION_TYPES = Object.freeze({
  REALTIME: 'realtime',
  SCHEDULED: 'scheduled',
  INFERRED: 'inferred'
});

const PROVIDER_ERROR_CODES = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  AUTH: 'AUTH',
  RATE_LIMIT: 'RATE_LIMIT',
  UNAVAILABLE: 'UNAVAILABLE',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  NOT_FOUND: 'NOT_FOUND'
});

function toStringOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function toString(value, fallback = '') {
  const normalized = toStringOrNull(value);
  return normalized === null ? fallback : normalized;
}

function toStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => toStringOrNull(value)).filter(Boolean);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toEpochMsOrNull(value) {
  const parsed = toNumberOrNull(value);
  if (parsed === null) {
    return null;
  }
  return parsed > 1000000000000 ? Math.round(parsed) : Math.round(parsed * 1000);
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = toNumberOrNull(value);
  if (parsed === null) {
    return fallback;
  }
  return Math.max(0, Math.round(parsed));
}

function toObjectOrNull(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value;
}

function clampConfidence(value, fallback = null) {
  const parsed = toNumberOrNull(value);
  if (parsed === null) {
    return fallback;
  }
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 1) {
    return 1;
  }
  return parsed;
}

function normalizeSource(value, fallback = SOURCE_TYPES.FALLBACK) {
  const normalized = toString(value, fallback).toLowerCase();
  if (normalized === SOURCE_TYPES.OFFICIAL) {
    return SOURCE_TYPES.OFFICIAL;
  }
  if (normalized === SOURCE_TYPES.PUBLIC) {
    return SOURCE_TYPES.PUBLIC;
  }
  if (normalized === SOURCE_TYPES.FALLBACK) {
    return SOURCE_TYPES.FALLBACK;
  }

  if (normalized === 'stub' || normalized === 'unknown' || normalized === 'cache' || normalized === 'internal') {
    return SOURCE_TYPES.FALLBACK;
  }
  return fallback;
}

function normalizePredictionType(value, fallback = PREDICTION_TYPES.INFERRED) {
  const normalized = toString(value, fallback).toLowerCase();
  if (normalized === PREDICTION_TYPES.REALTIME) {
    return PREDICTION_TYPES.REALTIME;
  }
  if (normalized === PREDICTION_TYPES.SCHEDULED) {
    return PREDICTION_TYPES.SCHEDULED;
  }
  if (normalized === PREDICTION_TYPES.INFERRED) {
    return PREDICTION_TYPES.INFERRED;
  }
  return fallback;
}

function inferPredictionType({ predictionType, predictedEpochMs, scheduledEpochMs, isRealtime }) {
  if (predictionType) {
    return normalizePredictionType(predictionType, PREDICTION_TYPES.INFERRED);
  }

  if (typeof isRealtime === 'boolean') {
    return isRealtime ? PREDICTION_TYPES.REALTIME : PREDICTION_TYPES.SCHEDULED;
  }
  if (predictedEpochMs !== null) {
    return PREDICTION_TYPES.REALTIME;
  }
  if (scheduledEpochMs !== null) {
    return PREDICTION_TYPES.SCHEDULED;
  }
  return PREDICTION_TYPES.INFERRED;
}

function normalizeCoordinates(rawCoordinates) {
  const lat = toNumberOrNull(rawCoordinates && rawCoordinates.lat);
  const lon = toNumberOrNull(rawCoordinates && rawCoordinates.lon);
  return {
    lat,
    lon
  };
}

function normalizeStopShape(rawStop, defaults = {}) {
  if (!rawStop && !defaults) {
    return null;
  }

  const id = toString(rawStop && rawStop.id ? rawStop.id : defaults.id, '');
  const name = toString(rawStop && rawStop.name ? rawStop.name : defaults.name, '');
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    aliases: toStringArray(rawStop && rawStop.aliases !== undefined ? rawStop.aliases : defaults.aliases),
    coordinates: normalizeCoordinates(rawStop && rawStop.coordinates ? rawStop.coordinates : defaults.coordinates),
    lineIds: toStringArray(rawStop && rawStop.lineIds !== undefined ? rawStop.lineIds : defaults.lineIds),
    source: normalizeSource(rawStop && rawStop.source !== undefined ? rawStop.source : defaults.source),
    sourceName: toString(rawStop && rawStop.sourceName !== undefined ? rawStop.sourceName : defaults.sourceName, ''),
    confidence: clampConfidence(rawStop && rawStop.confidence !== undefined ? rawStop.confidence : defaults.confidence, 0.8),
    providerStopId: toStringOrNull(rawStop && rawStop.providerStopId !== undefined ? rawStop.providerStopId : defaults.providerStopId),
    metadata: toObjectOrNull(rawStop && rawStop.metadata !== undefined ? rawStop.metadata : defaults.metadata)
  };
}

function normalizeLineShape(rawLine, defaults = {}) {
  if (!rawLine && !defaults) {
    return null;
  }

  const id = toString(rawLine && rawLine.id ? rawLine.id : defaults.id, '');
  if (!id) {
    return null;
  }

  return {
    id,
    code: toString(rawLine && rawLine.code !== undefined ? rawLine.code : defaults.code, id),
    aliases: toStringArray(rawLine && rawLine.aliases !== undefined ? rawLine.aliases : defaults.aliases),
    destinationTargetId: toStringOrNull(
      rawLine && rawLine.destinationTargetId !== undefined
        ? rawLine.destinationTargetId
        : defaults.destinationTargetId
    ),
    destinationName: toString(
      rawLine && rawLine.destinationName !== undefined ? rawLine.destinationName : defaults.destinationName,
      ''
    ),
    stopIds: toStringArray(rawLine && rawLine.stopIds !== undefined ? rawLine.stopIds : defaults.stopIds),
    firstMinute: toNumberOrNull(rawLine && rawLine.firstMinute !== undefined ? rawLine.firstMinute : defaults.firstMinute),
    lastMinute: toNumberOrNull(rawLine && rawLine.lastMinute !== undefined ? rawLine.lastMinute : defaults.lastMinute),
    headwayMinutes: toNumberOrNull(
      rawLine && rawLine.headwayMinutes !== undefined ? rawLine.headwayMinutes : defaults.headwayMinutes
    ),
    source: normalizeSource(rawLine && rawLine.source !== undefined ? rawLine.source : defaults.source),
    sourceName: toString(rawLine && rawLine.sourceName !== undefined ? rawLine.sourceName : defaults.sourceName, ''),
    confidence: clampConfidence(rawLine && rawLine.confidence !== undefined ? rawLine.confidence : defaults.confidence, 0.85),
    providerLineId: toStringOrNull(rawLine && rawLine.providerLineId !== undefined ? rawLine.providerLineId : defaults.providerLineId),
    metadata: toObjectOrNull(rawLine && rawLine.metadata !== undefined ? rawLine.metadata : defaults.metadata)
  };
}

function normalizeDestinationTargetShape(rawDestinationTarget, defaults = {}) {
  if (!rawDestinationTarget && !defaults) {
    return null;
  }

  const id = toString(
    rawDestinationTarget && rawDestinationTarget.id ? rawDestinationTarget.id : defaults.id,
    ''
  );
  const name = toString(
    rawDestinationTarget && rawDestinationTarget.name ? rawDestinationTarget.name : defaults.name,
    ''
  );
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    aliases: toStringArray(
      rawDestinationTarget && rawDestinationTarget.aliases !== undefined
        ? rawDestinationTarget.aliases
        : defaults.aliases
    ),
    targetStopIds: toStringArray(
      rawDestinationTarget && rawDestinationTarget.targetStopIds !== undefined
        ? rawDestinationTarget.targetStopIds
        : defaults.targetStopIds
    ),
    source: normalizeSource(
      rawDestinationTarget && rawDestinationTarget.source !== undefined
        ? rawDestinationTarget.source
        : defaults.source
    ),
    sourceName: toString(
      rawDestinationTarget && rawDestinationTarget.sourceName !== undefined
        ? rawDestinationTarget.sourceName
        : defaults.sourceName,
      ''
    ),
    confidence: clampConfidence(
      rawDestinationTarget && rawDestinationTarget.confidence !== undefined
        ? rawDestinationTarget.confidence
        : defaults.confidence,
      0.8
    ),
    providerDestinationId: toStringOrNull(
      rawDestinationTarget && rawDestinationTarget.providerDestinationId !== undefined
        ? rawDestinationTarget.providerDestinationId
        : defaults.providerDestinationId
    ),
    metadata: toObjectOrNull(
      rawDestinationTarget && rawDestinationTarget.metadata !== undefined
        ? rawDestinationTarget.metadata
        : defaults.metadata
    )
  };
}

function toArrivalFallbackConfidence(predictionType) {
  if (predictionType === PREDICTION_TYPES.REALTIME) {
    return 0.9;
  }
  if (predictionType === PREDICTION_TYPES.SCHEDULED) {
    return 0.75;
  }
  return 0.55;
}

function buildArrivalId({ stopId, lineId, predictionType, predictedEpochMs, scheduledEpochMs }) {
  const timestampPart = predictedEpochMs || scheduledEpochMs || 'na';
  return `arr:${stopId}:${lineId}:${predictionType}:${timestampPart}`;
}

function normalizeArrivalShape(rawArrival, defaults = {}) {
  if (!rawArrival && !defaults) {
    return null;
  }

  const stopId = toString(rawArrival && rawArrival.stopId ? rawArrival.stopId : defaults.stopId, '');
  const lineId = toString(rawArrival && rawArrival.lineId ? rawArrival.lineId : defaults.lineId, '');
  if (!stopId || !lineId) {
    return null;
  }

  const scheduledEpochMs = toEpochMsOrNull(
    rawArrival && rawArrival.scheduledEpochMs !== undefined
      ? rawArrival.scheduledEpochMs
      : defaults.scheduledEpochMs
  );
  const predictedEpochMs = toEpochMsOrNull(
    rawArrival && rawArrival.predictedEpochMs !== undefined
      ? rawArrival.predictedEpochMs
      : defaults.predictedEpochMs
  );
  const predictionType = inferPredictionType({
    predictionType:
      rawArrival && rawArrival.predictionType !== undefined
        ? rawArrival.predictionType
        : defaults.predictionType,
    predictedEpochMs,
    scheduledEpochMs,
    isRealtime: rawArrival && rawArrival.isRealtime !== undefined ? rawArrival.isRealtime : defaults.isRealtime
  });

  const asOfEpochMs = toEpochMsOrNull(
    rawArrival && rawArrival.asOfEpochMs !== undefined ? rawArrival.asOfEpochMs : defaults.asOfEpochMs
  ) || Date.now();

  let etaMinutes = toNumberOrNull(rawArrival && rawArrival.etaMinutes !== undefined ? rawArrival.etaMinutes : defaults.etaMinutes);
  if (etaMinutes === null) {
    const referenceEpochMs = predictedEpochMs !== null ? predictedEpochMs : scheduledEpochMs;
    if (referenceEpochMs !== null) {
      etaMinutes = Math.max(0, Math.round((referenceEpochMs - asOfEpochMs) / 60000));
    }
  }

  return {
    id: buildArrivalId({
      stopId,
      lineId,
      predictionType,
      predictedEpochMs,
      scheduledEpochMs
    }),
    stopId,
    lineId,
    destinationTargetId: toStringOrNull(
      rawArrival && rawArrival.destinationTargetId !== undefined
        ? rawArrival.destinationTargetId
        : defaults.destinationTargetId
    ),
    destinationName: toString(
      rawArrival && rawArrival.destinationName !== undefined ? rawArrival.destinationName : defaults.destinationName,
      ''
    ),
    etaMinutes: etaMinutes === null ? null : Math.max(0, Math.round(etaMinutes)),
    predictionType,
    scheduledEpochMs,
    predictedEpochMs,
    delaySeconds:
      predictedEpochMs !== null && scheduledEpochMs !== null
        ? Math.round((predictedEpochMs - scheduledEpochMs) / 1000)
        : null,
    asOfEpochMs,
    isRealtime: predictionType === PREDICTION_TYPES.REALTIME,
    source: normalizeSource(rawArrival && rawArrival.source !== undefined ? rawArrival.source : defaults.source),
    sourceName: toString(rawArrival && rawArrival.sourceName !== undefined ? rawArrival.sourceName : defaults.sourceName, ''),
    confidence: clampConfidence(
      rawArrival && rawArrival.confidence !== undefined ? rawArrival.confidence : defaults.confidence,
      toArrivalFallbackConfidence(predictionType)
    ),
    freshness: normalizeFreshness(
      rawArrival && rawArrival.freshness !== undefined ? rawArrival.freshness : defaults.freshness,
      0.5
    ),
    reliabilityBand: normalizeReliabilityBand(
      rawArrival && rawArrival.reliabilityBand !== undefined ? rawArrival.reliabilityBand : defaults.reliabilityBand,
      RELIABILITY_BANDS.CAUTION
    ),
    providerTripId: toStringOrNull(
      rawArrival && rawArrival.providerTripId !== undefined
        ? rawArrival.providerTripId
        : rawArrival && rawArrival.tripId !== undefined
          ? rawArrival.tripId
          : defaults.providerTripId
    ),
    metadata: toObjectOrNull(rawArrival && rawArrival.metadata !== undefined ? rawArrival.metadata : defaults.metadata)
  };
}

function buildRouteId({ originStopId, destinationTargetId, lineIds }) {
  return `route:${originStopId}:${destinationTargetId}:${lineIds.join('+')}`;
}

function normalizeRouteOptionShape(rawRouteOption, defaults = {}) {
  if (!rawRouteOption && !defaults) {
    return null;
  }

  const originStopId = toString(
    rawRouteOption && rawRouteOption.originStopId ? rawRouteOption.originStopId : defaults.originStopId,
    ''
  );
  const destinationTargetId = toString(
    rawRouteOption && rawRouteOption.destinationTargetId
      ? rawRouteOption.destinationTargetId
      : defaults.destinationTargetId,
    ''
  );
  const lineIds = toStringArray(
    rawRouteOption && rawRouteOption.lineIds !== undefined ? rawRouteOption.lineIds : defaults.lineIds
  );
  if (!originStopId || !destinationTargetId || !lineIds.length) {
    return null;
  }

  const predictionType = normalizePredictionType(
    rawRouteOption && rawRouteOption.predictionType !== undefined
      ? rawRouteOption.predictionType
      : defaults.predictionType,
    PREDICTION_TYPES.INFERRED
  );

  return {
    id: toString(
      rawRouteOption && rawRouteOption.id !== undefined ? rawRouteOption.id : defaults.id,
      buildRouteId({ originStopId, destinationTargetId, lineIds })
    ),
    originStopId,
    destinationTargetId,
    lineIds,
    transfers: toNonNegativeInt(
      rawRouteOption && rawRouteOption.transfers !== undefined ? rawRouteOption.transfers : defaults.transfers,
      0
    ),
    estimatedMinutes: toNumberOrNull(
      rawRouteOption && rawRouteOption.estimatedMinutes !== undefined
        ? rawRouteOption.estimatedMinutes
        : defaults.estimatedMinutes
    ),
    predictionType,
    source: normalizeSource(
      rawRouteOption && rawRouteOption.source !== undefined ? rawRouteOption.source : defaults.source
    ),
    sourceName: toString(
      rawRouteOption && rawRouteOption.sourceName !== undefined ? rawRouteOption.sourceName : defaults.sourceName,
      ''
    ),
    confidence: clampConfidence(
      rawRouteOption && rawRouteOption.confidence !== undefined ? rawRouteOption.confidence : defaults.confidence,
      0.7
    ),
    metadata: toObjectOrNull(
      rawRouteOption && rawRouteOption.metadata !== undefined ? rawRouteOption.metadata : defaults.metadata
    )
  };
}

function createProviderError(rawProviderError, defaults = {}) {
  const base = rawProviderError || {};
  const code = toString(base.code || defaults.code, PROVIDER_ERROR_CODES.UNKNOWN).toUpperCase();

  return {
    code: PROVIDER_ERROR_CODES[code] ? code : PROVIDER_ERROR_CODES.UNKNOWN,
    message: toString(base.message || defaults.message, 'Provider error'),
    retriable: Boolean(base.retriable !== undefined ? base.retriable : defaults.retriable),
    source: normalizeSource(base.source !== undefined ? base.source : defaults.source),
    sourceName: toString(base.sourceName !== undefined ? base.sourceName : defaults.sourceName, ''),
    httpStatus: toNumberOrNull(base.httpStatus !== undefined ? base.httpStatus : defaults.httpStatus),
    occurredAtEpochMs:
      toEpochMsOrNull(base.occurredAtEpochMs !== undefined ? base.occurredAtEpochMs : defaults.occurredAtEpochMs) ||
      Date.now(),
    details: toObjectOrNull(base.details !== undefined ? base.details : defaults.details),
    cause: toStringOrNull(base.cause !== undefined ? base.cause : defaults.cause)
  };
}

function createProviderResult(rawProviderResult = {}) {
  const ok = rawProviderResult.ok !== false;
  const source = normalizeSource(rawProviderResult.source, SOURCE_TYPES.FALLBACK);
  const sourceName = toString(rawProviderResult.sourceName, source === SOURCE_TYPES.OFFICIAL ? 'provider_primary' : 'provider_fallback');
  const predictionType = normalizePredictionType(
    rawProviderResult.predictionType !== undefined ? rawProviderResult.predictionType : PREDICTION_TYPES.INFERRED,
    PREDICTION_TYPES.INFERRED
  );
  const rawConfidence = clampConfidence(rawProviderResult.confidence, null);
  const quality = scoreProviderResultQuality({
    source,
    sourceName,
    predictionType,
    confidence: rawConfidence,
    freshness: rawProviderResult.freshness,
    reliabilityBand: rawProviderResult.reliabilityBand,
    ok,
    data: Array.isArray(rawProviderResult.data) ? rawProviderResult.data : [],
    error: rawProviderResult.error || null
  });

  return {
    ok,
    source,
    sourceName,
    predictionType,
    confidence: quality.confidence,
    freshness: quality.freshness,
    reliabilityBand: quality.reliabilityBand,
    fetchedAtEpochMs: toEpochMsOrNull(rawProviderResult.fetchedAtEpochMs) || Date.now(),
    staleAtEpochMs: toEpochMsOrNull(rawProviderResult.staleAtEpochMs),
    warnings: toStringArray(rawProviderResult.warnings),
    data: Array.isArray(rawProviderResult.data) ? rawProviderResult.data : [],
    error: rawProviderResult.error ? createProviderError(rawProviderResult.error, { source }) : null,
    meta: toObjectOrNull(rawProviderResult.meta)
  };
}

function isProviderResult(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'ok' in value && 'data' in value);
}

function unwrapProviderResultData(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (isProviderResult(value)) {
    return Array.isArray(value.data) ? value.data : [];
  }
  return [];
}

module.exports = {
  SOURCE_TYPES,
  PREDICTION_TYPES,
  PROVIDER_ERROR_CODES,
  normalizeSource,
  normalizePredictionType,
  clampConfidence,
  normalizeStopShape,
  normalizeLineShape,
  normalizeArrivalShape,
  normalizeRouteOptionShape,
  normalizeDestinationTargetShape,
  createProviderResult,
  createProviderError,
  isProviderResult,
  unwrapProviderResultData
};
