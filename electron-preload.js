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
    setDirty: (v) => ipcRenderer.send('patch:dirty', v),
  },
});
