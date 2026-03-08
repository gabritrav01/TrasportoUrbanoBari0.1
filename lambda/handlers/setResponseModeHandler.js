'use strict';

const Alexa = require('ask-sdk-core');
const { mapResponseMode } = require('../utils/slotUtils');
const { getSlotValue } = require('../utils/slotUtils');
const { speak } = require('../utils/response');
const { getContainer } = require('./handlerUtils');

const SetResponseModeIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'SetResponseModeIntent'
    );
  },
  async handle(handlerInput) {
    const modeValue = getSlotValue(handlerInput, 'responseMode');
    const mappedMode = mapResponseMode(modeValue);
    if (!mappedMode) {
      return speak(handlerInput, 'Puoi scegliere solo risposta breve o completa.', 'Dimmi: imposta risposta breve.');
    }

    const { repositories } = getContainer(handlerInput);
    const savedMode = await repositories.userPreferencesRepository.setResponseMode(mappedMode);
    const speechText =
      savedMode === 'breve'
        ? 'Modalita breve attivata. Da ora rispondo in modo sintetico.'
        : 'Modalita completa attivata. Da ora rispondo con piu dettagli.';
    return speak(handlerInput, speechText, 'Fammi una richiesta sui bus.');
  }
};

module.exports = {
  SetResponseModeIntentHandler
};
