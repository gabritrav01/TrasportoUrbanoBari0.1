'use strict';

module.exports = [
  {
    key: 'stazione',
    canonicalLabel: 'Stazione Centrale Bari',
    queryTokens: ['stazione', 'stazione centrale', 'piazza moro', 'centrale'],
    mappedDestinationIds: ['DEST_STAZIONE'],
    placeId: 'PLACE_STAZIONE_CENTRALE',
    confidence: 'high'
  },
  {
    key: 'policlinico',
    canonicalLabel: 'Policlinico di Bari',
    queryTokens: ['policlinico', 'ospedale', 'ospedale policlinico'],
    mappedDestinationIds: ['DEST_POLICLINICO'],
    placeId: 'PLACE_POLICLINICO',
    confidence: 'high'
  },
  {
    key: 'universita',
    canonicalLabel: 'Universita degli Studi di Bari',
    queryTokens: ['universita', 'ateneo', 'campus universitario', 'campus'],
    mappedDestinationIds: ['DEST_UNIVERSITA'],
    placeId: 'PLACE_UNIVERSITA',
    confidence: 'high'
  },
  {
    key: 'lungomare',
    canonicalLabel: 'Lungomare Nazario Sauro',
    queryTokens: ['lungomare', 'mare', 'nazario sauro'],
    mappedDestinationIds: ['DEST_LUNGOMARE'],
    placeId: 'PLACE_LUNGOMARE',
    confidence: 'high'
  },
  {
    key: 'facolta_biologia',
    canonicalLabel: 'Facolta di Biologia',
    queryTokens: ['facolta di biologia', 'biologia', 'dipartimento di biologia'],
    mappedDestinationIds: ['DEST_UNIVERSITA'],
    placeId: 'PLACE_FACOLTA_BIOLOGIA',
    confidence: 'low',
    note: 'TODO: verificare target destinazione ufficiale AMTAB/MUVT per facolta di biologia.'
  },
  {
    key: 'casa',
    canonicalLabel: 'Casa',
    queryTokens: ['casa', 'a casa', 'torno a casa'],
    mappedDestinationIds: [],
    placeId: 'PLACE_CASA',
    confidence: 'contextual',
    note: 'Richiede preferiti utente o indirizzo dispositivo per risoluzione operativa.'
  }
];
