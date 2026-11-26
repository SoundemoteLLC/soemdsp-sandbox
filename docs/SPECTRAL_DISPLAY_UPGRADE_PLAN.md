# Spectral Display Upgrade Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-25 |
| **Status** | Built 2026-11-25 via `docs/SPECTRAL_DISPLAY_VISION.md` (one pass): shared analysis core, 1D Spectrum PoC, one frequency Curve, honest-dB Spectrogram / Circular Spectrogram, Spectrum Circle on the shared core with a Ceiling, and the §7 processor style faces. Scope Spectrum mode still uses its fixed −100..0 dB pooling (Phase 3 cleanup). Listening acceptance by Argi open. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Related** | `docs/SPECTRUM_1D.md`, `docs/CIRCULAR_SPECTROGRAM.md`, `docs/SPECTRUM_CIRCLE.md`, `docs/SPECTRAL_CLOUD.md` |

Handoff for an outside coding AI. Upgrade STFT / FFT *displays* one module at a time. Get the proof-of-concept perfect, then a few more, then the rest. Do not start every display at once. Do not change audio DSP except a read-only band/bin tap when a processor face needs it (see §7). Leave other agents' dirty files alone.

---

## 1. Inventory

These four are the live FFT / STFT *faces*. Other "waterfall" displays in the app are scrolling signal history, not spectra. Matrix Waterfall is glyph rain. Spectral Oscillator's face is a baked one-cycle plot (`spectralOscBakeCycle`), not a live FFT. Spectral Blur and the other STFT processors use a 1D scope trace. `fftReconstruction` is still a stub with no DSP. STFT / spectral processors get visual styles in §7; they stay out of the analyzer accuracy PoC except as later consumers of the shared analysis core.

