# Pie (radial) menus — specification and plan

Replace the list-style right-click context menus with radial **pie** menus that can
be operated in one fluid click-and-drag, and fold the toolbar into them to free
screen space. The existing list menus (`_onModuleContextMenu`, `_onRowContextMenu`,
`_scopeMenu` in `host/rack.js`) are what this supersedes.

## 1. Contexts

Right-click opens a pie whose contents depend on what is under the pointer:

- **Faceplate background** (a module's face, not on a control, a jack, or the title
  strip) → the **panel pie** — global app actions.
- **Terminal** (an input or output port) → the **terminal pie**.
- **Title strip** (the far-left module-name region) → a **module pie** (delete).
- **Controls** (knobs) → not handled yet.

Left-click is unchanged and stays direct: left-drag from a terminal pulls a patch
cable; left-drag on the title strip moves the module; left-drag anywhere else on the
face does nothing — which removes today's accidental whole-panel move. The pie
appears **only on right-click**.

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

## 3. Interaction — peek / un-peek / commit

Opens centred on the pointer; the pointer begins in the dead zone. The menu does
**not** close when you enter or click a segment — it stays up through the whole
gesture and closes only by committing (out) or cancelling (centre).

- **Peek.** Moving or dragging into a segment highlights it and fires a *reversible
  preview*: sound starts, an oscilloscope appears showing its wave. Moving to a
  different segment un-peeks the first and peeks the new one.
- **Un-peek.** Moving back into the centre dead zone reverses the preview (sound
  stops, the scope disappears). You are back to neutral, menu still open.
- **Commit.** Dragging/moving *outward past the outer circle* leaves the preview in
  place and hands off: sound stays on; the scope detaches and follows the pointer to
  be dropped — on release if a button was held, on the next click if not. The menu
  vanishes.
- **Cancel.** Back in the centre, releasing or clicking (either button), or Escape,
  closes the menu with every preview undone.

So one gesture peeks to audition, then either flicks outward to keep it or falls back
to the centre to drop it — a quick peek-and-decide. One-shot segments (app menu,
delete) have no preview: they just highlight on hover and fire on the same cross-out.

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
- **NW** (upper-left): app main menu (the hamburger). Opens the existing vertical
  menu as a submenu; it now also holds **show network**.
- **S** (bottom): **start/stop sound**. Its wedge is highlighted while the transport
  runs and unhighlighted when stopped — the current toolbar toggle behaviour.
- The other six positions are empty for now.

**Terminal pie**
- **NE** (upper-right): **scope** — drag an oscilloscope out of the terminal. The
  only segment in v1.

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
