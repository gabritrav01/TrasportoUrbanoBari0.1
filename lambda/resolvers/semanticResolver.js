'use strict';

const stopAliases = require('../config/stopAliases');
const destinationAliases = require('../config/destinationAliases');
const bariPlaces = require('../config/bariPlaces');
const knownLines = require('../config/knownLines');

function normalizeItalianText(text) {
  if (!text) {
    return '';
  }

  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['`]/g, ' ')
    .replace(/\bdi\b/g, ' di ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textMatchScore(queryNormalized, candidateNormalized) {
  if (!queryNormalized || !candidateNormalized) {
    return 0;
  }

  if (queryNormalized === candidateNormalized) {
    return 100;
  }
  if (candidateNormalized.startsWith(queryNormalized) || queryNormalized.startsWith(candidateNormalized)) {
    return 85;
  }
  if (candidateNormalized.includes(queryNormalized) || queryNormalized.includes(candidateNormalized)) {
    return 70;
  }

  const queryTokens = new Set(queryNormalized.split(' ').filter(Boolean));
  const candidateTokens = new Set(candidateNormalized.split(' ').filter(Boolean));
  let overlap = 0;
  queryTokens.forEach((token) => {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  });
  if (!overlap) {
    return 0;
  }

  const ratio = overlap / Math.max(queryTokens.size, candidateTokens.size);
  return Math.round(ratio * 65);
}

function matchCatalogEntries(queryNormalized, entries, tokenSelector) {
  return entries
    .map((entry) => {
      const tokens = tokenSelector(entry) || [];
      const bestTokenScore = tokens.reduce((best, token) => {
        const score = textMatchScore(queryNormalized, normalizeItalianText(token));
        return score > best ? score : best;
      }, 0);
      return {
        entry,
        score: bestTokenScore
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}

function extractLineHints(queryNormalized) {
  return knownLines
    .map((line) => {
      const bestScore = (line.spokenForms || []).reduce((best, form) => {
        const score = textMatchScore(queryNormalized, normalizeItalianText(form));
        return score > best ? score : best;
      }, 0);
      return {
        line,
        score: bestScore
      };
    })
    .filter((match) => match.score >= 70)
    .sort((a, b) => b.score - a.score)
    .map((match) => match.line.id);
}

function detectQueryEntityType(queryNormalized, aliasMatches, placeMatches) {
  const topAlias = aliasMatches.length ? aliasMatches[0].entry : null;
  const topPlace = placeMatches.length ? placeMatches[0].entry : null;

  if (topPlace && topPlace.placeType === 'spoken_target') {
    return 'spoken_target';
  }
  if (topPlace && topPlace.placeType === 'poi') {
    return 'poi';
  }
  if (topPlace && topPlace.placeType === 'area') {
    return 'area';
  }
  if (topAlias && topAlias.placeId) {
    return 'area';
  }

  if (queryNormalized.includes('fermata')) {
    return 'stop';
  }
  if (queryNormalized.includes('verso') || queryNormalized.includes('arriv') || queryNormalized.includes('andare')) {
    return 'spoken_target';
  }

  return 'unknown';
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return (candidates || []).filter((candidate) => {
    if (!candidate || !candidate.id) {
      return false;
    }
    if (seen.has(candidate.id)) {
      return false;
    }
    seen.add(candidate.id);
    return true;
  });
}

function collectMappedCandidates(ids, getterFn) {
  if (typeof getterFn !== 'function') {
    return [];
  }

  const result = [];
  (ids || []).forEach((id) => {
    const entity = getterFn(id);
    if (entity) {
      result.push(entity);
    }
  });
  return result;
}

function rankCandidateStops(candidates, context) {
  const queryNormalized = normalizeItalianText(context.query || context.queryNormalized || '');
  const aliasMatches = context.aliasMatches || [];
  const placeMatches = context.placeMatches || [];
  const nearbyStopIds = new Set(context.nearbyStopIds || []);
  const preferredStopIds = new Set(context.preferredStopIds || []);
  const lineHints = new Set(context.lineHints || []);

  const ranked = dedupeCandidates(candidates).map((candidate) => {
    const reasons = [];
    const candidateTerms = [candidate.name].concat(candidate.aliases || []).map(normalizeItalianText);
    const lexicalScore = candidateTerms.reduce((best, term) => Math.max(best, textMatchScore(queryNormalized, term)), 0);

    let score = lexicalScore;
    if (lexicalScore > 0) {
      reasons.push(`lexical:${lexicalScore}`);
    }

    aliasMatches.forEach((aliasMatch) => {
      const alias = aliasMatch.entry;
      if ((alias.mappedStopIds || []).includes(candidate.id)) {
        const baseBonus = alias.confidence === 'high' ? 24 : alias.confidence === 'medium' ? 16 : 8;
        const relevanceFactor = aliasMatch.score >= 80 ? 1 : aliasMatch.score >= 60 ? 0.6 : 0.3;
        const bonus = Math.round(baseBonus * relevanceFactor);
        score += bonus;
        reasons.push(`alias:${alias.key}+${bonus}`);
      }
    });

    placeMatches.forEach((placeMatch) => {
      const place = placeMatch.entry;
      if ((place.linkedStopIds || []).includes(candidate.id)) {
        const baseBonus = place.confidence === 'high' ? 18 : place.confidence === 'medium' ? 12 : 6;
        const relevanceFactor = placeMatch.score >= 80 ? 1 : placeMatch.score >= 60 ? 0.6 : 0.25;
        const bonus = Math.round(baseBonus * relevanceFactor);
        score += bonus;
        reasons.push(`place:${place.id}+${bonus}`);
      }
    });

    if (nearbyStopIds.has(candidate.id)) {
      score += 10;
      reasons.push('nearby:+10');
    }

    if (preferredStopIds.has(candidate.id)) {
      score += 6;
      reasons.push('preferred:+6');
    }

    const servedLines = new Set(candidate.lineIds || []);
    if (lineHints.size && [...lineHints].some((lineId) => servedLines.has(lineId))) {
      score += 7;
      reasons.push('line_hint:+7');
    }

    return {
      id: candidate.id,
      name: candidate.name,
      score,
      reasons,
      rawCandidate: candidate
    };
  });

  return ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function detectAmbiguity(candidates) {
  const ranked = Array.isArray(candidates) ? candidates : [];
  if (ranked.length <= 1) {
    return {
      isAmbiguous: false,
      reason: ranked.length ? 'single_candidate' : 'no_candidates',
      options: ranked.slice(0, 1)
    };
  }

  const top = ranked[0];
  const second = ranked[1];
  const scoreGap = top.score - second.score;
  const ambiguous = scoreGap <= 8 || top.score < 55;

  if (!ambiguous) {
    return {
      isAmbiguous: false,
      reason: 'dominant_top_candidate',
      options: [top]
    };
  }

  const threshold = Math.max(top.score - 8, second.score);
  const options = ranked.filter((candidate) => candidate.score >= threshold).slice(0, 4);
  if (options.length <= 1) {
    return {
      isAmbiguous: false,
      reason: 'single_effective_option',
      options: [top]
    };
  }
  return {
    isAmbiguous: true,
    reason: scoreGap <= 8 ? 'close_scores' : 'low_confidence',
    topScore: top.score,
    secondScore: second.score,
    options
  };
}

function buildClarificationPrompt(candidates, entityType) {
  const safeCandidates = Array.isArray(candidates) ? candidates.slice(0, 4) : [];
  const label = entityType === 'destination' ? 'destinazione' : entityType === 'line' ? 'linea' : 'fermata';

  if (!safeCandidates.length) {
    return `Mi serve un chiarimento sulla ${label}.`;
  }

  const choiceText = safeCandidates
    .map((candidate, index) => `${index + 1}, ${candidate.name || candidate.id}`)
    .join('; ');
  return `Ho trovato piu opzioni per la ${label}: ${choiceText}. Dimmi numero o nome completo.`;
}

async function collectCandidates(query, context, strategy) {
  const collected = [];
  const searchFn = strategy.searchFn;
  const expansions = strategy.expansions || [];

  if (typeof searchFn === 'function') {
    const direct = await searchFn(query);
    collected.push(...(Array.isArray(direct) ? direct : []));

    if (!collected.length) {
      for (const expansionQuery of expansions) {
        const expanded = await searchFn(expansionQuery);
        if (Array.isArray(expanded) && expanded.length) {
          collected.push(...expanded);
          break;
        }
      }
    }
  }

  if (!collected.length && Array.isArray(strategy.allCandidates)) {
    const queryNormalized = normalizeItalianText(query);
    const fallback = strategy.allCandidates
      .map((candidate) => {
        const terms = [candidate.name].concat(candidate.aliases || []);
        const best = terms.reduce((max, term) => Math.max(max, textMatchScore(queryNormalized, normalizeItalianText(term))), 0);
        return { candidate, score: best };
      })
      .filter((entry) => entry.score >= 45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((entry) => entry.candidate);
    collected.push(...fallback);
  }

  return dedupeCandidates(collected);
}

function mapAmbiguityForHandlers(ambiguity) {
  return (ambiguity.options || []).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    score: candidate.score
  }));
}

async function resolveStopQuery(query, context = {}) {
  const queryNormalized = normalizeItalianText(query);
  if (!queryNormalized) {
    return {
      status: 'missing',
      query,
      queryNormalized
    };
  }

  const aliasMatches = matchCatalogEntries(queryNormalized, stopAliases, (entry) => entry.queryTokens || []);
  const placeMatches = matchCatalogEntries(queryNormalized, bariPlaces, (entry) => entry.spokenForms || []);
  const lineHints = extractLineHints(queryNormalized);
  const queryEntityType = detectQueryEntityType(queryNormalized, aliasMatches, placeMatches);

  const expansionQueries = [];
  aliasMatches.slice(0, 3).forEach((match) => {
    const alias = match.entry;
    if (alias.canonicalLabel) {
      expansionQueries.push(alias.canonicalLabel);
    }
    (alias.queryTokens || []).slice(0, 2).forEach((token) => expansionQueries.push(token));
  });

  const candidates = await collectCandidates(query, context, {
    searchFn: context.searchStops,
    allCandidates: context.allStops,
    expansions: expansionQueries
  });

  const mappedCandidates = [];
  aliasMatches.forEach((match) => {
    mappedCandidates.push(...collectMappedCandidates(match.entry.mappedStopIds || [], context.getStopById));
  });
  placeMatches.forEach((match) => {
    mappedCandidates.push(...collectMappedCandidates(match.entry.linkedStopIds || [], context.getStopById));
  });

  const ranked = rankCandidateStops(dedupeCandidates(candidates.concat(mappedCandidates)), {
    query: queryNormalized,
    aliasMatches,
    placeMatches,
    lineHints,
    nearbyStopIds: context.nearbyStopIds || [],
    preferredStopIds: context.preferredStopIds || []
  });

  if (!ranked.length) {
    return {
      status: 'not_found',
      query,
      queryNormalized,
      queryEntityType,
      metadata: {
        aliasMatches: aliasMatches.slice(0, 3).map((match) => match.entry.key),
        placeMatches: placeMatches.slice(0, 3).map((match) => match.entry.id),
        lineHints
      }
    };
  }

  const ambiguity = detectAmbiguity(ranked);
  if (ambiguity.isAmbiguous) {
    return {
      status: 'ambiguous',
      query,
      queryNormalized,
      queryEntityType,
      candidates: ranked,
      options: mapAmbiguityForHandlers(ambiguity),
      clarificationPrompt: buildClarificationPrompt(ambiguity.options, 'stop'),
      metadata: {
        reason: ambiguity.reason
      }
    };
  }

  return {
    status: 'resolved',
    query,
    queryNormalized,
    queryEntityType,
    match: ranked[0],
    score: ranked[0].score,
    candidates: ranked
  };
}

function rankDestinationCandidates(candidates, context) {
  const queryNormalized = normalizeItalianText(context.query || context.queryNormalized || '');
  const aliasMatches = context.aliasMatches || [];
  const placeMatches = context.placeMatches || [];

  const ranked = dedupeCandidates(candidates).map((candidate) => {
    const reasons = [];
    const candidateTerms = [candidate.name].concat(candidate.aliases || []).map(normalizeItalianText);
    const lexicalScore = candidateTerms.reduce((best, term) => Math.max(best, textMatchScore(queryNormalized, term)), 0);
    let score = lexicalScore;
    if (lexicalScore > 0) {
      reasons.push(`lexical:${lexicalScore}`);
    }

    aliasMatches.forEach((aliasMatch) => {
      const alias = aliasMatch.entry;
      if ((alias.mappedDestinationIds || []).includes(candidate.id)) {
        const baseBonus = alias.confidence === 'high' ? 22 : alias.confidence === 'medium' ? 14 : 7;
        const relevanceFactor = aliasMatch.score >= 80 ? 1 : aliasMatch.score >= 60 ? 0.6 : 0.3;
        const bonus = Math.round(baseBonus * relevanceFactor);
        score += bonus;
        reasons.push(`alias:${alias.key}+${bonus}`);
      }
    });

    placeMatches.forEach((placeMatch) => {
      const place = placeMatch.entry;
      if ((place.linkedDestinationIds || []).includes(candidate.id)) {
        const baseBonus = place.confidence === 'high' ? 16 : place.confidence === 'medium' ? 10 : 5;
        const relevanceFactor = placeMatch.score >= 80 ? 1 : placeMatch.score >= 60 ? 0.6 : 0.25;
        const bonus = Math.round(baseBonus * relevanceFactor);
        score += bonus;
        reasons.push(`place:${place.id}+${bonus}`);
      }
    });

    return {
      id: candidate.id,
      name: candidate.name,
      score,
      reasons,
      rawCandidate: candidate
    };
  });

  return ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

async function resolveDestinationQuery(query, context = {}) {
  const queryNormalized = normalizeItalianText(query);
  if (!queryNormalized) {
    return {
      status: 'missing',
      query,
      queryNormalized
    };
  }

  const aliasMatches = matchCatalogEntries(queryNormalized, destinationAliases, (entry) => entry.queryTokens || []);
  const placeMatches = matchCatalogEntries(queryNormalized, bariPlaces, (entry) => entry.spokenForms || []);
  const queryEntityType = detectQueryEntityType(queryNormalized, aliasMatches, placeMatches);

  const expansionQueries = [];
  aliasMatches.slice(0, 3).forEach((match) => {
    const alias = match.entry;
    if (alias.canonicalLabel) {
      expansionQueries.push(alias.canonicalLabel);
    }
    (alias.queryTokens || []).slice(0, 2).forEach((token) => expansionQueries.push(token));
  });

  const candidates = await collectCandidates(query, context, {
    searchFn: context.searchDestinations || context.resolveDestination,
    allCandidates: context.allDestinations,
    expansions: expansionQueries
  });

  const mappedCandidates = [];
  aliasMatches.forEach((match) => {
    mappedCandidates.push(
      ...collectMappedCandidates(match.entry.mappedDestinationIds || [], context.getDestinationById)
    );
  });
  placeMatches.forEach((match) => {
    mappedCandidates.push(
      ...collectMappedCandidates(match.entry.linkedDestinationIds || [], context.getDestinationById)
    );
  });

  const ranked = rankDestinationCandidates(dedupeCandidates(candidates.concat(mappedCandidates)), {
    query: queryNormalized,
    aliasMatches,
    placeMatches
  });

  if (!ranked.length) {
    return {
      status: 'not_found',
      query,
      queryNormalized,
      queryEntityType,
      metadata: {
        aliasMatches: aliasMatches.slice(0, 3).map((match) => match.entry.key),
        placeMatches: placeMatches.slice(0, 3).map((match) => match.entry.id)
      }
    };
  }

  const ambiguity = detectAmbiguity(ranked);
  if (ambiguity.isAmbiguous) {
    return {
      status: 'ambiguous',
      query,
      queryNormalized,
      queryEntityType,
      candidates: ranked,
      options: mapAmbiguityForHandlers(ambiguity),
      clarificationPrompt: buildClarificationPrompt(ambiguity.options, 'destination'),
      metadata: {
        reason: ambiguity.reason
      }
    };
  }

  return {
    status: 'resolved',
    query,
    queryNormalized,
    queryEntityType,
    match: ranked[0],
    score: ranked[0].score,
    candidates: ranked
  };
}

module.exports = {
  normalizeItalianText,
  resolveStopQuery,
  resolveDestinationQuery,
  rankCandidateStops,
  detectAmbiguity,
  buildClarificationPrompt
};