| Module | Type / files | How the FFT is computed | How it is drawn | Display Settings / face | Visible weaknesses |
|--------|----------------|-------------------------|-----------------|-------------------------|--------------------|
| **Spectrogram** | `spectrogram`. Worklet: `public/modules/spectrogram/spectrogram-worklet-evaluator.js`. Draw: `spectrogram-display.js`, `spectrogram-gl.js`, `spectrogram-gradient-editor.js`. Defs ~24041. | JS worklet, not C++. Window 128–16384 (default 1024, Hann). Hop = window / overlap factor (default 4×). Optional zero-pad 1/2/4×, FFT cap 32768. Hard-coded EMA `0.35 * old + 0.65 * mag`, then columns are `log10(1 + ema·100)` (compressed). Thru is native passthrough. | WebGL `spectrogramBurn` on the shared picture device (GPU ring + gradient LUT). Face knobs: Freq band, Floor / Ceiling, History (s). Mini Canvas should be a uniformly scaled copy of the Canvas / module tile, not a second analysis. | Display Settings (`spectrogramBurn`): FFT size, window (Rect / Hann / Hamming / Blackman / Blackman–Harris), time overlap, freq overlap (pad), frequency curve (0 lin … 1 log), pause on silence, gradient. | Default 1024 bins are ~47 Hz wide at 48 kHz — weak bass. Compressed column is not true dB. Two frequency systems linger (`frequencyCurve` vs older Mel/Bark `freqScale` default). History / scroll / GPU ring are a large surface. CPU grows with FFT size × 4×–32× overlap (batch cap 64). |
| **Circular Spectrogram** | `circularSpectrogram`. Same worklet (`SPECTROGRAM_ANALYSIS_TYPES`). Draw: `public/modules/circularSpectrogram/circular-spectrogram-display.js` plus the Spectrogram GPU ring. Defs ~24189. Docs: `docs/CIRCULAR_SPECTROGRAM.md`. | Identical analysis to Spectrogram (same Spectrum / SpectrumBatch / FftSize ports). | Same `spectrogramBurn` type; shader maps angle → time, radius → frequency (bass inside by default). Spin, Inner, Rotate, Mirror, Direction on the face. WebGL only. | Same analysis settings as Spectrogram, plus polar / sweep retention (Fixed / Moving Head, Afterglow, Hang, Sweep fade). | Inherits every analysis weakness. Polar mapping and sweep bookkeeping are extra presentation work. Canvas tile animation was a past bug (Mini Canvas live, Canvas stale) — any upgrade must keep both views alive from the same ink, not a second FFT. |
| **1D Spectrum** | `spectrum1d`. Same worklet. Draw: `public/modules/spectrum1d/spectrum1d-display.js`. Defs ~24136. Docs: `docs/SPECTRUM_1D.md`. | Same worklet FFT, but also posts `SpectrumRaw` (last-hop \|X[k]\|, no EMA) and `SpectrumGain` (window sum, so a full-scale sine is 0 dBFS). Analysis throttled to ~60 hops/s; no SpectrumBatch. | WebGL `spectrumLine`: Filled / Line / Bars. Face knob: Freq band only. Log/lin curve with bin interpolation and a fix for log-axis comb spikes. Peak hold / fall. Smooth (ms). | Same FFT / window / overlap / pad as Spectrogram, plus frequency curve, Smooth, bar geometry, Scale (Exact dB / dB smoothed / Compressed / Linear), dB floor / ceiling, Draw, Peak hold, Peak decay, stroke / background colors. | Best candidate: already has honest raw magnitudes, but dB floor/ceiling are discrete Display Settings lists, not continuous definition-owned ranges. Heights above the ceiling are slammed to 1.0. Default 1024 still starves the low end. No dedicated `test_spectrum1d` harness (Circle has `scripts/test_spectrum_circle.mjs`). Smooth / peak are good, but must stay event/hop-driven (no timers). |
| **Spectrum Circle** | Saved type stays `videoFeedback`. `public/modules/videoFeedback/video-feedback-display.js`, `video-feedback-gl.js`, `video-feedback-register.js`. Docs: `docs/SPECTRUM_CIRCLE.md`. | **Separate main-thread FFT**, not the worklet. Uses `nodeGraphSpectrumFftInPlace` in `public/node-graph-module-scope-spectrum.js`. Default 2048, window from settings. "The face pump owns the clock: one FFT + one plate step per video frame." dB floor … 0 only: `(db - floor) / -floor`. Band peak or linear bin lerp. | WebGL rays on the shared picture device (mirror or full ring). Publishes 📺 via `nodeGraphPicturePublish`. | FFT size, window, freq axis / range, dB floor, bands (visual density, not FFT size), ray width, Symmetric, Reverse freq, color-by-level / radius, gradient, Inner / Size / Rotate / Spin / Decay / Smooth. | Duplicated FFT (Float64, twiddles recomputed, not hop-accurate). Tied to the video frame clock rather than audio hops. Ceiling fixed at 0 dBFS. Does not share SpectrumRaw. Unifying it is Phase 3, after the shared core is proven. |
| **Scope "Spectrum" mode** | Not its own module. Generic display mode `renderer === "spectrum"` in `node-graph-module-scope-spectrum.js`. | Yet another copy: fixed 1024-point Hann, `nodeGraphSpectrumFftInPlace`, magnitudes mapped to a hard-coded **-100…0 dB** window, max-pooled to 160 linear bars. | Used when a module's display mode is switched to Spectrum. WebGL bars. | Almost none of the 1D Spectrum settings. | The worst of the duplicates: fixed size, fixed dB, linear pooling, no log axis. Phase 3 should point this mode at the shared core or retire it in favor of spawning 1D Spectrum. |

Shared pieces already in the tree (use them; do not fork again):

- Analysis types set: `SPECTROGRAM_ANALYSIS_TYPES` = `spectrogram`, `spectrum1d`, `circularSpectrogram`.
- `nodeGraphFrequencyCurveHz` in `spectrogram-display.js` (0 = linear, 1 = log, blend in between). 1D Spectrum already calls it.
- Gradient LUT / GPU ring for the two spectrograms.
- Paint is supposed to follow `hopSerial` / new data, not a setInterval.

