# FFT And Convolution Roadmap

Updated: 2026-11-18. Idea backlog and sequencing plan; not implemented features.
Baseline: `codex/convolution-resonator`. `[ ]` means proposed work.

## What This Plan Covers

FFT is a transform, not a separate effect family from STFT: STFT repeatedly
uses FFTs on windowed audio. This plan focuses on impulse-response design,
convolution, phase/dispersion and correlation. Time-varying spectral effects
and dynamics belong in [STFT_ROADMAP.md](STFT_ROADMAP.md).

Fixed convolution is a linear time-invariant filter: it can color, ring,
delay and smear incoming sound, but cannot generate new harmonics, transpose
frequencies or perform dynamics compression. A changing kernel is a different,
time-varying system and needs explicit transition/artefact handling.

These are candidates, not an instruction to create eight new module types.
Extend existing modules where the behavior and user interaction genuinely fit.

## Existing Foundations

- Noise Convolution Reverb generates shaped noise IRs and uses a direct head
  plus FFT partitions. Its immediate extreme-settings work has a separate
  [plan](NOISE_CONVOLUTION_REVERB_PLAN.md).
- Convolution Resonator already explores Buzz/String/Tube bodies and has an
  additional body-colored STFT path. Do not restore its removed filter-bank
  comparison or assume every resonator path is a finite convolution.
- Standalone IIR Vocoder is separate; see [VOCODER_ROADMAP.md](VOCODER_ROADMAP.md).

## 1. IR Designer

Goal: make a designed filter visible, editable and reusable as an IR.

- [ ] Begin with a bounded magnitude-response editor and deterministic FIR export.
- [ ] Explicit frequency axis, gain units, kernel length and output gain.
- [ ] Linear-phase mode with known delay and visible pre-ringing tradeoff.
- [ ] Minimum-phase mode as a separate tested design step. Define the magnitude
  floor needed for log-spectrum construction; do not hide it as audio clipping.
- [ ] Preview actual realized magnitude/phase, not just the requested curve.
- [ ] Later: smoothing, spectral tilt, notches and generic resource export/import.

Proof: impulse output equals the generated kernel; measured response matches
the requested curve within stated resolution/window limits. Account for design
delay separately from convolution-engine buffering latency.

## 2. Dispersion

Goal: frequency-dependent arrival time for chirping, springy or smeared attacks.

- [ ] Prototype a phase/group-delay curve with Amount and Frequency/Pivot.
- [ ] Compare a finite designed IR with a small allpass implementation before
  deciding the runtime. FFT need not be forced into an effect better served by IIR.
- [ ] Make direction, delay and dry/wet alignment explicit.
- [ ] Later: curve shape, stereo differences and animated dispersion.

Proof: plot group delay and magnitude; listen to impulses, kicks and pulse trains.
An ideal allpass preserves magnitude, but truncating its IR generally does not;
measure the approximation instead of promising perfect transparency.

## 3. Captured-Sound Convolution / Cross-Synthesis

Goal: use a captured sound as the filter for another sound.

- [ ] Signal input, separate capture source, Capture trigger and Ready state.
- [ ] Explicit capture duration, trim/start, endpoint taper and kernel gain.
- [ ] Audition the captured IR independently from the processed signal.
- [ ] First version freezes the capture; repeated capture replaces it through
  an intentional transition. Continuous convolution between two live streams
  is not an implied feature.
- [ ] Later: reverse, playback-rate resampling of the IR and resource loading.
  Resampling the IR changes its response, not the pitch of all incoming audio.
- [ ] Store captured IRs using existing asset conventions, not hidden patch blobs.

Proof: voice, glass, clap and drum captures yield deterministic convolution;
silence/very quiet captures do not cause automatic gain explosions. Normalization,
if offered, is explicit. No dependency on the future File Grid UI to prove capture.

## 4. Material Resonator

Goal: kernels that turn impulses into recognizable or invented struck objects.

- [ ] First compare the existing Convolution Resonator bodies with a small
  modal/IR material proof; identify genuinely missing behavior before adding a module.
- [ ] Candidate controls: Material, Fundamental/Size, Decay, Inharmonicity, Damping.
- [ ] Later: excitation position and stereo pickup placement.
- [ ] Choose finite IR versus recursive modal synthesis from measured cost and
  required decay/modulation behavior; do not require FFT for its own sake.

Proof: inspect modal frequencies/decays, low-frequency behavior, response to
single-sample excitation and sustained input. Retuning must have a defined policy.

## 5. Early Reflection Designer

Goal: tiny rooms, tunnels, slap clusters and impossible reflection geometry.

