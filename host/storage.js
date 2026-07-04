// storage.js — the save/load transport, chosen for the environment.
//
// The serialize/restore core (patch-io.js) is environment-blind; this is the
// thin layer that actually moves the bytes, and it OWNS the "current file" so
// the app just calls open / save / saveAs with text and gets a display name
// back. Two backends (design/save-load.md):
//
//   Electron — native dialogs + Node file writes over the preload bridge.
//   Browser  — File System Access API (Chromium-based browsers). The file
//              handle is persisted in IndexedDB so the file can be reopened
//              after a relaunch (reopenLast).
//
//   createStorage() -> {
//     open()        : Promise<{ text, name } | null>   // pick + read, becomes current
//     save(text)    : Promise<string | null>           // write to current (prompts if none)
//     saveAs(text)  : Promise<string | null>           // prompt, then becomes current
//     reopenLast()  : Promise<{ text, name } | null>   // re-open the persisted file (browser)
//     hasLast()     : boolean                          // is there a persisted file to reopen?
//     lastName()    : string | null
//     forget()      : void                             // drop the current file (New)
//     name()        : string | null                    // current file's display name
//   }
//
// A user cancelling a picker resolves to null (not an error).

'use strict';

const baseName = (p) => (p ? p.replace(/^.*[\\/]/, '') : null);

// ---- Electron: native dialogs + Node writes via the preload bridge ----

function electronStorage(bridge) {
  let currentPath = null;
  return {
    async open() {
      const res = await bridge.open();
      if (!res) return null;
      currentPath = res.path;
      return { text: res.text, name: baseName(res.path) };
    },
    async save(text) {
      const res = await bridge.save({ path: currentPath, text });
      if (!res) return null;
      currentPath = res.path;
      return baseName(res.path);
    },
    async saveAs(text) {
      const res = await bridge.saveAs({ text, path: currentPath });
      if (!res) return null;
      currentPath = res.path;
      return baseName(res.path);
    },
    async reopenLast() { return null; },   // Electron reopen (via settings) is deferred
    hasLast() { return false; },
    lastName() { return null; },
    forget() { currentPath = null; },
    name() { return baseName(currentPath); },
  };
}

// ---- Browser: File System Access API + IndexedDB handle ----

// A one-key IndexedDB box for the FileSystemFileHandle (handles are
// structured-cloneable, so they store directly).
function handleStore() {
  const DB = 'wcoast', STORE = 'handles', KEY = 'currentFile';
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return {
    async get() {
      const db = await open();
      return new Promise((res, rej) => {
        const q = db.transaction(STORE).objectStore(STORE).get(KEY);
        q.onsuccess = () => res(q.result || null);
        q.onerror = () => rej(q.error);
      });
    },
    async set(v) {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(v, KEY);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    },
  };
}

function browserStorage() {
  if (typeof window === 'undefined' || !window.showSaveFilePicker) {
    const no = () => { throw new Error('This browser lacks the File System Access API — use Chrome or Edge.'); };
    return { open: no, save: no, saveAs: no, async reopenLast() { return null; }, hasLast() { return false; }, lastName() { return null; }, forget() {}, name() { return null; } };
  }

  const PICKER = { types: [{ description: 'Wcoast Patch', accept: { 'application/json': ['.wcoast'] } }] };
  const idb = handleStore();
  let current = null;   // the file being edited this session (Save writes here)
  let last = null;      // the persisted handle, offered for reopen after a relaunch
  idb.get().then((h) => { if (!last) last = h; }).catch(() => { /* first run / blocked */ });

  // Cancelling a picker throws AbortError; treat that as "no choice", not a fault.
  const orNull = async (fn) => {
    try { return await fn(); } catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
  };
  // The picker grants permission; a handle from IndexedDB must (re-)request it,
  // which is why reopen/save-after-relaunch happen on a click (the gesture).
  const ensure = async (handle, mode) => {
    const opts = { mode };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  };
  const remember = async (handle) => { current = handle; last = handle; try { await idb.set(handle); } catch (_e) { /* fine */ } };
  const read = async (handle) => (await (await handle.getFile()).text());
  const write = async (handle, text) => { const w = await handle.createWritable(); await w.write(text); await w.close(); };

  async function saveAs(text) {
    const h = await orNull(() => window.showSaveFilePicker({ ...PICKER, suggestedName: (current && current.name) || 'patch.wcoast', startIn: current || 'documents' }));
    if (!h) return null;
    await write(h, text);
    await remember(h);
    return h.name;
  }

  return {
    async open() {
      const picked = await orNull(() => window.showOpenFilePicker({ ...PICKER, multiple: false, startIn: current || 'documents' }));
      if (!picked) return null;
      const h = picked[0];
      if (!(await ensure(h, 'read'))) return null;
      const text = await read(h);
      await remember(h);
      return { text, name: h.name };
    },
    async save(text) {
      if (!current) return saveAs(text);
      if (!(await ensure(current, 'readwrite'))) return null;
      await write(current, text);
      return current.name;
    },
    saveAs,
    async reopenLast() {
      if (!last) return null;
      if (!(await ensure(last, 'read'))) return null;
      current = last;
      return { text: await read(last), name: last.name };
    },
    hasLast() { return !!last; },
    lastName() { return last ? last.name : null; },
    forget() { current = null; },
    name() { return current ? current.name : null; },
  };
}

export function createStorage() {
  const w = typeof window !== 'undefined' ? window.wcoast : null;
  if (w && w.isElectron && w.patch) return electronStorage(w.patch);
  return browserStorage();
}
