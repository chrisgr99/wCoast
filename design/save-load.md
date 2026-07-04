# Save & Load — Design

Saving and restoring a patch: the arrangement of modules, their wiring, and
their settings. This is the authoritative design for the feature; fold the
settled parts into DESIGN.md once built.

## Principle: one core, two transports

The work of turning the live state into a portable object and rebuilding from
it is pure data logic — identical whether we run in Electron or a browser. It
lives in one **serialize-and-restore core** that knows nothing about where the
bytes go.

Only the transport differs, so there is a thin **storage adapter** with two
backends, chosen once at startup from `window.wcoast.isElectron` (already
exposed by the preload):

- **Electron** — native Save/Open dialogs and Node's file system, reached from
  the sandboxed renderer through the preload bridge to the main process. Real
  paths on disk; a private app-data folder for quiet state.
- **Browser** — the File System Access API (`showSaveFilePicker` /
  `showOpenFilePicker`). Chromium-based browsers only, which is acceptable. The
  save picker's click *is* the permission grant; once we hold the file handle,
  every later Save writes to it silently for the session. The handle is
  persisted in IndexedDB so the file survives a relaunch (see below).

Keeping the file format identical between the two means a patch saved in one
opens in the other.

## The saved file (`.wcoast`, JSON)

The format deliberately separates the **topology** (which modules exist and how
they are wired — the "instrument") from the **settings** (every knob and switch
value — the "sound"). This seam is what lets snapshots be added later (see
Future) without disturbing the topology or wiring.

```
{
  "format": "wcoast-patch",
  "version": 1,
  "rack":    { "rows": 2 },
  "modules": [
    { "id": "m0", "type": "complex-oscillator-259t", "row": 0, "x": 0 },
    { "id": "m1", "type": "lpg-292",                  "row": 1, "x": 0 }
  ],
  "wiring": [
    { "from": { "module": "m0", "port": "prinFinalOut" },
      "to":   { "module": "m1", "port": "inA" },
      "bow":  { "along": 0.5, "perp": 3.2 } },
    { "from": { "module": "m1", "port": "outA" },
      "to":   { "module": "mixer", "port": "chanA" } }
  ],
  "settings": {
    "params": {
      "m0":    { "prinFreq": 110, "modWave": "sawtooth", "...": "..." },
      "m1":    { "levelA": 0.8, "decayA": 0.4, "lpA": "on", "...": "..." },
      "mixer": { "levelA": 0.8, "panA": 0, "master": 0.7, "...": "..." }
    }
  }
}
```

Notes:

- **Identity.** `id` is a stable per-file module id (the session key is fine as
  the id at save time). On restore the recreated modules get fresh session keys,
  so restore builds a saved-id → new-key map and rewrites the wiring through it.
- **The mixer is not a rack module.** It always exists (created at boot), so it
  is not listed in `modules`; its settings sit under `settings.params.mixer`,
  and wiring refers to the fixed endpoint `"mixer"`.
- **Bow** (`{along, perp}`) is the cable's bend; present only where a cord has
  been reshaped. Omitting it restores the default droop.
- `version` gates forward compatibility; restore refuses a format/version it
  does not understand.

## The shared core

- `serialize()` reads three sources into the object above:
  - **modules** and their **params** — from the rack's records (`rec.descriptorId`,
    `rec.row`, `rec.x`, and `rec.values`, which is the live param map).
  - **mixer params** — from the mixer's control state (the MixerPanel's fader /
    knob / mute values plus the shared master).
  - **wiring** — from the patchbay's edge list (`e.src`, `e.dst`, `e.bow`).
- `restore(obj)`:
  1. Validate `format`/`version`.
  2. Clear the current patch and rack.
  3. Set `rack.rows`.
  4. Recreate each module (`addModule(type, row, x)`), recording saved-id → key.
  5. Apply each module's saved params (`_setParam` per entry) and the mixer's.
  6. Recreate each wire (`patchbay.connect` via the id map), restoring `bow`.

Recreate order matters: modules exist before params, params before wiring; the
mixer already exists.

## Storage adapters

A small interface the core calls, with two implementations:

```
newFile()            // clear to an empty patch
open()               // pick + read a file → object, hand to restore()
save()               // write serialize() to the current file/handle
saveAs()             // pick a new destination, then save()
loadSettings()/saveSettings()   // quiet app state (see below)
```

- **Electron adapter** — `open`/`saveAs` call the main process over the preload
  bridge to show `dialog.showOpenDialog` / `showSaveDialog` and do the `fs`
  read/write. The current file path is held in memory and remembered in the
  app-data folder so `save` writes straight to it.
- **Browser adapter** — `open`/`saveAs` call `showOpenFilePicker` /
  `showSaveFilePicker`; `save` writes to the held handle via a writable stream.
  The handle is kept in memory for the session and mirrored to IndexedDB.

### Handle / path persistence

So the app can reopen the file you were editing:

- **Browser** — store the `FileSystemFileHandle` in IndexedDB (handles are
  structured-cloneable) under a key like `currentFile`. On launch, read it and
  call `handle.queryPermission`; if not already granted, `requestPermission`
  (one confirmation click). If the user declines or nothing is stored, the first
  Save falls back to Save As.
- **Electron** — store the last file path in the app-data settings and reopen it
  on launch.

### Quiet state (settings / autosave) — later

Preferences, the last-opened file, and an eventual autosave are not patch files;
they live in the app-data folder (Electron) or localStorage/IndexedDB (browser).
Add when wanted; the adapter already exposes `loadSettings`/`saveSettings`.

## The hamburger menu (UI)

We do **not** use Electron's native application menu — the UI must be identical
in both environments and stay inside the window. Instead a **hamburger button at
the left end of the toolbar** opens a dropdown containing a **File** menu:

- **New**, **Open…**, **Save**, **Save As…**

with room for other menus later. It reuses the existing pop-up menu component so
it looks and behaves like the connection menu. In Electron we disable (or
minimise) the default application menu so File lives only in the hamburger.

## Future: settings snapshots (noted, not built)

A patch file holds one topology — one instrument and its wiring — but may later
hold **several settings variations** over that same instrument. The user picks
"Save snapshot" and steps back and forth between them to compare sounds.

The format already anticipates this: `settings` is a self-contained block
distinct from `modules`/`wiring`. To add snapshots, `settings` grows from a
single `{ params }` into a list plus an active index — roughly:

```
"settings": { "active": 1,
  "snapshots": [ { "name": "bright", "params": { "...": "..." } },
                 { "name": "dark",   "params": { "...": "..." } } ] }
```

Restore applies the active snapshot's params; stepping swaps the applied params
without touching modules or wiring. Because the topology/settings seam is in
place from the start, adding snapshots later touches only the settings section
and the UI — not the wiring, the adapters, or the core's module rebuild.
