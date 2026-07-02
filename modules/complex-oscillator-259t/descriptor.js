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
// SOURCE: modelled from the official Buchla & TipTop Audio 259t manual
// (tiptopaudio.com/manuals/Buchla_&_Tiptop_Audio_259t.pdf), which is the
// authoritative panel reference. Every port and control below corresponds to
// a real jack, knob, or switch on the 259t — EXCEPT the ART system, which is
// deliberately omitted (see "ART — DROPPED" below).
//
// ART — DROPPED. The 259t's ART (Autonomous Reactive Tuning) hardware exists
// to solve two analog problems we do not have: (1) autotuning oscillator
// drift — irrelevant because a digital oscillator computes frequency exactly
// and never drifts; and (2) polyphonic voice allocation over a hardware
// protocol — handled instead by Wcoast's own per-voice engine and the GXW
// bridge. So the per-oscillator ART switch, ART input jack, and GATE OUT jack
// are removed. What remains of that area is the plain 1V/oct pitch input,
// which our oscillator tracks perfectly with no tuning apparatus behind it.
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
// VERIFY-AGAINST-PANEL (minor, flagged honestly): a few fine points aren't
// fully resolved by the manual's text and are worth a glance at a clear panel
// photo before the DSP is built: whether the Timbre CV input has its own
// attenuator (the manual notes only that Order and Symmetry lack attenuators,
// implying others may have them); the exact end-labels on Order/Symmetry
// ("even/odd"); and whether any oscillator exposes a second, direct (un-
// attenuated) FM jack in addition to the attenuated one. These are marked
// TODO:verify inline.

export default {
  apiVersion: 1,
  id: "wcoast.complexOsc259t",
  name: "Complex Oscillator",
  model: "Buchla & TipTop 259t",
  scope: "voice",          // one full copy per polyphonic voice
  hp: 34,                  // panel width reference, for faithful layout

  // Worklet DSP module paths the host must addModule() before instantiating
  // this module. Paths are relative to the app:// origin root. Per the
  // one-module-one-worklet rule the whole 259t (both oscillators AND the
  // Timbre/Harmonics wavefolder) lives in this single processor, which sits
  // in the module's own folder alongside this descriptor and the factory.
  worklets: ["modules/complex-oscillator-259t/complex-osc-processor.js"],

  // Logical panel sections, used to group controls for faithful layout and
  // for dictation ("the timbre section"). Order is top-of-panel intent.
  sections: [
    { id: "modOsc",  name: "Modulation Oscillator" },
    { id: "middle",  name: "Modulation (center)" },
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
      glideMs: 0, modulatable: false },   // attenuator for modFm input
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
      glideMs: 0, modulatable: false },   // attenuator for prinFm input

    // Timbre / Harmonics (shapes the Principal's Final output)
    { id: "timbre", section: "timbre", name: "Timbre",
      min: 0, max: 1, default: 0.2, unit: "", curve: "linear",
      glideMs: 20, modulatable: true },   // fold depth / shape crossfade
    { id: "order", section: "timbre", name: "Order",
      min: 0, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 20, modulatable: true },   // crossfade folder<->saw<->M shape
    { id: "symmetry", section: "timbre", name: "Symmetry",
      min: -1, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 20, modulatable: true },   // DC offset into folder / saw-M xfade

    // Middle modulation section (Modulation osc -> Principal)
    { id: "modIndex", section: "middle", name: "Mod Index",
      min: -1, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 10, modulatable: false },  // attenuverter: depth for the 3 mod switches
    { id: "amplMod", section: "middle", name: "Amplitude Mod",
      curve: "stepped", default: "off", modulatable: false,
      steps: [ { value: "off", name: "Off" }, { value: "on", name: "On" } ] },
    { id: "pitchMod", section: "middle", name: "Pitch Mod (FM)",
      curve: "stepped", default: "off", modulatable: false,
      steps: [ { value: "off", name: "Off" }, { value: "on", name: "On" } ] },
    { id: "timbreMod", section: "middle", name: "Timbre Mod",
      curve: "stepped", default: "off", modulatable: false,
      steps: [ { value: "off", name: "Off" }, { value: "on", name: "On" } ] },
    { id: "phaseLockAmount", section: "middle", name: "Phase Lock",
      min: 0, max: 1, default: 0, unit: "", curve: "linear",
      glideMs: 10, modulatable: false },  // attenuator on the phase-lock input
  ],

  // ---- PORTS (jacks) ----
  // dir: "in" | "out". domain: "audio" | "control" | "trigger".
  // target: (inputs only) the parameter id this CV input modulates. Absent on
  //   pure signal inputs (audio FM, phase lock) and on all outputs.
  ports: [
    // Modulation oscillator inputs
    { id: "modPitchIn", section: "modOsc", name: "1V/Oct", domain: "control",
      dir: "in", target: "modFreq" },                 // was 1V/OCT-or-ART; ART dropped
    { id: "modCvIn", section: "modOsc", name: "CV In", domain: "control",
      dir: "in", target: "modFreq", via: "modCvAmount" }, // attenuverted CV
    { id: "modFmIn", section: "modOsc", name: "FM In", domain: "audio",
      dir: "in" },                                    // audio-rate FM, scaled by modFmAmount
    // Modulation oscillator outputs
    { id: "modTriOut", section: "modOsc", name: "Triangle", domain: "audio",
      dir: "out" },                                   // fixed triangle, always available
    { id: "modSigOut", section: "modOsc", name: "Signal", domain: "audio",
      dir: "out" },                                   // shape set by modWave
    { id: "modCvOut", section: "modOsc", name: "CV Out", domain: "control",
      dir: "out" },                                   // for use as a control source

    // Principal oscillator inputs
    { id: "prinPitchIn", section: "prinOsc", name: "1V/Oct", domain: "control",
      dir: "in", target: "prinFreq" },
    { id: "prinCvIn", section: "prinOsc", name: "CV In", domain: "control",
      dir: "in", target: "prinFreq", via: "prinCvAmount" },
    { id: "prinFmIn", section: "prinOsc", name: "FM In", domain: "audio",
      dir: "in" },                                    // scaled by prinFmAmount
    // Principal oscillator outputs
    { id: "prinSineOut", section: "prinOsc", name: "Sine", domain: "audio",
      dir: "out" },
    { id: "prinSquareOut", section: "prinOsc", name: "Square", domain: "audio",
      dir: "out" },
    { id: "prinFinalOut", section: "prinOsc", name: "Final", domain: "audio",
      dir: "out" },                                   // post Timbre/Harmonics

    // Timbre / Harmonics CV inputs (Order & Symmetry have NO attenuator)
    { id: "timbreCvIn", section: "timbre", name: "Timbre CV", domain: "control",
      dir: "in", target: "timbre" },                  // TODO:verify own attenuator
    { id: "orderCvIn", section: "timbre", name: "Order CV", domain: "control",
      dir: "in", target: "order" },
    { id: "symmetryCvIn", section: "timbre", name: "Symmetry CV", domain: "control",
      dir: "in", target: "symmetry" },

    // Middle section: phase-lock audio input (attenuated by phaseLockAmount)
    { id: "phaseLockIn", section: "middle", name: "Phase Lock In", domain: "audio",
      dir: "in" },
  ],
};
