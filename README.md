# Wcoast

A West Coast (Buchla-style) modular synthesizer for Web Audio, packaged as
a native macOS app via Electron. Companion instrument to GXW/GeoSonel: it
can be played on its own and, later, driven by control-rate messages and
timestamped triggers from GXW.

## Status: audio-generation spike

The project is at its first milestone — a throwaway spike whose only job is
to retire the highest technical risk before any real design is implemented:
that the AudioWorklet toolchain loads and runs cleanly inside Electron.

Running `npm start` opens a window with two controls:

1. **Native oscillator** — proves the audio path and the click-to-start
   gesture work inside the Electron renderer.
2. **Worklet tone** — loads `worklets/test-tone-processor.js` over the
   `app://` origin and plays a tone from an `AudioWorkletProcessor`. The DSP
   is a naive sine on purpose, so any failure is unambiguously a pipeline
   problem rather than a synthesis bug. The frequency slider demonstrates
   the destination-side glide that the GXW bridge will later rely on.

The log panel reports each step, including whether `crossOriginIsolated` is
true — the app is served over a custom `app://` scheme with COOP/COEP
headers so that SharedArrayBuffer stays available for the optional
future WASM-DSP route. That route is not in use yet; the first worklet is
hand-written JS.

## Architecture notes (for later milestones)

- **Separate audio context from GXW.** The two apps talk over a local
  message transport (control-rate parameter messages plus timestamped
  triggers), not a shared audio graph. GXW is tick-rate and cannot produce
  audio-rate control, so all fast modulation lives inside Wcoast.
- **Band-limited from the start.** The complex oscillator and the wavefolder
  are worklet DSP with contained oversampling; the LPG and control-rate
  modules can lean on native nodes.
- **Zero allocation on the audio thread.** The single most likely cause of
  an audible glitch. The spike worklet already follows this discipline.

## Requirements

- Node.js (Homebrew Node at `/opt/homebrew/bin`)
- `npm install` to fetch Electron, then `npm start`
