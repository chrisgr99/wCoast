# LibreSynth control protocol — Design

How an external sequencer or composition engine plays LibreSynth: a small,
sender-agnostic message protocol that arrives at a **rack module** and comes out
as **voltages on jacks** — pitch, gate, and modulation — which you patch like any
other cable. GXW is the first client; Strudel and a MIDI translator are co-clients
of the same front door. This is the detailed protocol behind DESIGN.md §9 (the
bridge transport) and leans on §7 (the voice allocator) and `ai-mirror.md` (the
catalogue, for discovery).

The guiding stance: **control enters the synth the way a cable does.** The module
turns messages into pitch/gate/CV; nothing reaches into a module's internals. That
keeps the whole thing modular and keeps the sender decoupled from the patch.

## Two ends

- **Receiver — a module in the rack.** The *Control Interface* module owns the
  listener, the voice allocator (§7), and the active-voice table. Its outputs are
  jacks: per voice-group a **pitch** out (control-domain, 1V/oct — the green jack
  family) and a **gate** out (trigger), a **level/velocity** out (control), a bank
  of general **modulation** outs (control), and a **clock** out (trigger) the
  sender can drive for transport sync. It has **no audio output** — OSC conveys
  control, not audio; sound is made by whatever you patch these into.
- **Sender — not a module.** It lives in the controlling app: in GXW a mapping UI
  (below); in Strudel its pattern controls emitted as these messages; a thin MIDI
  translator is a third option. All three speak the identical protocol, so the
  synth never knows or cares which is driving it.

## Transport

- **OSC-shaped messages** — an address, typed args, and a time tag — over a local
  link. A browser Strudel can't open UDP, so the canonical carrier is a
  **WebSocket** the Electron **main process** receives; native OSC-over-UDP is
  accepted by the same listener. So LibreSynth stands in for the SuperCollider/SuperDirt
  target that Strudel already knows how to drive. Plain JSON `{address, args,
  timestamp}` over the same socket is an equivalent carrier — OSC is a tidy
  convention, not a speed requirement (§9).
- **Scheduled, not played on arrival.** Each event is sent a small lookahead early
  with an intended timestamp on the shared clock; the receiver places it at that
  sample. This decouples rhythmic resolution from transport jitter (§9).
- **The medium is lossy.** Especially over UDP, packets can be dropped, duplicated,
  or reordered. The note model and receiver rules below are built to stay correct
  under all three — this is not an edge case, it is the normal condition.

## The note model — handle + mandatory duration

Unlike SuperDirt's fire-and-forget events, every note carries two things that make
early release and loss-tolerance possible:

- **A handle** — a unique token **minted by the sender**, naming this specific
  sounding note so a later message can refer to it. Recommended form: a short
  random **session prefix** plus a **monotonic counter** (e.g. `s7:1042`).
  Collision-free within a sender (a counter never repeats), namespaced across
  senders (distinct prefixes), and human-readable when debugging — a stronger and
  shorter guarantee than a random GUID.
- **A required duration** — the note's natural length **and** a dropped-message
  failsafe. The receiver schedules an automatic release at start + duration, so a
  note **always** ends on its own even if its off is never delivered. There are no
  truly infinite notes; a drone is just a generous cap. This one rule turns a lost
  off from a stuck voice into a self-healing situation.

## Messages

- **note-on** — `handle`, `channel`, `pitch`, `level`, `duration`, `time`, and
  optional named controls. Allocates a voice, schedules the auto-release.
- **note-off** — `handle`, `time`, optional `release` override. Releases the named
  voice early and **cancels** its pending auto-release. Whichever of {explicit off,
  duration timeout} comes first wins.
- **all-notes-off** — optional `channel`, `time`. Panic / phrase reset; releases
  every voice (or every voice on a channel).
- **control-set** — `target`, `value`, `time`. Continuous modulation not tied to a
  note: `target` is a modulation-out lane on the module, or (via the catalogue) a
  named module parameter for direct automation. The patchable lanes are the
  idiomatic default; direct-param addressing is there for automation lanes.
- **note-modify** *(future)* — `handle`, plus `pitch` or a control value: per-note
  expression (glide, move a CV after attack) — MPE-style. The handle model already
  enables it; not built now.

## Field semantics

- **pitch** — a note number (semitones, middle-C-relative, or MIDI) or a direct
  frequency; the module maps it to a 1V/oct pitch CV. Microtonal via fractional
  note numbers or direct frequency.
- **level** — 0..1, to a velocity/level CV lane.
- **channel** — an integer selecting which voice-group / output set the note plays
  on, so several parts or patterns can drive independent voices.
- **duration** / **time** / **release** — seconds on the shared scheduling clock.
- **named controls** — optional; mapped to the module's modulation lanes, or by the
  catalogue to named parameters. The sender's mapping decides what each means.

## Receiver semantics (loss-tolerant)

The module keeps an **active-voice table keyed by handle**, and:

- a **note-on for a handle already active** is **ignored** (dedupes a duplicated
  packet; it does **not** retrigger);
- a **note-off for an unknown or already-released handle** is a **no-op** (covers a
  lost note-on and a late-arriving off);
- an **explicit off cancels** the scheduled auto-release so the timeout can't fire
  redundantly;
- **release = drop the voice's gate**, which enters the envelope's release stage —
  a forced-off note fades out per the patch, it doesn't click; steal-oldest with a
  fast release when the pool overflows (§7);
- **everything is placed by its timestamp**, not by arrival order.

## Voice allocation

The allocator is the seam (§7): the sender fires abstract note-ons and note-offs by
handle; the allocator maps them onto physical voices, applies the polyphony count,
and steals the oldest voice when the pool overflows (a normal condition for a
generative sender, not an exception). The sender never addresses a physical voice —
only handles and channels.

## The sending end — mapping UI

Discovery is free: the mirror's `catalogue.json` (`ai-mirror.md`) enumerates every
module, port, and parameter with its range and curve, so a sender knows the
available targets and how to scale into them.

- **GXW** — a routing matrix: its sources (each part's pitch/gate/level, its
  modulation sources, macros) down one side; the module's channels and control
  lanes across the top, read live from the catalogue so the grid tracks the real
  patch. Assign a source to a lane per cell; each connection carries a range
  mapping into the target's real units; a learn mode binds by wiggling a source and
  arming a lane. Sender duties: mint handles, always include a duration, send offs
  (best-effort — the failsafe covers loss), stamp events with a lookahead, and be
  the tempo master (optionally emit the clock).
- **Strudel** — its pattern controls (note, gain, pan, cutoff, …) emitted as these
  messages; because it already speaks the SuperDirt play format, pointing it at
  LibreSynth is largely repointing its output. A superdough-shaped adapter maps its
  control names to the protocol's fields. Strudel is the tempo master when it drives.
- **MIDI** — a thin translator: note-on/off to protocol note-on/off (synthesising a
  handle per key, a generous duration as the failsafe), CC to control-set.

## Non-goals

- **No audio over the protocol** — it carries control only; audio is synthesised by
  the patched modules.
- **No shared audio graph** — sender and synth run separate contexts and talk only
  over this transport (§9).

## Status

Designed, not built — consistent with the deferred bridge (§7, §9). The receiving
module is the concrete build unit when this is picked up; the sending end is built
inside whichever controlling app drives it.
