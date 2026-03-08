'use strict';

const Alexa = require('ask-sdk-core');
const { AMBIGUITY_KINDS, ACTIONS } = require('../config/constants');
const { getSlotValue } = require('../utils/slotUtils');
const sessionState = require('../utils/sessionState');
const { speak } = require('../utils/response');
const { getContainer, handleNearbyUnavailable } = require('./handlerUtils');
const { executeRoutesToDestination } = require('./actionExecutors');

const RoutesToDestinationIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'RoutesToDestinationIntent'
    );
  },
  async handle(handlerInput) {
    const destinationName = getSlotValue(handlerInput, 'destination');
    const stopName = getSlotValue(handlerInput, 'stopName');
    if (!destinationName) {
      return speak(handlerInput, 'Dimmi la destinazione che vuoi raggiungere.', 'Ad esempio: come arrivo al policlinico.');
    }

    const { resolvers, formatter } = getContainer(handlerInput);
    const destinationResolution = await resolvers.destinationResolver.resolveByName(destinationName);
    if (destinationResolution.status === 'not_found') {
      return speak(handlerInput, `Non riconosco la destinazione ${destinationName}.`, 'Prova con stazione, universita, policlinico o lungomare.');
    }
    if (destinationResolution.status === 'ambiguous') {
      sessionState.setPendingAmbiguity(handlerInput, {
        kind: AMBIGUITY_KINDS.DESTINATION,
        action: ACTIONS.ROUTES_TO_DESTINATION,
        options: destinationResolution.options,
        context: {
          stopName: stopName || null
        }
      });
      const prompt = formatter.formatAmbiguityPrompt('la destinazione', destinationResolution.options);
      return speak(handlerInput, prompt, prompt);
    }

    let originStop = null;
    if (stopName) {
      const stopResolution = await resolvers.stopResolver.resolveByName(handlerInput, stopName);
      if (stopResolution.status === 'not_found') {
        return speak(handlerInput, `Non trovo la fermata ${stopName}.`, 'Prova con una fermata come stazione o policlinico.');
      }
      if (stopResolution.status === 'nearby_unavailable') {
        return handleNearbyUnavailable(handlerInput, stopResolution.reason, 'Dimmi una fermata specifica.');
      }
      if (stopResolution.status === 'ambiguous') {
        sessionState.setPendingAmbiguity(handlerInput, {
          kind: AMBIGUITY_KINDS.STOP,
          action: ACTIONS.ROUTES_TO_DESTINATION,
          options: stopResolution.options,
          context: {
            destinationId: destinationResolution.destination.id
          }
        });
        const prompt = formatter.formatAmbiguityPrompt('la fermata di partenza', stopResolution.options);
        return speak(handlerInput, prompt, prompt);
      }
      originStop = stopResolution.stop;
    }

    return executeRoutesToDestination({
      handlerInput,
      destination: destinationResolution.destination,
      originStop
    });
  }
};

module.exports = {
  RoutesToDestinationIntentHandler
};
