'use strict';

// In-memory stand-in for the parts of SpreadsheetApp the repositories use. It keeps a grid per
// sheet and records every write, so a characterisation suite can pin both what a repository
// returns and exactly what it stores. Nothing here touches Google.
//
// Cell values are kept as given. To seed a Date cell, create the Date INSIDE the sandbox
// (see seedRows in the suites) so `instanceof Date` behaves as it does in Apps Script.

function createFakeSpreadsheet(journal) {
  const sheets = {};
  const isBlank = value => value === '' || value === null || value === undefined;

  function makeSheet(name) {
    const grid = [];
    const ensure = (rows, columns) => {
      while (grid.length < rows) grid.push([]);
      for (const row of grid) while (row.length < columns) row.push('');
    };
    const width = () => grid.reduce((max, row) => Math.max(max, row.length), 0);
    const sheet = {
      getName: () => name,
      getLastRow: () => {
        for (let r = grid.length; r > 0; r--) if (grid[r - 1].some(value => !isBlank(value))) return r;
        return 0;
      },
      getLastColumn: () => {
        let last = 0;
        for (const row of grid) for (let c = row.length; c > last; c--) if (!isBlank(row[c - 1])) { last = c; break; }
        return last;
      },
      getRange: (row, column, numRows, numColumns) => {
        const rows = numRows === undefined ? 1 : numRows;
        const columns = numColumns === undefined ? 1 : numColumns;
        if (row < 1 || column < 1 || rows < 1 || columns < 1) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
        const read = () => {
          ensure(row + rows - 1, Math.max(width(), column + columns - 1));
          return grid.slice(row - 1, row - 1 + rows).map(r => r.slice(column - 1, column - 1 + columns));
        };
        const range = {
          getValues: read,
          getValue: () => read()[0][0],
          getDisplayValues: () => read().map(r => r.map(value => (isBlank(value) ? '' : String(value)))),
          setValues: values => {
            if (values.length !== rows || values.some(r => r.length !== columns)) throw new Error('The number of rows or columns in the data does not match the range.');
            ensure(row + rows - 1, Math.max(width(), column + columns - 1));
            values.forEach((r, i) => r.forEach((value, j) => { grid[row - 1 + i][column - 1 + j] = value; }));
            journal.push({ sheet: name, setValues: { row, column, rows, columns }, values: JSON.parse(JSON.stringify(values)) });
            return range;
          },
          setValue: value => range.setValues([[value]]),
          setFontWeight: weight => { journal.push({ sheet: name, setFontWeight: weight, at: { row, column, rows, columns } }); return range; },
          setNumberFormat: format => { journal.push({ sheet: name, setNumberFormat: format, at: { row, column, rows, columns } }); return range; },
          setWrap: wrap => { journal.push({ sheet: name, setWrap: wrap }); return range; },
          setBackground: colour => { journal.push({ sheet: name, setBackground: colour }); return range; },
          setFontColor: colour => { journal.push({ sheet: name, setFontColor: colour }); return range; },
          clearContent: () => {
            ensure(row + rows - 1, Math.max(width(), column + columns - 1));
            for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) grid[row - 1 + i][column - 1 + j] = '';
            journal.push({ sheet: name, clearContent: { row, column, rows, columns } });
            return range;
          }
        };
        return range;
      },
      appendRow: values => {
        const target = sheet.getLastRow() + 1;
        ensure(target, Math.max(width(), values.length));
        values.forEach((value, j) => { grid[target - 1][j] = value; });
        journal.push({ sheet: name, appendRow: target, values: JSON.parse(JSON.stringify(values)) });
        return sheet;
      },
      deleteRow: row => { grid.splice(row - 1, 1); journal.push({ sheet: name, deleteRow: row }); return sheet; },
      setFrozenRows: count => { journal.push({ sheet: name, setFrozenRows: count }); return sheet; },
      autoResizeColumns: (start, count) => { journal.push({ sheet: name, autoResizeColumns: [start, count] }); return sheet; },
      setColumnWidth: (column, widthPx) => { journal.push({ sheet: name, setColumnWidth: [column, widthPx] }); return sheet; },
      // Test helpers (not part of the Apps Script API).
      __seed: rows => { rows.forEach(r => { grid.push(r.slice()); }); ensure(grid.length, width()); },
      __dump: () => JSON.parse(JSON.stringify(grid.slice(0, sheet.getLastRow())))
    };
    return sheet;
  }

  return {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => { journal.push({ insertSheet: name }); sheets[name] = makeSheet(name); return sheets[name]; },
    __create: name => { sheets[name] = makeSheet(name); return sheets[name]; },
    __names: () => Object.keys(sheets)
  };
}

module.exports = { createFakeSpreadsheet };
