'use strict';

const { DEFAULT_FAVORITE_LABEL } = require('../config/constants');
const sessionState = require('../utils/sessionState');
const { speak } = require('../utils/response');
const { getContainer, normalizeFavoriteLabel } = require('./handlerUtils');

async function executeNextArrivalsByStop({ handlerInput, stop, line, nearby, prefixText }) {
  const { repositories, services, formatter } = getContainer(handlerInput);
  const responseMode = await repositories.userPreferencesRepository.getResponseMode();
  const arrivals = await services.transitService.getNextArrivalsByStop({
    stopId: stop.id,
    lineId: line ? line.id : null
  });

  sessionState.setLastResolvedStopId(handlerInput, stop.id);
  const baseSpeech = formatter.formatArrivalsByStop({
    stop,
    arrivals,
    responseMode,
    nearby: Boolean(nearby)
  });
  const speechText = prefixText ? `${prefixText} ${baseSpeech}` : baseSpeech;

  const repromptText = 'Puoi chiedere una destinazione, oppure dire salva questa fermata come casa.';
  return speak(handlerInput, speechText, repromptText);
}

async function executeRoutesToDestination({ handlerInput, destination, originStop }) {
  const { repositories, services, formatter } = getContainer(handlerInput);
  const responseMode = await repositories.userPreferencesRepository.getResponseMode();
  const routes = await services.transitService.getRoutesToDestination({
    destinationId: destination.id,
    fromStopId: originStop ? originStop.id : null
  });

  const speechText = formatter.formatRoutesToDestination({
    destination,
    originStop,
    routes,
    responseMode
  });

  return speak(handlerInput, speechText, 'Vuoi anche i prossimi arrivi a una fermata?');
}

async function executeLineDirectionArrivals({ handlerInput, line, destination, stop }) {
  const { repositories, services, formatter } = getContainer(handlerInput);
  const responseMode = await repositories.userPreferencesRepository.getResponseMode();
  const arrivals = await services.transitService.getLineDirectionArrivals({
    lineId: line.id,
    destinationId: destination ? destination.id : null,
    stopId: stop ? stop.id : null
  });

  const fallbackDestination = destination || { name: line.destinationName };
  const speechText = formatter.formatLineDirectionArrivals({
    line,
    destination: fallbackDestination,
    stop,
    arrivals,
    responseMode
  });

  return speak(handlerInput, speechText, 'Puoi chiedere anche bus vicino a me.');
}

async function executeSaveFavoriteStop({ handlerInput, stop, favoriteLabel }) {
  const { repositories, formatter } = getContainer(handlerInput);
  const label = normalizeFavoriteLabel(favoriteLabel || DEFAULT_FAVORITE_LABEL);
  await repositories.userPreferencesRepository.saveFavoriteStop(label, stop);
  sessionState.setLastResolvedStopId(handlerInput, stop.id);
  const speechText = formatter.formatFavoriteSaved(label, stop.name);
  return speak(handlerInput, speechText, 'Vuoi i prossimi arrivi della preferita?');
}

async function executeGetFavoriteStopArrivals({ handlerInput, favoriteLabel }) {
  const { repositories, services } = getContainer(handlerInput);
  const favorite = await repositories.userPreferencesRepository.getFavoriteStop(favoriteLabel);
  if (!favorite) {
    return speak(
      handlerInput,
      'Non hai ancora fermate preferite salvate. Puoi dire salva stazione come casa.',
      'Dimmi una fermata da salvare.'
    );
  }

  const stop = services.transitService.getStopById(favorite.stopId);
  if (!stop) {
    return speak(
      handlerInput,
      `La preferita ${favorite.label} non punta piu a una fermata valida. Aggiornala con un nuovo salvataggio.`,
      'Dimmi quale fermata vuoi salvare.'
    );
  }

  return executeNextArrivalsByStop({
    handlerInput,
    stop,
    prefixText: `Uso la fermata preferita ${favorite.label}.`
  });
}

module.exports = {
  executeNextArrivalsByStop,
  executeRoutesToDestination,
  executeLineDirectionArrivals,
  executeSaveFavoriteStop,
  executeGetFavoriteStopArrivals
};
