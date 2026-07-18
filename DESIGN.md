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

**Free patching is the default (Serge-spirit).** Because nothing is denied, the
connect menu surfaces **every compatible port, cross-domain included**, not just
same-domain ones — so anything can patch into anything (a function generator's CV
or pulse into the mixer, etc.). The domains survive purely as **identity**: a
cable's colour/style still tells you what it carries, and cross-domain candidates
are shown dimmed. The domains no longer gate connectivity, only inform it.

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

### Terminal + cable colour = signal family

Colour is the signal **family**, the same for a jack and the cords that touch
it, so what-can-patch-into-what reads at a glance:

- **audio → yellow**
- **CV / control → orange**
- **trigger / gate / pulse → blue** (a light blue, so the black direction dashes
  read on it)
- **1V/oct pitch → green** — kept distinct; pitch is the one CV that earns its
  own colour.

A **cable takes its DESTINATION jack's colour** (`familyOfPort` in the patchbay),
so a cord's colour tells you what it feeds. Cross-family patching is allowed
(free patching) — an audio out into a CV in simply draws an orange (CV) cord.

Every cable is **one thick, solid weight** — no thinner grades, no dashes,
including the cord in hand — so a short stub always reads and the rack looks
like a real patchbay.

### Direction = a dashed ring on the jack

The same family colour serves both an input and an output; **direction is a bold
black dashed ring** on the coloured band, a third of the band wide:

- **output** — ring on the **outer** third, hugging the outer edge;
- **input** — ring on the **inner** third, hugging the hole.

Dashes at the rim read as "signal leaves here"; dashes at the porthole as
"signal enters here". The host paints both the fill and the ring from each
port's domain and `dir` (`jackFill` / `addDirRing` in the panel loader) — nothing
is baked into panel art, so every module and both light/dark panels stay in
lockstep.

### Creation surfaces

1. **Click-to-carry** on the panel (primary, and the whole pointer story). Cabling
   never holds the mouse button: **click a jack, and the cord follows the pointer
   with your hand free** until you **click again to drop** it — on a valid jack it
   connects, on empty space it cancels (Escape or a right-click also cancel). The
   free hand is the point: mid-pull you can still scroll, pan the view, and open
   the overview navigator to cross the rack, none of which is possible while a
   button is held. Holding the button and dragging deliberately does **nothing**;
   letting go simply leaves you in the carry, so the habit corrects itself.
   Cords are stub-less: each ends in the **middle of the jack's coloured band** and
   droops between. **Grab a cord anywhere on its port** — click a connected port
   and that port's end lifts to be re-routed (drop on another valid jack to move
   it, on empty space to **delete**); the cord breaks the moment it's lifted, so
   you hear the patch without it while you decide. Click a **bare** port and a
   fresh cord trails the pointer instead. A port can fan out to several cords, so
   the **direction of your first move picks which one** you grab — the cord leaving
   that port most nearly that way; a stack of same-direction cords is teased apart
   by first bending one aside with its mid-cord handle. Because picking up a
   connected output lifts its cord rather than starting a new one, an extra
   fan-out cord is **started from the destination** (always an empty input, since
   inputs hold one cable) and carried back to the output. While carrying, valid
   targets thicken their rings and the one under the pointer **swells with a bold
   outline in its family colour** — the "ready to receive" cue. A drop onto an
   occupied input is rejected (the cord snaps back). There is **no jack context
   menu** — a right-click on a jack opens its Scope/Monitor/Upstream options.
2. **Dictation** (parallel, no-pointer path): e.g. "connect mod oscillator out
   to carrier FM, amount forty percent" makes the same edge.

### Reading/editing: connection list (planned)

A floating **connection list** — every cable as a source->destination row, a
coloured dot at each end matching its terminal, joined by a line in the cable's
own colour and thickness — read as **patch documentation**. All modules appear
even with no connections. Roll-over a row to **highlight that cable and its two
terminals** in the rack. A plain click on a jack opens this list; later phases
add editing (drag a row's end to re-route, drop to delete) so it becomes a
co-equal editing surface, not just an audit view. The full global matrix is
dropped as too large.

### Reading: signal-net highlight

A deliberate, in-the-rack way to see the network a module belongs to. It is an
**explore mode**, toggled from a panel's right-click menu (**Explore signal
nets**), not an always-on hover. While the mode is on, whatever module you
**hover** lights its net — every cord downstream to the outputs plus everything
upstream that feeds or modulates it, traced both ways (`_computeNet`) — full
opaque, the rest at their normal half-strength; move to another module and the
highlight follows. The **hovered scope drives it, not where you invoked it**. Off
by default so the plain view is never dimmed; exit with Escape or the menu again.
The lit net's cords also show **flow direction**: black dashes crawl each cord
source->destination at a slow constant drift (one clock, so it survives redraws),
with dash LENGTH encoding the destination family — audio shortest, CV medium,
trigger longest — a shape cue on top of colour. The toolbar's network button
toggles the same mode.

