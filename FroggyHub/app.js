const LS_USERNAME = 'fh:username';
const $ = (s, r=document)=>r.querySelector(s);

function toast(msg, type='info'){
  console[type==='error'?'error':'log']('[toast]', msg);
  try { window.showToast?.(msg, type) ?? alert(msg); } catch {}
}

function withBusy(btn, fn){
  return async (...a)=>{
    if(!btn) return fn(...a);
    const t=btn.textContent; btn.disabled=true; btn.textContent='Подождите…';
    try{ return await fn(...a); } finally{ btn.disabled=false; btn.textContent=t; }
  };
}

async function callFn(name, payload){
  const url = `/.netlify/functions/${name}`;
  console.log('[fetch]', name, {url, payload});
  const res = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload??{})});
  const data = await res.json().catch(()=> ({}));
  if(!res.ok || data?.ok===false){
    const msg = data?.error || data?.message || `Ошибка ${name}`;
    console.error('[fn:error]', name, res.status, data);
    throw new Error(msg);
  }
  console.log('[fn:ok]', name, data);
  return data;
}

const getUsername = ()=> localStorage.getItem(LS_USERNAME)||'';
const setUsername = (u)=> {
  localStorage.setItem(LS_USERNAME, u);
  const badge = $('[data-user-badge]');
  if(badge) badge.textContent = u||'гость';
};
setUsername(getUsername());

/* ---------- Supabase init with proxy fallback ---------- */
const DEBUG_AUTH = !!window.DEBUG_AUTH;
const dbgAuth = (...args) => { if (DEBUG_AUTH) console.debug('[auth]', ...args); };
const DEBUG_EVENTS = !!window.DEBUG_EVENTS;

function probeDirect(url){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  return fetch(url + '/auth/v1/health', { method: 'HEAD', signal: ctrl.signal })
    .then(res => { clearTimeout(timer); return res.ok; })
    .catch(() => { clearTimeout(timer); return false; });
}

async function ensureSupabase(){
  if(window.__supabaseClient){ return window.__supabaseClient; }

  if(!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY){
    throw new Error('Supabase URL or anon key not configured');
  }

  while(typeof window.createClient !== 'function'){
    await new Promise(r => setTimeout(r,50));
  }

  let mode = sessionStorage.getItem('sb_mode');
  let baseUrl;
  if(mode){
    baseUrl = mode === 'proxy' ? window.PROXY_SUPABASE_URL : window.SUPABASE_URL;
  }else{
    const ok = await probeDirect(window.SUPABASE_URL);
    if(ok){
      baseUrl = window.SUPABASE_URL;
      mode = 'direct';
    }else{
      baseUrl = window.PROXY_SUPABASE_URL;
      mode = 'proxy';
    }
    sessionStorage.setItem('sb_mode', mode);
  }

  const sb = window.createClient(baseUrl, window.SUPABASE_ANON_KEY, {
    auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
  });
  window.__supabaseClient = sb;
  window.supabase = sb;
  return sb;
}

async function switchToProxyAndRetry(action){
  sessionStorage.setItem('sb_mode','proxy');
  window.__supabaseClient = null;
  const sb = await ensureSupabase();
  return await action(sb);
}

window.ensureSupabase = ensureSupabase;

const clearUsername = () => setUsername('');

function renderUserBadge({ nickname, email } = {}) {
  const badge = document.querySelector('[data-user-badge]');
  if (!badge) return;
  const name = (nickname && nickname.trim()) || getUsername() || (email || '').split('@')[0] || 'гость';
  badge.textContent = name;
}

function sendAuthTelemetry(kind, mode){
  try{
    if(DEBUG_AUTH) return;
    fetch('/.netlify/functions/auth-telemetry',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ kind, mode: mode || sessionStorage.getItem('sb_mode') || 'direct', ua:navigator.userAgent, ts:Date.now() }),
      keepalive:true
    }).catch(()=>{});
  }catch(_){ /* ignore */ }
}

async function withTimeout(promiseFactory, ms, label){
  const controller = new AbortController();
  const p = promiseFactory(controller.signal);
  const t = setTimeout(() => controller.abort('timeout'), ms);
  try{
    return await p;
  }catch(err){
    if(controller.signal.aborted){
      const e = new Error(label || 'timeout');
      e.code = 'TIMEOUT';
      throw e;
    }
    throw err;
  }finally{
    clearTimeout(t);
  }
}

async function callFnEx(name, { method='POST', body, headers={} } = {}, { timeoutMs=15000, retryOnceOnNetwork=true } = {}) {
  const url = `/.netlify/functions/${name}`;
  const auth = await (typeof authHeader === 'function' ? authHeader() : {});
  const doFetch = (signal) => fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth, ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal
  });
  try {
    const res = await withTimeout((signal)=>doFetch(signal), timeoutMs, `${name.toUpperCase()}_TIMEOUT`);
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      const err = new Error(text || res.statusText); err.status = res.status; throw err;
    }
    return await res.json().catch(()=> ({}));
  } catch (e) {
    const net = (e.name==='AbortError' || e.code==='TIMEOUT' || /Failed to fetch|NetworkError/i.test(String(e)));
    if (net && retryOnceOnNetwork) {
      try {
        const res = await withTimeout((signal)=>doFetch(signal), timeoutMs, `${name.toUpperCase()}_TIMEOUT_RETRY`);
        if (!res.ok) { const t = await res.text().catch(()=> ''); const er = new Error(t||res.statusText); er.status=res.status; throw er; }
        return await res.json().catch(()=> ({}));
      } catch (e2) { e.original = e2; throw e; }
    }
    throw e;
  }
}

function explainFnError(err){
  if (err.status===401||err.status===403) return 'Нет прав. Войдите заново.';
  if (err.status===409) return 'Конфликт данных. Попробуйте снова.';
  if (err.code==='TIMEOUT') return 'Сервер не отвечает. Повторите попытку.';
  if (/Failed to fetch|NetworkError/i.test(String(err))) return 'Проблема со связью. Проверьте интернет.';
  return 'Ошибка сервера. Попробуйте позже.';
}

function formatAuthError(e){
  console.error(e);
  const msg = e?.message || '';
  const st = e?.status;
  if(st === 400 || st === 401 || msg === 'Invalid login credentials') return 'Неверная почта или пароль';
  if(st === 429 || /rate limit/i.test(msg)) return 'Слишком много попыток, попробуйте позже';
  if(st === 500) return 'Сервис недоступен, повторите позже';
  if(msg === 'User already registered') return 'Пользователь с этой почтой уже существует';
  if(e?.code === 'TIMEOUT' || (e instanceof TypeError && /Failed to fetch|network/i.test(msg))){
    sendAuthTelemetry('auth_failed_fetch');
    return 'Не удалось связаться с сервером авторизации. Попробуйте вход по ссылке.';
  }
  return 'Ошибка входа: ' + (msg || String(e));
}

function isFetchErr(e){
  const msg = e?.message || '';
  return e?.code === 'TIMEOUT' || (e instanceof TypeError && /Failed to fetch/i.test(msg));
}

function validateAuthForm(fields, mode){
  const errors={};
  const email=(fields.email||'').trim().toLowerCase();
  if(!email) errors.email='Введите почту';
  else if(!/^\S+@\S+\.\S+$/.test(email)) errors.email='Некорректная почта';
  const pass=fields.password||'';
  if(!pass) errors.password='Введите пароль';
  else if(pass.length<4) errors.password='Пароль слишком короткий';
  if(mode==='signup'){
    const pass2=fields.password2||'';
    if(!pass2) errors.password2='Повторите пароль';
    else if(pass2!==pass) errors.password2='Пароли не совпадают';
    const nick=(fields.nickname||'').trim();
    if(!nick) errors.nickname='Введите имя';
  }
  return { ok:Object.keys(errors).length===0, errors };
}

function clearFieldError(input){
  if(!input) return;
  input.classList.remove('is-invalid');
  input.removeAttribute('aria-invalid');
  const errId='err-'+input.id;
  input.removeAttribute('aria-describedby');
  const el=document.getElementById(errId);
  if(el) el.remove();
}

function showFieldError(input,msg){
  if(!input) return;
  let errId='err-'+input.id;
  let err=document.getElementById(errId);
  if(!err){
    err=document.createElement('div');
    err.id=errId;
    err.className='field-error';
    input.insertAdjacentElement('afterend',err);
  }
  err.textContent=msg;
  input.classList.add('is-invalid');
  input.setAttribute('aria-invalid','true');
  input.setAttribute('aria-describedby',errId);
  const onInput=()=>{clearFieldError(input);input.removeEventListener('input',onInput);};
  input.addEventListener('input',onInput);
}

function showFormError(el,msg){ if(el) el.textContent=msg; }
function clearFormError(el){ if(el) el.textContent=''; }

