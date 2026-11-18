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

## Fixed-Size STFT Vocoder

The new Vocoder control blends between the retained body-only path (0, default)
and the vocoder (1). All three bodies tint both the measured input and the BLIT
carrier. Independent left/right spectral magnitudes shape the common carrier
phase, so the input phase never takes over the pitched source. Formant Shift
reindexes that envelope in semitones, interpolating positive values in
log-magnitude; bins outside the spectrum are dropped rather than wrapped.
DC and Nyquist bins are excluded from production spectral modulation.

The fixed engine uses 512-sample periodic Hann windows, 128-sample hops and
Hann synthesis scaled by 2/3. The squared four-window sum is 3/2. Streaming
analysis/synthesis has exactly 512 samples of reconstruction delay. The final
delay rings compensate this and the body's 8-sample interpolation delay,
retaining the 2048-sample nominal reference for dry, body and vocoder. Modified
spectral envelopes can spread transients within the analysis window; this is
not a promise of an identical impulse onset on processed and dry paths.

The STFT storage is pool-owned, allocated on first Vocoder use, and retained
until destroy. Once allocated it continues processing at zero blend, avoiding
frozen spectral tails on later blend changes. First activation still needs
the normal pipeline fill. Reset clears analysis and overlap-add state.

The reusable FFT header is adapted from Noise Convolution Reverb's radix-2
butterfly. This worktree does not change that reverb or another agent's tree;
migrating its private caller to the shared header remains a separate task.

`node scripts/test_convolution_resonator_vocoder.mjs` builds a test-only WASM
harness against the production headers. It verifies complex FFT round trips,
sample-accurate unity-envelope reconstruction including startup and DC,
envelope shift, carrier-phase ownership, silence, independent stereo levels,
and proportional level response. Standalone module tests cover audible
Buzz/String/Tube vocoding and reset. The graph test compares Vocoder and
Formant Shift directly against native reference processing.

This is the fixed-size proof, not the finished Crunch engine. Response-size
morphing, controllable spectral bandwidth, oversampled fast AM and the final
parameter-pinned IR display remain unimplemented. Shift changes at analysis
hops, not inside an FFT frame. No alias-free claim is made for arbitrary fast
modulation, and the broader browser audio-reference smoke is not part of this
milestone. Listening is still required.

Verification: all seven focused test scripts pass, including sample-for-sample
graph/reference comparison at 0 and +12 semitones. FFT round-trip error is
4.17e-7; unity-envelope streaming reconstruction error is 3.80e-7. All 199
native modules built, followed by an incremental final vocoder relink. Syntax
checks and `git diff --check` pass. The isolated server serves cache tag cres6.

## Crunch

The vocoder now keeps seven valid STFT streams warm: 32/64/128/256/512/1024/2048.
The smallest two use sliding hops of 1 and 2 samples; the rest use N/4. Each
periodic Hann analysis/synthesis pair uses the exact 8*H/(3*N) OLA scale.
All streams schedule onto a common 2048-sample reference. The body interpolator
requires another 8 samples, so total reported latency is now **2056 samples**
for dry, body and vocoder, independent of Crunch. Extra vocoder delay rings
were removed because each STFT now supplies its own aligned output.

Effective response is clamp(Crunch + Response, 0, 1), mapped logarithmically
from 2048 to 32 samples. Adjacent complete output streams blend with a
smoothstep, unity-gain crossfade. This deliberately replaces the plan's
equal-power recommendation: these streams are correlated, and equal-power
weights would create a 3 dB bump even for identical unity-envelope outputs.
No frame is resized, reset or switched cold. Keeping all seven streams warm
also replaces hop-boundary pair activation; the mixer alone can move each
sample while each frame's FFT and OLA remain internally consistent.

Effective bandwidth is clamp(Crunch + Bandwidth, 0, 1). A normalized two-sided
exponential kernel operates on log frequency. Width is ln(2)*b/(1-b); zero
means individual bins, and b=1 is exactly one mean over non-DC/non-Nyquist
bins. Both boundary normalization and flat-spectrum preservation are tested.
Crunch defaults to 0.25, with zero trims. For the previous fixed sound, use
Crunch=1/3, Response=0, Bandwidth=-1/3. Vocoder still defaults to zero to retain
the body-only audition path until enabled.

The harness now sweeps size boundaries and trims against the aligned
unity-envelope reference, with error about 4.2e-7 and no crossfade gain bump.
It also verifies the old 512-sample reference and full-band collapse. A 1 kHz
AM fixture produces sideband/carrier ratios about 0.0006 for long frames and
0.24 for short sliding frames. This demonstrates faster envelope tracking,
not added saturation. All earlier body contracts retain their behavior with
the new shared latency.

Cost is explicitly provisional: keeping seven streams warm took roughly
0.34-0.36 seconds to process one second of the changing-control harness on
this machine, including sample-by-sample JS/WASM test calls. This is not a
browser/plugin performance benchmark, nor a many-instance guarantee. A later
optimization must prove state-warm pair activation before replacing this
reference. There is no oversampled-AM finish yet, so fast modulation and
high-frequency aliasing must not be described as solved. Broader browser
audio-reference smoke was not run; Argi's listening is the next gate.

Verification: all seven focused scripts pass, including native Crunch/trim
modulation and two graph/reference control configurations. All 199 modules
and combined WASM build; syntax checks and `git diff --check` pass. Isolated
server cache tag is cres7. Work remains on the unmerged development branch.

## Next

1. Diagnose the browser Render Sample stall, with a bounded test and diagnostics.
2. Listen to Buzz with voice/music and verify its Mix and f controls.
3. Argi verified that String can be played melodically and its buildup settles.
   Listen to Tube with Body = 1, Decay = 0.08 s and then longer decay; compare
   with String and sweep the intermediate body settings.
4. Argi confirmed the fixed-size vocoder sounds good. Listen to the Crunch
   sweep with Vocoder=1 and zero trims, then try Response/Bandwidth separately.
5. Coordinate adoption of the shared FFT by Noise Convolution Reverb without
   touching another agent's worktree. Then performance/high-frequency finish and
   pinned displays.

The 2048-sample latency is provisional until oversampled filter group delay is
known. All wet branches and dry must share the final reported latency.
