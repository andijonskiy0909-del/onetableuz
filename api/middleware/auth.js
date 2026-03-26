// src/middleware/auth.js — JWT Authentication middleware
'use strict';

const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

function createToken(payload, expiresIn = env.JWT_EXPIRES_IN) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function handleTokenError(err, res) {
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token muddati tugagan. Qayta kiring.' });
  }
  return res.status(401).json({ error: "Token noto'g'ri" });
}

// ── Middlewares ───────────────────────────────────────────────

function userAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Token kerak' });
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    handleTokenError(err, res);
  }
}

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
  } catch (err) {
    handleTokenError(err, res);
  }
}

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
  } catch (err) {
    handleTokenError(err, res);
  }
}

// Optional auth — sets req.user if token exists, but doesn't block
function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try { req.user = verifyToken(token); } catch {}
  }
  next();
}

module.exports = { createToken, verifyToken, userAuth, ownerAuth, adminAuth, optionalAuth };