function applyValidationErrors(mode, errors){
  const map= mode==='login'
    ? { email:'loginEmail', password:'loginPass' }
    : { nickname:'regName', email:'regEmail', password:'regPass', password2:'regPass2' };
  Object.entries(errors).forEach(([k,v])=>{
    const el=document.getElementById(map[k]);
    showFieldError(el,v);
  });
  const firstKey=Object.keys(errors)[0];
  if(firstKey){
    const firstEl=document.getElementById(map[firstKey]);
    firstEl?.scrollIntoView({ behavior:'smooth', block:'center' });
    if(!reduceMotion) firstEl?.classList.add('shake');
    setTimeout(()=>firstEl?.classList.remove('shake'),200);
    setTimeout(()=>firstEl?.focus(),100);
    const ann = mode==='login'?$('#loginAnnounce'):$('#regAnnounce');
    if(ann) ann.textContent=errors[firstKey];
  }
}

/* ---------- ПОЛЬЗОВАТЕЛИ / СЕССИЯ ---------- */
const USERS_KEY = 'froggyhub_users_v1';
const SESSION_KEY = 'froggyhub_session_email';
const users = JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
const saveUsers = () => localStorage.setItem(USERS_KEY, JSON.stringify(users));
const setSession = (email) => localStorage.setItem(SESSION_KEY, email);
const getSession = () => localStorage.getItem(SESSION_KEY);
let currentUser = null;
let lastSession = null;
let rebindTried = false;
let manualSignOut = false;

const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
const randBytes = (len=16) => crypto.getRandomValues(new Uint8Array(len));

async function pbkdf2Hash(password, saltHex, iterations=150_000){
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(h=>parseInt(h,16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', hash:'SHA-256', salt, iterations },
    key,
    256
  );
  return toHex(bits);
}

function timingSafeEqual(aHex, bHex){
  if (aHex.length !== bHex.length) return false;
  let diff = 0;
  for (let i=0; i<aHex.length; i++) diff |= aHex.charCodeAt(i) ^ bHex.charCodeAt(i);
  return diff === 0;
}

async function sha256(pass){
  const buf=await crypto.subtle.digest('SHA-256', enc.encode(pass));
  return toHex(buf);
}

async function logout(msg){
  const sb = await ensureSupabase();
  manualSignOut = true;
  try{ await sb.auth.signOut(); }catch(_){ }
  manualSignOut = false;
  try{ await fetch('/.netlify/functions/local-logout'); }catch(_){ }
  clearUsername();
  renderUserBadge({ nickname:'', email:'' });
  sessionStorage.removeItem('sb_mode');
  sessionStorage.removeItem('pendingCreate');
  localStorage.removeItem(COOKIE_TEMP_KEY);
  localStorage.removeItem(SESSION_KEY);
  if(msg){
    sessionBanner.textContent = msg;
    sessionBanner.hidden = false;
  }else{
    sessionBanner.hidden = true;
  }
  show('#screen-auth');
  setAuthState('login');
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function buildInviteUrl(code){
  const url = new URL(location.href);
  url.searchParams.set('code', code);
  return url.toString();
}

async function shareInvite(code){
  const link = buildInviteUrl(code);
  if (navigator.share) {
    try {
      await navigator.share({ title: 'FroggyHub', text: 'Присоединяйся к событию', url: link });
      return;
    } catch (_) {}
  }
  await navigator.clipboard.writeText(link);
  toast('Ссылка скопирована: ' + link);
}

/* ---------- УТИЛИТЫ ---------- */
const sessionBanner = document.getElementById('sessionBanner');
function toggleAuthButtons(disabled){
  document.querySelectorAll('[data-requires-auth]').forEach(btn=>{
    if(disabled) btn.setAttribute('disabled',''); else btn.removeAttribute('disabled');
  });
}
toggleAuthButtons(true);
function trapFocus(node){
  const f=node.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])');
  if(!f.length) return () => {};
  const first=f[0], last=f[f.length-1];
  const handler=e=>{
    if(e.key!=='Tab') return;
    if(e.shiftKey && document.activeElement===first){ last.focus(); e.preventDefault(); }
    else if(!e.shiftKey && document.activeElement===last){ first.focus(); e.preventDefault(); }
  };
  node.addEventListener('keydown',handler);
  return ()=>node.removeEventListener('keydown',handler);
}
function show(idToShow){
  ['#screen-auth','#screen-lobby','#screen-app'].forEach(id=>{
    const el=$(id); if(!el) return; el.hidden = (id!==idToShow);
  });
}

function showAuthPane(kind){
  const loginTab = document.getElementById('tab-login');
  const registerTab = document.getElementById('tab-register');
  const loginPane = document.getElementById('pane-login');
  const registerPane = document.getElementById('pane-register');
  const isLogin = kind === 'login';
  loginTab?.classList.toggle('is-active', isLogin);
  loginTab?.setAttribute('aria-selected', isLogin ? 'true' : 'false');
  registerTab?.classList.toggle('is-active', !isLogin);
  registerTab?.setAttribute('aria-selected', !isLogin ? 'true' : 'false');
  loginPane?.classList.toggle('is-hidden', !isLogin);
  registerPane?.classList.toggle('is-hidden', isLogin);
  const pane = isLogin ? loginPane : registerPane;
  const focusEl = pane?.querySelector('input,button,select,textarea,[tabindex="0"]');
  focusEl?.focus();
  document.getElementById(`pane-${kind}`)?.scrollIntoView({behavior:'smooth', block:'start'});
}

// --- Auth state management ---
let authState = 'login';
let loginBtn, regBtn;
let isAuthPending = false;
let dbgLogin, dbgSignup;
const resetEmailBlock = document.getElementById('resetEmailBlock');
const resetPassBlock = document.getElementById('resetPassBlock');
function updateRegBtnState(){
  if(!regBtn) return;
  const { ok } = validateAuthForm({
    nickname: document.getElementById('regName')?.value,
    email: document.getElementById('regEmail')?.value,
    password: document.getElementById('regPass')?.value,
    password2: document.getElementById('regPass2')?.value
  }, 'signup');
  if(ok){ regBtn.disabled=false; regBtn.removeAttribute('aria-disabled'); }
  else { regBtn.disabled=true; regBtn.setAttribute('aria-disabled','true'); }
  updateAuthDebug();
}

function updateAuthDebug(){
  if(!DEBUG_AUTH) return;
  const sbMode = sessionStorage.getItem('sb_mode') || 'direct';
  const btn = authState === 'signup' ? regBtn : loginBtn;
  let overlay = false;
  if(btn){
    const r = btn.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
    overlay = !!(el && el !== btn && !btn.contains(el));
  }
  const msg = `state:${authState} loginDisabled:${!!loginBtn?.disabled} signupDisabled:${!!regBtn?.disabled} pending:${isAuthPending} sbMode:${sbMode} overlay:${overlay}`;
  if(dbgLogin) dbgLogin.textContent = msg;
  if(dbgSignup) dbgSignup.textContent = msg;
  dbgAuth(msg);
}

function setAuthState(state){
  const prev = authState;
  authState = state;
  const panes = { login: document.getElementById('paneLogin'), signup: document.getElementById('paneSignup'), reset: document.getElementById('paneReset') };
  Object.entries(panes).forEach(([name,pane])=>{
    const active = name===state;
    if(pane){
      pane.hidden = !active;
      if('inert' in pane){ pane.inert = !active; }
      else if(!active){ pane.setAttribute('inert',''); } else { pane.removeAttribute('inert'); }
      if(!active){
        pane.querySelectorAll('.is-invalid').forEach(el=>el.classList.remove('is-invalid'));
        pane.querySelectorAll('.form-error').forEach(el=>el.textContent='');
        pane.querySelectorAll('input').forEach(inp=>{
          if(name==='login' && prev==='login' && state==='reset' && inp.id==='loginEmail') return;
          inp.value='';
        });
      }
    }
  });
  const tabs = { login: document.getElementById('tabLogin'), signup: document.getElementById('tabSignup') };
  Object.entries(tabs).forEach(([name,tab])=>{
    if(tab){
      const active = name===state;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active? 'true':'false');
    }
  });
  sessionStorage.setItem('auth_state', state);
  const params = new URLSearchParams(location.search);
  params.set('auth', state);
  history.replaceState(null,'', location.pathname + '?' + params.toString() + location.hash);
  const panel = panes[state];
  const focusMap = { login:'loginEmail', signup:'regName', reset:'resetEmail' };
  document.getElementById(focusMap[state])?.focus({ preventScroll:true });
  if(prev==='login' && state==='reset'){
    const email = document.getElementById('loginEmail')?.value;
    if(email) document.getElementById('resetEmail').value = email;
  }
  if(state==='reset'){
    resetEmailBlock.hidden = false;
    resetPassBlock.hidden = true;
  }
  if(state==='signup'){
    if(loginBtn){ loginBtn.disabled=false; loginBtn.textContent='Войти'; loginBtn.removeAttribute('aria-disabled'); }
    if(regBtn){ regBtn.textContent='Зарегистрироваться'; }
    updateRegBtnState();
  }else{
    if(regBtn){ regBtn.disabled=false; regBtn.textContent='Зарегистрироваться'; regBtn.removeAttribute('aria-disabled'); }
    if(loginBtn){ loginBtn.disabled=false; loginBtn.textContent='Войти'; loginBtn.removeAttribute('aria-disabled'); }
  }
  panel?.scrollIntoView({ behavior:'smooth', block:'center' });
  updateAuthDebug();
}

