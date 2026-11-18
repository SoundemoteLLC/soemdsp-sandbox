# Convolution Resonator Progress

Branch: `codex/convolution-resonator`

Current runtime: active-pair, 2x-oversampled Crunch vocoder; **2184 samples**
reported latency. Earlier sections below record the successive proof stages.
Current face: native, parameter-pinned body IR and vocoder band kernels,
evaluated off-thread and presented through the shared WebGL picture device.
Current listening gate: the STFT implementation works but did not meet Argi's
Vocodex-like sound target. Argi confirmed that the IIR filter-bank comparison
has the desired family of character, especially very narrow, ringing bands.
It is now also available as a standalone Vocoder; no exact Vocodex-match claim
is made. The temporary comparison is now removed from Convolution Resonator;
all filter-bank features live in standalone Vocoder, with 5..100 bands.
Order and Flatness remain future work.

## Standalone Vocoder Extraction

- Native type 269, `native_modules/vocoder/vocoder.cpp`, category Analog Filter.
- Replaces the old parked Vocoder placeholder; no duplicate module or JS DSP.
- Voice L/R and Synth L/R inputs. One connected side of either pair feeds both
  channels; two connected sides are independent stereo. Mono averages L/R.
- Band Width (spawn range 0.001..4 oct), Follower (0..20 ms), Formant Shift,
  and Mix. Width remains editable near zero for narrow ringing bands.
- Originally 32 bands, rectified one-pole envelopes, independent stereo carrier filters.
  Mix blends the dry modulator, not a hidden oscillator or carrier passthrough.
- The bank and 2x resampler live beside Vocoder. Only the generic resampler is
  still shared by Convolution Resonator's STFT path; no bank DSP remains there.
- No STFT or body processing in the standalone path. Its resampling reference
  delay is 128 samples, not the resonator's 2184. IIR group delay/ringing still
  vary with frequency and bandwidth. Dry is delayed by the same 128 samples.
- State is allocated once at create through the shared pool, released on
  destroy; no audio-loop allocations, limiter, or automatic level correction.
- C++ metadata contains ports, parameter ranges and tooltips; a test enforces
  agreement with the existing UI definition path.
- Standard 1D Trace face uses the existing shared WebGL renderer/settings.

Verification: full 200-module standalone/combined build; `test_vocoder.mjs`
covers exact extracted DSP, latency, input absence, independent stereo,
graph/native parity, controls, 0.001-octave endpoints, non-finite recovery and
pool reuse. Existing resonator bank, STFT/AA and graph tests remain green.
`test_vocoder_browser.mjs` confirms creation in the default efficient build,
real AudioWorklet output, and a visible standard trace/controls on desktop
and mobile. The resonator browser display regression test also passes.
Warm WASM graph processing measured about 9..10% of one realtime budget at
48 kHz for one stereo 32-band instance on this machine. This includes graph
and resampling work, excludes UI, and is not a DAW CPU or 100-band estimate.

Listening: wire music/voice to Voice L/R and a bright oscillator to Synth L/R;
use Mix 1. Try Band Width 0.01 with Follower 0 for narrow ringing, then widen
the bands for overlap/crunch. There is no internal carrier in this module.
Standalone Vocoder was confirmed; the resonator comparison has been removed.

## Variable Band Count

- Standalone Vocoder now exposes Bands, integer 5..100, default 32. The
  original 32-band response remains unchanged in standalone Vocoder.
- Band centers cover the same 40 Hz..0.45*sampleRate range logarithmically.
  Band Width stays in octaves rather than being reinterpreted as band spacing.
  Count changes can change summed level; no hidden gain correction was added.
- Both filter layouts are preallocated at instance creation. A live count edit
  resets the inactive layout, runs it for 20 ms while retaining the old output,
  then smoothstep-crossfades for 20 ms. Very narrow filters still have their
  natural, longer settling/ringing time. Rapid edits queue the latest target
  instead of restarting fades; at most two banks run during a transition.
- Cold start/reset uses the selected count immediately. Permanent resampling
  reference delay stays 128 samples. No audio-loop allocations or memory growth.
