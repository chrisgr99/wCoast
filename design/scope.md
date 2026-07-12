# Signal scope — specification

The scope is a clip-on probe you drop on any terminal to *see* a signal. Today it is a
pretty signal-wiggler with continuous auto-scaling; this turns it into an instrument you
can actually read — real-scope triggering, calibrated 1-2-5 scales, a one-shot autoset,
and a second trace — while keeping its small, glanceable footprint.

## 1. Principles

- **Compact for monitoring, menu for setup.** The resting scope stays small (a readout you
  glance at). Everything configurable lives in the **right-click menu**, so no gesture is
  ever *required* — this matters for a mouse-first, screen-magnified workflow. A handful of
  frequent adjustments are *also* promoted to gestures.
- **Autoset is a one-shot, not a background process.** The old continuous auto-scale hides
  the very thing you want to watch — the trace breathing as amplitude and rate change. It
  runs **once** (on open, or on demand) and then **holds**, so those dynamics stay visible.
- **The face carries the signal; the corner carries the trigger.** The signal enters through
  the scope's **edge loop** (as now). An optional external trigger enters through a **corner
  tee**. Nothing on the tiny face requires precise dragging.

## 2. Display

- A faint **graticule** — a centre cross plus light division lines, tuned to the wide aspect
  (about 10 horizontal by 4 vertical divisions). The divisions are what make the calibrated
  scales legible: one reads "per division".
- **Traces are colour-coded**: trace 1 is **white** (`#ffffff`); trace 2 is **bright orange**
  (`#ff8c1a`) — chosen for readability on the dark face. Both share the time base.
- **Transient readout.** The face shows no permanent numbers. While you actively change a
  scale (scroll or cmd-drag), a small label flashes the value in a corner (e.g. `2 ms/div`,
  `0.2 /div`) for ~1 s and fades. The persistent values live in the menu.
- The **trigger level** is drawn as a **dotted horizontal line** across the display, in the
  colour of the trace it triggers on — so you can see exactly where the sweep fires.

## 3. Autoset (one-shot)

Runs on open and whenever invoked from the menu. It reads a short window of the signal and
picks settings that **frame it with headroom** so the dynamics stay readable:

- **Vertical:** choose the 1-2-5 step where the current peak fills roughly **60–70%** of the
  screen — not 100%, so the trace can grow without instantly clipping and shrink without
  vanishing.
- **Time base:** choose the 1-2-5 step showing a **few cycles** (for a periodic signal), so
  cycles visibly spread and compress as the rate changes.
- **Trigger level:** place it at the signal's **midpoint / zero crossing**, so triggering is
  stable by default and rarely needs manual setting.

After autoset, all settings **hold** until you change them or run autoset again.

## 4. Scales (calibrated 1-2-5)

Vertical scale and time base step through a **1, 2, 5, 10, …** sequence (per division),
replacing the old continuous multipliers. Adjusted three ways, all equivalent:

- **Vertical scroll** → vertical scale (per-division amplitude).
- **Horizontal scroll** → time base (scan rate), where the device supports it.
- **Cmd-drag on the face** → the same, for devices that can't scroll horizontally: horizontal
  drag = time base, vertical drag = vertical scale. (Plain drag still *moves* the scope, so
  the modifier is required.)
- **Menu** → the current values are shown, and can be stepped there too.

## 5. Triggering

- **Source.** Default is **self-trigger** — the scope triggers on the signal it is showing
  (trace 1), so the common case needs no extra cable. To trigger on a *different* signal,
  **drag from the corner tee** onto a terminal; that becomes the external trigger source. A
  small **tee** shows in the top-left corner (opposite the resize handle) marking the drag
  point. The trigger cable hangs from the scope **corner nearest its source** and follows as
  the scope moves.
- **Level.** The dotted line (§2). Defaulted by autoset; adjustable via scroll while the
  menu's "set trigger level" is active, or a coarse grab in the enlarged view.
- **Slope.** Rising or falling edge.
- **Mode.**
  - **Auto** — free-run if no trigger arrives (always shows something).
  - **Normal** — sweep only on a trigger (a stable locked trace).
  - **Single** — capture one sweep and freeze. Ideal for catching a single envelope or
    one-shot; pairs naturally with the held scales.
- With two traces, the menu lets you pick which trace (or the external tee) is the trigger
  source; default trace 1.

## 6. Traces (dual)

- **Add trace** (menu) enters a drag mode: pull a **second loop, in orange**, onto a terminal
  to add its trace. Both traces share the **time base**.
- **Vertical scale and position are per-trace.** Comparing an audio signal against a slow CV
  envelope means wildly different amplitudes, so each trace keeps its own vertical scale (and
  offset). The data model is per-trace from the start; a first cut may expose only trace 1's
  vertical control and share it, with per-trace controls added later.
- **Cap: two traces** on a face this small.
- **Remove** a trace by its loop's **×-dot** (the close gesture used elsewhere), or a menu
  "remove trace".

## 7. Interaction map

| Gesture | Action |
| --- | --- |
| Plain drag on face | Move the scope |
| Click on face | Freeze / run |
| Vertical scroll | Vertical scale (1-2-5) |
| Horizontal scroll / cmd-drag | Time base (1-2-5) |
| Right-click | The scope menu (everything) |
| Drag from top-left tee | Set external trigger source |
| Bottom-right corner | Resize (both dimensions) |
| Edge loop's dot | Re-probe (drag) / close (×) |
| Add-trace drag | Drop a second coloured loop |

Everything reachable by gesture is also in the menu; no gesture is mandatory.

## 8. Menu structure

- **Autoset** — re-frame now.
- **Vertical** — current value; step finer / coarser.
- **Time base** — current value; step finer / coarser.
- **Trigger ▸** — Mode (Auto / Normal / Single), Slope (Rising / Falling), Source (Trace 1 /
  Trace 2 / External), Set level.
- **Coupling** — DC / AC (AC removes a DC bias so a small signal on a CV offset is readable).
- **Add trace** / **Remove trace**.
- **Freeze / Run.**
- **Reset** — back to autoset defaults.

## 9. Data model

Per scope:
- `traces[]` — 1 or 2, each `{ key, portId, tap, analyser, color, vDiv, vPos }` (per-trace
  vertical scale index and offset; `color` white or orange).
- `tDiv` — shared time-base step index.
- `trigger` — `{ sourceIndex | 'ext', extKey, extPortId, extAnalyser, mode, slope, level }`.
- `frozen`, `armed` (for Single), plus the graticule/readout state.

Replaces today's continuous `gainMul` / `timeMul` (now step indices), `trigger` boolean (now
the trigger object), and `forceMode`. Persisted per scope: trace ports and colours, `tDiv`,
per-trace `vDiv`/`vPos`, the trigger object, `frozen`, `w`, `h`.

## 10. Build plan

1. **Readable core.** One-shot autoset (with headroom), 1-2-5 vertical/time scales, the
   graticule, and the fading readout. Replace continuous auto-scale. Highest value.
2. **Trigger system.** Self-trigger default, the dotted trigger-level line, slope, and the
   Auto / Normal / Single modes; the corner tee for an external source.
3. **Second trace.** Add-trace drag, white/orange colours, shared time base, per-trace
   vertical, remove-by-×.
