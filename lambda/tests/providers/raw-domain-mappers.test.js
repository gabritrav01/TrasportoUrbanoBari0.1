'use strict';

const { mapRawStopToStop } = require('../../services/providers/amtab/mappers/mapRawStopToStop');
const { mapRawLineToLine } = require('../../services/providers/amtab/mappers/mapRawLineToLine');
const { mapRawArrivalToArrival } = require('../../services/providers/amtab/mappers/mapRawArrivalToArrival');

const FIXED_NOW = Date.parse('2026-03-09T10:00:00.000Z');

describe('AMTAB raw -> domain mappers', () => {
  test('mapRawStopToStop maps verified official stop with full provenance fields', () => {
    const stop = mapRawStopToStop(
      {
        stopId: 'STOP_100',
        stopName: 'Stazione Centrale',
        stopCode: '100',
        coordinates: { lat: 41.1177, lon: 16.8697 }
      },
      {
        nowEpochMs: FIXED_NOW,
        referenceEpochMs: FIXED_NOW,
        source: 'official',
        sourceName: 'amtab_gtfs_static',
        verifiedOfficial: true
      }
    );

    expect(stop).not.toBeNull();
    expect(stop).toEqual(expect.objectContaining({
      id: 'STOP_100',
      name: 'Stazione Centrale',
      source: 'official',
      sourceName: 'amtab_gtfs_static',
      predictionType: 'scheduled'
    }));
    expect(typeof stop.confidence).toBe('number');
    expect(stop.freshness).toBeDefined();
    expect(stop.reliabilityBand).toBeDefined();
  });

  test('mapRawStopToStop downgrades non-verified official source to public', () => {
    const stop = mapRawStopToStop(
      {
        stopId: 'STOP_200',
        stopName: 'Policlinico'
      },
      {
        nowEpochMs: FIXED_NOW,
        source: 'official',
        verifiedOfficial: false
      }
    );

    expect(stop).not.toBeNull();
    expect(stop.source).toBe('public');
  });

  test('mapRawLineToLine maps route row and keeps metadata routeId', () => {
    const line = mapRawLineToLine(
      {
        route_id: 'R1',
        route_short_name: '1',
        route_long_name: 'Linea 1'
      },
      {
        nowEpochMs: FIXED_NOW,
        referenceEpochMs: FIXED_NOW,
        source: 'official',
        verifiedOfficial: true
      }
    );

    expect(line).not.toBeNull();
    expect(line).toEqual(expect.objectContaining({
      id: '1',
      code: '1',
      source: 'official',
      predictionType: 'scheduled'
    }));
    expect(line.metadata).toEqual(expect.objectContaining({
      routeId: 'R1'
    }));
  });

  test('mapRawArrivalToArrival maps realtime row to normalized Arrival', () => {
    const arrival = mapRawArrivalToArrival(
      {
        stopId: 'STOP_100',
        lineId: '1',
        destinationName: 'Stazione',
        predictedEpochMs: FIXED_NOW + 4 * 60 * 1000,
        scheduledEpochMs: FIXED_NOW + 3 * 60 * 1000,
        asOfEpochMs: FIXED_NOW,
        tripId: 'TRIP_10',
        vehicleId: 'BUS_10'
      },
      {
        nowEpochMs: FIXED_NOW,
        source: 'official',
        sourceName: 'amtab_gtfs_rt_tripupdates',
        verifiedOfficial: true
      }
    );

    expect(arrival).not.toBeNull();
    expect(arrival).toEqual(expect.objectContaining({
      stopId: 'STOP_100',
      lineId: '1',
      predictionType: 'realtime',
      source: 'official',
      sourceName: 'amtab_gtfs_rt_tripupdates'
    }));
    expect(typeof arrival.confidence).toBe('number');
    expect(arrival.freshness).toBeDefined();
    expect(arrival.reliabilityBand).toBeDefined();
  });

  test('mapRawArrivalToArrival does not allow official for inferred records', () => {
    const arrival = mapRawArrivalToArrival(
      {
        stopId: 'STOP_300',
        lineId: '3',
        destinationName: 'Campus',
        predictionType: 'inferred',
        scheduledEpochMs: FIXED_NOW + 10 * 60 * 1000,
        asOfEpochMs: FIXED_NOW
      },
      {
        nowEpochMs: FIXED_NOW,
        source: 'official',
        verifiedOfficial: true
      }
    );

    expect(arrival).not.toBeNull();
    expect(arrival.predictionType).toBe('inferred');
    expect(arrival.source).toBe('public');
  });

  test('mapRawArrivalToArrival returns null for missing mandatory fields', () => {
    const missingStop = mapRawArrivalToArrival(
      {
        lineId: '1',
        predictedEpochMs: FIXED_NOW + 5 * 60 * 1000
      },
      { nowEpochMs: FIXED_NOW }
    );
    const missingTimestamps = mapRawArrivalToArrival(
      {
        stopId: 'STOP_1',
        lineId: '1'
      },
      { nowEpochMs: FIXED_NOW }
    );

    expect(missingStop).toBeNull();
    expect(missingTimestamps).toBeNull();
  });
});
