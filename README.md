# LibreModular

LibreModular is a modular synthesizer that runs in a web browser, built on Web Audio. You place modules on a rack, wire their jacks with virtual cables, turn the knobs, and listen — the feel of a hardware modular, with a few things a screen can do that hardware can't. It's a personal project: non-commercial, free, open source once it's a little further along, and — I hope — something you'll enjoy using as much as I do. Your mileage may vary. 😌

Two ideas drive it. The first is the interface — making a modular easier to read, explore, and understand — which is where most of the effort below has gone. The second is an open architecture: each module is just a folder holding a descriptor and its DSP, and the host builds the panel and handles patching, saving, and the rest from that descriptor alone — pure JavaScript (and a bit of SVG), without reaching into the core. New modules of any kind, with or without a hardware ancestor, drop in as plug-ins; in time, if there's interest, so could modules contributed by others.

The modules that ship today are a West Coast-style complex oscillator, a quad low-pass gate, a quad function generator, and a mixer — reflecting my interest in West Coast synthesis (Buchla and Serge style) — but nothing in the architecture ties LibreModular to that: it's an open platform meant for modules of any kind. The name says as much: *Libre* for free and open, *Modular* for what it is — LibreMod for short.

## What makes it different

**Cables and terminals you can read at a glance.**

- A cable takes its colour from the terminal it plugs into, not the one it comes from — so a cable shows its job. Run an audio output into a trigger input and the cable is a trigger cable, because that's how the signal is being used.
- Input and output terminals in a family share a colour but are drawn differently, so a terminal's direction is always clear.
- A slow dashed pattern crawls along each cable in the direction the signal flows.
- Cables stay out of the way: drawn semi-transparent, brightening only when relevant, and fading to let a click pass straight through to any control they cover. Drag a cable's middle to reshape its path.

**Watching, hearing, and driving any point — without rewiring.**

- Clip a full oscilloscope onto any terminal. It floats above the panels, takes no rack space, and needs no extra cable. Freeze the trace to study its shape, and read its frequency or its minimum, mean, and maximum level. Add as many as you like.
- Clip an audio monitor onto any terminal the same way to listen at that point in the chain. Monitors feed their own bus on the mixer, so you can balance them against the main output.
- Or just peek: right-click a terminal for a menu whose items act the moment you rest on one. Rest on Scope or Monitor and it shows or plays only while you hover, then vanishes when you leave — or click to drop it in place and keep it. (Rest on Engine and the whole patch sounds for as long as you hover.)
- Planned, as the input-side counterpart: floating signal sources you clip to a terminal the same way — a control-voltage knob, a push button, or a toggle — to drive a control from off-panel without a module or any rack space; and signal injectors that feed a test sine or square wave into any terminal for probing a patch.

**Focusing on one part of a patch.**

- Hovering a module lights up the cables feeding it and the cables it feeds, so you can see what a change here will touch.
- Right-click a terminal to isolate its subnet — just the cables, modules, and controls that shape the signal arriving there — so you can work on one branch of a large patch at a time. Each terminal then pulses gently in time and size with the signal passing through it.

Patching itself stays direct, and you never hold the mouse button down: left-click a terminal and the cable comes with you — hands free, so you can scroll, zoom and roam to find the far end — then left-click where it lands. (Right-click or Escape drops it.) You can also chain input terminals to share one incoming signal — a mult, like a hardware multiple — so a source can feed several inputs without a cable running back to it each time, which keeps the patch tidier. The panels are compact and consistent, keeping a lot of the instrument in view and behaving the same from module to module, in matching light and dark faceplates.

## Current state

LibreModular is in alpha — fully usable, but expect rough edges and things to change. What works today:

- A **rack** you place modules on, and **save and load** for whole patches.
- **Modules:** Complex Oscillator, Quad Low Pass Gate, Quad Function Generator, and a Mixer — plus a "gallery" module used to exercise every control and jack type.

Still ahead, designed but not yet built: the floating signal sources and injectors above, polyphony (it's one voice today), and an interface module that conforms to the Web Audio Modules (WAM) plugin standard, so other in-browser audio hosts and sequencers can drive LibreModular and embed it as a sound source. Many other modules are planned; suggestions are welcome.

Share thoughts, bugs, and ideas in the [discussions](https://github.com/chrisgr99/LibreModular/discussions).

## Running it

There's nothing to download or install. Open the GitHub Pages build at [chrisgr99.github.io/LibreModular](https://chrisgr99.github.io/LibreModular/) and follow the getting-started notes that appear on first run. A cross-platform desktop version, built on Electron, is coming in the near future.

It works in most browsers — Chrome, Edge, Firefox, or Safari. Saving and loading patches as files relies on the browser's File System Access feature, which today is only in Chrome and Edge, so use one of those if you want to keep your patches; everything else works the same everywhere.

**One caveat — turn off page-recolouring extensions.** If you use an add-on that changes how pages look (Dark Reader, or any dark-mode or colour-adjusting extension), disable it for LibreModular. The app has its own light and dark modes, and these extensions distort the panels and lettering — the most likely culprit if anything ever looks wrong.