A **sectioned** module (a quad — `sectioned: true` in its descriptor) scopes to
the **channel** under the click, not the whole module: its four channels are
usually unrelated nets, so the trace runs over per-channel nodes (`_sectionKey`)
and one channel's net never bleeds into its neighbours, even where two channels
reconverge downstream (e.g. at a shared mixer). Emphasis is opacity only — no
dimming of modules, no width change. Later: a toolbar toggle, and a right-button
pie menu for one-gesture access.

---

## 4. Module abstraction (pluggability)

A module is up to **three separable artifacts**:

1. **Descriptor (data, required):** the single source of truth. Declares
   identity, sections, parameters, and ports (with domains). The host reads
   ONLY the descriptor to build panels, the connection list, drag-to-patch,
   dictation names, save/load, and GXW routing. The host is never coupled to
   specific modules — it just reads descriptors, which is what makes
   third-party modules work like built-ins.
2. **Factory (code, required for sound):** `create(ctx, services)` builds the
   actual Web Audio nodes when a voice needs sound, and returns a small
   **realized-instance** contract: `getOutput(portId)`, `getInput(portId)`,
   `getParam(paramId)`, optional trigger method, `dispose()`. The host wires
   by walking netlist edges and asking instances for nodes/params. It never
   reaches inside.
3. **Panel (SVG, optional):** a hand-authored SVG that faithfully depicts the
   real module's faceplate, tagged so its controls/ports bind to the
   descriptor — see §5. Absent one, the host auto-lays out a generic (non-
   faithful but functional) panel from the descriptor so the module still works.

### "Module" = a complete Buchla module

Throughout Wcoast, **"module" ALWAYS means a complete Buchla module** (the 259t
Complex Oscillator, the 292 Low Pass Gate, the 281 Function Generator, …) —
never a subpart of one. The 259t's Timbre/Harmonics wavefolder is a *section
of* the 259t, not a module; a separate dedicated wavefolder would be a
different complete module. The unit of pluggability is the physical instrument.

### Packaging & discovery (one folder, one worklet)

Each module is a **self-contained folder** under `modules/<module-id>/` holding
everything that module needs: its `descriptor.js`, its `factory.js`, its
worklet DSP, and its panel SVG. Nothing about a module lives outside its
folder, so a module is added or removed as a unit and third-party modules drop
in exactly the way built-ins do.

A module is realized by **at most one worklet**: the whole Buchla module —
every section, including internally nonlinear parts like the 259t's wavefolder
— is DSP inside that single processor, never split across several. (Native-node
modules such as the LPG may need no worklet at all; the rule is one-module-
one-worklet, never several worklets per module.)

The **registry** (`host/registry.js`) is the mechanism for adding a module:
register a `{ descriptor, create }` pair and the host can enumerate, load, and
instantiate it with no module-specific coupling. Registration is explicit in
code today; folder auto-discovery (scan `modules/`, register each) is a later
convenience that changes nothing about the contract.

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

## 5. Panel system (faithful appearance, uniform behaviour)

Panels are a **custom appearance layer only**, never a behaviour layer. Each
module's panel **faithfully emulates the look of the real hardware** (dense,
distinctive, recognisable); the **host owns all connection interaction**
(drag-to-patch, dictation, connection list). This preserves per-module visual
character AND guarantees every module patches identically — the accessibility
win.

### The SVG is modelled after the real module, NOT generated

A module's panel is a **hand-authored SVG that faithfully depicts the real
faceplate** — its knobs, ports, and labels laid out and named as on the
physical module. It is **not** generated from the descriptor. It need not be
pixel-accurate, but the controls, jacks, and legends must be accurate and
correctly placed, so the panel reads unmistakably as that module.

Authoring workflow: work **from photographs of the real faceplate** — Claude
Code analyses the faceplate photo and constructs the SVG (this is the intended
route). Every interactive element carries a **binding tag** —
`data-wcoast-param="<paramId>"` on a knob/switch, `data-wcoast-port="<portId>"`
on a jack — mapping it to the descriptor entry it drives. The descriptor stays
the single source of truth for WHAT each control/port is (range, domain,
target); the SVG says how the module LOOKS and WHERE each tagged element sits;
the tags are the bridge between them.

