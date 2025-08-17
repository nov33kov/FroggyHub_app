// netlify/functions/local-signup.js
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

// CORS + унифицированные ответы
function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': 'https://froggyhubapp.netlify.app',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    ...extra
  };
}
function ok(body, status = 200) {
  return { statusCode: status, headers: cors(), body: JSON.stringify(body) };
}
function err(message, status = 400, meta) {
  return { statusCode: status, headers: cors(), body: JSON.stringify({ success: false, error: message, ...(meta||{}) }) };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return err('Invalid JSON body', 400);
    }

    const { nickname, password, email } = payload;
    if (!nickname || !password) return err('Missing nickname or password', 400);

    const conn = process.env.DATABASE_URL;
    if (!conn) return err('DATABASE_URL is not set', 500);

    const client = new Client({
      connectionString: conn,
      ssl: { rejectUnauthorized: false }
    });

    await client.connect();

    // хэш пароля
    const passwordHash = await bcrypt.hash(password, 10);

    // вставка пользователя
    let result;
    try {
      result = await client.query(
        `INSERT INTO public.users_local (nickname, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, nickname, email, created_at`,
        [nickname, email || null, passwordHash]
      );
    } catch (e) {
      // PG duplicate key
      if (e && e.code === '23505') {
        await client.end();
        return err('Nickname already exists', 409);
      }
      throw e;
    }

    await client.end();

    return ok({ success: true, user: result.rows[0] }, 201);
  } catch (e) {
    console.error('local-signup error:', e && (e.stack || e.message || e));
    return err(e && e.message ? e.message : 'Internal error', 500);
  }
};
