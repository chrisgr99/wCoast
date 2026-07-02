# Wcoast — Handoff

Live orientation for continuing development. Read `DESIGN.md` first for the
full design; this file is the short "where things stand / what's next" state.

## Where things stand (as of this handoff)

- **Spike complete.** Electron shell + custom `app://` scheme (COOP/COEP,
  crossOriginIsolated confirmed true) + AudioWorklet toolchain proven. Both a
  native tone and a worklet tone sound. Zero-allocation + destination-glide
  patterns are established in `worklets/test-tone-processor.js`. Everything in
  the spike is throwaway scaffolding EXCEPT the Electron/scheme setup and the
  worklet discipline, which are keepers.
- **First module descriptor written (data only):** the Complex Oscillator
  (Buchla & TipTop 259t) at `modules/complex-oscillator-259t/descriptor.js`.
  It is modelled from the official 259t manual, with the ART system
  deliberately dropped (see DESIGN.md §10). It also establishes the module
  **schema** (apiVersion, sections, params-with-curves, ports-with-domains-
  and-targets) that every future module mirrors — so treat its shape as the
  reference when adding modules.

## FIRST: commit the current work

The descriptor and design docs are not yet committed. Do this first (it is
data/docs only — nothing executable to test):

```
cd ~/ProgrammingProjects/Wcoast
git add . && git commit -m "Add Complex Oscillator 259t descriptor + DESIGN.md/HANDOFF.md; establishes module schema"
```

(If the repo isn't initialised yet: `git init` first. The spike from the
prior session may already be committed; if `git log` is empty, the spike files
will be included in this commit too — fine.)

## What's next (recommended order)

Per DESIGN.md §11, implementation milestone 3 is next: **the host reads a
descriptor and instantiates a module.** Concretely, the sensible next chunk:

1. **Host/registry skeleton:** load a module's `descriptor.js`, register it,
   and be able to enumerate its params/ports. No audio yet — just prove the
   host can consume the descriptor.
2. **Oscillator DSP factory:** write the `create(ctx, services)` factory and
   the PolyBLEP worklet for the 259t's oscillators (band-limited saw/square,
   sine/triangle nearly free, FM in the phase increment). Start with the two
   oscillators + FM; add the Timbre/Harmonics wavefolder (with a configurable
   oversampling factor) after the bare oscillators sing. Keep the oversampled
   region contained to the folder.
3. **Temporary debug control surface** (NOT the rack) to set params and
   trigger notes, so the module can be heard. Reuse the spike's approach.

Then thicken toward: generated panel SVG (§5), LPG, function generator,
connection UI (§3), rack, polyphony (§7), GXW bridge (§9).

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
