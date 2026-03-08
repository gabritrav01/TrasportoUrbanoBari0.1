'use strict';

const Alexa = require('ask-sdk-core');
const { speak } = require('../utils/response');
const { getContainer } = require('./handlerUtils');

const AMTABHelpExamplesHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMTABHelpExamplesIntent'
    );
  },
  handle(handlerInput) {
    const { formatter } = getContainer(handlerInput);
    const speechText = formatter.formatHelpExamples();
    return speak(handlerInput, speechText, 'Vuoi provare con una richiesta sulla stazione?');
  }
};

module.exports = {
  AMTABHelpExamplesHandler
};
