'use strict';

const Alexa = require('ask-sdk-core');
const { AMBIGUITY_KINDS, ACTIONS } = require('../config/constants');
const { getSlotValue } = require('../utils/slotUtils');
const { buildAddressPermissionMissingResponse } = require('../utils/addressPermissionResponse');
const sessionState = require('../utils/sessionState');
const { speak } = require('../utils/response');
const { getContainer, handleNearbyUnavailable } = require('./handlerUtils');
const { executeNextArrivalsByStop } = require('./actionExecutors');

function mapNearbyCandidatesToOptions(candidates) {
  return (candidates || []).slice(0, 3).map((candidate) => ({
    id: candidate.stop.id,
    name:
      typeof candidate.distanceMeters === 'number'
        ? `${candidate.stop.name} a circa ${candidate.distanceMeters} metri`
        : candidate.stop.name
  }));
}

const NextArrivalsByNearbyIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'NextArrivalsByNearbyIntent'
    );
  },
  async handle(handlerInput) {
    const lineNumber = getSlotValue(handlerInput, 'lineNumber');
    const { resolvers, formatter, services } = getContainer(handlerInput);

    let resolvedLine = null;
    if (lineNumber) {
      const lineResolution = await resolvers.lineResolver.resolveByName(lineNumber);
      if (lineResolution.status === 'not_found') {
        return speak(handlerInput, `Non trovo la linea ${lineNumber}.`, 'Riprova con un numero linea valido.');
      }
      if (lineResolution.status === 'ambiguous') {
        sessionState.setPendingAmbiguity(handlerInput, {
          kind: AMBIGUITY_KINDS.LINE,
          action: ACTIONS.NEXT_ARRIVALS_BY_NEARBY,
          options: lineResolution.options,
          context: {}
        });
        const prompt = formatter.formatAmbiguityPrompt('la linea', lineResolution.options);
        return speak(handlerInput, prompt, prompt);
      }
      resolvedLine = lineResolution.line;
    }

    const nearbyResult = await services.locationService.getNearbyStopsFromDeviceAddress(handlerInput, { limit: 3 });
    if (nearbyResult.status === 'permission_required') {
      return buildAddressPermissionMissingResponse(handlerInput);
    }
    if (nearbyResult.status === 'unavailable') {
      return handleNearbyUnavailable(handlerInput, nearbyResult.reason, 'Dimmi una fermata specifica.');
    }
    if (nearbyResult.status === 'ambiguous') {
      const options = mapNearbyCandidatesToOptions(nearbyResult.candidates);
      sessionState.setPendingAmbiguity(handlerInput, {
        kind: AMBIGUITY_KINDS.STOP,
        action: ACTIONS.NEXT_ARRIVALS_BY_NEARBY,
        options,
        context: {
          lineId: resolvedLine ? resolvedLine.id : null
        }
      });
      const prompt = formatter.formatAmbiguityPrompt('la fermata vicina', options);
      return speak(handlerInput, prompt, prompt);
    }
    if (nearbyResult.status !== 'resolved') {
      return speak(handlerInput, 'Non riesco a trovare una fermata vicina in questo momento.', 'Dimmi una fermata precisa.');
    }

    return executeNextArrivalsByStop({
      handlerInput,
      stop: nearbyResult.stop,
      line: resolvedLine,
      nearby: true
    });
  }
};

module.exports = {
  NextArrivalsByNearbyIntentHandler
};
