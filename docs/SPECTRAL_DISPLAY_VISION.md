# Spectral Display Vision

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-25 |
| **Status** | Implemented 2026-11-25. See "Implementation notes" at the end. Listening acceptance by Argi open. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Companion** | `docs/SPECTRAL_DISPLAY_UPGRADE_PLAN.md` — inventory, accuracy rules (honest dB, log mapping, low-end, peak/smooth, no fake clipping), and the shared style-menu keys. **Read that plan. Do not copy it into this file.** This document supersedes only the *delivery model*: ship a shared foundation and a bunch of module faces in one pass, not a one-module proof of concept first. |

Handoff for an outside coding AI. Build the shared spectral layer once, then give every module below its own face in the same pass. Invent from this vision; do not wait for a further brief, and do not flatten every module into Vocodex bars just because bars are a good look on a vocoder. Audio DSP stays as-is except **read-only** taps of band or bin data the faces need. Leave other agents' dirty files alone; if a listed file is already mid-edit, fold into that work or skip the hunk — do not clobber it.

---

## The vision

Spectral displays in this app should feel like looking *into the process*, not at a generic oscilloscope glued under every knob row. Analyzers tell the truth about level and frequency. Processors show what the module is *doing* — doors opening, a spectrum freezing, echoes leaning later in the treble, a voice painting a bank of bands, a blur turning into weather.

They are one family. Dark stage, light is sound. Frequency reads left to right on a log axis unless the module is polar or the user picks linear. Amplitude is height, brightness, or particle density, always against a definition-owned floor and ceiling — the widget never pretends a value is clipping because the tile is short. Motion is only ever a consequence of audio hops or the module's own envelope posts. A kick should bloom the low end; a cymbal should etch a fine bright ridge; silence should leave a faint floor, not a dead black rectangle.

A shared default gradient — deep indigo at the floor, teal through the mids, warm gold into white at the ceiling ("cold fire") — ties the family together. A module may override it from Display Settings. Vocoder bars can be more graphic and neon. Blur particles should be milkier and softer. Gate and Contrast are more utilitarian: shut is slate, open is light, cuts hang below a zero line.

Canvas and Mini Canvas are the same picture. The module Canvas is the designed tile under the existing knob rows. Mini Canvas is that tile scaled down uniformly — never a second FFT, never a simplified "icon" analysis.

---

## 1. Shared foundation (build once)

Build this layer first. Every face below consumes it. Accuracy, mapping, event rules, and style keys live in `docs/SPECTRAL_DISPLAY_UPGRADE_PLAN.md` §§2 and 7.2 — follow them. This section is the *where* and the *once*.

### 1.1 Analysis core

One FFT, one window set, one definition of full scale (0 dBFS = coherent window sum / 2). Hop-driven posts with a serial (`hopSerial` or equivalent). Shared log/lin frequency helper (`nodeGraphFrequencyCurveHz` or the single successor). Honest dB after that scale. Interpolation of bins on a log axis (keep the 1D comb-spike fix). Event driven: no timers, no polling, no `requestAnimationFrame` smoother that runs when audio is quiet and no hop has arrived.

**Files**

- `public/lib/spectral-analysis.js` — intended home. **If this file already exists when you start, extend it; do not invent a second core.** (An uncommitted start was present when this vision was written.)
- `public/modules/spectrogram/spectrogram-worklet-evaluator.js` — Spectrogram, Circular Spectrogram, and 1D Spectrum already share this worklet (`SPECTROGRAM_ANALYSIS_TYPES`). Point it at the core; stop keeping a private FFT / window / dB path.
- `public/modules/videoFeedback/video-feedback-*.js` and `public/node-graph-module-scope-spectrum.js` — Spectrum Circle and the generic scope Spectrum mode must consume the same core (or the generic mode is removed; see skipped). No third or fourth FFT.

Do not move this FFT into C++ in this pass unless it is already happening elsewhere. Processor faces prefer a **module tap** over a second FFT of the output.

### 1.2 Shared WebGL spectral renderer + style menu