**Duplicated FFT code today:** (1) worklet `spectrogramFft` (Float32, cached twiddles), (2) main-thread `nodeGraphSpectrumFftInPlace` (Float64, no cache) used by Spectrum Circle and the generic scope Spectrum mode.

---

## 2. Shared upgrade themes

Do these once, then reuse. The PoC should introduce the shared pieces even if only 1D Spectrum's face is declared "perfect."

1. **One shared analysis core** — window, hop, pad, honest linear magnitudes, optional display-side smoothing. Worklet and (later) main-thread faces import the same math. No third Cooley–Tukey. Optional later: a native analysis tap, but JS worklet is fine for the PoC if CPU stays bounded.
2. **Log / linear frequency mapping with real bin interpolation** — share `nodeGraphFrequencyCurveHz` (and Mel / Bark if kept). Interpolate fractional bins; max-pool a pixel's bin span so narrow peaks survive on a log axis (1D Spectrum already started this; lift it into the shared helper).
3. **Honest dB range** — floor and ceiling come from parameter definitions (or Display Settings whose min/max/step live in those defs). A full-scale sine reads 0 dBFS. Display scaling must **not fake clipping**: values inside the window sit at the right height; going past the ceiling is a view-range limit, not "the signal slammed into 0 dBFS." Prefer a slight over-range cue over silently clamping in a way that looks like analog clip.
4. **Peak-hold / decay and smoothing** — already designed on 1D Spectrum (`docs/SPECTRUM_1D.md`). Keep them accurate and **event / hop driven**. No `setInterval`, no polling loops. Between hops, hold the latest spectrum.
5. **Low-end resolution** — 1024 at 48 kHz is ~47 Hz/bin. Options: a higher default, zero-pad (helps grid, not time resolution), and/or a **multi-resolution** path (a longer window, lower hop rate, blended in below a crossover). Cost must be capped and independent of the input's pitch.
6. **WebGL-only faces**, including Canvas and Mini Canvas. Mini Canvas is a uniformly scaled copy of the full Canvas / module tile picture, not a second hi-res FFT. Phone-friendly. No Canvas2D fallback, no dead code.
7. **Gradients / colors** already exist; do not invent a second LUT. Docked tips use real descriptions (`tooltip` / settings copy). **No hover tooltips.** Names: Canvas and Mini Canvas.
8. **Limits only from parameter definitions.** Only MIDI modules handle MIDI. **MasterBot's files are off-limits:** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, and all cull / present / camera code. Do not kill servers (8765 / 8080 / 8090 / 8081 / 8082 / 8084) or restart the app. Argi Ctrl+F5s himself.

---

## 3. Proof of concept: 1D Spectrum

**Pick: 1D Spectrum (`spectrum1d`).**

Reasons: it is the cleanest classic analyzer, so "is this FFT display accurate?" is easy to see and to test (sines, log axis, 0 dBFS, floor/ceiling, peak hold). It already sits on the shared worklet (`SpectrumRaw` + `SpectrumGain`), so extracting a proper analysis core here is automatically exercised by Spectrogram and Circular Spectrogram in Phase 2 without taking on history, GPU-ring scroll, or polar sweep in the first slice. It already has the right vocabulary (Exact dB, peak hold, Smooth, bars, frequency curve) but the ranges, low end, and shared-core story are not finished. Spectrogram is the Multimeter *default* (more often spawned) and is Phase 2 on purpose: its compressed columns and history make "perfect" a bigger surface. Spectrum Circle is a worse first target because its FFT is a separate, frame-clocked path.

### What "perfect" means (acceptance)

