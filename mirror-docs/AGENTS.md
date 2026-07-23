# AGENTS.md — Wcoast patch mirror

This folder is the **patch mirror** for a running Wcoast session. Wcoast is a
West Coast (Buchla-style) modular synthesizer for Web Audio, packaged as a macOS
Electron app. You compose a *patch* — Chris calls it a **score** — by placing
modules in a rack, wiring their jacks with cables, and setting their knobs and
switches. The mirror projects the live patch to these files so an AI assistant
(you, via a filesystem MCP server pointed at this folder) can read the current
state and reason about it.

The user is authoritative. You are a slower, deliberate collaborator working from
the user's instructions; the user always has the final say.

## Proposing a patch (the round-trip)

You **read** the projected files and, to propose a new patch, you **write one
file: `inbox.json`**. This is the only file you ever write. `patch.json` and the
rest are read-only projections of the live app — never write them.

When you write `inbox.json`, Wcoast reads it, validates the patch against
`catalogue.json`, shows the user a confirm dialog, and — on accept — rebuilds the
running patch from it. It then **deletes `inbox.json`** (that is your signal the
handoff was received) and writes the outcome to `last-apply-result.json`.

How to write it:

- `inbox.json` holds a patch in the exact **`patch.json` format** (see below).
  Reference only module types, ports, and params that exist in `catalogue.json`,
  with values inside each param's range or step set. An invalid patch is rejected
  whole — nothing is applied.
- Write it with an **atomic temp-and-rename**: write `inbox.json.tmp` first, then
  rename it to `inbox.json`. Wcoast never sees a torn file, and the completed
  rename is itself the signal — there is no separate handshake. (If you can only
  write in place, that is tolerated: a half-written file that doesn't parse yet is
  ignored until it does.)
- `inbox.json` disappearing means Wcoast has taken the handoff. Then read
  `last-apply-result.json`:
  - `{ "status": "success", "applied": ["inbox.json"] }` — your patch is now the
    running patch (unsaved; the user can Save it). Confirm the new state in
    `patch.json`.
  - `{ "status": "rejected", "error": "…" }` — nothing changed. Fix the problem
    named in `error` and write a fresh `inbox.json`.
- If the user clicks Cancel in the confirm dialog, that is a rejection.

Only propose a patch while `active.json` shows `isLive: true` — a handoff is for a
live session the user is driving. Applying is a full rebuild — a brief audible
gap, the same as loading a file. When a change could be large or surprising,
describe it to the user first.

## Mirror folder

At `~/Documents/WCOAST/mirror/`, beside the user's saved patches. Created when
the user enables the mirror (on by default) and emptied when they disable it.

`isLive` in `active.json` is `true` while Wcoast is running and `false` after it
quits. If you read the folder with `isLive: false`, the data is stale — the app
is closed and the user isn't at the keyboard.

## Files

- `active.json` — protocol metadata and a live snapshot: the patch name and dirty
  flag, whether sound is on, and the master level. Read this first.
- `catalogue.json` — the authoring schema: every module type with its ports and
  parameters, plus the mixer endpoint. This is how you know what modules exist,
  what each parameter's range or allowed values are, and how ports may connect.
- `patch.json` — the current patch: the modules placed, the wiring between them,
  and every parameter value. This is the same format Wcoast saves to a `.wcoast`
  file. It reflects live in-memory state, including unsaved changes. **Read-only**
  — to propose a change you write `inbox.json` (see the round-trip section above),
  never `patch.json`.
- `inbox.json` — the one file you write, to hand a proposed patch back to Wcoast
  (in `patch.json` format). Absent unless a handoff is in flight; Wcoast deletes
  it once taken. See the round-trip section above.
- `last-apply-result.json` — the outcome of your most recent `inbox.json` handoff:
  success (applied) or rejected (with the error). Absent until your first handoff.
- `selection.json` — the module the user last pointed at: `{ id, type, name }`, or
  `null` before any hover. Use it to resolve deixis — "make *this* one louder".
- `runtime.json` — small live signals: whether sound is running, the master
  level, and the master VU. Present while the app runs.
- `audio-trace.json` — the live sound as measurements (see its section below).
  Present only while sound plays.
- `AGENTS.md` — this file.
- `README.md` — a "do not edit" note for the human user; you can ignore it.

The `files` lists inside `active.json` are the authoritative declaration of which
file is which; trust those over this prose if they ever disagree.

## active.json

```json
{
  "protocolVersion": 1,
  "isLive": true,
  "patch": { "name": "bright pluck.wcoast", "dirty": true },
  "state": { "sound": "on", "master": 0.7 },
  "sync": { "lastSyncAt": "2026-07-04T21:00:00.000Z" },
  "files": {
    "roundTrip": ["inbox.json"],
    "observationOnly": ["patch.json", "active.json", "catalogue.json", "last-apply-result.json", "selection.json", "runtime.json", "audio-trace.json", "AGENTS.md"]
  }
}
```

`patch.name` is `null` for an unsaved patch. `state.sound` is `"on"` or `"off"`
(the sound On/Off toggle); `master` is the master output level 0–1.

## catalogue.json

The reference for reading and (later) authoring patches. Shape:

