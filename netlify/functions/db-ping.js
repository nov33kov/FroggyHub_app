import { getClient } from '../../utils/db.js';

export async function handler() {
  try {
    const client = await getClient();
    const res = await client.query("SELECT NOW()");
    await client.end();
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, time: res.rows[0].now })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message })
    };
  }
}