- A 0 dBFS sine at a known frequency peaks at 0 dBFS (± a small, documented tolerance) in Exact dB, with the window's coherent gain applied. It does not look "clipped" unless the signal itself exceeds full scale or the chosen ceiling.
- Floor / ceiling are continuous ranges owned by parameter definitions (or settings whose limits come from those defs). Changing them moves the picture immediately; they do not silently rescale to fake a clip.
- Log frequency curve places that sine at the correct x, including low frequencies (20–200 Hz). No comb / stepping artifacts on the log axis. Linear curve is also correct.
- Peak hold / fall and Smooth (ms) match `docs/SPECTRUM_1D.md`. Updates follow new hops / paint events only — no timers, no polling.
- Bass detail is clearly better than today's default 1024-only path (either a documented better default, pad, and/or a capped multi-resolution band). A 40 Hz tone and a 80 Hz tone are distinguishable at a glance.
- Filled, Line, and Bars all stay WebGL. Bars keep whole-pixel width/gap rules. Phone-friendly face (Freq band on the face; analysis in Display Settings).
- Canvas and Mini Canvas show the same picture; Mini Canvas is a uniform scale of the tile, not a second FFT.
- With analysis at "off/defaults that match today" where applicable, old patches still load. Thru still passes dry audio. No hover tooltips; docked tips are real sentences.
- New tests exist (see §5). CPU at 1024 / 4× overlap does not regress badly; larger sizes stay optional and capped.

### Step plan (PoC only)

Coordinate with other agents before touching a file they already have dirty. Commit only your hunks. Preserve line endings. No stash, rebase, reset, force-push, or branch switch. After a commit: plain `git merge origin/master` (check first that no merge/rebase is in progress). If `public/index.html` or `public/perform.html` need a cache-bust, **append** a `?v=` suffix; never replace another agent's tag. Do not implement Phase 2–3 in the same change.

1. **Extract a shared analysis helper** (new file, e.g. `public/lib/spectral-analysis.js` or `public/modules/spectrogram/spectral-analysis.js`): window tables, hop / pad, radix-2 FFT with cached twiddles, linear magnitudes, window-sum gain. Point the worklet evaluator at it (or a worklet-safe twin that stays bit-identical — if the worklet cannot import the main-thread file, generate or duplicate *once* from the same source and say so). Do not leave a third FFT in `node-graph-module-scope-spectrum.js` for this PoC, but you do not have to switch Spectrum Circle yet.
2. **Worklet (`spectrogram-worklet-evaluator.js`)** — keep posting `SpectrumRaw` + `SpectrumGain` + hop meta for 1D Spectrum. Make the hard-coded 0.35/0.65 EMA and `log10(1+x·100)` compression a clearly named, optional path used only by the spectrogram faces (do not silently change Spectrogram look in the PoC). 1D Exact dB / Linear continue to use raw last-hop magnitudes. Hop throttle (~60/s) can stay. Still no DSP door / `create*State` from `setPlan`.
3. **1D face (`spectrum1d-display.js`)** — keep `nodeGraphSpectrumLineComputeColumns` as the single column path. Share frequency mapping (`nodeGraphFrequencyCurveHz`) instead of forking it. Interpolate bins; keep the log-axis spike fix. Draw through the existing WebGL line / fill / bar path only.
4. **Definitions and Display Settings** — `public/node-graph-module-definitions.js` (`spectrum1d`), `public/node-graph-module-scope-trace-controls.js` (`spectrumLine` schema), `public/node-graph-module-scope-defaults.js`. Floor / ceiling / curve / smooth / peak limits live in defs (continuous where they should be, not only a stale choice list). Docked tip strings, no `title` hover. Face stays phone-friendly (Freq band on the module; analysis in Display Settings).
5. **Low end** — pick one capped approach and document it: raise the useful default, use freq pad carefully, and/or add a second longer-window FFT merged below a crossover (e.g. below ~200 Hz). Cost cap: no extra FFT beyond that pair, no pitch-dependent work. If multi-res does not land cleanly, ship the shared core + mapping + dB honesty first and list multi-res as the last PoC gate, not as a silent skip.
6. **Tests** — add `scripts/test_spectrum1d.mjs` (and a small browser smoke if that is the house style, cf. `scripts/test_spectrum_circle.mjs`). Cases: 0 dBFS sine level and frequency on lin and log axes; floor/ceiling; peak hold / decay; Smooth; bars vs line; hopSerial / no timer; Thru dry; resize / Mini Canvas is a scale of the same tile; no NaN. Extend existing spawn-width / settings probes only if you touch those files anyway.
7. **Docs** — update `docs/SPECTRUM_1D.md` with the new analysis, dB rules, and low-end behavior. Do not rewrite it from scratch.

