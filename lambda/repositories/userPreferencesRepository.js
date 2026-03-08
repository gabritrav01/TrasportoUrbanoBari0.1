'use strict';

const { DEFAULT_FAVORITE_LABEL, DEFAULT_RESPONSE_MODE, RESPONSE_MODES } = require('../config/constants');
const { normalizeText } = require('../utils/slotUtils');

function sanitizeResponseMode(mode) {
  return mode === RESPONSE_MODES.BRIEF ? RESPONSE_MODES.BRIEF : DEFAULT_RESPONSE_MODE;
}

function normalizeLabel(label) {
  return normalizeText(label || DEFAULT_FAVORITE_LABEL) || DEFAULT_FAVORITE_LABEL;
}

class UserPreferencesRepository {
  constructor(attributesManager) {
    this.attributesManager = attributesManager;
    this.state = null;
  }

  async load() {
    if (this.state) {
      return this.state;
    }

    const persisted = (await this.attributesManager.getPersistentAttributes()) || {};
    const favoriteStops = persisted.favoriteStops && typeof persisted.favoriteStops === 'object' ? persisted.favoriteStops : {};

    this.state = {
      responseMode: sanitizeResponseMode(persisted.responseMode),
      favoriteStops
    };

    return this.state;
  }

  async save() {
    await this.load();
    this.attributesManager.setPersistentAttributes(this.state);
    await this.attributesManager.savePersistentAttributes();
  }

  async getResponseMode() {
    const state = await this.load();
    return state.responseMode;
  }

  async setResponseMode(mode) {
    const state = await this.load();
    state.responseMode = sanitizeResponseMode(mode);
    await this.save();
    return state.responseMode;
  }

  async saveFavoriteStop(label, stop) {
    const state = await this.load();
    const favoriteLabel = label || DEFAULT_FAVORITE_LABEL;
    const key = normalizeLabel(favoriteLabel);

    state.favoriteStops[key] = {
      label: favoriteLabel,
      stopId: stop.id,
      stopName: stop.name,
      updatedAt: new Date().toISOString()
    };

    await this.save();
    return state.favoriteStops[key];
  }

  async getFavoriteStop(label) {
    const state = await this.load();
    const allFavorites = Object.values(state.favoriteStops);
    if (!allFavorites.length) {
      return null;
    }

    if (label) {
      const key = normalizeLabel(label);
      if (state.favoriteStops[key]) {
        return state.favoriteStops[key];
      }

      const targetLabel = normalizeText(label);
      const fuzzy = allFavorites.find((favorite) => {
        const normalized = normalizeText(favorite.label);
        return normalized === targetLabel || normalized.includes(targetLabel) || targetLabel.includes(normalized);
      });
      if (fuzzy) {
        return fuzzy;
      }
    }

    const defaultFavorite = state.favoriteStops[normalizeLabel(DEFAULT_FAVORITE_LABEL)];
    return defaultFavorite || allFavorites[0];
  }

  async listFavoriteStops() {
    const state = await this.load();
    return Object.values(state.favoriteStops);
  }
}

function createUserPreferencesRepository(attributesManager) {
  return new UserPreferencesRepository(attributesManager);
}

module.exports = {
  createUserPreferencesRepository
};