### Binding contract (geometry the author and the loader both follow)

The tag identifies a control; this contract says how the host reads its
geometry and animates it as the user operates it. The SVG author and the host
loader follow it exactly, or the panel will not track its values.

**Coordinate system.** The viewBox is in millimetres of real panel: origin
top-left, x to the right, y down. A module's width is its descriptor `hp`
times 5.08 mm; its height is 128.5 mm (Eurorack 3U). Authoring in true
millimetres lets modules tile in a rack by their real widths.

**Controls (knobs and switches).** Each is an SVG group carrying
`data-wcoast-param` = the parameter id. The group holds the static art (skirt,
cap, tick marks) plus exactly one child marked `data-wcoast-role="indicator"` —
the pointer of a knob or the lever of a switch, the part that turns. The host
rotates ONLY that indicator; everything else in the group stays put. The group
also carries `data-wcoast-cx` and `data-wcoast-cy`: the pivot point, in viewBox
units. The author draws the indicator in its ZERO pose, pointing straight up;
the host rotates it about the pivot.

**Value → angle.** The host keeps a normalised position 0..1 for each control
(0 = min, 1 = max). A knob turns LINEARLY in position; the value is derived
from position through the descriptor's `curve` (so an exp knob turns evenly
while its Hz value tapers). Angle is measured clockwise from straight-up.
Position maps linearly to angle between an angle-min and angle-max, defaulting
to −150° and +150° (the familiar ~7-o'clock-to-5-o'clock sweep, which puts a
bipolar control's zero at 12 o'clock). A control may override the sweep with
`data-wcoast-angle-min` / `data-wcoast-angle-max` — needed for the big
Frequency and Pitch knobs whose printed scales span a specific arc.

**Switches.** A stepped param's `steps` come from the descriptor, in order. A
switch shown as a moving lever uses the same indicator + pivot as a knob, with
a default sweep of −20°..+20°; the host places step *i* at its evenly-spaced
angle and snaps the lever there. Where the real panel shows the position with
LAMPS instead of a moving lever (the Range and Waveshape LED rows), the author
instead marks one element per step with `data-wcoast-role="step-indicator"` and
`data-wcoast-step` = that step's value; the host lights the active one and dims
the rest. A switch uses one style or the other, not both.

**Jacks (ports).** Each jack is an element or group carrying
`data-wcoast-port` = the port id, plus `data-wcoast-cx` / `data-wcoast-cy` — the
point where a patch cord anchors (the stub-and-droop origin). Jacks do not
rotate.

**Legends.** Text and scale markings — parameter names, the Hz/note numbers,
"even/odd", "low/high" — are static faceplate art and are NOT tagged. The
descriptor already holds the authoritative names for dictation, menus, and save
files; the SVG legends exist only to look right.

**Operating a control.** The host owns all interaction. When the user drags a
knob, scrolls it, or sets it by dictation, the host updates the control's
normalised position, rotates its indicator to the new angle in real time, and
calls the module's `setParam` with the derived value. Switches snap to the next
step the same way. Because the indicator is its own rotatable element, this
live rotation needs no per-frame redraw of the faceplate.

```svg
<!-- continuous knob: Principal frequency (default sweep) -->
<g data-wcoast-param="prinFreq" data-wcoast-cx="120" data-wcoast-cy="80">
  <circle cx="120" cy="80" r="16" class="knob-skirt"/>
  <line data-wcoast-role="indicator" x1="120" y1="80" x2="120" y2="66"/>
</g>

<!-- jack: Principal sine output -->
<g data-wcoast-port="prinSineOut" data-wcoast-cx="60" data-wcoast-cy="40">
  <circle cx="60" cy="40" r="7" class="jack"/>
</g>

<!-- lamp switch: Range (low / high) -->
<g data-wcoast-param="modRange">
  <circle data-wcoast-role="step-indicator" data-wcoast-step="low"  cx="20" cy="30" r="3"/>
  <circle data-wcoast-role="step-indicator" data-wcoast-step="high" cx="20" cy="40" r="3"/>
</g>
```

### Loading and validation

