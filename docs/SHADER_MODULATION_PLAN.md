# Shader module modulation (audio → picture at frame rate) — plan

Status: **plan only, not built.** Asked for by Argi via MasterBot on 2026-11-20:
the new shader (picture effect) modules' parameters can't be modulated, and he
expects frame-rate modulation from audio to fit the way the rest of the app
already modulates parameters.
Written by Badger from a read-only look at `HEAD` `ccd64e7b`.

Related: `docs/PARAM_SURFACES.md` (DOMAIN / MOD / SIGNAL IN),
`docs/SLIDER_BUFFERED_MODULATION_PLAN.md` (parked), `docs/VIDEO_GRAPH_PLAN.md`,
`public/node-graph-ghost-sliders.js`,
`public/node-graph-stdlib/node-graph-param-surface-helpers.js`.

## Why it doesn't work today

Most of the pieces are already there. One link is missing.

1. **The jacks exist.** `createNodeGraphParameter`
   (`public/node-graph-module-factories.js` ~line 861) gives every parameter a
   MOD jack unless its definition says `modulation: false`. None of the shader
   definitions say that, so a cable can already be wired into, say,
   Kaleidoscope › Rotate.
2. **The source is already captured.** `nodeGraphCompiledScopeCaptureNodeIds`
   (`public/node-graph-execution-plan.js`) adds every modulation source to the
   scope-capture set. Its samples land in
   `nodeGraphModuleScopeState.buffers` under `"<node>:<port>"`. Every shader
   module is a `visualSink`, so it is reachable in the plan, and so are its
   modulation sources.
3. **The ghost already computes the modulated value.**
   `nodeGraphParameterGhostSignal(node, key)` folds the base value plus every
   MOD source through the shared fold (`nodeGraphParamFoldModSources`) and
   returns `effectiveDomain`. Three faces already draw from it at frame rate:
   the Additive filter curve, the Harmonic count and the Transport BPM.
4. **The missing link: the shader faces never read it.** Every picture
   module's `*-display.js` reads only the knob, through its own
   `nodeGraph<Module>ReadParam` → `nodeGraphReadNodeNumber` (the patch value).
   Then it clamps with **hardcoded numbers** (for example
   `nodeGraphCrtRasterClamp(..., 0, 4)` and Kaleidoscope's
   `read("zoom", 0.1, -1, 1) * 0.05`). So the ghost moves, but the picture
   doesn't. The hardcoded clamps also break the rule that parameter
   definitions are the only source of limits.

So the job is a **reader**, not a new modulation system: one shared
frame-rate "effective parameter" read that every picture face uses instead of
its local `ReadParam` and `Clamp`.

## Shader modules in scope

The new picture-chain modules (commit `a9474f94`). Each has
`*-register.js` (definition), `*-display.js` (reads parameters and calls
`...GlStep`), `*-gl.js` (program and uniforms) and `*-ui.js` (rAF face pump
through `nodeGraphInstallDrawingFacePump`, which owns the clock).

| Module (key) | Parameters | Local readers / hardcoded clamps in display |
|---|---|---|
| CRT Raster (`crtRaster`) | pitch, depth, beam | 6 / 4 |
| Analog Signal (`analogSignal`) | jitter, roughness, jitterRate, wobble, wobbleRate, ringing, ringX, ringY, bleed, noise, instability | 5 / 3 |
| Analog Distortion (`analogDistortion`) | hum, humBars, humWidth, humSpeed, wiggle, wiggleRate, magnet, magX, magY, magPull, magSwirl, magSize, magPurity, instability | 4 / 4 |
| Kaleidoscope (`kaleidoscope`) | segments, angle, mirror, centerX, centerY, input, decay, zoom, rotate, shiftX, shiftY, blend, hue, blur, srcX, srcY, srcZoom, saturation, punch | 5 / 2 (helper used ~19 times) |
| Chroma Color (`chromaColor`) | red, green, blue, hue, saturation, lightness, contrast, gamma, tintHue, tint, invert, drift, spread | 4 / 2 |
| Bloom & Glow (`bloomGlow`) | threshold, bloom, spread, glow, glowSize, dim | 4 / 2 |
| Screen Glass (`screenBend`, changed in the same commit) | width, height, round, vignette, vigReach, vigCurve, vigShape, glareX, glareY, glare, glareSize, shadowAlpha, shadowThick | 16 / 14 |
| Aberration (`aberration`, changed) | mode, blend, hue, range | 11 / 7 |

