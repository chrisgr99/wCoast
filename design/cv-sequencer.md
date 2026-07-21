# CV Sequencer — design spec

Status: design specification for future development. NOT yet implemented. Captured here so the design is
preserved and can be revised in place as it evolves.

## Module name
CV Sequencer

## Purpose
The CV Sequencer is a compact modular control-voltage sequencer for a browser-based modular synthesizer. It is inspired by Serge-style programmer sequencers, but it should not behave like a touch keyboard and should not require performance by clicking on tiny stage controls.

The module is not primarily a MIDI-style note sequencer, piano roll, or DAW pattern editor. It is a modular voltage programmer. It stores several rows of values and outputs those values as patchable CV, gate, trigger, stage, end, and chain signals.

The module should be useful for pitch sequences, timbre animation, LPG level patterns, envelope timing, wavefolder movement, delay feedback, filter cutoff, probability modulation, or any other voltage-controlled destination.

The first version should be powerful enough to create evolving and syncopated patterns, but not so complex that it becomes a separate composition environment.

## Core concept
The module has 8 visible stages. Each stage stores values for several rows. The first version should have three CV rows and one gate row.

Rows:
- Row A: general CV row, usually defaulting to pitch.
- Row B: general CV row, usually defaulting to unipolar modulation.
- Row C: general CV row, usually defaulting to unipolar modulation.
- Gate row: determines whether the current stage fires a gate or trigger.

The module should support both simple global-stage sequencing and more advanced independent-row sequencing.

### Global Stage Mode
All rows share one playhead. On each clock, the whole module moves to the next stage. Row A, Row B, Row C, and Gate all read from the same stage number.

### Independent Row Mode
Each row has its own playhead. Row A, Row B, Row C, and Gate may each have their own length, direction, clock division, reset behavior, and end behavior. This allows an 8-stage sequencer to create much longer evolving patterns through polymeter and row interaction.

## Initial size
The first version should be an 8-stage module. A later version may support 16 stages, but the preferred design is to chain two 8-stage modules rather than make one large dense 16-stage panel.

Reason for 8 stages: an 8-stage panel is easier to read, easier to magnify, and easier to edit. Longer patterns should be produced by chaining modules or by using independent row lengths and reset behavior.

## Main outputs
- Row A CV out
- Row B CV out
- Row C CV out
- Gate out
- Trigger out
- End out
- Chain out
- Stage CV out

Optional later outputs: End A, End B, End C, End Gate, Stage number event out (if the system supports structured event signals).

## Main inputs
- Clock in
- Reset in
- Run in
- Direction in
- Chain in
- Length CV in
- Row A transpose CV in
- Row B offset CV in
- Row C offset CV in

Optional later inputs: Reset A, Reset B, Reset C, Reset Gate, Clock A, Clock B, Clock C, Clock Gate, Reverse all, Reverse selected row, Stage select input.

## Clocking
The module is primarily externally clocked. The first version does not need an internal clock. It advances from pulses at Clock in.

- In Global Stage Mode, each clock advances the shared playhead.
- In Independent Row Mode, each row decides whether to advance on a given clock according to its clock division, run state, probability, and row rules.

## Reset
Reset in returns the sequence to the start.

- In Global Stage Mode, Reset returns the shared playhead to stage 1.
- In Independent Row Mode, Reset can target all rows or a selected row.

Reset Target options: All, Row A, Row B, Row C, Gate row.

The first version can use one Reset input plus a Reset Target selector. Later versions may add separate reset inputs for each row.

## Run
If Run is off, incoming clocks do not advance the sequencer. If Run is on, incoming clocks advance the sequencer.

If Run in is patched, the external signal controls run state. If Run in is not patched, the module's Run switch controls run state.

## Length
- In Global Stage Mode, the module has a global length from 1 to 8.
- In Independent Row Mode, each row has its own length from 1 to 8.

Example: Row A length 7, Row B length 5, Row C length 8, Gate row length 3. This creates a composite pattern that takes many clock pulses to fully repeat, even though each row only has 8 visible stages.

## Direction
The module should support direction control.

Global direction modes: Forward, Reverse, Pendulum, Random.
Independent row direction modes: each row may have its own direction (Forward, Reverse, Pendulum, Random).

- Forward steps upward through the row.
- Reverse steps downward.
- Pendulum moves forward then backward.
- Random chooses a stage within the active row length.

First-version recommendation: include Forward, Reverse, and Pendulum. Add Random if implementation is straightforward.

