'use strict';

const {
  resolveDestinationQuery
} = require('./semanticResolver');

function createDestinationResolver({ transitService }) {
  async function resolveByName(destinationName) {
    if (!destinationName) {
      return { status: 'missing' };
    }

    const semanticResult = await resolveDestinationQuery(destinationName, {
      resolveDestination: (query) => transitService.resolveDestination(query),
      getDestinationById: (destinationId) => transitService.getDestinationById(destinationId)
    });

    if (semanticResult.status === 'not_found') {
      return { status: 'not_found' };
    }

    if (semanticResult.status === 'ambiguous') {
      return {
        status: 'ambiguous',
        options: semanticResult.options,
        prompt: semanticResult.clarificationPrompt
      };
    }

    const resolvedDestination =
      semanticResult.match && semanticResult.match.rawCandidate ? semanticResult.match.rawCandidate : null;
    if (!resolvedDestination) {
      return { status: 'not_found' };
    }

    return {
      status: 'resolved',
      destination: resolvedDestination,
      score: semanticResult.score
    };
  }

  return {
    resolveByName
  };
}

module.exports = {
  createDestinationResolver
};
