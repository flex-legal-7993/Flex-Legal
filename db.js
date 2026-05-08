// ─────────────────────────────────────────────────────────────────────────────
// Database Abstraction Layer
// Uses PostgreSQL when DATABASE_URL is set (Render), sql.js otherwise (local dev)
// ─────────────────────────────────────────────────────────────────────────────

const { Pool } = require('pg');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'intakes.db');

let pool = null;   // pg pool (Postgres mode)
let sqlDb = null;   // sql.js database (local mode)
let mode = null;    // 'pg' or 'sqlite'

// ─── Initialization ──────────────────────────────────────────────────────────

async function initDatabase() {
  if (DATABASE_URL) {
    mode = 'pg';
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false } // Render requires SSL
    });

    // Test connection
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('✅ Connected to PostgreSQL');
    } finally {
      client.release();
    }

    // Create tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS intakes (
        id SERIAL PRIMARY KEY,
        client_name TEXT NOT NULL,
        client_email TEXT,
        client_phone TEXT,
        package_type TEXT NOT NULL,
        trust_type TEXT NOT NULL,
        intake_data TEXT NOT NULL,
        documents TEXT DEFAULT '[]',
        status TEXT DEFAULT 'new',
        previous_status TEXT DEFAULT NULL,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS attorneys (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        firm_name TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add previous_status column if missing (migration for existing DBs)
    try {
      await pool.query('ALTER TABLE intakes ADD COLUMN IF NOT EXISTS previous_status TEXT DEFAULT NULL');
    } catch (e) { /* already exists */ }

    // Seed if empty
    const countResult = await pool.query('SELECT COUNT(*) FROM intakes');
    if (parseInt(countResult.rows[0].count) === 0) {
      await seedSampleClientsPg();
    }

    console.log('PostgreSQL database initialized');

  } else {
    mode = 'sqlite';
    const SQL = await initSqlJs();
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      sqlDb = new SQL.Database(fileBuffer);
    } else {
      sqlDb = new SQL.Database();
    }

    sqlDb.run(`CREATE TABLE IF NOT EXISTS intakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_name TEXT NOT NULL,
      client_email TEXT,
      client_phone TEXT,
      package_type TEXT NOT NULL,
      trust_type TEXT NOT NULL,
      intake_data TEXT NOT NULL,
      documents TEXT DEFAULT '[]',
      status TEXT DEFAULT 'new',
      previous_status TEXT DEFAULT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);

    try { sqlDb.run('ALTER TABLE intakes ADD COLUMN previous_status TEXT DEFAULT NULL'); } catch (e) { /* exists */ }

    sqlDb.run(`CREATE TABLE IF NOT EXISTS attorneys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      firm_name TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    const count = sqlDb.exec('SELECT COUNT(*) FROM intakes');
    if (count[0].values[0][0] === 0) seedSampleClientsSqlite();

    saveSqlite();
    console.log('SQLite database initialized at', DB_PATH);
  }
}

