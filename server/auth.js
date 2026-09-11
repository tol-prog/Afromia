const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly at boot rather than silently signing tokens with a guessable default.
  throw new Error('JWT_SECRET environment variable is required.');
}
const TOKEN_TTL = '30d';

function signToken(staff) {
  return jwt.sign(
    { staffId: staff.id, name: staff.name, role: staff.role, branchId: staff.branchId },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}
async function comparePassword(pw, hash) {
  if (!hash) return false;
  return bcrypt.compare(pw, hash);
}

// Express middleware: requires a valid Bearer token, sets req.auth = {staffId,name,role,branchId}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.auth = verifyToken(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.auth || req.auth.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
}

module.exports = { signToken, verifyToken, hashPassword, comparePassword, requireAuth, requireAdmin };
