# Spectral Blur — Swarm Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-25 |
| **Status** | Swarm **Warble** is built (93ba63c0 and follow-ups). **Cloud** is design only: do not change DSP in this doc revision. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Related** | `docs/SPECTRAL_BLUR.md` (current module; do not replace it), `native_modules/spectral_blur/spectral_blur.cpp` |

This is a handoff for an outside coding AI. Sections 1-10 described the first Swarm slice; that slice is now in the tree and sounds **warbly**, which is useful but not the fuzzy/fluffy cloud Argi wanted. Section 11 designs **Cloud** mode. Implement only Cloud (keep Warble as-is). Leave the dead `stftBlur` cleanup until asked. Do not change any other modules.

---

## 1. Goal

Add a fuzzy, "swarming" sound to **Spectral Blur** (`spectralBlur`, native type 272) that **stays in place in time**. Partials should buzz and wobble around the current analysis, not smear into a reverb or alien wash.

The current module already sounds like reverb/alien at its defaults. That is expected. Do not retune Time Smear, Frequency Blur, or Diffusion to fake a swarm. Add new, separate controls. Swarm at default 0 must leave old patches sounding the same.

---

## 2. How Spectral Blur works now

Native STFT effect. DSP is C++ in `native_modules/spectral_blur/spectral_blur.cpp` (`Core::frame`, `Core::tick`, `Core::spread`). The graph calls it from `process_stft_dynamics` in `native_modules/graph_engine/graph_engine.cpp` when `node.typeId == kTypeSpectralBlur` (272). The worklet only maps params; there is no JS DSP.

- Hann-windowed STFT, hop = FFT size / 4, IFFT overlap-add. Sizes 512–16384, default 4096 (about 85 ms delay at 48 kHz; latency equals the window). Size changes warm a second core and crossfade 50 ms.
- Each hop: FFT; leaky-average per-bin power (**Time Smear**, `smearSeconds`); box-spread that power to neighboring bins (**Frequency Blur**, `blurHz`); optional magnitude lag (**Amplitude Smooth**); rotate each bin's phase; IFFT.
- **Diffusion** is a Brownian phase walk, not a wobble: `offset[k] += random() * jitter` every hop, then a one-pole (**Phase Smooth**) on that unwrapped walk. At amount 1 the walk wanders and never returns to the analysis phase. **Stereo Spread** adds a second walk with opposite signs per channel (no audio crossfeed). Quiet bins continue their last measured phase advance.
- Defaults are very wet: Time Smear 2 s, Frequency Blur 100 Hz, Diffusion 1, Stereo Spread 1, Phase Smooth 10 ms, Amplitude Smooth 0, Mix 1. That is why it sounds like a stereo spectral reverb / alien wash. Zero smear, zero blur, zero diffusion, and zero Amplitude Smooth reconstruct the delayed input.

Current Control slots (`init_control` around `graph_engine.cpp` line 5105; worklet map in `public/node-live-audio-worklet-native-graph.js` ~637 and ~6283):

| Param | Node Control | `NATIVE_GRAPH_PARAM_*` |
|-------|--------------|------------------------|
| `fftSize` | `stages` | `STAGES` (22) |
| `stereoSpread` | `pan` | `PAN` (1) |
| `phaseSmoothMs` | `offsetMs` | `OFFSET_MS` (55) |
| `amplitudeSmoothMs` | `diffusionSize` | `DIFFUSION_SIZE` (41) |
| `smearSeconds` | `timeNumerator` | `TIME_NUMERATOR` (52) |
| `blurHz` | `width` | `WIDTH` (31) |
| `diffusion` | `diffusionAmount` | `DIFFUSION_AMOUNT` (42) |
| `mix` | `mix` | `MIX` (40) |

Also keep the C++ metadata JSON in `spectral_blur.cpp` and `public/native-modules-catalog.json` in sync. Existing tests: `scripts/test_spectral_blur.mjs`, `scripts/test_spectral_blur_graph.mjs`, `scripts/test_spectral_blur_browser.mjs`. Current native version is 4; bump it if the ABI/metadata changes.

---

## 3. New parameters

