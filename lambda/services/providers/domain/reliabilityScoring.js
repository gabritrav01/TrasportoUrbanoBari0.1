'use strict';

const {
  SOURCE_TYPES,
  PREDICTION_TYPES,
  normalizeSource,
  normalizePredictionType,
  clampConfidence
} = require('./providerShapes');
const {
  RELIABILITY_BANDS,
  DEFAULT_THRESHOLDS,
  normalizeReliabilityBand,
  normalizeFreshness,
  resolveThresholds,
  classifyBandByConfidence,
  applyReliabilityPolicy
} = require('./qualityScoring');

const RELIABILITY_WEIGHTS = Object.freeze({
  source: 0.35,
  freshness: 0.3,
  completeness: 0.2,
  coherence: 0.15
});

const SOURCE_SCORE = Object.freeze({
  [SOURCE_TYPES.OFFICIAL]: 1.0,
  [SOURCE_TYPES.PUBLIC]: 0.78,
  [SOURCE_TYPES.FALLBACK]: 0.55
});

const THRESHOLDS = Object.freeze({
  DIRECT: DEFAULT_THRESHOLDS.direct,
  CAUTION: DEFAULT_THRESHOLDS.caution,
  DEGRADED: DEFAULT_THRESHOLDS.degraded
});

const FRESHNESS_PROFILES = Object.freeze({
  stop: { freshWithinSec: 12 * 60 * 60, maxAgeSec: 48 * 60 * 60 },
  line: { freshWithinSec: 12 * 60 * 60, maxAgeSec: 48 * 60 * 60 },
  destination: { freshWithinSec: 24 * 60 * 60, maxAgeSec: 72 * 60 * 60 },
  routeOption: { freshWithinSec: 5 * 60, maxAgeSec: 60 * 60 },
  arrival: {
    [PREDICTION_TYPES.REALTIME]: { freshWithinSec: 20, maxAgeSec: 180 },
    [PREDICTION_TYPES.SCHEDULED]: { freshWithinSec: 120, maxAgeSec: 1800 },
    [PREDICTION_TYPES.INFERRED]: { freshWithinSec: 60, maxAgeSec: 900 }
  }
});

