# FFT Reconstruction

Updated: 2026-11-18. Under-construction placeholder in Sample Player.
Type reserved: `fftReconstruction`; label: FFT Reconstruction.

## Intent

A general buffered-audio FFT analysis/resynthesis module, not a module narrowly
named after stretching. Extreme time stretching is the first musical proof:
load or capture audio, move independently through its source timeline, and
reconstruct continuous output while the patch keeps playing.

This is a real-time instrument inside Sandbox, not an offline export utility.
The name does not imply that an FFT by itself stretches time. Analysis position,
phase evolution and overlap-add synthesis must be designed explicitly.

This is also not FFT convolution: it reconstructs selected analysis frames
from buffered source audio rather than applying an impulse response.

## Current Status

- [x] Module Browser placeholder in Sample Player, forced under construction.
- [x] No fake DSP, native stub, ports or user controls advertised as functional.
- [ ] Native C++/WASM implementation and runtime registration.
- [ ] Musical/listening acceptance.

Do not add a runtime type ID or JS fallback just to make the placeholder spawn.
Existing Spectral Blur and Spectral Freeze remain independently useful modules;
this plan does not authorize replacing them or inventing a common engine first.

## First Proof

1. Read a finite, immutable audio buffer using existing audio resource loading.
2. Reconstruct at normal source speed with a tested phase-coherent neutral path.
3. Decouple source-position advance from synthesis-hop advance.
4. Slow the source timeline drastically while continuing output phase evolution.
5. Hold source position without repeating a stale complex frame.
6. Compare coherent and intentionally diffuse synthesis on voice, percussion,
   sustained instruments and full mixes. Choose default character by listening.

No claim of Paulstretch equivalence or algorithm identity. The goal is a useful,
playable reconstruction instrument with its own measured behavior.

## Source And Timeline Contract

- Loaded resource and captured buffer are distinct source modes.
- Position is measured in source seconds; fractional-sample access is deliberate.
- Speed is a dimensionless source-time ratio: 1 = normal, 0 = held position,
  small positive values = slow source progression. Reverse is a later proof.
- If a Stretch readout is added, derive it from Speed; do not create two
  independent controls fighting over the same timeline.
- Source progression and output pitch must be independently defined. Simply
  reading PCM slower lowers pitch; that is not the desired time-stretch proof.
- Source/host sample-rate conversion must be accounted for explicitly.
- End-of-file, loops, seeks and source replacement each need a boundary policy
  and a crossfade. Do not wrap or clear a buffer silently.

## Live Capture

- [ ] Record wired mono/stereo audio into a bounded, preallocated native buffer.
- [ ] Start with capture-then-play: stop recording to create an immutable segment
  that can be stretched without an advancing writer overwriting its history.
- [ ] Later add continuous rolling capture with visible write/read cursors.
- [ ] Specify what happens when the writer overtakes a slow reader: hold a
  captured segment, wrap, or move to available history through an explicit
  transition. Infinite retention of a finite rolling buffer is impossible.
- [ ] Capacity is a real duration/memory budget, reported to the user. Resize or
  import happens outside the audio callback; failure leaves the old source valid.

Capture input audio remains wired. Resource selection can use the existing
registry/File Grid handoff; the grid owns browsing, not synthesis or source state.

## Proposed Controls (Not Yet A Final UI)

- Source selection: file/resource or captured buffer.
- Record/capture commands with explicit edge/gate behavior.
- Position in seconds and Speed ratio.
- Loop Start/End in seconds and an explicit Loop toggle.
- FFT Size in samples with discrete supported powers of two; show effective
  window duration, frequency resolution and processing delay.
- Phase character: coherent versus diffuse, or a properly defined amount.
- Output Gain in dB; stereo behavior defined, no hidden loudness normalization.
- Optional Pitch in semitones after the time-stretch proof is reliable.

Do not expose arbitrary normalized values for quantities with real physical
units. UI choice indices are bookkeeping; persisted choices/native IDs must
identify the actual supported FFT size. Use the shared app choice-control path.

## Reconstruction Requirements

- Native C++/WASM, existing tested FFT/window utilities, bounded instance state.
- Analysis and synthesis clocks are separate. Track phase advance so stationary
  tones retain intended pitch as the read head slows or stops.
- A diffuse/random-phase option should be intentional, stereo-aware and avoid
  cancellation-prone complex crossfades at partial settings.
- Use a proven reconstruction approach; verify phase locking/transient strategies
  before promising clean drums at extreme stretch ratios.
- FFT-size edits need a warm/transition policy. Source changes must not destroy
  unrelated graph state or stop other modules.
- Decouple resource IO/preparation from the audio callback. No callback allocation,
  file reads, unbounded FFT work or main-thread dependency for continuing playback.
- No compressor, saturation or limiter added to conceal bad reconstruction.
- Preserve separate stereo source channels and expose any decorrelation option.

## Display And Persistence

- Shared WebGL only: source waveform with read cursor, and write cursor in live
  mode. A spectral view is a later useful module-owned display mode.
- Show actual buffer duration, source position, window size and status as data.
- Asset references use existing samples/requiredAssets/resource conventions.
- Decide whether a captured segment is transient or exported as a patch asset;
  do not silently embed large PCM payloads into ordinary parameter JSON.
- Missing resources report errors without corrupting the current patch/source.

## Implementation Queue

1. Audit existing audio resource/PCM ownership and FFT reconstruction utilities.
2. Native finite-buffer normal-speed reconstruction proof, reference delay tested.
3. Independent source-time progression and coherent phase continuation.
4. Diffuse ambient mode and extreme slow/held positions; listening comparison.
5. Resource binding and playback controls in Sandbox, no duplicate file picker.
6. Finite live capture and capture-then-stretch workflow.
7. Continuous rolling capture only after overwrite/boundary behavior is agreed.
8. Optional pitch, loop/seek polish, spectral display and capture persistence.

One proof, one demo, one checkpoint, one report per substantial milestone.
No new shared renderer, cross-repo audio API or generic spectral framework is
approved merely because this module is described as general-purpose.

## Verification Gates

- Neutral reconstruction and pitch accuracy at 44.1/48/96 kHz and differing
  source/host rates; FFT scaling, DC/Nyquist and overlap-add boundaries.
- Very slow speed, held position, loop seams, seeks and source replacement.
- Stereo isolation/image, silent captures and short/empty/invalid resources.
- Worst-callback timing and memory at each FFT size, not only average CPU.
- Rapid controls, multiple instances, teardown/reuse and local non-finite recovery.
- Actual browser/worklet playback plus native reference tests; plugin latency
  reporting/compensation verified separately before a plugin release.
- Long playback should not drift in source position or quietly lose its buffer.
- Listening: no frame buzz mistaken for sustain, and no hidden processing that
  destroys the extreme contrast or diffuse texture the user wants to explore.

Related: [STFT roadmap](STFT_ROADMAP.md), [Spectral Cloud](SPECTRAL_CLOUD.md),
[Spectral Freeze](SPECTRAL_FREEZE.md), and
[FFT/convolution roadmap](FFT_CONVOLUTION_ROADMAP.md).