Limits come **only** from the parameter definitions. Suggested keys and ranges (adjust only if an open question is settled first):

| Key | Label | Default | Min / mid / max | Slot |
|-----|-------|---------|-----------------|------|
| `swarm` | Swarm | **0** | 0 / 0.5 / 1 | `node.shape` → `NATIVE_GRAPH_PARAM_SHAPE` (13) |
| `swarmRate` | Rate | 5 | 0.1 / 5 / 40, unit Hz, `kind: "frequency"` | `node.lfoRate` → `NATIVE_GRAPH_PARAM_LFO_RATE` (57) |
| `swarmDrift` | Drift | **0** | 0 / 0.5 / 1 | `node.lfoVariation` → `NATIVE_GRAPH_PARAM_LFO_VARIATION` (47) |
| `swarmSeed` | Seed | 1 | 0 / 1 / 16777215, `kind: "seed"`, step 1 | `node.seed` → `NATIVE_GRAPH_PARAM_SEED` (48) |

- **Swarm**: amount. 0 is off (bit-identical to today). 1 is full designed depth (see §4).
- **Rate**: how fast the per-bin noise wobbles (one-pole cutoff / speed). Updates only at the STFT hop rate (at default 4096 / 48 kHz, hop is ~47 Hz), so do not claim audio-rate modulation. Rate may stay at 5 Hz when Swarm is 0; it must not change the output until Swarm or Drift is up.
- **Drift** (include in this slice): tiny mean-reverting extra phase advance per hop, a slight pitch wander around the bin, not a frequency-bin smear.
- **Seed**: deterministic noise. Same Seed + same input + same params → same output. Additive NoisyFreq / NoisyPhase / NoisyAmp already use this 0..16777215 pattern.

Missing keys in old patches must load as these defaults. Add matching `init_control` lines in the `kTypeSpectralBlur` block (~5105). Discrete Seed: no smoothing (`linearSmoothing: false`, `smoothingType: "none"`).

Docked parameter-tips copy belongs in the definitions (`tooltip` is the docked-tips string, not a hover tooltip). No `title` / hover tooltips.

---

## 4. DSP design (`Core::frame`)

Do this in `Core::frame` in `spectral_blur.cpp`. Keep the Diffusion Brownian walk exactly as it is. Swarm is a **separate** mean-reverting modulator applied to the **analysis phase** and the **current magnitude**.

Per bin, per hop, for Swarm / Drift (skip all of this, including all RNG draws, when Swarm == 0 and Drift == 0):