document.getElementById('tab-login')?.addEventListener('click',()=>showAuthPane('login'));
document.getElementById('tab-register')?.addEventListener('click',()=>showAuthPane('register'));
showAuthPane('login');

const forgotBtn = document.getElementById('showReset');
const forgotBlock = document.getElementById('resetPassBlock');
forgotBtn?.addEventListener('click',()=>{
  const state = forgotBtn.getAttribute('data-forgot') === 'true';
  if(state){
    forgotBtn.setAttribute('data-forgot','false');
    forgotBlock?.classList.add('is-hidden');
  }else{
    forgotBtn.setAttribute('data-forgot','true');
    forgotBlock?.classList.remove('is-hidden');
    forgotBlock?.querySelector('input,button,select,textarea,[tabindex="0"]')?.focus();
  }
});

// local auth helpers
const showErr = (where, e)=>console.error(`[${where}]`, e?.status, e?.message || e);

const call = async (path, body)=>{
  try{
    const res = await fetch(`/.netlify/functions/${path}`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.ok){
      const err = new Error(data?.error || `${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }catch(err){
    err.status = err.status || 0;
    throw err;
  }
};

function setBusy(zone,on){
  const b = zone==='reg' ? document.getElementById('btn-register') : document.getElementById('btn-login');
  if(!b) return;
  b.disabled = !!on;
  b.textContent = on ? (zone==='reg'?'Регистрируем…':'Входим…') : (zone==='reg'?'Зарегистрироваться':'Войти');
}

function setStatus(zone,msg){
  const id = zone==='reg' ? 'reg-status' : 'login-status';
  const el = document.getElementById(id);
  if(el){ el.textContent = msg||''; }
}

function goToLobby(){
  show('#screen-lobby');
}

async function handleRegister(){
  const username = document.getElementById('reg-username')?.value.trim();
  const p1 = document.getElementById('reg-password')?.value;
  const p2 = document.getElementById('reg-password2')?.value;
  if(!username || p1.length<4 || p1!==p2) return setStatus('reg','Проверьте логин и пароли');
  setStatus('reg','');
  setBusy('reg', true);
  document.getElementById('reg-username')?.classList.remove('input-error');
  try{
    await call('auth-register', { username, password: p1 });
    setUsername(username);
    renderUserBadge({ nickname: username });
    setStatus('reg','Готово! Теперь войдите.');
    showAuthPane('login');
    const li = document.querySelector('#pane-login input[name="login"], #pane-login input[type="text"], #pane-login input[type="email"]');
    if(li){ li.value = username; li.focus(); }
  }catch(e){
    showErr('register', e);
    let msg = e?.message || 'Ошибка сети';
    if(e.status === 409){
      msg = 'Логин уже занят';
      const field = document.getElementById('reg-username');
      field?.classList.add('input-error');
      field?.focus();
    }else if(e.status >= 500 || e.status === 0){
      msg = 'Проблемы с сервером, попробуйте позже';
    }
    setStatus('reg', msg);
  }finally{
    setBusy('reg', false);
  }
}

async function handleLogin(){
  const username = document.getElementById('login-username')?.value.trim();
  const password = document.getElementById('login-password')?.value;
  if(!username || !password) return setStatus('login','Введите логин и пароль');
  setStatus('login','');
  setBusy('login', true);
  try{
    const { user } = await call('auth-login', { username, password });
    const n = user?.username || username;
    setUsername(n);
    renderUserBadge({ nickname: n });
    localStorage.setItem('fh_user', JSON.stringify(user));
    setStatus('login','Вход выполнен');
    goToLobby();
  }catch(e){
    showErr('login', e);
    let msg = e?.message || 'Ошибка сети';
    if(e.status === 401){
      msg = 'Неверный логин или пароль';
    }else if(e.status >= 500 || e.status === 0){
      msg = 'Проблемы с сервером, попробуйте позже';
    }
    setStatus('login', msg);
  }finally{
    setBusy('login', false);
  }
}

document.getElementById('btn-register')?.addEventListener('click', handleRegister);
document.getElementById('btn-login')?.addEventListener('click', handleLogin);

// --- Password reset ---
const resetBtn = document.getElementById('resetSend');
resetBtn?.addEventListener('click', async (e)=>{
  e.preventDefault();
  clearFormError(document.getElementById('resetError'));
  const email = document.getElementById('resetEmail').value.trim().toLowerCase();
  if(!email){ showFormError(document.getElementById('resetError'),'Введите почту'); return; }
  const orig = resetBtn.textContent;
  resetBtn.disabled=true; resetBtn.textContent='Отправляем…';
  try{
    const sb = await ensureSupabase();
    await withTimeout(() => sb.auth.resetPasswordForEmail(email),15000);
    toast('Письмо отправлено');
  }catch(err){
    showFormError(document.getElementById('resetError'), formatAuthError(err));
  }finally{
    resetBtn.disabled=false; resetBtn.textContent=orig;
  }
});

const resetSetBtn = document.getElementById('resetSet');
resetSetBtn?.addEventListener('click', async ()=>{
  clearFormError(document.getElementById('resetError'));
  const p1 = document.getElementById('resetPass').value;
  const p2 = document.getElementById('resetPass2').value;
  if(!p1 || p1.length<4){ showFormError(document.getElementById('resetError'),'Пароль слишком короткий'); return; }
  if(p1 !== p2){ showFormError(document.getElementById('resetError'),'Пароли не совпадают'); return; }
  const orig = resetSetBtn.textContent;
  resetSetBtn.disabled=true; resetSetBtn.textContent='Сохраняем…';
  try{
    const sb = await ensureSupabase();
    const { error } = await sb.auth.updateUser({ password:p1 });
    if(error) throw error;
    toast('Пароль изменён');
    setAuthState('login');
  }catch(ex){
    showFormError(document.getElementById('resetError'), formatAuthError(ex));
  }finally{
    resetSetBtn.disabled=false; resetSetBtn.textContent=orig;
  }
});

/* ---------- АВТОВХОД ---------- */
(async function autoLogin() {
  const sb = await ensureSupabase();
  if(sb){
    const { data } = await sb.auth.getSession();
    const supUser = data.session?.user;
    const emailSup = supUser?.email;
    if(emailSup){
      currentUser = supUser;
      setSession(emailSup);
      window.currentUserEmail = emailSup;
      renderUserBadge({ nickname: getUsername(), email: emailSup });
      show('#screen-lobby');
      return;
    }
  }
  const email = getSession();
  if (email && users[email]) {
    window.currentUserEmail = email;
    renderUserBadge({ nickname: getUsername(), email });
    show('#screen-lobby');
  } else {
    localStorage.removeItem(SESSION_KEY);
    show('#screen-auth');
    setAuthState('login');
  }
})();

/* ---------- COOKIE CONSENT ---------- */
const COOKIE_CHOICE_KEY = 'cookie_choice';
const COOKIE_TEMP_KEY = 'cookie_consent_temp';
let analyticsTag = null;
function applyCookieChoice(choice){
  if(choice?.analytics){
    if(!analyticsTag){
      const src = window.ANALYTICS_SRC || '';
      if(src){
        analyticsTag = document.createElement('script');
        analyticsTag.src = src;
        analyticsTag.async = true;
        document.head.appendChild(analyticsTag);
      }
    }
  } else {
    analyticsTag?.remove();
    analyticsTag = null;
  }
}

let isSavingConsent = false;
let saveConsentTimer = null;
let releaseCookieTrap = null;
let lastFocusEl = null;

function hideCookieBanner(banner){
  banner.hidden = true;
  banner.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('cookie-open');
  releaseCookieTrap?.();
  releaseCookieTrap = null;
  lastFocusEl?.focus();
  lastFocusEl = null;
  console.debug('[cookies] hidden'); // TODO: remove debug
}

async function persistCookieChoice(choice, banner, status){
  if(isSavingConsent) return;
  isSavingConsent = true;
  try{
    const sb = await ensureSupabase();
    if(sb){
      const { data:{ user } } = await sb.auth.getUser();
      if(user){
        await sb.from('cookie_consents').upsert({ user_id: user.id, choice });
        localStorage.setItem(COOKIE_CHOICE_KEY, JSON.stringify(choice));
        localStorage.removeItem(COOKIE_TEMP_KEY);
      }else{
        localStorage.setItem(COOKIE_CHOICE_KEY, JSON.stringify(choice));
        localStorage.setItem(COOKIE_TEMP_KEY, JSON.stringify(choice));
      }
    }
    applyCookieChoice(choice);
    toast('Настройки сохранены');
    console.debug('[cookies] saved', choice); // TODO: remove debug
    hideCookieBanner(banner);
    status.textContent = '';
  } catch(e){
    console.warn('cookie save', e);
    status.textContent = 'Не удалось сохранить';
  } finally {
    isSavingConsent = false;
  }
}

function queueCookieSave(choice, banner, status){
  if(isSavingConsent) return;
  clearTimeout(saveConsentTimer);
  saveConsentTimer = setTimeout(()=>persistCookieChoice(choice, banner, status),300);
}

async function initCookieBanner(){
  const banner = document.getElementById('cookieBanner');
  if(!banner) return;
  const analyticsCb = document.getElementById('cookieAnalytics');
  const accept = document.getElementById('cookieAccept');
  const decline = document.getElementById('cookieDecline');
  const status = document.getElementById('cookieStatus');

  let choice=null;
  const stored = localStorage.getItem(COOKIE_CHOICE_KEY);
  if(stored){
    try{ choice = JSON.parse(stored); }catch(_){ choice=null; }
  } else {
    try{
      const sb = await ensureSupabase();
      if(sb){
        const { data:{ user } } = await sb.auth.getUser();
        if(user){
          const { data } = await sb.from('cookie_consents').select('choice').eq('user_id', user.id).single();
          if(data?.choice){
            choice = data.choice;
            localStorage.setItem(COOKIE_CHOICE_KEY, JSON.stringify(choice));
          }
        }
      }
    }catch(e){ console.warn('cookie load', e); }
  }

  console.debug('[cookies] init/loaded choice', choice); // TODO: remove debug

  if(choice){
    analyticsCb.checked = !!choice.analytics;
    applyCookieChoice(choice);
    return;
  }

  lastFocusEl = document.activeElement;
  banner.hidden = false;
  banner.setAttribute('aria-hidden', 'false');
  document.body.classList.add('cookie-open');
  releaseCookieTrap = trapFocus(banner);

  const saveCurrent = () => {
    const c = { necessary:true, analytics: analyticsCb.checked };
    queueCookieSave(c, banner, status);
  };

  analyticsCb?.addEventListener('change', saveCurrent);
  accept?.addEventListener('click', () => {
    analyticsCb.checked = true;
    saveCurrent();
  });
  decline?.addEventListener('click', saveCurrent);
}

document.addEventListener('DOMContentLoaded', initCookieBanner);

document.addEventListener('DOMContentLoaded', () => {
  const email = window.currentUserEmail || '';
  renderUserBadge({ nickname: getUsername(), email });
});

ensureSupabase().then(async sb => {
  if(!sb) return;
  const { data:{ session } } = await sb.auth.getSession();
  currentUser = session?.user || null;
  toggleAuthButtons(!currentUser);
  if(currentUser){
    window.currentUserEmail = currentUser.email || '';
    renderUserBadge({ nickname: getUsername(), email: window.currentUserEmail });
    show('#screen-lobby');
    const pending = sessionStorage.getItem('pendingCreate');
    if(pending){
      Object.assign(eventData, JSON.parse(pending));
      sessionStorage.removeItem('pendingCreate');
      save();
      startCreateFlow();
    }
  } else {
    show('#screen-auth');
    setAuthState('login');
  }
  sb.auth.onAuthStateChange(async (event, session)=>{
    if(event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN'){
      lastSession = session;
      rebindTried = false;
    }
    if(event === 'SIGNED_OUT'){
      currentUser = null;
      toggleAuthButtons(true);
      if(manualSignOut){ manualSignOut=false; return; }
      if(!rebindTried && lastSession){
        try{
          const { error } = await sb.auth.setSession(lastSession);
          if(!error){ return; }
        }catch(_){ }
        rebindTried = true;
      }
      await logout('Сессия истекла, войдите снова');
      return;
    }
    currentUser = session?.user || null;
    toggleAuthButtons(!currentUser);
    if(event === 'PASSWORD_RECOVERY'){
      setAuthState('reset');
      resetEmailBlock.hidden = true;
      resetPassBlock.hidden = false;
      show('#screen-auth');
      return;
    }
    if(event === 'SIGNED_IN' && currentUser){
      window.currentUserEmail = currentUser.email || '';
      renderUserBadge({ nickname: getUsername(), email: window.currentUserEmail });
      show('#screen-lobby');
      const pendingProfile = sessionStorage.getItem('pendingProfileName');
      if(pendingProfile){
        try{ await sb.from('profiles').upsert({ id: currentUser.id, nickname: pendingProfile }); }catch(e){ console.warn('profile upsert', e); }
        sessionStorage.removeItem('pendingProfileName');
      }
      const hash = location.hash || '';
      if(hash.includes('error=')){
        const code = new URLSearchParams(hash.slice(1)).get('error');
        sessionBanner.innerHTML = `Ошибка: ${code}. <button id="resendFromBanner" class="btn ghost">Переотправить письмо</button>`;
        sessionBanner.hidden = false;
        document.getElementById('resendFromBanner')?.addEventListener('click', async ()=>{
          try{ await sb.auth.resend({ type:'signup', email: currentUser.email }); sessionBanner.textContent='Письмо отправлено'; }catch(_){ sessionBanner.textContent='Не удалось отправить'; }
        });
        sendAuthTelemetry('redirect_error_'+code);
      } else {
        sessionBanner.hidden = true;
      }
      const temp = localStorage.getItem(COOKIE_TEMP_KEY);
      const uid = session?.user?.id;
      if(temp && uid){
        try{
          const choice = JSON.parse(temp);
          await sb.from('cookie_consents').upsert({ user_id: uid, choice });
          localStorage.setItem(COOKIE_CHOICE_KEY, temp);
          localStorage.removeItem(COOKIE_TEMP_KEY);
          applyCookieChoice(choice);
          return;
        }catch(e){ console.warn('cookie sync', e); }
      }
      const stored = localStorage.getItem(COOKIE_CHOICE_KEY);
      if(!stored && uid){
        try{
          const { data } = await sb.from('cookie_consents').select('choice').eq('user_id', uid).single();
          if(data?.choice){
            localStorage.setItem(COOKIE_CHOICE_KEY, JSON.stringify(data.choice));
            applyCookieChoice(data.choice);
          }
        }catch(e){ console.warn('cookie sync', e); }
      }
      const pending = sessionStorage.getItem('pendingCreate');
      if(pending){
        Object.assign(eventData, JSON.parse(pending));
        sessionStorage.removeItem('pendingCreate');
        save();
        startCreateFlow();
      }
    }
  });
});
/* ---------- ВЫХОД ---------- */
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await logout();
  currentUser = null;
});

$('#changePassBtn')?.addEventListener('click', async ()=>{
  clearFormError($('#changePassError'));
  const curr = $('#currPass').value;
  const np1 = $('#newProfilePass').value;
  const np2 = $('#newProfilePass2').value;
  if(!curr || !np1 || !np2){ showFormError($('#changePassError'),'Заполните все поля'); return; }
  if(np1.length<4){ showFormError($('#changePassError'),'Пароль слишком короткий'); return; }
  if(np1!==np2){ showFormError($('#changePassError'),'Пароли не совпадают'); return; }
  try{
    const sb = await ensureSupabase();
    const { data:{ user } } = await sb.auth.getUser();
    const email = user?.email;
    if(!email) throw new Error('no_user');
    const { error: err } = await sb.auth.signInWithPassword({ email, password: curr });
    if(err){ showFormError($('#changePassError'),'Текущий пароль неверен'); return; }
    const { error } = await sb.auth.updateUser({ password: np1 });
    if(error) throw error;
    toast('Пароль обновлён');
    $('#currPass').value=''; $('#newProfilePass').value=''; $('#newProfilePass2').value='';
  }catch(ex){
    showFormError($('#changePassError'), formatAuthError(ex));
  }
});

$('#deleteAccountBtn')?.addEventListener('click', ()=>{
  $('#deleteConfirm').showModal();
});

$('#confirmDeleteBtn')?.addEventListener('click', async ()=>{
  const dlg = $('#deleteConfirm');
  try{
    const sb = await ensureSupabase();
    const { data:{ session } } = await sb.auth.getSession();
    const token = session?.access_token;
    await fetch('/.netlify/functions/delete-account', { method:'POST', headers:{ Authorization:`Bearer ${token}` } });
    dlg.close();
    await logout();
  }catch(_){
    dlg.close();
    toast('Не удалось удалить аккаунт');
  }
});

/* ---------- ЛОББИ: переходы ---------- */
$('#goCreate')?.addEventListener('click', startCreateFlow);
$('#goJoinByCode')?.addEventListener('click', ()=>{
  show('#screen-app');
  setScene('pond'); renderPads(); frogJumpToPad(0,true); showSlide('join-code');
  const code=$('#lobbyJoinCode').value.trim();
  if(code){
    $('#joinCodeInput').value=code;
    $('#joinCodeInput').dispatchEvent(new Event('input'));
  }
});

const lobbyCodeInput=document.getElementById('lobbyJoinCode');
const lobbyJoinBtn=document.getElementById('goJoinByCode');
if(lobbyCodeInput && lobbyJoinBtn){
  lobbyJoinBtn.disabled=true;
  lobbyCodeInput.addEventListener('input',()=>{
    lobbyCodeInput.value=lobbyCodeInput.value.replace(/\D/g,'').slice(0,6);
    lobbyJoinBtn.disabled = lobbyCodeInput.value.length!==6;
  });
}

const codeInput=document.getElementById('joinCodeInput');
const joinBtn=document.getElementById('joinCodeBtn');
if(codeInput && joinBtn){
  joinBtn.disabled=true;
  const err=document.getElementById('joinCodeError');
  codeInput.addEventListener('input',()=>{
    codeInput.value=codeInput.value.replace(/\D/g,'').slice(0,6);
    joinBtn.disabled = codeInput.value.length!==6;
    if(err) err.textContent='';
  });
}


/* ---------- ПРУД / ЛЯГУШКА ---------- */
const FROG_IDLE="assets/frog_idle.png";
const FROG_JUMP="assets/frog_jump.png";
const CROAK_URL="assets/croak.mp3";
let croakAudio=null; try{croakAudio=new Audio(CROAK_URL);croakAudio.volume=.75}catch(e){}
const croak=()=>{ if(!croakAudio) return; try{croakAudio.currentTime=0;croakAudio.play();}catch(e){} };

const body=document.body, pond=document.getElementById('pond');
const frog=document.getElementById('frog'), frogImg=document.getElementById('frogImg');
const padsWrap=document.getElementById('pads');
const speech=document.getElementById('speech');
const root=document.getElementById('root');
const bigClock = $('#bigClock'), bigClockHM = $('#bigClockHM'), bigClockDays = $('#bigClockDays');
const finalLayout = $('#finalLayout');
const slidesEl = $('#slides');
const stumpImg = document.getElementById('stumpImg');

// Фикс для мобильных: держим мобильную раскладку при открытой клавиатуре
function installMobileLock(){
  const vv = window.visualViewport;
  const isCoarse = matchMedia('(pointer: coarse)').matches;

  const update = () => {
    let kbOpen = false;
    if (vv) {
      // если высота визуального вьюпорта сильно меньше window.innerHeight → открыта клавиатура
      kbOpen = (window.innerHeight - vv.height) > 120;
    }
    document.body.classList.toggle('force-mobile', kbOpen || isCoarse);
  };

  update();
  window.addEventListener('resize', update);
  vv?.addEventListener('resize', update);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', update);
}
installMobileLock();
stumpImg?.addEventListener('load',()=>{
  if(document.body.classList.contains('scene-final')) placeFrogOnStump();
});

function setScene(scene){
  document.body.classList.remove('scene-intro','scene-pond','scene-final');
  document.body.classList.add(`scene-${scene}`);

  $('#slides').hidden = (scene !== 'pond');
  $('#finalLayout').style.display = (scene === 'final') ? 'flex' : 'none';
  $('#bigClock').hidden = (scene !== 'final');

  if (scene === 'final'){
    placeFrogOnStump();
    window.scrollTo(0,0);
  }
}

window.addEventListener('resize', () => {
  if (document.body.classList.contains('scene-final')) placeFrogOnStump();
});
window.visualViewport?.addEventListener('resize', () => {
  if (document.body.classList.contains('scene-final')) placeFrogOnStump();
});

/* Лягушка на пне */
function placeFrogOnStump(){
  const stump = document.querySelector('#stumpImg');
  const frog  = document.querySelector('#frog');
  if(!stump || !frog) return;
  const r = stump.getBoundingClientRect();
  const top  = r.top  + window.scrollY + r.height * 0.58;
  const left = r.left + window.scrollX + r.width  * 0.50;
  frog.style.top = `${top}px`;
  frog.style.left = `${left}px`;
}

const stepToPad = {
  'create-1':0, 'create-wishlist':1, 'create-details':2, 'admin':3,
  'join-code':0, 'join-1':1, 'join-wishlist':2
};
let lastPadIndex = 0;

function renderPads(){
  padsWrap.innerHTML='';
  const rect=pond.getBoundingClientRect();
  const pondW = rect.width || document.documentElement.clientWidth || window.innerWidth || 1024;
  const pondH = rect.height || Math.max(400, Math.round(window.innerHeight*0.48));
  const baseY = pondH*0.70;
  const xs = [15, 40, 65, 88];

  for(let i=0;i<4;i++){
    const pad=document.createElement('div'); pad.className='pad';
    pad.style.left = (pondW*xs[i]/100)+'px';
    pad.style.top  = ( (i%2===0)? baseY : (baseY-60) )+'px';
    padsWrap.appendChild(pad);
  }
  immediatePlaceFrog(lastPadIndex);
}
function immediatePlaceFrog(index){
  const pad=padsWrap.children[index]; if(!pad) return;
  const rect=pad.getBoundingClientRect(), stage=document.body.getBoundingClientRect();
  frog.style.left=(rect.left+rect.width/2-stage.left)+'px';
  frog.style.top =(rect.top +rect.height*0.52-stage.top )+'px';
}
function frogJumpToPad(index, forceJump=false){
  const pad=padsWrap.children[index]; if(!pad){ return; }
  const rect=pad.getBoundingClientRect(), stage=document.body.getBoundingClientRect();
  frog.style.left=(rect.left+rect.width/2-stage.left)+'px';
  frog.style.top =(rect.top +rect.height*0.52-stage.top )+'px';
  if(forceJump && !reduceMotion){
    frogImg.src=FROG_JUMP; frog.classList.remove('jump'); void frog.offsetWidth; frog.classList.add('jump'); croak();
    setTimeout(()=>{ frogImg.src=FROG_IDLE; },550);
  }
  lastPadIndex = index;
}

function withTransition(next){ root.classList.add('fading'); setTimeout(()=>{ next&&next(); root.classList.remove('fading'); }, 450); }
function showSlide(id){
  document.querySelectorAll('#slides > section').forEach(s=>s.hidden=true);
  $(`#slide-${id}`).hidden=false;
  if(stepToPad[id] !== undefined){ frogJumpToPad(stepToPad[id], true); }
}

async function startCreateFlow(){
  const sb = await ensureSupabase();
  const { data:{ user } = {} } = sb ? await sb.auth.getUser() : { data:{} };
  if(user){
    show('#screen-app');
    setScene('pond'); renderPads(); frogJumpToPad(0,true); showSlide('create-1');
  } else {
    sessionStorage.setItem('pendingCreate', JSON.stringify(eventData));
    show('#screen-auth');
    setAuthState('login');
  }
}

/* интро-кнопки */
document.getElementById('speech').querySelector('.actions').onclick=(e)=>{
  const btn=e.target.closest('button'); if(!btn) return;
  withTransition(()=>{
    if(btn.dataset.next==='create'){
      startCreateFlow();
    } else {
      show('#screen-app'); setScene('pond'); renderPads(); frogJumpToPad(0,true); showSlide('join-code');
    }
  });
};

/* ---------- ДАННЫЕ СОБЫТИЯ ---------- */
const STORAGE='froggyhub_state_v14';
let eventData = JSON.parse(localStorage.getItem(STORAGE)||'null') || {
  id:Math.random().toString(36).slice(2,8),
  title:'',date:'',time:'',address:'',dress:'',bring:'',notes:'',
  wishlist:Array.from({length:25},(_,i)=>({id:i+1,title:'',url:'',claimedBy:''})),
  guests:[], join_code:null
};
const save=()=>localStorage.setItem(STORAGE,JSON.stringify(eventData));
let isEventActionPending = false;

function genCode(){ return Math.floor(100000 + Math.random()*900000).toString(); }
async function uniqueCode(sb){
  for(let i=0;i<5;i++){
    const c=genCode();
    const { data } = await sb.from('events').select('id').eq('join_code', c).maybeSingle();
    if(!data) return c;
  }
  throw new Error('Не удалось сгенерировать код');
}

async function createEvent(sb, ownerId, { title, date, time, address, dress, bring, notes, wishlist }){
  const join_code = await uniqueCode(sb);
  const ttlDays = 14;
  const code_expires_at = new Date(Date.now() + ttlDays*24*60*60*1000).toISOString();
  const event_at = new Date(`${date}T${time}:00`).toISOString();
  const payload = { owner_id: ownerId, title, address, dress, bring, notes, join_code, code_expires_at, event_at };
  console.debug('createEvent payload', payload);
  const { data, error } = await sb.from('events').insert([payload]).select('*').single();
  if(error){ console.debug('createEvent error', error); throw error; }
  console.debug('createEvent response', data);
  const items = (wishlist||[]).filter(i=>i.title||i.url).map(it=>({
    event_id: data.id, title: it.title, url: it.url
  }));
  if(items.length){ await sb.from('wishlist_items').insert(items); }
  return data;
}

/* шаги создания */
$('#formCreate')?.addEventListener('submit',(e)=>{
  e.preventDefault();
  const title=$('#eventTitle').value.trim();
  const date=$('#eventDate').value.trim();
  const time=$('#eventTime').value.trim();
  const address=$('#eventAddress').value.trim();
  if(!title||!date||!time){ toast('Заполните название, дату и время'); return; }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)){ toast('Неверный формат даты или времени'); return; }
  Object.assign(eventData,{title,date,time,address}); save();
  withTransition(()=>{ showSlide('create-wishlist'); renderGrid(); });
});

const wlGrid=$('#wlGrid'), editor=$('#cellEditor');
const cellTitle=$('#cellTitle'), cellUrl=$('#cellUrl'); let currentCellId=null;
if(editor) trapFocus(editor);
editor?.addEventListener('close', ()=> editor.querySelector('button, input')?.blur());

function renderGrid(){
  wlGrid.innerHTML=''; wlGrid.style.gridTemplateColumns=`repeat(5,1fr)`;
  eventData.wishlist.forEach(cell=>{
    const div=document.createElement('div'); div.className='cell'+(cell.claimedBy?' taken':''); div.dataset.id=cell.id;
    div.innerHTML=`${cell.claimedBy?'<div class="status">Занято</div>':'<div class="status">Свободно</div>'}
                   <div class="label">${cell.title||''}</div>
                   <div class="action">${cell.url?`<a href="${cell.url}" target="_blank" rel="noopener">Открыть</a>`:''}</div>`;
    div.addEventListener('click',()=>openEditor(cell.id)); wlGrid.appendChild(div);
  });
}
function openEditor(id){
  currentCellId=id; const c=eventData.wishlist.find(x=>x.id===id);
  cellTitle.value=c.title||''; cellUrl.value=c.url||'';
  editor.showModal?editor.showModal():editor.setAttribute('open','');
  cellTitle.focus();
}
$('#saveCell')?.addEventListener('click',()=>{ const c=eventData.wishlist.find(x=>x.id===currentCellId); c.title=cellTitle.value.trim(); c.url=cellUrl.value.trim(); save(); renderGrid(); });
$('#clearWL')?.addEventListener('click',()=>{ eventData.wishlist.forEach(c=>{c.title='';c.url='';c.claimedBy='';}); save(); renderGrid(); });
$('#addItem')?.addEventListener('click',()=>{ const nextId=eventData.wishlist.length?Math.max(...eventData.wishlist.map(i=>i.id))+1:1; eventData.wishlist.push({id:nextId,title:'',url:'',claimedBy:''}); save(); renderGrid(); });
$('#toDetails')?.addEventListener('click',()=>withTransition(()=>{ showSlide('create-details'); }));
editor?.addEventListener('click',e=>{ const r=editor.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) editor.close(); });

