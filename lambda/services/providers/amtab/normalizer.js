'use strict';

const { normalizeText } = require('../../../resolvers/transportDataResolver');
const {
  normalizeStopShape,
  normalizeLineShape,
  normalizeArrivalShape,
  normalizeRouteOptionShape,
  normalizeDestinationTargetShape
} = require('../domain/providerShapes');

function createAmtabNormalizer() {
  function searchText(value) {
    return normalizeText(value || '');
  }

  function normalizeStop(rawStop, defaults = {}) {
    return normalizeStopShape(rawStop, defaults);
  }

  function normalizeLine(rawLine, defaults = {}) {
    return normalizeLineShape(rawLine, defaults);
  }

  function normalizeDestinationTarget(rawDestination, defaults = {}) {
    return normalizeDestinationTargetShape(rawDestination, defaults);
  }

  function normalizeArrival(rawArrival, defaults = {}) {
    return normalizeArrivalShape(rawArrival, defaults);
  }

  function normalizeRouteOption(rawRoute, defaults = {}) {
    return normalizeRouteOptionShape(rawRoute, defaults);
  }

  return {
    searchText,
    normalizeStop,
    normalizeLine,
    normalizeDestinationTarget,
    normalizeArrival,
    normalizeRouteOption
  };
}

module.exports = {
  createAmtabNormalizer
};
