# Display In / Display Out — plan

Status: **plan only, not built.** Asked for by Argi on 2026-11-24: modules
like Viewport In / Viewport Out, but they would affect only module
displays, not the whole circuit view. He also wants to see what happens
when shader displays are allowed to affect themselves, and asked whether
running Screen Glass and Chroma Color on every display would be heavy.

Written by Badger from a read of the current `master` tree:
`public/node-graph-screen-fx.js`, `public/node-graph-video-graph.js`,
`public/node-graph-gl-graph.js` (stack groups and display quads),
`public/lib/visual/picture-device.js`, `public/lib/visual/display-canvas.js`,
`public/node-graph-camera-keys.js`, `docs/VIDEO_GRAPH_PLAN.md`,
`docs/SHADER_MODULATION_PLAN.md`, `docs/DISPLAY_COMPOSITE_LAYERING_PLAN.md`,
and the relevant rules in `docs/APP_POLICY.md`.

Related: `docs/VIDEO_GRAPH_PLAN.md` (scheduler, cycles, pull-based culling),
`docs/SHADER_MODULATION_PLAN.md` (picture params),
`docs/SHADER_BRIGHTNESS_LENS_PLAN.md` (Screen Glass ranges),
`docs/ADDING_HARDCODED_SANDBOX_MODULE.md` (these are picture I/O modules,
not C++ DSP).

## What this is

**Display In** is a source: the module-display layer as a 📺 picture, one
frame behind. **Display Out** is a sink: its 📺 in replaces that layer in
the circuit composite. Plates, cables, cable-end dots, and the room
background stay untouched. Wire Display In through picture effects into
Display Out; a straight In-to-Out cable should change nothing.

They sit in the rgba category next to Viewport In / Viewport Out. Suggested
type ids: `displayIn` and `displayOut` (clearer than the historical
`viewOut` / `screenOut` names). They are not `uniqueInPatch`. More than one
of each works but is not controllable yet: every Display In publishes the
same layer, and the first Display Out (patch order) whose chain is fed is
the one used. Say so once in the debug error log, the same way Viewport
does today.

This is about **display tiles** (`.node-display-face`: scopes, plots,
shader previews, and every other module screen). It is not about parameter
faces (knobs, sliders, choice rows drawn as GL ink on the plate).

## What I found: faces are not their own canvas

The circuit view is three workspace canvases, composited back to front in
`nodeGraphScreenFxSources`:

1. `wireCanvas` — cables, plus the room-dark quad that sits under everything.
2. `g.canvas` — plates, chrome, parameter faces, **and** display screens.
3. `dotsCanvas` — cable-end dots (and veils).

There is no fourth "faces" canvas. Display tiles are image quads inside
the plates batch. `nodeGraphGlGraphStackGroups` draws each overlapping
group in this order: plate, chrome, parameter face, display pictures,
display ink (frame and labels), then the next group on top. Consecutive
modules that do not overlap share a group. That is how a module on top of
another can cover the lower module's screen.

A displays-only present (`nodeGraphGlGraphPresentDisplaysOnly`) replays
that whole plates batch, not the quads alone, because they share a canvas.

**Effort is medium, not small**, and the reason is this mixing. Adding a
visible fourth workspace canvas and stacking it over or under the plates
would break overlap: every display would float above every plate, or sit
under its own plate. The work is an **offscreen** faces texture plus a
hook so each stack group samples that texture when it draws its display
quads. Z-order stays the same as today.

## How Viewport In / Out work today (the pattern to copy)

Each frame, `nodeGraphScreenFxRender`:

1. Runs Screen Space Shader picture effects, upstream first.
2. Composites the three workspace canvases into a **scene** texture
   (workspace background, then layers with premultiplied alpha).
3. **Screen:** if Viewport Out's chain is fed and peek is off, that
   picture replaces the circuit area; otherwise the plain scene is shown.
4. **Viewport In:** this frame's **scene** (not the final screen) is
   copied into a ping-pong pair and published for the **next** frame.

Two lessons are already written into that file and must be kept:

- Capture the raw layer, never the post-replacement picture. Using the
  final screen for Viewport In made In → Out a closed loop that never
  took in a new frame (frozen view).
- Every texture is double-buffered. Nothing is read and written in the
  same frame.

