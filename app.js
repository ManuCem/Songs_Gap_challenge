/* Lyrics Gap Challenge — app logic (plain ES module, no build step) */

// =====================================================================
// helpers
// =====================================================================
const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids){
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})){
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)){ if (c != null && c !== false) e.append(c.nodeType ? c : String(c)); }
  return e;
}
const store = {
  get(k, d){ try { const v = localStorage.getItem('lgc:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem('lgc:' + k, JSON.stringify(v)); } catch {} },
  del(k){ try { localStorage.removeItem('lgc:' + k); } catch {} }
};
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const toDate = v => v ? (typeof v.toDate === 'function' ? v.toDate() : new Date(v)) : null;
function timeAgo(d){
  if (!d) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return d.toLocaleDateString();
}
function toast(msg){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2800);
}
const hueOf = s => { let x = 7; for (const c of String(s || '')) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
function tile(title, cover, size = ''){
  const t = h('div', { class: 'tile ' + size, style: `--h:${hueOf(title)}` });
  if (cover){
    const img = h('img', { src: cover, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.onerror = () => { img.remove(); t.textContent = initial(title); };
    t.append(img);
  } else t.textContent = initial(title);
  return t;
}
const initial = s => (String(s || '?').trim().match(/[\p{L}\p{N}]/u) || ['♪'])[0].toUpperCase();

// seeded random → the same seed always gives the same gaps (used by share links & resume)
function rng(seed){
  let x = 2166136261 >>> 0;
  for (const c of String(seed)){ x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  let a = x >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand = Math.random){
  for (let i = arr.length - 1; i > 0; i--){ const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
const newSeed = () => Math.random().toString(36).slice(2, 10);
const hash36 = s => { let x = 0; for (const c of s) x = (Math.imul(x, 31) + c.charCodeAt(0)) | 0; return (x >>> 0).toString(36); };
const b64enc = str => { const bytes = new TextEncoder().encode(str); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64dec = s => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };

// =====================================================================
// text & answers
// =====================================================================
function cleanLine(l){
  l = String(l).replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/[ ​]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^\[[^\]]*\]$/.test(l) ? '' : l;
}
function cleanLines(text){
  const out = [];
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')){
    const l = cleanLine(raw);
    if (!l && (!out.length || !out[out.length - 1])) continue;
    out.push(l);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}
function linesFromLRC(lrc){
  const items = [];
  for (const raw of String(lrc).split(/\r?\n/)){
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '');
    for (const m of tags) items.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text });
  }
  items.sort((a, b) => a.t - b.t);
  const lines = [], times = [];
  for (const it of items){
    const l = cleanLine(it.text);
    if (!l && (!lines.length || !lines[lines.length - 1])) continue;
    lines.push(l); times.push(it.t);
  }
  while (lines.length && !lines[lines.length - 1]){ lines.pop(); times.pop(); }
  return { lines, times };
}

const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
function same(a, b){
  a = norm(a); b = norm(b);
  if (!a) return false;
  if (a === b) return true;
  const f = x => x.replace(/ing$/, 'in');           // shinin' ≈ shining
  return f(a) === f(b);
}

const SMALL = new Set(('a an the and or but nor so yet to of in on at by for from with about into onto over under up down out off as if than then that this these those ' +
  'i me my mine you your yours he him his she her hers it its we us our ours they them their theirs ' +
  'is am are was were be been being do does did have has had will would can could shall should may might must not no ' +
  'im youre hes shes its were theyre ive youve weve theyve ill youll well theyll id youd dont doesnt didnt cant wont isnt arent wasnt').split(' '));
// ad-libs nobody can spell: "oh-oh", "ooooh", "la-la-la", "nanana", "yeah-yeah", "uh-huh", "mm-hmm", "skrrt"…
const FILLER_SYL = /^(o+h*|a+h+|u+h+|e+h+|a+y+e?|e+y+|w+h?o+a+h*|w+h?o{2,}|h+o{2,}|y+e+a+h*|y+e+h+|y+a+h*|y+o+|l+a+|n+a+h*|d+a+|h+a+h*|h+e+y+|m+|h+m+|m+h+m+|h+u+h+|b+r+|g+r+|s+k+r+t*)$/;
function isFiller(core){
  const parts = String(core).toLowerCase().normalize('NFD').replace(/[̀-ͯ']/g, '').split(/[-–—~]+/).map(p => p.replace(/[^a-z]/g, '')).filter(Boolean);
  return parts.length > 0 && parts.every(p => {
    if (FILLER_SYL.test(p)) return true;
    const rep = p.match(/^([a-z]{2,4}?)\1+$/);           // one filler sound repeated: "ohoh", "lalala"
    return !!rep && FILLER_SYL.test(rep[1]);
  });
}

// density = % of the song's DIFFERENT words you really type (a chorus sung 4 times counts once)
const PRESETS = {
  easy:   { density: 10, minLen: 4, focus: 'content', firstLetter: true,  sizeBoxes: true,  desc: 'Casual listener. 1 in 10 words, first letters given. Failing this is a choice. 💀' },
  medium: { density: 15, minLen: 3, focus: 'any',     firstLetter: false, sizeBoxes: true,  desc: 'You know the chorus… right? 1 in 7 words.' },
  hard:   { density: 25, minLen: 2, focus: 'any',     firstLetter: false, sizeBoxes: false, desc: 'Day-one fan. 1 in 4 words, no length clues.' },
  insane: { density: 40, minLen: 1, focus: 'any',     firstLetter: false, sizeBoxes: false, desc: 'You ARE the artist. 40% of the song is gone. 🔥' },
};
const GAPS_V = 2;      // gap-engine version: saved games from another version can't be restored
const MODE_LABEL = { type: '✍️ Type', choice: '🎯 Choose', listen: '✍️ Type' };
const PRESET_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', insane: 'Insane', custom: 'Custom' };

// split one word token into [prefix punctuation, word, suffix punctuation]
const TOKEN = /^([^\p{L}\p{N}']*)([\p{L}\p{N}'](?:.*[\p{L}\p{N}'])?)([^\p{L}\p{N}']*)$/u;

const EXPLICIT = /^(n[i1]gg(a|as|az|er|ers)|f+u+c+k\w*|motherf\w*|bitch\w*|shit\w*|bullshit|puss(y|ies)|ass(es|hole|holes)?|dick\w*|cunt\w*|cock\w*|whore\w*|hoes?|slut\w*|fag\w*|retard\w*)$/;
const isExplicit = core => EXPLICIT.test(norm(core));
// "fuckin'" → "f****n'": keep the first and last letter, hide the rest
const maskWord = core => core.replace(/^(\W*\w)(\w*)(\w)(\W*)$/u, (m, a, mid, z, tail) => a + '*'.repeat(Math.max(1, mid.length)) + z + tail);
function isEligible(core, inParen, o){
  const w = norm(core);
  if (!w) return false;
  if (o.clean !== false && isExplicit(core)) return false;      // 🧼 clean lyrics
  if (o.skipParens && inParen) return false;
  if (o.focus === 'small') return SMALL.has(w);
  const letters = (core.match(/[\p{L}\p{N}]/gu) || []).length;
  if (letters < o.minLen) return false;
  if (isFiller(core)) return false;                              // never hide an "oh-oh" (on any level)
  if (o.focus === 'content') return !SMALL.has(w);
  return true;
}

function parseLines(lines, o, force){
  const parsed = [], eligible = [];
  lines.forEach((ln, li) => {
    if (!ln.trim()){ parsed.push(null); return; }
    let inParen = false;
    const want = force ? new Set(force[li] || []) : null;
    parsed.push(ln.trim().split(/\s+/).map((raw, pos) => {
      if (raw.includes('(')) inParen = true;
      const wasParen = inParen;
      if (raw.includes(')')) inParen = false;
      const t = { raw, gap: false, line: li, pos };
      const m = raw.match(TOKEN);
      if (m){
        t.pre = m[1]; t.core = m[2]; t.suf = m[3];
        if (want){ const n = norm(t.core); if (want.has(n)){ want.delete(n); eligible.push(t); } }
        else if (isEligible(t.core, wasParen, o)) eligible.push(t);
      }
      return t;
    }));
  });
  return { parsed, eligible };
}

// =====================================================================
// lyrics & artwork sources (free, no API key)
// =====================================================================
const LRCLIB = 'https://lrclib.net/api';
function songFromLrclib(j){
  const base = { src: 'lrclib', id: String(j.id), title: j.trackName || j.name || 'Untitled', artist: j.artistName || '', album: j.albumName || '', duration: j.duration || 0, cover: '' };
  if (j.syncedLyrics){
    const { lines, times } = linesFromLRC(j.syncedLyrics);
    if (lines.some(Boolean)) return { ...base, lines, times };
  }
  return { ...base, lines: cleanLines(j.plainLyrics), times: null };
}
async function fetchSong(id){
  const r = await fetch(`${LRCLIB}/get/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error('Song not found');
  return songFromLrclib(await r.json());
}
const coverCache = new Map();
async function findCover(title, artist){
  const k = (artist + '|' + title).toLowerCase();
  if (coverCache.has(k)) return coverCache.get(k);
  let url = '';
  try {
    const r = await fetch(`https://itunes.apple.com/search?entity=song&limit=10&term=${encodeURIComponent(artist + ' ' + title)}`);
    const list = (await r.json()).results || [];
    // the real release: same artist + title, not a karaoke/cover/tribute version
    const nA = norm(String(artist).split(/[,&]/)[0]), nT = norm(String(title).replace(/\s*[([].*$/, ''));
    const fake = x => /karaoke|tribute|cover|instrumental|made famous|in the style/i.test((x.trackName || '') + ' ' + (x.collectionName || '') + ' ' + (x.artistName || ''));
    const hit = list.find(x => !fake(x) && norm(x.artistName || '').includes(nA) && norm(x.trackName || '').startsWith(nT.slice(0, 6)))
      || list.find(x => !fake(x) && norm(x.artistName || '').includes(nA))
      || list.find(x => !fake(x));
    url = (hit?.artworkUrl100 || '').replace('100x100bb', '600x600bb');
  } catch {}
  coverCache.set(k, url);
  return url;
}

// =====================================================================
// theme, views, nav
// =====================================================================
function applyTheme(t){
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.querySelector('meta[name=theme-color]').content = dark ? '#0d0e11' : '#f4f2ee';
}
applyTheme(store.get('theme2', 'dark'));      // dark for everyone (new key: older "light" choices start dark again)
$('themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next); store.set('theme2', next);
};

const VIEWS = ['play', 'setup', 'game', 'library', 'stats', 'room'];
let view = 'play';
function showView(v){
  if (view === 'game' && v !== 'game'){ pauseVideo(); saveProgress(); closeChoice(); }
  VIEWS.forEach(x => $('view-' + x).classList.toggle('hidden', x !== v));
  view = v;
  const navKey = (v === 'setup' || v === 'game' || v === 'room') ? 'play' : v;
  document.querySelectorAll('#mainNav button').forEach(b => b.classList.toggle('on', b.dataset.view === navKey));
  $('bar').classList.toggle('hidden', v !== 'game');
  document.body.classList.toggle('in-game', v === 'game');
  const cover = v === 'setup' ? SETUP.song?.cover : v === 'game' ? G.s?.cover : '';
  setBackdrop(cover);
  if (v === 'play') renderContinue();
  renderRoomBanner();
  if (v === 'library') renderLibrary();
  if (v === 'stats') renderStats();
  window.scrollTo(0, 0);
}
function setBackdrop(url){
  const b = $('backdrop');
  if (url){ b.style.backgroundImage = `url("${url}")`; b.classList.add('on'); }
  else b.classList.remove('on');
}
document.querySelectorAll('#mainNav button').forEach(b => b.onclick = () => showView(b.dataset.view));
$('brand').onclick = e => { e.preventDefault(); showView('play'); };

// =====================================================================
// home: search, quick picks, paste
// =====================================================================
// 🧪 fan tests: [artist, song, what fans call them]
const FAN_TESTS = [
  ['Playboi Carti', 'Sky', 'Carti'], ['Central Cee', 'Sprinter', 'Cench'], ['Drake', "God's Plan", 'Drake'],
  ['Travis Scott', 'FE!N', 'Travis'], ['Kendrick Lamar', 'Not Like Us', 'Kendrick'], ['Lil Uzi Vert', 'Just Wanna Rock', 'Uzi'],
  ['Ice Spice', 'Munch', 'Ice Spice'], ['Eminem', 'Rap God', 'Eminem'], ['Future', 'Mask Off', 'Future'],
  ['21 Savage', 'a lot', '21'], ['Juice WRLD', 'Lucid Dreams', 'Juice'], ['XXXTENTACION', 'SAD!', 'X'],
  ['Yeat', 'Get Busy', 'Yeat'], ['Ken Carson', 'ss', 'Ken Carson'], ['Gunna', 'fukumean', 'Gunna'],
  ['Don Toliver', 'No Idea', 'Don'], ['Metro Boomin', 'Superhero', 'Metro'], ['Lil Baby', 'Drip Too Hard', 'Lil Baby'],
  ['Tyler, The Creator', 'EARFQUAKE', 'Tyler'], ['Frank Ocean', 'Pink + White', 'Frank'], ['SZA', 'Kill Bill', 'SZA'],
  ['The Weeknd', 'Blinding Lights', 'Weeknd'], ['Sabrina Carpenter', 'Espresso', 'Sabrina'], ['Billie Eilish', 'BIRDS OF A FEATHER', 'Billie'],
  ['Doja Cat', 'Paint The Town Red', 'Doja'], ['Nicki Minaj', 'Super Bass', 'Nicki'], ['Dave', 'Starlight', 'Dave'],
  ['Stormzy', 'Vossi Bop', 'Stormzy'], ['Aitch', 'Taste (Make It Shake)', 'Aitch'], ['Lil Nas X', 'INDUSTRY BABY', 'Lil Nas X'],
  ['Post Malone', 'Sunflower', 'Post'], ['Kanye West', 'Stronger', 'Ye'], ['Jack Harlow', 'First Class', 'Jack Harlow'],
  ['Ed Sheeran', 'Shape of You', 'Ed Sheeran'], ['Ed Sheeran', 'Perfect', 'Ed Sheeran'], ['Playboi Carti', 'Magnolia', 'Carti'], ['Playboi Carti', 'Long Time - Intro', 'Carti']
];
const FAN_NICK = Object.fromEntries(FAN_TESTS.map(([a, , n]) => [norm(a), n]));
const fanName = artist => { const p = primaryArtist(artist || ''); return FAN_NICK[norm(p)] || p || 'this artist'; };
const BAITS = [
  a => `Only real ${a} fans pass this.`,
  a => `Fake ${a} fans fail this instantly 💀`,
  a => `If you can’t finish this, you’re not a real ${a} fan.`,
  a => `You’ve been mumbling ${a} for years. Time to find out.`,
  a => `Real ${a} fans don’t need the lyrics. Prove it.`,
  a => `${a} fans when they have to type the words: 🧍`,
  a => `Day-one ${a} fans only. Edit-watchers, go back to TikTok.`,
  a => `C2 English? ${a} says otherwise.`,
  a => `You know the ${a} beat. Do you know the words? 🤨`,
  a => `Your Spotify Wrapped says ${a}. Your score won’t.`,
  a => `Name one ${a} lyric. Go on. We’ll wait. ⏳`,
  a => `Singing ${a} in the shower ≠ knowing ${a} 🚿`,
  a => `This ${a} test has ended friendships. 💔`,
  a => `Bro said he’s a ${a} fan and got 12% 💀`,
  a => `Type what ${a} actually said, not what you thought you heard.`,
  a => `Your ${a} karaoke era ends today. 🎤`,
  a => `Mumble along to ${a} all you want. The gaps don’t lie.`,
  a => `${a} stans, this is your final exam. 📝`,
  a => `You’ve played ${a} 1,000 times. Show your receipts. 🧾`,
  a => `Real ${a} fans finish this in one try. 🎯`,
  a => `${a} in your bio? Prove it. 👀`,
  a => `The ${a} test your group chat needs. 📲`,
  a => `Screenshot your ${a} score or it didn’t happen. 📸`,
  a => `Fake ${a} fans are getting exposed today. 🚨`,
  a => `Think you know ${a}? The lyrics disagree.`,
  a => `Your ${a} aura is about to be tested. ✨`,
  a => `Bet you can’t finish one ${a} verse without a mistake. 😤`,
  a => `${a} fan or TikTok-edit listener? Find out. 🧐`,
  a => `No lyric sites. No excuses. Just you and ${a}. 🎧`,
  a => `Even day-one ${a} fans sweat on this one. 😰`,
  a => `${a} on repeat for years and still guessing the words? 😭`,
  a => `Send this ${a} test to the friend who “knows every word”. 😈`,
  a => `Lowest ${a} score in the group chat buys food. 🍔`,
  a => `You hum ${a}. Can you type ${a}? ⌨️`,
  a => `Certified ${a} fan or certified mumbler? 🫠`,
  a => `${a} lyrics hit different when you have to spell them. ✍️`,
  a => `If ${a} heard you sing this, it’s over. 💀`,
  a => `One song. Zero lyric sites. Pure ${a} knowledge. 🔥`
];
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
function deck(items){ let d = []; return () => { if (!d.length) d = shuffle(items.slice()); return d.pop(); }; }
const nextBaitLine = deck(BAITS);
const bait = artist => pickOne(BAITS)(fanName(artist));

// one tap → search → open the song straight away
async function fanTest(artist, song){
  const q = artist + ' ' + song;
  $('searchInput').value = q;
  await doSearch(q);
  document.querySelector('#searchResults .sr')?.click();
}
const savedCovers = store.get('covers2', {});
async function coverFor(title, artist){
  const k = (artist + '|' + title).toLowerCase();
  if (k in savedCovers) return savedCovers[k];
  const url = await findCover(title, artist);
  if (url){ savedCovers[k] = url; store.set('covers2', savedCovers); }
  return url;
}
const nextFanTest = deck(FAN_TESTS);
async function renderFanTests(){
  const box = $('quickPicks');
  const seen = new Set(), pick = [];
  while (pick.length < 6){ const f = nextFanTest(); if (!seen.has(f[1])){ seen.add(f[1]); pick.push(f); } }
  const cards = pick.map(([a, t]) => {
    const art = h('div', { class: 'fan-art' }, tile(t, savedCovers[(a + '|' + t).toLowerCase()] || ''));
    const card = h('button', { class: 'fan-test', onclick: () => fanTest(a, t) }, art, h('div', { class: 'fan-txt' }, h('b', { text: t }), h('span', { text: a })));
    return { card, art, a, t };
  });
  box.replaceChildren(...cards.map(c => c.card), h('button', { class: 'fan-more', title: 'More songs', 'aria-label': 'More songs', text: '🔀 More songs', onclick: renderFanTests }));
  for (const c of cards){                                   // fetch missing covers one by one (gentle on the API)
    if (c.art.querySelector('img')) continue;
    const url = await coverFor(c.t, c.a);
    if (url && c.art.isConnected) c.art.replaceChildren(tile(c.t, url));
  }
}
renderFanTests();

// hero: "Only real ___ fans pass this." rotating every few seconds
const nextHeroArtist = deck(FAN_TESTS);
function heroBait(){
  const [a, t, n] = nextHeroArtist();
  const txt = nextBaitLine()('\u0000');
  const [before, after] = txt.split('\u0000');
  $('heroBait').replaceChildren(before, h('button', { class: 'rot', type: 'button', text: n, title: `Take the ${n} fan test`, onclick: () => fanTest(a, t) }), after);
}
heroBait();
setInterval(() => {
  if (view !== 'play') return;
  $('heroBait').classList.add('out');
  setTimeout(() => { heroBait(); $('heroBait').classList.remove('out'); }, 260);
}, 3200);

let searchTimer = 0, searchSeq = 0;
$('searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2){ searchSeq++; $('searchResults').replaceChildren(); $('view-play').classList.remove('searching'); $('searchSpin').classList.add('hidden'); return; }
  searchTimer = setTimeout(() => doSearch(q), 450);
});
$('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter'){ clearTimeout(searchTimer); const q = e.target.value.trim(); if (q) doSearch(q); }
});

// Search = iTunes (ranked by popularity, with album art) → lyrics from LRCLIB when you pick a song.
// If iTunes is unavailable, fall back to searching LRCLIB directly.
const ITUNES = 'https://itunes.apple.com/search';
const primaryArtist = a => (String(a || '').split(/\s*(?:,|&|\/|\bfeat\.?\s|\bft\.?\s|\bx\s|\band\s|\bwith\s)\s*/i)[0] || '').trim() || String(a || '');
const cleanTitle = t => String(t || '')
  .replace(/\s*[([][^)\]]*\b(feat|ft|with|prod|remaster(ed)?|version|edit|live|mono|stereo|deluxe|bonus|explicit|clean|mix|from|lyrics?|audio|official)\b[^)\]]*[)\]]/gi, '')
  .replace(/\s+-\s+.*\b(remaster(ed)?|live|version|edit|mix)\b.*$/i, '').trim() || String(t || '');
const searchCache = new Map();

async function itunesSearch(q){
  const r = await fetch(`${ITUNES}?media=music&entity=song&limit=25&term=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('iTunes ' + r.status);
  const j = await r.json();
  const seen = new Set(), out = [];
  for (const x of j.results || []){
    if (x.kind && x.kind !== 'song') continue;
    const art = x.artworkUrl100 || '';
    const t = { title: x.trackName, artist: x.artistName, album: x.collectionName || '',
      duration: x.trackTimeMillis ? Math.round(x.trackTimeMillis / 1000) : 0,
      cover: art.replace('100x100bb', '600x600bb'), thumb: art.replace('100x100bb', '200x200bb'),
      year: (x.releaseDate || '').slice(0, 4) };
    const k = norm(cleanTitle(t.title)) + '|' + norm(primaryArtist(t.artist));
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}
async function lrclibSearch(q){
  const r = await fetch(`${LRCLIB}/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error('LRCLIB ' + r.status);
  return dedupe(await r.json()).map(j => ({ title: j.trackName, artist: j.artistName, album: j.albumName || '', duration: Math.round(j.duration || 0), cover: '', thumb: '', year: '', lyr: Promise.resolve(j), fromLyrics: true, raw: j }));
}

// how well a result matches what you typed: "trojan horse dave" → Dave (all words, nothing extra) beats Dave Eggar
const words = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9']+/).map(w => w.replace(/'/g, '')).filter(Boolean);
function matchScore(t, qWords){
  if (!qWords.length) return 0;
  const tw = new Set(words(cleanTitle(t.title))), aw = new Set(words(t.artist));
  const hit = qWords.filter(w => tw.has(w) || aw.has(w)).length;
  const artistMain = words(primaryArtist(t.artist));
  let s = hit / qWords.length * 10;
  if (artistMain.length && artistMain.every(w => qWords.includes(w))) s += 3;   // you named the artist
  if (tw.size && [...tw].every(w => qWords.includes(w))) s += 2;                 // you named the whole title
  return s;
}

// Apple (popular songs + covers) and the lyrics database (finds songs Apple misses) at the same time
async function combinedSearch(q){
  const [it, lr] = await Promise.allSettled([itunesSearch(q), lrclibSearch(q)]);
  const apple = it.status === 'fulfilled' ? it.value : [];
  const lyr = lr.status === 'fulfilled' ? lr.value : [];
  if (!apple.length && !lyr.length && it.status === 'rejected' && lr.status === 'rejected') throw new Error('Both searches failed');
  const key = t => norm(cleanTitle(t.title)) + '|' + norm(primaryArtist(t.artist));
  const byKey = new Map();
  apple.forEach(t => byKey.set(key(t), t));
  const all = [...apple];
  lyr.forEach(t => {
    const a = byKey.get(key(t));
    if (a){ if (!a.lyr && (!a.duration || !t.duration || Math.abs(a.duration - t.duration) <= 12)) a.lyr = t.lyr; return; }
    byKey.set(key(t), t); all.push(t);
  });
  const qWords = words(q);
  return all.map((t, i) => ({ t, s: matchScore(t, qWords) - i * 0.15 }))
    .sort((a, b) => b.s - a.s).map(x => x.t).slice(0, 12);
}

// best LRCLIB entry for a track: right length (±12 s), synced if possible
function pickBest(list, dur){
  let best = null, bs = -1e9;
  for (const j of list || []){
    if (j.instrumental || !(j.plainLyrics || j.syncedLyrics)) continue;
    const dd = dur && j.duration ? Math.abs(j.duration - dur) : 0;
    if (dd > 12) continue;
    const sc = quality(j) * 2 - dd;
    if (sc > bs){ bs = sc; best = j; }
  }
  return best;
}
function lyricsFor(t){
  return t.lyr ||= (async () => {
    const title = cleanTitle(t.title), prim = primaryArtist(t.artist);
    const tries = [
      `${LRCLIB}/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(prim)}`,
      `${LRCLIB}/search?q=${encodeURIComponent(title + ' ' + prim)}`,
      `${LRCLIB}/search?q=${encodeURIComponent(title + ' ' + t.artist)}`
    ];
    let failed = false;
    for (const url of tries){
      try { const r = await fetch(url); if (!r.ok){ failed = true; continue; } const best = pickBest(await r.json(), t.duration); if (best) return best; } catch { failed = true; }
    }
    if (failed){ t.lyr = null; return undefined; }   // network hiccup / rate limit: don't say "no lyrics", let a click try again
    return null;
  })();
}

async function doSearch(q){
  const seq = ++searchSeq;
  $('searchSpin').classList.remove('hidden');
  try {
    const key = q.toLowerCase();
    let list = searchCache.get(key);
    if (!list){
      list = await combinedSearch(q);
      searchCache.set(key, list);
    }
    if (seq !== searchSeq) return;
    renderResults(list);
  } catch (e){
    if (seq !== searchSeq) return;
    console.error(e);
    renderResults([], 'Could not reach the music services. Check your connection, or paste the lyrics yourself.');
  } finally {
    if (seq === searchSeq) $('searchSpin').classList.add('hidden');
  }
}
// LRCLIB is community-made: rank synced, properly-titled entries first and push junk like "hello adele" down
function quality(j){
  let q = 0;
  if (j.syncedLyrics) q += 2;
  if (/\p{Lu}/u.test(j.trackName || '')) q += 1;
  const a = norm(j.artistName), t = norm(j.trackName);
  if (a && t !== a && t.includes(a)) q -= 3;
  return q;
}
function dedupe(list){
  const best = new Map();
  list.forEach((j, i) => {
    if (j.instrumental || !(j.plainLyrics || j.syncedLyrics)) return;
    j._q = quality(j); j._i = i;
    const k = norm(j.trackName) + '|' + norm(j.artistName);
    const cur = best.get(k);
    if (!cur || j._q > cur._q) best.set(k, j);
  });
  return [...best.values()].sort((a, b) => (b._q - a._q) || (a._i - b._i)).slice(0, 12);
}
function lyricsBadge(badge, j){
  if (j === undefined){ badge.className = 'badge'; badge.textContent = '…'; return; }
  if (!j){ badge.className = 'badge none'; badge.textContent = 'NO LYRICS'; return; }
  badge.className = j.syncedLyrics ? 'badge synced' : 'badge';
  badge.textContent = j.syncedLyrics ? '⏱ SYNCED' : 'LYRICS';
}
// results replace the song cards right under the search bar (same card look), so they're always on screen
function renderResults(list, msg){
  const box = $('searchResults');
  $('view-play').classList.add('searching');
  if (!list.length){ box.replaceChildren(h('div', { class: 'empty', text: msg || 'No songs found. Try the artist + song name, or paste the lyrics yourself.' })); return; }
  box.replaceChildren(...list.map((t, i) => {
    const badge = h('span', { class: 'badge', text: i < 6 || t.lyr ? '…' : '' });
    const card = h('button', { class: 'fan-test sr', style: `animation-delay:${i * 25}ms`, onclick: () => openTrack(t, card, badge),
        title: [t.title, t.artist, t.album, t.year, t.duration ? fmtTime(t.duration) : ''].filter(Boolean).join(' · ') },
      h('div', { class: 'fan-art' }, tile(t.title, t.thumb)),
      h('div', { class: 'fan-txt' }, h('b', { text: t.title }), h('span', { text: [t.artist, t.year].filter(Boolean).join(' · ') }), badge));
    // check lyrics for the top results in the background so the badges fill in
    if (i < 6 || t.lyr) lyricsFor(t).then(j => lyricsBadge(badge, j));
    // songs found only in the lyrics database: try to fetch their album art
    if (!t.thumb && t.fromLyrics && i < 4) findCover(t.title, primaryArtist(t.artist)).then(url => {
      if (!url) return;
      t.cover = url; t.thumb = url.replace('600x600bb', '200x200bb');
      card.querySelector('.tile')?.replaceWith(tile(t.title, t.thumb));
    });
    return card;
  }));
  revealResults();
}
// if the first row of results is below the fold (or under the phone keyboard), slide the search bar up under the nav
function revealResults(){
  if (view !== 'play') return;
  const first = $('searchResults').firstElementChild;
  if (!first) return;
  const visibleH = window.visualViewport?.height || innerHeight;
  if (first.getBoundingClientRect().bottom <= visibleH - 12) return;
  const navH = document.querySelector('.nav')?.getBoundingClientRect().height || 0;
  scrollTo({ top: scrollY + document.querySelector('.search').getBoundingClientRect().top - navH - 14, behavior: 'smooth' });
}
async function openTrack(t, card, badge){
  card.classList.add('loading');
  badge.className = 'badge'; badge.textContent = 'FINDING LYRICS…';
  const j = await lyricsFor(t);
  card.classList.remove('loading');
  lyricsBadge(badge, j);
  if (!j){ toast(`No lyrics found for “${t.title}”. Try another version, or paste them yourself.`); return; }
  const song = songFromLrclib(j);
  song.title = t.title || song.title;
  song.artist = t.artist || song.artist;
  song.album = t.album || song.album;
  song.duration = t.duration || song.duration;
  song.cover = t.cover || '';
  openSetup(song);
}

$('pasteToggle').onclick = () => { $('pasteCard').classList.toggle('hidden'); if (!$('pasteCard').classList.contains('hidden')) $('pasteTitle').focus(); };
$('pasteGo').onclick = () => {
  const lines = cleanLines($('pasteText').value);
  if (!lines.length){ toast('Paste some lyrics first.'); return; }
  openSetup({ src: 'paste', title: $('pasteTitle').value.trim() || 'My song', artist: $('pasteArtist').value.trim(), lines, times: null, cover: '' });
};

// "continue where you left off"
function renderContinue(){
  if (MP.code){ renderRoomCard(); return; }
  const box = $('continueCard');
  let title, sub, go;
  if (G.active && !G.done){
    title = G.s.title;
    sub = `${G.lastChance ? '❤️ Last chance' : 'Try ' + G.tryNo} · ${lockedCount()} / ${unitCount()} correct`;
    go = () => { showView('game'); if (G.phase !== 'playing') showReady(); };
  } else {
    const p = store.get('progress', null);
    if (p && p.gv !== GAPS_V){ store.del('progress'); box.classList.add('hidden'); return; }   // saved by an older gap engine: its gaps don't match any more
    if (!p || !p.s){ box.classList.add('hidden'); return; }
    title = p.s.title;
    sub = `${p.lastChance ? '❤️ Last chance' : 'Try ' + (p.tryNo || 1)} · ${p.filled || 0} / ${p.total || '?'} correct · ${timeAgo(new Date(p.at))}`;
    go = () => startGame(p.s, p);
  }
  box.replaceChildren(
    tile(title, G.active ? G.s.cover : store.get('progress', {}).s?.cover),
    h('div', { class: 'c-info' }, h('small', { text: 'Continue where you left off' }), h('b', { text: title }), h('small', { text: sub })),
    h('button', { class: 'btn primary', text: 'Continue →', onclick: go }),
    h('button', { class: 'x', title: 'Dismiss', 'aria-label': 'Dismiss', text: '✕', onclick: () => { store.del('progress'); if (G.active){ G.active = false; destroyPlayer(); } box.classList.add('hidden'); } }));
  box.classList.remove('hidden');
}

// =====================================================================
// setup screen
// =====================================================================
// music: 'audio' | 'video' | 'off'; pick = the video chosen per music tab; custom = pasted or saved link
const SETUP = { song: null, preset: 'medium', mode: 'type', opts: null, offset: 0, music: 'audio', yt: '', pick: {}, custom: '', cands: null };

function openSetup(song, extra = {}){
  const prefs = store.get('prefs', {});
  SETUP.song = song;
  SETUP.offset = extra.offset || 0;
  SETUP.preset = prefs.preset || 'medium';
  SETUP.mode = prefs.mode === 'choice' ? 'choice' : 'type';
  SETUP.pauseLines = !!prefs.pauseLines || prefs.mode === 'listen';
  SETUP.oneShot = !!prefs.oneShot;
  SETUP.opts = { ...PRESETS.medium, skipParens: true, ...(prefs.opts || {}), instant: true };
  if (SETUP.preset !== 'custom') Object.assign(SETUP.opts, PRESETS[SETUP.preset]);

  $('setupTitle').textContent = song.title;
  $('setupArtist').textContent = [song.artist, song.album].filter(Boolean).join(' · ') || 'Your own lyrics';
  $('setupBait').textContent = song.artist ? '🧪 ' + bait(song.artist) : '';
  const words = song.lines.join(' ').split(/\s+/).filter(Boolean).length;
  $('setupBadges').replaceChildren(
    song.times ? h('span', { class: 'badge synced', text: '⏱ SYNCED LYRICS' }) : h('span', { class: 'badge', text: 'LYRICS' }),
    song.duration ? h('span', { class: 'badge', text: fmtTime(song.duration) }) : null,
    h('span', { class: 'badge', text: `${words} WORDS` }));
  $('setupCover').replaceChildren(tile(song.title, song.cover, 'lg'));
  if (!song.cover && song.src !== 'paste'){
    findCover(song.title, song.artist).then(url => {
      if (!url || SETUP.song !== song) return;
      song.cover = url;
      $('setupCover').replaceChildren(tile(song.title, url, 'lg'));
      if (view === 'setup') setBackdrop(url);
    });
  }
  $('lyricsPreview').replaceChildren(...song.lines.filter(Boolean).slice(0, 12).map(l => h('div', { text: l })));
  SETUP.music = prefs.music === 'off' ? 'off' : 'audio';
  SETUP.custom = SETUP.yt = extra.yt || '';
  SETUP.pick = {};
  SETUP.cands = null;
  $('ytManual').open = false;
  $('ytInput').value = extra.yt ? 'https://youtu.be/' + extra.yt : '';
  SETUP.loading = false;
  if (SETUP.music !== 'off') loadMusic(song); else renderMusic();
  $('ytFind').href = `https://www.youtube.com/results?search_query=${encodeURIComponent([song.artist, song.title, 'lyrics'].filter(Boolean).join(' '))}`;
  renderSetupControls();
  showView('setup');
}

function renderSetupControls(){
  const o = SETUP.opts;
  $('presetSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === SETUP.preset));
  $('modeSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === SETUP.mode));
  $('presetDesc').textContent = SETUP.preset === 'custom' ? 'Custom settings (see below).' : PRESETS[SETUP.preset].desc;
  $('density').value = o.density; $('densVal').textContent = o.density;
  $('minLen').value = o.minLen; $('minVal').textContent = o.minLen;
  $('focusSel').value = o.focus;
  $('optFirst').checked = !!o.firstLetter; $('optSize').checked = !!o.sizeBoxes;
  $('optParens').checked = !!o.skipParens;
  $('optClean').checked = o.clean !== false;
  // "pause after each line" needs timed lyrics + music
  const canPause = !!(SETUP.song?.times && SETUP.music !== 'off');
  $('optPause').disabled = !canPause;
  $('optPause').checked = canPause && SETUP.pauseLines;
  $('pauseNote').textContent = !SETUP.song?.times ? '(needs synced lyrics ⏱)' : SETUP.music === 'off' ? '(needs music)' : '(easier: the song waits for you)';
}
$('optPause').onchange = e => { SETUP.pauseLines = e.target.checked; };
$('readLyricsBtn').onclick = () => {
  const song = SETUP.song;
  openModal(
    h('h2', { text: '📖 ' + song.title }),
    h('p', { class: 'muted', text: song.artist || '' }),
    h('div', { class: 'read-lyrics' }, song.lines.map(l => l ? h('div', { text: l }) : h('div', { class: 'gap-line' }))),
    h('p', { class: 'hint', text: 'Tip: select any words to translate them once the game starts (🌍).' }),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', text: 'Got it, close', onclick: () => closeModal() })));
};
$('presetSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  SETUP.preset = b.dataset.p; Object.assign(SETUP.opts, PRESETS[SETUP.preset]); renderSetupControls();
});
$('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  SETUP.mode = b.dataset.m; renderSetupControls();
});
const customize = (key, val) => { SETUP.opts[key] = val; SETUP.preset = 'custom'; renderSetupControls(); };
$('density').oninput = e => customize('density', +e.target.value);
$('minLen').oninput = e => customize('minLen', +e.target.value);
$('focusSel').onchange = e => customize('focus', e.target.value);
$('optFirst').onchange = e => customize('firstLetter', e.target.checked);
$('optSize').onchange = e => customize('sizeBoxes', e.target.checked);
$('optParens').onchange = e => { SETUP.opts.skipParens = e.target.checked; };
$('optClean').onchange = e => { SETUP.opts.clean = e.target.checked; };
$('setupBack').onclick = () => showView('play');

function ytId(url){
  url = String(url || '').trim();
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(url) ? url : '';
}

// ---------- YouTube: find the song automatically ----------
// Uses the official YouTube Data API if you add a free key here (most reliable, 100 searches/day),
// otherwise free public Piped servers. If all fail you can still paste a link by hand.
const YT_KEY = '';
const PIPED = ['https://api.piped.private.coffee', 'https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://pipedapi.leptons.xyz'];
const timeoutSignal = ms => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
const isoDur = s => { const m = String(s).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
const decodeHtml = s => new DOMParser().parseFromString(s, 'text/html').documentElement.textContent;
const ytCache = new Map();

function ytSearch(q, filter = 'videos'){
  const ck = filter + '|' + q;
  if (ytCache.has(ck)) return ytCache.get(ck);
  const p = (async () => {
    if (YT_KEY && filter === 'videos'){
      try {
        const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=10&q=${encodeURIComponent(q)}&key=${YT_KEY}`);
        if (r.ok){
          const items = ((await r.json()).items || []).map(i => ({ id: i.id.videoId, title: decodeHtml(i.snippet.title), channel: i.snippet.channelTitle, duration: 0 }));
          try {
            const r2 = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${items.map(i => i.id).join(',')}&key=${YT_KEY}`);
            const d = new Map(((await r2.json()).items || []).map(v => [v.id, isoDur(v.contentDetails.duration)]));
            items.forEach(i => i.duration = d.get(i.id) || 0);
          } catch {}
          if (items.length) return items;
        }
      } catch (e){ console.warn('YouTube API failed', e); }
    }
    for (const base of [...PIPED]){
      try {
        const r = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=${filter}`, { signal: timeoutSignal(7000) });
        if (!r.ok) continue;
        const items = ((await r.json()).items || [])
          .filter(i => i.type === 'stream' && /v=[\w-]{11}/.test(i.url) && !i.isShort && i.duration !== -1)
          .map(i => ({ id: i.url.match(/v=([\w-]{11})/)[1], title: i.title || '', channel: i.uploaderName || '', duration: i.duration > 0 ? i.duration : 0 }));
        if (items.length){ PIPED.splice(PIPED.indexOf(base), 1); PIPED.unshift(base); return items; }   // remember the server that works
      } catch {}
    }
    throw new Error('No YouTube search available');
  })();
  ytCache.set(ck, p);
  p.catch(() => ytCache.delete(ck));
  return p;
}
function ytKind(c){
  const t = c.title.toLowerCase();
  if (/\b(official )?audio\b|visuali[sz]er/.test(t) || / - topic$/i.test(c.channel)) return 'audio';
  if (/lyric/.test(t)) return 'lyric';
  if (/official (music )?video|music video|\(official\)|\bm\/?v\b/.test(t)) return 'video';
  return 'other';
}
const KIND_LABEL = { audio: 'Official audio', lyric: 'Lyric video', video: 'Music video', other: 'Video' };
function rankFor(cands, kind, dur, songTitle){
  const want = kind === 'audio' ? { audio: 30, lyric: 16, other: 6, video: 0 } : { video: 30, other: 12, lyric: 8, audio: 2 };
  const off = new RegExp('\\b(cover|karaoke|instrumental|8d|sped|slowed|reverb|nightcore|remix|reaction|live|tutorial|piano)\\b', 'i');
  const score = c => {
    let s = want[c.kind] - c.i * 1.5;
    if (dur && c.duration) s -= Math.min(30, Math.abs(c.duration - dur) / (kind === 'audio' ? 2 : 6));
    if (off.test(c.title) && !off.test(songTitle)) s -= 40;
    return s;
  };
  return [...cands].sort((a, b) => score(b) - score(a));
}

async function loadMusic(song){
  SETUP.cands = null;
  SETUP.loading = true;
  renderMusic();
  const q = [primaryArtist(song.artist), cleanTitle(song.title)].filter(Boolean).join(' ');
  try {
    const [songs, vids] = await Promise.allSettled([ytSearch(q, 'music_songs'), ytSearch(q, 'videos')]);
    const seen = new Set();
    const list = [...(songs.value || []).map(c => ({ ...c, topic: true })), ...(vids.value || [])].filter(c => !seen.has(c.id) && seen.add(c.id));
    if (!list.length) throw new Error('No music found');
    if (SETUP.song !== song) return;
    SETUP.cands = list.map((c, i) => ({ ...c, i, kind: c.topic ? 'audio' : ytKind(c) }));
  } catch (e){
    if (SETUP.song !== song) return;
    console.warn(e);
    SETUP.cands = 'error';
    $('ytManual').open = true;
  }
  SETUP.loading = false;
  SETUP.yt = SETUP.custom || autoPick(SETUP.music);
  renderMusic();
}
function rankedCands(kind){
  if (!Array.isArray(SETUP.cands)) return [];
  // only keep videos whose title contains the song name (drops other songs by the same artist)
  const want = norm(cleanTitle(SETUP.song.title));
  const match = SETUP.cands.filter(c => !want || norm(c.title).includes(want));
  // never use lyric videos: they show the answers on screen
  const pool = match.length ? match : SETUP.cands;
  const noLyrics = pool.filter(c => c.kind !== 'lyric');
  return rankFor(noLyrics.length ? noLyrics : pool, kind, SETUP.song.duration, SETUP.song.title);
}
const autoPick = k => SETUP.pick[k] || rankedCands(k)[0]?.id || SETUP.custom || '';
function setMusic(k){
  SETUP.music = k;
  if (k !== 'off'){
    if (SETUP.cands === null && !SETUP.loading) loadMusic(SETUP.song);
    else SETUP.yt = autoPick(k);
  }
  renderMusic();
  renderSetupControls();
}
function renderMusic(){
  const k = SETUP.music;
  $('musicSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('musicHint').textContent = k === 'off'
    ? '🔇 No music: fill in the gaps by yourself and press “End try” when you’re done.'
    : '🎧 The song plays in a small music player. The version below is picked automatically; tap another one to change it.';
  const box = $('ytPicks');
  $('ytManual').classList.toggle('hidden', k === 'off');
  if (k === 'off'){ box.replaceChildren(); return; }
  if (SETUP.cands === null){ box.replaceChildren(h('div', { class: 'yt-loading' }, h('span', { class: 'spinner' }), 'Finding the song on YouTube…')); return; }
  const list = rankedCands(k).slice(0, 3);
  if (SETUP.yt && !list.some(c => c.id === SETUP.yt)) list.unshift({ id: SETUP.yt, title: 'Your YouTube link', channel: '', kind: 'other', duration: 0 });
  if (!list.length){
    box.replaceChildren(h('p', { class: 'hint', text: 'Couldn’t search YouTube automatically right now. Paste a link below (press “Find ↗” to search YouTube).' }));
    return;
  }
  box.replaceChildren(...list.map(c => h('button', { class: 'yt-pick' + (c.id === SETUP.yt ? ' on' : ''), type: 'button',
      onclick: () => { SETUP.yt = SETUP.pick[k] = c.id; renderMusic(); } },
    h('img', { src: `https://i.ytimg.com/vi/${c.id}/mqdefault.jpg`, alt: '', loading: 'lazy' }),
    h('div', { class: 'yi' },
      h('div', { class: 'yt-t', text: c.title }),
      h('div', { class: 'yt-s', text: [KIND_LABEL[c.kind], c.channel, c.duration ? fmtTime(c.duration) : ''].filter(Boolean).join(' · ') })))));
}
$('musicSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMusic(b.dataset.k); });
$('ytInput').addEventListener('input', () => {
  const id = ytId($('ytInput').value);
  if (!id) return;
  SETUP.music = 'audio';
  SETUP.yt = SETUP.custom = SETUP.pick.audio = id;
  renderMusic(); renderSetupControls();
});

$('startBtn').onclick = () => {
  const song = SETUP.song;
  const raw = $('ytInput').value.trim();
  if (raw && !ytId(raw) && SETUP.music !== 'off'){ toast('That doesn’t look like a YouTube link.'); $('ytManual').open = true; $('ytInput').focus(); return; }
  const yt = SETUP.music === 'off' ? '' : SETUP.yt;
  if (SETUP.music !== 'off' && !yt){
    if (SETUP.cands === null){ toast('Still looking for the song… one second.'); return; }
    toast('No music found for this song: choose “🔇 No music” or paste a YouTube link.');
    $('ytManual').open = true;
    return;
  }
  store.set('prefs', { preset: SETUP.preset, mode: SETUP.mode, opts: SETUP.opts, music: SETUP.music, pauseLines: SETUP.pauseLines, oneShot: SETUP.oneShot });
  const { opts } = SETUP;
  const alts = Array.isArray(SETUP.cands) ? rankedCands('audio').slice(0, 4).map(c => c.id) : null;
  startGame({
    src: song.src, id: song.id || '', title: song.title, artist: song.artist || '', cover: song.cover || '', duration: song.duration || 0,
    lines: song.lines, times: song.times, preset: SETUP.preset, mode: SETUP.mode,
    opts: { density: opts.density, minLen: opts.minLen, focus: opts.focus, firstLetter: opts.firstLetter, sizeBoxes: opts.sizeBoxes, skipParens: opts.skipParens, clean: opts.clean !== false, instant: true },
    seed: newSeed(), yt, music: yt ? 'audio' : 'off', pauseLines: !!(SETUP.pauseLines && yt && song.times), oneShot: SETUP.mode === 'choice' && SETUP.oneShot, ytAlts: alts, offset: SETUP.offset
  });
};

// =====================================================================
// game: Ready → Try 1, 2, 3… → ❤️ Last chance → final results
// During a try the song only plays/pauses (no rewinding). Correct words
// turn green by themselves and stay green in the next tries.
// =====================================================================
const G = {
  s: null, parsed: [], gaps: [], lineEls: [], solEls: [], lineGaps: [],
  hints: 0, session: '', active: false, done: false, bonus: false, played: false,
  focus: null, wait: -1, passed: new Set(), cur: -1, badYt: new Set(),
  phase: 'ready', tryNo: 1, tries: [], lastChance: false, rewinds: 0, tryStart: null, heard: false, xpTotal: 0
};
const head = g => g.primary || g;                         // copies of a chorus word share one "head"
const units = () => G.gaps.filter(g => !g.primary);       // what we count: each hidden word once
const unitCount = () => units().length;
const lockedCount = () => units().filter(g => g.locked).length;
const filledCount = lockedCount;
const REWINDS = 3, REWIND_SECONDS = 20;

function buildPool(parsed){
  const seen = new Set(), pool = [];
  parsed.forEach(toks => toks && toks.forEach(t => {
    if (!t.core) return;
    const n = norm(t.core);
    if (n.length < 2 || seen.has(n) || isFiller(t.core)) return;
    seen.add(n); pool.push(t.core);
  }));
  return pool;
}
function makeOptions(answer, pool, rand){
  const an = norm(answer), L = answer.length;
  let cands = pool.filter(w => norm(w) !== an && Math.abs(w.length - L) <= 2);
  if (cands.length < 3) cands = pool.filter(w => norm(w) !== an);
  shuffle(cands, rand);
  const picked = [], seen = new Set([an]);
  for (const w of cands){ const n = norm(w); if (seen.has(n)) continue; seen.add(n); picked.push(w); if (picked.length === 3) break; }
  const cap = /^\p{Lu}/u.test(answer);
  const fix = w => cap ? w[0].toUpperCase() + w.slice(1) : (w !== 'I' && !/^I'/.test(w) ? w[0].toLowerCase() + w.slice(1) : w);
  return shuffle([answer, ...picked.map(fix)], rand);
}

// settings saved by older versions of the app
function normalizeSettings(s){
  s = { ...s };
  if (s.mode === 'listen'){ s.mode = 'type'; s.pauseLines = true; }
  if (s.mode !== 'choice') s.mode = 'type';
  if (s.ytAlts && !Array.isArray(s.ytAlts)) s.ytAlts = s.ytAlts.audio || [];
  s.music = s.yt ? 'audio' : 'off';
  s.pauseLines = !!(s.pauseLines && s.yt && s.times);
  s.opts = { ...s.opts, instant: true, clean: s.opts?.clean !== false };
  s.oneShot = !!(s.oneShot && s.mode === 'choice');
  return s;
}

// Group lines that say the same thing (a chorus sung 3 times, or almost the same line)
// so a word is hidden in only ONE of the copies: it counts once and can't be copied
// from a copy you haven't heard yet (future lines are blurred while the song plays).
function lineFamilies(parsed){
  const fam = new Array(parsed.length).fill(-1), reps = [];
  parsed.forEach((toks, li) => {
    if (!toks) return;
    const set = new Set(toks.map(t => t.core ? norm(t.core) : '').filter(Boolean));
    if (set.size){
      for (const r of reps){
        const inter = [...set].filter(w => r.set.has(w)).length, union = new Set([...set, ...r.set]).size;
        // one-word lines ("Baby!") only match the very same word
        if (set.size >= 2 ? inter / union >= 0.6 : inter === union){ fam[li] = r.id; return; }
      }
    }
    reps.push({ id: reps.length, set });
    fam[li] = reps.length - 1;
  });
  return fam;
}

// The level's % is what you REALLY type: a chorus sung 4 times is one line here (its words
// count once), so a song full of repeats can't turn "25%" into "fill the chorus once and done".
// Every different line gets one gap before any gets a second, gaps on the same line avoid
// sitting next to each other, and a hidden word is linked in every copy of its line
// (answer it once, all copies turn green; see lineFamilies).
function pickSpread(eligible, density, rand, parsed){
  const fam = lineFamilies(parsed);
  const famLines = new Map();                   // family → its lines (all copies of a chorus line)
  fam.forEach((f, li) => { if (f < 0) return; if (!famLines.has(f)) famLines.set(f, []); famLines.get(f).push(li); });
  const words = li => (parsed[li] || []).filter(t => t.core);
  const countIn = (li, k) => words(li).filter(t => norm(t.core) === k).length;
  const gapsIn = new Map();                     // line → visible gaps so far
  const cap = li => Math.max(1, Math.floor(words(li).length / 2));   // a line is never more than half gaps
  const used = new Map();                       // family → words already hidden in it
  // the words you can be asked: each different line once (the first time it's sung)
  const cands = new Map();
  eligible.forEach(t => {
    const f = fam[t.line];
    if (!cands.has(f)) cands.set(f, { line: t.line, toks: [] });
    if (cands.get(f).line === t.line) cands.get(f).toks.push(t);
  });
  const lines = [...cands.entries()].map(([f, c]) => ({ f, toks: shuffle(c.toks, rand) }));
  const total = lines.reduce((n, l) => n + l.toks.length, 0);
  let left = Math.max(1, Math.round(total * density / 100));       // words to type (each counts once)
  const fits = (t, f, k) => {
    if (countIn(t.line, k) > 1) return false;                 // "timeless, timeless, timeless": never hide those
    return famLines.get(f).every(li => (gapsIn.get(li) || 0) + countIn(li, k) <= cap(li));
  };
  while (left > 0){
    let progress = false;
    for (const { f, toks } of shuffle([...lines], rand)){
      if (left <= 0) break;
      if (!used.has(f)) used.set(f, new Set());
      const taken = used.get(f);
      const free = toks.filter(t => !t.gap && !taken.has(norm(t.core)) && fits(t, f, norm(t.core)));
      if (!free.length) continue;
      const near = toks.filter(t => t.gap).map(t => t.pos);
      const pick = free.find(t => !near.some(p => Math.abs(p - t.pos) <= 1)) || free[0];
      // hide this word in EVERY copy of the line (linked: answer once, all copies turn green)
      const k = norm(pick.core);
      taken.add(k);
      for (const li of famLines.get(f)) for (const t of words(li)) if (norm(t.core) === k){
        t.gap = true; t.unit = f + '|' + k;
        gapsIn.set(li, (gapsIn.get(li) || 0) + 1);
      }
      left--;
      progress = true;
    }
    if (!progress) break;
  }
}

function startGame(s, restore, mp){
  s = normalizeSettings(s);
  const { parsed, eligible } = parseLines(s.lines, s.opts, s.force);
  if (!eligible.length){ toast('No words to hide with these settings. Try a lower minimum length.'); return false; }
  const rand = rng(s.seed);
  if (s.force) eligible.forEach(t => t.gap = true);
  else pickSpread(eligible, s.opts.density, rand, parsed);
  const pool = s.mode === 'choice' ? buildPool(parsed) : null;

  destroyPlayer();
  closeModal(true);
  Object.assign(G, {
    s, parsed, gaps: [], lineEls: [], solEls: [], lineGaps: [],
    hints: restore?.hints || 0,
    session: restore?.session || (Date.now().toString(36) + newSeed()),
    active: true, done: false, bonus: false, played: !!restore?.played,
    focus: null, wait: -1, passed: new Set(), cur: -1, badYt: new Set(),
    phase: 'ready', tryNo: restore?.tryNo || 1, tries: restore?.tries || [],
    lastChance: false, rewinds: 0,
    tryStart: null, heard: false, xpTotal: restore?.xpTotal || 0, pendingStart: false, finishing: false,
    mp: mp || null, mpFinished: false, mpHid: false
  });

  const box = $('lyrics'), solBox = $('solution');
  box.replaceChildren(); solBox.replaceChildren();
  const firstOfUnit = new Map();
  parsed.forEach((toks, li) => {
    const d = h('div', { class: 'line' }), sd = h('div', { class: 'line' });
    G.lineGaps.push([]);
    if (!toks){ d.className = sd.className = 'line blank'; }
    else toks.forEach(t => {
      if (!t.gap){
        const shown = s.opts.clean !== false && t.core && isExplicit(t.core) ? (t.pre || '') + maskWord(t.core) + (t.suf || '') : t.raw;
        d.append(shown + ' '); sd.append(shown + ' '); return;
      }
      const g = { i: G.gaps.length, line: li, answer: t.core, locked: false, hinted: false, xp: false, wrong: null, lockTry: 0, twins: [] };
      const p = t.unit && firstOfUnit.get(t.unit);
      if (p){ g.primary = p; p.twins.push(g); } else if (t.unit) firstOfUnit.set(t.unit, g);
      if (s.mode === 'choice') g.options = p ? p.options : makeOptions(t.core, pool, rand);
      if (t.pre) sd.append(t.pre);
      g.sol = h('span', { class: 'sol miss', text: t.core });
      sd.append(g.sol, (t.suf || '') + ' ');
      const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', autocorrect: 'off', 'aria-label': 'Missing word' });
      const w = s.mode === 'choice' ? Math.max(...g.options.map(o => o.length)) : (s.opts.sizeBoxes ? t.core.length : 8);
      inp.style.width = (Math.max(3, w) + 1.6) + 'ch';
      if (s.opts.firstLetter) inp.placeholder = t.core[0];
      if (s.mode === 'choice'){ inp.readOnly = true; inp.setAttribute('inputmode', 'none'); inp.classList.add('choice'); if (!s.opts.firstLetter) inp.placeholder = '▾'; }
      g.input = inp; g.ph = inp.placeholder;
      inp.addEventListener('focus', () => { G.focus = g; if (s.mode === 'choice' && !g.locked) openChoice(g); });
      inp.addEventListener('click', () => { if (s.mode === 'choice' && !g.locked) openChoice(g); });
      inp.addEventListener('blur', () => { if (g.input.value.trim().length >= g.answer.length) commitWrong(g); setTimeout(() => { if (G.choiceFor === g && document.activeElement !== inp) closeChoice(); }, 150); });
      inp.addEventListener('input', () => onGapInput(g));
      inp.addEventListener('keydown', e => onGapKey(e, g));
      d.append(h('span', { class: 'gap' }, t.pre || '', inp, (t.suf || '') + ' '));
      G.gaps.push(g); G.lineGaps[li].push(g);
    });
    if (toks){
      // after the game, a small ▶ on each line plays it (clicking/selecting the text only selects it)
      const play = () => h('button', { class: 'lp', type: 'button', title: 'Play this line', 'aria-label': 'Play this line', text: '▶',
        onclick: e => { e.stopPropagation(); seekLine(li); } });
      d.append(play()); sd.append(play());
    }
    box.append(d); solBox.append(sd);
    G.lineEls.push(d); G.solEls.push(sd);
  });

  if (restore){
    G.gaps.forEach((g, i) => {
      if (restore.hinted?.[i]) g.hinted = true;
      if (restore.locked?.[i]){ lockGap(g, true); g.xp = true; g.lockTry = restore.locked[i]; }
      else if (restore.answers?.[i]) g.input.value = restore.answers[i];
    });
  }
  G.reach = restore?.reach ?? -1;
  G.optionsDone = s.mode !== 'choice';
  G.optionsReady = s.mode === 'choice'
    ? Promise.race([upgradeOptions(), new Promise(r => setTimeout(r, 6000))]).then(() => { G.optionsDone = true; })
    : null;
  applyReach();

  $('gameTitle').textContent = s.title;
  $('gameArtist').textContent = [s.artist, PRESET_LABEL[s.preset]].filter(Boolean).join(' · ');
  $('gameCover').replaceChildren(tile(s.title, s.cover, 'md'));
  $('modePill').textContent = (s.mode === 'choice' ? '🎯 Choose' : '✍️ Type') + (s.oneShot ? ' · ⚡' : '') + (s.pauseLines ? ' · ⏸' : '');
  $('saveSongBtn').classList.toggle('hidden', s.src === 'practice');
  $('shareBtn').classList.toggle('hidden', s.src === 'practice' || !!mp);
  ['printBtn', 'restartBtn'].forEach(id => $(id).classList.toggle('hidden', !!mp));
  ['podiumBtn', 'lobbyBtn'].forEach(id => $(id).classList.add('hidden'));
  setTransOpen(false);
  $('newBtn').replaceChildren(mp ? '🚪 ' : '♪ ', h('span', { class: 'lbl', text: mp ? 'Leave room' : 'New song' }));
  mpGameLayout();
  refreshSaveBtn();
  $('keysHint').textContent = (s.mode === 'choice' ? 'Tap a gap and press 1–4 to choose · a wrong pick is final' : 'Tab/Enter → next gap · Shift+Tab → back · a wrong word you leave is final')
    + ' · ⌨️ Alt+1 play/pause · Alt+2 hint · Alt+3 rewind · Alt+4 end try';

  setupPlayer(s.yt);
  showTab('challenge');
  showView('game');
  if (!s.cover && s.src !== 'paste' && s.src !== 'practice'){
    findCover(s.title, s.artist).then(url => {
      if (!url || G.s !== s) return;
      s.cover = url; $('gameCover').replaceChildren(tile(s.title, url, 'md'));
      if (view === 'game') setBackdrop(url);
    });
  }
  setInputsEnabled(false);
  updateHud();
  saveProgress();
  showReady();
  return true;
}

// ---------- HUD ----------
function updateHud(){
  const total = unitCount(), ok = lockedCount();
  const playingPhase = G.phase === 'playing';
  $('progress').textContent = `${ok} / ${total} correct`;
  $('pfill').style.width = (total ? ok / total * 100 : 0) + '%';
  $('hintVal').textContent = G.hints;
  $('tryPill').textContent = G.done ? '🏁 Finished' : `🔁 Try ${G.tryNo}`;
  $('hintBtn').classList.toggle('hidden', !playingPhase);
  $('endTryBtn').classList.toggle('hidden', !playingPhase);
  $('contBtn').classList.toggle('hidden', !(playingPhase && G.wait >= 0));
  // solo: skip/scrub any time · multiplayer: locked until the game is over
  const canSeek = freeSeek() && (playingPhase || G.done);
  $('rewBtn').classList.toggle('hidden', !canSeek);
  $('npRew').classList.add('hidden');
  $('rewBtn').textContent = '⟲ 5s'; $('rewBtn').disabled = false;
  $('npSkip').classList.toggle('hidden', !(G.s?.yt && freeSeek()));
  $('npSkip').querySelectorAll('button').forEach(b => { b.disabled = !canSeek; });
  $('lineBtn').classList.toggle('hidden', !(G.done && G.s.times));
  $('npProg').classList.toggle('scrub', canSeek);
  $('npLock').textContent = G.done ? 'Free play: tap the bar or any line' : G.mp ? '🔒 No skipping in multiplayer' : canSeek ? 'Skip or drag the bar to move' : '';
  $('tabSolution').textContent = G.done ? '👁 Solution' : '🔒 Solution';
  $('lyrics').classList.toggle('frozen', !playingPhase && !G.done);
  $('transBtn').classList.toggle('hidden', !G.done);           // 🌍 only once the game is over
  if (!G.done && !$('transPanel').classList.contains('hidden')) setTransOpen(false);
  mpHud();
}
function setInputsEnabled(on){
  G.inputsOn = on;
  G.gaps.forEach(g => { if (!g.locked && G.s.mode !== 'choice') g.input.readOnly = !on || g.dead || isFuture(g.line); });
  if (!on) closeChoice();
}

// ---------- anti-cheat: lines unlock when the song reaches them ----------
// Only with music + synced lyrics. You can see/type up to the next line; later lines
// are blurred so you can't read ahead (or copy from a chorus you haven't heard yet).
const locking = () => false;   // (lines used to unlock as the song played; now the whole song stays readable)
function unlockedUntil(){
  let i = G.reach + 1;
  while (i < G.parsed.length && !G.parsed[i]) i++;   // skip empty lines
  return Math.max(i, 0);
}
const isFuture = li => locking() && li > unlockedUntil();
function applyReach(){
  const lock = locking(), until = unlockedUntil();
  G.lineEls.forEach((el, li) => el.classList.toggle('future', lock && li > until));
  if (G.inputsOn) G.gaps.forEach(g => { if (!g.locked && G.s.mode !== 'choice') g.input.readOnly = g.dead || (lock && g.line > until); });
}

// ---------- multiple choice: tricky options that SOUND like the answer ----------
// Datamuse (free, no key) gives words that sound alike ("night" → knight, knit…).
// Picks are sorted deterministically so everyone with the same link gets the same options.
const soundCache = new Map();
async function soundAlikes(word){
  const w = word.toLowerCase();
  if (!/^[a-z]{2,}$/.test(w)) return [];
  if (soundCache.has(w)) return soundCache.get(w);
  let out = [];
  try {
    const r = await fetch(`https://api.datamuse.com/words?sl=${encodeURIComponent(w)}&max=40&md=f`, { signal: timeoutSignal(5000) });
    const list = r.ok ? await r.json() : [];
    const plural = x => x === w + 's' || x === w + 'es' || w === x + 's' || w === x + 'es';
    out = list
      .map(x => ({ word: x.word, score: x.score || 0, f: parseFloat((x.tags || []).find(t => t.startsWith('f:'))?.slice(2) || '0') }))
      .filter(x => /^[a-z]+$/.test(x.word) && x.word !== w && !plural(x.word) && x.f >= 0.5)
      .sort((a, b) => (b.score - a.score) || (b.f - a.f) || a.word.localeCompare(b.word))
      .map(x => x.word);
  } catch {}
  soundCache.set(w, out);
  return out;
}
async function upgradeOptions(){
  const s = G.s, gaps = G.gaps.filter(g => !g.locked && !g.primary);
  const answers = [...new Set(gaps.map(g => g.answer.toLowerCase()))].slice(0, 120);
  const queue = [...answers];
  await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await soundAlikes(queue.shift()); }));
  if (G.s !== s || G.phase === 'playing') return;   // never change the options in the middle of a try
  gaps.forEach(g => {
    const alike = (soundCache.get(g.answer.toLowerCase()) || []).slice(0, 3);
    if (!alike.length) return;                       // keep the song-word options
    const cap = /^\p{Lu}/u.test(g.answer);
    const fix = w => cap ? w[0].toUpperCase() + w.slice(1) : w;
    const fill = g.options.filter(o => !same(o, g.answer) && !alike.some(a => same(a, o)));
    const opts = [g.answer, ...alike.map(fix), ...fill].slice(0, 4);
    g.options = shuffle(opts, rng(s.seed + '|' + g.i));
    for (const x of groupOf(g)){ x.options = g.options; x.input.style.width = (Math.max(3, ...g.options.map(o => o.length)) + 1.6) + 'ch'; }
  });
}