```json
{
  "protocolVersion": 1,
  "domains": ["audio", "control", "trigger"],
  "connectionRules": "same-domain connects; audio→control is allowed (FM); an input holds one cable; outputs fan out",
  "modules": {
    "<moduleType>": {
      "name": "…",
      "ports":  [ { "id": "…", "name": "…", "domain": "audio|control|trigger", "dir": "in|out", "target": "…?", "via": "…?" } ],
      "params": [ { "id": "…", "name": "…", "curve": "linear|exp|stepped", "min": 0, "max": 1, "steps": ["…"], "default": … } ]
    }
  },
  "mixer": { "key": "mixer", "ports": [ … ], "params": [ … ] }
}
```

- A **port** has a `domain` (audio / control / trigger — the signal type, which
  determines what may connect to what) and a `dir` (in / out). `target`/`via`
  appear on some control inputs (a CV input that drives a named parameter).
- A **param** with `curve: "stepped"` takes one of its `steps` string values;
  otherwise it is numeric within `min`..`max`. `default` is its start value.
- The **mixer** is a fixed endpoint (always present, not a rack module); its key
  in wiring and settings is `"mixer"`.

## patch.json

```json
{
  "format": "wcoast-patch",
  "version": 1,
  "rack": { "rows": 2 },
  "modules": [ { "id": "m0", "type": "<moduleType>", "row": 0, "x": 0 } ],
  "wiring":  [ { "from": { "module": "m0", "port": "prinFinalOut" },
                 "to":   { "module": "mixer", "port": "chanA" },
                 "bow":  { "along": 0.5, "perp": 3.2 } } ],
  "settings": { "params": { "m0": { "prinFreq": 110 }, "mixer": { "master": 0.7 } } }
}
```

Topology (`modules`, `wiring`) is separated from `settings` (every value). A
`module.id` is a per-file id referenced by `wiring` and by the keys under
`settings.params`; the mixer's id is `"mixer"`. `wiring.from` is always an output
port and `to` an input; `bow` (optional) is the cable's bend. Every `type`,
`port`, and `param` id must exist in `catalogue.json`.

## selection.json, runtime.json, audio-trace.json — what's happening now

These three are written only while the mirror is on; `audio-trace.json` and
`runtime.json` also require sound to be playing.

- `selection.json` is the **deictic pointer**: `{ "id": "m1", "type": "lpg-292",
  "name": "Quad Low Pass Gate" }`. It holds the module the user last moved the
  pointer over and stays put after they move away, so when they say "this one"
  while talking to you, this is what they mean. `null` until the first hover.
- `runtime.json`: `{ "sound": "on", "master": 0.7, "vu": { "peak_dbfs": -6.1,
  "rms_dbfs": -12.4 }, "at": "…" }` — a light, always-current read of transport
  and output level.
- `audio-trace.json` is the sound reduced to numbers — you cannot hear the audio,
  but you can reason about its measurements. Shape:

```json
{
  "protocolVersion": 1,
  "capturedAt": "…",
  "sound": "on",
  "sampleRateHz": 48000,
  "endpoints": [
    { "id": "m0.prinFinalOut", "module": "259t Complex Oscillator", "port": "Final",
      "rms_dbfs": -14.2, "peak_dbfs": -6.0, "centroid_hz": 820, "flags": [] },
    { "id": "mixer.chanA", "module": "Mixer", "port": "channel A", "rms_dbfs": -18.0,
      "peak_dbfs": -9.1, "centroid_hz": 700, "flags": [] },
    { "id": "mixer.master", "module": "Mixer", "port": "master", "rms_dbfs": -16.5,
      "peak_dbfs": -7.0, "centroid_hz": 760, "flags": [] }
  ],
  "onsets": [ { "t": 12.34, "endpoint": "mixer.chanA", "peak_dbfs": -6.0, "centroid_hz": 900 } ],
  "masterPeakHistory_dbfs": [ -8.1, -7.6, -7.0 ]
}
```

  - `endpoints` runs in signal-flow order: every **wired module output**, then each
    **mixer channel** (measured post-fader/mute, so a zeroed fader reads as
    silence), then the **master**. Only wired outputs appear — an unconnected jack
    is not measured. This lets you trace where signal is present and where it dies:
    a hot module output whose mixer channel is silent means the fader is down, the
    channel is muted, or the cable is missing.
  - Levels are `rms_dbfs` (loudness) and `peak_dbfs` (headroom); `centroid_hz` is
    the spectral centroid — higher is brighter. `flags` may include `clip` (peak at
    full scale), `silent` (essentially no signal), `dc` (a stuck DC offset), and
    `nan` (a broken DSP node). These are your fault-finding cues.
  - `onsets` is a rolling log of recent **strikes** — envelope peaks on the voice
    and channel outputs — each with a time (in the audio clock), the endpoint, and
    its peak and brightness. Use it to reason about rhythm and dynamics.
  - `masterPeakHistory_dbfs` is a short trail of recent master peaks, for a coarse
    sense of the output's dynamics over the last few seconds.

  The honest ceiling: this makes you a good **diagnostician** and a coarse
  **advisor** — you can spot clipping, silence, a dead channel, brightness, or a
  steady rhythm — but not a listener. You cannot judge whether something sounds
  beautiful. Within that limit it is most valuable for "why is there no sound?"
  and "why does this feel wrong?".

## When in doubt

Ask the user — they drive the work; you carry it out. When a request is ambiguous
about which module or which behaviour they mean, ask rather than guess.
