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

  test('adds caution disclaimer for scheduled official data', () => {
    const speech = formatter.formatArrivalsByStop({
      stop: { id: 'STOP_1', name: 'Fermata Test' },
      arrivals: [
        {
          lineId: '1',
          destinationName: 'Centro',
          minutes: [4],
          reliabilityBand: 'caution',
          confidence: 0.8,
          source: 'official',
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

    expect(speech).toContain('Nota: i tempi sono indicativi');
  });

  test('adds degraded disclaimer for inferred data', () => {
    const speech = formatter.formatArrivalsByStop({
      stop: { id: 'STOP_2', name: 'Fermata Degrado' },
      arrivals: [
        {
          lineId: '5',
          destinationName: 'Campus',
          minutes: [9],
          reliabilityBand: 'degraded',
          confidence: 0.5,
          source: 'fallback',
          predictionType: 'inferred',
          freshness: {
            ageSec: 100,
            freshnessScore: 0.4,
            bucket: 'aging'
          }
        }
      ],
      responseMode: RESPONSE_MODES.FULL,
      nearby: false
    });

    expect(speech).toContain('Nota: i tempi indicati sono una stima');
  });

  test('does not read discard entries as main result', () => {
    const speech = formatter.formatArrivalsByStop({
      stop: { id: 'STOP_3', name: 'Fermata Filtro' },
      arrivals: [
        {
          lineId: '99',
          destinationName: 'Deposito',
          minutes: [1],
          reliabilityBand: 'discard',
          confidence: 0.2,
          source: 'fallback',
          predictionType: 'inferred'
        },
        {
          lineId: '7',
          destinationName: 'Stazione',
          minutes: [6],
          reliabilityBand: 'caution',
          confidence: 0.7,
          source: 'official',
          predictionType: 'scheduled'
        }
      ],
      responseMode: RESPONSE_MODES.FULL,
      nearby: false
    });

    expect(speech).toContain('linea 7');
    expect(speech).not.toContain('linea 99');
    expect(speech).toContain('Ho escluso alcuni dati poco affidabili.');
  });

  test('treats missing reliability band as non-direct', () => {
    const speech = formatter.formatArrivalsByStop({
      stop: { id: 'STOP_4', name: 'Fermata SenzaBand' },
      arrivals: [
        {
          lineId: '3',
          destinationName: 'Centro',
          minutes: [5],
          confidence: 0.9,
          source: 'official',
          predictionType: 'scheduled'
        }
      ],
      responseMode: RESPONSE_MODES.FULL,
      nearby: false
    });

    expect(speech).toContain('Nota:');
    expect(speech).not.toContain('Nota: i tempi indicati sono una stima');
  });
});
