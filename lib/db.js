const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'db', 'data.db');

// Ensure db directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let rawDb = null;

// Auto-save to disk after writes
function saveToFile() {
  const data = rawDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// better-sqlite3–compatible prepared statement
function prepare(sql) {
  return {
    get(...params) {
      const stmt = rawDb.prepare(sql);
      if (params.length > 0) stmt.bind(params);
      let row;
      if (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
      }
      stmt.free();
      return row;
    },

    all(...params) {
      const stmt = rawDb.prepare(sql);
      if (params.length > 0) stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        const cols = stmt.getColumnNames();
        const vals = stmt.get();
        const row = {};
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
        rows.push(row);
      }
      stmt.free();
      return rows;
    },

    run(...params) {
      rawDb.run(sql, params.length > 0 ? params : undefined);
      const changes = rawDb.getRowsModified();
      const ridStmt = rawDb.prepare('SELECT last_insert_rowid() as rid');
      ridStmt.step();
      const lastInsertRowid = ridStmt.get()[0];
      ridStmt.free();
      saveToFile();
      return { changes, lastInsertRowid };
    },
  };
}

function exec(sql) {
  rawDb.exec(sql);
  saveToFile();
}

function pragma(setting) {
  try {
    rawDb.exec('PRAGMA ' + setting);
  } catch (_) {
    // sql.js doesn't support all pragmas (e.g. WAL)
  }
}

// Async init — must await `ready` before using any DB methods
const ready = initSqlJs().then((SQL) => {
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(buffer);
  } else {
    rawDb = new SQL.Database();
  }

  // Pragmas
  try { rawDb.exec('PRAGMA foreign_keys = ON'); } catch (_) {}

  // Schema
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  rawDb.exec(schema);
  saveToFile();
});

module.exports = { prepare, exec, pragma, ready };
