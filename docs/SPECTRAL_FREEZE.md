# Spectral Freeze

Native listening proof on `codex/convolution-resonator`, 2026-11-18.
Module Browser: Space; native type 273, `spectral_freeze` version 2.

## Interaction

1. Feed voice, music or an instrument into Mono or Left/Right.
2. Click the Freeze toggle while the wanted sound plays; it lights as Frozen.
3. Stop the source: the captured spectrum keeps sounding.
4. Return to Live to release. A wired Freeze gate replaces the switch:
   rising above 0.5 captures; falling below 0.5 releases.
5. Click Recapture, or send its input a rising-edge trigger, to replace the held
   spectrum while Frozen. Requests latch until an available analysis boundary.
   Requests arriving during a transition coalesce into the next capture.

Capture waits for a complete initial selected-size analysis window, then uses the
latest available frame at the next hop. It may capture silence intentionally;
there is no undocumented noise gate. Held is 1 after an active capture is ready,
0 in Live or before capture. Recapture while Live is ignored.

## Controls

- Freeze: click-only toggle, default Live/off; it lights as Frozen/on. The input
  gate overrides the button. Uses the existing shared binary-button widget.
- Recapture: click-only action; each click increments a request counter, rather
  than toggling an on/off state. Ignored while Live, like the trigger input.
- FFT Size: 512, 1024, 2048, 4096 (default), 8192 or 16384 samples. Changing size
  remaps the held spectrum using measured phase-advance frequencies; it does not
  recapture the live input or silence.
- Capture Blend: milliseconds, default 20. A new capture or remapped spectrum
  warms its preallocated second core, then smoothstep-crossfades over this time.
  Zero permits an abrupt handoff after warming.
- Refresh Rate: Hz, default 0 (off). Exponential power-spectrum refresh admits
  live input gradually and tracks its phase advance without resetting held phase.
  1 Hz gives an approximately one-second power-following time constant; this is
  not a periodic retrigger clock. Silent input eventually fades the held sound.
- Decay: magnitude time constant in seconds; 0 means infinite sustain. Positive
  values fade the stored spectrum. Recapture starts again from current input.
- Diffusion: extra phase excursion, 0..100%, default 0. The captured phase advance
  always continues; diffusion optionally adds motion without a complex crossfade.
- Stereo Spread: opposite-channel diffusion motion, default 100%. Requires
  Diffusion above zero; otherwise captured stereo remains unchanged in intent.
- Mix: delayed live versus held signal, default 100%. Capture/release has its
  own 20 ms smoothstep handoff. It is not a whole-signal limiter or auto-leveler.

## DSP And State

Selected FFT size / quarter-size hop, Hann analysis/synthesis with normalized
four-way OLA. Live and held share selected-size latency: 10.67 to 341.33 ms at
48 kHz. Size changes intentionally change timing; plugin host latency
compensation has not been verified. They require warming plus Capture Blend.

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
  and local non-finite recovery. All six sizes retain correct dry latency;
  held-tone pitch survives remapping, counted Recapture requests reach DSP,
  Capture Blend bounds the DC transition slope, Refresh follows live power.
- `test_spectral_freeze_graph.mjs`: switch versus wired-gate override, stereo,
  Recapture, real Held output and continued synthesis match direct native processing.
- `test_spectral_freeze_browser.mjs`: actual worklet capture/Held, continued sound
  after source amplitude zero, Live release and desktop/mobile GL presentation.

Listening acceptance is required, particularly on complex held sounds during size
changes and recaptures. Remapping is not lossless: down-sizing reduces spectral
resolution. Capture persistence, spectrum display and transposition remain future
work. No hidden limiter or automatic gain normalization is applied.
