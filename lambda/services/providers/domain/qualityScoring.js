'use strict';

const RELIABILITY_BANDS = Object.freeze({
  DIRECT: 'direct',
  CAUTION: 'caution',
  DEGRADED: 'degraded',
  DISCARD: 'discard'
});

const RELIABILITY_ORDER = Object.freeze({
  [RELIABILITY_BANDS.DIRECT]: 0,
  [RELIABILITY_BANDS.CAUTION]: 1,
  [RELIABILITY_BANDS.DEGRADED]: 2,
  [RELIABILITY_BANDS.DISCARD]: 3
});

const DEFAULT_THRESHOLDS = Object.freeze({
  direct: 0.82,
  caution: 0.62,
  degraded: 0.45
});

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

function clamp01(value, fallbackValue = null) {
  const parsed = toNumberOrNull(value);
  if (parsed === null) {
    return fallbackValue;
  }
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 1) {
    return 1;
  }
  return parsed;
}

function normalizeReliabilityBand(value, fallback = RELIABILITY_BANDS.CAUTION) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === RELIABILITY_BANDS.DIRECT) {
    return RELIABILITY_BANDS.DIRECT;
  }
  if (normalized === RELIABILITY_BANDS.CAUTION) {
    return RELIABILITY_BANDS.CAUTION;
  }
  if (normalized === 'disclaimer') {
    return RELIABILITY_BANDS.CAUTION;
  }
  if (normalized === RELIABILITY_BANDS.DEGRADED) {
    return RELIABILITY_BANDS.DEGRADED;
  }
  if (normalized === RELIABILITY_BANDS.DISCARD) {
    return RELIABILITY_BANDS.DISCARD;
  }
  return fallback;
}

function resolveThresholds(input) {
  const thresholds = input && typeof input === 'object' ? input : {};
  const direct = toNumberOrNull(thresholds.direct);
  const caution = toNumberOrNull(
    thresholds.caution !== undefined ? thresholds.caution : thresholds.disclaimer
  );
  const degraded = toNumberOrNull(thresholds.degraded);

  return {
    direct: direct !== null ? direct : DEFAULT_THRESHOLDS.direct,
    caution: caution !== null ? caution : DEFAULT_THRESHOLDS.caution,
    degraded: degraded !== null ? degraded : DEFAULT_THRESHOLDS.degraded
  };
}

function classifyBandByConfidence(confidence, thresholds) {
  const safeConfidence = clamp01(confidence, null);
  if (safeConfidence === null) {
    return RELIABILITY_BANDS.CAUTION;
  }

  const resolved = resolveThresholds(thresholds);
  if (safeConfidence >= resolved.direct) {
    return RELIABILITY_BANDS.DIRECT;
  }
  if (safeConfidence >= resolved.caution) {
    return RELIABILITY_BANDS.CAUTION;
  }
  if (safeConfidence >= resolved.degraded) {
    return RELIABILITY_BANDS.DEGRADED;
  }
  return RELIABILITY_BANDS.DISCARD;
}

function worsenBand(currentBand, floorBand) {
  const current = normalizeReliabilityBand(currentBand);
  const floor = normalizeReliabilityBand(floorBand);
  return RELIABILITY_ORDER[current] >= RELIABILITY_ORDER[floor] ? current : floor;
}

function mergeReliabilityBands(values, fallback = RELIABILITY_BANDS.CAUTION) {
  const list = Array.isArray(values) ? values : [];
  if (!list.length) {
    return normalizeReliabilityBand(fallback);
  }

  let merged = normalizeReliabilityBand(list[0], fallback);
  list.slice(1).forEach((value) => {
    const normalized = normalizeReliabilityBand(value, fallback);
    if (RELIABILITY_ORDER[normalized] > RELIABILITY_ORDER[merged]) {
      merged = normalized;
    }
  });
  return merged;
}

function normalizeFreshness(value, fallbackScore = 0.5) {
  if (!value || typeof value !== 'object') {
    return {
      ageSec: null,
      freshnessScore: clamp01(fallbackScore, 0.5),
      bucket: 'unknown'
    };
  }

  const score = clamp01(value.freshnessScore, clamp01(fallbackScore, 0.5));
  const ageSec = toNumberOrNull(value.ageSec);
  return {
    ageSec: ageSec !== null ? Math.max(0, Math.round(ageSec)) : null,
    freshnessScore: score,
    bucket: typeof value.bucket === 'string' && value.bucket.trim() ? value.bucket : 'unknown'
  };
}

