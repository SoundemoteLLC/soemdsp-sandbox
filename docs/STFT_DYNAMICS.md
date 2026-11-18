# STFT Contrast And STFT Gate

Feature tracking and proposed modules: [STFT_ROADMAP.md](STFT_ROADMAP.md).
Standalone IIR Vocoder development: [VOCODER_ROADMAP.md](VOCODER_ROADMAP.md).

Native listening proofs on `codex/convolution-resonator`. Both modules are in
Dynamics. DSP is C++/WASM; the face uses the shared WebGL 1D Trace and settings.
No JavaScript DSP or drawing fallback was added. Vocoder is unchanged.

## Shared Timing And Routing

- 1024-sample FFT, 256-sample hop, periodic Hann analysis/synthesis, normalized
  four-way overlap-add. Neutral reconstruction includes DC and Nyquist.
- Fixed 1024-sample reference delay (21.33 ms at 48 kHz). Dry/wet is aligned.
- In/Left/Right and Mono/Left/Right use the app's stereo routing. Detection
  observes both resolved inputs regardless of which output is connected.
  One linked gain field preserves channel ratios and complex phases.
- Gain decisions update per hop, not per input sample. Attack 0 means the
  fastest hop response, not an instantaneous sample-domain processor.
- State is taken from the shared pool at create and released at destroy;
  no allocation inside audio processing. Finite-but-unrepresentable float FFT
  input and non-finite state recover locally; there is no audio level clipper.

## STFT Contrast

32 overlapping logarithmic analysis regions cover 40 Hz through Nyquist.
One-sided Parseval-normalized bin power is distributed between neighboring
region centers. Scale smooths those region powers with an edge-normalized
Gaussian neighborhood in octaves. Gain is interpolated back to FFT bins.

For each region, relative contrast contributes:

```text
contrastGainDb = Contrast * (regionLevelDb - meanRegionPowerDb)
```

Positive Contrast exaggerates spectral peaks; negative Contrast brings quiet
regions forward. This stage is independent of overall input level. Separately,
Threshold/Ratio apply downward compression above the region's threshold.
Max Boost is an explicit upper bound on positive spectral gain, not an output
limiter. Output Gain is applied afterward. No automatic makeup gain is hidden.

Attack smooths increasing gain reduction; Release smooths recovery/upward gain.
The threshold is region-power dBFS, not a full-band peak-meter reading.

Listening: try music through the module and sweep Contrast around zero. Use
Ratio 1 to hear relative contrast alone. Compare narrow and broad Scale. For
neutral reference use Contrast 0, Ratio 1, Output Gain 0; Mix 0 has the same
fixed delay. This is not a Soundgoodizer/Maximus clone.

## STFT Gate

Each bin has a variable Knee around its threshold (default 6 dB, preserving
the original behavior). Knee 0 hard-switches at the threshold; positive values
use a smooth transition across the specified dB width. Depth sets the closed
attenuation. Smooth blends gain decisions with a five-bin triangular average
in linear gain; Attack opens and Release closes the stereo-linked gains.

Hold is a retriggerable per-bin peak hold, default 0 ms (original behavior).
While the bin is above threshold its most-open gain is retained and the timer
restarts. Once below threshold, that gain is held until Hold expires; then
Release closes it. Hold duration is measured in physical milliseconds with
one-hop timing resolution. Shortening Hold takes effect on the next hop;
raising it does not resurrect an expired opening. Profile mode changes and
signal resets clear held gains. Learn/bypass does not prime the hold state.

The spawn range ends at 1000 ms, but there is no DSP maximum or time-sized
buffer. Typing 5000 extends the parameter maximum and holds for five seconds.
This holds gain, not spectral samples: a vanished harmonic is not synthesized.

For extreme harmonic pop-in, use Manual, Knee 0, Attack 0, Release 0, Smooth 0,
Depth 100..120 dB and Mix 1; sweep Threshold through the harmonics. Add Hold
to make openings linger before Release begins. Learn and
Use Profile also honor Knee. STFT overlap still blends frame transitions;
hard bin decisions are intentionally not a promise of sample-domain clicks.

Noise Profile modes:

1. Manual: use the per-bin Threshold (not whole-signal peak level).
2. Learn: start a fresh running mean noise-power spectrum. Wait for a full
   fresh 1024-sample window before capturing, so old audio is not learned.
   Learning passes the audio through the aligned spectral path.
3. Use Profile: use each learned bin's mean power plus Margin as its threshold.
   This freezes learning. More margin removes more noise and can erase detail.

Ready is a real native output: 1 once a complete noise frame has been learned,
otherwise 0. Use Profile without a profile passes audio unchanged, not through
a guessed fallback threshold. Learn only background noise, then switch to Use
Profile. Learning music or speech teaches the gate to suppress it.

**V1 limitation:** profiles are engine-session state, not serialized into
patches. Signal reset retains a frozen profile; new Learn, instance destruction,
engine rebuild, or sample-rate change clears it. Patch-persistent profile
storage is not implemented. This is spectral gating, not AI voice isolation;
musical-noise artifacts and removal of wanted low-level content remain possible.

## Verification

- Full 202-module standalone and combined WASM build.
- `node scripts/test_stft_dynamics.mjs`: metadata/tooltips parity, neutral
  reconstruction and latency at 8/44.1/48/96 kHz, DC/Nyquist, stereo linkage,
  contrast polarity, 4:1 compression slope, level independence, manual gating,
  Learn/Use/fresh-window/profile invalidation, retained wanted tone, non-finite
  recovery, pool capacity and released storage.
- Hold tests check zero-default compatibility, below-threshold audibility,
  expiry at 44.1/48/96 kHz, retriggers, 5000 ms without a time cap, no audio-loop
  allocation, and silence after the source disappears.
- Synthetic learned-noise test measured roughly 50 dB attenuation at Margin
  9 dB; that is a test signal result, not a general denoising promise.
- `node scripts/test_stft_dynamics_graph.mjs`: default/custom controls,
  mono/lone-side/stereo/summed routing, native parity, Ready and pooled state.
- `node scripts/test_stft_dynamics_browser.mjs`: both modules spawn, connect,
  produce audio, change profile modes, and show their standard GL faces on
  desktop/mobile without page errors.

User listening is the next gate before claiming the sonic goal is achieved.
