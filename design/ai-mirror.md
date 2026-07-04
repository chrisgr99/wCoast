# Wcoast patch mirror — Design

The **patch mirror** projects the state of the running Wcoast app to a folder of
plain files on disk, so an AI assistant (Claude, via a filesystem MCP server
pointed at the folder) can read the current patch, reason about it, and author
new patches — what Chris calls *scores*: a complete connection matrix plus knob
settings — by writing files that Wcoast validates and applies.

This is the Wcoast equivalent of GeoSonel's composition mirror (GXW DESIGN §15;
`~/ProgrammingProjects/GXW/mirror-docs/AGENTS.md` and `electron-mirror.js`). It
adopts GXW's architecture and its hard-won lessons; it differs where Wcoast is
simpler (one running patch, no moving physics) and where Wcoast is richer (a
descriptor-driven module catalogue makes the authoring schema machine-precise).

Electron-only. The user is authoritative; the AI is a slower collaborator whose
edits are always confirmed before they touch the running app. Opt-in, default
off — no surprise folder appears until the user turns the mirror on.

## Why the Electron main process, at a fixed path

GXW first tried this in the renderer with the browser File System Access API
(`src/diskMirror.js`, now deprecated) and it was too fragile: permissions lapse
on reload, the API can't hand the assistant an absolute path, module caches mask
external edits, and round-trips corrupt formatting. The working design moved the
whole mechanism into the Electron main process at a stable, canonical path. We
follow that directly. The renderer holds the in-memory state (the source of
truth); the main process owns the folder, the atomic writes, and the file
watcher. This is also why the mirror is Electron-only — the browser build has no
such path or watcher.

## The mirror folder

`~/Documents/WCOAST/mirror/` — beside the user's saved patches (the WCOAST folder
the save dialogs already default to), so a filesystem MCP granted the WCOAST
folder reaches it with no extra configuration. (The enabled setting lives in app
data, `userData/settings.json`, not in the mirror folder.)

Lifecycle: created when the user enables the mirror; its `.tmp` and `.pending`
leftovers are cleaned at startup; emptied when disabled. `active.json` carries
`isLive: true` while the app runs and `false` after it quits (written on quit),
so an AI reading the folder with the app closed knows the data is stale.

The user never edits these files by hand — the running app is the source of
truth and the files are projected from it. The AI edits only the round-trip
files, following the protocol below.

## File inventory

**Round-trip** (the AI may write these; Wcoast validates and applies them):

- `patch.json` — the current patch, in the exact `.wcoast` serialize format
  (`host/patch-io.js`): `modules` (type, position), `wiring` (cables with bend),
  and `settings.params` (every module's and the mixer's values). This IS the live
  patch, projected from the running app; writing it proposes a new patch.

**Observation-only** (Wcoast writes; the AI reads):

- `active.json` — protocol metadata and a live snapshot (schema below): protocol
  version, `isLive`, the current patch's name and dirty flag, a transport-style
  state (audio on/off, master level), and the files lists.
- `catalogue.json` — the machine-readable authoring schema: every registered
  module type with its full parameter and port descriptors, plus the mixer
  endpoint. This is what the AI reads to construct *valid* patches. Generated
  from the descriptors, so it is always exact and never drifts. (Wcoast's answer
  to GXW's `sceneSchema.md`, but generated rather than prose.)
- `last-apply-result.json` — the outcome of the most recent AI-edit batch:
  success with what applied, or rejection with the first validation error.
- `AGENTS.md` — the grounding doc for the AI: this protocol, distilled to what an
  assistant needs to participate safely. Copied on enable.

**Deferred, observation-only** (nice-to-have, later phases):

- `selection.json` — the deictic "this module" pointer: the module the user is
  hovering or whose connection menu is open, so "make this louder" resolves. The
  spatial counterpart to GXW's canvas selection.
- `runtime.json` — at-rest runtime signals Wcoast's static patch doesn't carry:
  the two output VU levels, whether sound is running. Small; captured on pause.
- `audio-trace.json` — the sound as measurements: a rolling buffer of per-endpoint
  levels and spectral features plus detected onsets, so the AI can diagnose and
  advise on the actual output. Full section below.

The files lists inside `active.json` are the protocol-level declaration of which
file is which; trust those over this prose if they ever disagree.

## patch.json — the round-trip patch

Identical to the `.wcoast` file format (see `design/save-load.md`): topology
(`modules`, `wiring`) separated from `settings`. The mirror reuses
`serialize(rack, mixer)` to project it and `restore(obj, rack, mixer)` to apply
an AI edit — the same core the File menu uses. Reusing that core means a patch
authored through the mirror and one saved to a file are the same object, and the
apply path is already proven.

The mixer is the fixed endpoint `"mixer"` in `wiring` and `settings.params`, as
in the save format.

## catalogue.json — the authoring schema

The most important AI-facing file, and the piece Wcoast can do better than GXW.
Wcoast modules are already fully described by their descriptors (params carry
`curve`, `min`/`max`/`steps`/`default`; ports carry `domain`, `dir`, `target`,
`via`), so the catalogue is generated by walking the registry. It gives the AI
everything needed to write a patch that validates on the first try:

```json
{
  "protocolVersion": 1,
  "domains": ["audio", "control", "trigger"],
  "connectionRules": "audio→audio, control→control, trigger→trigger; audio→control (FM) allowed; an input holds one cable; outputs fan out",
  "modules": {
    "wcoast.complexOsc259t": {
      "name": "259t Complex Oscillator",
      "ports": [
        { "id": "prinFinalOut", "name": "final", "domain": "audio", "dir": "out" },
        { "id": "modFmIn", "name": "FM In", "domain": "audio", "dir": "in" }
      ],
      "params": [
        { "id": "prinFreq", "curve": "exp", "min": 0, "max": 20000, "default": 110 },
        { "id": "modWave", "curve": "stepped", "steps": ["sawtooth","square","triangle"], "default": "sawtooth" }
      ]
    },
    "lpg-292": { "...": "..." }
  },
  "mixer": {
    "key": "mixer",
    "ports": [ { "id": "chanA", "domain": "audio", "dir": "in" } ],
    "params": [ { "id": "levelA", "curve": "linear", "min": 0, "max": 1, "default": 0.8 } ]
  }
}
```

The AI's authoring flow: read `catalogue.json` (what exists), `active.json` (what
state), `patch.json` (the current patch), then write a new `patch.json` that
references only real module types, real port ids, and param values inside each
param's range or step set.

