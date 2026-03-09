'use strict';

const {
  SOURCE_TYPES,
  PREDICTION_TYPES,
  normalizeSource,
  normalizePredictionType,
  normalizeArrivalShape,
  clampConfidence
} = require('../../domain/providerShapes');
const { scoreRecordReliability } = require('../../domain/reliabilityScoring');
const { DEFAULT_SERVICE_TIME_ZONE, parseFlexibleTimeValue } = require('../../domain/timeParsing');

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toEpochMsOrNull(value) {
  const parsed = parseFlexibleTimeValue(value, {
    serviceTimeZone: DEFAULT_SERVICE_TIME_ZONE
  });
  return typeof parsed === 'number' ? parsed : null;
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

function normalizeLineToken(value) {
  return toText(value).replace(/\s+/g, '');
}

function resolveLineId(rawArrival) {
  const candidate = pickFirst(rawArrival, ['lineId', 'line_id', 'lineNumber', 'line_number', 'line', 'routeId', 'route_id']);
  return normalizeLineToken(candidate);
}

function resolvePredictionType(rawArrival, options, predictedEpochMs, scheduledEpochMs) {
  const explicitValue =
    pickFirst(rawArrival, ['predictionType', 'prediction_type', 'recordType', 'record_type']) ||
    options.predictionType ||
    null;
  const explicit = explicitValue ? normalizePredictionType(explicitValue, PREDICTION_TYPES.INFERRED) : null;

  if (explicit === PREDICTION_TYPES.INFERRED) {
    return PREDICTION_TYPES.INFERRED;
  }
  if (explicit === PREDICTION_TYPES.REALTIME && predictedEpochMs !== null) {
    return PREDICTION_TYPES.REALTIME;
  }
  if (explicit === PREDICTION_TYPES.SCHEDULED && scheduledEpochMs !== null) {
    return PREDICTION_TYPES.SCHEDULED;
  }
  if (predictedEpochMs !== null) {
    return PREDICTION_TYPES.REALTIME;
  }
  if (scheduledEpochMs !== null) {
    return PREDICTION_TYPES.SCHEDULED;
  }
  return PREDICTION_TYPES.INFERRED;
}

function resolveSource(rawArrival, predictionType, options) {
  const requested = normalizeSource(
    pickFirst(rawArrival, ['source']) || options.source || SOURCE_TYPES.FALLBACK,
    SOURCE_TYPES.FALLBACK
  );
  const isVerifiedOfficial = options.verifiedOfficial === true;

  if (options.forceFallback === true || rawArrival.isMock === true || rawArrival.isSimulated === true) {
    return SOURCE_TYPES.FALLBACK;
  }
  if (predictionType === PREDICTION_TYPES.INFERRED && requested === SOURCE_TYPES.OFFICIAL) {
    return SOURCE_TYPES.PUBLIC;
  }
  if (requested === SOURCE_TYPES.OFFICIAL && !isVerifiedOfficial) {
    return SOURCE_TYPES.PUBLIC;
  }
  return requested;
}

function resolveSourceName(rawArrival, source, predictionType, options) {
  const explicit = toText(pickFirst(rawArrival, ['sourceName', 'source_name']) || options.sourceName);
  if (explicit) {
    return explicit;
  }
  if (source === SOURCE_TYPES.OFFICIAL) {
    return predictionType === PREDICTION_TYPES.REALTIME
      ? (options.officialRealtimeSourceName || 'amtab_gtfs_rt_tripupdates')
      : (options.officialScheduledSourceName || 'amtab_gtfs_static');
  }
  if (source === SOURCE_TYPES.PUBLIC) {
    return options.publicSourceName || 'amtab_public_unverified';
  }
  return options.fallbackSourceName || 'amtab_fallback';
}

function defaultConfidenceBySourceAndType(source, predictionType) {
  if (source === SOURCE_TYPES.OFFICIAL) {
    if (predictionType === PREDICTION_TYPES.REALTIME) {
      return 0.9;
    }
    if (predictionType === PREDICTION_TYPES.SCHEDULED) {
      return 0.76;
    }
    return 0.62;
  }
  if (source === SOURCE_TYPES.PUBLIC) {
    if (predictionType === PREDICTION_TYPES.REALTIME) {
      return 0.78;
    }
    if (predictionType === PREDICTION_TYPES.SCHEDULED) {
      return 0.7;
    }
    return 0.62;
  }
  if (predictionType === PREDICTION_TYPES.REALTIME) {
    return 0.65;
  }
  if (predictionType === PREDICTION_TYPES.SCHEDULED) {
    return 0.62;
  }
  return 0.55;
}

function resolveTimestamps(rawArrival, options) {
  const serviceTimeZone =
    (typeof options.serviceTimeZone === 'string' && options.serviceTimeZone.trim()) || DEFAULT_SERVICE_TIME_ZONE;
  const serviceDate = options.serviceDate;
  const fallbackReferenceEpochMs = toEpochMsOrNull(options.referenceEpochMs) || Date.now();
  const referenceEpochMs =
    parseFlexibleTimeValue(
      pickFirst(rawArrival, ['asOfEpochMs', 'as_of_epoch_ms', 'headerTimestampEpochMs', 'header_timestamp_epoch_ms', 'timestamp']),
      {
        referenceEpochMs: fallbackReferenceEpochMs,
        serviceDate,
        serviceTimeZone,
        allowRollover: false
      }
    ) || fallbackReferenceEpochMs;
  const predictedEpochMs =
    parseFlexibleTimeValue(
      pickFirst(rawArrival, ['predictedEpochMs', 'predicted_epoch_ms', 'realtimeEpochMs', 'realtime_epoch_ms', 'realtime_time']),
      {
        referenceEpochMs,
        serviceDate,
        serviceTimeZone,
        rolloverReferenceEpochMs: referenceEpochMs
      }
    ) ||
    null;
  const scheduledEpochMs =
    parseFlexibleTimeValue(
      pickFirst(rawArrival, ['scheduledEpochMs', 'scheduled_epoch_ms', 'scheduledTime', 'scheduled_time']),
      {
        referenceEpochMs,
        serviceDate,
        serviceTimeZone,
        rolloverReferenceEpochMs: referenceEpochMs
      }
    ) ||
    null;
  const asOfEpochMs =
    referenceEpochMs;

  return {
    predictedEpochMs,
    scheduledEpochMs,
    asOfEpochMs
  };
}

function mapRawArrivalToArrival(rawArrival, options = {}) {
  const record = rawArrival && typeof rawArrival === 'object' ? rawArrival : {};
  const nowEpochMs = typeof options.nowEpochMs === 'number' ? options.nowEpochMs : Date.now();
  const stopId = normalizeStopId(
    pickFirst(record, ['stopId', 'stop_id', 'stopCode', 'stop_code'])
  );
  const lineId = resolveLineId(record);
  if (!stopId || !lineId) {
    return null;
  }

  const timestamps = resolveTimestamps(record, options);
  if (timestamps.predictedEpochMs === null && timestamps.scheduledEpochMs === null) {
    return null;
  }

  const predictionType = resolvePredictionType(
    record,
    options,
    timestamps.predictedEpochMs,
    timestamps.scheduledEpochMs
  );
  const source = resolveSource(record, predictionType, options);
  const sourceName = resolveSourceName(record, source, predictionType, options);
  const confidence = clampConfidence(
    pickFirst(record, ['confidence']) !== null ? pickFirst(record, ['confidence']) : options.confidence,
    defaultConfidenceBySourceAndType(source, predictionType)
  );

  const normalized = normalizeArrivalShape({
    stopId,
    lineId,
    destinationTargetId: toText(pickFirst(record, ['destinationTargetId', 'destination_target_id'])) || null,
    destinationName: toText(
      pickFirst(record, ['destinationName', 'destination_name', 'destination', 'headsign', 'tripHeadsign', 'trip_headsign'])
    ),
    predictionType,
    predictedEpochMs: timestamps.predictedEpochMs,
    scheduledEpochMs: timestamps.scheduledEpochMs,
    asOfEpochMs: timestamps.asOfEpochMs,
    source,
    sourceName,
    confidence,
    providerTripId: toText(pickFirst(record, ['providerTripId', 'tripId', 'trip_id'])) || null,
    metadata: {
      routeId: toText(pickFirst(record, ['routeId', 'route_id'])) || null,
      tripId: toText(pickFirst(record, ['tripId', 'trip_id'])) || null,
      vehicleId: toText(pickFirst(record, ['vehicleId', 'vehicle_id'])) || null,
      rawIndex: record.rawIndex !== undefined ? record.rawIndex : null
    }
  });
  if (!normalized) {
    return null;
  }

  const reliability = scoreRecordReliability(
    {
      ...normalized,
      predictionType
    },
    {
      recordType: 'arrival',
      nowEpochMs,
      thresholds: options.thresholds,
      contradictionCount: Number(options.contradictionCount) || 0,
      consensusCount: Number(options.consensusCount) || 0
    }
  );

  if (reliability.reliabilityBand === 'discard' && options.includeDiscarded !== true) {
    return null;
  }

  return {
    ...normalized,
    source: reliability.source || normalized.source || SOURCE_TYPES.FALLBACK,
    sourceName,
    predictionType: reliability.predictionType || predictionType,
    confidence: clampConfidence(reliability.confidence, normalized.confidence),
    freshness: reliability.freshness || { ageSec: null, freshnessScore: 0.5, bucket: 'unknown' },
    reliabilityBand: reliability.reliabilityBand || 'caution',
    scoreBreakdown: reliability.scoreBreakdown,
    coherenceReasons: reliability.coherenceReasons
  };
}

module.exports = {
  mapRawArrivalToArrival
};
