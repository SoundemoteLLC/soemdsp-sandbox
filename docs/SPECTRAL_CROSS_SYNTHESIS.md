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
- Formant Shift -12 / +12 st: move the Voice envelope down/up an octave,
  leaving Synth's harmonic frequencies and phase unchanged.
- FFT Size 512..16384: smaller for tighter attacks, larger for finer spectral
  detail. Existing patches retain the 2048-sample default.
- Mix blends aligned dry Synth with wet. Voice is not directly mixed in.

This is distinct from Vocoder's logarithmic IIR bands and resonant ringing.
Convolution Resonator builds its own carrier; this module accepts an external
stereo Synth, retains its phase and spectral fine structure, and explicitly
normalizes its envelope before applying Voice's.
It is not Spectral Morph or an audio crossfade.

## DSP Contract

FFT sizes 512, 1024, 2048, 4096, 8192 and 16384; hop is size / 4. Hann
analysis/synthesis, 4x overlap and 2/3 overlap-add normalization. At stable size,
reference delay equals FFT Size, including dry Synth. At 48 kHz this spans
10.67..341.33 ms; default 2048 gives 42.67 ms. No new global host compensation.

Each channel analyzes Voice and Synth independently. Per-bin power follows
separate attack/release time constants, in ms. Prefix-sum neighborhood averaging
forms the broad envelope in O(N); Envelope Width is the full neighborhood width
in Hz. Fractional radii interpolate, with edge neighborhoods renormalized.
Formant Shift resamples the Voice envelope at bin / 2^(semitones/12), with
linear interpolation. Outside the source spectrum the envelope is zero, not
wrapped or clamped to the edge. Envelope Width applies before shifting.

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

One bounded, pool-allocated state per instance, capacity 64 subject to the pool
memory budget, about 2.23 MB each. Two max-size engines are preallocated.
No allocation inside processing. Each active hop performs four forward FFTs and two
inverse FFTs for stereo. Work is bounded but concentrated on hop boundaries;
native throughput is not a guarantee of every host's worst-case callback time.
FFT-size edits reset the standby engine, remap power-envelope estimates in Hz
with FFT normalization accounted for, warm for its full window, then crossfade
over 50 ms. New requests queue the latest desired size. Warm/fade temporarily
uses two engines and can color the sound as their different delays overlap.
The active-size/latency getter changes when the handoff finishes. A size setter
returns a local configuration error for unsupported sizes, never silently snaps.
Formant Shift uses the ordinary continuous parameter smoothing path.
Rate changes and explicit reset clear only local state. Nonfinite frames recover
locally with Error=1; the next valid processing clears the error.
Deleting the module releases its memory. Hiding the GL face does not alter DSP.

## Verification

- `test_spectral_cross_synthesis.mjs`: 44.1/48/96 kHz reconstruction, identical
  donors, dry alignment, silent donors, independent stereo, magnitude ownership
  and local nonfinite recovery.
- `test_spectral_cross_synthesis_graph.mjs`: stereo and single-cable fallback,
  FFT/formant controls, pool lifecycle and sample parity against the native module.
- `test_spectral_cross_synthesis_controls.mjs`: all FFT sizes reconstruct,
  positive/negative octave envelope ownership, queued warm handoffs, reset
  persistence and invalid configuration diagnostics.
- `test_spectral_cross_synthesis_browser.mjs`: live audio, real parameter
  updates and shared GL desktop/mobile face.

Base-module listening accepted. New FFT/formant controls await listening.
Whitening and Transient Blend are declared as hidden WIP parameters, with
modulation and parameter outputs disabled. They have no runtime bindings and
currently do nothing. No IR-loading workflow.
