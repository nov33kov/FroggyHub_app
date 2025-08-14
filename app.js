// FroggyHub — green theme with mascot onboarding (localStorage only)
const els = {
  onboard: document.getElementById('onboard'),
  obName: document.getElementById('obName'),
  obSkip: document.getElementById('obSkip'),
  obStart: document.getElementById('obStart'),
  guestNameInline: document.getElementById('guestNameInline'),
  // Create
  createForm: document.getElementById('createForm'),
  eventTitle: document.getElementById('eventTitle'),
  eventDate: document.getElementById('eventDate'),
  eventTime: document.getElementById('eventTime'),
  eventDesc: document.getElementById('eventDesc'),
  eventDress: document.getElementById('eventDress'),
  wishlistUrl: document.getElementById('wishlistUrl'),
  wishlistRaw: document.getElementById('wishlistRaw'),
  surpriseMode: document.getElementById('surpriseMode'),
  // Invite/Dash
  inviteEmpty: document.getElementById('inviteEmpty'),
  inviteView: document.getElementById('inviteView'),
  iTitle: document.getElementById('iTitle'),
  iDesc: document.getElementById('iDesc'),
  chipDate: document.getElementById('chipDate'),
  chipTime: document.getElementById('chipTime'),
  chipDress: document.getElementById('chipDress'),
  wishlist: document.getElementById('wishlist'),
  rsvpForm: document.getElementById('rsvpForm'),
  guestName: document.getElementById('guestName'),
  sYes: document.getElementById('sYes'),
  sMaybe: document.getElementById('sMaybe'),
  sNo: document.getElementById('sNo'),
  guestList: document.getElementById('guestList'),
  giftList: document.getElementById('giftList'),
  dash: document.getElementById('dash'),
  dashEmpty: document.getElementById('dashEmpty'),
  copyInvite: document.getElementById('copyInvite'),
  resetEvent: document.getElementById('resetEvent'),
};

const KEY = 'froggyhub_event_v01';
const NAME_KEY = 'froggyhub_user_name';

function parseManualWishlist(raw){
  if(!raw) return [];
  return raw.split('\n').map(s=>s.trim()).filter(Boolean).map((line, idx)=>{
    const [name, url] = line.split('|').map(x=>x && x.trim());
    return { id: String(idx+1), name: name || 'Подарок', url: url || null, reservedBy: null };
  });
}

function load(){ const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; }
function save(data){ localStorage.setItem(KEY, JSON.stringify(data)); }

function createEvent(e){
  e.preventDefault();
  const title = els.eventTitle.value.trim();
  const date = els.eventDate.value;
  const time = els.eventTime.value;
  if(!title || !date || !time){ alert('Укажите название, дату и время'); return; }
  const data = {
    id: Math.random().toString(36).slice(2,8),
    title, date, time,
    desc: els.eventDesc.value.trim(),
    dress: els.eventDress.value.trim(),
    wishlistUrl: els.wishlistUrl.value.trim(),
    surprise: els.surpriseMode.checked,
    wishlist: parseManualWishlist(els.wishlistRaw.value),
    guests: []
  };
  save(data);
  renderAll();
  document.getElementById('invite').scrollIntoView({behavior:'smooth'});
}

// Onboarding
function startOnboarding(){
  const savedName = localStorage.getItem(NAME_KEY);
  if(savedName){
    els.onboard.style.display = 'none';
    els.guestNameInline.textContent = savedName;
    return;
  }
  els.onboard.style.display = 'grid';
}
function finishOnboarding(skip=false){
  const name = (els.obName.value || '').trim();
  if(!skip && !name){ alert('Как тебя зовут?'); return; }
  if(!skip) localStorage.setItem(NAME_KEY, name);
  els.guestNameInline.textContent = name || 'гость';
  els.onboard.style.display = 'none';
}

els.obStart.addEventListener('click', ()=>finishOnboarding(false));
els.obSkip.addEventListener('click', ()=>finishOnboarding(true));

