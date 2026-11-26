# Spectral Prism Plan

## Current Listening Prototype

The original Width/unchanged-mono design below is historical. The approved
prototype now uses Centre (dB), energy-normalized Spread (0..40), Fold and
final Amp. See `SPECTRAL_PRISM.md` and native metadata for the current contract.
Its display is linear actual wet M/S coefficients, not pan or signed-log q.

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-25 |
| **Status** | Implemented in `codex/euclidean-sequencer`; automated proofs pass. Argi's listening acceptance is pending. See `SPECTRAL_PRISM.md`. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Related** | `docs/SPECTRAL_DISPLAY_TEST_NOTES.md` (Spectral Prism idea; Warp Stereo is a shift offset, not width), `docs/SPECTRAL_DISPLAY_VISION.md`, `docs/SPECTRAL_DISPLAY_UPGRADE_PLAN.md` |

A new module: a **real mono-to-stereo spectral widener**. Spectral Warp's "Stereo" parameter is a per-channel additive frequency-shift offset (`stereoShiftHz`, left −half / right +half). Argi likes that effect; leave it alone in this pass. Prism is a different module with a different job.

Copy the registration and STFT scaffolding of **Spectral Warp** (own native, own `process_*`, not a new branch inside `process_stft_dynamics`). Invent the sound and the face from this document; do not wait for a further brief.

---

## 1. Goal and sound

Spectral Prism should feel like putting a sound through a piece of glass: **frequencies take different seats in the stereo field**, like colours fanning out of a prism. A mono voice or synth becomes a stable, wide image — not a Haas delay, not a mid-side EQ boost, not Warp's split-shift. Sines at different frequencies sit in different places and stay there (when Shimmer Speed is off). Chords open into a rainbow. Bass stays planted in the centre.

**Mono in works.** Plug only `In` (Mono): the module manufactures a side signal from the mid, and Left / Right come out as a real stereo image. The Mono output is the fold-down, and it must sound like the delayed input — same timbre, no hollow comb, no missing notes.

**Stereo in is handled, not replaced.** Existing panning and width are kept. The prism *adds* width from the mid, scaled by Width. It does not throw away a vocal that was already on the left. Below the Mono Bass frequency, no new width is added; as Width rises, original side energy below that frequency is gently collapsed toward mono (mastering-style bass). At Width 0 the module is identity (delayed dry), including stereo bass — so the collapse is Width-proportional, not a permanent side high-pass.

The signature is **static, seeded, frequency-smoothed** placement: a particular Seed is a particular glass. Optional Shimmer Speed slowly slides that glass along log-frequency, like turning the prism, not like a chorus.

---

## 2. DSP design

### 2.1 STFT scaffolding (copy Warp / Blur)

Hann window, hop = N/4, IFFT overlap-add with the usual 4× Hann gain (2/3), latency = FFT size, dry delayed to match, Mix is delayed-dry to wet. FFT-size changes warm a second engine and crossfade (~50 ms, same idea as Warp); queue the latest size. DC and Nyquist bins stay mid-only (no side). Process **mid/side in the bin domain** from a stereo STFT of L and R (one analysis of each, not four FFTs). Reuse the existing radix-2 FFT helpers (`#include <soemdsp/fft/fft_radix2.h>`), sizes 512…16384, same family as Warp.

Do **not** hang this off `process_stft_dynamics` (that path is Blur / Gate / Contrast). Give Prism its own `process_spectral_prism`, like `process_spectral_warp`.

### 2.2 Mid is sacred

For every bin:

- `M = (L + R) / 2`
- `S = (L − R) / 2`

**Never alter M** (except the STFT delay / OLA that also applies to the dry path). All widening is done by constructing `S_out` and writing `L' = M + S_out`, `R' = M − S_out`. Then the mono fold-down `(L' + R') / 2` is exactly the delayed mid. That is the mono-sum safety and the "no timbre change in the mono sum" rule. Do not use a constant-power pan on M itself — that would make `(L+R)/2` depend on pan and colour the mono.

