'use strict';

const { normalizeText } = require('../utils/slotUtils');

const ORDINAL_INDEX = {
  '1': 0,
  uno: 0,
  prima: 0,
  primo: 0,
  'la prima': 0,
  '2': 1,
  due: 1,
  seconda: 1,
  secondo: 1,
  'la seconda': 1,
  '3': 2,
  tre: 2,
  terza: 2,
  terzo: 2,
  'la terza': 2,
  '4': 3,
  quattro: 3,
  quarta: 3,
  quarto: 3
};

function createAmbiguityChoiceResolver() {
  function resolveChoice(choice, options) {
    if (!Array.isArray(options) || !options.length) {
      return null;
    }

    if (options.length === 1) {
      return options[0];
    }

    const normalizedChoice = normalizeText(choice);
    if (!normalizedChoice) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(ORDINAL_INDEX, normalizedChoice)) {
      return options[ORDINAL_INDEX[normalizedChoice]] || null;
    }

    const numericMatch = normalizedChoice.match(/\d+/);
    if (numericMatch) {
      const index = parseInt(numericMatch[0], 10) - 1;
      if (!Number.isNaN(index) && options[index]) {
        return options[index];
      }
    }

    const directMatch = options.find((option) => {
      const optionName = normalizeText(option.name);
      return optionName === normalizedChoice || optionName.includes(normalizedChoice) || normalizedChoice.includes(optionName);
    });

    return directMatch || null;
  }

  return {
    resolveChoice
  };
}

module.exports = {
  createAmbiguityChoiceResolver
};
