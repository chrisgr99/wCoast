# Wcoast

Wcoast is a modular synthesizer for Web Audio. Building on Web Audio makes it
cross-platform: it plays in any modern browser, and a native desktop application
will be available as well. It's non-commercial, free to use.

This is a personal project with two main objectives:

- To provide a general-purpose, open-architecture modular synthesizer platform for
  Web Audio.
- To explore user-interface techniques to make a modular synthesizer easier to
  work with, and patches easier to explore and understand.

Wcoast recreates the feel of a hardware modular synthesizer: you place modules on
a rack, wire their jacks with virtual cables on easy-to-read panels, turn the
knobs, and listen. The modules available initially are West Coast — complex
oscillators, low-pass gates, function generators and the like. The name Wcoast
comes from the project's initial focus on West Coast (Buchla/Serge inspired)
synthesis, but it has since grown to support modules of any style equally.

The open architecture is structural: each module is just a folder holding a
descriptor and its DSP, and the host works entirely from that descriptor —
building the panel, handling patching, saving, and more (pure JavaScript) —
without reaching inside the module. That lets new modules of any kind, with or
without a hardware ancestor, drop in as plug-ins.

Toward the second objective, Wcoast tries a number of interface ideas for making
patches easier to build, follow, and understand:

- **Patching by identity, not cord-tracing.** Click to open a radial "pie" menu
  right on a faceplate or jack to pull a new cable, inspect a connection, or drop
  a probe — the work happens in place, so you never struggle to trace the source
  or destination of a cable across the screen.
- **Signals automatically colour-coded by destination terminal type/colour**
  (audio, control voltage, trigger/gate), with the ability to highlight everything
  upstream of a terminal — so you can read a patch at a glance.
- **Clear visual distinction between input and output terminals**, so a terminal's
  direction is always obvious.
- **Gentle animation showing signal direction on every cable**, so flow is visible
  at a glance.
- **Clip-on scopes and ear-monitors** you attach to any terminal to see or hear
  what a signal is doing, without rewiring.
- **Compact panels** that keep a lot of the instrument in view and behave
  consistently from module to module.

## Current state

A working modular environment you can patch and play:

- A **rack** you place modules on, with faithful light/dark faceplates.
- **Save and load** whole patches.
- **Modules so far:** Complex Oscillator (259, feature-complete), Low Pass Gate
  (292), Function Generator (281), and a Mixer — plus a "gallery" module used to
  exercise every control and jack type.

Still ahead: more modules (a Source of Uncertainty is designed), polyphony (it's
currently one voice), and a bridge that lets any Web Audio companion app drive it
over a local message link. These are designed but not yet built.

## Running it

For the native macOS build, run `npm install` and then `npm start` (requires Node
— Homebrew Node at `/opt/homebrew/bin`).

In a browser, it also runs at its GitHub Pages build,
[chrisgr99.github.io/wCoast](https://chrisgr99.github.io/wCoast/) — open the page
and click to start (Chrome or Edge recommended for saving patches).
