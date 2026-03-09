'use strict';

const { scheduleMinutesFromHeadway, sortByEta } = require('../../../resolvers/transportDataResolver');
const { createArrivalNormalizer } = require('../domain/arrivalNormalizer');
const { filterRecordsByReliability } = require('../domain/reliabilityScoring');
const {
  SOURCE_TYPES,
  PREDICTION_TYPES,
  normalizeSource,
  normalizePredictionType,
  clampConfidence
} = require('../domain/providerShapes');
const {
  RESILIENCE_DEFAULTS,
  createSimpleCircuitBreaker,
  executeWithResilience
} = require('./resilienceHelpers');

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

const RELIABILITY_BANDS = Object.freeze({
  DIRECT: 'direct',
  DISCLAIMER: 'disclaimer',
  DISCARD: 'discard'
});

function normalizeFreshness(value) {
  const bucket = value && typeof value.bucket === 'string' ? value.bucket : 'unknown';
  const ageSec =
    value && typeof value.ageSec === 'number' && Number.isFinite(value.ageSec)
      ? value.ageSec
      : null;
  const freshnessScore =
    value && typeof value.freshnessScore === 'number' && Number.isFinite(value.freshnessScore)
      ? Math.max(0, Math.min(1, value.freshnessScore))
      : 0.5;

  return {
    ageSec,
    freshnessScore,
    bucket
  };
}

function normalizeReliabilityBand(value) {
  if (value === RELIABILITY_BANDS.DIRECT) {
    return RELIABILITY_BANDS.DIRECT;
  }
  if (value === RELIABILITY_BANDS.DISCARD) {
    return RELIABILITY_BANDS.DISCARD;
  }
  if (value === RELIABILITY_BANDS.DISCLAIMER) {
    return RELIABILITY_BANDS.DISCLAIMER;
  }
  return RELIABILITY_BANDS.DISCLAIMER;
}

function safeSourceName(value, fallbackValue) {
  if (typeof value !== 'string') {
    return fallbackValue;
  }
  const normalized = value.trim();
  return normalized || fallbackValue;
}

