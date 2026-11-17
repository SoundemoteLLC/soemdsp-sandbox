# Convolution Resonator — plan

Status: **plan only, nothing built.** Requested by Argi via MasterBot on
2026-11-17. Another agent will implement it later. This document is the
brief: no code, no scaffolding in the tree.

Proposed key: `convolutionResonator`. Label: **Convolution Resonator**.
Internal type id: the next free `kType…` / `NATIVE_GRAPH_TYPE_IDS` number
at build time (as of `4faa8c06` the highest in-tree id is 266, Comb Pluck).
Keep the internal key stable so later patches load, even if the label
changes.

Category proposal: **object**, next to Formant Voice (`formantFilter`),
with store search notes covering vocoder, convolution, robot, crunch,
resonator, and voice. Category: `space`, with Dark Velvet Reverb (decided).

## Goal

One module you talk into. Its main control, **Crunch**, sweeps a single
character from a resonant, robotic voice (your voice through a
hyperfuturistic voice synth) to super crunchy.

The crunch is the Vocodex kind: wide, overlapping bands with a snappy
response time, so each band's envelope follower tracks the voice's actual
waveform (pitch ripple, glottal pulses) rather than its loudness contour,
and multiplies that onto a pitched carrier as audio-rate amplitude
modulation. That AM produces sidebands and intermodulation grit.

The convolution version of that idea:

1. The voice excites a short, pitch-tuned impulse response (the **Body**).
2. A frame-by-frame spectral multiply runs against a pitched **carrier**.
3. **Response** is the frame length (envelope integration time).
4. **Bandwidth** is spectral smoothing (how wide and overlapping the bands
   are).

Crunch drives Response and Bandwidth together by default.

## Argi's rules

These are part of the design, not optional polish.

- **All the math must be physically real.** Every stage is a real filter,
  convolution, STFT, or oscillator: no cosmetic distortion, no canned
  wavetables pretending to be a tube, no "digital grit" added after the
  fact. If a control has a physical meaning (frame length, smoothing
  width, modal frequencies, loop gain), that is what it does.
- **Explorable from top to bottom.** Every continuous control should be
  usable from slow and readable all the way to Nyquist, with no hidden
  walls. The only limits are the ones in the parameter definitions.
