# Wcoast — Design Document

Wcoast is a West Coast (Buchla-style) modular synthesizer for Web Audio,
packaged as a native macOS app via Electron. It is a companion instrument to
GXW/GeoSonel: playable standalone, and later drivable by GXW over a local
message bridge. Non-commercial personal project.

This document is the authoritative design reference. It captures decisions
reached during the design sessions so implementation can proceed against a
settled plan. Where something is deliberately left open, it says so.

---

## 1. Guiding context: accessibility drives the design

The author has limited eyesight, works from a recliner with a monitor on an
articulating arm, uses macOS Accessibility Zoom (screen magnification) as the
primary way of viewing the screen, Speak Selection for reading text aloud, and
speech-to-text dictation as the primary input method, with a Magic Trackpad
and trackball for pointing.

Consequences that shaped every subsequent decision:

- **Magnification means the whole screen is never in view at once.** Any UI
  that relies on taking in a large area as a gestalt (e.g. a full patch-bay
  matrix) fails. Conversely, **dense layouts are good**: packing elements
  close together puts more of them inside the magnified viewport at once, so
  there is less travel. Model the real modules' density faithfully; do not
  spread controls out.
- **Following a patch cord end-to-end is hard.** The connection interface is
  built to replace cord-tracing with identity-matching and spoken commands.
- **Dictation is a first-class input path**, not an afterthought. Every
  creation/editing action has a spoken route, in parallel with pointing.
- **Consistency aids spatial memory.** Controls and connection behaviour must
  work the same way across all modules so there is no per-module relearning.

Buchla was chosen partly because its real panels already lean toward
high-contrast graphics, large well-spaced knobs, and colour-coded signal
domains — qualities that happen to help low vision.

---

## 2. Signal domains (three cable types)

Wcoast is modelled on Buchla, which separates signals into domains. We use
three: **audio**, **control**, **trigger**. Every port declares its domain.

The domains are **typed-with-override**, not rigid. A single policy function
governs connections and returns allow / warn / deny:

- Same-domain connections: allow.
- Audio into a control input: allow — this is audio-rate modulation (FM), and
  is essential; it must never be blocked.
- Trigger domain: kept distinct in the UI and policy; connecting a
  non-trigger into a trigger input, or a trigger into a non-trigger input,
  returns **warn** (not deny) — the user is told it's unusual but may proceed.
- Genuinely odd combinations: warn.

The whole policy lives in one `canConnect(sourceDomain, destDomain)` function
so the rules are in one place and adjustable.

### Trigger transport (internal, invisible to user)

Triggers are a first-class *cable type* in the UI, but under the hood a trigger
travels as an **impulse on an audio-rate signal** (a shaped pulse), on an
ordinary node connection — NOT as an out-of-band scheduled method call. This
keeps the host's graph-wiring uniform (all three domains wire the same way)
and is faithful to what a Buchla trigger actually is (a pulse with a shape,
not an instantaneous event). Timing precision is recovered by sample-placing
the impulse at its source (same approach as GXW-bridge triggers, §9).

Because the transport is shared, a port's domain is a **semantic label** the
author must declare honestly in the descriptor — it is the sole source of
truth for the port's category, decoupled from the fact that all three ride the
same kind of wire.

---

## 3. Connection interface

The **netlist is the source of truth** — a patch is a list of edges. Every
visual surface is a different rendering of that same edge list, so surfaces
can be added/removed without architectural change.

### Primary surface: stub-and-droop on the real panel

Connections are shown ON the real module panels (not a separate matrix), but
cords are NOT drawn full-length (that reintroduces cord-tracing). Instead:

- Each end of a connection shows a short **stub** leaving the jack, drawn as
  the tangent of where the cord *would* hang as a catenary.
- The stub's **departure angle encodes both direction and distance**: a near
  destination has slack, so the cord hangs steep (stub points nearly straight
  down); a far destination pulls taut, so the stub leaves at a shallower
  angle. Steep = near, shallow = far. **Render every cord with the same
  virtual slack constant** so angle maps consistently to distance.
- Ends are matched by **colour identity**, not by tracing. Two stubs of the
  same colour are the two ends of one cord.
