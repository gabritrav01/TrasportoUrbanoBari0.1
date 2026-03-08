'use strict';

function getSessionAttributes(handlerInput) {
  return handlerInput.attributesManager.getSessionAttributes();
}

function setSessionAttributes(handlerInput, sessionAttributes) {
  handlerInput.attributesManager.setSessionAttributes(sessionAttributes);
}

function setPendingAmbiguity(handlerInput, pendingAmbiguity) {
  const sessionAttributes = getSessionAttributes(handlerInput);
  sessionAttributes.pendingAmbiguity = pendingAmbiguity;
  setSessionAttributes(handlerInput, sessionAttributes);
}

function getPendingAmbiguity(handlerInput) {
  const sessionAttributes = getSessionAttributes(handlerInput);
  return sessionAttributes.pendingAmbiguity || null;
}

function clearPendingAmbiguity(handlerInput) {
  const sessionAttributes = getSessionAttributes(handlerInput);
  delete sessionAttributes.pendingAmbiguity;
  setSessionAttributes(handlerInput, sessionAttributes);
}

function setLastSpeech(handlerInput, speechText) {
  const sessionAttributes = getSessionAttributes(handlerInput);
  sessionAttributes.lastSpeechText = speechText;
  setSessionAttributes(handlerInput, sessionAttributes);
}

function getLastSpeech(handlerInput) {
  const sessionAttributes = getSessionAttributes(handlerInput);
  return sessionAttributes.lastSpeechText || '';
}

function setLastResolvedStopId(handlerInput, stopId) {
  const sessionAttributes = getSessionAttributes(handlerInput);
  sessionAttributes.lastResolvedStopId = stopId;
  setSessionAttributes(handlerInput, sessionAttributes);
}

function getLastResolvedStopId(handlerInput) {
  const sessionAttributes = getSessionAttributes(handlerInput);
  return sessionAttributes.lastResolvedStopId || null;
}

module.exports = {
  getSessionAttributes,
  setPendingAmbiguity,
  getPendingAmbiguity,
  clearPendingAmbiguity,
  setLastSpeech,
  getLastSpeech,
  setLastResolvedStopId,
  getLastResolvedStopId
};
