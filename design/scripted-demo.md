# LibreSynth Scripted Demo (Attract Mode) — Design

A self-contained subsystem inside LibreSynth that plays back an authored sequence of
patching and performance actions — instantiating modules, drawing patch cables,
turning knobs, firing gates — while a synthetic on-screen pointer moves around the
panel so it reads as a hand-operated session. It runs entirely inside the app,
with no AI or external driver in the loop at playback time. You run it on command
(menu item, keyboard, or a URL) and capture it with an external screen recorder
that grabs system audio; the recording itself is out of scope.

The output is a screen-plus-audio recording of a generative modular synth, so the
aim is repeatability: on the same machine and output device, every replay should
look and sound the same, so takes are interchangeable and re-recording is free.

## Non-goals

- Not a test or automation framework, and not driven by synthetic DOM input
  events — it never fakes pointer/drag events to trigger handlers.
- Does not record the screen; capture is an external tool's job.
- Does not target cross-machine audio identity (see Determinism).
- No control-message layer. The runner calls LibreSynth's own methods directly; the
  GXW control-rate link is a separate, unrelated interface and is not involved.
- Does not rename module descriptor ids or folders — they keep their legacy numbers
  (a separate refactor, out of scope). This subsystem only uses module names in its
  human-facing text (captions, menus, docs).

## Principle: theatre separate from behaviour

The synthetic cursor is pure theatre. Each step positions the cursor over the
relevant control and plays a click/grab/turn animation; the actual effect —
instantiate, patch, set a parameter, fire a gate — is produced by calling the
rack's own imperative methods directly. The cursor is choreographed to sit over
the right knob or jack just before each call, so it looks like the pointer did the
work while the work goes through the same entry points the live UI uses. The demo
therefore cannot desynchronise from real app state, and it degrades gracefully: if
the animation is skipped, the patch still builds correctly.

## The action surface

The runner drives a thin adapter over methods the `Rack` already exposes (the same
ones the live UI and save/load use), so the timeline never reaches into rack
internals:

- **instantiate** — `rack.addModule(descriptorId, row, xMm, { key })`. The demo
  passes a stable `key` (e.g. `"osc"`) so later steps can reference the instance.
- **patch** — `rack.connectPatch({ key, portId }, { key, portId })` (renders a real
  cable) and its inverse for unpatch.
- **set / ramp** — `rack.applyParam(rec, paramId, value)`. A ramp is the adapter
  stepping `applyParam` across sub-values on the demo clock so the knob visibly
  rotates and the audio sweeps.
- **trigger** — there is no separate trigger call; firing a gate is `applyParam`
  on a momentary param (e.g. `strikeA` → `"on"`), exactly as the panel's strike
  buttons do.

`rack.records` is the `key → rec` map the adapter resolves instance keys through.

## Synthetic cursor layer

A single DOM element above everything — an SVG pointer or styled div, `position:
fixed`, high z-index, `pointer-events: none` so it never intercepts anything.
During playback the real OS cursor is hidden (`cursor: none` on the app root) so
only the synthetic pointer appears in the capture. The layer supports move-to
(each leg follows an ease-in-out curve — accelerating away and settling as it
arrives, with travel time scaled to distance — so the pointer reads as a human hand
rather than a linear glide), dwell, a **prominent
click animation** — an expanding ring/ripple at the point of contact, plus a brief
highlight of the control being acted on — so each interaction plainly lands on
camera rather than being a silent state change, and a grab/drag affordance for
drawing cables (the cable visibly follows the pointer from jack to jack). Movement
is frame-driven but slaved to the clock below, so the pointer stays locked to the
audio rather than free-running.

## Caption layer

Alongside the cursor, a caption box narrates what is happening — a legible message
box (large, high-contrast text, fixed to a screen edge such as lower-centre) that
holds a short line per action: "Add a Complex Oscillator", "Patch its output into
the Low Pass Gate", "Start the gate's internal clock". A step carries an optional
`caption`; when present the box crossfades to that text and holds it until the next
caption. Captions are sized for video legibility (and for low-vision viewing),
theme-aware, and timed on the same demo clock so the narration stays in step with
the pointer and the audio. The box is part of the theatre layer, drawn above the
app, and is suppressed outside playback.

## Control resolution