The host loads the SVG as the module's appearance and wires interaction to the
tagged elements: hit-testing controls, rotating a knob or switch to its value,
drawing connection stubs at each port. Because the bindings are hand-authored
rather than generated, the host **validates** them on load. Identity checks:
every `data-wcoast-*` tag must resolve to a real descriptor id, and every
descriptor param/port must have exactly one tagged element. Geometry checks
(from the binding contract): every control group has an indicator child and a
pivot — or, for a lamp switch, one `step-indicator` per descriptor step; every
jack has an anchor point; and any angle overrides parse as numbers. The host
warns on anything missing so a hand-built SVG cannot silently misbehave. When a
descriptor gains a control, its tagged element is added to the SVG (validation
flags the gap until it is).

Absent a faithful SVG, the host can still auto-lay out a generic, functional
(non-faithful) panel from the descriptor, so a new module is playable before
its artwork exists. Faithful density is encouraged — it helps magnified viewing.

### Faceplate visual language (house style)

Every module shares one visual language so a rack of them reads as one
instrument, and every new faceplate must match it. All numbers below are in
millimetres of real panel (the viewBox unit).

**Panel body.** The active face is the full module width by **113.5912 mm** tall
(one 3U rack row; the mounting rim above and below is cropped away on load).
Width = descriptor `hp` × 5.08 mm. Draw two stacked fill rects with **rounded
corners rx 2.5** — a base fill plus a faint monochrome grain overlay
(fractal-noise turbulence at ~10% alpha) for a matte texture:

| | base fill | grain |
|---|---|---|
| dark | `#262629` | `#2a2a2d` |
| light | `#cfcfcf` | `#d0d0d0` |

**Border.** A rounded rect **0.5 mm inside the face on all four sides** (x/y
`0.5`, width/height = face − 1), **rx 2.2**, `fill:none`, stroke the line-grey
below at **stroke-width 0.5**. This frame — not a separate top or edge line — is
the module's outline.

**Lines.** Section dividers and the frame share one **line-grey**: `#808085`
(dark) / `#7d7d7d` (light) at **stroke-width 0.355**. Fine intra-section
separators (e.g. between mixer fader columns) use the same grey at width `0.25`
and may run a partial height rather than edge-to-edge.

**Ink** (legends, tick marks, knob pointers): `#b8b8bc` (dark) / `#163a69`
(light). Faceplate text is **bold italic** in a condensed face (Arial Narrow,
Helvetica, Arial), sizes ~2.0–2.6; legends are static art, never tagged.

**Module name.** Set vertically up the left margin (rotated −90°), font-size
`3.1`, weight 700, at x = face-left + `3.4`, centred top-to-bottom, fill
**white** (`#ffffff`) in dark / `#163a69` in light, opacity `0.9`. The host draws
this automatically from `descriptor.name` — authors leave the left margin clear.

**Knobs (small, "259t" style).** Skirt ring radius `4.2`, radial blue
(`#1688cc → #006da8 → #003d62`), stroke `#6fa8d6` (dark) / `#004b7a` (light) at
`0.355`. Cap radius `3.3`, radial metal gradient — dark `#3a3d43 → #4c5058 →
#5a5f67 → #6b7079`, light `#f8f8f8 → #bfc3c5 → #f4f4f4 → #777` — stroke `#b8b8bc`
(dark) / `#666` (light) at `0.2366`. Pointer: a line from centre to cap top in
ink at `0.55`, tagged `data-wcoast-role="indicator"`. Seven tick marks over a
±150° sweep in ink at `0.3`.

**Jacks.** Author only the geometry — an outer ring (radius ~`3.0`) around a
concentric hole (radius ~`1.6`). The host paints the rest: the family **colour**
and the dashed **direction ring** from the port's domain and `dir` (see "Terminal
+ cable colour = signal family" above), so jack art carries no colour of its own.

**Lamps / push-button LEDs.** Red LED, radius `1.8`, radial `#ff4a4a → #d00000 →
#650000`, stroke `#7c0000` at `0.2366`, with a small pink highlight dot. Used for
step/toggle indicators (`data-wcoast-role="step-indicator"`); lit = active, the
host dims the inactive state.

**Faders.** Vertical: a rounded track (width `2.4`) in a dark slot colour, with a
wider rounded handle (`8 × 4.4`) carrying a centre line. The handle group is
tagged `data-wcoast-role="handle"` and slides along the track.

**VU meters.** A vertical column of small circular LEDs (radius `0.75` = 1.5 mm
diameter) beside a fader, evenly spaced over its travel and `1` mm off the
handle's left edge. Unlit = a **line-grey ring** (`fill:none`, stroke line-grey
at `0.3`); the host lights them by level. Tagged `data-wcoast-role="vu"` with a
`data-wcoast-seg` index per LED.

