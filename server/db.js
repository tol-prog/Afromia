const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS documents (
      collection TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection, doc_id)
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents (collection);`);
}

// Seed the real Afromia data on first boot only (when the documents table is empty).
// This makes a fresh Railway deploy self-contained — no manual migration step.
async function seedIfEmpty() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM documents');
  if (rows[0].n > 0) return { seeded: false };

  const seedPath = path.join(__dirname, 'seed-data.json');
  if (!fs.existsSync(seedPath)) return { seeded: false };
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const client = await pool.connect();
  let count = 0;
  try {
    await client.query('BEGIN');
    for (const collection of Object.keys(seed)) {
      const docs = seed[collection];
      for (const docId of Object.keys(docs)) {
        await client.query(
          `INSERT INTO documents (collection, doc_id, data, updated_at)
           VALUES ($1, $2, $3::jsonb, now())
           ON CONFLICT (collection, doc_id) DO NOTHING`,
          [collection, docId, JSON.stringify(docs[docId])]
        );
        count++;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { seeded: true, count };
}

module.exports = { pool, query, initSchema, seedIfEmpty };
