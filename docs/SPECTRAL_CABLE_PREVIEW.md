# Spectral Cable Visual Proof

Preview: `/public/demos/spectral-cable.html`.

This is a visual prototype, not an implementation of spectral transport.
It deliberately does not instantiate STFT modules, alter a saved patch,
or touch native DSP, the scheduler, Warble, Cloud or Smear.

## Included

- Hyperbolic Bright/Dim point distances now use CSS pixels, independent of
  cable width. Narrowing brings the two fixed profiles together rather than
  rescaling their decay. Previously saved normalized distances migrate once
  using the saved width and zoom, preserving their last appearance.
- Preview now opens in Pixel profile mode: 32 independent brightness bins,
  each one CSS screen pixel inward from either edge. It bypasses all curve,
  colour, floor and outer-skirt controls. The shared shader integrates pixel
  coverage directly. Width 64 and zoom 1 expose all bins; a straight reference
  strip and First pixel only preset isolate thickness from cable curvature.
  Disable Pixel profile to return to the hyperbolic experiment.
- Strict `spectral` port type; same-type connections only.
- Reserved magenta channel for explicitly spectral jacks and their wires.
  Ordinary round jack chrome applies. The destination owns the base colour.
- An empty **🌊 Spectral** browser department after Additive. No existing
  modules moved and no fake STFT In/Out modules were registered.
- The glass tube is an opt-in path of the existing shared WebGL renderer:
  `nodeGraphGlLinesRibbon(batch, points, half, feather, rgba, 0, .5, { spectral: true })`.
- Shared defaults exported as `nodeGraphSpectralWireDefaults`. Pass appearance
  through `nodeGraphGlLinesBegin(..., { spectralWire: settings })`.
- Caps 12/12.5 carry world arc length and signed across distance to the
  shared shader. Colour is computed in that shader, not per pixel in JS.
- A hyperbolic inward profile replaces the fixed-width solid wall and the
  trial Gaussian/exponential/long-tail curves. Two positions, measured inward
  from each outer edge, define the fade: Bright point (default 0%) and Dim
  point (default 100%, the centre). Crossed point edits keep them ordered.
- Between those points, coverage is `(1-t)/(1+bend*t)`. Bend 0 is linear;
  larger bends give a narrow bright rim and a dim tail. Bend defaults to 999
  (the reference decay's 1 to 0.001 ratio), with a logarithmic slider up to
  99999. Before this curve, Shape w applies the reference time warp
  `(exp(w*t)-1)/(exp(w)-1)`, with linear time at zero. Negative shape sharpens
  the initial drop; positive shape delays it. Default Shape w is -2.
  Floor alpha controls the dim point's opacity. Dim point above 100% permits
  the two edge tails to overlap across the centre.
- There is no mandatory full-bright inner plateau: Bright point 0 starts
  fading immediately at the edge. Both sides and outer coverage are sampled
  together 4x4, avoiding multiplication of separately filtered masks. The
  chrome edge curve is unchanged, but the spectral-only outer skirt is capped
  at 0.5 CSS px instead of the ribbon's 2 px. Dither is unchanged.
  Only tubes narrower than 1.5 CSS px
  collapse to a solid line for visibility; larger tubes keep the curve.
- Both curved and orthogonal preview routes, selection colour, appearance
  controls, zoom, draggable endpoint blocks and a normal cable comparison.
- Animation uses requestAnimationFrame only while visible and moving.
  Speed zero, hidden document and offscreen preview do not request idle frames.

The STFT In/Out blocks on this isolated page are drawn labels, not working
modules. The canvas receives only the shared GL device's finished picture.

## Deliberately Deferred

- Every STFT engine/frame transport/scheduler change in the full plan.
- Reclassification or migration of existing spectral effects and displays.
- Actual circuit-builder cable dispatch, live dragging and wire-bake hashes.
- Production UIDEV registration, persistence and pixelate-on-zoom animation policy.

These are integration tasks after appearance approval and the other agent's
engine commits. The primitive and port groundwork can be merged independently.

## Development Verification

- Browser WebGL compilation and visible pixels on desktop and 390px / DPR 3.
- Ribbon/trace routing, parameter changes, selection and animation.
- Static preview requests no idle frames.
- Ordinary ribbon vertices, including parameter dip, match the pre-change
  renderer byte for byte with and without a camera.
- Canonical audio smoke remains exactly equal to its reference.

No per-module smoke or release gate was added.
