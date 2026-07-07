# Faceplate system — canonical controls, generated panels

How every module's panel is built: a shared library of control-drawing functions,
plus a per-module data table of placed items. Panels are **generated**, never
hand-drawn, so one canonical look is enforced in one place and the light/dark
twins can never drift apart.

This supersedes the earlier stance in DESIGN.md §5 that panels are hand-authored
SVG faithfully copied from real hardware. What **still holds** from §5: the
binding contract (below) and the house visual language. What **changes**: panels
are generated from the library, and faithful copying of a specific real module is
no longer a goal.

## 1. Principles

- **Composed from a canonical library.** A faceplate is assembled from our own
  control primitives — jack, knob, radio group, button, LED, slider, VU. It is
  not a drawing of a particular hardware panel.
- **Real hardware is optional inspiration, not a contract.** A module may be
  wholly original, adapted from a real module, or somewhere between. When we work
  from a real module we read its photo, identify what each control *does*, and
  choose the library control that serves that function — mapping by function, not
  appearance — then size, place, and label it in our house style, modifying freely.
- **One house look, enforced in one place.** Style — gradients, stroke widths,
  tick shape, cap proportion, colors — lives inside the primitive and the theme
  table. Changing how a knob looks is a one-file change that updates every module.
- **The descriptor stays the source of truth for data.** It owns which params and
  ports exist, their ranges, curves, domains, and defaults. The panel says how the
  module looks and where each control sits. Binding tags are the bridge.
- **Generated, not hand-drawn.** The library emits the SVG; a human authors the
  data table and tunes the primitives, not raw SVG.

## 2. The item model

Everything on a faceplate is a **typed item** in one flat list. A control is the
richest kind of item; a label is a simpler item; a divider is simpler still. The
generator walks the list and dispatches to a draw function per type. Controls,
labels, and lines all live in the same list and flow through the same table.

An item is `{ type, x, y, ...params }`. Positions are in millimetres of real
panel (the viewBox unit; see §6). The item catalog:

- **Controls** — `jack`, `knob`, `radio`, `button`, `led`, `slider`, `vu`. Carry
  a binding id (`param` or `port`) and emit the binding attributes (§6).
- **Labels** — `label` (free-floating / group text). Attached labels are a
  property of a control item, not separate items (§4).
- **Structure** — `line`, `hrule`, `vrule`, `frame`, `sectionDivider`.

## 3. Control primitives

Each control type is a function taking a structured params object. **Style is
fixed inside the function and shared; size, count, orientation, and position are
params.** So a bigger knob or a horizontal radio group is a parameter, never a
fork of the code. Designed open from the start, e.g.:

- `knob` — `{ radius, angleMin, angleMax, ticks, scale? }`. `scale` is an optional
  set of range numbers the function positions at its corners (the .001/.03/.3/10
  markings are a knob-with-scale, not a separate control).
- `radio` — `{ count, orientation: 'h'|'v', spacing, options: [{ label|glyph }] }`.
  Covers the mode/range lamp rows and the waveshape selector.
- `jack` — `{ kind? }`. Neutral by default (the loader repaints by port domain at
  runtime); an explicit color/kind is available for panels that bake it.
- `led`, `button`, `slider`, `vu` — sized and placed by params, styled centrally.
  `button` (like `jack` and `knob`) takes an optional attached `label`, routed
  through the shared label helper so the text always clears the lamp (§4).

Every control primitive emits the binding attributes so the host can wire and
animate it (§6). The primitive draws the indicator in its zero pose; the host
rotates it live.

## 4. Labels

Two kinds, one text style underneath.

- **Attached labels** are a property of a control item; the control's own draw
  function places them relative to its anchor. Params: `placement`
  (below/above/left/right), `gap` (distance), `size`, `rotation`, with sensible
  per-type defaults so a plain control needs no label geometry. A control may have
  several (a name below plus scale numbers around it).
- **Free-floating / group labels** are their own `label` item, placed
  independently: `{ text, x, y, size, anchor, rotation, color }`. Section headers
  (LEVEL, QUADRATURE, SUM) are these.

Both call the same canonical text helper, so a label always looks like a label.
Legends and scale markings are static art — not tagged for binding (§6).

## 5. Structure — dividers, rules, frame

Item types drawn from the same table: a `line` by endpoints, an `hrule`/`vrule`
by a span, the `frame` border, a `sectionDivider` between regions. All use themed
stroke tokens (never raw hex). The channel-vs-section dividers and row separators
become ordinary rows in the table.

## 6. Binding contract (preserved from DESIGN.md §5)

Generated SVG must carry the same tags a hand-authored one did, or the host will
not track it. The primitives emit them; nothing else changes.

- **Coordinates** — viewBox in millimetres; width = descriptor `hp` × 5.08 mm (or
  set directly); active height 113.5912 mm within a 128.5 mm 3U row.