function clamp01(value) {
  return clampConfidence(value, 0);
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

function toPredictionType(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizePredictionType(value, PREDICTION_TYPES.INFERRED);
}

function scoreFromLinearDecay(ageSec, profile) {
  if (!profile) {
    return 0.5;
  }
  if (ageSec <= profile.freshWithinSec) {
    return 1;
  }
  if (ageSec >= profile.maxAgeSec) {
    return 0;
  }
  const span = profile.maxAgeSec - profile.freshWithinSec;
  if (span <= 0) {
    return 0;
  }
  const elapsed = ageSec - profile.freshWithinSec;
  return clamp01(1 - elapsed / span);
}

function resolveFreshnessProfile(recordType, predictionType) {
  if (recordType === 'arrival') {
    const normalizedType = toPredictionType(predictionType) || PREDICTION_TYPES.INFERRED;
    return FRESHNESS_PROFILES.arrival[normalizedType];
  }
  return FRESHNESS_PROFILES[recordType] || FRESHNESS_PROFILES.routeOption;
}

function computeAgeSec(record, nowEpochMs) {
  const referenceCandidates = [
    record && record.asOfEpochMs,
    record && record.fetchedAtEpochMs,
    record && record.updatedAtEpochMs,
    record && record.timestampEpochMs
  ];
  let referenceEpochMs = null;
  for (const candidate of referenceCandidates) {
    const parsed = toNumberOrNull(candidate);
    if (parsed !== null) {
      referenceEpochMs = parsed;
      break;
    }
  }

  if (referenceEpochMs === null) {
    return null;
  }

  return Math.max(0, Math.round((nowEpochMs - referenceEpochMs) / 1000));
}

function scoreSource(record) {
  const source = normalizeSource(record && record.source ? record.source : SOURCE_TYPES.FALLBACK);
  return {
    source,
    sourceScore: SOURCE_SCORE[source] || SOURCE_SCORE[SOURCE_TYPES.FALLBACK]
  };
}

function scoreFreshness(record, options = {}) {
  const nowEpochMs = typeof options.nowEpochMs === 'number' ? options.nowEpochMs : Date.now();
  const recordType = options.recordType || 'arrival';
  const predictionType = toPredictionType(record && record.predictionType);
  const ageSec = computeAgeSec(record, nowEpochMs);
  const profile = resolveFreshnessProfile(recordType, predictionType);

  if (ageSec === null) {
    return {
      freshness: {
        ageSec: null,
        freshnessScore: 0.5,
        bucket: 'unknown'
      }
    };
  }

  const freshnessScore = scoreFromLinearDecay(ageSec, profile);
  let bucket = 'stale';
  if (freshnessScore >= 0.85) {
    bucket = 'fresh';
  } else if (freshnessScore >= 0.5) {
    bucket = 'aging';
  }

  return {
    freshness: {
      ageSec,
      freshnessScore,
      bucket
    }
  };
}

function getRequiredFields(recordType) {
  if (recordType === 'stop') {
    return ['id', 'name'];
  }
  if (recordType === 'line') {
    return ['id', 'code'];
  }
  if (recordType === 'destination') {
    return ['id', 'name'];
  }
  if (recordType === 'routeOption') {
    return ['originStopId', 'destinationTargetId', 'lineIds'];
  }
  return ['stopId', 'lineId'];
}

function getWeightedOptionalFields(recordType) {
  if (recordType === 'arrival') {
    return [
      { field: 'destinationName', weight: 0.2 },
      { field: 'etaMinutes', weight: 0.25 },
      { field: 'scheduledEpochMs', weight: 0.2 },
      { field: 'predictedEpochMs', weight: 0.2 },
      { field: 'asOfEpochMs', weight: 0.15 }
    ];
  }
  if (recordType === 'stop') {
    return [
      { field: 'coordinates', weight: 0.5 },
      { field: 'lineIds', weight: 0.25 },
      { field: 'aliases', weight: 0.25 }
    ];
  }
  if (recordType === 'line') {
    return [
      { field: 'destinationName', weight: 0.35 },
      { field: 'destinationTargetId', weight: 0.25 },
      { field: 'stopIds', weight: 0.4 }
    ];
  }
  if (recordType === 'destination') {
    return [
      { field: 'targetStopIds', weight: 0.6 },
      { field: 'aliases', weight: 0.4 }
    ];
  }
  return [
    { field: 'estimatedMinutes', weight: 0.5 },
    { field: 'transfers', weight: 0.5 }
  ];
}

function hasMeaningfulValue(record, field) {
  if (!record || !field) {
    return false;
  }
  const value = record[field];
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

function scoreCompleteness(record, options = {}) {
  const recordType = options.recordType || 'arrival';
  const requiredFields = getRequiredFields(recordType);
  const optionalFields = getWeightedOptionalFields(recordType);

  const requiredCount = requiredFields.length;
  const requiredPresent = requiredFields.filter((field) => hasMeaningfulValue(record, field)).length;
  const requiredRatio = requiredCount > 0 ? requiredPresent / requiredCount : 1;

  const optionalWeightSum = optionalFields.reduce((sum, item) => sum + item.weight, 0);
  const optionalWeightPresent = optionalFields.reduce((sum, item) => {
    return sum + (hasMeaningfulValue(record, item.field) ? item.weight : 0);
  }, 0);
  const optionalRatio = optionalWeightSum > 0 ? optionalWeightPresent / optionalWeightSum : 1;

  const completenessScore = clamp01(requiredRatio * 0.7 + optionalRatio * 0.3);

  return {
    completeness: {
      requiredRatio,
      optionalRatio,
      completenessScore
    }
  };
}

function scoreCoherence(record, options = {}) {
  const recordType = options.recordType || 'arrival';
  if (recordType !== 'arrival') {
    return {
      coherence: {
        coherenceScore: 0.85,
        reasons: []
      }
    };
  }

  const reasons = [];
  let score = 1;

  const etaMinutes = toNumberOrNull(record && record.etaMinutes);
  const scheduledEpochMs = toNumberOrNull(record && record.scheduledEpochMs);
  const predictedEpochMs = toNumberOrNull(record && record.predictedEpochMs);
  const asOfEpochMs = toNumberOrNull(record && record.asOfEpochMs) || Date.now();
  const predictionType = toPredictionType(record && record.predictionType);

  if (etaMinutes !== null && etaMinutes < 0) {
    score -= 0.45;
    reasons.push('negative_eta');
  }

  if (predictionType === PREDICTION_TYPES.REALTIME && predictedEpochMs === null) {
    score -= 0.35;
    reasons.push('realtime_without_predicted_timestamp');
  }

  if (predictionType === PREDICTION_TYPES.SCHEDULED && scheduledEpochMs === null) {
    score -= 0.3;
    reasons.push('scheduled_without_scheduled_timestamp');
  }

  if (etaMinutes !== null) {
    const referenceEpochMs = predictedEpochMs !== null ? predictedEpochMs : scheduledEpochMs;
    if (referenceEpochMs !== null) {
      const derivedEta = Math.round((referenceEpochMs - asOfEpochMs) / 60000);
      const drift = Math.abs(derivedEta - etaMinutes);
      if (drift > 5) {
        score -= 0.25;
        reasons.push(`eta_drift_${drift}m`);
      }
    }
  }

  if (predictedEpochMs !== null && scheduledEpochMs !== null) {
    const realtimeDriftMinutes = Math.abs(Math.round((predictedEpochMs - scheduledEpochMs) / 60000));
    if (realtimeDriftMinutes > 45) {
      score -= 0.2;
      reasons.push(`realtime_scheduled_drift_${realtimeDriftMinutes}m`);
    }
  }

  const contradictionCount = Number(options.contradictionCount || 0);
  if (contradictionCount > 0) {
    const penalty = Math.min(0.3, contradictionCount * 0.1);
    score -= penalty;
    reasons.push(`cross_source_contradictions_${contradictionCount}`);
  }

  const consensusCount = Number(options.consensusCount || 0);
  if (consensusCount >= 2) {
    score += 0.05;
    reasons.push(`cross_source_consensus_${consensusCount}`);
  }

  return {
    coherence: {
      coherenceScore: clamp01(score),
      reasons
    }
  };
}

function applyHardGuards(baseScore, components, options = {}) {
  let adjusted = baseScore;
  const recordType = options.recordType || 'arrival';

  if (components.completeness.completenessScore < 0.4) {
    adjusted *= 0.6;
  }
  if (components.coherence.coherenceScore < 0.4) {
    adjusted *= 0.7;
  }
  if (recordType === 'arrival' && components.freshness.freshnessScore < 0.2) {
    adjusted *= 0.5;
  }

  return clamp01(adjusted);
}

function classifyReliabilityBand(confidence, thresholds) {
  return normalizeReliabilityBand(
    classifyBandByConfidence(confidence, resolveThresholds(thresholds)),
    RELIABILITY_BANDS.CAUTION
  );
}

function scoreRecordReliability(record, options = {}) {
  const sourcePart = scoreSource(record);
  const freshnessPart = scoreFreshness(record, options);
  const completenessPart = scoreCompleteness(record, options);
  const coherencePart = scoreCoherence(record, options);

  const weightedBase = clamp01(
    sourcePart.sourceScore * RELIABILITY_WEIGHTS.source +
      freshnessPart.freshness.freshnessScore * RELIABILITY_WEIGHTS.freshness +
      completenessPart.completeness.completenessScore * RELIABILITY_WEIGHTS.completeness +
      coherencePart.coherence.coherenceScore * RELIABILITY_WEIGHTS.coherence
  );

  const finalConfidence = applyHardGuards(
    weightedBase,
    {
      freshness: freshnessPart.freshness,
      completeness: completenessPart.completeness,
      coherence: coherencePart.coherence
    },
    options
  );

  const predictionType = toPredictionType(record && record.predictionType);
  const confidenceBand = classifyReliabilityBand(finalConfidence, options.thresholds);
  const freshness = normalizeFreshness(freshnessPart.freshness, 0.5);
  const policyBand = applyReliabilityPolicy(confidenceBand, {
    source: sourcePart.source,
    predictionType,
    confidence: finalConfidence,
    freshness,
    completenessScore: completenessPart.completeness.completenessScore,
    allowScheduledDirect: options.allowScheduledDirect === true
  });
  const band = normalizeReliabilityBand(policyBand, RELIABILITY_BANDS.CAUTION);

  return {
    source: sourcePart.source,
    predictionType,
    freshness,
    confidence: finalConfidence,
    reliabilityBand: band,
    scoreBreakdown: {
      sourceScore: sourcePart.sourceScore,
      freshnessScore: freshnessPart.freshness.freshnessScore,
      completenessScore: completenessPart.completeness.completenessScore,
      coherenceScore: coherencePart.coherence.coherenceScore,
      weightedBase
    },
    coherenceReasons: coherencePart.coherence.reasons
  };
}

function filterRecordsByReliability(records, options = {}) {
  const list = Array.isArray(records) ? records : [];
  const evaluated = list.map((record) => ({
    record,
    reliability: scoreRecordReliability(record, options)
  }));

  const direct = evaluated.filter((entry) => entry.reliability.reliabilityBand === RELIABILITY_BANDS.DIRECT);
  const caution = evaluated.filter((entry) => entry.reliability.reliabilityBand === RELIABILITY_BANDS.CAUTION);
  const degraded = evaluated.filter((entry) => entry.reliability.reliabilityBand === RELIABILITY_BANDS.DEGRADED);
  const discarded = evaluated.filter((entry) => entry.reliability.reliabilityBand === RELIABILITY_BANDS.DISCARD);

  return {
    evaluated,
    direct,
    caution,
    degraded,
    discarded,
    // Legacy alias per compatibilità in moduli non ancora migrati.
    disclaimer: caution
  };
}

function buildAlexaReliabilityHint(evaluatedRecords) {
  const safeList = Array.isArray(evaluatedRecords) ? evaluatedRecords : [];
  if (!safeList.length) {
    return '';
  }

  const hasCaution = safeList.some(
    (entry) => entry.reliability && entry.reliability.reliabilityBand === RELIABILITY_BANDS.CAUTION
  );
  const hasDegraded = safeList.some(
    (entry) => entry.reliability && entry.reliability.reliabilityBand === RELIABILITY_BANDS.DEGRADED
  );
  const hasDiscarded = safeList.some(
    (entry) => entry.reliability && entry.reliability.reliabilityBand === RELIABILITY_BANDS.DISCARD
  );
  const hasRealtime = safeList.some((entry) => {
    const predictionType = entry.reliability && entry.reliability.predictionType;
    return predictionType === PREDICTION_TYPES.REALTIME;
  });

  if (hasDegraded) {
    return 'Ti do una stima degradata: i tempi possono cambiare sensibilmente.';
  }
  if (hasCaution && hasRealtime) {
    return 'I tempi potrebbero variare leggermente.';
  }
  if (hasCaution) {
    return 'Ti do la migliore stima disponibile in questo momento.';
  }
  if (hasDiscarded) {
    return 'Alcuni dati non erano abbastanza affidabili e non li ho considerati.';
  }

  return '';
}

module.exports = {
  RELIABILITY_WEIGHTS,
  SOURCE_SCORE,
  THRESHOLDS,
  RELIABILITY_BANDS,
  FRESHNESS_PROFILES,
  scoreFreshness,
  scoreCompleteness,
  scoreCoherence,
  classifyReliabilityBand,
  scoreRecordReliability,
  filterRecordsByReliability,
  buildAlexaReliabilityHint
};