- **Hover a jack** to reveal its full cord(s) — the escape hatch when matching
  is ambiguous or a region is crowded (esp. fan-out). A momentary
  **show-all-cords** shortcut exists as a whole-patch sanity check. Both are
  momentary, not the working view.

### Cable colour = identity (end-matching)

Colours are **auto-assigned** and carry cord identity for end-matching.
Colour need NOT be globally unique: angle+droop already narrows the search to
a small region, so colour only disambiguates within that region. The colour
allocator's real job: **a single source's fan-out cords must be mutually
contrasting**, because hovering a source to disambiguate its fan-out shows
those cords side by side. Elsewhere colours may repeat freely.

### Cable style = domain (styled by DESTINATION)

Domain is shown on channels **independent of colour** (colour is spoken for by
identity). Styling is by the **destination** domain, via this precedence:

```
styleOf(sourceDomain, destDomain):
  if sourceDomain === "audio"   -> "audio"     // any audio-rate signal, incl. FM & FM feedback
  if destDomain   === "trigger" -> "trigger"
  else                          -> "control"
```

Rationale: audio-rate presence is the loudest fact about a cable (aliasing,
feedback, CPU, FM character), so it wins first — this makes FM and FM-feedback
cables read as audio automatically, with no FM-specific logic. Otherwise
trigger-ness is a property of reception, so the destination decides.

Visual encoding (two reinforcing channels; colour stays free for identity):

- **Thickness is the primary domain cue:** audio = thick, control = thin.
- **Trigger = medium width AND dashed.** Medium (not thick) so the dashed line
  doesn't consume too much space; medium (not thin) so the dashes stay
  visible; dashes close together so a short stub still reads as dashed.

All appearances are **subject to tuning on real stubs at working
magnification** — the principle is fixed (colour=identity, thickness+dash=
domain), the exact pixel values are empirical.

### Creation surfaces (three doors to the same edge)

1. **Drag-to-patch** on the panel (primary): grab an output jack, drop on an
   input jack. The author has good pointer control (trackpad + trackball).
2. **Context menu** at the pointer (accessibility-friendly under zoom because
   it appears inside the current magnified viewport): right-click an output ->
   menu of destination modules -> pick one -> a **half-size mini-panel of that
   module** appears at the pointer showing its real inputs in their real
   layout -> click the real input jack to connect. Drill-down happens **in
   place** (menu redraws / panel appears at pointer); **no fly-out submenus**
   (they demand a hover-corridor and can open off-screen under zoom). The
   mini-panel also truthfully shows which inputs are already occupied.
3. **Dictation** (parallel, no-pointer path): e.g. "connect mod oscillator out
   to carrier FM, amount forty percent" makes the same edge.

### Reading/removing: sparse grid (optional, demoted)

An optional **sparse connection grid** shows only rows/columns that carry a
connection, in a **stable canonical order** (positions don't reshuffle as
edges come and go, so spatial memory can form). It is a reading/pruning
surface (click a filled cell to break), not required for creation. The full
global matrix is dropped. The grid is an on-demand audit view, not a co-equal
interface.

---

## 4. Module abstraction (pluggability)

A module is up to **three separable artifacts**:

1. **Descriptor (data, required):** the single source of truth. Declares
   identity, sections, parameters, and ports (with domains). The host reads
   ONLY the descriptor to build panels, the connection grid, patching menus,
   dictation names, save/load, and GXW routing. The host is never coupled to
   specific modules — it just reads descriptors, which is what makes
   third-party modules work like built-ins.
2. **Factory (code, required for sound):** `create(ctx, services)` builds the
   actual Web Audio nodes when a voice needs sound, and returns a small
   **realized-instance** contract: `getOutput(portId)`, `getInput(portId)`,
   `getParam(paramId)`, optional trigger method, `dispose()`. The host wires
   by walking netlist edges and asking instances for nodes/params. It never
   reaches inside.
3. **Panel (SVG, optional):** see §5. Falls back to auto-layout if absent.

### Parameters

A parameter is a **control-domain input backed by an AudioParam** with: name,
range (min/max), unit, default, curve (`linear`/`exp`/`stepped`), glide time
(ms), and `modulatable` flag. This one abstraction serves four consumers at
once: the knob in the panel, the modulation destination in a patch, the glide
target for smoothing, and the address a GXW message writes to.

