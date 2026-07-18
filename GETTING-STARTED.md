# Getting Started with LibreModular

*Working document — a proposed structure for the getting-started guide, not the final copy. Audience: someone already fluent in modular synthesis. The job of this guide is to map their existing knowledge onto LibreModular's specific interface, and to surface the few things that have no hardware equivalent. We deliberately do not teach modular basics.*

## Guiding principle

Good soft-modular guides (VCV Rack, Cardinal, Softube Modular, Voltage Modular, Audulus) optimize for **time to first sound**: hear something in under a minute, learn the core patching loop, then discover what makes the instrument worth staying in. Because our reader already knows modular, we compress the basics and spend most of the wordcount on our interface conventions and on the watching / hearing / focusing tools that hardware can't do. That is LibreModular's whole pitch, so the guide should be mostly that.

---

## The sequence

### Phase 1 — Orient (~20 seconds of reading)

1. **What this is, in one sentence.** A browser modular on Web Audio; a real patching instrument, not a preset player; one voice today. Reassure the reader that their modular instincts transfer.
2. **What's on screen.** The rack and its rows; compact, consistent panels; and that the **mixer is the output** of the whole instrument — where everything eventually arrives.

### Phase 2 — First sound (the fast win)

3. **Make it sound, right now.** The shortest possible chain into the mixer, and how you switch the instrument on. Smallest step, biggest payoff.
4. **The "peek" shortcut, introduced early.** Rest on a terminal's menu and hover **Engine** to make the whole patch sound only while you hover. This is also the reader's first taste of our hover-to-act idea, which recurs later.

### Phase 3 — The core loop (add, patch, tweak)

5. **Placing and moving modules.** Adding a module from the menu, positioning it, rows, and that panels behave the same from module to module.
6. **Patching, and our one big convention.** Left-click a jack to start a cable and pull it to its destination. Then the thing to unlearn from hardware: **a cable takes its colour from the input it plugs into, not the output it leaves** — so a cable shows the job it's doing. Cover the direction-of-flow dashes, reshaping a cable by its middle, and that cables ride semi-transparent and fade under controls so a click passes through.
7. **Mults by chaining.** Drag from an empty input onto an already-fed input to share that signal, like a hardware multiple, without a cable running back to the source. Small idea, keeps big patches tidy, not obvious.
8. **Removing cables and tweaking.** How to take a cable off; knobs respond to drag and scroll. Kept brief — this part the reader can guess.

### Phase 4 — The reason to stay (the distinctive tools)

9. **Floating scopes and monitors.** Clip an oscilloscope or an audio monitor onto any terminal — no rack space, no extra cable. Freeze a trace and read its frequency, or its minimum, mean, and maximum. Monitors feed their own mixer bus, so you can balance them against the main output. Our strongest single differentiator — give it room.
10. **Peek menus in full.** Right-click any terminal; items act the moment you rest on them; Scope and Monitor show or play only while you hover, then vanish — or click to keep. Frame it as "try before you commit."
11. **Focusing a large patch.** Hover a module — or a single mixer channel — to light just the cables that feed it and that it feeds; isolate a terminal's subnet to work on one branch, with terminals pulsing in time with their signal. Positions LibreModular for *understanding* a patch, not only building one.

### Phase 5 — Keep your work, and go further

12. **Saving and loading.** The File menu; your last patch reopens where you left off; the honest caveat that saving to a file needs Chrome or Edge today.
13. **Comfort and the one gotcha.** Light and dark faceplates, and the single thing that actually breaks the look: turn off page-recolouring extensions such as Dark Reader.
14. **Where next.** The modules that ship today (by name), that new modules drop in as plug-ins, and the link to discussions for bugs and ideas.

---

## Cross-cutting notes

- **Lead with a 60-second "first patch," then let the rest be reference.** Front-load one complete success; make everything after it skimmable.
- **Every distinctive feature earns a one-line "why," not just a "how."** A modular user adopts a convention once they see the payoff: cable colour = cable job; peek = try-before-commit; net highlight = see-what-a-change-touches.
- **Keep phases 1–3 tight; spend the wordcount on phase 4.** This inverts a hardware manual on purpose, because the basics are already the reader's.
- **Leave out of getting-started:** the open plug-in architecture and the planned WAM interface (fascinating, but they belong in an About / for-developers page); and the planned floating sources and injectors (mention only as "coming," so we don't teach an interaction that isn't there yet).

---

## Open questions for the final copy

- **Medium.** The same first-run card that exists now, a longer standalone page, or a short guided sequence inside the app? This decides length and voice.
- **The concrete first patch.** Which exact modules and jacks make the fastest, most satisfying first sound to open with?
