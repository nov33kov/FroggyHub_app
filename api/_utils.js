export const json = (code, data) => ({
  statusCode: code,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  },
  body: JSON.stringify(data)
});

export async function getUserFromAuth(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new Error('NO_TOKEN');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` }
  });
  if (!r.ok) throw new Error('INVALID_TOKEN');
  return await r.json(); // { id, ... }
}

export function clientIp(event){
  return (event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || '').split(',')[0] || 'unknown';
}

/**
 * Простая проверка лимита: максимум `limit` хитов за `windowSec` секунд.
 * Использует upsert в таблицу rate_limits. Возвращает true, если ПРЕВЫШЕН лимит.
 */
export async function isRateLimited(client, bucket, windowSec, limit){
  const q = `
    insert into rate_limits(bucket, window_start, count)
    values ($1, now(), 1)
    on conflict(bucket) do update
      set count = case when now() - rate_limits.window_start > ($2 || ' seconds')::interval
                       then 1 else rate_limits.count + 1 end,
          window_start = case when now() - rate_limits.window_start > ($2 || ' seconds')::interval
                              then now() else rate_limits.window_start end
    returning count;
  `;
  const { rows } = await client.query(q, [bucket, String(windowSec)]);
  const hits = rows?.[0]?.count ?? 1;
  return hits > limit;
}
