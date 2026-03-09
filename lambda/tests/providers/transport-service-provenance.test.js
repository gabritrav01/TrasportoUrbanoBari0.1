'use strict';

const { createTransportService } = require('../../services/transportService');

function createProvider(overrides = {}) {
  const catalog = overrides.catalog || {
    stops: [{ id: 'STOP_1', name: 'Fermata Test', aliases: [] }],
    destinationTargets: [{ id: 'DEST_1', name: 'Centro', aliases: [] }],
    lines: [
      {
        id: '1',
        destinationName: 'Centro',
        destinationTargetId: 'DEST_1',
        stopIds: ['STOP_1']
      }
    ]
  };

  return {
    providerName: overrides.providerName || 'test-provider',
    getCatalog: jest.fn(() => catalog),
    searchStops: jest.fn(async () => []),
    nearestStops: jest.fn(async () => []),
    getStopArrivals: jest.fn(async () => []),
    getLinesServingStop: jest.fn(async () => catalog.lines.filter((line) => (line.stopIds || []).includes('STOP_1'))),
    resolveDestination: jest.fn(async () => []),
    findRoutes: jest.fn(async () => []),
    getRealtimePredictions: jest.fn(async () => []),
    getScheduledArrivals: jest.fn(async () => []),
    searchLines: jest.fn(async () => []),
    ...overrides
  };
}

describe('TransportService provenance hardening', () => {
  test('treats missing reliabilityBand as caution (never direct)', async () => {
    const primaryProvider = createProvider({
      getStopArrivals: jest.fn(async () => [
        {
          stopId: 'STOP_1',
          lineId: '1',
          destinationName: 'Centro',
          etaMinutes: 3,
          source: 'official',
          sourceName: 'amtab_primary',
          predictionType: 'realtime',
          confidence: 0.93,
          freshness: {
            ageSec: 5,
            freshnessScore: 0.95,
            bucket: 'fresh'
          }
        }
      ])
    });
    const service = createTransportService({
      primaryProvider,
      fallbackProvider: null
    });

    const arrivals = await service.getNextArrivalsByStop({ stopId: 'STOP_1', lineId: null });

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].reliabilityBand).toBe('caution');
  });

  test('downgrades scheduled fallback from realtime miss to non-official + caution', async () => {
    const primaryProvider = createProvider({
      getRealtimePredictions: jest.fn(async () => []),
      getScheduledArrivals: jest.fn(async () => [
        {
          stopId: 'STOP_1',
          lineId: '1',
          destinationName: 'Centro',
          etaMinutes: 7,
          predictionType: 'scheduled',
          source: 'official',
          sourceName: 'amtab_primary',
          confidence: 0.88,
          reliabilityBand: 'direct',
          freshness: {
            ageSec: 30,
            freshnessScore: 0.82,
            bucket: 'fresh'
          }
        }
      ])
    });
    const service = createTransportService({
      primaryProvider,
      fallbackProvider: null
    });

    const arrivals = await service.getLineDirectionArrivals({
      lineId: '1',
      destinationId: null,
      stopId: 'STOP_1'
    });

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].predictionType).toBe('scheduled');
    expect(arrivals[0].source).toBe('fallback');
    expect(arrivals[0].reliabilityBand).toBe('caution');
  });
});
