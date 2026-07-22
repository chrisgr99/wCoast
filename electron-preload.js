// Electron preload script for Wcoast.
//
// Runs in a privileged context before the renderer loads. It exposes a small,
// explicit surface on window.wcoast: a stamp confirming we're inside Electron
// (rather than a bare browser tab), and the patch save/load bridge, which
// forwards to the main process (native dialogs + Node file writes). The GXW
// control-message transport will join here later, same contextBridge pattern.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wcoast', {
  isElectron: true,
  // Open an external URL (docs / help links) in the user's default browser,
  // rather than a new Electron window.
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Open the panel editor window (developer tool). opts: { moduleId?, scale? } — moduleId focuses
  // it on a module; scale is the rack's current px/mm so the panel opens at the same size.
  openPanelEditor: (opts) => ipcRenderer.invoke('open-panel-editor', opts),
  // The panel editor page uses these: write a module's files, and be told which module to focus.
  designerSave: (msg) => ipcRenderer.invoke('designer:save', msg),
  onSelectModule: (cb) => ipcRenderer.on('designer:select-module', (_e, id) => cb(id)),
  // The source revision this app was built from ({ commit, short, branch, describe, dirty,
  // committedAt } | null), stamped into saved patches for bug-report traceability.
  build: () => ipcRenderer.invoke('app:build'),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  // Patch files. open() -> { path, text } | null; save/saveAs -> { path } | null.
  // setDirty tells the main process about unsaved changes so it can guard the
  // window close.
  patch: {
    open: () => ipcRenderer.invoke('patch:open'),
    save: (state) => ipcRenderer.invoke('patch:save', state),
    saveAs: (state) => ipcRenderer.invoke('patch:saveAs', state),
    recent: () => ipcRenderer.invoke('patch:recent'),
    read: (p) => ipcRenderer.invoke('patch:read', p),
    setDirty: (v) => ipcRenderer.send('patch:dirty', v),
  },
  // The native application menu. The renderer owns both the state it shows and the commands it
  // fires, so this is only a wire: push state up, take actions back down.
  menu: {
    setState: (s) => ipcRenderer.send('menu:state', s),
    onAction: (cb) => ipcRenderer.on('menu:action', (_e, payload) => cb(payload)),
  },
  // AI patch mirror. status/setEnabled/reveal round-trip; write projects files.
  mirror: {
    status: () => ipcRenderer.invoke('mirror:status'),
    setEnabled: (v) => ipcRenderer.invoke('mirror:setEnabled', v),
    write: (files) => ipcRenderer.send('mirror:write', files),
    reveal: () => ipcRenderer.invoke('mirror:reveal'),
    // Round-trip: main sends an external patch.json edit; the renderer reports the outcome.
    onExternal: (cb) => ipcRenderer.on('mirror:external', (_e, payload) => cb(payload)),
    result: (r) => ipcRenderer.send('mirror:result', r),
  },
});
