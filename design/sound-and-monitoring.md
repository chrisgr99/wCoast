# Sound and monitoring — specification

Two things people want to hear in DreamRack: the **master** (the finished mix out of
the mixer) and the **monitor** (a single terminal, tapped by an ear monitor, to check
it in isolation). Today those sit behind a third, higher concept — the **engine**
(the On/Off transport, stored as the mixer's `masterMute` param) — so a placed monitor
can be silent for two different reasons at once (the engine is off, or the monitor bus
is off), and auditioning one port cleanly means a trip to the mixer to mute the master.

This removes the engine as a user-facing idea and leaves just the two buses, each
independently on or off, plus a **Sound** menu that lets you audition either bus by
hovering and toggle it by clicking. It supersedes the On/Off transport, the `masterMute`
"Engine" param, and the engine item on the panel menu.

## 1. Two buses, no engine

The only transport state is two independent enables, both already present as mixer
params:

- **`masterEnable`** — the master bus (the mixer output). Default on.
- **`monitorEnable`** — the monitor bus (placed ear monitors). Default off.

Either, both, or neither can play. **Silence everything** is simply both off — there is
no separate global mute. `masterMute` (the old "Engine" param) and the `started`
On/Off transport in `debug/rack-app.js` go away; the panel menu's sound item becomes
the Sound menu below.

Because the master defaults on and the monitor defaults off, an empty rack behaves
exactly as before: you hear the mix, not monitors, until you place one.

## 2. The audio context is a hidden detail

Web Audio needs a running `AudioContext`, but the user should never think about it.
Wake it lazily on the first thing that needs sound — a bus being enabled, a monitor
being placed, or an audition beginning — and, once woken, keep it running for the
session (opening any menu is already a click, so autoplay's user-gesture requirement
is satisfied long before anyone hovers a Sound item). Optionally suspend it when both
buses are off and nothing is auditioning, purely to save CPU; correctness never
depends on it, since both buses being off is already silence.

## 3. The Sound menu (panel menu only)

Lives on the **panel** menu (the faceplate-background context menu — global app actions), not on
the terminal menu. The way you reach the monitor bus *from a terminal* is to open a
monitor or hover the monitor entry there (§5), so the terminal menu needs no Sound
control.

Three items:

- **Master**
- **Monitor**
- **Both**

Each item does two things depending on how you touch it:

- **Hover — momentary audition.** While the pointer rests on an item, you hear that
  choice, and *only* that choice, regardless of the current bus states. Hover **Master**
  → the master alone; hover **Monitor** → the monitor alone; hover **Both** → both,
  whichever was on or off. Leaving the item **restores the exact prior state** — an
  audition never changes anything persistent.
- **Click — persistent toggle.** Click **Master** toggles the master bus; click
  **Monitor** toggles the monitor bus; click **Both** persistently enables both. A
  click also ends the momentary audition cleanly (the persistent choice takes over).

Show each item's current persistent state (a check or a lit mark) so you can see what is
on without auditioning.

### Debounce

Not strictly required — you move the pointer diagonally straight to the item you want,
rather than tracking down a column past the others. Include a short hover debounce
anyway (a few tens of milliseconds before an audition starts) so a pointer that merely
crosses an item on its way elsewhere makes no sound, and so quick passes can't glitch.

## 4. How auditioning works — momentary overlay, no writes

Auditioning must not touch the persistent bus params (or restoring would risk clobbering
a state the user changed meanwhile). Drive it entirely through the gain nodes that
already exist, as a momentary overlay:

- The mixer's **`soloDuck`** node (`modules/mixer/factory.js`, `setSolo`) silences the
  main output post-mute *without disturbing `masterEnable`*. Duck it to audition
  monitor-only; release it to bring the master back.
- The monitor bus's **mode gate** and **engine gate** (`_monModeGate`, `_monEngineGate`
  in `host/rack.js` `_monitorBus()`) open the monitor path the same way — the hover
  "Listen" preview (`_monPreviewGain`) already proves a terminal can be made audible
  past those gates without changing `monitorEnable`.

So each Sound audition is: capture nothing, open/duck the right nodes for the hovered
choice, and on leave set those nodes back to what the persistent bus states dictate
(recomputed from `masterEnable`/`monitorEnable`, not from a snapshot). Because the
persistent params are never written during an audition, there is nothing to restore and
nothing to get out of sync — a save mid-audition still saves the user's real settings.

## 5. Monitoring a terminal

Enabling the monitor bus from a terminal is implicit, so it needs no menu of its own:

- **Opening a monitor** on a terminal enables the monitor bus, so a freshly placed
  monitor makes sound immediately — the master is untouched, so you are not forced to
  turn the mix off to hear the port.
- **Hovering the monitor entry** in the terminal menu auditions that terminal
  momentarily (the existing `_monPreviewGain` hover-listen), so you can check a port
  before committing a monitor.

Whether *removing* the last monitor should disable the monitor bus again is an open
question (§7).

## 6. Persistence and defaults

Two booleans, saved and restored with the patch: `masterEnable` and `monitorEnable`.
No engine/transport state to persist. On load, a sensible floor is master on so a
reopened patch is never silent for a non-obvious reason; revisit whether monitor-enable
should persist or always reset to off.

## 7. Open questions (decide at implementation)

- **A quick silence-all.** With click-Both defined as "enable both," there is no
  single gesture that silences everything — you toggle each bus off. If that proves
  clumsy, the cleanest fix is to make Both a true toggle: enable both unless both are
  already on, in which case silence both. Worth trying the enable-both form first and
  seeing whether a one-click silence is actually missed.
- **Monitor bus auto-disable.** Should removing the last placed monitor turn
  `monitorEnable` back off? Leaving it on is harmless (nothing feeds it) but the lamp
  then reads "on" with nothing to hear.
- **Per-terminal solo.** This design auditions whole buses, so hovering Monitor with
  several monitors placed sounds them all. Hearing one of many in isolation is rare
  enough to defer; it could return later as an optional per-monitor solo without
  disturbing anything here.

## 8. Implementation touch-points

- `debug/rack-app.js` — remove `started` and the `masterMute` transport wiring; the
  panel-menu sound item becomes the Sound menu; monitor placement enables
  `monitorEnable`.
- `modules/mixer/descriptor.js` — retire the `masterMute` ("Engine") param; keep
  `masterEnable` / `monitorEnable`.
- `host/rack.js` — the Sound menu's hover-audition and click-toggle, built on
  `setSolo` / `_monModeGate` / `_monEngineGate` / `_monPreviewGain`; the context
  wake/sleep lifecycle.
- `modules/mixer/factory.js` — `masterMute` node's role folds into `masterEnable`;
  `soloDuck` stays as the momentary-audition duck.
