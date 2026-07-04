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

You can both **read** these files and **write `patch.json`** to propose a new
patch. When you write it, Wcoast validates the patch against `catalogue.json`,
shows the user a confirm dialog, and — on accept — rebuilds the running patch
from it. Read `last-apply-result.json` afterwards to learn whether your edit was
accepted or rejected, and why.

How to write it:

- Write `patch.json` with an **atomic temp-and-rename**: write `patch.json.tmp`
  first, then rename it to `patch.json`. Wcoast never sees a torn file, and the
  completed rename is itself the signal — there is no separate handshake.
- Keep the exact format (see "patch.json" below) and reference only module types,
  ports, and params that exist in `catalogue.json`, with values inside each
  param's range or step set. An invalid patch is rejected as a whole — nothing is
  applied.
- After writing, read `last-apply-result.json`:
  - `{ "status": "success", "applied": ["patch.json"] }` — your patch is now the
    running patch (unsaved; the user can Save it).
  - `{ "status": "rejected", "error": "…" }` — nothing changed, and Wcoast has
    force-pushed the current patch back to `patch.json`, so the file reverts. Fix
    the problem named in `error` and try again.
- If the user clicks Cancel in the confirm dialog, that is a rejection and the
  file reverts.

Applying is a full rebuild — a brief audible gap, the same as loading a file.
When a change could be large or surprising, describe it to the user first.

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
  file. It reflects live in-memory state, including unsaved changes. This is also
  the file you write to propose a change (see the round-trip section above).
- `last-apply-result.json` — the outcome of your most recent `patch.json` write:
  success (applied) or rejected (with the error). Absent until your first write.
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
    "roundTrip": ["patch.json"],
    "observationOnly": ["active.json", "catalogue.json", "AGENTS.md"]
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

## When in doubt

Ask the user — they drive the work; you carry it out. When a request is ambiguous
about which module or which behaviour they mean, ask rather than guess.
