# Spectral Smear: Fix Plan

| | |
|---|---|
| **Status** | Plan only. Nothing here is built yet. Hand this to the outside coding AI. This is the third of three: Cloud, Warble, Smear. |
| **Module** | `spectralSmear` (native type 282, `native_modules/spectral_smear/`). It keeps its name, **Spectral Smear**. |
| **Base commit** | afbdaa5a. Smear is the pre-split Spectral Blur wash: 73bb587a split it out, and afbdaa5a restored Frequency Blur, Stereo Spread and Phase Smooth. |
| **Scope** | Only Spectral Smear, plus the build order across all three plans (section 10). Cloud: `docs/SPECTRAL_CLOUD_FIX_PLAN.md`. Warble: `docs/SPECTRAL_WARBLE_FIX_PLAN.md`. |
| **Verdict** | **Mostly good. Keep the sound family Argi liked and fix three real faults:** metallic ringing from how smeared and blurred energy gets its phase, a level loss that the test suite asserts on purpose, and frame-rate grain in decaying tails. Add Mono Bass, Seed, a Normal/Smooth hop choice and inactive-parameter striping. Delete one musical cap. **Goal (Argi, 2026-11-26): avoid the metallic sound as much as possible.** A deliberately metallic or clangy effect is a possible future module and is out of scope here. |

Line numbers below are from afbdaa5a. Re-check them before editing because other agents work in this tree.

File keys:
- `S` = `native_modules/spectral_smear/spectral_smear.cpp`
- `E` = `native_modules/spectral_blur/spectral_stft_engine.h`
- `D` = `public/node-graph-module-definitions.js`
- `K` = `public/node-live-audio-worklet-native-graph.js`
- `G` = `native_modules/graph_engine/graph_engine.cpp`
- `T` = `scripts/test_spectral_smear.mjs`

---

## 1. What it should sound like

Smear is the **wash**: a sound's spectrum smeared in time (it lingers and blooms) and spread in frequency (partials melt into each other), with drifting phases that give it width and air. It is the pre-split default sound Argi liked (Time Smear 2 s, Frequency Blur 100 Hz, Diffusion 1, Stereo Spread 1, Phase Smooth 10 ms), made cleaner.

**Target tests:**
- **A plucked or struck sound** (a short saw pluck at 110 Hz and at 880 Hz, a snare, a voice phrase) at default settings, Mix 1, on headphones.
  - The attack softens into a bloom.
  - After the note stops, a smooth spectral tail decays over about the Time Smear time.
  - The tail is wide in stereo and soft, like a frozen reverb that slowly lets go.
- **A held 110 Hz saw:** a dense, slowly breathing pad. The harmonics are blurred into bands by Frequency Blur and Pitch Blur, and the pitch is still recognisable at moderate blur.
- **There must be NO:**
  - metallic ringing or "tin can" tone (a grid of steady whistling tones, especially in the highs and in tails);
  - crackle or grain in the decaying tail;
  - level drop or boost when Blur or Diffusion is turned up (the level matches the input on sustained sounds);
  - phasey, hollow bass in mono.
- **Everything at 0 is the dry signal**, delayed by one window. This already works.

## 2. Audit of the current Smear

### 2.1 What is good (keep it; do not rewrite)
- **Time Smear** (`E:154`, `E:259`): per-bin exponential power averaging in real seconds, correctly hop-aware. It is musical and honest ("not a delay or freeze", `S:12`).
- **The blur kernel** (`E:119-149`): bcd1df7f replaced the hard box with a **smooth triangular kernel** (two box passes), **power-matched** per frame. Frequency Blur (Hz, `S:13`) and Pitch Blur (cents, `S:14`) add together, so a pitch-aware blur already exists. This answers half of the test-notes request (section 8 of `docs/SPECTRAL_DISPLAY_TEST_NOTES.md`). The other half is section 2.2.
- **Diffusion plus Stereo Spread structure** (`E:159-167`, `E:283-286`): a shared per-bin phase walk plus or minus half the Spread times a side walk. Phase only, with no crossfeed. This is the pre-split stereo Argi liked (Cloud plan section 2.7). **Keep it as Smear's stereo.**
- **Phase Smooth** (`E:160`, `E:164`, `E:166`) and **Amplitude Smooth** (`E:161`, `E:280`): honest one-pole lags.
- **Neutral reconstruction, channel isolation, the FFT warm-and-crossfade, local resets on non-finite values, and no allocation while processing** (`docs/SPECTRAL_SMEAR.md:27-66`), all well tested (`T`, 130 lines; reconstruction about 4e-8 at 44.1, 48 and 96 kHz).
- **Real units everywhere** (s, Hz, ¢, ms, ×).

### 2.2 Fault 1: metallic ringing (bcd1df7f did NOT fully fix it)
Argi's note: "Frequency Blur sounds metallic, wider at high frequencies". bcd1df7f fixed the *kernel* (no hard edges, no sinc ripple) and added Pitch Blur. Spawn defaults are still Frequency Blur 100 Hz and Pitch Blur 0 (`S:13-14`, `G:5142-5143`). More importantly, the metallic sound comes from **phase, not the kernel**:
- **Spread energy gets the wrong phase.**
  - After blurring, every bin's new magnitude is combined with **that bin's own analysis phase** (`E:268`, used at `E:294-301`).
  - A bin next to a partial carries the partial's leakage phase. The spread energy is therefore a *coherent*, reshaped copy of the partial: its time grain is shorter and modulated, which you hear as a buzz at the frame rate (47 Hz at FFT 4096).
  - A bin far from any partial carries noise-floor phase, re-drawn every frame (grain).
