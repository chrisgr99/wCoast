# wCoast

wCoast is a modular synthesizer for Web Audio. Building on Web Audio makes it
cross-platform: it plays in any modern browser, and a native desktop application
will be available as well. It's non-commercial, free to use.

This is a personal project with two main objectives:

- To provide a general-purpose, open-architecture modular synthesizer platform for
  Web Audio.
- To explore user-interface techniques to make a modular synthesizer easier to
  work with, and patches easier to explore and understand.

wCoast recreates the feel of a hardware modular synthesizer: you place modules on
a rack, wire their jacks with virtual cables on easy-to-read panels, turn the
knobs, and listen. The modules available initially are West Coast — complex
oscillators, low-pass gates, function generators and the like. The name wCoast
comes from the project's initial focus on West Coast (Buchla/Serge-style)
synthesis, but it has since grown to support modules of any style equally.

The open architecture is structural: each module is just a folder holding a
descriptor and its DSP, and the host works entirely from that descriptor —
building the panel, handling patching, saving, and more (pure JavaScript) —
without reaching inside the module. That lets new modules of any kind, with or
without a hardware ancestor, drop in as plug-ins.

Toward the second objective, wCoast tries a number of interface ideas for making
patches easier to build, follow, and understand:

- **Patching by identity, not cord-tracing.** Right-click a jack or a panel to open
  an *active context menu* — a menu whose items act the moment you rest on one, so
  you can try before you commit. Stop on Scope and a live oscilloscope appears beside
  the pointer; stop on Listen and you hear that terminal; stop on Engine and the sound
  starts for as long as you hover. Click to keep the result — a scope or monitor then
  follows the pointer to wherever you drop it — or move off to dismiss it. Cables are
  pulled in place: a left-click on a jack starts one.
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

wCoast is in alpha. It is fully usable, but expect rough edges and things to
change.

A working modular environment you can patch and play:

- A **rack** you place modules on, with faithful light/dark faceplates.
- **Save and load** whole patches.
- **Modules so far:** Complex Oscillator (feature-complete), Low Pass Gate,
  Function Generator, and a Mixer — plus a "gallery" module used to exercise every
  control and jack type.

Still ahead: more modules (a random and fluctuating voltage source is designed),
polyphony (it's currently one voice), and a bridge that lets any Web Audio
companion app drive it over a local message link. These are designed but not yet
built.

Feedback is very welcome — share thoughts, bugs, and ideas in the
[discussions](https://github.com/chrisgr99/wCoast/discussions).

## Running it

wCoast runs entirely in your web browser — there's nothing to download or install.
Open the GitHub Pages build at
[chrisgr99.github.io/wCoast](https://chrisgr99.github.io/wCoast/) and follow the
getting-started instructions that appear on first run.

## Browser support

wCoast works in any modern browser — Chrome, Edge, Firefox, or Safari. Saving and
loading patches as files on your computer relies on the browser's File System Access
feature, which today is available only in Chrome and Edge, so use one of those if you
want to keep your patches. Everything else works the same in every browser; you just
can't save to disk yet in Firefox or Safari.

**Important — disable page-recolouring extensions.** If you use a browser add-on that
changes how pages look — Dark Reader, or any dark-mode or colour-adjusting extension —
turn it off for wCoast. The app has its own light and dark modes, and these extensions
distort the panel graphics and lettering. If the panels ever look wrong, an extension
like this is the most likely cause.
