# Pie (radial) menus — specification and plan

Replace the list-style right-click context menus with radial **pie** menus that can
be operated in one fluid click-and-drag, and fold the toolbar into them to free
screen space. The existing list menus (`_onModuleContextMenu`, `_onRowContextMenu`,
`_scopeMenu` in `host/rack.js`) are what this supersedes.

## 1. Contexts

A **right click** opens a pie whose contents depend on what is under the pointer.
Left click never opens a pie; the native context menu is suppressed app-wide:

- **Faceplate background** (a module's face, not on a control, a jack, or the title
  strip) → the **panel pie** — global app actions.
- **Terminal** (an input or output port) → the **terminal pie**.
- **Title strip** (the far-left module-name region) → the **module pie** (delete).
- **Controls** (knobs, buttons) → no pie.
- **Empty rack row** → the **add-module** list menu (unchanged).

Left click stays direct: left-drag from a terminal pulls a patch cable; left-drag on
the faceplate moves the module. A plain left **click** on a terminal starts a *sticky*
cord that follows the cursor with no button held (scroll/zoom/roam freely) — click a
target jack to connect, or Escape / right-click to cancel. This is an alternative to
press-drag cabling for long runs.

## 2. The pie

- **Eight fixed segment positions** (N, NE, E, SE, S, SW, W, NW). A position is
  reserved by its action and left empty if unused, so a given action is always in
  the same direction — the user builds muscle memory for the drag direction.
- **Each wedge is the button** — icon only, no inner rectangular button widget. The
  pie's radius is just large enough to hold the icons.
- A central **dead zone** around the pointer.
- A segment may **fire an action**, **flow into a drag action**, or **open a submenu
  list**.
- A segment may show a **highlighted (toggled) state**.

## 3. Interaction — click, or drag-out

Opens centred on the pointer; the pointer begins in the dead zone. Moving over the
wedges only **highlights** them — nothing triggers on entry or movement. A wedge acts
two ways, and a click does **not** close the menu:

- **Click to act (menu stays open).** Clicking a wedge runs its action and leaves the
  pie up, so it reads like a little control panel:
  - **Sound** — toggles on/off, exactly like the toolbar button.
  - **Scope / Listen** — shows a *temporary* viewer (a scope, or an ear monitor) right
    beside the menu, for a quick look. A second click hides it, and it is removed when
    the menu closes — a peek, not a permanent object. It appears immediately to the
    right of the menu, vertically centred on the pointer (left-edge midpoint as close
    to the pointer as it can be without the menu covering it; flips left if there's no
    room on the right).
  - **App menu / Delete** are the exception: they close the pie, then act (the app
    menu opens next to the pointer; delete removes the module).
- **Press-and-drag out to create (permanent).** On the scope or listen wedge, pressing
  the button and dragging out through the outer circle pulls a *new* viewer out to be
  dropped where you release. This is the **only** way to make a permanent instance.
- **Closing.** The pie closes on Escape, a click in the centre dead zone, or the
  pointer leaving past the outer circle (a plain move-out, no button). Any temporary
  click-shown viewer is removed on close; dropped (dragged-out) viewers stay, removable
  by their ×.

## 4. Pointer and window edges (rendered cursor)

A renderer can't warp the OS cursor (and the browser build couldn't anyway), so we
draw our own cursor rather than move the real one:

- On open, **hide** the OS cursor (leave it live — do **not** Pointer-Lock it) and
  draw a rendered cursor. Track the real pointer via mousemove; the rendered cursor
  = real pointer + a fixed offset. Keeping the OS cursor *moving* (just invisible)
  is what lets the screen magnifier keep following it.
- Normal case: offset 0 — the rendered cursor sits exactly on the real pointer, both
  at the pie centre; the magnifier tracks perfectly.
- Edge case: if the right-click is near a window edge, **shift the pie inward** just
  enough to be fully visible and set the offset to that shift, so the rendered cursor
  still starts at the (shifted) pie centre. The offset never exceeds ~half the pie's
  small diameter, so the rendered and real cursors stay close and the magnifier still
  frames the pie.
- Full Pointer Lock is a fallback only if edge-reachability proves a problem; it
  would freeze the OS cursor and the magnifier with it, so we avoid it by default.

## 5. Item placement (fixed directions)

**Panel pie**
- **NW** (upper-left): app main menu (the hamburger). Opens the existing vertical menu.
- **S** (bottom): **start/stop sound**. Its wedge is highlighted while the transport
  runs and unhighlighted when stopped — the current toolbar toggle behaviour.
- The other positions are empty for now.

