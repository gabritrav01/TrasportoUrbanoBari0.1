'use strict';

const {
  hasDeviceAddressPermission
} = require('../utils/addressPermissionResponse');

const DEFAULT_NEARBY_LIMIT = 3;
const MAX_NEARBY_LIMIT = 5;
const DEFAULT_AMBIGUITY_DELTA_METERS = 180;

function hasUsableAddress(address) {
  if (!address || typeof address !== 'object') {
    return false;
  }

  const values = [
    address.addressLine1,
    address.addressLine2,
    address.addressLine3,
    address.city,
    address.postalCode,
    address.countryCode
  ];

  return values.some((value) => typeof value === 'string' && value.trim().length > 0);
}

function roundDistance(distanceMeters) {
  if (typeof distanceMeters !== 'number') {
    return null;
  }
  return Math.max(0, Math.round(distanceMeters));
}

function clampLimit(limit) {
  if (typeof limit !== 'number' || Number.isNaN(limit)) {
    return DEFAULT_NEARBY_LIMIT;
  }
  const integerLimit = Math.floor(limit);
  return Math.max(1, Math.min(MAX_NEARBY_LIMIT, integerLimit));
}

class LocationService {
  constructor({ geocodingService, transportService }) {
    this.geocodingService = geocodingService;
    this.transportService = transportService;
  }

  async getDeviceAddress(handlerInput) {
    const requestEnvelope = handlerInput.requestEnvelope || {};
    const system = requestEnvelope.context && requestEnvelope.context.System ? requestEnvelope.context.System : {};
    const device = system.device || {};
    const deviceId = device.deviceId;

    if (!deviceId) {
      return { status: 'unavailable', reason: 'device_not_available' };
    }

    if (!hasDeviceAddressPermission(handlerInput)) {
      return { status: 'permission_required' };
    }

    if (!handlerInput.serviceClientFactory || typeof handlerInput.serviceClientFactory.getDeviceAddressServiceClient !== 'function') {
      return { status: 'unavailable', reason: 'service_client_unavailable' };
    }

    try {
      const deviceAddressServiceClient = handlerInput.serviceClientFactory.getDeviceAddressServiceClient();
      const fullAddress = await deviceAddressServiceClient.getFullAddress(deviceId);
      if (!hasUsableAddress(fullAddress)) {
        return { status: 'unavailable', reason: 'address_not_available' };
      }

      return {
        status: 'resolved',
        address: {
          addressLine1: fullAddress.addressLine1 || '',
          addressLine2: fullAddress.addressLine2 || '',
          addressLine3: fullAddress.addressLine3 || '',
          city: fullAddress.city || '',
          stateOrRegion: fullAddress.stateOrRegion || '',
          postalCode: fullAddress.postalCode || '',
          countryCode: fullAddress.countryCode || ''
        }
      };
    } catch (error) {
      const statusCode = error && (error.statusCode || error.status);
      if (statusCode === 401 || statusCode === 403) {
        return { status: 'permission_required' };
      }
      if (statusCode === 204 || statusCode === 404) {
        return { status: 'unavailable', reason: 'address_not_available' };
      }

      console.error('Device address lookup failed', error);
      return { status: 'unavailable', reason: 'address_service_error' };
    }
  }

  async getAddressCoordinates(handlerInput) {
    const addressResult = await this.getDeviceAddress(handlerInput);
    if (addressResult.status !== 'resolved') {
      return addressResult;
    }

    const geocode = await this.geocodingService.geocodeDeviceAddress(addressResult.address);
    if (!geocode || !geocode.ok) {
      return {
        status: 'unavailable',
        reason: (geocode && geocode.reason) || 'geocode_failed'
      };
    }

    return {
      status: 'resolved',
      coordinates: {
        latitude: geocode.latitude,
        longitude: geocode.longitude
      },
      metadata: {
        geocodingSource: geocode.source || 'unknown',
        geocodingConfidence: geocode.confidence || 'unknown'
      }
    };
  }

  async getNearbyStopsFromDeviceAddress(handlerInput, options) {
    const opts = options || {};
    const limit = clampLimit(opts.limit);
    const ambiguityDeltaMeters =
      typeof opts.ambiguityDeltaMeters === 'number' ? opts.ambiguityDeltaMeters : DEFAULT_AMBIGUITY_DELTA_METERS;

    const coordinatesResult = await this.getAddressCoordinates(handlerInput);
    if (coordinatesResult.status !== 'resolved') {
      return coordinatesResult;
    }

    const nearestStops = await this.transportService.nearestStops(
      coordinatesResult.coordinates.latitude,
      coordinatesResult.coordinates.longitude
    );

    if (!nearestStops.length) {
      return { status: 'not_found' };
    }

    const candidates = nearestStops.slice(0, limit).map((entry) => ({
      stop: entry.stop,
      distanceMeters: roundDistance(entry.distanceMeters)
    }));

    const hasAmbiguousTopStops =
      candidates.length > 1 &&
      typeof candidates[0].distanceMeters === 'number' &&
      typeof candidates[1].distanceMeters === 'number' &&
      Math.abs(candidates[1].distanceMeters - candidates[0].distanceMeters) <= ambiguityDeltaMeters;

    if (hasAmbiguousTopStops) {
      return {
        status: 'ambiguous',
        candidates: candidates.slice(0, Math.min(3, candidates.length)),
        coordinates: coordinatesResult.coordinates,
        metadata: coordinatesResult.metadata
      };
    }

    return {
      status: 'resolved',
      stop: candidates[0].stop,
      distanceMeters: candidates[0].distanceMeters,
      candidates: candidates.slice(0, Math.min(3, candidates.length)),
      coordinates: coordinatesResult.coordinates,
      metadata: coordinatesResult.metadata
    };
  }
}

function createLocationService({ geocodingService, transportService }) {
  return new LocationService({ geocodingService, transportService });
}

module.exports = {
  LocationService,
  createLocationService
};
