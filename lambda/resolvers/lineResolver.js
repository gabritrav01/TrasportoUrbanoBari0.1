'use strict';

function createLineResolver({ transitService }) {
  async function resolveByName(lineNumber) {
    if (!lineNumber) {
      return { status: 'missing' };
    }

    const matches = await transitService.searchLines(lineNumber);
    if (!matches.length) {
      return { status: 'not_found' };
    }

    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        options: matches.map((line) => ({ id: line.id, name: `linea ${line.id}` }))
      };
    }

    return {
      status: 'resolved',
      line: matches[0]
    };
  }

  return {
    resolveByName
  };
}

module.exports = {
  createLineResolver
};