The timeline addresses controls logically — by instance key plus control id —
never by pixel coordinates, and only resolves to screen space at the last moment.
The binding already exists: `parsePanel` (host/panel-loader.js) stores, on each
record's `rec.panel`, a `controls` map (paramId → binding) and a `ports` map
(portId → binding), each pointing at the live SVG element (`data-wcoast-param` /
`data-wcoast-port`). Jacks are additionally tagged in the DOM with `dataset.jackKey`
/ `dataset.jackPort`, and `rack._jackElement(key, portId)` returns a jack element
directly.

So a step's target resolves as: look up `rec = rack.records.get(key)`, then the
control's element via `rec.panel.controls.get(paramId)` (a knob) or
`rec.panel.ports.get(portId)` (a jack), then read `getBoundingClientRect()` and
take its centre in screen space right then. This survives accessibility zoom and
wherever the articulating-arm monitor has the layout, because the authored sequence
is geometry-independent. If a referenced control is absent (its module was never
instantiated), the step fails loudly in an authoring/preview mode rather than
silently mis-placing the cursor.

## Timeline and runner

An authored demo is a declarative, ordered list of steps loaded from disk, sitting
naturally alongside the module descriptors. The runner walks the timeline, driving
the cursor layer and invoking the action adapter at each step's scheduled time. The
step vocabulary is small and stable:

- `instantiate` — add a module at a panel position, under a stable key
- `patch` / `unpatch` — connect or remove a cable between two jacks
- `set` — set a parameter, optionally as a timed ramp
- `move` / `dwell` / `click` — pure cursor choreography, no side effect
- `wait` — advance the clock and let the patch play

Any step may also carry a `caption` — a line of narration shown in the caption box
(above) — and `cursor: true` to give it the full pointer-and-click treatment.

Setup steps (instantiate, initial patching) may run with the cursor hidden or
moving quickly; the "performance" steps get the full cursor treatment. A demo
begins from a rack cleared of user modules (the pinned Mixer aside) and builds the
whole patch itself, so it is self-contained and never depends on prior app state.

## Determinism

Two things make replays match on one machine:

1. **Schedule against the audio clock.** Parameter ramps and gate fires are placed
   relative to `AudioContext.currentTime`, not wall-clock or `requestAnimationFrame`,
   so the DSP renders the same each time. The cursor animation reads elapsed time
   from the same audio clock each frame and interpolates position from it, so the
   visuals stay welded to the audio even if frame timing jitters.
2. **Fixed starting conditions.** A known initial rack (empty), the descriptors'
   default param states, and a fixed order of operations.

The current modules (oscillators, gates, envelopes) carry no randomness, so this is
enough for matching takes today. When a stochastic module lands (a noise / source-
of-uncertainty style random-voltage module), it must expose a seedable PRNG whose
seed the demo pins at start — otherwise its audio drifts run to run. Full
cross-machine byte-identity (rendering the audio through an `OfflineAudioContext`
and muxing it with the captured video) is an optional future extension, not the
default.

## Demo library and triggers

Demos are a named library — one file per reel, kept together in a `demos/` folder
in the app (JSON, discovered by name, the way modules are registered). A build can
carry several reels, each addressed by its `id`.

Choosing and starting are two separate acts, because the author needs the start
timed to when the screen recorder begins:

- **Choose** — an unused wedge of the panel ("main") pie carries a demo launcher
  (a clapperboard/film icon). Clicking it opens a list of the named demos; picking
  one **arms** it as the current demo (it does not start yet). This launcher wedge
  and its list are **hidden whenever a demo is running**, so they never appear in
  the recording.
- **Start** — a **keyboard shortcut** starts the armed demo. This is the
  record-timing trigger: the author hits record, then presses the key, so the reel
  begins exactly when they choose. The same shortcut re-runs the armed demo.
- **URL / auto-run** — a hash on the `app://` scheme
  (`app://wcoast/index.html#demo=intro`) auto-starts a named demo on load, and an
  auto-run/loop flag drives kiosk/attract use. (No URL is read at boot today; this
  is new.) A "Run Demo" item in the Electron native menu is an optional convenience.

## Playback rate

A single global rate multiplier scales the whole demo clock — cursor travel,
dwells, parameter ramps, and waits all stretch or compress together, so pacing
stays proportional and the audio ramps still land musically. This is the knob for
trading legibility against running time: slower for a clear teaching pass, faster
for a tight highlight reel. A demo may declare a default rate; a global override
(settable near the launcher) wins, so one authored reel can be re-recorded at
several speeds without editing it.

## Authored demo format

