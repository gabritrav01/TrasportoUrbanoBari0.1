'use strict';

const Alexa = require('ask-sdk-core');
const { createPersistenceAdapter } = require('./persistence');
const { DependencyInjectorRequestInterceptor } = require('./requestInterceptors');
const { requestHandlers, errorHandlers } = require('../handlers');

let cachedLambdaHandler = null;
let handlerInitializationPromise = null;

function buildLambdaHandler() {
  const logger = console;
  const skillBuilder = Alexa.SkillBuilders.custom()
    .addRequestInterceptors(DependencyInjectorRequestInterceptor)
    .addRequestHandlers(...requestHandlers)
    .addErrorHandlers(...errorHandlers);

  const { adapter: persistenceAdapter, meta: persistenceMeta } = createPersistenceAdapter({ logger });
  if (persistenceAdapter) {
    skillBuilder.withPersistenceAdapter(persistenceAdapter);
  }

  if (typeof Alexa.DefaultApiClient === 'function') {
    skillBuilder.withApiClient(new Alexa.DefaultApiClient());
  } else {
    logger.warn('Alexa.DefaultApiClient non disponibile: le API device address potrebbero non funzionare.');
  }

  return {
    handler: skillBuilder.lambda(),
    persistenceMeta
  };
}

async function getOrCreateLambdaHandler() {
  if (cachedLambdaHandler) {
    return cachedLambdaHandler;
  }

  if (handlerInitializationPromise) {
    return handlerInitializationPromise;
  }

  console.info('[BOOTSTRAP_START]', {
    phase: 'skill_handler_init'
  });

  handlerInitializationPromise = Promise.resolve()
    .then(() => {
      const { handler, persistenceMeta } = buildLambdaHandler();
      cachedLambdaHandler = handler;

      console.info('[BOOTSTRAP_OK]', {
        phase: 'skill_handler_init',
        persistenceMode: persistenceMeta && persistenceMeta.mode ? persistenceMeta.mode : 'unknown',
        persistenceEnabled: Boolean(persistenceMeta && persistenceMeta.enabled)
      });

      return cachedLambdaHandler;
    })
    .catch((error) => {
      console.error('[BOOTSTRAP_FAIL]', {
        phase: 'skill_handler_init',
        code: error && error.code ? error.code : 'UNKNOWN',
        message: error && error.message ? error.message : String(error)
      });
      throw error;
    })
    .finally(() => {
      handlerInitializationPromise = null;
    });

  return handlerInitializationPromise;
}

function createSkillHandler() {
  return async function lazySkillHandler(event, context) {
    const runtimeHandler = await getOrCreateLambdaHandler();
    return runtimeHandler(event, context);
  };
}

module.exports = {
  createSkillHandler,
  getOrCreateLambdaHandler
};
