# Brightness/Contrast and Lens Distortion — plan

Status: **plan only, not built.** Asked for by Argi on 2026-11-24: add
brightness/contrast to the shader plans; for Screen Glass, "fringe distortion
so the edges get more distorted," possibly as its own module; is that called
Fresnel distortion?

Written by Badger from a read of the current `master` tree: Screen Glass
(`screenBend`), Aberration, Chroma Color, Place, Kaleidoscope,
`docs/SHADER_MODULATION_PLAN.md`, `public/node-graph-picture-params.js`, and
the relevant rules in `docs/APP_POLICY.md`.

Related: `docs/SHADER_MODULATION_PLAN.md` (the shared reader is now in the
tree), `docs/ADDING_HARDCODED_SANDBOX_MODULE.md` (these are picture modules,
not C++ DSP).

## Naming: this is not Fresnel

Fresnel is reflections and sheen getting stronger at glancing angles. It
brightens or reflects at the rim; it does not bend the picture. Screen Glass
already has that kind of look as **Glare** (a placed soft spot plus a faint
sheen along the glass rim).

Warping that gets stronger toward the edges is **radial lens distortion**:
barrel when it bulges outward, pincushion when it pinches inward. The usual
model is Brown-Conrady, \(r' = r\,(1 + k_1 r^2 + k_2 r^4)\). A colour split
that also grows toward the edges is **lateral chromatic aberration**
(fringing). That is a different effect from the existing Aberration module,
which shifts whole colour plates by a constant offset.

## What already covers part of this

### Chroma Color already has Lightness and Contrast

Chroma Color (`chromaColor`) is the all-in-one colour module. It already has:

- **Lightness** (−1…+1): positive mixes the picture toward white, negative
  scales it toward black. It is not exposure in stops.
- **Contrast** (−1…+1): \((c - 0.5) \times m + 0.5\), with mid grey locked at
  0.5. At +1, \(m = 3\); at −1, \(m = 0\) (flat mid grey).
- **Gamma**, RGB gains, hue, saturation, tint, invert, and a final
  `clamp(col, 0, 1)`.

The math runs directly on the stored 8-bit texture values. There is no
sRGB decode, no linear light, and no movable pivot.

A dedicated Brightness/Contrast module is still worth adding if it is a
small, physically meaningful tool (exposure in stops, contrast around a
chosen pivot, an explicit colour-space choice). It is not worth adding if
it would only repeat those two Chroma Color knobs. That is an open question
below.

### Screen Glass already bows the picture

Screen Glass (type id `screenBend`) is "a picture seen through curved
glass." **Width** and **Height** already bow it, independently on each axis:

```
q.x *= 1.0 + uWidth  * 0.42 * p.y * p.y;
q.y *= 1.0 + uHeight * 0.42 * p.x * p.x;
```

Positive is an outer CRT barrel, negative is an inner pincushion. The warp
is already stronger toward the edges (the \(y^2\) / \(x^2\) terms). The 0.42
scale is hardcoded in the shader so a full knob throw stays strong without
folding the picture over itself. The centre is always the frame centre.
The radius is not aspect-corrected, so the bow is not a circular lens on a
wide frame. There is no higher-order term, no "keep the centre clean /
emphasise the edge" control, and no chromatic fringing.

Out-of-range samples fade to black (a soft `smoothstep` inside the frame,
then the squircle mask). Textures use `LINEAR` and `CLAMP_TO_EDGE`.

The rest of the module is the glass itself: Roundness (squircle edge),
Vignette (Reach, Curve, Shape), Glare (position and size), and a rim
Shadow. That face is already long.

### Aberration already splits colour, but not as edge fringing

Aberration splits the picture into three plates (RGB or CMY), then gives
each plate a uniform X/Y offset (at most 12% of the face, scaled by
Range), a brightness, and a small Gaussian blur. Blend is Additive or
Over. Samples that leave the frame are clamped to the edge.

It cannot make a fringe that is quiet in the centre and stronger at the
edges. A radial, per-channel scale in a lens module is a different effect
and can sit beside Aberration, not replace it. The lens module should not
grow Aberration's three XY pads.

### Place and the picture chain

Picture modules store 8-bit RGBA on the shared WebGL2 device and treat
those values as-is (no documented linearization). Place already uses
**stops** for Zoom (`exp2`, 0 is actual size, +1 is 2×). Pixels that leave
the Place frame are black. New modules should follow that chain: 📺 in /
📺 out, `visualSink`, LayoutA, the usual `*-register.js` / `*-display.js` /
`*-gl.js` / `*-ui.js` set, and `nodeGraphPictureParam` for every knob.

## Shared rules for both modules

- Parameter definitions are the only source of limits. Units live in the
  definition (`unit`, `min`, `max`, `mid`, tooltip). No hardcoded scales
  in the display or the shader the way Screen Glass still multiplies bow
  by 0.42.
- Every parameter is readable through `nodeGraphPictureParam` (knob plus
  the per-frame mean of each MOD cable, folded and bounded by the
  definition). Discrete choices snap to `step`. `constraint: "gpu"` only
  if a value is a real GPU loop limit; these modules should not need it.
- `frameSmoothingSeconds` stays unset (off) unless a parameter turns out
  to need it.
- Fill in definition `tooltip` fields. No hover pop-ups (`title` / mouse
  followers), per APP_POLICY §12.
- Displays are WebGL2, same present path as the other picture faces.
  No C++ / `library/include/soemdsp` work.
- No legacy helpers, dual keys, or silent remaps.
- Follow the existing picture-module spawn (8 gu wide, 6 gu display), not
  the generic "new DSP module is 7 gu" default.

---

## 1. Brightness/Contrast

A small picture module. Working name **Brightness Contrast**, type id
`brightnessContrast`. 📺 in, 📺 out.

### Controls

| Key | Label | Range | Default | Unit | Notes |
|---|---|---|---|---|---|
| `exposure` | Exposure | −4…+4, mid 0, bipolar | 0 | st | Multiply by \(2^{E}\) in the chosen space. 0 leaves the picture. +1 is one stop brighter (2×), −1 is one stop darker (½). Same idea as Place Zoom. |
| `contrast` | Contrast | −1…+1, mid 0, bipolar | 0 | — | Around Pivot. 0 is unchanged. −1 is flat at the pivot. +1 is 4× (two stops) around the pivot: \(p + (c - p)\,4^{C}\) when \(C>0\), and a linear squeeze to flat when \(C<0\). |
| `pivot` | Pivot | 0…1, mid 0.5 | 0.5 | — | The grey Contrast is measured from. 0.5 is the middle of the stored range. In Linear, 0.18 is photographic 18% grey if someone wants it. |
| `space` | Space | Display / Linear, step 1 | Display | — | Choice. Modulated, it switches at the halfway point. |

Exposure in stops is the recommendation over an additive brightness
offset. An offset is not physically meaningful, and Lightness in Chroma
Color already covers "mix toward white / scale toward black."

### Colour space

The picture chain is 8-bit and does not linearize. Chroma Color's
Lightness, Contrast, and Gamma all run in that stored space.

- **Display:** operate on the stored values, same as Chroma Color. Default,
  so a patch that already uses Chroma Color Contrast will feel familiar,
  and modest moves will match what the rest of the chain does.
- **Linear:** treat stored values as sRGB, decode, apply Exposure and
  Contrast, encode. This is the honest space for exposure in stops. It
  will not match Chroma Color's Contrast on the same picture, and 8-bit
  decode/encode can band in shadows. Worth having as a choice; not the
  default unless Argi prefers it.

Do not invent a scene-referred pipeline only inside this one module.

### Edge cases

- The destination is still 8-bit. Values above 1 clip on write. Do not
  add a hidden tone map or a second clamp in the shader beyond what the
  framebuffer format already does. Say so in the Exposure tooltip.
- Contrast at −1: every pixel becomes the pivot colour.
- Pivot at 0: Contrast only scales, blacks stay black.
- No picture cable: black output, same as the other picture modules.
- No NaN/inf path to invent here beyond the usual `max(0, …)` before a
  gamma encode if Space is Linear.

---

## 2. Lens Distortion

### Option A — a separate module (recommended)

Working name **Lens Distortion**, type id `lensDistortion`. 📺 in, 📺 out.
A radial Brown-Conrady warp, with the centre free to move, the radius
aspect-corrected by default, and an optional fringe.

This is what Argi described: the centre can stay clean and the edges
warp more. It is not Fresnel, and it is not the same thing as Screen
Glass's CRT bow or Aberration's plate shift.

### Controls

| Key | Label | Range | Default | Unit | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | −1…+1, mid 0, bipolar | 0 | — | Overall radial warp. 0 is off. Positive is barrel (outward), negative is pincushion (inward). The definition range is the real range: at ±1 the corners are strongly bent, just short of folding over themselves. The tooltip says so. |
| `edge` | Edge | 0…1, mid 0.5 | 0 | — | Where the warp lives. 0 is a plain \(k_1 r^2\) term (bow starts as soon as you leave the centre). 1 pushes it into a \(k_2 r^4\) term, so the centre stays nearly straight and the edges take the bend. This is the "fringe distortion" control. |
| `centerX`, `centerY` | Center X / Y | −1…+1, mid 0, bipolar | 0 | — | Distortion centre. 0 is the middle of the frame. ±1 is the edge. Face these as an XY pad, same as Kaleidoscope's centre and Screen Glass's glare. The pad stays on the knob and shows the ghost. |
| `aspect` | Aspect | Auto / Stretch, step 1 | Auto | — | Auto uses the picture's width and height so a circle stays a circle. Stretch treats the UV square as-is (what Screen Glass does today). |
| `fill` | Fill | Black / Clamp / Mirror, step 1 | Black | — | What to do when a sample lands outside the picture. **Black** matches Place and Screen Glass (empty frame). **Clamp** holds the edge pixel (`CLAMP_TO_EDGE`). **Mirror** reflects (`MIRRORED_REPEAT`). |
| `fringe` | Fringe | −1…+1, mid 0, bipolar | 0 | — | Optional lateral CA: red and blue are sampled at slightly different radii from green, so the split grows toward the edges on its own. 0 is off. Positive and negative swap which side of green each channel goes. A single knob, not Aberration's three pads. |

Under the hood, Amount and Edge map onto \(k_1\) and \(k_2\) in a
dest-to-source lookup (the usual shader form: distort the sample
coordinates). Do not expose raw \(k_1\) / \(k_2\) on the face unless Argi
wants them.

### Sampling

Existing picture modules already sample with `LINEAR` filtering. Start
with that. A strong warp can alias at high-contrast edges; if that shows
up, a cheap 4-tap along the warp gradient can be added later. No quality
knob and no `constraint: "gpu"` unless a sample-count parameter appears.

### How this relates to Aberration

Leave Aberration alone. Fringe here is radial and edge-weighted.
Aberration is a uniform plate offset with blur and RGB/CMY blend modes.
They stack: Lens Distortion for a lens-like fringe, Aberration for a
creative split. If Fringe feels like a duplicate in practice, it can be
dropped from v1 (open question).

### Option B — add the same controls to Screen Glass

Add Amount, Edge, Centre, Aspect, Fill, and maybe Fringe to the existing
Screen Glass face, or retask Width / Height into this model.

Pros:

- Argi framed it as a Screen Glass need.
- One module for "the picture is seen through a curved screen."
- No extra catalog entry.

Cons:

- Screen Glass already bows the picture (Width / Height) and already has
  a long face (Roundness, four vignette knobs, glare, shadow). Adding a
  second, different distortion model on top of the CRT bow is confusing:
  two ways to bend the same picture, with different centres, aspect
  rules, and fill behaviour.
- The current bow is anisotropic (horizontal and vertical amounts are
  independent) and not circularly radial. Replacing it would change the
  look of existing patches. APP_POLICY §1 does not want a dual-key
  remap to keep those patches working.
- The glass metaphor (squircle, vignette, glare, rim shadow) and an
  optical lens model are different jobs. Keeping them separable means
  they can be stacked or used alone.

### Recommendation

**Build Lens Distortion as its own module (Option A).** Leave Screen
Glass's Width / Height bow, squircle, vignette, glare, and shadow as
they are. A patch that wants both looks can run Lens Distortion into
Screen Glass, or the other way around.

Do not change Screen Glass in this work unless Argi asks. If, after
using the new module, the CRT bow feels redundant, that can be a later
conversation — not a silent replacement.

---

## 3. Open questions

1. Is Brightness/Contrast a new module, or should Exposure, Contrast, and
   Pivot be added to Chroma Color, which already has Lightness and
   Contrast?
2. Is Exposure in stops (±4 st) the right brightness control, or do you
   want an additive offset as well or instead?
3. Should Space default to Display (as-stored, matches Chroma Color) or
   Linear (honest for stops)?
4. Confirm Lens Distortion as its own module, rather than adding these
   controls to Screen Glass?
5. Once Lens Distortion exists, should Screen Glass keep its Width /
   Height CRT bow as a separate, anisotropic bend?
6. Is Black the right default Fill (matches Place and Screen Glass), or
   would you rather default to Clamp?
7. Include Fringe (lateral CA) in v1, or leave colour splits to
   Aberration?
8. Are the names **Brightness Contrast** and **Lens Distortion** right,
   or would you rather **Exposure Contrast** / **Barrel Distortion**?
