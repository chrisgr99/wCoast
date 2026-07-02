// host.js — the audio host.
//
// The host owns the one AudioContext, loads the worklet DSP a module declares,
// and turns a registered module into a live, wired instance. It is the piece
// that consumes the descriptor at run time: it reads descriptor.worklets to
// know what to addModule(), and it hands the factory a `services` bundle so
// the factory can build its nodes without knowing anything about the host.
//
// The host stays generic — it has no knowledge of oscillators or wavefolders.
// Everything module-specific lives behind the descriptor (data) and the
// factory (code). Adding a new module is: register it, then instantiate it.
// That is the pluggability promise of DESIGN §4, made real.
//
// This milestone builds a SINGLE instance (no polyphony, no rack yet) — enough
// to hear the module. Voice allocation, stealing, and multi-instance patching
// come later (DESIGN §7); the seam is here (instantiate takes an optional
// instanceId) so growing to N voices doesn't reshape this file.

'use strict';

import { ModuleRegistry } from './registry.js';

export class SynthHost {
  // ctx: an AudioContext the caller created on a user gesture (browsers, and
  // Electron's renderer, require a gesture before audio starts). The host does
  // not create the context itself so the gesture stays in the UI layer.
  constructor(ctx, registry) {
    this.ctx = ctx;
    this.registry = registry || new ModuleRegistry();
    // Worklet module paths already addModule()'d, so we never load one twice
    // (addModule is idempotent but this avoids the extra round-trips).
    this._loadedWorklets = new Set();
    // instanceId -> realized instance, so the host can dispose/enumerate them.
    this._instances = new Map();
    this._instanceSeq = 0;
  }

  register(entry) { return this.registry.register(entry); }

  // Load every worklet a module declares, once each. Paths are relative to the
  // app:// origin root; a leading slash resolves them against the origin
  // regardless of the current document path (same convention as the spike).
  async loadWorklets(descriptorId) {
    const descriptor = this.registry.descriptor(descriptorId);
    const paths = Array.isArray(descriptor.worklets) ? descriptor.worklets : [];
    for (const p of paths) {
      const url = p.startsWith('/') ? p : `/${p}`;
      if (this._loadedWorklets.has(url)) continue;
      await this.ctx.audioWorklet.addModule(url);
      this._loadedWorklets.add(url);
    }
  }

  // Build one live instance of a registered module. Returns { instanceId,
  // instance }. The factory is called with (ctx, services); services carries
  // the descriptor, the registry (for its port-order enumeration), and the
  // real sample rate. The optional explicit instanceId lets a future voice
  // allocator name instances deterministically ("voice0.complexOsc").
  async instantiate(descriptorId, instanceId) {
    const entry = this.registry.entry(descriptorId);
    if (!entry.create) {
      throw new Error(`Module "${descriptorId}" has no factory; cannot instantiate.`);
    }
    await this.loadWorklets(descriptorId);

    const id = instanceId || `${descriptorId}#${this._instanceSeq++}`;
    if (this._instances.has(id)) {
      throw new Error(`Instance id "${id}" already exists.`);
    }
    const services = {
      descriptor: entry.descriptor,
      registry: this.registry,
      sampleRate: this.ctx.sampleRate,
    };
    const instance = entry.create(this.ctx, services);
    this._instances.set(id, instance);
    return { instanceId: id, instance };
  }

  instance(instanceId) { return this._instances.get(instanceId) || null; }

  dispose(instanceId) {
    const inst = this._instances.get(instanceId);
    if (!inst) return;
    try { inst.dispose(); } catch (_e) { /* best effort */ }
    this._instances.delete(instanceId);
  }

  disposeAll() {
    for (const id of [...this._instances.keys()]) this.dispose(id);
  }
}