function renderInvite(data){
  if(!data){ els.inviteView.hidden = true; els.inviteEmpty.hidden = false; return; }
  els.inviteEmpty.hidden = true;
  els.inviteView.hidden = false;
  els.iTitle.textContent = data.title;
  els.iDesc.textContent = data.desc || '';
  els.chipDate.textContent = new Date(data.date).toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric'});
  els.chipTime.textContent = data.time || '--:--';
  els.chipDress.textContent = 'Дресс-код: ' + (data.dress || '—');

  // wishlist cards
  els.wishlist.innerHTML = '';
  data.wishlist.forEach(item=>{
    const li = document.createElement('li');
    li.className = 'card-item';
    li.innerHTML = \`
      <div class="title">\${item.name}</div>
      <div class="muted">\${item.url ? '<a href="'+item.url+'" target="_blank" rel="noopener">ссылка</a>' : ''}</div>
      <div class="pick">
        <span class="badge \${item.reservedBy ? 'taken' : 'free'}">\${item.reservedBy ? 'Занято' : 'Свободно'}</span>
        <button class="btn" data-id="\${item.id}">\${item.reservedBy ? 'Освободить' : 'Выбрать'}</button>
      </div>
    \`;
    li.querySelector('button').addEventListener('click', ()=>toggleReserve(item.id));
    els.wishlist.appendChild(li);
  });
}

function renderDashboard(data){
  if(!data){ els.dash.hidden = true; els.dashEmpty.hidden = false; return; }
  els.dash.hidden = false; els.dashEmpty.hidden = true;

  const yes = data.guests.filter(g=>g.rsvp==='yes').length;
  const maybe = data.guests.filter(g=>g.rsvp==='maybe').length;
  const no = data.guests.filter(g=>g.rsvp==='no').length;
  els.sYes.textContent = yes; els.sMaybe.textContent = maybe; els.sNo.textContent = no;

  els.guestList.innerHTML = data.guests.map(g=>\`<li>\${g.name} — \${g.rsvp}</li>\`).join('') || '<li class="muted">Пока пусто</li>';
  els.giftList.innerHTML = data.wishlist.map(i=>\`<li>\${i.name} — \${i.reservedBy ? ('выбран: ' + i.reservedBy) : 'свободно'}</li>\`).join('') || '<li class="muted">Пока пусто</li>';
}

function renderAll(){
  const data = load();
  renderInvite(data);
  renderDashboard(data);
}

function toggleReserve(id){
  const data = load(); if(!data) return;
  const item = data.wishlist.find(w=>w.id===id);
  if(!item) return;
  const name = localStorage.getItem(NAME_KEY) || (els.guestName.value.trim() || 'гость');
  const by = data.surprise ? 'аноним' : name;
  item.reservedBy = item.reservedBy ? null : by;
  save(data); renderAll();
}

function submitRSVP(code){
  const data = load(); if(!data) return;
  const inputName = els.guestName.value.trim() || localStorage.getItem(NAME_KEY) || 'гость';
  const existing = data.guests.find(g=>g.name.toLowerCase()===inputName.toLowerCase());
  if(existing){ existing.rsvp = code; } else { data.guests.push({name: inputName, rsvp: code}); }
  save(data); renderAll(); els.guestName.value='';
}

['yes','maybe','no'].forEach(code=>{
  document.querySelector('[data-rsvp="'+code+'"]').addEventListener('click', ()=>submitRSVP(code));
});

els.createForm.addEventListener('submit', createEvent);
els.copyInvite.addEventListener('click', ()=>{
  const data = load(); if(!data){ alert('Сначала создайте событие'); return; }
  const fakeLink = location.href.split('#')[0] + '#invite=' + data.id;
  navigator.clipboard.writeText(fakeLink).then(()=>alert('Ссылка скопирована (демо):\n'+fakeLink));
});
els.resetEvent.addEventListener('click', ()=>{
  if(confirm('Сбросить локальные данные?')){ localStorage.removeItem(KEY); renderAll(); }
});

// init
startOnboarding();
renderAll();
