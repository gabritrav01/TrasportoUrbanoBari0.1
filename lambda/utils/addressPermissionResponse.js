'use strict';

const sessionState = require('./sessionState');

const DEVICE_FULL_ADDRESS_PERMISSION = 'alexa::devices:all:address:full:read';

function hasDeviceAddressPermission(handlerInput) {
  const requestEnvelope = handlerInput.requestEnvelope || {};
  const system = requestEnvelope.context && requestEnvelope.context.System ? requestEnvelope.context.System : {};
  const user = system.user || {};
  const permissions = user.permissions || {};
  return typeof permissions.consentToken === 'string' && permissions.consentToken.length > 0;
}

function buildAddressPermissionMissingResponse(handlerInput) {
  const speechText =
    'Per usare da qui o vicino a me devo leggere l indirizzo del tuo dispositivo Alexa. ' +
    'Apri l app Alexa, abilita il permesso indirizzo e poi ripeti la richiesta.';
  const repromptText = 'Puoi dire: ho attivato il permesso, riprova vicino a me.';

  sessionState.setLastSpeech(handlerInput, speechText);

  return handlerInput.responseBuilder
    .speak(speechText)
    .reprompt(repromptText)
    .withAskForPermissionsConsentCard([DEVICE_FULL_ADDRESS_PERMISSION])
    .getResponse();
}

module.exports = {
  DEVICE_FULL_ADDRESS_PERMISSION,
  hasDeviceAddressPermission,
  buildAddressPermissionMissingResponse
};
