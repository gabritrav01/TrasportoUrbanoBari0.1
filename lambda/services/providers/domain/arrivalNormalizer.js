'use strict';

const {
  PREDICTION_TYPES,
  SOURCE_TYPES,
  normalizeSource,
  normalizePredictionType,
  normalizeArrivalShape,
  createProviderError
} = require('./providerShapes');

const STOP_ID_FIELDS = [
  'stopId',
  'stop_id',
  'stopCode',
  'stop_code',
  'stop',
  'fermataId',
  'fermata_id'
];

const LINE_ID_FIELDS = [
  'lineId',
  'line_id',
  'line',
  'lineCode',
  'line_code',
  'routeId',
  'route_id',
  'routeShortName',
  'route_short_name'
];

const DESTINATION_ID_FIELDS = [
  'destinationTargetId',
  'destination_target_id',
  'destinationId',
  'destination_id',
  'headsignId',
  'headsign_id'
];

const DESTINATION_NAME_FIELDS = [
  'destinationName',
  'destination_name',
  'destination',
  'headsign',
  'tripHeadsign',
  'trip_headsign',
  'direction',
  'directionName'
];

const PREDICTED_TIME_FIELDS = [
  'predictedEpochMs',
  'predictedTime',
  'predicted_time',
  'expectedTime',
  'expected_time',
  'realtimeEpochMs',
  'arrivalPrediction',
  'etaTimestamp'
];

const SCHEDULED_TIME_FIELDS = [
  'scheduledEpochMs',
  'scheduledTime',
  'scheduled_time',
  'plannedTime',
  'planned_time',
  'arrivalTime',
  'timetableTime'
];

const AS_OF_TIME_FIELDS = [
  'asOfEpochMs',
  'as_of_epoch_ms',
  'timestamp',
  'feedTimestamp',
  'feed_timestamp',
  'updatedAt',
  'updateTime'
];

const ETA_FIELDS = [
  'etaMinutes',
  'eta_minutes',
  'minutes',
  'minutesToArrival',
  'minutes_to_arrival',
  'arrivalInMin',
  'arrival_in_min'
];

const PREDICTION_TYPE_FIELDS = ['predictionType', 'prediction_type'];

function createNoopLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
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

function toTextOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function pickFirstNonEmpty(raw, fieldNames) {
  for (const fieldName of fieldNames) {
    if (raw && raw[fieldName] !== undefined && raw[fieldName] !== null && raw[fieldName] !== '') {
      return raw[fieldName];
    }
  }
  return null;
}

function canonicalizeId(value) {
  const text = toTextOrNull(value);
  if (!text) {
    return null;
  }
  return text
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9/_:-]/g, '');
}

function sourceRank(source) {
  if (source === SOURCE_TYPES.OFFICIAL) {
    return 3;
  }
  if (source === SOURCE_TYPES.PUBLIC) {
    return 2;
  }
  return 1;
}

function predictionRank(predictionType) {
  if (predictionType === PREDICTION_TYPES.REALTIME) {
    return 3;
  }
  if (predictionType === PREDICTION_TYPES.INFERRED) {
    return 2;
  }
  return 1;
}

function toTimeValue(rawValue, context) {
  const text = toTextOrNull(rawValue);
  if (!text) {
    return null;
  }

  const numeric = toNumberOrNull(text);
  if (numeric !== null) {
    if (numeric > 1000000000000) {
      return Math.round(numeric);
    }
    if (numeric > 1000000000) {
      return Math.round(numeric * 1000);
    }
  }

  const parsedIso = Date.parse(text);
  if (!Number.isNaN(parsedIso)) {
    return parsedIso;
  }

  const clockMatch = text.match(/^(\d{1,2}|\d{2,3}):(\d{2})(?::(\d{2}))?$/);
  if (clockMatch) {
    const hour = Number(clockMatch[1]);
    const minute = Number(clockMatch[2]);
    const second = Number(clockMatch[3] || 0);
    const serviceDate = context.serviceDate instanceof Date ? context.serviceDate : new Date(context.nowEpochMs);
    const midnight = new Date(serviceDate);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime() + ((hour * 60 + minute) * 60 + second) * 1000;
  }

  return null;
}

function dedupeTimestampEpochMs(arrival) {
  if (arrival.predictedEpochMs !== null) {
    return arrival.predictedEpochMs;
  }
  if (arrival.scheduledEpochMs !== null) {
    return arrival.scheduledEpochMs;
  }
  if (typeof arrival.etaMinutes === 'number') {
    return arrival.asOfEpochMs + arrival.etaMinutes * 60 * 1000;
  }
  return null;
}