Stereo loudness will rise a little as Width adds side energy (`|L|² + |R|² = 2|M|² + 2|S|²`). Leave it; do not dip M to "compensate." Document this in the Width tip. Optionally cap `|S_out|` per bin (e.g. not larger than `|M|`) so a bin cannot go past a hard L/R extreme and blow up.

### 2.3 Seeded, smoothed pan field

From Seed, build a deterministic field `P(k) ∈ [−1, 1]` over bins, **smooth in log-frequency**, not a raw per-bin hash (that is what sounds metallic / zipper / comb-like).

Recommended construction:

1. Hash Seed + a log-frequency grid into a small set of slow random breakpoints (or a band-limited noise along log Hz).
2. Interpolate, then smooth with a kernel whose width is **Smooth** (cents). Default Smooth is wide enough that adjacent bins cannot flip sides.
3. Force `P` to 0 at bin 0 and Nyquist; fade the first few bins toward 0.

This field is the prism glass. Same Seed gives the same initial field in a fresh instance. Shimmer Speed zero freezes the current position rather than returning to the initial field. Changing Seed is a different glass, instantly visible on the face.

### 2.4 Width, Mono Bass, Tilt

Effective width at frequency f:

`W(f) = Width * bassFade(f) * tiltShape(f)`

- **bassFade**: a raised-cosine (or similar) fade over about one octave around **Mono Bass**. Below the fade, generated width is 0. Not a brick-wall bin cut.
- **tiltShape**: **Tilt** 0 is flat above the fade. Positive Tilt (default, slightly) puts more width toward the highs — the prism fans out. Tilt +1 ≈ none at the crossover, full at Nyquist (log ramp). Negative Tilt inverts (wider low-mids). Tilt does not bypass Mono Bass.

Then:

`S_gen = W(f) * P(k) * M`, with an optional **Phase** mix: blend a real (amplitude-pan) `S_gen` with a quadrature / seeded phase-rotated copy of the same magnitude so the image can be slightly decorrelated rather than a set of hard-panned partials. Phase 0 is pure spectral pan (very "coloured glass"). A small default (0.25) adds a little air. The mono sum still does not care, because S never enters `M`.

**Stereo in:**

`S_out = S_in * (1 − c(f)) + S_gen`

where `c(f)` is 0 at Width 0 (identity, original side kept, including bass), and rises with Width under the Mono Bass fade so *original* low-frequency side is gradually collapsed. Above the crossover, `c` stays 0 for the original side (the original image is preserved) and width is *added* via `S_gen`. Soft-clip or cap `|S_out|` vs `|M|` after the sum.

**Width 0** (any other settings): `S_out = S_in`, wet = delayed dry. This must pass a reconstruction test like Warp's.

### 2.5 Shimmer Speed / Shimmer Depth (optional motion)

Default off (Shimmer Speed = 0). The seeded pan field travels continuously through log-frequency while the bass, tilt and edge envelopes remain stationary. Positive speed travels toward higher frequencies (right); negative speed travels left. One Hz traverses one Smooth correlation length per second. Integrate signed position at native STFT hops; do not use a sinusoid or wrap at one cycle. Zero speed freezes the current position. Shimmer Depth blends the fixed seeded pattern with the travelling pattern (0 = fixed, 1 = fully travelling), independently of speed. Depth still changes the blend at a frozen nonzero position, so it is not marked inactive at speed zero.

### 2.6 Parameters

Limits live **only** in the parameter definitions (JS defs + native metadata, kept in agreement). Docked tips are the `tooltip` strings — real sentences, no hover `title`s. No hard-coded ranges in DSP besides rejecting non-finite / non-power-of-two FFT sizes (return Error, like Warp).