## active.json

```json
{
  "protocolVersion": 1,
  "isLive": true,
  "patch": { "name": "bright pluck.wcoast", "dirty": true },
  "state": { "sound": "on", "master": 0.7 },
  "sync": { "lastSyncAt": "2026-07-04T21:00:00.000Z" },
  "files": {
    "roundTrip": ["patch.json"],
    "observationOnly": ["active.json", "catalogue.json", "last-apply-result.json", "AGENTS.md"]
  }
}
```

`patch.name` is `null` for an unsaved patch; `dirty` mirrors the unsaved-changes
flag we already track. `state.sound` is `"on"`/`"off"` (the On/Off toggle);
`master` is the current master level.

## last-apply-result.json

Written after every AI-edit batch. Success: `{ "status": "success", "timestamp":
…, "applied": ["patch.json"] }`. Rejection: `{ "status": "rejected", "timestamp":
…, "filename": "patch.json", "error": "<what failed>" }`. On rejection the
in-memory patch is unchanged and its last-known-good content is force-pushed back
to `patch.json`, so the file reverts within the same write window.

## Round-trip protocol

Modelled exactly on GXW's, which is proven:

- **Atomic temp-and-rename.** Wcoast writes `patch.json.tmp` then renames to
  `patch.json`; an AI watching never sees a torn file. The AI must write the same
  way. A completed rename of a round-trip file is itself the signal — no separate
  handshake. (An optional `.pending` sentinel brackets a slower multi-file batch;
  not needed for the single-file patch case.)
- **Self-write muting.** The main process records a signature (size + hash) of
  what it just wrote, so its own projection writes are not mistaken for AI edits.
  The watcher reconciles by signature, not by fs event name — macOS `fs.watch` is
  unreliable about which filename a rename reports.
