# Spectral Warble: Fix Plan

> **2026-11-27, `docs/SPECTRAL_NO_LEVELING_PLAN.md`:** every automatic level match this plan describes (the per-frame power match, the
> synthesis-window match, Smear's per-bin makeup) is deleted, and the level checks are reported, not asserted. The module sets its level with
> Amplitude (0..1, signed, after Mix). The level targets below are history.

| | |
|---|---|
| **Status** | Plan only. Nothing here is built yet. Hand this to the outside coding AI. |
| **Module** | `spectralWarble` (native type 281, `native_modules/spectral_warble/`). It keeps its name, **Spectral Warble**. |
| **Base commit** | afbdaa5a. Warble was split out of Spectral Blur in 73bb587a. Its DSP is the Swarm path first shipped in 93ba63c0. |
| **Scope** | Only Spectral Warble. Spectral Cloud has `docs/SPECTRAL_CLOUD_FIX_PLAN.md` and Spectral Smear gets its own doc. The one shared piece is the partial-moving code (section 3.7). |
| **Supersedes** | the Warble parts of `docs/SPECTRAL_BLUR_SWARM_PLAN.md` (sections 1-11.1) and `docs/SPECTRAL_WARBLE.md`. |

Line numbers below are from afbdaa5a. Re-check them before editing because other agents work in this tree.

File keys:
- `W` = `native_modules/spectral_warble/spectral_warble.cpp`
- `E` = `native_modules/spectral_blur/spectral_stft_engine.h` (shared engine)
- `D` = `public/node-graph-module-definitions.js`
- `K` = `public/node-live-audio-worklet-native-graph.js`
- `G` = `native_modules/graph_engine/graph_engine.cpp`

---

## 1. What it should sound like

Argi's first reaction to the pre-split Swarm was "warbly, not cloudy". That warbly character is what this module now owns, done properly.

**Target test:** a plain sawtooth at 110 Hz and another at 880 Hz, default settings, Mix 1, on headphones.

- **A lush, organic ensemble.** Each harmonic wobbles in pitch **on its own**, at its own slightly different speed, like a choir of slightly drunk voices, a swarm of bees around the note, or a worn tape ensemble. The note's pitch centre stays put; the inside of the tone moves.
- **Musical depth that is the same at every pitch.** A wobble of 25 cents is 25 cents on the fundamental and on the 30th harmonic. So the 880 Hz saw warbles just as much as the 110 Hz one, and the low end does not turn into a seasick siren.
- **Smooth motion.** The wobble glides. There is no stepping, no buzz at the frame rate (47 Hz today) and no grit.
- **Several voices** (default 3): every harmonic is sung by a few copies that drift independently, so the voices beat gently against each other, like a chorus, while the level stays even.
- **Stereo by default:** the voices sit spread across left and right, and each ear hears its own wobble. Stereo Spread 0 gives two identical channels.
- **There must be NO:**
  - single, synchronised vibrato (the whole note going up and down together),
  - noise, hiss or fuzz (that is Spectral Cloud's job),
  - smear or tail after the note (that is Spectral Smear's job),
  - level pumping or boost.
- **Depth 0 is exactly dry.**
- **The spawned module already warbles.** Today it spawns at Swarm 0, which is silent dryness (section 2.6).

## 2. Why the current Warble sucks

Short version: today's Warble is **not a pitch wobble at all**.

- It applies a **random phase jitter to every FFT bin independently**, re-drawn almost from scratch every frame.
- That tears each harmonic apart, so you hear **grainy amplitude roughness and a frame-rate buzz**.
- The real pitch movement it does make is a **fixed number of Hz**. That is huge at the bottom and nothing at the top.
- With Level, Drift, voices and the old smear/diffusion stereo wash all removed in the split, nothing is left to hide that.

### 2.1 It wobbles phase, per bin, not pitch, per partial
- `E:224-244` gives **every bin `k` its own** independent random state (`swarmPhaseState[k]`, `E:231`). `E:241-242` turns it into a rotation of up to ±Swarm degrees, and `E:287-292` applies that rotation to the bin's analysis phase.
- A single harmonic occupies a Hann main lobe of about 4 bins. Those 4 bins now get 4 unrelated rotations, so the partial's own components disagree.
  - Its level flickers frame by frame (roughness).
  - Energy leaks to the sides.
  - Its "pitch" only jitters instead of gliding.
  - The tooltip at `W:12` even calls it "a fuzzy buzz".
- The rotation is bounded (±Swarm), not integrated. A bounded phase jitter is phase modulation around a fixed frequency: the pitch never actually travels away and comes back the way a voice's does.

### 2.2 The motion is near-white at the frame rate, not a 5 Hz wobble
- Warble runs at hop N/4 (`E:151`; the `cloud` flag is false, `W:25`). That is 1024 samples, about 47 frames per second at FFT 4096.
- The walk pole is `exp(−2π·Rate·hop/sr)` (`E:227`). At the default and demo Rate of 5 Hz that is `exp(−2π·5·1024/48000) ≈ 0.51` **per hop**: the state forgets half of itself every frame.
- So at the demo's Swarm of 120° (`patches/demo_patches/spectral_warble.json`), each frame takes a fresh jump of up to about ±2 radians. That is a phase scramble at 47 Hz, which you hear as a buzz or grain.
- The phase is constant within each frame and jumps between frames, with no accumulation (`E:241` against Cloud's accumulated version at `E:212-214`). The 4× overlap-add then crossfades between the jumps.
- `Rate` goes up to 1000 Hz (`D:9133`, `W:13`), but anything above about 23 Hz (half the frame rate) only makes the per-frame jump fully random. The tooltip at `W:13` half-admits this.

### 2.3 The depth is fixed in Hz, so it is a siren at lows and vibrato at highs
- `docs/SPECTRAL_BLUR_SWARM_PLAN.md:192` and `:198`: the peak frequency deviation of a phase walk is about `Swarm_radians × Rate` Hz, **the same number of Hz at every bin**.
  - Around 110 Hz, ±10 Hz is ±160 cents, a wild siren.
  - Around 3.5 kHz it is ±5 cents, almost nothing.
- That is Argi's original clue ("cloudy at lows, vibrato at highs", SWARM plan section 11.2).

### 2.4 The state is clamped, so it sits at full depth
- `E:228` gives the state a stationary spread of 1 standard deviation, and `E:234` clamps it to ±1. The phase therefore sits pinned at ±Swarm about a third of the time.
- That makes the jitter even more square-ish and harsh, and it is a hidden musical cap (section 8).

### 2.5 What the split took away
- `W:24-25` forces `swarmLevel = 0` and `swarmDrift = 0`. Level was dropped because it boosted and could clip (`docs/SPECTRAL_WARBLE.md:15-16`; `exp(+Level·state)` raises mean power, `E:243`). Drift was a Hz-wide pitch wander (`E:237-240`).
  - The code for both still runs every frame (`E:232-233`, `E:235-240`, `E:243`, `E:292`), drawing random numbers for nothing. That is **dead code**.
- **No voices:** one rotation per bin, one copy of the sound.
- **No stereo:** one shared rotation for both channels (SWARM plan `:189`). The test at `scripts/test_spectral_warble.mjs:67-71` even asserts the channels stay linked.
  - Before the split, a freshly spawned Spectral Blur ran Time Smear 2 s, Frequency Blur 100 Hz, Diffusion 1 and Stereo Spread 1 underneath Swarm. That stereo wash masked the buzz (see section 2.7 of the Cloud plan).
  - The AI's own pre-split Swarm demo preset (`spectral_blur_swarm.json`) turned all of that off: Diffusion 0 and Spread 0.

### 2.6 Smaller faults
- **Spawns as a do-nothing module:** Swarm defaults to 0 (`D:9118`, `W:12`, `G:5134`, `K:6314`).
- **`W:55` calls `core.seedCloud()`**, which has nothing to do with Warble.
- The module-browser text (`public/node-graph-module-store.js:1157`) sells "a fuzzy buzz".

### 2.7 What is fine (keep)
- The shared analysis and resynthesis.
- The FFT-size warm-and-crossfade (`E:403-435`).
- The synthesis-window pass match (`E:344-352`).
- The seeded, deterministic random streams.
- The in-place, no-tail behaviour (the test at `scripts/test_spectral_warble.mjs:58-66`).

## 3. The DSP design for the fix

### 3.1 The idea
Treat each **partial** (a spectral peak and its lobe) as a sound source and **move its pitch** smoothly, in cents.
- Each partial gets its own seeded motion generator, at its own slightly different rate.
- Each voice is a separate copy of every partial with its own motion.
- Each channel can get its own motion (stereo).

The machinery to move a partial cleanly already exists in today's Blur/Cloud path:
- peak tracking: `E:184-193`;
- lobe move with the sign pattern and 4-tap Catmull-Rom: `E:201-222` and `E:309-327`;
- accumulated phase, so the moved partial is a continuous sinusoid: `E:212-214`;
- per-frame power match: `E:329-341`.

The Cloud plan removes it from Cloud. **Warble takes it over** as its engine (section 3.7). What makes Warble different from that old "spectral supersaw" Cloud:

| Old Cloud (7fcb716b) | New Warble |
|---|---|
| state at knots every 8 bins, so neighbouring harmonics move together | knots every **2 bins**, so every harmonic has its own motion |
| clamped OU walk at one shared Wander rate, pinned at ±Fuzz | **unclamped, unit-variance** smooth motion; per-partial rate spread by **Drunk** |
| a slow wander only | a blend of a **regular wobble (sine) and a wander (smooth noise)**: Drunk 0 = each partial a clean vibrato at its own phase; 1 = an organic random wander |
| linked L/R | **stereo**: per-channel motion (Spread) plus voices fanned across the stereo field |
| meant as a cloud (wrong job) | meant as a warble (right job): pitch motion **is** the effect here |

### 3.2 Steps per hop

Warble runs at **hop N/8**, the same 8× overlap and OLA gain of 1/3 that Cloud uses (`E:151-153`). At FFT 4096 that is about 94 frames per second, smooth enough for wobbles up to about 20 Hz.

Constants: `N`, `H = N/8`, `sr`, `L = voices`, `S = stereoSpread`, `D = drunk`, `R = rate`, and Depth in cents.

**A. Motion, once per hop, before the channel loop.**
- Knots sit every `kWarbleKnot = 2` bins. For each voice `v` and knot `n`, there are three unit-variance generators:
  - `m` (mid),
  - `sL` and `sR` (side; only advanced when `S ≠ 0`).
- Each generator has a fixed per-knot rate `R_n = R · 2^(D · r_n)`, where `r_n` is uniform on [−1, 1] and drawn once from the seed. Drunk 1 spreads rates over ±1 octave.
- Each generator outputs `x = cos(πD/2)·√2·sin(φ) + sin(πD/2)·g`:
  - `φ` advances by `2π·R_n·H/sr` per hop and starts at a seeded random phase;
  - `g` is smooth noise: two cascaded one-poles at cutoff `R_n`, driven by seeded white noise and scaled to unit variance by the filter's analytic stationary variance (verify numerically in a test).
- **No clamp and no limiter on `x`.** The cos/sin blend is defined for any Drunk value, so raising Drunk's maximum in the definition never produces NaN.
- Channel motion: `w_c = cos(πS_n/2)·m + sin(πS_n/2)·s_c`, where `S_n` is Spread with the Mono Bass ramp (section 4). Its variance is 1 for any Spread, and the L/R correlation is `cos²(πS_n/2)`, so 1 at S = 0 and 0 at S = 1.
- **Detune** in cents for voice `v`, channel `c` and knot `n` is `Depth · w_c`. Because `w_c` has unit variance, **Depth is the RMS pitch deviation in cents** at every Drunk value. A pure regular wobble (Drunk 0) peaks at about 1.4 × Depth.

**B. Partial mapping, per channel, using the previous hop's power.**
- Peak search as at `E:188-193`, but with ±2 bins (`kWarbleLobe = 2`), so harmonics 4–5 bins apart at FFT 2048 stay separate.
- Each bin takes the detune of its peak `pk`, linearly interpolated between the two knots around `pk`.
- The shift in bins is `delta = pk·(2^(cents/1200) − 1)`.
- The phase is accumulated per voice, channel and bin, as at `E:212-214`.
- Target bin, fraction and rotation are stored per channel: `[2][kMaxVoices][bins]`. The right channel is only computed separately when `S ≠ 0`; at S = 0 it reuses the left values bit-exactly.

**C. Analysis.** Unchanged (`E:250-275`).

**D. Synthesis.**
- For every bin and voice, rotate by that voice's accumulated phase, then scatter into `t0−1..t0+2` with the Catmull-Rom weights and the `(−1)^(q−k)` sign pattern (`E:313-326`).
- Then multiply by the voice's **fan gain** for this channel (section 4).

**E. Level.**
- The per-frame, per-channel power match to the source frame (`E:329-341`).
- Then the synthesis-window pass match (`E:344-352`).
- Both are matches to the *source*, never above it. There is no makeup gain, and no limiter.

**F. Output.** Inverse FFT and overlap-add, as today.

**Identity:** at Depth 0 every delta and accumulated phase is 0, so all voices are identical copies. Any fan gains cancel in the power match, so the output is exactly the dry signal at any Spread, Voices, Drunk or Rate (test T1).

**Cost** is about the old Cloud's, plus 3 generators per voice per knot (bins/2 knots). The right channel is only processed when S ≠ 0. Cost does not depend on pitch (T13).

### 3.3 Parameters (the definitions are the only place limits live)

| Key | Label | Unit | Min / Mid / Max | Default | Decision |
|---|---|---|---|---|---|
| `fftSize` | FFT Size | samples | 512..16384 choice | 4096 | KEEP |
| `depth` | Depth | ¢ | 0 / 25 / 200 | **25** | NEW, replacing `swarm` (degrees of phase is the wrong unit). Nonlinear slider. |
| `rate` | Rate | Hz | 0.05 / 4 / 20 | **4** | KEEP the key; new range and default. Nonlinear slider. |
| `drunk` | Drunk | × | 0 / 0.5 / 1 | **0.5** | NEW. 0 = each partial a regular vibrato at exactly Rate (desynchronised); 1 = organic random wander with rates spread ±1 octave. |
| `voices` | Voices | — | 1 / 2 / 4 | **3** | NEW. Copies of every partial, each with its own motion. |
| `stereoSpread` | Stereo Spread | × | 0 / 0.5 / 1 | **1** | NEW (the same key as Cloud and Smear). 0 = identical channels. |
| `monoBassHz` | Mono Bass | Hz | 0 / 120 / 1000 | **120** | NEW (the same key as Cloud). 0 = off. Defaults to 120 Hz on Warble (Argi, 2026-11-26), unlike Cloud's 0, because a bass that wobbles differently in each ear feels seasick. |
| `seed` | Seed | — | app seed control | 0 | KEEP. Seeds every generator (Seed + voice + stream salt). |
| `mix` | Mix | % | 0 / 0.5 / 1 | 1 | KEEP |
| `frequencyCurve` | Curve | — | display only | 1 | KEEP |
| ~~`swarm`~~ | — | — | — | — | **DELETE** everywhere: definition, metadata, setter, `swarm` field, worklet, slot, tests and docs. |
| ~~Level, Drift~~ | — | — | — | — | Stay deleted **for good** (Argi, 2026-11-26). Delete their dead engine code too (section 3.6). No level wobble of any kind: the voices' natural beating gives movement without a boost. |

Docked tips panel text (each definition's `tooltip`; no hover tooltips):
- **Depth:** "How far each partial's pitch wobbles, in cents (average, RMS): the same musical amount on low and high notes. Every harmonic moves on its own, so the tone swims instead of doing one vibrato. 0 is dry."
- **Rate:** "Average wobble speed in Hz. Around 2–6 Hz is a lush, vocal warble; slower is a gentle swim; faster gets nervous. Each partial runs at its own speed around this (see Drunk). Motion updates about 94 times a second at FFT 4096 (half that at 8192, a quarter at 16384), so very high rates step at big FFT sizes."
- **Drunk:** "How irregular the wobble is. 0 = every partial is a smooth, regular vibrato at Rate (just out of step with each other); 1 = a wandering, organic motion with each partial's speed spread over an octave."
- **Voices:** "How many independently wobbling copies sing each partial. More voices make a thicker chorus that gently beats; the level stays matched. Costs CPU per voice."
- **Stereo Spread:** "How differently the two ears wobble, and how wide the voices are spread. 0 = identical channels; 1 = each ear has its own motion and the voices fan out left to right. The level per channel stays matched."
- **Mono Bass:** "Below this frequency both ears wobble identically and the voices stay centred, so the bass stays solid in mono. One-octave smooth transition. 0 = off."
- **Seed:** "The random pattern of the wobble. The same Seed, input and settings always give the same output."

### 3.4 Which file changes what
- **`W`:**
  - In the metadata (`W:10-15`), delete `swarm` and add `depth`, `drunk`, `voices`, `stereoSpread` and `monoBassHz`. Give `rate` its new range and default, and rewrite the tooltips.
  - Update `create()` (`W:24-25`): new engine selection, hop N/8, no Level/Drift lines.
  - Replace `set_warble` (`W:47-58`) with `soemdsp_spectral_warble_set_warble(h, depthCents, rateHz, drunk, voices, seed)` and add `soemdsp_spectral_warble_set_stereo(h, spread, monoBassHz)`.
  - Drop the `seedCloud()` call at `W:55`.
  - Bump the version at `W:43`.
- **`G`:**
  - Update the declarations at `:893-898` and the comment at `:2677`.
  - Update `init_control` at `:5132-5137` (new defaults; the slots below).
  - Update the calls at `:16426-16431`.
- **`K`:**
  - Key-to-slot map at `:647-653` and push list at `:6312-6318`:
    - `depth` → `NATIVE_GRAPH_PARAM_SHAPE` (the old `swarm` slot);
    - `rate` → `LFO_RATE` (unchanged);
    - `drunk` → `LFO_VARIATION` (pre-split Drift's slot);
    - `voices` → `OVERSAMPLE`;
    - `stereoSpread` → `PAN`;
    - `monoBassHz` → `FREQUENCY`;
    - `seed` and `mix` unchanged.
- **`D`:**
  - Parameters at `:9075-9180`.
  - Face (`:9068-9074`) rows: FFT Size; Depth | Rate; Drunk | Voices; Stereo Spread | Mono Bass; Seed; Mix; Curve.
- **`public/node-graph-module-store.js:1154-1159`:** new description, for example "Native STFT ensemble warble: every partial wobbles in pitch on its own (Depth in cents, Rate, Drunk), sung by several voices spread in stereo. A lush, organic chorus with no noise and no smear. Processing delay follows FFT Size."; and new notes `["spectral","STFT","warble","chorus","ensemble","vibrato","stereo","native"]`.
- **Demo patch `patches/demo_patches/spectral_warble.json`:** Depth 25, Rate 4, Drunk 0.5, Voices 3, Spread 1, Mono Bass 120, Seed 1, plus the description text. Remove `swarm`.
- **Docs:** rewrite `docs/SPECTRAL_WARBLE.md` (Controls, How it works, Preset, Verification).
- **Rebuild** with `scripts/build_native_modules.ps1`: `spectral_warble`, `graph_engine`, and `spectral_blur` and `spectral_smear` because they share the engine header. Regenerate the catalog if the build script generates it.
- **Saved patches:** old `swarm` values are ignored (verify the loader drops unknown keys generically; no Warble-specific shim). Old patches pick up the new defaults.

### 3.5 Engine structure (coordinate with the Cloud plan)
- Replace the `cloud` boolean and the `swarming` test (`E:46`, `E:168`) with one `enum class Engine { Smear, Warble, Cloud }`, set in each module's `create()`. Warble and Cloud both use hop N/8, and Smear uses N/4.
- If the Cloud fix has already landed with its `cloud` flag, convert that flag to the enum in this change. If this change lands first, the Cloud change adopts the enum.

### 3.6 Delete (Warble-only dead code, no shims)
- The whole Swarm OU path:
  - `E:224-245`;
  - the swarming rotation and gain at `E:287-293`;
  - `swarmPhaseState`, `swarmAmpState`, `swarmDriftState`, `swarmDriftPhase`, `swarmSin`, `swarmCos` and `swarmGain` (`E:41-42`);
  - `swarm`, `swarmLevel`, `swarmRate` and `swarmDrift` (`E:44`);
  - `kDegrees` (`E:13`);
  - `seedSwarm` and `swarmRandom` (`E:101-110`);
  - the matching lines in `reset()` and `initialize()` (`E:73`, `E:86`, `E:398`).
- Smear never uses this path: it sets `swarm = 0` at `native_modules/spectral_smear/spectral_smear.cpp:29`, so delete that assignment too. If the seed field is still needed, rename `swarmSeed` to `seed`.
- `E:168` and `E:252` mention `swarming`. Replace them with the enum.

### 3.7 The shared partial-moving code (coordination with the Cloud plan)
The Cloud plan (sections 3.6 and 8) deletes the peak search, knot walk, lobe move and Catmull-Rom scatter from Cloud. **Warble needs exactly that code.** So:
- If both plans are implemented in one pass, **move** it into the Warble engine branch instead of deleting it and re-adding it.
- If Cloud has already landed, restore it from `git show afbdaa5a:native_modules/spectral_blur/spectral_stft_engine.h` (`E:184-222` and `E:309-341`) into the Warble branch.
- Rename `cloud*` arrays to `warble*`. Drop the knot OU walk (`E:194-200`) and the level state; section 3.2 A replaces them.

## 4. Stereo (Warble's own way)

Cloud's stereo decorrelates noise phase. **Warble's stereo is an ensemble spread across the stage.** Two parts, both controlled by Stereo Spread:

1. **Each ear wobbles differently.** As in section 3.2 A, `w_c = cos(πS/2)·m + sin(πS/2)·s_c`.
   - At S = 0, left and right share the motion bit-exactly.
   - At S = 1, they have independent motions with the same depth, so a harmonic can rise in one ear while it falls in the other. That is the classic wide stereo chorus.
2. **The voices fan across the field.**
   - Voice `v` of `L` sits at pan position `p_v = S·(2v/(L−1) − 1)` (0 when L = 1).
   - Its per-channel gain uses the constant-power law, `gL = √2·cos(π(1+p)/4)` and `gR = √2·sin(π(1+p)/4)`, so both are 1 at the centre.
   - The per-channel power match then holds each channel's level to its source, so the fan changes **which** voices dominate each ear, never the loudness.
   - There is no crossfeed: the left output is built only from the left input analysis, and the right output only from the right.

**Mono Bass:**
- `S_n = S · ramp(f_n)`, where `ramp` is a raised-cosine rise from 0 at `MonoBass/√2` to 1 at `MonoBass·√2`.
- `S_n` is used for both the motion blend and the fan.
- Mono Bass ≤ 0 means off (`ramp = 1`). That is what the knob means at 0, not a clamp.

**Stereo input:** each channel is analysed on its own. At S = 0, both channels get the same motion, so the input image is kept.

**Mono sum:** at S = 1, left and right differ in pitch motion, so their sum beats a little more. It stays a warble, not a comb, and T10c checks the level.

## 5. Display
- Keep the three styles Overlay, Particles and Waterfall (`public/modules/spectralDisplay/spectral-display-face.js:15`). **Waterfall is the default** for Warble (Argi, 2026-11-26). Put it first in the module's style list in `spectral-display-face.js:15`, or set the default the way the face config already selects one:
  - Warble is pitch motion over time, and a waterfall shows each harmonic as its own wavy line wobbling independently. That is the best visual proof of the effect.
  - The same picture exposes the two failure modes: all lines wiggling in step means a lockstep vibrato bug, and fuzzy stripes mean it has turned into noise.
- **Display default to be confirmed by Argi after testing** (2026-11-26). He will pick each module's default style after trying them all; Waterfall is usually his least favourite. Keep the style list easy to reorder per module.
- **Overlay** draws the input ghost (lane B "In", `spectral-display-worklet.js:24`) against the output. Each harmonic should look slightly widened and alive, centred on the input line.
- **Particles** are driven by the real output spectrum only. Nothing is faked from the knob values, and there are no particles without audio.
- Use honest dB (floor −90, ceiling 0) and never fake clipping. WebGL only. Events from the audio-callback collector, no timers or polling. The Display Settings show only what these styles use.
- Phone: the face grows by two 40-unit rows (Drunk | Voices and Spread | Mono Bass). Check it still fits the phone layout; if it does not, raise `displayHeightGu` or `defaultWidthGu` in the definition rather than shrinking the touch targets.
- The display stays mono (out vs in). Do not add a stereo view in this change.

## 6. Acceptance tests

Rewrite `scripts/test_spectral_warble.mjs`: it asserts `swarm` and degrees at `:10-12`, linked stereo at `:67-71`, and Rate 400 at `:53`. Update `scripts/test_spectral_blur_graph.mjs` (slots: 13 Depth, 57 Rate, 47 Drunk, OVERSAMPLE Voices, PAN Spread, FREQUENCY Mono Bass, 48 Seed, 40 Mix) and `scripts/test_spectral_blur_browser.mjs`.

Signals are 48 kHz: band-limited (additive) saws and sines, measured after warm-up, over at least 8 s. **Pitch tracking** uses a separate test STFT (N = 8192, H = 256) of the output: take the peak bin of the partial, refine it with parabolic interpolation, and convert to cents against the dry frequency.

Unless stated, Depth = 25, Rate = 4, Drunk = 0.5, Voices = 1, Spread = 0, Mono Bass = 0 and FFT = 4096. Mono Bass is 0 here so the stereo tests measure the whole spectrum; the shipped default is 120. Add one check that a freshly spawned module reports Mono Bass 120 and Waterfall.

### 6.1 Objective checks

| # | Check | Pass |
|---|---|---|
| T1 | **Dry at Depth 0** (any Rate, Drunk, Voices, Spread, Mono Bass, Seed): output equals the input delayed by N. | max error < 1e-4 |
| T2 | **Depth is in cents at every pitch:** sines at 220 and 1760 Hz. RMS of the tracked pitch deviation in cents. | each within ±30 % of Depth (Depth is RMS cents) at Drunk 0 and at Drunk 1; ratio of the two pitches 0.75–1.33 |
| T3 | **Rate is the wobble speed:** at Drunk 0, the modulation spectrum of the tracked pitch (1760 Hz sine). | peak at Rate ±15 % (also at Rate 1 and 8) |
| T4 | **Drunk makes it irregular:** at Drunk 1, the same modulation spectrum. | no peak more than 6 dB above the median between 0.5·Rate and 2·Rate; energy present from 0.1·Rate to 2·Rate |
| T5 | **Partials move independently:** 110 Hz saw. Pairwise correlation of the tracked pitch of harmonics 3, 5, 8 and 13. | mean \|ρ\| ≤ 0.25 (a lockstep vibrato would be about 1) |
| T6 | **It is a pitch glide, not roughness or buzz:** a 1760 Hz sine, Voices 1. (a) Envelope fluctuation, the RMS of the 5 ms envelope over its mean. (b) Lines at f0 ± k·sr/H (k = 1, 2) against the floor ±10 Hz around them. | (a) ≤ 0.05; (b) each < −50 dB relative to f0. Record afbdaa5a at Swarm 120°, which should fail both. |
| T7 | **The centre stays:** mean tracked pitch over 8 s. | within ±2 ¢ of the dry pitch, at all Drunk values |
| T8 | **Voices make a chorus:** at Voices 3 (sine at 1760 Hz), envelope fluctuation from the beating is higher than at Voices 1, and the −20 dB width of the partial is wider. | fluctuation ≥ 0.1, width larger; T9 level still holds |
| T9 | **Level, no boost:** RMS and peak of output against input, per channel. Saws at 110 and 880 Hz, Depth {0, 25, 100, 200}, Rate {0.5, 4, 20}, Drunk {0, 1}, Voices {1..4}, Spread {0, 1}. | RMS within ±1 dB; peak ≤ dry peak + 3 dB; no clamp, limiter or makeup gain beyond the per-frame matches. Report the worst case. |
| T10a | **Spread 0 is linked:** mono in gives Left = Right. | max error < 1e-9 |
| T10b | **Spread decorrelates the motion:** 1760 Hz mono sine, Voices 1. Correlation of the left and right tracked-pitch trajectories. | S = 0: 1.000; S = 0.5: 0.5 ± 0.15; S = 1: \|ρ\| ≤ 0.2 |
| T10c | **Mono sum is sane:** at S = 1 with Voices 3, the (L+R)/2 RMS against the S = 0 output, and 1/6-octave-smoothed PSDs. | within −3 dB to +0.5 dB; no smoothed-PSD dip deeper than 6 dB |
| T10d | **The fan widens without loudness change:** mono saw at 880 Hz, Depth 25, S = 1. Each channel's RMS is within ±1 dB of its input's. The L/R output correlation at Voices 3 is lower than at Voices 1, so the fan adds width. | both |
| T10e | **Mono Bass:** S = 1, Mono Bass 200. L/R trajectory correlation at 100 Hz and at 2 kHz. | 100 Hz: ρ ≥ 0.95; 2 kHz: \|ρ\| ≤ 0.2 |
| T10f | **No crossfeed:** a signal on Left only, at S = 1. | Right output < −80 dB |
| T11 | **Deterministic:** the same Seed gives identical output, a different Seed changes it, and a reset reseeds (keep `:44-56`, updated). | all |
| T12 | **In place:** an impulse leaves no energy past one window (keep `:58-66`). | keep |
| T13 | **Cost:** cost does not depend on pitch. At Voices 4, S = 1 and N = 16384, it is at most 2× the afbdaa5a Cloud path. | both |
| T14 | **Robust:** finite under rapid edits of every parameter (including values beyond the definition ranges), NaN input and FFT switches. A switch stays neutral at Depth 0 (keep `:76-98`, updated). | all |
| T15 | **Smear and Cloud unchanged by this change:** `test_spectral_smear.mjs` and `test_spectral_blur.mjs` pass. Smear's output is the same within 1e-7 before and after, because the Swarm deletion must not touch Smear. | both |
| T16 | **Limits come from the definition:** see section 8.3. | all |

### 6.2 Listening (Argi decides)
Use a keyboard, then a band-limited saw, then Spectral Warble, then the output, on headphones and then summed to mono. Play 110 Hz and 880 Hz, each held 6 s, through these settings:
- Depth 10 / 25 / 60;
- Rate 1 / 4 / 8;
- Drunk 0 / 0.5 / 1;
- Voices 1 / 3;
- Spread 0 / 1.

Pass when all of these hold:
- It sounds lush and organic, like an ensemble or swarm, with each harmonic swimming on its own.
- 880 Hz warbles as much as 110 Hz, and the low end is not a siren.
- There is no single vibrato, buzz, grit, noise or tail.
- There is no level pumping or boost.
- Spread 1 is a wide stage, and mono is still fine.
- It is clearly different from Spectral Cloud (fur) and Spectral Smear (wash).

## 7. App rules (must follow)
- **Parameter limits live only in the parameter definitions and with the user.** There are no musical clamps or caps in C++, the worklet, graph_engine or the setters (section 8). Safety guards stay only where they prevent a failure (NaN/Inf, division by zero, array bounds, FFT size, runaway, memory). Each one carries a `// safety: <reason>` comment and must never quietly act as a musical cap.
- **No hover tooltips.** Each parameter's `tooltip` is a real description for the **docked tips panel**.
- **Phone-friendly** face (section 5).
- **Events only, no timers or polling.** Hop-rate work stays inside the STFT frame.
- **No dead code, dead settings or shims.** Delete the Swarm path, Level and Drift remnants, the stray `seedCloud()` call and stale comments and docs in the same change.
- **WebGL-only UIs.** Display scaling never fakes clipping.
- **Only MIDI modules handle MIDI** (none here).
- **`?v=` tags:** in `public/index.html` and `public/perform.html`, *append* a suffix such as `-warble2` to the existing `?v=` of every changed script. These are `node-graph-module-definitions.js` (index `:3607`, perform `:3592`) and `node-graph-module-store.js` (index `:3922`, perform `:3905`), plus `spectral-display-face.js` (index `:3754`, perform `:3738`) for the default-style change. **Never replace or shorten another agent's tag.**
- **Coordinate edits.** Other agents have uncommitted work in this tree, and the Cloud plan touches the same engine header (sections 3.5 and 3.7). Check `git diff` first and stage only your own hunks.
- **Never touch MasterBot's files:** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, and any cull, present or camera code.
- **Git:**
  - Work directly on master: no PRs, no cloud agents.
  - No force push, stash, `reset --hard`, rebase or branch switch.
  - Commit only your own hunks and preserve line endings.
  - Then a plain `git merge origin/master`. Push only after Argi says yes.
- **Never kill servers or restart the app.** Argi reloads with Ctrl+F5.

## 8. Hard-coded limits to delete

Argi's rule (2026-11-26): limits come **only** from the parameter definitions and the user. Raising a maximum in the parameter interface must reach the DSP unchanged.

The exceptions are guards that prevent app failures or explosions: NaN/Inf, division by zero, array or buffer bounds, FFT-size validity, runaway feedback, and memory. Those stay, each with a `// safety:` comment, and must not quietly act as musical caps.

I found these in Warble's path in `W`, `E`, `G`, `K` and `D` at afbdaa5a.

### 8.1 Delete (musical caps)
| # | Where | What | Why it is a cap |
|---|---|---|---|
| W-D1 | `E:234` | `swarmPhaseState` clamped to ±1 | Pins the wobble at ±Swarm about a third of the time, so raising Swarm's max only makes more of the time pinned. The replacement motion (section 3.2 A) is unclamped. |
| W-D2 | `E:235` | `swarmAmpState` clamped to ±1 | Level's cap (dead in Warble). Delete with the path. |
| W-D3 | `E:236` | `swarmDriftState` clamped to ±1 | Drift's cap (dead in Warble). Delete with the path. |
| W-D4 | `E:227` | `swarmRate > 0 ? swarmRate : 0` repeated in the frame | A duplicate of the setter's guard (`W:54`). Delete with the path; one guard in one place. |

### 8.2 Keep (safety guards)
| # | Where | Guard | Reason |
|---|---|---|---|
| W-K1 | `W:50` | Seed: non-finite or ≤ 0 becomes 0; ≥ 2^32−1 saturates | The storage type is uint32. The definition max (16777215) is far below it, so this never caps musically. |
| W-K2 | `W:52` | Swarm: non-finite becomes 0 | NaN guard. Becomes the Depth guard. |
| W-K3 | `W:54` | Rate: negative or non-finite becomes 0 | A negative rate makes the one-pole coefficient exceed 1, which blows up. 0 is the definition's minimum, so it never caps a raised max. The new generators take their pole from `|R_n|`, so even this guard can go if every path uses `|R|`. |
| W-K4 | `W:36` | FFT size must be 512..16384 power of two | FFT validity and the fixed transform sizes and buffers (`E:10`, `E:18-33`). |
| W-K5 | `E:363`, `E:379` | Reset on non-finite input or output, or sample rate < 100 | NaN/Inf containment; an invalid sample rate. |
| W-K6 | `E:350-351` | Window-pass match only when energies > 1e-24 | Division by zero. |
| W-K7 | `K:5751-5764`, `G:3801-3818` | Modulation is wrapped and clamped to the parameter's min/max domain | **Comes from the definition / user-edited range** (pushed per parameter from `meta.min/max`), so it follows a raised max. Keep it, but T16 must prove a raised max moves the domain. |
| W-K8 | new | Voices: round to an integer, below 1 becomes 1, above the per-voice storage `kMaxVoices` held to storage | Below 1 is a division by zero; above storage is an array bound. **Not a silent cap:** the native metadata exposes `voiceStorage`, and T16 fails if any definition max exceeds it. Raise `kMaxVoices` (memory) rather than letting the guard bite. |

Checked and clean, with no musical caps: `K:5672-5689` (`readContinuous`/`readDiscrete` pass values through), `K:6312-6318`, and `G:5132-5137` and `:16426-16431` (defaults only; values passed straight through `control_audio`). The new parameters Drunk, Spread and Mono Bass use formulas that are defined for any value (section 3.2 A and 4), so they need no guard.

### 8.3 Test T16: a raised max reaches the DSP unclamped
Add it to `scripts/test_spectral_blur_graph.mjs`, which covers all three modules, and run it against Warble:
1. Load a patch whose `spectralWarble` node has `paramMeta` overriding `depth.max` to 1000, `rate.max` to 200 and `voices.max` to `voiceStorage`. Set depth 800, rate 150 and voices = `voiceStorage`.
2. Assert that the worklet pushes exactly 800, 150 and `voiceStorage` to the native slots (slot readback), and that the domain pushed for each slot has the raised max.
3. Render a 1760 Hz sine through the native graph and assert that the tracked RMS pitch deviation is about 800 ¢ (±30 %). That shows the value was used, not clamped to 200.
4. With modulation added to Depth (a unit-band modulation pushing it past the old max of 200 but within the new 1000), the effective value exceeds 200.
5. **Guard lint:** a test that scans `spectral_*.cpp` and `spectral_stft_engine.h` for clamp shapes (`? a : b` with a comparison against a constant, `min(`/`max(`, `if (x > c) x = c`). It fails on any such line without a `// safety:` comment on it, and the safety lines must match section 8.2.
6. Assert that every definition max for Voices is ≤ `voiceStorage` from the metadata (W-K8).

## 9. Decisions (Argi, 2026-11-26)
All the earlier questions are decided, so none are open.

1. **Rename Swarm to Depth**, in cents (key `depth`, label "Depth"; `swarm` is deleted). Decided.
2. **Waterfall is the default style** for Warble; Overlay and Particles stay available (section 5). Decided.
3. **Mono Bass defaults to 120 Hz** on Warble (section 3.3; the demo patch too). Decided.
4. **Defaults: Depth 25 ¢, Rate 4 Hz, Drunk 0.5, Voices 3, Spread 1.** Argi will try them and say quickly if any need changing, so keep them easy to retune: definition defaults, `G:5132-5137` init values, worklet fallbacks at `K:6312-6318`, and the demo patch must all agree. Add a test that the four sources match. Decided.
5. **Level wobble is dropped for good.** There is no level modulation in Warble; the voices' beating provides the movement with matched level. Decided.

## 10. Build order across the three plans
Follow `docs/SPECTRAL_SMEAR_FIX_PLAN.md` section 10: shared prep first (engine setting, `// safety:` comments, guard lint, T16 harness, inactive-parameter rules), then Warble, then Cloud, then Smear, one commit each. Each step appends its own `?v=` suffix and re-baselines the other modules against the previous step's build.
