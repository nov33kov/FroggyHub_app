// Lightweight CI smoke tests (no DB needed)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PUBLISH_DIR = 'FroggyHub';
let fails = 0;
const log = (ok, msg) => console[ok ? 'log' : 'error']((ok ? '✅' : '❌') + ' ' + msg);
const ok  = (m) => log(true, m);
const fail= (m) => { log(false, m); fails++; };

// 1) Files exist
[
  path.join(PUBLISH_DIR, 'index.html'),
  path.join(PUBLISH_DIR, '_redirects'),
  'api/event-by-code.js',
  'api/join-by-code.js',
  'netlify.toml'
].forEach(p => fs.existsSync(p) ? ok(`found ${p}`) : fail(`missing ${p}`));

// 2) No DSN secrets in client files
const clientFiles = [
  path.join(PUBLISH_DIR, 'index.html'),
  path.join(PUBLISH_DIR, 'app.js'),
  path.join(PUBLISH_DIR, 'style.css')
].filter(f => fs.existsSync(f));

const badPatterns = [/postgresql:\/\//i, /SUPABASE_DB_URL/i, /service_role/i];
for (const f of clientFiles) {
  const txt = fs.readFileSync(f, 'utf8');
  const hit = badPatterns.find(rx => rx.test(txt));
  hit ? fail(`secret-like pattern in ${f}: ${hit}`) : ok(`no secrets in ${f}`);
}

// 3) Basic auth markup sanity checks
const html = fs.readFileSync(path.join(PUBLISH_DIR,'index.html'),'utf8');
/id="tab-login"[^>]*class="tab is-active"/.test(html)
  ? ok('login tab active by default') : fail('login tab not active');
/id="pane-register"[^>]*class="[^" ]*[^>]*is-hidden/.test(html)
  ? ok('signup pane hidden by default') : fail('signup pane should be hidden');
/id="resetPassBlock"[^>]*class="[^" ]*[^>]*is-hidden/.test(html)
  ? ok('new password block hidden by default') : fail('new password block should be hidden');

// 4) Import functions and test early guards (no DB call)
const imp = async (p) => (await import(pathToFileURL(path.resolve(p)).href));

const testEventByCode = async () => {
  const { handler } = await imp('api/event-by-code.js');
  if (typeof handler !== 'function') return fail('event-by-code: no handler export');

  const r1 = await handler({ httpMethod: 'GET' });
  (r1.statusCode === 405) ? ok('event-by-code: 405 on GET') : fail('event-by-code: expected 405 on GET');

  const r2 = await handler({ httpMethod: 'POST', body: JSON.stringify({}) });
  (r2.statusCode === 400) ? ok('event-by-code: 400 on missing body') : fail('event-by-code: expected 400 on missing body');
};

const testJoinByCode = async () => {
  const { handler } = await imp('api/join-by-code.js');
  if (typeof handler !== 'function') return fail('join-by-code: no handler export');

  const r1 = await handler({ httpMethod: 'GET' });
  (r1.statusCode === 405) ? ok('join-by-code: 405 on GET') : fail('join-by-code: expected 405 on GET');

  const r2 = await handler({ httpMethod: 'POST', body: JSON.stringify({}) });
  (r2.statusCode === 400) ? ok('join-by-code: 400 on missing body') : fail('join-by-code: expected 400 on missing body');
};

await testEventByCode();
await testJoinByCode();

if (fails) {
  console.error(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