$('#formDetails')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(isEventActionPending) return;
  isEventActionPending = true;
  const btn = e.submitter;
  const original = btn?.textContent;
  btn?.setAttribute('disabled','');
  btn && (btn.textContent='Создаём…');
  Object.assign(eventData,{dress:$('#eventDress').value.trim(),bring:$('#eventBring').value.trim(),notes:$('#eventNotes').value.trim()});
  const status=$('#createEventStatus');
  status.textContent='';
  try{
    const sb = await ensureSupabase();
    const { data:{ user } } = await sb.auth.getUser();
    if(!user){ toast('Войдите'); status.textContent='Войдите'; return; }
    const payload = { title:eventData.title, date:eventData.date, time:eventData.time, address:eventData.address, notes:eventData.notes, dress_code:eventData.dress, bring:eventData.bring, owner_id:user.id };
    if(DEBUG_EVENTS) console.log('[create-event] payload', payload);
    const data = await callFnEx('create-event', { method:'POST', body: payload });
    if(DEBUG_EVENTS) console.log('[create-event] ok');
    Object.assign(eventData, data);
    save();
    status.textContent='Событие создано';
    withTransition(()=>{ showSlide('admin'); renderAdmin(); });
  }catch(err){
    if(DEBUG_EVENTS) console.warn('[create-event] err', err);
    status.textContent = explainFnError(err);
    toast(explainFnError(err));
  }finally{
    isEventActionPending=false;
    btn?.removeAttribute('disabled');
    if(btn) btn.textContent = original || 'Сгенерировать код';
  }
});
function renderAdmin(){
  $('#eventCode').textContent=eventData.join_code||'—';
  const exp=$('#codeExpire');
  if(exp){
    if(eventData.code_expires_at){
      const d=new Date(eventData.code_expires_at);
      exp.textContent=`Код истечёт ${d.toLocaleDateString('ru-RU')}`;
    } else exp.textContent='';
  }
  const link=$('#analyticsLink');
  if(link){
    link.href=`event-analytics.html?id=${encodeURIComponent(eventData.id||'')}`;
    link.hidden=!eventData.id;
  }
  const html=(eventData.wishlist.filter(i=>i.title||i.url).map(i=>`${i.title||'Подарок'} — ${i.claimedBy?'🔒 занято':'🟢 свободно'} ${i.url?`• <a href="${i.url}" target="_blank">ссылка</a>`:''}`)).map(s=>`<li>${s}</li>`).join('');
  $('#adminGifts').innerHTML=html||'<li>Вишлист пуст</li>';
}
$('#finishCreate')?.addEventListener('click',()=>withTransition(()=>toFinalScene()));

