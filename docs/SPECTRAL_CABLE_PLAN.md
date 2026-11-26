# Spectral Cable Plan: explicit STFT in the patch

| Field | Value |
|-------|-------|
| **Author** | Misty (for Argi) |
| **Date** | 2026-11-26 |
| **Status** | Design only. Handoff for an outside coding AI. No code, build, commit or push has been done for this plan. |
| **Repo** | `C:\Users\argit\Documents\_PROGRAMMING\soemdsp-sandbox` |
| **Related** | `docs/SPECTRAL_CLOUD_FIX_PLAN.md`, `docs/SPECTRAL_WARBLE_FIX_PLAN.md`, `docs/SPECTRAL_SMEAR_FIX_PLAN.md`, `docs/SPECTRAL_PRISM_PLAN.md`, `docs/PORT_TYPES.md`, `docs/APP_POLICY.md` (§2, §10b, §13 CMYK plane, §17, §18, §22, §23, §25), `docs/SPECTRUM_1D.md` |
| **Line numbers** | From the working tree on 2026-11-26. That tree has uncommitted edits in `spectral_stft_engine.h`, `graph_engine.cpp` and the three spectral modules, so numbers will drift. Each reference also names the function, so search for the name. |

Shorthand: **G** = `native_modules/graph_engine/graph_engine.cpp`, **E** = `native_modules/spectral_blur/spectral_stft_engine.h`, **W** = `public/node-live-audio-worklet-native-graph.js`, **PT** = `public/node-graph-port-types.js`, **PG** = `public/node-graph-port-geometry.js`, **JC** = `public/node-graph-jack-chrome.js`, **MS** = `public/node-graph-module-store.js`, **D** = `public/node-graph-module-definitions.js`.

---

## 1. The idea

Today every spectral module does its own STFT: it analyses audio, edits the spectrum, resynthesises, and charges a full FFT-size delay. Three spectral modules in a row cost three analyses, three resyntheses and three delays. Each spectral face then does a fourth FFT in JS just to draw (`public/modules/spectralDisplay/spectral-display-worklet.js:7-12, 31`: a 2048-point analysis 30 times a second of the module's own output).

Make the STFT explicit, the way Additive is explicit:

| Additive (today) | Spectral (this plan) |
|---|---|
| **Additive Generator** builds a Yellow Graph payload (`process_additive_generator`, G:8727) | **STFT In** analyses audio into spectral frames |
| Yellow `Graph` cable, data plane, once per quantum (`kPortGraph = 23`, G:2725) | `Spectral` cable (thin iridescent glass tube, 2.5), data plane, 0 to k frames per quantum |
| Filters, Noisy*, Sync edit the payload in place after `yellow_graph_copy_in` (G:8949) | Cloud, Warble, Smear, Freeze, Delay, Warp, Gate, Contrast, Cross Synthesis, Blend, Prism, Vocoder edit frames in place |
| **Additive Out** renders audio (`process_additive_out`, G:9354) | **STFT Out** resynthesises audio |

The whole chain pays **one** STFT delay. Displays (spectral-display face, Spectrogram, Circular Spectrogram, 1D Spectrum) can tap a spectral cable and draw its bins **with no extra FFT**.

What exists today, for reference:
- All the STFT modules already share one convention: periodic Hann analysis and synthesis windows, overlap-add, unnormalised forward FFT, latency = FFT size N. Freeze, Delay, Warp and Cross Synthesis use hop N/4. Smear uses N/4. Cloud and Warble use N/8 (E:164). Gate and Contrast are fixed at 1024 / 256 (`stft_contrast/spectral_engine.h:7`). Because of this, a common frame format costs no sound change.
- Each module's FFT-size change already runs two cores and crossfades over 50 ms (E:457-519 `State`, `beginChange`). Section 3.5 reuses that pattern for the stream.
- The engine has no graph-wide latency compensation. Modules export `*_latency_for_handle` (for example `spectral_smear.cpp:46`), but nothing in G or JS reads it. Spectral Delay's own docs say "Plugin-host latency compensation is unverified".
- The **Vocoder** is an IIR filter bank (`vocoder/filter_bank_vocoder.h`), not an STFT module, so it stays an audio module. A frame-domain vocoder is a new kernel (section 9, phase 5).

---

## 2. The spectral cable format

### 2.1 Port type, jack and cable look

- **New strict port type `spectral`** in `NODE_GRAPH_PORT_TYPES` (PT:18-28) and in the type table of `docs/PORT_TYPES.md`.
  - It connects only to `spectral`. `nodeGraphPortTypesCompatible` (PT:152) needs no new exception, because the same-type rule already covers it.
  - A spectral↔audio attempt is refused with the existing wire-break animation (`nodeGraphWireEndpointsDimensionMismatch`, PG).
  - It is a data-plane port, like `Graph`: list it in `dataInputs` / `dataOutputs` and in `portTypes`.
- **Cable look: decided (Argi, 2026-11-26).** The spectral cable is a thin **iridescent oil-slick glass tube** (section 2.5). It is the only cable with this style.
- **Colour:**
  - The base colour comes from the IN jack, the app rule.
  - The spectral jack's colour is the reserved CMYK M: `--node-jack-magenta` `#e040fb` (JC:187-191), which is already tunable as UIDEV "Jack Magenta" (`nodeUiDevJackMagenta`, `node-graph-ui-settings-definitions.js:164`). This fits the Additive C + Y family.
  - Route it through one place: a `spectral` → `"magenta"` branch in `nodeGraphPortWireColor` (PG, next to the yellow Graph branch at PG:912) and in the channel resolver (JC:404-408). No module hard-codes the colour.
  - How strongly that colour tints the glass is a UIDEV setting (2.5). Its default is low, so the cable reads like the concept image.
- **Jack shape: round**, like the yellow Graph jack. Square stays for note bus, code and setup.
- **Port name `Spectral`** on both sides, with the visible jack label "Spectral". A two-input module types its two jacks as `spectral` through `portTypes`, for example `Voice` and `Synth` on Cross Synthesis, or `A` and `B` on Blend.
- **Wire colour comes from the IN jack** (app rule, implemented in `node-graph-gl-graph.js:3154`: "the IN (destination) jack decides it").
  - A spectral cable always ends on a spectral inlet, so its base colour is the spectral jack colour along its whole length. The base is solid; the iridescent sheen (2.5) is the style's own texture, not a colour change from end to end.
  - `docs/PORT_TYPES.md:28` still says "Cable color is owned by the output jack". That line is stale against the code and the rule. Correct it in phase 1 (doc change only).

### 2.2 What one frame is

**Canonical form: complex bins, half spectrum, stereo.**

```text
SpectralFrame
  header                     (2.3)
  float re[2][bins]          bins = N/2 + 1   (DC .. Nyquist; channel 0 = Left, 1 = Right)
  float im[2][bins]          im[c][0] = im[c][bins-1] = 0
  float trueHz[2][bins]      optional, see 2.4 (present only when a consumer asked for it)
```

- **Complex, not magnitude/phase.**
  - The FFT produces complex numbers, and STFT Out consumes them.
  - Delay, Freeze, Cross Synthesis and the lobe moves in Cloud and Warble (E, the 4-tap move) all work on complex values.
  - Magnitude or phase is a cheap per-bin conversion inside a kernel that needs it. Storing polar would force a round trip on every module.
- **Always two channels.** STFT In follows the stereo routing rules (APP_POLICY §13, `soemdsp::routing::stereo_route`).
  - A single source fills both channels and sets the `monoSource` flag.
  - A kernel with no stereo behaviour may process channel 0 and copy it to channel 1 while the flag is set.
  - A kernel that creates width clears the flag, for example Cloud Stereo Spread, Warble fan or Prism.
- **Scale:** the same as today's Core (E `frame`): an unnormalised forward FFT of the Hann-windowed block. A full-scale sine centred on bin k reads `|X_k| = N/4`. Display taps convert to dBFS with that factor, and STFT Out applies the inverse transform and the synthesis-window gain `8 / (3 · overlap)` (E:165-166), computed rather than tabled.
- **Half spectrum on the cable.** Today's engine mirrors the conjugate half before the inverse FFT (E:413-415). STFT Out does that mirroring once. Nothing on the cable carries the redundant half.

### 2.3 Header: settings that flow downstream

```text
struct SpectralFrameHeader {
  uint32 streamId;       // FNV-1a hash of the STFT In node id (the existing fnv1aHash32 used by W)
  uint32 configSerial;   // increments whenever STFT In's N, hop or the sample rate changes
  int32  fftSize;        // N
  int32  overlap;        // 4 (Normal) or 8 (Smooth); hop = N / overlap
  uint8  window;         // 0 = periodic Hann (the only one now; the field exists so the format does not change later)
  uint8  flags;          // bit0 monoSource, bit1 trueHzValid, bit2 warmingStream (3.5), bit3 phaseEdited
  float  sampleRate;
  uint64 frameIndex;     // absolute hop index on the global frame grid (3.3)
  uint64 endSample;      // absolute engine sample index of the last input sample in this frame
  int16  blockOffset;    // endSample's position inside the current render quantum (0..127)
}
```

- **Downstream modules adopt the header.** When `configSerial` changes, a module re-initialises any per-bin state for the new N or hop, the same way a size change does today.
- **FFT Size and Hop move onto STFT In.**
  - In cable mode the module's own FFT Size row (and Smear's Hop row from the Smear plan) is **inactive**: striped, with the visible text "set by STFT In". This uses the generic inactive-parameter mechanism from the Smear plan §5.
  - In standalone mode (section 6) those rows work as they do today.
