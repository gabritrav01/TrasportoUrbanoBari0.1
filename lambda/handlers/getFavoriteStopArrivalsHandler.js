'use strict';

const Alexa = require('ask-sdk-core');
const { DEFAULT_FAVORITE_LABEL } = require('../config/constants');
const { getSlotValue } = require('../utils/slotUtils');
const { executeGetFavoriteStopArrivals } = require('./actionExecutors');
const { normalizeFavoriteLabel } = require('./handlerUtils');

const GetFavoriteStopArrivalsIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetFavoriteStopArrivalsIntent'
    );
  },
  async handle(handlerInput) {
    const favoriteLabel = normalizeFavoriteLabel(getSlotValue(handlerInput, 'favoriteLabel') || DEFAULT_FAVORITE_LABEL);
    return executeGetFavoriteStopArrivals({
      handlerInput,
      favoriteLabel
    });
  }
};

module.exports = {
  GetFavoriteStopArrivalsIntentHandler
};
