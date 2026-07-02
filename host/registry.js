// registry.js — the module registry.
//
// The registry is the host's catalogue of known modules. A module is
// registered as a pair: its DESCRIPTOR (pure data — the single source of
// truth for panels, ports, params, dictation, save/load, GXW routing) and
// its CREATE factory (the code that builds Web Audio nodes when a voice
// needs sound). The registry keeps the two together under the descriptor's
// id and offers small, boring enumeration helpers so the rest of the host
// (and the debug surface) can ask "what params does this module have?",
// "what are its audio outputs?", "what does this CV input target?" WITHOUT
// ever reaching into module-specific code. That decoupling is the whole
// point of the descriptor: the host is generic; modules are data + a factory.
//
// This file is deliberately audio-free. It touches no AudioContext, no
// worklet, nothing from the browser — it is pure data plumbing, so it can be
// imported and unit-checked under plain Node. Instantiation (which does need
// the AudioContext) lives in host.js; the registry only knows descriptors and
// hands back the matching factory on request.

'use strict';

// The port domains and directions the schema allows. Kept here so validation
// has one place to check against and callers can reuse the sets.
export const DOMAINS = Object.freeze(['audio', 'control', 'trigger']);
export const DIRECTIONS = Object.freeze(['in', 'out']);

// Validate a descriptor enough to catch the mistakes that would otherwise
// surface later as confusing wiring bugs: missing ids, duplicate ids across
// the shared param/port namespace (addresses must be unique because the
// netlist stores `instanceId.paramOrPortId`), unknown domains/directions, and
// CV inputs whose `target`/`via` name a param that does not exist. It does
// NOT enforce DSP-level correctness — the descriptor can be complete on paper
// while its factory is still a stub. Throws on the first structural problem
// with a message naming the offending module and field.
export function validateDescriptor(descriptor) {
  const where = descriptor && descriptor.id ? `module "${descriptor.id}"` : 'module (no id)';
  if (!descriptor || typeof descriptor !== 'object') {
    throw new Error(`Descriptor for ${where} is not an object.`);
  }
  if (typeof descriptor.id !== 'string' || descriptor.id === '') {
    throw new Error(`Descriptor is missing a string "id".`);
  }
  if (typeof descriptor.apiVersion !== 'number') {
    throw new Error(`Descriptor for ${where} is missing a numeric "apiVersion".`);
  }
  const params = Array.isArray(descriptor.params) ? descriptor.params : [];
  const ports = Array.isArray(descriptor.ports) ? descriptor.ports : [];

  // Build the param id set first so port targets can be checked against it.
  const paramIds = new Set();
  for (const p of params) {
    if (!p || typeof p.id !== 'string' || p.id === '') {
      throw new Error(`Descriptor for ${where} has a param with no id.`);
    }
    if (paramIds.has(p.id)) {
      throw new Error(`Descriptor for ${where} has duplicate param id "${p.id}".`);
    }
    paramIds.add(p.id);
  }

  // Ports share the address namespace with params; a port id must not collide
  // with a param id, and ports must not duplicate each other.
  const portIds = new Set();
  for (const port of ports) {
    if (!port || typeof port.id !== 'string' || port.id === '') {
      throw new Error(`Descriptor for ${where} has a port with no id.`);
    }
    if (portIds.has(port.id) || paramIds.has(port.id)) {
      throw new Error(`Descriptor for ${where} has an id collision on "${port.id}".`);
    }
    portIds.add(port.id);
    if (!DOMAINS.includes(port.domain)) {
      throw new Error(`Port "${port.id}" in ${where} has unknown domain "${port.domain}".`);
    }
    if (!DIRECTIONS.includes(port.dir)) {
      throw new Error(`Port "${port.id}" in ${where} has unknown dir "${port.dir}".`);
    }
    // A CV input's target/via must name real params. Outputs and pure signal
    // inputs carry neither; that is legal.
    if (port.target !== undefined && !paramIds.has(port.target)) {
      throw new Error(`Port "${port.id}" in ${where} targets unknown param "${port.target}".`);
    }
    if (port.via !== undefined && !paramIds.has(port.via)) {
      throw new Error(`Port "${port.id}" in ${where} names unknown attenuator "${port.via}".`);
    }
  }
  return true;
}

export class ModuleRegistry {
  constructor() {
    // id -> { descriptor, create }. create may be null for a data-only
    // registration (a descriptor registered before its factory exists — the
    // host will refuse to instantiate it, but enumeration still works).
    this._modules = new Map();
  }

  // Register a module. `entry` is { descriptor, create? }. The descriptor is
  // validated up front so a malformed module fails loudly at registration,
  // not deep inside a later patch operation.
  register(entry) {
    if (!entry || typeof entry !== 'object' || !entry.descriptor) {
      throw new Error('register() expects { descriptor, create? }.');
    }
    const { descriptor, create } = entry;
    validateDescriptor(descriptor);
    if (create !== undefined && typeof create !== 'function') {
      throw new Error(`Module "${descriptor.id}" create must be a function if given.`);
    }
    if (this._modules.has(descriptor.id)) {
      throw new Error(`Module "${descriptor.id}" is already registered.`);
    }
    this._modules.set(descriptor.id, { descriptor, create: create || null });
    return descriptor.id;
  }

  has(id) { return this._modules.has(id); }

  // The raw registration record; throws if unknown so callers get a clear
  // error rather than an undefined dereference.
  entry(id) {
    const e = this._modules.get(id);
    if (!e) throw new Error(`No module registered under "${id}".`);
    return e;
  }

  descriptor(id) { return this.entry(id).descriptor; }
  factory(id) { return this.entry(id).create; }
  ids() { return [...this._modules.keys()]; }

  // ---- Enumeration helpers (read-only views onto the descriptor) ----
  // These exist so the rest of the host never re-implements descriptor
  // filtering. They all return fresh arrays / plain values so a caller can't
  // mutate the registered descriptor by accident.

  params(id) { return [...(this.descriptor(id).params || [])]; }
  ports(id) { return [...(this.descriptor(id).ports || [])]; }

  paramById(id, paramId) {
    return (this.descriptor(id).params || []).find((p) => p.id === paramId) || null;
  }
  portById(id, portId) {
    return (this.descriptor(id).ports || []).find((p) => p.id === portId) || null;
  }

  // Node OUTPUT ports, in descriptor order. Every out port is an audio-graph
  // output regardless of domain (a control-domain "CV out" is still a signal
  // node output); the domain only affects cable styling and policy, not
  // whether it is a graph output. The order defines the worklet's output
  // index assignment, so it must be stable — see the factory's assertion.
  outputPorts(id) {
    return (this.descriptor(id).ports || []).filter((p) => p.dir === 'out');
  }

  // Node INPUT ports: only pure signal inputs (dir "in" with NO target). A CV
  // input carries a `target` and is realized as a connection to that param's
  // AudioParam, not as a node input — so it is deliberately excluded here.
  signalInputPorts(id) {
    return (this.descriptor(id).ports || []).filter((p) => p.dir === 'in' && p.target === undefined);
  }

  // CV input ports: dir "in" WITH a target. These map a source's output onto
  // the target param's AudioParam (optionally through the `via` attenuator).
  cvInputPorts(id) {
    return (this.descriptor(id).ports || []).filter((p) => p.dir === 'in' && p.target !== undefined);
  }
}
