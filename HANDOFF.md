# Wcoast — Handoff

Live orientation for continuing development. Read `DESIGN.md` first for the
full design; this file is the short "where things stand / what's next" state.

## Where things stand (as of this handoff)

- **Spike complete + committed.** Electron shell + custom `app://` scheme
  (COOP/COEP, crossOriginIsolated confirmed true) + AudioWorklet toolchain
  proven. Zero-allocation + destination-glide patterns established in
  `worklets/test-tone-processor.js`. The old spike UI (`renderer.js` +
  `test-tone-processor.js`) is retired reference — kept in the tree but no
  longer loaded; the Electron/scheme setup and the worklet discipline are the
  keepers.
- **Module schema** set by the Complex Oscillator (259t) descriptor at
  `modules/complex-oscillator-259t/descriptor.js` (ART dropped, DESIGN §10).
  Treat its shape as the reference when adding modules.
- **Implementation milestone 3 BUILT** — the host reads the descriptor,
  loads its worklet, instantiates it through its factory, and the resulting
  instance makes band-limited sound. New files:
  - `host/registry.js` — registers `{descriptor, create}`, validates the
    descriptor (unique ids, known domains/dirs, CV `target`/`via` resolve),
    and enumerates params / output ports / signal-input ports / CV-input
    ports. Audio-free and Node-importable.
  - `host/host.js` — `SynthHost`: owns the AudioContext, `addModule()`s each
    path in `descriptor.worklets` once, instantiates a module via its factory.
    Single instance for now; `instantiate(id, instanceId?)` is the seam for
    the future voice allocator.
  - `modules/complex-oscillator-259t/complex-osc-processor.js` — ONE PolyBLEP
    processor for the WHOLE module (both oscillators now; the wavefolder etc.
    land here too — one-module-one-worklet). Band-limited saw/square, near-free
    sine/triangle, through-zero FM folded into the phase increment (external
    FM-in jacks + internal mod→principal pitch mod), ring/AM. Zero-allocation
    loop; reads real `sampleRate`. Processor name `complex-osc-259t`.
  - `modules/complex-oscillator-259t/factory.js` — `create(ctx, services)`
    builds the node, derives port→graph-index maps from the descriptor and
    **asserts** they match the processor's assumed order, and returns the
    realized instance (`getOutput/getInput/getParam/setParam/supports/
    dispose/node`).
  - `debug/debug-surface.js` + rewritten `index.html` — the bench (NOT the
    rack), generated entirely from the descriptor: a control per param grouped
    by section, an output-monitor selector, master gain. `setParam` drives
    everything; params whose DSP is deferred render disabled with the reason.
- **Validated headlessly:** every ESM imports cleanly under Node; the worklet
  runs 200 blocks through a stub harness with no NaNs and output within trim;
  the bench builds all 18 param rows / 6 monitor outputs under a fake DOM.
  **Not yet run in Electron** — audible confirmation needs `npm start` and a
  human ear; I did not launch the app window (avoids disrupting the desktop
  layout). First-sound smoke test is the one open verification.

## FIRST: hear it (the one open check)

```
cd ~/ProgrammingProjects/Wcoast
npm start
```

Click **Start**. You should get a drone. Move **Principal → Frequency** to
change pitch. For the complex-oscillator character: **Middle → Pitch Mod (FM)
= On**, then raise **Middle → Mod Index** and change **Modulation → Frequency**.
Switch the **Monitor output** to compare Sine / Square / Final / the mod-osc
outs. The disabled controls (Timbre/Order/Symmetry, Phase Lock, the CV
attenuators) are the deferred DSP, flagged in place.

## What's next (recommended order)

**Milestone 4 = FINISH the Complex Oscillator completely** (every 259t feature
but ART), all in the one module worklet. Three parts:

1. **Wavefolder (Timbre/Harmonics):** the DSP for `timbre` (fold depth),
   `order` (shape morph), `symmetry` (DC-offset-into-fold → even harmonics),
   plus the `timbreMod` switch. It consumes the principal's raw saw (currently
   routed straight to `prinFinalOut`) and folds it into the real Final output.
   CONTAINED internal oversampling (factor a parameter, not a constant — an
   internal quality setting, NOT a faceplate control) with a windowed-sinc/
   polyphase decimator; keep the oversampled region inside the fold block.
2. **Phase lock:** the `phaseLockIn` audio input (already wired to worklet
   input 2) + the `phaseLockAmount` attenuator — the modulation oscillator
   locking to the incoming signal.
3. **1V/oct pitch + CV-input DSP:** octave-per-volt summing for `modPitchIn`/
   `prinPitchIn`, and the CV attenuverter behaviour behind `modCvIn`/`prinCvIn`
   (`modCvAmount`/`prinCvAmount`). These can't be patched end-to-end until the
   connection UI exists, but the input DSP is written and verified NOW against
   the stub harness (feed a 1V/oct ramp → pitch tracks octaves; feed phase-lock
   → it locks), so the module's DSP is genuinely complete.

When those land, every knob on the bench is live and the module is done.

Then, in order: the **faithful panel SVG** for the 259t (§5 — hand-authored
from faceplate photos, `data-wcoast-param`/`-port` tags, host-validated); the
**connection UI** (§3) so the input jacks can actually be patched; then the
next modules — **LPG (292)** and **function generator (281)**. Later: rack,
polyphony (§7), GXW bridge (§9).

## Hard rules to respect (from DESIGN.md — don't rediscover these)

- **Zero allocation on the audio thread.** Top cause of glitches. No
  object/array literals or per-block closures in `process()`; preallocate;
  pull state into stack locals. Read the real `sampleRate` at construction.
- **Band-limited from the start.** PolyBLEP oscillators; oversampled folder
  (factor as a parameter). Native nodes OK for LPG and control-rate modules.
- **Descriptor is the single source of truth.** The host reads only the
  descriptor for panels/grid/menus/dictation/save/GXW-routing; it never
  reaches into a module's DSP. Modules expose the small realized-instance
  contract (getOutput/getInput/getParam/dispose/optional trigger).
- **Faithful, no invented jacks.** `modulatable: true` only where the real
  panel has a CV input. Don't add CV inputs the hardware lacks.
- **Three signal domains** (audio/control/trigger); triggers travel as sample-
  placed impulse signals but are a distinct semantic label. Connection policy
  warns (not denies) on odd combinations; audio-into-control is always allowed
  (that's FM).
- **Accessibility:** dense layouts are GOOD (magnified viewing); every action
  has a dictation path; consistency across modules; the connection UI is
  stub-and-droop + context menu + dictation, backed by the netlist.

## Author working preferences

- Plain-prose answers, no bold/headers/bullets in conversation; code in fenced
  blocks. Interpret dictation errors charitably (e.g. "book la"/"book
  club"/"bula" = Buchla; "note.JS" = Node.js; "geologic" = GeoSonix).
- Don't write commit messages until changes are tested/confirmed; combine
  `git add` and commit into one pasteable block.
- For large/multi-file edits, this (Claude Code) is the right tool.
- Node: Homebrew at `/opt/homebrew/bin`; `npm install` then `npm start`.
