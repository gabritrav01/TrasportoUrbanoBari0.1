'use strict';

const { RESPONSE_MODES } = require('../config/constants');
const {
  RELIABILITY_BANDS,
  normalizeReliabilityBand
} = require('../services/providers/domain/qualityScoring');

function formatMinutes(minutes) {
  if (typeof minutes !== 'number' || minutes <= 0) {
    return 'in arrivo';
  }

  if (minutes === 1) {
    return 'tra 1 minuto';
  }

  return `tra ${minutes} minuti`;
}

function formatArrivalsSegment(arrival, responseMode) {
  const minuteLimit = responseMode === RESPONSE_MODES.BRIEF ? 1 : 3;
  const times = (arrival.minutes || []).slice(0, minuteLimit).map(formatMinutes);
  const timeText = times.length ? times.join(', ') : 'senza orario imminente';
  return `linea ${arrival.lineId} per ${arrival.destinationName} ${timeText}`;
}

function getFreshnessScore(arrival) {
  if (!arrival || !arrival.freshness || typeof arrival.freshness !== 'object') {
    return null;
  }
  const score = arrival.freshness.freshnessScore;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return null;
  }
  return Math.max(0, Math.min(1, score));
}

function hasLowConfidence(arrivals) {
  return (arrivals || []).some((arrival) => {
    if (!arrival || typeof arrival.confidence !== 'number' || !Number.isFinite(arrival.confidence)) {
      return true;
    }
    return arrival.confidence < 0.8;
  });
}

function getEffectiveReliabilityBand(arrival) {
  const explicitBand = normalizeReliabilityBand(arrival && arrival.reliabilityBand, null);
  if (explicitBand) {
    return explicitBand;
  }

  const predictionType = String((arrival && arrival.predictionType) || '').trim().toLowerCase();
  const source = String((arrival && arrival.source) || '').trim().toLowerCase();
  if (predictionType === 'inferred') {
    return RELIABILITY_BANDS.DEGRADED;
  }
  if (!source || source === 'fallback') {
    return RELIABILITY_BANDS.DEGRADED;
  }
  return RELIABILITY_BANDS.CAUTION;
}

function discardUnreliableArrivals(arrivals) {
  const safeArrivals = Array.isArray(arrivals) ? arrivals : [];
  return safeArrivals.filter(
    (arrival) => getEffectiveReliabilityBand(arrival) !== RELIABILITY_BANDS.DISCARD
  );
}

function buildReliabilityDisclaimer(arrivals) {
  const safeArrivals = Array.isArray(arrivals) ? arrivals : [];
  if (!safeArrivals.length) {
    return '';
  }

  const hasDiscard = safeArrivals.some(
    (arrival) => getEffectiveReliabilityBand(arrival) === RELIABILITY_BANDS.DISCARD
  );
  const hasCautionBand = safeArrivals.some(
    (arrival) => getEffectiveReliabilityBand(arrival) === RELIABILITY_BANDS.CAUTION
  );
  const hasDegradedBand = safeArrivals.some(
    (arrival) => getEffectiveReliabilityBand(arrival) === RELIABILITY_BANDS.DEGRADED
  );
  const hasAgingFreshness = safeArrivals.some((arrival) => {
    const score = getFreshnessScore(arrival);
    return score !== null && score < 0.6;
  });
  let disclaimer = '';
  if (hasDegradedBand) {
    disclaimer = ' Nota: i tempi indicati sono una stima e potrebbero cambiare.';
  } else if (hasCautionBand || hasLowConfidence(safeArrivals) || hasAgingFreshness) {
    disclaimer = ' Nota: i tempi sono indicativi e possono variare.';
  }
  if (hasDiscard) {
    disclaimer = `${disclaimer} Ho escluso alcuni dati poco affidabili.`.trim();
  }
  return disclaimer;
}

function formatArrivalsByStop({ stop, arrivals, responseMode, nearby }) {
  const safeArrivals = Array.isArray(arrivals) ? arrivals : [];
  const readableArrivals = discardUnreliableArrivals(safeArrivals);
  if (!readableArrivals.length) {
    const hadDiscardOnly = safeArrivals.length > 0;
    const fallbackText = hadDiscardOnly
      ? 'non ho dati abbastanza affidabili sui passaggi imminenti'
      : 'non risultano passaggi imminenti';
    if (nearby) {
      return `Alla fermata vicina ${stop.name} ${fallbackText}.`;
    }
    return `Alla fermata ${stop.name} ${fallbackText}.`;
  }

  const limit = responseMode === RESPONSE_MODES.BRIEF ? 2 : 4;
  const selected = readableArrivals.slice(0, limit).map((arrival) => formatArrivalsSegment(arrival, responseMode));
  const intro = nearby ? `Fermata vicina: ${stop.name}.` : `Fermata: ${stop.name}.`;
  const suffix = responseMode === RESPONSE_MODES.BRIEF ? '' : ' Puoi dire risposta breve per una sintesi.';
  const disclaimer = buildReliabilityDisclaimer(safeArrivals);
  return `${intro} ${selected.join('. ')}.${suffix}${disclaimer}`;
}

