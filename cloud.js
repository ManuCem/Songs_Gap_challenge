// Firebase: Google login, results, XP/streak, library and leaderboards.
// Loaded lazily by app.js — if this file fails to load, the game still works offline.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp, collection, query, orderBy, limit, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Public web config (safe to publish; access is controlled by the Firestore security rules)
const firebaseConfig = {
  apiKey: "AIzaSyCO-h9HEdWHU0ehSIIWEErONYolxCNiPYA",
  authDomain: "lyrics-gap-challenge.firebaseapp.com",
  projectId: "lyrics-gap-challenge",
  storageBucket: "lyrics-gap-challenge.firebasestorage.app",
  messagingSenderId: "651059037021",
  appId: "1:651059037021:web:3e6a3781f07ab2ad9adeb4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export const state = { ready: false, user: null, profile: null, results: [], library: new Map() };
const listeners = new Set();
export function onChange(fn){ listeners.add(fn); if (state.ready) fn(state); }
const emit = () => listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });

onAuthStateChanged(auth, async u => {
  state.user = u; state.profile = null; state.results = []; state.library = new Map();
  state.ready = true;
  emit();
  if (u){
    const r = await Promise.allSettled([loadProfile(), loadLibrary(), loadResults()]);
    r.forEach(x => x.status === 'rejected' && console.error(x.reason));
    emit();
  }
});

export const signIn = () => signInWithPopup(auth, new GoogleAuthProvider());
export const signOut = () => fbSignOut(auth);
const uid = () => state.user.uid;
const now = () => new Date();

// ---------- profile: XP + daily streak ----------
const dayStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => dayStr(new Date());
export const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return dayStr(d); };

async function loadProfile(){
  const s = await getDoc(doc(db, 'users', uid()));
  state.profile = s.exists() ? s.data() : { xp: 0, streak: 0, lastPlayed: '' };
}

export async function addXp(points){
  const p = state.profile || { xp: 0, streak: 0, lastPlayed: '' };
  const t = today();
  let streak = p.streak || 0;
  if (p.lastPlayed !== t) streak = p.lastPlayed === yesterday() ? streak + 1 : 1;
  const next = { xp: Math.max(0, Math.round((p.xp || 0) + points)), streak, lastPlayed: t };
  state.profile = next;
  emit();
  await setDoc(doc(db, 'users', uid()), { ...next, updatedAt: serverTimestamp() });
  return next;
}

// ---------- results ----------
export async function loadResults(n = 60){
  const snap = await getDocs(query(collection(db, 'users', uid(), 'results'), orderBy('updatedAt', 'desc'), limit(n)));
  state.results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return state.results;
}

export async function saveResult(id, r){
  await setDoc(doc(db, 'users', uid(), 'results', id), { ...r, updatedAt: serverTimestamp() });
  state.results = [{ id, ...r, updatedAt: now() }, ...state.results.filter(x => x.id !== id)];
  emit();
}

export async function deleteResult(id){
  await deleteDoc(doc(db, 'users', uid(), 'results', id));
  state.results = state.results.filter(r => r.id !== id);
  emit();
}
export async function clearResults(){
  const col = collection(db, 'users', uid(), 'results');
  for (;;){
    const snap = await getDocs(query(col, limit(100)));
    if (snap.empty) break;
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
  }
  state.results = [];
  emit();
}

// ---------- library (saved songs with labels) ----------
export async function loadLibrary(){
  const snap = await getDocs(collection(db, 'users', uid(), 'songs'));
  state.library = new Map(snap.docs.map(d => [d.id, { key: d.id, ...d.data() }]));
  return state.library;
}

export async function saveSong(key, data){
  await setDoc(doc(db, 'users', uid(), 'songs', key), { ...data, updatedAt: serverTimestamp() });
  state.library.set(key, { key, ...data, updatedAt: now() });
  emit();
}

export async function updateSong(key, patch){
  const cur = state.library.get(key);
  if (!cur) return;
  await setDoc(doc(db, 'users', uid(), 'songs', key), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  state.library.set(key, { ...cur, ...patch, updatedAt: now() });
  emit();
}

export async function removeSong(key){
  await deleteDoc(doc(db, 'users', uid(), 'songs', key));
  state.library.delete(key);
  emit();
}

// ---------- leaderboards (one per song + level + mode) ----------
function shortName(){
  const parts = (state.user.displayName || 'Player').trim().split(/\s+/);
  return (parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '')).slice(0, 40);
}

// better score first, then fewer tries, then fewer hints
export async function submitScore(board, pct, tries, hints){
  const ref = doc(db, 'leaderboards', board, 'scores', uid());
  const rank = pct * 1000000 - Math.min(tries, 999) * 1000 - Math.min(hints, 999);
  const cur = await getDoc(ref);
  if (cur.exists() && cur.data().rank >= rank) return false;
  await setDoc(ref, { name: shortName(), pct, tries, hints, rank, updatedAt: serverTimestamp() });
  return true;
}

export async function topScores(board, n = 5){
  const snap = await getDocs(query(collection(db, 'leaderboards', board, 'scores'), orderBy('rank', 'desc'), limit(n)));
  return snap.docs.map(d => ({ uid: d.id, me: d.id === uid(), ...d.data() }));
}
