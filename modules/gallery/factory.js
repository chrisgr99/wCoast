// factory.js — Control Gallery: a display-only stub. The gallery makes no sound;
// it exists to render the canonical controls. It satisfies the instance contract
// with a single silent gain node so the rack can place and (harmlessly) patch it.
'use strict';

export function create(ctx, _services) {
  const node = ctx.createGain();
  node.gain.value = 0;                 // silent; this module is for display only
  const anchor = { node, index: 0 };
  return {
    node,
    getOutput: () => anchor,
    getInput: () => anchor,
    getParam: () => null,
    setParam: () => {},
    supports: () => false,
    dispose: () => { try { node.disconnect(); } catch (_e) { /* already gone */ } },
  };
}
