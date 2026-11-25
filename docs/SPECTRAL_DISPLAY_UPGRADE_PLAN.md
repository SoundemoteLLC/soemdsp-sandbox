# Spectral Display Upgrade Plan

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-25 |
| **Status** | Design only. Do not implement from this revision. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Related** | `docs/SPECTRUM_1D.md`, `docs/CIRCULAR_SPECTROGRAM.md`, `docs/SPECTRUM_CIRCLE.md` |

Handoff for an outside coding AI. Upgrade STFT / FFT *displays* one module at a time. Get the proof-of-concept perfect, then a few more, then the rest. Do not start every display at once. Do not change audio DSP modules (Spectral Blur, Warp, Delay, etc.) unless a display needs a read-only analysis tap. Leave other agents' dirty files alone.

---

## 1. Inventory

These four are the live FFT / STFT *faces*. Other "waterfall" displays in the app are scrolling signal history, not spectra. Matrix Waterfall is glyph rain. Spectral Oscillator's face is a baked one-cycle plot (`spectralOscBakeCycle`), not a live FFT. Spectral Blur and the other STFT processors use a 1D scope trace. `fftReconstruction` is still a stub with no DSP. Those are out of scope except as later consumers of a shared analysis core.

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
3. Any later FFT display (or a video 📺 tap from these faces) must use the shared core. Audio STFT modules stay out of this plan.

---

## 6. Open questions

1. Is a slightly larger default FFT (2048) acceptable for 1D Spectrum, or must 1024 stay the default and multi-res do the bass work?
2. Should Spectrogram keep a Compressed compatibility mode after Phase 2, or move everyone to Exact dB?
3. Multi-resolution in the PoC, or only if the larger window / pad is not enough?
4. Floor / ceiling on the 1D Spectrum *face* (like Spectrogram) vs Display Settings only?
5. Keep Mel / Bark, or is the 0…1 linear↔log curve enough?
6. Should the worklet FFT eventually move to native C++, or is the JS worklet the long-term analysis core?

Listening acceptance by Argi on the 1D Spectrum PoC is required before Phase 2 starts.