// ---------- the try loop ----------
function triesChips(){
  const total = unitCount();
  if (!G.tries.length) return null;
  return h('div', { class: 'tries' }, G.tries.map(t => h('div', { class: 'try' + (t.last ? ' last' : '') },
    h('small', { text: t.last ? '❤️ Last chance' : 'Try ' + t.n }),
    h('b', { text: `${t.correct}/${total}` }),
    h('div', { class: 'try-bar' }, h('div', { style: `width:${total ? t.correct / total * 100 : 0}%` })))));
}
function ringEl(correct, total){
  const pct = total ? Math.round(correct / total * 100) : 0;
  return h('div', { class: 'ring', style: `--p:${pct}` }, h('div', null, h('span', { text: `${correct}/${total}` }), h('small', { text: pct + '%' })));
}
function showReady(){
  if (G.mp) return mpShowReady();
  G.phase = 'ready';
  setInputsEnabled(false);
  updateHud();
  const music = !!G.s.yt, last = false;
  const go = () => { closeModal(true); beginTry(); };
  const readyBtn = h('button', { class: 'btn primary big', text: '▶ Ready', onclick: go });
  if (G.optionsReady && !G.optionsDone){
    readyBtn.disabled = true; readyBtn.textContent = '⏳ Preparing tricky options…';
    G.optionsReady.then(() => { readyBtn.disabled = false; readyBtn.textContent = '▶ Ready'; });
  }
  openModal({ locked: true },
    h('div', { class: 'big-emoji', text: last ? '❤️' : music ? '🎧' : '✍️' }),
    h('h2', { text: last ? 'Last chance' : G.tries.length ? `Ready for try ${G.tryNo}?` : 'Ready?' }),
    !G.tries.length && G.s.artist ? h('p', { class: 'roast', text: `🧪 Real ${fanName(G.s.artist)} fan test. Fake fans fail here.` }) : null,
    h('p', { class: 'muted', text: last
      ? `The song starts again. This time you can rewind ${REWIND_SECONDS} seconds ${REWINDS} times. After it, you’ll see your final results.`
      : music
        ? `Try ${G.tryNo}: the song plays from the start. Pause, skip back or forward (−30 … +30 s) or drag the bar whenever you want. Correct words turn green by themselves.`
        : `Try ${G.tryNo}: fill in the gaps. Correct words turn green by themselves. Press “End try” when you’re done.` }),
    locking() && G.tryNo === 1 && !G.tries.length ? h('p', { class: 'hint', text: '🔒 Lines unlock as the song reaches them. Once a line has played, you can always go back to it.' }) : null,
    h('p', { class: 'hint', text: '✋ A wrong answer is final for this try, so think before you press Enter/Tab.' }),
    triesChips(),
    h('div', { class: 'btns' },
      readyBtn,
      G.tries.length ? h('button', { class: 'btn', text: '🏁 Finish & see the results', onclick: () => { closeModal(true); finishGame(0); } }) : null),
    h('button', { class: 'link', text: '♪ Choose another song', onclick: () => { closeModal(true); showView('play'); } }));
}