## Gate behavior
The Gate row determines whether a stage fires.

- Gate on: the stage produces a gate and trigger when reached.
- Gate off: the stage still outputs Row A, B, and C values, but Gate out and Trigger out do not fire.

This distinction is important. A silent stage may still change pitch, timbre, envelope timing, or other CV values.

### Gate length
The module should have a Gate Length control. In the first version, this can be a global percentage of the current clock interval (e.g. 10, 25, 50, 75, 100 percent). If the clock interval is not known yet, use a safe default gate time.

## Trigger behavior
Trigger out emits a short pulse at the start of each enabled stage. The internal trigger may be very short (1–5 ms), but the UI LED should remain visible for about 50–100 ms.

## Probability
The module should support per-stage gate probability. Each stage can have a probability value controlling whether the gate and trigger actually fire when that stage is reached.

Suggested values: 100, 75, 50, 25, 0 percent. Simple and readable, not a tiny continuous control in the first version.

Important behavior: if the probability check fails, the CV rows still output their values. Only the gate and trigger are suppressed.

Musical purpose: probability makes an 8-step sequence less mechanical — useful for percussion, plucked patterns, generative melodies, and evolving rhythms.

### Advance probability (optional)
Different from gate probability: gate probability decides whether a note fires; advance probability decides whether a row moves to its next stage. Example: Row B has 75% advance probability, so on some clocks it stays put while Row A keeps moving, creating drifting timbre patterns.

Recommendation: include gate probability in the first version. Include row advance probability only if the UI can clearly show when a row did not advance.

## Ratchets and repeats
Each stage should optionally repeat its trigger within the stage duration. Suggested values: 1x, 2x, 3x, 4x (1x = normal, 2x = two evenly spaced triggers during the stage, etc.).

Gate/Trigger behavior: in the first version, Trigger out should fire once for each ratchet pulse; Gate out may stay high for the stage duration (easier to understand than making the gate chatter).

Musical purpose: Berlin-school patterns, percussion bursts, repeated plucks, tremolo-like effects, animated modular sequences.

## Glide
The module should support glide, especially for Row A pitch.

Simple first version: each stage has Glide on/off for Row A; a global Glide Time control sets the slide time.
Later: glide per row, per-stage glide time, glide on Row B and Row C.

Important behavior: glide should be optional — many modular uses require sharp stepped voltages. First-version behavior: Row A can glide from the previous to the new Row A value when Glide is enabled for that stage; Row B and Row C remain stepped unless glide is later added.

## Row modes
Each CV row should have a mode.

Defaults: Row A = Pitch, chromatic quantized; Row B = Unipolar CV; Row C = Unipolar CV.

Suggested modes: Pitch chromatic, Pitch unquantized, Unipolar 0..1, Bipolar -1..+1, Percent 0..100.
Later: Major scale, Minor scale, Pentatonic scale, User scale, Time multiplier, Discrete steps 4/8/16.

## Quantization
Row A should support chromatic quantization in the first version. Row B and Row C may remain continuous in the first version; later they may support stepped quantization (4/8/16 levels).

## Row range and offset
Each CV row should have row-level scaling — Row A: Transpose + Range; Row B: Offset + Range; Row C: Offset + Range.

Purpose: the same stored sequence can be adapted to different destinations without editing every stage (e.g. Row B a subtle wavefolder movement with a small range, or dramatic movement with a large range).

## Stage skip
Stage skip is different from gate off. Gate off: the stage still happens but does not fire a gate/trigger. Skip: the sequencer jumps over the stage entirely.

Recommendation: do not include skip in the first version unless it remains visually clear. Gate off is enough for the first version; skip can be added later.

## Independent row playback
An advanced but important creative feature. In this mode, each row has: Length, Direction, Clock division, Playhead, optional reset behavior, optional end behavior, optional advance probability. This allows syncopated, recycling, polymetric, evolving patterns from only 8 stages.

### Per-row clock division
Each row may advance at a different rate relative to the main clock. Suggested: 1/1 (every clock), 1/2, 1/3, 1/4. Optional later: 2x, 3x, 4x, external clock per row.

Example: Row A every clock, Row B every 2, Row C every 3, Gate every clock — pitch, timbre, and rhythm shift against each other.

### Per-row reset
In Independent Row Mode the user should be able to reset one row without resetting the others (e.g. reset Row A to the start while B and C continue; reset Row C when Row B reaches its end). This creates syncopation and recycling patterns.