- **Debounce.** Writes within a short window coalesce into one batch.
- **Confirm to apply.** On a detected external edit, the main process hands the
  new `patch.json` to the renderer, which validates it (below) and, if valid,
  shows a confirm dialog with a short before→after summary (e.g. "3 modules, 5
  cables → 4 modules, 7 cables"). On accept, `restore()` rebuilds the running
  patch; on cancel, the last-known-good patch is force-pushed back to the file.
  Either way the outcome is written to `last-apply-result.json`.

## Validating an AI-proposed patch

Stricter than the trusting `restore()` the File menu uses, since the input is
machine-authored. Reject the whole batch on the first failure, with a precise
message, and revert:

- `format` is `wcoast-patch` and `version` is understood.
- Every `modules[].type` is a registered module type.
- Every `settings.params` key is a known module id (from this file's modules) or
  `"mixer"`; every param id exists on that module's descriptor; every value is
  the right kind and within `min`/`max` (numeric) or one of `steps` (stepped).
- Every `wiring` endpoint names a module in the file (or `"mixer"`) and a real
  port id on it; the pair is output→input and domain-compatible; no input carries
  more than one cable.
- Module ids are unique.

Because the catalogue is generated from the same descriptors the validator uses,
a patch the AI builds from `catalogue.json` should validate first time.

## Applying is a rebuild

`restore()` clears the rack and rebuilds it, so applying an AI patch is a full
teardown/rebuild — a brief audible gap and any transient runtime state is lost.
That is acceptable for a compositional tool where you are constructing the patch,
and it matches how Open already works. (A future refinement could diff and apply
incrementally; not for the first version.)

## Enabling and settings

Opt-in, default off, persisted in `userData/settings.json` (a new tiny settings
store, since Wcoast has none yet). The toggle lives in the hamburger menu — a new
section beneath File, e.g. **AI Mirror ▸ On / Reveal folder in Finder**. On
enable: create the folder, copy `AGENTS.md`, generate `catalogue.json`, push the
current `patch.json` and `active.json`, start the watcher. On disable: stop the
watcher, empty the folder.

## Deictic pointer — selection.json (later)

When the user works with the AI they can't point at the screen, so — as in GXW —
Wcoast can project which module they mean: the module under the pointer, or the
one whose connection menu is open, written (debounced) to `selection.json` as
`{ id, type, name }`. Pair it with `catalogue.json`/`patch.json` to resolve "this
module". Deferred to a later phase.

## audio-trace.json — the sound, as measurements (later)

Wcoast has no discrete musical events to log the way GXW does; it has continuous
audio. Since an AI cannot hear audio, logging raw samples would be useless — but
audio reduced to a compact stream of *measurements* is very reasonable to reason
about, and is the true analog of GXW's `event-trace.json` (which was never raw
audio either — it was the signal values behind each event). This file serves the
two diagnostic uses Chris named: finding faults, and advising on results. A
rolling buffer, newest last, updated a few times a second while sound plays;
empty or absent when stopped.

- A **signal-flow snapshot** — the most valuable part. For every endpoint (each
  module output, each mixer channel, and the master): current level as RMS and
  peak in dBFS, plus flags for clipping (peak at or above 0 dBFS), a stuck DC
  offset, and NaN/Inf (a broken DSP node). This lets the AI trace exactly where
  signal is present and where it dies — pinpointing a gate that isn't opening, a
  missing cable, a zeroed level, or a node that has blown up.
- **Brightness** per endpoint — the spectral centroid in Hz, optionally with a
  tonal-vs-noisy flatness — so the AI can say the sound is dark or bright and
  advise on wavefolding or filter settings.
- **Onsets** — amplitude-envelope peaks on the gate/voice outputs, which recreate
  discrete events *from* the audio: each strike as `{ time, endpoint, peak,
  centroid }`. This is the closest Wcoast comes to GXW's event trace, and it lets
  the AI reason about rhythm and dynamics.

Feasibility: cheap and already half-present — the mixer taps the master with
AnalyserNodes for the VU meters, so this is the same technique with a few more
taps (per module output and mixer channel) and a little math on the control
thread each frame; no consequential extra work on the audio thread.

The honest ceiling: this makes the AI a good diagnostician and a coarse advisor —
it can report clipping, silence, brightness, or "firing every beat at a rising
level" — but not a listener. It cannot judge that something sounds beautiful or
catch a subtle timbral nuance. Within that limit the value is real, especially
for "why is there no sound" and "why does this feel wrong."

## What differs from GXW

- **One patch, not many scores.** No per-score subfolders, no score-switch
  emptying — the mirror always reflects the single running patch.
- **No moving physics.** GXW's `runtime-state.json` captures sprite positions and
  cursor sweeps; Wcoast's runtime state is nearly nothing (VU + on/off), so it is
  deferred and tiny.
- **Generated catalogue vs prose schema.** The descriptor system gives the AI an
  exact, machine-readable authoring schema for free.
- **Whole-file round-trip is fine.** A patch is small, so the AI rewrites the
  whole `patch.json`; GXW needed `property-changes.json` to avoid rewriting a
  large, live-edited `scene.json`. We can add a targeted `property-changes.json`
  later for one-knob tweaks, but it is not needed to start.

## Phasing

1. **Write side (bundle → mirror).** The Electron main mirror module: folder
   lifecycle, atomic writes, self-write muting scaffold, and projecting
   `patch.json`, `catalogue.json`, and `active.json` from the renderer on every
   change (reusing `serialize` and the descriptor registry). Copy `AGENTS.md`.
   The enable toggle + settings store. Verifiable by reading the folder while the
   app runs.
2. **Round-trip (mirror → bundle).** The `fs.watch` + signature reconcile +
   debounce, the validator, the confirm-to-apply dialog, `restore()` apply, and
   `last-apply-result.json`. This is where the AI can actually build a patch.
3. **Deictic + runtime + audio trace.** `selection.json`, `runtime.json`, the
   `audio-trace.json` analysis (a few analyser taps and per-frame feature math),
   and optionally `property-changes.json` for targeted edits.

Phase 1 is the observable win — the AI can *see and reason about* the patch —
and is the natural first build. Phase 2 makes it *authorable*.