---

## 4. Phase 2 (after the PoC is accepted)

Do two or three faces that already share the worklet, so they inherit the core.

1. **Spectrogram** — switch color mapping to honest dBFS using Floor / Ceiling (already on the face), without forcing the old compressed look unless a "Compressed" compatibility mode stays. Same frequency-curve helper. History / scroll stay. Confirm Canvas and Mini Canvas share one ring, no second FFT. Gradient editor unchanged in spirit. Update comments in `spectrogram-gl.js` (`bin lerp → undo log10…` should become a true dB path).
2. **Circular Spectrogram** — same analysis and dB path; only polar / sweep presentation remains unique (`docs/CIRCULAR_SPECTROGRAM.md`). Re-verify Spin, Mirror, Moving / Fixed Head, and that the Canvas tile animates.
3. Optional small follow-through: retire or alias the leftover Mel/Bark `freqScale` vs `frequencyCurve` confusion so all three faces tell one story.

---

## 5. Phase 3 (the rest)

1. **Spectrum Circle** (`videoFeedback`) — stop the main-thread per-video-frame FFT; consume the shared worklet (or the same helper driven by audio hops). Keep the ray / mirror presentation. Give it a real ceiling, not only a floor. Update `docs/SPECTRUM_CIRCLE.md` and `scripts/test_spectrum_circle.mjs`.
2. **Generic scope "Spectrum" mode** — point it at the shared core and 1D mapping, or remove it and send people to 1D Spectrum (no dead code).
3. Any later FFT display (or a video 📺 tap from these faces) must use the shared core. Processor faces use the style menu in §7; their audio DSP stays put except a read-only tap.

---

## 6. Open questions

1. Is a slightly larger default FFT (2048) acceptable for 1D Spectrum, or must 1024 stay the default and multi-res do the bass work?
2. Should Spectrogram keep a Compressed compatibility mode after Phase 2, or move everyone to Exact dB?
3. Multi-resolution in the PoC, or only if the larger window / pad is not enough?
4. Floor / ceiling on the 1D Spectrum *face* (like Spectrogram) vs Display Settings only?
5. Keep Mel / Bark, or is the 0…1 linear↔log curve enough?
6. Should the worklet FFT eventually move to native C++, or is the JS worklet the long-term analysis core?

Listening acceptance by Argi on the 1D Spectrum accuracy PoC is required before analyzer Phase 2 starts.
The STFT processor style PoC (Vocoder, §7) may proceed beside it once the shared style renderer can take a band vector.

---

## 7. Display styles for STFT modules

Argi's "upgrade" is two layers: the accuracy work in §§1–6, **and** new visual designs on the *processor* modules (not only the Multimeter analyzers). One example is Vocodex-style bars that grow and shrink per band — useful, but no module should be locked to that look. Style is a Display Settings choice. The 1D Spectrum accuracy PoC stays first (or can overlap only if it does not block this). This section is the style plan.

DSP stays as-is except a **read-only** tap of band or bin levels when a display needs the module's own analysis (preferred over a second FFT of the output).

### 7.1 Processor inventory (current faces)

`process_stft_dynamics` in `graph_engine.cpp` (~16379, dispatched ~19636) runs **Spectral Blur**, **STFT Contrast**, and **STFT Gate**. Other spectral processors have their own process functions in the same file. Almost every live one currently shows a generic **1D oscilloscope trace** (`displayType: "scope1dTrace"`) — a waveform, not bands. That is the gap.

