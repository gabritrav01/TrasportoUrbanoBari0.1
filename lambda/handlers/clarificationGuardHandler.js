'use strict';

const Alexa = require('ask-sdk-core');
const sessionState = require('../utils/sessionState');
const { speak } = require('../utils/response');
const { getContainer } = require('./handlerUtils');
const { AMBIGUITY_KINDS } = require('../config/constants');

const ALLOWED_WHEN_PENDING = new Set(['ResolveAmbiguityIntent', 'AMAZON.CancelIntent', 'AMAZON.StopIntent']);

function kindToLabel(kind) {
  if (kind === AMBIGUITY_KINDS.STOP) {
    return 'la fermata';
  }
  if (kind === AMBIGUITY_KINDS.DESTINATION) {
    return 'la destinazione';
  }
  return 'la linea';
}

const ClarificationGuardHandler = {
  canHandle(handlerInput) {
    if (Alexa.getRequestType(handlerInput.requestEnvelope) !== 'IntentRequest') {
      return false;
    }

    const pendingAmbiguity = sessionState.getPendingAmbiguity(handlerInput);
    if (!pendingAmbiguity) {
      return false;
    }

    const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
    return !ALLOWED_WHEN_PENDING.has(intentName);
  },
  handle(handlerInput) {
    const pendingAmbiguity = sessionState.getPendingAmbiguity(handlerInput);
    const { formatter } = getContainer(handlerInput);
    const clarificationPrompt = formatter.formatAmbiguityPrompt(kindToLabel(pendingAmbiguity.kind), pendingAmbiguity.options || []);
    const speechText = `Per continuare devo prima chiarire ${kindToLabel(pendingAmbiguity.kind)}. ${clarificationPrompt}`;
    return speak(handlerInput, speechText, clarificationPrompt);
  }
};

module.exports = {
  ClarificationGuardHandler
};
