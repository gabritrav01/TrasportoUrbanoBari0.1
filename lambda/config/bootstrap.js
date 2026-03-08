'use strict';

const Alexa = require('ask-sdk-core');
const { createPersistenceAdapter } = require('./persistence');
const { DependencyInjectorRequestInterceptor } = require('./requestInterceptors');
const { requestHandlers, errorHandlers } = require('../handlers');

function createSkillHandler() {
  const skillBuilder = Alexa.SkillBuilders.custom()
    .withPersistenceAdapter(createPersistenceAdapter())
    .addRequestInterceptors(DependencyInjectorRequestInterceptor)
    .addRequestHandlers(...requestHandlers)
    .addErrorHandlers(...errorHandlers);

  if (typeof Alexa.DefaultApiClient === 'function') {
    skillBuilder.withApiClient(new Alexa.DefaultApiClient());
  } else {
    console.warn('Alexa.DefaultApiClient non disponibile: le API device address potrebbero non funzionare.');
  }

  return skillBuilder.lambda();
}

module.exports = {
  createSkillHandler
};