| Module | Type / native | Engine | Current face | Notes |
|--------|----------------|--------|--------------|-------|
| Spectral Blur | `spectralBlur` (272), `native_modules/spectral_blur/spectral_blur.cpp` | `process_stft_dynamics` | `scope1dTrace`. Face: FFT size, Time Smear, Frequency Blur, Diffusion, Stereo, smoothers, Swarm / Level / Rate / Drift / Seed, Mix. | Live STFT effect. Swarm/Cloud wants a look that can feel fuzzy, not only a waveform. |
| STFT Contrast | `stftContrast` (270), `native_modules/stft_contrast/` | `process_stft_dynamics` | `scope1dTrace`. Contrast, Scale, Threshold, Ratio, Attack / Release, boost / gain, Mix. | Stereo-linked spectral dynamics. The interesting picture is per-band gain, not the output wave. |
| STFT Gate | `stftGate` (271), `native_modules/stft_gate/` | `process_stft_dynamics` | `scope1dTrace`. Hold, knee, profile, threshold, margin, depth, Attack / Release, smooth, Mix. | Same story: which bands are open or shut. |
| Spectral Freeze | `spectralFreeze` (273), `native_modules/spectral_freeze/` | own process (~19625) | `scope1dTrace`. | Frozen vs live spectrum is the story. |
| Spectral Delay | `spectralDelay` (275), `native_modules/spectral_delay/` | own process (~19631) | `scope1dTrace`. FFT size, delay / spread, pivot, curve, feedback, Mix. | Delay-vs-frequency, or a short history of the wet spectrum. |
| Spectral Warp | `spectralWarp` (279), `native_modules/spectral_warp/` | own process (~19614) | `scope1dTrace`. | Input vs output spectrum shows the warp. |
| Spectral Cross Synthesis | `spectralCrossSynthesis` (278), `native_modules/spectral_cross_synthesis/` | own process (~19617) | `scope1dTrace`. | Two sources; an overlay earns its keep. |
| Vocoder | `vocoder` (269), `native_modules/vocoder/vocoder.cpp` | own process (~19621) | `scope1dTrace`. Bands (5–100, default 32, log IIR 40 Hz–90% Nyquist), Band Width, Follower, Formant Shift, Mix. Inputs: Voice L/R, Synth L/R. | **Filter-bank vocoder, not an STFT**, but it is the Vocodex analogue: real per-band envelopes already exist in the DSP. Best style PoC. |
| Convolution Resonator | `convolutionResonator`, has an STFT vocoder blend | own process | **Already a custom WebGL face** `convolutionResonatorFace` ("Body / Bands"). | Do not replace that default. Later, offer the shared style menu as an *optional* display mode. |
| Spectral Smear (`spectralSmear`), FFT Reconstruction (`fftReconstruction`) | stubs | none | empty defs, no face, no DSP. | Skip until they exist. |
| Spectral Oscillator | oscillator, not a processor | `process_spectral_osc` | baked cycle (`additiveWaveform`), not a live STFT. | Out of this section. |
| Dispersion, Material Resonator, Noise Convolution Reverb, Early Reflections | also `scope1dTrace` or their own FX faces | not STFT analysis | — | Out of the shared STFT style menu unless a later pass offers the same renderer on any processor. |

`stftBlur` remains a dead passthrough (see `docs/SPECTRAL_BLUR_SWARM_PLAN.md` §7) and is not a display target.

### 7.2 Shared style menu

One WebGL style renderer (new helper, e.g. `public/lib/spectral-display-styles.js` + a shader face), fed by a **band or bin vector** plus optional second vector (input, carrier, or per-band gain). Sources, in order of preference:

1. A read-only tap of the module's own bands (Vocoder IIR envelopes, STFT Gate / Contrast gain, Freeze magnitudes, etc.).
2. The shared analysis core from §2, on In and/or Out (and a second input when the module has one).

Do not run a second heavy FFT when the DSP already has the bands. Updates follow audio hops or the module's own band-rate posts (`hopSerial` or equivalent) — **events only, no timers or polling**.

