'use strict';

const {
  parseStopsRaw,
  parseStopsRawWithReport
} = require('../../services/providers/amtab/parsers/parseStopsRaw');

function createLoggerMock() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}

describe('parseStopsRaw parser', () => {
  test('maps valid raw payload into coherent raw stop records', () => {
    const payload = {
      rows: [
        {
          stop_id: 'STOP_100',
          stop_code: '100',
          stop_name: 'Stazione Centrale',
          stop_lat: '41.1177',
          stop_lon: '16.8697',
          direction: 'Centro',
          lato: 'A'
        }
      ]
    };

    const records = parseStopsRaw(payload);

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(expect.objectContaining({
      stopId: 'STOP_100',
      stopName: 'Stazione Centrale',
      stopCode: '100',
      direction: 'Centro',
      side: 'A',
      coordinates: {
        lat: 41.1177,
        lon: 16.8697
      }
    }));
  });

  test('discards records without mandatory fields and logs discarded records', () => {
    const logger = createLoggerMock();
    const payload = {
      rows: [
        {
          stop_name: 'Missing id',
          stop_lat: '41.1',
          stop_lon: '16.8'
        },
        {
          stop_id: 'STOP_200',
          stop_lat: '41.2',
          stop_lon: '16.9'
        },
        {
          stop_id: 'STOP_300',
          stop_name: 'Valid stop',
          stop_lat: '41.3',
          stop_lon: '16.7'
        }
      ]
    };

    const result = parseStopsRawWithReport(payload, { logger });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].stopId).toBe('STOP_300');
    expect(result.discarded).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('keeps record with missing coordinates but flags warning', () => {
    const result = parseStopsRawWithReport({
      rows: [
        {
          stop_id: 'STOP_400',
          stop_name: 'No coordinates'
        }
      ]
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].coordinates).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].issues).toContain('missing_coordinates');
  });

  test('deduplicates same stop id preserving most complete record', () => {
    const result = parseStopsRawWithReport({
      rows: [
        {
          stop_id: 'STOP_500',
          stop_name: 'Dup stop',
          stop_code: '500'
        },
        {
          stop_id: 'STOP_500',
          stop_name: 'Dup stop',
          stop_code: '500',
          stop_lat: '41.2001',
          stop_lon: '16.8001',
          direction: 'Nord'
        }
      ]
    });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].coordinates).toEqual({
      lat: 41.2001,
      lon: 16.8001
    });
    expect(result.records[0].direction).toBe('Nord');
  });
});

