'use strict';

module.exports = [
  {
    key: 'stazione',
    canonicalLabel: 'Stazione Centrale Piazza Moro',
    queryTokens: ['stazione', 'stazione centrale', 'piazza moro', 'centrale', 'capolinea stazione'],
    mappedStopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_STAZIONE_ATENEO'],
    placeId: 'PLACE_STAZIONE_CENTRALE',
    confidence: 'high'
  },
  {
    key: 'piazza_moro',
    canonicalLabel: 'Piazza Moro',
    queryTokens: ['piazza moro', 'aldo moro', 'moro'],
    mappedStopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_STAZIONE_ATENEO'],
    placeId: 'PLACE_STAZIONE_CENTRALE',
    confidence: 'high'
  },
  {
    key: 'policlinico',
    canonicalLabel: 'Policlinico',
    queryTokens: ['policlinico', 'ospedale policlinico', 'ospedale'],
    mappedStopIds: ['STOP_POLICLINICO'],
    placeId: 'PLACE_POLICLINICO',
    confidence: 'high'
  },
  {
    key: 'universita',
    canonicalLabel: 'Campus Universitario',
    queryTokens: ['universita', 'ateneo', 'universita bari', 'facolta'],
    mappedStopIds: ['STOP_CAMPUS', 'STOP_STAZIONE_ATENEO'],
    placeId: 'PLACE_UNIVERSITA',
    confidence: 'medium'
  },
  {
    key: 'campus',
    canonicalLabel: 'Campus Universitario',
    queryTokens: ['campus', 'campus universitario', 'campus uniba'],
    mappedStopIds: ['STOP_CAMPUS'],
    placeId: 'PLACE_UNIVERSITA',
    confidence: 'high'
  },
  {
    key: 'lungomare',
    canonicalLabel: 'Lungomare Nazario Sauro',
    queryTokens: ['lungomare', 'nazario sauro', 'lungomare bari', 'mare'],
    mappedStopIds: ['STOP_LUNGOMARE'],
    placeId: 'PLACE_LUNGOMARE',
    confidence: 'high'
  },
  {
    key: 'facolta_biologia',
    canonicalLabel: 'Facolta di Biologia',
    queryTokens: ['facolta di biologia', 'biologia', 'dipartimento di biologia', 'istituto di biologia'],
    mappedStopIds: ['STOP_CAMPUS'],
    placeId: 'PLACE_FACOLTA_BIOLOGIA',
    confidence: 'low',
    note: 'TODO: verificare fermata AMTAB piu vicina ufficiale per la facolta di biologia.'
  }
];
