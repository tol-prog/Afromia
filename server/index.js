const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { query, initSchema, seedIfEmpty } = require('./db');
const { signToken, hashPassword, comparePassword, requireAuth, requireAdmin } = require('./auth');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Collections that any authenticated staff (admin or trainer) may write to,
// because they're routine day-to-day duties (taking attendance, recording
// assessment scores). Everything else requires an administrator.
const STAFF_WRITABLE = new Set(['attendance', 'assessments']);

function canWrite(auth, collection) {
  if (auth.role === 'admin') return true;
  return STAFF_WRITABLE.has(collection);
}

// Never let staff PINs/password hashes leave the server.
function sanitizeStaffData(data) {
  if (!data) return data;
  const { passwordHash, pin, password, ...rest } = data;
  return rest;
}
function sanitize(collection, data) {
  return collection === 'staff' ? sanitizeStaffData(data) : data;
}

/* ------------------------------------------------------------------ */
/* auth routes                                                         */
/* ------------------------------------------------------------------ */

app.get('/api/auth/status', async (req, res) => {
  try {
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM documents WHERE collection = 'staff'`);
    res.json({ hasStaff: rows[0].n > 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/bootstrap-admin', async (req, res) => {
  try {
    const { rows } = await query(`SELECT COUNT(*)::int AS n FROM documents WHERE collection = 'staff'`);
    if (rows[0].n > 0) return res.status(409).json({ error: 'An administrator account already exists. Please sign in.' });

    const { name, username, password, phone } = req.body || {};
    if (!name || !username || !password) return res.status(400).json({ error: 'Name, username and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const data = {
      name, username: String(username).trim().toLowerCase(), passwordHash,
      role: 'admin', branchId: 'all', phone: phone || '', active: true,
      createdAt: new Date().toISOString(),
    };
    await query(
      `INSERT INTO documents (collection, doc_id, data, updated_at) VALUES ('staff', $1, $2::jsonb, now())`,
      [id, JSON.stringify(data)]
    );
    const staff = { id, name: data.name, role: data.role, branchId: data.branchId, phone: data.phone };
    res.json({ token: signToken(staff), staff });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
    const { rows } = await query(
      `SELECT doc_id, data FROM documents WHERE collection = 'staff' AND lower(data->>'username') = lower($1)`,
      [String(username).trim()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });
    const row = rows[0];
    const ok = await comparePassword(password, row.data.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
    if (row.data.active === false) return res.status(403).json({ error: 'This account has been deactivated' });

    const staff = { id: row.doc_id, name: row.data.name, role: row.data.role, branchId: row.data.branchId, phone: row.data.phone || '' };
    res.json({ token: signToken(staff), staff });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* generic document store — /api/db/:collection[/:docId]               */
/* ------------------------------------------------------------------ */

app.use('/api/db', requireAuth);

app.get('/api/db/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    const { field, value } = req.query;
    let rows;
    if (field && value !== undefined) {
      ({ rows } = await query(
        `SELECT doc_id, data, updated_at FROM documents WHERE collection = $1 AND data->>$2 = $3`,
        [collection, field, String(value)]
      ));
    } else {
      ({ rows } = await query(`SELECT doc_id, data, updated_at FROM documents WHERE collection = $1`, [collection]));
    }
    res.json(rows.map(r => ({ id: r.doc_id, data: sanitize(collection, r.data), updatedAt: r.updated_at })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/db/:collection/:docId', async (req, res) => {
  try {
    const { collection, docId } = req.params;
    const { rows } = await query(`SELECT data, updated_at FROM documents WHERE collection = $1 AND doc_id = $2`, [collection, docId]);
    if (!rows.length) return res.json({ exists: false, id: docId, data: null });
    res.json({ exists: true, id: docId, data: sanitize(collection, rows[0].data), updatedAt: rows[0].updated_at });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

async function prepareWriteData(collection, incoming, existing) {
  if (collection !== 'staff') return incoming;
  const merged = { ...incoming };
  if (merged.password) {
    merged.passwordHash = await hashPassword(merged.password);
  }
  delete merged.password;
  // Never allow a write to blank out an existing password hash.
  if (!merged.passwordHash && existing && existing.passwordHash) merged.passwordHash = existing.passwordHash;
  if (merged.username) merged.username = String(merged.username).trim().toLowerCase();
  return merged;
}

async function checkUsernameFree(username, excludeDocId) {
  if (!username) return true;
  const { rows } = await query(
    `SELECT doc_id FROM documents WHERE collection = 'staff' AND lower(data->>'username') = lower($1)`,
    [username]
  );
  return rows.every(r => r.doc_id === excludeDocId);
}

// create with a generated id (mirrors the old db.collection(x).add(data))
app.post('/api/db/:collection', async (req, res) => {
  try {
    const { collection } = req.params;
    if (!canWrite(req.auth, collection)) return res.status(403).json({ error: 'Administrator access required' });
    const id = crypto.randomUUID();
    let data = req.body || {};
    if (collection === 'staff') {
      if (!data.username || !data.password) return res.status(400).json({ error: 'Username and password are required' });
      if (!(await checkUsernameFree(data.username, null))) return res.status(409).json({ error: 'That username is already taken' });
      data = await prepareWriteData(collection, data, null);
    }
    await query(
      `INSERT INTO documents (collection, doc_id, data, updated_at) VALUES ($1, $2, $3::jsonb, now())`,
      [collection, id, JSON.stringify(data)]
    );
    res.json({ id, data: sanitize(collection, data) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// full replace / upsert (mirrors doc.set())
app.put('/api/db/:collection/:docId', async (req, res) => {
  try {
    const { collection, docId } = req.params;
    if (!canWrite(req.auth, collection)) return res.status(403).json({ error: 'Administrator access required' });
    let data = req.body || {};
    if (collection === 'staff') {
      const { rows } = await query(`SELECT data FROM documents WHERE collection = 'staff' AND doc_id = $1`, [docId]);
      const existing = rows[0] ? rows[0].data : null;
      if (data.username && !(await checkUsernameFree(data.username, docId))) return res.status(409).json({ error: 'That username is already taken' });
      data = await prepareWriteData(collection, data, existing);
    }
    await query(
      `INSERT INTO documents (collection, doc_id, data, updated_at) VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (collection, doc_id) DO UPDATE SET data = $3::jsonb, updated_at = now()`,
      [collection, docId, JSON.stringify(data)]
    );
    res.json({ id: docId, data: sanitize(collection, data) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// merge update (mirrors doc.update())
app.patch('/api/db/:collection/:docId', async (req, res) => {
  try {
    const { collection, docId } = req.params;
    if (!canWrite(req.auth, collection)) return res.status(403).json({ error: 'Administrator access required' });
    const { rows } = await query(`SELECT data FROM documents WHERE collection = $1 AND doc_id = $2`, [collection, docId]);
    const existing = rows[0] ? rows[0].data : {};
    let patch = req.body || {};
    if (collection === 'staff') {
      if (patch.username && !(await checkUsernameFree(patch.username, docId))) return res.status(409).json({ error: 'That username is already taken' });
      patch = await prepareWriteData(collection, patch, existing);
    }
    const merged = { ...existing, ...patch };
    await query(
      `INSERT INTO documents (collection, doc_id, data, updated_at) VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (collection, doc_id) DO UPDATE SET data = $3::jsonb, updated_at = now()`,
      [collection, docId, JSON.stringify(merged)]
    );
    res.json({ id: docId, data: sanitize(collection, merged) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/db/:collection/:docId', requireAdmin, async (req, res) => {
  try {
    const { collection, docId } = req.params;
    await query(`DELETE FROM documents WHERE collection = $1 AND doc_id = $2`, [collection, docId]);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ------------------------------------------------------------------ */
/* static frontend                                                     */
/* ------------------------------------------------------------------ */

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await initSchema();
    const seedResult = await seedIfEmpty();
    if (seedResult.seeded) console.log(`Seeded ${seedResult.count} documents from server/seed-data.json`);
    app.listen(PORT, () => console.log(`Afromia Training Manager listening on port ${PORT}`));
  } catch (e) {
    console.error('Failed to start server:', e);
    process.exit(1);
  }
})();