1. Draw zero-mean noise from a **dedicated** Swarm RNG (do not advance Diffusion's `rng` / `sideRng`). Seed it from `swarmSeed` (and bin index if useful). Reset the stream on Seed change and on the module's existing local reset / sample-rate reset.
2. One-pole, hop-rate, mean-reverting (Ornstein–Uhlenbeck / leaky noise), one state each for phase wobble, amp wobble, and drift:

   `state = pole * state + (1 - pole) * noise`

   Choose `pole` from Rate and `hopSize / sampleRate`, same style as the existing `phasePole` / `amplitudePole` (`exp(-hopSize / (sr * tau))`, with `tau` derived from Rate in Hz). State stays near 0 and comes back; it must not integrate like `offset[k] += noise`.
3. **Phase**: rotate the **analysis** unit phase (`phaseR` / `phaseI` from the current frame, or the continued velocity when the bin is quiet) by `Swarm * phaseState[k] * kPhaseDepth`. Do not add this angle into `offset[k]` / `smoothOffset[k]`. Suggested `kPhaseDepth` at Swarm 1: ±π radians. Open question if listening wants less.
4. **Amplitude**: `mag * (1 + Swarm * ampState[k] * kAmpDepth)`, then clamp to ≥ 0 (and a modest upper cap if needed to avoid blow-ups). Do **not** lag the signal magnitude to make a swarm; that smears transients. Amplitude Smooth, if on, stays a lag of the unswarmed (spread) target and should run so that Swarm still modulates the sounding magnitude, not the other way around. Suggested `kAmpDepth` at Swarm 1: 0.5, so the multiplier stays around 0.5..1.5 before clamp.
5. **Drift**: add `Drift * driftState[k] * kDriftDepth` radians to that bin's phase each hop (extra phase advance, mean-reverting around 0). This is a tiny pitch wander. It is not Frequency Blur (no power moved to neighboring bins). Suggested depth: a few Hz equivalent at full Drift (`2π * maxHz * hop / sr`, maxHz around 2–5). Open question.

Stereo: Swarm / Drift modulators are **shared** (linked) across L/R so a mono input stays mono and Swarm does not become a stereo wash. Stereo Spread continues to affect **Diffusion only**.

Behaviour with Time Smear / Frequency Blur / Diffusion at 0: Swarm + Rate (+ Drift) should be the only effect besides the usual STFT delay. Transients stay at their original time (aside from window/hop latency). Energy does not bleed into neighbor bins or hang as a cloud. With those smear controls up, Swarm may still run, but the sound will still have the wash; that is fine.

FFT size 16384 is already the expensive path. Extra per-bin poles and a few randoms are cheap. Do not add more FFTs. Guard non-finite state with the module's existing local reset. Do not allocate on the audio thread.

Rebuild `spectral_blur.wasm` (and the combined native engine, as this repo already does) after the C++ change. Do **not** kill servers on ports 8765 / 8080 / 8090 / 8081 / 8082 / 8084, and do not restart the app. Argi does Ctrl+F5 himself.

---

## 5. Where to edit (exact slots)

Coordinate with other agents before touching a file they already have dirty. Commit only your hunks. Preserve line endings. Do not switch branches, rebase, stash, or force-push. After your commit: plain `git merge origin/master` (check first that no rebase or merge is already in progress). If `public/index.html` or `public/perform.html` cache-bust tags need a bump, **append** a `?v=` suffix; never replace another agent's tag.

1. `native_modules/spectral_blur/spectral_blur.cpp` — state, dedicated RNG, `Core::frame` math, new setter (e.g. `soemdsp_spectral_blur_set_swarm(handle, amount, rateHz, drift, seed)`), metadata JSON, version bump, reset/init.
2. `native_modules/graph_engine/graph_engine.cpp` — `extern "C"` declaration; `process_stft_dynamics` (~16370) calls the setter from the Control slots above; `init_control` defaults in the `kTypeSpectralBlur` block (~5105).
3. `public/node-graph-module-definitions.js` — `spectralBlur` `parameters` and `face`. Add a phone-friendly row: Swarm | Rate. If Drift is in this slice, add Drift | Seed (Seed may be `hidden: true` on spawn, shown via the param's Show toggle). Do not drop existing rows. Parameter min/max/mid/step/defaults live only here (and in the matching native metadata / `init_control`).
4. `public/node-live-audio-worklet-native-graph.js` — both the id map (~637) and the `push(...)` block (~6283). Defaults in `push` must match the defs.
5. `public/native-modules-catalog.json` if this repo regenerates it from metadata; keep it consistent.
6. Extend the existing `scripts/test_spectral_blur*.mjs` tests (see §8). Update `docs/SPECTRAL_BLUR.md` with the new controls and the Swarm preset values (do not rewrite that doc).

No dead code. No new timers or polling; hop-rate work stays inside the existing STFT frame. Events only in any UI you touch.

---

## 6. Old patches and a Swarm preset

Swarm 0, Drift 0, Seed 1, Rate 5 Hz: output must be **bit-identical** to the current module (same input, same old params, same FFT size / sample rate). Seed must not change the output while Swarm and Drift are 0.

Add a factory or user-visible **Swarm** preset (follow however this repo already stores factory module/patch presets; if there is no per-module preset hook, add a small demo patch and document the values in `docs/SPECTRAL_BLUR.md`):

- Time Smear 0, Frequency Blur 0, Diffusion 0, Stereo Spread 0, Amplitude Smooth 0, Mix 1
- FFT Size 4096 (or 2048 if 4096 feels too smeary for transients; say which and why)
- Phase Smooth can stay at 10 ms (it only affects Diffusion, which is off)
- Swarm ~0.6–1, Rate ~5 Hz, Drift 0 or a little, Seed 1

---

## 7. Separate cleanup (do not do in this change)

**STFT Blur** (`stftBlur`) is a dead passthrough leftover. It has no DSP: `stftBlurStates` is allocated and cleared but never processed, and `stftBlur` is in `passthroughTypes` in `public/node-graph-execution-plan.js`. The live module is Spectral Blur. Removing `stftBlur` is a later, dedicated cleanup. Files that mention it include:

- `public/node-graph-module-definitions.js`, `public/node-graph-module-store.js`, `public/node-graph-module-scope-defaults.js`
- `public/node-graph-execution-plan.js`, `public/node-graph-live-plan-runtime.js`
- `public/node-live-audio-worklet-core.js`, `public/node-live-audio-worklet-set-plan.js`, `public/node-live-audio-worklet-clear-plan.js`
- `public/presets/useruisettings.js`, `useruisettings.default.json`, `useruisettings.json`
- `scripts/apply_resource_constraints.js`, `scripts/test_fft_browser_markers.mjs`, `scripts/test_spectral_spawn_widths.mjs`
- `docs/module_faces_inventory.json`, notes in `docs/BUG_PLAN.md`

---

## 8. Tests

Extend the existing Spectral Blur tests; do not invent a second harness if those already cover graph + native + browser.

- **Swarm 0 / Drift 0**: bit-identical to the current baseline (max error in the same order as today's neutral-reconstruction test, ~4e-8). Seed changes must not move this output.
- **Determinism**: fixed Seed, same input, same params → identical output across runs. A different Seed changes the wobble. Reset / sample-rate change reseeds cleanly.
- **In-place**: with Time Smear, Frequency Blur, Diffusion, and Amplitude Smooth at 0, a short impulse's energy does not grow a long spectral tail and does not spread into far bins; the swarm buzzes at the original time (plus the usual window delay).
- **Stereo**: mono in, Stereo Spread 0, Swarm up → Left and Right match.
- **No NaN / Inf**: silence, loud bursts, rapid param edits, size changes; existing local reset still recovers.
- **CPU**: no large regression vs current Spectral Blur at the same FFT size; do not treat JS harness numbers as REAPER CPU.
- **Defaults / mapping**: new node and an old patch without the new keys get Swarm 0 and Drift 0. Face and worklet maps agree with the defs.

---

## 9. App / git rules (must follow)

- No hover tooltips. Docked tips panel is fine (definition `tooltip` text).
- Phone-friendly face. No dead code. Parameter limits only from parameter definitions.
- Events only; no timers or polling.
- Do not kill servers (ports 8765 / 8080 / 8090 / 8081 / 8082 / 8084). Do not restart the app. No probe loops. Argi Ctrl+F5s himself.
- Work directly in the repo. No PRs, no cloud agents, no force-push, no stash, no `reset --hard`, no rebase, no branch switches. Commit only your own hunks. Preserve line endings.
- Git flow: check that no rebase or merge is in progress; commit; plain `git merge origin/master`; push only if Argi has lifted the push hold. Leave other agents' dirty files alone.
- If you touch `public/index.html` or `public/perform.html`, append a `?v=` suffix; never replace another agent's tag.

---

## 10. Open questions (Warble slice — mostly settled)

The Warble slice chose real units (Swarm in degrees, Level in dB, Drift in Hz, Rate in Hz, Seed visible). Stereo Spread still affects Diffusion only; Swarm L/R are linked. Amplitude Smooth runs first, then Swarm gain. Remaining questions live in §11.8.

---

## 11. Cloud mode (fuzzy, not warbly)

**Do not implement in a docs-only pass.** Next coding change: keep the current Swarm path as **Warble** and add **Cloud**.

### 11.1 What was actually built (Warble)

Shipped in `93ba63c0`, then `fe13859f`, `b6b7b66b`, `5dd1a1b1`. No further uncommitted Swarm DSP: `spectral_blur.cpp` is clean; dirty `graph_engine.cpp` / `node-graph-module-definitions.js` hunks are unrelated (Mutator, etc.) and must be left alone.

In `Core::frame` (`native_modules/spectral_blur/spectral_blur.cpp`):

- Dedicated `swarmRng` (xorshift, seeded from `swarmSeed`). Diffusion's `rng` / `sideRng` are untouched. RNG draws are skipped when Swarm, Level and Drift are all 0.
- Each interior bin gets three independent Ornstein–Uhlenbeck states (phase, level, drift), hop-rate, mean-reverting, clamped to ±1:

  `state = pole * state + sqrt(1 - pole^2) * sqrt(3) * U[-1,1]`

  `pole = exp(-2π * Rate * hop / sr)` so depth stays constant when Rate changes. Default Rate is 5 Hz. Hop is still `windowSize / 4` (~47 Hz at 4096 / 48 kHz), so a 5 Hz walk is correlated for many hops (~200 ms) and is an audible LFO, not grain or fur.
- **Phase:** the analysis unit phase is rotated by `Swarm° * state` (same peak angle on every bin). `kDegrees` is π/180. Mid 45°, max 180°.
- **Level:** `magnitude *= exp(Level_dB * state * ln(10)/20)` after Amplitude Smooth. Same dB on every bin.
- **Drift:** `swarmDriftPhase[k] += Drift_Hz * state * 2π * hop / sr`, wrapped. **The same peak Hz wander on every bin.**
- One shared `swarmSin` / `swarmCos` / `swarmGain` is applied to both channels (linked). No extra unison layers. No energy moved to neighboring bins (that is still only Frequency Blur).
- Face (after Phase Smooth / Amplitude Smooth): Swarm | Level, Rate | Drift, Seed, then Mix. Wiring: `process_stft_dynamics` → `soemdsp_spectral_blur_set_swarm(handle, shape, amplitude, lfoRate, lfoVariation, seed)` (`graph_engine.cpp` ~16394). Worklet map in `public/node-live-audio-worklet-native-graph.js` (~645 and ~6298). Defaults 0 / 0 / 5 / 0 / 1. Demo patch: `patches/demo_patches/spectral_blur_swarm.json`.

Peak FM deviation from the phase walk is about `Swarm_radians * Rate` Hz (at 45° and 5 Hz, ~4 Hz; at 180°, ~16 Hz). Drift adds its Hz on top. That deviation is **constant in Hz**, not in cents.

### 11.2 Why low input sounds cloudy and high input warbles

Argi's listening clue: the **same** Swarm setting is cloudy on low-frequency input and warbly on high-frequency input. That matches this DSP.

A slow, coherent phase/drift walk with a fixed Hz width produces FM sidebands whose bandwidth is roughly `2 * (Δf + Rate)` in Hz. Around an 80–150 Hz partial, ±4–16 Hz is a large fraction of the pitch (hundreds of cents at the low end) and fills the region — a soft cloud. Around a 2 kHz partial, the same ±4–16 Hz is only ~3–14 cents: one well-resolved line slowly vibrato-ing. Drift is explicitly constant-Hz, so it has the same bias. Rate is also constant in Hz, so high partials keep a tidy 5 Hz wag instead of breaking into fast grain. A high partial lives in one or two bins and, with no cents-wide spray, cannot become a band. Linked stereo and a single layer leave it as one voice. The 4× hop can add ~47 Hz chatter on bright material, which also reads as warble rather than fur.

Warble is a good character. It is not "fluffy like fur." Cloud has to make **high partials as relatively wide as low ones already are**.

### 11.3 Cloud design (plain words)

Keep Warble math on a Character switch (default **Warble**). **Cloud** should stay in place in time (no Time Smear / Diffusion wash) but smear each partial into a soft band whose **width is constant in cents**, so a high note gets the same fuzz a low note already has.

Do all of the following in the spectral frame; do not run extra analyses per layer.

1. **Fuzz / Width in cents** (this is the important unit). Each bin's power is sprayed into a neighborhood of ±Width cents around that bin (a short Gaussian or triangle kernel on a log-frequency / cents axis, not a fixed Hz box like Frequency Blur). Optional tiny per-hop jitter of the kernel center, also in cents. Radius in bins grows with bin frequency: `f_k * (2^(Width/1200) - 1) / (sr / N)`. Cap the radius (see cost). This is what turns a high partial into a fluffy band instead of a moving tone.
2. **Fast, white, per-hop phase / micro-pitch scatter**, decorrelated per bin, per hop, and per layer. No slow 5 Hz OU in Cloud. Convert Width (cents) to a per-hop frequency offset, not a fixed degree phase LFO. If Rate is kept in Cloud, scale it with bin frequency (`rate_k = min(Rate * f_k / f_ref, hop_Nyquist)`, with `f_ref` around 100 Hz) or treat Rate as a residual correlation that defaults to "already uncorrelated at hop rate."
3. **2–4 decorrelated layers** (unison voices) from the Seed. Each layer gets its own scatter/phase instance. Sum the complex spectra and normalize (power-preserving, e.g. divide by `sqrt(layers)`). One analysis FFT and one IFFT per channel per hop, not N×L transforms.
4. **Hop N/8 while Cloud is active** (overlap 8×) so the frame rate is high enough that the scatter is grain/fur, not a 47 Hz wag. Change the OLA compensation (today's `2/3` is for 4× Hann). Warm/crossfade the hop change like an FFT-size change; snap back to N/4 when Cloud is off. No extra user hop knob unless listening proves it is needed.
5. **Amplitude micro-dither** that is fast (per hop, uncorrelated) and small (around ±0.2–1 dB), not the current slow Level LFO. Level may stay as a Warble-only depth.

Old patches stay identical: Character defaults to Warble, Fuzz/Width defaults to 0, Voices can default to 3 (unused in Warble). Swarm / Level / Rate / Drift at 0 still bit-identical. Cloud with Width 0 and amount 0 is also a no-op.

### 11.4 New / reused parameters

Limits only in the parameter definitions (and matching metadata / `init_control`). Docked tips use definition `tooltip` text. No hover `title`s.

| Key | Label | Default | Suggested range | Slot |
|-----|-------|---------|-----------------|------|
| `swarmCharacter` | Character | **0 Warble** | choices `Warble`, `Cloud` (discrete, no smoothing) | `node.mode` → `NATIVE_GRAPH_PARAM_MODE` (21) |
| `swarmFuzz` | Fuzz | **0** | 0 / 50 / 200, unit `¢` (cents) | `node.center` → `NATIVE_GRAPH_PARAM_CENTER` (30) |
| `swarmVoices` | Voices | 3 | 2 / 3 / 4, step 1, discrete; may be `hidden: true` on spawn | `node.oversample` → `NATIVE_GRAPH_PARAM_OVERSAMPLE` (32) |

Existing Swarm, Level, Rate, Drift, Seed stay for Warble. In Cloud, **Fuzz** is the cloud bandwidth; prefer that Swarm (if > 0) scales how fully that width is applied and that Fuzz at 0 is always dry. Seed seeds every Cloud layer (`Seed + layer index`).

Face: add a phone-friendly row Character | Fuzz, and Voices next to Seed or hidden until Show. Do not drop Warble rows.

### 11.5 Where each change goes

Coordinate: leave other agents' dirty files alone (current uncommitted Mutator / `index.html` / `perform.html` / `graph_engine.cpp` work is not yours unless a hunk is strictly the Cloud wiring and you can split it). Preserve line endings. No stash, rebase, reset, or force-push. Do not kill servers. Append `?v=` tags if those HTML files must change; never replace another agent's tag.

1. `native_modules/spectral_blur/spectral_blur.cpp` — `Core::frame` Cloud branch (cents spray, white per-hop scatter, layers, micro-dither); `Core::tick` hop `N/8` + OLA gain while Cloud is active; setter (extend `soemdsp_spectral_blur_set_swarm` or add `set_cloud`); metadata JSON; version bump; reset/init. Do not alter the Warble OU path.
2. `native_modules/graph_engine/graph_engine.cpp` — `extern "C"`; `process_stft_dynamics` (~16389) passes Character / Fuzz / Voices; `init_control` in the `kTypeSpectralBlur` block (~5115).
3. `public/node-graph-module-definitions.js` — `spectralBlur` parameters + face rows. Ranges only here (plus metadata / `init_control`).
4. `public/node-live-audio-worklet-native-graph.js` — id map (~637) and `push` block (~6290). Defaults must match the defs.
5. `public/native-modules-catalog.json` if generated from metadata. Rebuild `spectral_blur.wasm` and the combined engine as this repo already does; no app restart, no server kills. Argi Ctrl+F5s himself.
6. Extend `scripts/test_spectral_blur*.mjs`. Update `docs/SPECTRAL_BLUR.md` (do not rewrite it) and add a Cloud demo patch beside `patches/demo_patches/spectral_blur_swarm.json`.

No dead code. No timers or polling; hop-rate work stays inside the existing STFT frame. Events only in any UI you touch. Parameter limits only from defs. Cost must be bounded and **independent of the input's pitch** (every frame already visits all bins). Cap spray radius (suggested max 32 bins, or a tight equivalent) so Nyquist bins cannot fan across the whole spectrum. Worst-case CPU is "Cloud on, 8× hop, 4 voices, max cap," not "how high the note is."

### 11.6 Cloud preset

Factory or demo patch **Cloud** (same hook as the Swarm demo):

- Character Cloud, Fuzz ~50¢, Voices 3, Swarm amount up (or Fuzz alone if that is the amount), Seed 1
- Time Smear 0, Frequency Blur 0, Diffusion 0, Stereo Spread 0, Amplitude Smooth 0, Mix 1
- Level 0 or a very small micro-dither only; Drift unused in Cloud
- FFT Size 4096 (or 2048 if 8× hop + 4096 is too heavy; say which and why)
- Hop is automatic N/8 while Cloud is on

### 11.7 A/B tests (cloudy vs warbly)

Use the existing Spectral Blur tests plus listening / scripted sines. Do not kill servers.

- **Bit-identical:** Character Warble, all Swarm amounts 0 (and Cloud Fuzz 0) matches today's baseline (~4e-8). Changing Fuzz / Voices / Character must not move this output while amounts are 0.
- **Low vs high input, same settings:** a 100 Hz sine and a 2 kHz sine, Time Smear / Frequency Blur / Diffusion at 0. **Warble** (Swarm mid, Rate 5 Hz, Drift 0): 100 Hz should already sound relatively wide/cloudy; 2 kHz should warble (tight vibrato). **Cloud** at the same Fuzz in cents: 2 kHz should be similarly fuzzy/fluffy to 100 Hz, not a cleaner vibrato. A cents-wide band around 2 kHz (50¢ is about ±58 Hz) should be visible / audible; Warble at 2 kHz should stay a narrow line.
- **In place:** a short impulse under Cloud does not grow a long smear tail (that is still Time Smear). Delay is the usual window (and the 8× hop must stay correctly compensated).
- **Determinism:** fixed Seed, same input, same params → identical output. Different Seed changes the fur. Layers come from `Seed + layer`.
- **Stereo:** mono in, Stereo Spread 0 → L/R match in both characters unless Cloud is explicitly documented as per-channel (default: still linked).
- **No NaN / Inf,** size changes, hop 4×↔8× crossfade continuity, CPU no blow-up vs current at the same FFT size with Cloud's cap.

### 11.8 Open questions (Cloud)

1. Is Fuzz alone the Cloud amount (Swarm Warble-only), or does Swarm scale how fully Fuzz is applied? (Recommended: Fuzz is width, Swarm > 0 enables / scales it, Fuzz 0 is dry.)
2. Fuzz range: is 0–200¢ with mid 50¢ enough fur, or too wide at the top?
3. Voices 2–4 with default 3: hidden on spawn, or always visible?
4. Should Cloud decorrelate L/R (a soft stereo fur) or stay linked like Warble (recommended default, maybe later follow Stereo Spread)?
5. Automatic N/8 hop vs an explicit overlap control.
6. Cloud FFT Size for the preset: 4096 or 2048.

Listening acceptance by Argi is required before calling Cloud done. The test he already gave: high-frequency input should get the same cloudy/fuzzy/fluffy character low-frequency input already has, without turning the low end into reverb.