function createArrivalsDataSource(dependencies = {}) {
  const normalizer = dependencies.normalizer;
  const cacheAdapter = dependencies.cacheAdapter || createNoopCacheAdapter();
  const apiClient = dependencies.apiClient || {};
  const retryAdapter = dependencies.retryAdapter || null;
  const linesDataSource = dependencies.linesDataSource;
  const providerName = dependencies.providerName || 'amtab-provider';
  const providerSource = normalizeSource(dependencies.defaultSource, SOURCE_TYPES.FALLBACK);
  const providerSourceName =
    typeof dependencies.defaultSourceName === 'string' ? dependencies.defaultSourceName : providerName;
  const derivedSourceName = `${providerSourceName}:derived`;
  const logger = dependencies.logger || console;
  const now = typeof dependencies.now === 'function' ? dependencies.now : () => Date.now();
  const resiliencePolicy = dependencies.resiliencePolicy || {};
  const reliabilityPolicy = dependencies.reliabilityPolicy || {};
  const defaultLimit = typeof dependencies.defaultLimit === 'number' && dependencies.defaultLimit > 0
    ? Math.floor(dependencies.defaultLimit)
    : 3;
  const realtimeTtlMs = typeof dependencies.realtimeTtlMs === 'number' ? dependencies.realtimeTtlMs : 15000;
  const scheduledTtlMs = typeof dependencies.scheduledTtlMs === 'number' ? dependencies.scheduledTtlMs : 45000;
  const stopArrivalsTtlMs = typeof dependencies.stopArrivalsTtlMs === 'number' ? dependencies.stopArrivalsTtlMs : 10000;
  const arrivalNormalizer =
    dependencies.arrivalNormalizer ||
    createArrivalNormalizer({
      now,
      logger
    });
  const timeoutsMs = {
    realtime:
      resiliencePolicy.timeoutsMs && typeof resiliencePolicy.timeoutsMs.realtime === 'number'
        ? resiliencePolicy.timeoutsMs.realtime
        : RESILIENCE_DEFAULTS.timeoutsMs.realtime,
    scheduled:
      resiliencePolicy.timeoutsMs && typeof resiliencePolicy.timeoutsMs.scheduled === 'number'
        ? resiliencePolicy.timeoutsMs.scheduled
        : RESILIENCE_DEFAULTS.timeoutsMs.scheduled,
    staticLookup:
      resiliencePolicy.timeoutsMs && typeof resiliencePolicy.timeoutsMs.staticLookup === 'number'
        ? resiliencePolicy.timeoutsMs.staticLookup
        : RESILIENCE_DEFAULTS.timeoutsMs.staticLookup
  };
  const circuitBreakerOptions = {
    realtime: (resiliencePolicy.circuitBreaker && resiliencePolicy.circuitBreaker.realtime) || RESILIENCE_DEFAULTS.circuitBreaker.realtime,
    scheduled: (resiliencePolicy.circuitBreaker && resiliencePolicy.circuitBreaker.scheduled) || RESILIENCE_DEFAULTS.circuitBreaker.scheduled,
    staticLookup: (resiliencePolicy.circuitBreaker && resiliencePolicy.circuitBreaker.staticLookup) || RESILIENCE_DEFAULTS.circuitBreaker.staticLookup
  };
  const circuitBreakers = dependencies.circuitBreakers || {
    realtime: createSimpleCircuitBreaker(circuitBreakerOptions.realtime),
    scheduled: createSimpleCircuitBreaker(circuitBreakerOptions.scheduled),
    staticLookup: createSimpleCircuitBreaker(circuitBreakerOptions.staticLookup)
  };

  function resolveCategory(methodName) {
    const normalizedMethodName = String(methodName || '').toLowerCase();
    if (normalizedMethodName.includes('realtime')) {
      return 'realtime';
    }
    if (normalizedMethodName.includes('scheduled')) {
      return 'scheduled';
    }
    return 'staticLookup';
  }

  function ensureArrivalMetadata(arrival, overrides = {}) {
    const rawPredictionType =
      overrides.predictionType !== undefined ? overrides.predictionType : arrival.predictionType;
    const predictionType = normalizePredictionType(rawPredictionType, PREDICTION_TYPES.INFERRED);

    const rawSource = overrides.source !== undefined ? overrides.source : arrival.source;
    let source = normalizeSource(rawSource, SOURCE_TYPES.FALLBACK);
    if (predictionType === PREDICTION_TYPES.INFERRED && source === SOURCE_TYPES.OFFICIAL) {
      source = SOURCE_TYPES.PUBLIC;
    }

    const sourceName = safeSourceName(
      overrides.sourceName !== undefined ? overrides.sourceName : arrival.sourceName,
      predictionType === PREDICTION_TYPES.INFERRED ? derivedSourceName : providerSourceName
    );
    const confidence = clampConfidence(
      overrides.confidence !== undefined ? overrides.confidence : arrival.confidence,
      0.55
    );
    const freshness = normalizeFreshness(
      overrides.freshness !== undefined ? overrides.freshness : arrival.freshness
    );
    const reliabilityBand = normalizeReliabilityBand(
      overrides.reliabilityBand !== undefined ? overrides.reliabilityBand : arrival.reliabilityBand
    );

    return {
      ...arrival,
      source,
      sourceName,
      predictionType,
      confidence,
      freshness,
      reliabilityBand
    };
  }

  function toFallbackScheduledProvenance(arrival) {
    return ensureArrivalMetadata(arrival, {
      source: SOURCE_TYPES.FALLBACK,
      sourceName: `${safeSourceName(arrival.sourceName, providerSourceName)}:scheduled_fallback`,
      predictionType: PREDICTION_TYPES.SCHEDULED,
      confidence: Math.min(clampConfidence(arrival.confidence, 0.7), 0.74),
      reliabilityBand: RELIABILITY_BANDS.DISCLAIMER
    });
  }

  function toArrivalDefaults(stopId, lineId, overrides = {}) {
    const line = lineId && linesDataSource && typeof linesDataSource.getLineById === 'function'
      ? linesDataSource.getLineById(lineId)
      : null;

    return {
      stopId: stopId || '',
      lineId: lineId || '',
      destinationTargetId:
        overrides.destinationTargetId || (line && line.destinationTargetId ? line.destinationTargetId : null),
      destinationName:
        overrides.destinationName || (line && line.destinationName ? line.destinationName : 'destinazione sconosciuta'),
      source: normalizeSource(
        overrides.source,
        overrides.predictionType === PREDICTION_TYPES.INFERRED ? SOURCE_TYPES.PUBLIC : providerSource
      ),
      sourceName: safeSourceName(
        overrides.sourceName,
        overrides.predictionType === PREDICTION_TYPES.INFERRED ? derivedSourceName : providerSourceName
      ),
      predictionType: normalizePredictionType(overrides.predictionType, PREDICTION_TYPES.INFERRED),
      confidence: overrides.confidence,
      isRealtime: Boolean(overrides.isRealtime),
      predictedEpochMs: overrides.predictedEpochMs,
      scheduledEpochMs: overrides.scheduledEpochMs
    };
  }

  function scoreAndFilterArrivals(arrivals) {
    if (!Array.isArray(arrivals) || !arrivals.length) {
      return [];
    }

    const scored = filterRecordsByReliability(arrivals, {
      recordType: 'arrival',
      nowEpochMs: now(),
      thresholds:
        reliabilityPolicy && reliabilityPolicy.thresholds
          ? reliabilityPolicy.thresholds
          : undefined
    });

    if (scored.discarded.length) {
      logger.warn(`AMTAB reliability scoring discarded ${scored.discarded.length} low-confidence arrivals`);
    }

    return scored.direct.concat(scored.disclaimer).map((entry) => {
      const hydrated = ensureArrivalMetadata(entry.record, {
        source: entry.reliability.source || entry.record.source,
        predictionType: entry.reliability.predictionType || entry.record.predictionType,
        confidence: entry.reliability.confidence,
        freshness: entry.reliability.freshness,
        reliabilityBand: entry.reliability.reliabilityBand
      });

      return {
        ...hydrated,
        scoreBreakdown: entry.reliability.scoreBreakdown,
        coherenceReasons: entry.reliability.coherenceReasons
      };
    });
  }

  function normalizeArrivalList(rawArrivals, defaults, context = {}) {
    if (!Array.isArray(rawArrivals)) {
      return [];
    }

    const batchResult = arrivalNormalizer.normalizeBatch(rawArrivals, {
      defaults,
      ...context
    });

    if (batchResult.errors.length) {
      logger.warn(
        `AMTAB arrival normalization dropped ${batchResult.errors.length}/${batchResult.inputCount} records`
      );
    }
    if (batchResult.warnings.length && logger.debug) {
      logger.debug(`AMTAB arrival normalization warnings: ${batchResult.warnings.length}`);
    }

    return scoreAndFilterArrivals(batchResult.arrivals);
  }

  async function safeRemoteArrivals(methodName, args, defaults, context = {}) {
    const method = apiClient && apiClient[methodName];
    if (typeof method !== 'function') {
      return [];
    }

    try {
      const category = resolveCategory(methodName);
      const result = await executeWithResilience({
        operationName: `amtab.arrivalsDataSource.${methodName}`,
        category,
        timeoutMs: timeoutsMs[category],
        retryAdapter,
        circuitBreaker: circuitBreakers[category],
        logger,
        executeFn: () => method(...args)
      });
      return normalizeArrivalList(result, defaults, context);
    } catch (error) {
      logger.error(`AMTAB arrivalsDataSource remote call failed: ${methodName}`, error);
      return [];
    }
  }

  function buildHeadwayScheduledArrivals(stopId, line) {
    if (
      !line ||
      typeof line.firstMinute !== 'number' ||
      typeof line.lastMinute !== 'number' ||
      typeof line.headwayMinutes !== 'number' ||
      line.headwayMinutes <= 0
    ) {
      return [];
    }

    const etaMinutesList = scheduleMinutesFromHeadway({
      firstMinute: line.firstMinute,
      lastMinute: line.lastMinute,
      headwayMinutes: line.headwayMinutes,
      referenceDate: new Date(now()),
      limit: defaultLimit
    });

    const referenceEpochMs = now();
    return scoreAndFilterArrivals(
      etaMinutesList.map((etaMinutes) =>
        normalizer.normalizeArrival(
          {
            stopId,
            lineId: line.id,
            destinationTargetId: line.destinationTargetId,
            destinationName: line.destinationName,
            etaMinutes,
            scheduledEpochMs: referenceEpochMs + etaMinutes * 60 * 1000,
            predictedEpochMs: null,
            asOfEpochMs: referenceEpochMs,
            source: SOURCE_TYPES.FALLBACK,
            sourceName: `${providerSourceName}:headway_inferred`,
            predictionType: PREDICTION_TYPES.INFERRED,
            isRealtime: false,
            confidence: 0.55
          },
          toArrivalDefaults(stopId, line.id, {
            isRealtime: false,
            source: SOURCE_TYPES.FALLBACK,
            sourceName: `${providerSourceName}:headway_inferred`,
            predictionType: PREDICTION_TYPES.INFERRED
          })
        )
      ).filter(Boolean)
    );
  }

  async function getRealtimePredictions(stopId, lineId) {
    if (!stopId || !lineId) {
      return [];
    }

    const cacheKey = `amtab:arrivals:realtime:${stopId}:${lineId}`;
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const defaults = toArrivalDefaults(stopId, lineId, {
          isRealtime: true,
          source: providerSource,
          sourceName: providerSourceName,
          predictionType: PREDICTION_TYPES.REALTIME
        });
        const remoteArrivals = await safeRemoteArrivals(
          'getRealtimePredictions',
          [stopId, lineId],
          defaults,
          {
            predictionType: PREDICTION_TYPES.REALTIME
          }
        );
        return sortByEta(remoteArrivals);
      },
      realtimeTtlMs
    );
  }

  async function getScheduledArrivals(stopId, lineId) {
    if (!stopId || !lineId) {
      return [];
    }

    const cacheKey = `amtab:arrivals:scheduled:${stopId}:${lineId}`;
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const defaults = toArrivalDefaults(stopId, lineId, {
          isRealtime: false,
          source: providerSource,
          sourceName: providerSourceName,
          predictionType: PREDICTION_TYPES.SCHEDULED,
          predictedEpochMs: null
        });
        const remoteArrivals = await safeRemoteArrivals(
          'getScheduledArrivals',
          [stopId, lineId],
          defaults,
          {
            predictionType: PREDICTION_TYPES.SCHEDULED
          }
        );
        if (remoteArrivals.length) {
          return sortByEta(remoteArrivals);
        }

        const line =
          linesDataSource && typeof linesDataSource.getLineById === 'function'
            ? linesDataSource.getLineById(lineId)
            : null;
        return sortByEta(buildHeadwayScheduledArrivals(stopId, line));
      },
      scheduledTtlMs
    );
  }

  async function getStopArrivals(stopId) {
    if (!stopId) {
      return [];
    }

    const cacheKey = `amtab:arrivals:stop:${stopId}`;
    return cacheAdapter.getOrSet(
      cacheKey,
      async () => {
        const remoteArrivals = await safeRemoteArrivals(
          'getStopArrivals',
          [stopId],
          toArrivalDefaults(stopId, '', {
            source: providerSource,
            sourceName: providerSourceName
          })
        );
        if (remoteArrivals.length) {
          return sortByEta(remoteArrivals);
        }

        const lines =
          linesDataSource && typeof linesDataSource.getLinesServingStop === 'function'
            ? await linesDataSource.getLinesServingStop(stopId)
            : [];

        const groupedArrivals = await Promise.all(
          lines.map(async (line) => {
            const realtime = await getRealtimePredictions(stopId, line.id);
            if (realtime.length) {
              return realtime;
            }
            const scheduled = await getScheduledArrivals(stopId, line.id);
            return scheduled.map(toFallbackScheduledProvenance);
          })
        );

        const dedupeResult = arrivalNormalizer.dedupeArrivals(groupedArrivals.flat());
        return sortByEta(dedupeResult.arrivals.map((arrival) => ensureArrivalMetadata(arrival)));
      },
      stopArrivalsTtlMs
    );
  }

  return {
    getStopArrivals,
    getRealtimePredictions,
    getScheduledArrivals
  };
}

module.exports = {
  createArrivalsDataSource
};
