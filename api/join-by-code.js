import { createClient } from '@supabase/supabase-js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { code } = JSON.parse(event.body || '{}');
    if (!code) {
      return { statusCode: 400, body: 'code required' };
    }
    const token = event.headers.authorization?.split(' ')[1] || event.headers.Authorization?.split(' ')[1];
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user } } = await client.auth.getUser(token);
    if (!user) return { statusCode: 401, body: 'Unauthorized' };

    const { data: eventRow } = await client
      .from('events')
      .select('id')
      .eq('join_code', code)
      .maybeSingle();
    if (!eventRow) return { statusCode: 404, body: 'Event not found' };

    const { error } = await client
      .from('participants')
      .insert({ event_id: eventRow.id, user_id: user.id });
    if (error && error.code === '23505') {
      return { statusCode: 409, body: 'Already joined' };
    }
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ event_id: eventRow.id }) };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
}
