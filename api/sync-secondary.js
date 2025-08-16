import { selectBatched, upsertRows } from './_lib/db-sync.js';
import { promises as fs } from 'fs';
import path from 'path';

const stateFile = path.resolve('./sync/state.json');

export default async function handler(){
  const limit = Number(process.env.SYNC_BATCH_LIMIT || 2000);
  const tables = (process.env.SYNC_TABLES || '').split(',').map(t => t.trim()).filter(Boolean);
  const full = String(process.env.FULL_SYNC).toLowerCase() === 'true';

  let lastSyncTs = '1970-01-01T00:00:00Z';
  try {
    if (!full){
      const txt = await fs.readFile(stateFile, 'utf8').catch(() => '');
      const data = txt ? JSON.parse(txt) : {};
      if (data.last_sync_ts) lastSyncTs = data.last_sync_ts;
    }
  } catch (e) { /* ignore */ }

  let maxTs = null;
  let synced = 0;

  try {
    for (const table of tables){
      try {
        let since = full ? '1970-01-01T00:00:00Z' : lastSyncTs;
        while (true){
          const rows = await selectBatched(table, since, limit);
          if (rows.length === 0) break;
          await upsertRows(table, rows);
          synced += rows.length;
          since = rows[rows.length - 1].updated_at;
          if (!maxTs || since > maxTs) maxTs = since;
          console.log({ table, batch: rows.length });
        }
      } catch (err) {
        err.table = table;
        throw err;
      }
    }

    if (maxTs){
      const ts = full ? new Date().toISOString() : maxTs;
      await fs.writeFile(stateFile, JSON.stringify({ last_sync_ts: ts }));
      lastSyncTs = ts;
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, synced, lastSync: lastSyncTs })
    };
  } catch (err){
    console.error({ table: err.table, code: err.code, message: err.message });
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, table: err.table, reason: err.message })
    };
  }
}
