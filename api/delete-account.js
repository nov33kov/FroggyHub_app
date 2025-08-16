import { createClient } from '@supabase/supabase-js';
import { json, getUserFromAuth } from './_utils.js';

export async function handler(event){
  if(event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE'){
    return json(405, { error: 'Method Not Allowed' });
  }
  try{
    const user = await getUserFromAuth(event);
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const uid = user.id;
    await client.from('participants').delete().eq('user_id', uid);
    await client.from('cookie_consents').delete().eq('user_id', uid);
    await client.from('profiles').delete().eq('id', uid);
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers:{
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    });
    if(!res.ok){ throw new Error('admin_delete_failed'); }
    return json(200, { success: true });
  }catch(err){
    console.error('delete-account', err);
    if(err.message === 'NO_TOKEN' || err.message === 'INVALID_TOKEN'){
      return json(401, { error: 'unauthorized' });
    }
    return json(500, { error: 'server_error' });
  }
}