A demo is data, loadable from disk — a compact JSON shape; a thin JS builder over
the same shape is optional authoring sugar. Control references use the descriptor-
declared ids. The first reel wires the **Complex Oscillator** into the **Quad Low
Pass Gate** into the **Mixer**, lets the gate strike itself from its own internal
clock, and sweeps the oscillator's timbre. The Mixer is the pinned singleton
already on the rack (key `mixer`), so the demo patches into it rather than
instantiating it, and the runner turns the transport on at reel start so the patch
is audible.

```json
{
  "id": "intro",
  "steps": [
    { "type": "instantiate", "module": "wcoast.complexOsc259t", "row": 0, "x": 0, "as": "osc", "caption": "Add a Complex Oscillator" },
    { "type": "instantiate", "module": "lpg-292", "row": 1, "x": 0, "as": "lpg", "caption": "Add a Quad Low Pass Gate" },
    { "type": "move",  "to": "osc:prinFinalOut", "dur": 0.6 },
    { "type": "patch", "from": "osc:prinFinalOut", "to": "lpg:inA", "cursor": true, "caption": "Patch the oscillator into the gate" },
    { "type": "move",  "to": "lpg:outA", "dur": 0.5 },
    { "type": "patch", "from": "lpg:outA", "to": "mixer:chanA", "cursor": true, "caption": "Patch the gate into the mixer" },
    { "type": "set",   "target": "lpg:run",    "to": "on", "cursor": true, "caption": "Start the gate's internal clock" },
    { "type": "set",   "target": "lpg:clkOnA", "to": "on", "cursor": true },
    { "type": "set",   "target": "osc:timbre", "to": 0.85, "ramp": 3.0, "cursor": true, "caption": "Open the timbre" },
    { "type": "wait",  "dur": 6.0 }
  ]
}
```

Times are seconds on the demo clock; `cursor: true` marks steps that get full
pointer choreography versus instant setup. Targets like `osc:timbre`, `lpg:outA`,
and `mixer:chanA` resolve through the descriptor ids and the panel binding. The
JSON `module` value is the internal descriptor id (which still carries a legacy
number); everywhere in prose a module is named, not numbered.

## Recording mode

A clean playback mode hides the OS cursor, optionally suppresses development chrome,
and can bracket the reel with brief title/outro states. Capture is external, so the
only contract with the recorder is visual and audible: hide the real pointer, keep
the synthetic one crisp, and let audio leave through the normal output path so a
system-audio recorder catches it. The click ripples and the caption box are what
make the reel legible on camera — a viewer sees each pointer action land and reads,
in the message box, what it accomplished. Attract-loop mode restarts the reel after
the outro.

## Where it rides / build order

The subsystem needs the registry to instantiate modules, the descriptors to
enumerate addressable controls, and the rack's imperative methods to act — all of
which exist. It lives in a small `host/demo/` module (runner, action adapter,
cursor, captions), a `demos/` folder for the reels, and thin wiring in the rack,
the app, `index.html`, and the Electron main.

Staged so each stage stands alone and is verifiable:

1. **Runner core + action adapter** — the adapter over `rack.addModule` /
   `connectPatch` / `applyParam`, the logical-id resolver (`instance:control` →
   record → element/centre), and a runner that walks steps on a demo clock scaled
   by a rate multiplier, scheduling ramps/waits on `AudioContext.currentTime`. No
   theatre yet; proves a script builds the patch and makes sound.
2. **Synthetic cursor + click theatre** — the eased pointer, click ripple, control
   highlight, and cable-drag, choreographed just before each action; OS cursor
   hidden in playback.
3. **Caption box** — per-step narration in a legible, theme-aware box.
4. **Demo library + loader** — the `demos/` folder, JSON loaded by name, the first
   reel authored as `demos/intro.json`.
5. **Triggers and launcher** — the panel-pie launcher wedge (arm a reel) and the
   keyboard shortcut (start it, for record timing), the launcher hidden during
   playback, plus the `#demo=` URL and auto-run/loop.
6. **Recording mode and polish** — global rate override, sound-on at reel start,
   title/outro brackets, attract-loop, and an easing/timing tuning pass against the
   live panel.

Determinism is folded into Stage 1 (audio-clock scheduling); PRNG seeding stays
deferred until a random module exists, and the offline-render path is an optional
future extension only if cross-machine identity is ever needed.

## Open decisions

- Authored format: hand-edited JSON, a JS builder, or a record-and-refine authoring
  aid. Start with JSON plus the descriptor-declared ids — lowest friction.
- The exact easing/timing feel of the cursor — travel speed, dwell lengths, how a
  knob-turn animates against its parameter ramp — is a tuning pass best done against
  the live panel once the runner renders.
