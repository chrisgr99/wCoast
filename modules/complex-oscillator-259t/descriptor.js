// descriptor.js — Complex Oscillator (Buchla & TipTop 259t), Wcoast module.
//
// This is the DESCRIPTOR: pure data describing what the module is. It is the
// single source of truth the host reads to build the panel, the connection
// grid, the right-click patching menus, dictation names, save/load, and the
// GXW message routing. The host never needs to understand the DSP to handle
// this module — it only reads this descriptor. The audio-building FACTORY
// (create()) is a separate concern added when the DSP is implemented; this
// file is data only, so the module can be fully designed before any sound.
//
// SOURCE: reconciled against a clear faceplate photo of the real module
// (259t-faceplate-reference.png in this folder; from postmodular.co.uk),
// cross-checked with the official manual. Every port and control below
// corresponds to a real jack, knob, or switch on the 259t — EXCEPT the ART
// system, which is deliberately omitted (see "ART — DROPPED" below).
//
// ART — DROPPED (labels and controls both). The 259t's ART (Autonomous
// Reactive Tuning) hardware solves two analog problems we do not have: (1)
// autotuning oscillator drift — irrelevant because a digital oscillator
// computes frequency exactly and never drifts; and (2) polyphonic voice
// allocation over a hardware protocol — handled instead by Wcoast's own
// per-voice engine and the GXW bridge. We have better ways to do the same
// things. So EVERYTHING ART-related is removed: the Range switch's ART
// position (Range is just low/high here), both "1V/OCT · ART" buttons and
// their LEDs, the ART input jacks, and the two red GATE OUT jacks. Each
// oscillator's keyboard input remains as a plain 1V/oct pitch input, which our
// oscillator tracks perfectly with no tuning apparatus behind it.
//
// SIGNAL DOMAINS. Every port declares one of three domains — "audio",
// "control", "trigger" — which drive cable styling (audio thick, control
// thin, trigger medium dashed) and the connection policy (warn/deny). The
// 259t has no trigger ports; its jacks are audio or control.
//
// PARAMETERS vs PORTS. A knob whose value can also be voltage-controlled is
// modelled as a single modulatable parameter (a control-domain destination
// with a base value from the knob). Where the panel exposes an explicit CV
// input jack for that parameter, the jack is listed in `ports` with a
// `target` naming the parameter it modulates, so the inventory stays complete
// and the knob<->jack relationship is explicit. Pure signal jacks (audio FM
// inputs, the phase-lock input, all outputs) are ports with no target.
//
// RESOLVED FROM THE FACEPLATE PHOTO (was TODO:verify): Timbre's CV input DOES
// have its own attenuverter (Order and Symmetry do not); the end-labels are
// Order low->high and Symmetry even->odd; there is exactly ONE f.m. in per
// oscillator (no second direct FM jack). The photo also caught two controls
// the manual text alone missed and that ARE now included below: Mod Index has
// its own CV input (attenuverted), and phase lock has an on/off switch (the
// middle column) in addition to its input jack and "gain" knob.

