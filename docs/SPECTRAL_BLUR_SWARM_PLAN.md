# Spectral Blur — Swarm Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-25 |
| **Status** | Design only. Do not start from this doc and change unrelated code. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Related** | `docs/SPECTRAL_BLUR.md` (current module; do not replace it), `native_modules/spectral_blur/spectral_blur.cpp` |

This is a handoff for an outside coding AI. Implement only the swarm work described here. Leave a separate cleanup item until asked. Do not change any other modules.

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

## 10. Open questions

1. Exact depths: is ±π rad at Swarm 1 and ±0.5 amplitude depth the right "nice swarm," or should it be gentler?
2. Rate as Hz (as planned) vs a time constant in ms like Phase Smooth?
3. Drift depth (a few Hz equivalent vs cents) and whether Drift stays in the first slice or ships right after Swarm + Rate.
4. Should Stereo Spread also decorrelate Swarm, or stay Diffusion-only (recommended)?
5. Seed hidden on spawn, or visible next to Drift?
6. Swarm preset FFT size: 4096 to match the module default, or 2048 for tighter transients?
7. Order vs Amplitude Smooth: confirm Swarm modulates after that lag (recommended) so chatter smoothing does not erase the wobble.

Listening acceptance by Argi is required before calling it done.