Style is a **Display Settings choice** (`spectralDisplayStyle` or similar), not hardcoded in the module. Band count, frequency scale (log/lin; Vocoder should default to its real IIR band map), dB floor/ceiling, colors / gradient, peak-cap and attack/release times all take their **limits from parameter definitions** (or settings whose min/max/step live in those defs). Docked tips are real sentences. **No hover tooltips.** Phone-friendly: the style view fills the module display area under the existing knob rows; dense options stay in Display Settings. Canvas and Mini Canvas: one rendered tile, Mini Canvas is a **uniformly scaled copy**, not a second analysis. Display scaling must **not fake clipping** (same rule as §2). WebGL only, no Canvas2D fallback, no dead style branches.

| Style key | What it looks like | Fits best |
|-----------|--------------------|-----------|
| `bars` | Vertical (or radial, later) bars that grow and shrink with each band's level. Optional peak caps with hold then fall. Attack/release from defs so motion can be snappy or creamy. Vocodex-class. | **Vocoder** default. Also a strong option on Gate / Contrast (level or gain). |
| `curve` | Smooth filled (and/or stroked) spectrum, log or lin X, honest dB Y — the 1D Spectrum look on a processor face. | Safe, readable default for Warp, Delay, Freeze, and Blur if particles feel too busy. |
| `particles` | A dot / particle field that gathers around the current spectrum (or Swarm/Cloud bins). Fuzzy, not a hard bar graph. | **Spectral Blur** default (matches Swarm / Cloud). Optional elsewhere. |
| `mirrorBars` | Two sets of bars, mirrored: L/R, or In/Out, or Voice/Synth. | Stereo Blur, Vocoder (Voice vs Synth), Cross Synthesis. |
| `miniWaterfall` | A short scrolling spectrum history in the face (not a full Spectrogram module). | **Spectral Delay** default; also Freeze (frozen plate + live trickle). |
| `overlay` | Input and output (or two sources) drawn together — two curves, or bars in two colors. | **Spectral Warp** and **Cross Synthesis** defaults. |
| `bandGain` | Per-band gain or gain-reduction: a zero line, boost up, cut down (or a dim bar for "shut"). | **STFT Gate** and **STFT Contrast** defaults. |

A module may hide styles that make no sense (no `bandGain` on Warp unless it exposes a gain vector). Adding a style later must not require forking a new renderer per module.

### 7.3 Recommended default per module

| Module | Default style | Why |
|--------|---------------|-----|
| Vocoder | **Bars** | This is the Vocodex picture: one bar per real IIR band, following the Voice envelope that drives the Synth. Curve is the fallback if bars feel too busy at 100 bands. |
| STFT Gate | **Band gain** | You need to see which bands are open. Bars of output level hide the gate. |
| STFT Contrast | **Band gain** | Contrast/compression is a per-band gain story; overlay or bars are options. |
| Spectral Blur | **Particles** | Waveform and hard bars fight the cloudy/fuzzy identity (Swarm / Cloud). A filled curve is the sober alternative if particles are not ready in the first style slice. |
| Spectral Freeze | **Mini waterfall** or a **curve** of the held spectrum with a live-input ghost | The hold is the point; a bouncing output wave is not. |
| Spectral Delay | **Mini waterfall** | Time-across-frequency is the module. A later specialized "delay vs Hz" curve is welcome but not the first style. |
| Spectral Warp | **Overlay** (in vs out) | You want to see the spectrum stretch, not just a wet waveform. |
| Spectral Cross Synthesis | **Overlay** (two sources and/or in vs out) | Two inputs. |
| Convolution Resonator | Keep **Body / Bands** | Already designed. Shared styles can be an optional mode later, not the spawn default. |

The 1D Spectrum *monitor* already has Filled / Line / Bars; it can stay on that schema, or later offer the same style keys where they overlap. Do not delay the accuracy PoC on this menu.

### 7.4 Style proof of concept: Vocoder

**Pick: Vocoder (`vocoder`).** After (or beside, without blocking) the 1D Spectrum accuracy PoC.

Reasons: Argi's reference is Vocodex-style growing bars, and this module already has a real band count and log IIR envelopes — the display can match the sound instead of a generic FFT of the output. It is a *processor*, so it proves the style menu on the modules that today only show `scope1dTrace`. Spectral Blur is a better later customer (default particles) once the renderer exists; Gate / Contrast follow with `bandGain`.