function beginTry(){
  if (G.phase === 'playing' || G.done) return;
  G.phase = 'playing';
  G.tryStart = { correct: lockedCount(), hints: G.hints };
  G.passed = new Set(); G.wait = -1; G.cur = -1; G.heard = false; G.mpHid = false; G.mpPaused = false;
  G.gaps.forEach(g => {
    g.input.classList.remove('bad');
    if (g.dead){ g.dead = false; g.wrong = null; g.input.value = ''; g.input.placeholder = g.ph || ''; g.input.classList.remove('dead'); }   // lost words get a new chance each try
  });
  setInputsEnabled(true);
  updateHud();
  if (G.s.yt){ if (playerReady) startPlayback(); else G.pendingStart = true; }
  if (G.s.mode !== 'choice' && !G.s.pauseLines) focusNext(-1, true);
  saveProgress();
}

function awardXp(){
  let xp = 0;
  units().forEach(g => {
    if (!g.locked || g.xp) return;
    g.xp = true;
    xp += g.hinted ? 2 : g.lockTry === 1 ? 10 : g.lockTry === 2 ? 7 : 5;
  });
  G.xpTotal += xp;
  return xp;
}

function endTry(){
  if (G.phase !== 'playing') return;
  if (G.mp) return mpEndTry();
  pauseVideo(); closeChoice();
  if (G.wait >= 0){ G.lineEls[G.wait].classList.remove('wait'); G.wait = -1; }
  const correct = lockedCount(), total = unitCount();
  G.tries.push({ n: G.tryNo, correct, hints: G.hints - (G.tryStart?.hints || 0), last: G.lastChance });
  G.gaps.forEach(g => { if (!g.locked && g.input.value.trim()) flashBad(g); });
  const xp = awardXp();
  if (correct === total || G.lastChance){ finishGame(xp); return; }

  const gained = correct - (G.tryStart?.correct || 0);
  const done = G.tries[G.tries.length - 1];
  G.tryNo++;
  G.phase = 'between';
  setInputsEnabled(false);
  updateHud();
  saveProgress();
  const go = () => { closeModal(true); beginTry(); };
  openModal({ locked: true },
    h('h2', { text: `Try ${done.n} finished` }),
    ringEl(correct, total),
    h('p', { class: 'muted', text: gained ? `+${gained} new word${gained === 1 ? '' : 's'} this try. Your green words stay for the next one.` : 'No new words this time. Listen carefully and try again!' }),
    triesChips(),
    h('div', { class: 'res-stats' },
      h('span', { class: 'pill', text: `💡 ${G.hints} hint${G.hints === 1 ? '' : 's'}` }),
      xp ? h('span', { class: 'pill', text: `⭐ +${xp} XP` }) : null),
    h('p', { class: 'save-note', id: 'saveNote' }),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', text: `🔁 Play it again · Try ${G.tryNo}`, onclick: go }),
      h('button', { class: 'btn', text: '🏁 Finish & see the results', onclick: () => { closeModal(true); finishGame(0); } })),
    h('button', { class: 'link', text: '♪ Choose another song', onclick: () => { closeModal(true); showView('play'); } }));
  syncAttempt(false, xp);
}

