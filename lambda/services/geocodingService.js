'use strict';

function normalizeText(value) {
  return (value || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createGeocodingService() {
  async function geocodeDeviceAddress(deviceAddress) {
    if (!deviceAddress || typeof deviceAddress !== 'object') {
      return { ok: false, reason: 'address_not_available' };
    }

    // TODO(GEOCODING_REAL): integrare un provider reale di geocodifica (es. endpoint istituzionale o servizio terzo autorizzato).
    // TODO(GEOCODING_REAL): aggiungere gestione quote, retry con backoff, timeout e cache su indirizzi normalizzati.
    const city = normalizeText(deviceAddress.city);
    const postalCode = normalizeText(deviceAddress.postalCode);
    const country = normalizeText(deviceAddress.countryCode);

    // Stub prudenziale: coordinate del centro di Bari per abilitare i flussi di sviluppo.
    if (country === 'it' && (city.includes('bari') || /^701[0-9]{2}$/.test(postalCode))) {
      return {
        ok: true,
        latitude: 41.117143,
        longitude: 16.871871,
        source: 'stub_bari_city_center',
        confidence: 'low'
      };
    }

    return { ok: false, reason: 'geocode_failed' };
  }

  return {
    geocodeDeviceAddress
  };
}

module.exports = {
  createGeocodingService
};