function buildDedupKey(arrival, bucketMs) {
  const destinationToken = arrival.destinationTargetId || arrival.destinationName || '';
  const refEpochMs = dedupeTimestampEpochMs(arrival);
  const bucket = refEpochMs !== null ? Math.floor(refEpochMs / bucketMs) : 'na';
  return [
    arrival.stopId,
    arrival.lineId,
    destinationToken,
    arrival.predictionType,
    bucket
  ].join('|');
}

function choosePreferredArrival(current, candidate) {
  const sourceDiff = sourceRank(candidate.source) - sourceRank(current.source);
  if (sourceDiff !== 0) {
    return sourceDiff > 0 ? candidate : current;
  }

  const predictionDiff = predictionRank(candidate.predictionType) - predictionRank(current.predictionType);
  if (predictionDiff !== 0) {
    return predictionDiff > 0 ? candidate : current;
  }

  const currentConfidence = typeof current.confidence === 'number' ? current.confidence : 0;
  const candidateConfidence = typeof candidate.confidence === 'number' ? candidate.confidence : 0;
  if (candidateConfidence !== currentConfidence) {
    return candidateConfidence > currentConfidence ? candidate : current;
  }

  if (candidate.asOfEpochMs !== current.asOfEpochMs) {
    return candidate.asOfEpochMs > current.asOfEpochMs ? candidate : current;
  }

  return current;
}

function normalizePredictionTypeFromInput(raw, defaults, predictedEpochMs, scheduledEpochMs) {
  const explicitType =
    toTextOrNull(pickFirstNonEmpty(raw, PREDICTION_TYPE_FIELDS)) || toTextOrNull(defaults.predictionType);
  if (explicitType) {
    return normalizePredictionType(explicitType, PREDICTION_TYPES.INFERRED);
  }

  if (typeof raw.isRealtime === 'boolean') {
    return raw.isRealtime ? PREDICTION_TYPES.REALTIME : PREDICTION_TYPES.SCHEDULED;
  }
  if (typeof defaults.isRealtime === 'boolean') {
    return defaults.isRealtime ? PREDICTION_TYPES.REALTIME : PREDICTION_TYPES.SCHEDULED;
  }
  if (predictedEpochMs !== null) {
    return PREDICTION_TYPES.REALTIME;
  }
  if (scheduledEpochMs !== null) {
    return PREDICTION_TYPES.SCHEDULED;
  }
  return PREDICTION_TYPES.INFERRED;
}