function finishGame(xpLastTry){
  if (G.done) return;
  G.phase = 'done'; G.done = true; G.wait = -1;
  pauseVideo(); closeChoice();
  store.del('progress');
  const total = unitCount(), correct = lockedCount(), perfect = correct === total;
  let bonus = 0;
  if (perfect && !G.bonus){ G.bonus = true; bonus = (G.tries.length <= 1 ? 50 : 25) + ({ hard: 50, insane: 100 }[G.s.preset] || 0); G.xpTotal += bonus; }
  if (perfect && !matchMedia('(prefers-reduced-motion: reduce)').matches) confetti();
  setInputsEnabled(false);
  applyReach();   // game over → nothing is blurred any more
  G.lineEls.forEach((el, i) => { if (G.s.yt && G.s.times && G.parsed[i]) el.classList.add('seek'); });
  G.solEls.forEach((el, i) => { if (G.s.yt && G.s.times && G.parsed[i]) el.classList.add('seek'); });
  updateHud();

  const n = G.tries.length;
  const pctNow = Math.round(correct / total * 100);
  openModal(
    h('h2', { text: perfect ? (n <= 1 ? '🏆 Perfect on the first try!' : `🎉 All words in ${n} tries!`) : '🏁 Final results' }),
    h('div', { class: 'verdict ' + verdict(pctNow)[2], text: verdictText(pctNow, G.s.artist) }),
    ringEl(correct, total),
    h('p', { class: 'roast', text: roast(pctNow, G.s.artist) }),
    triesChips(),
    h('div', { class: 'res-stats' },
      h('span', { class: 'pill', text: `🔁 ${n} ${n === 1 ? 'try' : 'tries'}` }),
      h('span', { class: 'pill', text: `💡 ${G.hints} hint${G.hints === 1 ? '' : 's'}` }),
      G.xpTotal ? h('span', { class: 'pill', text: `⭐ +${G.xpTotal} XP` }) : null),
    h('p', { class: 'save-note', id: 'saveNote' }),
    h('div', { class: 'lb hidden', id: 'lbBox' }),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', text: '📤 Share my score (dare your friends)', onclick: () => shareScore(pctNow) }),
      h('button', { class: 'btn', text: '👁 See the solution & replay the song', onclick: () => { closeModal(); showTab('solution'); } }),
      h('button', { class: 'btn', text: '🔁 New game with new gaps', onclick: () => { closeModal(); restart(); } }),
      h('button', { class: 'btn', text: '♪ Choose another song', onclick: () => { closeModal(); showView('play'); } })));
  syncAttempt(true, xpLastTry + bonus);
}

function buildDetail(final){
  const missed = units().filter(g => !g.locked);
  const correct = lockedCount(), total = unitCount();
  return {
    title: G.s.title.slice(0, 200), artist: (G.s.artist || '').slice(0, 200), songId: G.s.src === 'lrclib' ? G.s.id : '',
    correct, total, pct: Math.round(correct / total * 100), mode: G.s.mode, preset: G.s.preset, hints: G.hints,
    tries: G.tries.length, scores: G.tries.map(t => t.correct).slice(0, 50), lastChance: G.lastChance, finished: final,
    missed: missed.map(g => g.answer).slice(0, 200),
    missedPairs: missed.slice(0, 100).map(g => ({ w: g.answer, l: G.s.lines[g.line].slice(0, 300) }))
  };
}
function boardKey(s){
  if (s.src !== 'lrclib' || s.preset === 'custom') return null;
  return `${s.id}_${s.preset}_${s.mode === 'choice' ? 'c' : 't'}`;
}
async function syncAttempt(final, xp){
  const note = () => $('saveNote');
  if (!signedIn()){
    if (note()) note().textContent = 'Sign in to save your games, earn XP and join the leaderboard.';
    return;
  }
  const d = buildDetail(final);
  if (note()) note().textContent = 'Saving…';
  try {
    await cloud.saveResult(G.session, d);
    if (xp > 0) await cloud.addXp(xp);
    if (final){
      const key = songKey(G.s), lib = cloud.state.library.get(key);
      if (lib) await cloud.updateSong(key, { best: Math.max(lib.best || 0, d.pct), plays: (lib.plays || 0) + 1 });
    }
    if (note()) note().textContent = '✓ Saved to your stats' + (xp ? ` · +${xp} XP` : '');
  } catch (e){ console.error(e); if (note()) note().textContent = 'Could not save this game.'; }

  const board = final && boardKey(G.s);
  if (!board) return;
  try {
    if (d.pct > 0) await cloud.submitScore(board, d.pct, d.tries, d.hints);
    const top = await cloud.topScores(board);
    const box = $('lbBox');
    if (!box || !top.length) return;
    box.replaceChildren(
      h('h4', { text: `🏆 Leaderboard · ${PRESET_LABEL[G.s.preset]} · ${G.s.mode === 'choice' ? 'Choose' : 'Type'}` }),
      h('ol', null, top.map(r => h('li', { class: r.me ? 'me' : '' },
        h('span', { text: r.name + (r.me ? ' (you)' : '') }), h('b', { text: r.pct + '%' }),
        h('em', { text: r.tries ? `${r.tries} ${r.tries === 1 ? 'try' : 'tries'}` : '' })))));
    box.classList.remove('hidden');
  } catch (e){ console.error(e); }
}

// ---------- typing & choosing ----------
const groupOf = g => [head(g), ...head(g).twins];
function lockGap(g, silent){
  const lt = head(g).lockTry || (G.lastChance ? 9 : G.tryNo);
  for (const x of groupOf(g)){
    x.locked = true; x.dead = false; x.lockTry = lt;
    x.input.value = x.answer;
    x.input.classList.remove('bad', 'dead');
    x.input.classList.add('ok');
    if (!silent){ x.input.classList.remove('pop'); void x.input.offsetWidth; x.input.classList.add('pop'); }
    x.input.readOnly = true;
    x.input.tabIndex = -1;
    if (G.choiceFor === x) closeChoice();
  }
  if (!silent) mpScore('ok', g);
}
// a wrong answer is final for this try (no editing it): the word (and its chorus copies) is lost
function markDead(g){
  for (const x of groupOf(g)){
    x.dead = true; x.input.readOnly = true; x.input.classList.add('dead');
    if (x !== g){ x.input.value = ''; x.input.placeholder = '✗'; }
    if (G.choiceFor === x) closeChoice();
  }
  flashBad(g);
  G.misses = (G.misses || 0) + 1;
  mpScore('miss', g);
}
function commitWrong(g){
  if (G.phase !== 'playing' || !playable(g) || G.s.mode === 'choice') return;
  const v = g.input.value.trim();
  if (!v || same(v, g.answer)) return;
  markDead(g); afterChange(g);
}
function flashBad(g){ g.input.classList.remove('bad'); void g.input.offsetWidth; g.input.classList.add('bad'); }
const playable = g => !g.locked && !g.dead && !isFuture(g.line);
function focusGap(x, noScroll){
  x.input.focus({ preventScroll: true });
  if (noScroll) return;
  const r = x.input.getBoundingClientRect();
  if (r.top < innerHeight * 0.25 || r.bottom > innerHeight * 0.7) x.input.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function focusNext(from, noScroll){
  for (let i = from + 1; i < G.gaps.length; i++) if (playable(G.gaps[i])){ focusGap(G.gaps[i], noScroll); return true; }
  return false;
}
function focusPrev(from){
  for (let i = from - 1; i >= 0; i--) if (playable(G.gaps[i])){ focusGap(G.gaps[i]); return true; }
  return false;
}
function onGapInput(g){
  if (G.phase !== 'playing' || !playable(g)) return;
  g.input.classList.remove('bad');
  if (same(g.input.value.trim(), g.answer)) lockGap(g);
  afterChange(g);
}
function afterChange(g){
  updateHud();
  queueSave();
  if (G.s.pauseLines && G.wait === g.line && G.lineGaps[g.line].every(x => x.locked)) continueListen();
  if (!G.mp && G.phase === 'playing' && units().every(x => x.locked || x.dead) && !G.finishing){
    G.finishing = true;
    setTimeout(() => { G.finishing = false; endTry(); }, 300);
  }
}
function onGapKey(e, g){
  if (e.key === 'Enter' || e.key === 'Tab'){
    e.preventDefault();
    if (e.key === 'Enter' && G.s.pauseLines && G.wait === g.line){ continueListen(); return; }
    commitWrong(g);                              // leaving a wrong word = final answer
    e.shiftKey ? focusPrev(g.i) : focusNext(g.i);
    return;
  }
  if (e.key === '?'){ e.preventDefault(); hint(g); return; }
  if (G.s.mode === 'choice' && /^[1-4]$/.test(e.key)){ e.preventDefault(); pickChoice(g, +e.key - 1); return; }
  if (e.key === 'Escape') closeChoice();
}

function openChoice(g){
  if (G.phase !== 'playing' || !playable(g)) return;
  const pop = $('choicePop');
  pop.replaceChildren(...g.options.map((o, i) => {
    const b = h('button', { type: 'button', role: 'option' }, h('kbd', { text: String(i + 1) }), o);
    b.disabled = !!g.wrong?.has(i);
    b.addEventListener('mousedown', e => e.preventDefault());
    b.onclick = () => pickChoice(g, i);
    return b;
  }));
  pop.classList.remove('hidden');
  G.choiceFor = g;
  const r = g.input.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2));
  pop.style.left = (left + window.scrollX) + 'px';
  pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
}
function closeChoice(){ $('choicePop').classList.add('hidden'); G.choiceFor = null; }
function pickChoice(g, i){
  if (G.phase !== 'playing' || !playable(g) || !g.options[i] || g.wrong?.has(i)) return;
  const o = g.options[i];
  g.input.value = o;
  if (same(o, g.answer)){ lockGap(g); afterChange(g); focusNext(g.i); }
  else { markDead(g); closeChoice(); afterChange(g); focusNext(g.i); }   // wrong pick = final for this try
}
window.addEventListener('resize', closeChoice);
document.addEventListener('mousedown', e => {
  if (G.choiceFor && !$('choicePop').contains(e.target) && e.target !== G.choiceFor.input) closeChoice();
});

// ---------- hints (counted in your stats) ----------
function hint(g){
  if (G.phase !== 'playing') return;
  g = g && playable(g) ? g : (G.focus && playable(G.focus) ? G.focus : G.gaps.find(playable));
  if (!g) return;
  G.hints++; g.hinted = head(g).hinted = true; mpScore('hint', g);
  if (G.s.mode === 'choice'){
    const wrongIdx = g.options.map((o, i) => i).filter(i => !same(g.options[i], g.answer) && !g.wrong?.has(i));
    if (wrongIdx.length) (g.wrong ||= new Set()).add(wrongIdx[0]);
    if (wrongIdx.length <= 1){ lockGap(g); afterChange(g); }
    else { g.input.focus(); openChoice(g); }
    toast('💡 One wrong option removed');
  } else {
    const v = g.input.value, a = g.answer;
    let k = 0;
    while (k < v.length && k < a.length && v[k].toLowerCase() === a[k].toLowerCase()) k++;
    g.input.value = a.slice(0, k + 1);
    g.input.classList.remove('bad');
    if (k + 1 >= a.length) lockGap(g);
    else { g.input.focus(); g.input.setSelectionRange(g.input.value.length, g.input.value.length); }
    afterChange(g);
  }
  updateHud();
}

// ---------- tabs: the solution unlocks when the game is over ----------
function refreshSolution(){
  G.gaps.forEach(g => {
    const attempt = g.input.value.trim();
    const ok = g.locked;
    g.sol.className = 'sol ' + (ok ? 'ok' : 'miss');
    g.sol.title = ok ? `Found in ${g.lockTry === 9 ? 'the last chance' : 'try ' + g.lockTry}` : (attempt ? `You wrote: ${attempt}` : 'Left empty');
  });
}
function showTab(name){
  const sol = name === 'solution';
  if (sol && !G.done){ toast('🔒 The solution unlocks after your last try.'); return; }
  if (sol){ refreshSolution(); closeChoice(); }
  $('challengePane').classList.toggle('hidden', sol);
  $('solutionPane').classList.toggle('hidden', !sol);
  $('tabChallenge').classList.toggle('on', !sol);
  $('tabSolution').classList.toggle('on', sol);
  $('tabChallenge').setAttribute('aria-selected', String(!sol));
  $('tabSolution').setAttribute('aria-selected', String(sol));
}
$('tabChallenge').onclick = () => showTab('challenge');
$('tabSolution').onclick = () => showTab('solution');

// ---------- autosave ----------
function saveProgress(){
  if (!G.active || G.done || G.mp) return;
  store.set('progress', {
    gv: GAPS_V, s: G.s, session: G.session, hints: G.hints, played: G.played, at: Date.now(),
    tryNo: G.tryNo, tries: G.tries, lastChance: G.lastChance, reach: G.reach, rewinds: G.rewinds, xpTotal: G.xpTotal,
    answers: G.gaps.map(g => g.locked ? '' : g.input.value),
    locked: G.gaps.map(g => g.locked ? (g.lockTry || 1) : 0),
    hinted: G.gaps.map(g => g.hinted ? 1 : 0),
    filled: lockedCount(), total: unitCount()
  });
}
let saveT = 0;
const queueSave = () => { clearTimeout(saveT); saveT = setTimeout(saveProgress, 500); };
window.addEventListener('pagehide', saveProgress);
document.addEventListener('visibilitychange', () => { if (document.hidden){ saveProgress(); mpLeft(); } });

// ---------- controls ----------
function restart(){
  if (!G.s) return;
  store.del('progress');
  startGame({ ...G.s, seed: newSeed() });
}
$('hintBtn').onclick = () => hint(G.focus);
// In-app "are you sure?" window. (The browser's own confirm() pop-up can get silently
// blocked by Chrome after a few uses, which made "End try" look like it did nothing.)
function askConfirm(title, text, okLabel, onOk){
  openModal(
    h('h2', { text: title }),
    h('p', { class: 'muted', text }),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', text: okLabel, onclick: () => { closeModal(); onOk(); } }),
      h('button', { class: 'btn', text: 'Cancel', onclick: () => closeModal() })));
}
$('endTryBtn').onclick = () => {
  if (G.phase !== 'playing') return;
  if (!G.s.yt){ endTry(); return; }
  askConfirm(`End ${G.lastChance ? 'your last chance' : 'try ' + G.tryNo} now?`, 'The song stops and you see your score.', '🏁 End try', endTry);
};
$('restartBtn').onclick = () => {
  if (G.done){ restart(); return; }
  askConfirm('Start a new game?', 'You get new random gaps and your tries for this game are lost.', '↺ New game', restart);
};
$('newBtn').onclick = () => G.mp ? askLeaveRoom() : showView('play');
// after the podium: get back to it, or (host) take everyone back to the lobby for the next song
$('podiumBtn').onclick = () => { if (MP.room?.status === 'final') showPodium(); else $('podiumBtn').classList.add('hidden'); };
$('lobbyBtn').onclick = () => { if (MP.role === 'host' && MP.room) rematch(); };
$('contBtn').onclick = () => continueListen();

// =====================================================================
// audio player (YouTube underneath, our own controls on top)
// =====================================================================
let player = null, playerReady = false, pollT = 0, ytPromise = null, playerToken = 0;
function loadYT(){
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return ytPromise ||= new Promise(res => {
    window.onYouTubeIframeAPIReady = () => res(window.YT);
    document.head.append(h('script', { src: 'https://www.youtube.com/iframe_api' }));
  });
}
function onPlayerError(e){
  const s = G.s;
  G.badYt.add(s.yt);
  const next = (s.ytAlts || []).find(x => !G.badYt.has(x));
  if (next && e.data !== 2){
    s.yt = next;
    toast('That upload can’t be played here. Trying another one…');
    player.loadVideoById(next);
    if (G.phase !== 'playing') setTimeout(pauseVideo, 300);
  } else {
    toast('The song won’t play here. If you opened the app inside VS Code, use Chrome or Edge instead.');
  }
}
function setPlayIcon(on){ $('playBtn').textContent = on ? '⏸' : '▶'; $('npPlay').textContent = on ? '⏸' : '▶'; }

async function setupPlayer(id){
  const has = !!id;
  $('playerCol').classList.toggle('hidden', !has);
  $('gameGrid').classList.toggle('with-player', has);
  $('mediaCtrls').classList.toggle('hidden', !has);
  $('syncBox').classList.toggle('hidden', !(has && G.s.times));
  $('offVal').textContent = (G.s.offset || 0).toFixed(1) + 's';
  $('npTitle').textContent = G.s.title;
  $('npArtist').textContent = G.s.artist || '';
  $('npFill').style.width = '0%';
  $('npCur').textContent = '0:00'; $('npDur').textContent = G.s.duration ? fmtTime(G.s.duration) : '–:––';
  setPlayIcon(false);
  if (!has) return;
  const token = ++playerToken;
  $('playerHost').replaceChildren(h('div', { id: 'ytPlayer' }));
  const YT = await loadYT();
  if (token !== playerToken) return;
  player = new YT.Player('ytPlayer', {
    videoId: id, width: '100%', height: '100%',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3 },
    events: {
      onReady: () => { playerReady = true; if (G.pendingStart){ G.pendingStart = false; startPlayback(); } },
      onError: onPlayerError,
      onStateChange: e => {
        setPlayIcon(e.data === 1);
        if (e.data === 1){
          if (G.phase !== 'playing' && !G.done){ pauseVideo(); return; }   // music only plays during a try
          G.heard = true;
          if (G.wait >= 0) continueListen(true);
        }
        if (e.data === 0 && G.phase === 'playing' && G.heard && !(G.mp && MP.role !== 'host')) endTry();    // song finished → try finished (the host decides in multiplayer)
        mpHostPlayState(e.data);
      }
    }
  });
  clearInterval(pollT);
  pollT = setInterval(poll, 120);
}
function destroyPlayer(){
  playerToken++;
  clearInterval(pollT);
  try { player?.destroy(); } catch {}
  player = null; playerReady = false;
  $('playerHost').replaceChildren();
}
function startPlayback(){ try { player.seekTo(0, true); player.playVideo(); } catch {} }
const playing = () => playerReady && player.getPlayerState?.() === 1;
function pauseVideo(){ try { if (playerReady) player.pauseVideo(); } catch {} }
function playVideo(){ try { if (playerReady) player.playVideo(); } catch {} }
const lineTime = li => G.s.times[li] + (G.s.offset || 0);

