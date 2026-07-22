# Panel editor — a visual designer for module faceplates

A tool for building a module's faceplate visually: drop controls onto a real
panel, say what each one is, adjust it with proper widgets, and see it render
live. The module's **interface — its ports and params — is authored by drawing it**,
and the descriptor is generated from the design. The only thing left to write in
code is the module's behaviour: the factory and its DSP.

It builds on the faceplate system (`design/faceplate-system.md`) — the same control
primitives, theme tokens, and binding contract. The editor changes how a module's
layout *and interface* are authored, not how a panel is rendered.

## Principle — the editor is our renderer, and the interface is drawn

The editor draws every control with the same primitives that render the shipped
panels, so **what you place is what ships**: a five-position radio appears as a
five-position radio, a knob shows its real calibration scale, and light/dark and
the binding are automatic. Because the tool *is* the thing that draws the controls,
the hard cases (parametric variants, a bespoke knob scale) are easy — there is no
external editor and no gap between editing and rendering.

And because each control is placed *and specified* in one act, the module's
interface falls out of the drawing. You never hand-write the port-and-param table;
you draw the panel, and the descriptor is generated from it.

## Data model

Per module:

- `descriptor.js` — **generated**: the module's interface (ports and params, their
  ranges, curves, domains, directions, step values), emitted by the editor from the
  visual design. The factory *reads* these ids; it doesn't declare them.
- `panel.layout.json` — the **layout**: the ordered list of placed controls and
  structural elements with their positions and presentation params. The editor's
  other output.
- `panel.svg` / `panel.dark.svg` — **rendered output**, what the app loads,
  regenerated from the layout by the renderer.
- `factory.js` (+ a DSP worklet) — **hand-written**, the only code. Implements the
  module's behaviour against the ids the editor generated.

The source of truth flips: **the editor owns the interface** (the descriptor is
generated, like the panels), and **code owns the behaviour** (the factory and DSP).
There is no SVG round-trip; the renderer is one-way, layout → panels.

## Drawing defines the interface

Placing a control defines it. You drag a control *type* from a toolbox, drop it on
the panel, and in the inspector you specify its identity and data — for a jack, its
direction and domain (from just "output" up to "audio output," to whatever level
the module needs); for a knob, its range, its control taper, and default; for a
radio, its positions and their values. The editor writes that into two outputs at
once — the layout entry (where it sits, how it looks) and the descriptor entry (the
port or param it *is*). There is no separate binding step: the control doesn't bind
to a pre-existing param, it **creates** one.

So the properties inspector has two faces: **presentation** (size, orientation,
label placement) feeds the layout; **data** (id, name, direction, domain, range,
taper, steps, glide) feeds the descriptor.

**Two tapers, and only one is drawn here.** The control taper — how a knob's
rotation maps to the value it emits (linear, exponential, dB) — is a feel choice,
set in the inspector and written to the descriptor. What that value *means*
physically (value-to-hertz, value-to-cutoff) stays in the DSP code and is never
part of the drawing.

## Two things the editor must get right, because code depends on them

- **Port order.** A worklet's input and output indices come from the descriptor's
  port order, so the editor must produce a stable, author-controllable ordering
  that the DSP is written against.
- **Id stability.** An id is the contract the factory references and the key a saved
  patch stores. A rename breaks the factory and orphans patches, so the editor
  treats an id as deliberate — warned on change, not silently following a label.

## The layout item model

A flat, ordered list of typed items (the model of `faceplate-system.md §2`). A
control item is `{ type, x, y, bind, ...params }`. Types: `knob`, `jack`, `radio`,
`button`, `slider`, `vu` (controls, carry a `bind`); `label` (free text); `line`/
`divider`, `frame` (structure, no binding). Coordinates are millimetres, the same
viewBox convention as the rendered panel (`faceplate-system.md §6`). This is exactly
the table `gen-panel.js` hand-authors today, lifted out of code into data.

## The editor

A designer mode inside DreamRack, rendering the panel-in-progress live from the
layout. Its parts:

- **Canvas** — the panel at real size, pan and zoom, every control drawn by the
  primitives exactly as it will ship.
- **Toolbox** — the palette of control *types* to draw from (knob, jack, radio,
  button, slider, vu) plus the structural pieces (label, divider, frame).
- **Selection and drag** — click to select, drag to position; the layout updates and
  the panel re-renders live.
- **Properties inspector** — the selected control's **presentation** and **data** as
  constrained widgets. Editing presentation re-renders live; editing data updates the
  generated descriptor. Bespoke knob calibration is a scale preset here.
- **Structure tools** — section labels, dividers, the frame.
- **Save** — write `panel.layout.json`, regenerate `panel.svg` + `panel.dark.svg`, and
  emit the generated `descriptor.js`.

## What we reuse

Largely assembly, not greenfield: the app already has a canvas with pan and zoom,
drag handling, undo, dark mode, the control primitives, and the table-to-SVG
renderer. The new parts are selection, the properties inspector (with its data face),
the descriptor generation, and the save path.

## Embellishments and skins