### Per-row end actions
Each row may have an action when it reaches its end: Do nothing, Reset all rows, Reset Row A/B/C/Gate, Reverse all rows, Reverse Row A/B/C/Gate, Fire End pulse only.

Examples: Row B end resets Row A; Gate row end reverses Row C; Row C end fires End out but resets nothing; Row A end reverses Row B.

Musical purpose: generative phrase structure without a large sequencer — short rows can reset or reverse each other to produce syncopation, phasing, and evolving cycles.

### Row reverse
Rows should be able to reverse direction manually or through end actions. First version: per-row direction settings and per-row end actions are enough. Later: patchable Reverse All / Reverse Row input.

### Polymeter examples
- A pitch len 7 fwd; B timbre len 5 rev; C envelope len 8 pend; Gate rhythm len 3 fwd — realigns only after many clocks.
- A len 8; B len 5; C len 4; Gate len 7 — pitch loop feels familiar, but timbre/envelope/rhythm shift against it.
- A len 6 pend; B len 5 rev; C len 8 fwd; Gate len 4 — cycling movement without randomization.

## Chaining
Two CV Sequencer modules should be chainable to create the equivalent of a 16-stage sequence. The module should remain 8 stages visually; longer patterns come from connecting two modules.

Chaining ports: Chain In, Chain Out. Optional: Reset Out, Run Out, Active Out.

Chain mode: Off (independent 8-stage), First in chain (starts active after reset), Next in chain (starts inactive after reset, waits for Chain In).

Simple two-module chain: Seq1 = First, Seq2 = Next; both receive the same master clock; Seq1 Chain Out → Seq2 Chain In; Seq2 Chain Out → Seq1 Chain In.

Preferred chain behavior: only the active sequencer advances and fires gates; the inactive one does not fire gates/triggers.

### Inactive output mode
Options: Hold, Zero, Mute gates only. Default: hold CV outputs but mute gates and triggers — avoids sudden CV jumps while preventing both sequencers firing notes at once.

Chain reset behavior: a master reset returns Seq1 to stage 1 + active, and Seq2 to stage 1 + inactive.

Chaining visual feedback: an Active indicator shows whether this module is active in a chain; Chain Out LED flashes when handing control on; Chain In visibly activates the module; inactive modules are visually dimmed or clearly labelled inactive.

## Visual layout
The panel should be readable under screen magnification. Avoid a dense 16-column grid in the first version.

Suggested top band: Module title, Run button, Reset button, Mode selector (Global/Independent), Length, Direction, Gate Length, Glide Time, Chain Mode selector.

Suggested main grid: 8 stage columns × 4 row lanes (A, B, C, G). Rows A/B/C show stored CV values; Row G shows gate state / probability / repeat depending on display mode.

- In Global Stage Mode: one strong vertical active-stage highlight across all rows.
- In Independent Row Mode: each row has its own active-cell highlight (essential, since each row may be on a different stage).

Suggested grid sketch:

```
+------------------------------------------------------+
| CV SEQUENCER     Mode: Independent     Run Reset     |
| Chain: Off       Gate 50%    Glide 80 ms             |
+------------------------------------------------------+
|        1    2    3    4    5    6    7    8          |
| A ●    C3   D3  [E3]  G3   A3   G3   E3   D3  L7 Fwd|
| B ●   .20  .35  .50  .70 [.60] .40  .25  .10 L5 Rev|
| C ●   .80 [.70] .50  .30  .40  .60  .75  .90 L8 Pend|
| G ●    ON   ON   --  [ON]  ON   --   ON   ON L3 Fwd|
+------------------------------------------------------+
| Row End Action: B end -> Reset A                     |
| IN: Clock Reset Run Dir Chain In                     |
| OUT: A CV B CV C CV Gate Trig End Chain Stage        |
+------------------------------------------------------+
```

The bracketed values show the active cell for each row; in the actual UI this should be a strong visible rectangle/highlight, not brackets.

### Large selected-stage editor
Because the grid can become dense, include a large selected-stage editor with larger text/controls than the grid. Example: Selected Stage 4 — A Pitch G3, B CV 0.70, C CV 0.30, Gate ON, Probability 100%, Repeat 1x, Glide ON.

### Large selected-row editor
In Independent Row Mode, edit the selected row as a whole. Example: Selected Row B — Length 5, Direction Reverse, Clock Division 1/2, End Action Reset Row A, Advance Probability 100%, Range 60%, Offset 0.10.

