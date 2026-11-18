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

These are candidates, not an instruction to create all of these module types.
Extend existing modules where the behavior and user interaction genuinely fit.

## No IR-Sample Workflow

Do not add IR-file loaders, captured-sound-as-IR modules or two-IR asset morphing.
Convolution kernels in this roadmap are generated internally from parameters,
geometry or mathematical designs; no imported/captured IR assets are required.
FFT Reconstruction is a separate FFT sample player and stays unchanged: ordinary
audio playback/resynthesis is not an IR-loading workflow.

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

- [ ] Begin with a bounded magnitude-response editor and deterministic FIR generation.
- [ ] Explicit frequency axis, gain units, kernel length and output gain.
- [ ] Linear-phase mode with known delay and visible pre-ringing tradeoff.
- [ ] Minimum-phase mode as a separate tested design step. Define the magnitude
  floor needed for log-spectrum construction; do not hide it as audio clipping.
- [ ] Preview actual realized magnitude/phase, not just the requested curve.
- [ ] Later: smoothing, spectral tilt and notches. Kernels remain internally generated.

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

## 3. Material Resonator

Goal: kernels that turn impulses into recognizable or invented struck objects.

- [ ] First compare the existing Convolution Resonator bodies with a small
  modal/IR material proof; identify genuinely missing behavior before adding a module.
- [ ] Candidate controls: Material, Fundamental/Size, Decay, Inharmonicity, Damping.
- [ ] Later: excitation position and stereo pickup placement.
- [ ] Choose finite IR versus recursive modal synthesis from measured cost and
  required decay/modulation behavior; do not require FFT for its own sake.

Proof: inspect modal frequencies/decays, low-frequency behavior, response to
single-sample excitation and sustained input. Retuning must have a defined policy.

## 4. Early Reflection Convolution

Goal: tiny rooms, tunnels, slap clusters and impossible reflection geometry.

The existing tap-based module is named Early Reflection Delay (stable type
`earlyReflections`). The implemented procedural room module is Early Reflection
Convolution; these are distinct modules, not two names for the same DSP.

- [x] Native rectangular-room IR proof: reflection times, inverse-distance gains,
  absorption, damping and spaced stereo receivers. See
  [EARLY_REFLECTION_CONVOLUTION.md](EARLY_REFLECTION_CONVOLUTION.md).
- [x] Separate Early Reflection Convolution module; Noise Convolution remains
  the dense noise-kernel tool, Early Reflection Delay remains the tap/drift tool.
- [x] Room dimensions, source/listener position, Order, Absorption, Damping,
  Ear Distance and Mix. Ready/Error expose kernel availability/capacity failures.
- [ ] Prefer sparse delay taps when cheaper than dense FFT convolution; support
  fractional-delay placement deliberately rather than quantizing casually.

Current proof uses two-sample fractional placement and dense convolution for the
damped path tails. Diffusion and listening acceptance are complete; sparse/dense
cost comparison remains.

Proof: impulse arrivals match specified paths; room-size edits do not produce
unintended glitches; stereo/mono behavior and direct-path handling are explicit.

## 5. Matched Filter / Correlation Detector

Goal: output a detection score/trigger when incoming audio resembles a reference.

- [ ] Capture/load reference, normalized score, threshold and retrigger interval.
- [ ] Define reversed/conjugated reference, time alignment and detection latency.
- [ ] Use direct correlation for short references and FFT blocks only where useful.
- [ ] Test gain variation, noise, timing offsets, false positives and silence;
  bound the normalization denominator explicitly.
- [ ] Keep it a similarity detector, not a promise of pitch-invariant or
  semantic sound recognition. Audio output is optional, not its core purpose.

## Proposed Order

1. Generated IR Designer: one mathematical kernel, measured response and audible proof.
2. Dispersion: compare generated FIR and allpass prototypes before choosing runtime.
3. Material experiments; compare existing resonators before adding another module.
4. Correlation detection as an independent later milestone. Its reference audio is
   not a room/cabinet IR-loading workflow.

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
