# wCoast — Interactive tutorial

<!--
This file is BOTH the document you are reading and the exact copy the app shows in its tutorial cards. Editing it here changes the tutorial; there is no build step.

Format (parsed by host/tutorial-md.js):
  ## Heading         starts a card; the heading becomes the card's title
  paragraph          a paragraph — write it on ONE line, the card wraps it
  - item             consecutive items become one bulleted list
  > **Do this** — …  a "Do this" block; the bold text is its label

Inline: **bold**, *italic*, [text](url), `code`. Text above the first ## is preamble for a human reader and never reaches the app.

House style: the reader has probably used a software modular before, and they all differ in interface and terminology — so the job is to map, not to teach. One card per heading, each a complete covering of it. No sales pitch; they've read the README.
-->

This is the tutorial wCoast shows in its floating cards, on a first run and from Help ▸ Interactive tutorial. It's written for someone who has used a software modular before, so rather than teaching synthesis it maps what you already know onto this one — and points out where wCoast differs.

## Before you start

**Before you start,** please turn off any browser extension that recolours pages — Dark Reader and the like — for this site. wCoast has its own light and dark modes, and those extensions distort its panels.

**These cards:** each explains one part of the instrument, then asks you to do something. A card stays open while you work, so you never have to dismiss it to follow it — park it anywhere by its title bar, and resize it like any other window. Marked blocks are your cue to act, like this one:

