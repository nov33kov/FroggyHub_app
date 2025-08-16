import { createClient } from '@supabase/supabase-js';
import { json, getUserFromAuth } from './_utils.js';

export async function handler(event){
  try{
    if(event.httpMethod !== 'GET' && event.httpMethod !== 'POST'){
      return json(405, { error: 'Method Not Allowed' });
    }
    const payload = event.httpMethod === 'GET' ? (event.queryStringParameters || {}) : JSON.parse(event.body||'{}');
    const eventId = payload.event_id || payload.id;
    if(!eventId){
      return json(400, { error: 'event_id required' });
    }
    const user = await getUserFromAuth(event);
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: evt } = await client
      .from('events')
      .select('owner_id, title, date, time, address, notes, dress_code, bring')
      .eq('id', eventId)
      .single();
    if(!evt){
      return json(404, { error: 'not_found' });
    }
    if(evt.owner_id !== user.id){
      return json(403, { error: 'forbidden' });
    }
    const { owner_id, ...eventData } = evt;
    return json(200, { event: eventData });
  }catch(err){
    console.error('get-event-details', err);
    return json(500, { error: 'server_error' });
  }
}
