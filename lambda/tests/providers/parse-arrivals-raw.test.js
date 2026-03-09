'use strict';

const {
  parseArrivalsRaw,
  parseArrivalsRawWithReport
} = require('../../services/providers/amtab/parsers/parseArrivalsRaw');

function createLoggerMock() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}

describe('parseArrivalsRaw parser', () => {
  test('extracts coherent raw arrivals from TripUpdates-like payload', () => {
    const nowSec = Math.round(Date.parse('2026-03-09T10:00:00.000Z') / 1000);
    const payload = {
      Header: { Timestamp: nowSec },
      Entities: [
        {
          TripUpdate: {
            Trip: {
              RouteId: 'R1',
              TripId: 'TRIP_100',
              TripHeadsign: 'Stazione'
            },
            Vehicle: {
              Id: 'BUS_10'
            },
            StopTimeUpdate: [
              {
                StopId: 'STOP_100',
                Arrival: {
                  Time: nowSec + 300,
                  ScheduledTime: nowSec + 240
                }
              }
            ]
          }
        }
      ]
    };

    const records = parseArrivalsRaw(payload, {
      routeShortNameByRouteId: new Map([['R1', '1']]),
      stopIdFilter: 'STOP_100'
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(expect.objectContaining({
      stopId: 'STOP_100',
      lineId: '1',
      lineNumber: '1',
      routeId: 'R1',
      destinationName: 'Stazione',
      recordType: 'realtime',
      vehicleId: 'BUS_10',
      tripId: 'TRIP_100'
    }));
    expect(typeof records[0].realtimeEpochMs).toBe('number');
    expect(typeof records[0].scheduledEpochMs).toBe('number');
  });

  test('handles mixed timestamp formats in direct raw rows', () => {
    const referenceEpochMs = Date.parse('2026-03-09T10:00:00.000Z');
    const rows = [
      {
        stopId: 'STOP_200',
        lineId: '2',
        destination: 'Policlinico',
        predicted_time: '2026-03-09T10:05:00Z',
        scheduled_time: '1773050580',
        as_of_epoch_ms: referenceEpochMs
      },
      {
        stop_id: 'STOP_200',
        line_number: '2',
        headsign: 'Policlinico',
        realtimeEpochMs: referenceEpochMs + 7 * 60 * 1000,
        scheduledEpochMs: referenceEpochMs + 6 * 60 * 1000
      }
    ];

    const result = parseArrivalsRawWithReport({ rows }, {
      referenceEpochMs
    });

    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((record) => typeof record.realtimeEpochMs === 'number')).toBe(true);
  });

  test('logs and discards records with missing stop/line/timestamps', () => {
    const logger = createLoggerMock();
    const rows = [
      { lineId: '1', destination: 'A', predicted_time: 1773072000 },
      { stopId: 'STOP_1', destination: 'A', predicted_time: 1773072000 },
      { stopId: 'STOP_1', lineId: '1' }
    ];

    const result = parseArrivalsRawWithReport({ rows }, { logger });

    expect(result.records).toHaveLength(0);
    expect(result.discarded).toHaveLength(3);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('deduplicates duplicate arrivals and keeps most complete record', () => {
    const nowEpochMs = Date.parse('2026-03-09T10:00:00.000Z');
    const rows = [
      {
        stopId: 'STOP_DUP',
        lineId: '10',
        destination: 'Campus',
        realtimeEpochMs: nowEpochMs + 6 * 60 * 1000
      },
      {
        stopId: 'STOP_DUP',
        lineId: '10',
        destination: 'Campus',
        realtimeEpochMs: nowEpochMs + 6 * 60 * 1000,
        tripId: 'TRIP_10',
        vehicleId: 'BUS_33',
        scheduledEpochMs: nowEpochMs + 5 * 60 * 1000
      }
    ];

    const result = parseArrivalsRawWithReport({ rows }, {
      referenceEpochMs: nowEpochMs
    });

    expect(result.records).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
    expect(result.records[0].tripId).toBe('TRIP_10');
    expect(result.records[0].vehicleId).toBe('BUS_33');
  });

  test('flags contradictory duplicate records with large timestamp drift', () => {
    const nowEpochMs = Date.parse('2026-03-09T10:00:00.000Z');
    const rows = [
      {
        stopId: 'STOP_CONFLICT',
        lineId: '6',
        destination: 'Poggiofranco',
        realtimeEpochMs: nowEpochMs + 5 * 60 * 1000,
        tripId: 'TRIP_X'
      },
      {
        stopId: 'STOP_CONFLICT',
        lineId: '6',
        destination: 'Poggiofranco',
        realtimeEpochMs: nowEpochMs + 25 * 60 * 1000,
        tripId: 'TRIP_X'
      }
    ];

    const result = parseArrivalsRawWithReport({ rows }, {
      referenceEpochMs: nowEpochMs,
      contradictionThresholdMs: 8 * 60 * 1000
    });

    expect(result.records).toHaveLength(1);
    expect(result.contradictions.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });

  test('parses HH:mm with service timezone and rolls over past midnight', () => {
    const rows = [
      {
        stopId: 'STOP_CLOCK',
        lineId: 'C1',
        scheduled_time: '00:10',
        asOfEpochMs: '2026-03-09T22:50:00.000Z'
      }
    ];

    const result = parseArrivalsRawWithReport(
      { rows },
      {
        serviceDate: '2026-03-09',
        serviceTimeZone: 'Europe/Rome',
        referenceEpochMs: Date.parse('2026-03-09T22:50:00.000Z')
      }
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0].scheduledEpochMs).toBe(Date.parse('2026-03-09T23:10:00.000Z'));
  });

  test('HH:mm and full ISO yield same scheduled epoch', () => {
    const referenceEpochMs = Date.parse('2026-03-09T10:00:00.000Z');
    const context = {
      serviceDate: '2026-03-09',
      serviceTimeZone: 'Europe/Rome',
      referenceEpochMs
    };

    const clock = parseArrivalsRawWithReport(
      {
        rows: [
          {
            stopId: 'STOP_MATCH',
            lineId: 'M1',
            scheduled_time: '12:30',
            asOfEpochMs: referenceEpochMs
          }
        ]
      },
      context
    );
    const iso = parseArrivalsRawWithReport(
      {
        rows: [
          {
            stopId: 'STOP_MATCH',
            lineId: 'M1',
            scheduled_time: '2026-03-09T12:30:00+01:00',
            asOfEpochMs: referenceEpochMs
          }
        ]
      },
      context
    );

    expect(clock.records).toHaveLength(1);
    expect(iso.records).toHaveLength(1);
    expect(clock.records[0].scheduledEpochMs).toBe(iso.records[0].scheduledEpochMs);
  });
});