- **Crop / frame inset.** The loader shows only the functional face: it resets the
  viewBox origin to `(FACE_LEFT 3.9, FACE_TOP 7.0994)` mm, cropping the mounting
  rim. A panel's frame border and content must sit **inside** that region —
  either inset the border (as the 259t does) or wrap the whole body in one
  `translate(3.9, 7.0994)` so a `(0,0)`-based layout lands in the visible face
  (as the low-pass-gate v2 does). Otherwise the top and left border are cropped.
- **Controls** — an SVG group with `data-wcoast-param` = param id, plus
  `data-wcoast-cx`/`cy` (pivot) and exactly one child `data-wcoast-role="indicator"`
  (the pointer/lever, drawn straight-up at zero). Optional
  `data-wcoast-angle-min`/`max` override the −150°..+150° sweep.
- **Lamp switches** — one element per step marked `data-wcoast-role="step-indicator"`
  with `data-wcoast-step` = that step's value; the host lights the active one.
- **Jacks** — `data-wcoast-port` = port id, plus `data-wcoast-cx`/`cy` (the cord
  anchor).
- **Legends** — static, untagged.

The host still validates on load: every tag resolves to a real descriptor id,
every param/port has exactly one tagged element, every control has an
indicator + pivot (or step-indicators), every jack has an anchor.

## 7. Theme tokens

Colors are named tokens, not hex, resolved from a two-entry theme table (light,
dark): `face`, `grain`, `ink`, `frame`, knob gradient stops, `ringStroke`,
`capStroke`, jack/led/accent colors. A `build(dark)` pass walks the item list and
paints it from the selected table, emitting both `panel.svg` and `panel.dark.svg`
in one run. Neither file is authored; they are siblings from the same geometry.

## 8. The module layout table

The human-authored part: a list of items. Two conveniences keep it usable:

- **Channel repeat.** For quad/multi-channel modules, author one channel's items
  once and stamp them at N row offsets, so a row is never copied by hand.
- **Flow layout.** Instead of hand-placing x for every control, a row declares
  each control's **visual extent** (its half-widths left and right of its anchor,
  including attached labels and scale rings) and one inter-control gap is solved so
  neighbours have **equal optical air, edge-to-edge — not equal centre pitch** —
  regardless of control size. Realised inline in a module's `gen-panel.js` (the
  quad low-pass-gate v2 uses it); not yet extracted to `panel/layout.js`.

## 9. Control gallery (test bench)

A display-only module, `modules/gallery`, lays out every control type — across its
parameter variations and both themes — and is loaded in the running app so each
primitive is reviewed through the *real* panel loader (family repaint, direction
rings, live rotation, dark-mode toggle, magnification). It's where the canonical
look is tuned, and it doubles as the visual regression surface when a primitive
changes later. Its panel is generated by the shared library like any module.

## 10. Authoring a new module

1. Decide the controls by **function** (from a real module's photo, an
   adaptation, or an original design), and choose library controls to serve them.
2. Add the params/ports to the **descriptor** (the data source of truth).
3. Write the module's **layout table** — controls with binding ids, labels,
   dividers — using channel-repeat and/or flow layout.
4. Generate; review the render; iterate on the table (and, rarely, the primitive).

## 11. File layout

- `panel/primitives.js` — the control + structure draw functions.
- `panel/theme.js` — the light/dark token tables.
- `panel/layout.js` — item dispatch, channel-repeat, flow layout, the frame *(planned)*.
- `modules/gallery/` — the in-app Control Gallery (the test bench, §9): descriptor +
  stub factory + a `gen-panel.js` that lays out every primitive.
- `modules/<m>/gen-panel.js` — thin: requires the library, provides the module's
  item table, emits `panel.svg` + `panel.dark.svg`.

## 12. Migration — incremental, no accidental drift

The generated SVGs are the contract and git tracks them, so each step is checked
by regenerating and diffing.

- **Move steps** (relocating code) must produce a **byte-identical** diff.
- **Reconcile steps** (unifying a drifted primitive) produce a diff we review on
  the render; the diff must be **localized to that primitive's elements** —
  everything else byte-identical — proving no collateral change.
- A **look** change and a **position** change are never in the same step.

Order:

1. Commit a clean baseline; render every panel (light + dark) as reference.
2. Extract the function generator's primitives verbatim into `panel/*`; the 281t
   regenerates byte-identical. (The canonical donor.)
3. Extract the mixer's inline primitives into `panel/*` (the jack color model,
   knob, slider); the mixer keeps drawing from its own copies for now.
4. Rebuild each hand-tuned panel as a new `*-v2` module beside the original —
   `complex-oscillator-259t-v2`, `lpg-292-v2`, `mixer-v2`, and
   `function-gen-281t-v2` — reusing the original descriptor, factory, and worklet
   (only the panel is new), now drawn entirely from the shared library. (The 281t
   and mixer donated their primitives to the library but kept drawing from their
   own inline copies until their v2.) Each is validated by render comparison and
   human judgment; the original stays registered for side-by-side comparison, and
   each v2 is committed once approved.
