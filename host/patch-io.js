// patch-io.js — serialize a live patch to a portable object, and rebuild one.
//
// This is the environment-independent CORE of save/load (design/save-load.md):
// it knows nothing about files, dialogs, or storage — only how to turn the rack,
// its wiring, and every setting into a plain object, and how to reconstruct that.
// The storage adapters (Electron / browser) sit on top and only move the bytes.
//
// The format separates TOPOLOGY (which modules exist, where, and how wired) from
// SETTINGS (every param value), so settings snapshots can be added later without
// touching the topology or wiring (see design/save-load.md "Future").
//
//   serialize(rack, mixer) -> object
//   restore(object, rack, mixer) -> Promise<void>
//
// `mixer` is a small adapter for the toolbar mixer, which is a fixed patch
// endpoint rather than a rack module:
//   { key, getParams(): {id: value}, setParams({id: value}): void }

'use strict';

export const FORMAT = 'wcoast-patch';
export const VERSION = 1;

const round2 = (n) => Math.round(n * 100) / 100;

export function serialize(rack, mixer) {
  const recs = rack.moduleRecords();

  const modules = recs.map((rec) => ({
    id: rec.key,
    type: rec.descriptorId,
    row: rec.row,
    x: round2(rec.x),
  }));

  const params = {};
  for (const rec of recs) params[rec.key] = Object.fromEntries(rec.values);
  params[mixer.key] = { ...mixer.getParams() };

  const wiring = rack.patchbay.list().map((e) => {
    const w = {
      from: { module: e.src.key, port: e.src.portId },
      to: { module: e.dst.key, port: e.dst.portId },
    };
    if (e.bow) w.bow = { along: e.bow.along, perp: e.bow.perp };
    return w;
  });

  return {
    format: FORMAT,
    version: VERSION,
    rack: { rows: rack.rowCount },
    modules,
    wiring,
    settings: { params },
  };
}

export async function restore(obj, rack, mixer) {
  if (!obj || obj.format !== FORMAT) throw new Error('Not a Wcoast patch file.');
  if (obj.version !== VERSION) throw new Error(`Unsupported patch version ${obj.version}.`);

  rack.clear();
  if (obj.rack && typeof obj.rack.rows === 'number') rack.setRowCount(obj.rack.rows);

  // Recreate modules, mapping each saved id to the fresh session key. The mixer
  // is a fixed endpoint whose id maps to itself.
  const idToKey = new Map([[mixer.key, mixer.key]]);
  for (const m of obj.modules || []) {
    const rec = await rack.addModule(m.type, m.row, m.x);
    if (rec) idToKey.set(m.id, rec.key);
  }

  // Apply settings: module param maps, then the mixer.
  const params = (obj.settings && obj.settings.params) || {};
  for (const [id, vals] of Object.entries(params)) {
    if (id === mixer.key) { mixer.setParams(vals); continue; }
    const rec = rack.records.get(idToKey.get(id));
    if (rec) for (const [pid, v] of Object.entries(vals)) rack.applyParam(rec, pid, v);
  }

  // Recreate wiring (both endpoints now exist), restoring each cable's bend.
  for (const w of obj.wiring || []) {
    const fromKey = idToKey.get(w.from.module);
    const toKey = idToKey.get(w.to.module);
    if (!fromKey || !toKey) continue;
    const edge = rack.connectPatch(
      { key: fromKey, portId: w.from.port },
      { key: toKey, portId: w.to.port },
    );
    if (edge && w.bow) edge.bow = w.bow;
  }
  rack.redrawCables();
}

// Validate an (AI-authored) patch object against the registered descriptors.
// Returns { ok: true } or { ok: false, error }. Stricter than restore(), which
// trusts its input: this checks the format, module types, param ids and their
// ranges/steps, and wiring ports (real, right direction, one cable per input)
// BEFORE anything is applied — so a machine-written patch is rejected cleanly
// with a precise message rather than half-applied.
export function validate(obj, registry) {
  const bad = (m) => ({ ok: false, error: m });
  if (!obj || obj.format !== FORMAT) return bad('not a wcoast-patch file');
  if (obj.version !== VERSION) return bad(`unsupported version ${obj.version}`);

  // module id -> descriptor (the mixer is a fixed endpoint, always present).
  const descOf = new Map([['mixer', registry.descriptor('mixer')]]);
  for (const m of (obj.modules || [])) {
    if (!m || typeof m.id !== 'string') return bad('a module has no id');
    if (descOf.has(m.id)) return bad(`duplicate module id "${m.id}"`);
    if (!registry.has(m.type)) return bad(`unknown module type "${m.type}"`);
    descOf.set(m.id, registry.descriptor(m.type));
  }

  const params = (obj.settings && obj.settings.params) || {};
  for (const [mid, vals] of Object.entries(params)) {
    const d = descOf.get(mid);
    if (!d) return bad(`settings for unknown module "${mid}"`);
    const byId = new Map((d.params || []).map((p) => [p.id, p]));
    for (const [pid, v] of Object.entries(vals)) {
      const p = byId.get(pid);
      if (!p) return bad(`unknown param "${pid}" on "${mid}"`);
      if (p.curve === 'stepped') {
        const steps = (p.steps || []).map((s) => s.value);
        if (!steps.includes(v)) return bad(`param "${pid}" on "${mid}" must be one of: ${steps.join(', ')}`);
      } else if (typeof v !== 'number' || !Number.isFinite(v)) {
        return bad(`param "${pid}" on "${mid}" must be a number`);
      } else if (v < p.min || v > p.max) {
        return bad(`param "${pid}" on "${mid}" is out of range ${p.min}..${p.max}`);
      }
    }
  }

  const portOf = (mid, portId, dir) => {
    const d = descOf.get(mid);
    const port = d && (d.ports || []).find((pp) => pp.id === portId);
    return (port && port.dir === dir) ? port : null;
  };
  const usedInputs = new Set();
  for (const w of (obj.wiring || [])) {
    if (!w || !w.from || !w.to) return bad('a wiring entry is missing from/to');
    if (!descOf.has(w.from.module)) return bad(`wiring from unknown module "${w.from.module}"`);
    if (!descOf.has(w.to.module)) return bad(`wiring to unknown module "${w.to.module}"`);
    if (!portOf(w.from.module, w.from.port, 'out')) return bad(`no output "${w.from.port}" on "${w.from.module}"`);
    if (!portOf(w.to.module, w.to.port, 'in')) return bad(`no input "${w.to.port}" on "${w.to.module}"`);
    const key = `${w.to.module}|${w.to.port}`;
    if (usedInputs.has(key)) return bad(`input "${w.to.port}" on "${w.to.module}" has more than one cable`);
    usedInputs.add(key);
  }
  return { ok: true };
}