The same pattern, so the same change applies to: Place, Screen Shake,
Image Burn, Video Delay, Video Feedback, RGB Fractal and fBm Field. Phase 3
picks them up.

How the uniforms are set today: once per face-pump frame, `draw…FaceItem`
builds a plain object of numbers and passes it to `nodeGraph<Module>GlStep`,
which calls `gl.uniform1f` and similar for each one. **Every uniform is already
re-sent every frame**, so modulation adds no uniform-upload cost.

## How the rest of the app modulates (what we reuse)

- **Definition** (`parameters[]`): `min`, `max`, `mid`, `step`,
  `nonlinearSlider` / `sliderCurve`, `bipolar`, `wraparound`, `hardClamp`,
  `hardMax`, `constraint` (`cpu|gpu|ram`), `outputDomain`, `unipolarMod`,
  `smoothingSeconds`, `tooltip`. Patch `paramMeta` can override per node
  (`nodeGraphReadPatchParameterMetadata`).
- **Fold (single source of truth):** `nodeGraphParamFoldOrBase` /
  `nodeGraphParamFoldModSources`:
  - A bare MOD sample is a **unit offset across [min, max]**: −1…+1 is the full
    range. It adds to the knob and the result clips to min/max (B-082).
  - Sources tagged `outputDomain` add in real units.
  - MOD never multiplies and never replaces.
  - There is no per-cable depth. Depth comes from an upstream module
    (Attenumax, Gain, Range).
- **Domain bounds:** `nodeGraphParamApplyDomainBounds`. Values wrap when
  `wraparound` is set, and clamp only for `hardClamp` or `constraint: gpu|cpu|ram`.
- **Audio → main thread:** the worklet posts scope rings. Each buffer carries
  `nodeGraphScopeAbsoluteFrame` / `nodeGraphScopeTotalWritten`. Sources whose
  own face is a waveform display write every engine sample. Other sources are
  "latest value" and are written once per stride (`visualWriteStride`,
  following Simulation FPS), which is a point sample.
- **Ghost span:** `nodeGraphGhostSliderScopeRange` scans the samples since the
  last scan (shared 6 ms cache, 250 ms cap) and returns `{lo, hi, latest}`.

## The plan

### 1. One shared reader: `nodeGraphPictureParam(nodeId, key)`

Add a new small file, `public/node-graph-picture-params.js`, loaded before the
module displays in `index.html` and `perform.html`. It provides:

- `nodeGraphPictureParams(nodeId, keys)` → `{ key: effectiveDomainValue }`.
  It is called **once per paint** by each face, before `GlStep`.
- Per parameter:
  1. `base` = `nodeGraphReadNodeNumber(nodeId, key)` (the knob; already
     smoothed when the user drags).
  2. `sources` = the MOD cables into `(nodeId, key)`. They come from a
     per-node index rebuilt only when `patch` or `patch.modulations` identity
     changes (the same rule as the ghost map), not from scanning
     `patch.modulations` for every parameter on every frame.
  3. Each source is reduced to **one value per frame** (§2), then tagged
     `{value, domain: true}` when the destination metadata has
     `outputDomain`, exactly as the ghost and the worklet tag it.
  4. `effective = nodeGraphParamFoldOrBase(base, sources, metadata)`. This is
     the same fold the audio engine and the ghost use, so the picture, the
     ghost and any audio use of the same parameter agree.
  5. `nodeGraphParamApplyDomainBounds(effective, metadata)`.
  6. If the definition `step` > 0, quantize to the step (`pitch`, `segments`,
     `blend`, `mirror`, `mode`).
- **No numbers of its own:** there are no clamps, scales or fallbacks beyond
  the definition's `defaultValue` (through `nodeGraphParameterFallback`).

### 2. Reducing audio to one value per frame (physically meaningful)

A picture is shown for one frame interval Δt (about 16.7 ms at 60 Hz). The
honest value for that frame is **the mean of the signal over that interval**.
It is what a camera with an open shutter would integrate. It is a box filter
exactly one frame long, with nulls at multiples of the frame rate, so anything
faster than the picture can show averages out instead of aliasing into slow
fake motion.

- **Mean, not latest:** the latest sample of a 220 Hz sine read at 60 Hz is a
  random-looking point. Its aliases land anywhere from 0 to 30 Hz, so the
  picture "wanders" with no relation to the sound. The mean does not do that.
- **Not peak or RMS inside the reader:** those are signal processing with
  their own time constant. To drive the picture with loudness, wire an
  envelope or the existing RMS module into the MOD jack, which is the modular
  way. The reader stays a neutral time-average, so DC and slow CV (LFOs,
  envelopes) pass through unchanged. *(Open question 2.)*
