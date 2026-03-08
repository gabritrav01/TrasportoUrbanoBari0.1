'use strict';

const Alexa = require('ask-sdk-core');
const { speak } = require('../utils/response');

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    const speechText =
      'Trasporto Urbano Bari versione zero punto uno. Puoi chiedere i prossimi arrivi a una fermata, ' +
      'chiedere linee verso una destinazione, usare da qui o vicino a me, e gestire preferiti.';
    return speak(handlerInput, speechText, 'Ad esempio: prossimi bus alla stazione.');
  }
};

module.exports = {
  LaunchRequestHandler
};
