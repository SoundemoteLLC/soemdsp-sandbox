# Vocoder Continued Development

Updated: 2026-11-18. Deferred roadmap: return after current STFT priorities.
`[x]` means implemented in this worktree; `[ ]` means proposed, not shipped.

## Intent And Boundary

Explore the range from extremely narrow, ringing bands to overlapping, crunchy
cross-synthesis. Vocodex is a listening reference, not a specification or a claim
that its proprietary implementation is known. User observations about flatness,
order and post-processing are hypotheses to test in our own design.

Standalone Vocoder owns IIR filter-bank development. Convolution Resonator's
temporary comparison path is removed and must stay removed. STFT effects have
their own [roadmap](STFT_ROADMAP.md).

## Current Baseline

- [x] Native C++/WASM, stereo Voice L/R and Synth L/R inputs; Mono/Left/Right outputs.
- [x] 5..100 logarithmic IIR bands; default 32, from 40 Hz to 90% of Nyquist.
- [x] Band Width in octaves, including narrow 0.001 settings; Follower in ms,
  Formant Shift in semitones, aligned dry/wet Mix.
- [x] 2x resampling; nominal 128-sample reference delay. IIR ringing/phase are
  frequency-dependent, not additional fixed latency that can simply be removed.
- [x] Preallocated old/new bank states; count edits warm for 20 ms then crossfade
  for 20 ms. Rapid changes retain the latest queued layout request.
- [x] No hidden output normalization/limiter; narrow widths can be quiet.
- [x] Native tests for widths, counts, range, stereo, scaling, graph routing,
  warm/fade behavior, memory reuse and allocation-free switching.
- [x] Shared GL trace. No dedicated filter-bank/envelope display yet.

## Phase 1: Make The Existing Instrument Legible

- [ ] Dedicated shared-GL view: analysis envelopes and synth band responses,
  with actual band centers, width and shifted centers visible.
- [ ] Listen selector: Vocoded / Voice / Synth. Keep aligned listening behavior
  explicit; bypass and Mix meanings must not change accidentally.
- [ ] Output Gain as an explicit control for level comparison, not hidden makeup.
- [ ] Presets: narrow/ringing, balanced speech, broad/crunchy, robot and percussion.
- [ ] Document high-count CPU costs, narrow-band settling and width-dependent level.

Acceptance: a user can understand why changing width/count changes tone and level
without relying on internal variable names. Presets must demonstrate the extremes.

## Phase 2: Envelope Articulation

- [ ] Separate Attack and Release, preserving existing Follower behavior for old
  patches through explicit migration/defaults, not a silent reinterpretation.
- [ ] Optional Hold for per-band articulation; physical milliseconds.
- [ ] Low-to-high timing tilt: slower lows / faster highs, with neutral zero.
- [ ] Envelope floor/depth and sensitivity for quiet detail; no concealed gate.
- [ ] Optional envelope contrast/compression amount with visible gain bounds.

Acceptance: test response in milliseconds across sample rates; compare fast ripple
and smooth speech; stereo behavior stays defined. Zero-time behavior remains an
intentional creative option, not automatically smoothed away.

## Phase 3: Order And Flatness Listening Proof

- [ ] Prototype selectable bandpass slope/order with bounded preallocated stages.
  Decide whether UI means poles, cascaded sections or slope in dB/oct; do not use
  an ambiguous label such as "4 order" without defining it.
- [ ] Revisit Q/width mapping and peak gain when cascading. Cascading unchanged
  filters narrows the response; it does not preserve the existing bandwidth.
- [ ] Prototype Flatness as a precisely defined response-shape/overlap control.
  Compare response plots and sound before choosing a topology or naming it.
- [ ] Structural order/topology changes need warm/crossfade handling like count.

Acceptance: measure actual frequency responses, overlap, peak/aggregate gain,
ringing, modulation artifacts and worst-case CPU at 100 bands. No promise that
four sections times 100 bands is affordable until measured in WASM and plugin.

## Phase 4: Consonants And Excitation

- [ ] Detect unvoiced/transient content using a documented voice-derived measure.
- [ ] Consonants To Noise amount: inject a shaped noise excitation into the synth
  path under that detector; keep noise generation and envelope transfer separate.
- [ ] Detector Sensitivity, frequency emphasis and noise tone, only as needed.
- [ ] Optional direct consonant/voice blend, clearly distinct from synthesized noise.
- [ ] Deterministic seed behavior and independent stereo excitation policy.

Acceptance: sibilants become intelligible without continuous hiss in silence;
audition detector and noise independently. This is not a claim of Vocodex parity.

## Phase 5: Optional Post-Processing

- [ ] Audition existing STFT Contrast or conventional dynamics after Vocoder first.
- [ ] Only integrate a dedicated "enhance"/contrast stage if a separate module
  cannot provide the needed workflow/sound. Specify its transfer law and meters.
- [ ] Keep saturation, compression, makeup and limiting explicit and bypassable.
- [ ] Consider spectral tilt and low/high cut before a broad effects bundle.

Non-goal: reverse-engineering or labeling an approximation as Soundgoodizer.
The user wants intelligibility, punch and crunch; listening proves that result.

## Phase 6: Advanced Mapping (Later)

- [ ] Analysis/synthesis low/high range controls with defined out-of-range behavior.
- [ ] Envelope band shift/warp independently of synth pitch and current formant shift.
- [ ] Optional per-band level/pan or editable mappings, after the simple UI works.
- [ ] Stereo linking/spread with explicit detector and excitation ownership.
- Decision: internal carrier belongs in a separate oscillator or explicit mode;
  do not add one merely because commercial vocoders bundle one.

## Verification And Return Queue

1. Capture baseline audio and benchmark current 5/32/100-band configurations.
2. Add diagnostic GL view/listening and explicit Output Gain.
3. Separate envelope timing; audition frequency-dependent response.
4. Prove order/flatness using response plots and matched-level listening.
5. Consonant noise, then decide whether post-processing should remain external.

Every step must preserve old patch intent or supply a tested migration. Test
mono/stereo/missing inputs, silence, impulses, speech, bass, percussion, synth
chords, rapid automation, graph edits and multiple instances. Check 44.1/48/96 kHz,
alias products, no callback allocation, reported latency, native capacity and
non-finite diagnostics. UI parameter ranges are not arbitrary DSP clamps.

Record each milestone's controls/units, before/after listening, CPU/memory,
automated checks, commit and remaining questions. No merge/release implied by
checking off a feature in this worktree.
