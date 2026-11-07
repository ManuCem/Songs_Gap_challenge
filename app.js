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
const FILLER = new Set('oh ooh ohh woah whoa yeah yea ya ah ahh uh hey la na da mmm mm hmm ay ayy eh huh yo'.split(' '));

const PRESETS = {
  easy:   { density: 20, minLen: 4, focus: 'content', firstLetter: true,  sizeBoxes: true,  desc: 'About 1 in 5 words, longer words only, with first-letter hints.' },
  medium: { density: 35, minLen: 3, focus: 'any',     firstLetter: false, sizeBoxes: true,  desc: 'About 1 in 3 words. Boxes show the word length.' },
  hard:   { density: 55, minLen: 2, focus: 'any',     firstLetter: false, sizeBoxes: false, desc: 'More than half the words, short ones too, and no length clues.' },
  insane: { density: 85, minLen: 1, focus: 'any',     firstLetter: false, sizeBoxes: false, desc: 'Almost every word is gone. Good luck. 🔥' },
};
const MODE_LABEL = { type: '✍️ Type', choice: '🎯 Choose', listen: '🎧 Listen-along' };
const PRESET_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', insane: 'Insane', custom: 'Custom' };

// split one word token into [prefix punctuation, word, suffix punctuation]
const TOKEN = /^([^\p{L}\p{N}']*)([\p{L}\p{N}'](?:.*[\p{L}\p{N}'])?)([^\p{L}\p{N}']*)$/u;

function isEligible(core, inParen, o){
  const w = norm(core);
  if (!w) return false;
  if (o.skipParens && inParen) return false;
  if (o.focus === 'small') return SMALL.has(w);
  const letters = (core.match(/[\p{L}\p{N}]/gu) || []).length;
  if (letters < o.minLen) return false;
  if (o.focus === 'content') return !SMALL.has(w) && !FILLER.has(w);
  return !FILLER.has(w) || o.minLen <= 1;
}

function parseLines(lines, o, force){
  const parsed = [], eligible = [];
  lines.forEach((ln, li) => {
    if (!ln.trim()){ parsed.push(null); return; }
    let inParen = false;
    const want = force ? new Set(force[li] || []) : null;
    parsed.push(ln.trim().split(/\s+/).map(raw => {
      if (raw.includes('(')) inParen = true;
      const wasParen = inParen;
      if (raw.includes(')')) inParen = false;
      const t = { raw, gap: false, line: li };
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
    const r = await fetch(`https://itunes.apple.com/search?entity=song&limit=1&term=${encodeURIComponent(artist + ' ' + title)}`);
    const j = await r.json();
    url = (j.results?.[0]?.artworkUrl100 || '').replace('100x100bb', '600x600bb');
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
applyTheme(store.get('theme', null));
$('themeBtn').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next); store.set('theme', next);
};

const VIEWS = ['play', 'setup', 'game', 'library', 'stats'];
let view = 'play';
function showView(v){
  if (view === 'game' && v !== 'game'){ pauseVideo(); saveProgress(); closeChoice(); }
  VIEWS.forEach(x => $('view-' + x).classList.toggle('hidden', x !== v));
  view = v;
  const navKey = (v === 'setup' || v === 'game') ? 'play' : v;
  document.querySelectorAll('#mainNav button').forEach(b => b.classList.toggle('on', b.dataset.view === navKey));
  $('bar').classList.toggle('hidden', v !== 'game');
  document.body.classList.toggle('in-game', v === 'game');
  const cover = v === 'setup' ? SETUP.song?.cover : v === 'game' ? G.s?.cover : '';
  setBackdrop(cover);
  if (v === 'play') renderContinue();
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
const QUICK = ['Adele Hello', 'Ed Sheeran Perfect', 'Coldplay Yellow', 'Bruno Mars Count on Me', 'Queen Bohemian Rhapsody', 'Imagine Dragons Believer', 'Taylor Swift Shake It Off', 'The Beatles Let It Be'];
QUICK.forEach(q => $('quickPicks').append(h('button', { class: 'chip', text: q, onclick: () => { $('searchInput').value = q; doSearch(q); } })));

let searchTimer = 0, searchSeq = 0;
$('searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2){ searchSeq++; $('searchResults').replaceChildren(); $('searchSpin').classList.add('hidden'); return; }
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
  .replace(/\s*[([][^)\]]*\b(feat|ft|with|remaster(ed)?|version|edit|live|mono|stereo|deluxe|bonus|explicit|clean|mix|from)\b[^)\]]*[)\]]/gi, '')
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
  return dedupe(await r.json()).map(j => ({ title: j.trackName, artist: j.artistName, album: j.albumName || '', duration: j.duration || 0, cover: '', thumb: '', year: '', lyr: Promise.resolve(j) }));
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
    for (const url of tries){
      try { const r = await fetch(url); if (!r.ok) continue; const best = pickBest(await r.json(), t.duration); if (best) return best; } catch {}
    }
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
      try { list = await itunesSearch(q); } catch (e){ console.warn(e); list = []; }
      if (!list.length) list = await lrclibSearch(q);
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
function renderResults(list, msg){
  const box = $('searchResults');
  if (!list.length){ box.replaceChildren(h('div', { class: 'empty', text: msg || 'No songs found. Try the artist + song name, or paste the lyrics yourself.' })); return; }
  box.replaceChildren(...list.map((t, i) => {
    const badge = h('span', { class: 'badge', text: '…' });
    const card = h('button', { class: 'result', style: `animation-delay:${i * 25}ms`, onclick: () => openTrack(t, card, badge) },
      tile(t.title, t.thumb),
      h('div', { class: 'r-info' },
        h('div', { class: 'r-title', text: t.title }),
        h('div', { class: 'r-sub', text: [t.artist, t.album, t.year].filter(Boolean).join(' · ') })),
      h('div', { class: 'r-meta' }, t.duration ? h('span', { text: fmtTime(t.duration) }) : null, badge));
    // check lyrics for the top results in the background so the badges fill in
    if (i < 6 || t.lyr) lyricsFor(t).then(j => lyricsBadge(badge, j));
    return card;
  }));
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
  const box = $('continueCard');
  let title, sub, go;
  if (G.active && !G.done){
    title = G.s.title; sub = `${filledCount()} / ${G.gaps.length} gaps · in progress`;
    go = () => showView('game');
  } else {
    const p = store.get('progress', null);
    if (!p || !p.s){ box.classList.add('hidden'); return; }
    title = p.s.title; sub = `${p.filled || 0} / ${p.total || '?'} gaps · ${timeAgo(new Date(p.at))}`;
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
  SETUP.mode = prefs.mode || 'type';
  SETUP.opts = { ...PRESETS.medium, skipParens: true, instant: true, ...(prefs.opts || {}) };
  if (SETUP.preset !== 'custom') Object.assign(SETUP.opts, PRESETS[SETUP.preset]);
  if (SETUP.mode === 'listen' && !song.times) SETUP.mode = 'type';

  $('setupTitle').textContent = song.title;
  $('setupArtist').textContent = [song.artist, song.album].filter(Boolean).join(' · ') || 'Your own lyrics';
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
  SETUP.music = prefs.music || 'audio';
  SETUP.custom = SETUP.yt = extra.yt || '';
  SETUP.pick = {};
  SETUP.cands = null;
  $('ytManual').open = false;
  $('ytInput').value = extra.yt ? 'https://youtu.be/' + extra.yt : '';
  SETUP.loading = false;
  if (SETUP.music !== 'off') loadMusic(song); else renderMusic();
  $('ytFind').href = `https://www.youtube.com/results?search_query=${encodeURIComponent([song.artist, song.title, 'lyrics'].filter(Boolean).join(' '))}`;
  const listenBtn = $('modeSeg').querySelector('[data-m=listen]');
  listenBtn.disabled = !song.times;
  $('listenDesc').textContent = song.times
    ? 'The song pauses after each line so you can fill it in.'
    : 'Only for songs with synced lyrics (⏱). Try another version of the song.';
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
  $('optParens').checked = !!o.skipParens; $('optInstant').checked = !!o.instant;
}
$('presetSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  SETUP.preset = b.dataset.p; Object.assign(SETUP.opts, PRESETS[SETUP.preset]); renderSetupControls();
});
$('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  SETUP.mode = b.dataset.m; renderSetupControls();
  if (SETUP.mode === 'listen' && SETUP.music === 'off') setMusic('audio');
});
const customize = (key, val) => { SETUP.opts[key] = val; SETUP.preset = 'custom'; renderSetupControls(); };
$('density').oninput = e => customize('density', +e.target.value);
$('minLen').oninput = e => customize('minLen', +e.target.value);
$('focusSel').onchange = e => customize('focus', e.target.value);
$('optFirst').onchange = e => customize('firstLetter', e.target.checked);
$('optSize').onchange = e => customize('sizeBoxes', e.target.checked);
$('optParens').onchange = e => { SETUP.opts.skipParens = e.target.checked; };
$('optInstant').onchange = e => { SETUP.opts.instant = e.target.checked; };
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

function ytSearch(q){
  if (ytCache.has(q)) return ytCache.get(q);
  const p = (async () => {
    if (YT_KEY){
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
        const r = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, { signal: timeoutSignal(7000) });
        if (!r.ok) continue;
        const items = ((await r.json()).items || [])
          .filter(i => i.type === 'stream' && /v=[\w-]{11}/.test(i.url) && !i.isShort && i.duration !== -1)
          .map(i => ({ id: i.url.match(/v=([\w-]{11})/)[1], title: i.title || '', channel: i.uploaderName || '', duration: i.duration > 0 ? i.duration : 0 }));
        if (items.length){ PIPED.splice(PIPED.indexOf(base), 1); PIPED.unshift(base); return items; }   // remember the server that works
      } catch {}
    }
    throw new Error('No YouTube search available');
  })();
  ytCache.set(q, p);
  p.catch(() => ytCache.delete(q));
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
    const list = await ytSearch(q);
    if (SETUP.song !== song) return;
    SETUP.cands = list.map((c, i) => ({ ...c, i, kind: ytKind(c) }));
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
  return rankFor(match.length ? match : SETUP.cands, kind, SETUP.song.duration, SETUP.song.title);
}
const autoPick = k => SETUP.pick[k] || rankedCands(k)[0]?.id || SETUP.custom || '';
function setMusic(k){
  SETUP.music = k;
  if (k !== 'off'){
    if (SETUP.cands === null && !SETUP.loading) loadMusic(SETUP.song);
    else SETUP.yt = autoPick(k);
  }
  renderMusic();
}
function renderMusic(){
  const k = SETUP.music;
  $('musicSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('musicHint').textContent = {
    audio: '🎧 Plays the official audio (only the album cover is shown). This syncs best with the karaoke.',
    video: '🎬 Plays the music video. Clips sometimes have an intro, so use the sync buttons if the lyrics run early.',
    off: '🔇 No music. You can still play, but the lyrics won’t follow the song.'
  }[k];
  const box = $('ytPicks');
  $('ytManual').classList.toggle('hidden', k === 'off');
  if (k === 'off'){ box.replaceChildren(); return; }
  if (SETUP.cands === null){ box.replaceChildren(h('div', { class: 'yt-loading' }, h('span', { class: 'spinner' }), 'Finding the song on YouTube…')); return; }
  const list = rankedCands(k).slice(0, 4);
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
  if (SETUP.music === 'off') SETUP.music = 'video';
  SETUP.yt = SETUP.custom = SETUP.pick[SETUP.music] = id;
  renderMusic();
});

