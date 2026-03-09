'use strict';

const {
  SOURCE_TYPES,
  PREDICTION_TYPES,
  normalizeSource,
  normalizePredictionType,
  normalizeStopShape,
  clampConfidence
} = require('../../domain/providerShapes');
const { scoreRecordReliability } = require('../../domain/reliabilityScoring');

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
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

function pickFirst(source, keys) {
  if (!source || typeof source !== 'object') {
    return null;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return null;
}

function normalizeStopId(value) {
  const token = toText(value).toUpperCase();
  if (!token) {
    return '';
  }
  return token
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9:_/-]/g, '');
}

function normalizeStopName(value) {
  return toText(value).replace(/\s+/g, ' ');
}

function resolveCoordinates(rawStop) {
  const direct = rawStop && rawStop.coordinates && typeof rawStop.coordinates === 'object'
    ? rawStop.coordinates
    : null;
  const lat = toNumberOrNull(direct && direct.lat !== undefined ? direct.lat : pickFirst(rawStop, ['stop_lat', 'stopLat', 'lat', 'latitude']));
  const lon = toNumberOrNull(direct && direct.lon !== undefined ? direct.lon : pickFirst(rawStop, ['stop_lon', 'stopLon', 'lon', 'lng', 'longitude']));

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { lat: null, lon: null };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { lat: null, lon: null };
  }
  return { lat, lon };
}

function resolvePredictionType(rawStop, options) {
  return normalizePredictionType(
    pickFirst(rawStop, ['predictionType', 'prediction_type']) || options.predictionType || PREDICTION_TYPES.SCHEDULED,
    PREDICTION_TYPES.SCHEDULED
  );
}

function resolveSource(rawStop, predictionType, options) {
  const requested = normalizeSource(
    pickFirst(rawStop, ['source']) || options.source || SOURCE_TYPES.FALLBACK,
    SOURCE_TYPES.FALLBACK
  );
  const isVerifiedOfficial = options.verifiedOfficial === true;

  if (predictionType === PREDICTION_TYPES.INFERRED && requested === SOURCE_TYPES.OFFICIAL) {
    return SOURCE_TYPES.PUBLIC;
  }
  if (requested === SOURCE_TYPES.OFFICIAL && !isVerifiedOfficial) {
    return SOURCE_TYPES.PUBLIC;
  }
  if (options.forceFallback === true || rawStop.isMock === true || rawStop.isSimulated === true) {
    return SOURCE_TYPES.FALLBACK;
  }
  return requested;
}

function resolveSourceName(rawStop, source, options) {
  const explicit = toText(pickFirst(rawStop, ['sourceName', 'source_name']) || options.sourceName);
  if (explicit) {
    return explicit;
  }
  if (source === SOURCE_TYPES.OFFICIAL) {
    return options.officialSourceName || 'amtab_gtfs_static';
  }
  if (source === SOURCE_TYPES.PUBLIC) {
    return options.publicSourceName || 'amtab_public_unverified';
  }
  return options.fallbackSourceName || 'amtab_fallback';
}

function defaultConfidenceBySource(source) {
  if (source === SOURCE_TYPES.OFFICIAL) {
    return 0.96;
  }
  if (source === SOURCE_TYPES.PUBLIC) {
    return 0.8;
  }
  return 0.65;
}

function normalizeAliases(rawStop, stopCode) {
  const aliases = [];
  if (stopCode) {
    aliases.push(stopCode);
  }
  const rawAliases = Array.isArray(rawStop.aliases) ? rawStop.aliases : [];
  rawAliases.forEach((entry) => {
    const value = toText(entry);
    if (value) {
      aliases.push(value);
    }
  });
  return Array.from(new Set(aliases));
}

function mapRawStopToStop(rawStop, options = {}) {
  const record = rawStop && typeof rawStop === 'object' ? rawStop : {};
  const nowEpochMs = typeof options.nowEpochMs === 'number' ? options.nowEpochMs : Date.now();
  const stopId = normalizeStopId(
    pickFirst(record, ['stopId', 'stop_id', 'id', 'stopCode', 'stop_code', 'code'])
  );
  const stopName = normalizeStopName(
    pickFirst(record, ['stopName', 'stop_name', 'name', 'stop_desc'])
  );
  if (!stopId || !stopName) {
    return null;
  }

  const predictionType = resolvePredictionType(record, options);
  const source = resolveSource(record, predictionType, options);
  const sourceName = resolveSourceName(record, source, options);
  const stopCode = toText(pickFirst(record, ['stopCode', 'stop_code', 'code']));
  const providerStopId = toText(
    pickFirst(record, ['providerStopId', 'provider_stop_id', 'stopId', 'stop_id', 'id'])
  );
  const confidence = clampConfidence(
    pickFirst(record, ['confidence']) !== null ? pickFirst(record, ['confidence']) : options.confidence,
    defaultConfidenceBySource(source)
  );
  const referenceEpochMs =
    toEpochMsOrNull(
      pickFirst(record, ['asOfEpochMs', 'as_of_epoch_ms', 'fetchedAtEpochMs', 'fetched_at_epoch_ms', 'updatedAtEpochMs'])
    ) ||
    toEpochMsOrNull(options.referenceEpochMs) ||
    nowEpochMs;

  const normalized = normalizeStopShape({
    id: stopId,
    name: stopName,
    aliases: normalizeAliases(record, stopCode),
    coordinates: resolveCoordinates(record),
    lineIds: Array.isArray(record.lineIds) ? record.lineIds : [],
    source,
    sourceName,
    confidence,
    providerStopId: providerStopId || null,
    metadata: {
      stopCode: stopCode || null,
      direction: toText(pickFirst(record, ['direction', 'stop_direction'])) || null,
      side: toText(pickFirst(record, ['side', 'lato'])) || null,
      platformCode: toText(pickFirst(record, ['platformCode', 'platform_code'])) || null,
      rawIndex: record.rawIndex !== undefined ? record.rawIndex : null
    }
  });
  if (!normalized) {
    return null;
  }

  const reliability = scoreRecordReliability(
    {
      ...normalized,
      predictionType,
      asOfEpochMs: referenceEpochMs
    },
    {
      recordType: 'stop',
      nowEpochMs,
      thresholds: options.thresholds
    }
  );

  if (reliability.reliabilityBand === 'discard' && options.includeDiscarded !== true) {
    return null;
  }

  return {
    ...normalized,
    source: reliability.source || normalized.source || SOURCE_TYPES.FALLBACK,
    sourceName,
    predictionType,
    confidence: clampConfidence(reliability.confidence, normalized.confidence),
    freshness: reliability.freshness || { ageSec: null, freshnessScore: 0.5, bucket: 'unknown' },
    reliabilityBand: reliability.reliabilityBand || 'caution',
    scoreBreakdown: reliability.scoreBreakdown,
    coherenceReasons: reliability.coherenceReasons
  };
}

module.exports = {
  mapRawStopToStop
};
