const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function extractToken(req) {
  return req.headers.authorization?.split(' ')[1] || null;
}

function createToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

// ── User Auth ──────────────────────────────────────────────────
function userAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token kerak' });
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token muddati tugagan. Qayta kiring.' });
    }
    return res.status(401).json({ error: "Token noto'g'ri" });
  }
}

// ── Owner Auth ─────────────────────────────────────────────────
function ownerAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token kerak' });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== 'owner' && decoded.role !== 'admin') {
      return res.status(403).json({ error: "Ruxsat yo'q" });
    }
    req.owner = decoded;
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token muddati tugagan. Qayta kiring.' });
    }
    return res.status(401).json({ error: "Token noto'g'ri" });
  }
}

// ── Admin Auth ─────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token kerak' });
  try {
    const decoded = verifyToken(token);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Faqat admin uchun' });
    }
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token noto'g'ri" });
  }
}

// ── Optional Auth (public routes) ─────────────────────────────
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try { req.user = verifyToken(token); } catch (e) {}
  }
  next();
}

module.exports = { userAuth, ownerAuth, adminAuth, optionalAuth, createToken };