function poll(){
  if (!playerReady || !G.active) return;
  const t = player.getCurrentTime() || 0, dur = player.getDuration() || 0;
  if (dur){
    $('npFill').style.width = Math.min(100, t / dur * 100) + '%';
    $('npCur').textContent = fmtTime(t);
    $('npDur').textContent = fmtTime(dur);
  }
  mpHostClock(t, dur);
  if (!G.s?.times) return;
  const times = G.s.times;
  let cur = -1;
  for (let i = 0; i < times.length; i++){ if (lineTime(i) <= t + 0.05) cur = i; else break; }

  // "pause after each line": stop right before the next line if this one still has gaps
  if (G.s.pauseLines && G.phase === 'playing' && G.wait < 0 && cur >= 0 && player.getPlayerState() === 1){
    const endOf = i => i + 1 < times.length ? lineTime(i + 1) : lineTime(i) + 6;
    for (const L of [cur - 1, cur]){
      if (L < 0) continue;
      const end = endOf(L);
      if (t >= end - 0.25 && t < end + 1.2 && !G.passed.has(L) && G.lineGaps[L].some(g => !g.locked)){
        player.pauseVideo();
        G.wait = L;
        G.lineEls[L].classList.add('wait');
        updateHud();
        G.lineGaps[L].find(g => !g.locked)?.input.focus({ preventScroll: true });
        G.lineEls[L].scrollIntoView({ block: 'center', behavior: 'smooth' });
        break;
      }
    }
  }

  if (cur !== G.cur){
    G.lineEls[G.cur]?.classList.remove('now'); G.solEls[G.cur]?.classList.remove('now');
    G.cur = cur;
    if (cur > G.reach && G.phase === 'playing'){ G.reach = cur; applyReach(); queueSave(); mpHostReach(); }
    if (cur < 0) return;
    G.lineEls[cur].classList.add('now'); G.solEls[cur].classList.add('now');
    if ($('followChk').checked && G.wait < 0 && !document.activeElement?.closest?.('#lyrics')){
      const el = $('solutionPane').classList.contains('hidden') ? G.lineEls[cur] : G.solEls[cur];
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight * 0.25 || r.bottom > innerHeight * 0.7) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

function continueListen(fromPlay){
  const L = G.wait;
  if (L < 0){ if (!fromPlay) playVideo(); return; }
  G.lineGaps[L].forEach(g => { if (!g.locked && g.input.value.trim()) flashBad(g); });
  G.passed.add(L);
  G.wait = -1;
  G.lineEls[L].classList.remove('wait');
  updateHud(); queueSave();
  if (!fromPlay) playVideo();
}
function seekTo(t){ if (playerReady){ player.seekTo(Math.max(0, t), true); G.cur = -2; } }
function seekLine(li){
  if (!playerReady || !G.s.times || !G.done) return;
  seekTo(lineTime(li) - 0.3);
  playVideo();
}
function replayLine(){ if (G.done) seekLine(Math.max(0, G.cur)); }
// solo: skip back/forward and scrub whenever you want · multiplayer: only after the game
const freeSeek = () => !G.mp || G.done;
function seekBy(d){ if (playerReady) seekAbs((player.getCurrentTime() || 0) + d); }
function seekAbs(t){
  if (!playerReady || !freeSeek()) return;
  const to = Math.max(0, Math.min(t, (player.getDuration() || t) - 0.5));
  seekTo(to);
  if (G.s.times) [...G.passed].forEach(L => { if (lineTime(L) >= to - 0.5) G.passed.delete(L); });
  if (G.wait >= 0){ G.lineEls[G.wait].classList.remove('wait'); G.wait = -1; }
  if (G.phase === 'playing' || G.done) playVideo();
  updateHud(); queueSave();
}
function rewind(){ seekBy(-5); }
function togglePlay(){
  if (mpPlayerToggle()) return;
  if (!playerReady) return;
  if (G.phase === 'ready' || G.phase === 'between') return;
  if (G.wait >= 0){ continueListen(); return; }
  playing() ? player.pauseVideo() : player.playVideo();
}
$('rewBtn').onclick = $('npRew').onclick = rewind;
$('playBtn').onclick = $('npPlay').onclick = togglePlay;
$('lineBtn').onclick = replayLine;
// tap or drag the progress bar to move through the song
{
  let drag = false;
  const at = e => { const r = $('npProg').getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (player.getDuration() || 0); };
  const preview = e => { const d = player.getDuration() || 0; if (d) $('npFill').style.width = (at(e) / d * 100) + '%'; };
  $('npProg').addEventListener('pointerdown', e => {
    if (!playerReady || !freeSeek() || G.phase === 'ready' || G.phase === 'between') return;
    drag = true; $('npProg').setPointerCapture(e.pointerId); preview(e);
  });
  $('npProg').addEventListener('pointermove', e => { if (drag) preview(e); });
  $('npProg').addEventListener('pointerup', e => { if (!drag) return; drag = false; seekAbs(at(e)); });
  $('npProg').addEventListener('pointercancel', () => { drag = false; });
}
// skip buttons: −30 −15 −10 −5 · +5 +10 +15 +30
$('npSkip').replaceChildren(...[-30, -15, -10, -5, 5, 10, 15, 30].map(d =>
  h('button', { class: 'np-sk', title: (d < 0 ? 'Back ' : 'Forward ') + Math.abs(d) + ' seconds', text: (d < 0 ? '−' : '+') + Math.abs(d), onclick: () => seekBy(d) })));
function setOffset(v){
  G.s.offset = Math.round(v * 10) / 10;
  $('offVal').textContent = G.s.offset.toFixed(1) + 's';
  G.cur = -2; queueSave();
  const key = songKey(G.s);
  if (cloud?.state.library.has(key)) cloud.updateSong(key, { offset: G.s.offset }).catch(console.error);
}
$('offMinus').onclick = () => setOffset((G.s.offset || 0) - 0.5);
$('offPlus').onclick = () => setOffset((G.s.offset || 0) + 0.5);
$('tapSync').onclick = () => {
  if (!playerReady) return;
  const first = G.s.lines.findIndex(Boolean);
  setOffset(player.getCurrentTime() - G.s.times[first]);
  toast(`Synced! Lyrics shifted by ${G.s.offset.toFixed(1)} s`);
};

// debug handle (handy in the browser console): __lgc.G, __lgc.player()
window.__lgc = { G, player: () => player };

document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){ closeModal(); closeChoice(); $('userMenu').classList.add('hidden'); }
  if (view !== 'game') return;
  // Alt+1 play/pause · Alt+2 hint · Alt+3 rewind (when allowed) · Alt+4 end the try
  const k = e.code?.startsWith('Digit') ? e.code.slice(5) : e.key;
  if (e.altKey && !e.ctrlKey && ['1', '2', '3', '4'].includes(k)){
    e.preventDefault();
    if (k === '1') togglePlay();
    if (k === '2') hint(G.focus);
    if (k === '3') rewind();
    if (k === '4' && !$('endTryBtn').classList.contains('hidden')) $('endTryBtn').click();
  }
});

// =====================================================================
// 🌍 translation panel: select words in the lyrics → translation (MyMemory, free)
// one word → also meaning + pronunciation (Free Dictionary API)
// =====================================================================
const trCache = new Map();
let trSeq = 0, trTimer = 0, trLast = '';
try { $('trLang').value = localStorage.getItem('lgc:trLang') || 'es'; } catch {}
function setTransOpen(on){
  $('transPanel').classList.toggle('hidden', !on);
  $('transBtn').classList.toggle('saved', on);
  refreshSide();
}
$('transBtn').onclick = () => setTransOpen($('transPanel').classList.contains('hidden'));
$('trClose').onclick = () => setTransOpen(false);
$('trLang').onchange = () => { try { localStorage.setItem('lgc:trLang', $('trLang').value); } catch {} if (trLast) translateSel(trLast, true); };

document.addEventListener('selectionchange', () => {
  if (view !== 'game' || !G.done) return;
  clearTimeout(trTimer);
  trTimer = setTimeout(() => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().replace(/\s+/g, ' ').trim() : '';
    if (!/\p{L}{2,}/u.test(text) || text.length > 400 || text === trLast) return;
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (!node || !node.closest('#lyrics, #solution') || node.closest('.future')) return;
    translateSel(text);
  }, 450);
});

async function translateSel(text, force){
  trLast = text;
  setTransOpen(true);
  const lang = $('trLang').value, seq = ++trSeq;
  const word = /^[A-Za-z']+$/.test(text) ? text.toLowerCase().replace(/^'+|'+$/g, '') : '';
  const out = h('div', { class: 'tr-out', text: 'Translating…' });
  const dict = word ? h('div', { class: 'tr-dict', text: 'Looking up the meaning…' }) : null;
  $('trBody').replaceChildren(h('div', { class: 'tr-src', text: text }), out, dict);
  const key = lang + '|' + text;
  try {
    let res = trCache.get(key);
    if (!res){
      const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${lang}`);
      const j = await r.json();
      if (j.quotaFinished) throw new Error('quota');
      res = j.responseData?.translatedText || '';
      trCache.set(key, res);
    }
    if (seq === trSeq) out.textContent = res || 'No translation found.';
  } catch (e){ if (seq === trSeq) out.textContent = e.message === 'quota' ? 'Daily free translation limit reached. Try again tomorrow.' : 'Couldn’t translate right now.'; }
  if (!word) return;
  try {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (seq !== trSeq) return;
    if (!r.ok){ dict.textContent = 'No dictionary entry for this word (slang or a name?).'; return; }
    const e = (await r.json())[0];
    const audio = e.phonetics?.find(p => p.audio)?.audio;
    const phon = e.phonetic || e.phonetics?.find(p => p.text)?.text || '';
    dict.replaceChildren(
      h('div', { class: 'tr-word' }, h('b', { text: e.word }), phon ? h('span', { text: ' ' + phon }) : null,
        audio ? h('button', { class: 'tr-say', title: 'Listen', 'aria-label': 'Listen to the pronunciation', text: '🔊', onclick: () => new Audio(audio).play().catch(() => {}) }) : null),
      ...e.meanings.slice(0, 3).map(m => h('div', { class: 'tr-mean' },
        h('em', { text: m.partOfSpeech }), ' ', m.definitions[0]?.definition || '',
        m.definitions[0]?.example ? h('div', { class: 'tr-ex', text: '“' + m.definitions[0].example + '”' }) : null)));
  } catch { if (seq === trSeq) dict.textContent = 'Couldn’t load the dictionary right now.'; }
}

// =====================================================================
// share link, print worksheet
// =====================================================================
// ---------- roasts & the share card ----------
const ROASTS = [
  [0, ['0%. Were you even listening? 💀', 'Not a single word. Impressive, honestly. 💀']],
  [20, ['Bro’s been singing “na na na” this whole time 💀', 'You know the beat. Just the beat. 😭']],
  [40, ['You know the vibe, not the words 😭', 'Mumble-singing in the car has consequences 🫠']],
  [60, ['Half fan, half mumbler 🫠', 'You know it… kind of 👀']],
  [80, ['Okay, you actually listen 👀', 'Solid. Not day-one, but solid 😤']],
  [99, ['So close. Run it back 😤', 'One more try and it’s yours 😤']],
  [100, ['Are you the artist?? 🐐', 'Certified day-one fan 🐐']]
];
const ARTIST_ROASTS = [
  [20, [a => `C2 English and you still can’t understand ${a} 💀`, a => `Fake ${a} fan detected 🚨`, a => `-1000 aura. ${a} would be ashamed 💀`, a => `You’re cooked. Zero real ${a} fan behaviour 💀`, a => `Bro only knows the ${a} TikTok edits 💀`]],
  [40, [a => `Casual ${a} listener spotted 🫵`, a => `You know the ${a} vibe, not the words 😭`, a => `Mumbling ${a} in the car has consequences 🫠`]],
  [60, [a => `Mid ${a} fan energy 😐`, a => `Half fan, half NPC 🫠`, () => 'You know it… kind of 👀']],
  [80, [a => `Okay, you actually listen to ${a} 👀`, () => '+500 aura 😤', () => 'Solid. Not day-one, but solid 😤']],
  [99, [a => `So close. Almost a real ${a} fan 😤`, () => 'One more try and you’re certified 😤']],
  [100, [a => `Real ${a} fan confirmed ✅`, a => `+1000 aura. Are you ${a}?? 🐐`, a => `Certified day-one ${a} fan 🐐`]]
];
const VERDICTS = [[20, '🚨 FAKE FAN', 'fake'], [40, '🫵 CASUAL', 'casual'], [60, '😐 MID', 'mid'], [80, '👀 REAL LISTENER', 'real'], [99, '✅ REAL FAN', 'real'], [100, '🐐 DAY ONE', 'goat']];
const verdict = pct => VERDICTS.find(([max]) => pct <= max) || VERDICTS[VERDICTS.length - 1];
// "🚨 FAKE DRAKE FAN", "🐐 DAY-ONE CARTI FAN"… (generic when there's no artist)
function verdictText(pct, artist){
  const [, txt, kind] = verdict(pct), fan = fanName(artist);
  if (fan === 'this artist') return txt;
  const F = fan.toUpperCase();
  return { fake: `🚨 FAKE ${F} FAN`, goat: `🐐 DAY-ONE ${F} FAN` }[kind] || (pct > 80 ? `✅ REAL ${F} FAN` : txt);
}
function roast(pct, artist){
  if (artist && fanName(artist) !== 'this artist' && Math.random() < 0.75){
    const tier = ARTIST_ROASTS.find(([max]) => pct <= max) || ARTIST_ROASTS[ARTIST_ROASTS.length - 1];
    return pickOne(tier[1])(fanName(artist));
  }
  const tier = ROASTS.find(([max]) => pct <= max) || ROASTS[ROASTS.length - 1];
  return pickOne(tier[1]);
}
// 🟩 found · 🟥 wrong answer · ⬛ missed (in song order, max 50 squares)
function scoreGrid(){
  let u = units().map(g => g.locked ? '🟩' : g.dead ? '🟥' : '⬛');
  if (u.length > 50){ const step = u.length / 50; u = Array.from({ length: 50 }, (_, i) => u[Math.floor(i * step)]); }
  const rows = [];
  for (let i = 0; i < u.length; i += 10) rows.push(u.slice(i, i + 10).join(''));
  return rows.join('\n');
}
async function shareScore(pct){
  const s = G.s, n = G.tries.length;
  const fan = fanName(s.artist), v = verdictText(pct, s.artist);
  const text = `🧪 ${fan === 'this artist' ? 'LyricsGap' : fan + ' fan test'} · ${s.title}\n`
    + `${PRESET_LABEL[s.preset] || 'Custom'} · ${lockedCount()}/${unitCount()} words (${pct}%)${n > 1 ? ' · ' + n + ' tries' : ''}\n`
    + scoreGrid() + '\n'
    + `Verdict: ${v}\n`
    + roast(pct, s.artist) + '\n'
    + (fan !== 'this artist' ? `Only real ${fan} fans can beat this 👇` : 'Think you know it better? Same gaps, your turn 👇');
  const url = shareUrl();
  if (navigator.share){ try { await navigator.share({ title: 'LyricsGap', text, url }); return; } catch (e){ if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text + '\n' + url); toast('📋 Score copied! Paste it in the comments 😈'); }
  catch { prompt('Copy your score:', text + '\n' + url); }
}

function shareUrl(){
  const s = G.s;
  const p = { p: s.preset, o: s.opts, m: s.mode, sd: s.seed, yt: s.yt || undefined, pl: s.pauseLines ? 1 : undefined, os: s.oneShot ? 1 : undefined, of: s.offset || undefined, t: s.title, a: s.artist };
  if (s.src === 'lrclib') p.id = s.id; else p.l = s.lines;
  return location.origin + location.pathname + '#c=' + b64enc(JSON.stringify(p));
}
$('shareBtn').onclick = async () => {
  const url = shareUrl();
  const text = `🎤 I bet you don’t know the lyrics of “${G.s.title}”. Same gaps as me, go:`;
  if (navigator.share){ try { await navigator.share({ title: 'LyricsGap', text, url }); return; } catch (e){ if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('🔗 Link copied! Everyone who opens it gets exactly the same gaps.'); }
  catch { prompt('Copy this link:', url); }
};

async function openShared(){
  const m = location.hash.match(/^#c=([\w-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let p;
  try { p = JSON.parse(b64dec(m[1])); } catch { toast('This share link is broken.'); return; }
  let song;
  try {
    song = p.id ? await fetchSong(p.id) : { src: 'paste', title: p.t || 'Shared song', artist: p.a || '', lines: p.l || [], times: null, cover: '' };
  } catch { toast('Could not load the shared song.'); return; }
  if (!song.lines.length) return;
  const s = { src: song.src, id: song.id || '', title: p.t || song.title, artist: p.a ?? song.artist, cover: '', lines: song.lines, times: song.times,
    preset: p.o ? (p.p || 'custom') : 'medium', mode: p.m === 'choice' ? 'choice' : 'type', pauseLines: !!(p.pl || p.m === 'listen'), oneShot: !!p.os,
    opts: p.o || { ...PRESETS.medium, skipParens: true, instant: true }, seed: p.sd || newSeed(), yt: p.yt || '', offset: p.of || 0 };
  if (song.src !== 'paste') findCover(s.title, s.artist).then(u => { s.cover = u; });
  openModal(
    h('div', { class: 'big-emoji', text: '🎵' }),
    h('h2', { text: 'You’ve been challenged!' }),
    h('p', { class: 'muted', text: `“${s.title}”${s.artist ? ' by ' + s.artist : ''}` }),
    h('div', { class: 'res-stats' },
      h('span', { class: 'pill', text: PRESET_LABEL[s.preset] || 'Custom' }),
      h('span', { class: 'pill', text: MODE_LABEL[s.mode] }),
      h('span', { class: 'pill', text: s.yt ? '🎧 With music' : '🔇 No music' })),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', text: 'Accept the challenge →', onclick: () => { closeModal(); startGame(s); } }),
      h('button', { class: 'btn', text: 'Not now', onclick: closeModal })));
}

$('printBtn').onclick = () => {
  const s = G.s, area = $('printArea');
  let n = 0;
  const answers = [];
  const body = G.parsed.map(toks => {
    if (!toks) return h('p', { class: 'pa-line' }, ' ');
    return h('p', { class: 'pa-line' }, toks.map(t => {
      if (!t.gap) return t.raw + ' ';
      answers.push(t.core); n++;
      return [t.pre || '', h('span', { class: 'pa-blank', style: `min-width:${Math.max(4, t.core.length) * 0.75}em` }, h('sup', { text: n })), (t.suf || '') + ' '];
    }));
  });
  area.replaceChildren(
    h('h1', { text: s.title }),
    h('p', { class: 'pa-sub', text: [s.artist, PRESET_LABEL[s.preset] + ' level', `${answers.length} gaps`].filter(Boolean).join(' · ') }),
    h('p', { class: 'pa-name', text: 'Name: ______________________________     Date: ______________' }),
    ...body,
    h('div', { class: 'pa-key' }, h('h1', { text: 'Answer key' }), h('ol', null, answers.map(a => h('li', { text: a })))));
  window.print();
};

// =====================================================================
// modal, confetti
// =====================================================================
// openModal({ locked: true }, ...nodes) → can't be closed with Esc / clicking outside
let modalLocked = false;
function openModal(...nodes){
  const opts = nodes[0] && !nodes[0].nodeType && typeof nodes[0] === 'object' ? nodes.shift() : {};
  modalLocked = !!opts.locked;
  $('modal').replaceChildren(...nodes.flat(Infinity).filter(n => n != null && n !== false));
  $('overlay').classList.remove('hidden');
  $('modal').querySelector('button')?.focus();
}
function closeModal(force){
  if (modalLocked && force !== true) return;
  modalLocked = false;
  $('overlay').classList.add('hidden');
}
$('overlay').addEventListener('click', e => { if (e.target === $('overlay')) closeModal(); });

function confetti(){
  const c = $('confetti'), ctx = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight; c.style.display = 'block';
  const colors = ['#d4ff3a', '#ff6b4a', '#38d9ff', '#ffb547', '#3ddc84', '#ffffff'];
  const P = Array.from({ length: 170 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 240, y: innerHeight * .38,
    vx: (Math.random() - .5) * 16, vy: -Math.random() * 15 - 4, r: Math.random() * 7 + 4,
    c: colors[Math.random() * colors.length | 0], a: Math.random() * 6, va: (Math.random() - .5) * .35
  }));
  let f = 0;
  (function tick(){
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of P){
      p.vy += .32; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (++f < 170) requestAnimationFrame(tick); else { ctx.clearRect(0, 0, c.width, c.height); c.style.display = 'none'; }
  })();
}

// =====================================================================
// cloud: account, library, stats
// =====================================================================
let cloud = null;
const songKey = s => s.src === 'lrclib' ? 'l' + s.id : 'p' + hash36(s.title + '|' + (s.artist || '') + '|' + s.lines.join('\n'));
const signedIn = () => !!cloud?.state.user && !cloud.state.user.isAnonymous;
async function doSignIn(){
  if (!cloud){ toast('Accounts are unavailable right now. Check your connection.'); return; }
  try { await cloud.signIn(); }
  catch (e){ if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast('Sign-in failed: ' + (e.code || e.message)); }
}
$('loginBtn').onclick = doSignIn;
$('avatarBtn').onclick = e => { e.stopPropagation(); $('userMenu').classList.toggle('hidden'); };
document.addEventListener('click', e => { if (!$('userMenu').contains(e.target)) $('userMenu').classList.add('hidden'); });
$('logoutBtn').onclick = () => { $('userMenu').classList.add('hidden'); cloud?.signOut(); };

const levelOf = xp => Math.floor(Math.sqrt((xp || 0) / 150)) + 1;
const xpForLevel = l => (l - 1) * (l - 1) * 150;
function liveStreak(p){
  if (!p || !cloud) return 0;
  return (p.lastPlayed === cloud.today() || p.lastPlayed === cloud.yesterday()) ? (p.streak || 0) : 0;
}

function onCloud(st){
  const u = st.user && !st.user.isAnonymous ? st.user : null;
  if (st.ready && !MP.triedRejoin){ MP.triedRejoin = true; tryRejoin(); }
  $('loginBtn').classList.toggle('hidden', !!u);
  $('avatarBtn').classList.toggle('hidden', !u);
  $('streakPill').classList.toggle('hidden', !u || !st.profile);
  $('lvlPill').classList.toggle('hidden', !u || !st.profile);
  if (u){
    $('userName').textContent = u.displayName || u.email;
    if (u.photoURL) $('userPhoto').src = u.photoURL;
    const xp = st.profile?.xp || 0;
    $('userXp').textContent = `${xp} XP · level ${levelOf(xp)}`;
    $('streakVal').textContent = liveStreak(st.profile);
    $('lvlVal').textContent = levelOf(xp);
  }
  refreshSaveBtn();
  if (view === 'library') renderLibrary();
  if (view === 'stats') renderStats();
}
const cloudP = import('./cloud.js').then(m => { cloud = m; m.onChange(onCloud); return m; });
cloudP.catch(e => console.warn('Cloud features unavailable:', e));

const gLogo = () => $('loginBtn').querySelector('.g-logo').cloneNode(true);   // the Google "G" from the nav button
function wall(emoji, title, text){
  return h('div', { class: 'card wall' }, h('div', { class: 'big-emoji', text: emoji }), h('h3', { text: title }), h('p', { text }),
    h('button', { class: 'btn g-btn', onclick: doSignIn }, gLogo(), 'Sign in with Google'));
}

// ---------- library ----------
function refreshSaveBtn(){
  const b = $('saveSongBtn');
  const saved = !!(G.s && cloud?.state.library.has(songKey(G.s)));
  b.textContent = saved ? '♥' : '♡';
  b.classList.toggle('saved', saved);
  b.title = saved ? 'Saved in your library (click to remove)' : 'Save to your library';
  const np = $('npHeart');
  np.textContent = saved ? '♥' : '♡';
  np.title = b.title;
  np.classList.toggle('saved', saved);
  np.classList.toggle('hidden', G.s?.src === 'practice');
}
$('npHeart').onclick = () => $('saveSongBtn').click();
$('saveSongBtn').onclick = async () => {
  if (!signedIn()){ toast('Sign in to save songs to your library.'); doSignIn(); return; }
  const s = G.s, key = songKey(s);
  try {
    if (cloud.state.library.has(key)){ await cloud.removeSong(key); toast('Removed from your library'); }
    else {
      const data = { title: s.title.slice(0, 200), artist: (s.artist || '').slice(0, 200), songId: s.src === 'lrclib' ? s.id : '', cover: s.cover || '', youtube: s.yt || '', offset: s.offset || 0, tags: [], best: 0, plays: G.played ? 1 : 0 };
      if (s.src !== 'lrclib') data.lyrics = s.lines.join('\n').slice(0, 30000);
      await cloud.saveSong(key, data);
      toast('♥ Saved! Find it in your Library and add labels.');
    }
  } catch (e){ console.error(e); toast('Could not update your library.'); }
};

let libTag = '';
function renderLibrary(){
  const body = $('libBody');
  if (!signedIn()){ body.replaceChildren(wall('📚', 'Your songs, organised', 'Sign in to save songs with ♡, label them (e.g. “B1”, “Class 2A”) and see your best score for each one.')); return; }
  const items = [...cloud.state.library.values()].sort((a, b) => (toDate(b.updatedAt) || 0) - (toDate(a.updatedAt) || 0));
  if (!items.length){
    body.replaceChildren(h('div', { class: 'card wall' }, h('div', { class: 'big-emoji', text: '♡' }), h('h3', { text: 'Nothing saved yet' }),
      h('p', { text: 'While playing a song, press ♡ next to the title to save it here.' }),
      h('button', { class: 'btn primary', text: 'Find a song →', onclick: () => showView('play') })));
    return;
  }
  const tags = [...new Set(items.flatMap(i => i.tags || []))].sort((a, b) => a.localeCompare(b));
  if (libTag && !tags.includes(libTag)) libTag = '';
  const chips = h('div', { class: 'chips', style: 'justify-content:flex-start' },
    h('button', { class: 'chip' + (libTag ? '' : ' on'), text: `All (${items.length})`, onclick: () => { libTag = ''; renderLibrary(); } }),
    tags.map(t => h('button', { class: 'chip' + (libTag === t ? ' on' : ''), text: '#' + t, onclick: () => { libTag = t; renderLibrary(); } })));
  const shown = libTag ? items.filter(i => (i.tags || []).includes(libTag)) : items;
  body.replaceChildren(tags.length ? chips : '', h('div', { class: 'lib-grid' }, shown.map(libCard)));
}
function libCard(it){
  const tagInput = h('input', { class: 'tag-input', placeholder: '+ add label', maxlength: '24', 'aria-label': 'Add a label' });
  tagInput.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const t = tagInput.value.trim().replace(/^#/, '');
    if (!t) return;
    const tags = [...new Set([...(it.tags || []), t])].slice(0, 12);
    try { await cloud.updateSong(it.key, { tags }); } catch (err){ console.error(err); toast('Could not add the label.'); }
  });
  return h('div', { class: 'card lib-card' },
    h('div', { class: 'lib-top' }, tile(it.title, it.cover, 'md'),
      h('div', { class: 'r-info' }, h('b', { text: it.title }), h('div', { class: 'r-sub', text: it.artist || 'Your own lyrics' }))),
    h('div', { class: 'lib-meta' },
      h('span', { class: 'badge', text: it.best ? `BEST ${it.best}%` : 'NOT PLAYED' }),
      it.plays ? h('span', { class: 'badge', text: `${it.plays} PLAY${it.plays > 1 ? 'S' : ''}` }) : null,
      it.youtube ? h('span', { class: 'badge', text: '▶ VIDEO' }) : null),
    h('div', { class: 'lib-tags' },
      (it.tags || []).map(t => h('span', { class: 'tag' }, '#' + t, h('button', { title: 'Remove label', 'aria-label': 'Remove label ' + t, text: '✕',
        onclick: () => cloud.updateSong(it.key, { tags: it.tags.filter(x => x !== t) }).catch(console.error) }))),
      tagInput),
    h('div', { class: 'lib-actions' },
      h('button', { class: 'btn primary small', text: '▶ Play', onclick: () => playFromLibrary(it) }),
      h('button', { class: 'btn small', title: 'Remove from library', 'aria-label': 'Remove from library', text: '🗑',
        onclick: () => askConfirm('Remove this song?', `“${it.title}” will be removed from your library.`, '🗑 Remove', () => cloud.removeSong(it.key).catch(console.error)) })));
}
async function playFromLibrary(it){
  let song;
  try {
    if (it.songId){ toast('Loading lyrics…'); song = await fetchSong(it.songId); }
    else song = { src: 'paste', title: it.title, artist: it.artist, lines: cleanLines(it.lyrics || ''), times: null };
  } catch { toast('Could not load the lyrics for this song.'); return; }
  song.cover = it.cover || '';
  openSetup(song, { yt: it.youtube, offset: it.offset });
}

// ---------- stats ----------
function renderStats(){
  const body = $('statsBody');
  if (!signedIn()){ body.replaceChildren(wall('📈', 'Track your progress', 'Sign in to earn XP, keep a daily streak, see your accuracy over time and practise the words you miss most.')); return; }
  const p = cloud.state.profile || { xp: 0 };
  const results = cloud.state.results;
  const xp = p.xp || 0, lvl = levelOf(xp);
  const lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
  const avg = results.length ? Math.round(results.reduce((a, r) => a + (r.pct || 0), 0) / results.length) : 0;
  const perfects = results.filter(r => r.pct === 100).length;
  const withTries = results.filter(r => r.tries);
  const avgTries = withTries.length ? (withTries.reduce((a, r) => a + r.tries, 0) / withTries.length).toFixed(1) : '–';
  const totalHints = results.reduce((a, r) => a + (r.hints || 0), 0);

  // most-missed words
  const counts = new Map();
  results.forEach(r => (r.missed || []).forEach(w => { const k = w.toLowerCase(); counts.set(k, (counts.get(k) || 0) + 1); }));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);

  body.replaceChildren(
    h('div', { class: 'card level' },
      h('div', { class: 'lvl-badge' }, h('small', { text: 'LEVEL' }), String(lvl)),
      h('div', { class: 'grow' },
        h('b', { text: `${xp} XP` }), h('span', { class: 'muted small', text: ` · ${hi - xp} XP to level ${lvl + 1}` }),
        h('div', { class: 'xpbar' }, h('div', { style: `width:${Math.min(100, (xp - lo) / (hi - lo) * 100)}%` })))),
    h('div', { class: 'kpis six' },
      kpi('🔥 ' + liveStreak(p), 'day streak'),
      kpi(String(results.length), 'games played'),
      kpi(avg + '%', 'average score'),
      kpi(String(perfects), 'perfect games'),
      kpi(String(avgTries), 'tries per game'),
      kpi('💡 ' + totalHints, 'hints used')),
    h('div', { class: 'stats-grid' },
      h('div', { class: 'card chart' }, h('h3', { text: 'Score, last 20 games' }), results.length ? chart(results.slice(0, 20).reverse()) : h('p', { class: 'muted', text: 'Play a song to see your chart.' })),
      h('div', { class: 'card' },
        h('h3', { text: 'Words you miss most' }),
        top.length ? h('div', { class: 'words' }, top.map(([w, n]) => h('span', { class: 'word' }, w, n > 1 ? h('small', { text: '×' + n }) : null)))
                   : h('p', { class: 'muted', text: 'No mistakes yet. Impressive!' }))),
    h('div', { class: 'card', style: 'margin-top:12px' },
      h('div', { class: 'card-head' },
        h('h3', { text: 'Your last games' }),
        h('span', { class: 'muted small grow-r', text: '🔒 Only you can see this' }),
        results.length ? h('button', { class: 'btn small', text: '🗑 Clear history', onclick: () =>
          askConfirm('Clear your whole history?', 'All your games are deleted from your stats. Your XP, level, streak and library stay.', '🗑 Delete all games',
            () => cloud.clearResults().then(() => toast('History cleared')).catch(e => { console.error(e); toast('Could not clear the history.'); })) }) : null),
      results.length ? h('ul', { class: 'games' }, results.slice(0, 20).map(gameRow))
      : h('p', { class: 'muted', text: 'Nothing yet. Your games appear here after your first try.' })));
}
// one row per game: song, level, score after each try, hints, last chance
function gameRow(r){
  const total = r.total || 0;
  const scores = r.scores?.length ? r.scores : [r.correct];
  return h('li', null,
    h('div', { class: 'g-top' },
      h('span', { class: 't', text: r.title + (r.artist ? ' · ' + r.artist : '') }),
      h('span', { class: 'p', text: r.pct + '%' }),
      h('button', { class: 'g-del', title: 'Delete this game', 'aria-label': 'Delete this game', text: '🗑',
        onclick: () => askConfirm('Delete this game?', `“${r.title}” (${r.pct}%) is removed from your history.`, '🗑 Delete',
          () => cloud.deleteResult(r.id).catch(e => { console.error(e); toast('Could not delete this game.'); })) })),
    h('div', { class: 'g-tries' },
      scores.map((c, i) => [
        i ? h('span', { class: 'arrow', text: '→' }) : null,
        h('span', { class: 'chip-s' + (r.lastChance && i === scores.length - 1 ? ' last' : ''), title: r.lastChance && i === scores.length - 1 ? 'Last chance' : `Try ${i + 1}` },
          (r.lastChance && i === scores.length - 1 ? '❤️ ' : '') + `${c}/${total}`)])),
    h('div', { class: 'g-meta' },
      r.multi ? h('span', { class: 'badge synced', text: `👥 #${r.place || '?'} OF ${r.players || '?'} · ${fmtPts(r.points)} PTS` }) : null,
      r.preset ? h('span', { class: 'badge', text: (PRESET_LABEL[r.preset] || r.preset).toUpperCase() }) : null,
      r.mode ? h('span', { class: 'badge', text: r.mode === 'choice' ? 'CHOOSE' : 'TYPE' }) : null,
      h('span', { class: 'badge', text: `${r.tries || 1} ${(r.tries || 1) === 1 ? 'TRY' : 'TRIES'}` }),
      h('span', { class: 'badge', text: `💡 ${r.hints || 0}` }),
      r.tries && r.finished === false ? h('span', { class: 'badge', text: 'UNFINISHED' }) : null,
      h('span', { class: 'd', text: timeAgo(toDate(r.updatedAt)) })));
}
const kpi = (v, l) => h('div', { class: 'card kpi' }, h('div', { class: 'v', text: v }), h('div', { class: 'l', text: l }));
function chart(rs){
  const W = 600, H = 170, pad = 24, n = rs.length, bw = Math.min(36, (W - pad) / n - 6);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 18}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Accuracy of your last challenges');
  const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text) e.textContent = text; svg.append(e); return e; };
  [0, 50, 100].forEach(v => { const y = H - v / 100 * (H - 10); add('line', { x1: pad, x2: W, y1: y, y2: y, class: 'grid-l' }); add('text', { x: 0, y: y + 4 }, v + '%'); });
  rs.forEach((r, i) => {
    const x = pad + 6 + i * ((W - pad) / n), hgt = Math.max(3, (r.pct || 0) / 100 * (H - 10));
    const b = add('rect', { x, y: H - hgt, width: bw, height: hgt, rx: 4, class: 'bar-r' + (r.pct === 100 ? ' perfect' : '') });
    const t = document.createElementNS(ns, 'title'); t.textContent = `${r.title}: ${r.pct}%`; b.append(t);
  });
  return svg;
}
// =====================================================================
// 👥 MULTIPLAYER — one host plays the song, everyone types on their phone
// Room status: lobby → (spin) → ready → playing ⇄ paused → between → … → final
// Points: +100 per word (try 2: 70, try 3: 50) × combo, hint −50, miss −30
// =====================================================================
const MP = {
  code: null, role: null, room: null, players: [], unsubRoom: null, unsubPlayers: null,
  loadedKey: '', loading: '', spinShown: null, modal: null, lobbyBuilt: '', triedRejoin: false,
  points: 0, combo: 0, hints: 0, misses: 0, left: 0, syncT: 0, confettiDone: false,
  playlist: store.get('playlist', [])
};
const fmtPts = n => Math.round(n || 0).toLocaleString('en-US');
const myId = () => cloud?.myUid?.() || '';
const roundsOf = r => r.format === 'playlist' ? Math.min(r.rounds || 1, r.songs.length) : 1;
const whenCloud = () => cloud ? Promise.resolve(cloud) : cloudP;
function copyText(t){ navigator.clipboard?.writeText(t).then(() => toast('🔗 Link copied!'), () => prompt('Copy this link:', t)); }

