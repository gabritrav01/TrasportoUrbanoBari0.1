'use strict';

const { createUserPreferencesRepository } = require('../repositories/userPreferencesRepository');
const { createTransitService } = require('../services/transitService');
const { createLocationService } = require('../services/locationService');
const { createGeocodingService } = require('../services/geocodingService');
const { createStopResolver } = require('../resolvers/stopResolver');
const { createDestinationResolver } = require('../resolvers/destinationResolver');
const { createLineResolver } = require('../resolvers/lineResolver');
const { createAmbiguityChoiceResolver } = require('../resolvers/ambiguityChoiceResolver');
const formatter = require('../utils/formatter');

let cachedCoreServices = null;

function getCoreServices() {
  if (cachedCoreServices) {
    return cachedCoreServices;
  }

  const transitService = createTransitService();
  const geocodingService = createGeocodingService();
  const locationService = createLocationService({
    geocodingService,
    transportService: transitService
  });
  const ambiguityChoiceResolver = createAmbiguityChoiceResolver();

  cachedCoreServices = {
    transitService,
    geocodingService,
    locationService,
    ambiguityChoiceResolver
  };

  return cachedCoreServices;
}

function buildRequestContainer(handlerInput) {
  const coreServices = getCoreServices();
  const userPreferencesRepository = createUserPreferencesRepository(handlerInput.attributesManager);

  return {
    repositories: {
      userPreferencesRepository
    },
    services: {
      transitService: coreServices.transitService,
      geocodingService: coreServices.geocodingService,
      locationService: coreServices.locationService
    },
    resolvers: {
      stopResolver: createStopResolver({
        transitService: coreServices.transitService,
        locationService: coreServices.locationService
      }),
      destinationResolver: createDestinationResolver({ transitService: coreServices.transitService }),
      lineResolver: createLineResolver({ transitService: coreServices.transitService }),
      ambiguityChoiceResolver: coreServices.ambiguityChoiceResolver
    },
    formatter
  };
}

module.exports = {
  buildRequestContainer
};