**`modulatable` is set per-knob to match the hardware** — true ONLY where the
real panel has a CV input jack for that knob. It is not a default-on
convenience; `modulatable: false` means "no jack, don't draw one, nothing can
patch here." We deliberately do NOT add CV inputs the original lacks (avoids
faceplate clutter and complexity with no real benefit). Relaxing this for a
specific knob would be a deliberate, marked departure.

Where a modulatable param has an explicit CV jack, that jack is listed in
`ports` with a `target` naming the param (and `via` naming an attenuator knob
if the CV passes through one). Pure signal jacks (audio FM ins, phase-lock in,
all outputs) are ports with no target.

### Scope (per-voice vs shared)

The descriptor's `scope` field is `"voice"` (instantiated once per polyphonic
voice) or `"shared"` (instantiated once, feeds all voices). This is where the
"shared vs independent source-of-uncertainty" decision is encoded
declaratively — one word, not a structural rewrite.

### Addressing & versioning

Uniform addressing across every consumer: a parameter is `instanceId.paramId`,
and that same address is what the netlist stores, the connection UI
references, and a GXW message targets. The descriptor carries `apiVersion` so
the host can adapt/refuse modules gracefully as the contract evolves.

---

## 5. Panel system (custom appearance, uniform behaviour)

Panels are a **custom appearance layer only**, never a behaviour layer. The
author designs how a module looks (faithful to the real hardware, dense,
distinctive); the **host owns all connection interaction** (stub-and-droop,
grid, menus, dictation). This preserves per-module visual character AND
guarantees every module patches identically — the accessibility win.

### Authoring workflow (correct-by-construction)

1. The host **generates a starter SVG** from the descriptor: a knob for each
   parameter, a jack for each port, a text label for each, every element
   tagged with its binding (`data-wcoast-param="..."` / `data-wcoast-port=
   "..."`) and placed to mirror the real module's layout.
