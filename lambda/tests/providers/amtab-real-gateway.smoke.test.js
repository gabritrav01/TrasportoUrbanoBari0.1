'use strict';

const { createAmtabRealGateway } = require('../../services/providers/amtab/amtabRealGateway');
const { createAmtabProvider } = require('../../services/providers/amtabProvider');

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
    'R1,1,Linea 1'
  ].join('\n');

  const tripsCsv = [
    'route_id,service_id,trip_id,trip_headsign,direction_id',
    'R1,SVC_WEEKDAY,TRIP_SCHED_1,Centro,0',
    'R1,SVC_WEEKDAY,TRIP_SCHED_2,Centro,0'
  ].join('\n');

  const stopTimesCsv = [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence',
    'TRIP_SCHED_1,11:06:00,11:06:00,STOP_1,1',
    'TRIP_SCHED_2,11:12:00,11:12:00,STOP_1,1'
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

describe('AMTAB real gateway smoke', () => {
  test('fetchStopsRaw returns GTFS stops rows from official source', async () => {
    const gtfsArchive = createGtfsArchiveFixture();
    const fetchFn = jest.fn(async (url) => {
      if (url.includes('google_transit.zip')) {
        return createBinaryResponse(gtfsArchive);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const gateway = createAmtabRealGateway({
      fetchFn,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    const stopsRaw = await gateway.fetchStopsRaw();

    expect(stopsRaw.source).toBe('official');
    expect(stopsRaw.sourceName).toBe('amtab_gtfs_static');
    expect(stopsRaw.rows.length).toBeGreaterThan(0);
    expect(stopsRaw.rows[0].stopId).toBe('STOP_1');
    expect(stopsRaw.rows[0].stopName).toBe('Stazione Centrale');
  });

  test('fetchTripUpdatesRaw and fetchArrivalsRaw expose coherent raw entities for a stop', async () => {
    const gtfsArchive = createGtfsArchiveFixture();
    const tripUpdatePayload = {
      Header: {
        Timestamp: Math.round(FIXED_NOW / 1000)
      },
      Entities: [
        {
          TripUpdate: {
            Trip: {
              RouteId: 'R1',
              TripId: 'TRIP_1',
              TripHeadsign: 'Stazione Centrale'
            },
            StopTimeUpdate: [
              {
                StopId: 'STOP_1',
                Arrival: {
                  Time: Math.round((FIXED_NOW + 5 * 60 * 1000) / 1000)
                }
              }
            ]
          }
        }
      ]
    };

    const fetchFn = jest.fn(async (url) => {
      if (url.includes('google_transit.zip')) {
        return createBinaryResponse(gtfsArchive);
      }
      if (url.includes('TripUpdates')) {
        return createJsonResponse(tripUpdatePayload);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const gateway = createAmtabRealGateway({
      fetchFn,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    const tripUpdatesRaw = await gateway.fetchTripUpdatesRaw();
    const arrivalsRaw = await gateway.fetchArrivalsRaw('STOP_1');
    const arrivals = await gateway.getRealtimePredictions('STOP_1', '1');

    expect(Array.isArray(tripUpdatesRaw.entities)).toBe(true);
    expect(arrivalsRaw.sourceName).toBe('amtab_gtfs_rt_tripupdates');
    expect(arrivalsRaw.rows).toHaveLength(1);
    expect(arrivalsRaw.rows[0].stopId).toBe('STOP_1');
    expect(arrivalsRaw.rows[0].lineId).toBe('1');
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].stopId).toBe('STOP_1');
    expect(arrivals[0].lineId).toBe('1');
    expect(arrivals[0].predictionType).toBe('realtime');
    expect(arrivals[0].source).toBe('official');
    expect(arrivals[0].sourceName).toBe('amtab_gtfs_rt_tripupdates');
    expect(typeof arrivals[0].confidence).toBe('number');
    expect(arrivals[0].freshness).toBeDefined();
    expect(arrivals[0].reliabilityBand).toBeDefined();
  });

  test('getScheduledArrivals derives official scheduled results from GTFS static stop_times', async () => {
    const gtfsArchive = createGtfsArchiveFixture();
    const tripUpdatePayload = {
      Header: {
        Timestamp: Math.round(FIXED_NOW / 1000)
      },
      Entities: []
    };

    const fetchFn = jest.fn(async (url) => {
      if (url.includes('google_transit.zip')) {
        return createBinaryResponse(gtfsArchive);
      }
      if (url.includes('TripUpdates')) {
        return createJsonResponse(tripUpdatePayload);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

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
    expect(scheduled.some((entry) => entry.reliabilityBand === 'caution' || entry.reliabilityBand === 'direct')).toBe(true);
  });

  test('fails explicitly on real source error and provider falls back to stub without official source', async () => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    };
    const fetchFn = jest.fn(async () => {
      throw new Error('network_down');
    });
    const gateway = createAmtabRealGateway({
      fetchFn,
      logger,
      now: () => FIXED_NOW,
      stopsFeedUrl: 'https://www.amtabservizio.it/gtfs/google_transit.zip',
      tripUpdatesUrl: 'https://avl.amtab.it/WSExportGTFS_RT/api/gtfs/TripUpdates'
    });

    await expect(gateway.fetchStopsRaw()).rejects.toMatchObject({
      code: expect.stringMatching(/^AMTAB_REAL_/)
    });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const provider = createAmtabProvider({
        defaultSource: 'official',
        defaultSourceName: 'amtab_primary',
        searchStops: () => gateway.searchStops('stazione')
      });

      const stops = await provider.searchStops('stazione');
      expect(stops.length).toBeGreaterThan(0);
      expect(stops.every((stop) => stop.source !== 'official')).toBe(true);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
