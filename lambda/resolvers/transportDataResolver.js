'use strict';

function normalizeText(value) {
  if (!value) {
    return '';
  }

  return value
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateScore(query, candidateValues) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return 0;
  }

  let maxScore = 0;
  candidateValues.forEach((candidateValue) => {
    const normalizedCandidate = normalizeText(candidateValue);
    if (!normalizedCandidate) {
      return;
    }

    if (normalizedCandidate === normalizedQuery) {
      maxScore = Math.max(maxScore, 100);
      return;
    }

    if (normalizedCandidate.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedCandidate)) {
      maxScore = Math.max(maxScore, 80);
      return;
    }

    if (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate)) {
      maxScore = Math.max(maxScore, 60);
    }
  });

  return maxScore;
}

function topRankedMatches(items, query, valuesSelector) {
  const scoredItems = items
    .map((item) => ({
      item,
      score: candidateScore(query, valuesSelector(item))
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scoredItems.length) {
    return [];
  }

  const topScore = scoredItems[0].score;
  return scoredItems.filter((entry) => entry.score === topScore).map((entry) => entry.item);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function scheduleMinutesFromHeadway({ firstMinute, lastMinute, headwayMinutes, referenceDate, limit }) {
  const now = referenceDate instanceof Date ? referenceDate : new Date();
  const nowMinutes = minutesSinceMidnight(now);
  if (nowMinutes > lastMinute) {
    return [];
  }

  let nextMinute = firstMinute;
  if (nowMinutes > firstMinute) {
    const elapsed = nowMinutes - firstMinute;
    nextMinute = firstMinute + Math.ceil(elapsed / headwayMinutes) * headwayMinutes;
  }

  const maxItems = typeof limit === 'number' && limit > 0 ? limit : 3;
  const result = [];
  for (let index = 0; index < maxItems; index += 1) {
    const runMinute = nextMinute + index * headwayMinutes;
    if (runMinute <= lastMinute) {
      result.push(Math.max(0, runMinute - nowMinutes));
    }
  }
  return result;
}

function sortByEta(arrivals) {
  return arrivals.slice().sort((a, b) => {
    const etaA = typeof a.etaMinutes === 'number' ? a.etaMinutes : Number.MAX_SAFE_INTEGER;
    const etaB = typeof b.etaMinutes === 'number' ? b.etaMinutes : Number.MAX_SAFE_INTEGER;
    return etaA - etaB;
  });
}

module.exports = {
  normalizeText,
  candidateScore,
  topRankedMatches,
  haversineDistanceMeters,
  scheduleMinutesFromHeadway,
  sortByEta
};
