'use strict';

const NEARBY_REFERENCES = new Set([
  'da qui',
  'vicino a me',
  'qui',
  'dove sono',
  'posizione attuale'
]);

function normalizeText(value) {
  if (!value) {
    return '';
  }

  return value
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSlotValue(handlerInput, slotName) {
  const request = handlerInput.requestEnvelope.request || {};
  const intent = request.intent || {};
  const slots = intent.slots || {};
  const slot = slots[slotName] || {};
  return typeof slot.value === 'string' ? slot.value.trim() : '';
}

function mapResponseMode(value) {
  const normalizedValue = normalizeText(value);

  const shortModes = new Set(['breve', 'corta', 'sintetica', 'essenziale']);
  if (shortModes.has(normalizedValue)) {
    return 'breve';
  }

  const fullModes = new Set(['completa', 'dettagliata', 'estesa', 'lunga']);
  if (fullModes.has(normalizedValue)) {
    return 'completa';
  }

  return null;
}

function isNearbyReference(value) {
  return NEARBY_REFERENCES.has(normalizeText(value));
}

module.exports = {
  normalizeText,
  getSlotValue,
  mapResponseMode,
  isNearbyReference
};
