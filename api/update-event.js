import { createClient } from '@supabase/supabase-js';
import { json, getUserFromAuth } from './_utils.js';

export async function handler(event){
  try{
    if(event.httpMethod !== 'POST' && event.httpMethod !== 'PUT'){
      return json(405, { error: 'Method Not Allowed' });
    }
    const body = JSON.parse(event.body||'{}');
    const eventId = body.event_id || body.id;
    if(!eventId){
      return json(400, { error: 'event_id required' });
    }
    const allowed = ['title','date','time','address','notes','dress_code','bring'];
    const updates = {};
    for(const f of allowed){
      if(body[f] !== undefined) updates[f] = body[f];
    }
    if(Object.keys(updates).length === 0){
      return json(400, { error: 'no_updates' });
    }
    const user = await getUserFromAuth(event);
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: evt } = await client
      .from('events')
      .select('owner_id')
      .eq('id', eventId)
      .single();
    if(!evt){
      return json(404, { error: 'not_found' });
    }
    if(evt.owner_id !== user.id){
      return json(403, { error: 'forbidden' });
    }

    const { data, error } = await client
      .from('events')
      .update(updates)
      .eq('id', eventId)
      .select('id, title, date, time, address, notes, dress_code, bring')
      .single();
    if(error) throw error;
    return json(200, { event: data });
  }catch(err){
    console.error('update-event', err);
    return json(500, { error: 'server_error' });
  }
}