| Key | Label | Default | Min / mid / max | Unit / kind | Tip (use this spirit; you may tighten wording, not the meaning) |
|-----|-------|---------|-----------------|-------------|------------------------------------------------------------------|
| `fftSize` | FFT Size | `2048` | choice 512, 1024, 2048, 4096, 8192, 16384 (same pattern as Warp: `kind: "choice"`, `linearSmoothing: false`) | samples | STFT window and dry/wet reference delay in samples. Hop is one quarter of size. Smaller is tighter and lower latency; larger separates nearby partials for a smoother prism. Size edits warm a second engine then crossfade for 50 ms. Requests queue the latest size. No automatic host delay compensation. |
| `width` | Width | `0.7` | 0 / 1 / 40, any step | (dimensionless) | Amount of prismatic side added from the mid. Zero is delayed stereo identity, including bass. One is full spread; higher values exaggerate it without a hidden side limiter. Stereo loudness rises; the mono fold-down is unchanged. |
| `monoBassHz` | Mono Bass | `120` | 20 / 120 / 500, `kind: "frequency"`, nonlinear slider | Hz | Frequency below which the prism adds no width, with about a one-octave fade. As Width rises, original side energy below this frequency is also faded toward mono. At Width zero this control does nothing (identity). Bass stays planted; highs are free to fan out. |
| `tilt` | Tilt | `0` | −1 / 0 / 1, any step | (dimensionless) | Frequency slope above Mono Bass. Zero is even. Positive favours highs, negative low-mids. Bipolar fill follows parameter metadata, like every face cell. |
| `smoothCents` | Smooth | `300` | 50 / 300 / 2400, nonlinear slider | ¢ | How widely the seeded pan field is smoothed along log frequency. Narrow values place bands more independently and can edge toward a metallic, comb-like image; wider values are a gentle wash. The audio mid is not smoothed — only the pan field is. |
| `phase` | Phase | `0.25` | 0 / 0.5 / 1, any step | (dimensionless) | Blend from coherent spectral pan (zero: each band sits at a place) toward a phase-decorrelated side of the same amount (one: more diffuse, less "this note is on the left"). The mono sum is unchanged either way. |
| `shimmerSpeedHz` | Shimmer Speed | `0` | -50 / 0 / 50, nonlinear slider | Hz | Signed continuous log-frequency travel: positive right, negative left. One Smooth correlation length per second per Hz. Zero freezes position. Never reverses automatically or wraps after one cycle. |
| `shimmerDepth` | Shimmer Depth | `0.5` | 0 / 0.5 / 1, any step | (dimensionless) | Blend from the fixed seeded pattern at zero to the travelling pattern at one, without changing speed. At speed zero, blends against the frozen position. |
| `shimmerQuantize` | Quantize | `0` | 0 / 0.5 / 1 | none | Transition sharpness: continuous at zero, hold/snap at one. Fixed spacing of one Smooth region. Input pitch is unchanged; STFT overlap softens steps. |
| `seed` | Seed | `1` | 1 / 1 / 9999, step 1, `linearSmoothing: false` | (integer) | Chooses the prism pattern. The same seed always gives the same still field (Shimmer Speed at zero). Changing seed is a different glass, not a loudness or tone control. |
| `mix` | Mix | `1` | 0 / 0.5 / 1, any step | | Delayed dry to prism wet, aligned at the active FFT Size. FFT-size edits change the delay during the warmed crossfade. |
| `frequencyCurve` | Curve | `1` | 0 / 0.5 / 1, `displayOnly: true`, no modulation, no parameter output | | Display frequency spacing: 0 = linear Hz, 1 = logarithmic. Display only; the audio is unchanged. |

Suggested face rows (phone-friendly, three-to-five rows under the picture, no seventh row of clutter):

1. `fftSize` (horizontal)
2. `width`, `monoBassHz`, `tilt`
3. `smoothCents`, `phase`, `seed`
4. `shimmerSpeedHz`, `shimmerDepth`
5. `shimmerQuantize`, `mix`, `frequencyCurve` (Curve is display-only)

**Control-slot map** (keep in sync: defs keys, worklet `mapNativeGraphParamId`, `graph_engine.cpp` `init_control` + `process_spectral_prism`). Reuse existing `kParam*` / `NATIVE_GRAPH_PARAM_*` slots, as Warp does (`fftSize` → stages / 22, etc.):

