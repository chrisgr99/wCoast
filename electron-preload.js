// Electron preload script for Wcoast.
//
// Runs in a privileged context before the renderer loads. At the spike
// stage there is nothing to bridge — no persistence, no GXW message
// channel yet — so this file only exposes a version stamp the renderer
// can read to confirm the preload ran and it is running inside Electron
// rather than a bare browser tab. Later stages will add the real bridges
// (score persistence, the GXW control-message transport) here, following
// the contextBridge pattern used in the GXW project.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('wcoast', {
  isElectron: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
