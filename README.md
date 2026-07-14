# wCoast

wCoast is a modular synthesizer for Web Audio. Building on Web Audio makes it
cross-platform: it plays in most browsers, and a desktop app will be available.
It's non-commercial, free and will be open source when it's more complete.

It's a personal project with these main objectives:

- To provide a general-purpose, open-architecture modular synthesizer platform for
  Web Audio.
- To explore user-interface ideas to make a modular synth more flexible, easier to use, and patches easier to explore and understand.
- To create a modular synth I, and hopefully you, will enjoy using. YMMV… 😌

wCoast recreates the feel of a hardware modular synthesizer: you place modules on
a rack, wire their jacks with virtual cables on easy-to-read panels, turn the
knobs, and listen. The modules available initially are a West Coast-style complex
oscillator, a quad low-pass gate, a quad function generator and a mixer. The name
wCoast comes from my interest in West Coast synthesis (Buchla/Serge-style), but
nothing in its architecture limits it in any way.

The open architecture is structural: each module is just a folder holding a
descriptor and its DSP, and the host works entirely from that descriptor —
building the panel, handling patching, saving, and more, pure JavaScript (and a bit of SVG) —
without reaching inside the core. That lets new modules of any kind, with or
without a hardware ancestor, drop in as plug-ins — potentially, if there is
interest, modules contributed by others.

Toward the second objective, wCoast tries a number of interface ideas:

- **Patching with confidence.** Right-click a jack or a panel to open an *active
  context menu* — a menu whose items act the moment you rest on one, so you can try
  before you commit. Stop on Engine and the sound starts for as long as you hover.
  Cables are pulled in place: a left-click on a jack starts one.
- **Exploring signals in place.** From that same menu, stop on Scope and a live
  oscilloscope appears beside the pointer; stop on Monitor and you hear that terminal.
  Click to keep the result — a scope or monitor then follows the pointer to wherever
  you drop it — or move off to dismiss it. Scopes and monitors clip on to any
  terminal without rewiring.
- **Signals automatically colour-coded by destination terminal type/colour**
  (audio, control voltage, trigger/gate), with the ability to highlight everything
  upstream of a terminal — so you can read a patch at a glance.
- **Visually distinct input and output terminals**, so a terminal's direction is
  instantly recognizable.
- **Gentle animation showing signal direction on cables**, so flow is easy to
  follow.
- **Compact panels** that keep a lot of the instrument in view and behave
  consistently from module to module.

## Current state

wCoast is in alpha. It is fully usable, but expect rough edges and things to
change.

A pretty complete modular instrument you can patch and play:

- A **rack** you place modules on, with both light and dark mode faceplates.
- **Save and load** whole patches.
- **Modules so far:** Complex Oscillator (feature-complete), Low Pass Gate,
  Function Generator, and a Mixer — plus a "gallery" module used to exercise every
  control and jack type.

Still ahead: more modules (a random and fluctuating voltage source is designed),
polyphony (it's currently one voice), and a bridge that lets any Web Audio
companion app drive it over a local message link. These are designed but not yet
built.

Feedback is welcome — share thoughts, bugs, and ideas in the
[discussions](https://github.com/chrisgr99/wCoast/discussions).

## Running it

wCoast runs in your web browser — there's nothing to download or install.
Open the GitHub Pages build at
[chrisgr99.github.io/wCoast](https://chrisgr99.github.io/wCoast/) and follow the
getting-started instructions that appear on first run.

## Browser support

wCoast works in most browsers — Chrome, Edge, Firefox, or Safari. Saving and
loading patches as files on your computer relies on the browser's File System Access
feature, which today is available only in Chrome and Edge, so use one of those if you
want to keep your patches. Everything else works the same in every browser; you just
can't save to disk yet in Firefox or Safari.

**Important — disable page-recolouring extensions.** If you use a browser add-on that
changes how pages look — Dark Reader, or any dark-mode or colour-adjusting extension —
turn it off for wCoast. The app has its own light and dark modes, and these extensions
distort the panel graphics and lettering. If the panels ever look wrong, an extension
like this is the most likely cause.