- Native capacity is explicitly 100; metadata exposes that structural limit.
  The existing sample ABI is unchanged; count is passed through a new setter.
- Tests cover independent 5/16/32/64/100-band references, stereo, original
  32-band identity, warm-output preservation, rapid edits, latest-target
  convergence, capacity bounds, cold start, and allocation-free switching.
  Graph parameter slot Stages carries Bands; the real browser slider reaches
  100 while retaining the same AudioWorklet and producing output. Desktop and
  mobile faces remain visible with no page errors.
- Warm 48 kHz WASM graph benchmark: about 4% / 8% / 12% / 17% of one realtime
  budget at 5 / 32 / 64 / 100 bands respectively. This is one local Node/WASM
  measurement, not a DAW CPU reading; transition processing temporarily runs
  both layouts. Full 200-module build and focused resonator regressions pass.

Next listening proof: compare 5, 32, and 100 at Band Width 0.01, then widen
to hear the density/overlap change. Order and Flatness are deliberately not
folded into this count change.

## Comparison Removal

At Argi's request, Convolution Resonator is back to its single body/STFT path.
Removed the Filter Bank and raw-STFT comparison models, Model / Band Width /
Follower controls, model switching, warm-up/crossfade state, extra delay rings,
raw/bank processor allocations, native setter/export and worklet bindings.
Native version is 10. Buzz/String/Tube, Crunch, Response, Bandwidth, Formant
Shift, body/vocoder blend and the 2184-sample timing reference are retained.
The face again shows only the body IR and native STFT kernels.

The former comparison section below is historical, not an active feature.
Its core IIR tests now live in `scripts/test_vocoder_bank.mjs`; retired model
switching tests are deleted. Standalone Vocoder is not removed or altered.

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

## High-Frequency And Performance Pass

The production vocoder now runs at 2x sample rate. Frame lengths and hops also
double, preserving their base-rate durations/resolution. Input voice L/R and
carrier use a 257-tap symmetric Blackman halfband interpolator; synthesized
L/R use the matching anti-alias decimator. Polyphase sparse evaluation avoids
zero taps. Each filter contributes 64 base-rate samples, so the total nominal
reference is now **2048 + 8 + 128 = 2184 samples** (45.5 ms at 48 kHz).
Dry and body delay rings match this reference. The passband is retained through
the tested 20 kHz at 48 kHz; the unavoidable transition rolls off near Nyquist.
Analysis bandwidth normalization still uses the original base-rate frequency
domain, not the extra oversampled bins, avoiding an arbitrary level change.

Only the selected STFT pair runs. Retained input and frame-time controls span
twice the largest window. When a size wakes, the renderer reconstructs just
the N/H original frames whose OLA contributions overlap the present output,
ignoring already-past samples. This is not a cold reset or a guessed warm-up.
Tests compare the optimized 1x renderer against the all-warm reference over
changing Crunch/trim controls: **zero measured sample difference**. The
all-warm mode is test reference only, not a production fallback.

Zero carrier/voice frames are skipped only when their contribution is exactly
zero; previously scheduled OLA tails are retained. A burst-tail regression
test verifies this explicitly. Stereo channels keep separate envelopes,
history, resampler state and pending outputs.

Measured folded-sideband fixtures, normalized to their carrier:

- 26 kHz folded to 22 kHz: 1.312e-5 -> 9.313e-9 (63.0 dB reduction).
- 25 kHz folded to 23 kHz: 7.345e-3 -> 2.195e-6 (70.5 dB reduction).
- A second 26/22 kHz fixture: 3.552e-3 -> 1.797e-6 (65.9 dB reduction).
- Unity-envelope amplitudes at 1/12/20 kHz: 1.000000/1.000001/0.999988.
- 2x size-sweep reconstruction error at 12 kHz: about 1.04e-6, with a
  2176-base-sample vocoder/filter delay before the body's 8-sample reference.

These are specific measured improvements, **not a universal alias-free claim**.
Two-times oversampling does not remove every nonlinear/very-fast-modulation
product, and cannot undo aliases already generated by time-varying body
filters upstream. Physical frame duration still follows the base sample rate.