function formatRoutesToDestination({ destination, originStop, routes, responseMode }) {
  if (!routes.length) {
    if (originStop) {
      return `Da ${originStop.name} non risultano linee dirette per ${destination.name}.`;
    }
    return `Non risultano linee dirette per ${destination.name}.`;
  }

  const limit = responseMode === RESPONSE_MODES.BRIEF ? 2 : 5;
  const lineIds = routes.slice(0, limit).map((route) => route.lineId).join(', ');

  if (originStop) {
    return `Da ${originStop.name} puoi usare le linee ${lineIds} per ${destination.name}.`;
  }

  return `Per ${destination.name} puoi usare le linee ${lineIds}.`;
}

function formatLineDirectionArrivals({ line, destination, stop, arrivals, responseMode }) {
  const safeArrivals = Array.isArray(arrivals) ? arrivals : [];
  const readableArrivals = discardUnreliableArrivals(safeArrivals);
  if (!readableArrivals.length) {
    const fallbackText = safeArrivals.length > 0
      ? `Nessun passaggio affidabile per la linea ${line.id} verso ${destination.name}`
      : `Nessun passaggio imminente per la linea ${line.id} verso ${destination.name}`;
    if (stop) {
      return `${fallbackText} a ${stop.name}.`;
    }
    return `${fallbackText}.`;
  }

  const limit = responseMode === RESPONSE_MODES.BRIEF ? 2 : 3;
  const selected = readableArrivals.slice(0, limit).map((arrival) => formatArrivalsSegment(arrival, responseMode));
  const disclaimer = buildReliabilityDisclaimer(safeArrivals);
  if (stop) {
    return `Linea ${line.id} verso ${destination.name} a ${stop.name}: ${selected.join('. ')}.${disclaimer}`;
  }

  return `Linea ${line.id} verso ${destination.name}: ${selected.join('. ')}.${disclaimer}`;
}

function formatAmbiguityPrompt(kindLabel, options) {
  const limitedOptions = (options || []).slice(0, 4);
  if (!limitedOptions.length) {
    return `Serve un chiarimento sulla ${kindLabel}.`;
  }

  const choices = limitedOptions.map((option, index) => `${index + 1}, ${option.name}`).join('; ');
  return `Ho trovato piu opzioni per ${kindLabel}: ${choices}. Dimmi numero o nome.`;
}

function formatNearbyUnavailable(reason) {
  if (reason === 'address_not_available') {
    return 'Non trovo un indirizzo completo del dispositivo. Controlla indirizzo e CAP nell app Alexa.';
  }
  if (reason === 'service_client_unavailable' || reason === 'address_service_error') {
    return 'Non riesco a leggere l indirizzo del dispositivo in questo momento. Riprova tra poco.';
  }
  if (reason === 'geocode_failed') {
    return 'Non riesco a usare l indirizzo del dispositivo per trovare fermate vicine.';
  }
  if (reason === 'device_not_available') {
    return 'Non riesco a identificare il dispositivo corrente per cercare fermate vicine.';
  }
  if (reason === 'stale') {
    return 'La posizione del dispositivo non e aggiornata. Apri l app Alexa e riprova.';
  }
  if (reason === 'accuracy') {
    return 'La posizione attuale non e abbastanza precisa. Riprova tra poco.';
  }
  return 'Per usare da qui o vicino a me attiva il permesso indirizzo del dispositivo nell app Alexa.';
}

function formatFavoriteSaved(label, stopName) {
  return `Salvata la fermata ${stopName} come preferita ${label}.`;
}

function formatHelpExamples() {
  return (
    'Esempi: prossimi bus alla stazione, bus vicino a me, linee per policlinico, ' +
    'quando passa la linea 2 barra verso universita, salva questa fermata come casa.'
  );
}

module.exports = {
  formatArrivalsByStop,
  formatRoutesToDestination,
  formatLineDirectionArrivals,
  formatAmbiguityPrompt,
  formatNearbyUnavailable,
  formatFavoriteSaved,
  formatHelpExamples
};
