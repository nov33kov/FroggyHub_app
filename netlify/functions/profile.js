// netlify/functions/profile.js
const { Client } = require('pg');
const { cors, ok, err, requireAuth } = require('./_auth');

async function handler(event, context) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (event.httpMethod !== 'GET') return err('Method not allowed', 405);

  const conn = process.env.DATABASE_URL;
  if (!conn) return err('DATABASE_URL is not set', 500);

  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // context.user.sub — id из токена
    const { rows } = await client.query(
      'SELECT id, username, email, created_at FROM public.local_users WHERE id = $1 LIMIT 1',
      [context.user.sub]
    );
    if (!rows[0]) return err('User not found', 404);
    return ok({ success: true, profile: rows[0] });
  } catch (e) {
    return err(e.message || 'Failed to load profile', 500);
  } finally {
    await client.end();
  }
}

exports.handler = requireAuth(handler);