$('#copyCodeBtn')?.addEventListener('click', ()=>shareInvite(eventData.join_code));

/* ПРИСОЕДИНЕНИЕ ПО КОДУ */
async function authHeader(){
  const sb = await ensureSupabase();
  if(sb){
    const { data } = await sb.auth.getSession();
    const t = data?.session?.access_token;
    return t ? { Authorization: 'Bearer '+t } : {};
  }
  return {};
}

async function joinByCode(code){
  const announce = document.getElementById('joinCodeError');
  announce.textContent='';
  if(isEventActionPending) return;
  isEventActionPending = true;
  const original = joinBtn?.textContent;
  joinBtn?.setAttribute('disabled','');
  if(joinBtn) joinBtn.textContent='Присоединяем…';
  try{
    const sb = await ensureSupabase();
    const { data:{ user } } = await sb.auth.getUser();
    if(!user){ toast('Войдите'); announce.textContent='Войдите'; return; }
    const data = await callFnEx('join-by-code',{ method:'POST', body:{ code }});
    await loadEvent(data.event_id || data.eventId);
    setScene('final');
  }catch(err){
    if(err.status===404||err.status===400) announce.textContent='Неверный или истёкший код.';
    else if(err.status===409) announce.textContent='Вы уже участник этого события.';
    else announce.textContent=explainFnError(err);
    toast(announce.textContent);
  }finally{
    isEventActionPending=false;
    joinBtn?.removeAttribute('disabled');
    if(joinBtn) joinBtn.textContent=original || 'Проверить';
  }
}

