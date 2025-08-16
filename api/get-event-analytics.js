import { createClient } from '@supabase/supabase-js';
import { json, getUserFromAuth } from './_utils.js';

const DEBUG_ANALYTICS = process.env.DEBUG_ANALYTICS === 'true';
const dbg = (...args) => { if (DEBUG_ANALYTICS) console.debug('[analytics]', ...args); };

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
      .select('id, owner_id, title, date, time, address, notes')
      .eq('id', eventId)
      .single();
    if(!evt){
      return json(404, { error: 'not_found' });
    }
    if(evt.owner_id !== user.id){
      return json(403, { error: 'forbidden' });
    }

    const { data: participants } = await client
      .from('participants')
      .select('rsvp, profiles(nickname, avatar_url)')
      .eq('event_id', eventId);

    const { data: wishlist } = await client
      .from('wishlist_items')
      .select('title, url, taken_by, profiles:profiles!wishlist_items_taken_by_fkey(nickname, avatar_url)')
      .eq('event_id', eventId);

    const visitors = (participants||[]).map(p => ({
      nickname: p.profiles?.nickname || '',
      avatar_url: p.profiles?.avatar_url || '',
      rsvp: p.rsvp
    }));

    const wl = (wishlist||[]).map(w => ({
      title: w.title,
      url: w.url,
      taken_by: w.taken_by ? { nickname: w.profiles?.nickname || '', avatar_url: w.profiles?.avatar_url || '' } : null
    }));
    const format = payload.format || payload.csv;
    if(format === 'csv'){
      const esc = (v) => {
        if(v == null) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
      };
      const visitorRows = [['nickname','rsvp'], ...visitors.map(v=>[v.nickname, v.rsvp])];
      const wishlistRows = [['title','url','taken_by'], ...wl.map(w=>[w.title, w.url, w.taken_by?.nickname || ''])];
      const lines = [];
      if(visitorRows.length > 1){
        lines.push('Visitors');
        visitorRows.forEach(r => lines.push(r.map(esc).join(',')));
      }
      if(wishlistRows.length > 1){
        if(lines.length) lines.push('');
        lines.push('Wishlist');
        wishlistRows.forEach(r => lines.push(r.map(esc).join(',')));
      }
      const csv = lines.join('\n');
      const rowCount = (visitorRows.length - 1) + (wishlistRows.length - 1);
      dbg(`CSV export: ${rowCount} rows, ${Buffer.byteLength(csv, 'utf8')} bytes`);
      return {
        statusCode: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="analytics.csv"',
          'cache-control': 'no-store'
        },
        body: csv
      };
    }

    return json(200, {
      event: {
        title: evt.title,
        date: evt.date,
        time: evt.time,
        address: evt.address,
        notes: evt.notes
      },
      participants: visitors,
      wishlist: wl
    });
  }catch(err){
    console.error('get-event-analytics', err);
    return json(500, { error: 'server_error' });
  }
}