function createArrivalNormalizer(options = {}) {
  const logger = options.logger || createNoopLogger();
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const dedupeWindowMs =
    typeof options.dedupeWindowMs === 'number' && options.dedupeWindowMs > 0 ? options.dedupeWindowMs : 60000;
  const pastToleranceMinutes =
    typeof options.pastToleranceMinutes === 'number' && options.pastToleranceMinutes >= 0
      ? options.pastToleranceMinutes
      : 2;
  const farFutureMinutes =
    typeof options.farFutureMinutes === 'number' && options.farFutureMinutes > 0 ? options.farFutureMinutes : 360;
  const normalizeStopIdHook = typeof options.normalizeStopId === 'function' ? options.normalizeStopId : null;
  const normalizeLineIdHook = typeof options.normalizeLineId === 'function' ? options.normalizeLineId : null;
  const resolveDestinationHook = typeof options.resolveDestination === 'function' ? options.resolveDestination : null;

  function normalizeStopId(raw, context) {
    const fromRaw = pickFirstNonEmpty(raw, STOP_ID_FIELDS);
    const fallback = context.stopId !== undefined ? context.stopId : context.defaults.stopId;
    const candidate = fromRaw !== null ? fromRaw : fallback;
    const canonical = canonicalizeId(candidate);
    if (!canonical) {
      return null;
    }
    return normalizeStopIdHook ? normalizeStopIdHook(canonical, raw, context) : canonical;
  }

  function normalizeLineId(raw, context) {
    const fromRaw = pickFirstNonEmpty(raw, LINE_ID_FIELDS);
    const fallback = context.lineId !== undefined ? context.lineId : context.defaults.lineId;
    const candidate = fromRaw !== null ? fromRaw : fallback;
    const canonical = canonicalizeId(candidate);
    if (!canonical) {
      return null;
    }
    return normalizeLineIdHook ? normalizeLineIdHook(canonical, raw, context) : canonical;
  }

  function normalizeDestination(raw, context) {
    const inputId =
      pickFirstNonEmpty(raw, DESTINATION_ID_FIELDS) ??
      context.defaults.destinationTargetId ??
      context.destinationTargetId ??
      null;
    const inputName =
      pickFirstNonEmpty(raw, DESTINATION_NAME_FIELDS) ??
      context.defaults.destinationName ??
      context.destinationName ??
      '';

    if (resolveDestinationHook) {
      try {
        const resolved = resolveDestinationHook(
          {
            id: inputId,
            name: inputName
          },
          raw,
          context
        );
        if (resolved && typeof resolved === 'object') {
          return {
            destinationTargetId: resolved.destinationTargetId ? canonicalizeId(resolved.destinationTargetId) : null,
            destinationName: toTextOrNull(resolved.destinationName || resolved.name || inputName) || ''
          };
        }
      } catch (error) {
        logger.warn('arrivalNormalizer.resolveDestination hook failed', error);
      }
    }

    return {
      destinationTargetId: inputId ? canonicalizeId(inputId) : null,
      destinationName: toTextOrNull(inputName) || ''
    };
  }

  function normalizeTimestamps(raw, context) {
    const nowEpochMs = context.nowEpochMs;
    const predictedInput = pickFirstNonEmpty(raw, PREDICTED_TIME_FIELDS);
    const scheduledInput = pickFirstNonEmpty(raw, SCHEDULED_TIME_FIELDS);
    const asOfInput = pickFirstNonEmpty(raw, AS_OF_TIME_FIELDS);

    const predictedEpochMs =
      toTimeValue(predictedInput, context) ??
      toTimeValue(context.defaults.predictedEpochMs, context);
    const scheduledEpochMs =
      toTimeValue(scheduledInput, context) ??
      toTimeValue(context.defaults.scheduledEpochMs, context);
    const asOfEpochMs =
      toTimeValue(asOfInput, context) ??
      toTimeValue(context.defaults.asOfEpochMs, context) ??
      nowEpochMs;

    return {
      predictedEpochMs,
      scheduledEpochMs,
      asOfEpochMs
    };
  }

  function normalizeEtaMinutes(raw, timestamps, context, warnings) {
    const rawEta = pickFirstNonEmpty(raw, ETA_FIELDS);
    let etaMinutes = toNumberOrNull(rawEta);
    if (etaMinutes === null && context.defaults.etaMinutes !== undefined) {
      etaMinutes = toNumberOrNull(context.defaults.etaMinutes);
    }

    if (etaMinutes === null) {
      const targetEpochMs = timestamps.predictedEpochMs !== null ? timestamps.predictedEpochMs : timestamps.scheduledEpochMs;
      if (targetEpochMs !== null) {
        etaMinutes = Math.round((targetEpochMs - timestamps.asOfEpochMs) / 60000);
      }
    }

    if (etaMinutes === null) {
      return null;
    }

    if (etaMinutes < -pastToleranceMinutes) {
      warnings.push(`arrival appears stale (${etaMinutes} min)`);
      return null;
    }

    if (etaMinutes > farFutureMinutes) {
      warnings.push(`arrival far in future (${etaMinutes} min)`);
    }

    return Math.max(0, Math.round(etaMinutes));
  }

  function normalizeSingle(rawEntry, contextOverrides = {}) {
    const raw = rawEntry && typeof rawEntry === 'object' ? rawEntry : {};
    const defaults = contextOverrides.defaults && typeof contextOverrides.defaults === 'object'
      ? contextOverrides.defaults
      : {};
    const context = {
      ...contextOverrides,
      defaults,
      nowEpochMs: now(),
      serviceDate: contextOverrides.serviceDate instanceof Date ? contextOverrides.serviceDate : new Date(now())
    };
    const warnings = [];

    const source = normalizeSource(raw.source ?? defaults.source ?? context.source ?? SOURCE_TYPES.FALLBACK);
    const sourceName = toTextOrNull(raw.sourceName ?? defaults.sourceName ?? context.sourceName ?? '') || '';
    const stopId = normalizeStopId(raw, context);
    const lineId = normalizeLineId(raw, context);

    if (!stopId || !lineId) {
      const error = createProviderError({
        code: 'INVALID_PAYLOAD',
        message: 'Arrival record missing stopId or lineId',
        retriable: false,
        source,
        sourceName,
        details: {
          stopId,
          lineId,
          rawKeys: Object.keys(raw)
        }
      });
      return {
        arrival: null,
        error,
        warnings
      };
    }

    const destination = normalizeDestination(raw, context);
    const timestamps = normalizeTimestamps(raw, context);
    const predictionType = normalizePredictionTypeFromInput(
      raw,
      defaults,
      timestamps.predictedEpochMs,
      timestamps.scheduledEpochMs
    );
    const etaMinutes = normalizeEtaMinutes(raw, timestamps, context, warnings);

    if (etaMinutes === null && timestamps.predictedEpochMs === null && timestamps.scheduledEpochMs === null) {
      const error = createProviderError({
        code: 'INVALID_PAYLOAD',
        message: 'Arrival record missing both ETA and timestamps',
        retriable: false,
        source,
        sourceName,
        details: {
          stopId,
          lineId,
          rawKeys: Object.keys(raw)
        }
      });
      return {
        arrival: null,
        error,
        warnings
      };
    }

    if (timestamps.predictedEpochMs !== null && timestamps.scheduledEpochMs !== null) {
      const driftMinutes = Math.round((timestamps.predictedEpochMs - timestamps.scheduledEpochMs) / 60000);
      if (Math.abs(driftMinutes) > 60) {
        warnings.push(`large realtime/scheduled drift detected (${driftMinutes} min)`);
      }
    }

    const normalizedArrival = normalizeArrivalShape(
      {
        ...raw,
        stopId,
        lineId,
        destinationTargetId: destination.destinationTargetId,
        destinationName: destination.destinationName,
        predictionType,
        etaMinutes,
        predictedEpochMs: timestamps.predictedEpochMs,
        scheduledEpochMs: timestamps.scheduledEpochMs,
        asOfEpochMs: timestamps.asOfEpochMs,
        source,
        sourceName
      },
      defaults
    );

    if (!normalizedArrival) {
      const error = createProviderError({
        code: 'INVALID_PAYLOAD',
        message: 'Arrival record rejected by shape normalizer',
        retriable: false,
        source,
        sourceName
      });
      return {
        arrival: null,
        error,
        warnings
      };
    }

    return {
      arrival: normalizedArrival,
      error: null,
      warnings
    };
  }

  function dedupeArrivals(arrivals, context = {}) {
    const map = new Map();
    const duplicateEvents = [];
    const bucketMs =
      typeof context.dedupeWindowMs === 'number' && context.dedupeWindowMs > 0
        ? context.dedupeWindowMs
        : dedupeWindowMs;

    arrivals.forEach((arrival) => {
      if (!arrival || !arrival.stopId || !arrival.lineId) {
        return;
      }

      const key = buildDedupKey(arrival, bucketMs);
      if (!map.has(key)) {
        map.set(key, arrival);
        return;
      }

      const current = map.get(key);
      const selected = choosePreferredArrival(current, arrival);
      const rejected = selected === current ? arrival : current;
      map.set(key, selected);
      duplicateEvents.push({
        key,
        keptId: selected.id,
        droppedId: rejected.id,
        keptSource: selected.source,
        droppedSource: rejected.source
      });
    });

    if (duplicateEvents.length) {
      logger.debug(`arrivalNormalizer deduplicated ${duplicateEvents.length} arrivals`);
    }

    return {
      arrivals: Array.from(map.values()),
      duplicates: duplicateEvents
    };
  }

  function normalizeBatch(rawEntries, contextOverrides = {}) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    const normalizedArrivals = [];
    const errors = [];
    const warnings = [];

    entries.forEach((rawEntry, index) => {
      const result = normalizeSingle(rawEntry, contextOverrides);
      if (result.error) {
        errors.push({
          index,
          error: result.error
        });
        logger.warn(`arrivalNormalizer dropped record at index ${index}: ${result.error.message}`);
      }
      if (Array.isArray(result.warnings) && result.warnings.length) {
        warnings.push({
          index,
          warnings: result.warnings
        });
      }
      if (result.arrival) {
        normalizedArrivals.push(result.arrival);
      }
    });

    const dedupeResult = dedupeArrivals(normalizedArrivals, contextOverrides);
    return {
      arrivals: dedupeResult.arrivals,
      duplicates: dedupeResult.duplicates,
      warnings,
      errors,
      droppedCount: errors.length,
      inputCount: entries.length
    };
  }

  return {
    normalizeSingle,
    normalizeBatch,
    dedupeArrivals
  };
}

module.exports = {
  createArrivalNormalizer
};
