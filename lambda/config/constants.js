'use strict';

const RESPONSE_MODES = {
  BRIEF: 'breve',
  FULL: 'completa'
};

const DEFAULT_RESPONSE_MODE = RESPONSE_MODES.FULL;
const DEFAULT_FAVORITE_LABEL = 'predefinita';

const AMBIGUITY_KINDS = {
  STOP: 'stop',
  DESTINATION: 'destination',
  LINE: 'line'
};

const ACTIONS = {
  NEXT_ARRIVALS_BY_STOP: 'next_arrivals_by_stop',
  NEXT_ARRIVALS_BY_NEARBY: 'next_arrivals_by_nearby',
  ROUTES_TO_DESTINATION: 'routes_to_destination',
  LINE_DIRECTION_ARRIVALS: 'line_direction_arrivals',
  SAVE_FAVORITE_STOP: 'save_favorite_stop'
};

module.exports = {
  RESPONSE_MODES,
  DEFAULT_RESPONSE_MODE,
  DEFAULT_FAVORITE_LABEL,
  AMBIGUITY_KINDS,
  ACTIONS
};