- **STFT In parameters:**
  - **FFT Size**: a choice, 512 to 16384, default 4096.
  - **Hop**: 2 choice buttons, Normal (N/4) or **Smooth (N/8, the default**, Argi 2026-11-26). Smooth is about double the analysis and synthesis CPU of Normal.
  - **Mix** is on STFT Out (section 4), not STFT In.
- **CPU badge, debug mode only** (Argi, 2026-11-26):
  - STFT In shows the existing `cpu` constraint badge, using the existing mechanism: `constraint: "cpu"` on the **Hop** and **FFT Size** parameter rows (as Additive Generator's Harmonics does, D:1789), rendered by `applyNodeGraphResourceConstraintMarks` (`public/node-graph-module-factories.js:874`). The face gets `resourceConstraints: ["cpu"]` on the definition.
  - The badges are visible only when the **G debug switch** is on (`renderNodeGraphKeyboardDebugToggle`, `public/node-graph-view-controls.js:1196-1222`: "G is the one debug switch") together with the CPU toggle (`constraintToggles.cpu`, `public/node-graph-state.js:207-209`). With debug off, nothing shows. This is the app's existing behaviour, with no new switch and no timer.
  - The same `constraint: "cpu"` marks go on the FFT Size row (and Smear's Hop row) of the dual-mode modules, because in standalone mode those rows cost CPU in the same way.
  - A measured per-module CPU number (a profiler per node) is not part of this plan. The badge marks which controls drive the cost. If Argi wants a live percentage, it is a separate engine-profiling task.
- **Limits come only from the definitions** (APP_POLICY §25).
  - STFT In's FFT Size is a choice whose `choiceIds` own the values.
  - The native setter accepts any power of two that the FFT tables support, and rejects anything else as a **safety** guard (buffer sizes and FFT validity), with a `// safety:` comment.
  - Overlap: any power of two ≥ 2 that divides N, as in the Smear plan §3.1.
  - No musical caps.

### 2.4 True-frequency (phase-vocoder) view

- **STFT In always emits absolute phase:** the raw FFT phase of each frame, referenced to the first sample of the window. This is the convention today's Core uses, and the only one STFT Out understands. So In→Out is a null.
- **STFT In optionally adds a true-frequency array** `trueHz[c][k]`, the instantaneous frequency of each bin, from the standard phase-vocoder difference:
  `trueHz = (k + princarg(Δφ − 2π·k·hop/N) · N / (2π·hop)) · sampleRate / N`
  - It is **computed only when a consumer asks for it.** At compile time a module whose definition declares `spectralNeedsTrueFrequency: true` (Warble, Warp, Prism) makes the upstream STFT In allocate and fill it.
  - No consumer means no array and no cost.
  - It is side data, not a mode and not a separate port, so there is no UI for it.
- **Phase-moving modules coexist through one rule: each module reads absolute phase and writes absolute phase.**
  - Its own phase accumulators are private state, advanced by `frameIndex`. Examples: Cloud's walk, Warble's lobe accumulators (`mvAcc`), Smear's live/smeared blend, Warp's remap.
  - So Cloud → Warble → Warp works like three modules in a row of audio, with no shared phase bookkeeping.
  - A module that changes phases or moves energy between bins sets `phaseEdited` and clears `trueHzValid`.
  - A later module that needs true frequency and finds it invalid recomputes it locally from its own previous input frame. That is one pass over the bins with no FFT; the module keeps one frame of history.
  - A module that only scales magnitudes keeps `trueHz` valid. Examples: Gate, Contrast, a gain-only Blend.
- **Frame gaps:** if `frameIndex` jumps (a stream switch or a reset), a phase-moving module restarts its accumulators from the incoming phases instead of integrating across the gap.

### 2.5 The spectral cable look: thin iridescent glass tube (decided, Argi 2026-11-26)

**Reference:** Argi's chosen concept is the bottom-middle tile of `/cursor/stores/user/grok-bot/agents/81901b32-0f3a-4d78-a814-f59686818bf9/assets/51ed5d2921e59921416999b41f2eb628a205a4380a87b41fb9415b86f0bcaf58.jpg` (in the Grok Bot chat, not in the repo). It shows:
- two thin, subtle bright edge strokes;
- an interior that is a soft gradient, strongest just inside the edges and fading to low alpha in the centre (a slightly hollow, translucent glass look);
- a faint iridescent sheen (pink / teal / gold / violet) shifting along the length.

**Argi's only change: the middle was too thick.** Keep the edge strokes as they are, and make the whole wire thin. Edge stroke width is therefore set in **screen pixels**, independent of the overall width, so thinning the tube never thins its edges.

**Scope:**
- Only spectral cables use this style. A cable is spectral when its **IN (destination) jack** resolves to port type `spectral` (`nodeGraphEndpointPortType`, PT:174).
- Every other cable is untouched. That includes the **param-wire dip** (`nodeGraphGlLinesRibbon(..., dip, dipWidth)` for `wire.param`, `node-graph-gl-graph.js:3694` and `:4928`): those calls and the dip settings stay exactly as they are. Spectral cables are never param wires, so they never dip.
- Both routings get the tube: ribbon, and the orthogonal "trace" routing. A trace-routed spectral cable is drawn through the same tube path along its orthogonal points instead of `nodeGraphGlLinesPolyline(..., "ortho")`.
- Selected spectral cables keep the tube profile. The usual selection colour `[0.95, 0.86, 0.45]` replaces the base colour, and the iridescence stays on.
- Room lighting applies as it does to every wire: the base colour goes through `nodeGraphGlGraphShadeRgba(rgba, light)` with `nodeGraphGlGraphWireLight(false)`.

**Rendering: the existing WebGL wire shader only, no Canvas2D.**
- Where: the line renderer `public/lib/visual/gl-line-renderer.js`. Ribbons are emitted by `nodeGraphGlLinesRibbon` (line 1523) as camera quads with `caps` 3 / 3.5 (line 1620), and shaded by the shared fragment shader `FS` (lines 186-293).
- Add a **`spectral` option to `nodeGraphGlLinesRibbon`**. With it, each vertex is emitted with a new caps code (**12 / 12.5**: top and bottom side) and two extra values:
  - its **arc length** from the cable's source end, in zoom-1 world px, accumulated over the polyline;
  - the signed across offset, as now.
  - The vertex shader treats caps 12 like caps 3 (same reach and camera maths), but passes the arc length through `vLocal.x` instead of zeroing it.
- Because the sheen depends on arc length, not vertex index, it stays continuous however the curve is split. **Adaptive resampling is untouched:** the curve tolerance in `nodeGraphGlGraphPushWire` (0.2 screen px live, 0.25 world px baked, `node-graph-gl-graph.js:3180-3186`) decides the points as for any wire. The tube needs no extra subdivision, unlike the dip, which colours per vertex.
- **Fragment profile for caps 12:**
  - `w` = tube half-width in screen px (overall width ÷ 2 × zoom).
  - `e` = edge stroke width in screen px (the setting, at any zoom).
  - `d` = distance from the centre line in screen px.
  - The **outer silhouette** uses the shared `coverageEdge(w, feather, d)`, the app edge with 4×4 supersampling, so the tube's outline is anti-aliased like every other wire.
  - **Edge strokes:** `edge = coverageEdge(e/2, feather, |d − (w − e/2)|)`. This is a thin bright band hugging each side.
  - **Interior:** `x = clamp(d / max(w − e, 1e-3), 0, 1)`, then `body = centerAlpha + (1 − centerAlpha) · innerAlpha · x^falloff`. A higher falloff keeps the glow closer to the edges and the middle more hollow. `innerAlpha` is fixed at 0.5 so the edge strokes stay the brightest thing on the cable.
  - **Colour:** `base = mix(glass, jackRgb, baseTint)`, where `glass = vec3(0.86, 0.90, 0.96)` (a pale neutral) and `jackRgb` is the shaded IN-jack colour.
  - **Sheen:** `t = arc / sheenLength + 0.15 · (d / w) + phase`. The oil-slick palette is a smooth cosine palette that passes pink → teal → gold → violet. `hueSpread` scales how much of it is visible: 0 is one tint, 1 is the whole cycle within one sheen length.
  - Result: `rgb = mix(base, palette(t · hueSpread), iridescence)`. The edges are lifted toward white by edge brightness (100% = colour, above lifts toward white, the same convention as UIDEV "wire dot lit light").
  - Alpha = silhouette coverage × max(edge, body) × the wire's alpha.
  - The existing ordered dither (`soemDitherRgb`) is applied so the low-alpha centre does not band.
- **Too small to be hollow:** when `w < e + 0.75` screen px (far zoomed out), the profile becomes a solid line of the edge colour and edge alpha, so the cable never vanishes or turns to mush. This is a rendering rule, not a parameter limit.
- **Pixelate on zoom (UIDEV `pixelateWiresOnZoom`, `node-graph-gl-graph.js:3517-3540`):**
  - When it is on, spectral cables are baked with the other cables. The bake draws through the same GL ribbon path, so the tube appears in the zoom-1 picture and pixelates above 2.5× like every wire.
  - Add the spectral flag and all ten spectral settings to the bake hash (`nodeGraphGlGraphWireBakeMix`, line 3635), so changing a setting re-bakes once on settle.
  - **With pixelate on, the shimmer is frozen** at the phase of the bake. Re-baking every frame would defeat the bake. The panel says so in visible text next to Shimmer speed.
  - A spectral cable being dragged (no patch slot) stays a live vector stroke on top, as today.
  - UIDEV `pixelateWireDotsOnZoom`, `wireDotShadows` and end-dot sizes are unchanged.
- **Shimmer animation (only when Shimmer speed ≠ 0, and pixelate off):**
  - `phase` advances by `speed × Δt / sheenLength`, with Δt taken from the timestamp of the **existing present callback** (`nodeGraphGlGraphPresentSoon`'s `requestAnimationFrame`, `node-graph-gl-graph.js:5380`).
  - While at least one spectral cable is on screen and the page is visible, the present asks for its next frame the way the sharpen tick does ("requestAnimationFrame only while it has work", line 4434). With speed 0 or no spectral cable visible, no frame is requested.
  - No `setInterval`, no `setTimeout` loop and no separate timer.
  - A positive speed flows from the source (OUT) end toward the IN end, the direction frames travel.

**UIDEV settings** (a new group "wires: spectral" right after the "wires" group in `public/node-graph-ui-settings-definitions.js:372-387`):
- Each setting is one entry in the definitions list (lines 219-234 show the pattern), so the existing **Reset Settings** button (`resetNodeUiDevSettingsButton`, `public/index.html:1224`, "Restore every UIDEV control to its declared default") restores factory defaults with no extra code.
- The sync code reads each value with the definition's own min and max. Do not copy literal ranges the way the dip sync does today (`node-graph-ui-settings-sync.js:1511`); that duplication stays as is for the dip and is not repeated here.
- On an input event, the value goes into `nodeGraphGlGraphState.spectralWire` and requests one present. Ranges are wide on purpose; Argi tunes them.

| Setting | id | Unit | Min / Max / Step | Default | Notes |
|---|---|---|---|---|---|
| Overall width | `nodeUiDevSpectralWireWidth` | world px (scales with zoom) | 1 / 24 / 0.01 | **5** | Thin: about 1.7× the default wire thickness (3), so the hollow still reads |
| Edge stroke width | `nodeUiDevSpectralWireEdgeWidth` | screen px (constant) | 0.25 / 4 / 0.01 | **1** | Each side. Unchanged when the width changes |
| Edge brightness | `nodeUiDevSpectralWireEdgeBrightness` | % | 0 / 300 / 1 | **160** | 100 = colour; above lifts toward white |
| Center alpha | `nodeUiDevSpectralWireCenterAlpha` | % | 0 / 100 / 1 | **10** | Opacity at the tube's centre line |
| Gradient falloff | `nodeUiDevSpectralWireFalloff` | exponent | 0.25 / 12 / 0.01 | **3** | Higher = glow hugs the edges, hollower middle |
| Iridescence amount | `nodeUiDevSpectralWireIridescence` | % | 0 / 100 / 1 | **55** | 0 = plain tinted glass |
| Hue spread | `nodeUiDevSpectralWireHueSpread` | % | 0 / 100 / 1 | **70** | Share of the pink/teal/gold/violet cycle shown per sheen length |
| Sheen length | `nodeUiDevSpectralWireSheenLength` | world px | 10 / 2000 / 1 | **180** | One palette pass along the cable. Added so hue spread and the size of the colour bands are separate controls |
| Shimmer speed | `nodeUiDevSpectralWireShimmerSpeed` | world px/s | −400 / 400 / 1 | **0** | 0 = static. Positive flows OUT → IN. Frozen while pixelate-on-zoom is on |
| Base tint | `nodeUiDevSpectralWireBaseTint` | % | 0 / 100 / 1 | **30** | How much the IN-jack colour tints the glass |

The defaults reproduce the bottom-middle tile (pale glass, bright thin iridescent edges, hollow centre) at a thinner overall width.

**Phone check:**
- On a phone-sized viewport (390 × 844 CSS px, device pixel ratio 3) at the smallest workspace zoom and at zoom 0.5 and 1, a spectral cable between two modules must stay **visible**:
  - the 1-px edge strokes render at least 1 device px;
  - the collapsed-solid rule takes over below the hollow size;
  - its mean contrast against the workspace background stays above that of a normal audio cable at the default UIDEV settings.
- No hover is involved anywhere. The settings live in the UIDEV panel, which is already usable on a phone.

---

## 3. Graph scheduling

### 3.1 Frame rate inside a sample-rate engine

- The engine renders 128-sample quanta (`kMaxBlockFrames = 128`, G:2408), in a compiled topological order (`Circuit::order`, G:3131-3165; `soemdsp_graph_compile`).
- A hop is N/overlap. It ranges from 64 samples (N 512, Smooth) to 4096 (N 16384, Normal). So a quantum carries **0 to k frames**, with `k = ceil(128 / hop)`: 2 at most with today's sizes.
- **Each spectral output holds a small frame list for the current quantum:** `count` plus up to k frames, each with its `blockOffset`.
  - Capacity is derived from N and the overlap, not a fixed table.
  - The storage comes from the shared pool (`soemdsp/utility/memory_pool.h`, APP_POLICY §23). It is taken at create or at a size change and released at destroy. List the new types in `type_uses_pool` (G, around line 18197).
  - Do **not** add frame arrays to `struct Node` (G:2890). One 16384 stereo frame is about 131 KB, and every node would pay for it.

### 3.2 Who runs what, per quantum

| Module | Loop | Work |
|---|---|---|
| **STFT In** | per sample over the quantum | Writes the input ring (N per channel). At every sample where the global grid (3.3) says a hop ends, it windows, runs the FFT, writes a frame with that `blockOffset` and, if asked, `trueHz`. |
| **Spectral effect** (cable mode) | **per frame, no sample loop** | For each incoming frame: copy-in (3.4), read parameters at the frame's `blockOffset` (`control_audio(g, node, X, blockOffset)`, the same as today's frame-boundary use), run the kernel, then publish. |
| **Display tap** | per frame, read only | Points at the upstream frame and copies nothing (section 5). |
| **STFT Out** | per sample over the quantum | When the sample index reaches a frame's `blockOffset`, it runs the inverse FFT and adds the grain to the OLA ring starting at the next sample (exactly as E `tick` does: wet is read before the frame is added). It then outputs that sample. |

- **Causality holds.** A frame stamped at offset o depends only on input up to o, and every node in the chain runs before STFT Out in the same quantum (topological order). So STFT Out always has the frame in time, and output(t) = input(t − N) exactly. That is today's latency, and it does not grow with chain length.
- **Cost win:**
  - Effects in cable mode drop their per-sample loop entirely. Today `process_stft_dynamics` (G:16411) calls 4-6 setters plus `*_sample` for every sample.
  - Parameter reads go from 128 per quantum to 1 per frame.

### 3.3 One global frame grid

- A frame ends at an absolute engine sample `t` when `(t + 1) % hop == 0`. The engine sample counter is shared by the whole circuit.
- So every STFT In with the same N and overlap produces frames on the **same samples**, whenever it was added. Two streams with equal settings are always aligned, and no alignment logic is needed in two-input modules.
- When the counter resets (transport reset or sample-rate change), all streams reset together.

### 3.4 Copy-in, in-place edit, fan-out

- **Copy-in, like Yellow Graph** (`yellow_graph_copy_in`, G:8949, which copies the whole payload):
  - Each spectral effect owns its output frame list. It copies the upstream frame in, then edits it in place.
  - This makes fan-out safe: one STFT In can feed Cloud and Freeze, and Cloud's edits never reach Freeze.
  - Cost: about 32 × sampleRate bytes per second per node (1.5 MB/s at 48 kHz). That figure does not depend on N and is negligible next to an FFT.
- **Optional optimisation (phase 3+, measured first):** when an upstream output has exactly one consumer, the consumer may take the buffer instead of copying. The engine knows fan-out at compile time. Do this only if profiling shows the copy matters.
- **Lookup:** add `find_spectral_src_index(g, dstHash, port)` next to `find_graph_src_index` (G:8596). Two-input modules ask for two ports.
- **Port ids:** add `kPortSpectral` and `kPortSpectralB` as the next free native port ids (25 and 26 at the time of writing; `kPortPhaseCv = 24` is the last, G:2726). Add the matching `NATIVE_GRAPH_PORT_SPECTRAL*` in W (next to `NATIVE_GRAPH_PORT_GRAPH = 23`, W:408) and the name→port mapping beside the `graph` case (W:1162, W:1769).

### 3.5 Changing STFT In's FFT Size or Hop without a click

This reuses today's two-core pattern (E `State`: `cores[2]`, `warm`, smoothstep `fade` over 50 ms), lifted to the stream:

1. STFT In starts a **warming stream** with the new settings. During the transition it emits both streams; frames of the new one carry `warmingStream`.
2. Every spectral effect keeps **two state slots** (as each module's `State` already does) and runs the warming stream through the second slot.
   - At a hop-only change with the same N, the effect copies its per-bin state into the new slot verbatim, so the crossfaded signals are coherent (Smear plan §3.1).
   - At an N change, it remaps the state the way `beginChange` does today (E:478-491).
3. STFT Out synthesises both. After the warm-up (N samples), it crossfades from old to new over 50 ms, then drops the old stream (`configSerial` advances).
4. Latency moves from N_old to N_new at the end of the crossfade, the same as a size change today. The latency readout (section 4) updates on that event.

A change queued during a crossfade waits, the same as today.

### 3.6 Feedback loops

- **A spectral cable inside a feedback group is refused** in this plan (G builds `fbGroup*` from strongly connected components). The connect is rejected with the wire-break animation, and the jack shows the visible text "Spectral loop: go through STFT Out and STFT In".
- A loop through audio (STFT Out → … → STFT In) is allowed. It costs one hop of delay per lap, plus N, which is honest.
- Spectral Delay's internal feedback is unaffected, because it is inside one module.

### 3.7 Worklet and edit continuity

- **Frames never cross into JS.** JS only sees read-only display views (section 5).
- Spectral cables are ordinary edges for compile and order.
  - The in-place wire path (`soemdsp_graph_connect_live` / `soemdsp_graph_disconnect`, APP_POLICY §22) handles them. Adding or removing an effect in a chain must not reset any other module's state.
  - Removing a module from between STFT In and STFT Out leaves the downstream modules' state intact. Their next frame simply comes from a new source.
  - If the new source has a different `streamId` and phase-moving modules see a gap, they apply the frame-gap rule in 2.4.

---

## 4. Latency reporting

- **One delay per In/Out pair:** an STFT In → (any number of effects) → STFT Out chain has latency exactly N. Effects add 0 samples, because they process the frame in the frame.
  - Exception: **Spectral Delay** adds its musical delay on purpose. That is the effect, not latency, and it is not reported.
- **New engine export** `soemdsp_graph_latency_samples(handle)`: the largest sum of module latencies along any audio path into the Output module.
  - An STFT Out reports the N of the stream it is synthesising.
  - A standalone spectral module reports its own N.
  - Everything else reports 0. Modules with fixed internal latency can opt in later through the same hook.
  - Compute it at compile time and on `configSerial` changes (an event), not per quantum.
- **Visible readout:** STFT Out's face shows "Latency 4096 smp · 85.3 ms" in plain text. That text updates on the configSerial event. No hover tooltip.
- **Dry/wet matching:**
  - **Inside the chain, a module's Mix blends its input frame with its output frame** (a complex lerp per bin). This is exact, because both are on the same frame grid, and it needs no delay matching.
    - Note: Mix is then read once per frame instead of per sample. Static settings match standalone exactly; fast Mix modulation is smoothed by the overlap-add.
  - **STFT Out has a Mix:** "dry" is the paired STFT In's input ring read at delay N, located through `streamId`. It is sample-exact, so it needs no extra cable and no extra delay module. For a two-stream chain, dry comes from the primary (first) input's STFT In.
  - Parallel audio paths outside a spectral chain are not auto-compensated. The app has no graph PDC, and this plan does not add one. The readout tells the user the number.
- **Plugin host:** the plugin shell (`soemdsp-sandbox-plugins`, `docs/PLUGIN_REPO_PLAN.md`) should report `soemdsp_graph_latency_samples` to the host as the plugin's latency. That work lives in the plugin repo and is listed as phase 6. This plan only provides the number and its change event.

---

## 5. Display taps (free)

- **Spectrogram, Circular Spectrogram and 1D Spectrum get a `Spectral` input jack** next to their audio `In`.
  - When it is wired, the display reads frames from the cable, and its own FFT Size, window and "Bass detail" rows become inactive (striped, "set by STFT In").
  - Resolution is the stream's N.
  - The audio `In` / `Thru` path keeps working when the spectral jack is not wired.
- **The spectral-display face of every spectral module** (Cloud, Warble, Smear, Freeze, Delay, Warp, Cross Synthesis) reads that module's own output frame (lane A) and input frame (lane B). This replaces the JS re-analysis in `spectral-display-worklet.js` (`SPECTRAL_DISPLAY_SOURCES` lanes, lines 20-32).
  - It works in cable mode and in standalone mode, because standalone modules also produce frames internally.
  - Delete the JS re-analysis path for those modules once they read frames, so the code does not keep two paths (§10b).
- **How:** a native tap export in the style of the existing STFT Gate / Contrast taps (`soemdsp_stft_gate_display_power`, `_display_bins`, `_display_frames`, which are already read by `spectral-display-worklet.js`).
  - The new export is `soemdsp_graph_spectral_tap(handle, nodeHash, port)`. It returns a pointer into wasm memory: header plus `re`/`im`.
  - The worklet wraps it in `Float32Array` views (no copy) and computes dB per display point.
  - It posts only when `frameIndex` changed since its last post, using the existing `SpectralMeta` serial. So **faces move only when a new frame exists**: events, not timers. No `setInterval` and no polling loop is added.
- **Cost:** no FFT anywhere for a tap. Test C3 counts FFTs.

---

## 6. Standalone audio-in/audio-out versions

Every existing spectral module must keep working with audio jacks, and old patches must load unchanged.

| Option | What it means | Duplicate code |
|---|---|---|
| A. Wrapper types | Keep `spectralSmear` (audio) and add `spectralSmearFrames` (cable), both calling one kernel | Two definitions, two catalog entries, two parameter lists and two docs per effect, which must be kept in sync forever |
| **B. Dual-mode ports (recommended)** | One module type with its audio jacks (M/L/R In and Out) **and** one `Spectral` in plus one `Spectral` out. Wiring decides the path. | One definition, one type id, one kernel, one doc |

**Recommendation: B, dual-mode ports, built on one kernel per effect and one shared analysis/synthesis pair.**

- **Native structure (phase 0):** split E into three parts.
  - `stft_analysis.h`: the input ring, window, forward FFT and frame writer. Used by STFT In and by every module's audio input side.
  - `stft_synthesis.h`: the mirror, inverse FFT, synthesis window and OLA ring. Used by STFT Out and by every module's audio output side.
  - One `process_frame(Kernel&, SpectralFrame&, const Params&)` per effect: Cloud, Warble and Smear first, the others in later phases.
  - The existing two-core `State` becomes the generic two-slot holder from 3.5.
- **Per node, the path is chosen once per block from wiring.** That is a flag read per node per block, which §22's cost model says is fine.

| Spectral in wired? | Spectral out wired? | Path |
|---|---|---|
| no | no | audio → own analysis → kernel → own synthesis → audio (today's behaviour; latency N) |
| yes | yes | frames → kernel → frames (latency 0 added) |
| yes | no | frames → kernel → own synthesis → audio (acts as the chain's STFT Out) |
| no | yes | audio → own analysis → kernel → frames (acts as the chain's STFT In, with its own FFT Size) |

- **With the spectral input wired, the audio input jacks are ignored.** The face shows them striped with "Spectral input in use", rather than mixing two worlds.
- **Old patches load as they are:** same type ids, same audio jacks, same parameters. So no migration and no shim are needed (§1).
- **Nothing becomes dead code:** the module's own analysis and synthesis are the shared headers that STFT In and STFT Out also use. Delete the private copies in `freeze_engine.h`, `delay_engine.h`, `spectral_warp.cpp`, `spectral_cross_synthesis.cpp` and `stft_contrast/spectral_engine.h` as each module moves onto the shared pair (§10b).
- **Phone:** dual mode adds two jacks per module, not a second module in the browser. The catalog does not double.

---

## 7. Mismatch rules (two streams meet)

- **A stream's signature** is `(fftSize, overlap, window, sampleRate)`. Thanks to the global grid (3.3), equal signatures are always frame-aligned.
- **Two inputs with equal signatures:** the module processes them normally. Different `streamId`s are fine; Cross Synthesis exists to combine two different sources.
- **Unequal signatures put the module in the mismatch state.** No resampling and no re-analysis happen silently.
  - The face shows a **visible text badge**, for example "Mismatch: Voice 4096 / Normal · Synth 2048 / Smooth". The second inlet's jack ring is striped. No hover is needed, so it works on a phone.
  - **Output in mismatch: the primary (first) input passes through unchanged** (the module behaves as bypassed), so a live performance does not drop out (decided, Argi 2026-11-26).
  - The status is exported (`soemdsp_graph_node_spectral_status` = ok / mismatch / loop) and read by the face on change events.
  - It clears on the first frame after the signatures match, with no click.
- **Fixing it is explicit:** set both STFT Ins to the same settings, or go back to audio (STFT Out) and re-analyse (STFT In) at the other settings. That path is visible in the patch and pays its own latency.
- **During an FFT-size crossfade (3.5)**, the warming stream is matched against the other input's warming or active stream with the same signature. A transient mismatch during someone else's 50 ms crossfade is not flagged.

---

## 8. Module browser category: 🌊 Spectral

### 8.1 How categories work today

- Departments are one list in MS:246-279 (`nodeGraphModuleStoreDepartments`), with fields `{ id, emoji, label, defaultModule, symbol, title, pitch, listed }`.
  - `nodeGraphModuleStoreDepartmentById` and `nodeGraphModuleStoreDepartmentIds` (MS:281-292) derive from it.
  - Settings persistence validates against the id set.
  - Old category names resolve through `nodeGraphModuleStoreDepartmentAliasToId` (MS:295-).
- Each catalog entry has `category` and an optional per-module `browserEmoji`, which overrides the department emoji on the card (MS:5215).
  - Today 🌊 is only a `browserEmoji`, spread over three departments:
    - **Space:** Spectral Freeze, Cross-Synthesis, Shift/Warp, Smear, Delay, Blur, Warble, STFT Blur, plus non-STFT Dispersion, Material Resonator, Early Reflection Convolution, Convolution Resonator and Noise Convolution Reverb.
    - **Dynamics:** STFT Contrast, STFT Gate.
    - **Multimeter:** Spectrogram, Circular Spectrogram.
  - There are also FFT Reconstruction (Sample Player, under construction) and 1D Spectrum (📟).
- **Search** (`nodeGraphModuleStoreSearchRank`, MS:4689-4749):
  - It ranks the label, type and `notes`.
  - At rank −30 it matches the department label, id and **department emoji**.
  - `nodeGraphModuleStoreDepartmentMatchesSearch` (MS:4758) matches department id, emoji and label.
  - A per-module `browserEmoji` is **not** searched, so typing 🌊 today finds nothing by emoji.
- `defaultModule` can be a list. Additive uses `["additiveGenerator", "additiveOut"]` (MS:252), and `nodeGraphModuleStoreDepartmentDefaultModules` (MS:4603) spawns them from the category row.

### 8.2 The new department

Insert after `additive`, its sibling non-realtime plane:

```js
{ id: "spectral", emoji: "🌊", label: "Spectral", defaultModule: ["stftIn", "stftOut"], symbol: "STFT", title: "Spectral",
  pitch: "Frequency-domain tools: STFT In turns sound into spectral frames, effects edit the frames, STFT Out turns them back into sound. One delay for the whole chain." },
```

- **The department emoji is 🌊**, as Argi wants. Tapping the row's default spawns STFT In and STFT Out as a pair, the same as Additive's Generator + Out. On a phone that is one tap to a working chain.
- **Modules that move into Spectral** (change `category: "spectral"` and delete their now-redundant `browserEmoji: "🌊"` line, §10b):
  - New: **STFT In**, **STFT Out**, **Blend** (two-stream mix/morph, phase 4), **Spectral Prism** (build it cable-native; its plan is already written).
  - From Space: Spectral Blur (renamed Spectral Cloud by the Cloud plan), Spectral Warble, Spectral Smear, Spectral Freeze, Spectral Delay, Spectral Shift / Warp, Spectral Cross-Synthesis.
  - From Dynamics: STFT Gate, STFT Contrast.
  - From Multimeter, the display taps (decided, Argi 2026-11-26): Spectrogram, Circular Spectrogram, 1D Spectrum. Each gets the spectral jack (section 5). 1D Spectrum's 📟 `browserEmoji` goes too, so it shows 🌊. Multimeter's `defaultModule` is `spectrogram` today, so change it to another member that stays there, for example `numberReadout`.
- **Modules that stay where they are:** Dispersion, Material Resonator, Early Reflection Convolution, Convolution Resonator, Noise Convolution Reverb (convolution and resonators, not frame effects); Vocoder (IIR filter bank, Analog Filter); Spectral Oscillator (an oscillator, not STFT); FFT Reconstruction (Sample Player, under construction).
  - **Remove their `browserEmoji: "🌊"`**, so that 🌊 means exactly "lives on the Spectral shelf". They then show their own shelf's emoji.
- **STFT Blur** (`stftBlur`, parked and hidden, MS:2199) overlaps Cloud and Smear. It is not moved. Flag it to the Architect for deletion as unused (§10b). This plan does not delete it.
- **Search:**
  - Typing **🌊** or **spectral** matches the department through the existing department-emoji and department-label rules, with no code change.
  - Add `"frequency domain"` and `"stft"` to each Spectral module's `notes` (most already have "STFT" and "spectral"), so the alternative names also find them.
  - Departments have no notes field, so do not add one; notes on the members are enough.
  - No alias entry is needed, because no saved patch stores a category.
- **Phone-friendly:**
  - The department row is the same chip as the others, and "Spectral" is a short label.
  - The pair spawn avoids hunting for two modules.
  - Card text is the existing visible description. No hover tooltips anywhere.
- **Name decided:** "🌊 Spectral" (Argi, 2026-11-26).

---

## 9. Coordination with the three fix plans

- **The cable comes after the three fix plans.** Recommended order: Warble → Cloud → Smear (per the order in those plans) → cable phase 0 → phases 1-6.
  - The fix plans repair the sound inside the shared engine E: Cloud's phase diffusion, Warble's lobe moves, Smear's live/smeared phase and level match.
  - Doing the cable first would mean refactoring DSP that is about to be rewritten, and the T15/T13 baselines would move twice.
  - Phase 0 is then a **pure refactor of the fixed engine**. The fix plans' tests become its bit-exact regression tests.
- **What the fix plans should keep in mind now (no change to their decisions):**
  - Keep each engine's per-frame work in one function that takes the frame and its parameters, separate from the ring, window, FFT and OLA. E `frame()` is already nearly that. This makes phase 0 mechanical.
  - Smear's **Hop (Normal/Smooth)** and every module's **FFT Size** stay module parameters in standalone mode. In cable mode they are inactive, and STFT In owns them (2.3).
  - Cloud and Warble assume overlap 8. STFT In defaults to Smooth (overlap 8), so by default they get what they expect. In cable mode they take the stream's overlap. Their formulas are already hop-derived (the per-hop walk variance and pole formulas in the plans), so this works at overlap 4 too.
    - A module may declare `spectralPreferredOverlap: 8`. If the stream is Normal, the face shows the hint "Smoother with STFT In Hop: Smooth" in plain text, and the module still runs.
  - Mono Bass, Seed and Stereo Spread are per-module parameters and do not move.
  - The hard-cap rule and the no-boost rule apply unchanged. The fix plans' T16 ("limits come from the definition") is extended to STFT In and STFT Out.
- **Shared file conflicts:** E, G (`process_stft_dynamics`, `type_uses_pool`, port ids), D, MS and W are touched by all four plans. Land the fix plans and run their full tests before phase 0 opens E.

---

## 10. Migration and phased rollout

No patch migration is needed in any phase: existing modules keep type ids, jacks and parameters (section 6).

| Phase | Scope | Done when |
|---|---|---|
| **0. Refactor** | Split E into `stft_analysis.h`, `stft_synthesis.h` and per-engine `process_frame`. Generic two-slot holder. No behaviour change. | The fix plans' tests and baselines pass bit-exact. |
| **1. Proof of concept** | `spectral` port type, magenta jack, the glass-tube cable style with its UIDEV group (2.5), `kPortSpectral(B)`, frame lists in the pool, global grid. **STFT In**, **STFT Out** (with Mix and latency readout). **Spectral Cloud** dual-mode. **1D Spectrum** spectral tap. The 🌊 Spectral department (all moves in 8.2). `docs/PORT_TYPES.md` updated (new type, magenta, the tube style, the IN-jack colour rule). `soemdsp_graph_latency_samples`. | C1, C2 (with Cloud), C3, C9, C10, C11, C13, C14, C15, C18, C19, C20. |
| **2. Shared-engine effects** | Warble and Smear dual-mode. The spectral-display face reads frames (standalone and cable), and the JS re-analysis is deleted for these modules. FFT Size / Hop crossfade on STFT In (3.5). | C2 with 3 effects, C5, C6, C7, C12. |
| **3. Own-engine effects** | Freeze, Delay, Warp, Gate, Contrast move onto the shared analysis/synthesis, with their private STFT code deleted. Gate and Contrast standalone stay at their fixed 1024; in cable mode they take the stream's N. | C7 for each. |
| **4. Two streams** | Cross Synthesis on `Voice`/`Synth` spectral jacks; new **Blend** module; mismatch state and badge. | C4, C8. |
| **5. New kernels and taps** | Spectral Prism (cable-native from the start, dual-mode), frame-domain Vocoder kernel, Spectrogram and Circular Spectrogram taps, true-frequency side data used by Warble and Warp. | C16 and each module's own plan tests. |
| **6. Plugin latency** | The plugin shell reports `soemdsp_graph_latency_samples` to hosts. This work is in the plugin repo. | A host's latency compensation lines an STFT chain up with a dry track (manual check in one DAW). |

**Why Cloud for the proof of concept and not Freeze:**
- After phase 0, Cloud's kernel is already extracted.
- It is the effect Argi cares most about.
- It is stereo-creating, so it exercises the `monoSource` flag.
- Freeze uses its own engine (`freeze_engine.h`) and an audio-rate capture gate, so it is a better phase-3 test of moving a private engine onto the shared pair.

---

## 11. Acceptance tests

Run these with `node scripts/test_spectral_cable.mjs` (new), plus the existing per-module scripts. All numbers are measured, not eyeballed.

| # | Test | Pass |
|---|---|---|
| C1 | **Null:** STFT In → STFT Out, for every N (512-16384), both overlaps, at 44.1 / 48 / 96 kHz. White noise, a sine sweep and an impulse train. | After N warm-up samples, `max |out[t] − in[t − N]| ≤ 1e-6` (float FFT). Mono and stereo sources. |
| C2 | **Chain latency:** In → 1, 3 and 8 effects at neutral settings → Out. | The impulse arrives at exactly sample N in all three. Cross-correlation peaks at N. `soemdsp_graph_latency_samples` = N in all three. |
| C3 | **Tap is free:** count forward FFTs with a debug-only counter export, and JS analyses with a counter in `public/lib/spectral-analysis.js`. Add 1, then 3 display taps to a running chain. | The native forward-FFT count per second is unchanged. JS analyses for the tapped displays = 0. |
| C4 | **Mismatch flagged:** two STFT Ins (4096 Normal / 2048 Smooth) into Cross Synthesis. | The status export = mismatch. The face badge text is present. Output = the primary input bypassed (null against that path ≤ 1e-6). No NaN. Matching the settings clears the status within one frame, and the switch passes the click criterion of C5. |
| C5 | **Size/hop change without a click:** a sustained saw plus plucks; toggle STFT In N and Hop 20 times at random moments, including during a crossfade. | No click: the high-passed (> 8 kHz) sample difference never exceeds 2× its steady-state maximum. 10 ms RMS stays within ±1 dB. The latency readout moves at the end of the crossfade. |
| C6 | **Fan-out isolation:** STFT In → Cloud → Out A and STFT In → Freeze → Out B, compared with each branch alone. | Each output is identical (≤ 1e-6) to its branch alone. One branch's edits never appear in the other. |
| C7 | **Standalone parity:** for each migrated module, audio-jack standalone vs In → module → Out at the same N, overlap, Seed and parameters (static Mix). | Outputs match within 1e-6 after warm-up. |
| C8 | **Global grid:** two STFT Ins with the same settings, added 1000 samples apart. | Their frames carry identical `endSample` / `frameIndex`. |
| C9 | **Spectral loop refused:** try to close a cycle with a spectral cable. | Connect refused with wire-break. Rest of the patch unaffected. The "Spectral loop" text is shown. |
| C10 | **Type and colour:** spectral → audio and audio → spectral are refused. A spectral cable's base colour is the IN (spectral) jack colour at both ends and along its length. | As stated. |
| C18 | **Tube style only on spectral cables:** a patch with audio, digital, yellow Graph, cyan, param (rail) and modulation cables plus two spectral cables (one ribbon, one trace-routed). Record the ribbon calls and vertex caps codes in the wire batch, with pixelate off and on. | Only the two spectral cables emit caps 12 / 12.5. All other cables emit exactly the vertices they emit today: the batch snapshot is byte-identical to a baseline without spectral cables, and param wires still get their dip. Changing any spectral UIDEV setting changes only spectral vertices and uniforms, and re-bakes once when pixelate is on. Reset Settings returns all ten to their defaults. |
| C19 | **Phone visibility:** viewport 390 × 844 CSS px, DPR 3; workspace zoom at its minimum, at 0.5 and at 1; default UIDEV. Screenshot-measure one spectral cable. | At every zoom the cable covers ≥ 1 device px across its whole length with no gaps. Its mean luminance contrast against the background is ≥ that of a default audio cable measured the same way. Below the hollow size it renders as a solid line (no dropout). |
| C20 | **Shimmer uses frame events only:** Shimmer speed 0, then 120; pixelate off, then on. | Speed 0: no frames requested while idle. Speed 120 with a spectral cable on screen: phase advances only in present callbacks; no `setInterval` / `setTimeout` in the diff. Pixelate on: the phase is frozen and no per-frame re-bake happens. Off-screen spectral cables request no frames. |
| C11 | **Latency export:** In → Out = N. Standalone module = N. Standalone → standalone in series = 2N. In → A → B → Out = N. | As stated. |
| C12 | **CPU:** In → Cloud → Warble → Smear → Out vs the three standalone modules in series at N 4096. | Cable chain ≤ 0.6× the standalone chain's cost. Effects show no per-sample work in a profile. |
| C13 | **Limits only from definitions:** raise STFT In's FFT Size choices and Out's Mix range in the definitions only. | The native side follows. No clamp outside the documented safety guards. Static check: no new musical clamp in the diff. |
| C14 | **Events, not timers:** count tap face redraws vs new frames over 10 s; grep the diff for `setInterval` / polling. | Redraws ≤ new frames, and 0 redraws while the input is silent and the frames are unchanged. No timers added. |
| C15 | **Edit continuity:** insert and remove an effect in the middle of a running chain. | The other modules' state continues (Cloud's walk does not restart; Freeze keeps its hold). No full compile (§22). |
| C17 | **STFT In defaults and CPU badge:** spawn STFT In; toggle the G debug switch and the CPU toggle. | Hop = Smooth and FFT Size = 4096 at spawn. The `cpu` badge on Hop and FFT Size is visible only while debug (G) and the CPU toggle are on, and gone when debug is off. |
| C16 | **True-frequency view:** a stationary sine between bins, with Warble requesting `trueHz`. | `trueHz` is within 0.01 bin of the true frequency. `trueHzValid` is cleared after a phase-moving module. No `trueHz` array exists when no consumer asks for it. |

---

## 12. Rules that apply to every line

- **Phone-friendly:** visible face text for all states (mismatch, loop, latency, "set by STFT In"). No hover `title` tooltips (APP_POLICY §12: no mouse-following tooltips). Docked tips are the `tooltip` strings, in real sentences. The jacks have the standard size.
- **Events, not timers:** latency readout, mismatch badge and tap redraws update on change events (configSerial, status change, new `frameIndex`).
- **Limits only from parameter definitions** (§25). The native side has safety guards only, each with a `// safety:` comment: power-of-two N in the FFT tables, an overlap that divides N, non-finite input reset (E `tick`), array bounds.
- **No boost:** In → Out is unity (C1). Kernels keep their own level-match rules from their plans. Blend uses equal-power or linear crossfade by its own parameter, never a hidden gain.
- **No shims, no dead code** (§1, §10b): dual-mode ports reuse the shared analysis/synthesis. Private STFT copies and the JS re-analysis path are deleted as each module migrates. No dual keys and no patch migration.
- **Cache tags:** bump the `?v=` tags in `public/index.html` and `public/perform.html` for every JS file a phase touches (as in the fix plans).

---

## 13. Decisions (Argi, 2026-11-26)

1. **Category name: "🌊 Spectral".**
2. **Cable colour and style: decided (2026-11-26).** The style is a thin iridescent oil-slick glass tube from the bottom-middle concept tile: the same thin bright edge strokes, a thinner overall wire, and a hollow translucent centre. Only spectral cables use it. The base colour comes from the IN jack (spectral jack = reserved CMYK M magenta, tunable as UIDEV Jack Magenta). Ten UIDEV settings, restored by Reset Settings, let Argi tune it (section 2.5, tests C18-C20).
3. **Mismatch:** pass the first input through unchanged and show the visible badge (section 7).
4. **STFT In Hop defaults to Smooth (N/8).** STFT In shows the existing `cpu` badge (on its Hop and FFT Size rows), visible only in debug mode via the G switch (section 2.3, test C17).
5. **Spectrogram, Circular Spectrogram and 1D Spectrum move into 🌊 Spectral** and get the spectral jack (sections 5 and 8.2).

There are no open questions.
