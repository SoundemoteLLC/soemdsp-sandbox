# Spectral Cross-Synthesis

Native stereo effect, type `spectralCrossSynthesis`, ID 278, Space category,
wave-family badge. No samples or external IR files.

## Listening

Connect speech/drums/music to Voice L/R and a sustained saw, noise or chord to
Synth L/R. One cable into either side of each pair feeds both channels;
two cables keep independent stereo. Route Left/Right to Output.

- Transfer 1: Voice's broad spectral envelope shapes Synth.
- Transfer 0: delayed Synth reconstruction.
- Envelope Width 300-1000 Hz: broad envelope transfer, retaining Synth harmonics.
- Width 0: individual FFT-bin magnitude transfer; more literal/robotic.
- Attack 0-5 ms, Release 50-200 ms: tight versus lingering envelope.
- Mix blends aligned dry Synth with wet. Voice is not directly mixed in.

This is distinct from Vocoder's logarithmic IIR bands and resonant ringing.
Convolution Resonator builds its own carrier; this module accepts an external
stereo Synth, retains its phase and spectral fine structure, and explicitly
normalizes its envelope before applying Voice's.
It is not Spectral Morph or an audio crossfade.

## DSP Contract

Fixed 2048-point FFT, hop 512, Hann analysis/synthesis, 4x overlap and 2/3
overlap-add normalization. Reference delay is exactly 2048 samples, including
dry Synth: 46.44 ms at 44.1 kHz, 42.67 ms at 48 kHz, 21.33 ms at 96 kHz.
There is no new global latency-compensation system or configurable FFT size.

Each channel analyzes Voice and Synth independently. Per-bin power follows
separate attack/release time constants, in ms. Prefix-sum neighborhood averaging
forms the broad envelope in O(N); Envelope Width is the full neighborhood width
in Hz. Fractional radii interpolate, with edge neighborhoods renormalized.

Wet complex spectrum is Synth multiplied by
`1 + Transfer * (sqrt(VoiceEnvelope / SynthEnvelope) - 1)`.
Thus Synth owns phase and local fine structure; Voice owns the replacement
power envelope. No donor phase interpolation or phase vocoder is needed.
Nonexistent Synth components are never synthesized. A numerical denominator
threshold of 1e-24 power avoids division by numerical silence, not a user gate.
Voice silence closes the transfer after the chosen release; Synth silence
always produces silence, including while Voice is loud.

DC/Nyquist remain real; other bins are mirrored with conjugate symmetry.
Control smoothing uses the native graph's normal path, with transfer/envelope
settings observed each hop and Mix/Gain per sample. OLA windows blend frames.
Stereo states are independent. Output Gain is explicit dB; no hidden leveling,
limiter, clipping, carrier generator or automatic phase invention.

## State And Cost

One bounded, pool-allocated state per instance, capacity 64, about 0.15 MB each.
No allocation inside processing. Each hop performs four forward FFTs and two
inverse FFTs for stereo. Work is bounded but concentrated on hop boundaries;
native throughput is not a guarantee of every host's worst-case callback time.
Rate changes and explicit reset clear only local state. Nonfinite frames recover
locally with Error=1; the next valid processing clears the error.
Deleting the module releases its memory. Hiding the GL face does not alter DSP.

## Verification

- `test_spectral_cross_synthesis.mjs`: 44.1/48/96 kHz reconstruction, identical
  donors, dry alignment, silent donors, independent stereo, magnitude ownership
  and local nonfinite recovery.
- `test_spectral_cross_synthesis_graph.mjs`: stereo and single-cable fallback,
  controls, pool lifecycle and sample parity against the native module.
- `test_spectral_cross_synthesis_browser.mjs`: live audio, real parameter
  updates and shared GL desktop/mobile face.

Listening acceptance remains required. Later candidates: FFT-size handoff,
formant shift, envelope whitening and transient blend. No IR-loading workflow.
