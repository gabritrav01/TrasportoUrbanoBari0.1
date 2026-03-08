'use strict';

const Alexa = require('ask-sdk-core');
const { AMBIGUITY_KINDS, ACTIONS } = require('../config/constants');
const { getSlotValue } = require('../utils/slotUtils');
const sessionState = require('../utils/sessionState');
const { speak } = require('../utils/response');
const { getContainer, handleNearbyUnavailable } = require('./handlerUtils');
const { executeLineDirectionArrivals } = require('./actionExecutors');

const LineDirectionArrivalsIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'LineDirectionArrivalsIntent'
    );
  },
  async handle(handlerInput) {
    const lineNumber = getSlotValue(handlerInput, 'lineNumber');
    const destinationName = getSlotValue(handlerInput, 'destination');
    const stopName = getSlotValue(handlerInput, 'stopName');

    if (!lineNumber) {
      return speak(handlerInput, 'Dimmi il numero della linea.', 'Ad esempio: quando passa la linea 2 barra per policlinico.');
    }

    const { resolvers, formatter } = getContainer(handlerInput);

    const lineResolution = await resolvers.lineResolver.resolveByName(lineNumber);
    if (lineResolution.status === 'not_found') {
      return speak(handlerInput, `Non trovo la linea ${lineNumber}.`, 'Riprova con un numero linea valido.');
    }
    if (lineResolution.status === 'ambiguous') {
      sessionState.setPendingAmbiguity(handlerInput, {
        kind: AMBIGUITY_KINDS.LINE,
        action: ACTIONS.LINE_DIRECTION_ARRIVALS,
        options: lineResolution.options,
        context: {
          destinationName: destinationName || null,
          stopName: stopName || null
        }
      });
      const prompt = formatter.formatAmbiguityPrompt('la linea', lineResolution.options);
      return speak(handlerInput, prompt, prompt);
    }

    let destination = null;
    if (destinationName) {
      const destinationResolution = await resolvers.destinationResolver.resolveByName(destinationName);
      if (destinationResolution.status === 'not_found') {
        return speak(handlerInput, `Non riconosco la destinazione ${destinationName}.`, 'Prova con stazione, universita o policlinico.');
      }
      if (destinationResolution.status === 'ambiguous') {
        sessionState.setPendingAmbiguity(handlerInput, {
          kind: AMBIGUITY_KINDS.DESTINATION,
          action: ACTIONS.LINE_DIRECTION_ARRIVALS,
          options: destinationResolution.options,
          context: {
            lineId: lineResolution.line.id,
            stopName: stopName || null
          }
        });
        const prompt = formatter.formatAmbiguityPrompt('la destinazione', destinationResolution.options);
        return speak(handlerInput, prompt, prompt);
      }
      destination = destinationResolution.destination;
    }

    let stop = null;
    if (stopName) {
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
          action: ACTIONS.LINE_DIRECTION_ARRIVALS,
          options: stopResolution.options,
          context: {
            lineId: lineResolution.line.id,
            destinationId: destination ? destination.id : null
          }
        });
        const prompt = formatter.formatAmbiguityPrompt('la fermata', stopResolution.options);
        return speak(handlerInput, prompt, prompt);
      }
      stop = stopResolution.stop;
    }

    return executeLineDirectionArrivals({
      handlerInput,
      line: lineResolution.line,
      destination,
      stop
    });
  }
};

module.exports = {
  LineDirectionArrivalsIntentHandler
};
