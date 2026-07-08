# Source of Entropy — module specification

A stochastic control-voltage source built as a **chaos-to-order continuum over one
random core**. It keeps the full palette of the Buchla / Tiptop **Source of
Uncertainty** — the raw kinds of randomness — and adds a single **ORDER** stage,
drawn from Mutable **Marbles**, that imposes *degrees of order* on the stepped and
sampled randomness: distribution shaping, quantization, musical scale, and
above all déjà-vu looping. The same random source is tapped **raw and ordered at
once**, which is the capability neither original has and the reason this is a new
module rather than a copy of either.

Organising principle: read the panel left → right as **uncertainty → order**.
Every control either *generates* raw randomness or *imposes a degree of order* on
it; if a control does neither, it doesn't belong here.

Faceplate uses the shared library (`panel/*`) like the four current modules: jacks
neutral (loader paints by domain), knobs with scales, the new `stepButton` for the
scale selector, an illuminated `button` for déjà-vu on/off, radio/grouping-line
where a small set of states is chosen.

## 1. How it preserves the Source of Uncertainty (capability mapping)

| Source of Uncertainty capability | Source of Entropy |
| --- | --- |
| Noise: 3 colours | **NOISE** section — white / dark / bright, unchanged |
| Fluctuating random voltages (rate) | **FLUCTUATING** section — 2 smooth CVs, one RATE |
| Quantized random ("number of states") | **STEPS** knob on the ordered core |
| Stored random ("distribution") | **BIAS + SPREAD** on the ordered core |
| Stored random: sample external | **EXT IN** (sample-and-hold source) |
| Stored random: raw sampled output | **RAW OUT** (unshaped random per clock) |

Marbles adds on top: **déjà-vu** loop/length/mutate, a **scale** quantizer, the
**Y** slow output, and a probability-gated **random gate**. The Source of
Uncertainty's separate *quantized* and *stored* sections are unified into one core
(they are the same primitive) so the machinery is built once — this is what makes
the combined module smaller than the two originals side by side.

## 2. Sections

### A. Noise  (raw)
Three always-on noise outputs of different spectral tilt: **white**, **dark**
(low-tilted), **bright** (high-tilted). No controls.

### B. Fluctuating random  (raw)
Two smoothly wandering bipolar CVs. One **RATE** knob (+CV) sets the fluctuation
speed for both. Not orderable — looping continuous noise is meaningless — so this
section has no path into the ORDER stage.

### C. Clock  (timing)
The core's heartbeat. **RATE** knob; **CLOCK IN** (external, overrides internal);
**CLOCK OUT**.

### D. The random core  (the one shared generator)
On every clock it draws one random state — a value and a gate decision.
- **RAW OUT** — the unshaped value, full range, uniform: the Source of
  Uncertainty's stored-random tap, the "chaos" output.
- **EXT IN** — patch a signal and the clock samples *it* instead of internal
  noise (sample-and-hold).
- **PROBABILITY** knob → **GATE OUT** — the gate decision as a trigger; probability
  sets its density (a coin/Bernoulli gate). This is the one nod to Marbles' gate
  engine, kept to a single derived output rather than a second engine.

### E. ORDER  (Marbles-derived; the degrees of order)
Everything here shapes the core's stream. Four axes of order:
- *Statistics* — **SPREAD** (+CV): how wide a range values span. **BIAS** (+CV):
  where the distribution centres.
- *Granularity* — **STEPS** (+CV): smooth continuous at CCW → snap to fewer and
  fewer discrete levels toward CW (the "number of states").
- *Pitch* — **SCALE**: a `stepButton` picking the output quantizer scale
  (*off · chromatic · major · minor · pentatonic*).
- *Time* — **DÉJÀ VU** (+CV): fresh random → **lock and loop** at centre →
  **mutate** toward CW. **LENGTH**: loop length (1/2/3/4/6/8/16). **DÉJÀ VU**
  button: engage / bypass (illuminated). Déjà-vu loops the whole per-clock state,
  so it repeats the voltage *and* the gate together.
- Outputs: **X1**, **X2** — two independent ordered CVs from the same shaped core;
  **Y** — a slower ordered CV sampled every few clocks.

## 3. Parameters (descriptor draft)

