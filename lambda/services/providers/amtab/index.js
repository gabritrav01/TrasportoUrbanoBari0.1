'use strict';

const { createAmtabApiClient } = require('./amtabApiClient');
const { createArrivalsDataSource } = require('./arrivalsDataSource');
const { createAmtabRealApiClient } = require('./clients/amtabApiClient');
const { createMemoryCacheAdapter } = require('./cacheAdapter');
const { createDestinationResolverAdapter } = require('./destinationResolverAdapter');
const { createLinesDataSource } = require('./linesDataSource');
const { createAmtabNormalizer } = require('./normalizer');
const { createRetryAdapter } = require('./retryAdapter');
const { createRoutePlanner } = require('./routePlanner');
const { createStopDataSource } = require('./stopDataSource');
const { createAmtabRealGateway } = require('./amtabRealGateway');
const csvParser = require('./parsers/csvParser');
const gtfsStaticScheduleParser = require('./parsers/gtfsStaticScheduleParser');
const arrivalsRawParser = require('./parsers/parseArrivalsRaw');
const rawDomainMappers = require('./mappers');
const stopsRawParser = require('./parsers/parseStopsRaw');
const zipParser = require('./parsers/zipParser');
const tripUpdatesParser = require('./parsers/tripUpdatesParser');
const providerShapes = require('../domain/providerShapes');
const { createArrivalNormalizer } = require('../domain/arrivalNormalizer');
const reliabilityScoring = require('../domain/reliabilityScoring');
const resilienceHelpers = require('./resilienceHelpers');

module.exports = {
  createAmtabApiClient,
  createArrivalsDataSource,
  createAmtabRealApiClient,
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
  createAmtabRealGateway,
  csvParser,
  gtfsStaticScheduleParser,
  rawDomainMappers,
  arrivalsRawParser,
  stopsRawParser,
  zipParser,
  tripUpdatesParser,
  providerShapes
};