2. The author (optionally) opens it in an SVG editor and drags things for a
   better/faithful layout, or refines **by dictation** ("move the FM index
   knob below the principal pitch") with the host editing the SVG directly.
   The SVG editor is available but not required.
3. The host loads the SVG as the panel, **reading positions and faceplate art
   only** — each control's size/appearance comes from the host's own
   rendering, so all knobs stay visually uniform across modules.

Because the starter SVG is generated from the descriptor, bindings always
match the abstract definition — mismatches are impossible to introduce by
dragging. If a descriptor gains a control later, regeneration is **additive**:
the host keeps existing positions and drops any newly-declared control at a
default spot; it never clobbers a hand-arranged layout. Faithful density is
encouraged (helps magnified viewing).

Start the panel format at the low-to-middle end (positions, sizes, groups,
labels, background image, host-drawn knobs). Faceplate art / custom knob skins
can grow later without changing the principle.

---

## 6. Audio engine architecture

- **Band-limited from the start.** The whole DSP architecture is committed to
  anti-aliasing. Built-in OscillatorNode band-limiting is undone by non-linear
  processing (the wavefolder), so the signature Buchla move needs custom DSP.
- **AudioWorklet-based DSP** for the modules that generate/fold harmonics:
  - Complex oscillator: **PolyBLEP** band-limited saw/square (sine/triangle
    nearly free), with FM built into the phase increment (through-zero FM
    exact, unlike the built-in oscillator's approximation).
  - Wavefolder: **internal oversampling** (2x/4x/8x — make the factor a
    parameter, not a constant) with a windowed-sinc/polyphase decimation
    filter. Keep the **oversampled region contained** to the folder block; the
    graph outside stays at base rate.
- **Native nodes are fine** for the LPG (subtractive — lowpass filter + VCA
  sharing a control signal with a `setTargetAtTime` vactrol-ish decay) and for
  control-rate modules (function generators, sample-and-hold via a
  ConstantSourceNode with scheduled random jumps).
- **Zero allocation on the audio thread** is the single most important
  discipline — the top cause of glitches (a GC pause blows the 128-sample
  deadline), far more than oversampling cost. No object/array literals, no
  per-block closures; preallocate everything; pull instance state into stack
  locals in the process loop. The spike worklet already follows this.
- **Read the real sample rate** at construction (`sampleRate` global); it may
  be 44100 or 48000. Derive smoothing coefficients and oversampling from it.
- **crossOriginIsolated** is arranged (custom `app://` scheme + COOP/COEP
  headers in the Electron main process) so SharedArrayBuffer stays available
  for an optional future WASM-DSP route (compile oscillator/folder DSP from
  Rust/C). NOT in use yet — first DSP is hand-written JS. Reach for WASM only
  if profiling demands it.

---

## 7. Polyphony & voice model

- **~3 voices** — GXW benefits from a little polyphony. A Buchla voice is
  deep, not massively polyphonic, so 3 voices is cheap even with an
  oversampled folder per voice (oversampling cost scales with voice count, and
  3 is far from where it hurts).
- **Full polyphony** (independent complete copies of the patch per voice), not
  paraphonic — the cheapness makes the independence worth it.
- **Voice allocation / stealing must be designed deliberately**, because GXW
  is generative and will overflow a 3-voice pool routinely (it's a normal
  operating condition, not an edge case). Default: **steal-oldest with a fast
  release** so the stolen voice doesn't click; the LPG's natural decay makes
  an already-fading voice a graceful steal candidate.
- The **voice allocator is the seam** between GXW's note events and physical
  voices: GXW fires abstract note-on/note-off events; the allocator maps them
  onto voices and handles stealing; the synth decides how many can sound. GXW
  does not reach into specific voices.
- **Random-source scope** (correlated vs divergent voices) is set by the
  source-of-uncertainty module's `scope` field — shared = correlated,
  voice = divergent. (Open preference; encode as `scope`.)

---

## 8. Module roster & build order

Core voice (build in this order):
1. **Complex oscillator (259t)** — principal + modulation osc, FM, and the
   Timbre/Harmonics wavefolder section. Descriptor DONE. (This is the piece
   most character lives in; build first.)
2. **Wavefolder** — if not folded into the 259t model, the signature harmonic
   adder; worklet + oversampling.
3. **Low pass gate (292)** — plucky vactrol amplitude+brightness; native
   filter+VCA+decay.

Modulation & timing (make it move):
4. **Function generator (281)** — rise/fall envelope that self-cycles into an
   LFO; both envelope and LFO; can cross to audio rate. The workhorse; the
   ONLY possible source of fast modulation (GXW cannot supply audio-rate).
5. **Source of uncertainty (266)** — sample-and-hold + fluctuating random +
   noise; the generative heart.
6. **Clock/pulser** — minimal timing. NOTE: consider keeping the synth's own
   timing thin and letting GXW be the sequencer when bridged. A full
   sequencer is optional / deferred.
7. **Attenuators / CV mixer** — connective tissue; wanted as soon as there's
   more than one modulation source. (Control edges already get an inline gain
   for the per-connection amount, i.e. a free attenuator per control cord.)

Full-fidelity rule: each Wcoast module represents its real Buchla counterpart
**completely** — every jack and control — except hardware-only features with
no software meaning (see ART, §10). Completeness sets the DSP bar per module;
finish one module fully before the next.

---

## 9. GXW bridge (deferred, but designed)

- **Separate audio contexts.** GXW and Wcoast do NOT share an audio graph;
  they talk over a local message transport. (Electron-to-Electron makes this
  far simpler than browser-to-anything.)
- **GXW is tick-rate and cannot produce audio-rate control.** This is settled
  by GXW's nature (physics-tick cursor motion). Therefore:
  - **All fast/audio-rate modulation lives inside Wcoast** (its function
    generators, LFOs, random source). GXW *parameterises and triggers* these;
    it is not itself a modulation source. This is also the more Buchla-true
    arrangement.
  - **Everything GXW sends is control-rate**, so everything gets
    **destination-side glide** (one-pole smoothing toward a target). This, not
    message rate, is what cures zippering. **Match the glide time to GXW's
    tick interval** (reach each target ~as the next arrives) — derive it from
    the tick rate, don't hardcode. Err slightly long (smooth-but-slightly-
    laggy beats stepped).
- **Note triggers are timestamped and scheduled**, not played on arrival, so
  rhythmic resolution isn't capped at the physics tick grid or subject to
  transport jitter. GXW's firing engine already reasons in scheduled time;
  emit each event a small lookahead ahead with its intended timestamp; the
  synth places it at the intended sample.
- **Transport:** OSC-shaped messages are a reasonable convention (address +
  args + time tags), over a WebSocket / MessageChannel on the local machine.
  Plain JSON with {address, value, timestamp} over the same transport does the
  identical job — OSC is a tidy convention, not a speed requirement.
- **Strudel support: dropped by choice** (avoids constraining the design and
  adding a second vocabulary). Not foreclosed: because GXW and Strudel would
  both be clients of the same message front door, a superdough adapter could
  be added later without redesign. Not now.

---

## 10. ART — dropped (reference decision)

The 259t's ART (Autonomous Reactive Tuning) hardware solves two analog
problems Wcoast does not have: autotuning oscillator **drift** (a digital
oscillator computes frequency exactly and never drifts), and **polyphonic
voice allocation over a hardware protocol** (handled by Wcoast's own voice
engine + the GXW bridge). So the ART switch, ART input jacks, and GATE OUT
jacks are omitted from the module; the plain 1V/oct pitch input remains and
tracks perfectly. This is the template for handling any hardware-only feature:
reinterpret or drop features that only exist because of physical constraints
we don't share, rather than modelling dead controls.

---

## 11. Milestones

### Design milestones (mostly complete)
1. Module abstraction — descriptor/factory/panel, ports, params. DONE (§4).
2. Patch & connection model — netlist, edges, type rules. DONE (§2–3).
3. Rack & panel spatial model — layout + the accessible connection surfaces.
   Panel system DONE (§5); rack layout/coordinate model still to detail.
4. Audio engine & voice host architecture. DONE on paper (§6–7); worklet-
   realization details finalised against the running spike.

### Implementation milestones (to first sound and beyond)
1. Electron shell + audio bootstrap (native tone). **DONE** (spike).
2. Worklet pipeline (trivial sine, proves toolchain). **DONE** (spike).
3. Module abstraction in code — host reads a descriptor; oscillator is the
   first concrete module conforming to it. NEXT.
4. Real band-limited oscillator DSP (PolyBLEP + phase-increment FM).
5. Temporary debug control surface (NOT the rack) to play/hear the module.
   ("First module producing sound" in full.)
Then thicken: panel SVG, wavefolder, LPG, connection UI, rack, polyphony,
GXW bridge.

---

## 12. Current status

- **Spike complete and committed-worthy:** Electron shell; custom `app://`
  scheme serving the renderer over a secure isolated origin with COOP/COEP;
  worklet toolchain proven (native tone + worklet tone both sound);
  crossOriginIsolated confirmed true; zero-allocation + destination-glide
  patterns established in `worklets/test-tone-processor.js`.
- **Complex Oscillator 259t descriptor written** (data only, ART dropped) at
  `modules/complex-oscillator-259t/descriptor.js`. Establishes the module
  schema (apiVersion, sections, params-with-curves, ports-with-domains-and-
  targets) that all future modules mirror.
- **Not yet built:** DSP factories, panel SVGs, connection UI, rack, polyphony,
  GXW bridge.

### Open / to-verify
- 259t fine points to check against a clear panel photo: whether Timbre CV has
  its own attenuator; exact Order/Symmetry end-labels; any second direct FM
  jack. (Marked TODO:verify in the descriptor. None block design.)
- Rack coordinate/layout model: still to detail.
- Random-source scope default (shared vs per-voice): to choose.
- Exact stub/cable pixel values: empirical, tune on-screen at magnification.

---

## Project conventions

- Electron shell mirrors GXW's posture: context isolation on, node integration
  off, sandboxed renderer, non-fatal crash-log net.
- Renderer served over `app://` (NOT `file://`) so AudioWorklet.addModule and
  crossOriginIsolated work and isolation headers can be attached.
- Node: Homebrew at `/opt/homebrew/bin`. `npm install` then `npm start`.
- Chat/prose style for the author: plain paragraphs, no bold/headers/bullets
  in conversation; code in fenced blocks; interpret dictation charitably.
