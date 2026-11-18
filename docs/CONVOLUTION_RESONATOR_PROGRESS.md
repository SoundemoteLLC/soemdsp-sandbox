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

## String Body

Body now spans 0 (Buzz) to 0.5 (String). Buzz remains the default. The finite
pulse train shortens toward one pulse while a fractional-delay feedback loop
develops, using the shared comb core rather than mixing two finished effects.
The loop includes damping, a moving-period DC trap, and fundamental phase
compensation for damping and the Thiran fractional delay. Decay is a 1/e time
constant in seconds before frequency-dependent damping (0.08 s default).

Left, right and the internal BLIT carrier have independent loop state. Storage
grows from the shared pool while retaining history. Reset clears all tails.
There is no level-dependent limiter or saturation in the body.

`node scripts/test_convolution_resonator_string.mjs` checks ringing, decay,
linearity at 10x input, stereo isolation, finite range endpoints, modulation,
reset and fractional tuning. The current short-tail spectral measurement is
within 5.1 cents at 55 Hz and within 1.8 cents at 110.7 Hz and above; this is not
a claim of perfect low-frequency tuning. Native graph coverage checks that
Body and Decay actually change the ringing response through the graph.

The existing Transition control crossfades the Buzz excitation only, not the
String loop's feedback state. Fast Body/pitch edits still require listening;
finite-output tests are not a click-free guarantee.

All 199 native modules and the combined WASM rebuild successfully for this
milestone. All five focused Convolution Resonator test scripts pass, including
the combined graph. JavaScript syntax checks and `git diff --check` pass.
The old Python smoke entrypoint no longer exists in this checkout; the broader
browser audio-reference smoke was not run for this milestone.

## Tube Body

Body now spans 0 Buzz / 0.5 String / 1 closed-open Tube. The String endpoint
and default Buzz settings are unchanged. Above String, the string loop gain
and its DC-trap coupling recede while the tube section's direct feedthrough
recedes and modal residues develop. This is a cascade of physical filter
sections with varying coefficients, not a mix of two complete body renders.
Its intermediate IR is therefore the cascade's response, not a linear morph
of isolated String and Tube impulse responses.

The Tube section is a bank of two-pole bandpasses at (2n-1)*f. Each has zeros
at DC and Nyquist. Complex rotating pole state keeps the state transition
contractive as pitch changes, avoiding time-varying direct-form pole-state
energy pumping. Mode decay time is Decay/sqrt(2n-1), giving increasing wall
loss at upper modes; Decay is the fundamental's 1/e time. Mode density scales
excitation by sqrt(4*f/sampleRate). Modes fade over the top 20% of Nyquist
and leave the bank at Nyquist; newly entering modes start with clear state.
There is no fixed mode-count ceiling or pitch floor. Low pitches and audio-rate
retuning cost more: count follows Nyquist/f and coefficient changes update
the bank. No claim of constant CPU cost is made.

Voice left/right and the internal carrier have independent modal states.
No saturation or limiter was added. Returning fully to String clears dormant
tube state, so later re-entry cannot resurrect an old frozen tail. Reset also
clears history moved to the end of enlarged String storage.

`node scripts/test_convolution_resonator_tube.mjs` verifies odd/even response,
DC rejection, faster high-mode decay, level-independent linearity, dry latency,
finite morphs at 44.1/48/96 kHz and Nyquist boundaries, carrier finiteness,
endpoint continuity, intermediate-body settling, decay after a rapid melody,
and reset after storage growth. Browser listening remains Argi's acceptance
step; arbitrary modulation is not claimed alias-free or click-free.

All six focused Convolution Resonator scripts pass against the rebuilt native
binaries, including String/Tube graph controls. All 199 native modules built;
the final Tube coefficient change was then incrementally rebuilt and relinked
into the combined WASM. Syntax checks and `git diff --check` pass. No broader
browser audio-reference smoke was run in this milestone.

STFT, Crunch and the final parameter-pinned IR display remain unimplemented.

## Next

1. Diagnose the browser Render Sample stall, with a bounded test and diagnostics.
2. Listen to Buzz with voice/music and verify its Mix and f controls.
3. Argi verified that String can be played melodically and its buildup settles.
   Listen to Tube with Body = 1, Decay = 0.08 s and then longer decay; compare
   with String and sweep the intermediate body settings.
4. Coordinate shared FFT extraction from Noise Convolution Reverb. Do not
   modify Sandy's worktree. The FFT remains private to her module at this point.
5. Fixed-size STFT, then Crunch transitions, anti-aliasing and pinned displays.

The 2048-sample latency is provisional until oversampled filter group delay is
known. All wet branches and dry must share the final reported latency.