| Param | Slot |
|-------|------|
| `fftSize` | `STAGES` (22), discrete |
| `width` | `WIDTH` (31) |
| `monoBassHz` | `CENTER` (30) |
| `tilt` | `SHAPE` (13) |
| `phase` | `PHASE` (14) |
| `smoothCents` | `DIFFUSION_AMOUNT` (42) — or another free continuous slot if that collides in process; document the choice |
| `shimmerSpeedHz` | `LFO_RATE` (57) |
| `shimmerDepth` | `LFO_VARIATION` (47) |
| `shimmerQuantize` | `FEEDBACK` (50), unused by other Prism controls |
| `seed` | `SEED` (48), discrete |
| `mix` | `MIX` (40) |

`frequencyCurve` is never sent to native.

Type id: **`kTypeSpectralPrism = 283`**. IDs 281 and 282 are Euclidean Sequencer and Divider Sequencer in this worktree. JS type key: `spectralPrism`. User-visible name: **Spectral Prism**.

---

## 3. Face

A **specialized prism picture**, not the generic `spectralStyle` / "Spectral" Display Settings set. Those menus include Particles and styles this face would not use (see the test notes: specialize, only settings the face uses).

**Look.** Frequency along X (log by default, Curve on the face). Stereo position along Y: Left at the top, Right at the bottom, a mid line through the centre. The seeded pan field, after Width / Mono Bass / Tilt / Smooth, is a **ribbon of coloured shards** — each band sits on that curve, coloured by a prism gradient (violet / indigo lows → teal mids → gold / white highs), brightness or thickness from live mid energy drawn faintly *behind* the ribbon. It should read as a rainbow leaning across the stereo field, with bass sitting on the mid line and highs more free to wander when Tilt is up.

**Settings reshape it without audio.** Seed, Width, Mono Bass, Tilt, Smooth (and Shimmer Depth/Shimmer Speed when a shimmer position is known) must move the ribbon immediately. Implement a small JS twin of the pan-curve math (`public/lib/spectral-prism-curve.js`) so the face does not wait for a hop. The C++ path uses the same documented function; a test must prove they agree. Live energy and the current shimmer position come from a **read-only** hop post when audio is running. No timers, no polling, no rAF motion invented without a hop or a param-change event.

**Current display decision (supersedes the energy-overlay proposal above):** draw only the ideal curve from settings and current native shimmer position. No measured pan/energy overlay, no energy Floor/Ceiling settings, and no spectrum-array transport. Keep the gradient editor. Sample uniformly on the selected screen axis so linear views do not undersample high frequencies.

WebGL only. Canvas is the prism tile under the knob rows. Mini Canvas is a **uniform scale** of that same tile, never a second analysis or a simplified fake. Phone-friendly: the picture fills the display area; dense options stay in the small settings set. Docked tips for every param, including Curve and display floor/ceiling.

`displayType: "spectralPrism"` (new), `displayHeightGu: 3`, `visualSink: true`, `bufferedInputs: ["In"]` as needed for a ghost, `planRole: "processor"`, `planFreeRun: true`, `defaultWidthGu: 7`. Jacks like Warp: inputs `In` (Mono), `Left`, `Right`; outputs `Mono`, `Left`, `Right`, `Error`; same bypass map and aliases.

Read-only DSP tap (names can follow the existing SpectralHz / SpectralMeta bus in `spectral-display-worklet.js`, plus a pan vector): per-bin Hz, pan position actually applied, mid magnitude, count, hop serial, FFT size, shimmer position. Do not change the audio path to obtain them.

---

## 4. Files to create and touch

### Create

- `native_modules/spectral_prism/spectral_prism.cpp` — module metadata JSON, STFT, mid/side prism, display getters. Built to `native_modules/spectral_prism/spectral_prism.wasm` by the existing script. Mirror Warp's header comments (`soemdsp-native-module`, label, target, kind: effect).
- `public/lib/spectral-prism-curve.js` — display twin of the pan-field function (Seed, Smooth, Width, Mono Bass, Tilt, optional shimmer position / Shimmer Depth). No audio DSP.
- `public/modules/spectralDisplay/spectral-prism-face.js` — WebGL prism face, event-driven.
- `scripts/test_spectral_prism.mjs` — native unit tests (see §6).
- `scripts/test_spectral_prism_graph.mjs` and `scripts/test_spectral_prism_browser.mjs` — follow the Warp graph / browser pair (`scripts/test_spectral_warp_graph.mjs`, `scripts/test_spectral_warp_browser.mjs`).
- Optional: `patches/demo_patches/spectral_prism.json` and a short `docs/SPECTRAL_PRISM.md` only if you need a user-facing doc; not required to start.