// ---------- QR code (small library, loaded only when needed) ----------
let qrLib = null;
function makeQR(el, text){
  (qrLib ||= new Promise((res, rej) => {
    const sc = h('script', { src: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js' });
    sc.onload = () => res(window.QRCode); sc.onerror = rej; document.head.append(sc);
  })).then(Q => { el.replaceChildren(); new Q(el, { text, width: 196, height: 196, colorDark: '#0d0e11', colorLight: '#ffffff', correctLevel: Q.CorrectLevel.M }); })
    .catch(() => { el.textContent = 'Use the code above to join'; });
}

// ---------- settings & songs for a room ----------
function roomSettings(){
  const prefs = store.get('prefs', {});
  const preset = SETUP.opts ? SETUP.preset : (prefs.preset || 'medium');
  const mode = SETUP.opts ? SETUP.mode : (prefs.mode === 'choice' ? 'choice' : 'type');
  const o = SETUP.opts || { ...PRESETS.medium, skipParens: true, ...(prefs.opts || {}), ...(PRESETS[preset] || {}) };
  return { preset, mode, oneShot: mode === 'choice' && !!(SETUP.opts ? SETUP.oneShot : prefs.oneShot),
    opts: { density: o.density, minLen: o.minLen, focus: o.focus, firstLetter: !!o.firstLetter, sizeBoxes: !!o.sizeBoxes, skipParens: !!o.skipParens, clean: o.clean !== false, instant: true } };
}
function songFromSetup(){
  const s = SETUP.song;
  return { id: s.id, title: s.title, artist: s.artist || '', cover: s.cover || '', duration: s.duration || 0,
    yt: SETUP.music === 'off' ? '' : (SETUP.yt || ''), alts: Array.isArray(SETUP.cands) ? rankedCands('audio').slice(0, 4).map(c => c.id) : [] };
}
function checkSetupSong(){
  if (!SETUP.song || SETUP.song.src !== 'lrclib'){ toast('Multiplayer works with songs from the search (not pasted lyrics).'); return false; }
  if (SETUP.music !== 'off' && !SETUP.yt){ toast(SETUP.cands === null ? 'Still finding the music… one second.' : 'Pick a song version or choose “🔇 No music”.'); return false; }
  return true;
}

// ---------- 🎵 choosing the song(s) for a room ----------
// The host creates the room first; then picks songs with the normal search → setup screen
// ("✅ Use this song in the room" / "➕ Add to the room’s playlist"). The room stays open.
function renderPlaylist(){ $('playlistTray').classList.add('hidden'); }
const segEl = (vals, cur, onPick, fmt = v => v) => h('div', { class: 'seg', style: `grid-template-columns:repeat(${vals.length},1fr)` },
  vals.map(v => h('button', { class: v === cur ? 'on' : '', text: fmt(v), onclick: () => onPick(v) })));
function renderRoomBanner(){
  const inRoomHost = !!(MP.code && MP.role === 'host');
  const on = inRoomHost && MP.picking && (view === 'play' || view === 'setup');
  $('roomBanner').classList.toggle('hidden', !on);
  document.body.classList.toggle('picking', inRoomHost && !!MP.picking);
  $('pickTitle').textContent = `Room ${MP.code || ''} · ${MP.room?.songs?.length || 0}/5 songs chosen`;
  if (on) $('roomBanner').replaceChildren(
    h('span', { text: `🎵 Choosing music for room ${MP.code} (${MP.room?.songs?.length || 0} song${MP.room?.songs?.length === 1 ? '' : 's'} so far): search, open a song, then “✅ Use this song in the room”.` }),
    h('button', { class: 'btn small', text: '← Back to the room', onclick: () => { MP.picking = false; goRoom(); } }));
  $('hostBtn').classList.toggle('hidden', !!MP.code);
  $('roomUseBtn').classList.toggle('hidden', !inRoomHost);
  $('addPlBtn').classList.toggle('hidden', !inRoomHost);
  $('startBtn').classList.toggle('hidden', inRoomHost && !!MP.picking);
  if (inRoomHost) $('addPlBtn').textContent = `➕ Add to the room’s 🎡 playlist (${MP.room?.songs?.length || 0}/5)`;
}
function pickSongs(){
  MP.picking = true;
  showView('play');
  $('searchInput').focus();
}
$('roomUseBtn').onclick = () => { if (checkSetupSong()) setRoomSongs([songFromSetup()], false); };
$('addPlBtn').onclick = () => {
  if (!checkSetupSong()) return;
  const cur = MP.room?.songs || [];
  if (cur.some(x => x.id === SETUP.song.id)){ toast('This song is already in the room.'); return; }
  if (cur.length >= 5){ toast('The room playlist is full (5 songs).'); return; }
  setRoomSongs([...cur, songFromSetup()], true);
};
async function setRoomSongs(songs, keepPicking){
  const r = MP.room;
  const playlist = songs.length > 1;
  try {
    await cloud.updateRoom(MP.code, {
      songs: songs.map(s => ({ ...s, seed: s.seed || newSeed() })), settings: roomSettings(),
      format: playlist ? 'playlist' : 'tries', rounds: playlist ? Math.min(Math.max(r.rounds || 1, 2), songs.length) : 1,
      current: 0, played: []
    });
  } catch (e){ console.error(e); toast('Could not update the room.'); return; }
  if (keepPicking){ toast(`➕ Added! The room has ${songs.length} songs. Add more, or go back to the room.`); showView('play'); }
  else { toast('✅ Song ready in the room!'); MP.picking = false; goRoom(); }
}
function removeRoomSong(i){
  const songs = MP.room.songs.filter((_, k) => k !== i);
  cloud.updateRoom(MP.code, { songs, format: songs.length > 1 ? 'playlist' : 'tries', rounds: Math.min(MP.room.rounds || 1, Math.max(songs.length, 1)), current: 0, played: [] });
}
$('hostBtn').onclick = () => { if (checkSetupSong()) openHostModal('single'); };
$('createRoomBtn').onclick = () => openHostModal('empty');

// ---------- host: create a room ----------
function openHostModal(kind){
  const songs = kind === 'single' ? [songFromSetup()] : [];
  const st = { hostPlays: true, teams: false, musicAll: false, name: store.get('nick', '') || (cloud?.state.user?.displayName || '').split(' ')[0] || '' };
  const render = () => {
    const nameIn = h('input', { class: 'field', placeholder: 'Your name', maxlength: '20', value: st.name });
    nameIn.oninput = () => { st.name = nameIn.value; };
    const chk = (key, label) => { const c = h('input', { type: 'checkbox' }); c.checked = st[key]; c.onchange = () => { st[key] = c.checked; }; return h('label', { class: 'check' }, c, ' ' + label); };
    openModal(
      h('h2', { text: '👥 Create a room' }),
      h('p', { class: 'muted', text: songs.length ? `${songs[0].title} · ${songs[0].artist}` : 'Friends join first, then you choose the song(s) in the room.' }),
      h('div', { class: 'host-form' },
        h('b', { text: 'Your screen' }),
        segEl(['host', 'play'], st.hostPlays ? 'play' : 'host', v => { st.hostPlays = v === 'play'; render(); }, v => v === 'host' ? '🖥 Host only' : '🎮 Host & play'),
        h('small', { class: 'muted', text: st.hostPlays ? 'You play on this screen too, with the live scores next to the lyrics.' : 'Big screen mode: the song and the live scores, no lyrics (great for a projector).' }),
        st.hostPlays ? nameIn : null,
        chk('musicAll', '🔊 The music also plays on every phone (you control pause)'),
        chk('teams', '👥 Red vs Blue teams')),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', text: 'Create the room →', onclick: create }),
        h('button', { class: 'btn', text: 'Cancel', onclick: () => closeModal() })));
  };
  const create = async e => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const c = await whenCloud();
      await c.ensureUser();
      const name = (st.name || 'Host').trim().slice(0, 20) || 'Host';
      if (st.hostPlays) store.set('nick', name);
      const code = await c.createRoom({
        status: 'lobby', locked: false, banned: [], hostPlays: st.hostPlays, teams: st.teams, musicAll: st.musicAll, hostName: name, hostPhoto: myPhoto(),
        format: 'tries', triesTotal: 2, rounds: 1, missPts: 1, settings: roomSettings(), songs: songs.map(s => ({ ...s, seed: newSeed() })),
        current: 0, played: [], tryNo: 1, reach: -1, hideBoard: false, spinId: 0, songPos: 0, songSeq: 0
      });
      if (st.hostPlays) await c.setPlayer(code, freshPlayer(name));
      closeModal();
      enterRoom(code, 'host');
    } catch (err){ console.error(err); toast('Could not create the room: ' + (err.code || err.message)); btn.disabled = false; btn.textContent = 'Create the room →'; }
  };
  render();
}
const freshPlayer = name => ({ name, photo: myPhoto(), team: null, joinedAt: Date.now(), points: 0, correct: 0, total: 0, hints: 0, misses: 0, combo: 0, left: 0, tries: [] });

// ---------- players: join a room ----------
$('joinBtn').onclick = () => joinRoom($('joinCode').value);
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('joinCode').value); });
$('joinCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

async function joinRoom(raw){
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4){ toast('Type the room code from the host’s screen.'); return; }
  try {
    const c = await whenCloud();
    await c.ensureUser();
    const room = await c.getRoom(code);
    if (!room || room.status === 'closed'){ toast('Room not found. Check the code.'); return; }
    if ((room.banned || []).includes(c.myUid())){ toast('You were removed from this room.'); return; }
    if (room.host === c.myUid()){ enterRoom(code, 'host'); return; }
    const me = await c.getMe(code);
    if (me){ enterRoom(code, 'player', me); return; }
    if (room.status !== 'lobby'){ toast('This game has already started.'); return; }
    if (room.locked){ toast('🔒 The host locked this room.'); return; }
    askName(async name => {
      try { await c.setPlayer(code, freshPlayer(name)); enterRoom(code, 'player'); }
      catch (err){ console.error(err); toast('Could not join (the room may be locked or already playing).'); }
    });
  } catch (err){ console.error(err); toast('Could not join: ' + (err.code || err.message)); }
}
function askName(cb){
  const inp = h('input', { class: 'field', placeholder: 'Your name', maxlength: '20', value: store.get('nick', '') || (cloud?.state.user?.isAnonymous ? '' : (cloud?.state.user?.displayName || '').split(' ')[0] || '') });
  const go = () => { const n = inp.value.trim().slice(0, 20); if (!n){ inp.focus(); return; } store.set('nick', n); closeModal(); cb(n); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  const google = !!myPhoto();
  openModal(
    h('div', { class: 'name-av' }, avatarEl({ uid: myId(), photo: myPhoto() }, 86)),
    h('h2', { text: 'What’s your name?' }),
    h('p', { class: 'muted', text: google ? 'Your Google photo is your character in the room.' : 'This is your character. It’s always the same for you!' }),
    inp,
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', text: 'Join the room →', onclick: go }),
      google ? null : h('button', { class: 'btn g-btn', onclick: async () => {
        await doSignIn();
        if (signedIn()){ if (!store.get('nick', '')) store.set('nick', (cloud.state.user.displayName || '').split(' ')[0]); askName(cb); }
      } }, gLogo(), 'Use my Google photo instead')));
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}

