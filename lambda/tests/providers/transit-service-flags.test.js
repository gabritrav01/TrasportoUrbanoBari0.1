'use strict';

describe('TransitService runtime flags', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.TRANSPORT_DATA_MODE;
    delete process.env.MOOVIT_FALLBACK_ENABLED;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('does not instantiate Moovit when MOOVIT_FALLBACK_ENABLED is false', () => {
    process.env.TRANSPORT_DATA_MODE = 'stub';
    process.env.MOOVIT_FALLBACK_ENABLED = 'false';

    const createTransportServiceMock = jest.fn(() => ({ id: 'transport-service' }));
    const createAmtabProviderMock = jest.fn(() => ({ providerName: 'amtab-provider' }));
    const createMoovitFallbackProviderMock = jest.fn(() => ({ providerName: 'moovit-fallback-provider' }));

    jest.doMock('../../services/transportService', () => ({
      createTransportService: createTransportServiceMock
    }));
    jest.doMock('../../services/providers/amtabProvider', () => ({
      createAmtabProvider: createAmtabProviderMock
    }));
    jest.doMock('../../services/providers/moovitFallbackProvider', () => ({
      createMoovitFallbackProvider: createMoovitFallbackProviderMock
    }));

    const { createTransitService } = require('../../services/transitService');
    createTransitService();

    expect(createMoovitFallbackProviderMock).not.toHaveBeenCalled();
    expect(createAmtabProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultSource: 'fallback',
      defaultSourceName: 'amtab_stub_local'
    }));
    expect(createTransportServiceMock).toHaveBeenCalledWith(expect.objectContaining({
      fallbackProvider: null
    }));
  });

  test('uses official AMTAB source and enables Moovit only when flag is true', () => {
    process.env.TRANSPORT_DATA_MODE = 'amtab_real';
    process.env.MOOVIT_FALLBACK_ENABLED = 'true';

    const createTransportServiceMock = jest.fn(() => ({ id: 'transport-service' }));
    const createAmtabProviderMock = jest.fn(() => ({ providerName: 'amtab-provider' }));
    const createMoovitFallbackProviderMock = jest.fn(() => ({ providerName: 'moovit-fallback-provider' }));

    jest.doMock('../../services/transportService', () => ({
      createTransportService: createTransportServiceMock
    }));
    jest.doMock('../../services/providers/amtabProvider', () => ({
      createAmtabProvider: createAmtabProviderMock
    }));
    jest.doMock('../../services/providers/moovitFallbackProvider', () => ({
      createMoovitFallbackProvider: createMoovitFallbackProviderMock
    }));

    const { createTransitService } = require('../../services/transitService');
    createTransitService();

    expect(createAmtabProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultSource: 'official',
      defaultSourceName: 'amtab_primary'
    }));
    expect(createMoovitFallbackProviderMock).toHaveBeenCalledTimes(1);
    expect(createTransportServiceMock).toHaveBeenCalledWith(expect.objectContaining({
      primaryProvider: expect.any(Object),
      fallbackProvider: expect.any(Object)
    }));
  });
});

