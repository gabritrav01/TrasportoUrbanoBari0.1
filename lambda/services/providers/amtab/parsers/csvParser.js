'use strict';

function toText(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function parseCsvRows(text) {
  const content = toText(text).replace(/^\uFEFF/, '');
  if (!content) {
    return [];
  }

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inQuotes) {
      if (char === '"') {
        const next = content[index + 1];
        if (next === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }

    if (char !== '\r') {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseCsvTable(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((value) => toText(value));
  return rows
    .slice(1)
    .filter((values) => values.some((value) => toText(value)))
    .map((values) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = values[index] !== undefined ? toText(values[index]) : '';
      });
      return record;
    });
}

module.exports = {
  parseCsvTable
};