One renderer, one shader family, many styles. Input is a generic buffer: `{ hz[], levelA[], levelB?, gain[]?, serial }`. Styles (keys and intent in the upgrade plan §7.2): `bars`, `curve`, `particles`, `mirrorBars`, `miniWaterfall`, `overlay`, `bandGain`. A module may hide styles that have no data (no `bandGain` without a gain vector). Adding a style later must not fork a per-module renderer.

**Files** (new, unless an equivalent already landed)

- `public/lib/spectral-display-styles.js` and a companion shader / picture-device face (under `public/lib/` or `public/modules/spectralDisplay/`). WebGL only. No Canvas2D fallback. No dead style branches.
- Hook into the existing shared picture device the way `spectrogram-gl.js` and scope traces already do. Do not invent a second GL stack. Do not touch MasterBot graph / camera / cull files (see §7).

### 1.3 Display Settings schema, gradients, events

Style is a **Display Settings** choice (`spectralDisplayStyle` or the existing schema's successor), not a hardcoded module look. Band count, frequency scale, dB floor / ceiling, colors / gradient, peak-cap and attack/release (or Smooth) all take **limits from parameter definitions**. Docked tips are real sentences. No `title` hover tooltips.

Reuse and extend the Spectrogram gradient editor / LUT rather than shipping a second gradient lab.

**Files**

- `public/node-graph-module-scope-trace-controls.js`
- `public/node-graph-module-scope-defaults.js`
- `public/node-graph-module-scope-settings-controls.js` if that is where the panel is actually drawn
- `public/modules/spectrogram/spectrogram-gradient-editor.js` (extend, do not clone)
- `public/node-graph-module-definitions.js` — per-module display type / mode, settings keys, tip strings, min/max/step. Keep existing knob rows unless a row is already a display control (Freq band, Floor / Ceiling, History).

Updates follow audio hops or the module's own band-rate posts. Thru / dry-wet audio stays unchanged.

### 1.4 Foundation acceptance

- One analysis path for the analyzers listed below; one style renderer for the processors listed below.
- A 0 dBFS bin-centred sine reads as 0 dBFS against the definition ceiling, on lin and log axes.
- Switching style never changes audio.
- Mini Canvas is a uniform scale of the Canvas tile.
- No timers, no hover tooltips, no fake clipping, no Canvas2D, no second gradient system.
- Phone: the style view fills the module display area under the existing knobs; dense controls stay in Display Settings.

---

## 2. Per-module vision

### 2.1 1D Spectrum (`spectrum1d`)

**Look and feel.** This is the reference analyzer: a living silhouette of the sound, not a toy EQ. Default is a **smooth filled curve** — a glass mountain, luminous fill under a sharp stroke, peak caps as thin hanging ticks that rise instantly and fall with definition-owned hold / decay. Bars are an alternate, not the default (bars are the vocoder's language). On a kick, the left side of a log axis blooms and the caps jump; on a voice, a moving formant ridge walks the midrange; on a bright cymbal, a fine treble edge. Silence leaves a whisper of floor color, not an empty frame. Exact dB, interpolated bins, real bass (follow the upgrade plan's low-end options; do not ship a 47 Hz-wide mush as "good enough" if a capped pad or a second longer window below ~200 Hz will land cleanly). The Canvas is this mountain under a sparse face (Freq band belongs on the module). Mini Canvas is the same mountain, postage-stamp size.

**Default / alternates.** Default `curve` (filled + stroke + peak caps). Alternates: line-only, `bars`. Keep today's Filled / Line / Bars thinking if it already exists, but map it onto the shared style keys where they overlap.

**Data tap.** No native DSP tap. Shared analysis core on the module input, already posted by the spectrogram worklet (`Spectrum`, `SpectrumRaw`, `SpectrumGain`, `hopSerial`).

**Files.** `public/modules/spectrum1d/spectrum1d-display.js`, worklet evaluator above, defs (`spectrum1d`), `spectrumLine` schema in the scope-controls files, `docs/SPECTRUM_1D.md`, new `scripts/test_spectrum1d.mjs`. Keep `nodeGraphSpectrumLineComputeColumns` as the single column path or succeed it once — do not leave two.

**Acceptance.** 0 dBFS sine is at the ceiling, at the right frequency, on lin and log. Floor / ceiling, Smooth, and peak hold / decay match defs. Heights never slam a widget ceiling while the signal is below the definition ceiling. Hop serial only. Thru dry. No NaN. Mini Canvas is a scale of the same tile. Old patches load.

### 2.2 Spectrogram (`spectrogram`)

**Look and feel.** An honest heat-map of time: the last N seconds of spectrum burning from left to right (or the current scroll direction), frequency up the axis, color from the shared / editor gradient mapped to **real dBFS** between Floor and Ceiling already on the face. A full-scale tone is ceiling color, not a mid-orange because of `log10(1+ema·100)` compression. Bass has grain, not a wide smudge. History is memory — ridges stay ridges as they age, unless the user asked for a compatibility "Compressed" mode (only if you keep one; see the upgrade plan's open question). Canvas is the scrolling burn; Mini Canvas is the same ring, scaled, still moving.

**Default / alternates.** This module *is* a waterfall. Do not replace it with bars. Display Settings keep FFT size, window, overlap, pad, frequency curve, pause on silence, gradient. Optional Compressed compatibility, not the default.

**Data tap.** Shared analysis core via the existing worklet. No native DSP.

**Files.** `public/modules/spectrogram/spectrogram-display.js`, `spectrogram-gl.js` (the comment about undoing `log10` becomes a true dB path), `spectrogram-gradient-editor.js`, worklet evaluator, defs ~24041, tests if a spectrogram test exists or a small new one. History / GPU ring stay; confirm Canvas and Mini Canvas share one ring, no second FFT.

**Acceptance.** Floor / Ceiling are honest dB. A 0 dBFS tone at a known frequency paints the expected bin/row in ceiling color. Canvas and Mini Canvas stay in sync (no stale tile). Gradient editor still works. Pause on silence still works. CPU stays inside today's batch caps; do not explode overlap × FFT size.

### 2.3 Circular Spectrogram (`circularSpectrogram`)

**Look and feel.** The same burn, wrapped into a disc of time: angle is history, radius is frequency, bass a glowing heart by default, treble at the rim. The present is a writing head (Moving Head or Fixed, as today's face already offers). It should feel hypnotic *and* accurate — a record of the last N seconds, not a decorative spinner with mushy notes. Spin, Inner, Rotate, Mirror, Direction, Afterglow, Hang, and Sweep fade stay. Canvas must animate; the past bug (Mini Canvas live, Canvas stale) must not return.

**Default / alternates.** Polar waterfall is the point. Style menu does not replace this face. Analysis settings match Spectrogram.

**Data tap.** Same worklet posts as Spectrogram. No second analysis.

**Files.** `public/modules/circularSpectrogram/circular-spectrogram-display.js`, shared `spectrogram-gl.js` ring, defs ~24189, `docs/CIRCULAR_SPECTROGRAM.md`, plus the worklet. Re-verify polar / sweep presentation after the dB path change.

**Acceptance.** Same honesty as Spectrogram, in polar form. Spin / Mirror / Moving vs Fixed Head still do what the docs say. Both Canvas and Mini Canvas stay alive from the same ink.

### 2.4 Spectrum Circle (videoFeedback spectrum mode)

**Look and feel.** This is the *now*, not a history: a radial burst of the current spectrum, the existing ray / mirror / kaleidoscope presentation, but honest in amplitude and driven by the shared core. It should feel like a speaker cone of light — energy flares outward on transients, then collapses when the sound does — not like a second, slightly wrong FFT fighting the others. Give it a real ceiling, not only a floor.

**Default / alternates.** Keep the ray / mirror look as default. Do not turn this into a spectrogram disc (that is Circular Spectrogram).

**Data tap.** Shared analysis core, hop-driven. **Stop the main-thread per-video-frame FFT.**

**Files.** `public/modules/videoFeedback/video-feedback-*.js`, defs as they exist for this mode, `docs/SPECTRUM_CIRCLE.md`, `scripts/test_spectrum_circle.mjs`.

**Acceptance.** No main-thread FFT remains for this mode. Levels and frequencies match 1D Spectrum on the same signal. Ceiling is real. Existing ray / mirror controls still work. Tests updated.

### 2.5 Vocoder (`vocoder`)

**Look and feel.** The showpiece processor face: a living graphic EQ. By default, one rounded luminous bar per real IIR band (5–100, spawn 32, log from 40 Hz to 90% of Nyquist), growing and shrinking with the Voice envelope that actually drives the synth filters. Peak caps hang and fall. Tight gaps, a little neon in the cold-fire gradient, phone-readable even at 32 bands and still legible at 100. When a singer hits a vowel, a cluster of mid bars lifts together; a plosive slams a short group and the caps flash. Formant Shift should slide the apparent band centers, because that is what the DSP is doing. Changing `bands` must morph after the DSP's own 20 ms warm + 20 ms crossfade — no instant pop, no invented second fade. Optional second tint or `mirrorBars` for Synth / output. The three existing knob rows stay; the style view fills the display area under them.

**Default / alternates.** Default `bars`. Alternates: `curve`, `overlay` or `mirrorBars` (Voice vs Synth or output). A "Waveform" choice that restores today's `scope1dTrace` is allowed so nothing is taken away, but it is not the spawn default.

**Data tap (read-only).** `native_modules/vocoder/vocoder.cpp` and `graph_engine.cpp` process ~19621: post Voice envelope array (primary), plus Synth or output envelopes as `levelB` if cheap, plus band-center Hz, count, and a serial. Do not alter the audio path. Follower (ms) may drive or default the visual lag; do not invent an undocumented second smoother. Wire through the worklet / data bus the way Spectrogram posts `Spectrum` (`public/node-live-audio-worklet-native-graph.js` as needed).

**Files.** `vocoder.cpp`, `graph_engine.cpp`, worklet native graph, defs (`vocoder`, ~9148), shared style renderer, scope settings / defaults, new `scripts/test_vocoder_display.mjs`. There is no `docs/VOCODER.md` at the time of writing — do not create one unless you need it; a short note here or in a comment is enough.

**Acceptance.** Spawn shows bars, one per band, from the real envelopes — not a generic FFT of the output. A tone in one band fills that bar honestly. Style switch does not change audio. `bands` changes resize with the DSP warm / crossfade. Peak caps and AR come from defs. Mini Canvas is a scale of the same tile. Old patches load and *gain* this face. Thru / mix unchanged.

### 2.6 Spectral Blur (`spectralBlur`)

**Look and feel.** Weather, not a bar graph. The default is a **soft particle field**: dots gather along the current wet spectrum and bloom into a nebula. Time Smear should make the cloud persist and drift; Frequency Blur should fatten it sideways; Diffusion / Swarm / Cloud should shimmer — a tight, fuzzy halo, cloudy rather than a flapping comb. Hard bars fight this module's identity. The Canvas feels like looking into a tank of lit fog that thickens when you play, and thins to a faint ridge when you stop. Mini Canvas is the same fog, scaled.

**Default / alternates.** Default `particles`. Alternates: `curve` (the sober reading), `mirrorBars` for L/R when Stereo Spread is interesting. `bars` may exist in the menu but is not recommended as spawn.

**Data tap (read-only).** `native_modules/spectral_blur/spectral_blur.cpp` via `process_stft_dynamics` (~16379, dispatch ~19636): post wet (and optionally dry) bin magnitudes, FFT size / bin Hz, hop serial. If Swarm / Cloud state can be posted cheaply (per-bin displacement or character), use it to jitter particles; if not, magnitudes alone plus the shared style are enough. Do not change the audio path. Do not implement Cloud DSP in this pass.

**Files.** `spectral_blur.cpp`, `graph_engine.cpp` (stft dynamics), worklet native graph, defs (`spectralBlur`, ~8644), shared style renderer, settings schema, a small `scripts/test_spectral_blur_display.mjs` (do not casually rewrite the existing audio tests in `scripts/test_spectral_blur.mjs` if another agent is touching them).

**Acceptance.** Spawn is a particle field that follows the wet spectrum, not a waveform. Motion is hop-driven. A narrow sine is a tight cluster; Frequency Blur visibly widens it. Style can switch to curve without changing audio. Particles stay cheap enough on a phone (cap particle count in defs). Mini Canvas matches. Mix / Thru unchanged. Leave Cloud / Swarm *sound* work to the swarm plan.

### 2.7 Spectral Gate (`spectralGate`) and Spectral Contrast (`spectralContrast`)

**Look and feel (Gate).** A rack of shutters. Each band is a slat: shut is a dark, almost-flat door; open is a bright column. On a drum loop you should *see* the pattern — hats flick high slats open, a kick may hold or punch the low doors depending on the threshold, and the hold / attack / release times are visible as slats that linger or snap. Alternate `bandGain` reading: a zero line with reduction hanging down. The face is about which bands are allowed through, not a pretty output waveform.

**Look and feel (Contrast).** Same family, bipolar: a zero line, boost rising, cut hanging, mid bands pumping when Contrast is working. It should read as a per-band compressor / expander, slightly more "meter" than Gate's doors, still cold-fire rather than a DAW greyscale.

**Default / alternates.** Both default to `bandGain`. Alternates: `bars` of output level, `overlay` (in vs out), `curve`.

**Data tap (read-only).** `native_modules/spectral_gate/`, `native_modules/spectral_contrast/`, and `process_stft_dynamics`: post per-band gain or gain-reduction, plus optional input / output magnitudes, bin Hz, serial. Attack / Release already on the modules should inform the picture (defs own the visual times; do not invent a hidden smoother that disagrees with the audio).

**Files.** The two native modules, `graph_engine.cpp`, worklet native graph, defs (`spectralGate` ~9002, `spectralContrast` ~8888), shared renderer, settings schema, `scripts/test_spectral_gate_display.mjs` and `scripts/test_spectral_contrast_display.mjs` (or one shared test with two cases).

**Acceptance.** You can tell open from shut (Gate) and boost from cut (Contrast) on a known signal without listening. Gain vectors come from the DSP, not a guessed FFT comparison, unless a tap proves impossible — in which case document the fallback. Style switch is visual only. Mini Canvas matches. Audio unchanged.

### 2.8 Spectral Freeze (`spectralFreeze`)

**Look and feel.** A daguerreotype: the held spectrum is a solid, slightly frosted fill that does not wander. The live input is a thin ghost curve sliding underneath, always moving, so Freeze on vs off is obvious at a glance. A short `miniWaterfall` alternate can show the moment of capture as a plate with a live trickle at the writing edge. A bouncing output waveform is the wrong story.

**Default / alternates.** Default: `overlay` or `curve` of the held spectrum plus live-input ghost (pick one and stick to it — prefer a held `curve` + ghost overlay). Alternate: `miniWaterfall`.

**Data tap (read-only).** `native_modules/spectral_freeze/` and its process in `graph_engine.cpp` (~19625): post held magnitudes and live input magnitudes, bin Hz, serial, and a frozen/live flag if that state is not already obvious from the params.

**Files.** Freeze native, `graph_engine.cpp`, worklet native graph, defs (`spectralFreeze`, ~8477), shared renderer, settings, `scripts/test_spectral_freeze_display.mjs`.

**Acceptance.** When frozen, the solid curve holds still while the ghost keeps moving. When unfrozen, they catch up. Honest dB. Hop-driven. Audio unchanged.

### 2.9 Spectral Delay (`spectralDelay`)

**Look and feel.** An echo chamber of light. Default is a short **mini waterfall** of the wet spectrum: new energy writes a bright edge, repeats show up as receding stripes, and Delay Spread makes those stripes *tilt* — highs and lows come back at different times, which you should be able to see as a leaning ridge. Feedback fills the chamber with fading copies. This is the module where time-across-frequency is the whole joke; a waveform face hides it.

**Default / alternates.** Default `miniWaterfall`. Alternates: `curve`, `overlay` (dry vs wet). A later specialized "delay vs Hz" curve is welcome if the tap makes it easy, but is not required if the tilted waterfall already tells the story.

**Data tap (read-only).** `native_modules/spectral_delay/` and process ~19631: post wet (and optionally dry) magnitudes per hop, bin Hz, serial. If a per-bin delay time vector is cheap, post it too so a delay-vs-Hz overlay can exist; if not, the waterfall is enough.

**Files.** Delay native, `graph_engine.cpp`, worklet native graph, defs (`spectralDelay`, ~8329), shared renderer, settings, `scripts/test_spectral_delay_display.mjs`.

**Acceptance.** A click or short burst produces a visible delayed ridge. With Spread up, high and low bands do not write that ridge at the same history depth. Feedback adds fading repeats. Hop-driven. Audio unchanged.

### 2.10 Spectral Warp (`spectralWarp`)

**Look and feel.** A rubber sheet. The input spectrum sits as a thin ghost; the output is the solid body, stretching and squeezing along log frequency as you warp. A sine should be seen to *move* — the ghost stays, the solid peak slides to a new home. This is the whole point of the module, and a wet waveform cannot say it.

**Default / alternates.** Default `overlay` (in vs out). Alternates: `curve` of the output, `mirrorBars`.

**Data tap (read-only).** `native_modules/spectral_warp/` and process ~19614: post input and output magnitudes, bin Hz, serial.

**Files.** Warp native, `graph_engine.cpp`, worklet native graph, defs (`spectralWarp`, ~7589), shared renderer, settings, `scripts/test_spectral_warp_display.mjs`.

**Acceptance.** On a sine, input and output peaks sit at the pre- and post-warp frequencies. Warp amount moves the solid peak. Honest dB, hop-driven, audio unchanged.

### 2.11 Spectral Cross Synthesis (`spectralCrossSynthesis`)

**Look and feel.** A double exposure that resolves into one voice: two source ghosts (the two inputs) and a brighter solid hybrid. When one source is a voice and the other is a texture, you should see which ridges came from where, and how the output borrows them. Two colors plus a result, not a third mystery waveform.

**Default / alternates.** Default `overlay` (two sources and/or in vs out). Alternates: `mirrorBars`, `curve` of the output.

**Data tap (read-only).** `native_modules/spectral_cross_synthesis/` and process ~19617: post both source magnitudes and the output magnitudes, bin Hz, serial.

**Files.** Cross-synthesis native, `graph_engine.cpp`, worklet native graph, defs (`spectralCrossSynthesis`, ~7720), shared renderer, settings, `scripts/test_spectral_cross_synthesis_display.mjs`.

**Acceptance.** Two distinct input tones are visible as two ghosts; the output shows the hybrid the module actually produces. Hop-driven, audio unchanged, Mini Canvas matches.

---

## 3. Skipped (and why)

These are out of this one-shot. Do not "just add bars" to them to look complete.

| Module | Why skipped |
|--------|-------------|
| **Convolution Resonator** | Already has a designed WebGL face (`convolutionResonatorFace`, Body / Bands). A one-shot must not replace that default. Shared styles may be an optional mode in a later pass. |
| **Spectral Smear**, **FFT Reconstruction** | Empty stubs: no DSP, no face. Nothing to tap or show. |
| **Spectral Oscillator** | Band-limited wavetable oscillator, not a live STFT. Its baked cycle plot (`additiveWaveform` / `spectralOscBakeCycle`) is a different problem. |
| **Dispersion**, **Material Resonator**, **Noise Convolution Reverb**, **Early Reflections** | Not STFT analysis faces. No confident spectral story that is *about what they do*. They may keep `scope1dTrace` or their own FX faces. |
| **`stftBlur`** | Dead passthrough leftover. Not a display target (see `docs/SPECTRAL_BLUR_SWARM_PLAN.md`). |
| **Generic scope "Spectrum" mode** | Not a designed module. In the foundation pass, point it at the shared core **or remove it** and send people to 1D Spectrum (no dead code, no third look). That is a cleanup, not a vision face. |

---

## 4. Build order (inside the one shot)

Ship as one effort, but in this sequence so later faces inherit working ink:

1. **Analysis core** in `public/lib/spectral-analysis.js`, wired through the spectrogram worklet. Honesty tests on a sine (level, frequency, lin/log).
2. **Shared WebGL style renderer** + Display Settings schema + shared gradient path. Prove `curve`, `bars`, `overlay` on a dummy or on 1D / Vocoder data. `particles` and `miniWaterfall` next in this same step, not a future project.
3. **Analyzer faces:** 1D Spectrum, then Spectrogram + Circular Spectrogram (same ring), then Spectrum Circle (kill the main-thread FFT).
4. **Read-only taps** in one native/worklet pass where possible: Vocoder envelopes first (cleanest band vector), then Gate / Contrast gain, then Blur / Freeze / Delay / Warp / Cross magnitudes. Do not change audio.
5. **Processor faces** in that same order: Vocoder, Gate + Contrast, Blur, Freeze, Delay, Warp, Cross Synthesis.
6. **Tests and docs** as each cluster lands (`docs/SPECTRUM_1D.md`, `docs/CIRCULAR_SPECTROGRAM.md`, `docs/SPECTRUM_CIRCLE.md`; processor notes only if a doc already exists). Append `?v=` tags if HTML boot lists must change. Argi Ctrl+F5s — do not kill or restart app servers.

If time or risk forces a cut inside the pass, drop in this order (last dropped first): Spectrum Circle presentation polish (but still remove the extra FFT), Cross Synthesis, Warp, Delay, Freeze, Blur particles (leave a `curve` default if particles are not ready — say so), Gate / Contrast, Vocoder, Spectrogram / Circular, 1D Spectrum, foundation. Do not ship processors that still show only `scope1dTrace` while claiming the vision is done, unless you explicitly list which faces slipped and why.

---

## 5. Shared risks

- **Cost.** Do not give every processor a second heavy FFT of In and Out if the DSP already has bands or bins. Cap particle counts and mini-waterfall history. Respect existing hop / batch caps. Phone-friendly is a cost budget, not only a layout.
- **Dirty tree.** `graph_engine.cpp`, defs, worklet files, `spectral_blur.cpp`, wasm, and `public/lib/spectral-analysis.js` are often mid-edit by others. Touch only what this pass needs; do not "format while you're here." Do not stage unrelated hunks.
- **Taps vs audio.** A display post that accidentally reallocates or resets a bank will click. Warm / crossfade (Vocoder 20+20 ms) must stay the DSP's. Read-only means read-only.
- **Stale Canvas.** Circular Spectrogram already had a Mini Canvas-live / Canvas-dead bug. Every face must draw both views from one tile.
- **Fake clipping and compressed dB.** The old spectrogram column and 1D height clamp are the pattern to kill, not to copy.
- **Style lock-in.** Defaults are strong opinions; the menu must still let someone pick `curve` on a vocoder or `bars` on a blur.
- **videoFeedback entanglement.** Spectrum Circle lives in a video module. Change the analysis source, not the whole video path.
- **Line numbers** in this doc (`~19621`, defs `~9148`, …) drift. Search from the symbol / type name if they have moved.

---

## 6. Test checklist

Shared, then per-face tests named in §2. Prefer new `scripts/test_*_display.mjs` files and the existing `scripts/test_spectrum_circle.mjs`. Add a small browser smoke only if that is house style.

- 0 dBFS sine: level, frequency, lin and log, no NaN.
- Floor / ceiling from defs; display scaling does not fake clip.
- Peak caps / Smooth / attack-release follow defs.
- Hop / envelope serial only — no timer-driven motion while audio is stopped and no posts arrive.
- Style switch never changes audio, Thru, or Mix.
- Band or FFT-size changes follow the DSP (Vocoder warm / crossfade; STFT size if exposed).
- Envelope-to-bar (Vocoder) and gain-to-slat (Gate / Contrast) correspondence.
- Freeze: held solid stays, ghost moves.
- Delay: delayed ridge, tilt with Spread.
- Warp: output peak moves relative to the input ghost.
- Cross Synthesis: two sources plus hybrid visible.
- Blur: narrow sine is a tight cluster; blur widens it; particles capped.
- Spectrogram / Circular: honest dB color, shared ring, both canvases live.
- Spectrum Circle: no main-thread FFT, ceiling works.
- Canvas vs Mini Canvas: one picture, uniform scale, resize safe.
- Old patches load; spawn defaults match this vision.
- No new hover `title` tooltips; docked tips are sentences.
- Phone layout: knobs remain usable; style view fills the remaining display area.

---

## 7. What NOT to do

- **No audio DSP changes** except read-only taps. Do not implement Spectral Blur Cloud, do not "improve" smearing, and do not retune defaults to make a picture look busier.
- **WebGL only.** No Canvas2D fallback, no new DOM canvas plotters.
- **No fake clipping.** Display scale must not slam or color-clip values that are still below the definition ceiling.
- **Events only.** No timers, no polling loops, no rAF interpolators that invent motion without a hop or envelope post.
- **Parameter limits only from parameter definitions.** No hard-coded floors, ceilings, band counts, or times that disagree with defs. Continuous where the def is continuous.
- **No hover tooltips.** No `title` tooltips. Docked tips panel with real descriptions.
- **Phone-friendly.** Dense analysis / style controls in Display Settings, not a seventh knob row.
- **No dead code.** No unused style branches, no leftover private FFTs, no generic Spectrum mode left half-alive.
- **Names are Canvas and Mini Canvas.** Mini Canvas is a uniform scale of the tile, not a second analysis.
- **Only MIDI modules handle MIDI.** These displays do not grow MIDI paths.
- **MasterBot files are off-limits:** `node-graph-gl-graph.js`, `node-graph-module-geometry.js`, `node-graph-viewport-perf.js`, `node-graph-view-probe.js`, `node-graph-jack-chrome.js`, and cull / present / camera code.
- **Do not replace** Convolution Resonator's Body / Bands face. Do not build a live STFT view for Spectral Oscillator. Do not revive `stftBlur`.
- **Do not kill or restart** app servers (8765 / 8080 / 8090 / 8081 / 8082 / 8084). Argi Ctrl+F5s. No force-push, no rebase, no branch switch, no `reset --hard`. Commit only your hunks. Preserve line endings (docs are LF).
- **Do not push** unless Argi lifts the standing hold.

Listening acceptance by Argi — especially Vocoder bars, Blur particles, and 1D honesty — is the real finish line. If a face looks clever but lies about the sound, it is not done.

---

## Implementation notes (2026-11-25)

- **Analysis core:** `public/lib/spectral-analysis.js` (FFT, windows, full scale, `nodeGraphFrequencyCurveHz`). Worklet, Spectrum Circle and the scope Spectrum mode all use it; Spectrum Circle's main-thread FFT is gone (it gets `SpectrumRaw` from the worklet analysis of input A).
- **Taps (read-only, no audio change):** Vocoder `soemdsp_vocoder_display_*` (band centres with Formant Shift, pi/2 x envelope so a unit sine reads 0 dBFS, incoming bank + DSP crossfade weight). Spectral Gate / Contrast `*_display_power / _gain / _rate / _frames` (bin power in their own Threshold units, gain dB).
- **Fallback, documented:** Blur, Freeze, Delay, Warp and Cross Synthesis rewrite their spectra in place, so there is no stable array to point at. Their faces use the shared core on the module output (scope ring) and the captured inputs (In / Voice / Synth) at display rate: a 2048 Hann, at most 30 analyses per second of audio, driven by audio blocks (no timer; no audio, no posts). Cost does not depend on the module FFT Size.
- **Renderer:** `public/lib/spectral-display-styles.js` on the shared GL line batch; styles curve, bars, particles, mirrorBars, miniWaterfall, overlay, bandGain. Face glue and per-module defaults: `public/modules/spectralDisplay/spectral-display-face.js` (displayType `spectralStyle`). Gradient: new "cold fire" preset in the shared gradient editor.
- **Defaults:** Vocoder bars, Gate / Contrast band gain, Blur particles, Freeze / Warp / Cross overlay, Delay waterfall. Each processor has a display-only Curve knob (`displayOnly: true`, not in C++ metadata) and Display Settings for style, Floor / Ceiling, bars, peak caps, particles, history rows and gain spans.
- **Spectrogram / Circular:** columns are linear |X| per hop (no EMA, no `log10(1+x)`); the shader grades |X| / full scale to dBFS.
- **1D Spectrum:** peak caps default to Hold.
- **Tests:** `scripts/test_spectral_display.mjs` (40 checks), `scripts/test_spectrum1d.mjs`; existing processor tests updated for the new face type.
- **Not done:** scope Spectrum mode still pools to 160 linear bars at a fixed −100..0 dB.

