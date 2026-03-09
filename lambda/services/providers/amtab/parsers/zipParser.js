'use strict';

const { inflateRawSync } = require('zlib');
const { createGatewayError } = require('../clients/amtabApiClient');

const ZIP_SIGNATURES = Object.freeze({
  LOCAL_FILE_HEADER: 0x04034b50,
  CENTRAL_DIRECTORY_HEADER: 0x02014b50,
  END_OF_CENTRAL_DIRECTORY: 0x06054b50
});

const COMPRESSION_METHODS = Object.freeze({
  STORE: 0,
  DEFLATE: 8
});

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_SIGNATURES.END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  return -1;
}

function parseZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw createGatewayError('AMTAB_REAL_GTFS_PARSE_ERROR', 'GTFS archive buffer is empty');
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw createGatewayError('AMTAB_REAL_GTFS_PARSE_ERROR', 'GTFS archive does not contain EOCD');
  }

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let offset = centralDirectoryOffset;
  const endOffset = centralDirectoryOffset + centralDirectorySize;

  while (offset < endOffset) {
    if (buffer.readUInt32LE(offset) !== ZIP_SIGNATURES.CENTRAL_DIRECTORY_HEADER) {
      throw createGatewayError('AMTAB_REAL_GTFS_PARSE_ERROR', 'Invalid GTFS central directory header');
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const fileName = buffer.toString('utf8', fileNameStart, fileNameEnd);

    entries.set(fileName, {
      compressionMethod,
      compressedSize,
      localHeaderOffset
    });

    offset = fileNameEnd + extraLength + commentLength;
  }

  return entries;
}

function extractZipEntry(buffer, entries, fileName) {
  const entry = entries.get(fileName);
  if (!entry) {
    return null;
  }

  const localHeaderOffset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(localHeaderOffset) !== ZIP_SIGNATURES.LOCAL_FILE_HEADER) {
    throw createGatewayError('AMTAB_REAL_GTFS_PARSE_ERROR', `Invalid local header for ${fileName}`);
  }

  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  const compressedData = buffer.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === COMPRESSION_METHODS.STORE) {
    return Buffer.from(compressedData);
  }
  if (entry.compressionMethod === COMPRESSION_METHODS.DEFLATE) {
    return inflateRawSync(compressedData);
  }

  throw createGatewayError(
    'AMTAB_REAL_GTFS_PARSE_ERROR',
    `Unsupported compression method ${entry.compressionMethod} for ${fileName}`
  );
}

module.exports = {
  parseZipEntries,
  extractZipEntry
};

