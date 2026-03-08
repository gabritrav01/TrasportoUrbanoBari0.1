'use strict';

const Alexa = require('ask-sdk-core');
const { ACTIONS, AMBIGUITY_KINDS } = require('../config/constants');
const { buildAddressPermissionMissingResponse } = require('../utils/addressPermissionResponse');
const { getSlotValue } = require('../utils/slotUtils');
const sessionState = require('../utils/sessionState');
const { speak } = require('../utils/response');
const { getContainer, handleNearbyUnavailable } = require('./handlerUtils');
const {
  executeNextArrivalsByStop,
  executeRoutesToDestination,
  executeLineDirectionArrivals,
  executeSaveFavoriteStop
} = require('./actionExecutors');

function getEntityLabel(kind) {
  if (kind === AMBIGUITY_KINDS.STOP) {
    return 'la fermata';
  }
  if (kind === AMBIGUITY_KINDS.DESTINATION) {
    return 'la destinazione';
  }
  return 'la linea';
}

function askAmbiguityAgain(handlerInput, kind, options, formatter) {
  const prompt = formatter.formatAmbiguityPrompt(getEntityLabel(kind), options || []);
  return speak(handlerInput, prompt, prompt);
}

function mapNearbyCandidatesToOptions(candidates) {
  return (candidates || []).slice(0, 3).map((candidate) => ({
    id: candidate.stop.id,
    name:
      typeof candidate.distanceMeters === 'number'
        ? `${candidate.stop.name} a circa ${candidate.distanceMeters} metri`
        : candidate.stop.name
  }));
}

async function resolveStopFromRaw(handlerInput, stopName, action, context, container) {
  const stopResolution = await container.resolvers.stopResolver.resolveByName(handlerInput, stopName);

  if (stopResolution.status === 'not_found') {
    return speak(handlerInput, `Non trovo la fermata ${stopName}.`, 'Prova con una fermata piu specifica.');
  }
  if (stopResolution.status === 'nearby_unavailable') {
    return handleNearbyUnavailable(handlerInput, stopResolution.reason, 'Dimmi una fermata specifica.');
  }
  if (stopResolution.status === 'ambiguous') {
    sessionState.setPendingAmbiguity(handlerInput, {
      kind: AMBIGUITY_KINDS.STOP,
      action,
      options: stopResolution.options,
      context
    });
    return askAmbiguityAgain(handlerInput, AMBIGUITY_KINDS.STOP, stopResolution.options, container.formatter);
  }

  return stopResolution.stop;
}

async function resolveDestinationFromRaw(handlerInput, destinationName, action, context, container) {
  const destinationResolution = await container.resolvers.destinationResolver.resolveByName(destinationName);

  if (destinationResolution.status === 'not_found') {
    return speak(handlerInput, `Non riconosco la destinazione ${destinationName}.`, 'Prova con una destinazione diversa.');
  }
  if (destinationResolution.status === 'ambiguous') {
    sessionState.setPendingAmbiguity(handlerInput, {
      kind: AMBIGUITY_KINDS.DESTINATION,
      action,
      options: destinationResolution.options,
      context
    });
    return askAmbiguityAgain(
      handlerInput,
      AMBIGUITY_KINDS.DESTINATION,
      destinationResolution.options,
      container.formatter
    );
  }

  return destinationResolution.destination;
}