### Touch (same hook points Warp already uses)

- `scripts/build_native_modules.ps1` — add a `spectral_prism` entry with exports (`create`, `destroy`, `reset`, `configure`, `sample`, `right`, `error`, `fft_size`, `latency`, `latency_for_handle`, `version`, `metadata_json`, `metadata_json_size`, plus display getters). Rebuild also writes `native_modules/combined/soemdsp_combined.wasm`.
- `native_modules/graph_engine/graph_engine.cpp`:
  - `static const int kTypeSpectralPrism = 283;` near the other spectral `kType*`.
  - `extern "C"` declarations next to Warp's (~847).
  - destroy (~3364), create (~5989), default `init_control` (~5155), native/latency predicate lists (~17986 and ~18158), `process_spectral_prism` + dispatch next to Warp (~19614).
  - Use `stereo_route` / `mix_node_inputs` the way Warp does so mono `In` and stereo L/R both work; Mono / Left / Right outputs populated each frame; Error from the native error flag.
- `public/node-live-audio-worklet-native-graph.js` — `spectralPrism: 283` in the type map, param-id map, default `push(...)` block, wasm export wiring, display-bus posts.
- `public/node-graph-module-definitions.js` — catalog label (`spectralPrism: "Spectral Prism"`) near the other spectral names (~217), full definition next to `spectralWarp` (~7609): jacks, face, parameters, tooltips, `displayType: "spectralPrism"`.
- `public/modules/spectralDisplay/spectral-display-face.js` — **do not** add Prism to `NODE_GRAPH_SPECTRAL_FACE_MODULES` (that is the generic style set). Register or dispatch the specialized face instead, or hook it from defs only.
- `public/modules/spectralDisplay/spectral-display-worklet.js` — hop posts for pan / energy / meta, or a tight sibling if that keeps the generic bus cleaner.
- Display settings schema files only if the tiny Prism settings set lives there: `public/node-graph-module-scope-trace-controls.js`, `public/node-graph-module-scope-defaults.js`, `public/node-graph-module-scope-settings-controls.js`. Do not dump Particles or unused styles into it.
- `public/index.html` and `public/perform.html` — script tags / `?v=` for new JS, if that is how the boot list works. Do not kill or restart app servers; Argi Ctrl+F5s.

Leave other agents' dirty files alone. If a listed file is mid-edit, fold in carefully or skip the unrelated hunk. Do not casually rewrite Warp, Blur, or the generic style renderer except for a minimal registration hook.

Suggested native API shape (names may match the export list):

`soemdsp_spectral_prism_create/destroy/reset/configure(handle, fftSize, rate)` plus setters for width, monoBass, tilt, smooth, phase, shimmerSpeed, shimmerDepth, seed; `sample(handle, l, r, mix)` / `right` / `error` / `fft_size` / `latency` / `latency_for_handle`; display: count, hz[i], pan[i], level[i], serial, shimmer position.

---

## 5. Registration and build order

1. Write `spectral_prism.cpp` with metadata and a neutral path (Width 0 reconstructs).
2. Add it to `scripts/build_native_modules.ps1` and run that script so the module wasm and `native_modules/combined/soemdsp_combined.wasm` both rebuild. Do not hand-edit wasm.
3. Hook `graph_engine.cpp` (type 283, create/destroy/defaults/process/dispatch/latency lists).
4. Hook the worklet type map, param ids, defaults, exports, display posts.
5. Hook JS defs (catalog + full module).
6. Curve twin + WebGL face + tiny settings set.
7. Tests, then a listen pass.

Search from symbol names if the line numbers above have drifted.

---

## 6. Tests and acceptance

### Native (`scripts/test_spectral_prism.mjs`)

