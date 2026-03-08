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

const transitService = createTransitService();
const geocodingService = createGeocodingService();
const locationService = createLocationService({
  geocodingService,
  transportService: transitService
});
const ambiguityChoiceResolver = createAmbiguityChoiceResolver();

function buildRequestContainer(handlerInput) {
  const userPreferencesRepository = createUserPreferencesRepository(handlerInput.attributesManager);

  return {
    repositories: {
      userPreferencesRepository
    },
    services: {
      transitService,
      geocodingService,
      locationService
    },
    resolvers: {
      stopResolver: createStopResolver({ transitService, locationService }),
      destinationResolver: createDestinationResolver({ transitService }),
      lineResolver: createLineResolver({ transitService }),
      ambiguityChoiceResolver
    },
    formatter
  };
}

module.exports = {
  buildRequestContainer
};