**Terminal pie**
- **NE** (upper-right): **scope** — an oscilloscope.
- **S** (bottom): **listen** — an ear monitor. It solos this terminal into a monitor
  bus (a brick-wall limiter protects ears/speakers; level respects the master gain)
  and ducks the normal output; several monitors *add* to the solo mix. Click a circle
  to mute/unmute it, drag to move it, the × to remove.
- **NW** (upper-left): **what feeds this** — isolate the terminal's UPSTREAM (see §9).

Both viewers follow the click-vs-drag rule (§3): a **click** shows a temporary one
beside the menu that vanishes on close; **press-and-drag out** drops a permanent one.
Only the permanent (dragged-out) viewer shows the **connection loop** (a ring around
the port + a line to the viewer) — the temporary one is unconnected-looking so its
line doesn't clutter the menu. Drag a permanent viewer's loop (its grab dot) onto
another port to re-probe it, or onto empty space to **disconnect** it from the port.

**Module pie** (title strip)
- **NE** (upper-right): **delete**. Left-drag on the strip = move the module.

## 6. Toolbar retirement

- Remove the toolbar to reclaim space.
- App menu → panel pie NW; start/stop → panel pie S; show network → inside the app
  menu.
- The overall-volume knob and the toolbar VU meter are **deprecated** — the mixer's
  master level and its VU meters cover both.

## 7. Build plan

1. **PieMenu engine** (nothing app-specific): eight fixed positions, dead zone,
   drag-from-centre + hover selection, wedge-as-icon-button rendering, highlight
   state, Pointer-Lock synthetic cursor, edge-clamp, and submenu-on-a-segment.
2. **Terminal pie** — the smallest real test: right-click a terminal → a pie with the
   scope wedge (NE) → the drag flows into the existing scope drag-out. This exercises
   the whole system end to end.
3. **Panel pie + toolbar retirement**: app-menu wedge (NW, opening the existing menu
   list; add show-network), start/stop wedge (S, with the running highlight); remove
   the toolbar; deprecate the volume knob and VU in favour of the mixer.
4. **Title strip**: restrict move to a left-drag on the title strip; add the module
   pie with delete; drop whole-panel drag and delete. Replace `_onModuleContextMenu`.
5. Later: more terminal actions (disconnect, etc.), a control pie, and a keyboard /
   accessibility path.

## 8. Open items

- Module pie: delete's fixed direction, and any other module-management actions.
- **Keyboard access** (nice-to-have, not required): the primary user works mouse-
  first with screen magnification, so a mouse-centric radial menu is fine as the main
  path. Keyboard equivalents for the pies are welcome later but never a blocker.
- Validate in practice that the rendered cursor + hidden-but-live OS cursor tracks
  well under screen magnification (expected to; the pie is small and the cursors stay
  within ~half its diameter).
- The icon set for the wedges.

## 9. Network display and the "what feeds this" isolate mode

**Baseline (always on).** Every cable carries the moving black flow-dashes at all
times (source→destination, full-opacity black so they read over any cable). Hovering
a module brightens the cables of its upstream/downstream network to full opacity and
fades the rest to 50%. This replaced the old app-menu "Show network" toggle — the
brightening is now permanent, not toggled.

**What feeds this (terminal pie, NW).** Selecting it isolates the **upstream** supply
chain of the clicked terminal — every cable that transitively feeds it, i.e. what
affects the signal there. Everything the terminal *drives* downstream is not part of it.

- The clicked port is **precise**: for an input, only the cord plugged into that exact
  port seeds it (not its siblings on the same module); an output is fed by its whole
  module. From there upstream is followed per module/channel section — a module is a
  black box (all inputs feed all outputs). See `_upstreamOf`.
- The upstream cables are drawn **bright, with the moving dashes**; every OTHER cable
  stays visible but **dimmed (50%) and dash-less** — de-emphasised, not hidden.
- **Live:** the upstream is recomputed on every patch edit, so a new feeding cord joins
  (and a removed one leaves) at once — including the immediate break when you pull a
  cord off to audition. Anchored to the clicked port in `_isolateOrigin`.
- Hover does nothing while isolating; the whole upstream stays lit regardless.
- Every participating jack (plus the clicked one) is **enlarged** — the swell + family-
  colour ring, which *breathes* with each terminal's live signal level, and each
  subnet cable's dash speed tracks its source signal (audio amplitude / CV motion /
  trigger pulses). First-cut mode indicator; may be revisited.
- The view is **persistent**: it ends on **Escape** or a **left click on empty
  faceplate space**.
