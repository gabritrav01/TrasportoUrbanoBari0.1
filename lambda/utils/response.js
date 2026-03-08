'use strict';

const sessionState = require('./sessionState');

function speak(handlerInput, speechText, repromptText) {
  sessionState.setLastSpeech(handlerInput, speechText);
  const responseBuilder = handlerInput.responseBuilder.speak(speechText);
  if (repromptText) {
    responseBuilder.reprompt(repromptText);
  }
  return responseBuilder.getResponse();
}

module.exports = {
  speak
};