### List view (later)
A text/list view of the same data, useful for accessibility and patch inspection. Example: `Stage 1: A C3, B 0.20, C 0.80, Gate ON, Prob 100, Repeat 1x`.

## LEDs and activity indicators
Clear activity LEDs show when each row is firing or advancing. Each row has a row activity LED near its label:
- Row A/B/C LED: flashes/brightens when the row advances or outputs a newly selected value.
- Gate row LED: flashes when the Gate row fires a trigger or opens a gate.

These indicate activity, not connection state — a connected but inactive output should not look active.

- In Global Stage Mode: A/B/C LEDs may flash together when the sequencer advances; the Gate LED flashes only if the current stage's gate actually fires.
- In Independent Row Mode: each row LED flashes independently (A every clock, B every 2nd, C every 3rd, Gate only when its own row fires).

Output jack LEDs: each output jack has a small activity LED — A/B/C CV (activity at that output), Gate (lit while gate high), Trigger (brief flash per pulse), End (flash when End fires), Chain (flash when Chain fires), Stage (flash/change when Stage CV changes).

CV LED behavior: for stepped rows, flash briefly when the row advances / value changes; for held values, remain dimly lit to show a sustained nonzero output; for bipolar CV, the first version can show absolute activity level rather than polarity.

Recommended visible timing: row and trigger LEDs flash for ~50–100 ms even if the internal trigger is shorter.

Probability feedback: if gate probability fails, Gate/Trigger LEDs do not flash; if row advance probability fails, that row's CV LED does not flash. LEDs show what actually happened.

Ratchet feedback: if a stage repeat > 1x, Trigger LED flashes for each ratchet pulse; Gate LED may stay high for the full gate duration in the first version.

Chaining feedback: Active LED lit when active, dim/off when inactive; Chain LED flashes when Chain Out fires; when Chain In activates the module, Active LED turns on and the stage highlight moves to the first active stage.

Suggested LED sketch:

```
+------------------------------------------------------+
| CV SEQUENCER        Active ●   Chain ●   End ●       |
+------------------------------------------------------+
|        1    2    3    4    5    6    7    8          |
| A ●    C3   D3  [E3]  G3   A3   G3   E3   D3        |
| B ●   .20  .35  .50  .70 [.60] .40  .25  .10        |
| C ●   .80 [.70] .50  .30  .40  .60  .75  .90        |
| G ●    ON   ON   --  [ON]  ON   --   ON   ON        |
+------------------------------------------------------+
| OUT: A CV ●  B CV ●  C CV ●  Gate ●  Trig ● End ●   |
+------------------------------------------------------+
```

### Accessibility requirements for LEDs
LEDs must not be the only way to understand module state. Every LED state should also be supported by text, highlighting, or position. Do not rely on color alone — use brightness, shape, labels, and position. Examples: the active row cell is highlighted; chain state has an Active/Inactive text label; gate states are visible as ON/OFF; selected stage and active stage use different outlines.

## Editing model
The module should not require mouse performance. Clicking a stage may select it for editing, but performance should come from clock, reset, patching, and keyboard-friendly controls.

Distinguish: Active stage/cell = what the sequencer is currently outputting; Selected stage/cell = what the user is editing.

### Keyboard-friendly editing
Left/Right arrows select previous/next stage; Up/Down arrows select previous/next row; Plus/Minus increase/decrease the selected value; Shift+Plus/Minus change by a larger amount; Enter toggles gate on/off for the selected stage; Space starts/stops the sequencer when the module has focus. These shortcuts apply only when the module has focus and must not interfere with browser shortcuts.

## Parameter list
```
run: boolean
mode: globalStage or independentRows
globalLength: integer 1..8
globalDirection: forward, reverse, pendulum, random
gateLength: percentage or time
glideTime: time
chainMode: off, first, next
inactiveOutputMode: hold, zero, muteGatesOnly

rowAMode: pitchChromatic, pitchUnquantized, unipolar, bipolar
rowBMode: unipolar, bipolar, pitch
rowCMode: unipolar, bipolar, pitch

rowATranspose, rowARange
rowBOffset, rowBRange
rowCOffset, rowCRange

rowALength, rowBLength, rowCLength, gateRowLength
rowADirection, rowBDirection, rowCDirection, gateRowDirection
rowAClockDivision, rowBClockDivision, rowCClockDivision, gateRowClockDivision
rowAEndAction, rowBEndAction, rowCEndAction, gateRowEndAction
rowAAdvanceProbability, rowBAdvanceProbability, rowCAdvanceProbability, gateRowAdvanceProbability   (optional)

stageValuesA: array of 8 values
stageValuesB: array of 8 values
stageValuesC: array of 8 values
stageGates: array of 8 booleans
stageGateProbabilities: array of 8 values
stageRepeats: array of 8 values
stageGlideA: array of 8 booleans

activeStageGlobal, activeStageA, activeStageB, activeStageC, activeStageGate
selectedStage, selectedRow
```