- **Window = the samples written since this consumer's last frame, by sample
  count, not wall time.** Keep a cursor per (picture node, source port) at the
  buffer's `nodeGraphScopeAbsoluteFrame`. Each paint averages the new samples
  from the cursor up to the newest and moves the cursor. Then:
  - Nothing is counted twice or skipped, even when the ghost (30 Hz) and the
    picture (60 Hz) read the same source. The ghost's shared 6 ms time cache
    can't guarantee that.
  - Frame-time jitter doesn't matter. A late frame just averages more samples.
  - A frame with no new samples (the worklet posts in blocks) **holds the
    previous mean**. It does not drop to 0 or to the knob.
  - If the cursor falls behind further than the ring holds (tab hidden),
    average what the ring still has.
- **Latest-value sources need a matching write.** Today a source that isn't a
  waveform display is written once per stride as a point sample, so the mean
  of those points is still aliased. Change the worklet's latest-value write
  for **modulation sources only** to write the stride's mean (a running sum
  over the stride, written when the stride ends). This is
  `visualWriteStride` in `node-live-audio-worklet-scope-io.js` and the stride
  write in `node-live-audio-worklet-native-graph.js` ~11665, plus the
  matching path in `node-live-audio-worklet-scope-snapshot.js`. LCD faces
  keep their point sample (they show "the value now"). The cost is one add per
  sample per captured modulation source. *(Open question 3.)*
- **Optional extra smoothing, from the definition only:** if a parameter's
  definition (or `paramMeta`) has `smoothingSeconds` = τ > 0, run a one-pole
  on the frame means with `α = 1 − exp(−Δt/τ)`. Δt is the measured paint
  interval, so the response time is the same at 30, 60 or 144 Hz. τ absent or
  0 means no extra smoothing; the one-frame mean is already the frame-tied
  smoothing. No hardcoded "0.08"-style coefficient. *(Analog Signal's
  frame-time smoother, `c.dt += (raw - c.dt) * 0.08`, is a separate thing and
  stays as it is.)*
- **Engine paused:** sources stop writing, so the reader holds. With Viewport
  On and the engine paused, the picture keeps painting with the held value.

### 3. Units: definitions only

- **MOD is a unit offset across the definition's [min, max]:** a ±1 source
  sweeps the full slider, and the result clips to min/max (the existing B-082
  rule). Sources tagged `outputDomain` add in real units. No shader code
  scales or clamps anything.
- **The hardcoded clamps and scales in the displays move into the
  definitions:**
  - Each `nodeGraph<Module>Clamp(x, lo, hi)` is deleted. If its lo/hi equals
    the definition min/max, the fold's unit-band clip already covers it. If it
    is a **GPU safety limit** (loop counts such as `segments`, blur taps,
    `pitch` ≥ 2), the definition gets `constraint: "gpu"` (or `hardClamp`), and
    `nodeGraphParamApplyDomainBounds` applies it for both knob and MOD.
  - Hidden unit scales (Kaleidoscope's `zoom × 0.05`, `rotate × 0.5`,
    `shift × 0.02`, `hue × 0.05`, `angle × π`) become the parameter's real
    unit in the definition (min/max/mid in %/frame, rad, turns, and so on, with
    `tooltip` text updated). The display then passes the value straight
    through. Old patches need a one-time param migration (value × scale)
    keyed on a definition version. *(Open question 4.)*
- **Bipolar:** the definition's `bipolar` (or min < 0 < max where the code
  infers it) decides whether negative MOD is allowed, through `unipolarMod`,
  with no shader-side rule.
- **Discrete parameters** (`blend`, `mirror`, `mode`, `pitch`, `segments`) are
  quantized by the definition `step` after the fold, so a slow LFO steps
  through blend modes cleanly. *(Open question 5.)*

### 4. Per-frame cost

- Reader: for each modulated parameter, sum the new samples. At 48 kHz and
  60 fps that is about 800 adds per full-rate source per frame (one shared
  scan per source per frame, cached by sample cursor). Unmodulated parameters
  cost what they cost today (one `nodeGraphReadNodeNumber`).
- Uniforms: unchanged. All are already sent every frame.
- Worklet: one add per sample per captured modulation source, for the mean
  write.
- No new GL contexts, textures or passes.

### 5. Face rules (stillness, no fake clipping)

- **The picture** follows the modulated value; that is the point of the
  feature.