Node/WASM sample-call CPU fixtures on this machine show about 83-116 ms/audio
second at default Crunch and 142-204 ms at maximum for the new 2x path.
The prior unoptimized 1x checkpoint measured about 275-285 ms. The current
all-warm reference also benefits from silent-channel skipping and measures
roughly 170-185 ms; it is no longer an unchanged performance baseline. No
timing thresholds are enforced in tests. These are not browser/plugin deadline
benchmarks or many-instance guarantees. Pathologically frequent size-pair
changes can still create bursts of reconstruction work.

All seven focused scripts pass, including graph/native agreement, alias
fixtures, stereo scaling, range endpoints, reset/non-finite recovery and
latency. All 199 native modules built, followed by an incremental final
module relink after zero-frame skipping. Syntax and diff checks pass; cache
tag is cres8. No broader browser audio-reference smoke or REAPER benchmark
was run. Argi's live listening/performance acceptance remains the next gate.

## Parameter-Pinned Display

Convolution Resonator now owns a `convolutionResonatorFace` recipe, with no
captured audio source and no inherited Trace/Burn settings. New instances
default to 12 GU wide and an 8-GU face; existing saved dimensions are preserved.
The shared face creator, drawing pump, texture sizing and GL line/text renderer
handle presentation. There is no private canvas, 2D drawing or JS DSP fallback.

The upper plot is a unit-impulse response evaluated through the real native
body with its fixed latency removed. Its amplitude axis stays at +/-1, with
actual peak labeling and geometry clipping at the view edge, not value clamps
or automatic peak scaling. Small responses retain every sample. Long responses
use chronological bin extrema, retain the actual peak, and are explicitly
named "IR envelope." The display window is limited to 2 seconds / 192000
samples; a limited window says "tail continues" (or + at narrow sizes). This
is only a display budget, not a change to the audible decay.

The lower plot shows four native tone-probe kernels (100/500/2k/8k Hz), using
the production FFT, log-frequency smoother, formant interpolation, size
selection and blend law. They are explicitly peak-normalized **shapes**, not
output gain measurements or a complete nonlinear vocoder transfer function.
FFT-grid peaks are included in the frequency grid. Above-Nyquist probe anchors
are omitted rather than aliased. Frame counts and effective bandwidth appear
when there is room; compact heights show only the IR.

Only stored parameter values and the user's active knob drag drive the probe.
Wired frequency, input audio and live MOD/ghost values do not move the plots.
Sample rate comes from the existing audio-derivation source of truth, including
global engine oversampling. Resize remaps the same data without rerunning DSP.

A dedicated worker loads the standalone native module. It creates its own
probe handles and never touches the worklet. Main-thread requests coalesce
per face, stale results are discarded, and twelve bounded parameter snapshots
are cached. Every face instance has its own completion target, including
multiple views of the same node. Native loading/evaluation failures are
reported to the debug console and face, not silently reinterpreted in JS.

Verification:

- All previous seven focused DSP scripts still pass.
- `test_convolution_resonator_display.mjs` verifies exact native IR identity,
  preserved extrema/peaks, explicit tail limits, shift/bandwidth behavior,
  above-Nyquist anchor omission, pinning and isolation from running vocoders.
- `test_convolution_resonator_display_browser.mjs` verifies the actual worker
  and nonblank shared-GL pixels on desktop/mobile and a real one-GU resize.
  It finds no private canvas, no inherited settings, no page/probe errors, and
  no probe-key changes from unrelated Mix/Vocoder edits. Screenshots were
  inspected; temporary images are written to the OS temp directory.
- All 199 native modules and combined WASM built; a final probe-only correction
  was incrementally rebuilt/relinked. Syntax and diff checks pass. Cache tag:
  cres9. Broader audio-reference smoke and REAPER were not run for this step.

## Historical Filter-Bank Listening Experiment (Removed)

Following Argi's report that the STFT sound was not the desired Vocodex-like
character, add a bounded native comparison rather than assuming more STFT
polish will reach that sound. This is not a clone or a claim about Vocodex's
undocumented implementation.

Model choices:

- **STFT Body** (default): the existing body-colored STFT path, unchanged.
- **STFT Raw**: bypass Body on voice and carrier, retaining the existing BLIT
  oscillator and STFT settings. Eight alignment samples replace the bypassed
  body interpolator.
- **Filter Bank**: the same raw voice and BLIT carrier, 32 logarithmically
  spaced constant-peak TPT bandpasses. Rectified per-band voice signals run
  through one-pole envelopes and multiply corresponding synthesis bands.
  Left/right have separate analysis filters/envelopes and share carrier bands.

Analysis centers span 40 Hz to 0.45 * base sample rate. Formant Shift moves
synthesis centers, not carrier pitch. Unrepresentable synthesis bands fade at
Nyquist rather than wrap. Band Width sets nominal octave bandwidth through Q;
bilinear warping narrows the digital width near Nyquist. Follower is in **ms**
on the UI (default 0.25 ms), converted to seconds in the native graph binding.
Zero means instantaneous rectification; attack/release share a time constant.
Pi/2 calibrates a rectified unit sine's mean. There is no envelope amplitude
clamp, limiter, saturation, or automatic overlap/loudness compensation.

Both implementations use the same module-local 2x polyphase resampler. The
bank's extra alignment ring preserves the 2184-sample nominal timing reference.
Models warm for this latency before a 20 ms smoothstep crossfade. Reversals
preserve the current blend; a third request is queued until the ongoing
transition finishes. Only the active model and an in-transition target run;
inactive processors retain allocations but are reset before re-entry.

Use Vocoder=1 and Mix=1 for the raw A/B. Compare **STFT Raw** against **Filter
Bank**; Body/Size/Decay do not color either. Crunch/Response/Bandwidth belong
to STFT; Band Width/Follower belong to the bank. The face marks Body as
bypassed and shows bank readouts instead of falsely displaying STFT kernels
as a bank response. A bank response plot is intentionally not part of this
first listening proof. Existing body DSP still advances to preserve the
body-only blend, so sonic bypass is not a promise of zero body CPU cost.

Verification:

- `test_convolution_resonator_bank.mjs`: a pure 6 kHz voice/carrier produces
  an 18 kHz ripple ratio of 0.0496 with instantaneous followers vs 5.10e-5 at
  20 ms. Width changes the actual overlap. Stereo scaling, 10x input scaling,
  raw Body-bypass identity, sample-rate/range endpoints, reset/non-finite
  recovery, model modulation and preservation of old output during warm-up pass.
- All prior focused scripts pass, including the resampler/alias regression.
  Those STFT alias measurements do **not** certify every bank AM product.
- Graph tests compare all three models and non-default bank controls against
  direct native processing. Browser tests verify named Model choices, readable
  0.25 ms follower values, correct bank view and desktop/mobile/compact GL output.
  Screenshots were inspected. No page/probe errors are observed.
- All 199 native modules built; the final graph millisecond conversion was
  incrementally rebuilt/relinked. Diff and syntax checks pass. Cache tag:
  cres10. No REAPER test or broad audio-reference smoke was run here.

That listening experiment is historical. Filter-bank processing now belongs
only to standalone Vocoder; its retained bank-core tests are in
`test_vocoder_bank.mjs`. Convolution Resonator keeps its body-colored STFT path.

## Next

1. Diagnose the browser Render Sample stall, with a bounded test and diagnostics.
2. Listen to Buzz with voice/music and verify its Mix and f controls.
3. Argi verified that String can be played melodically and its buildup settles.
   Listen to Tube with Body = 1, Decay = 0.08 s and then longer decay; compare
   with String and sweep the intermediate body settings.
4. Continue filter-bank listening and development in standalone Vocoder only.
   Do not restore the removed comparison models to Convolution Resonator.
5. Coordinate adoption of the shared FFT by Noise Convolution Reverb without
   touching another agent's worktree. Refine after display acceptance, then
   plan a separate merge/release checkpoint; this worktree remains unmerged.

The current oversampled path reports 2184 samples of latency. All wet branches
and dry share that timing; the focused native and graph tests enforce it.
