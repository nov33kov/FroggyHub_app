import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { username, password } = JSON.parse(event.body || '{}');
    if (!username || !password) return { statusCode: 400, body: 'username and password required' };
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: userRow } = await client.from('local_users').select('*').eq('username', username).maybeSingle();
    if (!userRow) return { statusCode: 401, body: 'Invalid credentials' };
    const match = await bcrypt.compare(password, userRow.password_hash || '');
    if (!match) return { statusCode: 401, body: 'Invalid credentials' };
    await client.from('local_users').update({ last_login: new Date().toISOString() }).eq('id', userRow.id);
    const access_token = jwt.sign({ sub: userRow.id, role: 'authenticated' }, process.env.SUPABASE_JWT_SECRET, { expiresIn: '1h' });
    const headers = {
      'Content-Type': 'application/json',
      'Set-Cookie': `sb-access-token=${access_token}; HttpOnly; Path=/; Max-Age=3600`
    };
    return { statusCode: 200, headers, body: JSON.stringify({ access_token, user: { id: userRow.id, username: userRow.username } }) };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