- **Face overlays and controls** (Screen Glass's vertical slider face, XY pads
  such as Analog Distortion's magnet position and Analog Signal's ringing
  direction) keep showing the **knob**. They also show the existing ghost span
  when modulated, the same as a slider. They do not jump with the audio.
  *(Open question 6.)*
- No display-side scaling or clipping. A value past the definition range
  is clipped only by the definition rule, and the ghost shows that same value.

### 6. What changes per module

For each picture module (`*-display.js` only, plus definitions):

1. Replace `nodeGraph<Module>ReadParam` and `nodeGraph<Module>Clamp` with one
   `const p = nodeGraphPictureParams(nodeId, KEYS)` per paint.
2. Delete the hardcoded lo/hi and scales; move them into the definition
   (`constraint: "gpu"` for real GPU limits; real units for hidden scales).
3. Phase-accumulated rates (Analog Signal `jitterRate`/`wobbleRate`, Analog
   Distortion `humSpeed`/`wiggleRate`) keep their phase accumulators. The
   modulated **rate** is integrated (`phase += rate·Δt`), so modulation
   bends speed smoothly and never jumps the phase.
4. `tooltip` fields: add one line where useful ("Modulate to …"). There are
   no pop-ups.
5. `*-gl.js`: no change, apart from removing shader-side `clamp(...)` calls
   that duplicate a definition limit (for example Analog Signal
   `clamp(uRough, 0.0, 1.0)`) when the definition now carries it.

Bump `?v=` only on the scripts that change.

### 7. Phases

0. **Check first (no code):**
   - Wire an LFO into Kaleidoscope › Rotate and confirm the MOD jack and ghost
     appear.
   - Confirm the source ring exists in `nodeGraphModuleScopeState.buffers`.
   - Confirm the native and efficient engines accept a modulation edge whose
     destination has no DSP (no "unknown destination" issue in
     `nodeGraphInactiveWireReads`).
1. Add `node-graph-picture-params.js` (reader, per-consumer cursor, mean,
   optional τ smoothing, step quantize) and wire it into Kaleidoscope and
   CRT Raster.
2. Make the worklet write a stride mean for modulation sources.
3. Roll out to the other picture modules (table above, then Place, Screen
   Shake, Image Burn, Video Delay, Video Feedback, RGB Fractal, fBm Field).
4. Move the hidden scales into definitions, with the patch migration (only if
   Argi says yes to question 4).

**Test:**
- A 1 Hz LFO gives a smooth sweep.
- A 220 Hz sine at full depth gives a steady average (≈ 0 offset) rather than
  a random wander.
- A DC source gives an exact offset.
- An envelope through RMS makes the picture pulse with the loudness.
- The ghost value equals the value sent to the picture.
- With nothing modulated, the picture is pixel-identical to today.

## Open questions for Argi (with my recommendation)

1. **Which modules first?** Recommend Kaleidoscope + CRT Raster in phase 1,
   then the rest of the picture chain in one pass.
2. **What should the reader give per frame: mean, latest sample, or
   peak/RMS?** Recommend **mean over the frame**. It is physically the
   exposure of one frame and it can't alias. For "react to loudness", wire RMS
   or an envelope into the jack. A per-cable mode (Mean / Peak / RMS) can come
   later if he wants it built in.
3. **Make the worklet's point-sampled "latest value" capture write a mean
   for modulation sources?** Recommend **yes**. Without it, an LFO module that
   has no waveform face would still alias at fast rates.
4. **Move the hidden display scales (Kaleidoscope zoom ×0.05, rotate ×0.5,
   etc.) into real-unit definitions, with a patch migration?** Recommend
   **yes, as phase 4**. It is what "definitions are the only source of limits"
   asks for, and MOD across [min, max] then means something readable.
   Related: these are per-frame steps, so the feedback runs faster at 144 Hz
   than at 60 Hz. Converting them to per-second rates (× Δt) would make them
   frame-rate independent. I recommend doing both in the same pass.
5. **Should discrete parameters (Blend, Mirror, Mode, Segments, Pitch) be
   modulatable?** Recommend **yes**, quantized by the definition `step`.
   Segments and Pitch also get `constraint: "gpu"` for their loop limits.
6. **Should XY pads and face controls follow the modulated value or stay on
   the knob?** Recommend **stay on the knob plus a ghost span**, matching
   sliders and the "still unless a control changes" rule.
7. **Extra smoothing per parameter (`smoothingSeconds`), or never?**
   Recommend **support it, default off**. One frame of averaging is enough
   for most uses, and τ is there when he wants a lazier response.
