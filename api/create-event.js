import { getSupabaseUser } from './_utils.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const { title, date, time, address, notes, dress_code, bring } = body;
    const { client, user } = await getSupabaseUser(event);

    let join_code;
    while (true) {
      join_code = Math.floor(100000 + Math.random() * 900000).toString();
      const { data: existing } = await client
        .from('events')
        .select('id')
        .eq('join_code', join_code)
        .maybeSingle();
      if (!existing) break;
    }
    const event_at = date && time ? new Date(`${date}T${time}:00`).toISOString() : null;
    const payload = { owner_id: user.id, title, address, dress: dress_code, bring, notes, join_code, event_at };
    const { data, error } = await client.from('events').insert(payload).select('*').single();
    if (error) return { statusCode: 500, body: error.message };
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (err) {
    const status = err.message === 'NO_TOKEN' || err.message === 'INVALID_TOKEN' ? 401 : 500;
    return { statusCode: status, body: err.message };
  }
}
