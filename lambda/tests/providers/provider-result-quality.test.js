'use strict';

const { createProviderResult } = require('../../services/providers/domain/providerShapes');

const FIXED_NOW = Date.parse('2026-03-09T10:00:00.000Z');

describe('ProviderResult quality scoring', () => {
  test('hydrates missing quality fields and keeps official realtime as direct when coherent', () => {
    const result = createProviderResult({
      ok: true,
      source: 'official',
      sourceName: 'amtab_gtfs_rt_tripupdates',
      predictionType: 'realtime',
      fetchedAtEpochMs: FIXED_NOW,
      data: [
        {
          stopId: 'STOP_100',
          lineId: '1',
          confidence: 0.92,
          freshness: {
            ageSec: 5,
            freshnessScore: 0.96,
            bucket: 'fresh'
          },
          reliabilityBand: 'direct'
        }
      ]
    });

    expect(result.source).toBe('official');
    expect(result.predictionType).toBe('realtime');
    expect(typeof result.confidence).toBe('number');
    expect(result.freshness).toBeDefined();
    expect(result.reliabilityBand).toBe('direct');
  });

  test('forces inferred provider results to degraded when not discarded', () => {
    const result = createProviderResult({
      ok: true,
      source: 'public',
      sourceName: 'derived_headway',
      predictionType: 'inferred',
      confidence: 0.85,
      data: [
        {
          stopId: 'STOP_200',
          lineId: '2',
          confidence: 0.8,
          freshness: {
            ageSec: 80,
            freshnessScore: 0.55,
            bucket: 'aging'
          }
        }
      ]
    });

    expect(result.reliabilityBand).toBe('degraded');
  });

  test('does not promote empty results to direct', () => {
    const result = createProviderResult({
      ok: true,
      source: 'official',
      predictionType: 'realtime',
      confidence: 0.95,
      data: []
    });

    expect(result.reliabilityBand).not.toBe('direct');
    expect(result.reliabilityBand).toBe('caution');
  });
});