## DSP and control behavior
Primarily a control-rate module. It should run inside the AudioWorklet or control engine with timing accurate enough for musical sequencing. Clock, reset, gate, trigger, end, and chain events must NOT depend on requestAnimationFrame — UI animation can be frame-based, but actual control timing should be engine-based.

- CV outputs: stepped control signals unless glide is active. Optional smoothing may be available but not forced globally.
- Trigger outputs: short internal pulses suitable for envelopes, LPGs, function generators, etc.
- Gate outputs: stay high for the selected gate duration.
- End output: fires when the selected end source reaches its end. End source options: Global cycle, Any row, Row A, Row B, Row C, Gate row. First version may use Global cycle and Any row only.
- Chain out: fires when the module reaches its chain end condition (end of the global cycle in Global Mode, or the end of the selected master row in Independent Mode).
- Chain master (Independent Mode): which row controls Chain Out — Global, Row A, Row B, Row C, Gate row. Default Row A or Global, depending on mode.

## Patch saving
The saved patch must include all stage values, gate states, probabilities, repeats, glide flags, row modes, quantization settings, row lengths, row directions, row clock divisions, end actions, chain settings, selected mode, and visual labels.

## Row labels
Rows should eventually be user-labelable (e.g. Row A: Pitch, Row B: Fold, Row C: Decay). Not required in the first version, but it would make patches easier to understand.

## Default patch
- Row A: C3, D3, E3, G3, A3, G3, E3, D3
- Row B: 0.20, 0.35, 0.50, 0.70, 0.60, 0.40, 0.25, 0.10
- Row C: 0.80, 0.70, 0.50, 0.30, 0.40, 0.60, 0.75, 0.90
- Gate: ON, ON, OFF, ON, ON, OFF, ON, ON

Default mode: Global Stage Mode, Length 8, Direction Forward, Gate Length 50%, Row A chromatic pitch, Row B/C unipolar, all probabilities 100%, all repeats 1x, all glide off.

## Recommended first-version feature set
8 stages; 3 CV rows; 1 gate row; external clock; Reset; Run; Global Stage Mode; Independent Row Mode; per-row length; per-row direction (forward/reverse/pendulum); per-row clock division (1/1, 1/2, 1/3, 1/4); per-row end action (none, reset all, reset selected row, reverse all, reverse selected row); Chain In/Out; Chain Mode (off/first/next); Inactive Output Mode (hold/zero/mute gates only); per-stage gate on/off; per-stage gate probability; per-stage repeat/ratchet; global gate length; global glide time; per-stage Row A glide on/off; Row A pitch/chromatic; Row B/C unipolar CV; row-level range and offset; A/B/C CV, Gate, Trigger, End, Chain, Stage outputs; row activity LEDs; output jack LEDs; active-stage/active-cell highlights; large selected-stage editor; large selected-row editor; keyboard-friendly editing.

## Features to defer
16-stage panel; internal clock; full scale quantization; separate clock input per row; separate reset input per row; per-stage gate length; per-stage independent glide time; per-stage direction changes; per-stage CV curve; full Euclidean rhythm system; pattern scenes; song mode; piano roll; deep random mutation system; mouse/touch performance keyboard.

## Reason for this design
The CV Sequencer should preserve the most useful Serge-like idea: a sequencer as a voltage programmer rather than a note list. It avoids touch-keyboard behavior that would not work well for users without a touchscreen or who do not want to perform by clicking.

The most important creative features are independent row playback, row length, row direction, row reset, row reversal, probability, ratchets, glide, and chaining. These make a short 8-stage sequencer feel much larger and more alive — allowing syncopation, polymeter, recycling patterns, phase relationships, and generative structure without a large 32-step sequencer or a DAW-like interface. It fits a modular Web Audio synthesizer because the outputs remain ordinary patchable CV, gate, trigger, end, chain, and stage signals.