`nodeGraphScreenFxChainFed` walks the 📺 chain back to a live source.
Viewport Out ignores an unfed chain (it would only be black) and the
plain circuit stays on screen. Peek (hold **R**, not P — the screen-fx
header comment is stale; `node-graph-camera-keys.js` and the hotkeys row
agree on R) shows the plain scene while Viewport Out's chain keeps
running.

The video graph scheduler (`node-graph-video-graph.js`) runs 📺 nodes in
topological order each frame (0-frame hops). Edges inside a cycle read
the previous frame. Viewport Out is always a visible sink, even if its
own module is scrolled off screen, so the chain feeding it does not
freeze. Display Out must be the same kind of sink.

Picture effects already render at the size of the incoming picture (the
whole screen when fed by Viewport In), and the module face shows that
picture scaled down. A Display In chain is the same idea: the incoming
picture is the faces layer, screen-sized.

## Frame order

Display replacement happens **before** the scene composite, so Viewport
In sees already-processed displays, and Viewport Out can still wrap the
whole room (processed displays, plates, cables, and all).

Ideal order in one frame:

1. Video-graph nodes paint their raw face textures (including shader
   module previews of the current picture).
2. Composite those raw display quads into an offscreen **faces** texture
   (screen-sized, transparent where there is no display). This is the
   raw layer. Optionally omit picture-module tiles (see Include, below).
3. Publish last frame's faces texture from Display In (ping-pong, one
   frame behind). Draw this frame's raw faces into the other buffer.
4. Run the Display In → effects → Display Out chain (same scheduler,
   0-frame hops, cycles one frame late).
5. Draw stack groups as today, but display quads sample Display Out's
   picture with screen-space UVs when its chain is fed. Mask and ink
   rules below. If the chain is not fed, quads keep their raw face
   textures.
6. Composite wires, the plates canvas (now carrying processed displays),
   and dots into the scene.
7. Viewport Out may replace the scene. Viewport In publishes the scene,
   which includes the processed displays.

Today the video graph and screen-fx each have their own rAF, so Viewport
is already allowed a frame of slop. v1 can hook capture and replace into
the screen-fx tick and request a plates replay after the Display chain.
A later pass should drive paint, Display, scene, and Viewport from one
frame so Display Out is not an extra frame late.

## Self-feedback (shader displays affecting themselves)

Argi wants to see this. It is safe if and only if Display In captures
the **raw** faces texture, never the post-Display-Out result, and both
sides of the faces pair are double-buffered. The hall of mirrors is
then the same one-frame-delay loop already familiar from Viewport In →
Video Feedback → Viewport Out. It must not freeze, hang, or crash. A
feedback cycle in the 📺 graph already reads the previous frame.

**Include picture modules** is a switch on Display In. "Picture modules"
here means modules whose face is a preview of a 📺 picture they produce
or consume: the current video-graph types (Aberration, Analog Signal,
Analog Distortion, Bloom & Glow, Chroma Color, CRT Raster, fBm Field,
Image Burn, Kaleidoscope, Place, RGB Fractal, Screen Glass, Screen
Shake, Video Delay, Video Feedback), plus Screen Space Shader, Viewport
In / Out, and Display In / Out themselves if they grow a preview face.
Audio scopes, plots, sequencers, keyboards, and similar stays are
always in the layer.

- **On (recommended default):** those preview faces are in the capture,
  so they show the processed layer, which includes themselves. This is
  the recursive effect Argi asked to see.
- **Off:** those tiles are left out of the capture (transparent) and
  Display Out does not replace them. They keep showing their honest
  output. Use this when the hall of mirrors gets in the way.

Default is **on**, because he said he wants to see the self-feedback.
The switch is there so it is not a one-way door.

## Mask to tiles

**Mask to tiles** is a switch on Display Out, **default on**. When on,
the processed picture is only painted inside display rectangles, so a
warp, shake, or kaleidoscope cannot smear display content onto plates,
cables, or empty workspace.

Recommended clip: the **union of all display rectangles that were in
the capture**. Content may jump from one tile into a neighbour if the
warp carries it there. Pixels that leave every tile are discarded.
(Whether to clip each tile to itself only, with no neighbour spill, is
an open question.)

When the mask is off, the processed faces layer can spill around the
tiles. Stack-group order should still let an overlapping module's plate
cover a lower display, including any spill that would have landed on
that plate. Spill into empty workspace is visible. This mode is for
the effect; the default stays clipped.

Hit testing does not follow the warp. A click still hits the original
display rectangle.

## Cost: one screen-sized pass, never a per-display chain

