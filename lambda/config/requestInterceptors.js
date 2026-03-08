'use strict';

const { buildRequestContainer } = require('./container');

const DependencyInjectorRequestInterceptor = {
  process(handlerInput) {
    const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
    requestAttributes.container = buildRequestContainer(handlerInput);
  }
};

module.exports = {
  DependencyInjectorRequestInterceptor
};