function confidenceFromBand(band) {
  const normalized = normalizeReliabilityBand(band);
  if (normalized === RELIABILITY_BANDS.DIRECT) {
    return 0.9;
  }
  if (normalized === RELIABILITY_BANDS.CAUTION) {
    return 0.72;
  }
  if (normalized === RELIABILITY_BANDS.DEGRADED) {
    return 0.56;
  }
  return 0.35;
}

function applyReliabilityPolicy(baseBand, context = {}) {
  const source = String(context.source || '').trim().toLowerCase() || 'fallback';
  const predictionType = String(context.predictionType || '').trim().toLowerCase() || 'inferred';
  const allowScheduledDirect = context.allowScheduledDirect === true;
  const freshness = normalizeFreshness(context.freshness, 0.5);
  const completenessScore = clamp01(context.completenessScore, 0.7);
  const confidence = clamp01(
    context.confidence,
    confidenceFromBand(baseBand)
  );

  let band = normalizeReliabilityBand(baseBand);

  if (predictionType === 'inferred') {
    band = worsenBand(band, RELIABILITY_BANDS.DEGRADED);
  }
  if (source !== 'official' && band === RELIABILITY_BANDS.DIRECT) {
    band = RELIABILITY_BANDS.CAUTION;
  }
  if (predictionType === 'scheduled' && !allowScheduledDirect && band === RELIABILITY_BANDS.DIRECT) {
    band = RELIABILITY_BANDS.CAUTION;
  }
  if (freshness.freshnessScore < 0.2 || completenessScore < 0.35) {
    band = RELIABILITY_BANDS.DISCARD;
  } else if (freshness.freshnessScore < 0.45 || completenessScore < 0.6) {
    band = worsenBand(band, RELIABILITY_BANDS.CAUTION);
  }
  if (confidence < 0.45) {
    band = worsenBand(band, RELIABILITY_BANDS.DEGRADED);
  }
  if (confidence < 0.3) {
    band = RELIABILITY_BANDS.DISCARD;
  }

  return band;
}

function scoreProviderResultQuality(rawProviderResult = {}, options = {}) {
  const source = String(rawProviderResult.source || 'fallback').trim().toLowerCase() || 'fallback';
  const predictionType =
    String(rawProviderResult.predictionType || options.predictionType || 'inferred').trim().toLowerCase() || 'inferred';
  const entries = Array.isArray(rawProviderResult.data) ? rawProviderResult.data : [];

  const entryBands = entries
    .map((entry) => normalizeReliabilityBand(entry && entry.reliabilityBand, null))
    .filter(Boolean);
  const entryConfidenceValues = entries
    .map((entry) => clamp01(entry && entry.confidence, null))
    .filter((value) => value !== null);
  const entryFreshnessValues = entries
    .map((entry) => normalizeFreshness(entry && entry.freshness, null).freshnessScore)
    .filter((score) => typeof score === 'number' && Number.isFinite(score));

  const explicitConfidence = clamp01(rawProviderResult.confidence, null);
  const derivedConfidence =
    entryConfidenceValues.length > 0
      ? entryConfidenceValues.reduce((sum, value) => sum + value, 0) / entryConfidenceValues.length
      : null;

  const initialBand = mergeReliabilityBands(
    [rawProviderResult.reliabilityBand].concat(entryBands),
    classifyBandByConfidence(explicitConfidence !== null ? explicitConfidence : derivedConfidence, options.thresholds)
  );
  const confidence = clamp01(
    explicitConfidence !== null ? explicitConfidence : derivedConfidence,
    confidenceFromBand(initialBand)
  );
  const freshness = normalizeFreshness(
    rawProviderResult.freshness,
    entryFreshnessValues.length ? Math.min(...entryFreshnessValues) : 0.5
  );

  const completenessScore = entries.length > 0 ? 1 : rawProviderResult.ok === false ? 0.35 : 0.55;
  const reliabilityBand = applyReliabilityPolicy(initialBand, {
    source,
    predictionType,
    confidence,
    freshness,
    completenessScore,
    allowScheduledDirect: options.allowScheduledDirect === true
  });

  return {
    confidence,
    freshness,
    reliabilityBand
  };
}

module.exports = {
  RELIABILITY_BANDS,
  DEFAULT_THRESHOLDS,
  normalizeReliabilityBand,
  normalizeFreshness,
  resolveThresholds,
  classifyBandByConfidence,
  mergeReliabilityBands,
  applyReliabilityPolicy,
  scoreProviderResultQuality
};
