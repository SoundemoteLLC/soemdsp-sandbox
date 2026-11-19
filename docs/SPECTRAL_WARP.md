# Spectral Shift / Warp

Native stereo module `spectralWarp`, type ID 279, Space category, wave badge,
7 GU default width. No samples/IRs, lookahead, JavaScript DSP or private renderer.

## Listening

Feed drums, speech or a harmonic oscillator into Mono or Left/Right.
Defaults are neutral: Warp 1, Pitch 0 st, Shift 0 Hz, Stereo Shift 0 Hz,
Pivot 1000 Hz, FFT Size 1024, Mix 100%, Gain 0 dB.

- Shift +100..500 Hz produces metallic, inharmonic translation.
- Warp 2, Pivot 1000 Hz sends 500 -> 250 Hz and 2000 -> 4000 Hz.
- Pitch +/-12 st doubles/halves warped partial frequencies.
- Stereo Shift 20..100 Hz spreads mono material in frequency. This is not panning.
- Larger FFT windows separate nearby partials; smaller windows are tighter.

The exact target for each detected partial is:

`Pivot * (inputHz / Pivot)^Warp * 2^(Pitch/12) + Shift +/- StereoShift/2`

Left takes minus half the Stereo Shift; right takes plus half. Thus the control
is the total right-minus-left Hz difference. Warp precedes Pitch, then both
additive shifts. At Warp 1 and zero additive shift, Pitch performs transposition.
Nonlinear Warp need not preserve harmonic relationships.

## Algorithm And Boundaries

The spectral-region approach is informed by Laroche and Dolson's
[phase-vocoder frequency-modification paper](https://www.ece.uvic.ca/~peterd/48409/Dobson1999.pdf).
This implementation groups bins around local spectral peaks, translates each
region rigidly, and keeps its relative complex phases together.

Phase differences between successive frames estimate peak frequencies beyond
integer bin centers. Integrated frequency-difference phase correction keeps
translated regions evolving continuously, inheriting correction through the
previous region when a peak moves. The FFT is centered at time zero before
fractional spectral interpolation, avoiding cancellation of adjacent Hann bins.
No amplitude threshold deletes small peaks; numerical silence is used only
when a previous phase estimate is unavailable.

Each stereo channel is independent. Mirrored complex bins make the output real;
DC/Nyquist use their one-sided normalization. Destination frequencies outside
0..Nyquist are rejected, never wrapped or folded back. Region edges can be
truncated. Fractional linear interpolation can change level; collisions between
regions can add or cancel. There is no hidden makeup gain, normalization,
limiter or amplitude clamp.

This is a sound-design processor, not a claim of transient-perfect,
formant-corrected musical pitch shifting. Nearby unresolved partials can move
together; dense/noisy material can sound phasey. FFT resolution, peak regrouping,
fractional interpolation and parameter changes affect the texture.
After returning to neutral controls, accumulated phase offsets are retained
instead of abruptly resetting them; neutral-from-reset reconstruction is tested.

The Bode Shifter browser entry is unimplemented; it is not an existing working
alternative. A future Hilbert/Bode shifter would provide a different,
low-buffering-latency linear-shift path without nonlinear Warp.

## Latency, State And Updates

FFT sizes 512, 1024, 2048, 4096, 8192, 16384; Hann analysis/synthesis with
fourfold overlap and hop N/4. Stable reference delay equals N samples for both
dry and wet. At 48 kHz this spans 10.67..341.33 ms; default 1024 is 21.33 ms.
There is no new host delay-compensation system.

Size changes warm the preallocated standby engine for N samples, then crossfade
over 50 ms. Rapid requests queue the latest size. The transition overlaps two
different delays and phase states, so temporary coloration is intentional.
The active latency getter changes when the handoff completes.

All continuous parameters use native graph smoothing. Mapping is observed at
hop boundaries and output Mix/Gain per sample. No processing-time allocation.
Two bounded max-size cores are allocated once from the native memory pool;
capacity is 64 subject to the pool budget. The state-bytes export reports
the actual allocation. Warm/fade temporarily doubles FFT processing.
Peak picking and region processing are O(N), plus FFT cost.
Worst-case host callback performance with many instances remains a separate test.

Invalid configuration holds the previous valid settings and raises Error.
Nonfinite audio recovery resets only local state; reset/rate change never
clears another module. Deleting the module releases its allocation.
The face uses shared GL 1D Trace and does not own audio processing.

## Verification

- `test_spectral_warp.mjs`: all six FFT sizes at 44.1/48/96 kHz; neutral and
  DC/Nyquist reconstruction, independent stereo, integer/fractional positive
  and negative shifts, nonlinear multitone mapping, pitch and stereo offsets,
  out-of-band rejection, queued FFT handoff and local recovery.
- `test_spectral_warp_graph.mjs`: mono/stereo routes, all mapped controls,
  direct/native sample parity and pool lifecycle.
- `test_spectral_warp_browser.mjs`: real Pitch/Stereo controls, native audio,
  16384/512 FFT handoff and shared GL desktop/mobile face at 7 GU.

Listening: base Warp/Shift accepted by Architect. Pitch and Stereo Shift await
listening confirmation. Spectral Morph remains parked.
