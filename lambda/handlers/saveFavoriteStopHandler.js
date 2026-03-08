'use strict';

const Alexa = require('ask-sdk-core');
const { AMBIGUITY_KINDS, ACTIONS, DEFAULT_FAVORITE_LABEL } = require('../config/constants');
const { getSlotValue } = require('../utils/slotUtils');
const sessionState = require('../utils/sessionState');
const { speak } = require('../utils/response');
const { getContainer, normalizeFavoriteLabel, handleNearbyUnavailable } = require('./handlerUtils');
const { executeSaveFavoriteStop } = require('./actionExecutors');

const SaveFavoriteStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'SaveFavoriteStopIntent'
    );
  },
  async handle(handlerInput) {
    const stopName = getSlotValue(handlerInput, 'stopName');
    const favoriteLabel = normalizeFavoriteLabel(getSlotValue(handlerInput, 'favoriteLabel') || DEFAULT_FAVORITE_LABEL);

    const { resolvers, services, formatter } = getContainer(handlerInput);

    if (!stopName) {
      const lastStopId = sessionState.getLastResolvedStopId(handlerInput);
      if (lastStopId) {
        const lastStop = services.transitService.getStopById(lastStopId);
        if (lastStop) {
          return executeSaveFavoriteStop({ handlerInput, stop: lastStop, favoriteLabel });
        }
      }
      return speak(handlerInput, 'Dimmi quale fermata vuoi salvare.', 'Ad esempio: salva stazione come casa.');
    }

    const stopResolution = await resolvers.stopResolver.resolveByName(handlerInput, stopName);
    if (stopResolution.status === 'not_found') {
      return speak(handlerInput, `Non trovo la fermata ${stopName}.`, 'Prova con stazione, universita o policlinico.');
    }
    if (stopResolution.status === 'nearby_unavailable') {
      return handleNearbyUnavailable(handlerInput, stopResolution.reason, 'Dimmi una fermata specifica.');
    }
    if (stopResolution.status === 'ambiguous') {
      sessionState.setPendingAmbiguity(handlerInput, {
        kind: AMBIGUITY_KINDS.STOP,
        action: ACTIONS.SAVE_FAVORITE_STOP,
        options: stopResolution.options,
        context: {
          favoriteLabel
        }
      });
      const prompt = formatter.formatAmbiguityPrompt('la fermata', stopResolution.options);
      return speak(handlerInput, prompt, prompt);
    }

    return executeSaveFavoriteStop({
      handlerInput,
      stop: stopResolution.stop,
      favoriteLabel
    });
  }
};

module.exports = {
  SaveFavoriteStopIntentHandler
};
