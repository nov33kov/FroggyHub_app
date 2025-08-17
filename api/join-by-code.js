import { getSupabaseUser } from './_utils.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { code } = JSON.parse(event.body || '{}');
    if (!code) {
      return { statusCode: 400, body: 'code required' };
    }
    const { client, user } = await getSupabaseUser(event);

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
    const status = err.message === 'NO_TOKEN' || err.message === 'INVALID_TOKEN' ? 401 : 500;
    return { statusCode: status, body: err.message };
  }
}