The editor owns the module's **controls** — the bound, interactive, themed elements.
Everything else a developer might want on the panel — custom art, a logo, a
distinctive border — is an **embellishment layer** they author freely and we retain.
This keeps the editor's scope bounded (it never has to support drawing arbitrary
graphics) while giving developers real artistic freedom, including carrying a brand.

**Two-SVG embellishments.** A developer draws their embellishments in any tool (e.g.
Inkscape) in whatever colours they like, and supplies a light and a dark version —
`embellishment.light.svg` and `embellishment.dark.svg` in the module folder. The
renderer drops each into the matching panel: their light art into the light panel,
their dark art into the dark. No palette to obey and no colour transformer to build
— the author authors both (which for a brand is control they'd want anyway), and
theme-neutral art can simply be the same file twice. Embellishments render **behind**
the controls, so whatever is drawn, a control can never be obscured. Constraint: they
stay in that layer and must not impersonate DreamRack's own chrome or identity.

**Skins (future).** A skin is just a light-and-dark panel pair. There is always the
default generated skin; a module may additionally ship alternate skin pairs — a
different faceplate look, or the same layout recoloured — and the user picks one per
module by right-clicking the module's title bar (the faceplate right-click is already
the main menu). This is a distinct, later feature — it needs a selection UI and
per-module storage in the patch — so it is noted here as a direction, not folded into
the near-term phases.

## Build phases

Ordered to prove the foundation first, hand back a usable payoff early, then reach a
complete draw-first authoring path.

1. **Layout as data, and a faithful renderer.** Split `gen-panel.js` into a shared
   renderer that turns a layout item-list into the light/dark SVGs, and each module's
   layout expressed as data. Migrate the modules. *Checkpoint:* every module's
   regenerated panels are byte-identical to the committed ones — the Mixer first
   (simplest), the Complex Oscillator last (its musical knob scale is the hard case).
   Pure refactor and data; the safety net everything stands on.
2. **Live panel view.** A designer mode that loads a module's layout and renders it
   live on a canvas, pan/zoom, dark-mode toggle. Read-only. *Checkpoint:* the live
   view matches the shipped panel exactly.
3. **Select and move.** Select a control, drag it, layout updates and re-renders live,
   save writes the layout and regenerates the SVGs. *Checkpoint:* nudge a knob on the
   Complex Oscillator and save — replacing the code-edit-and-regenerate cycles. **A
   natural stop point:** already a far faster way to tune every panel we ship.
4. **Properties inspector — presentation and data.** Edit the selected control's
   presentation (size, orientation, label placement, knob scale) live, *and* its data
   (id, name, range, taper, steps, direction, domain). Editing data updates an
   in-memory interface model. *Checkpoint:* change a radio to vertical and set its
   step values, all in the inspector.
5. **Toolbox and descriptor generation.** Drag a control type from the toolbox, drop
   it, specify its data, and have the editor create the port/param and generate
   `descriptor.js` on save — with a stable, author-controllable port order and
   id-rename warnings. *Checkpoint:* author a small module's whole interface by
   drawing it, and the generated descriptor validates.
6. **Structure and the closed loop.** Section labels, dividers, frame; the full save
   emitting layout + descriptor + panels. *Checkpoint:* a brand-new module — panel and
   descriptor authored visually, only its factory written in code — loads and plays in
   the rack. **The second stop point:** the draw-first authoring path is complete.
7. **Polish.** Alignment guides and snapping, multi-select, copy/paste, keyboard
   nudging, undo/redo woven into the app's existing undo.
8. **Later.** Author a starter factory stub from the interface; templates; and the
   decision of whether to ship the designer to end users for in-browser module
   building.

Two natural decision points: after phase 3 (pleasant enough to keep going?) and after
phase 6 (the loop is complete — polish now, or use it and defer 7–8?).

## Migration

The four shipping modules author their layout in `gen-panel.js` and their interface
in hand-written `descriptor.js`. Adopt the editor by lifting each module's table into
`panel.layout.json` (phase 1), confirming the renderer reproduces the committed panels
byte-identically. The existing descriptors become the check for descriptor generation:
what the editor emits from a drawn module must match the descriptor already in the
repo. The renderer half of `gen-panel.js` stays; the hand-authored tables are retired.

## Open decisions

- **Layout storage** — `panel.layout.json` (pure data) vs a JS module; how positions
  and per-control params serialise.
- **Descriptor generation scope** — whether the editor emits the whole `descriptor.js`
  or a section a small amount of code completes (e.g. the `worklets` path).
- **Port ordering UI** — how the author controls the port order the worklet depends on.
- **Editor invocation** — the designer mode's home, and whether it ships to end users.
- **Knob-scale presets** — the set of built-in calibration scales and how a new one is
  added.

## Relationship to other docs

- `design/faceplate-system.md` — the rendering system this builds on (primitives, theme
  tokens, the binding contract, the layout item model). Unchanged.
- `MODULE-AUTHORING.md` — the developer reference; once the editor exists, the panel
  and descriptor are authored here and it describes only the code an author still
  writes (the factory and DSP).
