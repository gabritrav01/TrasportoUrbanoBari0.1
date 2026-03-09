'use strict';

const { createAmtabRealGateway } = require('../../services/providers/amtab/amtabRealGateway');
const { createMemoryCacheAdapter } = require('../../services/providers/amtab/cacheAdapter');
const { createAmtabProvider } = require('../../services/providers/amtabProvider');
const { createGatewayError } = require('../../services/providers/amtab/clients/amtabApiClient');

const FIXED_NOW = Date.parse('2026-03-09T10:00:00.000Z');

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function createBinaryResponse(buffer) {
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return toArrayBuffer(buffer);
    }
  };
}

function createJsonResponse(value) {
  return createBinaryResponse(Buffer.from(JSON.stringify(value), 'utf8'));
}

function createStoredZip(entries) {
  let localOffset = 0;
  const localParts = [];
  const centralParts = [];

  entries.forEach((entry) => {
    const fileNameBuffer = Buffer.from(entry.fileName, 'utf8');
    const dataBuffer = Buffer.from(entry.content, 'utf8');

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(fileNameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, fileNameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(fileNameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    centralParts.push(centralHeader, fileNameBuffer);
    localOffset += localHeader.length + fileNameBuffer.length + dataBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function createGtfsArchiveFixture() {
  const stopsCsv = [
    'stop_id,stop_code,stop_name,stop_lat,stop_lon',
    'STOP_1,S1,Stazione Centrale,41.1177,16.8697',
    'STOP_2,S2,Policlinico,41.1104,16.8588'
  ].join('\n');
  const routesCsv = [
    'route_id,route_short_name,route_long_name',
    'R1,1,Linea 1',
    'R2,2,Linea 2'
  ].join('\n');
  const tripsCsv = [
    'route_id,service_id,trip_id,trip_headsign,direction_id',
    'R1,SVC_WEEKDAY,TRIP_SCHED_1,Centro,0',
    'R1,SVC_WEEKDAY,TRIP_SCHED_2,Centro,0',
    'R2,SVC_WEEKDAY,TRIP_SCHED_3,Policlinico,1'
  ].join('\n');
  const stopTimesCsv = [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'TRIP_SCHED_1,11:06:00,11:06:00,STOP_1,1',
    'TRIP_SCHED_2,11:12:00,11:12:00,STOP_1,1',
    'TRIP_SCHED_3,11:20:00,11:20:00,STOP_2,1'
  ].join('\n');
  const calendarCsv = [
    'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date',
    'SVC_WEEKDAY,1,1,1,1,1,0,0,20260101,20261231'
  ].join('\n');

  return createStoredZip([
    { fileName: 'stops.txt', content: stopsCsv },
    { fileName: 'routes.txt', content: routesCsv },
    { fileName: 'trips.txt', content: tripsCsv },
    { fileName: 'stop_times.txt', content: stopTimesCsv },
    { fileName: 'calendar.txt', content: calendarCsv }
  ]);
}

function createTripUpdatesPayload() {
  const nowSec = Math.round(FIXED_NOW / 1000);
  return {
    Header: {
      Timestamp: nowSec
    },
    Entities: [
      {
        TripUpdate: {
          Trip: {
            RouteId: 'R1',
            TripId: 'TRIP_R1_A',
            TripHeadsign: 'Centro'
          },
          StopTimeUpdate: [
            {
              StopId: 'STOP_1',
              Arrival: {
                Time: nowSec + 8 * 60
              }
            }
          ]
        }
      },
      {
        TripUpdate: {
          Trip: {
            RouteId: 'R1',
            TripId: 'TRIP_R1_B',
            TripHeadsign: 'Centro'
          },
          StopTimeUpdate: [
            {
              StopId: 'STOP_1',
              Arrival: {
                Time: nowSec + 4 * 60
              }
            }
          ]
        }
      },
      {
        TripUpdate: {
          Trip: {
            RouteId: 'R2',
            TripId: 'TRIP_R2',
            TripHeadsign: 'Policlinico'
          },
          StopTimeUpdate: [
            {
              StopId: 'STOP_2',
              Arrival: {
                Time: nowSec + 3 * 60
              }
            }
          ]
        }
      }
    ]
  };
}

function createFetchFixture() {
  const gtfsArchive = createGtfsArchiveFixture();
  const tripPayload = createTripUpdatesPayload();
  return jest.fn(async (url) => {
    if (url.includes('google_transit.zip')) {
      return createBinaryResponse(gtfsArchive);
    }
    if (url.includes('TripUpdates')) {
      return createJsonResponse(tripPayload);
    }
    throw new Error(`Unexpected URL in test fixture: ${url}`);
  });
}

function createLoggerMock() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}

function expectArrivalProvenanceShape(arrival) {
  expect(arrival).toEqual(
    expect.objectContaining({
      source: expect.any(String),
      sourceName: expect.any(String),
      predictionType: expect.any(String),
      confidence: expect.any(Number),
      reliabilityBand: expect.any(String),
      freshness: expect.any(Object)
    })
  );
  expect(arrival.confidence).toBeGreaterThanOrEqual(0);
  expect(arrival.confidence).toBeLessThanOrEqual(1);
}

function createProviderCatalogFixture() {
  return {
    stops: [
      {
        id: 'STOP_100',
        name: 'Stazione Centrale Test',
        aliases: ['stazione', 'centrale'],
        coordinates: { lat: 41.1177, lon: 16.8697 },
        lineIds: ['1A'],
        source: 'stub'
      }
    ],
    destinationTargets: [
      {
        id: 'DST_CENTRO',
        name: 'Centro',
        aliases: ['centro'],
        targetStopIds: ['STOP_100'],
        source: 'stub'
      }
    ],
    lines: [
      {
        id: '1A',
        aliases: ['linea 1A'],
        destinationTargetId: 'DST_CENTRO',
        destinationName: 'Centro',
        stopIds: ['STOP_100'],
        firstMinute: 300,
        lastMinute: 1410,
        headwayMinutes: 12,
        source: 'stub'
      }
    ]
  };
}

function createRealtimeFixture(stopId, lineId) {
  return [
    {
      stopId,
      lineId,
      destinationName: 'Centro',
      predictedTime: '2026-03-09T10:05:00Z',
      asOfEpochMs: '2026-03-09T10:00:00Z',
      source: 'official',
      sourceName: 'amtab_gtfs_rt_tripupdates',
      predictionType: 'realtime'
    }
  ];
}

describe('AMTAB real provider integration - gateway raw and normalized flows', () => {
  test('fetches real stops raw with official provenance from GTFS static zip', async () => {
    const fetchFn = createFetchFixture();
    const gateway = createAmtabRealGateway({
      fetchFn,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    const rawStops = await gateway.fetchStopsRaw();

    expect(rawStops.source).toBe('official');
    expect(rawStops.sourceName).toBe('amtab_gtfs_static');
    expect(rawStops.rows).toHaveLength(2);
    expect(rawStops.rows[0]).toEqual(
      expect.objectContaining({
        stopId: 'STOP_1',
        stopName: 'Stazione Centrale'
      })
    );
  });

  test('fetches real arrivals raw filtered by stop from GTFS-RT payload', async () => {
    const fetchFn = createFetchFixture();
    const gateway = createAmtabRealGateway({
      fetchFn,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    const rawArrivals = await gateway.fetchArrivalsRaw('STOP_1');

    expect(rawArrivals.source).toBe('official');
    expect(rawArrivals.sourceName).toBe('amtab_gtfs_rt_tripupdates');
    expect(rawArrivals.rows.length).toBeGreaterThan(0);
    expect(rawArrivals.rows.every((row) => row.stopId === 'STOP_1')).toBe(true);
  });

  test('maps raw arrivals to normalized shape with reliability scoring', async () => {
    const fetchFn = createFetchFixture();
    const gateway = createAmtabRealGateway({
      fetchFn,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    const arrivals = await gateway.getStopArrivals('STOP_1');

    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals[0]).toEqual(
      expect.objectContaining({
        stopId: 'STOP_1',
        lineId: '1'
      })
    );
    arrivals.forEach(expectArrivalProvenanceShape);
  });

  test('filters line direction arrivals and keeps eta sorted', async () => {
    const fetchFn = createFetchFixture();
    const gateway = createAmtabRealGateway({
      fetchFn,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    const arrivals = await gateway.getRealtimePredictions('STOP_1', '1');

    expect(arrivals).toHaveLength(2);
    expect(arrivals[0].etaMinutes).toBeLessThanOrEqual(arrivals[1].etaMinutes);
    expect(arrivals.every((entry) => entry.lineId === '1')).toBe(true);
    expect(arrivals.every((entry) => entry.predictionType === 'realtime')).toBe(true);
  });

  test('maps search stops to normalized stop shape with official source', async () => {
    const fetchFn = createFetchFixture();
    const gateway = createAmtabRealGateway({
      fetchFn,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    const stops = await gateway.searchStops('stazione');

    expect(stops.length).toBeGreaterThan(0);
    expect(stops[0]).toEqual(
      expect.objectContaining({
        id: 'STOP_1',
        source: 'official'
      })
    );
    expect(typeof stops[0].confidence).toBe('number');
    expect(stops[0].confidence).toBeGreaterThanOrEqual(0);
    expect(stops[0].confidence).toBeLessThanOrEqual(1);
  });

  test('derives scheduled arrivals from GTFS static and keeps official scheduled provenance', async () => {
    const fetchFn = createFetchFixture();
    const gateway = createAmtabRealGateway({
      fetchFn,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    const scheduled = await gateway.getScheduledArrivals('STOP_1', '1');

    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.every((entry) => entry.predictionType === 'scheduled')).toBe(true);
    expect(scheduled.every((entry) => entry.source === 'official')).toBe(true);
    expect(scheduled.every((entry) => entry.sourceName === 'amtab_gtfs_static')).toBe(true);
  });
});

describe('AMTAB real provider integration - fallback and provenance safety', () => {
  test('falls back to stub stop catalog with non-official provenance when real search fails', async () => {
    const searchStops = jest.fn(async () => {
      throw createGatewayError('AMTAB_REAL_GATEWAY_UNAVAILABLE', 'network_down');
    });
    const provider = createAmtabProvider({
      runtimeDataMode: 'amtab_real',
      defaultSource: 'official',
      defaultSourceName: 'amtab_primary',
      searchStops,
      catalog: createProviderCatalogFixture()
    });

    const stops = await provider.searchStops('stazione');

    expect(searchStops).toHaveBeenCalled();
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((stop) => stop.source !== 'official')).toBe(true);
  });

  test('falls back from realtime/scheduled failures to non-official arrivals', async () => {
    const getStopArrivals = jest.fn(async () => {
      throw createGatewayError('AMTAB_REAL_GATEWAY_UNAVAILABLE', 'arrivals_down');
    });
    const getRealtimePredictions = jest.fn(async () => {
      throw createGatewayError('AMTAB_REAL_GATEWAY_UNAVAILABLE', 'realtime_down');
    });
    const getScheduledArrivals = jest.fn(async () => {
      throw createGatewayError('AMTAB_REAL_GATEWAY_UNAVAILABLE', 'scheduled_down');
    });

    const provider = createAmtabProvider({
      runtimeDataMode: 'amtab_real',
      defaultSource: 'official',
      defaultSourceName: 'amtab_primary',
      getStopArrivals,
      getRealtimePredictions,
      getScheduledArrivals,
      catalog: createProviderCatalogFixture()
    });

    const arrivals = await provider.getStopArrivals('STOP_100');

    expect(arrivals.length).toBeGreaterThan(0);
    arrivals.forEach(expectArrivalProvenanceShape);
    expect(arrivals.every((entry) => entry.source !== 'official')).toBe(true);
    expect(arrivals.every((entry) => entry.reliabilityBand !== 'direct')).toBe(true);
  });

  test('keeps official provenance when realtime real hook succeeds', async () => {
    const getRealtimePredictions = jest.fn(async (stopId, lineId) =>
      createRealtimeFixture(stopId, lineId)
    );
    const provider = createAmtabProvider({
      runtimeDataMode: 'amtab_real',
      defaultSource: 'official',
      defaultSourceName: 'amtab_primary',
      getRealtimePredictions,
      catalog: createProviderCatalogFixture(),
      now: () => FIXED_NOW,
      maxAttempts: 2,
      retryBaseDelayMs: 0
    });

    const arrivals = await provider.getRealtimePredictions('STOP_100', '1A');

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].source).toBe('official');
    expect(arrivals[0].predictionType).toBe('realtime');
    expectArrivalProvenanceShape(arrivals[0]);
  });

  test('never exposes inferred records as official source', async () => {
    const getStopArrivals = jest.fn(async () => [
      {
        stopId: 'STOP_100',
        lineId: '1A',
        destinationName: 'Centro',
        predictionType: 'inferred',
        source: 'official',
        sourceName: 'amtab_gtfs_rt_tripupdates',
        predictedEpochMs: FIXED_NOW + 7 * 60 * 1000,
        asOfEpochMs: FIXED_NOW
      }
    ]);

    const provider = createAmtabProvider({
      runtimeDataMode: 'amtab_real',
      defaultSource: 'official',
      defaultSourceName: 'amtab_primary',
      getStopArrivals,
      catalog: createProviderCatalogFixture()
    });

    const arrivals = await provider.getStopArrivals('STOP_100');

    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.every((entry) => !(entry.predictionType === 'inferred' && entry.source === 'official'))).toBe(true);
  });
});

describe('AMTAB real provider integration - cache, stale-if-error, timeout and retry', () => {
  test('serves stale cache value if upstream fails within stale-if-error window', async () => {
    let nowMs = 0;
    const cache = createMemoryCacheAdapter({
      now: () => nowMs,
      logger: createLoggerMock()
    });
    const cachePolicy = {
      ttlMs: 100,
      staleIfErrorTtlMs: 200,
      negativeTtlMs: 20,
      inFlightDedupe: true,
      isNegativeValue: (value) => Array.isArray(value) && value.length === 0
    };

    const first = await cache.getOrSet('amtab:real:arrivals:STOP_1:1', async () => ['fresh'], cachePolicy);
    expect(first).toEqual(['fresh']);

    nowMs = 120;
    const stale = await cache.getOrSet(
      'amtab:real:arrivals:STOP_1:1',
      async () => {
        throw createGatewayError('AMTAB_REAL_GATEWAY_UNAVAILABLE', 'temporary_outage');
      },
      cachePolicy
    );
    expect(stale).toEqual(['fresh']);
  });

  test('deduplicates in-flight cache calls to protect real gateway', async () => {
    const cache = createMemoryCacheAdapter({
      logger: createLoggerMock()
    });
    const cachePolicy = {
      ttlMs: 1000,
      staleIfErrorTtlMs: 0,
      negativeTtlMs: 20,
      inFlightDedupe: true,
      isNegativeValue: (value) => Array.isArray(value) && value.length === 0
    };
    let calls = 0;

    const valueFactory = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ['ok'];
    };

    const [a, b, c] = await Promise.all([
      cache.getOrSet('amtab:real:stops:search:stazione', valueFactory, cachePolicy),
      cache.getOrSet('amtab:real:stops:search:stazione', valueFactory, cachePolicy),
      cache.getOrSet('amtab:real:stops:search:stazione', valueFactory, cachePolicy)
    ]);

    expect(calls).toBe(1);
    expect(a).toEqual(['ok']);
    expect(b).toEqual(['ok']);
    expect(c).toEqual(['ok']);
  });

  test('uses retry policy on transient realtime failures', async () => {
    let attempts = 0;
    const getRealtimePredictions = jest.fn(async (stopId, lineId) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('temporary');
        error.retryable = true;
        throw error;
      }
      return createRealtimeFixture(stopId, lineId);
    });

    const provider = createAmtabProvider({
      runtimeDataMode: 'amtab_real',
      defaultSource: 'official',
      defaultSourceName: 'amtab_primary',
      getRealtimePredictions,
      catalog: createProviderCatalogFixture(),
      now: () => FIXED_NOW,
      maxAttempts: 2,
      retryBaseDelayMs: 0,
      resiliencePolicy: {
        timeoutsMs: {
          realtime: 200,
          scheduled: 200,
          staticLookup: 200
        }
      }
    });

    const arrivals = await provider.getRealtimePredictions('STOP_100', '1A');

    expect(getRealtimePredictions).toHaveBeenCalledTimes(2);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].source).toBe('official');
  });

  test('returns empty result on realtime timeout and logs error', async () => {
    const logger = createLoggerMock();
    const getRealtimePredictions = jest.fn(() => new Promise(() => {}));
    const provider = createAmtabProvider({
      runtimeDataMode: 'amtab_real',
      defaultSource: 'official',
      defaultSourceName: 'amtab_primary',
      getRealtimePredictions,
      logger,
      catalog: createProviderCatalogFixture(),
      now: () => FIXED_NOW,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
      resiliencePolicy: {
        timeoutsMs: {
          realtime: 15,
          scheduled: 20,
          staticLookup: 20
        }
      }
    });

    const arrivals = await provider.getRealtimePredictions('STOP_100', '1A');

    expect(arrivals).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });
});
