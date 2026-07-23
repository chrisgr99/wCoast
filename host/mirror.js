// mirror.js — the renderer side of the AI patch mirror.
//
// The renderer is the source of truth; this module turns the live state into the
// mirror's file contents and hands them to the Electron main process (over the
// window.wcoast.mirror bridge) to write. It also generates catalogue.json — the
// machine-readable authoring schema — from the module descriptors.
//
// Electron-only: in a bare browser there is no bridge, so everything here is a
// no-op. See design/ai-mirror.md.

'use strict';

export const MIRROR_PROTOCOL = 1;

// The authoring schema: every module type's ports and params, plus the mixer
// endpoint, generated from descriptors so it is always exact.
export function buildCatalogue(moduleDescriptors, mixerDescriptor) {
  const portOf = (p) => {
    const o = { id: p.id, name: p.name, domain: p.domain, dir: p.dir };
    if (p.target) o.target = p.target;
    if (p.via) o.via = p.via;
    return o;
  };
  const paramOf = (p) => {
    const o = { id: p.id, name: p.name, curve: p.curve };
    if (p.curve === 'stepped') o.steps = (p.steps || []).map((s) => s.value);
    else { o.min = p.min; o.max = p.max; }
    if (p.default !== undefined) o.default = p.default;
    return o;
  };
  const shapeOf = (d) => ({ name: d.name, ports: (d.ports || []).map(portOf), params: (d.params || []).map(paramOf) });

  const modules = {};
  for (const d of moduleDescriptors) modules[d.id] = shapeOf(d);
  return {
    protocolVersion: MIRROR_PROTOCOL,
    domains: ['audio', 'control', 'trigger'],
    connectionRules: 'same-domain connects; audio→control is allowed (FM); an input holds one cable; outputs fan out',
    modules,
    mixer: { key: 'mixer', ...shapeOf(mixerDescriptor) },
  };
}

// createMirror({ getPatch, getActive, catalogue, applyEdit }) wires the projection
// to the Electron bridge. getPatch()/getActive() return the current objects to
// write; catalogue is the (static) schema; applyEdit(text) validates + confirms +
// applies an external patch.json edit and returns { ok, error? }. Returns { init,
// setEnabled, isEnabled, reveal, project }. project() is debounced; init() reads
// the persisted enabled state and pushes the first full set.
export function createMirror({ getPatch, getActive, catalogue, applyEdit }) {
  const bridge = (typeof window !== 'undefined' && window.wcoast && window.wcoast.mirror) || null;
  let enabled = false;
  let timer = null;
  const str = (o) => JSON.stringify(o, null, 2);

  function pushNow(withCatalogue) {
    if (!bridge || !enabled) return;
    const files = { 'patch.json': str(getPatch()), 'active.json': str(getActive()) };
    if (withCatalogue) files['catalogue.json'] = str(catalogue);
    bridge.write(files);
  }

  // Write arbitrary observation-only files (selection.json, runtime.json,
  // audio-trace.json) when the mirror is on. A no-op otherwise, so callers can
  // fire freely without guarding. Values are objects (or null); serialised here.
  function pushFiles(obj) {
    if (!bridge || !enabled || !obj) return;
    const files = {};
    for (const k of Object.keys(obj)) files[k] = str(obj[k]);
    bridge.write(files);
  }

  // Round-trip: a handoff (the AI's inbox.json, in patch.json's format) arrives
  // here as text. Apply it (with the app's confirm + validation), report the
  // outcome, then re-project so patch.json reflects the running patch again.
  // Guard against overlap and duplicate deliveries (a backgrounded window can be
  // handed the same edit twice): never run two applies at once, and skip an edit
  // whose text we are already handling.
  let applying = false;
  let lastHandled = null;
  if (bridge && bridge.onExternal && applyEdit) {
    bridge.onExternal(async ({ text }) => {
      if (applying || text === lastHandled) return;
      applying = true;
      lastHandled = text;
      let result;
      try { result = await applyEdit(text); } catch (e) { result = { ok: false, error: String(e && e.message || e) }; }
      applying = false;
      if (bridge.result) bridge.result(result);
      pushNow(false);
    });
  }
  function project() {
    if (!bridge || !enabled || timer) return;
    timer = setTimeout(() => { timer = null; pushNow(false); }, 250);
  }
  async function init() {
    if (!bridge) return false;
    const s = await bridge.status();
    enabled = !!s.enabled;
    if (enabled) pushNow(true);
    return enabled;
  }
  async function setEnabled(v) {
    if (!bridge) return;
    const r = await bridge.setEnabled(v);
    enabled = !!r.enabled;
    if (enabled) pushNow(true);
  }

  return {
    init,
    setEnabled,
    isEnabled: () => enabled,
    available: () => !!bridge,
    reveal: () => bridge && bridge.reveal(),
    project,
    pushFiles,
  };
}
