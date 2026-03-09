'use strict';

const {
  classifyReliabilityBand,
  scoreRecordReliability,
  filterRecordsByReliability,
  buildAlexaReliabilityHint
} = require('../../services/providers/domain/reliabilityScoring');

const FIXED_NOW = Date.parse('2026-03-09T10:00:00.000Z');

function buildBaseArrival(overrides = {}) {
  return {
    stopId: 'STOP_100',
    lineId: '1A',
    destinationName: 'Centro',
    predictionType: 'realtime',
    predictedEpochMs: FIXED_NOW + 5 * 60 * 1000,
    scheduledEpochMs: FIXED_NOW + 6 * 60 * 1000,
    asOfEpochMs: FIXED_NOW,
    etaMinutes: 5,
    source: 'official',
    ...overrides
  };
}

describe('Reliability scoring', () => {
  test('classifies fresh official realtime records as direct', () => {
    const reliability = scoreRecordReliability(buildBaseArrival(), {
      recordType: 'arrival',
      nowEpochMs: FIXED_NOW
    });

    expect(reliability.reliabilityBand).toBe('direct');
    expect(reliability.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test('classifies stale fallback records as discard', () => {
    const staleRecord = buildBaseArrival({
      predictionType: 'scheduled',
      predictedEpochMs: null,
      source: 'fallback',
      etaMinutes: null,
      asOfEpochMs: FIXED_NOW - 3 * 60 * 60 * 1000
    });

    const reliability = scoreRecordReliability(staleRecord, {
      recordType: 'arrival',
      nowEpochMs: FIXED_NOW
    });

    expect(reliability.reliabilityBand).toBe('discard');
    expect(reliability.confidence).toBeLessThan(0.6);
  });

  test('supports custom thresholds in band classification', () => {
    const thresholds = { direct: 0.9, disclaimer: 0.7 };

    expect(classifyReliabilityBand(0.95, thresholds)).toBe('direct');
    expect(classifyReliabilityBand(0.75, thresholds)).toBe('disclaimer');
    expect(classifyReliabilityBand(0.65, thresholds)).toBe('discard');
  });

  test('filters records into direct, disclaimer and discarded buckets', () => {
    const directRecord = buildBaseArrival();
    const disclaimerRecord = buildBaseArrival({
      source: 'fallback',
      predictionType: 'scheduled',
      predictedEpochMs: null,
      etaMinutes: null,
      asOfEpochMs: FIXED_NOW - 1000 * 1000
    });
    const discardRecord = buildBaseArrival({
      source: 'fallback',
      predictionType: 'scheduled',
      predictedEpochMs: null,
      etaMinutes: null,
      asOfEpochMs: FIXED_NOW - 4 * 60 * 60 * 1000
    });

    const result = filterRecordsByReliability([directRecord, disclaimerRecord, discardRecord], {
      recordType: 'arrival',
      nowEpochMs: FIXED_NOW
    });

    expect(result.direct).toHaveLength(1);
    expect(result.disclaimer).toHaveLength(1);
    expect(result.discarded).toHaveLength(1);
  });

  test('builds Alexa hint for disclaimer realtime data', () => {
    const hint = buildAlexaReliabilityHint([
      {
        reliability: {
          reliabilityBand: 'disclaimer',
          predictionType: 'realtime'
        }
      }
    ]);

    expect(hint).toBe('I tempi potrebbero variare leggermente.');
  });
});