'use strict';

module.exports = [
  {
    id: 'PLACE_STAZIONE_CENTRALE',
    displayName: 'Stazione Centrale Piazza Moro',
    placeType: 'area',
    spokenForms: ['stazione', 'stazione centrale', 'piazza moro', 'centrale'],
    linkedStopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_STAZIONE_ATENEO'],
    linkedDestinationIds: ['DEST_STAZIONE'],
    confidence: 'high'
  },
  {
    id: 'PLACE_POLICLINICO',
    displayName: 'Policlinico di Bari',
    placeType: 'poi',
    spokenForms: ['policlinico', 'ospedale policlinico', 'ospedale'],
    linkedStopIds: ['STOP_POLICLINICO'],
    linkedDestinationIds: ['DEST_POLICLINICO'],
    confidence: 'high'
  },
  {
    id: 'PLACE_UNIVERSITA',
    displayName: 'Universita di Bari / Campus',
    placeType: 'area',
    spokenForms: ['universita', 'campus', 'ateneo', 'facolta'],
    linkedStopIds: ['STOP_CAMPUS', 'STOP_STAZIONE_ATENEO'],
    linkedDestinationIds: ['DEST_UNIVERSITA'],
    confidence: 'medium'
  },
  {
    id: 'PLACE_LUNGOMARE',
    displayName: 'Lungomare Nazario Sauro',
    placeType: 'area',
    spokenForms: ['lungomare', 'mare', 'nazario sauro'],
    linkedStopIds: ['STOP_LUNGOMARE'],
    linkedDestinationIds: ['DEST_LUNGOMARE'],
    confidence: 'high'
  },
  {
    id: 'PLACE_FACOLTA_BIOLOGIA',
    displayName: 'Facolta di Biologia',
    placeType: 'poi',
    spokenForms: ['facolta di biologia', 'biologia', 'dipartimento di biologia'],
    linkedStopIds: ['STOP_CAMPUS'],
    linkedDestinationIds: ['DEST_UNIVERSITA'],
    confidence: 'low',
    note: 'TODO: validare geografia precisa con dataset AMTAB ufficiale.'
  },
  {
    id: 'PLACE_CASA',
    displayName: 'Casa',
    placeType: 'spoken_target',
    spokenForms: ['casa', 'a casa', 'torno a casa'],
    linkedStopIds: [],
    linkedDestinationIds: [],
    confidence: 'contextual',
    note: 'Richiede risoluzione da preferiti utente o indirizzo dispositivo.'
  }
];
