'use strict';

const { LaunchRequestHandler } = require('./launchRequestHandler');
const { ClarificationGuardHandler } = require('./clarificationGuardHandler');
const { ResolveAmbiguityIntentHandler } = require('./resolveAmbiguityHandler');
const { NextArrivalsByStopIntentHandler } = require('./nextArrivalsByStopHandler');
const { NextArrivalsByNearbyIntentHandler } = require('./nextArrivalsByNearbyHandler');
const { RoutesToDestinationIntentHandler } = require('./routesToDestinationHandler');
const { LineDirectionArrivalsIntentHandler } = require('./lineDirectionArrivalsHandler');
const { SaveFavoriteStopIntentHandler } = require('./saveFavoriteStopHandler');
const { GetFavoriteStopArrivalsIntentHandler } = require('./getFavoriteStopArrivalsHandler');
const { SetResponseModeIntentHandler } = require('./setResponseModeHandler');
const { AMTABHelpExamplesHandler } = require('./amtabHelpExamplesHandler');
const {
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  FallbackIntentHandler,
  RepeatIntentHandler,
  NavigateHomeIntentHandler
} = require('./builtInHandlers');
const { SessionEndedRequestHandler } = require('./sessionEndedHandler');
const { ErrorHandler } = require('./errorHandler');

const requestHandlers = [
  LaunchRequestHandler,
  ClarificationGuardHandler,
  ResolveAmbiguityIntentHandler,
  NextArrivalsByStopIntentHandler,
  NextArrivalsByNearbyIntentHandler,
  RoutesToDestinationIntentHandler,
  LineDirectionArrivalsIntentHandler,
  SaveFavoriteStopIntentHandler,
  GetFavoriteStopArrivalsIntentHandler,
  SetResponseModeIntentHandler,
  AMTABHelpExamplesHandler,
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  RepeatIntentHandler,
  NavigateHomeIntentHandler,
  FallbackIntentHandler,
  SessionEndedRequestHandler
];

const errorHandlers = [ErrorHandler];

module.exports = {
  requestHandlers,
  errorHandlers
};
