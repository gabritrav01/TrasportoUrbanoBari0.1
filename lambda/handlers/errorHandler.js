'use strict';

const { speak } = require('../utils/response');

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error('Unhandled skill error:', error);
    return speak(
      handlerInput,
      'Si e verificato un errore interno. Riprova tra poco.',
      'Puoi ripetere la richiesta.'
    );
  }
};

module.exports = {
  ErrorHandler
};
