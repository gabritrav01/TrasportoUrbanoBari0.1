'use strict';

const { createMemoryCacheAdapter } = require('../../services/providers/amtab/cacheAdapter');

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

describe('AMTAB memory cache adapter', () => {
  test('supports stale-if-error within stale window', async () => {
    let nowMs = 0;
    const cache = createMemoryCacheAdapter({
      now: () => nowMs,
      logger: createSilentLogger()
    });
    const cachePolicy = {
      ttlMs: 100,
      staleIfErrorTtlMs: 300,
      negativeTtlMs: 20,
      isNegativeValue: (value) => Array.isArray(value) && value.length === 0
    };

    const seed = await cache.getOrSet('stops:search:centro', async () => ['stop-1'], cachePolicy);
    expect(seed).toEqual(['stop-1']);

    nowMs = 150;
    const staleValue = await cache.getOrSet(
      'stops:search:centro',
      async () => {
        throw Object.assign(new Error('upstream down'), { code: 'UPSTREAM_DOWN' });
      },
      cachePolicy
    );
    expect(staleValue).toEqual(['stop-1']);

    nowMs = 450;
    await expect(
      cache.getOrSet(
        'stops:search:centro',
        async () => {
          throw Object.assign(new Error('still down'), { code: 'UPSTREAM_DOWN' });
        },
        cachePolicy
      )
    ).rejects.toMatchObject({ code: 'UPSTREAM_DOWN' });
  });

  test('deduplicates concurrent in-flight lookups for same key', async () => {
    const cache = createMemoryCacheAdapter({
      logger: createSilentLogger()
    });
    const cachePolicy = {
      ttlMs: 1000,
      staleIfErrorTtlMs: 0,
      negativeTtlMs: 50,
      inFlightDedupe: true,
      isNegativeValue: (value) => Array.isArray(value) && value.length === 0
    };
    let calls = 0;

    const factory = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ['line-2'];
    };

    const [a, b, c] = await Promise.all([
      cache.getOrSet('lines:search:2', factory, cachePolicy),
      cache.getOrSet('lines:search:2', factory, cachePolicy),
      cache.getOrSet('lines:search:2', factory, cachePolicy)
    ]);

    expect(calls).toBe(1);
    expect(a).toEqual(['line-2']);
    expect(b).toEqual(['line-2']);
    expect(c).toEqual(['line-2']);
  });

  test('applies negative cache ttl for empty array results', async () => {
    let nowMs = 0;
    const cache = createMemoryCacheAdapter({
      now: () => nowMs,
      logger: createSilentLogger()
    });
    const cachePolicy = {
      ttlMs: 1000,
      staleIfErrorTtlMs: 0,
      negativeTtlMs: 50,
      inFlightDedupe: true,
      isNegativeValue: (value) => Array.isArray(value) && value.length === 0
    };
    let calls = 0;

    const first = await cache.getOrSet(
      'arrivals:realtime:stop-a:line-1',
      async () => {
        calls += 1;
        return [];
      },
      cachePolicy
    );
    expect(first).toEqual([]);
    expect(calls).toBe(1);

    nowMs = 40;
    const withinNegativeTtl = await cache.getOrSet(
      'arrivals:realtime:stop-a:line-1',
      async () => {
        calls += 1;
        return ['unexpected'];
      },
      cachePolicy
    );
    expect(withinNegativeTtl).toEqual([]);
    expect(calls).toBe(1);

    nowMs = 60;
    const afterNegativeTtl = await cache.getOrSet(
      'arrivals:realtime:stop-a:line-1',
      async () => {
        calls += 1;
        return ['arrive-in-3'];
      },
      cachePolicy
    );
    expect(afterNegativeTtl).toEqual(['arrive-in-3']);
    expect(calls).toBe(2);
  });

  test('keeps compatibility with numeric ttl signature', async () => {
    let nowMs = 0;
    const cache = createMemoryCacheAdapter({
      now: () => nowMs,
      logger: createSilentLogger()
    });

    const value = await cache.getOrSet('compat:key', async () => 'ok', 100);
    expect(value).toBe('ok');
    expect(cache.get('compat:key')).toBe('ok');

    nowMs = 120;
    expect(cache.get('compat:key')).toBeNull();
  });
});