### Dark / light theming

Each module ships **two** SVGs: `panel.svg` (light) and `panel.dark.svg` (dark).
The host loads whichever matches the current mode; the two differ **only in
colour, never in geometry**. The colour pairs above are the entire mapping —
face, grain, line-grey, ink, knob cap/ring strokes, module-name fill — so one
theme converts to the other by a mechanical colour swap.

Keep the pair in sync with a **conversion/generator script**, not by editing two
files by hand. The mixer is the one panel we generate end to end —
`modules/mixer/gen-panel.js` — because it has no vintage faceplate to trace for
the controls we added; a single `build(dark)` takes a per-theme colour table and
writes both files, so dark↔light is just the two theme objects. For a
hand-authored module, author one theme, then run the same colour-pair swap to
produce the other, and re-run it whenever the palette changes. Either way the two
files stay identical except for the documented colour pairs.

---

## 5A. Rack — spatial model, placement, interaction

The rack is the instrument's front end: a case that holds module faceplates and
lets the author place, move, and remove them. It is the reason the panels are
authored in true millimetres — modules tile at their real physical width.

- **Rows.** The rack is a vertical stack of rows (count is a setting, default
  two). Each row is open-ended to the right and scrolls horizontally; you place
  freely in any visible row rather than waiting for a wrap.
- **Scale.** Each module's height is the window height divided by the row count,
  **capped at 300 px** so modules never grow ridiculously tall; width follows
  from the panel's real proportions. The rack is responsive — resizing the
  window rescales everything (still capped). Row count + window size set the
  scale; there is no separate zoom.
- **HP grid.** Modules sit on the Eurorack width grid (1 HP = 5.08 mm). A module
  occupies `descriptor.hp` whole units (the 259t is 34). Positions snap to HP,
  so sliding one module against another leaves them cleanly adjacent.
- **Face crop.** Panels are authored at the full 128.5 mm height, but only the
  functional FACE between the top and bottom frame rails is shown — the mounting
  rim (screw ears, title strip) is cropped by the loader (`FACE_TOP_MM` /
  `FACE_H_MM`) so no vertical space is wasted. A shared convention for all
  modules, so they stay the same height and the HP grid aligns.
- **Place.** Right-click an empty spot → a menu of module types → an instance
  drops there. If it doesn't fit because a module sits to its right, the ones to
  the right are **pushed right** to make room (cascading). Multiple instances of
  the same module are allowed.
- **Move.** Left-drag a module by its faceplate background — within a row or
  between rows — snapping to HP as you go, with a **ghost outline** showing the
  footprint it will occupy on drop. Dropping onto occupied space pushes the
  neighbours right (same as insert).
- **Delete.** Right-click a module's faceplate background → Delete.
- **Controls stay on the faceplate.** The knobs and switches keep their own
  behaviour (scroll a knob, click a switch), so grabbing the *background* is
  what moves a module; controls stop the drag from starting.
- **Transport lives in a floating window** (toggle to show/hide): audio on/off,
  master level, an output monitor (choose which module you hear), the row-count
  setting, and the log. No per-parameter sliders — every parameter is a control
  on the faceplate now.
- **No cables yet.** This is placement and appearance only; patching (the
  connection interface, §3) and multi-module audio come after.
- Layout persistence across sessions is deferred.

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
1. **Complex oscillator (259t)** — principal + modulation osc, FM, AND the
   Timbre/Harmonics wavefolder, all in ONE worklet (§4 one-module-one-worklet).
   The most character lives here; build first. Descriptor DONE; oscillators +
   FM DONE; the wavefolder + phase lock + pitch/CV-input DSP are what remains
   to finish the module.
2. *(No standalone wavefolder module.)* The 259t's Timbre/Harmonics folder is a
   **subpart of the 259t**, not a module of its own (§4). A dedicated wavefolder
   would only ever be a separate complete module if one is added later.
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

> The message protocol, the receiving module, and the sending-side mapping are
> specified in `design/control-protocol.md`. This section holds the bridge-level
> reasoning (control-rate, glide, scheduling); the protocol doc holds the wire
> format (handles, mandatory duration, note-off, loss tolerance).

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
- **Strudel is a co-client** (revised — see `design/control-protocol.md`). GXW,
  Strudel, and a thin MIDI translator all speak the SAME message protocol into
  the same front door, so no single client constrains the design. Strudel already
  emits the SuperDirt play format; a superdough-shaped adapter maps its control
  names onto the protocol’s fields, and Wcoast is the target it would otherwise
  point at SuperCollider.

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
   first concrete module conforming to it. **DONE** — `host/registry.js`,
   `host/host.js`, `modules/complex-oscillator-259t/factory.js`, and the
   descriptor-generated bench (`debug/debug-surface.js`, `index.html`).
