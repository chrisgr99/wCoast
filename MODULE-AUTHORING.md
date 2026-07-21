# Authoring a DreamRack module

This is the developer reference for building a **plug-in module** — a new panel
that a user can add to the rack. A module is a self-contained folder of plain
JavaScript plus a generated SVG faceplate. It drops in without touching the host:
you declare *what the module is* (a data descriptor), *how it sounds* (an audio
factory, optionally with a DSP worklet), and *how it looks* (a generated panel),
then register it in one place.

No build step and no separate IDE — author with a text editor and run the panel
generator with `node`.

Contents:
1. [The mental model](#1-the-mental-model)
2. [A module folder](#2-a-module-folder)
3. [The descriptor — the data source of truth](#3-the-descriptor--the-data-source-of-truth)
4. [The factory — the audio graph](#4-the-factory--the-audio-graph)
5. [The DSP worklet — where your algorithm lives](#5-the-dsp-worklet--where-your-algorithm-lives)
6. [The panel — a generated faceplate](#6-the-panel--a-generated-faceplate)
7. [Registering the module](#7-registering-the-module)
8. [Signal domains and colours](#8-signal-domains-and-colours)
9. [Save / load and stable ids](#9-save--load-and-stable-ids)
10. [Step-by-step checklist](#10-step-by-step-checklist)
11. [Quick reference](#11-quick-reference)

---

## 1. The mental model

Three concerns, cleanly separated:

- **Descriptor (data).** Owns which **params** (knobs, switches) and **ports**
  (jacks) exist, their ranges, curves, signal domains, and defaults. It is pure
  data — no browser, no audio. It is the single source of truth; the factory and
  the panel both defer to it.
- **Factory (audio).** Builds the live Web Audio graph for one instance and hands
  the host a small contract to wire and control it.
- **Panel (looks).** A generated SVG faceplate. Controls carry *binding tags* that
  tie each drawn knob/jack back to a descriptor id, so the host can rotate a knob,
  light a lamp, and anchor a cable without the panel knowing anything about audio.

The host reads the descriptor at run time: it loads any DSP the module declares,
calls the factory, loads the panel SVG, and binds the tagged controls to params
and ports by id. Add a module by adding its folder and registering it — the host
code is untouched.

---

## 2. A module folder

Everything for one module lives under `modules/<your-module>/`:

```
modules/my-module/
  descriptor.js          # data: id, ports, params           (required)
  factory.js             # create(ctx, services) -> instance  (required)
  gen-panel.js           # generates the faceplate SVGs       (required)
  panel.svg              # generated light faceplate           (committed)
  panel.dark.svg         # generated dark faceplate            (committed)
  my-module-processor.js # AudioWorkletProcessor (your DSP)     (usual; omit for native-node modules)
```

Look at `modules/lpg-292/` for a full worklet-based module (audio + CV + triggers
+ an internal clock) and `modules/mixer/` for one built from native Web Audio
nodes with no worklet. `modules/gallery/` shows every control primitive.

---

## 3. The descriptor — the data source of truth

`descriptor.js` exports a default object. Minimal shape:

```js
'use strict';

export default {
  id: 'my-module',            // unique, STABLE forever (saved patches key off it)
  apiVersion: 1,
  name: 'My Module',          // shown on the panel and the Add-module menu
  abbreviation: 'MyMod',      // short form for menus / the scope roster
  worklets: ['modules/my-module/my-module-processor.js'],   // [] if native-only
  ports: [ /* jacks */ ],
  params: [ /* knobs, switches */ ],
};
```

Optional top-level fields:

- `sectioned: true` — the module has several independent channels; the hover
  "what affects what" highlight then scopes to one channel instead of the whole
  module. Pair with `channels: ['A','B',...]`.
- `signalIdentity: ['audio']` — override the coloured identity band down the title
  column (an ordered list of domain keys, primary first). Omit it and the band is
  derived automatically from the module's **output** ports.
- `hp` — a nominal width in Eurorack HP, for reference. The panel's *actual* width
  is set in `gen-panel.js` (see §6); the rack sizes the module from the SVG.

### Ports (jacks)

```js
{ id: 'inA', name: 'A', section: 'channel', domain: 'audio', dir: 'in' }
```

| field    | meaning |
|----------|---------|
| `id`     | unique within the module; STABLE (patches store wiring by id) |
| `name`   | short label drawn by the jack |
| `section`| grouping key (e.g. `'channel'`, `'sum'`, `'clock'`) — used for layout and channel-scoped highlight |
| `domain` | `'audio'` · `'control'` (CV) · `'trigger'` (gate/pulse). Sets the jack colour and the cable colour at this destination |
| `dir`    | `'in'` or `'out'` |
| `target` | *(inputs only, optional)* the **param id** this CV input modulates (an attenuated CV-into-a-knob input). Inputs WITHOUT a `target` are raw signal inputs to your worklet |

A **pitch** (1V/oct) input is `domain: 'control'` with either `role: 'pitch'` or
`name: '1V/Oct'` — it renders green.

**Order matters for worklets.** The order of `dir: 'in'` ports fixes your
worklet's audio-input indices, and the order of `dir: 'out'` ports fixes its
output indices. The factory asserts this agreement (see §4), so a reorder can't
silently mis-wire.

### Params (knobs, switches, buttons)

```js
{ id: 'levelA', name: 'Level A', section: 'channel',
  curve: 'linear', min: 0, max: 1, default: 0.8, glideMs: 15 }
```

| field     | meaning |
|-----------|---------|
| `id`      | unique within the module; STABLE (patches store settings by id) |
| `name`    | label |
| `section` | grouping key (as for ports) |
| `curve`   | `'linear'` · `'gainDb'` (audio-taper gain) · `'stepped'` (discrete) · `'detent'` (knob clicks to integer marks) |
| `min`/`max`/`default` | value range and initial value |
| `glideMs` | smoothing time applied to changes (0 = instant) |
| `steps`   | *(stepped only)* the discrete values, e.g. `[{ value: 'off' }, { value: 'on' }]` |
| `momentary` | *(optional)* a press-and-release button that fires only on press (e.g. a manual STRIKE) |

A two-state toggle is a `stepped` param with `off`/`on` steps; a mutually-exclusive
lamp row is a `stepped` param with one step per option.

---

## 4. The factory — the audio graph

`factory.js` exports `create(ctx, services)`. `ctx` is the shared `AudioContext`;
`services` is `{ descriptor, registry, sampleRate }`. It builds the graph for one
instance and returns this contract:

```js
export function create(ctx, services) {
  // ...build nodes...
  return {
    node,                       // your main node (optional; used for tracing)
    getOutput(portId) { ... },  // -> { node, index } | null  (an output jack)
    getInput(portId)  { ... },  // -> { node, index } | null  (a signal input jack)
    getParam(paramId) { ... },  // -> AudioParam | null        (for CV targets)
    setParam(paramId, value, atTime) { ... },  // apply a knob/switch change
    supports(paramId) { ... },  // -> boolean
    dispose() { ... },          // disconnect / tear down
  };
}
```

- `getOutput` / `getInput` map a **port id** to a concrete `{ node, index }` so the
  host can `connect()` cables to the right node input/output. Return `null` for a
  port your graph doesn't expose as a node pin (e.g. a `target` CV input you
  instead route to an AudioParam).
- `getParam` exposes an `AudioParam` so a CV input's `target` can drive it.
- `setParam(id, value, atTime?)` applies a control change. Numeric knobs glide to
  the value (honour `glideMs`); switches and momentary buttons usually post a
  message to the worklet instead of touching an AudioParam.
- `dispose` disconnects everything so a deleted module frees its nodes.

**Two ways to build the graph:**

- **A worklet** — for most modules with real character (a novel oscillator, a
  physical model, a distinctive filter, a granular engine), create one
  `AudioWorkletNode` running your own DSP (§5). This is the usual path.
- **Native nodes** — for a module that only routes, mixes, filters, or gains
  signals, wire up the browser's built-in nodes directly (`ctx.createGain()`,
  `ctx.createStereoPanner()`, …) with no worklet at all — the Mixer / Output is
  exactly this (see `modules/mixer/factory.js`). Declare `worklets: []`.

**Assert the port order** against what your worklet assumes, so the descriptor
stays the source of truth:

```js
const outPorts = registry.outputPorts(descriptor.id);   // dir:'out', in order
const inPorts  = registry.ports(descriptor.id).filter((p) => p.dir === 'in');
// throw if their ids don't match your processor's fixed [input]/[output] order
```

---

## 5. The DSP worklet — where your algorithm lives

For anything with real sonic character, the built-in nodes won't get you there,
and this is where the module actually lives. A worklet is an
`AudioWorkletProcessor`: the host hands it the input buffers and the current param
values, and it fills the output buffers with whatever your algorithm produces.
What happens inside is entirely yours — DreamRack only cares about the descriptor
and the panel.

**Writing it.** If you already have your DSP algorithm, it will usually be easiest
to write the worklet directly in **JavaScript** — a `process()` loop over the
sample buffers, as below. It is *also* possible to bring existing DSP written in
**C, Rust, or similar by compiling it to WebAssembly** and running it inside the
worklet (the app already sets the cross-origin-isolation headers that
SharedArrayBuffer needs) — **but this route has not been tested yet**; every module
shipping today is hand-written JavaScript.

Declare the worklet's path in `descriptor.worklets` (relative to the page, e.g.
`'modules/my-module/my-module-processor.js'`); the host calls
`audioWorklet.addModule()` on it once before instantiating.

```js
'use strict';

class MyProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    // the NUMERIC, automatable params — ids must match descriptor param ids
    return [{ name: 'level', defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    // switches / momentary / clock messages arrive here (posted from setParam)
    this.port.onmessage = (e) => { /* update state from e.data */ };
  }
  process(inputs, outputs, parameters) {
    // inputs[i]  = the i-th descriptor dir:'in' port
    // outputs[i] = the i-th descriptor dir:'out' port
    // ZERO ALLOCATION here: preallocate all state; only read/write samples.
    return true;   // keep the node alive
  }
}
registerProcessor('my-module', MyProcessor);
```

- **AudioParams vs messages.** Continuous numeric knobs become AudioParams
  (`parameterDescriptors`) that the factory sets via `setValueAtTime` /
  `setTargetAtTime`. Discrete switches, momentary strikes, and structural changes
  (clock ratio, run/stop) are sent with `node.port.postMessage(...)` from
  `setParam`.
- **Input/output indices** follow the descriptor's `dir:'in'` / `dir:'out'`
  order — the same order the factory asserts.
- Keep `process()` allocation-free; it runs on the audio thread.

---

## 6. The panel — a generated faceplate

Panels are **generated, never hand-drawn**, so one house look is enforced in one
place and the light/dark twins can't drift. `gen-panel.js` requires the shared
library and emits both SVGs:

```js
const { defs, jack, knob, radioGroup, button, label, attachedLabel, bipolarMark } = require('../../panel/primitives');
const { THEME } = require('../../panel/theme');

const FACE_W = 100;          // panel width in mm (≈ hp × 5.08); sets the module's rack width

function build(dark) {
  const th = THEME[dark ? 'dark' : 'light'];
  const p = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_W}mm" height="128.5mm" viewBox="0 0 ${FACE_W} 128.5" ...>`);
  p.push(defs(th));
  // ...place jack(), knob(), label(), etc. by (x, y) in millimetres...
  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

fs.writeFileSync(__dirname + '/panel.svg', build(false));
fs.writeFileSync(__dirname + '/panel.dark.svg', build(true));
```

Generate (and regenerate after any change) with:

```
node modules/my-module/gen-panel.js
```

Commit `panel.svg` and `panel.dark.svg` — they are the contract the host loads.

**Coordinates.** viewBox is in millimetres. The active face is 113.5912 mm tall
within a 128.5 mm 3U row. The loader crops the mounting rim by resetting the
origin to `(3.9, 7.0994)`, so keep the frame border and all content **inside** that
region (inset the border like the 259t, or wrap the body in one `translate(3.9,
7.0994)`), or the top/left edge is cropped. Panel width = `FACE_W`; the rack sizes
the module from the SVG's viewBox width.

**Binding tags** (emitted by the primitives — you rarely write them by hand):

- **Knob / continuous control** — a `<g data-wcoast-param="...">` with
  `data-wcoast-cx`/`cy` (the pivot) and exactly one child
  `data-wcoast-role="indicator"` (the pointer, drawn straight up at zero). Optional
  `data-wcoast-angle-min`/`max` override the default −150°..+150° sweep.
- **Lamp / stepped control** — one element per step tagged
  `data-wcoast-role="step-indicator"` with `data-wcoast-step="<value>"`.
- **Jack** — `data-wcoast-port="..."` with `data-wcoast-cx`/`cy` (the cord anchor).
- **Legends / scale numbers** — static, untagged.

The host validates on load: every tag must resolve to a real descriptor id, every
param/port must have exactly one tagged element, every control needs an indicator
+ pivot (or step-indicators), every jack an anchor.

See `design/faceplate-system.md` for the full faceplate system (primitives,
theme tokens, channel-repeat, flow layout).

---

## 7. Registering the module

Registration is currently explicit, in `debug/rack-app.js` — two additions:

```js
// 1. import and register the descriptor + factory
import myDescriptor from '../modules/my-module/descriptor.js';
import { create as myCreate } from '../modules/my-module/factory.js';
registry.register({ descriptor: myDescriptor, create: myCreate });

// 2. add a MODULE_TYPES entry (this is what the Add-module menu lists)
{
  descriptorId: myDescriptor.id,
  name: 'My Module',
  hp: 20,
  panelUrl: 'modules/my-module/panel.svg',
  descriptor: myDescriptor,
  // hidden: true,   // for a pinned singleton like the mixer
}
```

That's the whole hook: the host discovers everything else from the descriptor,
the factory, and the panel.

---

## 8. Signal domains and colours

One palette runs through the jacks, the cables, and the module identity band, so a
rack reads at a glance:

| domain | colour | typical use |
|--------|--------|-------------|
| `audio`   | yellow | audio-rate signals |
| `control` | orange | CV / modulation |
| `trigger` | blue   | triggers, gates, clocks |
| pitch     | green  | 1V/oct (control input with `role: 'pitch'`) |

A **cable** takes the colour of the input it plugs into — it shows the role the
signal plays *at its destination*, not where it came from. A module's **identity
band** (the coloured stripe in its title column) is coloured by the signal type(s)
it **outputs**, derived automatically from your output ports (or set explicitly
with `signalIdentity`).

---

## 9. Save / load and stable ids

A saved patch stores modules by descriptor `id`, wiring by port `id`, and settings
by param `id`. **Never rename an id once patches may exist** — you'd orphan saved
work. Adding new params/ports is safe (old patches simply don't set them); removing
or renaming is not. The patch format also stamps the app version and the exact
source revision, so a bug report carrying a patch traces back to a build.

---

## 10. Step-by-step checklist

1. **Design by function.** Decide the controls and jacks the module needs, and pick
   the library control that serves each (a knob, a toggle, a jack…).
2. **Write `descriptor.js`.** Declare `ports` and `params` with stable ids, correct
   domains/dirs, curves, ranges, and defaults. Set `worklets: []` if native-only.
3. **Write `factory.js`.** Build the graph (native nodes and/or one worklet node)
   and return the instance contract. Assert the worklet port order against the
   descriptor.
4. **Write the worklet** (if any). `parameterDescriptors` for numeric knobs; a
   message port for switches and structural changes; allocation-free `process()`.
5. **Write `gen-panel.js`** and run `node modules/my-module/gen-panel.js`. Place the
   controls; keep everything inside the cropped face; regenerate both SVGs.
6. **Register** the module in `debug/rack-app.js` (register + a `MODULE_TYPES` entry).
7. **Run the app**, add the module from the menu, patch it, and verify: audio flows,
   knobs turn and take effect, jacks colour correctly, the identity band reads
   right, and a saved patch reloads.

---

## 11. Quick reference

**Descriptor** — `{ id, apiVersion, name, abbreviation, worklets, ports, params,
sectioned?, channels?, signalIdentity?, hp? }`

**Port** — `{ id, name, section, domain: 'audio'|'control'|'trigger', dir:
'in'|'out', target?, role? }`

**Param** — `{ id, name, section, curve: 'linear'|'gainDb'|'stepped'|'detent',
min, max, default, glideMs, steps?, momentary? }`

**Factory** — `create(ctx, { descriptor, registry, sampleRate }) -> { node?,
getOutput(portId), getInput(portId), getParam(paramId), setParam(paramId, value,
atTime?), supports(paramId), dispose() }`

**Worklet** — `class extends AudioWorkletProcessor` with static
`parameterDescriptors`, a `port.onmessage` handler, an allocation-free `process()`,
and `registerProcessor('<descriptor.id>', Class)`. Path listed in
`descriptor.worklets`.

**Panel** — `gen-panel.js` builds with `panel/primitives` + `panel/theme`, emits
`panel.svg` + `panel.dark.svg`; controls carry `data-wcoast-param` / `-port`,
`-cx`/`-cy`, and an `indicator` or `step-indicator` role.

**Register** — `registry.register({ descriptor, create })` + a `MODULE_TYPES` entry
in `debug/rack-app.js`.