**"Perfect" for this slice**

- Spawn shows **bars**, one per Vocoder band (the `bands` parameter, log 40 Hz–90% Nyquist), levels from a read-only tap of the DSP envelopes (Voice analysis at least; Synth or output as a second color or mirror option). A 0 dBFS tone in one band fills that bar honestly; floor/ceiling come from defs; no fake clip.
- Peak caps and attack/release are real and definition-owned. Follower (ms) already in the module may drive or default the visual lag; do not invent a second undocumented smoother.
- Display Settings includes **Style** (at least Bars, Curve, Overlay / Mirror, and a documented subset of the menu). Switching style does not change the audio. Changing `bands` resizes the picture with the same 20 ms warm / crossfade the DSP already uses.
- WebGL only, phone-friendly under the existing three knob rows. Canvas and Mini Canvas share one tile; Mini Canvas is a uniform scale. Events / envelope posts only — no timers. No hover tooltips. Thru / dry-wet audio unchanged. Old patches load; they just *gain* a spectral face (document the new default so a bare `scope1dTrace` waveform is not silently required).
- Tests: envelope-to-bar correspondence, band-count changes, style switch, peak caps, no NaN, no second audio path, Mini Canvas is a scale of the same picture.

**Steps and files**

1. Read-only band tap in `native_modules/vocoder/vocoder.cpp` (and `process` in `graph_engine.cpp` ~19621): post Voice (and Synth or output) envelope arrays plus band-center Hz, count, and a serial. Do not alter the audio path. Wire through the worklet / data bus the same way Spectrogram posts `Spectrum` (`public/node-live-audio-worklet-native-graph.js` as needed).
2. Shared style renderer (new, under `public/lib/` or `public/modules/spectralDisplay/`): WebGL bars / curve / overlay (particles may wait for the Blur slice if time is tight — say so if dropped). Consume a generic `{ hz[], levelA[], levelB?, gain[]? }` buffer so Gate and Blur can reuse it.
3. Vocoder face: `public/node-graph-module-definitions.js` (`vocoder`, ~9148) — keep the knob rows; change or add a display type/mode (do not leave only `scope1dTrace` as the only mode). Settings schema in `public/node-graph-module-scope-trace-controls.js` and defaults in `public/node-graph-module-scope-defaults.js`: Style, floor/ceiling, peak, colors/gradient, scale. Limits only from defs. Docked tips.
4. Tests: new `scripts/test_vocoder_display.mjs` (and a small browser smoke if that is house style). Docs: a short note in a vocoder doc if one exists, otherwise a subsection here or `docs/VOCODER.md` only if the repo already has it.
5. Leave Convolution Resonator's custom face alone. Leave other agents' dirty files alone. MasterBot's graph / camera / cull files stay off-limits. No server kills, no app restart; Argi Ctrl+F5s. Append `?v=` tags if HTML boot lists must change.

**After the Vocoder style PoC:** STFT Gate and STFT Contrast (`bandGain`, taps from `process_stft_dynamics` / `stft_gate.cpp` / `stft_contrast.cpp`), then Spectral Blur (`particles`, after or with Cloud), then Warp / Cross Synthesis (`overlay`) and Delay / Freeze (`miniWaterfall`).

### 7.5 Open questions (styles)

1. For Vocoder bars, is the primary height the Voice envelope, the vocoded output, or a default overlay of both?
2. Should a "Waveform" style remain (today's `scope1dTrace`) as an explicit choice so nothing is taken away?
3. Particle style in the Vocoder PoC, or only once Spectral Blur picks it up?
4. Visual attack/release: reuse Follower (ms), or a separate definition-owned pair so the sound can stay crunchy while the face stays calm?
5. When is the 1D Spectrum accuracy PoC required to land relative to this style PoC? (Recommended: accuracy core first or in parallel; do not block bars on multi-res bass FFT.)

Listening acceptance by Argi on the Vocoder bars (and on switching to at least one other style) is required before rolling the menu to the other processors.
