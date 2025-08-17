import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { nickname: nicknameFromBody, username, password } = JSON.parse(event.body || '{}');
    const nickname = nicknameFromBody ?? username;
    if (!nickname || !password) return { statusCode: 400, body: 'nickname and password required' };
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(nickname) || password.length < 4) {
      return { statusCode: 400, body: 'invalid nickname or password' };
    }
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { count } = await client.from('local_users').select('id', { count: 'exact', head: true }).eq('nickname', nickname);
    if (count && count > 0) return { statusCode: 409, body: 'nickname taken' };
    const password_hash = await bcrypt.hash(password, 10);
    const { data, error } = await client.from('local_users').insert({ nickname, password_hash }).select('id, nickname').single();
    if (error) throw error;
    const access_token = jwt.sign({ sub: data.id, role: 'authenticated' }, process.env.SUPABASE_JWT_SECRET, { expiresIn: '1h' });
    const headers = {
      'Content-Type': 'application/json',
      'Set-Cookie': `sb-access-token=${access_token}; HttpOnly; Path=/; Max-Age=3600`
    };
    return { statusCode: 200, headers, body: JSON.stringify({ access_token, user: { id: data.id, nickname: data.nickname } }) };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
