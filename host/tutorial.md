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

**Extensions:** please turn off any browser extension that recolours pages — Dark Reader and the like — for this site. wCoast has its own light and dark modes, and those extensions distort its panels.

**These cards:** each explains one part of the instrument, then asks you to do something. A card stays open while you work, so you never have to dismiss it to follow it — park it anywhere by its title bar, and resize it like any other window. Marked blocks are your cue to act, like this one:

> **Do this** — Read the [README](https://github.com/chrisgr99/wCoast/blob/main/README.md) if you haven't — it covers what wCoast is, and what it isn't, which this tutorial won't repeat.

**Coming up:**

- **Basic interaction** — panels, menus, and the controls
- **First sound** — the shortest path to hearing something
- **Building a patch** — adding modules, and how cables behave here
- **Getting around** — panning and zooming a rack bigger than the window
- **Watching and hearing** — scopes and monitors on any terminal
- **Following the signal** — seeing what feeds what
- **Keeping your work** — saving, loading, and what carries over

## Basic interaction

**Panels:** a module's faceplate — the background behind its knobs and jacks. Its name runs vertically up the left edge, to save vertical space (scarcer here than horizontal).

**Focus:** as you move around, the rack follows your pointer — whatever you're over brightens and everything else dims back. It's not decoration; it's how wCoast helps you read a patch. Hover a module and it stands out; on a multi-part module like a quad, hover just one band and only that band lights. Once things are wired, hovering lights the whole chain the signal runs through — every module from source to output — so the structure shows itself instead of hiding among equally bright cables and panels.

> **Do this** — Move your pointer over the "Complex Oscillator" (the top-left module) without clicking, and watch the whole module brighten while the rest dims. Now move to a single band of the "Quad Low Pass Gate" — just that band lights.

**Commands:** right-click a panel — or click the hamburger in the top corner — for the main menu: Engine, File, Edit, View and Help.

> **Do this** — Right-click a panel, go to View, and set light or dark to your taste. Everything re-skins, including this card, and your choice sticks between sessions.

**Terminals:** right-click one and the menu offers what you can do with that signal — watch it on a scope, listen to it, or trace where it goes.

> **Do this** — On the "Complex Oscillator", right-click the **Final** output (under Principal Osc Outputs) and rest the pointer on **Monitor** to hear the signal there, then slide onto **Scope** to see its shape. No clicking — each lasts only while your pointer is on it (you could click to keep it).

**Colour code:** terminals read at a glance. Colour is the signal family — **audio** yellow, **control voltage** orange, **gates and triggers** blue. Shape is direction: a dashed ring hugs a terminal's outer edge on an **output**, and surrounds the centre hole on an **input**.

**Controls:** knobs may work differently from other modulars you've used — they **don't drag**. Hover a knob and scroll. Full rate at the centre, a quarter of it at the rim, so the same gesture gives you coarse or fine without a modifier. Faders take either: drag them, or scroll them like a knob. Double-click any knob to reset it.

> **Do this** — Hover a knob and scroll it, then move to its rim and scroll again — the same gesture, four times finer.

**Moving around:** if scrolling turns knobs, how do you get around a big rack? Hint: hold Option (Alt on Windows) and scroll. More on this in the **Getting around** section of the tutorial, covered later.
