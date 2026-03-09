'use strict';

const formatter = require('../../utils/formatter');
const { RESPONSE_MODES } = require('../../config/constants');

describe('Formatter reliability disclaimers', () => {
  test('does not add disclaimer for direct official realtime data', () => {
    const speech = formatter.formatArrivalsByStop({
      stop: { id: 'STOP_1', name: 'Fermata Test' },
      arrivals: [
        {
          lineId: '1',
          destinationName: 'Centro',
          minutes: [2, 6],
          reliabilityBand: 'direct',
          confidence: 0.93,
          source: 'official',
          predictionType: 'realtime',
          freshness: {
            ageSec: 5,
            freshnessScore: 0.96,
            bucket: 'fresh'
          }
        }
      ],
      responseMode: RESPONSE_MODES.FULL,
      nearby: false
    });

    expect(speech).not.toContain('Nota:');
  });

  test('adds fallback disclaimer for non-official scheduled data', () => {
    const speech = formatter.formatArrivalsByStop({
      stop: { id: 'STOP_1', name: 'Fermata Test' },
      arrivals: [
        {
          lineId: '1',
          destinationName: 'Centro',
          minutes: [4],
          reliabilityBand: 'disclaimer',
          confidence: 0.7,
          source: 'fallback',
          predictionType: 'scheduled',
          freshness: {
            ageSec: 80,
            freshnessScore: 0.55,
            bucket: 'aging'
          }
        }
      ],
      responseMode: RESPONSE_MODES.FULL,
      nearby: false
    });

    expect(speech).toContain('Nota: stime da fonte secondaria');
  });
});

