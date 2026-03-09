'use strict';

const { createAmtabApiClient } = require('./amtabApiClient');
const { createArrivalsDataSource } = require('./arrivalsDataSource');
const { createMemoryCacheAdapter } = require('./cacheAdapter');
const { createDestinationResolverAdapter } = require('./destinationResolverAdapter');
const { createLinesDataSource } = require('./linesDataSource');
const { createAmtabNormalizer } = require('./normalizer');
const { createRetryAdapter } = require('./retryAdapter');
const { createRoutePlanner } = require('./routePlanner');
const { createStopDataSource } = require('./stopDataSource');
const providerShapes = require('../domain/providerShapes');
const { createArrivalNormalizer } = require('../domain/arrivalNormalizer');
const reliabilityScoring = require('../domain/reliabilityScoring');
const resilienceHelpers = require('./resilienceHelpers');

module.exports = {
  createAmtabApiClient,
  createArrivalsDataSource,
  createArrivalNormalizer,
  createMemoryCacheAdapter,
  createDestinationResolverAdapter,
  createLinesDataSource,
  createAmtabNormalizer,
  createRetryAdapter,
  resilienceHelpers,
  reliabilityScoring,
  createRoutePlanner,
  createStopDataSource,
  providerShapes
};
