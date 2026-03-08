'use strict';

const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_ACCURACY_METERS = 500;

function createGeolocationService() {
  function getCoordinates(handlerInput) {
    const geolocation = handlerInput.requestEnvelope && handlerInput.requestEnvelope.context
      ? handlerInput.requestEnvelope.context.Geolocation
      : null;

    if (!geolocation || !geolocation.coordinate) {
      return { ok: false, reason: 'not_available' };
    }

    const coordinate = geolocation.coordinate;
    const latitude = coordinate.latitudeInDegrees;
    const longitude = coordinate.longitudeInDegrees;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return { ok: false, reason: 'not_available' };
    }

    if (typeof coordinate.accuracyInMeters === 'number' && coordinate.accuracyInMeters > MAX_ACCURACY_METERS) {
      return { ok: false, reason: 'accuracy' };
    }

    if (geolocation.timestamp) {
      const sampleTs = Date.parse(geolocation.timestamp);
      if (!Number.isNaN(sampleTs) && Date.now() - sampleTs > MAX_AGE_MS) {
        return { ok: false, reason: 'stale' };
      }
    }

    return { ok: true, latitude, longitude };
  }

  return {
    getCoordinates
  };
}

module.exports = {
  createGeolocationService
};