- **Diffusion drifts too slowly to break that up.**
  - The walk is a fixed `jitter = sqrt(12·2π·2·hop/sr)` (`E:159`), a phase-diffusion linewidth of about 2 Hz per bin, scaled by Diffusion (`E:285`).
  - Spread over a 100 Hz-wide band, each bin's energy keeps ringing as an almost steady sinusoid at roughly its bin frequency. Bins are 11.7 Hz apart at FFT 4096, so the wash contains **a fixed grid of steady tones**. That is the metallic, tin-can colour, and it repeats every window length (85 ms).
  - It is most obvious in the highs, where a 2 Hz drift is nothing next to the frequency, and in long Time Smear tails.
- **Phase in tails.** Once the input stops, the smeared *power* keeps sounding, but its *phase* still comes from the current input frame (`E:255-275`).
  - The "continue the last phase advance" fallback only fires when a bin's input power is below an **absolute** 1e-24 (`E:260`), which in practice means digital silence.
  - Real tails over a noise floor therefore get noise phase, re-randomised 47 times a second (crackle). Digital-silence tails freeze into steady sinusoids (ringing).
  - `docs/SPECTRAL_SMEAR.md:81-84` already mentions the "cancellation-driven crackle".

### 2.3 Fault 2: Blur loses level, and the test asserts it
- `T:100-110` asserts that Blur 300 ¢ keeps **less than 0.9** of the level (more than 1 dB loss) and that the loss is *bigger at higher pitch*. `T:124-130` asserts the same for Frequency Blur (`lo < 0.9`).
- The cause: the spread spectrum is a different grain shape, so the synthesis window passes less of it. Cloud and Warble already compensate with the window-pass match (`E:344-352`), but it is gated to `cloud || swarming` (`E:252`, `E:345`), so **Smear never gets it**.
- Diffusion adds a second, uncompensated loss: phases that decorrelate between overlapping frames add incoherently in the 4× overlap-add.
- App rule: no parameter may boost *or* change the level. The fix makes these tests require ±1 dB instead.

