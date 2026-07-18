# LibreModular — Interactive tutorial

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

This is the tutorial LibreModular shows in its floating cards, on a first run and from Help ▸ Interactive tutorial. It's written for someone who has used a software modular before, so rather than teaching synthesis it maps what you already know onto this one — and points out where LibreModular differs.

## Before you start

**Before you start,** please turn off any browser extension that recolours pages — Dark Reader and the like — for this site. LibreModular has its own light and dark modes, and those extensions distort its panels.

**These cards:** each explains one part of the instrument, then asks you to do something. A card stays open while you work, so you never have to dismiss it to follow it — park it anywhere by its title bar, and resize it like any other window. Marked blocks are your cue to act, like this one:

> **Do this** — Read the [README](https://github.com/chrisgr99/LibreModular/blob/main/README.md) if you haven't — it covers what LibreModular is, and what it isn't, which this tutorial won't repeat.

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

**Focus:** as you move around, the rack follows your pointer — whatever you're over brightens and everything else dims back. It's not decoration; it's how LibreModular helps you read a patch. Hover a module and it stands out; on a multi-part module like a quad, hover just one band and only that band lights. Once things are wired, hovering lights the whole chain the signal runs through — every module from source to output — so the structure shows itself instead of hiding among equally bright cables and panels.

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

**Cables:** left-click a terminal and the cable follows the pointer — no button held. (Almost everything in LibreModular works without a held button — gentler on the hand than dragging.) Left-click another terminal to connect it, or left-click anywhere else to drop it. A cable takes the colour of the input it plugs into, so you can read its job at a glance.

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
