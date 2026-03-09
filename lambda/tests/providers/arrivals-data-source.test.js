'use strict';

const remoteArrivalsFixture = require('../fixtures/arrivals.remote.json');
const linesCatalogFixture = require('../fixtures/lines.catalog.json');
const { createAmtabNormalizer } = require('../../services/providers/amtab/normalizer');
const { createArrivalsDataSource } = require('../../services/providers/amtab/arrivalsDataSource');
const { createMemoryCacheAdapter } = require('../../services/providers/amtab/cacheAdapter');

const FIXED_NOW = Date.parse('2026-03-09T10:00:00.000Z');

function createLoggerMock() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}

function createLinesDataSourceMock(lines) {
  const lineById = new Map(lines.map((line) => [line.id, line]));
  return {
    getLineById: jest.fn((lineId) => lineById.get(lineId) || null),
    getLinesServingStop: jest.fn(async (stopId) => lines.filter((line) => (line.stopIds || []).includes(stopId)))
  };
}

function buildDataSource(options = {}) {
  const lines = options.lines || linesCatalogFixture.lines;
  const logger = options.logger || createLoggerMock();
  const linesDataSource = createLinesDataSourceMock(lines);
  const dataSource = createArrivalsDataSource({
    normalizer: createAmtabNormalizer(),
    cacheAdapter:
      options.cacheAdapter ||
      createMemoryCacheAdapter({
        defaultTtlMs: 60000,
        now: () => FIXED_NOW
      }),
    apiClient: options.apiClient || {},
    linesDataSource,
    logger,
    now: () => FIXED_NOW,
    defaultSource: 'official',
    defaultSourceName: 'amtab_primary',
    resiliencePolicy:
      options.resiliencePolicy || {
        timeoutsMs: {
          realtime: 20,
          scheduled: 20,
          staticLookup: 20
        }
      },
    reliabilityPolicy:
      options.reliabilityPolicy || {
        thresholds: {
          direct: 0.65,
          caution: 0.35,
          degraded: 0.2
        }
      }
  });

  return {
    dataSource,
    linesDataSource,
    logger
  };
}

describe('AMTAB arrivals data source', () => {
  test('normalizes and sorts realtime arrivals by eta', async () => {
    const apiClient = {
      getRealtimePredictions: jest.fn(async () => remoteArrivalsFixture.realtimeUnsorted)
    };
    const { dataSource } = buildDataSource({ apiClient });

    const arrivals = await dataSource.getRealtimePredictions('STOP_100', '1A');

    expect(arrivals).toHaveLength(2);
    expect(arrivals.map((arrival) => arrival.etaMinutes)).toEqual([5, 8]);
    expect(arrivals.every((arrival) => arrival.predictionType === 'realtime')).toBe(true);
  });

  test('caches realtime responses to avoid repeated remote calls', async () => {
    const apiClient = {
      getRealtimePredictions: jest.fn(async () => remoteArrivalsFixture.realtimeUnsorted)
    };
    const { dataSource } = buildDataSource({ apiClient });

    const first = await dataSource.getRealtimePredictions('STOP_100', '1A');
    const second = await dataSource.getRealtimePredictions('STOP_100', '1A');

    expect(apiClient.getRealtimePredictions).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  test('falls back from realtime to scheduled in getStopArrivals', async () => {
    const apiClient = {
      getStopArrivals: jest.fn(async () => []),
      getRealtimePredictions: jest.fn(async () => []),
      getScheduledArrivals: jest.fn(async () => remoteArrivalsFixture.scheduledSingle)
    };
    const { dataSource } = buildDataSource({ apiClient });

    const arrivals = await dataSource.getStopArrivals('STOP_100');

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].predictionType).toBe('scheduled');
    expect(apiClient.getScheduledArrivals).toHaveBeenCalledWith('STOP_100', '1A');
  });

  test('prefers realtime arrivals when available', async () => {
    const apiClient = {
      getStopArrivals: jest.fn(async () => []),
      getRealtimePredictions: jest.fn(async () => remoteArrivalsFixture.realtimeUnsorted),
      getScheduledArrivals: jest.fn(async () => remoteArrivalsFixture.scheduledSingle)
    };
    const { dataSource } = buildDataSource({ apiClient });

    const arrivals = await dataSource.getStopArrivals('STOP_100');

    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals[0].predictionType).toBe('realtime');
    expect(apiClient.getScheduledArrivals).not.toHaveBeenCalled();
  });

  test('builds scheduled arrivals from headway when remote schedule is empty', async () => {
    const apiClient = {
      getScheduledArrivals: jest.fn(async () => [])
    };
    const { dataSource } = buildDataSource({ apiClient });

    const arrivals = await dataSource.getScheduledArrivals('STOP_100', '1A');

    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals[0].etaMinutes).toBe(0);
    expect(arrivals.every((arrival) => arrival.predictionType === 'inferred')).toBe(true);
    expect(arrivals.every((arrival) => arrival.source === 'fallback')).toBe(true);
    expect(arrivals.every((arrival) => arrival.reliabilityBand === 'degraded')).toBe(true);
  });

  test('returns an empty list on realtime timeout and logs the error', async () => {
    const apiClient = {
      getRealtimePredictions: jest.fn(() => new Promise(() => {}))
    };
    const logger = createLoggerMock();
    const { dataSource } = buildDataSource({
      apiClient,
      logger,
      resiliencePolicy: {
        timeoutsMs: {
          realtime: 15,
          scheduled: 20,
          staticLookup: 20
        }
      }
    });

    const arrivals = await dataSource.getRealtimePredictions('STOP_100', '1A');

    expect(arrivals).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test('deduplicates stop arrivals and avoids duplicate in-flight realtime calls for same key', async () => {
    const duplicatedLines = [
      linesCatalogFixture.lines[0],
      {
        ...linesCatalogFixture.lines[0]
      }
    ];
    const apiClient = {
      getStopArrivals: jest.fn(async () => []),
      getRealtimePredictions: jest.fn(async () => remoteArrivalsFixture.duplicateRealtime),
      getScheduledArrivals: jest.fn(async () => [])
    };
    const { dataSource } = buildDataSource({ apiClient, lines: duplicatedLines });

    const arrivals = await dataSource.getStopArrivals('STOP_100');

    expect(arrivals).toHaveLength(1);
    expect(apiClient.getRealtimePredictions).toHaveBeenCalledTimes(1);
  });

  test('marks scheduled fallback in getStopArrivals as non-official with caution', async () => {
    const apiClient = {
      getStopArrivals: jest.fn(async () => []),
      getRealtimePredictions: jest.fn(async () => []),
      getScheduledArrivals: jest.fn(async () => remoteArrivalsFixture.scheduledSingle)
    };
    const { dataSource } = buildDataSource({ apiClient });

    const arrivals = await dataSource.getStopArrivals('STOP_100');

    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.every((arrival) => arrival.source !== 'official')).toBe(true);
    expect(arrivals.every((arrival) => arrival.reliabilityBand === 'caution')).toBe(true);
  });
});
