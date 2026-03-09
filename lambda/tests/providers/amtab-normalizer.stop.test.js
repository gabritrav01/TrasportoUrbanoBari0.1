'use strict';

const stopsFixture = require('../fixtures/stops.raw.json');
const { createAmtabNormalizer } = require('../../services/providers/amtab/normalizer');
const { normalizeStopShape } = require('../../services/providers/domain/providerShapes');

describe('AMTAB stop normalization', () => {
  const normalizer = createAmtabNormalizer();

  test('normalizes stop shape and clamps confidence', () => {
    const normalized = normalizer.normalizeStop(stopsFixture[0]);

    expect(normalized).toEqual(
      expect.objectContaining({
        id: 'STOP_001',
        name: 'Stazione Centrale',
        source: 'official',
        sourceName: 'amtab_primary',
        confidence: 1
      })
    );
    expect(normalized.aliases).toEqual(['centrale', 'stazione']);
    expect(normalized.lineIds).toEqual(['1', '1A']);
    expect(normalized.coordinates).toEqual({ lat: 41.117, lon: 16.8712 });
  });

  test('returns null when required stop fields are missing', () => {
    expect(normalizer.normalizeStop(stopsFixture[1])).toBeNull();
  });

  test('maps non-public source labels like cache to fallback', () => {
    const normalized = normalizeStopShape(stopsFixture[2]);
    expect(normalized.source).toBe('fallback');
  });

  test('searchText removes accents and punctuation', () => {
    expect(normalizer.searchText('  Stazióne-Centrale!!  ')).toBe('stazione centrale');
  });
});