Follow `scripts/test_spectral_warp.mjs`: instantiate `spectral_prism.wasm` directly, parse metadata (every parameter has a tooltip; display-only Curve is JS-only and will not appear in C++ metadata), check defaults and FFT-size choices.

- **Width 0 = identity.** For sizes 512…16384 and rates 44100 / 48000 / 96000, a stereo (and a mono) signal comes back as the input delayed by FFT size, error within ~2e-6, Error port 0. Other params may be non-default; Width 0 still identity.
- **Mono-sum null.** Width > 0, various Seeds, Tilt, Phase, Smooth, Mono Bass: `(L+R)/2` matches the delayed mono/mid input (same tolerance). A tone's level in the fold-down does not depend on Width, Seed, or Phase (no timbre / level change in mono).
- **Mono in becomes stereo.** Mono sine in, Width 1: Left and Right differ, correlating less than 1, and the fold-down still matches. Two sines at well-separated frequencies (e.g. 800 Hz and 4 kHz) sit at different pan positions for a given Seed (measure L/R energy ratio per tone).
- **Mono Bass.** A 60 Hz tone (below default 120 Hz) gets essentially no added width; a 4 kHz tone does. Fade is not a brick wall: a tone at the crossover is in between.
- **Tilt.** With Mono Bass and Width fixed, a high tone receives more added width at Tilt +1 than at Tilt −1.
- **Determinism.** Shimmer Speed 0, same Seed, same input, two fresh instances: outputs match. Different Seeds: pan positions differ.
- **Shimmer Speed off.** Shimmer Speed 0: a still field (pan of a tone does not wander over many hops).
- **FFT handoff.** Size changes stay finite and bounded, like Warp; bad sizes report Error and recover.
- **CPU.** At 48 kHz / 2048, processing a second of audio stays in the same order of magnitude as Spectral Warp at the same size (time the test; fail only on a gross regression, e.g. >5–10× Warp, not a tight micro-benchmark).

Also compare a dump of `P(k)` / applied pan from C++ against `spectral-prism-curve.js` on the same params.

### Graph / browser

Spawn, jack layout, face rows, type id 283, Display Settings contain no Particles / generic style menu, signed Shimmer Speed travels in either direction and zero freezes position, Canvas and Mini Canvas share one picture, knobs reshape the ribbon with no audio.

### Listening acceptance (required)

Argi listens. A mono synth or vocal should open into a wide, pretty, stable image without sounding like a detune, a chorus, or Warp's stereo shift, and without thinning when folded to mono. Bass stays centred. Music that is already stereo should get wider and more "sparkly" in the highs without the centre collapsing. If it sounds metallic or comb-like, Smooth is too narrow or the field is not actually log-smoothed — fix the DSP, do not hide it with more Mix dry.

---

## 7. What NOT to do

- Do not change Spectral Warp's Stereo-shift behaviour in this pass (a rename / tip clarification may exist elsewhere; it is not this module).
- Do not implement this as a wrapper around Warp, Blur Diffusion, or Swarm/Cloud. Do not implement Cloud.
- Do not alter mid-bin magnitudes to make the stereo bus "louder-compensated."
- Do not use unsmoothed per-bin random pans. Do not invent motion with timers or polling.
- WebGL only; no Canvas2D fallback. No fake clipping. No dead code, no unused generic styles "just in case."
- Parameter limits only from parameter definitions. Continuous where the def is continuous.
- No hover tooltips. Docked tips panel with real descriptions.
- Phone-friendly. Names are Canvas and Mini Canvas. Mini Canvas is a uniform scale of the tile.
- Only MIDI modules handle MIDI. This one does not grow MIDI paths.
- **MasterBot files are off-limits:** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, and cull / present / camera code.
- Do not kill or restart app servers (8765 / 8080 / 8090 / 8081 / 8082 / 8084). No force-push, no rebase, no branch switch, no `reset --hard`, no stash. Commit only your hunks. Docs are LF.
- Do not push unless Argi lifts the standing hold.

Listening acceptance by Argi is the finish line. If the face is clever but the mono fold-down colours the sound, it is not done.
