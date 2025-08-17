import { getSupabaseUser } from './_utils.js';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { code, event_id } = JSON.parse(event.body || '{}');
    if (!code && !event_id) {
      return { statusCode: 400, body: 'code or event_id required' };
    }
    const { client, user } = await getSupabaseUser(event);

    let eventRow;
    if (event_id) {
      const { data } = await client.from('events').select('*').eq('id', event_id).maybeSingle();
      eventRow = data;
    } else {
      const { data } = await client.from('events').select('*').eq('join_code', code).maybeSingle();
      eventRow = data;
    }
    if (!eventRow) return { statusCode: 404, body: 'Event not found' };

    const { data: participants } = await client
      .from('participants')
      .select('user_id, profiles(nickname)')
      .eq('event_id', eventRow.id);

    const { data: wishlist } = await client
      .from('wishlist_items')
      .select('*')
      .eq('event_id', eventRow.id);

    const isOwner = eventRow.owner_id === user.id;
    const isParticipant = participants.some(p => p.user_id === user.id) || isOwner;

    return {
      statusCode: 200,
      body: JSON.stringify({
        event: eventRow,
        participants,
        wishlist,
        isOwner,
        isParticipant
      })
    };
  } catch (err) {
    const status = err.message === 'NO_TOKEN' || err.message === 'INVALID_TOKEN' ? 401 : 500;
    return { statusCode: status, body: err.message };
  }
}