$('startBtn').onclick = () => {
  const song = SETUP.song;
  const raw = $('ytInput').value.trim();
  if (raw && !ytId(raw) && SETUP.music !== 'off'){ toast('That doesn’t look like a YouTube link.'); $('ytManual').open = true; $('ytInput').focus(); return; }
  const yt = SETUP.music === 'off' ? '' : SETUP.yt;
  if (SETUP.mode === 'listen' && !yt){
    toast(SETUP.cands === null ? 'Still looking for the song on YouTube… one second.' : 'Listen-along needs music: pick a video or paste a YouTube link.');
    return;
  }
  store.set('prefs', { preset: SETUP.preset, mode: SETUP.mode, opts: SETUP.opts, music: SETUP.music });
  const { opts } = SETUP;
  const alts = Array.isArray(SETUP.cands)
    ? { audio: rankedCands('audio').slice(0, 4).map(c => c.id), video: rankedCands('video').slice(0, 4).map(c => c.id) }
    : null;
  startGame({
    src: song.src, id: song.id || '', title: song.title, artist: song.artist || '', cover: song.cover || '',
    lines: song.lines, times: song.times, preset: SETUP.preset, mode: SETUP.mode,
    opts: { density: opts.density, minLen: opts.minLen, focus: opts.focus, firstLetter: opts.firstLetter, sizeBoxes: opts.sizeBoxes, skipParens: opts.skipParens, instant: opts.instant },
    seed: newSeed(), yt, music: yt ? SETUP.music : 'off', ytAlts: alts, offset: SETUP.offset
  });
};

