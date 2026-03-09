'use strict';

const {
  SOURCE_TYPES,
  PREDICTION_TYPES,
  normalizeSource,
  normalizePredictionType,
  normalizeLineShape,
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

function normalizeLineToken(value) {
  return toText(value).replace(/\s+/g, '');
}

function resolvePredictionType(rawLine, options) {
  return normalizePredictionType(
    pickFirst(rawLine, ['predictionType', 'prediction_type']) || options.predictionType || PREDICTION_TYPES.SCHEDULED,
    PREDICTION_TYPES.SCHEDULED
  );
}

function resolveSource(rawLine, predictionType, options) {
  const requested = normalizeSource(
    pickFirst(rawLine, ['source']) || options.source || SOURCE_TYPES.FALLBACK,
    SOURCE_TYPES.FALLBACK
  );
  const isVerifiedOfficial = options.verifiedOfficial === true;

  if (predictionType === PREDICTION_TYPES.INFERRED && requested === SOURCE_TYPES.OFFICIAL) {
    return SOURCE_TYPES.PUBLIC;
  }
  if (requested === SOURCE_TYPES.OFFICIAL && !isVerifiedOfficial) {
    return SOURCE_TYPES.PUBLIC;
  }
  if (options.forceFallback === true || rawLine.isMock === true || rawLine.isSimulated === true) {
    return SOURCE_TYPES.FALLBACK;
  }
  return requested;
}

function resolveSourceName(rawLine, source, options) {
  const explicit = toText(pickFirst(rawLine, ['sourceName', 'source_name']) || options.sourceName);
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
    return 0.9;
  }
  if (source === SOURCE_TYPES.PUBLIC) {
    return 0.76;
  }
  return 0.62;
}

function normalizeAliases(rawLine, routeId) {
  const aliases = [];
  const routeLongName = toText(pickFirst(rawLine, ['route_long_name', 'routeLongName', 'name']));
  if (routeLongName) {
    aliases.push(routeLongName);
  }
  if (routeId) {
    aliases.push(routeId);
  }
  if (Array.isArray(rawLine.aliases)) {
    rawLine.aliases.forEach((entry) => {
      const token = toText(entry);
      if (token) {
        aliases.push(token);
      }
    });
  }
  return Array.from(new Set(aliases));
}

function mapRawLineToLine(rawLine, options = {}) {
  const record = rawLine && typeof rawLine === 'object' ? rawLine : {};
  const nowEpochMs = typeof options.nowEpochMs === 'number' ? options.nowEpochMs : Date.now();
  const routeId = toText(pickFirst(record, ['route_id', 'routeId', 'providerLineId']));
  const lineId = normalizeLineToken(
    pickFirst(record, ['id', 'lineId', 'line_id', 'lineNumber', 'line_number', 'route_short_name']) || routeId
  );
  if (!lineId) {
    return null;
  }

  const predictionType = resolvePredictionType(record, options);
  const source = resolveSource(record, predictionType, options);
  const sourceName = resolveSourceName(record, source, options);
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

  const normalized = normalizeLineShape({
    id: lineId,
    code: toText(pickFirst(record, ['code', 'route_short_name', 'lineCode', 'line_code'])) || lineId,
    aliases: normalizeAliases(record, routeId),
    destinationTargetId: toText(pickFirst(record, ['destinationTargetId', 'destination_target_id'])) || null,
    destinationName: toText(
      pickFirst(record, ['destinationName', 'destination_name', 'headsign', 'route_long_name'])
    ),
    stopIds: Array.isArray(record.stopIds) ? record.stopIds : [],
    firstMinute: toNumberOrNull(pickFirst(record, ['firstMinute', 'first_minute'])),
    lastMinute: toNumberOrNull(pickFirst(record, ['lastMinute', 'last_minute'])),
    headwayMinutes: toNumberOrNull(pickFirst(record, ['headwayMinutes', 'headway_minutes'])),
    source,
    sourceName,
    confidence,
    providerLineId: routeId || null,
    metadata: {
      routeId: routeId || null,
      routeType: toText(pickFirst(record, ['route_type', 'routeType'])) || null,
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
      recordType: 'line',
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
  mapRawLineToLine
};
