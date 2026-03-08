'use strict';

const { isNearbyReference } = require('../utils/slotUtils');
const {
  resolveStopQuery
} = require('./semanticResolver');

function createStopResolver({ transitService, locationService }) {
  async function resolveNearby(handlerInput) {
    const nearby = await locationService.getNearbyStopsFromDeviceAddress(handlerInput, { limit: 3 });
    if (nearby.status === 'permission_required') {
      return { status: 'nearby_unavailable', reason: 'permission_required' };
    }
    if (nearby.status === 'unavailable') {
      return { status: 'nearby_unavailable', reason: nearby.reason };
    }
    if (nearby.status === 'not_found') {
      return { status: 'not_found' };
    }
    if (nearby.status === 'ambiguous') {
      return {
        status: 'ambiguous',
        options: (nearby.candidates || []).map((candidate) => ({
          id: candidate.stop.id,
          name:
            typeof candidate.distanceMeters === 'number'
              ? `${candidate.stop.name} a circa ${candidate.distanceMeters} metri`
              : candidate.stop.name
        }))
      };
    }

    return {
      status: 'resolved',
      stop: nearby.stop,
      metadata: {
        distanceMeters: nearby.distanceMeters
      }
    };
  }

  async function resolveByName(handlerInput, stopName) {
    if (!stopName) {
      return { status: 'missing' };
    }

    if (isNearbyReference(stopName)) {
      return resolveNearby(handlerInput);
    }

    const semanticResult = await resolveStopQuery(stopName, {
      searchStops: (query) => transitService.searchStops(query),
      getStopById: (stopId) => transitService.getStopById(stopId),
      nearbyStopIds: []
    });

    if (semanticResult.status === 'not_found') {
      return { status: 'not_found' };
    }

    if (semanticResult.status === 'ambiguous') {
      return {
        status: 'ambiguous',
        options: semanticResult.options,
        prompt: semanticResult.clarificationPrompt
      };
    }

    const resolvedStop = semanticResult.match && semanticResult.match.rawCandidate ? semanticResult.match.rawCandidate : null;
    if (!resolvedStop) {
      return { status: 'not_found' };
    }

    return {
      status: 'resolved',
      stop: resolvedStop,
      score: semanticResult.score
    };
  }

  return {
    resolveByName,
    resolveNearby
  };
}

module.exports = {
  createStopResolver
};