// =====================================================================
// game
// =====================================================================
const G = {
  s: null, parsed: [], gaps: [], lineEls: [], solEls: [], lineGaps: [],
  seconds: 0, hints: 0, session: '', active: false, done: false, bonus: false, played: false, peeked: false,
  focus: null, wait: -1, passed: new Set(), cur: -1
};
const filledCount = () => G.gaps.filter(g => g.locked || g.input.value.trim()).length;

function buildPool(parsed){
  const seen = new Set(), pool = [];
  parsed.forEach(toks => toks && toks.forEach(t => {
    if (!t.core) return;
    const n = norm(t.core);
    if (n.length < 2 || seen.has(n) || FILLER.has(n)) return;
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

function startGame(s, restore){
  const { parsed, eligible } = parseLines(s.lines, s.opts, s.force);
  if (!eligible.length){ toast('No words to hide with these settings. Try a lower minimum length.'); return false; }
  const rand = rng(s.seed);
  if (s.force) eligible.forEach(t => t.gap = true);
  else {
    const n = Math.max(1, Math.round(eligible.length * s.opts.density / 100));
    shuffle(eligible.map((_, i) => i), rand).slice(0, n).forEach(i => eligible[i].gap = true);
  }
  const pool = s.mode === 'choice' ? buildPool(parsed) : null;

  destroyPlayer();
  Object.assign(G, {
    s, parsed, gaps: [], lineEls: [], solEls: [], lineGaps: [],
    seconds: restore?.seconds || 0, hints: restore?.hints || 0,
    session: restore?.session || (Date.now().toString(36) + newSeed()),
    active: true, done: false, bonus: false, played: !!restore?.played, peeked: false,
    focus: null, wait: -1, passed: new Set(), cur: -1, badYt: new Set()
  });
  s.music ||= s.yt ? 'video' : 'off';

  const box = $('lyrics'), solBox = $('solution');
  box.replaceChildren(); solBox.replaceChildren();
  parsed.forEach((toks, li) => {
    const d = h('div', { class: 'line' }), sd = h('div', { class: 'line' });
    G.lineGaps.push([]);
    if (!toks){ d.className = sd.className = 'line blank'; }
    else toks.forEach(t => {
      if (!t.gap){ d.append(t.raw + ' '); sd.append(t.raw + ' '); return; }
      const g = { i: G.gaps.length, line: li, answer: t.core, locked: false, hinted: false, xp: false, wrong: null };
      if (s.mode === 'choice') g.options = makeOptions(t.core, pool, rand);
      // solution view
      if (t.pre) sd.append(t.pre);
      g.sol = h('span', { class: 'sol miss', text: t.core });
      sd.append(g.sol, (t.suf || '') + ' ');
      // challenge view
      const inp = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', autocorrect: 'off', 'aria-label': 'Missing word' });
      const w = s.mode === 'choice' ? Math.max(...g.options.map(o => o.length)) : (s.opts.sizeBoxes ? t.core.length : 8);
      inp.style.width = (Math.max(3, w) + 1.6) + 'ch';
      if (s.opts.firstLetter) inp.placeholder = t.core[0];
      if (s.mode === 'choice'){ inp.readOnly = true; inp.classList.add('choice'); if (!s.opts.firstLetter) inp.placeholder = '▾'; }
      g.input = inp;
      inp.addEventListener('focus', () => { G.focus = g; if (s.mode === 'choice' && !g.locked) openChoice(g); });
      inp.addEventListener('click', () => { if (s.mode === 'choice' && !g.locked) openChoice(g); });
      inp.addEventListener('blur', () => setTimeout(() => { if (G.choiceFor === g && document.activeElement !== inp) closeChoice(); }, 150));
      inp.addEventListener('input', () => onGapInput(g));
      inp.addEventListener('keydown', e => onGapKey(e, g));
      d.append(h('span', { class: 'gap' }, t.pre || '', inp, (t.suf || '') + ' '));
      G.gaps.push(g); G.lineGaps[li].push(g);
    });
    if (s.times && s.yt && toks){
      d.classList.add('seek'); sd.classList.add('seek');
      const seek = e => { if (e.target.tagName !== 'INPUT') seekLine(li); };
      d.addEventListener('click', seek); sd.addEventListener('click', seek);
    }
    box.append(d); solBox.append(sd);
    G.lineEls.push(d); G.solEls.push(sd);
  });

  if (restore){
    G.gaps.forEach((g, i) => {
      if (restore.hinted?.[i]) g.hinted = true;
      if (restore.locked?.[i]){ lockGap(g, true); g.xp = true; }
      else if (restore.answers?.[i]) g.input.value = restore.answers[i];
    });
  }

  // header
  $('gameTitle').textContent = s.title;
  $('gameArtist').textContent = [s.artist, PRESET_LABEL[s.preset]].filter(Boolean).join(' · ');
  $('gameCover').replaceChildren(tile(s.title, s.cover, 'md'));
  $('modePill').textContent = MODE_LABEL[s.mode];
  $('saveSongBtn').classList.toggle('hidden', s.src === 'practice');
  $('shareBtn').classList.toggle('hidden', s.src === 'practice');
  refreshSaveBtn();
  $('keysHint').textContent = s.mode === 'choice'
    ? 'Click a gap (or Tab to it) and press 1–4 to choose · Ctrl+Enter → check'
    : 'Enter/Tab → next gap · ? → hint · Ctrl+Enter → check' + (s.yt ? ' · Alt+1 back 5s · Alt+2 play/pause · Alt+3 replay line' : '');
  $('contBtn').classList.add('hidden');
  $('hintBtn').disabled = false;

  setupPlayer(s.yt);
  showTab('challenge');
  updateProgress();
  showView('game');
  if (!s.cover && s.src !== 'paste' && s.src !== 'practice'){
    findCover(s.title, s.artist).then(url => {
      if (!url || G.s !== s) return;
      s.cover = url; $('gameCover').replaceChildren(tile(s.title, url, 'md'));
      if (view === 'game') setBackdrop(url);
    });
  }
  if (s.mode !== 'listen') focusNext(-1);
  saveProgress();
  return true;
}

function updateProgress(){
  const filled = filledCount(), total = G.gaps.length;
  const locked = G.gaps.filter(g => g.locked).length;
  $('progress').textContent = `${locked} correct · ${filled} / ${total} filled`;
  $('pfill').style.width = (total ? filled / total * 100 : 0) + '%';
  $('hintVal').textContent = G.hints;
  $('timerVal').textContent = fmtTime(G.seconds);
}

function lockGap(g, silent){
  g.locked = true;
  g.input.value = g.answer;
  g.input.classList.remove('bad');
  g.input.classList.add('ok');
  if (!silent){ g.input.classList.remove('pop'); void g.input.offsetWidth; g.input.classList.add('pop'); }
  g.input.readOnly = true;
  g.input.tabIndex = -1;
  if (G.choiceFor === g) closeChoice();
}
function flashBad(g){ g.input.classList.remove('bad'); void g.input.offsetWidth; g.input.classList.add('bad'); }

function focusNext(from){
  for (let i = from + 1; i < G.gaps.length; i++){
    if (!G.gaps[i].locked){ G.gaps[i].input.focus({ preventScroll: false }); return true; }
  }
  return false;
}

function onGapInput(g){
  g.input.classList.remove('bad');
  if (G.s.opts.instant && !g.locked && same(g.input.value.trim(), g.answer)) lockGap(g);
  afterChange(g);
}
function afterChange(g){
  updateProgress();
  queueSave();
  if (G.s.mode === 'listen' && G.wait === g.line && G.lineGaps[g.line].every(x => x.locked)) continueListen();
  if (G.gaps.every(x => x.locked) && !G.done && !G.finishing){
    G.finishing = true;
    setTimeout(() => { G.finishing = false; if (!G.done) finishRound(); }, 250);
  }
}
function onGapKey(e, g){
  if (e.key === 'Enter'){
    e.preventDefault();
    if (e.ctrlKey || e.metaKey){ check(); return; }
    if (G.s.mode === 'listen' && G.wait === g.line && G.lineGaps[g.line].every(x => x.locked || x.input.value.trim())){ continueListen(); return; }
    if (!focusNext(g.i)) $('checkBtn').focus();
    return;
  }
  if (e.key === '?'){ e.preventDefault(); hint(g); return; }
  if (G.s.mode === 'choice' && /^[1-4]$/.test(e.key)){ e.preventDefault(); pickChoice(g, +e.key - 1); return; }
  if (e.key === 'Escape') closeChoice();
}

// ---------- multiple choice popover ----------
function openChoice(g){
  const pop = $('choicePop');
  pop.replaceChildren(...g.options.map((o, i) => {
    const b = h('button', { type: 'button', role: 'option' }, h('kbd', { text: String(i + 1) }), o);
    b.disabled = !!g.wrong?.has(i);
    b.addEventListener('mousedown', e => e.preventDefault());   // keep focus on the gap
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
  if (g.locked || !g.options[i] || g.wrong?.has(i)) return;
  const o = g.options[i];
  g.input.value = o;
  if (G.s.opts.instant){
    if (same(o, g.answer)){ lockGap(g); afterChange(g); focusNext(g.i); }
    else { (g.wrong ||= new Set()).add(i); flashBad(g); openChoice(g); afterChange(g); }
  } else {
    closeChoice(); afterChange(g);
    if (!focusNext(g.i)) $('checkBtn').focus();
  }
}
window.addEventListener('resize', closeChoice);
document.addEventListener('mousedown', e => {
  if (G.choiceFor && !$('choicePop').contains(e.target) && e.target !== G.choiceFor.input) closeChoice();
});

// ---------- hints ----------
function hint(g){
  g = g && !g.locked ? g : (G.focus && !G.focus.locked ? G.focus : G.gaps.find(x => !x.locked));
  if (!g || G.done) return;
  G.hints++; g.hinted = true;
  if (G.s.mode === 'choice'){
    const wrongIdx = g.options.map((o, i) => i).filter(i => !same(g.options[i], g.answer) && !g.wrong?.has(i));
    if (wrongIdx.length){ (g.wrong ||= new Set()).add(wrongIdx[0]); }
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
  updateProgress();
}

// ---------- check & results ----------
function check(){
  if (!G.active) return;
  closeChoice();
  showTab('challenge');
  G.gaps.forEach(g => {
    if (g.locked) return;
    const v = g.input.value.trim();
    if (v && same(v, g.answer)) lockGap(g); else flashBad(g);
  });
  updateProgress();
  finishRound();
}

function finishRound(){
  if (!G.active) return;
  const total = G.gaps.length;
  const correct = G.gaps.filter(g => g.locked).length;
  const perfect = correct === total;
  const pct = Math.round(correct / total * 100);
  // XP: 10 per word (3 if you used a hint), only once per word + bonus for perfect rounds
  let xp = 0;
  G.gaps.forEach(g => { if (g.locked && !g.xp){ g.xp = true; xp += g.hinted ? 3 : 10; } });
  if (perfect && !G.bonus){ G.bonus = true; xp += 50 + ({ hard: 50, insane: 100 }[G.s.preset] || 0); }
  if (perfect){
    G.done = true; store.del('progress');
    pauseVideo();
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) confetti();
  } else saveProgress();

  const missed = G.gaps.filter(g => !g.locked);
  const detail = {
    title: G.s.title.slice(0, 200), artist: (G.s.artist || '').slice(0, 200), songId: G.s.src === 'lrclib' ? G.s.id : '',
    correct, total, pct, mode: G.s.mode, preset: G.s.preset, seconds: G.seconds, hints: G.hints,
    missed: missed.map(g => g.answer).slice(0, 200),
    missedPairs: missed.slice(0, 100).map(g => ({ w: g.answer, l: G.s.lines[g.line].slice(0, 300) }))
  };
  showResult(detail, xp, perfect);
  syncAttempt(detail, xp);
}

function showResult(d, xp, perfect){
  const msg = perfect ? (G.hints ? '🎉 All done!' : '🏆 Perfect score!') : d.pct >= 70 ? '🔥 Almost there!' : d.pct >= 40 ? '💪 Good start!' : '🎧 Keep listening!';
  const mk = (label, cls, fn) => h('button', { class: 'btn ' + cls, text: label, onclick: () => { closeModal(); fn(); } });
  const btns = perfect
    ? [mk('🔁 Play again with new gaps', 'primary', restart), mk('♪ Choose another song', '', () => showView('play')), mk('👁 See the solution', '', () => showTab('solution'))]
    : [mk('✏️ Fix the wrong ones', 'primary', () => { const f = G.gaps.find(g => !g.locked); if (f){ f.input.focus(); f.input.select?.(); f.input.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }),
       mk('👁 See the solution', '', () => showTab('solution')),
       mk('↺ Restart with new gaps', '', restart)];
  openModal(
    h('h2', { text: msg }),
    h('div', { class: 'ring', style: `--p:${d.pct}` }, h('div', null, h('span', { text: `${d.correct}/${d.total}` }), h('small', { text: d.pct + '%' }))),
    h('div', { class: 'res-stats' },
      h('span', { class: 'pill', text: '⏱ ' + fmtTime(d.seconds) }),
      h('span', { class: 'pill', text: '💡 ' + d.hints + (d.hints === 1 ? ' hint' : ' hints') }),
      xp ? h('span', { class: 'pill', text: `⭐ +${xp} XP` }) : null),
    h('p', { class: 'save-note', id: 'saveNote' }),
    h('div', { class: 'lb hidden', id: 'lbBox' }),
    h('div', { class: 'btns' }, btns));
}

function boardKey(s){
  if (s.src !== 'lrclib' || s.preset === 'custom') return null;
  return `${s.id}_${s.preset}_${s.mode === 'choice' ? 'c' : 't'}`;
}

async function syncAttempt(detail, xp){
  const note = () => $('saveNote');
  if (!cloud || !cloud.state.user){
    if (note()) note().textContent = 'Sign in to save your progress, earn XP and join the leaderboard.';
    return;
  }
  if (note()) note().textContent = 'Saving…';
  try {
    await cloud.saveResult(G.session, detail);
    if (xp > 0) await cloud.addXp(xp);
    const key = songKey(G.s), lib = cloud.state.library.get(key);
    if (lib) await cloud.updateSong(key, { best: Math.max(lib.best || 0, detail.pct), plays: (lib.plays || 0) + (G.played ? 0 : 1) });
    G.played = true;
    if (note()) note().textContent = '✓ Saved to your stats' + (xp ? ` · +${xp} XP` : '');
  } catch (e){ console.error(e); if (note()) note().textContent = 'Could not save this result.'; }

  const board = boardKey(G.s);
  if (!board) return;
  try {
    if (!G.peeked && detail.pct > 0) await cloud.submitScore(board, detail.pct, detail.seconds);
    const top = await cloud.topScores(board);
    const box = $('lbBox');
    if (!box || !top.length) return;
    box.replaceChildren(
      h('h4', { text: `🏆 Leaderboard · ${PRESET_LABEL[G.s.preset]} · ${G.s.mode === 'choice' ? 'Choose' : 'Type'}` }),
      h('ol', null, top.map(r => h('li', { class: r.me ? 'me' : '' }, h('span', { text: r.name + (r.me ? ' (you)' : '') }), h('b', { text: r.pct + '%' }), h('em', { text: fmtTime(r.seconds) })))),
      G.peeked ? h('p', { class: 'hint', text: 'Scores after looking at the solution don’t count for the leaderboard.' }) : null);
    box.classList.remove('hidden');
  } catch (e){ console.error(e); }
}

// ---------- tabs: the solution is a separate view, answers are never erased ----------
function refreshSolution(){
  G.gaps.forEach(g => {
    const attempt = g.input.value.trim();
    const ok = g.locked || (attempt && same(attempt, g.answer));
    g.sol.className = 'sol ' + (ok ? 'ok' : 'miss');
    g.sol.title = ok ? 'Correct' : (attempt ? `You wrote: ${attempt}` : 'Left empty');
  });
}
function showTab(name){
  const sol = name === 'solution';
  if (sol){ refreshSolution(); closeChoice(); if (!G.done) G.peeked = true; }
  $('challengePane').classList.toggle('hidden', sol);
  $('solutionPane').classList.toggle('hidden', !sol);
  $('tabChallenge').classList.toggle('on', !sol);
  $('tabSolution').classList.toggle('on', sol);
  $('tabChallenge').setAttribute('aria-selected', String(!sol));
  $('tabSolution').setAttribute('aria-selected', String(sol));
}
$('tabChallenge').onclick = () => showTab('challenge');
$('tabSolution').onclick = () => showTab('solution');

// ---------- timer & autosave ----------
setInterval(() => {
  if (!G.active || G.done || view !== 'game' || document.hidden || !$('overlay').classList.contains('hidden')) return;
  G.seconds++;
  $('timerVal').textContent = fmtTime(G.seconds);
  if (G.seconds % 10 === 0) saveProgress();
}, 1000);

function saveProgress(){
  if (!G.active || G.done) return;
  store.set('progress', {
    s: G.s, session: G.session, seconds: G.seconds, hints: G.hints, played: G.played, at: Date.now(),
    answers: G.gaps.map(g => g.locked ? '' : g.input.value),
    locked: G.gaps.map(g => g.locked ? 1 : 0),
    hinted: G.gaps.map(g => g.hinted ? 1 : 0),
    filled: filledCount(), total: G.gaps.length
  });
}
let saveT = 0;
const queueSave = () => { clearTimeout(saveT); saveT = setTimeout(saveProgress, 500); };
window.addEventListener('pagehide', saveProgress);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });

// ---------- controls ----------
function restart(){
  if (!G.s) return;
  store.del('progress');
  startGame({ ...G.s, seed: newSeed() });
}
$('checkBtn').onclick = check;
$('hintBtn').onclick = () => hint(G.focus);
$('restartBtn').onclick = () => { if (G.done || confirm('Start over with new random gaps?')) restart(); };
$('newBtn').onclick = () => showView('play');
$('contBtn').onclick = continueListen;

// =====================================================================
// YouTube player + karaoke sync + listen-along
// =====================================================================
let player = null, playerReady = false, pollT = 0, ytPromise = null, playerToken = 0;
const SPEEDS = [1, 0.75, 0.5];
function loadYT(){
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return ytPromise ||= new Promise(res => {
    window.onYouTubeIframeAPIReady = () => res(window.YT);
    document.head.append(h('script', { src: 'https://www.youtube.com/iframe_api' }));
  });
}
function applyMusicLayout(){
  const s = G.s, audio = s.music === 'audio';
  $('gameGrid').classList.toggle('audio', audio);
  const canSwitch = !!(s.yt && s.ytAlts?.audio?.length && s.ytAlts?.video?.length);
  $('kindBtn').classList.toggle('hidden', !canSwitch);
  $('kindBtn').replaceChildren(audio ? '🎬 ' : '🎧 ', h('span', { class: 'lbl', text: audio ? 'Clip' : 'Audio' }));
  $('kindBtn').title = audio ? 'Switch to the music video' : 'Switch to the audio only';
}
$('kindBtn').onclick = () => {
  const s = G.s, next = s.music === 'audio' ? 'video' : 'audio';
  const id = s.ytAlts?.[next]?.find(x => !G.badYt.has(x));
  if (!id || !playerReady) return;
  (s.offsets ||= {})[s.music] = s.offset || 0;      // each version keeps its own sync offset
  s.music = next; s.yt = id; s.offset = s.offsets[next] ?? 0;
  $('offVal').textContent = s.offset.toFixed(1) + 's';
  const start = s.times && G.cur >= 0 ? Math.max(0, lineTime(G.cur) - 0.5) : 0;
  player.loadVideoById({ videoId: id, startSeconds: start });
  G.cur = -2;
  applyMusicLayout(); queueSave();
  toast(next === 'audio' ? '🎧 Switched to the audio' : '🎬 Switched to the video clip. Use the sync buttons if the lyrics run early.');
};
function onPlayerError(e){
  const s = G.s;
  G.badYt.add(s.yt);
  const next = (s.ytAlts?.[s.music] || []).find(x => !G.badYt.has(x));
  if (next && e.data !== 2){
    s.yt = next;
    toast('That video can’t be played here. Trying another one…');
    player.loadVideoById(next);
  } else {
    toast('This video won’t play here. If you opened the app inside VS Code, use Chrome or Edge instead.');
  }
}

async function setupPlayer(id){
  const has = !!id;
  $('playerCol').classList.toggle('hidden', !has);
  $('gameGrid').classList.toggle('with-player', has);
  applyMusicLayout();
  $('mediaCtrls').classList.toggle('hidden', !has);
  $('syncBox').classList.toggle('hidden', !(has && G.s.times));
  $('offVal').textContent = (G.s.offset || 0).toFixed(1) + 's';
  $('speedBtn').textContent = '1×';
  $('playBtn').textContent = '▶';
  if (!has) return;
  const token = ++playerToken;
  $('playerHost').replaceChildren(h('div', { id: 'ytPlayer' }));
  const YT = await loadYT();
  if (token !== playerToken) return;   // a newer game replaced this player while the API was loading
  player = new YT.Player('ytPlayer', {
    videoId: id, width: '100%', height: '100%',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => { playerReady = true; },
      onError: onPlayerError,
      onStateChange: e => {
        $('playBtn').textContent = e.data === 1 ? '⏸' : '▶';
        if (e.data === 1 && G.wait >= 0) continueListen(true);
        if (e.data === 0 && G.s.mode === 'listen' && !G.done) toast('🎵 Song finished! Press “Check answers”.');
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
const playing = () => playerReady && player.getPlayerState?.() === 1;
function pauseVideo(){ try { if (playerReady) player.pauseVideo(); } catch {} }
function playVideo(){ try { if (playerReady) player.playVideo(); } catch {} }
const lineTime = li => G.s.times[li] + (G.s.offset || 0);

function poll(){
  if (!playerReady || !G.s?.times || !G.active) return;
  const t = player.getCurrentTime();
  const times = G.s.times;
  let cur = -1;
  for (let i = 0; i < times.length; i++){ if (lineTime(i) <= t + 0.05) cur = i; else break; }

  // listen-along: pause right before the next line if this one still has gaps to fill
  // (checks the current line and the one just finished, in case a poll tick was missed)
  if (G.s.mode === 'listen' && G.wait < 0 && cur >= 0 && player.getPlayerState() === 1){
    const endOf = i => i + 1 < times.length ? lineTime(i + 1) : lineTime(i) + 6;
    for (const L of [cur - 1, cur]){
      if (L < 0) continue;
      const end = endOf(L);
      if (t >= end - 0.25 && t < end + 1.2 && !G.passed.has(L) && G.lineGaps[L].some(g => !g.locked)){
        player.pauseVideo();
        G.wait = L;
        G.lineEls[L].classList.add('wait');
        $('contBtn').classList.remove('hidden');
        G.lineGaps[L].find(g => !g.locked)?.input.focus({ preventScroll: true });
        G.lineEls[L].scrollIntoView({ block: 'center', behavior: 'smooth' });
        break;
      }
    }
  }

  if (cur !== G.cur){
    G.lineEls[G.cur]?.classList.remove('now'); G.solEls[G.cur]?.classList.remove('now');
    G.cur = cur;
    if (cur < 0) return;
    G.lineEls[cur].classList.add('now'); G.solEls[cur].classList.add('now');
    if ($('followChk').checked && G.wait < 0){
      const el = $('solutionPane').classList.contains('hidden') ? G.lineEls[cur] : G.solEls[cur];
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight * 0.25 || r.bottom > innerHeight * 0.7) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

function continueListen(fromPlay){
  const L = G.wait;
  if (L < 0){ if (!fromPlay) playVideo(); return; }
  G.lineGaps[L].forEach(g => {
    if (g.locked) return;
    const v = g.input.value.trim();
    if (v && same(v, g.answer)) lockGap(g); else flashBad(g);
  });
  G.passed.add(L);
  G.wait = -1;
  G.lineEls[L].classList.remove('wait');
  $('contBtn').classList.add('hidden');
  document.activeElement?.blur?.();
  updateProgress(); queueSave();
  if (G.gaps.every(g => g.locked)){ finishRound(); return; }
  if (!fromPlay) playVideo();
}
function seekLine(li){
  if (!playerReady || !G.s.times) return;
  G.passed.delete(li);
  if (G.wait >= 0){ G.lineEls[G.wait].classList.remove('wait'); G.wait = -1; $('contBtn').classList.add('hidden'); }
  player.seekTo(Math.max(0, lineTime(li) - 0.3), true);
  playVideo();
}
function replayLine(){
  if (!playerReady) return;
  if (!G.s.times){ player.seekTo(Math.max(0, player.getCurrentTime() - 5), true); playVideo(); return; }
  seekLine(G.wait >= 0 ? G.wait : Math.max(0, G.cur));
}
function rewind(){ if (playerReady){ player.seekTo(Math.max(0, player.getCurrentTime() - 5), true); } }
function togglePlay(){
  if (!playerReady) return;
  if (G.wait >= 0){ continueListen(); return; }
  playing() ? player.pauseVideo() : player.playVideo();
}
$('rewBtn').onclick = rewind;
$('playBtn').onclick = togglePlay;
$('lineBtn').onclick = replayLine;
$('speedBtn').onclick = () => {
  if (!playerReady) return;
  const cur = player.getPlaybackRate();
  const next = SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length] || 1;
  player.setPlaybackRate(next);
  $('speedBtn').textContent = next + '×';
};
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

// global shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){ closeModal(); closeChoice(); $('userMenu').classList.add('hidden'); }
  if (view !== 'game') return;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); check(); }
  if (e.altKey && !e.ctrlKey && ['1', '2', '3'].includes(e.key)){
    e.preventDefault();
    ({ 1: rewind, 2: togglePlay, 3: replayLine })[e.key]();
  }
});

// =====================================================================
// share link, print worksheet
// =====================================================================
function shareUrl(){
  const s = G.s;
  const p = { p: s.preset, o: s.opts, m: s.mode, sd: s.seed, yt: s.yt || undefined, mu: s.yt ? s.music : undefined, of: s.offset || undefined, t: s.title, a: s.artist };
  if (s.src === 'lrclib') p.id = s.id; else p.l = s.lines;
  return location.origin + location.pathname + '#c=' + b64enc(JSON.stringify(p));
}
$('shareBtn').onclick = async () => {
  const url = shareUrl();
  const text = `🎵 Can you beat me? Fill in the missing lyrics of “${G.s.title}”`;
  if (navigator.share){ try { await navigator.share({ title: 'Lyrics Gap Challenge', text, url }); return; } catch (e){ if (e.name === 'AbortError') return; } }
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
    music: p.yt ? (p.mu || 'video') : 'off',
    preset: p.o ? (p.p || 'custom') : 'medium', mode: (p.m === 'listen' && !(song.times && p.yt)) ? 'type' : (p.m || 'type'),
    opts: p.o || { ...PRESETS.medium, skipParens: true, instant: true }, seed: p.sd || newSeed(), yt: p.yt || '', offset: p.of || 0 };
  if (song.src !== 'paste') findCover(song.title, song.artist).then(u => { s.cover = u; });
  openModal(
    h('div', { style: 'font-size:2.6rem' }, '🎵'),
    h('h2', { text: 'You’ve been challenged!' }),
    h('p', { class: 'muted', text: `“${s.title}”${s.artist ? ' by ' + s.artist : ''}` }),
    h('div', { class: 'res-stats' }, h('span', { class: 'pill', text: PRESET_LABEL[s.preset] || 'Custom' }), h('span', { class: 'pill', text: MODE_LABEL[s.mode] })),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', text: 'Start the challenge →', onclick: () => { closeModal(); startGame(s); } }),
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
function openModal(...nodes){
  $('modal').replaceChildren(...nodes);
  $('overlay').classList.remove('hidden');
  $('modal').querySelector('button')?.focus();
}
function closeModal(){ $('overlay').classList.add('hidden'); }
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
const signedIn = () => !!cloud?.state.user;
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
  const u = st.user;
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
import('./cloud.js').then(m => { cloud = m; m.onChange(onCloud); }).catch(e => console.warn('Cloud features unavailable:', e));

function wall(emoji, title, text){
  return h('div', { class: 'card wall' }, h('div', { class: 'big-emoji', text: emoji }), h('h3', { text: title }), h('p', { text }),
    h('button', { class: 'btn dark', text: 'Sign in with Google', onclick: doSignIn }));
}

// ---------- library ----------
function refreshSaveBtn(){
  const b = $('saveSongBtn');
  const saved = !!(G.s && cloud?.state.library.has(songKey(G.s)));
  b.textContent = saved ? '♥' : '♡';
  b.classList.toggle('saved', saved);
  b.title = saved ? 'Saved in your library (click to remove)' : 'Save to your library';
}
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
        onclick: () => { if (confirm(`Remove “${it.title}” from your library?`)) cloud.removeSong(it.key).catch(console.error); } })));
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
    h('div', { class: 'kpis' },
      kpi('🔥 ' + liveStreak(p), 'day streak'),
      kpi(String(results.length), 'challenges played'),
      kpi(avg + '%', 'average accuracy'),
      kpi(String(perfects), 'perfect scores')),
    h('div', { class: 'stats-grid' },
      h('div', { class: 'card chart' }, h('h3', { text: 'Accuracy, last 20 challenges' }), results.length ? chart(results.slice(0, 20).reverse()) : h('p', { class: 'muted', text: 'Play a song to see your chart.' })),
      h('div', { class: 'card' },
        h('h3', { text: 'Words you miss most' }),
        top.length ? h('div', { class: 'words' }, top.map(([w, n]) => h('span', { class: 'word' }, w, n > 1 ? h('small', { text: '×' + n }) : null)))
                   : h('p', { class: 'muted', text: 'No mistakes yet. Impressive!' }),
        h('button', { class: 'btn primary full', text: '🎯 Practise my mistakes', disabled: !top.length, onclick: startPractice }))),
    h('div', { class: 'card', style: 'margin-top:12px' },
      h('h3', { text: 'Recent challenges' }),
      results.length ? h('ul', { class: 'recent' }, results.slice(0, 12).map(r => h('li', null,
        h('span', { class: 't', text: r.title + (r.artist ? ' · ' + r.artist : '') }),
        r.preset ? h('span', { class: 'badge', text: (PRESET_LABEL[r.preset] || r.preset).toUpperCase() }) : null,
        h('span', { class: 'p', text: r.pct + '%' }),
        h('span', { class: 'd', text: timeAgo(toDate(r.updatedAt)) }))))
      : h('p', { class: 'muted', text: 'Nothing yet. Your results appear here after you press “Check answers”.' })));
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
function startPractice(){
  const lines = [], force = [], seen = new Set();
  for (const r of cloud.state.results){
    for (const p of r.missedPairs || []){
      if (!p.l || !p.w) continue;
      const i = lines.indexOf(p.l);
      if (i >= 0){ force[i].push(norm(p.w)); continue; }
      if (lines.length >= 30 || seen.has(p.l)) continue;
      seen.add(p.l); lines.push(p.l); force.push([norm(p.w)]);
    }
  }
  if (!lines.length){ toast('Play a few songs first. Your mistakes will show up here.'); return; }
  startGame({
    src: 'practice', id: '', title: 'Practice: my mistakes', artist: `${lines.length} lines from your recent songs`, cover: '',
    lines, times: null, force, preset: 'custom', mode: 'type',
    opts: { density: 100, minLen: 1, focus: 'any', firstLetter: false, sizeBoxes: true, skipParens: false, instant: true },
    seed: newSeed(), yt: '', offset: 0
  });
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
openShared();
window.addEventListener('hashchange', openShared);