let rtChannel;

async function subscribeEventRealtime(eventId, { onWishlist, onGuests } = {}) {
  const sb = await ensureSupabase();
  if(!sb) return;
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ console.warn('Realtime: auth required'); return; }
  const { data:{ user } } = await sb.auth.getUser();
  const isOwner = user?.id && eventData.owner_id && user.id === eventData.owner_id;
  const sanitizeWishlist = (r)=> r ? ({ id:r.id, title:r.title, url:r.url, claimed_by:r.claimed_by || r.taken_by || r.reserved_by }) : null;
  const sanitizeGuest = (r)=> r ? ({ name:r.name, rsvp:r.rsvp }) : null;
  if (rtChannel) { sb.removeChannel(rtChannel); rtChannel = null; }
  rtChannel = sb
    .channel('event-' + eventId)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'wishlist_items', filter: 'event_id=eq.' + eventId
    }, (payload) => {
      const data = isOwner ? payload : { eventType: payload.eventType, new: sanitizeWishlist(payload.new), old: sanitizeWishlist(payload.old) };
      onWishlist?.(data);
    })
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'guests', filter: 'event_id=eq.' + eventId
    }, (payload) => {
      const data = isOwner ? payload : { eventType: payload.eventType, new: sanitizeGuest(payload.new), old: sanitizeGuest(payload.old) };
      onGuests?.(data);
    })
    .subscribe(status => {
      if(status === 'CHANNEL_ERROR') console.warn('Realtime channel not connected: insufficient rights');
    });
}

