'use strict';

const STOPS = [
  {
    id: 'STOP_STAZIONE_CAPRUZZI',
    name: 'Stazione Centrale Piazza Moro lato Capruzzi',
    aliases: ['stazione', 'piazza moro', 'capruzzi', 'centrale'],
    coordinates: { lat: 41.1177, lon: 16.8697 },
    lineIds: ['1', '2/', '6', '10', '12', '14', 'C'],
    source: 'stub'
  },
  {
    id: 'STOP_STAZIONE_ATENEO',
    name: 'Stazione Centrale Piazza Moro lato Ateneo',
    aliases: ['stazione ateneo', 'piazza moro ateneo', 'ateneo'],
    coordinates: { lat: 41.1173, lon: 16.8711 },
    lineIds: ['2/', '6', '10', '14'],
    source: 'stub'
  },
  {
    id: 'STOP_POLICLINICO',
    name: 'Policlinico ingresso principale',
    aliases: ['policlinico', 'ospedale', 'ospedale policlinico'],
    coordinates: { lat: 41.1104, lon: 16.8588 },
    lineIds: ['2/'],
    source: 'stub'
  },
  {
    id: 'STOP_CAMPUS',
    name: 'Campus Universitario',
    aliases: ['universita', 'campus', 'ateneo campus'],
    coordinates: { lat: 41.1052, lon: 16.8801 },
    lineIds: ['2/', '10'],
    source: 'stub'
  },
  {
    id: 'STOP_LUNGOMARE',
    name: 'Lungomare Nazario Sauro',
    aliases: ['lungomare', 'mare', 'nazario sauro'],
    coordinates: { lat: 41.1261, lon: 16.8789 },
    lineIds: ['14'],
    source: 'stub'
  },
  {
    id: 'STOP_PIAZZA_MASSARI',
    name: 'Piazza Massari',
    aliases: ['massari', 'centro storico'],
    coordinates: { lat: 41.1272, lon: 16.8667 },
    lineIds: ['1', '12', 'C'],
    source: 'stub'
  },
  {
    id: 'STOP_PORTO',
    name: 'Porto di Bari',
    aliases: ['porto', 'terminal porto'],
    coordinates: { lat: 41.1358, lon: 16.8676 },
    lineIds: ['1'],
    source: 'stub'
  },
  {
    id: 'STOP_SAN_PAOLO',
    name: 'San Paolo viale Europa',
    aliases: ['san paolo', 'viale europa'],
    coordinates: { lat: 41.1451, lon: 16.8207 },
    lineIds: ['12'],
    source: 'stub'
  },
  {
    id: 'STOP_POGGIOFRANCO',
    name: 'Poggiofranco via Camillo Rosalba',
    aliases: ['poggiofranco', 'rosalba'],
    coordinates: { lat: 41.1017, lon: 16.8765 },
    lineIds: ['6'],
    source: 'stub'
  },
  {
    id: 'STOP_AEROPORTO',
    name: 'Aeroporto Karol Wojtyla',
    aliases: ['aeroporto', 'palese', 'karol wojtyla'],
    coordinates: { lat: 41.1369, lon: 16.7604 },
    lineIds: ['C'],
    source: 'stub'
  }
];

const DESTINATION_TARGETS = [
  {
    id: 'DEST_STAZIONE',
    name: 'Stazione Centrale Bari',
    aliases: ['stazione', 'piazza moro', 'centrale'],
    targetStopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_STAZIONE_ATENEO'],
    source: 'stub'
  },
  {
    id: 'DEST_UNIVERSITA',
    name: 'Universita degli Studi di Bari',
    aliases: ['universita', 'ateneo', 'campus'],
    targetStopIds: ['STOP_CAMPUS'],
    source: 'stub'
  },
  {
    id: 'DEST_POLICLINICO',
    name: 'Policlinico di Bari',
    aliases: ['policlinico', 'ospedale'],
    targetStopIds: ['STOP_POLICLINICO'],
    source: 'stub'
  },
  {
    id: 'DEST_LUNGOMARE',
    name: 'Lungomare Nazario Sauro',
    aliases: ['lungomare', 'mare', 'sauro'],
    targetStopIds: ['STOP_LUNGOMARE'],
    source: 'stub'
  },
  {
    id: 'DEST_PORTO',
    name: 'Porto di Bari',
    aliases: ['porto', 'terminal porto'],
    targetStopIds: ['STOP_PORTO'],
    source: 'stub'
  },
  {
    id: 'DEST_SAN_PAOLO',
    name: 'San Paolo',
    aliases: ['san paolo', 'viale europa'],
    targetStopIds: ['STOP_SAN_PAOLO'],
    source: 'stub'
  },
  {
    id: 'DEST_POGGIOFRANCO',
    name: 'Poggiofranco',
    aliases: ['poggiofranco', 'rosalba'],
    targetStopIds: ['STOP_POGGIOFRANCO'],
    source: 'stub'
  },
  {
    id: 'DEST_AEROPORTO',
    name: 'Aeroporto Karol Wojtyla',
    aliases: ['aeroporto', 'palese'],
    targetStopIds: ['STOP_AEROPORTO'],
    source: 'stub'
  }
];

