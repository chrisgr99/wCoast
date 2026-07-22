# DreamRack

DreamRack is a modular synthesizer that runs in a web browser, built on Web Audio. You place modules on a rack, wire their jacks with virtual cables, turn the knobs, and listen — the feel of a hardware modular, with a few things a screen can do that hardware can't.

More than that, it's an exploration. It began as an attempt to build the modular I've always wished I could patch on, and to try out ideas for making one easier to use and more powerful. It's a personal project: free, with source code available on GitHub, for non-commercial use with attribution, and shared in the hope that others enjoy it as much as I do. Your mileage may vary. 😌

## My goals — the dream list

- **A consistent design language across every module**, so knowledge carries from one to the next — input/output terminals colour-coded by signal type (a hint, not a restriction), inputs and outputs told apart instantly, panels compact and consistent in light and dark. *(done)*
- **Interaction kept drag-free** — a click, on a mouse or trackpad, is easier on the wrist than a drag, so controls turn with the scroll wheel and patching is click to grab, click to drop, with nothing held down. *(done)*
- **See what affects what** — what feeds a module, what it feeds, and the whole chain shaping any one point. *(done)*
- **See at a glance what every cable is doing** — where it runs from and to, and the role it plays at the end it plugs into. *(done)*
- **Hear the signal at any terminal** effortlessly, without rewiring. *(done)*
- **See the signal at any terminal** just as easily — scopes you clip on and take off, as many as you want at once, and can pull up beside any knob that affects that terminal to watch the trace as you turn it — full featured dual trace, triggered, sampling scopes. *(partly TBD — dual trace still to come)*
- **Know the numbers at any terminal** effortlessly — its frequency in cycles per second, the maximum and minimum level of the signal, and its DC offset. *(done)*
- **Inject a signal into any jack** without disturbing the patch cables — a button to fire a trigger, a toggle to hold a gate, or a simple sine or square wave — to drive or probe any input from outside the patch. *(TBD)*
- **Take input from outside** — an interface module that receives events from Web Audio sequencers and hosts and converts them into DreamRack signals to play. *(TBD)*
- **Play it polyphonically** — more than one voice at a time, not the single voice it is today. *(TBD)*
- **Let any developer create new modules, and anyone snap them into their rack** — each a self-contained folder of plain JavaScript that drops in without altering the core framework and without a build step or separate development tools; see the [module-authoring reference](MODULE-AUTHORING.md). *(done)*
- **Explore how AI might help understand and create patches** — describing what a patch does, suggesting changes, or building one from a request. *(partly TBD)*

## Current state

DreamRack is in alpha — fully usable, but expect rough edges and things to change. Each goal above is tagged with where it stands: *(done)*, *(partly TBD)*, or *(TBD — to be done)*. Even the parts marked done may still change as I work on perfecting the design and receive feedback from users.

The modules that ship today are a Complex Oscillator, a Quad Low Pass Gate, a Quad Function Generator, and a Mixer. Many more modules are planned; suggestions are welcome.

## Background

The modules that ship today lean West Coast — Buchla- and Serge-flavoured — which is where my own interest lies and where the earliest work went. But nothing in the architecture ties DreamRack to that style: modules of any kind drop in as plug-ins, with or without a hardware ancestor.

Share thoughts, bugs, and ideas in the [discussions](https://github.com/chrisgr99/DreamRack/discussions).

## Running it

There's nothing to download or install. Open the GitHub Pages build at [chrisgr99.github.io/DreamRack](https://chrisgr99.github.io/DreamRack/) and follow the getting-started notes that appear on first run.

A desktop version, built on Electron, is fully running now. A packaged, one-click download will follow once the app settles a little — code-signing and notarizing it (so that macOS opens it without a security warning) is worth doing when the build is less subject to change. Until then you can run the desktop app yourself: with [Node.js](https://nodejs.org/) installed, clone the project from GitHub, open its folder in Terminal, and run `npm start`. A Windows or Linux desktop build is possible too — Electron is cross-platform — but for now the easiest way to run DreamRack on those systems is in the browser.

It works in most browsers — Chrome, Edge, Firefox, or Safari. Saving and loading patches as files relies on the browser's File System Access feature, which today is only in Chrome and Edge, so use one of those if you want to keep your patches; everything else works the same everywhere.

**One caveat — turn off page-recolouring extensions.** If you use an add-on that changes how pages look (Dark Reader, or any dark-mode or colour-adjusting extension), disable it for DreamRack. The app has its own light and dark modes, and these extensions distort the panels and lettering — the most likely culprit if anything ever looks wrong.
