// netlify/functions/local-login.js
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const { cors, ok, err, signToken } = require('./_auth');

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
    if (event.httpMethod !== 'POST') return err('Method not allowed', 405);

    let payload = {};
    try { payload = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON body', 400); }

    const { username, password } = payload;
    if (!username || !password) return err('Missing username or password', 400);

    const conn = process.env.DATABASE_URL;
    if (!conn) return err('DATABASE_URL is not set', 500);

    const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await client.connect();

    const { rows } = await client.query(
      'SELECT id, username, password_hash FROM public.local_users WHERE username=$1 LIMIT 1',
      [username]
    );

    if (!rows[0]) { await client.end(); return err('User not found', 401); }

    const user = rows[0];
    const okPass = await bcrypt.compare(password, user.password_hash);
    if (!okPass) { await client.end(); return err('Invalid password', 401); }

    await client.end();

    // JWT
    const token = signToken({ sub: user.id, username: user.username });

    return ok({ success: true, token, user: { id: user.id, username: user.username } });
  } catch (e) {
    console.error('local-login error:', e && (e.stack || e.message || e));
    return err(e && e.message ? e.message : 'Internal error', 500);
  }
};
