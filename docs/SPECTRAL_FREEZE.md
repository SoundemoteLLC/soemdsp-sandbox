# Spectral Freeze

Native listening proof on `codex/convolution-resonator`, 2026-11-18.
Module Browser: Space; native type 273, `spectral_freeze` version 1.

## Interaction

1. Feed voice, music or an instrument into Mono or Left/Right.
2. Change Freeze from Live to Frozen while the wanted sound plays.
3. Stop the source: the captured spectrum keeps sounding.
4. Return to Live to release. A wired Freeze gate replaces the switch:
   rising above 0.5 captures; falling below 0.5 releases.
5. Recapture is a rising-edge trigger that replaces the held spectrum while
   Frozen. A one-sample pulse is latched until the next analysis hop.

Capture waits for a complete initial 4096-sample analysis window, then uses the
latest available frame at the next hop. It may capture silence intentionally;
there is no undocumented noise gate. Held is 1 after an active capture is ready,
0 in Live or before capture. Recapture while Live is ignored.

## Controls

- Freeze: Live/Frozen; default Live. The input gate overrides the switch.
- Decay: magnitude time constant in seconds; 0 means infinite sustain. Positive
  values fade the stored spectrum. Recapture starts again from current input.
- Diffusion: extra phase excursion, 0..100%, default 0. The captured phase advance
  always continues; diffusion optionally adds motion without a complex crossfade.
- Stereo Spread: opposite-channel diffusion motion, default 100%. Requires
  Diffusion above zero; otherwise captured stereo remains unchanged in intent.
- Mix: delayed live versus held signal, default 100%. Capture/release has its
  own 20 ms smoothstep handoff. It is not a whole-signal limiter or auto-leveler.

## DSP And State

Fixed 4096 FFT / 1024 hop, Hann analysis/synthesis with normalized four-way OLA.
Live and held share 4096 samples of latency (85.33 ms at 48 kHz).
Freeze does not yet inherit Blur's size selector.

Magnitude, complex phase and measured inter-frame phase advance are captured
per channel/bin. Subsequent held frames advance those phases and optionally
decay magnitudes. This is neither a time-domain loop nor repetition of an
unchanged FFT frame. DC and Nyquist remain real; Hermitian symmetry is restored.

Inputs remain measured during hold so Recapture can take new material.
All buffers are preallocated per instance from the existing native pool.
No processing-time allocation, JS DSP fallback, private canvas or new shared
renderer/engine abstraction. The face uses the existing shared GL 1D Trace.
Reset/rate change clears the capture; it is not yet serialized into patches.
Invalid/non-finite signal state resets only this module. Held becomes zero.

## Verification

- `test_spectral_freeze.mjs`: 44.1/48/96 kHz; Live/dry latency, capture sustained
  after source silence, retained approximately 440 Hz pitch, stereo scaling,
  one-sample Recapture, release, positive decay, silent capture, no memory growth
  and local non-finite recovery.
- `test_spectral_freeze_graph.mjs`: switch versus wired-gate override, stereo,
  Recapture, real Held output and continued synthesis match direct native processing.
- `test_spectral_freeze_browser.mjs`: actual worklet capture/Held, continued sound
  after source amplitude zero, Live release and desktop/mobile GL presentation.

Listening acceptance is required. Recapture relies on window/OLA blending rather
than a separate dual-capture engine; listen specifically to abrupt recaptures.
Refresh, capture persistence, spectrum display, transposition and selectable
window sizes are future work, not implied features of v1.
