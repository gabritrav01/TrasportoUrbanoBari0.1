'use strict';

const arrivalsFixture = require('../fixtures/arrivals.raw.json');
const { createArrivalNormalizer } = require('../../services/providers/domain/arrivalNormalizer');
const { PREDICTION_TYPES } = require('../../services/providers/domain/providerShapes');

const FIXED_NOW = Date.parse('2026-03-09T10:00:00.000Z');

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

describe('Arrival normalizer', () => {
  function createNormalizer(extra = {}) {
    return createArrivalNormalizer({
      now: () => FIXED_NOW,
      logger: createSilentLogger(),
      ...extra
    });
  }

  test('normalizes ids and parses realtime timestamps', () => {
    const normalizer = createNormalizer();
    const result = normalizer.normalizeSingle(arrivalsFixture.canonicalRealtime);

    expect(result.error).toBeNull();
    expect(result.arrival).toEqual(
      expect.objectContaining({
        stopId: 'STOP_100',
        lineId: '1_A',
        predictionType: PREDICTION_TYPES.REALTIME,
        etaMinutes: 5,
        source: 'official'
      })
    );
  });

  test('parses HH:mm scheduled timestamps with serviceDate context', () => {
    const normalizer = createNormalizer();
    const result = normalizer.normalizeSingle(arrivalsFixture.clockScheduled, {
      serviceDate: new Date('2026-03-09T00:00:00.000Z')
    });

    expect(result.error).toBeNull();
    expect(result.arrival.predictionType).toBe(PREDICTION_TYPES.SCHEDULED);
    expect(result.arrival.scheduledEpochMs).toBe(Date.parse('2026-03-09T09:15:00.000Z'));
    expect(result.arrival.etaMinutes).toBe(15);
  });

  test('returns INVALID_PAYLOAD when stopId/lineId are missing', () => {
    const normalizer = createNormalizer();
    const result = normalizer.normalizeSingle(arrivalsFixture.missingIdentifiers);

    expect(result.arrival).toBeNull();
    expect(result.error).toEqual(expect.objectContaining({ code: 'INVALID_PAYLOAD' }));
  });

  test('deduplicates duplicates preferring official source over fallback', () => {
    const normalizer = createNormalizer();
    const batch = normalizer.normalizeBatch([
      arrivalsFixture.duplicateFallback,
      arrivalsFixture.duplicateOfficial
    ]);

    expect(batch.arrivals).toHaveLength(1);
    expect(batch.duplicates).toHaveLength(1);
    expect(batch.arrivals[0].source).toBe('official');
  });

  test('deduplicates same source using higher confidence', () => {
    const normalizer = createNormalizer();
    const lowConfidence = {
      stopId: 'STOP_900',
      lineId: '10',
      destinationName: 'Centro',
      predictedTime: '2026-03-09T10:20:10Z',
      asOfEpochMs: '2026-03-09T10:00:00Z',
      source: 'official',
      confidence: 0.3
    };
    const highConfidence = {
      ...lowConfidence,
      predictedTime: '2026-03-09T10:20:40Z',
      confidence: 0.92
    };

    const batch = normalizer.normalizeBatch([lowConfidence, highConfidence]);

    expect(batch.arrivals).toHaveLength(1);
    expect(batch.arrivals[0].confidence).toBeCloseTo(0.92, 2);
  });

  test('drops stale records that have no usable ETA or timestamps', () => {
    const normalizer = createNormalizer();
    const batch = normalizer.normalizeBatch([arrivalsFixture.staleWithoutTimestamp]);

    expect(batch.arrivals).toHaveLength(0);
    expect(batch.droppedCount).toBe(1);
    expect(batch.errors[0].error.code).toBe('INVALID_PAYLOAD');
  });
});
