import { Pool } from 'pg';

export const pgPrimary = new Pool({
  connectionString: process.env.SUPABASE_DB_URL
});

export const pgSecondary = new Pool({
  connectionString: process.env.RW_NEON_URL
});

pgPrimary.on('connect', c => c.query('set statement_timeout to 30000'));
pgSecondary.on('connect', c => c.query('set statement_timeout to 30000'));

const columnsCache = {};

async function getColumns(table){
  if (!columnsCache[table]){
    const q = `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = $1
        and is_generated = 'NEVER'
      order by ordinal_position;
    `;
    const { rows } = await pgPrimary.query(q, [table]);
    columnsCache[table] = rows.map(r => r.column_name);
  }
  return columnsCache[table];
}

export async function selectBatched(table, sinceTs, limit){
  const q = `select * from public.${table} where updated_at > $1 order by updated_at asc limit $2`;
  const { rows } = await pgPrimary.query(q, [sinceTs, limit]);
  return rows;
}

export async function upsertRows(table, rows){
  if (rows.length === 0) return;
  const cols = await getColumns(table);
  const colList = cols.join(', ');
  const values = [];
  const placeholders = [];
  let i = 1;
  for (const r of rows){
    const ph = cols.map(() => `$${i++}`);
    placeholders.push(`(${ph.join(',')})`);
    for (const c of cols) values.push(r[c]);
  }
  const updates = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(', ');
  const sql = `insert into public.${table} (${colList}) values ${placeholders.join(',')} on conflict (id) do update set ${updates}`;

  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++){
    const client = await pgSecondary.connect();
    try{
      await client.query('BEGIN');
      await client.query(sql, values);
      await client.query('COMMIT');
      client.release();
      return;
    }catch(err){
      await client.query('ROLLBACK').catch(()=>{});
      client.release();
      if (attempt === maxAttempts - 1) throw err;
      const delay = 250 * Math.pow(2, attempt);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
