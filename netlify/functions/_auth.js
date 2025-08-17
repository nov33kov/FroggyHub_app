// netlify/functions/_auth.js
const jwt = require('jsonwebtoken');

const CORS_ORIGIN = 'https://froggyhubapp.netlify.app';

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    ...extra
  };
}

function ok(body, status = 200) {
  return { statusCode: status, headers: cors(), body: JSON.stringify(body) };
}

function err(message, status = 400, meta) {
  return { statusCode: status, headers: cors(), body: JSON.stringify({ success: false, error: message, ...(meta||{}) }) };
}

function signToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.verify(token, secret);
}

// Достаём токен из Authorization: Bearer <token>
function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Обёртка для защищённых хендлеров
function requireAuth(handler) {
  return async (event, context) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    try {
      const token = getBearerToken(event);
      if (!token) return err('Unauthorized', 401);
      const claims = verifyToken(token);
      // прокинем user в context
      context.user = claims;
      return handler(event, context);
    } catch (e) {
      return err('Unauthorized', 401);
    }
  };
}

module.exports = { cors, ok, err, signToken, verifyToken, requireAuth, getBearerToken };