const LINES = [
  {
    id: '1',
    aliases: ['linea 1', 'uno'],
    destinationTargetId: 'DEST_PORTO',
    destinationName: 'Porto di Bari',
    stopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_PIAZZA_MASSARI', 'STOP_PORTO'],
    firstMinute: 300,
    lastMinute: 1410,
    headwayMinutes: 15,
    source: 'stub'
  },
  {
    id: '2/',
    aliases: ['linea 2 barra', 'due barra', 'due slash'],
    destinationTargetId: 'DEST_POLICLINICO',
    destinationName: 'Policlinico di Bari',
    stopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_STAZIONE_ATENEO', 'STOP_POLICLINICO', 'STOP_CAMPUS'],
    firstMinute: 300,
    lastMinute: 1410,
    headwayMinutes: 12,
    source: 'stub'
  },
  {
    id: '6',
    aliases: ['linea 6', 'sei'],
    destinationTargetId: 'DEST_POGGIOFRANCO',
    destinationName: 'Poggiofranco',
    stopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_STAZIONE_ATENEO', 'STOP_POGGIOFRANCO'],
    firstMinute: 305,
    lastMinute: 1390,
    headwayMinutes: 15,
    source: 'stub'
  },
  {
    id: '10',
    aliases: ['linea 10', 'dieci'],
    destinationTargetId: 'DEST_UNIVERSITA',
    destinationName: 'Universita degli Studi di Bari',
    stopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_STAZIONE_ATENEO', 'STOP_CAMPUS'],
    firstMinute: 315,
    lastMinute: 1400,
    headwayMinutes: 14,
    source: 'stub'
  },
  {
    id: '12',
    aliases: ['linea 12', 'dodici'],
    destinationTargetId: 'DEST_SAN_PAOLO',
    destinationName: 'San Paolo',
    stopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_PIAZZA_MASSARI', 'STOP_SAN_PAOLO'],
    firstMinute: 320,
    lastMinute: 1410,
    headwayMinutes: 20,
    source: 'stub'
  },
  {
    id: '14',
    aliases: ['linea 14', 'quattordici'],
    destinationTargetId: 'DEST_LUNGOMARE',
    destinationName: 'Lungomare Nazario Sauro',
    stopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_STAZIONE_ATENEO', 'STOP_LUNGOMARE'],
    firstMinute: 325,
    lastMinute: 1405,
    headwayMinutes: 18,
    source: 'stub'
  },
  {
    id: 'C',
    aliases: ['linea c', 'c aeroporto'],
    destinationTargetId: 'DEST_AEROPORTO',
    destinationName: 'Aeroporto Karol Wojtyla',
    stopIds: ['STOP_STAZIONE_CAPRUZZI', 'STOP_PIAZZA_MASSARI', 'STOP_AEROPORTO'],
    firstMinute: 340,
    lastMinute: 1380,
    headwayMinutes: 30,
    source: 'stub'
  }
];

function buildCatalogIndexes() {
  const stopById = new Map(STOPS.map((stop) => [stop.id, stop]));
  const destinationById = new Map(DESTINATION_TARGETS.map((destinationTarget) => [destinationTarget.id, destinationTarget]));
  const lineById = new Map(LINES.map((line) => [line.id, line]));
  return {
    stopById,
    destinationById,
    lineById
  };
}

module.exports = {
  STOPS,
  DESTINATION_TARGETS,
  LINES,
  buildCatalogIndexes
};