async function renderWishlist(eventId){
  const sb = await ensureSupabase();
  if(!sb) return;
  const { data } = await sb.from('wishlist_items').select('id,title,url,claimed_by').eq('event_id', eventId).order('id');
  eventData.wishlist = (data || []).map(it=>({ id:it.id, title:it.title, url:it.url, claimedBy:it.claimed_by || '' }));
  if(!$('#slide-join-wishlist').hidden) renderGuestWishlist();
  if(!$('#slide-create-wishlist').hidden) renderGrid();
  if(!$('#slide-admin').hidden) renderAdmin();
  if(document.body.classList.contains('scene-final')) toFinalScene();
}

async function renderGuests(eventId){
  const sb = await ensureSupabase();
  if(!sb) return;
  const { data } = await sb.from('guests').select('name,rsvp').eq('event_id', eventId);
  eventData.guests = data || [];
  if(document.body.classList.contains('scene-final')) toFinalScene();
}

async function loadEvent(eventId){
  try{
    const data = await callFnEx('event-by-code',{ method:'POST', body:{ event_id:eventId }});
    if(data.event){
      Object.assign(eventData, data.event);
      if(data.event.event_at){
        const d=new Date(data.event.event_at);
        eventData.date = d.toISOString().slice(0,10);
        eventData.time = d.toISOString().slice(11,16);
      }
    }
    eventData.wishlist = (data.wishlist || []).map(it=>({ id:it.id, title:it.title, url:it.url, claimedBy:it.claimed_by || it.taken_by || it.reserved_by || '' }));
    eventData.guests = (data.participants || []).map(p=>({ name:p.profiles?.nickname || p.name || '', rsvp:p.rsvp }));
    await Promise.all([renderWishlist(eventId), renderGuests(eventId)]);
    await subscribeEventRealtime(eventId, {
      onWishlist: () => renderWishlist(eventId),
      onGuests:   () => renderGuests(eventId),
    });
  }catch(err){
    if(err.status===401||err.status===403) await needLogin();
    else toast(explainFnError(err));
  }
}

function cleanupRealtime(){ if (rtChannel) { window.__supabaseClient?.removeChannel(rtChannel); rtChannel = null; } }
window.addEventListener('beforeunload', cleanupRealtime);

async function needLogin(){
  const qp = new URLSearchParams(location.search);
  const code = qp.get('code') || '';
  if (code) sessionStorage.setItem('pendingCode', code);
  show('#screen-auth');
  setAuthState('login');
}

async function handleDeepLink(){
  const code = (new URLSearchParams(location.search).get('code') || '').replace(/\D/g,'').slice(0,6);
  if(!code) return;
  const sb = await ensureSupabase();
  if(!sb) return;
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ sessionStorage.setItem('pendingCode', code); show('#screen-auth'); setAuthState('login'); }
  else { joinByCode(code); }
}

window.addEventListener('DOMContentLoaded', async () => {
  const pending = sessionStorage.getItem('pendingCode');
  if(pending){
    const sb = await ensureSupabase();
    if(sb){
      const { data:{ session } } = await sb.auth.getSession();
      if(session){ sessionStorage.removeItem('pendingCode'); joinByCode(pending); }
    }
  } else {
    handleDeepLink();
  }
});

$('#joinCodeBtn')?.addEventListener('click', () => {
  if(isEventActionPending) return;
  const code = (document.getElementById('joinCodeInput')?.value || '').trim();
  if(!/^\d{6}$/.test(code)){
    const announce = document.getElementById('joinCodeError');
    announce.textContent = 'Введите 6 цифр';
    return;
  }
  joinByCode(code);
});

async function joinCurrentEvent(){
  try{ await callFnEx('join-by-code',{ method:'POST', body:{ code:eventData.join_code }}); }catch(_){ }
}
/* RSVP + подарок */
let currentGuestName='';
document.querySelectorAll('[data-rsvp]')?.forEach(b=>b.addEventListener('click',e=>{
  const code=e.currentTarget.dataset.rsvp, name=($('#guestName').value||'').trim();
  if(!name) return toast('Введите имя');
  currentGuestName=name;
  const ex=eventData.guests.find(g=>g.name.toLowerCase()===name.toLowerCase());
  if(ex) ex.rsvp=code; else eventData.guests.push({name,rsvp:code});
  save(); croak();
}));
$('#toGuestWishlist')?.addEventListener('click',()=>{
  const name=($('#guestName').value||'').trim(); if(!name) return toast('Введите имя');
  currentGuestName=name; withTransition(()=>{ showSlide('join-wishlist'); renderGuestWishlist(); });
});
const guestGifts=$('#guestGifts');
function renderGuestWishlist(){
  const items=eventData.wishlist.filter(i=>i.title||i.url);
  guestGifts.innerHTML=items.map(item=>{
    const me=item.claimedBy && item.claimedBy.toLowerCase()===currentGuestName.toLowerCase();
    const taken=!!item.claimedBy && !me;
    const status=taken?`<span class="pill-mini">Занято</span>`:me?`<span class="pill-mini">Вы выбрали</span>`:`<span class="pill-mini">Свободно</span>`;
    const chooseBtn=taken?'': me ? `<button data-id="${item.id}" class="pill-mini unchoose">Снять выбор</button>` : `<button data-id="${item.id}" class="pill-mini choose">Выбрать</button>`;
    const link=item.url?` • <a href="${item.url}" target="_blank" rel="noopener">ссылка</a>`:'';
    return `<div class="list-item" style="display:flex;justify-content:space-between;align-items:center;background:#113424;border:1px solid #2a7c56;border-radius:12px;padding:10px 12px">
              <div><strong>${item.title||'Подарок'}</strong><span class="meta">${link}</span></div>
              <div class="gift-actions" style="display:flex;gap:8px">${status}${chooseBtn}</div>
            </div>`;
  }).join('');
  guestGifts.querySelectorAll('.choose').forEach(b=>b.addEventListener('click',e=>{
    const id=+e.currentTarget.dataset.id; const it=eventData.wishlist.find(x=>x.id===id);
    if(it.claimedBy && it.claimedBy.toLowerCase()!==currentGuestName.toLowerCase()) return toast('Этот подарок уже выбрали');
    eventData.wishlist.forEach(x=>{ if(x.claimedBy && x.claimedBy.toLowerCase()===currentGuestName.toLowerCase()) x.claimedBy=''; });
    it.claimedBy=currentGuestName; save(); renderGuestWishlist();
  }));
  guestGifts.querySelectorAll('.unchoose').forEach(b=>b.addEventListener('click',e=>{
    const id=+e.currentTarget.dataset.id; const it=eventData.wishlist.find(x=>x.id===id);
    if(it.claimedBy && it.claimedBy.toLowerCase()===currentGuestName.toLowerCase()){ it.claimedBy=''; save(); renderGuestWishlist(); }
  }));
}
$('#skipWishlist')?.addEventListener('click',async()=>{ await joinCurrentEvent(); withTransition(()=>toFinalScene()); });
$('#toGuestFinal')?.addEventListener('click',async()=>{ await joinCurrentEvent(); withTransition(()=>toFinalScene()); });