It is not heavy if effects run **once over the whole faces layer**, the
same cost as running them on Viewport Out today. Chroma Color is
per-pixel colour math, so one pass over the layer looks identical to
running it on each display separately. The expensive route — a separate
shader chain per display — would multiply draws by the number of tiles
(40 displays means 40 times the work) and is out of scope.

**Per-pixel effects** (Chroma Color, and later Brightness/Contrast) need
no extra help.

**Edge- and position-based effects** are the catch. Screen Glass's
curvature, vignette and glare are based on the frame's edges. Place,
Kaleidoscope, Screen Shake, Aberration, and CRT Raster also treat the
incoming picture as one frame. Run once over the layer with no help,
and you get one big curved glass (or one kaleidoscope, one shake)
across all the displays. To give each display its own local frame in
that same pass, the shader needs a map of the tiles.

### Tile map

Rebuild when the camera or layout changes (the same times the GL mesh
rebuilds), not on every scope paint.

- A **tile-id texture**, same size as the faces layer: 0 = no display,
  1…N = which tile. A fragment looks up its id in O(1) and does not
  loop over rects.
- A small **rect table** (uniform array, or a 1-D texture of
  `vec4(x, y, w, h)` in layer UV) so the shader can turn a tile id into
  a local 0–1 UV, aspect-corrected if the effect needs it. A uniform
  array is enough for typical patches; fall back to a texture if a
  patch has an unusually large number of displays. The table is packed
  from `nodeGraphGlGraphState.displays` in screen space, the same rects
  used to draw the quads.

Picture modules in a Display chain opt in with a **Per Display**
switch. When on, the shader uses the tile map: local UV inside the
tile, out-of-tile samples empty (or the module's usual out-of-frame
behaviour). When off, the whole faces layer is one frame, which is
also what these modules do on a Viewport chain (the map is a single
full-frame tile, so the switch is a no-op there).

Recommend adding the switch in v1 at least to Screen Glass, Place,
Kaleidoscope, Screen Shake, Aberration, and CRT Raster. Default **on**
so a Display chain looks like "each screen has its own glass," which is
what Argi was reaching for. Confirm that default before building.

### Budget, on top of today's present

All of these are **one screen-sized cost**, not one cost per display:

| Step | Extra passes per frame |
| --- | --- |
| Draw display quads into the faces FBO | 1 (many quads, one target; can piggyback on the existing pics layer) |
| Ping-pong copy / swap for Display In | 1 blit, or a buffer swap with no extra fill |
| Each picture effect in the Display chain | 1 per module (same as Viewport; not added if the module is only in this chain) |
| Tile map | 1 when camera or layout changes, 0 on a displays-only replay |
| Replacement | **0** if the plates batch binds the processed texture on the existing quads; 1 only if a later mask composite is a separate pass |

Never a chain per display. If both a Display chain and a Viewport chain
are running, their effect passes add, because they are different module
instances.

Resolution matches the workspace canvases: device pixels at
`devicePixelRatio`, capped at 2× and 4096 a side
(`nodeGraphGlGraphDeviceScale`), the same cap screen-fx already uses.
Display In publishes that size; effects run at that size.

## Sleeping, Canvas, Perform, and peek

**Sleep / culling.** Offscreen modules are `viewport-asleep`, but their
plates keep a cached box. Display drawing already skips tiles that are
fully off the workspace (except during a camera-backed present). The
faces layer should include tiles that are on screen (or in the current
mesh), not every asleep display in the patch. When a display scrolls
into view it joins the layer. Display Out is always a visible video-graph
sink, like Viewport Out, so the chain keeps running even if the Display
Out module itself is off screen. Upstream picture modules already use
`nodeGraphVideoGraphShouldSleep` and will stay awake while a visible
sink (or Display Out) needs them.

**Canvas view, Perform, and screen solo.** Viewport In / Out only run on
`#nodeGraphWorkspace` while `gl-graph-on` is set. Canvas tiles, Perform,
and screen-solo face hosts are separate present paths
(`PresentTiles`, `PresentFaceHost`) and already have their own layering
and blend rules. v1 is **circuit workspace only**, same as Viewport.
Whether tiles in Canvas / Perform should get this later is an open
question.

**Peek (hold R).** Today it bypasses Viewport Out only: the plain scene
shows, and the Viewport chain keeps running. Options for Display Out
are in the questions below. Recommendation: R peeks **both** (raw
displays in a plain circuit) while both chains keep running, because
that is what "plain circuit view" means today. If we later want to peek
only the room and keep display effects, that can be a second gesture.