4. Real band-limited oscillator DSP (PolyBLEP + phase-increment FM).
   **DONE — the whole 259t (but ART)**, all in
   `modules/complex-oscillator-259t/complex-osc-processor.js`: both oscillators,
   through-zero FM, internal pitch/ampl mod, the Timbre/Harmonics wavefolder
   (oversampled + windowed-sinc decimator), phase lock, and the 1V/oct pitch +
   CV inputs. Harness-verified (folder adds harmonics & stays bounded; +1V =
   one octave; hard sync resets the mod phase).
5. Temporary debug control surface (NOT the rack) to play/hear the module.
   **BUILT**; oscillators confirmed audible, folder etc. pending a live listen.
Then thicken: the faithful panel SVG (§5), connection UI, LPG, function
generator, rack, polyphony, GXW bridge.

---

## 12. Current status

- **Spike + module host in place, committed.** Electron shell; custom `app://`
  scheme over a secure isolated origin with COOP/COEP; worklet toolchain
  proven; crossOriginIsolated true; zero-allocation + destination-glide
  patterns established.
- **Complex Oscillator 259t is COMPLETE (every feature but ART).** The
  descriptor (data, ART dropped) defines the module schema; the host reads it
  generically (`host/registry.js`, `host/host.js`); the factory
  (`modules/complex-oscillator-259t/factory.js`) builds the DSP and returns the
  realized-instance contract; the one processor
  (`modules/complex-oscillator-259t/complex-osc-processor.js`) runs both
  oscillators (through-zero FM, internal pitch/ampl mod), the oversampled
  Timbre/Harmonics wavefolder, phase lock, and the 1V/oct pitch + CV inputs;
  the bench (`debug/debug-surface.js`, `index.html`) plays it. Every knob is
  live; the external-input knobs wait only on a way to patch a cord.
- **Not yet built:** the 259t's faithful panel SVG; the connection UI (so the
  external FM/CV/phase-lock inputs can actually be patched); further modules
  (LPG, function generator, …); rack; polyphony; GXW bridge.

### Open / to-verify
- **Listen to the finished 259t:** oscillators confirmed audible; the whole
  module (wavefolder, phase lock, pitch/CV) is harness-verified (folder adds
  harmonics & stays bounded; +1V = one octave; hard sync resets phase) but the
  folder etc. not yet heard by ear. `npm start`, monitor Final, turn up Timbre.
- **Folder fidelity:** the fold is a triangle multi-fold (bright, 259-ish),
  Order = sine→saw fold-input morph, Symmetry = DC offset; "reasonably
  realistic," tunable against a panel/recording, not sample-exact.
- 259t fine points to check against a clear panel photo: whether Timbre CV has
  its own attenuator; exact Order/Symmetry end-labels; any second direct FM
  jack. (Marked TODO:verify in the descriptor. None block design.)
- Rack coordinate/layout model: still to detail.
- Random-source scope default (shared vs per-voice): to choose.
- Exact stub/cable pixel values: empirical, tune on-screen at magnification.
- Anti-aliasing for audio-rate modules. Every module that can reach audio rate
  must band-limit its discontinuities. Done: the 259t band-limits its oscillators
  (PolyBLEP) and its wavefolder (oversampled + windowed-sinc decimation); the
  281t function generator BLAMP-corrects the two corners of its envelope (a
  ~2 dB win — the exponential RC shape is already ~−47 dB, so it barely aliases).
  To verify on the 259t: its phase lock (hard sync) resets phase abruptly and can
  alias — confirm it's band-limited at the sync point (BLEP), not just the free
  waveforms.

---

## Project conventions

- Electron shell mirrors GXW's posture: context isolation on, node integration
  off, sandboxed renderer, non-fatal crash-log net.
- Renderer served over `app://` (NOT `file://`) so AudioWorklet.addModule and
  crossOriginIsolated work and isolation headers can be attached.
- Node: Homebrew at `/opt/homebrew/bin`. `npm install` then `npm start`.
- Chat/prose style for the author: plain paragraphs, no bold/headers/bullets
  in conversation; code in fenced blocks; interpret dictation charitably.
