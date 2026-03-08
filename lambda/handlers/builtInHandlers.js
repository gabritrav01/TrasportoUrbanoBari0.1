'use strict';

const Alexa = require('ask-sdk-core');
const { speak } = require('../utils/response');
const sessionState = require('../utils/sessionState');
const { getContainer } = require('./handlerUtils');

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  },
  handle(handlerInput) {
    const { formatter } = getContainer(handlerInput);
    return speak(handlerInput, formatter.formatHelpExamples(), 'Dimmi quale richiesta vuoi provare.');
  }
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent' ||
        Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent')
    );
  },
  handle(handlerInput) {
    return speak(handlerInput, 'Va bene, alla prossima.', null);
  }
};

const FallbackIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent'
    );
  },
  handle(handlerInput) {
    return speak(
      handlerInput,
      'Non ho capito la richiesta. Puoi chiedere arrivi fermata, vicino a me, o linee per destinazione.',
      'Ad esempio: prossimi bus alla stazione.'
    );
  }
};

const RepeatIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.RepeatIntent'
    );
  },
  handle(handlerInput) {
    const lastSpeech = sessionState.getLastSpeech(handlerInput);
    if (!lastSpeech) {
      return speak(handlerInput, 'Non ho ancora nulla da ripetere.', 'Fammi una richiesta sui bus.');
    }
    return speak(handlerInput, lastSpeech, 'Dimmi pure la prossima richiesta.');
  }
};

const NavigateHomeIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NavigateHomeIntent'
    );
  },
  handle(handlerInput) {
    return speak(handlerInput, 'Sei tornato al menu principale di Trasporto Urbano Bari.', 'Puoi chiedere i prossimi bus alla stazione.');
  }
};

module.exports = {
  HelpIntentHandler,
  CancelAndStopIntentHandler,
  FallbackIntentHandler,
  RepeatIntentHandler,
  NavigateHomeIntentHandler
};