## Ink, holes, and what stays unprocessed

Display **ink** (the frame fade, the label strip) is drawn after the
picture quad today. It should stay that way: drawn after replacement,
unprocessed, so labels and frames stay sharp while the picture warps.
Jack holes punched in the display quad stay punched after replacement,
so a processed picture does not paint over a jack.

Parameter faces, plate chrome, rails, IO overlay, and dots are never in
the faces layer.

## Module shape and shared rules

- Category rgba. Layout like Viewport In / Out (small jack module).
  Display In parameters: **Include picture modules** (choice, default
  on). Display Out parameters: **Mask to tiles** (choice, default on).
  Fill definition tooltips; no hover pop-ups (`title` / mouse
  followers), APP_POLICY §12. No arrow cursors, §24; adjusting uses the
  shared mouse-dot cursor.
- Parameter definitions are the only source of limits. No legacy
  helpers, dual keys, or silent remaps (§1).
- Displays are WebGL2 through the shared picture device and
  `gl-line-renderer.js` (§3). No C++ / `library/include/soemdsp` work.
- Every picture knob in the chain still goes through
  `nodeGraphPictureParam`. Curves and axes on displays stay still
  unless a control changes; this feature must not make a scope rescale
  or jump just because the faces layer is being processed.
- `visualSink: true`. Display Out is a video-graph visible sink.

## Phases

### Phase 0 — Faces target and tile map (no new modules yet)

Offscreen faces texture, same size as the workspace canvases, built
from the same display-quad list as the plates batch, alpha 0 elsewhere.
Do not add a visible fourth canvas. Build the tile-id texture and rect
table on mesh / camera changes. Prove, without any effect chain, that
drawing stack groups from this texture (identity) matches today's
displays, including overlapping modules, jack holes, and ink on top.

### Phase 1 — Display In / Display Out, identity and Viewport order

Add the two modules. Display In publishes the raw faces layer, one
frame behind. Display Out, when its chain is fed, is the texture the
display quads sample. Unfed Out leaves the raw faces in place. Hook
this in before the scene composite so Viewport In sees processed
displays. Display Out is a visible sink. Duplicates log like Viewport.
Circuit workspace only. A straight In → Out cable is a visual no-op.

### Phase 2 — Include, mask, and self-feedback

Ship the two switches with the defaults above. Confirm: Include on
gives the one-frame hall of mirrors and never freezes; Include off
leaves picture-module faces honest; mask on clips warps to the tiles;
mask off can spill without breaking overlap z-order; offscreen tiles
join and leave the layer cleanly.

### Phase 3 — Per Display on spatial picture modules

Tile map available to shaders in a Display chain. Per Display switch
on Screen Glass, Place, Kaleidoscope, Screen Shake, Aberration, and
CRT Raster. One pass over the layer, local UV per tile. Measure the
budget on ArchIV (the VG plan's usual machine): added passes stay in
the table above, and a patch with many displays must not cost a chain
per tile.

### Phase 4 — Tests and peek polish

Smokes / probes for: In → Out identity; self-feedback does not freeze;
mask clips; Include off; Viewport In includes processed displays;
duplicates log; sleep / scroll-in; overlap z-order; device-pixel size
and the 4096 cap; peek behaviour once Argi picks it. Fix the stale
"hold P" comment in `node-graph-screen-fx.js` while touching that file.

## Open questions for Argi

1. Are the names **Display In** and **Display Out** right, or do you
   prefer Displays In / Out or Faces In / Out?
2. When you hold **R** to peek, should Display Out be bypassed too
   (plain raw circuit, recommended), or should peek only unwrap Viewport
   Out and leave the display effects on?
3. **Include picture modules** default on, so shader faces feed
   themselves — is that what you want shipped, with the switch there
   to turn it off?
4. With **Mask to tiles** on, may a warp spill from one display into a
   neighbouring display, or should each tile be clipped to itself only?
5. Should display ink (frame and labels) stay unprocessed on top
   (recommended)?
6. v1 is circuit workspace only, like Viewport. Do Canvas view,
   Perform, or screen solo need this later?
7. **Per Display** default on for Screen Glass and the other spatial
   modules — yes?
8. Is "first fed Display Out wins, plus a debug log" fine for
   duplicates, matching Viewport, or should these be unique in a patch?
