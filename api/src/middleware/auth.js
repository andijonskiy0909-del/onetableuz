/**
 * OneTable — Auth Middleware
 * JWT authentication for users and owners
 */
const jwt = require('jsonwebtoken');

// ── User Auth ─────────────────────────────────────────────────
function userAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token kerak' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token muddati tugagan. Qayta kiring.' });
    }
    return res.status(401).json({ error: 'Token noto\'g\'ri' });
  }
}

// ── Owner Auth ────────────────────────────────────────────────
function ownerAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token kerak' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'owner' && decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Ruxsat yo\'q' });
    }
    req.owner = decoded;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token muddati tugagan. Qayta kiring.' });
    }
    return res.status(401).json({ error: 'Token noto\'g\'ri' });
  }
}

// ── Admin Only ────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token kerak' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Faqat admin uchun' });
    }
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token noto\'g\'ri' });
  }
}

// ── Token yaratish ────────────────────────────────────────────
function createToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

module.exports = { userAuth, ownerAuth, adminAuth, createToken };