/* ---------- ФИНАЛ: две колонки ---------- */
let finalTimer = null;
function getEventDate(){
  const iso = `${eventData.date}T${eventData.time}`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
function toFinalScene(){
  setScene('final');
  croak();

  $('#fTitle').textContent = eventData.title || 'Событие';
  // чипы под заголовком отключены намеренно

  $('#fNotes').textContent = eventData.notes || 'Встречаемся и празднуем!';
  $('#fDress').textContent = eventData.dress || '—';
  $('#fBring').textContent = eventData.bring || '—';

  const fwl = $('#fWishlist');
  const items = eventData.wishlist.filter(i=>i.title||i.url).slice(0,8);
  fwl.innerHTML = items.length
    ? items.map(i=>`<div class="wl-tile ${i.claimedBy?'taken':''}">
          <div class="ttl">${i.title||'Подарок'}</div>
          <div class="tag">${i.claimedBy?`🔒 занято (${i.claimedBy})`:'🟢 свободно'}</div>
        </div>`).join('')
    : `<div class="wl-tile"><div class="ttl">Пусто</div><div class="tag">Добавьте пожелания</div></div>`;

  const yes = eventData.guests.filter(g=>g.rsvp==='yes').length;
  const maybe = eventData.guests.filter(g=>g.rsvp==='maybe').length;
  const no = eventData.guests.filter(g=>g.rsvp==='no').length;
  const chosen = eventData.wishlist.filter(i=>i.claimedBy).length;
  const totalW = eventData.wishlist.filter(i=>i.title||i.url).length;
  $('#fStats').innerHTML = `
    <div><strong>Гости:</strong> Идут — <b>${yes}</b>, Возможно — <b>${maybe}</b>, Не идут — <b>${no}</b></div>
    <div style="margin-top:6px"><strong>Подарки:</strong> Занято — <b>${chosen}</b>, Свободно — <b>${Math.max(0,totalW-chosen)}</b></div>
  `;
  $('#fShare').innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <div>Код события: <span class="pill-mini" style="background:#1b4a33">${eventData.join_code||'—'}</span></div>
      <button class="btn small" id="copyCodeBtn">Поделиться</button>
    </div>
  `;
  document.getElementById('copyCodeBtn')?.addEventListener('click', () => shareInvite(eventData.join_code));

  function tickClock(){
    const dt = getEventDate();
    if(!dt){ bigClockHM.textContent='—:—'; bigClockDays.textContent='—'; return; }
    const diff = dt - new Date();
    if(diff<=0){ bigClockHM.textContent='00:00'; bigClockDays.textContent='Праздник начался!'; return; }
    const days = Math.floor(diff/86400000);
    const rem  = diff%86400000;
    const hours = Math.floor(rem/3600000);
    const mins  = Math.floor((rem%3600000)/60000);
    const pad=n=>n.toString().padStart(2,'0');
    bigClockHM.textContent=`${pad(hours)}:${pad(mins)}`;
    bigClockDays.textContent = days===1 ? 'Остался 1 день' : `Осталось ${days} дней`;
  }
  tickClock(); clearInterval(finalTimer); finalTimer=setInterval(tickClock,1000);
}

/* ---------- ИНИЦИАЛИЗАЦИЯ ---------- */
(function initIntro(){
  renderPads();
  window.addEventListener('resize',()=>{
    if(document.body.classList.contains('scene-pond')){
      const keep = lastPadIndex;
      renderPads();
      immediatePlaceFrog(keep);
    }
  });
})();

/* ---------- РЕДАКТИРОВАНИЕ СОБЫТИЯ ---------- */
const editForm = document.getElementById('editForm');
if(editForm){
  const fields = {
    title: document.getElementById('editTitle'),
    date: document.getElementById('editDate'),
    time: document.getElementById('editTime'),
    address: document.getElementById('editAddress'),
    notes: document.getElementById('editNotes'),
    dress: document.getElementById('editDress'),
    bring: document.getElementById('editBring')
  };
  const errEl = document.getElementById('editError');
  const params = new URLSearchParams(location.search);
  const eventId = params.get('id');
  let currentEvent = {};

  async function loadDetails(){
    try{
      const res = await fetch(`/.netlify/functions/get-event-details?id=${encodeURIComponent(eventId)}`, {
        headers: await authHeader()
      });
      if(!res.ok) throw new Error(res.status===404 ? 'Событие не найдено' : 'Ошибка загрузки');
      const { event } = await res.json();
      fields.title.value = event.title || '';
      fields.date.value = event.date || '';
      fields.time.value = event.time || '';
      fields.address.value = event.address || '';
      fields.notes.value = event.notes || '';
      fields.dress.value = event.dress_code || '';
      fields.bring.value = event.bring || '';
      currentEvent = {
        title: fields.title.value,
        date: fields.date.value,
        time: fields.time.value,
        address: fields.address.value,
        notes: fields.notes.value,
        dress_code: fields.dress.value,
        bring: fields.bring.value
      };
    }catch(err){ errEl.textContent = err.message; }
  }

  editForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    errEl.textContent='';
    if(!fields.title.value.trim() || !fields.date.value || !fields.time.value){
      errEl.textContent = 'Заполните обязательные поля';
      return;
    }
    const prev = { ...currentEvent };
    const payload = {
      event_id: eventId,
      title: fields.title.value.trim(),
      date: fields.date.value,
      time: fields.time.value,
      address: fields.address.value.trim(),
      notes: fields.notes.value.trim(),
      dress_code: fields.dress.value.trim(),
      bring: fields.bring.value.trim()
    };
    currentEvent = { ...payload };
    toast('Сохраняем...');
    const headers = await authHeader();
    fetch('/.netlify/functions/update-event', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', ...headers },
      body: JSON.stringify(payload)
    }).then(res=>{
      if(!res.ok){
        throw new Error(res.status===403 ? 'Нет доступа' : res.status===404 ? 'Событие не найдено' : 'Ошибка обновления');
      }
      toast('Событие обновлено');
      setTimeout(()=>{ location.href = `event-analytics.html?id=${encodeURIComponent(eventId)}`; }, 500);
    }).catch(err=>{
      currentEvent = prev;
      fields.title.value = prev.title;
      fields.date.value = prev.date;
      fields.time.value = prev.time;
      fields.address.value = prev.address;
      fields.notes.value = prev.notes;
      fields.dress.value = prev.dress_code;
      fields.bring.value = prev.bring;
      errEl.textContent = err.message;
      toast(err.message);
    });
  });

  loadDetails();
}

/* ---------- Простые обработчики кнопок ---------- */
const createBtn = document.querySelector('[data-action="create-event"]');
if (createBtn){
  createBtn.addEventListener('click', withBusy(createBtn, async ()=>{
    const username = getUsername();
    if(!username){ toast('Сначала войдите/зарегистрируйтесь (нужен логин)', 'error'); return; }

    const event = {
      title: $('#event-title')?.value?.trim() || 'Моё событие',
      date:  $('#event-date')?.value || null,
      time:  $('#event-time')?.value || null,
      place: $('#event-place')?.value?.trim() || '',
      dress: $('#event-dress')?.value?.trim() || '',
      bring: $('#event-bring')?.value?.trim() || '',
      note:  $('#event-note')?.value?.trim()  || ''
    };

    try{
      const r = await callFn('create-event', { username, event });
      const code = r?.code || r?.event?.join_code;
      if(code){ try{ await navigator.clipboard.writeText(code);}catch{} }
      toast(code ? `Событие создано, код: ${code}` : 'Событие создано');
      // location.href = `/event.html?id=${encodeURIComponent(r?.event?.id||r?.id)}`;
    }catch(e){ toast(e.message || 'Не удалось создать событие', 'error'); }
  }));
}

const joinBtn2 = document.querySelector('[data-action="join-event"]');
if (joinBtn2){
  joinBtn2.addEventListener('click', withBusy(joinBtn2, async ()=>{
    const username = getUsername();
    if(!username){ toast('Сначала войдите с логином', 'error'); return; }
    const code = ($('#join-code')?.value||'').trim();
    if(!/^\w{6}$/.test(code)){ toast('Введите корректный 6-значный код', 'error'); return; }

    try{
      const r = await callFn('join-by-code', { username, code });
      toast('Вы присоединились к событию');
      // location.href = `/event.html?id=${encodeURIComponent(r?.event?.id||r?.id)}`;
    }catch(e){ toast(e.message || 'Не удалось присоединиться', 'error'); }
  }));
}

$('#login-btn')?.addEventListener('click', withBusy($('#login-btn'), async ()=>{
  const username = $('#login-username')?.value?.trim();
  const password = $('#login-password')?.value||'';
  if(!username || !password){ toast('Введите логин и пароль', 'error'); return; }
  try{ await callFn('local-login', { username, password }); setUsername(username); toast('Вход выполнен'); }
  catch(e){ toast(e.message||'Не удалось войти','error'); }
}));

$('#signup-btn')?.addEventListener('click', withBusy($('#signup-btn'), async ()=>{
  const username = $('#signup-username')?.value?.trim();
  const p1 = $('#signup-password')?.value||'', p2 = $('#signup-password2')?.value||'';
  if(!username || !p1 || p1!==p2){ toast('Проверьте логин и пароли', 'error'); return; }
  try{ await callFn('local-signup', { username, password:p1 }); setUsername(username); toast('Регистрация успешна'); }
  catch(e){ toast(e.message||'Не удалось зарегистрироваться','error'); }
}));

$('#logout-btn')?.addEventListener('click', withBusy($('#logout-btn'), async ()=>{
  try{ await callFn('local-logout', {});}catch(e){ console.warn(e); }
  setUsername('');
  toast('Вы вышли');
}));

async function uiSmoke(){
  const report = [];
  const need = [
    ['create-event', !!document.querySelector('[data-action="create-event"]')],
    ['join-event',   !!document.querySelector('[data-action="join-event"]')],
    ['login',        !!document.querySelector('#login-btn')],
    ['signup',       !!document.querySelector('#signup-btn')],
    ['logout',       !!document.querySelector('#logout-btn')],
  ];
  need.forEach(([k, ok])=> report.push({button:k, present:ok}));
  console.table(report);
  if(report.some(x=>!x.present)) console.warn('Не все кнопки найдены на странице');
}
uiSmoke();

if(DEBUG_AUTH){
  dbgAuth('sb_mode', sessionStorage.getItem('sb_mode') || 'direct');
}