const ResolveAmbiguityIntentHandler = {
  canHandle(handlerInput) {
    return (
      Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      Alexa.getIntentName(handlerInput.requestEnvelope) === 'ResolveAmbiguityIntent'
    );
  },
  async handle(handlerInput) {
    const pendingAmbiguity = sessionState.getPendingAmbiguity(handlerInput);
    const container = getContainer(handlerInput);

    if (!pendingAmbiguity) {
      return speak(handlerInput, 'Non c e una scelta in sospeso.', 'Dimmi una richiesta sui bus.');
    }

    const ambiguityChoice = getSlotValue(handlerInput, 'ambiguityChoice');
    const selectedOption = container.resolvers.ambiguityChoiceResolver.resolveChoice(
      ambiguityChoice,
      pendingAmbiguity.options || []
    );
    if (!selectedOption) {
      return askAmbiguityAgain(
        handlerInput,
        pendingAmbiguity.kind,
        pendingAmbiguity.options || [],
        container.formatter
      );
    }

    sessionState.clearPendingAmbiguity(handlerInput);
    const context = pendingAmbiguity.context || {};
    const { transitService } = container.services;

    if (pendingAmbiguity.action === ACTIONS.NEXT_ARRIVALS_BY_STOP) {
      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.STOP) {
        const stop = transitService.getStopById(selectedOption.id);
        const line = context.lineId ? transitService.getLineById(context.lineId) : null;
        if (!stop) {
          return speak(handlerInput, 'La fermata selezionata non e disponibile.', 'Riprova con una nuova richiesta.');
        }
        return executeNextArrivalsByStop({ handlerInput, stop, line });
      }

      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.LINE) {
        const line = transitService.getLineById(selectedOption.id);
        if (!line) {
          return speak(handlerInput, 'La linea selezionata non e disponibile.', 'Riprova con una nuova richiesta.');
        }
        const stop = await resolveStopFromRaw(
          handlerInput,
          context.stopName,
          ACTIONS.NEXT_ARRIVALS_BY_STOP,
          { lineId: line.id },
          container
        );
        if (!stop || stop.outputSpeech) {
          return stop;
        }
        return executeNextArrivalsByStop({ handlerInput, stop, line });
      }
    }

    if (pendingAmbiguity.action === ACTIONS.NEXT_ARRIVALS_BY_NEARBY) {
      const line =
        pendingAmbiguity.kind === AMBIGUITY_KINDS.LINE
          ? transitService.getLineById(selectedOption.id)
          : context.lineId
            ? transitService.getLineById(context.lineId)
            : null;

      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.LINE && !line) {
        return speak(handlerInput, 'La linea selezionata non e disponibile.', 'Riprova con una nuova richiesta.');
      }

      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.STOP) {
        const stop = transitService.getStopById(selectedOption.id);
        if (!stop) {
          return speak(handlerInput, 'La fermata selezionata non e disponibile.', 'Riprova con una nuova richiesta.');
        }
        return executeNextArrivalsByStop({
          handlerInput,
          stop,
          line,
          nearby: true
        });
      }

      const nearbyResult = await container.services.locationService.getNearbyStopsFromDeviceAddress(handlerInput, { limit: 3 });
      if (nearbyResult.status === 'permission_required') {
        return buildAddressPermissionMissingResponse(handlerInput);
      }
      if (nearbyResult.status === 'unavailable') {
        return handleNearbyUnavailable(handlerInput, nearbyResult.reason, 'Dimmi una fermata specifica.');
      }
      if (nearbyResult.status === 'ambiguous') {
        const options = mapNearbyCandidatesToOptions(nearbyResult.candidates);
        sessionState.setPendingAmbiguity(handlerInput, {
          kind: AMBIGUITY_KINDS.STOP,
          action: ACTIONS.NEXT_ARRIVALS_BY_NEARBY,
          options,
          context: {
            lineId: line ? line.id : null
          }
        });
        const prompt = container.formatter.formatAmbiguityPrompt('la fermata vicina', options);
        return speak(handlerInput, prompt, prompt);
      }
      if (nearbyResult.status !== 'resolved') {
        return speak(handlerInput, 'Non riesco a trovare una fermata vicina in questo momento.', 'Dimmi una fermata specifica.');
      }
      return executeNextArrivalsByStop({
        handlerInput,
        stop: nearbyResult.stop,
        line,
        nearby: true
      });
    }

    if (pendingAmbiguity.action === ACTIONS.ROUTES_TO_DESTINATION) {
      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.DESTINATION) {
        const destination = transitService.getDestinationById(selectedOption.id);
        if (!destination) {
          return speak(handlerInput, 'La destinazione selezionata non e disponibile.', 'Riprova con una nuova richiesta.');
        }

        let originStop = null;
        if (context.stopName) {
          const stop = await resolveStopFromRaw(
            handlerInput,
            context.stopName,
            ACTIONS.ROUTES_TO_DESTINATION,
            { destinationId: destination.id },
            container
          );
          if (!stop || stop.outputSpeech) {
            return stop;
          }
          originStop = stop;
        }

        return executeRoutesToDestination({
          handlerInput,
          destination,
          originStop
        });
      }

      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.STOP) {
        const destination = transitService.getDestinationById(context.destinationId);
        const stop = transitService.getStopById(selectedOption.id);
        if (!destination || !stop) {
          return speak(handlerInput, 'Non riesco a completare il chiarimento.', 'Riprova con una nuova richiesta.');
        }
        return executeRoutesToDestination({
          handlerInput,
          destination,
          originStop: stop
        });
      }
    }

    if (pendingAmbiguity.action === ACTIONS.LINE_DIRECTION_ARRIVALS) {
      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.LINE) {
        const line = transitService.getLineById(selectedOption.id);
        if (!line) {
          return speak(handlerInput, 'La linea selezionata non e disponibile.', 'Riprova con una nuova richiesta.');
        }

        let destination = null;
        if (context.destinationName) {
          const resolvedDestination = await resolveDestinationFromRaw(
            handlerInput,
            context.destinationName,
            ACTIONS.LINE_DIRECTION_ARRIVALS,
            { lineId: line.id, stopName: context.stopName || null },
            container
          );
          if (!resolvedDestination || resolvedDestination.outputSpeech) {
            return resolvedDestination;
          }
          destination = resolvedDestination;
        }

        let stop = null;
        if (context.stopName) {
          const resolvedStop = await resolveStopFromRaw(
            handlerInput,
            context.stopName,
            ACTIONS.LINE_DIRECTION_ARRIVALS,
            { lineId: line.id, destinationId: destination ? destination.id : null },
            container
          );
          if (!resolvedStop || resolvedStop.outputSpeech) {
            return resolvedStop;
          }
          stop = resolvedStop;
        }

        return executeLineDirectionArrivals({
          handlerInput,
          line,
          destination,
          stop
        });
      }

      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.DESTINATION) {
        const line = transitService.getLineById(context.lineId);
        const destination = transitService.getDestinationById(selectedOption.id);
        if (!line || !destination) {
          return speak(handlerInput, 'Non riesco a completare il chiarimento.', 'Riprova con una nuova richiesta.');
        }

        let stop = null;
        if (context.stopName) {
          const resolvedStop = await resolveStopFromRaw(
            handlerInput,
            context.stopName,
            ACTIONS.LINE_DIRECTION_ARRIVALS,
            { lineId: line.id, destinationId: destination.id },
            container
          );
          if (!resolvedStop || resolvedStop.outputSpeech) {
            return resolvedStop;
          }
          stop = resolvedStop;
        }

        return executeLineDirectionArrivals({
          handlerInput,
          line,
          destination,
          stop
        });
      }

      if (pendingAmbiguity.kind === AMBIGUITY_KINDS.STOP) {
        const line = transitService.getLineById(context.lineId);
        const destination = context.destinationId ? transitService.getDestinationById(context.destinationId) : null;
        const stop = transitService.getStopById(selectedOption.id);
        if (!line || !stop) {
          return speak(handlerInput, 'Non riesco a completare il chiarimento.', 'Riprova con una nuova richiesta.');
        }
        return executeLineDirectionArrivals({
          handlerInput,
          line,
          destination,
          stop
        });
      }
    }

    if (pendingAmbiguity.action === ACTIONS.SAVE_FAVORITE_STOP && pendingAmbiguity.kind === AMBIGUITY_KINDS.STOP) {
      const stop = transitService.getStopById(selectedOption.id);
      if (!stop) {
        return speak(handlerInput, 'La fermata selezionata non e disponibile.', 'Riprova con una nuova richiesta.');
      }
      return executeSaveFavoriteStop({
        handlerInput,
        stop,
        favoriteLabel: context.favoriteLabel
      });
    }

    return speak(handlerInput, 'Ho perso il contesto del chiarimento. Riparti con una nuova richiesta.', 'Come posso aiutarti?');
  }
};

module.exports = {
  ResolveAmbiguityIntentHandler
};