`fluctRate` (exp) · `clockRate` (exp) · `spread` (0..1) · `bias` (−1..1) ·
`steps` (0..1) · `scale` (stepped: off/chromatic/major/minor/penta) ·
`dejaVu` (0..1, centre-detent = loop) · `length` (stepped: 1/2/3/4/6/8/16) ·
`dejaOn` (on/off) · `probability` (0..1).

## 4. Ports (descriptor draft)

Inputs: `clockIn` (trigger), `extIn` (audio S&H source), `fluctRateCv`,
`spreadCv`, `biasCv`, `stepsCv`, `dejaVuCv` (control).

Outputs: `noiseWhite`, `noiseDark`, `noiseBright` (audio); `fluct1`, `fluct2`,
`rawOut`, `x1`, `x2`, `y` (control); `gateOut`, `clockOut` (trigger).

## 5. Proposed panel layout

3U (128.5 mm). Three vertical bands, **uncertainty on the left, order on the
right**, separated by the house divider lines; the ordered CV outputs sit at the
far-right edge as the destination of the flow. Working width ≈ 175 mm.

```
 UNCERTAINTY  ─────────────────────────────────────────────►  ORDER
┌───────────────┬─────────────────────┬──────────────────────────────┐
│ NOISE         │ CLOCK               │ ORDER                        │
│  ○white ○dark │  (RATE)  ○in ○out   │        ( DÉJÀ VU )  ○cv       │
│  ○bright      │                     │   (SPREAD)○ (BIAS)○ (STEPS)○  │
│               │ RANDOM CORE         │      LENGTH:•• DÉJÀ VU:(lamp) │
│ FLUCTUATING   │  ○ext in  ○RAW out  │   SCALE  [btn ○○○○○]          │
│  (RATE) ○cv   │                     │                     OUTS →   │
│  ○fluct1      │ GATE                │              ○X1  ○X2  ○Y     │
│  ○fluct2      │  (PROB) ○gate out   │                              │
└───────────────┴─────────────────────┴──────────────────────────────┘
   raw sources        one clocked core          shape it to taste
```

- **Left band — RAW UNCERTAINTY.** NOISE across the top (white/dark/bright output
  jacks); FLUCTUATING below (RATE knob + CV-in, two output jacks). Pure Source-of-
  Uncertainty, no path to the order stage.
- **Middle band — CORE & CLOCK.** CLOCK at top (RATE, clock-in, clock-out); the
  RANDOM CORE centre (EXT-in and RAW-out jacks); GATE at the bottom (PROBABILITY
  knob, gate-out). Everything the order stage consumes originates here.
- **Right band — ORDER.** A prominent **DÉJÀ VU** knob as the visual hub (with its
  CV-in), the three shaping knobs SPREAD / BIAS / STEPS (each with a CV-in jack)
  above/around it, LENGTH and the illuminated DÉJÀ VU on/off button beside it, and
  the SCALE stepper button with its lamp row. The ordered outputs **X1, X2, Y**
  are the rightmost jacks — the end of the chaos-to-order journey.

A thin header rule can carry the words UNCERTAINTY … ORDER to make the left-right
reading explicit.

## 6. DSP notes (Web Audio worklet)

- Noise: three sources with fixed one-pole tilt filters.
- Fluctuating: interpolated/slew-limited noise; RATE sets interpolation rate.
- Core: on each clock draw a uniform value + a Bernoulli gate (PROBABILITY). RAW
  OUT = the value; EXT IN replaces the draw with a sample of the input.
- Order: value → SPREAD (scale) → BIAS (offset) → STEPS (quantize to N levels) →
  SCALE (snap to scale). X1/X2 = two draws through the same shaping; Y sampled
  every N clocks.
- Déjà-vu: a ring buffer of the last LENGTH per-clock states; DÉJÀ VU amount is the
  probability of replaying the buffered state vs. drawing fresh, with the CW end
  randomly overwriting one slot (mutation). Buffers the value + gate together.

## 7. Open decisions

1. Random gates: keep the single probability-gated GATE OUT (current proposal), or
   grow it toward a fuller Marbles-style t engine (models, two/three gate streams)?
2. Déjà-vu scope: one shared knob over the whole core (current proposal, simplest)
   vs. independent déjà-vu for the gate and the voltages.
3. Scale quantizer in v1, or ship X as free voltage first and add scales later?
4. Distribution: is BIAS + SPREAD enough, or add a uniform-vs-peaked curve control
   (the Source of Uncertainty's stored-random "distribution")?
5. Final width / HP once the panel is drafted — this is a large module.
