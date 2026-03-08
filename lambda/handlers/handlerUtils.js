'use strict';

const { DEFAULT_FAVORITE_LABEL } = require('../config/constants');
const { buildAddressPermissionMissingResponse } = require('../utils/addressPermissionResponse');
const { normalizeText } = require('../utils/slotUtils');
const { speak } = require('../utils/response');

function getContainer(handlerInput) {
  const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
  return requestAttributes.container;
}

function normalizeFavoriteLabel(value) {
  const normalized = normalizeText(value);
  return normalized || DEFAULT_FAVORITE_LABEL;
}

async function handleNearbyUnavailable(handlerInput, reason, fallbackReprompt) {
  if (reason === 'permission_required') {
    return buildAddressPermissionMissingResponse(handlerInput);
  }

  const container = getContainer(handlerInput);
  const unavailable = container.formatter.formatNearbyUnavailable(reason);
  const reprompt = fallbackReprompt || 'Dimmi una fermata specifica.';

  try {
    const favorite = await container.repositories.userPreferencesRepository.getFavoriteStop();
    if (favorite) {
      const speechText =
        `${unavailable} Posso usare la tua fermata preferita ${favorite.label}, ` +
        `${favorite.stopName}, oppure puoi dirmi una fermata specifica.`;
      return speak(handlerInput, speechText, `Puoi dire: usa ${favorite.label}, oppure dimmi una fermata.`);
    }
  } catch (error) {
    console.error('Unable to read favorites while handling nearby fallback', error);
  }

  return speak(
    handlerInput,
    `${unavailable} Dimmi una fermata specifica, oppure salva una preferita.`,
    reprompt
  );
}

module.exports = {
  getContainer,
  normalizeFavoriteLabel,
  handleNearbyUnavailable
};
