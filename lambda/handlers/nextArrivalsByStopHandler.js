'use strict';

const Alexa = require('ask-sdk-core');
const { AMBIGUITY_KINDS, ACTIONS } = require('../config/constants');
const { getSlotValue } = require('../utils/slotUtils');
const sessionState = require('../utils/sessionState');
const { speak } = require('../utils/response');
const { getContainer, handleNearbyUnavailable } = require('./handlerUtils');
const { executeNextArrivalsByStop } = require('./actionExecutors');

const NextArrivalsByStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'NextArrivalsByStopIntent'
    );
  },
  async handle(handlerInput) {
    const stopName = getSlotValue(handlerInput, 'stopName');
    const lineNumber = getSlotValue(handlerInput, 'lineNumber');
    if (!stopName) {
      return speak(handlerInput, 'Dimmi la fermata che vuoi controllare.', 'Ad esempio: prossimi bus al policlinico.');
    }

    const { resolvers, services, formatter } = getContainer(handlerInput);

    let resolvedLine = null;
    if (lineNumber) {
      const lineResolution = await resolvers.lineResolver.resolveByName(lineNumber);
      if (lineResolution.status === 'not_found') {
        return speak(handlerInput, `Non trovo la linea ${lineNumber}.`, 'Riprova con un numero linea, ad esempio 2 barra.');
      }
      if (lineResolution.status === 'ambiguous') {
        sessionState.setPendingAmbiguity(handlerInput, {
          kind: AMBIGUITY_KINDS.LINE,
          action: ACTIONS.NEXT_ARRIVALS_BY_STOP,
          options: lineResolution.options,
          context: { stopName }
        });
        const prompt = formatter.formatAmbiguityPrompt('la linea', lineResolution.options);
        return speak(handlerInput, prompt, prompt);
      }
      resolvedLine = lineResolution.line;
    }

    const stopResolution = await resolvers.stopResolver.resolveByName(handlerInput, stopName);
    if (stopResolution.status === 'not_found') {
      return speak(handlerInput, `Non trovo la fermata ${stopName}.`, 'Prova con stazione, policlinico o lungomare.');
    }
    if (stopResolution.status === 'nearby_unavailable') {
      return handleNearbyUnavailable(handlerInput, stopResolution.reason, 'Dimmi una fermata specifica.');
    }
    if (stopResolution.status === 'ambiguous') {
      sessionState.setPendingAmbiguity(handlerInput, {
        kind: AMBIGUITY_KINDS.STOP,
        action: ACTIONS.NEXT_ARRIVALS_BY_STOP,
        options: stopResolution.options,
        context: {
          lineId: resolvedLine ? resolvedLine.id : null
        }
      });
      const prompt = formatter.formatAmbiguityPrompt('la fermata', stopResolution.options);
      return speak(handlerInput, prompt, prompt);
    }

    const stop = stopResolution.stop || services.transitService.getStopById(stopResolution.stopId);
    return executeNextArrivalsByStop({
      handlerInput,
      stop,
      line: resolvedLine
    });
  }
};

module.exports = {
  NextArrivalsByStopIntentHandler
};
