# Convolution Resonator Progress

Branch: `codex/convolution-resonator`

## Native Timing Proof

Implemented in a separate C++ native module:

- 64 instance handles; storage allocated on demand from the shared memory pool.
- Two independent delay channels, with exactly 2048 samples of latency.
- Unclipped samples; non-finite input clears both channels.
- Reset, destroy, capacity exhaustion, and released-storage reuse.
- Registered exports in the native build script.

`node scripts/test_convolution_resonator.mjs` passes against the standalone WASM.
The test covers exact impulse timing, signal identity after delay, stereo
isolation, instance isolation, non-finite recovery, handle exhaustion and reuse.

## Graph Integration

- Native type 268, dedicated create/destroy/dispatch and pooled-memory marking.
- Stereo routing uses stereo_route.h, including lone-side inputs and mono outs.
- Space-category Module Browser entry, native catalog, efficient-product
  allowlist and pass-through bypass classification.
- Existing lineBurn display; no JavaScript DSP or drawing fallback added.
- Only parameters whose DSP stages are implemented are exposed.

All 199 native modules and combined WASM build successfully.
`node scripts/test_convolution_resonator_graph.mjs` verifies eight graph routing
cases, exact delay, channel identity and native dispatch. A headless browser
boot confirms module discovery and node creation with no page errors.

Argi verified the delayed-dry path by listening to PolyBLEP through the module.
The separate headless browser Render Sample attempt stalled and was stopped;
this is not a passing browser Render Sample acceptance test.

## Buzz Body And Carrier

The wet path now runs a finite train of fractional-delay pulses. A normalized
16-tap windowed-sinc interpolator places each pulse between samples; each pulse
subtracts the mean of its following period, giving a finite DC-rejecting
harmonic sieve. An input DC blocker removes mic offsets before this body.
This is a linear filter at fixed controls, not an envelope/distortion effect.

- Frequency: 110 Hz default; wired f replaces it sample by sample.
- Size: 4 periods default, fractional last-pulse weight; range 1..8.
- Mix: fully wet default; dry retains its exact 2048-sample latency.
- Wet scheduling compensates the interpolator's 8-sample delay.
- BLIT saw carrier runs internally at the same pitch; not yet audible as a
  separate source or mixed with the body. It is prepared for the future STFT.
- History grows from the shared pool as required; no fixed pitch floor in DSP.

`node scripts/test_convolution_resonator_buzz.mjs` verifies harmonic rejection,
fractional tuning, linearity at 10x input, stereo, DC removal, carrier pitch,
range endpoints and finite audio-rate parameter modulation.
The combined-graph test also verifies audible wet output and f-jack replacement.

## Buzz Transitions

Frequency and Size changes now begin a definition-controlled transition
(20 ms default, 0..100 ms spawn range). Two valid FIR configurations share
the same retained input history and are blended with a smoothstep envelope.
Storage growth copies both configurations before releasing the old block;
reset clears transition state without discarding allocated capacity.

Transition = 0 selects direct sample-accurate retuning. With a nonzero
Transition, further edits update the destination filter without restarting
the active fade. This bounds the work to two filter evaluations per sample,
but is not a guarantee of click-free arbitrary rapid retargeting: an abrupt
change to the destination late in a fade can still be audible. The internal
BLIT carrier follows f directly; its eventual STFT transition is separate.

`node scripts/test_convolution_resonator_transitions.mjs` verifies exact
agreement with separately evaluated old/new FIR outputs for isolated pitch
and Size changes, plus finite rapid retargeting and reset during a fade.

String, Tube, the Body morph, STFT, Crunch and the final
parameter-pinned IR display are not implemented yet. Do not describe this as
the completed vocoder or as click-free for arbitrary modulation.

## Next

1. Diagnose the browser Render Sample stall, with a bounded test and diagnostics.
2. Listen to Buzz with voice/music and verify its Mix and f controls.
3. Listen to isolated note jumps and rapid retargeting; then implement String
   and Tube with matching IR probes.
4. Coordinate shared FFT extraction from Noise Convolution Reverb. Do not
   modify Sandy's worktree. The FFT remains private to her module at this point.
5. Fixed-size STFT, then Crunch transitions, anti-aliasing and pinned displays.

The 2048-sample latency is provisional until oversampled filter group delay is
known. All wet branches and dry must share the final reported latency.
