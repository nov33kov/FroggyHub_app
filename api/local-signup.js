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
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username) || password.length < 4) {
      return { statusCode: 400, body: 'invalid username or password' };
    }
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { count } = await client.from('local_users').select('id', { count: 'exact', head: true }).eq('username', username);
    if (count && count > 0) return { statusCode: 409, body: 'username taken' };
    const password_hash = await bcrypt.hash(password, 10);
    const { data, error } = await client
      .from('local_users')
      .insert({ username, password_hash })
      .select('id, username')
      .single();
    if (error) throw error;
    const access_token = jwt.sign(
      { sub: data.id, role: 'authenticated' },
      process.env.SUPABASE_JWT_SECRET,
      { expiresIn: '1h' }
    );
    const domain = process.env.COOKIE_DOMAIN ? `Domain=${process.env.COOKIE_DOMAIN}; ` : '';
    const headers = {
      'Content-Type': 'application/json',
      'Set-Cookie': `sb-access-token=${access_token}; ${domain}HttpOnly; Path=/; Max-Age=3600; Secure; SameSite=Lax`
    };
    return { statusCode: 200, headers, body: JSON.stringify({ access_token, user: data }) };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