### 2.4 Fault 3: frame-rate artefacts at hop N/4
- Smear runs at N/4 (`E:151`): 47 frames per second at 4096. Per-frame changes (Diffusion steps, tail phase, blurred magnitudes under Amplitude Smooth 0) are crossfaded over only 4 overlaps.
- Cloud and Warble move to N/8. For Smear, Argi chose to make the hop a parameter (section 3.1): Normal N/4 (the default, today's CPU) or Smooth N/8 (frame artefacts halved, double the CPU).

### 2.5 Smaller items
- **No Seed.** The two phase streams use fixed seeds (`rng = 0x9e3779b9`, `sideRng = 0xC2B2AE35`, `E:85`), so two Smear instances decorrelate identically, and parallel or doubled Smears are correlated with each other. Every other random module has the app Seed control ("new modules get their own").
- **No Mono Bass.** Diffusion stereo decorrelates the bass too, which makes it phasey in mono.
- **Inactive parameters look active.** Stereo Spread and Phase Smooth do nothing when Diffusion is 0 (`S:16` says "Requires Diffusion above zero"), but they look live.
  - The striping mechanism bcd1df7f added (`NODE_GRAPH_FACE_INACTIVE_PARAMS` in `public/node-graph-module-face.js`) was **deleted by 73bb587a**. Its index tag still carries `-inact3` (`public/index.html:3567`).
- **The demo patch is mono and not the liked sound.** `patches/demo_patches/spectral_smear.json` uses Time Smear 0.5, Frequency Blur 0, Pitch Blur 100, Diffusion 1, **Stereo Spread 0**. That is not the pre-split default Argi liked.
- **Stale docs.** `docs/SPECTRAL_SMEAR.md` still says "Music … -> Spectral Blur" (`:70`), "Blur 100 cents" where it means Hz (`:71`), points at `SPECTRAL_BLUR.md` for Cloud (`:3`), and mentions "1D Trace is the only display path" (`:66`), which is wrong now that the face uses the spectral styles.
- **Swarm leftovers.** `S:29` sets `swarm`, `swarmLevel` and `swarmDrift`. The Warble plan deletes that path and these assignments (Warble plan section 3.6), so do **not** do it again here.

## 3. The DSP design for the fix

Keep the signal flow. Change only how phase is assigned to smeared and blurred energy, and match the level.

### 3.1 Hop: a Normal / Smooth parameter (Argi, 2026-11-26)
- **New parameter `hopMode`**, labelled "Hop", shown as **2 choice buttons**: **Normal** (overlap 4, hop N/4, the **default**, today's CPU) and **Smooth** (overlap 8, hop N/8, about **double the CPU**, half the frame-rate artefacts).
  - Definition: `kind: "choice"`, `choices: ["Normal","Smooth"]`, `choiceKeys: ["normal","smooth"]`, `choiceIds: [4, 8]` (the overlap factor), `displayChoices: true`, `divideChoicesVisibly: true`, `linearSmoothing: false`, `smoothingType: "none"`.
  - The definition owns the choices. The native side derives everything from the overlap value it receives.
- **No hard-coded per-mode numbers:**
  - hop = `N / overlap`;
  - OLA gain = `8 / (3 · overlap)` (Hann analysis times Hann synthesis), computed, not a table;
  - the coherence factor `κ` (section 3.4) is computed in `reset()` for the core's own overlap.
- **Safety, not a musical cap:** the native setter accepts any overlap that is a power of two ≥ 2 and divides N, because those are the only values for which the frame buffers and the OLA are valid. It rejects anything else, the same way FFT Size rejects invalid sizes (`S:40`). A future choice such as 16 only needs a definition change. This guard carries a `// safety:` comment.
- **Glitch-free switching:**
  - The overlap is part of a core. A change goes through the **existing warm-and-crossfade core change** (`E:403-435`, which already treats a hop change like an FFT-size change, `E:405`).
  - The inactive core is set to the new overlap and the same N, warmed for N samples, then crossfaded over 50 ms with the existing smoothstep.
  - Because the window size and therefore the **latency (N samples) is the same in both modes**, the two cores are time-aligned. There is no comb or flam, and `latency_for_handle` keeps reporting N throughout.
  - To prevent a level dip while two *decorrelated* diffused signals crossfade:
    - at the switch, copy the active core's per-bin state into the warming core verbatim (no remap is needed at the same N): `power`, `magnitudeState`, `phaseR`/`phaseI`, `velocity`, `offset`/`smoothOffset`, `sideOffset`/`smoothSideOffset`, and the RNG states;
    - so both cores continue the same phase walks and the crossfade is between coherent signals.
  - A hop and an FFT-size change requested together use one core change. If a change arrives mid-crossfade, the existing queue takes it.
- **Time constants stay honest in both modes.** Time Smear, Phase Smooth and Amplitude Smooth poles are already computed from the hop. The Diffusion walk's per-hop variance follows the hop (the formula in 3.2), so the diffusion per second is identical in Normal and Smooth.
- **No boost:** the level matches in section 3.4 run per core at its own overlap. T9 runs in both modes, and T17 covers the switch.

### 3.2 Diffusion Speed: how fast diffused phases drift (the metallic fix)
- Replace the fixed 2 Hz walk (`E:159`) with a **new parameter, Diffusion Speed** (Hz, the phase-diffusion half-width per bin).
  - Per bin and per hop, the shared walk and the side walk each step by `u·sqrt(12π·Speed·H/sr)`, with `u` uniform on [−1, 1]. That is the same Lorentzian law as the Cloud plan: variance `4π·Speed·H/sr`, line half-width = Speed.
  - **Diffusion** stays the amount, scaling the angle as today (`E:285`), and the walks stay unwrapped (`E:158`).
- Diffusion Speed is in **Hz on purpose**: bins are equally spaced in Hz, so a Hz drift rate decorrelates every bin's steady tone equally.
  - About 2 Hz is the pre-split glassy sound, which rings metallic on wide blurs.
  - 20–60 Hz turns the same blur into a soft, non-metallic wash.
- **Pre-split match:** Diffusion Speed 2 Hz with Diffusion 1 reproduces the old walk's linewidth (in either hop mode).
- **Default 30 Hz** (Argi, 2026-11-26: avoid the metallic sound as much as possible). 2 Hz stays reachable for a pre-split comparison, but it is not the default and is not tuned for.

### 3.3 Live versus smeared phase (the tail fix)
- For each bin, compute `c_k = min(1, P_in,k / P_out,k)`.
  - `P_in` is this frame's input power at the bin.
  - `P_out` is the blurred and smeared target power (`blurred[k]`).
  - This is a blend weight from a power ratio, not a parameter limit. Mark it `// blend weight` so the guard lint (section 8.3) accepts it.
- **Base phase angle:** `continued_k + c_k · wrap(analysis_k − continued_k)`.
  - `continued_k` advances by the bin's held phase advance `velocity` (`E:262-273`).
  - That held advance is now updated as `velocity ← slerp(velocity, measured, c_k)` instead of on the absolute 1e-24 test at `E:260`. Delete that threshold branch.
- Then add Diffusion's walk rotation as today (`E:283-286`).
- Result:
  - Where the input is really present (c ≈ 1), the phase is the input's, so nothing changes: at Time Smear 0 and Blur 0, `P_out = P_in`, `c = 1`, and the output is exact identity (T1).
  - Smeared tails and spread energy (c → 0) get a smoothly continuing phase plus Diffusion's drift. That means no noise-floor crackle and, with Diffusion Speed, no frozen ringing.

### 3.4 Level match (no loss, no boost)
- **Window-pass match:** apply the existing match (`E:344-352`) to Smear too. Remove the `cloud || swarming` gating at `E:252` and `E:345` (it becomes unconditional for all three engines).
- **Overlap coherence compensation (Diffusion).**
  - Per bin, the expected inter-frame phase coherence after one hop is known analytically from the walk step `s_k`: `ρ_k = sinc(s_k)` for a uniform step, raised to the power of the Diffusion angle scaling.
  - With `κ` the analytic ratio of incoherent to coherent overlap-add power for Hann² at the core's own hop (compute it once in `reset()` per core), scale each bin's magnitude by `g_k = 1/sqrt(ρ_k + (1−ρ_k)·κ)`.
  - `g_k` only restores the loss that decorrelation causes. It is 1 at Diffusion 0 and never above the analytic loss, so it is **not makeup gain and cannot boost** beyond the source.
- **No limiter, no clamp.** T9 checks RMS and peak.

### 3.5 Mono Bass (new) and Seed (new)
- **Mono Bass** (Hz, default **120**, matching Warble):
  - The side walk's contribution is scaled by `ramp(f_k)`, a raised-cosine rise from 0 at `MonoBass/√2` to 1 at `MonoBass·√2`.
  - Below the cutoff both channels share the phase motion. 0 means off.
- **Seed** (app seed control): seeds `rng` and `sideRng` (`E:85`) from Seed with distinct salts, replacing the fixed constants. A changed Seed reseeds both cores, as in the other modules.

### 3.6 Parameters (the definitions are the only place limits live)

| Key | Label | Unit | Min / Mid / Max | Default | Decision |
|---|---|---|---|---|---|
| `fftSize` | FFT Size | samples | 512..16384 choice | 4096 | KEEP |
| `smearSeconds` | Time Smear | s | 0 / 1 / 10 | 2 | KEEP |
| `blurHz` | Frequency Blur | Hz | 0 / 200 / 4000 | 100 | KEEP (the pre-split default; it stops being metallic once Diffusion Speed is up) |
| `blurCents` | Pitch Blur | ¢ | 0 / 100 / 1200 | 0 | KEEP (the pitch-aware width; adds to Frequency Blur) |
| `diffusion` | Diffusion | × | 0 / 0.5 / 1 | 1 | KEEP |
| `diffusionSpeedHz` | Diffusion Speed | Hz | 0 / 30 / 200 | **30** | NEW (section 3.2). Nonlinear slider. |
| `hopMode` | Hop | choice | Normal / Smooth (choiceIds 4 / 8) | **Normal** | NEW (section 3.1). 2 choice buttons. |
| `stereoSpread` | Stereo Spread | × | 0 / 0.5 / 1 | 1 | KEEP |
| `monoBassHz` | Mono Bass | Hz | 0 / 120 / 1000 | **120** | NEW (the same key as Cloud and Warble) |
| `phaseSmoothMs` | Phase Smooth | ms | 0 / 10 / 200 | 10 | KEEP |
| `amplitudeSmoothMs` | Amplitude Smooth | ms | 0 / 10 / 200 | 0 | KEEP |
| `seed` | Seed | — | app seed control | 0 | NEW |
| `mix` | Mix | % | 0 / 0.5 / 1 | 1 | KEEP |
| `frequencyCurve` | Curve | — | display only | 1 | KEEP |

Nothing is deleted from the parameter list.

Docked tips panel text (each definition's `tooltip`; no hover tooltips). Rewrite where it changes:
- **Diffusion Speed:** "How fast the diffused phases drift, in Hz. The default 30 Hz melts the blur into a soft wash with no ringing tones; very low values (about 2 Hz) bring back the old glassy sound, which can ring metallic with a wide blur. Only does something while Diffusion is above 0."
- **Mono Bass:** "Below this frequency both ears get the same phase motion, so the bass stays solid in mono. One-octave smooth transition. 0 = off. Only does something while Diffusion and Stereo Spread are above 0."
- **Hop:** "How finely the sound is processed in time. Normal is the standard quality; Smooth makes twice as many analysis frames, which gives softer, less grainy motion in tails and diffusion, at about double the CPU. It does not change the delay or the level. Switching is glitch-free."
- **Seed:** "The random pattern of the diffusion. The same Seed, input and settings always give the same output; each new module gets its own."
- **Frequency Blur** and **Pitch Blur:** remove "level preserving" unless T9 passes (it will after section 3.4), and drop the phrase about level loss.
- **Stereo Spread:** keep the text, but it must say "Only does something while Diffusion is above 0" (it already does).

### 3.7 Which file changes what
- **`S`:**
  - Metadata `:10-19`: add `diffusionSpeedHz`, `monoBassHz` and `seed`, and fix the tooltips.
  - Add setters `soemdsp_spectral_smear_set_diffusion_speed(h, hz)`, `soemdsp_spectral_smear_set_mono_bass(h, hz)` and `soemdsp_spectral_smear_set_seed(h, seed)`. They can be combined into one setter if you prefer, as long as it follows the same pattern as the others.
  - `create()` `:29`: engine selection (section 10); the Swarm leftovers are removed by the Warble step.
  - Bump the version at `:47`.
- **`E`:**
  - Delete the radius cap at `:156` (section 8).
  - Walk step from Diffusion Speed (`:159`), Mono Bass ramp on the side walk (`:165-166` or `:284`), and Seed-based `rng`/`sideRng` (`:85`, `:111-118`).
  - The c-weighted phase and velocity (`:255-275`).
  - The window-pass match for all engines (`:252`, `:345`) and the coherence compensation (section 3.4).
  - Per-core overlap from `hopMode`: hop and OLA gain are computed from it (`:151-153`, `:359`), the state copy on a hop-only change goes into `beginChange()` (`:403-418`), and `State` gets a `desiredOverlap` that is compared like `desired` (`:423`).
  - Add a setter `soemdsp_spectral_smear_set_overlap(h, overlap)`; the slot is any one that is free for this type, for example `NATIVE_GRAPH_PARAM_MODE`.
- **`G`:** `init_control` `:5139-5148` (new controls) and the calls `:16432-16439`.
- **`K`:**
  - Key-to-slot map `:654-664`:
    - `diffusionSpeedHz` → a slot that is free for this type, for example `NATIVE_GRAPH_PARAM_LFO_RATE`;
    - `monoBassHz` → `NATIVE_GRAPH_PARAM_LPF_FREQUENCY` or another free slot (`FREQUENCY` is taken by Pitch Blur here);
    - `seed` → `SEED`.
  - Push list starting at `:6320`.
- **`D` `:8388-…`:**
  - Parameters as above.
  - Face rows: FFT Size; Time Smear; Frequency Blur | Pitch Blur; Diffusion | Diffusion Speed; Stereo Spread | Mono Bass; Phase Smooth | Amplitude Smooth; Seed; Mix; Curve.
- **Inactive look** (section 5).
- **Demo patch:** set `patches/demo_patches/spectral_smear.json` to the pre-split defaults (Time Smear 2, Frequency Blur 100, Pitch Blur 0, Diffusion 1, Stereo Spread 1, Phase Smooth 10, Amplitude Smooth 0), with Diffusion Speed at its new default, Mono Bass 120 and Seed 1. Update the description.
- **Docs:** rewrite the stale parts of `docs/SPECTRAL_SMEAR.md` (section 2.5) and describe Diffusion Speed, the tail phase, level matching, Mono Bass and Seed.
- **Rebuild** `spectral_smear` and `graph_engine`, and also `spectral_blur` and `spectral_warble` because they share the header.

## 4. Stereo (Smear's own way)
Smear keeps the pre-split **shared plus side phase walk** (Cloud plan section 2.7 describes it exactly):
- left = shared − ½·Spread·side, right = shared + ½·Spread·side, phase only, with no crossfeed;
- each channel analysed separately, so a stereo input keeps its image at Spread 0.

What changes:
- Diffusion Speed now sets the walk speed (section 3.2).
- Mono Bass keeps the lows shared (default 120).
- Seed decorrelates instances from each other.

Cloud randomises noise phase per voice, and Warble fans voices that wobble in pitch. **Smear's stereo is a slow drifting phase wash**, which is distinct, as Argi asked.

## 5. Display and inactive parameters
- **Styles:** keep Overlay, Particles and Waterfall (`public/modules/spectralDisplay/spectral-display-face.js:16`). **Keep Smear's current default style** (the first in its list; do not change it in this plan).
- **Display default to be confirmed by Argi after testing** (2026-11-26). He will pick each module's default style after trying them; Waterfall is usually his least favourite. Keep the style list easy to reorder per module.
- **Overlay** draws the input ghost (lane B) against the output, so the blur widening and the tail after the input stops are both visible.
- **Particles** are driven only by the real output spectrum. Nothing is faked.
- Use honest dB (−90 to 0) and never fake clipping. WebGL only. Events only.
- **Inactive look:**
  - Restore a generic `NODE_GRAPH_FACE_INACTIVE_PARAMS` (from `git show bcd1df7f:public/node-graph-module-face.js`). Extend its rule to **any of several conditions**: `{ anyOf: [{ when: "diffusion", values: [0] }, { when: "stereoSpread", values: [0] }] }`.
  - Draw the app's existing under-construction / not-applicable stripes.
  - Re-evaluate when a controlling parameter **changes** (an event), not on a timer or by polling.
  - Smear rules:
    - `stereoSpread`, `phaseSmoothMs` and `diffusionSpeedHz` are inactive when Diffusion = 0 (Hop always applies, so it is never striped);
    - `monoBassHz` is inactive when Diffusion = 0 or Stereo Spread = 0.
  - The same mechanism serves Cloud (Mono Bass inactive when Fuzz or Spread is 0) and Warble (Mono Bass inactive when Spread is 0; Rate, Drunk and Voices inactive when Depth is 0). It is built once in the shared prep step (section 10).
- **Phone:** the face grows by one 40-unit row (Stereo Spread | Mono Bass) and one Seed row. Check it fits; if not, raise `displayHeightGu` or `defaultWidthGu` rather than shrinking touch targets.

## 6. Acceptance tests

Keep everything in `T` that still holds: neutral reconstruction at 44.1, 48 and 96 kHz, latency, silence, channel isolation, Amplitude Smooth, rapid edits, finite recovery, every FFT size, and the Spread-decorrelation check at `:118-123`.

**Rewrite `T:100-110` and `T:124-130`:** these lock in the level loss as a feature and must now require matched level. Update `scripts/test_spectral_blur_graph.mjs` (new slots) and `scripts/test_spectral_blur_browser.mjs`.

Signals are 48 kHz: band-limited saws, sines, a pluck (a saw with a 50 ms decay) and noise bursts, measured after warm-up. Unless stated, the defaults of section 3.6 apply.

### 6.1 Objective checks
| # | Check | Pass |
|---|---|---|
| T1 | **Neutral:** Time Smear 0, both Blurs 0, Diffusion 0, Amplitude Smooth 0 (any Speed, Spread, Mono Bass, Seed) gives the input delayed by N. | max error < 1e-4 (the existing tests reach about 4e-8 and should stay that close) |
| T2 | **Not metallic: no steady tone grid.** Sustained noise band 2–6 kHz, Frequency Blur 400 Hz, Diffusion 1. Over 4 s, the long-PSD peak-to-floor ratio at the bin-centre frequencies (k·sr/N) and the output's spectral flatness inside the band. | at Speed 30 Hz: peaks < 3 dB above the smoothed floor and flatness ≥ 0.5. Record Speed 2 Hz (it should show the grid) and afbdaa5a. |
| T3 | **Tail is smooth, with no crackle:** a pluck at 880 Hz with Time Smear 2 s, input with a −90 dBFS noise floor. In the tail (0.2–1.5 s after the note), the energy at the frame rate sr/H and its harmonics in the tail envelope's spectrum. | < −40 dB relative to the envelope's DC; afbdaa5a recorded for comparison |
| T4 | **Tail does not freeze into ringing:** the same pluck with digital-silence input after the note. Count PSD lines in the tail more than 10 dB above the floor. | at Speed ≥ 20 Hz, no more lines than the input's own harmonics |
| T5 | **Live sound is untouched by the tail logic:** at Time Smear 0 and Blur 0 with Diffusion 0, output equals input (T1). At Time Smear 0, Blur 100 Hz and Diffusion 0, the phase at partial-peak bins matches the input's within 0.05 rad. | both |
| T6 | **Time Smear time is honest:** the tail's power decays with a time constant within ±15 % of Time Smear (measured on the band energy after the input stops), in both hop modes. | yes |
| T7 | **Blur widths:** Pitch Blur gives the same −10 dB width in cents at 700 Hz and 2.8 kHz (ratio 0.7–1.4). Frequency Blur gives the same width in Hz at both. | both |
| T8 | **Pitch kept at moderate blur:** 110 Hz saw, Pitch Blur 50 ¢, Frequency Blur 0. Harmonics 1–4 are still distinct peaks more than 6 dB above the midpoints. | yes |
| T9 | **Level matched, no boost:** sustained 110 and 880 Hz saws and pink noise, per channel RMS (steady state) and peak, over Frequency Blur {0, 100, 1000}, Pitch Blur {0, 300, 1200}, Diffusion {0, 0.5, 1}, Speed {2, 30, 200}, Spread {0, 1}, FFT {1024, 4096, 16384}. | RMS within ±1 dB of the input; peak ≤ dry peak + 3 dB; no limiter or clamp. Replaces the asserted loss at `T:108-109` and `T:129`. |
| T10a | **Spread 0 is linked:** mono in gives Left = Right. | max error < 1e-9 |
| T10b | **Spread decorrelates:** mono 880 Hz saw, Diffusion 1, Speed 30. L/R correlation at Spread 0 / 0.5 / 1. | 1.000 / between 0.3 and 0.9 / ≤ 0.3 |
| T10c | **Mono sum is sane:** at Spread 1, (L+R)/2 RMS against Spread 0, and 1/6-octave PSD. | within −4 dB to +0.5 dB; no dip deeper than 6 dB |
| T10d | **Mono Bass:** Spread 1, Mono Bass 200. L/R correlation on a 100 Hz sine and a 2 kHz sine. | ≥ 0.95 at 100 Hz; ≤ 0.3 at 2 kHz |
| T10e | **No crossfeed:** a signal on Left only. | Right output < −80 dB |
| T11 | **Seed:** the same Seed gives identical output, a different Seed changes it, and two instances with different Seeds decorrelate (correlation of their outputs ≤ 0.5 at Diffusion 1, Speed 30). | all |
| T12 | **Cost:** one audio second at N = 16384, Normal ≤ 1.15× and Smooth ≤ 2.3× the afbdaa5a figure; cost does not depend on pitch. | both |
| T13 | **Inactive look:** in the browser test, Diffusion 0 stripes Stereo Spread, Phase Smooth, Diffusion Speed and Mono Bass. Spread 0 stripes Mono Bass. Changing the controlling parameter updates the stripes on that event (no timer). | all |
| T14 | **Robust:** finite under rapid edits of every parameter (including beyond the definition ranges), NaN input and FFT switches; neutral across a switch (keep the existing tests). | all |
| T15 | **Cloud and Warble unchanged by this change** (their outputs against the previous step's build, within 1e-7) apart from the shared hop and level-match changes already made in their own steps. | yes |
| T16 | **Limits come from the definition:** see section 8.3. | all |
| T17 | **Hop switch is glitch-free:** a sustained saw and a pluck sequence, with Diffusion 1 and Time Smear 2. Toggle Normal ↔ Smooth 20 times at random moments, including mid-crossfade and together with an FFT-size change. | No click: the high-passed (above 8 kHz) sample-to-sample difference never exceeds 2× its steady-state maximum. Short-term RMS (10 ms) stays within ±1 dB across every switch. `latency_for_handle` stays N. Neutral settings stay neutral within 1e-4 through a switch. All values stay finite. |
| T18 | **Both hops honest:** T1, T6, T9 and T10a-e pass in Normal and in Smooth. Time Smear's decay time and the diffusion per second match between modes within ±10 %. | all |

### 6.2 Listening (Argi decides)
- Play a 110 Hz and an 880 Hz saw pluck, a held 110 Hz saw, a snare and a voice phrase.
- Run each at the defaults, at Hop Normal against Smooth, at Diffusion Speed 30 Hz against 2 Hz, at Frequency Blur 100 Hz against Pitch Blur 100 ¢, at Spread 0 against 1 (headphones and mono), and at Mono Bass 0 against 120.
- **A/B with the pre-split module:** set Diffusion Speed 2 and Mono Bass 0, and compare with a pre-split build (`git show 73bb587a^` wasm, a spawned Spectral Blur) on the same pluck. It should be the same family and at least as nice.

Pass when all of these hold:
- the wash blooms and tails smoothly;
- it is wide but solid in mono;
- there is no metallic ringing (the goal is as little as possible), crackle, level drop or boost;
- switching Hop makes no click.

## 7. App rules (must follow)
- **Parameter limits live only in the parameter definitions and with the user.** There are no musical clamps or caps in C++, the worklet, graph_engine or the setters (section 8). Safety guards stay only where they prevent a failure (NaN/Inf, division by zero, array bounds, FFT size, runaway, memory). Each one carries a `// safety: <reason>` comment and must never quietly act as a musical cap.
- **No hover tooltips.** Each parameter's `tooltip` is a real description for the **docked tips panel**.
- **Phone-friendly** face (section 5).
- **Events only, no timers or polling.** Hop-rate work stays inside the STFT frame; the inactive look updates on parameter-change events.
- **No dead code, dead settings or shims.** Delete the absolute 1e-24 phase branch (`E:260` and `E:269-273`, replaced by section 3.3), the radius cap, and stale doc text.
- **WebGL-only UIs.** Display scaling never fakes clipping.
- **Only MIDI modules handle MIDI** (none here).
- **`?v=` tags:** in `public/index.html` and `public/perform.html`, *append* a suffix such as `-smear2` to the existing `?v=` of every changed script. These are:
  - `node-graph-module-definitions.js` (index `:3607`, perform `:3592`);
  - `node-graph-module-store.js` (index `:3922`, perform `:3905`), if the description changes;
  - `spectral-display-face.js` (index `:3754`, perform `:3738`);
  - `node-graph-module-face.js` (index `:3567`, perform `:3553`), for the inactive look.
  
  **Never replace or shorten another agent's tag** (section 10).
- **Coordinate edits.** Other agents have uncommitted work in this tree. All three plans touch `spectral_stft_engine.h`. Check `git diff` first and stage only your own hunks.
- **Never touch MasterBot's files:** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, and any cull, present or camera code.
- **Git:**
  - Work directly on master: no PRs, no cloud agents.
  - No force push, stash, `reset --hard`, rebase or branch switch.
  - Commit only your own hunks and preserve line endings.
  - Then a plain `git merge origin/master`. Push only after Argi says yes.
- **Never kill servers or restart the app.** Argi reloads with Ctrl+F5.

## 8. Hard-coded limits to delete

Argi's rule (2026-11-26): limits come **only** from the parameter definitions and the user. The exceptions are guards that prevent failures or explosions (NaN/Inf, division by zero, array or buffer bounds, FFT-size validity, runaway feedback, memory). They stay with a `// safety:` comment and must never act as musical caps. The same list appears as section 9.3 in the Cloud plan; **this plan owns it**.

### 8.1 Delete (musical caps)
| # | Where | What | Why it is a cap |
|---|---|---|---|
| S-D1 | `E:156` | `if (radius > bins - 1) radius = bins - 1;` | Caps Frequency Blur. `boxMean` already handles a kernel wider than the spectrum (`E:124-125`, `E:131`); the cap changes the edge bins at extreme widths and stops a raised `blurHz` max from reaching the DSP. |

### 8.2 Keep (safety guards)
| # | Where | Guard | Reason |
|---|---|---|---|
| S-K1 | `E:154`, `E:374` | Negative Time Smear or Frequency Blur refused (treated as 0) | A negative time makes the one-pole coefficient exceed 1 (explosion); a negative width divides by ≤ 0. 0 is the definition's minimum. |
| S-K2 | `E:157` | `blurCents > 0 ? … : 0` | A negative width divides by ≤ 0. |
| S-K3 | `E:160-161` | Phase and Amplitude Smooth > 0 guards | One-pole explosion for a negative time. |
| S-K4 | `S:56-57` | Negative ms becomes 0 | The same pole explosion, at the setter. |
| S-K5 | `S:68` | Negative Pitch Blur becomes 0 | A negative width divides by ≤ 0. |
| S-K6 | `S:63` | Non-finite Stereo Spread becomes 0 | NaN guard (no other limit; Spread above 1 is used as given). |
| S-K7 | `E:124-125`, `E:131` | `boxMean` edge clipping | Array bounds. |
| S-K8 | `E:279` | `blurred > 0 ? … : 0` before the square root | Rounding can make a tiny negative, and its square root would be NaN. |

**Shared engine guards also on Smear's path** (counted in the Cloud plan): the FFT-size whitelist (`S:40`), resets on non-finite values or sample rate < 100 (`E:363`, `E:379`), and the window-pass division guards (`E:350-351`).

**New guards this plan adds:**
- Diffusion Speed: negative becomes 0 (the square root of a negative step).
- Seed: uint32 storage, as in the other modules.
- Mono Bass ≤ 0 means off. That is the knob's meaning at 0, not a clamp.
- `c_k = min(1, …)` is a blend weight, commented `// blend weight`.

**Checked and clean:** `K:654-664` and the push list from `:6320` (values passed raw through `readContinuous`, `K:5672-5675`), and `G:5139-5148` and `:16432-16439` (defaults only, `control_audio` pass-through). The modulation domain clamp (`K:5751-5764`, `G:3801-3818`) follows the definition and user range: keep it, and prove it with T16.

### 8.3 Test T16: a raised max reaches the DSP unclamped
Add it to `scripts/test_spectral_blur_graph.mjs` (the shared harness used by the Cloud and Warble plans):
1. Load a `spectralSmear` node whose `paramMeta` raises the following maxima, and set each to its value:

   | Parameter | Raised max | Set to |
   |---|---|---|
   | `blurHz` | 24000 | 20000 |
   | `blurCents` | 4800 | 3000 |
   | `smearSeconds` | 60 | 40 |
   | `diffusionSpeedHz` | 1000 | 800 |
   | `stereoSpread` | 2 | 1.5 |

2. Assert that the worklet pushes those exact values, and that each slot's pushed domain carries the raised max.
3. Render and check each was used:
   - Frequency Blur 20000 spreads at least as wide as at the old 4000 cap (the radius cap is gone);
   - the Time Smear tail time constant is about 40 s (±15 %);
   - Pitch Blur at 3000 ¢ is wider than at 1200.
4. With unit-band modulation pushing `blurHz` past 4000 (but within 24000), the effective value exceeds 4000.
5. **Guard lint** (shared with the other plans): fail on any clamp shape in `spectral_*.cpp` or `spectral_stft_engine.h` without a `// safety:` or `// blend weight` comment, and the safety lines must match the three plans' Keep lists.

## 9. Decisions (Argi, 2026-11-26)
All the earlier questions are decided, so none are open.

1. **Avoid the metallic sound as much as possible.** Diffusion Speed defaults to **30 Hz** (no ring). A deliberately metallic or clangy sound may become its own future module; it is out of scope here.
2. **Old pre-split patches are left alone.** There is no migration and no shim.
3. **Display default is not decided.** Keep Smear's current default style. Argi will pick each module's default after trying them (Waterfall is usually his least favourite).
4. **Mono Bass defaults to 120 Hz.**
5. **The hop is a parameter:** Normal (N/4, default) or Smooth (N/8, about double the CPU), shown as 2 choice buttons. It switches glitch-free with latency unchanged, under the same no-hard-cap and no-boost rules (section 3.1, tests T17 and T18).

## 10. Build order across the three plans

All three plans edit `native_modules/spectral_blur/spectral_stft_engine.h`, `graph_engine.cpp`, the worklet, `node-graph-module-definitions.js` and the same `?v=` lines. Build them **in this order**, one commit each. Re-baseline the "other modules unchanged" tests (Cloud T13, Warble T15, Smear T15) against the *previous step's* build, not against afbdaa5a.

0. **Shared prep (no sound change):**
   - `enum class Engine { Smear, Warble, Cloud }` replacing `cloud` and `swarming` (Warble plan section 3.5);
   - `// safety:` comments on every kept guard, plus the guard lint test;
   - the T16 harness in `scripts/test_spectral_blur_graph.mjs`;
   - `voiceStorage` in the metadata;
   - the generic `NODE_GRAPH_FACE_INACTIVE_PARAMS` with `anyOf` rules (section 5).
   
   Rebuild all three wasm; outputs must be the same within 1e-7.
1. **Warble** (`docs/SPECTRAL_WARBLE_FIX_PLAN.md`):
   - It **moves** the peak search, lobe move and Catmull-Rom scatter out of the Cloud path into the Warble branch (Warble plan section 3.7), and deletes the Swarm path, including the Swarm leftovers at `S:29`.
   - Deleting `seedSwarm` and `swarmSeed` also means editing the Cloud setter's call at `native_modules/spectral_blur/spectral_blur.cpp:59` to the renamed seed. That is the only edit to Cloud's file in this step.
   - Warble goes to hop N/8.
2. **Cloud** (`docs/SPECTRAL_CLOUD_FIX_PLAN.md`):
   - It deletes the remaining old Cloud walk (the knot OU walk and level state; the moved code is already gone from its path), builds the phase-diffusion cloud, and renames the module to Spectral Cloud.
   - It reuses `blurPower` (`E:137-149`) with radius 0. **Smear's step must not change `blurPower`'s behaviour** without re-running Cloud's tests.
3. **Smear** (this plan):
   - Diffusion Speed, the live/smeared phase, level matching, the Normal/Smooth hop parameter, Mono Bass, Seed, and the deletion at `E:156`.
   - After this step, the overlap is a per-core value everywhere: Cloud and Warble fix it at 8, and Smear takes it from `hopMode`. Hop and OLA gain are computed from the overlap, which replaces the per-engine branch at `E:151-153` and `E:359`. The other modules' T15/T13 baselines stay valid, because their overlap does not change.

**Other conflicts checked:**
- **Mono Bass defaults differ on purpose:** Cloud 0, Warble 120, Smear 120 (decided). They share the key `monoBassHz` and the same ramp, so implement the ramp once in the engine.
- **`?v=` tags:** each step *appends* its own suffix (`-prep1`, `-warble2`, `-cloud2`, `-smear2`) to the same lines. If you do several steps in one pass, append all their suffixes. Never replace or shorten a tag.
- **Docs:** the Cloud step renames `docs/SPECTRAL_BLUR.md` to `docs/SPECTRAL_CLOUD.md` and updates `docs/SPECTRAL_SMEAR.md:3`. Do not redo that here; fix only Smear's own stale text.
- **Hard-coded limits:** the Cloud plan section 9.3 copy of Smear's list is the same as section 8 here. This plan owns the fixes.