// ---------- room connection ----------
function leaveSubs(){ MP.unsubRoom?.(); MP.unsubPlayers?.(); MP.unsubRoom = MP.unsubPlayers = null; }
function enterRoom(code, role, me){
  leaveSubs();
  Object.assign(MP, { code, role, room: null, players: [], loadedKey: '', loading: '', spinShown: null, modal: null, lobbyBuilt: '', confettiDone: false, picking: false,
    points: me?.points || 0, combo: 0, hints: me?.hints || 0, misses: me?.misses || 0, left: me?.left || 0 });
  store.set('room', { code, role });
  showView('room');
  $('roomBody').replaceChildren(h('div', { class: 'empty', text: 'Connecting to the room…' }));
  MP.unsubRoom = cloud.watchRoom(code, onRoom, e => { console.error(e); toast('Lost the connection to the room.'); });
  MP.unsubPlayers = cloud.watchPlayers(code, onPlayers, console.error);
}
async function tryRejoin(){
  const saved = store.get('room', null);
  if (!saved?.code || !cloud?.myUid()) return;
  try {
    const room = await cloud.getRoom(saved.code);
    if (!room || room.status === 'closed' || room.status === 'final'){ store.del('room'); return; }
    if (room.host === cloud.myUid()){ enterRoom(saved.code, 'host'); return; }
    const me = await cloud.getMe(saved.code);
    if (me) enterRoom(saved.code, 'player', me); else store.del('room');
  } catch { /* offline: ignore */ }
}
function askLeaveRoom(){
  const host = MP.role === 'host';
  askConfirm(host ? 'Close the room?' : 'Leave the room?', host ? 'The game ends for everyone.' : 'You can come back with the code while the room is still in the lobby.', '🚪 ' + (host ? 'Close room' : 'Leave'), leaveRoom);
}
async function leaveRoom(){
  const code = MP.code, role = MP.role, status = MP.room?.status;
  leaveSubs(); store.del('room'); closeModal(true);
  Object.assign(MP, { code: null, role: null, room: null, players: [], modal: null, picking: false });
  if (G.mp){ G.active = false; G.mp = null; destroyPlayer(); }
  showView('play');
  try {
    if (role === 'host') await cloud.updateRoom(code, { status: 'closed' });
    else if (status === 'lobby') await cloud.leavePlayer(code);
  } catch {}
}
function endRoom(msg){
  const keepView = G.mp && G.done;     // after the podium you can stay on the solution
  leaveSubs(); store.del('room');
  Object.assign(MP, { code: null, role: null, room: null, modal: null });
  ['podiumBtn', 'lobbyBtn'].forEach(id => $(id).classList.add('hidden'));
  if (keepView){ toast(msg); return; }
  closeModal(true);
  if (G.mp){ G.active = false; G.mp = null; destroyPlayer(); }
  showView('play');
  openModal(h('div', { class: 'big-emoji', text: '👋' }), h('h2', { text: 'Room closed' }), h('p', { class: 'muted', text: msg }),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', text: 'OK', onclick: () => closeModal() })));
}
function renderRoomCard(){
  const box = $('continueCard'), r = MP.room;
  box.replaceChildren(
    h('div', { class: 'tile', style: '--h:280', text: '👥' }),
    h('div', { class: 'c-info' }, h('small', { text: 'You’re in a room' }), h('b', { text: `Room ${MP.code}` }), h('small', { text: r ? ({ lobby: 'Waiting in the lobby', final: 'Game over' }[r.status] || 'Game in progress') : 'Connecting…' })),
    h('button', { class: 'btn primary', text: 'Back to the room →', onclick: goRoom }),
    h('button', { class: 'x', title: 'Leave the room', 'aria-label': 'Leave the room', text: '✕', onclick: askLeaveRoom }));
  box.classList.remove('hidden');
}
function goRoom(){ MP.picking = false; const s = MP.room?.status; showView(!s || s === 'lobby' || s === 'spin' || !G.mp ? 'room' : 'game'); if (s === 'lobby') renderLobby(); }

function onRoom(room){
  const prev = MP.room;
  MP.room = room;
  if (!room || room.status === 'closed'){ endRoom(room ? 'The host closed the room.' : 'This room doesn’t exist any more.'); return; }
  if (MP.role !== 'host' && (room.banned || []).includes(myId())){ endRoom('The host removed you from the room.'); return; }
  if (room.status === 'lobby'){
    if (prev && prev.status !== 'lobby') resetForLobby();
    if (view !== 'room' && view !== 'library' && view !== 'stats' && !MP.picking) showView('room');
    renderLobby();
  } else if (room.status === 'spin'){
    if (MP.spinShown !== room.spinId){ MP.spinShown = room.spinId; showView('room'); renderRoomWaiting(); showSpin(room); }
  } else if (room.status === 'final'){
    if (G.mp && G.active) mpFinish(); else renderRoomWaiting();
  } else syncGame(room);
  renderBoard();
  renderRoomBanner();
  if (view === 'play') renderContinue();
}
function onPlayers(list){
  MP.players = list;
  const r = MP.room, me = list.find(p => p.uid === myId());
  if (r?.teams && me && !me.team && MP.role !== 'host' || (r?.teams && me && !me.team && MP.role === 'host')){
    const count = t => list.filter(p => p.team === t).length;
    cloud.setPlayer(MP.code, { team: count('red') <= count('blue') ? 'red' : 'blue' }).catch(() => {});
  }
  if (r?.status === 'lobby') renderLobby();
  renderBoard();
}
function resetForLobby(){
  closeModal(true);
  if (G.mp){ G.active = false; G.mp = null; destroyPlayer(); }
  Object.assign(MP, { points: 0, combo: 0, hints: 0, misses: 0, left: 0, loadedKey: '', spinShown: null, modal: null, lobbyBuilt: '', confettiDone: false });
  if (MP.role !== 'host' || MP.room?.hostPlays) cloud.setPlayer(MP.code, { points: 0, correct: 0, total: 0, hints: 0, misses: 0, combo: 0, left: 0, tries: [] }).catch(() => {});
}

// ---------- 🙂 avatars: your Google photo, or a funny buddy that's always the same for you ----------
const myPhoto = () => (cloud?.state.user && !cloud.state.user.isAnonymous && cloud.state.user.photoURL) || '';
function avatarSvg(seed){
  const r = rng('buddy:' + seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const hue = Math.floor(r() * 360);
  const body = `hsl(${hue} 72% 62%)`, dark = `hsl(${hue} 55% 38%)`, light = `hsl(${hue} 85% 82%)`, acc = `hsl(${(hue + 160) % 360} 75% 55%)`;
  const shape = pick(['round', 'tall', 'wide']);
  const eyes = pick(['dots', 'big', 'big', 'sleepy', 'wink']);
  const mouth = pick(['smile', 'open', 'grin', 'o', 'tongue']);
  const extra = pick(['none', 'cap', 'headphones', 'glasses', 'bow', 'antenna', 'party']);
  const bodies = {
    round: `<ellipse cx="50" cy="62" rx="34" ry="32" fill="${body}"/>`,
    tall: `<rect x="20" y="24" width="60" height="70" rx="30" fill="${body}"/>`,
    wide: `<ellipse cx="50" cy="66" rx="40" ry="28" fill="${body}"/>`
  };
  const eyeSets = {
    dots: `<circle cx="39" cy="56" r="4.5" fill="#1b1b22"/><circle cx="61" cy="56" r="4.5" fill="#1b1b22"/>`,
    big: `<circle cx="38" cy="54" r="10" fill="#fff"/><circle cx="62" cy="54" r="10" fill="#fff"/><g class="pupils"><circle cx="40" cy="56" r="4.6" fill="#1b1b22"/><circle cx="64" cy="56" r="4.6" fill="#1b1b22"/></g>`,
    sleepy: `<path d="M31 56 Q38 61 45 56 M55 56 Q62 61 69 56" stroke="#1b1b22" stroke-width="3.5" fill="none" stroke-linecap="round"/>`,
    wink: `<circle cx="38" cy="54" r="10" fill="#fff"/><circle cx="40" cy="56" r="4.6" fill="#1b1b22"/><path d="M55 55 Q62 50 69 55" stroke="#1b1b22" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
  };
  const mouths = {
    smile: `<path d="M42 70 Q50 78 58 70" stroke="#1b1b22" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
    open: `<ellipse cx="50" cy="73" rx="6.5" ry="5.5" fill="#3a1414"/>`,
    grin: `<path d="M40 69 Q50 81 60 69 Z" fill="#3a1414"/><path d="M42 70 H58" stroke="#fff" stroke-width="2.5"/>`,
    o: `<circle cx="50" cy="73" r="4" fill="#3a1414"/>`,
    tongue: `<ellipse cx="50" cy="72" rx="7" ry="6" fill="#3a1414"/><ellipse cx="50" cy="75.5" rx="4.5" ry="3" fill="#ff7a93"/>`
  };
  const extras = {
    none: '',
    cap: `<path d="M26 36 Q50 8 74 36 Z" fill="${acc}"/><path d="M70 34 Q86 34 90 40 L70 40 Z" fill="${acc}"/>`,
    headphones: `<path d="M20 52 Q20 14 50 14 Q80 14 80 52" stroke="#2a2a33" stroke-width="5" fill="none"/><rect x="12" y="46" width="13" height="20" rx="6" fill="${acc}"/><rect x="75" y="46" width="13" height="20" rx="6" fill="${acc}"/>`,
    glasses: `<rect x="27" y="45" width="21" height="17" rx="6" fill="none" stroke="#1b1b22" stroke-width="3"/><rect x="52" y="45" width="21" height="17" rx="6" fill="none" stroke="#1b1b22" stroke-width="3"/><path d="M48 52 H52" stroke="#1b1b22" stroke-width="3"/>`,
    bow: `<path d="M50 28 L36 18 L36 38 Z M50 28 L64 18 L64 38 Z" fill="${acc}"/><circle cx="50" cy="28" r="4" fill="${dark}"/>`,
    antenna: `<path d="M50 30 L50 12" stroke="${dark}" stroke-width="3"/><circle class="glow" cx="50" cy="10" r="5" fill="${acc}"/>`,
    party: `<path d="M50 0 L38 30 L62 30 Z" fill="${acc}"/><path d="M44 16 L56 16 M41 24 L59 24" stroke="#fff" stroke-width="2.5"/><circle cx="50" cy="1" r="3.5" fill="#ffd93d"/>`
  };
  return `<svg viewBox="0 0 100 104" aria-hidden="true">`
    + `<ellipse class="foot fl" cx="38" cy="96" rx="9" ry="5.5" fill="${dark}"/><ellipse class="foot fr" cx="62" cy="96" rx="9" ry="5.5" fill="${dark}"/>`
    + bodies[shape]
    + `<ellipse cx="50" cy="${shape === 'wide' ? 80 : 82}" rx="17" ry="10" fill="${light}" opacity=".7"/>`
    + `<circle cx="29" cy="67" r="5" fill="#ff7a93" opacity=".45"/><circle cx="71" cy="67" r="5" fill="#ff7a93" opacity=".45"/>`
    + `<g class="eyes">${eyeSets[eyes]}</g>` + mouths[mouth] + extras[extra]
    + `</svg>`;
}
function avatarEl(p, size = 40){
  const box = h('div', { class: 'avatar-img', style: `width:${size}px;height:${size}px` });
  const buddy = () => { box.innerHTML = avatarSvg(p.uid || p.name || '?'); box.classList.remove('photo'); box.classList.add('buddy'); };
  if (p.photo){
    const img = h('img', { src: p.photo, alt: '', referrerpolicy: 'no-referrer' });
    img.onerror = buddy;
    box.classList.add('photo'); box.append(img);
  } else buddy();
  return box;
}

// ---------- the lobby stage: characters wander around while everyone waits ----------
const STAGE = { els: new Map(), timer: 0 };
// pick a spot on the floor far from the other characters
function stageBounds(){
  const W = $('lobbyStage')?.clientWidth || 900;
  const lo = 50 / W * 100;                                        // keep the whole character inside the stage
  const dj = [...STAGE.els.values()].some(e => e.dataset.dj);
  return { lo, hi: 100 - lo - (dj ? 95 / W * 100 : 0), djX: 100 - lo };
}
function freeSpot(self, near, span){
  const { lo, hi } = stageBounds();
  const others = [...STAGE.els.values()].filter(e => e !== self).map(e => parseFloat(e.style.left) || 50);
  let best = 50, bestD = -1;
  for (let i = 0; i < 12; i++){
    const x = near == null ? lo + Math.random() * (hi - lo) : Math.max(lo, Math.min(hi, near + (Math.random() - 0.5) * span));
    const d = others.length ? Math.min(...others.map(o => Math.abs(o - x))) : 100;
    if (d > bestD){ bestD = d; best = x; }
  }
  return best;
}
const THOUGHTS = ['💭', '🎵', '🎶', '🤔', '😎', '🎤', '👀', '…', '🔥', '😴', '🥁', '🎧', '🙌'];
function syncStage(list, r){
  const stage = $('lobbyStage');
  if (!stage) return;
  const people = list.map(p => ({ ...p }));
  if (r && !r.hostPlays) people.push({ uid: r.host, name: r.hostName || 'Host', photo: r.hostPhoto || '', dj: true });
  const ids = new Set(people.map(p => p.uid));
  for (const [id, el] of STAGE.els){
    if (ids.has(id) && el.isConnected) continue;
    if (el.isConnected){ el.classList.add('bye'); setTimeout(() => el.remove(), 450); }
    STAGE.els.delete(id);
  }
  people.forEach(p => {
    let el = STAGE.els.get(p.uid);
    if (!el){
      el = h('div', { class: 'av new', style: `left:${p.dj ? stageBounds().djX : freeSpot(null)}%` },
        h('div', { class: 'bubble' }), h('div', { class: 'fig' }), h('div', { class: 'shadow' }), h('div', { class: 'tag' }));
      el.dataset.next = Date.now() + 600 + Math.random() * 2500;
      el.dataset.dj = p.dj ? '1' : '';
      if (p.uid === myId()) el.addEventListener('click', () => hop(el, ['🎉', '😄', '🙌', '💃', '🕺', '👋'][Math.floor(Math.random() * 6)]));
      stage.append(el); STAGE.els.set(p.uid, el);
      setTimeout(() => el.classList.remove('new'), 800);
    }
    el.classList.toggle('me', p.uid === myId());
    el.classList.remove('red', 'blue');
    if (r?.teams && p.team) el.classList.add(p.team);
    el.querySelector('.tag').textContent = (p.dj ? '🎧 ' : '') + p.name + (p.uid === myId() ? ' (you)' : '');
    const fig = el.querySelector('.fig');
    if (fig.dataset.photo !== (p.photo || '') || !fig.firstChild){ fig.dataset.photo = p.photo || ''; fig.replaceChildren(avatarEl(p, 76)); }
  });
  stage.classList.toggle('empty', !people.length);
  if (!STAGE.timer) STAGE.timer = setInterval(stageTick, 400);
}
function stageTick(){
  const stage = $('lobbyStage');
  if (!stage || !stage.isConnected || view !== 'room'){ clearInterval(STAGE.timer); STAGE.timer = 0; return; }
  const now = Date.now();
  for (const el of STAGE.els.values()){
    if (now < +el.dataset.next) continue;
    const roll = Math.random();
    if (roll < 0.6 && !el.dataset.dj){                  // walk somewhere (not on top of someone)
      const from = parseFloat(el.style.left) || 50;
      const to = freeSpot(el, from, 60);
      el.classList.toggle('flip', to < from);
      el.classList.add('walking');
      el.style.left = to + '%';
      setTimeout(() => el.classList.remove('walking'), 1900);
      el.dataset.next = now + 1900 + Math.random() * 1800;
    } else if (roll < 0.85){                            // think about something
      think(el, THOUGHTS[Math.floor(Math.random() * THOUGHTS.length)]);
      el.dataset.next = now + 1800 + Math.random() * 1800;
    } else {                                            // little hop
      hop(el);
      el.dataset.next = now + 1500 + Math.random() * 2000;
    }
  }
}
function think(el, txt){ const b = el.querySelector('.bubble'); b.textContent = txt; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
function hop(el, txt){ el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop'); if (txt) think(el, txt); }

// ---------- lobby ----------
function renderLobby(){
  const r = MP.room;
  if (!r || view !== 'room') return;
  const host = MP.role === 'host';
  if (MP.lobbyBuilt !== MP.code + ':lobby'){
    MP.lobbyBuilt = MP.code + ':lobby';
    const joinUrl = location.origin + location.pathname + '#join=' + MP.code;
    const qr = h('div', { class: 'qr' });
    if (host) makeQR(qr, joinUrl);
    $('roomBody').replaceChildren(
      h('div', { class: 'page-head' }, h('h2', { text: host ? '👥 Your room' : '👥 You’re in!' }),
        h('p', { class: 'muted', text: host ? 'Players join on their phones: open the app → “Play with friends” → type the code, or scan the QR.' : 'Get ready! The game starts when the host presses Start.' })),
      h('div', { class: 'stage', id: 'lobbyStage' }, h('div', { class: 'stage-floor' })),
      h('div', { class: 'room-grid' },
        h('div', { class: 'card room-code' },
          h('small', { text: 'ROOM CODE' }), h('div', { class: 'code', text: MP.code }),
          host ? qr : null,
          host ? h('button', { class: 'btn small', text: '🔗 Copy the invite link', onclick: () => copyText(joinUrl) }) : null),
        h('div', { class: 'card lobby-main' }, h('div', { id: 'lobbyInfo' }), h('div', { id: 'lobbyPlayers' }), h('div', { id: 'lobbyActions', class: 'btns' }))));
  }
  // what we're playing (the host chooses it here, and can change it after every game)
  const s = r.settings || {};
  const songs = r.songs || [];
  $('lobbyInfo').replaceChildren(...[
    h('h3', { text: songs.length > 1 ? '🎡 Playlist' : '🎵 Song' }),
    songs.length
      ? h('div', { class: 'lobby-songs' }, songs.map((x, i) => h('div', { class: 'lobby-song' }, tile(x.title, x.cover),
          h('div', { class: 'r-info' }, h('div', { class: 'r-title', text: x.title }), h('div', { class: 'r-sub', text: x.artist + (x.yt ? '' : ' · no music') })),
          host ? h('button', { class: 'tr-x', title: 'Remove this song', 'aria-label': 'Remove ' + x.title, text: '✕', onclick: () => removeRoomSong(i) }) : null)))
      : h('div', { class: 'lobby-empty', text: host ? 'No song yet. Choose one, or several for a 🎡 playlist match.' : '🎵 The host is choosing the song…' }),
    host ? h('div', { class: 'row', style: 'flex-wrap:wrap;margin-top:8px' },
      h('button', { class: 'btn small' + (songs.length ? '' : ' primary'), text: songs.length ? '🔄 Change / add songs' : '🎵 Choose a song', onclick: pickSongs })) : null,
    host && songs.length === 1 ? h('div', { class: 'lobby-fmt' }, h('b', { text: 'Tries' }),
      segEl([1, 2, 3], r.triesTotal || 1, v => cloud.updateRoom(MP.code, { triesTotal: v, format: 'tries' }), v => `${v} ${v === 1 ? 'try' : 'tries'}`)) : null,
    host && songs.length > 1 ? h('div', { class: 'lobby-fmt' }, h('b', { text: 'Songs to play (a wheel picks them · 1 try each)' }),
      segEl(songs.map((_, i) => i + 1), roundsOf(r), v => cloud.updateRoom(MP.code, { rounds: v }))) : null,
    host ? h('div', { class: 'lobby-fmt' }, h('b', { text: '❌ A wrong answer costs (points)' }),
      segEl(MISS_OPTS, missPts(r), v => cloud.updateRoom(MP.code, { missPts: v }), v => v ? `−${v}` : '0')) : null,
    songs.length ? h('div', { class: 'res-stats', style: 'justify-content:flex-start;margin:10px 0 4px' },
      h('span', { class: 'pill', text: r.format === 'playlist' ? `🎡 ${roundsOf(r)} of ${songs.length} songs` : `🔁 ${r.triesTotal} ${r.triesTotal === 1 ? 'try' : 'tries'}` }),
      h('span', { class: 'pill', text: PRESET_LABEL[s.preset] || 'Custom' }),
      h('span', { class: 'pill', text: s.mode === 'choice' ? '🎯 Choose' : '✍️ Type' }),
      h('span', { class: 'pill', text: missPts(r) ? `❌ −${missPts(r)} per miss` : '❌ Misses: 0 pts' }),
      h('span', { class: 'pill', text: r.musicAll ? '🔊 Music on every phone' : '🖥 Music on the host only' }),
      r.teams ? h('span', { class: 'pill', text: '🔴 vs 🔵 teams' }) : null,
      r.locked ? h('span', { class: 'pill', text: '🔒 Locked' }) : null) : null].filter(Boolean));
  // players
  const list = MP.players.slice().sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  const me = myId();
  $('lobbyPlayers').replaceChildren(...[
    h('h3', { text: `Players (${list.length})` }),
    list.length ? h('ul', { class: 'lobby-list' }, list.map(p => h('li', null,
      avatarEl(p, 24),
      r.teams ? h('i', { class: 'dot ' + (p.team || '') }) : null,
      h('span', { class: 'nm', text: p.name }),
      p.uid === r.host ? h('span', { class: 'badge', text: 'HOST' }) : null,
      p.uid === me ? h('span', { class: 'badge synced', text: 'YOU' }) : null,
      host && p.uid !== me ? h('button', { class: 'tr-x', title: 'Remove from the room', 'aria-label': 'Remove ' + p.name, text: '✕',
        onclick: () => askConfirm(`Remove ${p.name}?`, 'They leave the room and can’t join again with this code.', '✕ Remove', () => cloud.kickPlayer(MP.code, p.uid).catch(console.error)) }) : null)))
      : h('p', { class: 'muted', text: 'Nobody yet… share the code!' }),
    r.teams && list.some(p => p.uid === me) ? h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn small team-btn red', text: '🔴 Join Red', onclick: () => cloud.setPlayer(MP.code, { team: 'red' }) }),
      h('button', { class: 'btn small team-btn blue', text: '🔵 Join Blue', onclick: () => cloud.setPlayer(MP.code, { team: 'blue' }) })) : null].filter(Boolean));
  syncStage(list, r);
  // actions
  $('lobbyActions').replaceChildren(...(host ? [
    h('button', { class: 'btn primary big', text: songs.length ? '▶ Start the game' : '🎵 Choose a song first', disabled: !list.length || !songs.length, onclick: hostStartGame }),
    h('div', { class: 'row', style: 'flex-wrap:wrap' },
      h('button', { class: 'btn small', text: r.musicAll ? '🔊 Music: every phone' : '🖥 Music: host only', onclick: () => cloud.updateRoom(MP.code, { musicAll: !r.musicAll }) }),
      h('button', { class: 'btn small', text: r.locked ? '🔓 Unlock room' : '🔒 Lock room', onclick: () => cloud.updateRoom(MP.code, { locked: !r.locked }) }),
      h('button', { class: 'btn small', text: r.teams ? '👤 No teams' : '👥 Teams', onclick: () => cloud.updateRoom(MP.code, { teams: !r.teams }) }),
      h('button', { class: 'btn small', text: '🚪 Close room', onclick: askLeaveRoom }))
  ] : [
    h('div', { class: 'yt-loading' }, h('span', { class: 'spinner' }), songs.length ? 'Waiting for the host to start…' : 'Waiting for the host to choose a song…'),
    h('button', { class: 'btn small', text: '🚪 Leave the room', onclick: askLeaveRoom })
  ]));
}
function renderRoomWaiting(){
  MP.lobbyBuilt = '';
  $('roomBody').replaceChildren(h('div', { class: 'page-head' }, h('h2', { text: `👥 Room ${MP.code}` })), h('div', { class: 'card' }, h('h3', { text: '🏆 Scores so far' }), boardEl(50)));
}
function hostStartGame(){
  const r = MP.room;
  if (r.format === 'playlist') mpSpin(false);
  else cloud.updateRoom(MP.code, { status: 'ready', current: 0, tryNo: 1, reach: -1, hideBoard: false });
}

// ---------- 🎡 the wheel (playlist) ----------
function mpSpin(afterSong){
  const r = MP.room;
  const played = afterSong ? [...(r.played || []), r.current] : [];
  const left = r.songs.map((_, i) => i).filter(i => !played.includes(i));
  if (!left.length || played.length >= roundsOf(r)){ cloud.updateRoom(MP.code, { status: 'final', played }); return; }
  const idx = left[Math.floor(Math.random() * left.length)];
  cloud.updateRoom(MP.code, { status: 'spin', current: idx, played, spinId: (r.spinId || 0) + 1, tryNo: 1, reach: -1, hideBoard: false });
}
function showSpin(room){
  const left = room.songs.map((s, i) => ({ s, i })).filter(x => !(room.played || []).includes(x.i));
  const tiles = left.map(x => h('div', { class: 'spin-tile' }, tile(x.s.title, x.s.cover, 'md'), h('b', { text: x.s.title }), h('small', { text: x.s.artist })));
  const note = h('p', { class: 'muted', text: 'Spinning…' });
  openModal({ locked: true }, h('h2', { text: `🎡 Song ${(room.played || []).length + 1} of ${roundsOf(room)}` }), h('div', { class: 'spin-grid' }, tiles), note);
  const target = left.findIndex(x => x.i === room.current);
  const steps = left.length * 3 + target;
  let k = 0;
  const tick = () => {
    tiles.forEach(t => t.classList.remove('on'));
    tiles[k % tiles.length].classList.add('on');
    if (k >= steps){
      tiles[target].classList.add('picked');
      note.textContent = `🎶 ${room.songs[room.current].title}!`;
      if (MP.role === 'host') setTimeout(() => { if (MP.room?.status === 'spin') cloud.updateRoom(MP.code, { status: 'ready', tryNo: 1, reach: -1, hideBoard: false }); }, 1800);
      return;
    }
    k++;
    setTimeout(tick, 70 + Math.pow(k / steps, 3) * 420);
  };
  tick();
}

// ---------- loading the song & following the host ----------
async function syncGame(room){
  const song = room.songs[room.current];
  if (!song) return;
  const key = MP.code + '|' + room.current + '|' + song.seed;
  if (MP.loadedKey !== key){
    if (MP.loading === key) return;
    MP.loading = key;
    try {
      const full = await fetchSong(song.id);
      const s = room.settings;
      const host = MP.role === 'host';
      startGame({
        src: 'lrclib', id: song.id, title: song.title, artist: song.artist, cover: song.cover, duration: song.duration,
        lines: full.lines, times: full.times, preset: s.preset, mode: s.mode, opts: s.opts,
        // the host always plays the song; players too when "music on every phone" is on
        seed: song.seed, yt: (host || room.musicAll) ? song.yt : '', ytAlts: song.alts || [], pauseLines: false, offset: 0
      }, null, { role: MP.role, code: MP.code, hostOnly: host && !room.hostPlays });
      MP.loadedKey = key; MP.lastSeq = null; MP.muted = false;
      // joining (or reloading) in the middle of a game: line up with the room's try
      const doneTries = (MP.room.tryNo || 1) - 1 + (MP.room.status === 'between' ? 1 : 0);
      if (doneTries){ G.tries = Array.from({ length: doneTries }, (_, i) => ({ n: i + 1, correct: 0 })); G.tryNo = doneTries + 1; }
      if (MP.room.status === 'between'){ G.phase = 'between'; showBetween(); }
      updateHud();
    } catch (e){ console.error(e); toast('Could not load the song for this room.'); MP.loading = ''; return; }
    MP.loading = '';
    return syncGame(MP.room);
  }
  if (view === 'room') showView('game');
  if (MP.role === 'host') return;                 // the host's own game drives the room

  // where the host's song is (used by the music on this phone and the line highlight)
  if (room.songSeq && room.songSeq !== MP.lastSeq){ MP.lastSeq = room.songSeq; MP.seqAt = performance.now(); MP.seqPos = room.songPos || 0; }
  if (!G.s.yt && (room.reach ?? -1) > G.reach){
    G.reach = room.reach;
    G.lineEls.forEach((el, i) => el.classList.toggle('now', i === G.reach));
  }
  if ((room.status === 'playing' || room.status === 'paused') && G.phase !== 'playing' && !G.done && G.tries.length < room.tryNo){
    if (G.optionsReady && !G.optionsDone) await G.optionsReady;
    if (!['playing', 'paused'].includes(MP.room?.status)) return;
    MP.modal = null; closeModal(true); beginTry();
  }
  if (G.phase === 'playing'){
    const paused = MP.room.status === 'paused';
    if (paused !== !!G.mpPaused){ G.mpPaused = paused; setInputsEnabled(!paused); $('mpPaused').classList.toggle('hidden', !paused); }
  }
  followHostMusic();
  if (room.status === 'between' && G.phase === 'playing' && G.tries.length < room.tryNo) mpEndTry();
}

// 🔊 players' phones play the same song, kept in sync with the host (pause, position)
function hostSongPos(){
  if (!MP.room?.songSeq) return 0;
  return (MP.seqPos || 0) + (MP.room.status === 'playing' ? (performance.now() - MP.seqAt) / 1000 : 0);
}
function followHostMusic(){
  if (!G.mp || MP.role === 'host' || !G.s?.yt || !playerReady) return;
  const st = player.getPlayerState?.();
  if (G.phase !== 'playing' || MP.room?.status !== 'playing' || MP.muted){ if (st === 1) player.pauseVideo(); return; }
  const want = hostSongPos();
  if (Math.abs((player.getCurrentTime() || 0) - want) > 1.2) player.seekTo(want, true);
  if (st !== 1 && st !== 3) player.playVideo();
}
function mpFollowTick(){
  if (!G.mp || MP.role === 'host' || !G.s?.yt) return;
  const now = performance.now();
  if (now - (MP.lastFollow || 0) < 2000) return;
  MP.lastFollow = now;
  followHostMusic();
}
// players: ▶ / Alt+1 only switches the music on this phone (the host controls the game)
function mpPlayerToggle(){
  if (!G.mp || MP.role === 'host') return false;
  if (!G.s.yt){ toast('🎧 The host controls the music.'); return true; }
  if (playing()){ MP.muted = true; player.pauseVideo(); toast('🔇 Music off on this phone'); }
  else { MP.muted = false; followHostMusic(); if (MP.room?.status !== 'playing') toast('⏸ The host has paused the song.'); }
  return true;
}

function mpShowReady(){
  G.phase = 'ready'; setInputsEnabled(false); updateHud();
  const r = MP.room, host = MP.role === 'host';
  const title = r.format === 'playlist' ? `Song ${(r.played || []).length + 1} of ${roundsOf(r)}` : `Try ${G.tryNo} of ${r.triesTotal}`;
  let btn, sound = null;
  if (host){
    btn = h('button', { class: 'btn primary big', text: '▶ Start the song for everyone', onclick: mpHostStartTry });
    if (G.optionsReady && !G.optionsDone){ btn.disabled = true; btn.textContent = '⏳ Preparing…'; G.optionsReady.then(() => { btn.disabled = false; btn.textContent = '▶ Start the song for everyone'; }); }
  } else {
    btn = h('div', { class: 'yt-loading' }, h('span', { class: 'spinner' }), 'Get ready… the host starts the song');
    // phones only play sound after a tap: this unlocks the music on this device
    if (G.s.yt) sound = h('button', { class: 'btn', text: MP.audioOk ? '✅ Music ready on this phone' : '🔊 Tap to turn on the music on this phone', onclick: e => {
      try { player?.playVideo(); setTimeout(() => { if (MP.room?.status !== 'playing') player?.pauseVideo(); }, 400); } catch {}
      MP.audioOk = true; e.currentTarget.textContent = '✅ Music ready on this phone';
    } });
  }
  MP.modal = 'ready';
  openModal({ locked: true },
    h('div', { class: 'big-emoji', text: '👥' }), h('h2', { text: title }),
    h('p', { class: 'muted', text: `${G.s.title} · ${G.s.artist}` }),
    h('p', { class: 'hint', text: G.mp.hostOnly ? 'The song plays on this screen (and on the phones if 🔊 is on). The live scores show here.'
      : `+1 per word · ${missText(r)} (and it stays wrong) · a word you solved with a hint gives 0.` }),
    h('div', { class: 'btns' }, btn, sound),
    h('button', { class: 'link', text: host ? '🚪 Close the room' : '🚪 Leave the room', onclick: askLeaveRoom }));
}
const songStamp = () => ({ songPos: playerReady ? (player.getCurrentTime() || 0) : 0, songSeq: Date.now() });
function mpHostStartTry(){
  MP.modal = null; closeModal(true);
  beginTry();                                      // start the music right away (needs the click)
  cloud.updateRoom(MP.code, { status: 'playing', tryNo: G.tryNo, hideBoard: false, songPos: 0, songSeq: Date.now() }).catch(console.error);
}
function mpHostPlayState(state){
  if (!G.mp || MP.role !== 'host' || G.phase !== 'playing' || !G.heard) return;
  const st = MP.room?.status;
  if (state === 1 && st === 'paused') cloud.updateRoom(MP.code, { status: 'playing', ...songStamp() });
  if (state === 2 && st === 'playing') cloud.updateRoom(MP.code, { status: 'paused', ...songStamp() });
}
function mpHostReach(){ if (G.mp && MP.role === 'host') cloud.updateRoom(MP.code, { reach: G.reach, ...songStamp() }).catch(() => {}); }
function mpHostClock(t, dur){
  mpFollowTick();
  if (!G.mp || MP.role !== 'host' || G.phase !== 'playing' || G.mpHid || !dur || t < dur - 60 || t < 5) return;
  G.mpHid = true;
  cloud.updateRoom(MP.code, { hideBoard: true }).catch(() => {});   // 🙈 last minute: suspense!
}

function mpEndTry(){
  pauseVideo(); closeChoice();
  const correct = lockedCount();
  G.tries.push({ n: G.tryNo, correct, hints: G.hints - (G.tryStart?.hints || 0), last: false });
  G.gaps.forEach(g => { if (!g.locked && g.input.value.trim()) flashBad(g); });
  const xp = awardXp();
  if (xp && signedIn() && !G.mp.hostOnly) cloud.addXp(xp).catch(() => {});
  G.tryNo++; G.phase = 'between'; G.mpPaused = false;
  $('mpPaused').classList.add('hidden');
  setInputsEnabled(false); updateHud();
  mpSyncNow();
  if (MP.role === 'host') cloud.updateRoom(MP.code, { status: 'between', hideBoard: false }).catch(console.error);
  showBetween();
}
function showBetween(){
  const r = MP.room;
  if (!r) return;
  MP.modal = 'between';
  const host = MP.role === 'host', playlist = r.format === 'playlist';
  const songNo = (r.played || []).length + 1;
  const moreTries = !playlist && G.tries.length < r.triesTotal;
  const moreSongs = playlist && songNo < roundsOf(r);
  const actions = host ? [
    moreTries ? h('button', { class: 'btn primary', text: `▶ Start try ${G.tryNo}`, onclick: mpHostStartTry }) : null,
    moreSongs ? h('button', { class: 'btn primary', text: '🎡 Spin for the next song', onclick: () => { MP.modal = null; closeModal(true); mpSpin(true); } }) : null,
    h('button', { class: 'btn' + (moreTries || moreSongs ? '' : ' primary'), text: '🏆 Show the podium', onclick: () => { MP.modal = null; closeModal(true); cloud.updateRoom(MP.code, { status: 'final', played: playlist ? [...(r.played || []), r.current] : r.played }); } })
  ] : [h('div', { class: 'yt-loading' }, h('span', { class: 'spinner' }), 'Waiting for the host…')];
  openModal({ locked: true },
    h('h2', { text: playlist ? `Song ${songNo} of ${roundsOf(r)} done!` : `Try ${G.tries.length} of ${r.triesTotal} done!` }),
    !G.mp.hostOnly ? h('div', { class: 'res-stats' },
      h('span', { class: 'pill', text: `✅ ${lockedCount()}/${unitCount()} words` }),
      h('span', { class: 'pill', text: `⭐ ${fmtPts(MP.points)} pts` })) : null,
    h('div', { class: 'modal-board' }, boardEl(10)),
    h('div', { class: 'btns' }, actions),
    h('button', { class: 'link', text: host ? '🚪 Close the room' : '🚪 Leave the room', onclick: askLeaveRoom }));
}

// ---------- 🏆 final podium ----------
function mpFinish(){
  if (G.mpFinished) return;
  G.mpFinished = true;
  G.phase = 'done'; G.done = true; G.wait = -1;
  pauseVideo(); closeChoice(); setInputsEnabled(false); applyReach();
  G.lineEls.forEach((el, i) => { if (G.s.yt && G.s.times && G.parsed[i]) el.classList.add('seek'); });
  G.solEls.forEach((el, i) => { if (G.s.yt && G.s.times && G.parsed[i]) el.classList.add('seek'); });
  $('mpPaused').classList.add('hidden');
  updateHud(); renderBoard();
  showPodium();
  // save the match in your private history
  if (!G.mp.hostOnly && signedIn()){
    const ranked = rankedPlayers(), place = ranked.findIndex(p => p.uid === myId()) + 1;
    const d = buildDetail(true), r = MP.room;
    if (r.format === 'playlist'){ d.title = `🎡 Playlist match (${(r.played || []).length || roundsOf(r)} songs)`; d.artist = r.songs.map(x => x.title).join(', ').slice(0, 200); }
    cloud.saveResult('mp_' + MP.code + '_' + Date.now().toString(36), { ...d, multi: true, room: MP.code, place, players: ranked.length, points: Math.round(MP.points) }).catch(console.error);
    const bonus = { 1: 50, 2: 30, 3: 15 }[place] || 0;
    if (bonus) cloud.addXp(bonus).catch(() => {});
  }
}
function rankedPlayers(){ return MP.players.filter(p => p.name).sort((a, b) => (b.points || 0) - (a.points || 0) || (b.correct || 0) - (a.correct || 0)); }
function teamTotals(list){ return ['red', 'blue'].map(t => ({ t, pts: list.filter(p => p.team === t).reduce((a, p) => a + (p.points || 0), 0) })); }
function showPodium(){
  MP.modal = 'podium';
  const r = MP.room, ranked = rankedPlayers(), host = MP.role === 'host';
  const myPlace = ranked.findIndex(p => p.uid === myId()) + 1;
  const [first, second, third] = ranked;
  const pod = (p, place) => p ? h('div', { class: 'pod p' + place },
    h('div', { class: 'pod-av' + (place === 1 ? ' winner' : '') }, avatarEl(p, place === 1 ? 64 : 50)), h('div', { class: 'pod-medal', text: ['🥇', '🥈', '🥉'][place - 1] }), h('b', { text: p.name }), h('span', { text: fmtPts(p.points) + ' pts' }), h('div', { class: 'pod-bar' }, String(place))) : h('div');
  const teams = r?.teams ? teamTotals(ranked) : null;
  const winTeam = teams ? (teams[0].pts === teams[1].pts ? 'tie' : teams[0].pts > teams[1].pts ? 'red' : 'blue') : null;
  openModal(
    h('h2', { text: '🏆 Final podium' }),
    teams ? h('p', { class: 'team-win ' + winTeam, text: winTeam === 'tie' ? `🤝 It’s a tie! ${fmtPts(teams[0].pts)} – ${fmtPts(teams[1].pts)}` : `${winTeam === 'red' ? '🔴 Red' : '🔵 Blue'} team wins! ${fmtPts(teams[0].pts)} – ${fmtPts(teams[1].pts)}` }) : null,
    h('div', { class: 'podium' }, pod(second, 2), pod(first, 1), pod(third, 3)),
    ranked.length > 3 ? h('div', { class: 'modal-board' }, boardEl(50)) : null,
    myPlace ? h('p', { class: 'muted', text: `You finished #${myPlace} of ${ranked.length} with ${fmtPts(MP.points)} points.` }) : null,
    myPlace ? h('p', { class: 'roast', text: myPlace === 1 ? 'Undisputed. Nobody in this lobby knows the lyrics like you 🐐' : myPlace === ranked.length ? `Last place. Fake ${fanName(G.s?.artist)} fan of the lobby 💀` : 'Mid. Run it back 😤' }) : null,
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', text: '👁 See the solution', onclick: () => { MP.modal = null; closeModal(); showTab('solution'); } }),
      host ? h('button', { class: 'btn', text: '🔁 Back to the lobby (choose the next song)', onclick: rematch }) : null,
      h('button', { class: 'btn', text: host ? '🚪 Close the room' : '🚪 Leave the room', onclick: leaveRoom })));
  if (myPlace === 1 && !MP.confettiDone && !matchMedia('(prefers-reduced-motion: reduce)').matches){ MP.confettiDone = true; confetti(); }
}
function rematch(){
  const r = MP.room;
  cloud.updateRoom(MP.code, { status: 'lobby', played: [], current: 0, tryNo: 1, reach: -1, hideBoard: false, spinId: 0, songs: r.songs.map(s => ({ ...s, seed: newSeed() })) });
}

// ---------- live scoreboard (everyone sees it; hidden in the last minute) ----------
const boardHidden = () => { const r = MP.room; return !!(r?.hideBoard && (r.status === 'playing' || r.status === 'paused')); };
function boardEl(limit = 50, big){
  const r = MP.room;
  if (boardHidden())
    return h('div', { class: 'board-hidden' }, h('div', { class: 'big-emoji', text: '🙈' }), h('b', { text: 'Scores hidden!' }), h('p', { class: 'muted small', text: 'Last minute of the song… the results come at the end.' }));
  const ranked = rankedPlayers(), me = myId();
  const teams = r?.teams ? teamTotals(ranked) : null;
  return h('div', { class: 'board' + (big ? ' big' : '') },
    teams ? h('div', { class: 'teams' }, teams.map(x => h('div', { class: 'team ' + x.t }, h('small', { text: x.t === 'red' ? '🔴 Red' : '🔵 Blue' }), h('b', { text: fmtPts(x.pts) })))) : null,
    ranked.length ? h('ol', { class: 'board-list' }, ranked.slice(0, limit).map((p, i) => h('li', { class: p.uid === me ? 'me' : '' },
      h('span', { class: 'pl', text: ['🥇', '🥈', '🥉'][i] || String(i + 1) }),
      avatarEl(p, big ? 34 : 24),
      r?.teams && p.team ? h('i', { class: 'dot ' + p.team }) : null,
      h('span', { class: 'nm', text: p.name }),
      p.left ? h('span', { class: 'left', title: 'Left the game tab during a try', text: '⚠×' + p.left }) : null,
      p.total ? h('span', { class: 'ok', text: `✅${p.correct || 0} ❌${p.misses || 0}` }) : null,
      h('b', { text: fmtPts(p.points) }))))
    : h('p', { class: 'muted', text: 'No players yet.' }));
}
function renderStrip(){
  const el = $('mpStrip');
  if (!G.mp || G.mp.hostOnly || !MP.code){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (boardHidden()){ el.replaceChildren(h('span', { text: '🙈 Scores hidden: last minute!' })); return; }
  el.replaceChildren(...rankedPlayers().slice(0, 10).map((p, i) =>
    h('span', { class: p.uid === myId() ? 'me' : '', text: `${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} ${p.name} ${fmtPts(p.points)}` })));
}
function renderBoard(){
  if (G.mp && MP.code){
    $('mpBoard').replaceChildren(h('div', { class: 'mpb-head' }, h('b', { text: '🏆 Live scores' }), h('span', { class: 'muted small', text: `Room ${MP.code} · ${MP.players.length} players` })), boardEl(40, G.mp.hostOnly));
    renderStrip(); mpHud();
  }
  if ($('overlay').classList.contains('hidden')) return;
  if (MP.modal === 'between' && G.phase === 'between') showBetween();
  else if (MP.modal === 'podium') showPodium();
}
// right-hand column: live scores (multiplayer) + translator (after the game)
function refreshSide(){
  const board = !!(G.mp && MP.code), tr = !$('transPanel').classList.contains('hidden');
  $('mpBoard').classList.toggle('hidden', !board);
  $('sideCol').classList.toggle('hidden', !(board || tr));
  $('gameGrid').classList.toggle('with-side', board || tr);
}
function mpGameLayout(){
  $('view-game').classList.toggle('host-only', !!G.mp?.hostOnly);
  $('mpPaused').classList.add('hidden');
  refreshSide();
  if (G.mp) renderBoard(); else $('mpStrip').classList.add('hidden');
}
function mpHud(){
  const mp = G.mp;
  $('ptsPill').classList.toggle('hidden', !mp || mp.hostOnly);
  if (!mp) return;
  if (!mp.hostOnly){
    const place = rankedPlayers().findIndex(p => p.uid === myId()) + 1;
    $('ptsPill').textContent = `⭐ ${fmtPts(MP.points)} pts` + (place && !boardHidden() ? ` · #${place}` : '');
  }
  const host = mp.role === 'host', r = MP.room;
  const over = !!(G.done && r?.status === 'final');      // after the podium (e.g. looking at the solution)
  $('podiumBtn').classList.toggle('hidden', !over);
  $('lobbyBtn').classList.toggle('hidden', !(over && host));
  $('endTryBtn').classList.toggle('hidden', !(host && G.phase === 'playing'));
  $('hintBtn').classList.toggle('hidden', mp.hostOnly || G.phase !== 'playing');
  if (!host && !G.done) $('npLock').textContent = '🎧 The host controls the song';
  if (r) $('tryPill').textContent = G.done ? '🏁 Finished' : r.format === 'playlist'
    ? `🎡 Song ${(r.played || []).length + 1}/${roundsOf(r)}` : `🔁 Try ${Math.min(G.tryNo, r.triesTotal)}/${r.triesTotal}`;
}

// ---------- points: +1 per word, −(host's choice) per wrong answer (a word solved with a hint gives 0) ----------
const MISS_OPTS = [0, 1, 2, 3, 5];
const missPts = r => MISS_OPTS.includes(r?.missPts) ? r.missPts : 1;
const missText = r => missPts(r) ? `−${missPts(r)} per wrong answer` : 'wrong answers cost nothing';
function mpScore(kind, g){
  if (!G.mp || G.mp.hostOnly || G.phase !== 'playing') return;
  let delta = 0;
  if (kind === 'ok') delta = head(g).hinted ? 0 : 1;
  else if (kind === 'hint') MP.hints++;
  else { MP.misses++; delta = -missPts(MP.room); }
  MP.points += delta;
  if (delta && g?.input) floatPts(g, delta);
  mpHud(); queuePlayerSync();
}
function floatPts(g, delta){
  const r = g.input.getBoundingClientRect();
  const el = h('div', { class: 'float-pts ' + (delta >= 0 ? 'up' : 'down'), text: (delta > 0 ? '+' : '') + delta });
  el.style.left = (r.left + r.width / 2 + scrollX) + 'px';
  el.style.top = (r.top + scrollY - 6) + 'px';
  document.body.append(el);
  setTimeout(() => el.remove(), 1100);
}
function mpLeft(){
  if (!G.mp || G.mp.hostOnly || G.phase !== 'playing' || !MP.code) return;
  MP.left++;
  cloud.setPlayer(MP.code, { left: MP.left }).catch(() => {});
}
const playerData = () => ({ points: MP.points, correct: G.gaps.length ? lockedCount() : 0, total: unitCount(), hints: MP.hints, misses: MP.misses, combo: MP.combo, left: MP.left, tries: G.tries.map(t => t.correct).slice(0, 20) });
function queuePlayerSync(){ clearTimeout(MP.syncT); MP.syncT = setTimeout(mpSyncNow, 1200); }
function mpSyncNow(){
  clearTimeout(MP.syncT);
  if (!MP.code || !G.mp || G.mp.hostOnly) return;
  cloud.setPlayer(MP.code, playerData()).catch(console.error);
}

// =====================================================================
// PWA: offline cache + install button
// =====================================================================
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW failed', e));
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').classList.remove('hidden'); });
$('installBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('installBtn').classList.add('hidden'); };

// =====================================================================
// boot
// =====================================================================
renderContinue();
renderPlaylist();
openShared();
function openJoinLink(){
  const m = location.hash.match(/^#join=([A-Za-z0-9]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  $('joinCode').value = m[1].toUpperCase();
  joinRoom(m[1]);
}
openJoinLink();
window.addEventListener('hashchange', openJoinLink);
window.addEventListener('hashchange', openShared);
