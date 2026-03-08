'use strict';

const { createTransportService } = require('./transportService');
const { createAmtabProvider } = require('./providers/amtabProvider');
const { createMoovitFallbackProvider } = require('./providers/moovitFallbackProvider');

function createTransitService() {
  const amtabProvider = createAmtabProvider({
    // TODO(AMTAB_CONFIG): valorizzare con endpoint/token ufficiali.
    apiBaseUrl: process.env.AMTAB_API_BASE_URL || '',
    apiKey: process.env.AMTAB_API_KEY || ''
  });

  const moovitFallbackProvider = createMoovitFallbackProvider({
    // TODO(MOOVIT_CONFIG): valorizzare solo se fallback realmente autorizzato.
    apiBaseUrl: process.env.MOOVIT_API_BASE_URL || '',
    apiKey: process.env.MOOVIT_API_KEY || ''
  });

  return createTransportService({
    primaryProvider: amtabProvider,
    fallbackProvider: moovitFallbackProvider
  });
}

module.exports = {
  createTransitService
};
