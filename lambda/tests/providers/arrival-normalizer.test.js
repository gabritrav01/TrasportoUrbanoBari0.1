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
      serviceTimeZone: 'Europe/Rome',
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

  test('parses HH:mm future time in same service day using service timezone', () => {
    const normalizer = createNormalizer({
      now: () => Date.parse('2026-03-09T10:00:00.000Z')
    });
    const result = normalizer.normalizeSingle(
      {
        stopId: 'STOP_500',
        lineId: '5',
        scheduled_time: '12:30',
        asOfEpochMs: '2026-03-09T10:00:00.000Z',
        source: 'public'
      },
      {
        serviceDate: '2026-03-09'
      }
    );

    expect(result.error).toBeNull();
    expect(result.arrival.scheduledEpochMs).toBe(Date.parse('2026-03-09T11:30:00.000Z'));
    expect(result.arrival.etaMinutes).toBe(90);
  });

  test('rolls over HH:mm to next day when time is already passed', () => {
    const asOfEpochMs = Date.parse('2026-03-09T22:50:00.000Z');
    const normalizer = createNormalizer({
      now: () => asOfEpochMs
    });
    const result = normalizer.normalizeSingle(
      {
        stopId: 'STOP_600',
        lineId: '6',
        scheduled_time: '00:10',
        asOfEpochMs,
        source: 'public'
      },
      {
        serviceDate: '2026-03-09'
      }
    );

    expect(result.error).toBeNull();
    expect(result.arrival.scheduledEpochMs).toBe(Date.parse('2026-03-09T23:10:00.000Z'));
    expect(result.arrival.etaMinutes).toBe(20);
  });

  test('HH:mm and full ISO produce the same epoch for same local time', () => {
    const normalizer = createNormalizer();
    const context = {
      serviceDate: '2026-03-09'
    };
    const clock = normalizer.normalizeSingle(
      {
        stopId: 'STOP_700',
        lineId: '7',
        scheduled_time: '12:30',
        asOfEpochMs: '2026-03-09T10:00:00.000Z',
        source: 'public'
      },
      context
    );
    const iso = normalizer.normalizeSingle(
      {
        stopId: 'STOP_700',
        lineId: '7',
        scheduled_time: '2026-03-09T12:30:00+01:00',
        asOfEpochMs: '2026-03-09T10:00:00.000Z',
        source: 'public'
      },
      context
    );

    expect(clock.error).toBeNull();
    expect(iso.error).toBeNull();
    expect(clock.arrival.scheduledEpochMs).toBe(iso.arrival.scheduledEpochMs);
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
