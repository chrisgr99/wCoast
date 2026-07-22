// factory.js — Sine Source: a minimal self-playing test oscillator.
//
// The panel and descriptor were authored in the panel editor by drawing; this
// factory is the only hand-written code — the module's behaviour. It builds a
// native sine oscillator whose frequency is the drawn `freq` param and whose
// signal leaves through the drawn `out` audio port. Proof of the closed loop:
// draw the interface, write the behaviour, and it plays in the rack.
'use strict';

export function create(ctx, _services) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 220;
  const out = ctx.createGain();
  out.gain.value = 0.4;
  osc.connect(out);
  osc.start();

  const anchor = { node: out, index: 0 };
  return {
    node: out,
    getOutput: (portId) => (portId === 'out' ? anchor : null),
    getInput: () => null,                                   // no inputs — it's a source
    getParam: (paramId) => (paramId === 'freq' ? osc.frequency : null),
    setParam: (paramId, value) => { if (paramId === 'freq') osc.frequency.value = value; },
    supports: (paramId) => paramId === 'freq',
    dispose: () => { try { osc.stop(); osc.disconnect(); out.disconnect(); } catch (_e) { /* already gone */ } },
  };
}
