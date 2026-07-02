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
- **Milestone 4 DONE — the 259t is COMPLETE (every feature but ART).** All in
  the one worklet: the oversampled Timbre/Harmonics wavefolder (triangle
  multi-fold; Order = sine→saw fold-input morph; Symmetry = DC offset → even
  harmonics; timbreMod; windowed-sinc FIR decimator, oversample factor from
  `descriptor.dsp.oversample`), phase lock (rising zero-cross on `phaseLockIn`
  pulls modPhase toward 0 by `phaseLockAmount`; hard sync at 1), and the 1V/oct
  pitch + CV inputs (`modPitchIn`/`prinPitchIn` direct, `modCvIn`/`prinCvIn`
  via attenuverters) summed exponentially inside the worklet. The factory now
  exposes 7 worklet audio inputs; the exp-CV-vs-linear-CV split is a generic
  rule (target param's `curve`): exp → worklet input, linear (folder) →
  AudioParam. Every bench knob is now live.
- **Validated headlessly:** ESM imports clean; the worklet runs 300+ blocks
  NaN-free and bounded; folder total-variation ~4× higher at max timbre/order;
  +1V raises pitch one octave (221→441 Hz); hard sync resets the mod phase;
  the bench builds all rows under a fake DOM. **Audible confirmation of the
  folder etc. still wants a human ear** (oscillators already confirmed).

## FIRST: hear the finished module

```
cd ~/ProgrammingProjects/Wcoast
npm start   # if it's already running with old code, quit (Cmd-Q) and restart
```

Click **Start** for a drone. Set **Monitor output = Final** and turn up
**Timbre / Harmonics → Timbre** to hear the wavefolder open up; add **Order**
and **Symmetry** for more/asymmetric harmonics. Move **Principal → Frequency**
for pitch. For the complex-osc character: **Middle → Pitch Mod (FM) = On**,
raise **Mod Index**, sweep **Modulation → Frequency**. Knobs marked "needs a
patched cord" (FM/CV/phase-lock amounts) are live but silent until the
connection UI exists — their DSP is verified by harness.

## What's next (recommended order)

The Complex Oscillator's DSP is finished. Recommended order from here:

1. **Faithful panel SVG for the 259t** (§5) — hand-authored from faceplate
   photos, `data-wcoast-param`/`-port` tags binding to the descriptor,
   host-validated on load. Needs the host's SVG loader + validation + a way to
   render/interact with the tagged elements (this is new host work, not in the
   bench). Get a clear 259t faceplate photo first.
2. **Connection UI** (§3, stub-and-droop + context menu + dictation) so the
   external jacks can actually be patched. Only then do the input-dependent
   knobs (FM/CV/phase-lock amounts) become audible; the instance already
   exposes `getInput` (7 worklet inputs) and `getParam` (folder CV → AudioParam)
   so host wiring lands without touching the module.
3. **Next modules — LPG (292), function generator (281).** Native filter+VCA+
   decay, and the workhorse envelope/LFO (the only audio-rate mod source).

Later: rack, polyphony (§7), GXW bridge (§9).

### Folder notes (for tuning later)
The wavefolder is a triangle multi-fold (bright, 259-ish). `TIMBRE_DRIVE` and
`SYMMETRY_RANGE` constants in the processor set the feel; Order crossfades the
fold input sine→saw; oversample factor is `descriptor.dsp.oversample` (4). It's
"reasonably realistic," meant to be tuned by ear against a panel/recording, not
sample-exact — the Order/Symmetry mapping especially is a defensible
approximation (see the descriptor's TODO:verify notes).

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