- **High frequencies stay pristine.** Windowing, overlap-add, time-varying
  frame length, and the aliasing that audio-rate AM can produce all have
  to be designed for, not ignored. See [High frequencies](#high-frequencies).
- **Parameter definitions are the only source of ranges.** No hardcoded
  clamps in the native module, the engine, or the face, except stability
  guards (non-finite → reset, Q or filter tuning kept below Nyquist so a
  pole does not explode). If a definition says a knob goes to 20 kHz or
  to a 4-sample frame, the DSP honors that.
- **Display scaling must not fake clipping.** If a trace or IR goes past
  the view, draw it to the edge and label the peak (the Comb Pluck
  "peak 1.83x" treatment), rather than silently rescaling or clipping
  the drawing so it looks limited.
- **No hover pop-ups or hover text in the UI.** Fill every definition
  `tooltip` field the way other modules do; those strings are for the
  parameter panel and documentation, not for hover.
- **Displays use WebGL via `public/lib/visual/gl-line-renderer.js`,
  pixel-for-pixel.** Curves and axes stay still unless a parameter
  changes. Flashes, playheads, and live glow traces are fine. Do not let
  a wired ƒ or the incoming voice rescale or shift the predicted curves
  (the Comb Resonator / Comb Pluck lesson).
- **Comb-family lesson: no clipper inside loops.** A loud hit or a
  ringing body may get as loud as it wants. The only runtime guard is a
  reset if a state value goes NaN or inf. Speaker Protection already
  mutes a bad output downstream.
- **DC handling where it is relevant.** A pulse-train body, a comb-like
  string, a tube modal series, and a 0 Hz FFT bin can all accumulate
  DC. Handle it in the place that actually has a 0 Hz resonance or a
  nonzero mean, not with a blunt filter that detunes the partials.

## Signal flow

Recommended path (one effect, not two effects in parallel):

```
  Voice In ── DC-block ──► Body (short tuned IR / running equivalent)
                                    │
                                    ▼
                              STFT analysis
                                    │
                          |X[k]|  →  spectral smooth (Bandwidth)
                                    │
                          Formant Shift (scale the frequency axis)
                                    │
                                    ▼
  Pitch ──► Carrier (Body-tinted) ── STFT ──► C[k] × E[k] ── iSTFT
                                    │                         │
                                    │                    delay dry
                                    ▼                         ▼
                                   Mix ◄─────────────── Voice (aligned)
                                    │
                                    ▼
                              Stereo Out
```

- **Body** is the resonant "you are speaking into a physical thing"
  stage. At constant pitch it is exactly convolution with a short, tuned
  IR. Pitch is allowed to move, so the audio path should be a running,
  physically equivalent system (modal bank, Karplus-Strong comb, or a
  finite BLIT pulse-train filter) that matches that IR when ƒ is held.
  Rebuild a snapshot IR for the display, and for a convolution
  crossfade only when a discrete Body change needs it.
- **Vocoder** is the STFT spectral multiply: the (smoothed, shifted)
  magnitude of the body-colored voice becomes a per-bin envelope `E[k]`,
  multiplied onto the carrier's complex spectrum `C[k]`, then overlap-add
  resynthesis. Using magnitude only for `E` (and the carrier's own phase)
  is the classic vocoder. Do not take the voice's phase onto the carrier
  if you want a locked, pitched robot rather than a phase-vocoder smear.
- **Carrier** is a pitched source at ƒ, with a timbre that follows Body
  (buzz, string, tube) so the one Body control keeps the two sides of
  the effect in the same family. See the open questions if Body should
  color only the voice.
- **Mix** is dry/wet, with the dry delayed by the same constant latency
  as the wet path so the blend does not comb against itself.

Stereo I/O follows `library/include/soemdsp/routing/stereo_route.h`
(the same rule as other stereo effects): inputs decide what is fed,
wired outputs decide which paths run. Per-channel envelopes so a panned
voice keeps its image. Shared Pitch. Optional slight L/R body
decorrelation is a later extra, not required for v1.

## DSP math

### Why this makes Vocodex-style crunch

A classical vocoder is a bank of bandpass filters on the voice, an
envelope follower on each band, and a multiply onto the matching band of
a carrier. When the bands are narrow and the followers are slow, you
hear a clean spectral silhouette: a robot. When the bands become wide
and overlapping and the followers become fast enough to track glottal
pulses (roughly 50–250 Hz ripple, not just the syllable contour), the
multiply is audio-rate AM: each carrier partial grows sum-and-difference
sidebands around the pulse rate, and overlapping bands intermodulate.
That is the crunch.

In this module:

- **Response (frame length)** is the envelope integration time. A long
  frame averages over many glottal periods, so `E[k]` is a loudness
  contour. A short frame sees individual pulses, so `E[k]` ripples at
  the voice's pitch and the multiply becomes AM.
- **Bandwidth (spectral smoothing)** is how much `E[k]` is shared across
  neighboring bins. Light smoothing ≈ narrow, separate bands. Heavy
  smoothing ≈ wide, overlapping bands (in the limit, one envelope for
  the whole spectrum: a wide-band AM).

Crunch simply walks both of those at once.

### STFT frames, hops, and a continuous Crunch

Use a real STFT, not a one-FFT-per-block sketch.

- Window: Hann (or another COLA-safe window; Hann is enough).
- Hop at a given size `N`: `H = N/4` (75% overlap). That is COLA for
  Hann and keeps high-frequency reconstruction clean. 50% overlap is
  not enough if the vocoder envelope is time-varying.
- Proposed size set, all powers of two: **32, 64, 128, 256, 512, 1024,
  2048**. At 48 kHz that is about 0.67 ms … 42.7 ms. The definitions
  must allow Response to go from a few samples up to the long end
  (and, if the definition max is raised later, the DSP should follow).
  See [Latency](#latency) for why the live path still pays a constant
  delay.

Frame length is a continuous parameter, but an STFT only exists at
discrete `N`. Morphing `N` inside a frame clicks, breaks COLA, and
smears high frequencies.

**Recommendation: run two adjacent sizes and crossfade their
resynthesized outputs.** If Response (after Crunch and the trim) sits
between `N_i` and `N_{i+1}`, both STFTs run, each with its own hop and
its own COLA-compliant OLA, and the two wet signals are equal-power
crossfaded by the fractional position. Switch the pair only at hop
boundaries. Never interpolate FFT bins of two different sizes, and
never change `N` mid-frame.

That is physically real (both paths are valid STFTs; the output is a
linear mix) and is how you get a click-free, continuous Crunch. A
constant-Q / warped-frequency STFT is a possible later alternative for
even spacing of Bandwidth in octaves, but it is a bigger build and
does not by itself solve time-varying frame length. Do not start there.

At the crunchy end (N = 32 or 64), a hop of `N/4` is still 8–16
samples, which is fast but not quite audio-rate. For those smallest
sizes only, drop the hop toward **1 or 2 samples** (a sliding STFT).
The cost is affordable at those sizes and is what lets `E[k]` follow
glottal pulses instead of staircase them. Keep `H = N/4` at 256 and
above, where a hop of 1 would be too expensive and is not needed.

### Spectral smoothing (Bandwidth)

After `|X[k]|` (or a complex-smoothed magnitude; do not throw away a
better estimator if a power-smoothed magnitude is stabler), smooth
along frequency:

- A one-pole or Gaussian smooth on a **log-frequency** axis, with a
  width in octaves set by Bandwidth. Linear-in-bins smoothing is cheaper
  but makes high frequencies relatively narrower than low ones; log-axis
  smoothing is the one that matches "overlapping vocoder bands" and
  stays honest as you sweep Formant Shift.
- Bandwidth = 0 (the definition minimum) is no smoothing: each bin is
  its own band, as narrow as the current window allows.
- Bandwidth = max is smoothing so wide that `E[k]` is effectively one
  number (a wide-band AM of the whole carrier). That is the "all the
  way to Nyquist, no walls" end: the user can actually get there.

Smoothing must be renormalized so a flat voice spectrum stays flat (no
gain bump in the middle of the axis, no HF loss from a truncated kernel
at the top bin).

### Formant Shift

Scale the frequency axis of `E[k]` before the multiply: a shift of
`+1` octave reads `E` at `k/2`. Interpolate between bins (cubic or at
least linear in log-magnitude). Energy that would be pulled from below
0 Hz or above Nyquist is dropped, not wrapped. This is a real spectral
translation of the envelope, not a pitch shift of the carrier. The
carrier stays on Pitch.

### How the AM crunch emerges, and whether a time-domain band path is needed

Short frames plus wide smoothing already are a vocoder whose envelopes
run at close to audio rate. `|STFT|` is a unipolar, window-smoothed
rectifier, which is the right kind of AM (sidebands), not four-quadrant
ring modulation.

**Recommendation for v1: do not build a parallel time-domain filter-bank
vocoder.** Stay on the spectral path above, with sliding hops at the
smallest sizes. A second, overlapping band path would be the more
literal Vocodex circuit, and it would have constant low latency, but it
is a whole second module's worth of work and would have to stay sonically
identical to the STFT path through the middle of the Crunch range or the
sweep will change identity mid-knob.

Build the time-domain path later only if, after listening, the short-STFT
end is not gritty enough (hop residue, or envelopes that still feel like
a contour). If that happens, crossfade into the band path at high Crunch
rather than running both as a blend of two different effects all the
time.

### Body: running system, IR as the specification

For each Body type, first define the LTI impulse response `h(t)` at a
held ƒ (the physical model). The audio path implements that same
system so ƒ can move without rebuilding a FIR every sample.

When ƒ jumps (keyboard steps, a MIDI-module pitch jack), crossfade to
the new system over a short, definition-level fade (Sandy's Noise
Convolution Reverb uses 20 ms; something in that range is fine) so the
body does not click. When ƒ glides, the running modal / comb / BLIT
state tracks continuously.

IR length is short: a body, not a reverb. Typical useful lengths are a
few periods (buzz) up to a few hundred milliseconds (metallic tube).
Sandy's partitioned overlap-save machine is built for tails up to 6 s
and is the wrong default tool here; a short FIR, a modal bank, or
`comb_core` is cheaper and lower latency. Reuse her FFT, her dual-bank
crossfade, and her memory-pool pattern if a convolution path is needed
for display or for a discrete Body jump.

Body IRs / systems are unity-energy (or otherwise level-normalized)
so Mix and Level stay meaningful across Body, Pitch, and Decay-like
settings.

### Body types (physically based)

Body is specified as "harmonic buzz, then string, then metallic tube."
Treat that as a **continuous 0…1 morph** with three named anchors
(0 = Buzz, 0.5 = String, 1 = Tube), interpolating the model parameters
(and, at a jump, crossfading running state). A 3-way switch is the
fallback if Argi prefers discrete types; see open questions. A dedicated
Body Decay / Size knob is not in the requested control set; each type
has a physically motivated default length, and a Decay trim is an open
question.

**Buzz (0) — band-limited pulse train.**

The IR is a short train of band-limited impulses at ƒ, windowed over a
small number of periods (about 1–8). This is the finite impulse response
of a harmonic sieve: teeth at `n·ƒ` up to Nyquist. The running form is
the same filter, or simply a brief feed of the voice into a BLIT-period
comb of known length.

Use `library/include/soemdsp/oscillator/blit_saw.h` (Stilson & Smith
BLIT, already shared by BLIT Oscillator and Formant Voice) for the
band-limited pulse itself. The header already subtracts the known average
`1/p` and leaky-integrates with a DC blocker at `f/20`. For the *IR*,
use the BLIT kernel (the impulse train, not the integrated saw) so the
body stays a pulse train, and remove DC explicitly (the train is unipolar
and would otherwise dump a large 0 Hz component into the vocoder).

The carrier at this Body setting is a BLIT saw or pulse (the same
kernel, running as an oscillator), i.e. a harmonic buzz locked to Pitch.

**String (0.5) — Karplus-Strong / modal string.**

The IR is the impulse response of a KS string at ƒ: a delay of
`D = fs/ƒ` (fractional, Thiran) with loop gain from a decay time and a
one-pole damping lowpass, exactly the model in
`library/include/soemdsp/filter/comb_core.h`. That header already has
the Thiran fractional delay, the `g = exp(-D/(τ·fs))` law, the damping
pole, the period-mean **DC trap** that removes the 0 Hz loop resonance
without detuning partials, and the NaN/inf reset with no clipper. Use
it. Polarity stays + (all harmonics) for a string; damping is slightly
higher than a bright comb so the IR stays short and body-like.

The running form is the same comb: the voice is the excitation, the
loop is the body. The carrier at this setting can be a low-level
impulse train or a very short noise burst into a second, quieter copy
of the same string (or a harmonic series with frequency-dependent
decay), so the carrier "sounds like a string" rather than a raw buzz.

**Metallic tube (1) — closed/open tube modal series.**

A straight tube has a closed-form modal series (`c` = speed of sound,
`L` chosen so the fundamental is ƒ):

- Open–open (or open tube): `f_n = n · c/(2L) = n·ƒ` (all harmonics).
- Closed–open (stopped tube): `f_n = (2n−1) · c/(4L) = (2n−1)·ƒ`
  (odd harmonics only).

"Metallic" means high Q: each mode is a decaying cosine (or a two-pole
resonator, the same thing Mode Ping uses) with a long decay relative
to Buzz, and with losses that grow with frequency (wall losses ~ sqrt(f)
are the physically standard term; include them so the top is bright
but not infinitely ringing). Default v1 to **closed–open** (the more
tube-like, hollow series). An open/closed switch is an open question,
not a v1 requirement.

The IR is the sum of those decaying cosines, truncated when the tail
is below a floor, with a short fade at the cut so the spectrum does
not ripple. The running form is a bank of the same two-pole modes
(reuse the Mode Ping / `tpt_svf` resonator math). No ±1 clamp in those
loops; NaN/inf reset only. Mode count should climb with ƒ down to
Nyquist and drop out (state cleared) as a mode approaches Nyquist, the
way Formant Voice already fades bands near 0.8–1.0 × Nyquist, so high
notes stay clean rather than aliasing.

The carrier at this setting is a modal buzz: a pulse or saw through
the same tube, or the tube's odd-harmonic series as a running
oscillator, so it stays in family.

**Morphing between anchors.** Interpolate the underlying parameters
(loop gain, damping, modal Q, odd-vs-all harmonic mix, IR length),
not the waveforms. A 50% Body should be a plausible in-between
physical system, not a sample-wise blend of two unrelated IRs, though
a short crossfade of running state is acceptable while the parameters
settle.

### Carrier

A monophonic pitched source at the Pitch jack / Frequency knob,
`resolve_osc_hz` for the same absolute-Hz law as the oscillators and
Comb Pluck. Never MIDI. Band-limited (BLIT / DSF / modal), never a
naive wavetable that aliases at high ƒ.

When Pitch is unwired, the Frequency knob is the pitch. When ƒ is
wired, that signal is the pitch every sample (absolute Hz), same as
Comb Pluck. Unwired default 110 Hz (or 220 Hz; open question).

### DC handling

- Input: a gentle DC blocker on the voice (a few hertz) so a padded
  or offset mic does not become a 0 Hz vocoder band.
- Buzz IR: subtract the mean of the finite train (in addition to the
  BLIT kernel's own average correction).
- String: use `comb_core`'s period-mean DC trap, not a highpass in
  the loop (a loop highpass detunes partials; that was the comb-family
  finding).
- Tube: cosine modes start at ƒ or 3ƒ, not at 0 Hz; still drop any
  numerical DC after a long ring.
- STFT: do not let the DC bin of `E[k]` modulate the carrier into a
  large offset. Either skip bin 0 or highpass `E` very gently.
- Output: no obligatory highpass that would thin the robot; only the
  blockers above.

### No clipper

No tanh, soft clip, or ±1 clamp in the body loops, the STFT path, or
the AM. If the product is loud, it is loud. Reset the module state
(body, FFT overlap, envelopes) only when a value is non-finite.

## High frequencies

Four places HF goes dull or harsh if they are ignored:

1. **Windowing.** Hann (or better) only. A rectangular frame will
   leak and smear the top. The analysis and synthesis windows must
   satisfy COLA at the chosen hop, including the sliding-hop case at
   small `N` (use the appropriate hop-normalized synthesis gain).
2. **Overlap-add.** Keep a running OLA buffer per frame size. Gain
   must be exact for a flat `E` and a unit carrier: a sine going in
   at Mix = 0 (dry, delay-aligned) or a bypassed envelope must come
   out without amplitude ripple. Test this.
3. **Time-varying frame length.** Only the adjacent-size crossfade
   above. No intra-frame `N` changes, no bin-width interpolation
   between different FFTs. The dry delay does not change with
   Crunch (see Latency).
4. **Aliasing from audio-rate AM.** `carrier × envelope` produces
   sum and difference frequencies. When `E` is snappy, it has HF
   energy, and those products can fold. The physically correct fix
   is to **oversample the multiply** (2× is the v1 default: upsample
   the post-OLA carrier and the broadband envelope, multiply, then
   a proper halfband down). Band-limiting `E` alone would fight the
   crunch. Do not add a post-clipper to "hide" the aliases.

The smallest frames also have very coarse bin spacing; Bandwidth
smoothing and Formant Shift interpolation have to behave at the top
bin, not fall off because the kernel ran out of neighbors.

## Crunch coupling, and the override

Crunch is the macro. Response and Bandwidth are fine controls.

**Default law (when the trims are 0):**

- Crunch = 0: long frames (2048), narrow smoothing (no / near-zero
  Bandwidth) → clean, ringing robot.
- Crunch = 1: short frames (32), wide smoothing (full Bandwidth) →
  full crunch.
- In between: a smooth, perceptually even walk. Response moves on a
  **log-time** curve (so the middle of the knob is a musically useful
  frame, not 1000 samples from the top). Bandwidth moves on a
  **log-octave** curve. The two share the same Crunch position; they
  are not independently randomized.

**Override: Response and Bandwidth are bipolar trims around that
law, default 0, with enough range to reach either extreme at any
Crunch.** Moving Crunch always moves both; trimming Response only
changes frame length; trimming Bandwidth only changes smoothing.
There is no hidden "last knob wins" or unlink state, which is hard
to show, hard to save in a patch, and easy to desync.

The effective Response and Bandwidth are still clipped only by their
definition min/max (so a Crunch=1 plus a "longer" Response trim can
sit at the long end of the definition, and vice versa). If Argi
would rather have absolute Response / Bandwidth knobs plus an Unlink
switch, that is an open question; the trim model is the one to
build unless he says otherwise.

The face can show the effective frame time and effective smoothing
width (numbers or a small readout) so the coupling is visible,
without hover text.

## Pitch, MIDI, and stereo

- **Pitch is a plain signal input**, labeled ƒ, plus a Frequency
  knob used when ƒ is unwired. The cable comes from the keyboard or
  from a MIDI module's output. **Never MIDI itself.** Hard MIDI
  split: only MIDI modules handle MIDI. Same pattern as Comb Pluck
  and the oscillators (`resolve_osc_hz`, absolute Hz).
- Inputs: `In` (Mono), `Left`, `Right`, `f` (ƒ).
- Outputs: Mono, Left, Right.
- Stereo routing: `stereo_route.h`, as above.

## Latency

The STFT path has a latency on the order of the analysis window
(plus any oversampled-AM group delay). If that latency followed
Crunch, the Mix alignment would drift, the dry/wet would comb, and
a live voice would hear a pitchy delay modulation while turning the
knob.

**Hold a constant latency equal to the largest window in the size
set (2048 samples, about 42.7 ms at 48 kHz), plus a fixed hop or
filter delay, and delay the dry by the same amount.** Short-frame
paths are computed "on time" and then delayed to the same
alignment. Crunch does not change delay.

This is the right trade for a clean sweep. It does mean the
crunchy end is not extra-snappy in *wall-clock* response, only in
envelope integration time. If 43 ms is too sluggish for a talkbox,
drop the size set's top to 1024 (~21 ms) or 512 (~11 ms) and accept
a less "ringing / narrow-band" clean end — that is an open
question, not something to leave floating at runtime.

Report the constant latency if the engine has a place for it, so
downstream alignment (and any future PDC) can use it.

The Body path itself should be near zero extra latency (running
comb / modal / short FIR). Do not put the body through Sandy's
long partitioned-convolution scheduler.

## CPU and memory budget

This is a heavyweight effect. Budget for one instance, stereo, 48 kHz,
block 128, with Crunch mid-range (two adjacent STFTs running):

- Two frame sizes × (voice FFT + carrier FFT + iSTFT) × two channels,
  plus log-axis smoothing, plus 2× AM at the crunchy end, plus the
  body (comb or a modal bank of some tens of modes).
- Worst case is the 1024/2048 pair with 75% overlap. That should stay
  comfortable on a desktop live session with a handful of other
  native modules, but it will not be a cheap module. Mitigations
  that are allowed because they do not change the math: skip work on
  trailing silence (Sandy already tracks a `silentAge` in her
  convolution reverb), run only the sizes that the current Crunch
  actually needs, and use `soemdsp::memory_pool` for the FFT
  scratch, OLA buffers, and any IR snapshot (APP_POLICY 2b: pay for
  what you use; the engine has no malloc).
- Float FFTs are fine (Sandy's in-file `fft_radix2` is float).
  Double is not required for this path.
- SIMD can wait; correctness first.
- Instance cap: follow other heavy modules (64 is Sandy's
  convolution cap; 128 is Velvet Reverb). 64 is enough.

## Parameter table

All ranges live only in the definition. Fill every `tooltip`. Continuous
params are sample-accurate (`control_frame` / `control_audio` in the
graph engine; see `docs/PARAM_CONSUMPTION_AUDIT.md` and
`docs/ADDING_HARDCODED_SANDBOX_MODULE.md`). Body is a continuous morph
(or a discrete choice, if that open question lands the other way).

| Key | Label | Range | Default | Curve / kind | Notes |
|---|---|---|---|---|---|
| `crunch` | Crunch | 0 … 1 | 0.25 | linear, unit `%` | Macro: 0 = long / narrow (clean robot), 1 = short / wide (full crunch). Drives Response and Bandwidth when their trims are 0. |
| `frequency` | Frequency | 10 … 20000 Hz, mid 110 | 110 | `kind: "frequency"` | Used when ƒ is unwired. Same law as Comb Pluck / oscillators. |
| `body` | Body | 0 … 1 | 0 | linear, three anchors | 0 = Harmonic Buzz, 0.5 = String, 1 = Metallic Tube. Morph, not a hard switch (unless Argi prefers a switch). |
| `response` | Response | −1 … +1 | 0 | linear, bipolar trim | Fine control. 0 = the Crunch-law frame length. Negative = longer, positive = shorter, enough to reach the definition ends. Effective frame time is log-mapped between the size-set extremes (32 … 2048 samples at 48 kHz, and the equivalent time at other rates). |
| `bandwidth` | Bandwidth | −1 … +1 | 0 | linear, bipolar trim | Fine control. 0 = the Crunch-law smoothing. Negative = narrower, positive = wider, from no smoothing to a fully collapsed wide-band AM. |
| `formantShift` | Formant Shift | −24 … +24 st | 0 | linear, unit st | Scales the envelope's frequency axis. Carrier pitch is unchanged. |
| `mix` | Mix | 0 … 1 | 1 | linear, unit `%` | 0 = delay-aligned dry, 1 = wet. Default wet, since this is a "talk into it" module. |

Jacks (not parameters): `In`, `Left`, `Right`, `f` (ƒ). Outputs: Mono,
Left, Right. Each parameter also gets its automatic MOD port.

No MIDI jack. No hidden clamps. If a Body Decay / Size, carrier Level,
or open/closed tube switch is added later, it goes on this table first.

## Display

WebGL only, through `public/lib/visual/gl-line-renderer.js`,
pixel-for-pixel, same path as the comb-family hit view
(`public/modules/combPluck/pluck-hit-display.js`). Faces read engine
outputs (hidden display taps or accessors); they do no DSP.

**What is parameter-driven and must stay still unless a knob
changes** (pin these to the Frequency *knob*, Body, Crunch, Response,
Bandwidth, Formant Shift — not to the live ƒ cable and not to the
incoming voice):

- The Body IR (time), drawn from the snapshot IR at the knob pitch.
- The Body's magnitude spectrum, if shown.
- A frequency-axis picture of the vocoder bands: lobe width from
  Bandwidth, frame-length ruler from Response, Formant Shift as a
  displacement of that envelope axis.
- Axes, ticks, and dB / time / Hz markings.

**What may move every hit or every frame (flashes are fine):**

- A live phosphor / glow trace of the current voice envelope or a
  playhead on the IR, which must not rescale the axes. If a live
  peak exceeds the view, leave the axis alone and show a peak
  label, no fake clip.

Suggested default face: the band/envelope view, because Crunch is
the main control and that view shows what Crunch is doing. A
second mode can show the Body IR. `customDisplayArea: true`, one or
two `displayModes`, default `face`.

No hover pop-ups. No tooltip bubbles on the canvas.

## Research: what already exists

### Sandy's Noise Convolution Reverb (the important one)

This is **not on `master`**. As of 2026-11-17, 12:01 PM
America/Phoenix, it lives uncommitted in Sandy's worktree:

- Worktree: `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox-sandy-nconv`
  (branch `sandy-nconv`, currently checked out at `7e1c3ac3`).
- The only module file so far:
  `native_modules/noise_conv_reverb/noise_conv_reverb.cpp`
  (about 9 KB / 917 lines, still a WIP; there is no catalog entry,
  no definition, no display, and no graph_engine hook yet).
- A `_write_nconv.py` in that worktree is gitignored and is not
  part of the module.

It is a generated-noise, stereo, **zero-latency partitioned
convolution** reverb. Concrete pieces a later agent can reuse,
with the line numbers in that WIP file:

| Piece | Where | Reuse for Convolution Resonator? |
|---|---|---|
| In-file radix-2 FFT (`fft_radix2`, twiddles from `soemdsp_maths::dsp_sin_cos_turns`, inverse 1/N scaled) | `noise_conv_reverb.cpp` ~L71–106 | **Yes.** Factor into a shared header such as `library/include/soemdsp/fft/fft_radix2.h`, in coordination with Sandy, so her reverb and this module do not each own a copy. There is no FFT in `library/include/soemdsp` on master today (no kissfft / pffft / pocketfft either). |
| Overlap-save partitioned convolution: time-domain **head of 128 samples**, then non-uniform partitions that grow in hop (128, 256, … up to 4096) and stay uniform at the largest hop; frequency-delay line; complex multiply + IFFT of the saved overlap (`place_partitions`, `process_finished_hop`, `feed_sizes`, `add_head`) | ~L31–35, L119–154, L274–297, L493–611 | **Only if we need a long FIR.** Body IRs are short and tuned, so this scheduler is the wrong default. The multiply + IFFT and the overlap buffers are the useful pattern for the vocoder STFT, not the 6 s partition plan. |
| IR generation (Gaussian noise, Step Graph `segment_rational01` amp and spectral shapes, time-varying one-pole pair from Brightness → Darkness, Decorrelate, unity-power normalize, 20 ms tail fade) | ~L362–442, includes `segment_curves.h`, `exp_log.h`, `analog_filter_trig.h` | **IR-build discipline, not the noise IR itself.** We synthesize Buzz / String / Tube, not shaped noise. Do reuse `segment_rational01` / `segment_contour_soft_cap` if any shape knob wants the Step Graph curve. |
| Dual-bank IR + 20 ms wet crossfade; incremental build across audio blocks (`kBuildSamplesPerCall`, `kBuildFftsPerCall`) so a parameter move does not click or glitch the callback | ~L37–39, L156–188, L480–491, L629+ | **Yes**, for Body or size-set changes that need a rebuild. |
| `soemdsp::memory_pool` block allocation, 16-byte align, `block_bytes_for` | `library/include/soemdsp/utility/memory_pool.h`; ~L210–244, L323+ | **Yes.** Same wasm memory rule as Velvet Reverb and the delays. |
| Native ABI: `create` / `destroy` / `reset` / `set_seed` / `sample` / `process_block` / block in·out·mix pointers / `block_max_frames` / `block_bytes` / version, plus **IR accessors** (`ir_length`, `ir_sample`) for a display | ~L782–914 | **Yes**, including IR (or envelope) accessors so the face does no DSP. |
| Denormal flush, NaN-safe sanitize, silence ageing | throughout | **Yes**, plus a true non-finite state reset (comb-family style) rather than only flushing denormals. |
| Stereo L/R, Mix as a wet gain | `process_run` | **Yes**, but Mix here is dry/wet with delay-aligned dry, not wet-only. |

Do not treat this WIP as a stable API. Coordinate with Sandy before
factoring the FFT out of her file. If her module has not landed when
this one is built, copy the FFT into the shared header first and
leave her a note; do not edit her worktree as part of this work.

**Dark Velvet Reverb** (`native_modules/velvet_reverb/velvet_reverb.cpp`,
`velvetNoise` / `velvetReverb`) is a time-domain sparse-tap (velvet
noise) FIR, not an FFT convolution. Useful as another "convolution
feeling" reverb and as a reference for display accessors, memory-pool
use, `process_block` ABI, and catalog / build-script shape. It does
not provide an FFT or a partitioned scheduler. Sabrina Reverb and
SoEmReverb are unrelated (Sabrina is frozen).

### Other in-tree pieces

- `library/include/soemdsp/filter/comb_core.h` — Thiran KS comb,
  damping, Decay law, period-mean DC trap, NaN/inf reset, no clipper.
  The String body should use this. Used by Comb Resonator and Comb
  Pluck.
- `library/include/soemdsp/trigger/pluck_exciter.h` — Bump / Noise /
  Edge exciters for the pluck family. Not the Body IR, but the Edge /
  DC-free burst thinking is adjacent if a carrier needs a strike.
- `library/include/soemdsp/oscillator/blit_saw.h` — band-limited
  impulse train and leaky-integrated saw, DC-aware. Buzz body and
  buzz carrier.
- `library/include/soemdsp/oscillator/dsf_sawmorph.h` and
  `native_modules/dsf_oscillator/dsf_oscillator.cpp` — alternative
  band-limited buzz if BLIT is not the right color.
- `native_modules/mode_resonator/` and `process_mode_resonator` in
  `graph_engine.cpp` — two-pole pitched resonator (Mode Ping). Tube
  modes can reuse that resonator math; do not reuse any remaining
  loop clamp if one is still present, and do not reuse the trigger
  / pluck interface.
- `library/include/soemdsp/filter/tpt_svf.h` — TPT SVF, already the
  Formant Voice / EQ Filter bandpass. A later time-domain vocoder
  bank, or tube modes, can use it.
- `native_modules/formant_filter/formant_filter.cpp` (Formant Voice)
  — closest existing "voice" module: BLIT source, five formant SVFs,
  Shift in octaves, Nyquist-aware band fade, ADAA drive, response
  evaluator for the display. This module is not a vocoder and should
  not copy the vowel paths, but Shift, the Nyquist fade, and the
  "eval the same maths the audio uses" display pattern are the
  reference.
- `native_modules/flower_child_envelope_follower/flower_child_envelope_follower.cpp`
  — A/H/D peak follower on `abs(input)`, with a hardcoded clamp to
  `[0, 1]`. Too slow-stepped, and too clamped, to be the audio-rate
  AM envelope. Do not route the vocoder through it. Other envelopes
  (pluck, ping, vactrol, resonant, linear, robin leaky, thump) are
  also the wrong shape for this.
- **There is no vocoder module and no STFT vocoder in the tree.**
  Spectrograms (`public/modules/spectrogram/`,
  `public/modules/circularSpectrogram/`) are displays, not DSP.
  `docs/LOFI_PITCH_SHIFT_PLAN.md` discusses a phase vocoder only as
  a thing to avoid for that pitch shifter (granular is the plan
  there); it is not a reusable engine.
- `library/include/soemdsp/math/segment_curves.h` — Step Graph
  curves, source of truth for `[0,1]` + contour. Sandy already uses
  `segment_rational01` on her IR amp/spectrum shapes. Available if
  a shape control needs it; Crunch itself should stay a simple log
  map, not a Step Graph skew, unless Argi asks.
- `library/include/soemdsp/routing/stereo_route.h` — stereo I/O
  rule, the one source of truth.
- `library/include/soemdsp/utility/memory_pool.h` — shared wasm
  pool for big buffers.
- `library/include/soemdsp/math/seed.h`, `noise.h`,
  `lagged_fibonacci.h` — only if a body or carrier needs a seed
  (not in the v1 control set).
- `docs/ADDING_HARDCODED_SANDBOX_MODULE.md` — how to add the
  module. `docs/MODULE_PATTERN_REFERENCE.md` and
  `docs/PARAM_CONSUMPTION_AUDIT.md` — definition and sample-accurate
  param rules. `docs/COMB_PLUCK_PLAN.md` — family context, not a
  template for the DSP.

### How a native module is added

Follow `docs/ADDING_HARDCODED_SANDBOX_MODULE.md`. DSP is C++ only,
in the combined wasm (`native_modules/combined/soemdsp_combined.wasm`).
No JS evaluator, no worklet DSP. JS is definitions, plumbing, faces,
and displays. Render Sample and Live Audio run the same engine.

Because the DSP is large (FFT, body, STFT, oversampled AM), this
should be a **separate native module**
(`native_modules/convolution_resonator/convolution_resonator.cpp`)
with a handle pool, not inlined into `graph_engine.cpp`. Edit
points:

1. `native_modules/graph_engine/graph_engine.cpp` — `kType…` id;
   param-slot defaults; `process_convolution_resonator`; dispatch;
   `extern "C"` create/destroy; `needsNative` list; any display
   accessor exports.
2. `scripts/build_native_modules.ps1` — a `@{ Name =
   "convolution_resonator"; Simd = $false; Exports = @(…) }` entry
   (see the `velvet_reverb` entry for a `process_block` + accessor
   export list), plus any new graph exports on the `graph_engine`
   item. Run the script to rebuild the combined wasm.
3. Bump the `soemdsp_combined.wasm?v=` tag in
   `public/node-graph-live-runtime.js` (current tag as of this plan
   is the long `2026.11.16.7-…-vfltdef1` string).
4. `public/node-graph-module-definitions.js` — `nodeGraphNodeLabels`
   and `nodeGraphModuleDefinitions.convolutionResonator` (jacks,
   parameters, face, tooltips, display mode).
5. `public/node-live-audio-worklet-native-graph.js` —
   `NATIVE_GRAPH_TYPE_IDS`, param-slot `push(...)` mapping (`cont`
   vs `disc`), port-name mapping.
6. `public/node-graph-efficient-product.js` — allowlist, or the
   module renders silence live.
7. `public/node-graph-module-store.js` — Add Module menu / store
   entry and source pointers; `public/index.html` menu if needed.
8. `public/native-modules-catalog.json` — catalog entry (mirror a
   velvet / comb_pluck entry: `targetType`, `kind`, `source`,
   license, wasm pointers).
9. Display: `public/modules/convolutionResonator/convolution-resonator-display.js`,
   included from `public/index.html` and `public/perform.html` with
   a new `?v=` tag. Also bump `?v=` on every other script this
   work changes.
10. Verify with Render Sample and live playback; modulate a
    continuous param at audio rate; add a smoke patch if the
    module should stay covered (`patches/smoke_test.json`,
    `node scripts/smoke.mjs`).

## File list (proposed, for the later build)

Plan (this file):

- `docs/CONVOLUTION_RESONATOR_PLAN.md`

Native / library (new):

- `native_modules/convolution_resonator/convolution_resonator.cpp`
- `library/include/soemdsp/fft/fft_radix2.h` (factored from Sandy's
  WIP FFT, coordinated with her)
- Optional, only if the body models want to be shared:
  `library/include/soemdsp/filter/body_ir.h`

Native / JS hooks (existing files to edit):

- `native_modules/graph_engine/graph_engine.cpp`
- `scripts/build_native_modules.ps1`
- `public/native-modules-catalog.json`
- `public/node-graph-module-definitions.js`
- `public/node-graph-module-store.js`
- `public/node-live-audio-worklet-native-graph.js`
- `public/node-graph-efficient-product.js`
- `public/node-graph-live-runtime.js` (wasm cache tag)
- `public/index.html`, `public/perform.html` (script tags / cache tags)

Display and tests (new):

- `public/modules/convolutionResonator/convolution-resonator-display.js`
- `scripts/test_convolution_resonator.mjs`
- Optional: a demo patch under `patches/demo_patches/`

## Phased build order

Resources are low; each phase should be listen-able and testable
before the next one starts.

1. **Scaffold.** Definition, store, catalog, type id, build-script
   entry, graph_engine create/destroy/process stub, stereo I/O,
   Mix, Frequency / ƒ. Silent or dry-only is fine. Confirm the
   module appears, renders, and is live-audible as a delayed dry
   path.
2. **Body + carrier, no vocoder.** Buzz first (BLIT pulse-train
   body, BLIT carrier, Mix). Listen: talking into a harmonic
   body, pitch from ƒ. Then String (`comb_core`) and Tube (modal
   series), then the Body morph. DC traps and NaN/inf reset live
   here already. No clipper.
3. **Fixed-size STFT vocoder.** One frame size (e.g. 512), Hann,
   75% OLA, spectral multiply, Formant Shift, delay-aligned Mix.
   Confirm a clean robot at this size, locked to Pitch, stereo
   image intact, COLA-flat bypass.
4. **Crunch.** Size set, adjacent-size crossfade, log Response
   law, log Bandwidth smoothing, bipolar trims, sliding hop at
   32/64, constant latency. This is the heart of the module.
   Listen to the whole Crunch sweep for clicks, identity changes,
   and grit.
5. **High-frequency finish.** COLA gain, oversampled AM, top-bin
   smoothing, Nyquist fade of tube modes / BLIT harmonic count,
   dry-delay exactness, silence skip.
6. **Display.** Parameter-pinned IR and band views, live flashes
   that do not move the axes, no fake clip, no hover, cache tags.
7. **Tests and smoke.** The plan below. Only then, consider a
   time-domain band path if the crunchy end still is not enough.

## Test plan

Automated where possible (`scripts/test_convolution_resonator.mjs`,
in the style of `scripts/test_velvet_reverb.mjs` / the comb tests),
plus a live listen.

- **COLA / bypass.** Flat envelope, Mix = 0 (aligned dry) and a
  "E = 1" wet path: a sine or a sweep comes out without amplitude
  ripple or extra coloration, within a tight dB tolerance.
- **Pitch accuracy.** Carrier (and Body teeth / modes) sit within
  a few cents of ƒ across 10 Hz–Nyquist, including Thiran string
  delay and BLIT harmonic count.
- **Crunch sweep without clicks.** Automate Crunch 0 → 1 → 0 on a
  held vowel; peak residual at size-set boundaries should be at
  click-noise, not at a discontinuity.
- **Constant latency vs Crunch.** Impulse in, measure wet delay at
  Crunch 0, 0.5, and 1; they match. Dry delay matches wet.
- **Bandwidth law.** A white or pink voice at Bandwidth max yields
  essentially one envelope (carrier amplitude follows the
  broadband voice). At Bandwidth min, narrow teeth / bins remain
  distinct.
- **Audio-rate AM.** A pulse-like voice at Crunch 1 puts measurable
  sidebands around carrier partials at the pulse rate. At Crunch 0,
  those sidebands are gone or far down.
- **Formant Shift.** A measured envelope peak moves by the
  requested octaves / semitones; carrier ƒ does not move.
- **DC.** A unipolar burst into Buzz, a long String decay, and a
  Tube ring all stay free of a growing offset. 0 Hz STFT bin does
  not appear as a DC thump on the output.
- **No self-damping.** A tall hit and a quiet hit have the same
  Body decay time (the no-clipper test that failed on the old comb
  clamp). Output may be loud.
- **NaN/inf reset.** A forced non-finite state returns to silence
  and stays finite; the module keeps running.
- **Ranges.** Settings at every definition min and max (including
  10 Hz, 20 kHz, Crunch 0 and 1, Formant Shift ±24 st, Mix 0 and
  1) are legal and finite. No hidden clamps in the native sanitize
  except non-finite and Nyquist stability.
- **Stereo.** L-only input, R-only input, and a pan-swept voice:
  image is preserved; mono out averages correctly per
  `stereo_route.h`.
- **HF / aliasing.** A high sine (e.g. 12–16 kHz) through the
  vocoder at Crunch 0 stays clean. At Crunch 1, folded products
  are absent or at residual level after 2× oversampled AM.
- **Display.** A melody into ƒ, and a talking voice, do not move
  the predicted IR, band curves, or axes after a hard refresh.
  Knob moves do. Live flashes are allowed. Peaks past the view
  show a label, not a rescale or a clipped-looking trace.
- **Live + Render Sample.** Both paths produce sound; missing
  `NATIVE_GRAPH_TYPE_IDS` or efficient-product allowlist is the
  usual cause of a silent live path.
- **Audio-rate mod.** Crunch, Mix, Formant Shift, and ƒ change
  every sample when modulated, not once per block.

## Decisions (Argi, 2026-11-17)

All open questions are settled; build on these.

1. **Body** is a continuous morph: Buzz to String to Tube.
2. **Body Decay / Size** gets a fine knob.
3. **Body also tints the carrier**, so one knob keeps the family together.
4. **Tube series** is closed–open only (odd harmonics) for v1.
5. **Latency:** as recommended, a constant ~43 ms (2048 at 48 kHz), with the dry
   path delayed to match.
6. **Response / Bandwidth** are bipolar trims around the Crunch law (recommended).
7. **Defaults** as recommended: Crunch 0.25, Mix 1 (fully wet), Frequency 110 Hz.
8. **Category:** `space` (with the reverbs). Label "Convolution Resonator",
   key `convolutionResonator`.
9. **Time-domain band path** is deferred until the short STFT has been heard.
10. **Sandy's FFT:** yes, factor `fft_radix2` into
    `library/include/soemdsp/fft/fft_radix2.h` and share it, coordinating
    with Sandy.