- [ ] Prototype reflection times, amplitudes, damping and stereo placement.
- [ ] Decide whether this belongs in Noise Convolution Reverb or a separate
  editable reflection tool after comparing the actual workflows.
- [ ] Candidate controls: Room Size, Reflection Density, Damping and Spread.
- [ ] Prefer sparse delay taps when cheaper than dense FFT convolution; support
  fractional-delay placement deliberately rather than quantizing casually.

Proof: impulse arrivals match specified paths; room-size edits do not produce
unintended glitches; stereo/mono behavior and direct-path handling are explicit.

## 6. Convolution Cabinet / Body Loader

Goal: consume imported cabinet, enclosure, microphone or instrument-body IRs.

- [ ] Load an audio resource as an IR without replacing the running patch.
- [ ] Define mono, dual-mono and true-stereo channel layouts; never infer a
  four-channel matrix from an ordinary stereo file.
- [ ] Controls: trim, gain, optional normalization, polarity and aligned Mix.
- [ ] Resample at load time, precompute partitions off the audio callback,
  enforce a reported memory capacity and expose load failures clearly.
- [ ] Decide whether this and Captured-Sound Convolution share one user-facing
  module with two kernel sources. Do not duplicate a loader merely for naming.

Proof: reference IR files produce expected output across sample rates, switching
does not drop unrelated audio, and missing assets are reported rather than ignored.

## 7. IR Morph

Goal: move between two acoustic signatures with an honest description of the math.

- [ ] Start with two loaded/generated IRs and an aligned output crossfade.
- [ ] Label this as a blend; parallel convolution is not structural feature morphing.
- [ ] Later: magnitude/phase interpolation or matched reflection/modal movement.
  Establish phase alignment and zero/null handling before promising smooth morphs.
- [ ] Check whether a two-slot kernel source in IR Designer/Loader is sufficient.

Proof: exact endpoints, controlled latency, predictable cancellation/level and
smooth automation. Do not hide loudness matching or normalize away the experiment.

## 8. Matched Filter / Correlation Detector

Goal: output a detection score/trigger when incoming audio resembles a reference.

- [ ] Capture/load reference, normalized score, threshold and retrigger interval.
- [ ] Define reversed/conjugated reference, time alignment and detection latency.
- [ ] Use direct correlation for short references and FFT blocks only where useful.
- [ ] Test gain variation, noise, timing offsets, false positives and silence;
  bound the normalization denominator explicitly.
- [ ] Keep it a similarity detector, not a promise of pitch-invariant or
  semantic sound recognition. Audio output is optional, not its core purpose.

## Proposed Order

1. Finish the scoped Noise Convolution short-IR/darkness milestone.
2. IR Designer: one designed kernel, measured response and audible proof.
3. Dispersion: compare FIR and allpass prototypes before choosing runtime.
4. Captured-Sound Convolution, then generic IR loading/persistence.
5. Material and reflection experiments; decide extension versus new module.
6. IR Morph and correlation detection as independent later milestones.

Architect can reorder by musical interest. No scheduler, cross-project framework
or broad shared convolution abstraction is authorized by this document alone.

## Common Verification And Delivery Gates

- [ ] Native C++/WASM processing, bounded owned state and no callback allocation.
- [ ] Shared WebGL displays only; no JavaScript DSP or Canvas2D fallback.
- [ ] Compare with direct convolution/correlation references, not only spectra.
- [ ] Verify FFT scaling, zero-padding, partition boundaries and overlap handling:
  accidental circular convolution/time aliasing is an implementation bug.
- [ ] Check DC/Nyquist, impulse, silence, stereo isolation and linearity at
  44.1/48/96 kHz. Fixed linear convolution must not generate new frequencies.
- [ ] Report kernel duration, pre-delay/design delay, engine latency and tail
  length separately. Tiny kernels must not inherit unnecessary block latency.
- [ ] Kernel transitions preserve appropriate input history and tails; define
  crossfade cost, queued edits and sample-rate-change behavior.
- [ ] Measure worst callback time, partition scheduling spikes, multiple-instance
  CPU, memory and teardown/reuse, not just average throughput.
- [ ] Native failures and missing assets are visible; no hidden audio clipping,
  gain normalization, legacy DSP fallback or unexplained silence.
- [ ] Per milestone record the controls/units, non-goals, native/reference tests,
  browser/listening result, resource costs, checkpoint and unresolved decisions.

This plan adds no compatibility-check requirement to the approved Noise
Convolution work. It also does not waive signal-correctness or stability tests.