export default {
  apiVersion: 1,
  id: "wcoast.complexOsc259t",
  name: "Complex Oscillator",
  abbreviation: "Cpx Osc",
  model: "Buchla & TipTop 259t",
  scope: "voice",          // one full copy per polyphonic voice
  hp: 34,                  // panel width reference, for faithful layout

  // Connect-menu order: PRINCIPAL oscillator before MODULATION, then the folder
  // and centre controls. Menu-only — declaration order still fixes worklet I/O.
  menuSectionOrder: ["prinOsc", "modOsc", "timbre", "middle"],

  // Worklet DSP module paths the host must addModule() before instantiating
  // this module. Paths are relative to the app:// origin root. Per the
  // one-module-one-worklet rule the whole 259t (both oscillators AND the
  // Timbre/Harmonics wavefolder) lives in this single processor, which sits
  // in the module's own folder alongside this descriptor and the factory.
  worklets: ["modules/complex-oscillator-259t/complex-osc-processor.js"],

  // Internal DSP settings (NOT faceplate controls). oversample is the
  // wavefolder's oversampling factor — a quality/CPU knob per DESIGN §6, kept
  // out of the panel because it isn't a real Buchla control.
  dsp: { oversample: 4 },

  // Logical panel sections, used to group controls for faithful layout and
  // for dictation ("the timbre section"). Order is top-of-panel intent.
  sections: [
    { id: "modOsc",  name: "Modulation Oscillator" },
    { id: "middle",  name: "Modulation Index / Phase Lock" },
    { id: "timbre",  name: "Timbre / Harmonics" },
    { id: "prinOsc", name: "Principal Oscillator" },
  ],

  // ---- PARAMETERS (knobs and switches) ----
  // curve: "linear" | "exp" (perceptual/frequency) | "stepped" (switch/select)
  // modulatable: true means it is also a control-domain modulation destination
  //   (and, where the panel shows a CV jack for it, a matching port carries a
  //   `target` back to this id).
  params: [
    // Modulation oscillator
    { id: "modFreq",  section: "modOsc", name: "Frequency",
      min: 27.5, max: 7040, default: 220, unit: "Hz", curve: "exp",
      glideMs: 8, modulatable: true },
    { id: "modFine",  section: "modOsc", name: "Fine Tune",
      min: -3.5, max: 3.5, default: 0, unit: "st", curve: "linear",
      glideMs: 8, modulatable: false },   // ~a fifth of range per manual
    { id: "modCvAmount", section: "modOsc", name: "CV Amount",
      min: -1, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 0, modulatable: false },   // attenuverter for modCv input
    { id: "modFmAmount", section: "modOsc", name: "FM Amount",
      min: 0, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 0, modulatable: false, needsPort: "modFmIn" },   // attenuator for modFm input (inert with nothing patched)
    { id: "modRange", section: "modOsc", name: "Range",
      curve: "stepped", default: "high", modulatable: false,
      steps: [
        { value: "low",  name: "Low (LFO)" },   // 0.25–64 Hz
        { value: "high", name: "High (Audio)" } // 27–7040 Hz
      ] },
    { id: "modWave", section: "modOsc", name: "Signal Waveform",
      curve: "stepped", default: "triangle", modulatable: false,
      steps: [
        { value: "triangle", name: "Triangle" },
        { value: "square",   name: "Square" },
        { value: "sawtooth", name: "Sawtooth" }
      ] },   // selects the Signal output shape; Triangle out is always present

    // Principal oscillator
    { id: "prinFreq", section: "prinOsc", name: "Frequency",
      min: 27.5, max: 7040, default: 110, unit: "Hz", curve: "exp",
      glideMs: 8, modulatable: true },
    { id: "prinFine", section: "prinOsc", name: "Fine Tune",
      min: -3.5, max: 3.5, default: 0, unit: "st", curve: "linear",
      glideMs: 8, modulatable: false },
    { id: "prinCvAmount", section: "prinOsc", name: "CV Amount",
      min: -1, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 0, modulatable: false },   // attenuverter for prinCv input
    { id: "prinFmAmount", section: "prinOsc", name: "FM Amount",
      min: 0, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 0, modulatable: false, needsPort: "prinFmIn" },   // attenuator for prinFm input (inert with nothing patched)

    // Timbre / Harmonics (shapes the Principal's Final output). Panel legends:
    // Order runs low->high, Symmetry runs even->odd. Timbre's CV input has its
    // own attenuverter (timbreCvAmount); Order and Symmetry CV inputs do not.
    { id: "timbre", section: "timbre", name: "Timbre",
      min: 0, max: 1, default: 0.2, unit: "", curve: "linear",
      glideMs: 20, modulatable: true },   // fold depth
    { id: "timbreCvAmount", section: "timbre", name: "Timbre CV Amount",
      min: -1, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 0, modulatable: false },   // attenuverter for the timbre CV input
    { id: "order", section: "timbre", name: "Order",
      min: 0, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 20, modulatable: true, minLabel: "low", maxLabel: "high" },
    { id: "symmetry", section: "timbre", name: "Symmetry",
      min: -1, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 20, modulatable: true, minLabel: "even", maxLabel: "odd" },

    // Middle modulation section (Modulation osc -> Principal). Mod Index is the
    // depth attenuverter for the three mod switches, and it has its own CV
    // input (modIndexCvIn) with an attenuverter (modIndexCvAmount).
    { id: "modIndex", section: "middle", name: "Mod Index",
      min: -1, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 10, modulatable: true },   // depth for the mod switches; CV-able
    { id: "modIndexCvAmount", section: "middle", name: "Mod Index CV Amount",
      min: -1, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 0, modulatable: false },   // attenuverter for the mod-index CV input
    { id: "amplMod", section: "middle", name: "Amplitude Mod",
      curve: "stepped", default: "off", modulatable: false,
      steps: [ { value: "off", name: "Off" }, { value: "on", name: "On" } ] },
    { id: "pitchMod", section: "middle", name: "Pitch Mod (FM)",
      curve: "stepped", default: "off", modulatable: false,
      steps: [ { value: "off", name: "Off" }, { value: "on", name: "On" } ] },
    { id: "timbreMod", section: "middle", name: "Timbre Mod",
      curve: "stepped", default: "off", modulatable: false,
      steps: [ { value: "off", name: "Off" }, { value: "on", name: "On" } ] },
    { id: "phaseLock", section: "middle", name: "Phase Lock",
      curve: "stepped", default: "off", modulatable: false, needsPort: "phaseLockIn",
      steps: [ { value: "off", name: "Off" }, { value: "on", name: "On" } ] },   // does nothing without a phase-lock input
    { id: "phaseLockAmount", section: "middle", name: "Phase Lock Gain",
      min: 0, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 10, modulatable: false, needsPort: "phaseLockIn" },  // panel "gain" on the phase-lock input (inert with nothing patched)
  ],

  // ---- PORTS (jacks) ----
  // dir: "in" | "out". domain: "audio" | "control" | "trigger".
  // target: (inputs only) the parameter id this CV input modulates. Absent on
  //   pure signal inputs (audio FM, phase lock) and on all outputs.
  ports: [
    // Modulation oscillator inputs
    { id: "modPitchIn", section: "modOsc", name: "Mod 1V/Oct", domain: "control",
      dir: "in", target: "modFreq", role: "pitch" },  // 1V/oct pitch/keyboard in (green jack)
    { id: "modCvIn", section: "modOsc", name: "Mod CV In", domain: "control",
      dir: "in", target: "modFreq", via: "modCvAmount" }, // attenuverted CV
    { id: "modFmIn", section: "modOsc", name: "Mod FM In", domain: "audio",
      dir: "in" },                                    // audio-rate FM, scaled by modFmAmount
    // Modulation oscillator outputs
    { id: "modTriOut", section: "modOsc", name: "Mod Triangle", domain: "audio",
      dir: "out" },                                   // fixed triangle, always available
    { id: "modSigOut", section: "modOsc", name: "Mod Signal", domain: "audio",
      dir: "out" },                                   // shape set by modWave
    { id: "modCvOut", section: "modOsc", name: "Mod CV Out", domain: "control",
      dir: "out" },                                   // for use as a control source

    // Principal oscillator inputs
    { id: "prinPitchIn", section: "prinOsc", name: "Prin 1V/Oct", domain: "control",
      dir: "in", target: "prinFreq", role: "pitch" },
    { id: "prinCvIn", section: "prinOsc", name: "Prin CV In", domain: "control",
      dir: "in", target: "prinFreq", via: "prinCvAmount" },
    { id: "prinFmIn", section: "prinOsc", name: "Prin FM In", domain: "audio",
      dir: "in" },                                    // scaled by prinFmAmount
    // Principal oscillator outputs
    { id: "prinSineOut", section: "prinOsc", name: "Prin Sine", domain: "audio",
      dir: "out" },
    { id: "prinSquareOut", section: "prinOsc", name: "Prin Square", domain: "audio",
      dir: "out" },
    { id: "prinFinalOut", section: "prinOsc", name: "Prin Final", domain: "audio",
      dir: "out" },                                   // post Timbre/Harmonics

    // Timbre / Harmonics CV inputs. Timbre has its own attenuverter; Order and
    // Symmetry go straight in (no attenuator) — confirmed from the faceplate.
    { id: "timbreCvIn", section: "timbre", name: "Timbre CV", abbr: "Tmb CV", domain: "control",
      dir: "in", target: "timbre", via: "timbreCvAmount" },
    { id: "orderCvIn", section: "timbre", name: "Order CV", abbr: "Ord CV", domain: "control",
      dir: "in", target: "order" },
    { id: "symmetryCvIn", section: "timbre", name: "Symmetry CV", abbr: "Sym CV", domain: "control",
      dir: "in", target: "symmetry" },

    // Middle section: Mod Index CV (attenuverted) and the phase-lock audio
    // input (its level set by the phaseLockAmount "gain" knob).
    { id: "modIndexCvIn", section: "middle", name: "Mod Index CV", abbr: "Idx CV", domain: "control",
      dir: "in", target: "modIndex", via: "modIndexCvAmount" },
    { id: "phaseLockIn", section: "middle", name: "Phase Lock In", abbr: "PhLock", domain: "audio",
      dir: "in" },
  ],
};
