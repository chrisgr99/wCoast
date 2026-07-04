// storage.js — the save/load transport, chosen for the environment.
//
// The serialize/restore core (patch-io.js) is environment-blind; this is the
// thin layer that actually moves the bytes, and it OWNS the "current file" so
// the app just calls open / save / saveAs with text and gets a display name
// back. Two backends (design/save-load.md):
//
//   Electron — native dialogs + Node file writes over the preload bridge.
//   Browser  — File System Access API (phase 3); stubbed for now.
//
//   createStorage() -> {
//     open()        : Promise<{ text, name } | null>   // remembers it as current
//     save(text)    : Promise<string | null>           // writes to current (prompts if none)
//     saveAs(text)  : Promise<string | null>           // prompts, then remembers
//     forget()      : void                             // drop the current file (New)
//     name()        : string | null                    // current file's display name
//   }

'use strict';

const baseName = (p) => (p ? p.replace(/^.*[\\/]/, '') : null);

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
      const res = await bridge.saveAs({ text });
      if (!res) return null;
      currentPath = res.path;
      return baseName(res.path);
    },
    forget() { currentPath = null; },
    name() { return baseName(currentPath); },
  };
}

function browserStorage() {
  const soon = () => { throw new Error('Browser save/load lands in phase 3.'); };
  return { open: soon, save: soon, saveAs: soon, forget() {}, name() { return null; } };
}

export function createStorage() {
  const w = typeof window !== 'undefined' ? window.wcoast : null;
  if (w && w.isElectron && w.patch) return electronStorage(w.patch);
  return browserStorage();
}
