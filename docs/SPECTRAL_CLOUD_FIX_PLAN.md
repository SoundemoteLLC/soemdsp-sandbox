# Spectral Cloud: Fix Plan (was Spectral Blur)

> **2026-11-27, `docs/SPECTRAL_NO_LEVELING_PLAN.md`:** every automatic level match this plan describes (the per-frame power match, the
> synthesis-window match, Smear's per-bin makeup) is deleted, and the level checks are reported, not asserted. The module sets its level with
> Amplitude (0..1, signed, after Mix). The level targets below are history.

| | |
|---|---|
| **Status** | Plan only. Nothing here is built yet. Hand this to the outside coding AI. |
| **Module** | `spectralBlur` (native type 272, `native_modules/spectral_blur/`). Its user-visible name becomes **Spectral Cloud**. |
| **Base commit** | afbdaa5a (73bb587a split Blur into Blur, Warble and Smear; 7fcb716b added the wandering-detune Cloud). |
| **Scope** | Only Spectral Blur/Cloud. Spectral Warble and Spectral Smear are separate jobs. Their output must not change (section 6.3). |
| **Decisions** | Argi answered every open question on 2026-11-26 (section 8). This revision includes them: Grain as a knob that can never boost, Voices kept, **stereo controls on Cloud** (Stereo Spread and Mono Bass) that recreate the pre-split stereo, FFT 4096, and the demo patch may be renamed. |
| **Supersedes** | `docs/SPECTRAL_BLUR_SWARM_PLAN.md` section 11, and the "How it works" text in `docs/SPECTRAL_BLUR.md`. |

Line numbers below are from afbdaa5a. Re-check them before editing because other agents work in this tree.

---

## 1. What it should sound like

**Target test:** a plain sawtooth at 110 Hz (A2) and another at 880 Hz (A5). Default settings, Mix 1.

- **Pitch stays put and clear.** You can still hum the note. The fundamental and the first few harmonics stay recognisably tonal at default Fuzz. Nothing slides up and down.
- **Each harmonic becomes a soft, breathy band** instead of a thin line, like blowing across the saw or hearing it through fog. The upper harmonics become soft airy "fur" or hiss-cloud that sits *around* each harmonic, centred on it.
- **Highs are as fluffy as lows** in musical terms. The 880 Hz saw is as cloudy as the 110 Hz saw, not cleaner.
- **Wide and soft in stereo by default** (Stereo Spread 1). The fur is different in each ear, the way pre-split Spectral Blur's Diffusion and Stereo Spread made a mono saw into a stereo wash (section 2.7). At Stereo Spread 0, Left and Right are identical, so mono input gives mono output.
- **There must be NO:**
  - vibrato (a pitch wobble you can hear as a rate),
  - beating or chorus "wow" (two or three detuned copies rubbing against each other),
  - supersaw (a stack of detuned saws),
  - metallic ring or a buzz at the frame rate (about 94 Hz at FFT 4096),
  - tail or reverb after the note stops, beyond the usual one-window delay,
  - level jump compared with Mix 0.
- **Fuzz 0 is exactly dry.** Turning Fuzz up goes smoothly from "a hint of air" to "a big diffuse cloud where the pitch is still the centre of it."
- **Reference sounds:** Paulstretch-style phase randomisation, applied only in place (no time stretch), and with a width you control in cents. Not a chorus pedal, and not a unison oscillator.

## 2. Why the current code cannot make a cloud

Short version: **every stage of the current Cloud path is built to keep each partial a clean, coherent sinusoid.** It makes 2 to 4 *detuned copies* of every partial (a spectral supersaw). It never turns a partial into a *band*. The module-browser text admits this. `public/node-graph-module-store.js:1151` says "a lush fuzzy supersaw from a single oscillator", and `:1152` lists the notes "chorus, supersaw, detune".

Files: `E` = `native_modules/spectral_blur/spectral_stft_engine.h` and `B` = `native_modules/spectral_blur/spectral_blur.cpp`.

### 2.1 The voices are discrete lines, not a band (the core problem)
- `E:194-222` gives each voice ONE detune value per partial and moves the whole partial lobe by that amount. `E:309-327` then adds the moved copies together.
- With Voices = 3 (`B:26`, `B:14`), every harmonic of the saw comes out as **3 sinusoids** at slightly different frequencies. A long FFT of the output shows 3 thin lines per harmonic with empty space between them.
- Three lines beat against each other. That is chorus or supersaw, not cloud. The engine holds at most 4 voices (`E:15`, `kMaxVoices = 4`), so it can never get more than 4 lines, and a band would need effectively infinitely many.
- The existing test `scripts/test_spectral_blur.mjs:34-61` (`spreadCents`) measures the RMS spread in cents. Three separated lines also give a large RMS spread, so that test passes on a supersaw. It cannot tell lines from a band, and section 7 replaces it.

### 2.2 Each copy is made deliberately coherent
- **Whole-lobe moves:** `E:184-193` finds the local peak within ±3 bins (`kCloudLobe`) and moves every bin of the lobe by the same amount. The comment at `E:184-187` says this is done so the partial does *not* fall apart. Falling apart is exactly what a cloud needs.
- **The lobe shape is preserved:** `E:315-326` moves the lobe with 4-tap Catmull-Rom weights and keeps the `(-1)^bin` sign pattern. The result is a perfect Hann-lobe sinusoid at the new pitch.
- **Accumulated phase:** `E:212-214` advances each copy's phase by exactly `2π·delta·hop/N` per hop. The comment at `E:174-175` says this makes the moved partial "a continuous sinusoid at the detuned frequency". So every copy is a pure tone.
- **The analysis phase passes straight through:** Blur calls `tick(l, r, 0, 0, 0, mix, rate)` at `B:64`, so Diffusion = 0. In `E:283-286` the sin/cos then stay at (0, 1), and `E:296-297` builds the spectrum from the raw analysis phase `pr, pi` (`E:268`). Nothing ever randomises phase. In this mode the STFT is an identity transform plus shifted copies.

### 2.3 The detune is slow and pinned to its limits, so it sounds like vibrato or static detune
- **The walk is slow:** Wander defaults to 0.5 Hz (`B:13`). The walk pole at `E:181` works out to `exp(-2π·0.5·512/48000) ≈ 0.967` per hop at FFT 4096, about a 0.32 s correlation time. Each voice's pitch drifts slowly, and a slow random pitch drift is a vibrato or wow.
- **The walk is clamped:** `E:182` sets the injection so the walk's stationary spread is 1 standard deviation. `E:198` then clamps the walk to ±1, so a voice sits on the clamp about a third of the time, at the full ±Fuzz detune. The voices act roughly like fixed ±50 ¢ detuned copies, which is a supersaw.
- **The detune is narrow:** the default Fuzz of 50 ¢ (`B:12`) is only ±3.2 Hz on a 110 Hz fundamental. Three lines that close together are a slow beat, not air.
- **Wander is the wrong control:** turning Wander up only makes the vibrato faster, into FM. The tooltip at `B:13` says so: "higher is fuzz and eventually metallic FM".

### 2.4 Neighbouring partials move in lockstep
- `E:183` and `E:203-206` keep the walk at knots every 8 bins (`kCloudKnot`) and interpolate between them, so neighbouring partials share a detune trajectory.
- Above about 1 kHz at FFT 4096, several harmonics of a saw share a knot. They then move together, which reads as the whole tone wobbling rather than separate fuzz.

### 2.5 Dead code and settings found along the way (delete in the fix)
- `kCloudCapBins` (`E:15`) is never used.
- `swarmLevel` in the Cloud gain (`E:217`) is always 0 in Blur (`B:26`), so `cloudLevelState` (`E:55`, `E:84`, `E:197`, `E:199`, `E:206`) does nothing.
- `cloudWander` (`E:57`) and the Wander parameter exist only to drive the slow walk that section 2.3 says is wrong.

### 2.6 What is NOT the problem (keep)
- The 8× overlap (hop N/8) at `E:151` and the Hann² OLA gain of 1/3 at `E:152-153` are correct.
- The per-frame power match at `E:329-341` and the synthesis-window pass match at `E:344-352` are correct, and the fix needs both.
- The FFT-size warm-and-crossfade at `E:403-435` is fine.
- One RNG stream per voice from Seed (`E:89-100`) and the cents-based power kernel `blurPower` (`E:134-149`, currently used only by Smear) are useful as they are.
- The analysis and synthesis already run per channel (`E:246-355`), and the power match is per channel (`E:329-341`). So per-channel phase walks slot in without restructuring. Today all Cloud draws are shared by both channels (`E:176-177`, "Left and Right share every draw (linked)"), which is why Cloud has no stereo now.

### 2.7 What pre-split stereo did (what Argi liked)
Source: `git show 73bb587a^:native_modules/spectral_blur/spectral_blur.cpp`, plus the matching `graph_engine.cpp` and `node-live-audio-worklet-native-graph.js`. Stereo Spread was added in 8c41ad6b ("Smooth Spectral Blur phase motion and add stereo spread"). 73bb587a removed it from Blur, and afbdaa5a restored it only on Smear, where the same code still lives at `E:159-167` and `E:283-286`.

- **Stereo came from the Diffusion phase walk, not from Cloud.** Every hop, each bin got two independent random walks:
  - a shared walk `offset[k] += random()*jitter`;
  - a side walk `sideOffset[k] += sideRandom()*jitter`.
  
  Both used `jitter = sqrt(12·2π·2·hop/sr)` (pre-split lines 160, 163-168). Each walk was then smoothed by a one-pole filter with Phase Smooth (default 10 ms).
- **Per channel:** `phase = smoothOffset[k] + (c==0 ? −0.5 : +0.5) · stereoSpread · smoothSideOffset[k]`, and the bin was rotated by `diffusion · phase` (pre-split lines 286-289).
  - Left and Right shared the main walk and moved in opposite directions along the side walk. The L−R phase difference per bin was therefore `stereoSpread × (side walk)`, an unbounded random walk, so L and R drifted fully apart in phase within a fraction of a second.
  - Magnitudes were never changed per channel, and nothing was cross-fed between channels ("Does not crossfeed audio").
  - A mono input became a stereo wash whose mono sum has moving, never static, phase cancellations.
- **Speed and width:** the walk is constant in Hz, not cents. Its per-hop variance `8π·hop/sr` gives a phase-diffusion line half-width of about 2 Hz per bin at Diffusion 1, before the 10 ms smoothing. Diffusion scales the angle, so Diffusion 0 switched the stereo off entirely.
- **Seeding:** the side stream had a fixed seed (`sideRng = 0xC2B2AE35`, pre-split line 86) and did not follow the Seed control. There was no other per-channel seed or decorrelation.
- **Every control ran in every Character.** The pre-split frame applied Time Smear, Frequency Blur, Diffusion and Stereo Spread before the Cloud or Warble branch (pre-split lines 155-168, 279-289). The graph engine sent all of them every sample (pre-split `graph_engine.cpp:16398-16411`).
  - Spawn defaults were Time Smear 2 s, Frequency Blur 100 Hz, Diffusion 1, Stereo Spread 1 and Phase Smooth 10 ms (pre-split metadata lines 442-458; the worklet push defaults).
  - So the pre-split sound Argi liked on a freshly spawned module was a 2 s spectral smear, plus a 100 Hz blur, plus full Diffusion stereo wash, with Cloud's detuned voices on top when Character was Cloud.
  - The AI's own demo presets set Diffusion 0 and Stereo Spread 0, so they were mono.
- **Where that sound lives now:** Spectral Smear at its defaults (Time Smear 2 s, Diffusion 1, Stereo Spread 1, Phase Smooth 10 ms) is the pre-split default wash without Cloud.

  Cloud's stereo (section 3.4) reuses the same structure: a shared walk plus or minus half the Stereo Spread times a side walk, with no crossfeed. It is driven by Cloud's own pitch-aware walks and is seedable.

## 3. The DSP design for the fix

### 3.1 The idea
A cloud is a partial whose energy is spread into a **continuous band** around its frequency. The phase inside that band is **random over time**. The width scales with pitch (in cents), and the centre stays where it is.

Two mechanisms together do this, both inside the existing frame, with one FFT and one IFFT per channel per hop:

1. **Phase diffusion (the fluff).** Each bin gets its own random walk on its phase, per voice, updated every hop. A random-walk phase broadens a line into a smooth bell-shaped (Lorentzian) band centred on the original frequency, with no pitch shift and no vibrato. The step size per bin comes from Fuzz in cents.
   - This needs no frequency resolution, so it works even when the band is narrower than one bin. For example, 100 ¢ on a 110 Hz fundamental is ±6.5 Hz, and a bin at FFT 4096 is 11.7 Hz wide.
   - When the step reaches ±π, the phase is fully random every hop (Paulstretch). That is the widest phase diffusion can go, about ±24.5 Hz at FFT 4096 (section 3.3).
2. **Cents-wide magnitude spread (the width at the top).** Each bin's power is spread over ±Fuzz cents with the existing smooth triangular, power-matched kernel `blurPower` (`E:134-149`, `centsRatio = 2^(Fuzz/1200) − 1`, `radiusBins = 0`).
   - Above about 25 Hz half-width, phase diffusion is saturated, so this kernel is what makes a high harmonic as wide in cents as a low one.
   - The spread bins also receive the phase diffusion, so they come out as noise, not as a ringing comb.

3. **Stereo (section 3.4).** Each voice also gets a per-bin *side* walk. Left rotates by `walk − ½·Spread·side` and Right by `walk + ½·Spread·side`, the same shape as pre-split Diffusion stereo. Spread 0 is exactly linked, and Spread 1 gives fully independent fur in each ear.

**Voices** are 1 to 4 independent copies of the phase walks and level dither, summed together. They make the partly coherent zone (the low harmonics) denser and smoother. **Grain** is a small, fast amplitude flicker per bin, per hop and per voice that roughens the fur slightly, so it does not sound like a too-smooth hiss. It is built so it can **only lower or redistribute level, never raise it** (section 3.2 A, test T8b).

This is *not* the old "white per-hop jump" that `docs/SPECTRAL_BLUR.md:40-41` says caused a 94 Hz buzz. That earlier version put random jumps on top of a coherent, moved copy. Here the phase is a **random walk** (accumulated) whose step size follows the target width, and it is applied to every bin independently. At full saturation it is Paulstretch's random phase, which is smooth at 8× overlap with Hann analysis and synthesis windows. Acceptance test T7 checks for the buzz explicitly.

### 3.2 Steps per hop (in `Core::frame`, Cloud branch)

Constants per hop: `N = windowSize`, `H = N/8`, `sr = rate`, `r = 2^(Fuzz/1200) − 1`, and `L = cloudVoices` (rounded; the guard is the safety guard C-K5 in section 9, which must never bite below a definition max).

**A. Draws.** Do these once per hop, before the channel loop, replacing `E:169-223`. The main walk and Grain are shared by both channels. Only the side walk splits L from R:
```
for v in 0..L-1:                       // one xorshift stream per voice: cloudRandom(v)
  for k in 1..bins-2:                  // the bin loop also decorrelates neighbouring bins
    df    = k * sr / N * r                                   // target half-width in Hz at this bin
    step  = sqrt(12 * pi * df * H / sr)                      // uniform-step size: variance 4*pi*df*H/sr  =>  Lorentzian FWHM = 2*df
    if step >= pi:  walk[v][k] = pi * u()                    // saturated: fully random phase each hop
    else:           walk[v][k] = wrap(walk[v][k] + step * u())
    if step >= pi:  side[v][k] = pi * uS()                   // the side walk uses the voice's own SIDE stream (uS), same step size
    else:           side[v][k] = side[v][k] + step * uS()        // NOT wrapped: it is scaled by Spread/2 below, and scaling a wrapped angle jumps at pi
    a              = spreadAt(k) * side[v][k] / 2            // spreadAt(k) = Stereo Spread with the Mono Bass ramp, section 3.4
    (csL, snL)     = sin_cos(walk[v][k] - a)                 // Left
    (csR, snR)     = sin_cos(walk[v][k] + a)                 // Right
    gain[v][k]     = grainNorm * 10^(-GrainDb * uG() / 20)   // uG() uniform on [0,1] from the voice's own GRAIN stream: attenuation-only flicker
```

**Grain can never boost.** The flicker shape `10^(−G·uG/20)` only dips (it is at most 1). `grainNorm` is the analytic constant that brings its *mean power* back to exactly 1, so the average level is unchanged. A single bin can sit up to `grainNorm` above its plain value (about +2.7 dB at 6 dB Grain), but only because other bins in the same frame dip further. With `x = G·ln(10)/10`, `E[10^(−G·uG/10)] = (1 − e^(−x)) / x`, so `grainNorm = 1/sqrt((1 − e^(−x))/x)`, and `grainNorm = 1` at G = 0.

- The flicker therefore redistributes level between bins and hops without raising the average.
- The per-frame power match (step E) still holds every frame's power to the source frame's power. It is a match to the *source*, so with Grain the frame never ends up louder than the input frame.
- The old Level parameter boosted because `exp(+Level·state)` with a symmetric state raises the mean power (pre-split `swarmGain`, now `E:243`). This design rules that out.
- Grain draws use their **own** stream (uG) and side draws their **own** stream (uS), both per voice and seeded from Seed. So changing Grain or Stereo Spread never changes the main phase walks, and with the same Seed the Grain-0 and Grain-1 outputs differ only by the flicker. Test T8b depends on this.
- `u()` is uniform on [−1, 1] from `cloudRandom(v)` at `E:96-100`.
- `walk` replaces `cloudAcc` (float storage is fine because it is wrapped every hop).
- When Fuzz = 0, the step is 0 and both walks stay at 0. With Grain = 0 the gain stays 1, so the output is exactly dry at any Stereo Spread (stereo comes from the cloud). Make sure Fuzz 0 also skips the kernel.

**B. Analysis.** Unchanged, `E:250-275`.

**C. Magnitude.** Call `blurPower(c, 0, r)` (`E:137-149`), then `magnitude = sqrt(blurred[k] / edge)` (`E:279`). Pass `r` through as the cents ratio for Cloud instead of `blurCents`, which remains Smear's own.

**D. Synthesis spectrum.** For each bin `k` in 1..bins−2, with `X = magnitude·(pr + i·pi)` (the analysis phase):
```
acc[k] = sum over v of  X * gain[v][k] * (cs_c[v][k] + i*sn_c[v][k])     // cs_c/sn_c = the Left or Right rotation for channel c
```
- This is accumulated in place. There is no target bin, no fractional move, no 4-tap Catmull-Rom and no sign pattern.
- DC and Nyquist pass straight through, as at `E:307`.

**E. Level.** Keep the per-frame power match at `E:329-341`, which also handles the coherent-versus-incoherent sum of the voices. Keep the synthesis-window pass match at `E:344-352`, because a random-phase grain spreads across the frame and the synthesis window cuts more of it.

**F. Output.** Inverse FFT, then overlap-add with the existing 1/3 gain at N/8.

**Cost** is lower than today: one sin/cos and one exp per voice per bin per hop, and one complex multiply-add per voice per bin. There is no peak search and no 4-tap scatter. The cost does not depend on the input's pitch (keep the test at `scripts/test_spectral_blur.mjs:111-126`).

### 3.3 Numbers (48 kHz, FFT 4096, hop 512, about 94 hops/s)

| Signal | Fuzz 50 ¢ half-width | Fuzz 100 ¢ | Fuzz 300 ¢ | What does the work |
|---|---|---|---|---|
| 110 Hz (h1) | 1.6 Hz | 6.5 Hz | 21 Hz | phase diffusion only (narrow, still tonal) |
| 880 Hz (h8 of 110, h1 of 880) | 25.8 Hz | 52 Hz | 168 Hz | diffusion saturated, plus the kernel |
| 3520 Hz | 103 Hz | 209 Hz | 670 Hz | kernel plus fully random phase |

- The phase-diffusion limit is a half-width of `π·sr/(12·H)`. That is 24.5 Hz at FFT 4096 and 12.3 Hz at 8192.
- So on a 110 Hz saw at Fuzz 100, the fundamental is a gently breathing line, harmonic 4 and up are clearly cloudy, and harmonic 8 and up are fully diffuse fur. That is the target in section 1.

### 3.4 Stereo design (new; recreates the pre-split stereo inside Cloud)
- **Structure (same as pre-split, section 2.7):** a shared walk plus or minus half `spreadAt(k)` times a side walk, applied as a phase rotation only. Magnitudes and Grain are identical in both channels, and nothing is cross-fed. Each channel is power-matched to its own source frame (`E:329-341`).
- **What is new compared with pre-split:**
  - The side walk is per voice and per bin, and its step size is Cloud's pitch-aware one, so the stereo width follows the cloud.
  - It is seeded from Seed with its own stream per voice (pre-split used a fixed seed).
  - There is no 10 ms Phase Smooth, because Cloud's walk is meant to be fast. If listening says Spread 1 sounds too "busy" in the ears compared with pre-split, add a Phase Smooth knob later rather than a hidden constant.
- **Spread 0** gives `a = 0`, so L and R get identical rotations, and mono input gives L = R bit-exactly.
- **Spread 1:** the L−R phase difference is a full-rate random walk, so L and R are effectively independent within tens of milliseconds.
- **Mono Bass:**
  - `spreadAt(k) = Spread · ramp(f_k)`, where `ramp` is a raised-cosine rise from 0 at `MonoBass/√2` to 1 at `MonoBass·√2` (one octave wide, no hard edge).
  - Mono Bass 0 means `ramp = 1` everywhere, which is the pre-split behaviour.
  - Below the cutoff the cloud is still there; it is just identical in both ears.
- **Stereo input:** each channel is analysed separately. At Spread 0, both get the same rotations, so the input's stereo image is kept.
- **Mono sum:** at Spread 1, L+R loses on average about 3 dB against Spread 0, and its cancellations move all the time instead of forming a fixed comb. That is the honest cost of decorrelation, and it is tested (T9c).
- **Cost:** one more uniform draw and one more sin/cos per voice per bin per hop. That is still below today's cost (T12).
- **Setter:** `soemdsp_spectral_blur_set_stereo(h, spread, monoBassHz)`. Only non-finite values are refused. Mono Bass ≤ 0 means off, which is what the knob means at 0, not a clamp. Spread is used as given, above 1 too (the formula `a = Spread·side/2` is defined for any value).
- **Wiring:**
  - Map `stereoSpread` to `NATIVE_GRAPH_PARAM_PAN` (`node.pan`), as pre-split Blur did and the current Smear and Material Resonator do.
  - Map `monoBassHz` to a slot that is unused for this type, for example `NATIVE_GRAPH_PARAM_FREQUENCY` (`node.frequency`; pre-split Blur used it for Pitch Blur, and today's Blur leaves it free).

### 3.5 Parameters (the definitions are the only place limits live)

| Key | Label | Unit | Min / Mid / Max | Default | Notes |
|---|---|---|---|---|---|
| `fftSize` | FFT Size | samples | 512..16384 choice | 4096 | Keep as is. |
| `fuzz` | Fuzz | ¢ | 0 / 100 / 1200 | **100** | KEEP the key; it now sets the cloud's half-width. Nonlinear slider. |
| `grain` | Grain | dB | 0 / 1 / 6 | **1** | NEW. Fast per-bin level flicker, **attenuation-only with unity mean power** (never boosts). 0 = smooth hiss-cloud; higher = rougher fur. |
| `stereoSpread` | Stereo Spread | × | 0 / 0.5 / 1 | **1** | NEW (the same key and label as Smear and pre-split Blur, so Argi's mental model carries over). 0 = linked (mono in gives mono out); 1 = fully independent fur in each ear. |
| `monoBassHz` | Mono Bass | Hz | 0 / 120 / 1000 | **0** | NEW. Below this frequency the cloud stays identical in both ears (a one-octave smooth ramp). 0 = off, which is the pre-split sound. Try 120 if the low end feels phasey in mono. |
| `voices` | Voices | — | 1 / 2 / 4 | **3** | KEEP the key. Widen the minimum to 1. Independent cloud layers. Argi decided to keep it for now and will judge by ear. |
| `seed` | Seed | — | app seed control | 0 | Keep. Seeds every voice (Seed + voice). |
| `mix` | Mix | % | 0 / 0.5 / 1 | 1 | Keep. |
| `frequencyCurve` | Curve | — | display only | 1 | Keep (face only). |
| ~~`wander`~~ | — | — | — | — | **DELETE** everywhere (definition, native metadata, setter argument, `cloudWander`, worklet mapping, graph slot, tests, docs, demo patch). Slow wandering is Warble's job. |

The parameter descriptions go in each definition's `tooltip` field, which feeds the **docked tips panel** (no hover tooltips). Write real descriptions, for example:

- **Fuzz:** "How wide the cloud is around every partial, in cents either side: the same musical width at every pitch. Small values add air and keep the pitch tonal; large values turn each harmonic into a soft diffuse band. The centre pitch never moves. 0 is dry."
- **Grain:** "Fast random level flicker on every frequency bin, in dB. It only ever dips bins, then the level is matched, so it never makes the sound louder. 0 is a smooth, hissy cloud; a few dB makes the fur rougher and more textured."
- **Stereo Spread:** "How differently the cloud moves in each ear. 0 = the same in both (mono in stays mono); 1 = fully independent fur left and right, a wide stereo wash. Changes phase only, never level, and does not cross-feed. In mono, a high Spread can sound up to about 3 dB quieter."
- **Mono Bass:** "Keeps the cloud identical in both ears below this frequency, so the low end stays solid in mono. Smooth one-octave transition. 0 = off."
- **Voices:** "Independent cloud layers summed together. More voices make the low, still-tonal harmonics denser and smoother. Costs CPU per voice."
- **Seed:** "Random pattern of the cloud. The same Seed, input and settings always give the same output."

### 3.6 Code to delete, keep or change (no shims, no dead code)

**Delete in `spectral_stft_engine.h`** (Cloud is Blur-only: Warble sets `cloud = false` at `native_modules/spectral_warble/spectral_warble.cpp:25` and Smear does the same at `spectral_smear.cpp:29`):
- `kCloudCapBins`, `kCloudKnot`, `kCloudLobe` (`E:15`)
- `cloudTarget`, `cloudFrac` (`E:50-51`), `cloudPeak` (`E:53`), `cloudDetune`, `cloudLevelState` (`E:55`, `E:84`)
- `cloudWander` (`E:57`, `E:399`)
- the peak search (`E:188-193`), the knot walk (`E:194-200`), the lobe move (`E:201-222`) and the Catmull-Rom scatter (`E:309-327`). **Coordination:** `docs/SPECTRAL_WARBLE_FIX_PLAN.md` (section 3.7) re-homes the peak search, lobe move and scatter as Warble's engine. If both plans run in one pass, *move* that code to the Warble branch instead of deleting it. Also adopt the `enum class Engine { Smear, Warble, Cloud }` from the Warble plan (section 3.5) in place of the `cloud` flag if Warble lands first.
- the stale comments at `E:170-177` and `E:184-187`

**Keep or rename in the engine:**
- Keep `cloud` (it selects hop N/8), `cloudRng`, `seedCloud` and `cloudRandom`, plus `cloudCos`, `cloudSin` and `cloudGain` (now the rotation and the dither), `specRe`/`specIm`/`accRe`/`accIm`, and the level matches.
- Rename `cloudAcc` to `cloudWalk`. Add `cloudSide[kMaxVoices][bins]` (**double**, kept unwrapped as the pre-split side walk was; see `E:158`), split the rotations into Left and Right arrays (`cloudCos[2][kMaxVoices][bins]` and `cloudSin[2][kMaxVoices][bins]`), and add per-voice `cloudSideRng` and `cloudGrainRng` streams seeded in `seedCloud()` from Seed + voice with distinct salts. Add `cloudSpread` and `cloudMonoBassHz`.
- Leave Smear's own `sideOffset`, `smoothSideOffset`, `sideRandom` and `stereoSpread` (`E:39`, `E:115-118`, `E:165-166`, `E:284`) alone. They are Smear's stereo.
- Add `double cloudGrain`.
- Check whether `wrapTurns` (`E:17`) is still needed: keep it only if the walk uses it.

**`spectral_blur.cpp`:**
- In the metadata (`B:10-16`), change the label to "Spectral Cloud", delete `wander`, add `grain`, and give `fuzz` and `voices` the new ranges and descriptions.
- Update the native label comment at `B:2`.
- Update `create()` defaults at `B:26`.
- Change the setter to `soemdsp_spectral_blur_set_cloud(h, fuzzCents, grainDb, voices, seed)` (`B:48-62`), refusing only non-finite values. A negative Fuzz is treated as 0 (safety guard C-K2: a negative width gives the square root of a negative number in the step and a negative kernel width). Grain is used as given at any value: a negative Grain still has unity mean power through `grainNorm` (section 3.2 A).
- Add `soemdsp_spectral_blur_set_stereo(h, spread, monoBassHz)` (section 3.4).
- Bump the version at `B:44` to 2.

**`native_modules/graph_engine/graph_engine.cpp`:**
- Update the declaration at `:891`, the comment at `:2676` and the call at `:16422` (Grain replaces `node.lfoBaseSpeed`).
- Declare and call `soemdsp_spectral_blur_set_stereo(node.nativeHandle, control_audio(g, node.pan, f), control_audio(g, node.frequency, f))` next to the other Blur setters.
- Use whichever existing node field the worklet maps Grain to. Prefer a slot no other Blur parameter uses, for example `NATIVE_GRAPH_PARAM_LEVEL` if it is free for this type.

**`public/node-live-audio-worklet-native-graph.js`:** update the key-to-slot map at `:639-646` and the push list at `:6303-6311` (`wander` out; `grain`, `stereoSpread` (PAN, default 1) and `monoBassHz` (FREQUENCY, default 0) in; new `fuzz` default of 100).

**`public/node-graph-module-definitions.js`:**
- In the parameters at `:8938-9055`, delete `wander` and add `grain`.
- In the face row at `:8932`, change `[["fuzz","Fuzz"],["wander","Wander"]]` to `[["fuzz","Fuzz"],["grain","Grain"]]`. Add a row `{ kind: "cells", params: [["stereoSpread","Stereo Spread"],["monoBassHz","Mono Bass"]], h: 40 }` after Voices.
- Add the `stereoSpread` and `monoBassHz` parameters (section 3.5).
- Make the Voices cell's minimum 1.

**Generated files:**
- Rebuild the wasm for `spectral_blur` and `graph_engine` with `scripts/build_native_modules.ps1`.
- Also rebuild `spectral_warble` and `spectral_smear`, because they include the same header.
- Regenerate `public/native-modules-catalog.json` from metadata if the build script does that. Do not hand-edit it if it is generated.

**Saved patches:**
- Old patches still have `"wander"` (and `fuzz: 50`). Check that the patch loader quietly ignores a parameter key the definition no longer has. If it does not, fix that generically. Do **not** add a Blur-specific shim.
- Old patches keep their Fuzz value, so they will sound like a smaller cloud. That is acceptable (Argi has said to build it the best way for the sound).

## 4. Rename to "Spectral Cloud" (user-visible only)

**Change:**
- `public/node-graph-module-definitions.js:211`: `spectralBlur: "Spectral Cloud"`.
- `public/node-graph-module-store.js:1148-1153`:
  - label "Spectral Cloud";
  - new description, e.g. "Native STFT cloud: every partial blooms into a soft, diffuse band Fuzz cents wide, centred on its pitch (no detune, no vibrato). Processing delay follows FFT Size.";
  - notes `["spectral","STFT","cloud","fuzz","diffuse","texture","native"]`, dropping chorus, supersaw and detune;
  - emoji ☁️ instead of 🌊 if Argi agrees (Warble also uses 🌊).
- Native metadata label (`B:2`, `B:10`) and the catalog label (generated).
- The comment at `public/modules/spectralDisplay/spectral-display-face.js:2` and any other user-visible string that says "Spectral Blur" for this module. Use `rg -n "Spectral Blur"` to find them, but do not touch historical docs that describe old commits.
- Docs: rewrite `docs/SPECTRAL_BLUR.md` as `docs/SPECTRAL_CLOUD.md` (use `git mv`, then rewrite the Controls, How it works and Preset sections). Update the links in `docs/SPECTRAL_SMEAR.md`, `docs/SPECTRAL_WARBLE.md`, `docs/handoffs/INDEX.md` and `docs/STFT_ROADMAP.md`.
- Demo patch: `git mv patches/demo_patches/spectral_blur.json patches/demo_patches/spectral_cloud.json`. The AI created that file, so Argi is fine with renaming it (optional, decided 2026-11-26). Update the description text, set `fuzz: 100`, `grain: 1`, `stereoSpread: 1` and `monoBassHz: 0`, and remove `wander`. Update every reference to the old file name (`rg -n "spectral_blur.json"`, including docs and tests).

**Do NOT change** (keeps saved patches and the engine wiring working):
- the type key `spectralBlur`
- native type id 272 (`graph_engine.cpp:2676`, worklet `:296`)
- folder and module name `spectral_blur` and the export names `soemdsp_spectral_blur_*`
- the visual input key `spectralBlurIn`
- the bypass map, `node-graph-efficient-product.js:49` and `node-graph-module-bypass.js:288`
- the face config key `spectralBlur` in `spectral-display-face.js:14` and `spectral-display-worklet.js:23`
- the test file names

## 5. Face and display notes (consistent with SPECTRAL_DISPLAY_TEST_NOTES.md section 8)

- **Display default to be confirmed by Argi after testing** (2026-11-26). He will pick each module's default style after trying them all; Waterfall is usually his least favourite. Keep the style list easy to reorder per module.
- Styles stay limited to **Particles (default), Overlay and Waterfall** (`spectral-display-face.js:14`). Do not add styles. Display Settings show only what these styles use.
- **Overlay** is the clearest way to see that it works. Draw the input ghost (lane B "In", `spectral-display-worklet.js:23`) against the output. On a saw you should see thin input lines and wide, soft output bumps around each harmonic, wider at higher harmonics on the log Curve.
- **Waterfall** is the vibrato detector. Cloud output should look like soft, steady, fuzzy stripes. Wavy stripes would mean pitch wobble, which is a bug.
- **Particles** must be driven by the real analysed output spectrum: particle spread and density come from the measured band width, not from the Fuzz knob value. Nothing is faked; if there is no audio, there are no particles.
- Display scaling uses honest dB (the existing floor of −90 dB and ceiling of 0 dB). Scaling must never fake clipping.
- Display work happens in the audio-callback collector, with events only (no timers or polling) and WebGL only.
- Phone: the face rows are FFT, then Fuzz and Grain, then Voices, then Stereo Spread and Mono Bass, then Seed, then Mix, then Curve. That is one 40-unit row more than today; check that it still fits the phone layout with the default display height.
- The display stays mono (the existing lanes: output A, input ghost B). Do not invent a stereo view in this change.
- No hover tooltips anywhere. Tips go in the docked panel.

## 6. Acceptance tests

Put these in `scripts/test_spectral_blur.mjs`, rewriting its Wander-specific parts at `:11`, `:14`, `:30`, `:33` and `:72-88`. Update `scripts/test_spectral_blur_graph.mjs` (slot list: Wander slot 46 goes; the Grain, Stereo Spread (PAN) and Mono Bass (FREQUENCY) slots come in) and `scripts/test_spectral_blur_browser.mjs`.

Signals are 48 kHz. Use a band-limited (additive) saw and sines. Measure after the warm-up, over at least 4 s. The test's own analysis uses a long Welch PSD (about 65536 points, Hann) unless stated otherwise. Unless stated, Fuzz = 100, Voices = 3, Grain = 1, Stereo Spread = 0, Mono Bass = 0 and FFT = 4096. The mono checks T2-T7 measure Left; the stereo checks set Spread themselves.

### 6.1 Objective checks

| # | Check | Pass |
|---|---|---|
| T1 | **Dry at Fuzz 0, Grain 0** (any Voices, any Stereo Spread): output equals the input delayed by N. | max error < 1e-4 (keep the existing check at `:44-51`) |
| T2 | **Band, not lines:** an 880 Hz sine. In the PSD within ±Fuzz cents of 880 Hz, count local maxima more than 6 dB above their neighbours. Also compute spectral flatness (geometric mean over arithmetic mean of power) over ±0.5·Fuzz. | ≤ 1 peak (the centre) and flatness ≥ 0.35. Record the afbdaa5a engine's values for comparison: expect about 3 peaks and flatness < 0.1. |
| T3 | **Width in cents:** the −10 dB half-width (cents) around a sine at 1760 Hz and at 3520 Hz. | ratio between 0.6 and 1.6, and wider at Fuzz 300 than at Fuzz 100 than at Fuzz 50 |
| T4 | **Inter-hop phase coherence drops:** a separate test STFT (N = 4096, H = 512) of the output for a sine at f0. At the peak bin, `d = Δphase − 2π·f0·H/sr` per hop, and coherence = `|mean(exp(i·d))|`. | Dry ≥ 0.99. Fuzz 100 at 880 Hz ≤ 0.5 and at 3520 Hz ≤ 0.15. It falls steadily as Fuzz rises. |
| T5 | **No vibrato (centroid modulation):** for a sine at 880 Hz, track the power-weighted centroid within ±2·Fuzz cents every 20 ms for 8 s. | Mean centroid within ±3 ¢ of 880 Hz. The centroid trajectory's modulation spectrum has no peak more than 6 dB above its median between 0.2 and 20 Hz. Centroid standard deviation < 0.15·Fuzz cents. Record afbdaa5a for comparison (it should fail on the standard deviation). |
| T6 | **Saw is cloudy, pitch kept:** a 110 Hz saw. (a) Harmonics 1 to 3 are still distinct peaks, each more than 10 dB above the gap midway to the next harmonic. (b) For harmonics 16 to 24, the gap midpoint power rises by at least 15 dB compared with dry. (c) For an 880 Hz saw, every harmonic up to 8 kHz has flatness ≥ 0.3 within ±0.5·Fuzz. | all three |
| T7 | **No frame-rate buzz:** for a sine at 880 Hz, look for discrete lines at f0 ± k·sr/H (k = 1, 2) on top of the cloud's smooth skirt. | each less than 3 dB above the skirt interpolated from ±10 Hz around it |
| T8 | **Level match:** RMS ratio of output to input, per channel. Saw at 110 and 880 Hz, Fuzz {0, 50, 100, 300, 1200}, Voices {1..4}, Grain {0, 1, 6}, Spread {0, 1}. | within ±1 dB, with no clamp and no makeup gain beyond the per-frame matches |
| T8b | **Grain never boosts:** same Seed and input (saw at 110 and 880 Hz, Fuzz {50, 100, 1200}, Voices {1, 4}, Spread {0, 1}). Compare Grain {1, 3, 6} against Grain 0, per channel over 8 s. Also check that `grainNorm` gives unity mean power numerically (10^6 draws). | output RMS ≤ Grain-0 RMS + 0.1 dB; output peak ≤ Grain-0 peak + 0.5 dB; no sample beyond ±1 that the Grain-0 output did not also reach; mean power of the gain factor within 1 ± 0.002 |
| T8c | **Peaks are reported, not hidden:** a saw at −1 dBFS peak, Fuzz {100, 1200}. Random phase raises the crest factor at matched RMS. | Record the peak gain over dry in the test log and in `docs/SPECTRAL_CLOUD.md`. It must stay ≤ +6 dB, with no limiter and no clamp. If it exceeds that, report to Argi rather than adding a hidden limiter. |
| T9a | **Spread 0 is linked:** mono in at Stereo Spread 0 (any Fuzz, Grain, Voices or Mono Bass) gives Left = Right. Feeding the same signal to In or to Left+Right gives the same output. | max L−R error < 1e-9 (keep and extend `:90-95`) |
| T9b | **Spread decorrelates:** mono saw at 880 Hz, Fuzz 100. Pearson correlation of L and R over 4 s. | Spread 0 gives 1.000; Spread 0.5 between 0.3 and 0.9; Spread 1 gives \|ρ\| ≤ 0.3. Falls steadily with Spread. |
| T9c | **Mono sum stays sane:** at Spread 1, compare (L+R)/2 with the Spread-0 output. Also compare 1/6-octave-smoothed long PSDs of the two. | mono-sum RMS within −4 dB to +0.5 dB of Spread 0; no smoothed-PSD dip deeper than 6 dB (no static comb) |
| T9d | **Mono Bass works:** Spread 1, Mono Bass 200 Hz. Measure the L/R correlation on a 100 Hz sine and on a 2 kHz sine. | 100 Hz ρ ≥ 0.95; 2 kHz \|ρ\| ≤ 0.3; Mono Bass 0 makes the 100 Hz sine decorrelate too |
| T9e | **Stereo in keeps its image at Spread 0:** different signals on Left and Right at Fuzz 100, Spread 0. | each output channel's cross-talk from the other input < −80 dB (no crossfeed) |
| T10 | **In place:** an impulse leaves no energy beyond one window after it. | keep `:63-69` |
| T11 | **Deterministic:** the same Seed and settings give identical output. A different Seed changes it. Voices 1 vs 4 changes it. | keep and extend `:80-88` |
| T12 | **Cost:** cost does not depend on pitch (keep `:111-126`). At Voices 4 and N = 16384, it is not slower than the afbdaa5a engine. | both |
| T13 | **Warble and Smear unchanged:** `node scripts/test_spectral_warble.mjs` and `node scripts/test_spectral_smear.mjs` pass. Render a fixed signal through both, before and after; the output must be the same within 1e-7. | both |
| T14 | **Robust:** finite under rapid Fuzz, Grain, Voices, Stereo Spread, Mono Bass and FFT edits, NaN input and FFT switches. A switch stays neutral at Fuzz 0. | keep `:98-121` |
| T15 | **Voices measurably differs:** at Fuzz 100 on a 110 Hz saw, Voices 1 vs 4 shows lower envelope-fluctuation variance on harmonics 1 to 3 at 4 voices. | Report the numbers. Argi keeps Voices for now and decides by ear; if he later drops it, delete it completely (no dead settings). |
| T16 | **Limits come from the definition, not the code:** see section 9.4. | all |

### 6.2 Listening (Argi decides)
Use a keyboard, then a band-limited saw, then Spectral Cloud, then the output. Play 110 Hz and 880 Hz, each held 4 s, at Fuzz 0, 50, 100 and 300, with Voices 1 vs 4, Grain 0 vs 3, and Stereo Spread 0 vs 1 (on headphones and summed to mono). Also A/B against a freshly spawned **Spectral Smear** (its defaults are the pre-split stereo wash) to confirm Cloud's stereo is in the same family.

Pass when all of these hold:
- The pitch is clear and still.
- Each note has soft, breathy fur around it, and 880 Hz is as fluffy as 110 Hz.
- There is no vibrato, beating, supersaw, buzz or metallic ring.
- There is no tail after release.
- Mix 0 vs 1 is the same loudness, and Grain never makes it louder or clip.
- Stereo Spread 1 is a wide, soft stereo fur that Argi likes at least as much as the pre-split sound, and mono playback is not hollow.
- It sounds clearly different from Spectral Warble.

### 6.3 Commands
- `node scripts/test_spectral_blur.mjs`, `node scripts/test_spectral_blur_graph.mjs` and `node scripts/test_spectral_blur_browser.mjs`
- `node scripts/test_spectral_warble.mjs` and `node scripts/test_spectral_smear.mjs`
- `node scripts/test_spectral_display.mjs` and `node scripts/test_spectral_spawn_widths.mjs`

## 7. App rules (must follow)

- **Parameter limits live only in the parameter definitions and with the user** (Argi, 2026-11-26). There are no musical clamps or caps in C++, the worklet, graph_engine or the setters. Raising a max in the parameter interface must reach the DSP unchanged. Safety guards stay only where they prevent a failure (NaN/Inf, division by zero, array bounds, FFT size, runaway, memory). Each one carries a `// safety: <reason>` comment and must never quietly act as a musical cap (section 9).
- **No hover tooltips.** Every parameter's `tooltip` text is a real description shown in the **docked tips panel**.
- **Phone-friendly** face. Same row layout and touch targets as today.
- **Events only, no timers or polling.** Hop-rate work stays inside the STFT frame, and the face draws from the audio-callback collector.
- **No dead code, dead settings or compatibility shims.** Delete Wander, the knot walk, the lobe move, the Catmull-Rom scatter, `kCloudCapBins` and `cloudLevelState`. Fix stale comments and docs in the same change.
- **Only MIDI modules handle MIDI** (not relevant here, so do not add any).
- **WebGL-only UIs.** Display scaling never fakes clipping.
- **`?v=` cache tags:** in `public/index.html` and `public/perform.html`, *append* a suffix such as `-cloud2` to the existing `?v=` of every changed script. These are `node-graph-module-definitions.js` (index `:3607`, perform `:3592`) and `node-graph-module-store.js` (index `:3922`, perform `:3905`), plus `spectral-display-face.js` and the worklet only if you change them. **Never replace or shorten another agent's tag.**
- **Coordinate edits.** Other agents have uncommitted work in this tree. Leave other people's dirty files and hunks alone. Before touching `graph_engine.cpp`, `index.html` or `perform.html`, check `git diff` and stage only your own hunks.
- **Never touch MasterBot's files:** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, and any cull, present or camera code.
- **Git:**
  - Work directly on master: no PRs, no cloud agents.
  - No force push, stash, `reset --hard`, rebase or branch switch.
  - Commit only your own hunks and preserve line endings.
  - Then a plain `git merge origin/master`. Push only after Argi says yes.
- **Never kill servers or restart the app.** Argi reloads with Ctrl+F5.

## 8. Decisions (Argi, 2026-11-26)
All of the earlier open questions are decided. There are no open questions left for this plan.

1. **Fuzz:** default 100 ¢, maximum 1200 ¢. Decided.
2. **Grain:** a knob, 0 to 6 dB, default 1. It must never boost or clip like the old Level did, hence the attenuation-only, unity-power flicker plus level match (section 3.2 A) and tests T8b and T8c. Decided.
3. **Voices:** keep it, 1 to 4, default 3. Argi will judge by ear whether it earns its place (T15 reports the numbers). Decided for now.
4. **Stereo:** Cloud gets its **own stereo controls**, Stereo Spread (default 1) and Mono Bass (default 0). They are built on the pre-split Diffusion-stereo structure that Argi liked (sections 2.7 and 3.4), with tests T9a to T9e. The earlier mono-only recommendation is withdrawn. Each spectral module may stereoize in its own way. Decided.
5. **FFT Size:** default 4096. Decided.
6. **Demo patch:** the AI made it, so renaming it to `spectral_cloud.json` is fine (section 4). The ☁️ emoji is optional and up to the implementer. Decided.

## 9. Hard-coded limits to delete

Argi's rule (2026-11-26): limits come **only** from the parameter definitions and the user. Raising a maximum in the parameter interface must reach the DSP unchanged.

The exceptions are guards that prevent app failures or explosions: NaN/Inf, division by zero, array or buffer bounds, FFT-size validity, runaway feedback, and memory. Those stay, each with a `// safety:` comment, and must not quietly act as musical caps.

I found these at afbdaa5a in `B`, `E`, `native_modules/graph_engine/graph_engine.cpp` (`G`), `public/node-live-audio-worklet-native-graph.js` (`K`) and `public/node-graph-module-definitions.js`. Warble's own list is in `docs/SPECTRAL_WARBLE_FIX_PLAN.md` section 8.

### 9.1 Cloud: delete (musical caps)
| # | Where | What | Why it is a cap |
|---|---|---|---|
| C-D1 | `E:198` | `cloudDetune` state clamped to ±1 | Pins each voice at ±Fuzz. Deleted with the knot walk. |
| C-D2 | `E:199` | `cloudLevelState` clamped to ±1 | The cap of a dead level wobble. Deleted with it. |
| C-D3 | `E:178` | Voices re-clamped to 1..kMaxVoices inside the frame | A duplicate of the setter's guard. One guard in one place (C-K5). |
| C-D4 | `E:305` | The same duplicate Voices clamp in the synthesis | Same as C-D3. |
| C-D5 | `E:181` | `cloudWander > 0 ? cloudWander : 0` repeated in the frame | A duplicate guard. Goes with Wander. |
| C-D6 | `B:56` | Wander: negative becomes 0 | Goes with the Wander parameter. |
| C-D7 | `E:15` | `kCloudCapBins = 32` "fan-out guard" | An unused cap constant (its use was removed in afbdaa5a, "no detune cap"). Delete so it cannot come back. |

### 9.2 Cloud: keep (safety guards)
| # | Where | Guard | Reason |
|---|---|---|---|
| C-K1 | `B:53` | Seed: non-finite or ≤ 0 becomes 0; ≥ 2^32−1 saturates | The storage type is uint32. The definition max (16777215) is far below it. |
| C-K2 | `B:55`, plus the new Fuzz guard | Fuzz: non-finite becomes 0; negative becomes 0 | NaN guard; a negative width gives the square root of a negative number and a negative kernel width (division by ≤ 0). 0 is the definition's minimum, and there is **no upper limit**: Fuzz above 1200 ¢ works if the definition allows it. |
| C-K3 | `B:37` | FFT size must be 512..16384 power of two | FFT validity and the fixed transform sizes and buffers (`E:10`, `E:18-33`). |
| C-K4 | `E:209` | A moved bin too near DC/Nyquist stays put | Array bounds of the 4-tap move. It leaves Cloud with that code, and travels with it to Warble. |
| C-K5 | `B:58` | Voices: rounded, below 1 becomes 1, above `kMaxVoices` held to storage | Below 1 is a division by zero (`E:180`); above storage is an array bound. **Not a silent cap:** the native metadata exposes `voiceStorage`, and T16 fails if the definition max exceeds it. Raise `kMaxVoices` (memory) rather than letting the guard bite. |
| C-K6 | `E:335` | Power match only when `accPower > 1e-30` | Division by zero. |
| C-K7 | `E:350-351` | Window-pass match only when energies > 1e-24 | Division by zero. |
| C-K8 | `E:363`, `E:379` | Reset on non-finite input or output, or sample rate < 100 | NaN/Inf containment; an invalid sample rate. |
| C-K9 | `K:5751-5764`, `G:3801-3818` | Modulation is clamped to the parameter's min/max domain | **Comes from the definition / user-edited range** (pushed from `meta.min/max`), so it follows a raised max. Keep it; T16 proves it. |

Checked and clean: `K:5672-5689` (`readContinuous`/`readDiscrete` pass values through), `K:639-646` and `:6303-6311`, and `G:5124-5130` and `:16420-16425` (defaults only; values passed straight through `control_audio`).

### 9.3 Shared engine and Smear (owner: the Smear plan; fix there unless you are already editing these lines)
| # | Where | What | Delete or keep |
|---|---|---|---|
| S-D1 | `E:156` | `if (radius > bins - 1) radius = bins - 1;` caps Frequency Blur | **Delete (musical cap).** `boxMean` already handles a kernel wider than the spectrum (`E:124-125`, `E:131`), and the cap changes the edge bins at extreme widths. |
| S-K1 | `E:154`, `E:374` | Negative Time Smear or Frequency Blur refused (treated as 0) | Keep: a negative time makes the one-pole coefficient exceed 1 (explosion); a negative width divides by ≤ 0. |
| S-K2 | `E:157` | `blurCents > 0 ? … : 0` | Keep: a negative width divides by ≤ 0. |
| S-K3 | `E:160-161` | Phase and Amplitude Smooth > 0 guards | Keep: one-pole explosion for a negative time. |
| S-K4 | `native_modules/spectral_smear/spectral_smear.cpp:56-57` | Negative ms becomes 0 | Keep: the same pole explosion. |
| S-K5 | `spectral_smear.cpp:68` | Negative Pitch Blur becomes 0 | Keep: a negative width divides by ≤ 0. |
| S-K6 | `spectral_smear.cpp:63` | Non-finite Stereo Spread becomes 0 | Keep: NaN guard (no other limit). |
| S-K7 | `E:124-125`, `E:131` | `boxMean` edge clipping | Keep: array bounds. |
| S-K8 | `E:279` | `blurred > 0 ? … : 0` before the square root | Keep: rounding can make a tiny negative, and its square root would be NaN. |

### 9.4 Test T16: a raised max reaches the DSP unclamped
Add it to `scripts/test_spectral_blur_graph.mjs` for Cloud (and Smear when its plan runs):
1. Load a patch whose `spectralBlur` node has `paramMeta` raising `fuzz.max` to 4800, `grain.max` to 24, `stereoSpread.max` to 2 and `voices.max` to `voiceStorage`. Set fuzz 3000, grain 12, spread 1.5 and voices = `voiceStorage`.
2. Assert that the worklet pushes exactly those values to the native slots (slot readback), and that each slot's pushed domain has the raised max.
3. Render a sine at 1760 Hz: the −10 dB width at Fuzz 3000 is clearly wider than at 1200 (the value was used, not capped). Grain 12 still passes T8b's no-boost bounds.
4. With unit-band modulation pushing Fuzz past 1200 (but within 4800), the effective value exceeds 1200.
5. **Guard lint:** a test that scans `spectral_*.cpp` and `spectral_stft_engine.h` for clamp shapes (a comparison against a constant inside `? :`, `min(`/`max(`, `if (x > c) x = c`). It fails on any such line without a `// safety:` comment, and the safety lines must match sections 9.2 and 9.3.
6. Assert that every definition max for Voices is ≤ `voiceStorage` (C-K5).

## 10. Build order across the three plans
Follow `docs/SPECTRAL_SMEAR_FIX_PLAN.md` section 10: shared prep first (engine setting, `// safety:` comments, guard lint, T16 harness, inactive-parameter rules), then Warble, then Cloud, then Smear, one commit each. Each step appends its own `?v=` suffix and re-baselines the other modules against the previous step's build.