function saveSqlite() {
  if (mode !== 'sqlite' || !sqlDb) return;
  const data = sqlDb.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ─── Unified Query Interface ─────────────────────────────────────────────────

// Returns array of row objects
async function query(sql, params = []) {
  if (mode === 'pg') {
    let idx = 0;
    let pgSql = sql.replace(/\?/g, () => `$${++idx}`);
    pgSql = pgSql.replace(/datetime\('now'\)/g, 'NOW()');
    const result = await pool.query(pgSql, params);
    return result.rows;
  } else {
    // sql.js: run a SELECT and return array of objects
    const stmt = sqlDb.prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

// Execute a write (INSERT/UPDATE/DELETE), returns { lastId, changes }
async function execute(sql, params = []) {
  if (mode === 'pg') {
    let idx = 0;
    let pgSql = sql.replace(/\?/g, () => `$${++idx}`);

    // Convert SQLite datetime('now') to Postgres NOW()
    pgSql = pgSql.replace(/datetime\('now'\)/g, 'NOW()');

    // For INSERT, add RETURNING id to get lastId
    const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
    if (isInsert && !pgSql.toUpperCase().includes('RETURNING')) {
      pgSql += ' RETURNING id';
    }

    const result = await pool.query(pgSql, params);
    return {
      lastId: isInsert && result.rows.length ? result.rows[0].id : null,
      changes: result.rowCount
    };
  } else {
    const stmt = sqlDb.prepare(sql);
    stmt.run(params);
    stmt.free();
    saveSqlite();

    // Get last insert id
    const idResult = sqlDb.exec('SELECT last_insert_rowid() as id');
    const lastId = idResult.length ? idResult[0].values[0][0] : null;
    return { lastId, changes: sqlDb.getRowsModified() };
  }
}

// Get a single row or null
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

// Get raw count
async function count(table) {
  const rows = await query(`SELECT COUNT(*) as cnt FROM ${table}`);
  if (mode === 'pg') return parseInt(rows[0].cnt);
  return rows[0].cnt;
}

// Check if database is ready
function isReady() {
  return mode === 'pg' ? !!pool : !!sqlDb;
}

// Get the pg pool for session store (null if sqlite mode)
function getPool() {
  return pool;
}

function getMode() {
  return mode;
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

const sampleClients = [
  {
    name: 'Robert & Linda Thompson', email: 'rthompson@email.com', phone: '801-555-2341',
    package_type: 'Complete Estate Plan — Married', trust_type: 'joint',
    status: 'new', notes: '',
    docs: ['Joint Trust'], created_offset: '-1 day',
    data: { Your_First_Name: 'Robert', Your_Last_Name: 'Thompson', Spouse_First_Name: 'Linda',
      Your_Birth_Date: '03/15/1968', Address: '1842 Maple Dr', City: 'Draper', State: 'Utah',
      Zip_Code: '84020', County: 'Salt Lake', Your_Cell_Phone: '801-555-2341',
      Name_of_Trust: 'The Thompson Family Trust', First_Choice_Successor_Trustee: 'Sarah Thompson',
      Second_Choice_Successor_Trustee: 'Michael Thompson', Full_Legal_Names_of_Children: 'Sarah Thompson, Michael Thompson, Emily Thompson',
      client_email: 'rthompson@email.com', Trust_Type: 'joint',
      Attorney_Flags: 'Has property in multiple states | Spouse has prior will from previous marriage' }
  },
  {
    name: 'Maria Santos', email: 'msantos@email.com', phone: '801-555-8912',
    package_type: 'Complete Estate Plan — Single', trust_type: 'single',
    status: 'reviewed', notes: 'Reviewed trust provisions. Client has rental property — need to discuss funding the trust with real estate.',
    docs: ['Single Trust'], created_offset: '-3 days',
    data: { Your_First_Name: 'Maria', Your_Last_Name: 'Santos',
      Your_Birth_Date: '07/22/1975', Address: '590 E Center St', City: 'Provo', State: 'Utah',
      Zip_Code: '84606', County: 'Utah', Your_Cell_Phone: '801-555-8912',
      Name_of_Trust: 'The Maria Santos Revocable Living Trust', First_Choice_Successor_Trustee: 'Carlos Santos',
      Second_Choice_Successor_Trustee: 'Ana Ramirez', Full_Legal_Names_of_Children: 'Isabella Santos, Diego Santos',
      client_email: 'msantos@email.com', Trust_Type: 'single' }
  },
  {
    name: 'James & Patricia Kimball', email: 'jpkimball@email.com', phone: '435-555-6743',
    package_type: 'Complete Estate Plan — Married', trust_type: 'joint',
    status: 'signed', notes: 'Documents signed 4/18. Waiting on notarized copies to be returned.',
    docs: ['Joint Trust'], created_offset: '-7 days',
    data: { Your_First_Name: 'James', Your_Last_Name: 'Kimball', Spouse_First_Name: 'Patricia',
      Your_Birth_Date: '11/03/1955', Address: '2100 N Snow Canyon Pkwy', City: 'St. George', State: 'Utah',
      Zip_Code: '84770', County: 'Washington', Your_Cell_Phone: '435-555-6743',
      Name_of_Trust: 'The Kimball Family Trust', First_Choice_Successor_Trustee: 'David Kimball',
      Second_Choice_Successor_Trustee: 'Rachel Kimball-Wright',
      Full_Legal_Names_of_Children: 'David Kimball, Rachel Kimball-Wright, Andrew Kimball',
      client_email: 'jpkimball@email.com', Trust_Type: 'joint' }
  },
  {
    name: 'Angela Whitfield', email: 'awhitfield@email.com', phone: '801-555-3390',
    package_type: 'Self-Service', trust_type: 'selfservice',
    status: 'new', notes: '',
    docs: ['Will', 'Financial POA', 'Healthcare Directive'], created_offset: '-2 hours',
    data: { Your_First_Name: 'Angela', Your_Last_Name: 'Whitfield',
      Your_Birth_Date: '09/14/1990', Address: '415 S 700 E Apt 12', City: 'Salt Lake City', State: 'Utah',
      Zip_Code: '84102', County: 'Salt Lake', Your_Cell_Phone: '801-555-3390',
      has_children: false, Beneficiary_Names: 'Derek Whitfield, Carla Whitfield',
      First_Choice_Personal_Rep: 'Derek Whitfield', Second_Choice_Personal_Rep: 'Carla Whitfield',
      client_email: 'awhitfield@email.com', Trust_Type: 'selfservice',
      needs_dpoa: true, needs_will: true, needs_hcd: true }
  },
  {
    name: 'William Chen', email: 'wchen@email.com', phone: '801-555-1178',
    package_type: 'Self-Service', trust_type: 'selfservice',
    status: 'complete', notes: 'Client purchased self-service will only. No follow-up needed.',
    docs: ['Will'], created_offset: '-10 days',
    data: { Your_First_Name: 'William', Your_Last_Name: 'Chen',
      Your_Birth_Date: '04/30/1982', Address: '1020 E Tabernacle', City: 'St. George', State: 'Utah',
      Zip_Code: '84770', County: 'Washington', Your_Cell_Phone: '801-555-1178',
      has_children: true, has_minor_children: true, Beneficiary_Names: 'Lily Chen, Marcus Chen',
      First_Choice_Personal_Rep: 'Susan Chen', Second_Choice_Personal_Rep: 'David Park',
      First_Choice_Guardian: 'Susan Chen', Second_Choice_Guardian: 'David Park',
      client_email: 'wchen@email.com', Trust_Type: 'selfservice',
      needs_dpoa: false, needs_will: true, needs_hcd: false }
  },
  {
    name: 'Steven & Karen Merrill', email: 'smerrill@email.com', phone: '801-555-4402',
    package_type: 'Complete Estate Plan — Married', trust_type: 'joint',
    status: 'complete', notes: 'All documents signed, notarized, and filed. Trust funding letter sent. Case closed.',
    docs: ['Joint Trust'], created_offset: '-14 days',
    data: { Your_First_Name: 'Steven', Your_Last_Name: 'Merrill', Spouse_First_Name: 'Karen',
      Your_Birth_Date: '06/12/1960', Address: '834 E Vineyard Way', City: 'Orem', State: 'Utah',
      Zip_Code: '84097', County: 'Utah', Your_Cell_Phone: '801-555-4402',
      Name_of_Trust: 'The Merrill Family Trust', First_Choice_Successor_Trustee: 'Brandon Merrill',
      Second_Choice_Successor_Trustee: 'Jessica Merrill-Brown',
      Full_Legal_Names_of_Children: 'Brandon Merrill, Jessica Merrill-Brown',
      client_email: 'smerrill@email.com', Trust_Type: 'joint' }
  },
  {
    name: 'Diane Kowalski', email: 'dkowalski@email.com', phone: '385-555-9021',
    package_type: 'Attorney-Directed Documents', trust_type: 'standalone',
    status: 'reviewed', notes: 'DPOA and HCD look good. Scheduling signing appointment for next week.',
    docs: ['Financial POA', 'Healthcare Directive'], created_offset: '-5 days',
    data: { Your_First_Name: 'Diane', Your_Last_Name: 'Kowalski',
      Your_Birth_Date: '02/28/1972', Address: '2255 Parleys Way', City: 'Salt Lake City', State: 'Utah',
      Zip_Code: '84109', County: 'Salt Lake', Your_Cell_Phone: '385-555-9021',
      DPOA_Agent_Name: 'Thomas Kowalski', Agent_Address: '2255 Parleys Way',
      Agent_City: 'Salt Lake City', Agent_State: 'Utah', Agent_Zip: '84109',
      client_email: 'dkowalski@email.com', Trust_Type: 'standalone',
      needs_dpoa: true, needs_will: false, needs_hcd: true }
  }
];

async function seedSampleClientsPg() {
  console.log('Seeding sample clients for dashboard preview...');
  for (const s of sampleClients) {
    await pool.query(
      `INSERT INTO intakes (client_name, client_email, client_phone, package_type, trust_type, intake_data, documents, status, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + $10::interval)`,
      [s.name, s.email, s.phone, s.package_type, s.trust_type,
       JSON.stringify(s.data), JSON.stringify(s.docs), s.status, s.notes, s.created_offset]
    );
  }
  console.log(`Seeded ${sampleClients.length} sample clients`);
}

function seedSampleClientsSqlite() {
  console.log('Seeding sample clients for dashboard preview...');
  const offsetMap = {
    '-1 day': "datetime('now', '-1 day')",
    '-3 days': "datetime('now', '-3 days')",
    '-7 days': "datetime('now', '-7 days')",
    '-2 hours': "datetime('now', '-2 hours')",
    '-10 days': "datetime('now', '-10 days')",
    '-14 days': "datetime('now', '-14 days')",
    '-5 days': "datetime('now', '-5 days')"
  };

  sampleClients.forEach(s => {
    const created = offsetMap[s.created_offset] || "datetime('now')";
    sqlDb.run(
      `INSERT INTO intakes (client_name, client_email, client_phone, package_type, trust_type, intake_data, documents, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${created})`,
      [s.name, s.email, s.phone, s.package_type, s.trust_type,
       JSON.stringify(s.data), JSON.stringify(s.docs), s.status, s.notes]
    );
  });
  console.log(`Seeded ${sampleClients.length} sample clients`);
}

module.exports = {
  initDatabase,
  query,
  queryOne,
  execute,
  count,
  isReady,
  getPool,
  getMode,
  saveSqlite
};