> **Do this** — Read the [README](https://github.com/chrisgr99/wCoast/blob/main/README.md) if you haven't — it covers what wCoast is, and what it isn't, which this tutorial won't repeat.

**Coming up:**

- [**Basic interaction**](#basic-interaction) — panels, menus, and the controls
- [**First sound**](#first-sound) — the shortest path to hearing something
- [**Building a patch**](#building-a-patch) — adding modules, and how cables behave here
- [**Getting around**](#getting-around) — panning and zooming a rack bigger than the window
- [**Watching and hearing**](#watching-and-hearing) — scopes and monitors on any terminal
- [**Following the signal**](#following-the-signal) — seeing what feeds what
- [**Keeping your work**](#keeping-your-work) — saving, loading, and what carries over

Coming next: **Basic interaction**.

## Basic interaction

**Panels:** a module's faceplate — the background behind its knobs and jacks. Its name runs vertically up the left edge, to save vertical space.

**Focus:** as you move around, the rack follows your pointer — whatever you're over brightens and everything else dims back. It's not decoration; it's how wCoast helps you read a patch. Hover a module and it stands out; on a multi-part module like a quad, hover just one band and only that band lights. Once things are wired, hovering lights the whole chain the signal runs through — every module from source to output — so the structure shows itself instead of hiding among equally bright cables and panels.

> **Do this** — Move your pointer over the "Complex Oscillator" (the top-left module) without clicking, and watch the whole module brighten while the rest dims. Now move to a single band of the "Quad Low Pass Gate" — just that band lights.

**Commands:** right-click a panel — or click the hamburger in the top corner — for the main menu: Engine, File, Edit, View and Help.

> **Do this** — Right-click a panel, go to View, and set light or dark to your taste. Everything re-skins, including this card, and your choice sticks between sessions.

**Terminals:** right-click one and the menu offers what you can do with that signal — watch it on a scope, listen to it, or trace where it goes.

> **Do this** — On the "Complex Oscillator", right-click the **Final** output (under Principal Osc Outputs) and rest the pointer on **Monitor** to hear the signal there, then slide onto **Scope** to see its shape. No clicking — each lasts only while your pointer is on it (you could click to keep it).

**Colour code:** terminals read at a glance. Colour is the signal family — **audio** yellow, **control voltage** orange, **gates and triggers** blue. Shape is direction: a dashed ring hugs a terminal's outer edge on an **output**, and surrounds the centre hole on an **input**.

**Controls:** knobs may work differently from other modulars you've used — they **don't drag**. Hover a knob and scroll. Full rate at the centre, a quarter of it at the rim, so the same gesture gives you coarse or fine without a modifier. Faders take either: drag them, or scroll them like a knob. Double-click any knob to reset it.

> **Do this** — Hover a knob and scroll it, then move to its rim and scroll again — the same gesture, four times finer.

**Moving around:** if scrolling turns knobs, how do you get around a big rack? Hold Option (Alt on Windows), then move the pointer to slide the view and roll the wheel to zoom. More on this in the **Getting around** section, covered later.

Coming next: **First sound**.

## First sound

**Cables:** left-click a terminal and the cable follows the pointer — no button held. (Almost everything in wCoast works without a held button — gentler on the hand than dragging.) Left-click another terminal to connect it, or left-click anywhere else to drop it. A cable takes the colour of the input it plugs into, so you can read its job at a glance.

> **Do this** — Left-click the **"Complex Oscillator"** Final output (near the centre top of the module), move to **channel A** of the **"Mixer"** (bottom-left, top row of inputs), and click to connect. The cable is yellow — its destination is an audio terminal.

**Unplug or move a cable:** to remove or re-route a cable, left-click the terminal it's plugged into — the cable lifts off and follows the pointer again, just as if you'd started it there. Left-click another terminal to plug it in instead, or left-click empty space to remove it. Press Escape while carrying to cancel and leave the cable where it was. If more than one cable meets at that terminal, pull away in the direction of the one you want — the cable whose path matches your drag is the one that lifts off.

> **Do this** — Left-click the **"Mixer"** channel A input where your cable lands: it lifts off and follows the pointer. Left-click channel A again to plug it back in, and leave it connected there for what follows. (To remove a cable for good, you'd drop it on empty space instead.)

**Sound:** nothing plays until the sound engine is on.

> **Do this** — Right-click a panel to open the menu and hover over **Engine** — the oscillator sounds while your pointer rests there. Pull away from the menu and it stops. Reopen the menu and click **Engine** to leave it running. Then set a comfortable volume with the mixer's **Master** fader (drag it, or scroll it) — the first sound can come out louder or quieter than you'd like.

**The chain:** with the oscillator now wired to the mixer, the two are one signal chain — and hovering lights a whole chain at once, so you can see what feeds what, which controls affect the signal you're on, and what they in turn affect.

> **Do this** — Hover another mixer channel (B, say): the **"Complex Oscillator"** is dimmed, not part of that chain. Come back to channel A and it lights with the **"Complex Oscillator"** and the controls that shape what reaches it. Now hover the **"Complex Oscillator"** itself — channel A lights up downstream, showing that the **oscillator's** controls will affect that mixer channel.

Here it's trivial — one oscillator into one channel — but in a rack full of wired modules, seeing at a glance what affects what, and what is affected by what, lightens your mental load and heightens your understanding of the patch.

**Pitch:** the big **Pitch** knob (centre, under Principal Osc) sets the frequency of the sound you're hearing.

> **Do this** — Hold the pointer over the **Pitch** knob and scroll (scroll wheel, or two fingers on a trackpad) to hear the pitch rise and fall. Try it near the knob's centre, then out at its rim — the centre changes it fast, the rim slow and fine.

**Modulate:** the **"Complex Oscillator"** holds two oscillators — the principal one you're hearing, and a *modulation* oscillator (left) that can drive it. Between them sits the modulation section: three **push buttons** (Ampl Mod, Pitch Mod, Timbre Mod) that pick how it drives, and a **Mod Index** knob for depth.

> **Do this** — On the **"Complex Oscillator"**, press the **Pitch Mod** push button (it lights), then scroll **Mod Index** either way off its centre, to a non-zero modulation depth. Explore the sound possibilities by changing three things: the modulation oscillator's **Frequency** (left), the principal **Pitch**, and the **Mod Index** depth.

**More variations:** the shape section on the right — **Timbre**, **Order**, **Symmetry** — folds the waveform.

> **Do this** — With **Mod Index** still turned up and at least one modulation push button on, scroll **Timbre**, then **Order** and **Symmetry**, and listen to the harmonics shift. Then combine everything — the principal **Pitch**, the modulation oscillator's **Frequency**, **Mod Index**, the different modulation buttons, and the shape knobs — to hear the wide range of possible sounds.

Coming next: **Building a patch**.
## Building a patch

**Your modules:** you already have a useful set of four — the "Complex Oscillator", "Quad Function Generator", "Quad Low Pass Gate", and "Mixer" — enough to build real patches. Adding and removing modules comes later; for now, build with these. (The sound engine should still be running from **First sound**; if it's off, turn it on from the menu's **Engine** item.)

> **Do this** — This section works mostly with the "Quad Low Pass Gate", the module at the lower right. If this card covers it, pull its bottom edge up until the whole module is visible.

**Create a pluck or percussive sound:** a plucked sound is a brief pulse of sound, made by passing a signal through a gate that opens and closes quickly — which is how a low pass gate works. To give it something to gate, send a signal from the oscillator into the gate's input.

> **Do this** — Cable the "Complex Oscillator" **Square** output to the "Quad Low Pass Gate" **channel A** input (its **IN** jack), then the gate's **channel A** output (**OUT**) to the "Mixer" **channel B**. Nothing yet — the gate stays shut until it's struck.

**Play it:** the **Strike** button opens the gate for an instant — the sound bursts through, then decays. **Decay** sets how long the tail rings.

> **Do this** — Press **Strike** on channel A for a pluck, and press it again for another. Turn **Decay** up for a longer tail, down for a short blip.

**Clock it:** instead of striking by hand, let the gate's own clock strike it — steadily, over and over.

> **Do this** — Turn on channel A's **Clock** button (CLK on), then the master **Run** at the bottom of the module — the pluck now repeats in time. Turn **Rate** to speed it up or slow it down. Set channel A's **clock ratio** dial, and its **÷ / ×** mode, to pulse at divisions or multiples of the master rate — all locked in sync.

**Adjust the levels:** both voices run into the mixer now — the oscillator drone on channel A, the gated plucks on channel B. Balance them here.

> **Do this** — Drag the **channel A** and **channel B** faders to set each voice's level against the other. Then use the **Enable** buttons below the faders to switch a voice on or off.

**Explore:** mute the drone on channel A and leave the plucks on channel B, so you hear the rhythm on its own — then shape it with everything you've already met. The "Complex Oscillator" knobs colour the tone; the gate's **Level** and **Decay** set how hard and how long each pluck sounds.

> **Do this** — If channel A's **Enable** button on the mixer is illuminated, press it so it is not — that mutes the drone. Now explore: on the "Complex Oscillator" work the **Pitch**, **Timbre**, **Order**, **Symmetry**, **Mod Index** and the modulation buttons; on the gate, channel A's **Level** and **Decay**. Have fun — there's a wide range of sounds in here.

> **Bonus** — Add a second voice: cable the "Complex Oscillator" **Sine** output to the gate's **channel B** input, and the gate's **channel B** output to the "Mixer" **channel C**. Turn on channel B's **Clock**, and set its **clock ratio** to a different value than channel A's — the two plucks cross in and out of step, building a shifting rhythm.

Coming next: **Getting around**.

## Getting around

**Your rack:** the *rack* is the surface your modules sit on; a *module* is a single panel — the "Complex Oscillator", the "Mixer", and so on. Your four fit the window at once for now, but the moment you zoom in for a closer look — or add more modules later — the rack reaches past what the window can show, and you'll want to move around it and magnify parts of it. That's what this section covers. (Reshaping the rack itself — its rows, and adding or removing modules — will be covered later.)

**The Option key:** one key handles both moving and magnifying: **Option** (Alt on Windows). Hold it and the rack switches to a navigate mode: move the pointer to slide the view, and roll the wheel to zoom in and out on wherever the pointer is. The cursor becomes a four-way arrow while you navigate; let go and you're back to normal, ready to turn a knob or pull a cable.

> **Do this** — Hold **Option** and roll the wheel to zoom in on a module. Release Option — now you're looking at just a section of the rack. Press **Option** again and move the pointer to slide the view to a different part. Release Option, and you're there. Notice how effortlessly you can bring any part of your rack into view, as large or as small as you like. Mix zooming and moving freely, and practice until it feels comfortable.

**Cabling across the rack:** you may want to run a cable to a module that isn't currently in view. You can navigate to it with the cable already in hand — the same Option-key moving and zooming works while you carry a cable, and the cable stays attached the whole time.

> **Do this** — Hold **Option** and zoom in until only part of the rack shows. Click an **output** terminal to pick up a cable, then hold **Option** again and move and zoom until the module you want comes into view — the cable trails from your pointer all the way. Release **Option** and the cable is still in hand; click a terminal on that module to drop it, the usual way.

**Zooming in on a scope:** one way to see a scope more clearly is to enlarge the scope itself by dragging its borders. But when you'd rather get a closer look without resizing the object, zooming does it — magnify the view over a scope and it grows on screen along with everything around it, then zoom back out when you're done.

> **Do this** — If you don't already have a scope in your rack, attach one to an output that's producing sound — the "Complex Oscillator" **Final** output, say. Hover over the scope, hold **Option**, and roll the wheel to zoom in, nudging the pointer to keep the scope in view. Now it's as large as you want; zoom back out when you've seen enough.

Coming next: **Watching and hearing**.

## Watching and hearing

**Listen with the monitor:** many outputs carry a signal even with no cable plugged into them, so you can listen to a point in the circuit on its own — and not just audio: even a slower output like an LFO or a clock may carry a signal you can listen to, unless it's a very low frequency. Right-click a terminal and hover **Monitor** to listen to just that point; move off and it stops. It's separate from your mix — the "Mixer" is the sound you're building, while a monitor checks any single signal, even one that isn't in the mix, brought up to a comfortable level.

> **Do this** — Right-click a few different outputs on the "Complex Oscillator" — the modulation oscillator's **Triangle**, the principal **Sine**, the **Final** — and hover **Monitor** on each to hear how they differ, without wiring anything. If you built the patch last section, try it on the "Quad Low Pass Gate" too: hover **Monitor** on its **Clk Out**, and on channel A's **Clk A** output, to hear the clock ticking.

**Keep a monitor:** to listen without holding the pointer still, click **Monitor** instead of hovering — a monitor drops onto the rack and follows the pointer until you click again to set it down. It stays live and is saved with your patch, so you can leave several running side by side. Each is also its own control: hold the pointer over it and scroll to set its level, click it to mute and unmute — a green ring shows when it's on — and close it with its ×.

> **Do this** — Right-click a terminal, click **Monitor**, then drag the monitor to a spot near the terminal and click to set it down. Notice the callout: a ring appears around the terminal, joined to the monitor by a line, marking which signal it hears. Drop a couple more monitors on terminals — including ones with no cable — then hold the pointer over each and scroll to set its level, then click it to mute it and click again to bring it back.

**Master and monitor buses:** the "Mixer" carries two output buses, side by side in its master section. **Master** is the mix you build from the six channels; **Monitor** is the sum of every monitor you've dropped — a second, independent sub-mix, like the monitor or aux bus on a real desk. Each bus has its own level fader and its own enable lamp beneath it, and the two are independent: play either, both, or neither. Dropping a monitor switches the Monitor bus on for you; turning it off silences all your monitors at once without removing them, and turning **Master** off leaves just the monitor sub-mix. Both buses are gated by the engine.

> **Do this** — With a monitor or two running, find the **Master** and **Monitor** faders in the mixer's master section, each with an enable lamp below it. Set the **Monitor** level against the **Master**, then toggle the two enables — **Master** off to hear only your monitors, **Monitor** off to silence them and keep just the mix.

**Peek at a signal:** the same terminal menu's **Scope** shows a signal's shape. Right-click a terminal and hover **Scope**, and a small scope appears beside the pointer, drawing live; move off and it's gone — the same peek-or-keep pattern as the monitor. It sets its own scale and locks the trace steady, triggering on the signal's rising edges, so you get a still, framed picture at once — whether the signal is fast or slow. The exception is a signal with no clear rising edge to lock onto, like the Complex Oscillator's **Final** output while it's modulated: with nothing steady to trigger on, that trace keeps moving.

> **Do this** — Right-click the "Complex Oscillator" principal **Square** output and hover **Scope** — a clean waveform, held steady. Try the modulation oscillator's **Triangle** and the "Quad Low Pass Gate" **Clk Out** too: each locks into a still trace, the slow clock included.

**Keep a scope:** to hold a scope open, click it — on the **Scope** menu item, or on the peeked scope's face. It then follows the pointer until you click again to set it down. Like an audio monitor, a kept scope draws a callout — a ring around the terminal, joined by a line to the scope — stays live, and is saved with your patch. A running scope tracks its signal moment to moment, so anything you change upstream shows on screen at once.

> **Do this** — Right-click the "Complex Oscillator" principal **Square** output, click **Scope**, drag it to a clear spot, and click to set it down. Turn the **Frequency** (Pitch) knob and watch the wavelength squeeze and stretch as the frequency rises and falls. Then keep a scope on the "Quad Low Pass Gate" **Clk Out** and turn its **Rate** up and down — the trigger pulses crowd together or spread apart.

**Move or remove a scope:** the callout ring has a small grab handle. Drag the ring off its terminal and release it over empty space, and the scope vanishes — the same gesture as pulling a cable off a terminal. Drop the ring on a different terminal instead, and the scope re-probes there, re-framing to show that signal.

> **Do this** — Grab a kept scope's ring by its handle and drag it onto a different terminal, then release — the scope now shows that signal. Grab it again, pull it out over an empty part of the rack, and let go to remove the scope.

**Looking at complex signals:** while the "Complex Oscillator" is being modulated, its output usually can't be held steady by the scope's auto-sync — the waveform shifts too much from one cycle to the next for the trigger to lock onto. You can still study it by freezing the trace: hover the scope and press its freeze button (lower-left) to hold the picture exactly as it was the instant you pressed — a still frame to read at leisure. Freezing works on steady signals too, handy when you want a close look. Press the button again to run.

> **Do this** — Keep a scope on the "Complex Oscillator" **Final** output, then turn up the modulation — press **Pitch Mod** and raise **Mod Index**. The trace won't settle. Hover the scope and press its **freeze** button to catch a single frame; study its shape, then press again to run. Try freezing a steady signal too, like the principal **Square** — a still trace can be easier to read.

The scope can do more — triggering, and comparing two signals at once — which a later section covers.

Coming next: **Keeping your work**.

## Keeping your work

**Nothing is lost when you close:** you don't have to save to hang on to your work — wCoast quietly remembers your session as you go, in the desktop app and in any web browser, so the next time you open it you're right back where you left off: the same modules, cables, knob settings, and any scopes or monitors you'd placed. Saving is for something different — keeping a named version you can return to, or hand to someone else.

> **Do this** — Change something small — turn a knob, drop a monitor — then quit and reopen. It all comes back exactly as you left it.

**Save a patch:** to keep a version by name, open the menu and choose **File ▸ Save** — or **Save As…** to start a new one, saved to your Documents as a file you can keep, copy, or share. If you're running the web version in a browser, saving named files to disk needs **Chrome or Edge**; other browsers can't write files, but they still keep your work safe in the browser's own storage and restore it when you reload — you just can't name and export separate versions there.

> **Do this** — **File ▸ Save As…**, give the patch a name, and save. That one file now holds this whole setup.

**Open and revert:** **File ▸ Open** loads a saved patch. **File ▸ Recent** lists your saved patches, newest first — and the patch you currently have open is in that list too, so choosing it re-reads it from disk. That's how you revert: back to your last save, dropping any changes since.

> **Do this** — Turn a knob, then open **File ▸ Recent** and pick the patch you just saved — it reloads from disk, discarding that change.

**What a patch holds:** opening a patch brings the whole instrument back — every module and where it sits on the rack, every cable and its bends, every knob and switch, and the scopes and monitors you left clipped on, with their positions and settings. Nothing to reassemble; it reopens exactly as you had it.

That's the tour. From here it's yours — build, listen, and see where it takes you.
