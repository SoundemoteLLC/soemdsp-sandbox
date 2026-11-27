// Shared WebGL line / fill / image / text renderer for module faces (the one
// drawing interface; docs/WEBGL_DISPLAY_PLAN.md).
//
// Draws on the shared picture device (public/lib/visual/picture-device.js,
// one hidden WebGL2 context) and lands the result in the face's texture. A
// face is a face box (display-canvas.js: no <canvas>, keyed by node id + face
// slot) with the shared sizing path (backing = layout css x
// devicePixelRatio, never x workspace zoom); the GL graph picks each face
// quad's filter (nodeGraphGlGraphFacePin).
//
// Coordinates are device px unless begin() got { scale }: then x/y, halfPx,
// feather and text px are CSS px and multiplied by scale (pass the face
// pixelRatio).
//
// Lines are shader-expanded quads (capsules): each vertex carries its local
// position along/across the segment, the fragment shader takes the distance
// to the segment and fades it over `feather` px past `halfPx`, supersampled
// 4x4 in the shader (docs/APP_POLICY.md section 3):
//   a = mean over 16 sub-pixel offsets of edge((dist' - halfPx) / feather)
// so thickness never depends on fractional pixel position. Two edge kinds,
// per batch (begin option `edge`):
//   display (default): Expo skirt, 1 - (1 - e^-3t) / (1 - e^-3)
//   "chrome": smootherstep, 1 - (6t^5 - 15t^4 + 10t^3), for the circuit
//   builder's fixed-width edges (wires, jack dots, plates, keys). Fills are the
// same quads with an infinite halfPx (solid). A zero-length segment is a
// round dot of radius halfPx. Phosphor beams keep gaussian/erf. Jack
// rings keep a 1px AA skirt.
//
// Draw order per frame: images (under), quads, text (over).
//
// Text: nodeGraphGlLinesText draws from one shared glyph atlas per font
// (white coverage baked once at 64 px with a 2D canvas inside this shared lib,
// uploaded as an RGBA texture with mipmaps; tinted in the shader). Cells are
// separated by a TEXT_GUTTER so mip levels never sample a neighbour glyph.
//
// Color emoji: a text run that contains emoji grapheme clusters
// (Extended_Pictographic, ZWJ sequences, flags, keycaps, VS16) draws each
// emoji from a shared colour atlas, inline with the coverage glyphs, with the
// browser's advance and the same baseline. Each emoji is rasterized ONCE at
// its base size: the drawn size in face-backing device px (font px x
// pixelRatio; the backing is never x workspace zoom), cached by
// emoji + base px, uploaded premultiplied with NEAREST filtering. Zoom never
// re-bakes: zooming scales those pixels and the display pixelation rule
// applies (no sharpening). Steady state allocates nothing and bakes nothing.
//
// RGBA picture out: when the face's module has a cable on its `rgba` / TV out
// (picture-device nodeGraphPictureHasConsumer), end() renders the batch into
// that node's picture texture (transparent clear, premultiplied alpha), then
// shows the face from that texture over the plate colour. Picture textures on
// the wire are premultiplied RGBA (opaque sources are unchanged by this).
//
// No WebGL2 (no device, context lost, shader failure): begin() returns null and
// the caller shows a plain black square (nodeGraphGlLinesFillBlack). No 2D drawing.
// Context loss: picture-device drops the device; the next begin() sees a new
// gl and rebuilds the programs and atlases.

(function initNodeGraphGlLineRenderer(global) {
  const MAX_DIM = 4096;
  const FLOATS = 12; // pos2, local2, len1, half1, feather1, caps1, rgba4
  const SPECTRAL_WIRE_DEFAULTS = Object.freeze({
    width: 5, brightPoint: 0, edgeBrightness: 1.6, centerAlpha: 0.1,
    bend: 999, shape: -2, dimPoint: 10, iridescence: 0.55, hueSpread: 0.7, sheenLength: 180,
    shimmerSpeed: 0, baseTint: 0.3, phase: 0,
  });
  const PULSE_TRAIN_MAX = 16384;
  // Canonical display Expo skirt (APP_POLICY §3). One source for JS and GLSL.
  // coverage = 1 - (1 - e^-3t) / (1 - e^-3), t in [0, 1] past the solid edge.
  const NODE_GRAPH_GL_LINES_EXPO_SKIRT_GLSL = "1.0 - (1.0 - exp(-3.0 * t)) / 0.95021293163";
  function nodeGraphGlLinesExpoSkirt(t) {
    const x = Number(t);
    if (!(x > 0)) return 1;
    if (x >= 1) return 0;
    return 1 - (1 - Math.exp(-3 * x)) / 0.95021293163;
  }
  // Perlin quintic. Same one-SDF cost as Hermite smoothstep; C2 at the
  // skirt ends.
  // App edge (APP_POLICY section 3), in-shader 4x4 supersampling. The 16
  // sub-pixel samples are the pixel's distance plus its screen-space gradient
  // at each offset, the same box filter as an SSAA 4x buffer, so it works with
  // mixed colours and the batch's normal draw order. uEdge picks the curve:
  // 0 = display Expo skirt (default), 1 = chrome smootherstep.
  const COVERAGE_GLSL = `
uniform float uEdge;
float expoSkirt(float t) {
  t = clamp(t, 0.0, 1.0);
  return ${NODE_GRAPH_GL_LINES_EXPO_SKIRT_GLSL};
}
float edgeCurve(float t) {
  if (uEdge > 0.5) return 1.0 - t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  return expoSkirt(t);
}
float coverageEdgeAt(float halfPx, float feather, float dist) {
  if (dist <= halfPx) return 1.0;
  return edgeCurve(clamp((dist - halfPx) / max(feather, 1e-4), 0.0, 1.0));
}
float coverageEdge(float halfPx, float feather, float dist) {
  vec2 g = vec2(dFdx(dist), dFdy(dist));
  float acc = 0.0;
  for (int j = 0; j < 4; j += 1) {
    for (int i = 0; i < 4; i += 1) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) * 0.25 - 0.5;
      acc += coverageEdgeAt(halfPx, feather, dist + dot(o, g));
    }
  }
  return acc * 0.0625;
}
`;
  const VS = `
attribute vec2 position;
attribute vec2 local;
attribute float segLen;
attribute float halfPx;
attribute float feather;
attribute float caps;
attribute vec4 colour;
uniform float uPixel;
uniform vec3 uCam;
uniform vec2 uVp;
uniform float uDevice;
varying vec2 vLocal;
varying float vLen;
varying float vHalf;
varying float vFeather;
varying float vCaps;
varying vec4 vColour;
void main() {
  vec2 pos = position;
  float capsOut = caps;
  vec2 localOut = local;
  float halfOut = halfPx;
  float lenOut = segLen;
  // Analytic ring (caps 10): local = offset from the centre, segLen = radius.
  // Camera: radius / half are zoom-1 world px, feather is screen px (as dots).
  // caps 11: horizontal plate fade. local.x is t in 0..1 (opaque -> clear).
  // Do not treat it as a ring or expand the quad with zoom.
  if (caps > 11.5 && caps < 13.0) {
    if (uPixel > 0.5) {
      float side = caps > 12.25 ? -1.0 : 1.0;
      vec2 n = local;
      float nl = length(n);
      if (nl > 0.0001) n /= nl;
      float z = max(uCam.z, 0.0001);
      float width = max(halfPx * z, 0.5);
      float reach = width + feather;
      pos = position + n * side * (reach / z);
      localOut = vec2(segLen, side * reach);
      halfOut = width;
    }
    capsOut = 12.0;
  } else if (caps > 10.5 && caps < 11.5) {
    capsOut = 11.0;
  } else if (uPixel > 0.5 && caps > 9.75) {
    float z = max(uCam.z, 0.0001);
    localOut = local * z;
    halfOut = halfPx * z;
    lenOut = segLen * z;
  } else
  // Camera: halfPx is zoom-1 world px, feather is screen px. Reach uses the
  // live zoom so a retained mesh does not pulse when the camera changes.
  if (uPixel > 0.5 && caps > 5.5 && caps < 9.5) {
    float z = max(uCam.z, 0.0001);
    float aaWorld = 1.5 / z;
    float reach = halfPx + aaWorld;
    float alongSign = ((caps > 6.5 && caps < 7.5) || caps > 8.5) ? 1.0 : -1.0;
    float acrossSign = caps > 7.5 ? 1.0 : -1.0;
    vec2 tangent = local;
    float tl = length(tangent);
    if (tl > 0.0001) tangent /= tl;
    vec2 normal = vec2(-tangent.y, tangent.x);
    pos = position + (tangent * alongSign + normal * acrossSign) * reach;
    // segLen = arc at the end + alongSign * halfPx. Add the AA pad on top.
    localOut = vec2(segLen + alongSign * aaWorld, acrossSign * reach);
    capsOut = 6.0;
  } else if (uPixel > 0.5 && caps > 3.75) {
    float z = max(uCam.z, 0.0001);
    float reach = halfPx * z + feather;
    pos = position + local * (reach / z);
    localOut = local * reach;
    halfOut = halfPx * z;
    capsOut = 0.0;
  } else if (uPixel > 0.5 && caps > 2.5) {
    float side = caps > 3.25 ? -1.0 : 1.0;
    vec2 n = local;
    float nl = length(n);
    if (nl > 0.0001) n /= nl;
    float z = max(uCam.z, 0.0001);
    float reach = halfPx * z + feather;
    pos = position + n * side * (reach / z);
    localOut = vec2(0.0, side * reach);
    halfOut = halfPx * z;
    capsOut = 1.0;
  }
  if (uPixel > 0.5) {
    vec2 css = (pos - uCam.xy) * max(uCam.z, 0.0001);
    vec2 dev = css * uDevice;
    gl_Position = vec4(dev.x / uVp.x * 2.0 - 1.0, 1.0 - dev.y / uVp.y * 2.0, 0.0, 1.0);
  } else {
    gl_Position = vec4(position, 0.0, 1.0);
  }
  vLocal = localOut;
  vLen = lenOut;
  vHalf = halfOut;
  vFeather = feather;
  vCaps = capsOut;
  vColour = colour;
}
`;
  const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vLocal;
varying float vLen;
varying float vHalf;
varying float vFeather;
varying float vCaps;
varying vec4 vColour;
uniform float uCoverage;
uniform vec3 uCam;
uniform vec2 uDash;
// Spectral tube only: bright-point position, brightness, floor alpha, bend;
// iridescence, hue spread, world-pixel sheen length, jack tint, phase.
uniform vec4 uSpectralProfile;
uniform vec4 uSpectralColour;
uniform float uSpectralPhase;
uniform float uSpectralDimPoint;
uniform float uSpectralShape;
uniform float uSpectralPixelMode;
uniform float uSpectralPixels[32];
${COVERAGE_GLSL}
// Identical to SoemGl.GLSL_DITHER (ordered 8x8). Keep in lockstep.
float soemDither(vec2 fragCoord) {
  vec2 p = mod(floor(fragCoord), 8.0);
  vec2 a = mod(p, 2.0);
  vec2 b = mod(floor(p * 0.5), 2.0);
  vec2 c = floor(p * 0.25);
  float v = 16.0 * mod(2.0 * a.x + 3.0 * a.y, 4.0)
    + 4.0 * mod(2.0 * b.x + 3.0 * b.y, 4.0)
    + mod(2.0 * c.x + 3.0 * c.y, 4.0);
  return (v + 0.5) / 64.0 - 0.5;
}
vec3 soemDitherRgb(vec3 c, vec2 fragCoord) {
  return floor(clamp(c, 0.0, 1.0) * 255.0 + soemDither(fragCoord) + 0.5) / 255.0;
}
// Two user-positioned points joined by a hyperbolic decay. Bright point zero
// starts fading at the outer edge: no mandatory solid-width inner wall.
float spectralGlowTail(float distance, float bright, float dim, float bend) {
  float t = clamp((distance - bright) / max(dim - bright, 1e-4), 0.0, 1.0);
  if (abs(uSpectralShape) > 1e-4) {
    t = (exp(uSpectralShape * t) - 1.0) / (exp(uSpectralShape) - 1.0);
  }
  return (1.0 - t) / (1.0 + bend * t);
}
vec2 spectralInnerGlow(float across, float radius, float bright, float dim, float bend) {
  vec2 g = vec2(dFdx(across), dFdy(across));
  vec2 acc = vec2(0.0);
  for (int j = 0; j < 4; j += 1) {
    for (int i = 0; i < 4; i += 1) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) * 0.25 - 0.5;
      float y = across + dot(o, g);
      float a = spectralGlowTail(radius + y, bright, dim, bend);
      float b = spectralGlowTail(radius - y, bright, dim, bend);
      // Integrate the profile and outer edge together, not two blurred masks.
      float coverage = coverageEdgeAt(radius, min(vFeather, 0.5), abs(y));
      acc += vec2((1.0 - (1.0 - a) * (1.0 - b)) * coverage, coverage);
    }
  }
  return acc * 0.0625;
}
void main() {
  if (vCaps > 11.5 && vCaps < 13.0) {
    float w = max(vHalf, 0.5);
    float d = abs(vLocal.y);
    vec2 profile;
    if (uSpectralPixelMode > 0.5) {
      // Custom falloff replaces only the curve, not the appearance controls.
      vec2 g = vec2(dFdx(vLocal.y), dFdy(vLocal.y));
      float alpha = 0.0;
      float coverage = 0.0;
      for (int j = 0; j < 4; j += 1) {
        for (int i = 0; i < 4; i += 1) {
          vec2 o = (vec2(float(i), float(j)) + 0.5) * 0.25 - 0.5;
          float inward = w - abs(vLocal.y + dot(o, g));
          int bin = int(floor(max(inward, 0.0)));
          if (inward >= 0.0 && bin < 32) alpha += uSpectralPixels[bin];
          if (inward >= 0.0) coverage += 1.0;
        }
      }
      profile = vec2(alpha, coverage) * 0.0625;
    } else {
      bool collapsed = w < 0.75;
      profile = collapsed ? vec2(coverageEdge(w, min(vFeather, 0.5), d)) : spectralInnerGlow(vLocal.y, w, uSpectralProfile.x, uSpectralDimPoint, uSpectralProfile.w);
    }
    float glow = profile.x / max(profile.y, 1e-6);
    float t = vLocal.x / max(uSpectralColour.z, 1e-3) - uSpectralPhase + 0.15 * d / w;
    vec3 palette = vec3(0.72) + vec3(0.28) * cos(6.28318530718 * (t * uSpectralColour.y + vec3(0.0, 0.34, 0.67)));
    vec3 base = mix(vec3(0.86, 0.90, 0.96), vColour.rgb, uSpectralColour.w);
    vec3 rgb = mix(base, palette, uSpectralColour.x);
    vec3 lit = mix(rgb * min(uSpectralProfile.y, 1.0), vec3(1.0), clamp(uSpectralProfile.y - 1.0, 0.0, 1.0));
    float a = mix(profile.x, profile.y, uSpectralProfile.z);
    rgb = mix(rgb, lit, glow);
    gl_FragColor = (uCoverage > 0.5 && a < 0.004) ? vec4(0.0) : vec4(soemDitherRgb(rgb, gl_FragCoord.xy), a * vColour.a);
    return;
  }
  if (vCaps > 10.5 && vCaps < 11.5) {
    float t = clamp(vLocal.x, 0.0, 1.0);
    float a = 1.0 - t;
    float fade = a * a;
    float fade8 = floor(clamp(fade, 0.0, 1.0) * 255.0 + soemDither(gl_FragCoord.xy) + 0.5) / 255.0;
    gl_FragColor = vec4(soemDitherRgb(vColour.rgb, gl_FragCoord.xy), fade8 * vColour.a);
    return;
  }
  float u = vLocal.x;
  float across = abs(vLocal.y);
  float a;
  if (vCaps > 9.75) {
    // Analytic ring: distance to the circle of radius vLen, same solid core +
    // shared edge as the capsule / dot primitives.
    float d = abs(length(vLocal) - vLen);
    a = coverageEdge(vHalf, vFeather, d);
  } else if (vCaps > 5.5 && vCaps < 6.5) {
    // One stadium per dash. Arc length is zoom-1 px, so the pattern stays
    // put while the camera moves. Caps and the body share this coverage.
    float z = max(uCam.z, 0.0001);
    float arc = vLocal.x;
    float gap = abs(vLocal.y);
    float total = max(vFeather, 0.0);
    float on = max(uDash.x, 0.5);
    float period = max(on + max(uDash.y, 0.0), 1e-3);
    float k = floor(arc / period);
    float best = 1e4;
    for (int s = -1; s <= 1; s += 1) {
      float dash0 = (k + float(s)) * period;
      float dash1 = dash0 + on;
      float c0 = max(dash0, 0.0);
      float c1 = min(dash1, total);
      if (c1 > c0) {
        float along = arc < c0 ? c0 - arc : (arc > c1 ? arc - c1 : 0.0);
        best = min(best, along);
      }
    }
    float dScreen = length(vec2(best, gap)) * z;
    float halfScreen = max(vHalf, 0.0) * z;
    float fw = max(fwidth(dScreen), 0.6);
    a = coverageEdge(halfScreen, fw, dScreen);
  } else if (vCaps > 1.5) {
    // Phosphor beam. erf integrates the gaussian along the segment so
    // overlapping ends add to one continuous brightness.
    float sigma = max(vHalf, 1e-3);
    float inv = 0.70710678 / sigma;
    float x = vLocal.x * inv;
    float s = sign(x);
    float ax = abs(x);
    float p = 1.0 + (0.278393 + (0.230389 + 0.078108 * ax * ax) * ax) * ax;
    p *= p;
    float e0 = s - s / (p * p);
    x = (vLocal.x - vLen) * inv;
    s = sign(x);
    ax = abs(x);
    p = 1.0 + (0.278393 + (0.230389 + 0.078108 * ax * ax) * ax) * ax;
    p *= p;
    float e1 = s - s / (p * p);
    float along = clamp(0.5 * (e0 - e1), 0.0, 1.0);
    float y = vLocal.y;
    float acrossGlow = exp(-y * y / (2.0 * sigma * sigma));
    a = along * acrossGlow;
  } else {
    float d;
    if (vCaps > 0.5) {
      float outside = u < 0.0 ? -u : (u > vLen ? u - vLen : 0.0);
      d = outside > 0.0 ? vHalf + vFeather + outside : across;
    } else {
      d = u < 0.0 ? length(vLocal) : (u > vLen ? length(vec2(u - vLen, vLocal.y)) : across);
    }
    a = coverageEdge(vHalf, vFeather, d);
  }
  float cov = vColour.a * a;
  // Coverage pass stores straight alpha. Zero-coverage corners must be
  // (0,0,0,0) or MAX would paint the quad's bounding box. The cut tests
  // geometric coverage only, never colour alpha: no brightness threshold.
  gl_FragColor = (uCoverage > 0.5 && a < 0.004) ? vec4(0.0) : vec4(vColour.rgb, cov);
}
`;
  // Textured quads: images (mode 0), tinted glyph coverage (mode 1),
  // premultiplied picture present (mode 2).
  const IMG_VS = `
attribute vec2 position;
attribute vec2 uv;
attribute vec4 vtint;
uniform float uPixel;
uniform vec3 uCam;
uniform vec2 uVp;
uniform float uDevice;
// 1 = glyph quads of a 1:1 atlas: corners land on whole device pixels.
uniform float uSnap;
varying vec2 vUv;
varying vec4 vTint;
varying highp vec2 vWorld;
void main() {
  vWorld = position;
  if (uPixel > 0.5) {
    vec2 css = (position - uCam.xy) * max(uCam.z, 0.0001);
    vec2 dev = css * uDevice;
    if (uSnap > 0.5) dev = floor(dev + 0.5);
    gl_Position = vec4(dev.x / uVp.x * 2.0 - 1.0, 1.0 - dev.y / uVp.y * 2.0, 0.0, 1.0);
  } else {
    gl_Position = vec4(position, 0.0, 1.0);
  }
  vUv = uv;
  vTint = vtint;
}
`;
  const IMG_FS = `
precision mediump float;
uniform sampler2D tex;
uniform float alpha;
uniform vec4 tint;
uniform float mode;
// Module text in a dark room: uTextDark is how much the text is dimmed (0 = not at all); the mouse lamp
// (x, y, radius, strength) lifts that dimming around the cursor, so text near it gets brighter.
uniform float uTextDark;
uniform vec4 uLamp;
// Jack cutouts through a picture (camera mode, world units): (x, y, radius, side). Radius < 0 = square jack.
// side is +1 where the module's inside is to the right of the jack, -1 to the left. Hard edged.
uniform int uHoleCount;
uniform highp vec4 uHoles[16];
// One screen pixel in world units: the width of the hole's anti-aliased edge.
uniform highp float uHoleAA;
varying vec2 vUv;
varying vec4 vTint;
varying highp vec2 vWorld;
void main() {
  highp float keepPx = 1.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uHoleCount) break;
    highp vec4 h = uHoles[i];
    highp vec2 d = vWorld - h.xy;
    highp float dist = h.z < 0.0 ? max(abs(d.x), abs(d.y)) : length(d);
    highp float aa = max(uHoleAA, 1e-4);
    highp float cov = clamp((abs(h.z) - dist) / aa + 0.5, 0.0, 1.0) * clamp(d.x * h.w / aa + 0.5, 0.0, 1.0);
    keepPx = min(keepPx, 1.0 - cov);
  }
  if (keepPx <= 0.0) discard;
  vec4 c = texture2D(tex, vUv);
  if (mode > 2.5) {
    // Premultiplied colour emoji x tint alpha.
    gl_FragColor = c * vTint.a;
  } else if (mode > 1.5) {
    gl_FragColor = c;
  } else if (mode > 0.5) {
    // Per-vertex tint (batched glyphs / tinted sprites) x coverage.
    float textF = 1.0;
    vec3 textRgb = vTint.rgb;
    if (uTextDark > 0.0) {
      float ld = length(vWorld - uLamp.xy) / max(uLamp.z, 1.0);
      float lit = uLamp.w > 0.0 ? clamp(uLamp.w * exp(-1.6 * ld * ld), 0.0, 1.0) : 0.0;
      textF = 1.0 - uTextDark * (1.0 - lit);
      // Reflecting the lamp: past full brightness the glyph lifts toward white.
      textRgb = mix(textRgb, vec3(1.0), 0.45 * lit * lit);
    }
    gl_FragColor = vec4(textRgb, vTint.a * c.a * textF);
  } else {
    gl_FragColor = vec4(c.rgb, c.a * alpha * keepPx);
  }
}
`;
  const TEXT_BAKE_PX = 64;
  // Raised when the caller wants glyphs baked closer to the size they are drawn.
  // Capped so one cell still fits the sheet. Unset callers keep 64.
  let glyphBakePx = TEXT_BAKE_PX;
  // Bumped whenever a glyph atlas texture is retired (rebake at a new size or
  // growth for new characters). Kept meshes hold text runs that point at the
  // atlas texture they were recorded with; once it is deleted drawTexts skips
  // those runs, so a mesh recorded across a bump must be re-recorded.
  let textAtlasGen = 0;
  // Every character each font atlas has needed, so a rebake at a new size
  // starts complete and does not grow (and retire itself) mid-remesh.
  const textAtlasKnownChars = new Map();
  const TEXT_WHITE = Object.freeze([1, 1, 1, 1]);
  const TEXT_PAD = 6;
  // Empty texels between atlas cells, a quarter of the bake size (4..32): a
  // 64 px bake keeps 16, enough for a 1/4 minified draw (mip 2) without
  // neighbour bleed. A 1:1 bake of a 13 px label needs only 4.
  function textGutter(bakePx) { return Math.max(4, Math.min(32, Math.round(bakePx * 0.25))); }
  // Camera text (the workspace graph) bakes each size at its own device size,
  // quantised to 1/64 px so equal sizes share one atlas.
  const TEXT_CAM_BAKE_MIN = 8;
  const TEXT_CAM_BAKE_MAX = 256;
  let textAtlasEpoch = 0;
  // Bake cost counters (tests / diagnostics).
  const textAtlasStats = { bakes: 0, ms: 0, measureMs: 0, drawMs: 0, uploadMs: 0, maxMs: 0, fallbacks: 0, queued: 0 };
  // Lazy camera atlases (batches begun with lazyText, i.e. the workspace graph):
  // a missing size is not baked inside the record. The record draws with the
  // nearest live atlas of that font (resampled, not snapped) and the size is
  // queued; the caller bakes the queue a little per frame and re-records.
  // key -> { family, weight, camBake, chars, scale, prio }
  const textAtlasQueue = new Map();
  // Camera atlas textures replaced (grown) while a kept mesh may still point
  // at them. Deleted only by a sweep that knows nothing references them.
  const textAtlasRetiring = new Set();
  // Bumped only when a camera atlas texture is deleted synchronously (the
  // non-lazy growth path); the workspace mesh only holds camera atlases.
  let textAtlasCamGen = 0;
  // A lazy camera atlas being drawn a few glyphs per frame (BakeNext with a budget).
  let textAtlasBaking = null;
  // Per font: glyph advance / ascent measured once at TEXT_METRIC_PX and
  // scaled to each camera bake size (measureText was ~80% of a bake).
  const TEXT_METRIC_PX = 64;
  const textMetricCache = new Map();
  let textMetricCtx = null;
  // Colour emoji atlas.
  const EMOJI_SHEET = 1024;
  const EMOJI_PAD = 2;
  const EMOJI_MAX_PAGES = 4;
  const EMOJI_FAMILY = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
  // Cheap gate (no allocation): only text that may hold an emoji is segmented.
  const EMOJI_HINT = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{200D}\u{FE0F}\u{20E3}\u{00A9}\u{00AE}\u{203C}\u{2049}\u{2122}\u{2139}\u{2194}-\u{21AA}\u{231A}-\u{23FF}\u{24C2}\u{25AA}-\u{25FE}]/u;
  const EMOJI_CLUSTER = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}|\u{20E3}|\u{200D}/u;
  const EMOJI_PRESENTATION = /\p{Emoji_Presentation}|\u{FE0F}|\u{20E3}|\u{200D}|\p{Regional_Indicator}/u;
  const SEGMENT_CACHE_MAX = 512;
  const segmentCache = new Map();
  const emojiStats = { bakes: 0, uploads: 0, segmentMisses: 0, pages: 0, entries: 0, dropped: 0 };
  const TEXT_ASCENT = 0.8;   // of px, baseline from em top
  const TEXT_DEFAULT_FAMILY = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace';
  const TEXT_BASE_CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~—–°·×±µƒ♯♭";
  let state = null;
  let failedGl = null;

  function compile(gl, type, source, label) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "compile failed";
      gl.deleteShader(shader);
      throw new Error(label ? label + " compile: " + log : log);
    }
    return shader;
  }

  const VEIL_FS = `
precision highp float;
varying vec2 vPx;
uniform vec4 uRect;
uniform float uPeriod;
uniform float uFeather;
uniform float uAlpha;
// The app's Expo skirt (APP_POLICY section 3): 1 at t = 0 falling to 0 at t = 1.
float expoSkirt(float t) {
  return 1.0 - (1.0 - exp(-3.0 * t)) / 0.95021293163;
}
void main() {
  float f = max(uFeather, 0.01);
  // Distance inside the plate to its nearest edge: the stripes end on an anti-aliased edge too.
  float inside = min(min(vPx.x - uRect.x, uRect.x + uRect.z - vPx.x), min(vPx.y - uRect.y, uRect.y + uRect.w - vPx.y));
  if (inside < -f) discard;
  float period = max(uPeriod, 2.0);
  float half_ = period * 0.5;
  // Along the stripe normal (x + y), from the plate's corner so the pattern does not swim; q is the offset from the nearest stripe centre.
  float u = (vPx.x - uRect.x) + (vPx.y - uRect.y);
  float q = mod(u + half_ * 0.5, period) - half_;
  // Perpendicular distance past the stripe's edge (negative inside it); the stripe is half a period wide in x + y.
  float d = (abs(q) - half_ * 0.5) * 0.70710678118;
  float a = expoSkirt(clamp((d + f * 0.5) / f, 0.0, 1.0));
  a *= 1.0 - expoSkirt(clamp((inside + f * 0.5) / f, 0.0, 1.0));
  if (a <= 0.003) discard;
  gl_FragColor = vec4(0.886, 0.659, 0.427, uAlpha * a);
}
`;
  // Module lights, on the GPU. One pass over the view: for every module an inverse-square falloff of
  // the distance to its rounded rectangle, I = 1 / (1 + (d / d0)^2) windowed to zero at the reach,
  // in the original cyan-to-amber module light plus a light in the stroke colour.
  const LIGHT_FS = `
precision highp float;
varying highp vec2 vPx;
uniform int uCount;
uniform highp vec4 uRect[64];
// x: reach (world px), y: module light alpha, z: stroke light alpha, w: corner radius
uniform highp vec4 uGlow[64];
uniform vec4 uStrokeRgb[64];
// The original ellipse: radii = max(uGridMin, (1.18 w, 1.35 h)) * uSpread.
uniform vec2 uGridMin;
uniform float uSpread;
// Grid, revealed near modules and the mouse (was a CSS mask): world cell, colour + line alpha,
// reveal spread, module reveal strength, mouse (x, y, radius, amount), screen px per world px.
uniform float uGridOn;
uniform vec2 uGridCell;
uniform vec4 uGridRgba;
uniform float uGridSpread;
// The grid lines reflect the room light like module text does (see the glyph shader): uGridDark is how much a dark room dims
// them (0 = not at all), the mouse lamp (x, y, radius, strength) lifts that dimming around the cursor and, past full
// brightness, lifts the lines toward white.
uniform float uGridDark;
uniform highp vec4 uGridLamp;
// The mouse as a module-like light: 1 = it reveals the grid as brightly as a module does (0 = not at all).
uniform float uGridReflect;
// Grid line strength around the mouse (uGridRgba.a is the strength around modules).
uniform float uGridMouseA;
// TEMPORARY dial-in: x = push the lines at the mouse toward full white (0..1), y = how far the mouse light reaches, in SCREEN (device)
// px, so it does not change with the zoom.
uniform vec2 uGridLampMore;
uniform float uModuleAmt;
uniform highp vec4 uMouse;
uniform float uZoomPx;
void main() {
  vec3 cyan = vec3(0.498, 0.780, 0.851);
  vec3 amber = vec3(0.886, 0.659, 0.427);
  vec4 acc = vec4(0.0);
  float reveal = 0.0;
  for (int i = 0; i < 64; i++) {
    if (i >= uCount) break;
    vec4 r = uRect[i];
    vec2 half2 = r.zw * 0.5;
    vec2 c = r.xy + half2;
    float rad = min(uGlow[i].w, min(half2.x, half2.y));
    vec2 q = abs(vPx - c) - half2 + vec2(rad);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
    if (uGridOn > 0.5) {
      vec2 radiiG = vec2(max(uGridMin.x, 1.18 * r.z), max(uGridMin.y, 1.35 * r.w)) * uGridSpread;
      float tg = length((vPx - c) / radiiG);
      float ug = max(tg - 0.5, 0.0) / 0.5;
      float rg = (1.0 / (1.0 + (ug / 0.3) * (ug / 0.3))) * (1.0 - smoothstep(0.55, 1.0, ug));
      reveal = max(reveal, rg);
    }
    // Module light (the original ellipse around the module centre; the module hides its inside).
    vec2 radii = vec2(max(uGridMin.x, 1.18 * r.z), max(uGridMin.y, 1.35 * r.w)) * uSpread;
    float te = length((vPx - c) / radii);
    float ue = max(te - 0.5, 0.0) / 0.5;
    if (ue < 1.0) {
      float fe = (1.0 / (1.0 + (ue / 0.3) * (ue / 0.3))) * (1.0 - smoothstep(0.55, 1.0, ue));
      vec3 baseCol = mix(cyan, amber, smoothstep(0.0, 0.7, ue));
      float a1 = uGlow[i].y * fe;
      acc.rgb += (1.0 - acc.a) * baseCol * a1;
      acc.a += (1.0 - acc.a) * a1;
    }
    // Stroke light: the module's own shape (distance to its rounded rectangle), inverse-square.
    // Its own reach (uStrokeRgb.w, set by the module glow spread); the module light's reach when none is given.
    float u = max(sd, 0.0) / max(uStrokeRgb[i].w > 0.5 ? uStrokeRgb[i].w : uGlow[i].x, 1.0);
    if (u < 1.0) {
      float fall = (1.0 / (1.0 + (u / 0.3) * (u / 0.3))) * (1.0 - smoothstep(0.55, 1.0, u));
      float a2 = uGlow[i].z * fall;
      acc.rgb += (1.0 - acc.a) * uStrokeRgb[i].rgb * a2;
      acc.a += (1.0 - acc.a) * a2;
    }
  }
  if (uGridOn > 0.5) {
    // Distance (device px) from this pixel to the nearest grid line, line one device px wide. Box
    // filtered: a line that lands between pixels shares its energy instead of popping on and off while
    // the zoom changes. Lines too dense to read (cells under ~5 px) fade out instead of aliasing.
    vec2 cellDev = uGridCell * uZoomPx;
    vec2 fd = mod(vPx, uGridCell) * uZoomPx;
    vec2 dist = min(fd, cellDev - fd);
    vec2 lineCov = clamp(vec2(1.0) - dist, 0.0, 1.0);
    float cov = max(lineCov.x * smoothstep(4.0, 12.0, cellDev.x), lineCov.y * smoothstep(4.0, 12.0, cellDev.y));
    // What the modules reveal and what the mouse reveals are kept apart: each has its own line strength.
    float rv = reveal * uModuleAmt;
    float mouseRv = 0.0;
    if (uMouse.w > 0.0) {
      float mt = length(vPx - uMouse.xy) / max(uMouse.z, 1.0);
      float mr = uMouse.w * (1.0 / (1.0 + (mt / 0.35) * (mt / 0.35))) * (1.0 - smoothstep(0.6, 1.0, mt));
      mouseRv = clamp(mr, 0.0, 1.0);
    }
    // The mouse is a light like a module: it reveals the grid with the same falloff, over the same reach and at the same line
    // strength a module does (uGridReflect scales it; 1 = exactly as bright as around a module), wherever it is, in a lit room or
    // a dark one. The text lamp (lit) also lifts the lines toward white and, in a dark room, undims them around the cursor.
    float lit = 0.0;
    float lampRev = 0.0;
    if (uGridLamp.w > 0.0) {
      float ldw = length(vPx - uGridLamp.xy);
      float ld = ldw / max(uGridLamp.z, 1.0);
      lit = clamp(uGridLamp.w * exp(-1.6 * ld * ld), 0.0, 1.0);
      // Screen distance to the mouse over a screen-px reach: the mouse light is the same size on screen at every zoom.
      float ug = (ldw * uZoomPx) / max(uGridLampMore.y, 1.0);
      lampRev = clamp(uGridReflect, 0.0, 4.0) * (1.0 / (1.0 + (ug / 0.3) * (ug / 0.3))) * (1.0 - smoothstep(0.55, 1.0, ug));
    }
    float gridF = 1.0 - uGridDark * (1.0 - lit);
    vec3 gridRgb = mix(uGridRgba.rgb, vec3(1.0), 0.45 * lit * lit);
    mouseRv = 1.0 - (1.0 - mouseRv) * (1.0 - clamp(lampRev, 0.0, 1.0));
    float aModule = uGridRgba.a * rv * gridF;
    float aMouse = uGridMouseA * mouseRv * gridF;
    float gridA = cov * mix(1.0 - (1.0 - aModule) * (1.0 - aMouse), 1.0, clamp(lampRev, 0.0, 1.0) * clamp(uGridLampMore.x, 0.0, 1.0));
    acc.rgb += (1.0 - acc.a) * gridRgb * gridA;
    acc.a += (1.0 - acc.a) * gridA;
  }
  if (acc.a < 0.002) discard;
  gl_FragColor = acc;
}
`;
  const OUT_VS = `
attribute vec2 position;
attribute vec2 pixel;
uniform float uPixel;
uniform vec3 uCam;
uniform vec2 uVp;
uniform float uDevice;
uniform vec4 uPlate;
varying vec2 vPx;
void main() {
  vec2 pos = position;
  // Keep the 1px screen stroke inside the quad at any zoom. Veil draws leave
  // uPlate at zero, so they stay put.
  if (uPixel > 0.5 && uPlate.z > 0.5 && uPlate.w > 0.5) {
    vec2 center = uPlate.xy + uPlate.zw * 0.5;
    vec2 dir = pos - center;
    float len = length(dir);
    if (len > 0.001) {
      float z = max(uCam.z, 0.0001);
      float devScale = max(uDevice, 0.0001);
      pos += (dir / len) * (2.0 / (z * devScale));
    }
  }
  if (uPixel > 0.5) {
    vec2 css = (pos - uCam.xy) * max(uCam.z, 0.0001);
    vec2 dev = css * uDevice;
    gl_Position = vec4(dev.x / uVp.x * 2.0 - 1.0, 1.0 - dev.y / uVp.y * 2.0, 0.0, 1.0);
  } else {
    gl_Position = vec4(position, 0.0, 1.0);
  }
  // vPx moves with the grown quad. Interpolating the unmoved corner pixel
  // over the grown quad skewed the shader's pixel grid against the window,
  // so the plate border sat up to a device px off every quad drawn beside it.
  vPx = pixel + (pos - position);
}
`;
  const OUT_FS = `
precision highp float;
// Keep the jack's subpixel radius and distance in high precision as it shrinks.
varying highp vec2 vPx;
// Shared with the vertex shader, whose floats are highp. An unqualified
// float here is mediump and the program fails to link.
uniform highp vec4 uPlate;
uniform vec4 uPlateColor;
uniform vec4 uFill;
// A band of the plate drawn in another fill (IO view C: the pill strip, in the display's colour): world y0, y1.
uniform highp vec2 uStripY;
uniform vec4 uStripColor;
uniform float uStroke;
// Plate corners: (top radius, top shape, bottom radius, bottom shape). Radius in
// plate units, shape 0 round, 1 squircle, 2 pill (full end). All zero = square.
uniform vec4 uRound;
// The stroke's own top corner radius (plate units). The stroke band follows this shape on the top
// half; where it runs inside the plate (a rounder stroke behind sharper plate corners) it is drawn
// under the plate fill. Equal to uRound.x: the stroke hugs the plate as before.
uniform float uStrokeTop;
uniform int uCount;
uniform vec4 uJack[24];
uniform vec4 uJackColor[24];
// Workspace background for jacks flagged (uJack.w >= 2) to fill the hole they cut in the plate.
uniform vec4 uJackBackdrop;
// Border cuts: (y0, y1, side, 0) per rail IO box. No stroke on that wall over
// [y0, y1); the box is drawn through the gap by the rail quads.
uniform int uCutCount;
uniform highp vec4 uCut[16];
uniform highp float uPixel;
uniform highp vec3 uCam;
uniform highp float uDevice;
// Room light: the ambient dim quads (uDimShape = 1) are lifted around a lamp, so a lit spot shows
// the surface at its own colour instead of having white added to it. (x, y, radius, strength).
uniform highp vec4 uLight;
uniform float uDimShape;
void main() {
  vec2 plateMin = uPlate.xy;
  vec2 plateMax = uPlate.xy + uPlate.zw;
  vec2 px = vPx;
  float strokeW = max(uStroke, 0.0);
  float z = max(uCam.z, 0.0001);
  float devScale = max(uDevice, 0.0001);
  if (uPixel > 0.5) {
    // Screen pixels. Edges snap to whole pixels so zoom does not walk the
    // border and the body across the pixel grid. Stroke is at least 1 px.
    vec2 origin = uCam.xy;
    px = (vPx - origin) * z * devScale;
    // ceil(v - 0.5): the first pixel a quad edge at v covers (centre >= v),
    // so a half-pixel edge snaps the same way the face / rail quads rasterize.
    plateMin = ceil((uPlate.xy - origin) * z * devScale - 0.5);
    plateMax = ceil((uPlate.xy + uPlate.zw - origin) * z * devScale - 0.5);
    plateMax = max(plateMax, plateMin + vec2(1.0));
    strokeW = max(1.0, floor(max(uStroke, 0.0) * z * devScale + 0.5));
  }
  vec2 c = (plateMin + plateMax) * 0.5;
  vec2 halfSize = (plateMax - plateMin) * 0.5;
  vec2 pc = px - c;
  bool topHalf = pc.y < 0.0;
  float cornerR = topHalf ? uRound.x : uRound.z;
  float cornerShape = topHalf ? uRound.y : uRound.w;
  if (uPixel > 0.5) cornerR *= z * devScale;
  float maxR = min(halfSize.x, halfSize.y);
  cornerR = cornerShape > 1.5 ? maxR : min(max(cornerR, 0.0), maxR);
  vec2 q = abs(pc) - halfSize + vec2(cornerR);
  vec2 qm = max(q, 0.0);
  float cornerLen;
  if (cornerShape > 0.5 && cornerShape < 1.5) {
    // Squircle (superellipse, exponent 4): a flatter corner that meets the walls more gently.
    vec2 q2 = qm * qm;
    cornerLen = sqrt(sqrt(q2.x * q2.x + q2.y * q2.y));
  } else {
    cornerLen = length(qm);
  }
  float sdRect = cornerLen + min(max(q.x, q.y), 0.0) - cornerR;
  // The stroke's shape: the same rectangle, top corners at uStrokeTop.
  float sdStroke = sdRect;
  if (topHalf) {
    float sR = uStrokeTop;
    if (uPixel > 0.5) sR *= z * devScale;
    sR = cornerShape > 1.5 ? maxR : min(max(sR, 0.0), maxR);
    vec2 sq = abs(pc) - halfSize + vec2(sR);
    vec2 sqm = max(sq, 0.0);
    float sLen;
    if (cornerShape > 0.5 && cornerShape < 1.5) {
      vec2 sq2 = sqm * sqm;
      sLen = sqrt(sqrt(sq2.x * sq2.x + sq2.y * sq2.y));
    } else {
      sLen = length(sqm);
    }
    sdStroke = sLen + min(max(sq.x, sq.y), 0.0) - sR;
  }
  // Jacks are cutouts, defined by distance from the jack centre (on the wall). Radius R = the jack's radius;
  // strokePx is the rim width.
  //   hole: the inner half within R - rim of the centre. Nothing is drawn there: no plate, no stroke.
  //   rim:  the inner half from R - rim to R, in the jack colour, hard edged (no smoothing).
  //   wall: the module stroke is removed inside R on both sides of the wall, so it ends at the rim and never
  //         overlaps or cuts it.
  // The plate itself stays the plain rectangle. A square (param) jack uses the same rule with a square distance.
  float sd = sdRect;
  vec4 strokeCol = uPlateColor;
  float jackEdge = 0.0;
  float jackHole = 0.0;
  float jackRimW = uPixel > 0.5 ? strokeW : max(1.0, floor(strokeW + 0.5));
  float hole = 0.0;
  float rim = 0.0;
  float wallClear = 0.0;
  vec4 rimCol = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    if (i >= uCount) break;
    vec2 jack = uJack[i].xy;
    float radius = uJack[i].z;
    if (uPixel > 0.5) {
      float signr = radius < 0.0 ? -1.0 : 1.0;
      jack = (jack - uCam.xy) * z * devScale;
      radius = signr * abs(uJack[i].z) * z * devScale;
    }
    float square = radius < 0.0 ? 1.0 : 0.0;
    radius = abs(radius);
    // A wall jack sits on the outer edge of the module stroke: its centre is the plate edge plus one stroke
    // width outward. Taken from the same snapped plate edge as the wall, so it never jitters against it.
    float wallSide = jack.x < c.x ? 1.0 : -1.0;
    float wallX = wallSide > 0.0 ? plateMin.x : plateMax.x;
    if (abs(jack.x - wallX) < radius + jackRimW + 1.0) jack.x = wallX - wallSide * jackRimW;
    vec2 dv = px - jack;
    float dist = square > 0.5 ? max(abs(dv.x), abs(dv.y)) : length(dv);
    float side = jack.x < c.x ? 1.0 : -1.0;
    // One pixel of coverage on every edge (distance slope is 1), no feather beyond it.
    float jaa = max(fwidth(dist), uPixel > 0.5 ? 1.0 : 1e-4);
    float inDisc = clamp((radius - dist) / jaa + 0.5, 0.0, 1.0);
    float inHole = clamp((radius - jackRimW - dist) / jaa + 0.5, 0.0, 1.0);
    float onInside = clamp(dv.x * side / jaa + 0.5, 0.0, 1.0);
    // The module stroke is removed along the jack's whole height (the stroke band is outside the wall, so the
    // disc alone would leave a sliver in the notch where neighbouring jacks meet). Coverages add, so two jacks
    // meeting at one edge clear it completely.
    float spanClear = clamp((radius - abs(dv.y)) / jaa + 0.5, 0.0, 1.0)
      * clamp((dv.x * side + jackRimW + 2.0) / jaa + 0.5, 0.0, 1.0);
    wallClear = min(1.0, wallClear + max(inDisc, spanClear));
    float holeI = inHole * onInside;
    float rimI = max(inDisc - inHole, 0.0) * onInside;
    if (holeI > hole) hole = holeI;
    if (rimI > rim) {
      rim = rimI;
      rimCol = uJackColor[i];
    }
  }
  // Rim-only pass (uDimShape 5): drawn over the display, so only the rim.
  if (uDimShape > 4.5) {
    if (rim < 0.004) discard;
    gl_FragColor = vec4(rimCol.rgb, rimCol.a * rim);
    return;
  }
  if (hole > 0.999) discard;
  // Plate and its stroke show through where neither the hole nor the rim covers the pixel.
  float keep = max(1.0 - hole - rim, 0.0);
  // Stroke glow (uDimShape 4): one smooth exponential falloff outside the plate, radius uStroke, in
  // the plate colour. The stroke is a light source: this does not depend on the mouse lamp.
  if (uDimShape > 3.5) {
    float glowR = max(uPixel > 0.5 ? uStroke * z * devScale : uStroke, 1.0);
    float g = sdStroke > 0.0 ? exp(-sdStroke / glowR) : 0.0;
    float ga = uPlateColor.a * g;
    if (ga < 0.004) discard;
    gl_FragColor = vec4(uPlateColor.rgb, min(ga, 1.0));
    return;
  }
  // One stroke for wall and jack: the band 0 < sd <= strokePx outside the
  // shape, where the plate stroke has always sat. A jack meets the wall in a
  // square corner (the max of the two distances), so the strokes join with no
  // gap and no doubled pixel. Camera mode: strokeW is whole screen pixels and
  // the plate edges sit on pixel edges, so walls stay crisp and curves get a
  // one-pixel ramp. Coverage is linear in sd over one pixel (SDF slope 1).
  float strokePx = uPixel > 0.5 ? strokeW : max(1.0, floor(strokeW + 0.5));
  // Derivatives in uniform control flow (before any branch on jackEdge).
  vec2 sdGrad = vec2(dFdx(sd), dFdy(sd));
  float aa = max(fwidth(sd), uPixel > 0.5 ? 1.0 : 1e-4);
  float inner = clamp(sd / aa + 0.5, 0.0, 1.0);
  float band = inner - clamp((sd - strokePx) / aa + 0.5, 0.0, 1.0);
  // Stroke offset from the plate edge (0 except where the stroke's top corners differ).
  float sdOff = sdStroke - sd;
  float bandS = clamp(sdStroke / aa + 0.5, 0.0, 1.0) - clamp((sdStroke - strokePx) / aa + 0.5, 0.0, 1.0);
  if (jackEdge > 0.5) {
    // Round jacks (inlet / outlet half circles): the chrome edge, smootherstep
    // over one pixel, supersampled 4x4 from the distance gradient (APP_POLICY
    // section 3). A one-sample linear ramp stair-stepped on these small
    // curves. Walls keep the crisp pixel-snapped ramp above.
    // One pixel window centred on each edge: against an exact 16x16 box
    // reference this is the closest (edge error 0.035 RMS vs 0.057 for the old
    // one-sample linear ramp); wider windows only soften it away from true.
    float jw = aa;
    float accIn = 0.0;
    float accBand = 0.0;
    float accBandS = 0.0;
    for (int j = 0; j < 4; j += 1) {
      for (int i = 0; i < 4; i += 1) {
        vec2 o = (vec2(float(i), float(j)) + 0.5) * 0.25 - 0.5;
        float s = sd + dot(o, sdGrad);
        float tIn = clamp(s / jw + 0.5, 0.0, 1.0);
        float tOut = clamp((s - strokePx) / jw + 0.5, 0.0, 1.0);
        float eIn = tIn * tIn * tIn * (tIn * (tIn * 6.0 - 15.0) + 10.0);
        float eOut = tOut * tOut * tOut * (tOut * (tOut * 6.0 - 15.0) + 10.0);
        accIn += eIn;
        accBand += eIn - eOut;
        float s2 = s + sdOff;
        float tIn2 = clamp(s2 / jw + 0.5, 0.0, 1.0);
        float tOut2 = clamp((s2 - strokePx) / jw + 0.5, 0.0, 1.0);
        float eIn2 = tIn2 * tIn2 * tIn2 * (tIn2 * (tIn2 * 6.0 - 15.0) + 10.0);
        float eOut2 = tOut2 * tOut2 * tOut2 * (tOut2 * (tOut2 * 6.0 - 15.0) + 10.0);
        accBandS += eIn2 - eOut2;
      }
    }
    inner = accIn * 0.0625;
    band = accBand * 0.0625;
    bandS = accBandS * 0.0625;
  }
  // With the stroke on the plate edge bandS == band, all outside the plate. A rounder stroke top
  // puts part of the band inside the plate: that part sits behind the fill.
  if (abs(sdOff) < 1e-5) bandS = band;
  float bandOut = min(max(bandS, 0.0), inner);
  float bandIn = max(bandS - inner, 0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= uCutCount) break;
    highp vec4 cut = uCut[i];
    highp float cy0 = cut.x;
    highp float cy1 = cut.y;
    if (uPixel > 0.5) {
      cy0 = (cut.x - uCam.y) * z * devScale;
      cy1 = (cut.y - uCam.y) * z * devScale;
    }
    bool wall = cut.z < 0.0 ? px.x < plateMin.x : px.x >= plateMax.x;
    if (wall && px.y >= cy0 && px.y < cy1) { band = 0.0; bandOut = 0.0; bandIn = 0.0; }
  }
  // Stroke and fill cover disjoint parts of the pixel, so they add.
  // The module stroke stops at the rim.
  if (uDimShape > 0.5) rim = 0.0;
  bandOut *= 1.0 - wallClear;
  bandIn *= 1.0 - wallClear;
  vec4 fillCol = uFill;
  if (uStripY.y > uStripY.x) {
    float sy0 = uStripY.x;
    float sy1 = uStripY.y;
    if (uPixel > 0.5) {
      sy0 = ceil((uStripY.x - uCam.y) * z * devScale - 0.5);
      sy1 = ceil((uStripY.y - uCam.y) * z * devScale - 0.5);
    }
    if (px.y >= sy0 && px.y < sy1) fillCol = uStripColor;
  }
  float strokeA = bandOut * strokeCol.a;
  float plateA = (1.0 - inner) * fillCol.a;
  // Behind the fill: what the fill lets through (fill alpha is per covered area, so the hidden band
  // is weighted by 1 - fill alpha).
  float behindA = bandIn * strokeCol.a * (1.0 - fillCol.a);
  if (uDimShape > 0.5 && uLight.w > 0.0) {
    float ld = length(vPx - uLight.xy) / max(uLight.z, 1.0);
    float near = uLight.w * exp(-2.0 * ld * ld);
    // 1: the ambient dark, lifted near the lamp. 2: a reflected shine, strongest near the lamp.
    // 3: the stroke glow rim, brightened near the lamp.
    float scale = uDimShape > 2.5 ? 1.0 + 2.5 * near : (uDimShape > 1.5 ? near : 1.0 - near);
    strokeA *= scale;
    plateA *= scale;
    behindA *= scale;
  } else if (uDimShape > 1.5 && uDimShape < 2.5) {
    strokeA = 0.0;
    plateA = 0.0;
    behindA = 0.0;
  }
  // A flagged jack's hole inside the plate rectangle: the workspace background under its ring, opaque,
  // so the module's stroke light (it follows loudness) does not show through the jack.
  float holeA = 0.0;
  strokeA += behindA;
  float baseA = (strokeA + plateA + holeA) * keep;
  float rimA = rim * rimCol.a;
  float a = baseA + rimA;
  if (a < 0.004) discard;
  vec3 baseRgb = (strokeCol.rgb * strokeA + fillCol.rgb * plateA + uJackBackdrop.rgb * holeA) / max(strokeA + plateA + holeA, 1e-4);
  vec3 rgb = (baseRgb * baseA + rimCol.rgb * rimA) / a;
  gl_FragColor = vec4(rgb, a);
}
`;
  // The shared context is WebGL2, where GLSL 1.00 has no derivatives
  // (OES_standard_derivatives is a WebGL1 extension). Shaders that use fwidth
  // are written in 1.00 style and lifted to 300 es here, where it is built in.
  function es3(source, stage) {
    let out = String(source).replace(/^\s*#extension[^\n]*\n/gm, "");
    out = out.replace(/\battribute\b/g, "in");
    out = out.replace(/\bvarying\b/g, stage === "fs" ? "in" : "out");
    if (stage === "fs") {
      out = out.replace(/\btexture2D\b/g, "texture").replace(/\bgl_FragColor\b/g, "fragColor");
      out = out.replace(/(precision \w+ float;\s*(?:#endif\s*)?)/, "$1out vec4 fragColor;\n");
    }
    return "#version 300 es\n" + out.replace(/^\s+/, "");
  }

  function link(gl, vs, fs, opts) {
    const v3 = !!opts?.es3;
    const v = compile(gl, gl.VERTEX_SHADER, v3 ? es3(vs, "vs") : vs, "vertex");
    const f = compile(gl, gl.FRAGMENT_SHADER, v3 ? es3(fs, "fs") : fs, "fragment");
    const program = gl.createProgram();
    gl.attachShader(program, v);
    gl.attachShader(program, f);
    gl.linkProgram(program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "link failed";
      gl.deleteProgram(program);
      throw new Error("link: " + log);
    }
    return program;
  }

  function ensure() {
    const dev = typeof global.nodeGraphPictureDevice === "function" ? global.nodeGraphPictureDevice() : null;
    const gl = dev?.gl || null;
    if (!gl || typeof gl.createShader !== "function" || gl.isContextLost?.()) return null;
    if (state && state.gl === gl) return state;
    if (failedGl === gl) return null;
    try {
      const program = link(gl, VS, FS, { es3: true });
      const imgProgram = link(gl, IMG_VS, IMG_FS);
      const outProgram = link(gl, OUT_VS, OUT_FS, { es3: true });
      const veilProgram = link(gl, OUT_VS, VEIL_FS);
      const lightProgram = link(gl, OUT_VS, LIGHT_FS, { es3: true });
      state = {
        gl,
        dev,
        program,
        outProgram,
        outBuf: gl.createBuffer(),
        outPos: gl.getAttribLocation(outProgram, "position"),
        outPx: gl.getAttribLocation(outProgram, "pixel"),
        outPlate: gl.getUniformLocation(outProgram, "uPlate"),
        outPlateColor: gl.getUniformLocation(outProgram, "uPlateColor"),
        outFill: gl.getUniformLocation(outProgram, "uFill"),
        outStripY: gl.getUniformLocation(outProgram, "uStripY"),
        outStripColor: gl.getUniformLocation(outProgram, "uStripColor"),
        outStroke: gl.getUniformLocation(outProgram, "uStroke"),
        outRound: gl.getUniformLocation(outProgram, "uRound"),
        outStrokeTop: gl.getUniformLocation(outProgram, "uStrokeTop"),
        outLight: gl.getUniformLocation(outProgram, "uLight"),
        outDimShape: gl.getUniformLocation(outProgram, "uDimShape"),
        outCount: gl.getUniformLocation(outProgram, "uCount"),
        outCutCount: gl.getUniformLocation(outProgram, "uCutCount"),
        outCut: gl.getUniformLocation(outProgram, "uCut[0]"),
        outJack: gl.getUniformLocation(outProgram, "uJack[0]"),
        outJackColor: gl.getUniformLocation(outProgram, "uJackColor[0]"),
        outJackBackdrop: gl.getUniformLocation(outProgram, "uJackBackdrop"),
        outCamPixel: gl.getUniformLocation(outProgram, "uPixel"),
        outCamCam: gl.getUniformLocation(outProgram, "uCam"),
        outCamVp: gl.getUniformLocation(outProgram, "uVp"),
        outCamDevice: gl.getUniformLocation(outProgram, "uDevice"),
        lightProgram,
        lightPos: gl.getAttribLocation(lightProgram, "position"),
        lightPx: gl.getAttribLocation(lightProgram, "pixel"),
        lightCount: gl.getUniformLocation(lightProgram, "uCount"),
        lightRect: gl.getUniformLocation(lightProgram, "uRect[0]"),
        lightGlow: gl.getUniformLocation(lightProgram, "uGlow[0]"),
        lightStroke: gl.getUniformLocation(lightProgram, "uStrokeRgb[0]"),
        lightGridMin: gl.getUniformLocation(lightProgram, "uGridMin"),
        lightSpread: gl.getUniformLocation(lightProgram, "uSpread"),
        lightGridOn: gl.getUniformLocation(lightProgram, "uGridOn"),
        lightGridCell: gl.getUniformLocation(lightProgram, "uGridCell"),
        lightGridRgba: gl.getUniformLocation(lightProgram, "uGridRgba"),
        lightGridSpread: gl.getUniformLocation(lightProgram, "uGridSpread"),
        lightGridDark: gl.getUniformLocation(lightProgram, "uGridDark"),
        lightGridLamp: gl.getUniformLocation(lightProgram, "uGridLamp"),
        lightGridReflect: gl.getUniformLocation(lightProgram, "uGridReflect"),
        lightGridMouseA: gl.getUniformLocation(lightProgram, "uGridMouseA"),
        lightGridLampMore: gl.getUniformLocation(lightProgram, "uGridLampMore"),
        lightModuleAmt: gl.getUniformLocation(lightProgram, "uModuleAmt"),
        lightMouse: gl.getUniformLocation(lightProgram, "uMouse"),
        lightZoomPx: gl.getUniformLocation(lightProgram, "uZoomPx"),
        lightPlate: gl.getUniformLocation(lightProgram, "uPlate"),
        lightCamPixel: gl.getUniformLocation(lightProgram, "uPixel"),
        lightCamCam: gl.getUniformLocation(lightProgram, "uCam"),
        lightCamVp: gl.getUniformLocation(lightProgram, "uVp"),
        lightCamDevice: gl.getUniformLocation(lightProgram, "uDevice"),
        veilProgram,
        veilPos: veilProgram ? gl.getAttribLocation(veilProgram, "position") : -1,
        veilPx: veilProgram ? gl.getAttribLocation(veilProgram, "pixel") : -1,
        veilRect: veilProgram ? gl.getUniformLocation(veilProgram, "uRect") : null,
        veilPeriod: veilProgram ? gl.getUniformLocation(veilProgram, "uPeriod") : null,
        veilFeather: veilProgram ? gl.getUniformLocation(veilProgram, "uFeather") : null,
        veilAlpha: veilProgram ? gl.getUniformLocation(veilProgram, "uAlpha") : null,
        veilCamPixel: veilProgram ? gl.getUniformLocation(veilProgram, "uPixel") : null,
        veilCamCam: veilProgram ? gl.getUniformLocation(veilProgram, "uCam") : null,
        veilCamVp: veilProgram ? gl.getUniformLocation(veilProgram, "uVp") : null,
        veilCamDevice: veilProgram ? gl.getUniformLocation(veilProgram, "uDevice") : null,
        buf: gl.createBuffer(),
        attribs: ["position", "local", "segLen", "halfPx", "feather", "caps", "colour"].map((n) => gl.getAttribLocation(program, n)),
        coverage: gl.getUniformLocation(program, "uCoverage"),
        camPixel: gl.getUniformLocation(program, "uPixel"),
        camCam: gl.getUniformLocation(program, "uCam"),
        camVp: gl.getUniformLocation(program, "uVp"),
        camDevice: gl.getUniformLocation(program, "uDevice"),
        lineDash: gl.getUniformLocation(program, "uDash"),
        lineEdge: gl.getUniformLocation(program, "uEdge"),
        spectralProfile: gl.getUniformLocation(program, "uSpectralProfile"),
        spectralColour: gl.getUniformLocation(program, "uSpectralColour"),
        spectralPhase: gl.getUniformLocation(program, "uSpectralPhase"),
        spectralDimPoint: gl.getUniformLocation(program, "uSpectralDimPoint"),
        spectralShape: gl.getUniformLocation(program, "uSpectralShape"),
        spectralPixelMode: gl.getUniformLocation(program, "uSpectralPixelMode"),
        spectralPixels: gl.getUniformLocation(program, "uSpectralPixels[0]"),
        imgProgram,
        imgBuf: gl.createBuffer(),
        imgTex: gl.createTexture(),
        imgAttribs: ["position", "uv", "vtint"].map((n) => gl.getAttribLocation(imgProgram, n)),
        // Cached textures for static image sources ({ cache: true }), keyed by source.
        texCache: new WeakMap(),
        tpool: [],
        imgTexLoc: gl.getUniformLocation(imgProgram, "tex"),
        imgAlphaLoc: gl.getUniformLocation(imgProgram, "alpha"),
        imgTintLoc: gl.getUniformLocation(imgProgram, "tint"),
        imgTextDark: gl.getUniformLocation(imgProgram, "uTextDark"),
        imgSnap: gl.getUniformLocation(imgProgram, "uSnap"),
        imgLamp: gl.getUniformLocation(imgProgram, "uLamp"),
        imgModeLoc: gl.getUniformLocation(imgProgram, "mode"),
        imgHoleCount: gl.getUniformLocation(imgProgram, "uHoleCount"),
        imgHoles: gl.getUniformLocation(imgProgram, "uHoles"),
        imgHoleAA: gl.getUniformLocation(imgProgram, "uHoleAA"),
        imgCamPixel: gl.getUniformLocation(imgProgram, "uPixel"),
        imgCamCam: gl.getUniformLocation(imgProgram, "uCam"),
        imgCamVp: gl.getUniformLocation(imgProgram, "uVp"),
        imgCamDevice: gl.getUniformLocation(imgProgram, "uDevice"),
        atlases: new Map(),
        // Colour emoji: pages [{ texture, x, y, rowH }], entries "emoji|px".
        emoji: { pages: [], entries: new Map(), canvas: null, ctx: null },
        pool: [],
      };
      return state;
    } catch (error) {
      failedGl = gl;
      state = null;
      // Error fields are not enumerable; log the info-log text itself.
      console.error("[gl-line-renderer] shader failed; faces show black: " + String(error?.message || error));
      return null;
    }
  }

  /**
   * Start a frame for a face canvas (device px, y down).
   * options: { scale } -> coordinates in CSS px; { publishNodeId } -> force the
   * node id used for the rgba picture out (default: the canvas's .dsp-node).
   * @returns {object|null} batch, or null -> caller fills black.
   */
  function nodeGraphGlLinesBegin(canvas, clearRgba = [0, 0, 0, 1], options = {}) {
    if (!canvas) return null;
    const w = Math.max(1, canvas.width | 0);
    const h = Math.max(1, canvas.height | 0);
    if (w > MAX_DIM || h > MAX_DIM) return null;
    const s = ensure();
    if (!s) return null;
    const scale = Number(options?.scale) > 0 ? Number(options.scale) : 1;
    // Display text grows with its Performance view tile (pixel for pixel, no
    // stretched bitmap). Callers that size text themselves pass textInk: false.
    const textInk = options?.textInk === false ? 1 : nodeGraphGlLinesInkScale(canvas);
    return {
      s, canvas, w, h, clear: clearRgba, data: s.pool.pop() || new Float32Array(16384), n: 0, images: [], texts: [], blend: "alpha", scale, textInk,
      // Glyph quads for every text call: pos2 uv2 rgba4 per vertex, one draw per atlas run.
      tdata: s.tpool.pop() || new Float32Array(4096), tn: 0,
      publishNodeId: options?.publishNodeId,
      outlines: [],
      veils: [],
      // Quads drawn after the plate fill (slider wells, keys) so the fill
      // does not cover them. Text still draws after these.
      over: null,
      on: 0,
      _over: false,
      gdata: null,
      gn: 0,
      _glow: false,
      // transparent: overlay faces; the 2D blit target is cleared first.
      transparent: options?.transparent === true,
      // Blit over the 2D canvas instead of clearing it first.
      keep: options?.keep === true,
      // World-pixel camera. Positions stay in CSS px; the vertex shader applies pan/zoom.
      camera: options?.camera || null,
      // Keep the vertex arrays so a later camera change can redraw without rebuilding them.
      keepMesh: options?.keepMesh === true,
      // Camera text never bakes a missing atlas size inside the record (see textAtlasQueue).
      lazyText: options?.lazyText === true,
      // Face text bakes per exact device-pixel size; the view tiles opt out (exactText false).
      exactText: options?.exactText !== false,
      // Edge kind (APP_POLICY section 3): "chrome" = smootherstep for the
      // circuit builder's fixed-width edges; anything else = display Expo skirt.
      edge: options?.edge === "chrome" ? "chrome" : "display",
      spectralWire: options?.spectralWire || null,
    };
  }

  /**
   * A sub-layer of batch on the same colour buffer: drawn after the batch's own
   * content and its earlier layers, with its own images, quads, outlines and
   * text (in that order inside the layer). The GL graph draws one module stack
   * per layer group, back to front (docs/DISPLAY_COMPOSITE_LAYERING_PLAN.md
   * 4.2). Camera, pixelated text and keepMesh follow the parent at draw time.
   */
  function nodeGraphGlLinesLayer(batch) {
    if (!batch?.s) return null;
    const layer = {
      s: batch.s, canvas: batch.canvas, w: batch.w, h: batch.h, clear: batch.clear,
      data: new Float32Array(FLOATS * 96), n: 0, images: [], texts: [], blend: batch.blend,
      scale: batch.scale, textInk: batch.textInk,
      tdata: new Float32Array(48 * 16), tn: 0,
      publishNodeId: batch.publishNodeId,
      outlines: [],
      veils: [],
      over: null,
      on: 0,
      _over: false,
      gdata: null,
      gn: 0,
      _glow: false,
      transparent: batch.transparent,
      keep: batch.keep,
      camera: batch.camera,
      keepMesh: batch.keepMesh,
      lazyText: batch.lazyText,
      edge: batch.edge,
      spectralWire: batch.spectralWire,
      textPixelated: batch.textPixelated,
    };
    if (!batch.layers) batch.layers = [];
    batch.layers.push(layer);
    return layer;
  }

  function bindCam(gl, locs, batch) {
    if (!locs || locs.pixel == null) return;
    const cam = batch?.camera;
    if (!cam) {
      gl.uniform1f(locs.pixel, 0);
      return;
    }
    gl.uniform1f(locs.pixel, 1);
    gl.uniform3f(locs.cam, cam.x || 0, cam.y || 0, cam.zoom > 0 ? cam.zoom : 1);
    gl.uniform2f(locs.vp, batch.w, batch.h);
    gl.uniform1f(locs.device, batch.scale > 0 ? batch.scale : 1);
  }

  function lineCamLocs(s) {
    return { pixel: s.camPixel, cam: s.camCam, vp: s.camVp, device: s.camDevice };
  }

  function push(batch, x, y, lu, lv, len, half, feather, c, caps) {
    // A layer can send what is drawn "over" (a module's face: slider wells and fills) to a later layer,
    // after the ambient dim, with its own strength: a weak light source of its own (no spill).
    let alphaMul = 1;
    if (batch._over && batch.overLayer) {
      const target = batch.overLayer;
      alphaMul = target.alphaMul > 0 ? target.alphaMul : 1;
      batch = target;
    }
    // Vertices go straight into a pooled Float32Array (no per-frame JS arrays).
    const glow = batch._glow === true;
    const over = !glow && batch._over === true;
    let d = glow ? batch.gdata : (over ? batch.over : batch.data);
    let i = glow ? batch.gn : (over ? batch.on : batch.n);
    if (!d) d = new Float32Array(4096);
    if (i + FLOATS > d.length) {
      const grown = new Float32Array(d.length * 2);
      grown.set(d);
      d = grown;
    }
    if (batch.camera) {
      d[i] = x; d[i + 1] = y;
    } else {
      d[i] = (x / batch.w) * 2 - 1; d[i + 1] = 1 - (y / batch.h) * 2;
    }
    d[i + 2] = lu; d[i + 3] = lv; d[i + 4] = len; d[i + 5] = half; d[i + 6] = feather;
    d[i + 7] = caps || 0;
    d[i + 8] = c[0]; d[i + 9] = c[1]; d[i + 10] = c[2]; d[i + 11] = (c.length > 3 ? c[3] : 1) * alphaMul;
    if (glow) {
      batch.gdata = d;
      batch.gn = i + FLOATS;
    } else if (over) {
      batch.over = d;
      batch.on = i + FLOATS;
    } else {
      batch.data = d;
      batch.n = i + FLOATS;
    }
  }

  /** Solid axis-aligned rect. */
  function nodeGraphGlLinesRect(batch, x, y, w, h, rgba) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    if (k !== 1) { x *= k; y *= k; w *= k; h *= k; }
    const big = 1e6;
    const q = [[x, y], [x + w, y], [x, y + h], [x + w, y], [x + w, y + h], [x, y + h]];
    for (const [px, py] of q) push(batch, px, py, 0, 0, 0, big, 0, rgba);
  }

  /**
   * Horizontal plate fade: opaque at x, clear at x+w, quadratic ease (a*a)
   * and Soem ordered dither so an 8-bit present does not band.
   */
  function nodeGraphGlLinesFadeRect(batch, x, y, w, h, rgba) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    if (k !== 1) { x *= k; y *= k; w *= k; h *= k; }
    const big = 1e6;
    const caps = 11;
    const q = [
      [x, y, 0],
      [x + w, y, 1],
      [x, y + h, 0],
      [x + w, y, 1],
      [x + w, y + h, 1],
      [x, y + h, 0],
    ];
    for (const [px, py, t] of q) push(batch, px, py, t, 0, 0, big, 0, rgba, caps);
  }

  /** Solid triangle (fills, areas). */
  function nodeGraphGlLinesTriangle(batch, x0, y0, x1, y1, x2, y2, rgba) {
    if (!batch) return;
    const k = batch.scale || 1;
    const big = 1e6;
    push(batch, x0 * k, y0 * k, 0, 0, 0, big, 0, rgba);
    push(batch, x1 * k, y1 * k, 0, 0, 0, big, 0, rgba);
    push(batch, x2 * k, y2 * k, 0, 0, 0, big, 0, rgba);
  }

  /** Solid area between a polyline [x0,y0,x1,y1,...] and the horizontal line y = baseY. */
  function nodeGraphGlLinesFillUnder(batch, points, baseY, rgba) {
    if (!batch || !points || points.length < 4) return;
    for (let i = 2; i < points.length; i += 2) {
      const x0 = points[i - 2]; const y0 = points[i - 1];
      const x1 = points[i]; const y1 = points[i + 1];
      nodeGraphGlLinesTriangle(batch, x0, y0, x1, y1, x0, baseY, rgba);
      nodeGraphGlLinesTriangle(batch, x1, y1, x1, baseY, x0, baseY, rgba);
    }
  }

  // Keep the stroke quad inside the canvas. A zoomed segment whose ends are
  // far offscreen becomes a huge quad, and the GPU drops the whole primitive
  // even when the middle crosses the view.
  function clipLineToRect(x0, y0, x1, y1, minX, minY, maxX, maxY) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let u0 = 0;
    let u1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - minX, maxX - x0, y0 - minY, maxY - y0];
    for (let i = 0; i < 4; i += 1) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > u1) return null;
          if (t > u0) u0 = t;
        } else {
          if (t < u0) return null;
          if (t < u1) u1 = t;
        }
      }
    }
    return [x0 + u0 * dx, y0 + u0 * dy, x0 + u1 * dx, y0 + u1 * dy];
  }

  /**
   * Capsule segment (x0,y0)-(x1,y1): solid core halfPx, then `feather` px of
   * the batch's edge (display Expo / chrome smootherstep). Round ends/joins.
   */
  function nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba, caps) {
    if (!batch) return;
    const square = caps === "square" || caps === 1;
    if (batch.camera && (square || !(Math.hypot(x1 - x0, y1 - y0) > 1e-4))) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const ux = len > 1e-6 ? dx / len : 1;
      const uy = len > 1e-6 ? dy / len : 0;
      const nx = -uy;
      const ny = ux;
      const half = Math.max(0, halfPx);
      const fade = Math.max(0, feather);
      if (!(len > 1e-4)) {
        const corner = (sx, sy) => [x0, y0, sx, sy];
        const quad = [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        for (let i = 0; i < quad.length; i += 1) {
          const v = quad[i];
          push(batch, v[0], v[1], v[2], v[3], 0, half, fade, rgba, 4);
        }
        return;
      }
      const end = (x, y, side) => push(batch, x, y, nx, ny, 0, half, fade, rgba, side > 0 ? 3 : 3.5);
      end(x0, y0, 1); end(x0, y0, -1); end(x1, y1, 1);
      end(x0, y0, -1); end(x1, y1, -1); end(x1, y1, 1);
      return;
    }
    const k = batch.camera ? 1 : (batch.scale || 1);
    if (k !== 1) { x0 *= k; y0 *= k; x1 *= k; y1 *= k; halfPx *= k; feather *= k; }
    const reach = Math.max(0, halfPx) + Math.max(0, feather) + 4;
    // Camera batches hold world coordinates: batch.w/h is the screen, not a world
    // rect, so clipping there dropped strokes at negative world x/y (face LFO snips
    // vanished by module position). The GPU clips those.
    const clipped = batch.camera ? [x0, y0, x1, y1] : clipLineToRect(
      x0, y0, x1, y1,
      -reach, -reach, batch.w + reach, batch.h + reach,
    );
    if (!clipped) return;
    x0 = clipped[0];
    y0 = clipped[1];
    x1 = clipped[2];
    y1 = clipped[3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const ux = len > 1e-6 ? dx / len : 0;
    const uy = len > 1e-6 ? dy / len : 1;
    const nx = -uy;
    const ny = ux;
    const r = Math.max(0, halfPx) + Math.max(0, feather);
    const alongPad = square ? 0 : r;
    const capFlag = square ? 1 : 0;
    const corner = (along, across) => [
      x0 + ux * along + nx * across,
      y0 + uy * along + ny * across,
      along,
      across,
    ];
    const a = corner(-alongPad, -r);
    const b = corner(len + alongPad, -r);
    const c = corner(-alongPad, r);
    const d = corner(len + alongPad, r);
    for (const v of [a, b, c, b, d, c]) push(batch, v[0], v[1], v[2], v[3], len, halfPx, feather, rgba, capFlag);
  }

  /**
   * Analytic ring (distance field, no segments): circle of radius r centred at
   * (x,y), solid core halfPx either side of r, then `feather` px of Expo skirt
   * fade - the same edge as nodeGraphGlLinesSegment / nodeGraphGlLinesDot.
   */
  function nodeGraphGlLinesRing(batch, x, y, r, halfPx, feather, rgba) {
    if (!batch) return;
    let R = Math.max(0, r);
    let half = Math.max(0, halfPx);
    let fade = Math.max(0, feather);
    if (!batch.camera) {
      const k = batch.scale || 1;
      if (k !== 1) { x *= k; y *= k; R *= k; half *= k; fade *= k; }
    }
    const e = R + half + fade + 1;
    const corner = (sx, sy) => [x + sx * e, y + sy * e, sx * e, sy * e];
    const quad = [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (let i = 0; i < quad.length; i += 1) {
      const v = quad[i];
      push(batch, v[0], v[1], v[2], v[3], R, half, fade, rgba, 10);
    }
  }

  /** Round dot (zero-length capsule) of radius r. */
  function nodeGraphGlLinesDot(batch, x, y, r, feather, rgba) {
    nodeGraphGlLinesSegment(batch, x, y, x, y, r, feather, rgba);
  }

  /**
   * Instanced Pulse Train stems + dots. The vertex shader evaluates the same
   * E_k schedule as pulse_train.cpp (t_i = End * E_curve(u_i)) from
   * gl_InstanceID, so Count can be 16384 without a CPU vertex per pulse.
   * spec: count, duration (Time s), axisEnd (x-axis s), curve, spacing, ampStart,
   * ampEnd, ampCurve, amplitude, loop, x0, x1, base, top, peak, halfPx,
   * feather, dotR, elapsed (NaN idle), fadeTau (s, 0 = hold), line/dot/lit rgba.
   */
  function nodeGraphGlLinesPulseTrain(batch, spec) {
    if (!batch || !spec) return;
    const nFwd = Math.max(0, Math.min(PULSE_TRAIN_MAX, spec.count | 0));
    const total = Math.max(nFwd, Math.min(PULSE_TRAIN_MAX, spec.total | 0 || nFwd));
    const pulseMode = Number(spec.pulseMode);
    const p = !(pulseMode > 0) ? 0 : (pulseMode >= 1 ? 1 : pulseMode);
    const polarity = Number(spec.polarity) > 0.5 ? 1 : 0;
    const n = p > 0 ? total : nFwd;
    if (!(n > 0)) return;
    if (!batch.pulseTrains) batch.pulseTrains = [];
    const k = batch.camera ? 1 : (batch.scale || 1);
    const rgba = (c) => {
      const a = c && c.length > 3 ? c[3] : 1;
      return [c?.[0] || 0, c?.[1] || 0, c?.[2] || 0, Number.isFinite(a) ? a : 1];
    };
    batch.pulseTrains.push({
      count: n,
      nFwd: nFwd,
      pulseMode: p,
      polarity,
      duration: Number(spec.duration) || 0,
      axisEnd: Math.max(1e-6, Number(spec.axisEnd) || 0.001),
      curve: Number(spec.curve) || 0,
      spacing: Number(spec.spacing) || 0,
      ampStart: Number(spec.ampStart) || 0,
      ampEnd: Number(spec.ampEnd) || 0,
      ampCurve: Number(spec.ampCurve) || 0,
      amplitude: Number(spec.amplitude) || 0,
      loop: spec.loop ? 1 : 0,
      x0: (Number(spec.x0) || 0) * k,
      x1: (Number(spec.x1) || 0) * k,
      base: (Number(spec.base) || 0) * k,
      top: (Number(spec.top) || 0) * k,
      peak: Math.max(1e-12, Number(spec.peak) || 1),
      half: Math.max(0, Number(spec.halfPx) || 0) * k,
      feather: Math.max(0, Number(spec.feather) || 0) * k,
      dotR: Math.max(0, Number(spec.dotR) || 0) * k,
      elapsed: Number.isFinite(spec.elapsed) ? spec.elapsed : -1,
      fadeTau: Math.max(0, Number(spec.fadeTau) || 0),
      line: rgba(spec.line),
      dot: rgba(spec.dot),
      lit: rgba(spec.lit),
    });
  }

  /**
   * Rounded rectangle with an inside stroke, one SDF per pixel: the stroke and
   * fill share the box's distance field, so straight edges and corners are one
   * continuous shape (the CSS border-box look: stroke inside the edge, the fill
   * corner radius = radius - stroke). Edges use the app Expo curve, centred
   * on the edge, `feather` CSS px wide. Drawn after the "over" quads, before
   * text, one instanced call per batch.
   * spec: { radius, stroke, feather = 1, fill: rgba, strokeRgba: rgba,
   *         fillBottom: rgba (optional vertical gradient: fill at the top
   *         edge, fillBottom at the bottom), radiusTop (optional: top corners
   *         use this radius, bottom corners use radius) }
   * x / y / w / h / radius / stroke are batch units (world px under a camera).
   */
  function nodeGraphGlLinesRoundRect(batch, x, y, w, h, spec = {}) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    if (!batch.roundRects) batch.roundRects = [];
    const f = spec.fill || [0, 0, 0, 0];
    const fb = spec.fillBottom || f;
    const st = spec.strokeRgba || f;
    const feather = Number.isFinite(Number(spec.feather)) ? Math.max(0, Number(spec.feather)) : 1;
    const radius = Math.max(0, Number(spec.radius) || 0);
    const radiusTop = Number.isFinite(Number(spec.radiusTop)) ? Math.max(0, Number(spec.radiusTop)) : radius;
    batch.roundRects.push(
      x, y, w, h,
      radius, Math.max(0, Number(spec.stroke) || 0), feather, radiusTop,
      f[0] || 0, f[1] || 0, f[2] || 0, f.length > 3 ? f[3] : 1,
      st[0] || 0, st[1] || 0, st[2] || 0, st.length > 3 ? st[3] : 1,
      fb[0] || 0, fb[1] || 0, fb[2] || 0, fb.length > 3 ? fb[3] : 1,
    );
  }

  /**
   * Polyline: the app-wide antialiased line. Default (round) is the app
   * stroke (nodeGraphGlLinesStroke): exact capsules MAX-merged per colour, so
   * joints and hairpins never double-blend or pinch; `feather` is the soft
   * edge (pass ~1 device px). caps "butt" ends each segment flat.
   * caps "ortho" is for axis-aligned traces: at each corner the segment runs
   * to the far edge of the crossing stroke, so the corner square is covered
   * by overlap. No diagonal.
   */
  function nodeGraphGlLinesPolyline(batch, points, halfPx, feather, rgba, caps) {
    if (!batch || !points || points.length < 4) return;
    const square = caps === "square" || caps === "butt" || caps === "ortho" || caps === 1;
    const ortho = caps === "ortho";
    if (!square) {
      const joined = [points[0], points[1]];
      for (let i = 2; i < points.length; i += 2) {
        if (points[i] === joined[joined.length - 2] && points[i + 1] === joined[joined.length - 1]) continue;
        joined.push(points[i], points[i + 1]);
      }
      if (joined.length >= 4) nodeGraphGlLinesStroke(batch, joined, halfPx, feather, rgba);
      return;
    }
    const reachScale = batch.camera ? (batch.camera.zoom > 0 ? batch.camera.zoom : 1) : 1;
    const reach = (Math.max(0, halfPx) + Math.max(0, feather)) / reachScale;
    const segs = [];
    for (let i = 2; i < points.length; i += 2) {
      const x0 = points[i - 2];
      const y0 = points[i - 1];
      const x1 = points[i];
      const y1 = points[i + 1];
      if (x0 === x1 && y0 === y1) continue;
      segs.push({ x0, y0, x1, y1 });
    }
    for (let s = 0; s < segs.length; s += 1) {
      let { x0, y0, x1, y1 } = segs[s];
      if (ortho) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        if (s > 0) { x0 -= ux * reach; y0 -= uy * reach; }
        if (s < segs.length - 1) { x1 += ux * reach; y1 += uy * reach; }
      }
      nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, halfPx, feather, rgba, square ? 1 : 0);
    }
  }

  // One continuous ribbon. Neighboring pieces share the edge points, so a bend
  // has no end cap and no gap. `across` is the distance from the centerline.
  // Solid rgba. dip > 0: per-vertex darkening of RGB around the middle of the
  // arc length (cosine bell over half-width dipWidth / 2), alpha unchanged.
  function nodeGraphGlLinesRibbon(batch, points, halfPx, feather, rgba, dip = 0, dipWidth = 0.5, options = null) {
    if (!batch || !points || points.length < 4) return;
    const spectral = options?.spectral === true;
    if (spectral && !batch.spectralWire) batch.spectralWire = SPECTRAL_WIRE_DEFAULTS;
    // Dip: colour is per vertex, so subdivide the polyline (straight
    // splits, shape unchanged) until no piece is longer than 1/128 of the
    // arc, enough for the dip bell to read smooth on uneven (adaptive) pieces.
    const hw = dipWidth / 2;
    const dipping = !spectral && dip > 0 && hw > 0;
    if (dipping) {
      const segs = points.length / 2 - 1;
      let total = 0;
      for (let i = 0; i < segs; i += 1) {
        total += Math.hypot(points[i * 2 + 2] - points[i * 2], points[i * 2 + 3] - points[i * 2 + 1]);
      }
      const step = total > 0 ? total / 128 : 1;
      const dense = [];
      for (let i = 0; i < segs; i += 1) {
        const ax = points[i * 2]; const ay = points[i * 2 + 1];
        const bx = points[i * 2 + 2]; const by = points[i * 2 + 3];
        const sub = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
        for (let j = 0; j < sub; j += 1) {
          const f = j / sub;
          dense.push(ax + (bx - ax) * f, ay + (by - ay) * f);
        }
      }
      dense.push(points[points.length - 2], points[points.length - 1]);
      points = dense;
    }
    const k = batch.camera ? 1 : (batch.scale || 1);
    const r = Math.max(0, halfPx) + Math.max(0, feather);
    const count = points.length / 2;
    const spectralArc = spectral ? new Float32Array(count) : null;
    if (spectralArc) for (let i = 1; i < count; i += 1) {
      spectralArc[i] = spectralArc[i - 1] + Math.hypot(points[i * 2] - points[i * 2 - 2], points[i * 2 + 1] - points[i * 2 - 1]);
    }
    const dirX = new Float32Array(count);
    const dirY = new Float32Array(count);
    for (let i = 0; i < count - 1; i += 1) {
      let dx = points[(i + 1) * 2] - points[i * 2];
      let dy = points[(i + 1) * 2 + 1] - points[i * 2 + 1];
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) { dirX[i] = 1; dirY[i] = 0; continue; }
      dirX[i] = dx / len;
      dirY[i] = dy / len;
    }
    dirX[count - 1] = dirX[count - 2] || 1;
    dirY[count - 1] = dirY[count - 2] || 0;
    const miter = (index) => {
      const ax = index === 0 ? dirX[0] : dirX[index - 1];
      const ay = index === 0 ? dirY[0] : dirY[index - 1];
      const bx = dirX[Math.min(index, count - 2)];
      const by = dirY[Math.min(index, count - 2)];
      const n0x = -ay;
      const n0y = ax;
      const n1x = -by;
      const n1y = bx;
      let nx = n0x + n1x;
      let ny = n0y + n1y;
      const nl = Math.hypot(nx, ny);
      if (!(nl > 1e-4)) return [n0x, n0y];
      nx /= nl;
      ny /= nl;
      const dot = nx * n0x + ny * n0y;
      // A wide miter at a fast turn becomes a visible, rotating triangle at
      // waveform resolution. Keep the two neighbouring segments on one shared
      // edge, but cap the extension near the stroke width. This is the common
      // polyline rule: a limited miter, never a per-sample cap.
      const minMiterDot = 0.72;
      const scale = dot > minMiterDot ? 1 / dot : 1 / minMiterDot;
      return [nx * scale, ny * scale];
    };
    const edge = [];
    for (let i = 0; i < count; i += 1) edge.push(miter(i));
    let ink = null;
    if (dipping) {
      const arc = new Float32Array(count);
      for (let i = 1; i < count; i += 1) {
        arc[i] = arc[i - 1] + Math.hypot(points[i * 2] - points[(i - 1) * 2], points[i * 2 + 1] - points[(i - 1) * 2 + 1]);
      }
      const total = arc[count - 1] > 0 ? arc[count - 1] : 1;
      ink = [];
      for (let i = 0; i < count; i += 1) {
        const d = Math.abs(arc[i] / total - 0.5) / hw;
        const m = d < 1 ? 1 - dip * (0.5 + 0.5 * Math.cos(Math.PI * d)) : 1;
        ink.push([(rgba[0] ?? 1) * m, (rgba[1] ?? 1) * m, (rgba[2] ?? 1) * m, rgba[3] ?? 1]);
      }
    }
    for (let i = 0; i < count - 1; i += 1) {
      const x0 = points[i * 2] * k;
      const y0 = points[i * 2 + 1] * k;
      const x1 = points[(i + 1) * 2] * k;
      const y1 = points[(i + 1) * 2 + 1] * k;
      if (x0 === x1 && y0 === y1) continue;
      const n0 = edge[i];
      const n1 = edge[i + 1];
      const half = Math.max(0, halfPx) * (batch.camera ? 1 : k);
      const fade = Math.max(0, feather) * (batch.camera ? 1 : k);
      if (batch.camera) {
        const c0 = ink ? ink[i] : rgba;
        const c1 = ink ? ink[i + 1] : rgba;
        const end = (x, y, n, side, c, index) => push(batch, x, y, n[0], n[1], spectralArc ? spectralArc[index] : 0, half, fade, c, spectral ? (side > 0 ? 12 : 12.5) : (side > 0 ? 3 : 3.5));
        end(x0, y0, n0, 1, c0, i); end(x0, y0, n0, -1, c0, i); end(x1, y1, n1, 1, c1, i + 1);
        end(x0, y0, n0, -1, c0, i); end(x1, y1, n1, -1, c1, i + 1); end(x1, y1, n1, 1, c1, i + 1);
        continue;
      }
      const rk = r * k;
      const quad = [
        [x0 + n0[0] * rk, y0 + n0[1] * rk, rk],
        [x0 - n0[0] * rk, y0 - n0[1] * rk, -rk],
        [x1 + n1[0] * rk, y1 + n1[1] * rk, rk],
        [x1 - n1[0] * rk, y1 - n1[1] * rk, -rk],
      ];
      const tri = [0, 1, 2, 1, 3, 2];
      for (let t = 0; t < tri.length; t += 1) {
        const v = quad[tri[t]];
        const index = tri[t] < 2 ? i : i + 1;
        push(batch, v[0], v[1], spectralArc ? spectralArc[index] : 0, v[2], spectralArc ? spectralArc[index] : 0, half, fade, ink ? ink[index] : rgba, spectral ? 12 : 1);
      }
    }
  }

  // ---------------------------------------------------------------- Stroke --
  // The app's one line stroke (round Polyline, nodeGraphGlLinesStroke and the
  // nodeGraphGlLinesPresentFrame line faces). Each segment is a capsule; the
  // fragment shader takes the exact distance to the segment at 4x4 sub-pixel
  // offsets and applies the batch edge (display Expo skirt / chrome
  // smootherstep) with a solid core out to halfPx. Consecutive strokes of one
  // colour are MAX-merged in a coverage target first, so joints, hairpins
  // (square waves, Gibbs spikes) and dots on the line never double-blend or
  // pinch; the coverage is then composited over the face in call order
  // between the batch's quads (main and "over" layers).
  const STROKE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aSeg;
layout(location = 2) in vec2 aHF;
uniform float uPixel;
uniform vec3 uCam;
uniform float uDevice;
uniform vec2 uSize;
out vec2 vPos;
flat out vec4 vSeg;
flat out vec2 vHF;
void main() {
  vec4 s = aSeg;
  vec2 hf = aHF;
  if (uPixel > 0.5) {
    // Camera: points and half width are world px (x zoom x device), the
    // feather is screen CSS px (x device), as nodeGraphGlLinesRoundRect.
    float k = max(uCam.z, 0.0001) * uDevice;
    s = vec4((s.xy - uCam.xy) * k, (s.zw - uCam.xy) * k);
    hf = vec2(hf.x * k, hf.y * uDevice);
  }
  vec2 p0 = s.xy;
  vec2 p1 = s.zw;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 u = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-u.y, u.x);
  float reach = hf.x + hf.y + 2.0;
  vec2 pos = mix(p0 - u * reach, p1 + u * reach, aCorner.x) + n * reach * (aCorner.y * 2.0 - 1.0);
  vPos = pos;
  vSeg = s;
  vHF = hf;
  gl_Position = vec4(pos.x / uSize.x * 2.0 - 1.0, 1.0 - pos.y / uSize.y * 2.0, 0.0, 1.0);
}`;
  const STROKE_FS = `#version 300 es
precision highp float;
in vec2 vPos;
flat in vec4 vSeg;
flat in vec2 vHF;
out vec4 fragColor;
uniform float uEdge;
float edgeCurve(float t) {
  if (uEdge > 0.5) return 1.0 - t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  return ${NODE_GRAPH_GL_LINES_EXPO_SKIRT_GLSL};
}
float segDist(vec2 p) {
  vec2 a = vSeg.xy;
  vec2 ba = vSeg.zw - a;
  vec2 pa = p - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-12), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  float halfW = max(vHF.x, 0.0);
  float feather = max(vHF.y, 1e-4);
  float acc = 0.0;
  for (int j = 0; j < 4; j += 1) {
    for (int i = 0; i < 4; i += 1) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) * 0.25 - 0.5;
      float d = segDist(vPos + o);
      acc += d <= halfW ? 1.0 : edgeCurve(clamp((d - halfW) / feather, 0.0, 1.0));
    }
  }
  fragColor = vec4(acc * 0.0625, 0.0, 0.0, 1.0);
}`;
  const STROKE_COMP_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
  const STROKE_COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uCov;
uniform ivec2 uOrigin;
uniform vec4 uColour;
out vec4 fragColor;
void main() {
  float c = texelFetch(uCov, ivec2(gl_FragCoord.xy) - uOrigin, 0).r;
  if (c < 0.004) discard;
  fragColor = vec4(uColour.rgb, uColour.a * c);
}`;
  const STROKE_FLOATS = 6; // x0 y0 x1 y1 half feather

  function ensureStroke(s) {
    if (!s || s.strokeFailed) return null;
    if (s.stroke) return s.stroke;
    const gl = s.gl;
    if (!gl || typeof gl.drawArraysInstanced !== "function" || typeof gl.createVertexArray !== "function") {
      s.strokeFailed = true;
      return null;
    }
    try {
      const build = (vsSrc, fsSrc, name) => {
        const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, name + " vertex");
        const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, name + " fragment");
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          const log = gl.getProgramInfoLog(program) || "link failed";
          gl.deleteProgram(program);
          throw new Error(name + ": " + log);
        }
        return program;
      };
      const program = build(STROKE_VS, STROKE_FS, "stroke");
      const comp = build(STROKE_COMP_VS, STROKE_COMP_FS, "stroke composite");
      const vao = gl.createVertexArray();
      const corner = gl.createBuffer();
      const inst = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, corner);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STROKE_FLOATS * 4, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STROKE_FLOATS * 4, 16);
      gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const u = (prog, name) => gl.getUniformLocation(prog, name);
      s.stroke = {
        program,
        comp,
        vao,
        inst,
        emptyVao: gl.createVertexArray(),
        cov: null,
        uPixel: u(program, "uPixel"),
        uCam: u(program, "uCam"),
        uDevice: u(program, "uDevice"),
        uSize: u(program, "uSize"),
        uEdge: u(program, "uEdge"),
        uCov: u(comp, "uCov"),
        uOrigin: u(comp, "uOrigin"),
        uColour: u(comp, "uColour"),
      };
      return s.stroke;
    } catch (error) {
      s.strokeFailed = true;
      console.error("[gl-line-renderer] stroke shader failed: " + String(error?.message || error));
      return null;
    }
  }

  function ensureStrokeCoverage(st, gl, w, h) {
    if (!st.cov) st.cov = { tex: gl.createTexture(), fbo: gl.createFramebuffer(), w: 0, h: 0 };
    if (st.cov.w === w && st.cov.h === h) return st.cov;
    gl.bindTexture(gl.TEXTURE_2D, st.cov.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.cov.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, st.cov.tex, 0);
    st.cov.w = w;
    st.cov.h = h;
    return st.cov;
  }

  /**
   * The app line: points [x0,y0,x1,y1,...] (batch units, like Polyline) as one
   * stroke, solid core halfPx then `feather` px of the batch edge. A
   * non-finite point breaks the line; a lone point is a round dot of radius
   * halfPx. Drawn in call order between the batch's quads.
   */
  function nodeGraphGlLinesStroke(batch, points, halfPx, feather, rgba) {
    if (!batch || !points || points.length < 2) return;
    if (batch._glow === true || !ensureStroke(batch.s)) {
      if (points.length >= 4) nodeGraphGlLinesRibbon(batch, points, halfPx, feather, rgba);
      else nodeGraphGlLinesDot(batch, points[0], points[1], halfPx, feather, rgba);
      return;
    }
    const over = batch._over === true;
    const at = over ? batch.on : batch.n;
    const c = rgba || [1, 1, 1, 1];
    const col = [c[0] || 0, c[1] || 0, c[2] || 0, c.length > 3 && Number.isFinite(c[3]) ? c[3] : 1];
    if (!batch.strokes) batch.strokes = [];
    let g = batch.strokes[batch.strokes.length - 1];
    if (!g || g.over !== over || g.at !== at
      || g.rgba[0] !== col[0] || g.rgba[1] !== col[1] || g.rgba[2] !== col[2] || g.rgba[3] !== col[3]) {
      g = { over, at, rgba: col, data: new Float32Array(256), n: 0 };
      batch.strokes.push(g);
    }
    const cam = !!batch.camera;
    const k = cam ? 1 : (batch.scale || 1);
    const half = Math.max(0, Number(halfPx) || 0) * k;
    const fade = Math.max(0, Number(feather) || 0) * k;
    const reach = half + fade + 4;
    const add = (x0, y0, x1, y1) => {
      if (!cam) {
        const clipped = clipLineToRect(x0, y0, x1, y1, -reach, -reach, batch.w + reach, batch.h + reach);
        if (!clipped) return;
        x0 = clipped[0]; y0 = clipped[1]; x1 = clipped[2]; y1 = clipped[3];
      }
      if (g.n + STROKE_FLOATS > g.data.length) {
        const grown = new Float32Array(g.data.length * 2);
        grown.set(g.data);
        g.data = grown;
      }
      const d = g.data;
      const i = g.n;
      d[i] = x0; d[i + 1] = y0; d[i + 2] = x1; d[i + 3] = y1; d[i + 4] = half; d[i + 5] = fade;
      g.n = i + STROKE_FLOATS;
    };
    const count = (points.length / 2) | 0;
    let px = NaN;
    let py = NaN;
    let run = 0;
    for (let i = 0; i < count; i += 1) {
      const x = Number(points[i * 2]) * k;
      const y = Number(points[i * 2 + 1]) * k;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        if (run === 1) add(px, py, px, py);
        run = 0;
        continue;
      }
      if (run > 0 && (x !== px || y !== py)) add(px, py, x, y);
      px = x;
      py = y;
      run += 1;
    }
    if (run === 1) add(px, py, px, py);
  }

  function drawStrokeGroup(batch, g, blend, colourDst, alphaDst) {
    const st = ensureStroke(batch.s);
    const count = (g.n / STROKE_FLOATS) | 0;
    if (!st || !(count > 0)) return;
    const gl = batch.s.gl;
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const vp = gl.getParameter(gl.VIEWPORT);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    const vw = Math.max(1, vp[2] | 0);
    const vh = Math.max(1, vp[3] | 0);
    const cov = ensureStrokeCoverage(st, gl, vw, vh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cov.fbo);
    gl.viewport(0, 0, vw, vh);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(st.program);
    const cam = batch.camera;
    gl.uniform1f(st.uPixel, cam ? 1 : 0);
    gl.uniform3f(st.uCam, cam?.x || 0, cam?.y || 0, cam?.zoom > 0 ? cam.zoom : 1);
    gl.uniform1f(st.uDevice, batch.scale > 0 ? batch.scale : 1);
    gl.uniform2f(st.uSize, batch.w, batch.h);
    gl.uniform1f(st.uEdge, batch.edge === "chrome" ? 1 : 0);
    gl.bindVertexArray(st.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.inst);
    gl.bufferData(gl.ARRAY_BUFFER, g.data.subarray(0, g.n), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    if (scissor) gl.enable(gl.SCISSOR_TEST);
    const max = blend === "max";
    if (max) {
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
    }
    gl.useProgram(st.comp);
    gl.uniform1i(st.uCov, 0);
    gl.uniform2i(st.uOrigin, vp[0] | 0, vp[1] | 0);
    gl.uniform4f(st.uColour, g.rgba[0], g.rgba[1], g.rgba[2], g.rgba[3]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cov.tex);
    gl.bindVertexArray(st.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (max) gl.blendEquation(gl.FUNC_ADD);
  }

  // Adapt Max: arc-length resample of a polyline [x0,y0,x1,y1,...] to
  // outCount evenly spaced points (formula faces pre-sample y = f(x) or
  // parametric curves; a single line is capped at 120000 points).
  function nodeGraphGlLinesAdaptPoints(points, outCount) {
    const pts = points instanceof Float32Array ? points : Float32Array.from(points || []);
    const n = (pts.length / 2) | 0;
    if (n < 2) return pts;
    outCount = Math.max(2, outCount | 0);
    const dist = new Float64Array(n);
    for (let i = 1; i < n; i += 1) {
      dist[i] = dist[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    }
    const total = dist[n - 1] || 1;
    const out = new Float32Array(outCount * 2);
    let j = 0;
    for (let i = 0; i < outCount; i += 1) {
      const target = total * (i / (outCount - 1));
      while (j < n - 2 && dist[j + 1] < target) j += 1;
      const d0 = dist[j];
      const d1 = dist[j + 1];
      const a = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
      out[i * 2] = pts[j * 2] + (pts[j * 2 + 2] - pts[j * 2]) * a;
      out[i * 2 + 1] = pts[j * 2 + 1] + (pts[j * 2 + 3] - pts[j * 2 + 1]) * a;
    }
    return out;
  }

  // Line-face ink size in canvas view / screen solo. The circuit builder face
  // is the source of truth: a face shown bigger or smaller keeps the same
  // relative line width and dot size (ink x now / builder). Smoothing is
  // antialiasing, so it stays the set number of CSS px at every size.
  function faceMinCss(face) {
    const w = face?.clientWidth || 0;
    const h = face?.clientHeight || 0;
    return w > 0 && h > 0 ? Math.min(w, h) : 0;
  }

  /**
   * Record circuit-builder ink size for every display face in `face`, once,
   * right before the face is reparented into Canvas view / screen solo.
   */
  function nodeGraphGlLinesCaptureBuilderSize(face) {
    if (!(face instanceof Element)) return false;
    const faceMin = faceMinCss(face);
    if (faceMin > 0) face.__glLinesBuilderFaceMinCss = faceMin;
    for (const canvas of face.querySelectorAll(global.NODE_GRAPH_DISPLAY_FACE_SELECTOR || ".node-display-face")) {
      const w = canvas.clientWidth || 0;
      const h = canvas.clientHeight || 0;
      if (w > 0 && h > 0) canvas.__glLinesBuilderMinCss = Math.min(w, h);
    }
    return faceMin > 0;
  }

  function builderMinCss(canvas, presentedFace) {
    const captured = Number(canvas.__glLinesBuilderMinCss);
    if (captured > 0) return captured;
    const faceCaptured = Number(presentedFace?.__glLinesBuilderFaceMinCss);
    if (faceCaptured > 0) return faceCaptured;
    const drawn = Number(canvas.__glLinesDrawnMinCss);
    if (drawn > 0) {
      canvas.__glLinesBuilderMinCss = drawn;
      return drawn;
    }
    return 0;
  }

  /**
   * A line face in one call (SinCos, SinCos4, DSF, BLIT, Basic Shape,
   * Ellipsoid, Step Register): CSS-px frame on the face canvas, drawn with the
   * app stroke. frame: { cssWidth, cssHeight, background, waveKey?, blur,
   *   polylines: [{ points, color, width }], dots: [{ x, y, color, radius }],
   *   texts: [{ text, x, y, px, rgba, align, maxWidth }] }
   * width = full stroke width (0 = no line), blur = Line blur (CSS px).
   */
  /**
   * Ink scale for a display canvas: 1 in the circuit builder; in Performance
   * view / screen solo, the presented size over the builder size (captured
   * before reparent). Multiply CSS-px text sizes and offsets by it so display
   * text grows with its tile, drawn pixel for pixel (no stretched bitmap).
   */
  function nodeGraphGlLinesInkScale(canvas) {
    if (!canvas) return 1;
    const presented = typeof canvas.closest === "function" && canvas.closest(".node-screen-solo-face");
    const w = canvas.clientWidth || 0;
    const h = canvas.clientHeight || 0;
    const minCss = w > 0 && h > 0 ? Math.min(w, h) : 0;
    if (!presented) {
      if (minCss > 0) canvas.__glLinesDrawnMinCss = minCss;
      return 1;
    }
    const builderMin = builderMinCss(canvas, presented);
    if (!(builderMin > 0) || !(minCss > 0)) return 1;
    const now = canvas.__glLinesBuilderMinCss > 0 ? minCss : (faceMinCss(presented) || minCss);
    return Math.max(0.25, now / builderMin);
  }

  function nodeGraphGlLinesPresentFrame(canvas, frame = {}) {
    if (!canvas) return false;
    const cssWidth = Math.max(1, Number(frame.cssWidth) || canvas.clientWidth || 1);
    const cssHeight = Math.max(1, Number(frame.cssHeight) || canvas.clientHeight || 1);
    const scale = Math.max(1e-6, canvas.width / cssWidth);
    const colour = (c, fallback) => {
      if (Array.isArray(c)) return [+c[0] || 0, +c[1] || 0, +c[2] || 0, c.length > 3 ? +c[3] : 1];
      return nodeGraphGlLinesCss(typeof c === "string" && c ? c : fallback);
    };
    const minCss = Math.min(cssWidth, cssHeight);
    const presented = typeof canvas.closest === "function" && canvas.closest(".node-screen-solo-face");
    if (!presented) canvas.__glLinesDrawnMinCss = minCss;
    const builderMin = presented ? builderMinCss(canvas, presented) : 0;
    const ink = presented && builderMin > 0
      ? (canvas.__glLinesBuilderMinCss > 0 ? minCss : faceMinCss(presented) || minCss) / builderMin
      : 1;
    const blur = Number.isFinite(Number(frame.blur)) ? Math.max(0.05, Number(frame.blur)) : 1.2;
    const batch = nodeGraphGlLinesBegin(canvas, colour(frame.background, "#020609"), { scale });
    if (!batch) {
      if (typeof global.nodeGraphDisplayGlFailed === "function") global.nodeGraphDisplayGlFailed(canvas, "line face: no shared GL device");
      else nodeGraphGlLinesFillBlack(canvas);
      return false;
    }
    for (const line of Array.isArray(frame.polylines) ? frame.polylines : []) {
      if (!line?.points || line.points.length < 4) continue;
      const width = line.width == null ? 1.5 : Number(line.width);
      if (!(width > 0)) continue;
      let pts = line.points;
      if (pts.length / 2 > 120000) pts = nodeGraphGlLinesAdaptPoints(pts, 120000);
      nodeGraphGlLinesStroke(batch, pts, Math.max(0.02, width * 0.5) * ink, blur, colour(line.color, "#ffffff"));
    }
    for (const dot of Array.isArray(frame.dots) ? frame.dots : []) {
      if (!dot || !Number.isFinite(dot.x) || !Number.isFinite(dot.y)) continue;
      // Dot size 0 = no dot.
      if (!(Number(dot.radius) > 0)) continue;
      nodeGraphGlLinesStroke(batch, [dot.x, dot.y], Math.max(0.5, Number(dot.radius)) * ink, blur, colour(dot.color, "#ffffff"));
    }
    for (const label of Array.isArray(frame.texts) ? frame.texts : []) {
      if (!label || !Number.isFinite(label.x) || !Number.isFinite(label.y)) continue;
      nodeGraphGlLinesText(batch, label.text, label.x, label.y, label);
    }
    const ok = nodeGraphGlLinesEnd(batch);
    if (!ok && typeof global.nodeGraphDisplayGlFailed === "function") global.nodeGraphDisplayGlFailed(canvas, "line face: draw failed");
    canvas.__glLinesFrame = { waveKey: `${frame.waveKey || ""}|${canvas.width}x${canvas.height}` };
    return ok;
  }

  // Dashed round stroke. One quad per segment; the fragment shader cuts the
  // dashes and their round caps from arc length. halfWorld is zoom-1 px.
  // on/off are zoom-1 px along the curve. Zoom only changes uCam.
  function nodeGraphGlLinesDash(batch, points, halfWorld, on, off, rgba) {
    if (!batch || !points || points.length < 4) return;
    const half = Math.max(0.25, Number(halfWorld) || 0);
    const count = points.length / 2;
    const arc = new Float32Array(count);
    const dirX = new Float32Array(Math.max(1, count - 1));
    const dirY = new Float32Array(Math.max(1, count - 1));
    for (let i = 0; i < count - 1; i += 1) {
      const dx = points[(i + 1) * 2] - points[i * 2];
      const dy = points[(i + 1) * 2 + 1] - points[i * 2 + 1];
      const len = Math.hypot(dx, dy);
      arc[i + 1] = arc[i] + (len > 0 ? len : 0);
      if (len > 1e-6) {
        dirX[i] = dx / len;
        dirY[i] = dy / len;
      } else {
        dirX[i] = i > 0 ? dirX[i - 1] : 1;
        dirY[i] = i > 0 ? dirY[i - 1] : 0;
      }
    }
    const total = arc[count - 1];
    if (!(total > 0)) return;
    batch.dashOn = Math.max(0.5, Number(on) || 0);
    batch.dashOff = Math.max(0, Number(off) || 0);
    for (let i = 0; i < count - 1; i += 1) {
      if (!(arc[i + 1] > arc[i])) continue;
      const x0 = points[i * 2];
      const y0 = points[i * 2 + 1];
      const x1 = points[(i + 1) * 2];
      const y1 = points[(i + 1) * 2 + 1];
      const tx = dirX[i];
      const ty = dirY[i];
      const s0 = arc[i] - half;
      const s1 = arc[i + 1] + half;
      const vert = (x, y, arcBase, capsId) => push(batch, x, y, tx, ty, arcBase, half, total, rgba, capsId);
      vert(x0, y0, s0, 6);
      vert(x0, y0, s0, 8);
      vert(x1, y1, s1, 7);
      vert(x0, y0, s0, 8);
      vert(x1, y1, s1, 9);
      vert(x1, y1, s1, 7);
    }
  }

  // Woscope-style beam. Each segment is its own rectangle and the glow overlaps
  // on purpose. Drawn into the additive glow pass.
  function nodeGraphGlLinesPhosphor(batch, points, sigma, rgba) {
    if (!batch || !points || points.length < 4 || !(sigma > 0)) return;
    const prev = batch._glow;
    batch._glow = true;
    const k = batch.scale || 1;
    const sig = sigma * k;
    const reach = sig * 4;
    for (let i = 2; i < points.length; i += 2) {
      let x0 = points[i - 2] * k;
      let y0 = points[i - 1] * k;
      let x1 = points[i] * k;
      let y1 = points[i + 1] * k;
      let dx = x1 - x0;
      let dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;
      const corner = (along, across) => [
        x0 + ux * along + nx * across,
        y0 + uy * along + ny * across,
        along,
        across,
      ];
      const a = corner(-reach, -reach);
      const b = corner(len + reach, -reach);
      const c = corner(-reach, reach);
      const d = corner(len + reach, reach);
      for (const v of [a, b, c, b, d, c]) {
        push(batch, v[0], v[1], v[2], v[3], len, sig, 0, rgba, 2);
      }
    }
    batch._glow = prev;
  }

  /**
   * Textured quad (image blit). source: { data: Uint8Array RGBA, width, height }
   * or any TexImageSource. options: { nearest = true, alpha = 1, additive = false, blend }. Drawn under
   * the line/rect quads, in call order. blend: "normal" | "add" | "screen" | "multiply" |
   * "lighten" (Canvas tile blend); additive: true is "add".
   */
  function nodeGraphGlLinesImage(batch, source, x, y, w, h, options = {}) {
    if (!batch || !source || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    batch.images.push({
      source,
      x: x * k, y: y * k, w: w * k, h: h * k,
      nearest: options.nearest !== false,
      alpha: Number.isFinite(options.alpha) ? options.alpha : 1,
      // tint [r,g,b,a]: draw the source's alpha as coverage of this colour
      // (white masks, e.g. TraceDotSprite shape sprites).
      tint: Array.isArray(options.tint) ? options.tint : null,
      // cache: upload once per source object (static pictures / baked sprites).
      cache: options.cache === true,
      blend: options.blend || (options.additive === true ? "add" : "normal"),
    });
    return batch.images[batch.images.length - 1];
  }

  /**
   * Upload a source (e.g. a face canvas about to be resized) to a GL texture
   * NOW, so a later batch can draw the old pixels. Pass the result to
   * nodeGraphGlLinesImage; the texture is deleted after that batch draws it,
   * unless { keep: true } (then free it with nodeGraphGlLinesReleaseSnapshot).
   */
  function nodeGraphGlLinesSnapshot(source, options = {}) {
    const s = ensure();
    if (!s || !source) return null;
    const sw = source.naturalWidth || source.width || source.w || 0;
    const sh = source.naturalHeight || source.height || source.h || 0;
    if (typeof source !== "string" && (!(sw > 0) || !(sh > 0))) return null;
    const gl = s.gl;
    // A face (face box, key or texture entry) has no 2D bitmap: copy its texture.
    const isFace = typeof source === "string" || source.glFaceTexture === true
      || (typeof global.nodeGraphSharedGlFaceTextureOnly === "function" && global.nodeGraphSharedGlFaceTextureOnly(source));
    if (isFace) {
      const faceCopy = typeof global.nodeGraphSharedGlFaceCopyTexture === "function"
        ? global.nodeGraphSharedGlFaceCopyTexture(source)
        : null;
      return faceCopy
        ? { glSnapshot: true, keep: options?.keep === true, texture: faceCopy.texture, width: faceCopy.width, height: faceCopy.height }
        : null;
    }
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (_error) {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteTexture(texture);
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { glSnapshot: true, keep: options?.keep === true, texture, width: sw, height: sh };
  }

  function nodeGraphGlLinesReleaseSnapshot(snapshot) {
    if (!snapshot?.glSnapshot || !snapshot.texture) return;
    const s = ensure();
    if (s) s.gl.deleteTexture(snapshot.texture);
    snapshot.texture = null;
  }

  // ---- text atlas ---------------------------------------------------------
  /** { adv, asc } of ch at TEXT_METRIC_PX for this font, measured once. */
  function textMetric(family, weight, ch) {
    const fk = `${weight}|${family}`;
    let m = textMetricCache.get(fk);
    if (!m) { m = new Map(); textMetricCache.set(fk, m); }
    let g = m.get(ch);
    if (g) return g;
    if (!textMetricCtx) {
      const cv = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(8, 8) : global.document?.createElement?.("canvas");
      textMetricCtx = cv?.getContext?.("2d") || null;
    }
    if (!textMetricCtx) return null;
    textMetricCtx.font = `${weight} ${TEXT_METRIC_PX}px ${family}`;
    const mt = textMetricCtx.measureText(ch);
    g = { adv: mt.width || TEXT_METRIC_PX * 0.6, asc: mt.actualBoundingBoxAscent || 0 };
    m.set(ch, g);
    return g;
  }

  function atlasKey(family, weight, camBake, face = false) {
    if (face && camBake > 0) return `${weight}|${family}|f${camBake}`;
    return camBake > 0 ? `${weight}|${family}|${camBake}` : `${weight}|${family}`;
  }

  // Display-face text atlases: one per exact whole device-pixel size, baked once
  // and sampled texel-for-pixel (see FACE_TEXT_MIN / nodeGraphGlLinesText).
  const FACE_TEXT_MIN = TEXT_CAM_BAKE_MIN;
  const FACE_TEXT_MAX = 96;
  const FACE_ATLAS_LIMIT = 40;
  let faceAtlasTick = 0;

  function bakeAtlas(s, family, weight, chars, camBake) {
    const tBake0 = performance.now();
    const out = bakeAtlasInner(s, family, weight, chars, camBake);
    const d = performance.now() - tBake0;
    textAtlasStats.bakes += 1; textAtlasStats.ms += d; textAtlasStats.maxMs = Math.max(textAtlasStats.maxMs, d);
    return out;
  }

  function bakeAtlasInner(s, family, weight, chars, camBake) {
    const job = bakeAtlasStart(s, family, weight, chars, camBake);
    if (!job) return null;
    bakeAtlasDraw(job, Infinity);
    return bakeAtlasFinish(s, job);
  }

  /**
   * Lay out an atlas (sizes from the metric cache for camera bakes) and set up
   * its canvas: { cv, cx, list of [ch, glyph], i (next glyph to draw), ... }.
   */
  function bakeAtlasStart(s, family, weight, chars, camBake) {
    const doc = global.document;
    if (!doc?.createElement) return null;
    const cv = doc.createElement("canvas");
    const cx = cv.getContext?.("2d");
    if (!cx || typeof cx.measureText !== "function") return null;
    const list = [...new Set([...chars])];
    const tMeasure0 = performance.now();
    const maxTex = s.gl.getParameter(s.gl.MAX_TEXTURE_SIZE) || 4096;
    const sheetW = Math.min(1024, maxTex);
    let bakePx = camBake > 0 ? camBake : glyphBakePx;
    let glyphs = new Map();
    let sheetH = 0;
    let cellH = 0;
    let head = 0;
    const minBake = camBake > 0 ? TEXT_CAM_BAKE_MIN : 16;
    let gutter = textGutter(bakePx);
    while (bakePx >= minBake) {
      gutter = textGutter(bakePx);
      const fontTry = `${weight} ${bakePx}px ${family}`;
      cx.font = fontTry;
      // Room above the em ascent for fonts whose glyphs rise higher (DSEG7 digits).
      head = 0;
      const k = bakePx / TEXT_METRIC_PX;
      const metric = camBake > 0 ? (ch) => textMetric(family, weight, ch) : null;
      for (const ch of list) {
        const asc = metric ? (metric(ch)?.asc || 0) * k : (cx.measureText(ch).actualBoundingBoxAscent || 0);
        head = Math.max(head, Math.ceil(asc - bakePx * TEXT_ASCENT));
      }
      cellH = Math.ceil(bakePx * 1.25) + head + TEXT_PAD * 2;
      glyphs = new Map();
      let x = 0;
      let y = 0;
      let fits = cellH <= maxTex;
      for (const ch of list) {
        const adv = Math.max(1, (metric ? (metric(ch)?.adv || 0) * k : cx.measureText(ch).width) || bakePx * 0.6);
        const gw = Math.ceil(adv) + TEXT_PAD * 2;
        if (gw > sheetW || y + cellH > maxTex) { fits = false; break; }
        if (x + gw > sheetW) {
          x = 0;
          y += cellH + gutter;
          if (y + cellH > maxTex) { fits = false; break; }
        }
        glyphs.set(ch, { x, y, w: gw, h: cellH, adv });
        x += gw + gutter;
      }
      sheetH = y + cellH;
      if (fits && sheetH <= maxTex && glyphs.size === list.length) break;
      bakePx = camBake > 0 ? Math.floor(bakePx * 0.9 * 64) / 64 : Math.floor(bakePx * 0.9);
    }
    if (bakePx < minBake || glyphs.size !== list.length) return null;
    textAtlasStats.measureMs += performance.now() - tMeasure0;
    // Baseline on a whole texel row: canvas text at a fractional y is
    // resampled vertically, which softens every glyph.
    const baseRow = TEXT_PAD + head + Math.round(bakePx * TEXT_ASCENT);
    const font = `${weight} ${bakePx}px ${family}`;
    cv.width = sheetW;
    cv.height = sheetH;
    cx.font = font;
    cx.textBaseline = "alphabetic";
    cx.textAlign = "left";
    cx.fillStyle = "#fff";
    cx.clearRect(0, 0, sheetW, sheetH);
    return { cv, cx, glyphs, todo: [...glyphs], i: 0, sheetW, sheetH, head, baseRow, bakePx, list, camBake, family, weight };
  }

  /** Draw glyphs until done or budgetMs is spent (at least a few). True when every glyph is drawn. */
  function bakeAtlasDraw(job, budgetMs) {
    const t0 = performance.now();
    const { cx, todo, baseRow } = job;
    let n = 0;
    while (job.i < todo.length) {
      const [ch, g] = todo[job.i];
      cx.fillText(ch, g.x + TEXT_PAD, g.y + baseRow);
      job.i += 1;
      n += 1;
      if (n >= 4 && (n & 3) === 0 && performance.now() - t0 > budgetMs) break;
    }
    textAtlasStats.drawMs += performance.now() - t0;
    return job.i >= todo.length;
  }

  /** Upload a fully drawn atlas canvas: the atlas record. */
  function bakeAtlasFinish(s, job) {
    const gl = s.gl;
    const { cv, glyphs, sheetW, sheetH, head, baseRow, bakePx, list, camBake, family, weight } = job;
    const tUp0 = performance.now();
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    textAtlasStats.uploadMs += performance.now() - tUp0;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, glyphs, sheetW, sheetH, head: head / bakePx, baseRow, bakePx, chars: list.join(""), cam: camBake > 0, usedEpoch: textAtlasEpoch, family, weight };
  }

  /** Shared glyph atlas for a font (grows when new characters show up). */
  function nodeGraphGlLinesTextAtlas(family = TEXT_DEFAULT_FAMILY, weight = 600, text = "", camBake = 0, lazy = null, face = false) {
    const s = ensure();
    if (!s) return null;
    const key = atlasKey(family, weight, camBake, face);
    let atlas = s.atlases.get(key);
    const missing = [...String(text)].filter((ch) => !atlas?.glyphs.has(ch));
    if ((!atlas || missing.length) && camBake > 0 && lazy) {
      const fallback = textAtlasFallback(s, family, weight, text, camBake);
      if (fallback) {
        textAtlasEnqueue(key, family, weight, camBake, (atlas?.chars || textAtlasKnownChars.get(key) || TEXT_BASE_CHARS) + missing.join(""), lazy);
        textAtlasStats.fallbacks += 1;
        fallback.usedEpoch = textAtlasEpoch;
        return fallback;
      }
    }
    if (!atlas || missing.length) {
      const next = bakeAtlas(s, family, weight, (atlas?.chars || textAtlasKnownChars.get(key) || TEXT_BASE_CHARS) + missing.join(""), camBake);
      if (!next) return null;
      if (face) {
        // A face atlas is not a camera atlas: the epoch sweeps and the camera
        // generation leave it alone, and a bake-size change does not retire it.
        next.cam = false;
        next.face = true;
        faceAtlasEvict(s, key);
      }
      textAtlasKnownChars.set(key, next.chars);
      // This frame's text runs already stored the old texture. Delete it
      // after drawTexts, not while those runs are still queued.
      if (atlas?.texture) {
        if (atlas.cam && lazy) {
          // A kept mesh may still draw this texture: retire it, delete it later.
          textAtlasRetiring.add(atlas.texture);
        } else {
          if (!s.deadTextures) s.deadTextures = [];
          s.deadTextures.push(atlas.texture);
          // Face atlases are only referenced by the batch that is recording now.
          if (!atlas.face) textAtlasGen += 1;
          if (atlas.cam) textAtlasCamGen += 1;
        }
      }
      atlas = next;
      s.atlases.set(key, atlas);
      textAtlasQueue.delete(key);
      if (textAtlasBaking?.pick.key === key) textAtlasBaking = null;
    }
    atlas.usedEpoch = textAtlasEpoch;
    if (atlas.face) atlas.faceTick = ++faceAtlasTick;
    return atlas;
  }

  /** Keep the face atlases bounded: retire the least recently used past the limit. */
  function faceAtlasEvict(s, keepKey) {
    let count = 0;
    for (const a of s.atlases.values()) if (a?.face) count += 1;
    while (count >= FACE_ATLAS_LIMIT) {
      let oldKey = null;
      let oldTick = Infinity;
      for (const [k, a] of s.atlases) {
        if (!a?.face || k === keepKey) continue;
        if ((a.faceTick || 0) < oldTick) { oldTick = a.faceTick || 0; oldKey = k; }
      }
      if (oldKey == null) break;
      const old = s.atlases.get(oldKey);
      if (old?.texture) { if (!s.deadTextures) s.deadTextures = []; s.deadTextures.push(old.texture); }
      s.atlases.delete(oldKey);
      textAtlasKnownChars.delete(oldKey);
      count -= 1;
    }
  }

  /** Nearest live camera atlas of this font that has every character of text. */
  function textAtlasFallback(s, family, weight, text, camBake) {
    let best = null;
    let bestScore = Infinity;
    const chars = [...String(text)];
    for (const a of s.atlases.values()) {
      if (!a?.cam || a.family !== family || a.weight !== weight || !a.texture) continue;
      let ok = true;
      for (let i = 0; i < chars.length; i += 1) if (!a.glyphs.has(chars[i])) { ok = false; break; }
      if (!ok) continue;
      // Prefer a larger atlas (minified through mips) over a magnified one.
      const r = a.bakePx / camBake;
      const score = r >= 1 ? Math.log(r) : -Math.log(r) * 2;
      if (score < bestScore) { bestScore = score; best = a; }
    }
    return best;
  }

  function textAtlasEnqueue(key, family, weight, camBake, chars, lazy) {
    const scale = Number(lazy?.scale) || 0;
    const prio = Number(lazy?.prio);
    const known = textAtlasKnownChars.get(key) || "";
    const all = [...new Set([...(known + chars)])].join("");
    textAtlasKnownChars.set(key, all);
    const prev = textAtlasQueue.get(key);
    if (prev) {
      prev.chars = all;
      prev.scale = scale;
      if (Number.isFinite(prio) && !(prev.prio <= prio)) prev.prio = prio;
      return;
    }
    textAtlasStats.queued += 1;
    textAtlasQueue.set(key, { key, family, weight, camBake, chars: all, scale, prio: Number.isFinite(prio) ? prio : 1e9 });
  }

  /**
   * Lazy camera atlases waiting to be baked. With scale, only those asked for
   * at that zoom x device scale (stale sizes from a gesture are dropped).
   */
  function nodeGraphGlLinesTextAtlasPending(scale = 0) {
    const baking = textAtlasBaking && (!(scale > 0) || Math.abs(textAtlasBaking.pick.scale - scale) <= 1e-4 * scale) ? 1 : 0;
    if (!(scale > 0)) return textAtlasQueue.size + baking;
    let n = baking;
    for (const e of textAtlasQueue.values()) if (Math.abs(e.scale - scale) <= 1e-4 * scale) n += 1;
    return n;
  }

  /**
   * Work on ONE queued camera atlas (nearest the screen centre first) for at
   * most budgetMs: lay it out, draw a few glyphs per call, upload when every
   * glyph is drawn. Returns how many atlases are left (the one in progress
   * counts). Entries for another scale are dropped. The new atlas replaces an
   * older one of the same key without deleting it (a kept mesh may still draw
   * it); a sweep retires it once nothing points at it.
   */
  function nodeGraphGlLinesTextAtlasBakeNext(scale = 0, budgetMs = Infinity) {
    const s = ensure();
    if (!s) return 0;
    const t0 = performance.now();
    if (textAtlasBaking && scale > 0 && Math.abs(textAtlasBaking.pick.scale - scale) > 1e-4 * scale) textAtlasBaking = null;
    if (!textAtlasBaking) {
      let pick = null;
      for (const [key, e] of [...textAtlasQueue]) {
        if (scale > 0 && Math.abs(e.scale - scale) > 1e-4 * scale) { textAtlasQueue.delete(key); continue; }
        if (!pick || e.prio < pick.prio) pick = e;
      }
      if (!pick) return 0;
      textAtlasQueue.delete(pick.key);
      const old = s.atlases.get(pick.key);
      const job = bakeAtlasStart(s, pick.family, pick.weight, (old?.chars || "") + pick.chars, pick.camBake);
      if (!job) return nodeGraphGlLinesTextAtlasPending(scale);
      job.pick = pick;
      job.t0 = t0;
      job.ms = 0;
      textAtlasBaking = job;
    }
    const job = textAtlasBaking;
    const left = budgetMs - (performance.now() - t0);
    const drawn = bakeAtlasDraw(job, Math.max(0.5, left));
    job.ms += performance.now() - t0;
    if (!drawn) return nodeGraphGlLinesTextAtlasPending(scale);
    textAtlasBaking = null;
    const tUp = performance.now();
    const next = bakeAtlasFinish(s, job);
    const d = job.ms + (performance.now() - tUp);
    textAtlasStats.bakes += 1; textAtlasStats.ms += d; textAtlasStats.maxMs = Math.max(textAtlasStats.maxMs, d);
    const old = s.atlases.get(job.pick.key);
    textAtlasKnownChars.set(job.pick.key, next.chars);
    if (old?.texture) textAtlasRetiring.add(old.texture);
    next.usedEpoch = textAtlasEpoch;
    s.atlases.set(job.pick.key, next);
    return nodeGraphGlLinesTextAtlasPending(scale);
  }

  /**
   * Retire camera atlases whose textures no kept mesh draws (live: Set of
   * textures still referenced), plus retired growth textures. keepScale keeps
   * atlases of that zoom x device scale (just baked, about to be used).
   */
  function nodeGraphGlLinesTextAtlasSweepUnreferenced(live, keepBakes = null) {
    const s = state;
    if (!s?.atlases || !live) return 0;
    if (!s.deadTextures) s.deadTextures = [];
    let n = 0;
    for (const [key, atlas] of [...s.atlases]) {
      if (!atlas?.cam || !atlas.texture || live.has(atlas.texture)) continue;
      if (keepBakes && keepBakes.has(key)) continue;
      s.deadTextures.push(atlas.texture);
      s.atlases.delete(key);
      n += 1;
    }
    for (const tex of [...textAtlasRetiring]) {
      if (live.has(tex)) continue;
      s.deadTextures.push(tex);
      textAtlasRetiring.delete(tex);
      n += 1;
    }
    return n;
  }

  /** Start of a full record of the camera mesh: atlases not asked for since are stale. */
  function nodeGraphGlLinesTextAtlasEpoch() {
    textAtlasEpoch += 1;
    return textAtlasEpoch;
  }

  /**
   * End of a full record: retire camera atlases (per-size, per-zoom) that this
   * record did not use. The whole mesh was just re-recorded, so nothing kept
   * points at them (no generation bump, no re-record). Deleted after the next
   * text draw like any retired atlas.
   */
  function nodeGraphGlLinesTextAtlasSweep() {
    const s = state;
    if (!s?.atlases) return 0;
    let n = 0;
    for (const [key, atlas] of [...s.atlases]) {
      if (!atlas?.cam || atlas.usedEpoch === textAtlasEpoch) continue;
      if (atlas.texture) {
        if (!s.deadTextures) s.deadTextures = [];
        s.deadTextures.push(atlas.texture);
      }
      s.atlases.delete(key);
      n += 1;
    }
    // The whole camera mesh was just re-recorded: grown-away textures are unreferenced.
    for (const tex of textAtlasRetiring) {
      if (!s.deadTextures) s.deadTextures = [];
      s.deadTextures.push(tex);
      n += 1;
    }
    textAtlasRetiring.clear();
    return n;
  }

  /** Bake counters since load: { bakes, ms, measureMs, drawMs, uploadMs, maxMs } (tests / diagnostics). */
  function nodeGraphGlLinesTextAtlasStats() {
    return { ...textAtlasStats };
  }

  /** Live atlases: [{ weight, bakePx, cam }] (tests / diagnostics). */
  function nodeGraphGlLinesTextAtlasInfo() {
    const out = [];
    if (state?.atlases) for (const [key, a] of state.atlases) out.push({ key, bakePx: a.bakePx, cam: Boolean(a.cam), face: Boolean(a.face), glyphs: a.glyphs.size, sheetW: a.sheetW, sheetH: a.sheetH });
    return out;
  }

  // ---- colour emoji ---------------------------------------------------------
  /**
   * Grapheme segments of `text`: frozen [{ text, emoji }]. Cached per string,
   * so a steady face re-uses the same array (no per-frame allocation).
   */
  function nodeGraphGlLinesTextSegments(text) {
    const str = String(text ?? "");
    let segs = segmentCache.get(str);
    if (segs) return segs;
    emojiStats.segmentMisses += 1;
    const out = [];
    const Seg = global.Intl?.Segmenter;
    const clusters = Seg
      ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(str), (x) => x.segment)
      : (str.match(/\p{Regional_Indicator}{2}|(?:\p{Extended_Pictographic}|[#*0-9])(?:\u{FE0F}|\u{20E3}|\p{Emoji_Modifier})*(?:\u{200D}\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})*)*|[\s\S]/gu) || []);
    let plain = "";
    for (const c of clusters) {
      // Emoji presentation only: default-text symbols (©, ™, ↔, bare ❤, digits)
      // stay coverage glyphs unless a VS16 / keycap / ZWJ / flag asks for colour.
      const isEmoji = EMOJI_CLUSTER.test(c) && EMOJI_PRESENTATION.test(c);
      if (isEmoji) {
        if (plain) { out.push(Object.freeze({ text: plain, emoji: false })); plain = ""; }
        out.push(Object.freeze({ text: c, emoji: true }));
      } else {
        plain += c;
      }
    }
    if (plain) out.push(Object.freeze({ text: plain, emoji: false }));
    segs = Object.freeze(out);
    if (segmentCache.size >= SEGMENT_CACHE_MAX) segmentCache.clear();
    segmentCache.set(str, segs);
    return segs;
  }

  function emojiRaster(s) {
    const e = s.emoji;
    if (e.ctx) return e.ctx;
    const doc = global.document;
    const cv = doc?.createElement?.("canvas");
    const cx = cv?.getContext?.("2d", { willReadFrequently: false });
    if (!cx) return null;
    e.canvas = cv;
    e.ctx = cx;
    return cx;
  }

  function emojiPage(s, w, h) {
    if (!(w > 0) || !(h > 0) || w > EMOJI_SHEET || h > EMOJI_SHEET) return null;
    const e = s.emoji;
    const gl = s.gl;
    let page = e.pages[e.pages.length - 1];
    if (page) {
      if (page.x + w > EMOJI_SHEET) { page.x = 0; page.y += page.rowH; page.rowH = 0; }
      if (page.x + w <= EMOJI_SHEET && page.y + h <= EMOJI_SHEET) return page;
    }
    if (e.pages.length >= EMOJI_MAX_PAGES || w > EMOJI_SHEET || h > EMOJI_SHEET) return null;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, EMOJI_SHEET, EMOJI_SHEET, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    // Exact-size bake drawn 1:1; zoom pixelates (display policy), never smooths.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    page = { texture, x: 0, y: 0, rowH: 0 };
    e.pages.push(page);
    emojiStats.pages = e.pages.length;
    return page;
  }

  /**
   * Colour atlas entry for one emoji at base size `px` (integer device px).
   * Baked once; the same key is never rasterized again.
   */
  function emojiEntry(s, emoji, px) {
    const e = s.emoji;
    // Two-level lookup (emoji -> base px) so a cache hit builds no key string.
    let bySize = e.entries.get(emoji);
    let entry = bySize?.get(px);
    if (entry !== undefined) return entry;
    if (!bySize) { bySize = new Map(); e.entries.set(emoji, bySize); }
    if (px < 4) {
      // Unlaid-out / sub-legible box: advance only, never a texture bake.
      entry = Object.freeze({ page: null, adv: px, px, w: 0, h: 0, u0: 0, v0: 0, u1: 0, v1: 0 });
      bySize.set(px, entry);
      return entry;
    }
    const cx = emojiRaster(s);
    if (!cx) return null;
    cx.font = `${px}px ${EMOJI_FAMILY}`;
    const adv = Math.max(1, cx.measureText(emoji).width || px);
    const w = Math.ceil(adv) + EMOJI_PAD * 2;
    // Extra headroom: colour emoji draw above the em box and were clipped.
    const head = Math.ceil(px * 0.45);
    const h = Math.ceil(px * 1.25) + EMOJI_PAD * 2 + head;
    const page = emojiPage(s, w, h);
    if (!page) {
      // Atlas full: keep the advance, draw nothing (cached, so no retry loop).
      emojiStats.dropped += 1;
      entry = Object.freeze({ page: null, adv, px, w, h, u0: 0, v0: 0, u1: 0, v1: 0 });
      bySize.set(px, entry);
      return entry;
    }
    const cv = e.canvas;
    if (cv.width < w || cv.height < h) {
      cv.width = Math.max(cv.width, w);
      cv.height = Math.max(cv.height, h);
    }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.font = `${px}px ${EMOJI_FAMILY}`;
    cx.textBaseline = "alphabetic";
    cx.textAlign = "left";
    cx.fillStyle = "#000";
    cx.fillText(emoji, EMOJI_PAD, EMOJI_PAD + head + px * TEXT_ASCENT);
    const gl = s.gl;
    const pixels = cx.getImageData(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, page.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, page.x, page.y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    emojiStats.bakes += 1;
    emojiStats.uploads += 1;
    entry = Object.freeze({
      page, adv, px, w, h,
      u0: page.x / EMOJI_SHEET, v0: page.y / EMOJI_SHEET,
      u1: (page.x + w) / EMOJI_SHEET, v1: (page.y + h) / EMOJI_SHEET,
    });
    page.x += w;
    page.rowH = Math.max(page.rowH, h);
    bySize.set(px, entry);
    emojiStats.entries += 1;
    return entry;
  }

  /** Base bake size: drawn px in face-backing device px, rounded. */
  function emojiBasePx(devicePx) {
    return Math.max(1, Math.round(devicePx));
  }

  /** Counters for smokes / GPU checks (bakes never move at steady state or on zoom). */
  function nodeGraphGlLinesEmojiStats() {
    const keys = [];
    if (state) for (const [emoji, bySize] of state.emoji.entries) for (const px of bySize.keys()) keys.push(`${emoji}|${px}`);
    return { ...emojiStats, keys };
  }

  /** Width of `text` at `px` (same units as the batch coordinates). */
  function nodeGraphGlLinesMeasureText(text, px, family = TEXT_DEFAULT_FAMILY, weight = 600) {
    const str = String(text ?? "");
    const atlas = nodeGraphGlLinesTextAtlas(family, weight, str);
    if (!atlas) return str.length * px * 0.6;
    const g = px / atlas.bakePx;
    if (!EMOJI_HINT.test(str)) {
      let adv = 0;
      for (const ch of str) adv += atlas.glyphs.get(ch)?.adv || 0;
      return adv * g;
    }
    let width = 0;
    for (const seg of nodeGraphGlLinesTextSegments(str)) {
      if (seg.emoji) {
        const entry = emojiEntry(state, seg.text, emojiBasePx(px));
        width += entry ? entry.adv * (px / entry.px) : px;
      } else {
        for (const ch of seg.text) width += (atlas.glyphs.get(ch)?.adv || 0) * g;
      }
    }
    return width;
  }

  /**
   * Font metrics of `text` in a CSS `font` string (the browser's TextMetrics:
   * width, actualBoundingBox*, fontBoundingBox*). Layout only, for faces that
   * fit labels; one detached measuring context lives here, never drawn into.
   */
  let measureInkCtx = null;
  function nodeGraphGlLinesMeasureInk(text, font) {
    if (!measureInkCtx) measureInkCtx = global.document?.createElement?.("canvas")?.getContext?.("2d") || null;
    if (!measureInkCtx) return null;
    measureInkCtx.font = String(font || "");
    return measureInkCtx.measureText(String(text ?? ""));
  }

  /**
   * Text at (x, y). options: { px = 12, rgba = white, align = "center"
   * (left|center|right), baseline = "middle" (top|middle|alphabetic|bottom),
   * maxWidth (squeeze horizontally like canvas fillText), family, weight }.
   * Drawn over the quads.
   */
  function nodeGraphGlLinesText(batch, text, x, y, options = {}) {
    // A layer may route its text to a later layer (module text drawn after the ambient dim).
    if (batch && batch.textLayer) batch = batch.textLayer;
    const str = String(text ?? "");
    if (!batch || !str) return;
    const family = options.family || TEXT_DEFAULT_FAMILY;
    const weight = options.weight || 600;
    const cam = batch.camera || null;
    // Camera text is baked at the size it lands on screen (world px x zoom x
    // device scale), so the atlas is sampled 1:1 and nothing is resampled.
    const devScale = cam ? (cam.zoom > 0 ? cam.zoom : 1) * (batch.scale > 0 ? batch.scale : 1) : 0;
    const k = cam ? 1 : (batch.scale || 1) * (batch.textInk || 1);
    let px = cam ? Math.max(1, Number(options.px) || 12) : Math.max(1, Math.round((Number(options.px) || 12) * k));
    let wantBake = cam
      ? Math.min(TEXT_CAM_BAKE_MAX, Math.max(TEXT_CAM_BAKE_MIN, Math.round(px * devScale * 64) / 64))
      : 0;
    // Past the bake cap the atlas is magnified, not 1:1: no fit re-bake, no snap.
    // wantBake is clamped to TEXT_CAM_BAKE_MIN..MAX. Past the clamp the run is
    // magnified, not 1:1: it must not take the fitted re-bake below (that
    // divided by the clamped size, so a squeezed label stopped growing with
    // zoom and held one screen width: Chroma's Lightness / Saturation), and
    // it must not snap to device pixels.
    const capped = cam && Math.abs(px * devScale - wantBake) > 0.02;
    // Lazy camera atlases: a missing size draws with the nearest live atlas and is queued.
    const lazy = cam && batch.lazyText ? textLazyReq(batch, x, y, devScale) : null;
    // Display-face text: baked at its exact whole device-pixel size (a face is a
    // fixed-size texture, so this is the same at every zoom) and sampled
    // texel-for-pixel. Sizes below FACE_TEXT_MIN and the Performance-view tiles
    // (exactText false: their size follows the view zoom) keep the shared atlas.
    let faceBake = !cam && batch.exactText !== false && px >= FACE_TEXT_MIN && px <= FACE_TEXT_MAX ? px : 0;
    let atlas = nodeGraphGlLinesTextAtlas(family, weight, str, faceBake || wantBake, lazy, faceBake > 0);
    if (!atlas) return;
    if (faceBake > 0 && atlas.bakePx !== px) faceBake = 0;
    let g = px / atlas.bakePx;
    const segs = EMOJI_HINT.test(str) ? nodeGraphGlLinesTextSegments(str) : null;
    let hasEmoji = false;
    if (segs) for (let i = 0; i < segs.length; i += 1) if (segs[i].emoji) { hasEmoji = true; break; }
    const emojiPx = options.emojiPx != null ? emojiBasePx(options.emojiPx) : emojiBasePx(Math.round(px));
    const emojiScale = options.emojiPx != null ? px / Math.max(1, emojiPx) : 1;
    let width = 0;
    if (hasEmoji) {
      for (const seg of segs) {
        if (seg.emoji) width += (emojiEntry(batch.s, seg.text, emojiPx)?.adv || 0) * emojiScale;
        else for (const ch of seg.text) width += (atlas.glyphs.get(ch)?.adv || 0) * g;
      }
    } else {
      let adv = 0;
      for (const ch of str) adv += atlas.glyphs.get(ch)?.adv || 0;
      width = adv * g;
    }
    let squeeze = 1;
    let fitPending = false;
    const maxW = Number(options.maxWidth) * k;
    // Camera text too wide for maxWidth: shrink to the next half-device-pixel
    // size below the fit and bake that size, so the run is still sampled 1:1
    // (a resampled squeeze is what made fitted titles soft). Sizes are
    // quantised, so many titles share a few atlases.
    if (cam && !capped && !hasEmoji && maxW > 0 && width > maxW && Math.abs(atlas.bakePx - wantBake) < 0.02) {
      const fitBake = Math.floor(wantBake * (maxW / width) * 2) / 2;
      if (fitBake >= TEXT_CAM_BAKE_MIN) {
        const fitAtlas = nodeGraphGlLinesTextAtlas(family, weight, str, fitBake, lazy);
        if (fitAtlas && Math.abs(fitAtlas.bakePx - fitBake) < 0.02) {
          atlas = fitAtlas;
          wantBake = fitBake;
          px = fitBake / devScale;
          g = px / atlas.bakePx;
          let adv = 0;
          for (const ch of str) adv += atlas.glyphs.get(ch)?.adv || 0;
          width = adv * g;
        } else fitPending = true;
      }
    }
    // Face text too wide for maxWidth: the next whole pixel size below the fit,
    // baked exactly, so the run is still 1:1 (the uniform squeeze below only
    // takes what is left once even FACE_TEXT_MIN does not fit).
    if (faceBake > 0 && !hasEmoji && maxW > 0 && width > maxW) {
      const fitPx = Math.floor(px * (maxW / width));
      if (fitPx >= FACE_TEXT_MIN) {
        const fitAtlas = nodeGraphGlLinesTextAtlas(family, weight, str, fitPx, null, true);
        if (fitAtlas && fitAtlas.bakePx === fitPx) {
          atlas = fitAtlas;
          px = fitPx;
          g = 1;
          let adv = 0;
          for (const ch of str) adv += atlas.glyphs.get(ch)?.adv || 0;
          width = adv;
        }
      }
    }
    // Too wide for maxWidth: shrink the whole run uniformly (x and y), never
    // squeeze glyphs horizontally — controls keep their proportions.
    if (maxW > 0 && width > maxW) { squeeze = maxW / width; width = maxW; }
    const gy = g * squeeze;
    const pxRun = px * squeeze;
    const align = options.align || "center";
    const base = options.baseline || "middle";
    // Camera text keeps fractional world positions; the shader snaps to device pixels.
    const place = cam ? (v) => v : Math.round;
    let pen = place(x * k - (align === "center" ? width * 0.5 : (align === "right" ? width : 0)));
    let baseline = place(y * k);
    if (base === "middle") baseline += pxRun * (TEXT_ASCENT - 0.5);
    else if (base === "top") baseline += pxRun * TEXT_ASCENT;
    else if (base === "bottom") baseline -= pxRun * (1 - TEXT_ASCENT);
    const sx = g * squeeze;
    const c = options.rgba || TEXT_WHITE;
    const cr = c[0]; const cg = c[1]; const cb = c[2]; const ca = c.length > 3 ? c[3] : 1;
    // 1:1 runs (atlas baked at the on-screen size, no squeeze) have their
    // origins snapped to whole device pixels by the vertex shader.
    const snapScale = cam && !capped && squeeze === 1 && Math.abs(atlas.bakePx - wantBake) < 0.02 ? devScale : 0;
    // Fitting/capping can intentionally disable pixel snapping. That does not
    // make a resolved atlas stale or require its glyphs to be recorded again.
    const qualityScale = cam && !fitPending && Math.abs(atlas.bakePx - wantBake) < 0.02 ? devScale : 0;
    if (!hasEmoji) {
      pen = pushGlyphs(batch, atlas, str, pen, baseline, gy, sx, cr, cg, cb, ca, snapScale, qualityScale);
      return;
    }
    for (const seg of segs) {
      if (!seg.emoji) {
        pen = pushGlyphs(batch, atlas, seg.text, pen, baseline, gy, sx, cr, cg, cb, ca, snapScale, qualityScale);
        continue;
      }
      const entry = emojiEntry(batch.s, seg.text, emojiPx);
      if (!entry) continue;
      if (entry.page) {
        // 1:1 device px (squeezed only by maxWidth); colour is the bake, tint alpha only.
        const run = textRun(batch, entry.page.texture, true);
        // Whole device px so NEAREST samples the bake texel-for-pixel.
        const x0 = Math.round(pen - EMOJI_PAD * squeeze * emojiScale);
        const y0 = Math.round(baseline - (EMOJI_PAD + Math.ceil(entry.px * 0.45) + entry.px * TEXT_ASCENT) * squeeze * emojiScale);
        pushTextQuad(batch, x0, y0, x0 + entry.w * squeeze * emojiScale, y0 + entry.h * squeeze * emojiScale,
          entry.u0, entry.v0, entry.u1, entry.v1, 1, 1, 1, ca);
        run.end = batch.tn;
      }
      pen += entry.adv * squeeze * emojiScale;
    }
  }

  /** Lazy request info: the zoom x device scale and distance from the view centre (bake order). */
  function textLazyReq(batch, x, y, devScale) {
    const cam = batch.camera;
    const z = cam.zoom > 0 ? cam.zoom : 1;
    const sc = batch.scale > 0 ? batch.scale : 1;
    const cx = (Number(cam.x) || 0) + (batch.w || 0) / sc / z / 2;
    const cy = (Number(cam.y) || 0) + (batch.h || 0) / sc / z / 2;
    const req = textLazyReqScratch;
    req.scale = devScale;
    req.prio = Math.hypot((Number(x) || 0) - cx, (Number(y) || 0) - cy);
    return req;
  }
  const textLazyReqScratch = { scale: 0, prio: 0 };

  /** Current run for a texture (consecutive same-texture quads share one draw). */
  function textRun(batch, texture, color, snapScale = 0, qualityScale = 0) {
    let run = batch.texts.length ? batch.texts[batch.texts.length - 1] : null;
    if (!run || run.texture !== texture || (run.snapScale || 0) !== snapScale || (run.qualityScale || 0) !== qualityScale) {
      run = { texture, color, start: batch.tn, end: batch.tn, snapScale, qualityScale };
      batch.texts.push(run);
    }
    return run;
  }

  // Glyph aspect watch (smoke_text_aspect.mjs): x scale / y scale of every glyph quad.
  const textAspect = { quads: 0, minRatio: 1, maxRatio: 1 };
  function nodeGraphGlLinesTextAspectStats(reset = false) {
    const out = { ...textAspect };
    if (reset) { textAspect.quads = 0; textAspect.minRatio = 1; textAspect.maxRatio = 1; }
    return out;
  }

  // Display-face text (non-camera batches): how many glyph quads sample their
  // atlas texel-for-pixel (x and y scale 1) and the mean atlas-texel : pixel
  // ratio (1 = 1:1, 5 = a 64 px bake minified to 13 px). Tests / diagnostics.
  const faceTextStats = { glyphs: 0, exact: 0, texelRatioSum: 0, runs: 0, minSx: 1 };
  function nodeGraphGlLinesFaceTextStats(reset = false) {
    const out = { ...faceTextStats, meanTexelRatio: faceTextStats.glyphs ? faceTextStats.texelRatioSum / faceTextStats.glyphs : 1 };
    if (reset) { faceTextStats.glyphs = 0; faceTextStats.exact = 0; faceTextStats.texelRatioSum = 0; faceTextStats.runs = 0; faceTextStats.minSx = 1; }
    return out;
  }

  function pushGlyphs(batch, atlas, str, pen, baseline, g, sx, cr, cg, cb, ca, snapScale = 0, qualityScale = 0) {
    const ratio = sx / Math.max(1e-9, g);
    if (!batch.camera) {
      const n = [...str].length;
      faceTextStats.runs += 1;
      faceTextStats.glyphs += n;
      if (sx < faceTextStats.minSx) faceTextStats.minSx = sx;
      faceTextStats.texelRatioSum += n / Math.max(1e-9, sx);
      if (Math.abs(sx - 1) < 1e-6 && Math.abs(g - 1) < 1e-6) faceTextStats.exact += n;
    }
    textAspect.quads += 1;
    if (ratio < textAspect.minRatio) textAspect.minRatio = ratio;
    if (ratio > textAspect.maxRatio) textAspect.maxRatio = ratio;
    const run = textRun(batch, atlas.texture, false, snapScale, qualityScale);
    // Atlas size of this run (tests / diagnostics): texels per glyph em.
    if (run.bakePx === undefined) run.bakePx = atlas.bakePx;
    for (const ch of str) {
      const gl = atlas.glyphs.get(ch);
      if (!gl) continue;
      // 1:1 runs keep exact world coordinates (the vertex shader snaps the
      // corners to device pixels). Rounding to whole world px here made the
      // quad a different size than its texels at any non-integer zoom x dpr.
      const exact = snapScale > 0;
      const x0 = exact ? pen - TEXT_PAD * sx : Math.round(pen - TEXT_PAD * sx);
      const y0 = exact ? baseline - atlas.baseRow * g : Math.round(baseline - atlas.baseRow * g);
      const x1 = exact ? x0 + gl.w * sx : Math.round(x0 + gl.w * sx);
      const y1 = exact ? y0 + gl.h * g : Math.round(y0 + gl.h * g);
      const u0 = gl.x / atlas.sheetW; const u1 = (gl.x + gl.w) / atlas.sheetW;
      const v0 = gl.y / atlas.sheetH; const v1 = (gl.y + gl.h) / atlas.sheetH;
      pushTextQuad(batch, x0, y0, x1, y1, u0, v0, u1, v1, cr, cg, cb, ca);
      pen += gl.adv * sx;
    }
    run.end = batch.tn;
    return pen;
  }

  function pushTextVertex(d, i, x, y, u, v, r, g, b, a) {
    d[i] = x; d[i + 1] = y; d[i + 2] = u; d[i + 3] = v;
    d[i + 4] = r; d[i + 5] = g; d[i + 6] = b; d[i + 7] = a;
  }

  function pushTextQuad(batch, x0, y0, x1, y1, u0, v0, u1, v1, r, g, b, a) {
    let d = batch.tdata;
    const i = batch.tn;
    if (i + 48 > d.length) {
      const grown = new Float32Array(d.length * 2);
      grown.set(d);
      batch.tdata = d = grown;
    }
    pushTextVertex(d, i, x0, y0, u0, v0, r, g, b, a);
    pushTextVertex(d, i + 8, x1, y0, u1, v0, r, g, b, a);
    pushTextVertex(d, i + 16, x0, y1, u0, v1, r, g, b, a);
    pushTextVertex(d, i + 24, x1, y0, u1, v0, r, g, b, a);
    pushTextVertex(d, i + 32, x1, y1, u1, v1, r, g, b, a);
    pushTextVertex(d, i + 40, x0, y1, u0, v1, r, g, b, a);
    batch.tn = i + 48;
  }

  // ---- textured quad drawing ---------------------------------------------
  /** Growable per-state Float32Array (power-of-two growth; never shrinks). */
  function scratch(s, key, n) {
    let a = s[key];
    if (!a || a.length < n) {
      let cap = 1024;
      while (cap < n) cap *= 2;
      a = new Float32Array(cap);
      s[key] = a;
    }
    return a;
  }

  function drawTextured(s, w, h, verts, mode) {
    const gl = s.gl;
    const n = verts.length / 4;
    const out = scratch(s, "imgScratch", verts.length);
    const pix = s._drawBatch && s._drawBatch.camera;
    bindCam(gl, { pixel: s.imgCamPixel, cam: s.imgCamCam, vp: s.imgCamVp, device: s.imgCamDevice }, s._drawBatch);
    for (let i = 0; i < n; i += 1) {
      out[i * 4] = pix ? verts[i * 4] : (verts[i * 4] / w) * 2 - 1;
      out[i * 4 + 1] = pix ? verts[i * 4 + 1] : 1 - (verts[i * 4 + 1] / h) * 2;
      out[i * 4 + 2] = verts[i * 4 + 2];
      out[i * 4 + 3] = verts[i * 4 + 3];
    }
    gl.uniform1f(s.imgModeLoc, mode);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.imgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, verts.length), gl.STREAM_DRAW);
    const [pl, ul, tl] = s.imgAttribs;
    if (pl >= 0) { gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 16, 0); }
    if (ul >= 0) { gl.enableVertexAttribArray(ul); gl.vertexAttribPointer(ul, 2, gl.FLOAT, false, 16, 8); }
    if (tl >= 0) gl.vertexAttrib4f(tl, 1, 1, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    if (pl >= 0) gl.disableVertexAttribArray(pl);
    if (ul >= 0) gl.disableVertexAttribArray(ul);
  }

  /** Tinted textured triangles: data = pos2 uv2 rgba4 per vertex (device px). */
  function drawTexturedTinted(s, w, h, data, start, end, mode = 1) {
    drawTexturedTintedRanges(s, w, h, data, [{ start, end }], mode);
  }

  /** Several [start, end) ranges of one vertex array drawn as one upload and one draw. */
  function drawTexturedTintedRanges(s, w, h, data, ranges, mode = 1) {
    const gl = s.gl;
    let len = 0;
    for (let r = 0; r < ranges.length; r += 1) len += Math.max(0, ranges[r].end - ranges[r].start);
    if (len <= 0) return;
    const out = scratch(s, "tintScratch", len);
    const pix = s._drawBatch && s._drawBatch.camera;
    bindCam(gl, { pixel: s.imgCamPixel, cam: s.imgCamCam, vp: s.imgCamVp, device: s.imgCamDevice }, s._drawBatch);
    let i = 0;
    for (let r = 0; r < ranges.length; r += 1) {
      const start = ranges[r].start;
      const n = Math.max(0, ranges[r].end - start);
      for (let q = 0; q < n; q += 8, i += 8) {
        const j = start + q;
        out[i] = pix ? data[j] : (data[j] / w) * 2 - 1;
        out[i + 1] = pix ? data[j + 1] : 1 - (data[j + 1] / h) * 2;
        out[i + 2] = data[j + 2]; out[i + 3] = data[j + 3];
        out[i + 4] = data[j + 4]; out[i + 5] = data[j + 5]; out[i + 6] = data[j + 6]; out[i + 7] = data[j + 7];
      }
    }
    gl.uniform1f(s.imgModeLoc, mode);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.imgBuf);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, len), gl.STREAM_DRAW);
    const [pl, ul, tl] = s.imgAttribs;
    if (pl >= 0) { gl.enableVertexAttribArray(pl); gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 32, 0); }
    if (ul >= 0) { gl.enableVertexAttribArray(ul); gl.vertexAttribPointer(ul, 2, gl.FLOAT, false, 32, 8); }
    if (tl >= 0) { gl.enableVertexAttribArray(tl); gl.vertexAttribPointer(tl, 4, gl.FLOAT, false, 32, 16); }
    gl.drawArrays(gl.TRIANGLES, 0, len / 8);
    if (pl >= 0) gl.disableVertexAttribArray(pl);
    if (ul >= 0) gl.disableVertexAttribArray(ul);
    if (tl >= 0) gl.disableVertexAttribArray(tl);
  }

  function useTexturedProgram(s) {
    const gl = s.gl;
    gl.useProgram(s.imgProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(s.imgTexLoc, 0);
    // Jack holes are per picture (drawImages sets them); every other textured draw has none.
    if (s.imgHoleCount) gl.uniform1i(s.imgHoleCount, 0);
    if (s.imgSnap) gl.uniform1f(s.imgSnap, 0);
  }

  function nodeGraphGlLinesSnapImageQuad(batch, im) {
    const src = im?.source;
    const snap = Boolean(src && (src.dataset?.pixelSnap === "1" || src.classList?.contains("display-canvas-pixel-snap")));
    if (!snap) return { x0: im.x, y0: im.y, x1: im.x + im.w, y1: im.y + im.h };
    const cam = batch.camera;
    if (cam) {
      const z = cam.zoom > 0 ? cam.zoom : 1;
      const dev = batch.scale > 0 ? batch.scale : 1;
      const k = z * dev;
      const sx0 = Math.round((im.x - (cam.x || 0)) * k);
      const sy0 = Math.round((im.y - (cam.y || 0)) * k);
      const sw = Math.max(1, Math.round(im.w * k));
      const sh = Math.max(1, Math.round(im.h * k));
      return {
        x0: (cam.x || 0) + sx0 / k,
        y0: (cam.y || 0) + sy0 / k,
        x1: (cam.x || 0) + (sx0 + sw) / k,
        y1: (cam.y || 0) + (sy0 + sh) / k,
      };
    }
    const x0 = Math.round(im.x);
    const y0 = Math.round(im.y);
    return { x0, y0, x1: x0 + Math.max(1, Math.round(im.w)), y1: y0 + Math.max(1, Math.round(im.h)) };
  }

  function drawImages(batch, alphaDst) {
    const { s, w, h } = batch;
    const gl = s.gl;
    useTexturedProgram(s);
    gl.bindTexture(gl.TEXTURE_2D, s.imgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const faceTexture = typeof global.nodeGraphSharedGlFaceTexture === "function"
      ? global.nodeGraphSharedGlFaceTexture
      : null;
    const faceOnly = typeof global.nodeGraphSharedGlFaceTextureOnly === "function"
      ? global.nodeGraphSharedGlFaceTextureOnly
      : null;
    for (const im of batch.images) {
      const src = im.source;
      // A face that renders on this device: sample its GPU copy (top-down,
      // same orientation as a canvas upload). No upload (ZP-2).
      const isFace = !src.glSnapshot && faceOnly && faceOnly(src);
      const face = isFace && faceTexture ? faceTexture(src) : null;
      // A face with no texture yet (new or resized, not painted) shows
      // nothing: it has no bitmap to upload.
      if (isFace && !face) continue;
      if (src.glSnapshot) {
        gl.bindTexture(gl.TEXTURE_2D, src.texture);
      } else if (face) {
        gl.bindTexture(gl.TEXTURE_2D, face.texture);
      } else {
        let cached = im.cache ? s.texCache.get(src) : null;
        const sw = src.naturalWidth || src.width || 0;
        const sh = src.naturalHeight || src.height || 0;
        if (cached && (cached.w !== sw || cached.h !== sh || cached.src !== (src.currentSrc || src.src || ""))) {
          gl.deleteTexture(cached.texture);
          s.texCache.delete(src);
          cached = null;
        }
        if (im.cache && !cached) {
          cached = { texture: gl.createTexture(), w: sw, h: sh, src: src.currentSrc || src.src || "", fresh: true };
          s.texCache.set(src, cached);
        }
        gl.bindTexture(gl.TEXTURE_2D, cached ? cached.texture : s.imgTex);
        if (!cached || cached.fresh) {
          if (src.data && src.width > 0 && src.height > 0) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, src.width, src.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, src.data);
          } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          }
          if (cached) cached.fresh = false;
        }
      }
      // Per-image blend (exact for opaque pictures): normal over, add,
      // screen 1-(1-s)(1-d), multiply s*d, lighten max(s, d).
      const blend = im.blend;
      if (blend === "screen") gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR, gl.ONE, gl.ONE, alphaDst);
      else if (blend === "multiply") gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, blend === "add" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      if (blend === "lighten") gl.blendEquation(gl.MAX);
      const f = im.nearest ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1f(s.imgAlphaLoc, im.alpha);
      // Jack cutouts through this picture (camera mode only: they are in world units).
      const holes = batch.camera && Array.isArray(im.holes) ? im.holes.slice(0, 16) : [];
      if (s.imgHoleCount) gl.uniform1i(s.imgHoleCount, holes.length);
      if (holes.length && s.imgHoles) {
        const hd = new Float32Array(64);
        for (let hi = 0; hi < holes.length; hi += 1) {
          hd[hi * 4] = holes[hi].x;
          hd[hi * 4 + 1] = holes[hi].y;
          hd[hi * 4 + 2] = holes[hi].r;
          hd[hi * 4 + 3] = holes[hi].side;
        }
        gl.uniform4fv(s.imgHoles, hd);
        const cam = batch.camera;
        if (s.imgHoleAA) gl.uniform1f(s.imgHoleAA, 1 / Math.max(0.0001, (cam.zoom > 0 ? cam.zoom : 1) * (batch.scale > 0 ? batch.scale : 1)));
      }
      const snapped = nodeGraphGlLinesSnapImageQuad(batch, im);
      const x0 = snapped.x0; const x1 = snapped.x1; const y0 = snapped.y0; const y1 = snapped.y1;
      if (im.tint) {
        const t = im.tint;
        const q = scratch(s, "quadScratch", 48);
        const a = (t.length > 3 ? t[3] : 1) * im.alpha;
        pushTextVertex(q, 0, x0, y0, 0, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 8, x1, y0, 1, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 16, x0, y1, 0, 1, t[0], t[1], t[2], a);
        pushTextVertex(q, 24, x1, y0, 1, 0, t[0], t[1], t[2], a);
        pushTextVertex(q, 32, x1, y1, 1, 1, t[0], t[1], t[2], a);
        pushTextVertex(q, 40, x0, y1, 0, 1, t[0], t[1], t[2], a);
        drawTexturedTinted(s, w, h, q, 0, 48);
      } else {
        const quad = [x0, y0, 0, 0, x1, y0, 1, 0, x0, y1, 0, 1, x1, y0, 1, 0, x1, y1, 1, 1, x0, y1, 0, 1];
        // "straight": a straight-alpha picture (zero rgb where empty), same
        // two passes as the "straight" quads: colour lands unmultiplied on a
        // clear pixel, plain over on an opaque one. No dark edge.
        if (blend === "straight") {
          gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
          drawTextured(s, w, h, quad, 0);
          gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
        }
        drawTextured(s, w, h, quad, 0);
      }
      if (blend === "lighten") gl.blendEquation(gl.FUNC_ADD);
      if (src.glSnapshot && src.texture && !src.keep) {
        gl.deleteTexture(src.texture);
        src.texture = null;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function drawTexts(batch, alphaDst) {
    const { s, w, h } = batch;
    const gl = s.gl;
    useTexturedProgram(s);
    if (s.imgTextDark) {
      const dark = batch.textDark > 0 ? batch.textDark : 0;
      gl.uniform1f(s.imgTextDark, dark);
      const lamp = dark > 0 && typeof global.nodeGraphRoomLightUniform === "function" ? global.nodeGraphRoomLightUniform() : null;
      if (s.imgLamp) gl.uniform4f(s.imgLamp, lamp ? lamp[0] : 0, lamp ? lamp[1] : 0, lamp ? lamp[2] : 1, lamp ? lamp[3] : 0);
    }
    // One draw call per texture (glyph atlas or colour emoji page) and snap
    // state: several sizes alternate within a module, but each size has its own
    // atlas, so runs are grouped here rather than drawn one by one.
    const cam = batch.camera;
    const camScale = cam ? (cam.zoom > 0 ? cam.zoom : 1) * (batch.scale > 0 ? batch.scale : 1) : 0;
    const groups = [];
    for (const t of batch.texts) {
      if (t.end <= t.start || !t.texture) continue;
      // A retired atlas is marked at delete. gl.isTexture is a synchronous GPU
      // round trip per run; on replayed meshes it cost ~4 ms a frame.
      if (t.texture.__glDeleted) continue;
      // Origins snap only while the camera still matches the scale the run
      // was recorded at (a mid-zoom replay is scaled, so snapping would jitter).
      const snap = camScale > 0 && t.snapScale > 0 && Math.abs(t.snapScale - camScale) <= 1e-3 * camScale ? 1 : 0;
      let grp = null;
      for (let gi = 0; gi < groups.length; gi += 1) {
        const c = groups[gi];
        if (c.texture === t.texture && c.snap === snap && c.color === Boolean(t.color)) { grp = c; break; }
      }
      if (!grp) { grp = { texture: t.texture, color: Boolean(t.color), snap, ranges: [] }; groups.push(grp); }
      grp.ranges.push(t);
    }
    for (const t of groups) {
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      if (s.imgSnap) gl.uniform1f(s.imgSnap, t.snap);
      // Workspace zoom above 2.5 samples the 64px glyph bake nearest, same
      // policy as .pixelated-canvas-zoom. Emoji pages stay NEAREST always.
      if (!t.color) {
        const pixel = batch.textPixelated === true;
        const mag = pixel ? gl.NEAREST : gl.LINEAR;
        const min = pixel ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
      }
      if (t.color) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      drawTexturedTintedRanges(s, w, h, batch.tdata, t.ranges, t.color ? 3 : 1);
    }
    if (s.imgSnap) gl.uniform1f(s.imgSnap, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (s.imgTextDark) gl.uniform1f(s.imgTextDark, 0);
    const dead = s.deadTextures;
    if (dead && dead.length) {
      for (let i = 0; i < dead.length; i += 1) {
        dead[i].__glDeleted = true;
        gl.deleteTexture(dead[i]);
      }
      dead.length = 0;
    }
  }

  // Pulse Train forest: one instance per pulse. Stem is a vertical capsule,
  // dot is the same disc recolored when lit (no extra halo circle).
  const PT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform vec2 uVp;
uniform float uCount;
uniform float uDuration;
uniform float uAxis;
uniform float uCurve;
uniform float uSpacing;
uniform float uAmpStart;
uniform float uAmpEnd;
uniform float uAmpCurve;
uniform float uAmp;
uniform float uLoop;
uniform float uPulseMode;
uniform float uPolarity;
uniform float uX0;
uniform float uX1;
uniform float uBase;
uniform float uTop;
uniform float uPeak;
uniform float uElapsed;
uniform float uFadeTau;
uniform float uHalf;
uniform float uFeather;
uniform float uDotR;
uniform float uMode;
uniform vec4 uLine;
uniform vec4 uDotCol;
uniform vec4 uLit;
out vec2 vLocal;
out float vLen;
out float vAcross;
out float vPolyline;
out float vHalf;
out float vFeather;
out float vMode;
out vec4 vColour;
float curveShape(float k, float u) {
  if (!(abs(k) > 1e-6)) return u;
  float den = exp(k) - 1.0;
  if (abs(den) < 1e-12) return u;
  return (exp(k * u) - 1.0) / den;
}
float timeWarp(float k, float u, int i, float n, bool iLoop) {
  if (!(u >= 0.0)) u = 0.0;
  if (u > 1.0) u = 1.0;
  float fam = uSpacing;
  if (fam >= 0.5 && fam < 1.5) {
    float ii = float(i);
    float h = iLoop
      ? (n > 0.0 ? (ii * (ii + 1.0)) / (n * (n + 1.0)) : 0.0)
      : (n > 1.0 ? (ii * (ii + 1.0)) / ((n - 1.0) * n) : 0.0);
    float w = clamp(abs(k) * 0.1, 0.0, 1.0);
    if (!(k < 0.0)) return u + w * (h - u);
    float hr = iLoop
      ? (n > 0.0 ? (ii * (2.0 * n - ii + 1.0)) / (n * (n + 1.0)) : 0.0)
      : (n > 1.0 ? (ii * (2.0 * n - ii - 1.0)) / ((n - 1.0) * n) : 0.0);
    return u + w * (hr - u);
  }
  if (fam >= 1.5) {
    float s = clamp(k * 0.1, -0.99, 0.99);
    float den = 1.0 - s + 2.0 * s * u;
    if (abs(den) < 1e-12) return u;
    return ((1.0 + s) * u) / den;
  }
  return curveShape(k, u);
}
void main() {
  int id = gl_InstanceID;
  float n = max(uCount, 1.0);
  int ni = int(n + 0.5);
  float p = uPulseMode;
  if (!(p > 0.0)) p = 0.0;
  if (p > 1.0) p = 1.0;
  float preAmt = p <= 0.0 ? 0.0 : (p >= 0.5 ? 1.0 : p * 2.0);
  float postAmt = p >= 1.0 ? 0.0 : (p <= 0.5 ? 1.0 : (1.0 - p) * 2.0);
  bool revOnly = preAmt > 0.0 && !(postAmt > 0.0);
  bool dual = preAmt > 0.0 && postAmt > 0.0;
  bool rev = revOnly || (dual && id >= ni);
  int i = id < ni ? id : (2 * ni - 1 - id);
  if (revOnly) i = id;
  float kT = uCurve;
  bool iLoop = uLoop > 0.5 && !rev;
  float uu = iLoop ? float(i) / n : (n > 1.0 ? float(i) / (n - 1.0) : 0.0);
  float tf;
  if (!iLoop && i == ni - 1 && n > 1.0) tf = uDuration;
  else tf = uDuration * timeWarp(kT, uu, i, n, iLoop);
  if (!(tf >= 0.0)) tf = 0.0;
  if (tf > uDuration) tf = uDuration;
  float t;
  if (rev) {
    t = preAmt * (uDuration - tf);
  } else {
    t = preAmt * uDuration + postAmt * tf;
  }
  if (revOnly && uLoop > 0.5 && n > 1.0) t *= (n - 1.0) / n;
  if (!(t >= 0.0)) t = 0.0;
  if (t > uAxis) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vLocal = vec2(0.0);
    vLen = 0.0;
    vHalf = 0.0;
    vColour = vec4(0.0);
    return;
  }
  float a0 = uPolarity > 0.5 ? uAmpEnd : uAmpStart;
  float a1 = uPolarity > 0.5 ? uAmpStart : uAmpEnd;
  float kA = uAmpCurve;
  float amp = abs((a0 + (a1 - a0) * curveShape(kA, uu)) * uAmp);
  float x = mix(uX0, uX1, clamp(t / uAxis, 0.0, 1.0));
  float y = uBase - (amp / uPeak) * (uBase - uTop);
  bool fired = uElapsed >= 0.0 && t <= uElapsed;
  float age = fired ? uElapsed - t : 1e9;
  // PhosphorResidual.energyAfterSeconds: exp(-age / tau). tau 0 = hold.
  float litAmt = 0.0;
  if (fired) litAmt = uFadeTau > 0.0 ? exp(-age / uFadeTau) : 1.0;
  vMode = uMode;
  vFeather = max(uFeather, 1e-4);
  vec2 pos;
  if (uMode < 0.5) {
    float len = max(0.0, uBase - y);
    if (len <= 0.5) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      vLocal = vec2(0.0);
      vLen = 0.0;
      vHalf = 0.0;
      vColour = vec4(0.0);
      return;
    }
    float r = uHalf + vFeather;
    float along = -r + aCorner.x * (len + 2.0 * r);
    float across = mix(-r, r, aCorner.y);
    pos = vec2(x + across, uBase - along);
    vLocal = vec2(along, across);
    vLen = len;
    vHalf = uHalf;
    vColour = mix(uLine, uLit, litAmt);
  } else {
    float rad = max(uDotR, 0.0);
    float r = rad + vFeather;
    if (r <= 0.0) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      vLocal = vec2(0.0);
      vLen = 0.0;
      vHalf = 0.0;
      vColour = vec4(0.0);
      return;
    }
    vec2 off = (aCorner * 2.0 - 1.0) * r;
    pos = vec2(x, y) + off;
    vLocal = off;
    vLen = 0.0;
    vHalf = rad;
    vColour = mix(uDotCol, uLit, litAmt);
  }
  gl_Position = vec4(pos.x / uVp.x * 2.0 - 1.0, 1.0 - pos.y / uVp.y * 2.0, 0.0, 1.0);
}
`;
  const PT_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen;
in float vHalf;
in float vFeather;
in float vMode;
in vec4 vColour;
out vec4 fragColor;
${COVERAGE_GLSL}
void main() {
  float a;
  if (vMode < 0.5) {
    float u = vLocal.x;
    float across = abs(vLocal.y);
    float outside = u < 0.0 ? -u : (u > vLen ? u - vLen : 0.0);
    float d = outside > 0.0 ? length(vec2(outside, vLocal.y)) : across;
    a = coverageEdge(vHalf, vFeather, d);
  } else {
    float d = length(vLocal);
    a = coverageEdge(vHalf, vFeather, d);
  }
  if (a < 0.004) discard;
  fragColor = vec4(vColour.rgb, vColour.a * a);
}
`;

  function ensurePulseTrain(s) {
    if (!s || s.pulseTrainFailed) return null;
    if (s.pulseTrain) return s.pulseTrain;
    const gl = s.gl;
    if (!gl || typeof gl.drawArraysInstanced !== "function") {
      s.pulseTrainFailed = true;
      return null;
    }
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, PT_VS, "pulseTrain vertex");
      const fs = compile(gl, gl.FRAGMENT_SHADER, PT_FS, "pulseTrain fragment");
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.bindAttribLocation(program, 0, "aCorner");
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || "link failed";
        gl.deleteProgram(program);
        throw new Error(log);
      }
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 1, 0, 0, 1,
        1, 0, 1, 1, 0, 1,
      ]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const u = (name) => gl.getUniformLocation(program, name);
      s.pulseTrain = {
        program,
        buf,
        uVp: u("uVp"),
        uCount: u("uCount"),
        uDuration: u("uDuration"),
        uAxis: u("uAxis"),
        uCurve: u("uCurve"),
        uSpacing: u("uSpacing"),
        uAmpStart: u("uAmpStart"),
        uAmpEnd: u("uAmpEnd"),
        uAmpCurve: u("uAmpCurve"),
        uAmp: u("uAmp"),
        uLoop: u("uLoop"),
        uPulseMode: u("uPulseMode"),
        uPolarity: u("uPolarity"),
        uX0: u("uX0"),
        uX1: u("uX1"),
        uBase: u("uBase"),
        uTop: u("uTop"),
        uPeak: u("uPeak"),
        uElapsed: u("uElapsed"),
        uFadeTau: u("uFadeTau"),
        uHalf: u("uHalf"),
        uFeather: u("uFeather"),
        uDotR: u("uDotR"),
        uMode: u("uMode"),
        uLine: u("uLine"),
        uDotCol: u("uDotCol"),
        uLit: u("uLit"),
      };
      return s.pulseTrain;
    } catch (error) {
      s.pulseTrainFailed = true;
      console.error("[gl-line-renderer] pulse train shader failed: " + String(error?.message || error));
      return null;
    }
  }

  function drawPulseTrains(batch) {
    const pt = ensurePulseTrain(batch.s);
    if (!pt || !batch.pulseTrains?.length) return;
    const gl = batch.s.gl;
    const { w, h } = batch;
    gl.useProgram(pt.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, pt.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.uniform2f(pt.uVp, w, h);
    for (const spec of batch.pulseTrains) {
      gl.uniform1f(pt.uCount, spec.nFwd || spec.count);
      gl.uniform1f(pt.uPulseMode, spec.pulseMode || 0);
      gl.uniform1f(pt.uPolarity, spec.polarity || 0);
      gl.uniform1f(pt.uDuration, spec.duration);
      gl.uniform1f(pt.uAxis, spec.axisEnd);
      gl.uniform1f(pt.uCurve, spec.curve);
      gl.uniform1f(pt.uSpacing, spec.spacing || 0);
      gl.uniform1f(pt.uAmpStart, spec.ampStart);
      gl.uniform1f(pt.uAmpEnd, spec.ampEnd);
      gl.uniform1f(pt.uAmpCurve, spec.ampCurve);
      gl.uniform1f(pt.uAmp, spec.amplitude);
      gl.uniform1f(pt.uLoop, spec.loop);
      gl.uniform1f(pt.uX0, spec.x0);
      gl.uniform1f(pt.uX1, spec.x1);
      gl.uniform1f(pt.uBase, spec.base);
      gl.uniform1f(pt.uTop, spec.top);
      gl.uniform1f(pt.uPeak, spec.peak);
      gl.uniform1f(pt.uElapsed, spec.elapsed);
      gl.uniform1f(pt.uFadeTau, spec.fadeTau);
      gl.uniform1f(pt.uHalf, spec.half);
      gl.uniform1f(pt.uFeather, spec.feather);
      gl.uniform1f(pt.uDotR, spec.dotR);
      gl.uniform4f(pt.uLine, spec.line[0], spec.line[1], spec.line[2], spec.line[3]);
      gl.uniform4f(pt.uDotCol, spec.dot[0], spec.dot[1], spec.dot[2], spec.dot[3]);
      gl.uniform4f(pt.uLit, spec.lit[0], spec.lit[1], spec.lit[2], spec.lit[3]);
      gl.uniform1f(pt.uMode, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, spec.count);
      if (spec.dotR > 0) {
        gl.uniform1f(pt.uMode, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, spec.count);
      }
    }
    gl.disableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  // Rounded rect (nodeGraphGlLinesRoundRect): one instance per box, worked in
  // device px. Camera batches: rect / radius / stroke are world px (x zoom x
  // device); feather is screen CSS px (x device). Otherwise CSS px x uScale.
  const RR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRect;
layout(location = 2) in vec4 aShape;
layout(location = 3) in vec4 aFill;
layout(location = 4) in vec4 aStroke;
layout(location = 5) in vec4 aFill2;
uniform float uPixel;
uniform vec3 uCam;
uniform vec2 uVp;
uniform float uDevice;
uniform float uScale;
out vec2 vP;
out vec2 vHalf;
out vec3 vShape;
out float vRadiusTop;
out vec4 vFill;
out vec4 vStroke;
out vec4 vFill2;
void main() {
  float k = uPixel > 0.5 ? max(uCam.z, 0.0001) * uDevice : uScale;
  float fk = uPixel > 0.5 ? uDevice : uScale;
  vec2 centre = aRect.xy + aRect.zw * 0.5;
  vec2 dev = uPixel > 0.5 ? (centre - uCam.xy) * k : centre * k;
  vec2 halfSize = aRect.zw * 0.5 * k;
  float feather = aShape.z * fk;
  vec2 off = (aCorner * 2.0 - 1.0) * (halfSize + feather);
  vec2 pos = dev + off;
  gl_Position = vec4(pos.x / uVp.x * 2.0 - 1.0, 1.0 - pos.y / uVp.y * 2.0, 0.0, 1.0);
  vP = off;
  vHalf = halfSize;
  vShape = vec3(aShape.x * k, aShape.y * k, feather);
  vRadiusTop = aShape.w * k;
  vFill = aFill;
  vStroke = aStroke;
  vFill2 = aFill2;
}
`;
  const RR_FS = `#version 300 es
precision highp float;
in vec2 vP;
in vec2 vHalf;
in vec3 vShape;
in float vRadiusTop;
in vec4 vFill;
in vec4 vStroke;
in vec4 vFill2;
out vec4 fragColor;
// Inside fraction across a filled edge at sd = 0 (sd < 0 is inside): the
// batch's edge curve over a window w wide centred on the outline, so box sizes
// stay exact (fills keep their edge on the outline; lines use the outer
// skirt). uEdge 0 = display Expo, 1 = chrome smootherstep. In-shader 4x4
// supersampling like the line coverage.
uniform float uEdge;
float insideAt(float sd, float w) {
  float t = clamp(sd / max(w, 1e-4) + 0.5, 0.0, 1.0);
  if (uEdge > 0.5) return 1.0 - t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  return ${NODE_GRAPH_GL_LINES_EXPO_SKIRT_GLSL};
}
float inside(float sd, float w) {
  vec2 g = vec2(dFdx(sd), dFdy(sd));
  float acc = 0.0;
  for (int j = 0; j < 4; j += 1) {
    for (int i = 0; i < 4; i += 1) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) * 0.25 - 0.5;
      acc += insideAt(sd + dot(o, g), w);
    }
  }
  return acc * 0.0625;
}
void main() {
  // Top corners (vP.y < 0, y down) may use their own radius.
  float r = min(vP.y < 0.0 ? vRadiusTop : vShape.x, min(vHalf.x, vHalf.y));
  vec2 q = abs(vP) - vHalf + r;
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float w = vShape.z;
  float outer = inside(sd, w);
  float stroke = min(vShape.y, min(vHalf.x, vHalf.y));
  float fill = stroke > 0.0 ? inside(sd + stroke, w) : 1.0;
  // Vertical gradient: vFill at the top edge, vFill2 at the bottom edge.
  vec4 body = mix(vFill, vFill2, clamp(vP.y / max(2.0 * vHalf.y, 1e-4) + 0.5, 0.0, 1.0));
  vec4 c = mix(vStroke, body, fill);
  float a = outer * c.a;
  if (a < 0.004) discard;
  fragColor = vec4(c.rgb, a);
}
`;
  const RR_FLOATS = 20;

  function ensureRoundRect(s) {
    if (!s || s.roundRectFailed) return null;
    if (s.roundRect) return s.roundRect;
    const gl = s.gl;
    if (!gl || typeof gl.drawArraysInstanced !== "function") {
      s.roundRectFailed = true;
      return null;
    }
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, RR_VS, "roundRect vertex");
      const fs = compile(gl, gl.FRAGMENT_SHADER, RR_FS, "roundRect fragment");
      const program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) || "link failed";
        gl.deleteProgram(program);
        throw new Error(log);
      }
      const corners = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0, 1, 0, 0, 1,
        1, 0, 1, 1, 0, 1,
      ]), gl.STATIC_DRAW);
      const instances = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const u = (name) => gl.getUniformLocation(program, name);
      s.roundRect = {
        program,
        corners,
        instances,
        locs: { pixel: u("uPixel"), cam: u("uCam"), vp: u("uVp"), device: u("uDevice") },
        uScale: u("uScale"),
        uVp: u("uVp"),
        uEdge: u("uEdge"),
        scratch: new Float32Array(RR_FLOATS * 64),
      };
      return s.roundRect;
    } catch (error) {
      s.roundRectFailed = true;
      console.error("[gl-line-renderer] round rect shader failed: " + String(error?.message || error));
      return null;
    }
  }

  function drawRoundRects(batch) {
    const rr = ensureRoundRect(batch.s);
    const list = batch.roundRects;
    if (!rr || !list?.length) return;
    const gl = batch.s.gl;
    const count = list.length / RR_FLOATS;
    if (rr.scratch.length < list.length) rr.scratch = new Float32Array(list.length * 2);
    rr.scratch.set(list);
    gl.useProgram(rr.program);
    gl.uniform2f(rr.uVp, batch.w, batch.h);
    gl.uniform1f(rr.uScale, batch.scale > 0 ? batch.scale : 1);
    if (rr.uEdge) gl.uniform1f(rr.uEdge, batch.edge === "chrome" ? 1 : 0);
    bindCam(gl, rr.locs, batch);
    gl.bindBuffer(gl.ARRAY_BUFFER, rr.corners);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, rr.instances);
    gl.bufferData(gl.ARRAY_BUFFER, rr.scratch.subarray(0, list.length), gl.STREAM_DRAW);
    const sizes = [4, 4, 4, 4, 4];
    let off = 0;
    for (let i = 0; i < sizes.length; i += 1) {
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, sizes[i], gl.FLOAT, false, RR_FLOATS * 4, off * 4);
      gl.vertexAttribDivisor(i + 1, 1);
      off += sizes[i];
    }
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    for (let i = 1; i <= sizes.length; i += 1) {
      gl.vertexAttribDivisor(i, 0);
      gl.disableVertexAttribArray(i);
    }
    gl.disableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Draw images, quads, text into the bound framebuffer with the given blend funcs. */
  function drawContent(batch, blend, alphaDst) {
    const { s } = batch;
    const gl = s.gl;
    s._drawBatch = batch;
    const colourDst = blend === "add" ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA;
    gl.enable(gl.BLEND);
    if (batch.lightsOn) drawLights(batch);
    if (batch.images.length) {
      drawImages(batch, alphaDst);
    }
    const drawQuads = (data, n, start = 0) => {
      const count = (n - start) / FLOATS;
      if (!(count > 0) || !data) return;
      // "max": straight coverage. The dot canvas is premultipliedAlpha:false,
      // so a normal SRC_ALPHA write gets multiplied again when it crosses the
      // wire and leaves a dark ring. MAX unions same-colour coverage.
      const max = blend === "max";
      // "straight": normal over-blend, but where the pixel underneath is
      // transparent the colour lands unmultiplied. A plain SRC_ALPHA edge
      // there gets multiplied again by the premultipliedAlpha:false
      // compositor and shows as a dark ring over whatever lies below.
      // Pass 1 adds colour * (1 - dst alpha) on covered pixels only (the
      // coverage cut zeroes the quad's empty corners); pass 2 is the normal
      // over-blend: c*a + c*(1-a) = c on a clear pixel, plain over on a plate.
      const straight = blend === "straight";
      if (max) gl.blendEquation(gl.MAX);
      gl.blendFuncSeparate(max ? gl.ONE : gl.SRC_ALPHA, max ? gl.ONE : colourDst, gl.ONE, max ? gl.ONE : alphaDst);
      gl.useProgram(s.program);
      bindCam(gl, lineCamLocs(s), batch);
      if (s.lineDash) gl.uniform2f(s.lineDash, batch.dashOn || 0, batch.dashOff || 0);
      if (s.coverage) gl.uniform1f(s.coverage, max || straight ? 1 : 0);
      if (s.lineEdge) gl.uniform1f(s.lineEdge, batch.edge === "chrome" ? 1 : 0);
      if (batch.spectralWire) {
        const v = { ...SPECTRAL_WIRE_DEFAULTS, ...batch.spectralWire };
        gl.uniform4f(s.spectralProfile, v.brightPoint, v.edgeBrightness, v.centerAlpha, v.bend);
        gl.uniform4f(s.spectralColour, v.iridescence, v.hueSpread, v.sheenLength, v.baseTint);
        gl.uniform1f(s.spectralPhase, v.phase);
        gl.uniform1f(s.spectralDimPoint, v.dimPoint);
        gl.uniform1f(s.spectralShape, v.shape);
        gl.uniform1f(s.spectralPixelMode, v.pixelProfile ? 1 : 0);
        if (v.pixelProfile) gl.uniform1fv(s.spectralPixels, v.pixelProfile);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(start, n), gl.STREAM_DRAW);
      const sizes = [2, 2, 1, 1, 1, 1, 4];
      let off = 0;
      for (let i = 0; i < sizes.length; i += 1) {
        const loc = s.attribs[i];
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, sizes[i], gl.FLOAT, false, FLOATS * 4, off * 4);
        }
        off += sizes[i];
      }
      if (straight) {
        gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, 0, count);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      }
      gl.drawArrays(gl.TRIANGLES, 0, count);
      for (const loc of s.attribs) if (loc >= 0) gl.disableVertexAttribArray(loc);
      if (max) gl.blendEquation(gl.FUNC_ADD);
    };
    if (batch.gn > 0) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      drawQuads(batch.gdata, batch.gn);
      gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
    }
    // Quads and strokes in call order (a stroke sits between the quads pushed
    // before and after it).
    const drawLayer = (over) => {
      const data = over ? batch.over : batch.data;
      const n = over ? batch.on : batch.n;
      let pos = 0;
      for (const g of batch.strokes || []) {
        if (g.over !== over) continue;
        if (g.at > pos) drawQuads(data, g.at, pos);
        pos = Math.max(pos, g.at);
        drawStrokeGroup(batch, g, blend, colourDst, alphaDst);
        gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
      }
      if (n > pos) drawQuads(data, n, pos);
    };
    drawLayer(false);
    if (batch.pulseTrains?.length) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
      drawPulseTrains(batch);
    }
    if (batch.outlines?.length) {
      // The outline shader writes straight (non-premultiplied) colour, so it needs the normal over-blend. Without this it ran with
      // whatever the previous draw left set (the lights pass leaves premultiplied blending), which drew every module stroke at full
      // brightness whatever its alpha: the module stroke alpha only worked as on / off.
      gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
      drawOutlines(batch);
    }
    drawLayer(true);
    if (batch.roundRects?.length) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, colourDst, gl.ONE, alphaDst);
      drawRoundRects(batch);
    }
    if (batch.texts.length) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, alphaDst);
      drawTexts(batch, alphaDst);
    }
    if (batch.veils?.length) drawVeils(batch);
    if (batch.layers?.length) {
      for (const layer of batch.layers) {
        const offset = layer.worldOffset;
        layer.camera = offset && batch.camera
          ? { ...batch.camera, x: batch.camera.x - offset.x, y: batch.camera.y - offset.y }
          : batch.camera;
        layer.textPixelated = batch.textPixelated;
        // A layer may ask for its own quad blend (e.g. "straight" wire dots).
        drawContent(layer, layer.quadBlend || blend, alphaDst);
      }
      s._drawBatch = batch;
    }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  function publishNodeIdFor(batch) {
    if (batch.publishNodeId !== undefined) return String(batch.publishNodeId || "");
    const host = batch.canvas?.closest?.(".dsp-node, [data-node]");
    return String(host?.dataset?.node || "");
  }

  /**
   * Draw the batch and blit it into the face's 2D canvas.
   * blend "add" = GL_SRC_ALPHA, GL_ONE (Sabrina plugin); "alpha" = normal over.
   * @returns {boolean} false -> caller fills black.
   */
  function nodeGraphGlLinesEnd(batch, blend = "alpha") {
    if (!batch) return false;
    try {
      return endBatch(batch, blend);
    } finally {
      releaseBatch(batch);
    }
  }

  function releaseBatch(batch) {
    if (batch.keepMesh) return;
    // Layer arrays are small and not pooled (Begin expects full-size pool arrays).
    batch.layers = null;
    // Hand the vertex array back for the next face (pool stays tiny).
    if (batch.data && batch.s.pool.length < 8) batch.s.pool.push(batch.data);
    if (batch.tdata && batch.s.tpool.length < 8) batch.s.tpool.push(batch.tdata);
    batch.data = null;
    batch.tdata = null;
    batch.n = 0;
    batch.tn = 0;
    batch.strokes = null;
  }

  /**
   * Draw the batch into the framebuffer the caller has bound (its viewport
   * covers batch.w x batch.h, y down like Begin). No clear, no picture out, no
   * copy to a face canvas: for faces that own their GPU picture and layer
   * marks on it in the same pass (waterfall ink: pause / protect / RMS dB
   * guides go straight into the waterfall present or its history texture).
   * @returns {boolean} false -> caller calls nodeGraphDisplayGlFailed.
   */
  function nodeGraphGlLinesDrawInto(batch, blend = "alpha") {
    if (!batch) return false;
    try {
      const gl = batch.s.gl;
      if (gl.isContextLost()) return false;
      if (gl.bindVertexArray) gl.bindVertexArray(null);
      // The caller's quads may leave arrays enabled on the default VAO; a
      // constant attribute (text tint) must not read a stale buffer.
      for (let i = 0; i < 8; i += 1) gl.disableVertexAttribArray(i);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      // Opaque target: colour over, alpha stays 1.
      drawContent(batch, blend, gl.ONE);
      gl.disable(gl.BLEND);
      return !gl.isContextLost();
    } finally {
      releaseBatch(batch);
    }
  }

  function endBatch(batch, blend) {
    const { s, w, h } = batch;
    const gl = s.gl;
    if (gl.isContextLost()) return false;
    const ctx = typeof global.nodeGraphSharedGlPresentTarget === "function"
      ? global.nodeGraphSharedGlPresentTarget(batch.canvas)
      : null;
    if (!ctx) return false;
    if (gl.bindVertexArray) gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    const cl = batch.clear || [0, 0, 0, 1];

    // RGBA picture out: only when something is cabled to this node's TV out.
    const nodeId = publishNodeIdFor(batch);
    const target = nodeId
      && typeof global.nodeGraphPictureHasConsumer === "function"
      && global.nodeGraphPictureHasConsumer(nodeId)
      && typeof global.nodeGraphPictureExportTarget === "function"
      ? global.nodeGraphPictureExportTarget(nodeId, w, h)
      : null;
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Premultiplied result: rgb = sum(c * a), alpha = over-composited coverage.
      drawContent(batch, blend, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    if (typeof global.nodeGraphSharedGlBindPresent === "function") {
      global.nodeGraphSharedGlBindPresent(gl, w, h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
    }
    gl.clearColor(cl[0], cl[1], cl[2], cl.length > 3 ? cl[3] : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (target) {
      // Face = plate + the published picture (premultiplied over).
      useTexturedProgram(s);
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      // FBO row 0 is the bottom: flip v.
      drawTextured(s, w, h, [0, 0, 0, 1, w, 0, 1, 1, 0, h, 0, 0, w, 0, 1, 1, w, h, 1, 0, 0, h, 0, 0], 2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      // Colour additive / over; alpha always accumulates to opaque.
      drawContent(batch, blend, gl.ONE);
    }
    if (typeof global.nodeGraphSharedGlEndPresent === "function") global.nodeGraphSharedGlEndPresent(gl);
    if (gl.isContextLost()) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // replace: the face texture gets this rect as is (a transparent batch).
    const replace = batch.transparent && batch.keep !== true;
    if (replace && !ctx.facePresentTarget) ctx.clearRect(0, 0, w, h);
    return global.nodeGraphSharedGlPresent(ctx, w, h, { replace }) !== false;
  }

  /** GL unavailable: plain black square (no 2D drawing fallback). */
  function nodeGraphGlLinesFillBlack(canvas) {
    if (!canvas) return;
    // A face's black plate is its face texture filled black.
    if (typeof global.nodeGraphSharedGlFaceTextureOnly === "function" && global.nodeGraphSharedGlFaceTextureOnly(canvas)) {
      if (typeof global.nodeGraphSharedGlFaceFill === "function") global.nodeGraphSharedGlFaceFill(canvas, [0, 0, 0, 1]);
      return;
    }
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /** "#rgb" / "#rrggbb" / "rgb(a)(...)" / "hsl(a)(...)" -> [r,g,b,a] 0..1. */
  function nodeGraphGlLinesCss(css, alpha = 1) {
    const s = String(css || "").trim().toLowerCase();
    let m = /^#([0-9a-f]{3})$/.exec(s);
    if (m) return [...m[1]].map((c) => parseInt(c + c, 16) / 255).concat(alpha);
    m = /^#([0-9a-f]{6})$/.exec(s);
    if (m) {
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
    }
    m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
    if (m) {
      const parts = m[2].split(/[\s,/]+/).filter(Boolean);
      const num = (v) => parseFloat(v);
      const a = parts.length > 3 ? (parts[3].endsWith("%") ? num(parts[3]) / 100 : num(parts[3])) : 1;
      if (m[1].startsWith("rgb")) {
        const ch = (v) => (v.endsWith("%") ? num(v) / 100 : num(v) / 255);
        return [ch(parts[0]), ch(parts[1]), ch(parts[2]), a * alpha];
      }
      return nodeGraphGlLinesHsl(num(parts[0]), num(parts[1]) / 100, num(parts[2]) / 100, a * alpha);
    }
    return [0, 0, 0, alpha];
  }

  /** HSL (hue degrees, s/l 0..1) -> [r,g,b,a] 0..1. */
  function nodeGraphGlLinesHsl(hDeg, s, l, alpha = 1) {
    const h = ((((Number(hDeg) || 0) % 360) + 360) % 360) / 360;
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4), alpha];
  }

  const OUT_MAX = 24;
  const CUT_MAX = 16;
  // Module lights for this batch (camera mode only): items { x, y, w, h, id, base: [r, g, b], reach,
  // round } in world units. Colours and strengths are resolved at draw time, so they follow the module
  // levels on every replayed frame.
  function nodeGraphGlLinesLights(batch, items, opts) {
    if (!batch || !batch.camera) return;
    batch.lights = Array.isArray(items) ? items.slice(0, 64) : null;
    batch.lightOpts = opts || {};
    batch.lightsOn = batch.lights !== null;
  }

  function drawLights(batch) {
    const { s } = batch;
    const gl = s.gl;
    const cam = batch.camera;
    const items = batch.lights;
    if (!s.lightProgram || !cam || !items) return;
    const grid = typeof global.nodeGraphGridLightParams === "function" ? global.nodeGraphGridLightParams() : null;
    if (!items.length && !grid) return;
    const rect = new Float32Array(64 * 4);
    const glow = new Float32Array(64 * 4);
    const stroke = new Float32Array(64 * 4);
    const bright = typeof global.nodeGraphModuleLightBrightness === "function" ? global.nodeGraphModuleLightBrightness() : 1;
    // The stroke light (and its loudness part) is not dimmed by the room: the module light brightness
    // setting only.
    const strokeBright = typeof global.nodeGraphModuleStrokeLightBrightness === "function" ? global.nodeGraphModuleStrokeLightBrightness() : bright;
    if (!(bright > 0) && !(strokeBright > 0) && !grid) return;
    const levelOf = typeof global.nodeGraphModuleStrokeFollowLevel === "function" ? global.nodeGraphModuleStrokeFollowLevel : null;
    const loudOf = typeof global.nodeGraphStrokeLoudColor === "function" ? global.nodeGraphStrokeLoudColor : null;
    const glowLv = typeof global.nodeGraphModuleGlowLevels === "function" ? global.nodeGraphModuleGlowLevels() : { rest: 0.155, loud: 0.16, spread: 0.505 };
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      const k = levelOf ? levelOf(it.id) : 0;
      // A selected module keeps its selected colour while it animates (it only gets brighter), so it still reads as selected.
      const loud = k > 0 && loudOf && !it.selected ? loudOf(it.id) : null;
      rect.set([it.x, it.y, it.w, it.h], i * 4);
      // A module that is not animating (no signal) has no glow: it ramps in over the first part of the level.
      const gate = Math.min(1, k * 8);
      glow.set([it.reach, 0.16 * bright, strokeBright * gate * (glowLv.rest + glowLv.loud * k), it.round || 0], i * 4);
      stroke.set([
        loud ? it.base[0] + (loud[0] - it.base[0]) * k : it.base[0],
        loud ? it.base[1] + (loud[1] - it.base[1]) * k : it.base[1],
        loud ? it.base[2] + (loud[2] - it.base[2]) * k : it.base[2],
        (it.glowReach > 0 ? it.glowReach : it.reach) * glowLv.spread,
      ], i * 4);
    }
    gl.useProgram(s.lightProgram);
    bindCam(gl, { pixel: s.lightCamPixel, cam: s.lightCamCam, vp: s.lightCamVp, device: s.lightCamDevice }, batch);
    gl.uniform1i(s.lightCount, items.length);
    gl.uniform4fv(s.lightRect, rect);
    gl.uniform4fv(s.lightGlow, glow);
    gl.uniform4fv(s.lightStroke, stroke);
    const lo = batch.lightOpts || {};
    if (s.lightGridMin) gl.uniform2f(s.lightGridMin, lo.gridMinX || 140, lo.gridMinY || 140);
    if (s.lightSpread) gl.uniform1f(s.lightSpread, lo.spread || 0.78);
    const scalePx = batch.scale > 0 ? batch.scale : 1;
    if (s.lightGridOn) gl.uniform1f(s.lightGridOn, grid ? 1 : 0);
    if (grid) {
      gl.uniform2f(s.lightGridCell, grid.cell[0], grid.cell[1]);
      gl.uniform4f(s.lightGridRgba, grid.rgba[0], grid.rgba[1], grid.rgba[2], grid.rgba[3]);
      gl.uniform1f(s.lightGridSpread, grid.spread);
      gl.uniform1f(s.lightModuleAmt, grid.moduleAmt);
      const mp = grid.mouse;
      // Mouse point is workspace screen px: to world with this frame's camera.
      if (mp) gl.uniform4f(s.lightMouse, cam.x + mp.x / cam.zoom, cam.y + mp.y / cam.zoom, grid.mouseRadius, grid.mouseAmount);
      else gl.uniform4f(s.lightMouse, 0, 0, 1, 0);
      gl.uniform1f(s.lightZoomPx, cam.zoom * scalePx);
      // Like module text: lit (and whitened) by the mouse lamp, anywhere; dimmed by a dark room away from it.
      const ambient = typeof global.nodeGraphRoomAmbientDark === "function"
        ? Math.max(0, Math.min(1, Number(global.nodeGraphRoomAmbientDark()) || 0)) : 0;
      const gridDark = Math.min(ambient, 0.75);
      const lamp = typeof global.nodeGraphRoomLightUniform === "function" ? global.nodeGraphRoomLightUniform() : null;
      if (s.lightGridReflect) gl.uniform1f(s.lightGridReflect, Math.max(0, Math.min(4, Number(grid.reflect) || 0)));
      if (s.lightGridLampMore) gl.uniform2f(s.lightGridLampMore, Math.max(0, Math.min(1, Number(grid.lampBright) || 0)), Math.max(1, (lo.gridMinX || 140) * (Number(grid.spread) || 1) * Math.max(0.25, Number(grid.lampReach) || 1) * scalePx));
      if (s.lightGridMouseA) gl.uniform1f(s.lightGridMouseA, Math.max(0, Math.min(1, Number.isFinite(Number(grid.mouseAlpha)) ? Number(grid.mouseAlpha) : Number(grid.rgba[3]))));
      if (s.lightGridDark) gl.uniform1f(s.lightGridDark, gridDark);
      if (s.lightGridLamp) gl.uniform4f(s.lightGridLamp, lamp ? lamp[0] : 0, lamp ? lamp[1] : 0, lamp ? lamp[2] : 1, lamp ? lamp[3] : 0);
    }
    if (s.lightPlate) gl.uniform4f(s.lightPlate, 0, 0, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.outBuf);
    gl.enableVertexAttribArray(s.lightPos);
    gl.enableVertexAttribArray(s.lightPx);
    gl.vertexAttribPointer(s.lightPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(s.lightPx, 2, gl.FLOAT, false, 16, 8);
    const scale = batch.scale > 0 ? batch.scale : 1;
    const x0 = cam.x;
    const y0 = cam.y;
    const x1 = cam.x + batch.w / scale / cam.zoom;
    const y1 = cam.y + batch.h / scale / cam.zoom;
    const c = [[x0, y0], [x1, y0], [x0, y1], [x1, y0], [x1, y1], [x0, y1]];
    const data = new Float32Array(24);
    for (let i = 0; i < 6; i += 1) {
      data[i * 4] = c[i][0];
      data[i * 4 + 1] = c[i][1];
      data[i * 4 + 2] = c[i][0];
      data[i * 4 + 3] = c[i][1];
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    // Premultiplied light over whatever is below (transparent canvas: the wires and background show).
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(s.lightPos);
    gl.disableVertexAttribArray(s.lightPx);
  }

  function nodeGraphGlLinesVeil(batch, x, y, w, h, period) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    // The stripe period in the batch's own units; drawVeils picks the final one from the screen zoom.
    if (period > 0) batch.veilPeriod = period * k;
    // The plate's edges on whole device pixels, so the pattern and its edge sit on the pixel grid.
    const x0 = Math.round(x * k);
    const y0 = Math.round(y * k);
    batch.veils.push({ x: x0, y: y0, w: Math.round((x + w) * k) - x0, h: Math.round((y + h) * k) - y0 });
  }

  function drawVeils(batch) {
    const { s, gl } = { s: batch.s, gl: batch.s.gl };
    if (!s.veilProgram) return;
    gl.useProgram(s.veilProgram);
    bindCam(gl, { pixel: s.veilCamPixel, cam: s.veilCamCam, vp: s.veilCamVp, device: s.veilCamDevice }, batch);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.buf);
    gl.enableVertexAttribArray(s.veilPos);
    gl.enableVertexAttribArray(s.veilPx);
    gl.vertexAttribPointer(s.veilPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(s.veilPx, 2, gl.FLOAT, false, 16, 8);
    // Blend over the plate already drawn in this buffer, so the stripe is a
    // see-through tint. With blending off the stripe replaced the plate's
    // pixels outright and read as a solid band. Alpha keeps the plate's own
    // coverage (ONE, ONE_MINUS_SRC_ALPHA) so the canvas stays opaque there.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Everything is decided in screen pixels. A camera batch holds world units, so one screen CSS px is 1 / zoom of them; a plain batch is
    // already in device pixels (scale per CSS px).
    const camZoom = batch.camera ? (batch.camera.zoom > 0 ? batch.camera.zoom : 1) : 1;
    const unitsPerCssPx = batch.camera ? 1 / camZoom : (batch.scale || 1);
    // Anti-aliasing: always 1 CSS px of Expo skirt, however far in or out (it never grows into a glow).
    if (s.veilFeather) gl.uniform1f(s.veilFeather, unitsPerCssPx);
    // The stripes belong to the module: the same spacing in world units (the design that reads well between zoom 0.5 and 0.3: a 90 px
    // period), measured from the plate's corner, so they scale and move with it and never shift against it. Nothing here compensates for
    // zoom; the plain-batch period (screen px) is the same world period times the zoom, unrounded.
    if (s.veilPeriod) gl.uniform1f(s.veilPeriod, batch.veilPeriod > 0 ? batch.veilPeriod : 67);
    // UI Dev "under construction alpha".
    if (s.veilAlpha) gl.uniform1f(s.veilAlpha, Math.max(0, Math.min(1, Number.isFinite(Number(global.nodeGraphUnderConstructionAlpha)) ? Number(global.nodeGraphUnderConstructionAlpha) : 0.4)));
    for (let n = 0; n < batch.veils.length; n += 1) {
      const shape = batch.veils[n];
      const x0 = shape.x;
      const y0 = shape.y;
      const x1 = shape.x + shape.w;
      const y1 = shape.y + shape.h;
      const pix = Boolean(batch.camera);
      const clip = pix
        ? (px, py) => [px, py]
        : (px, py) => [(px / batch.w) * 2 - 1, 1 - (py / batch.h) * 2];
      const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y0], [x1, y1], [x0, y1]];
      const data = new Float32Array(6 * 4);
      for (let i = 0; i < corners.length; i += 1) {
        const xy = clip(corners[i][0], corners[i][1]);
        data[i * 4] = xy[0];
        data[i * 4 + 1] = xy[1];
        data[i * 4 + 2] = corners[i][0];
        data[i * 4 + 3] = corners[i][1];
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.uniform4f(s.veilRect, shape.x, shape.y, shape.w, shape.h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(s.veilPos);
    gl.disableVertexAttribArray(s.veilPx);
  }

  function nodeGraphGlLinesModuleOutline(batch, x, y, w, h, stroke, rgba, jacks, fill, cuts, round, nodeId, selected, dimShape, glow, strip) {
    if (!batch || !(w > 0) || !(h > 0)) return;
    const k = batch.camera ? 1 : (batch.scale || 1);
    const sx = x * k;
    const sy = y * k;
    const sw = w * k;
    const sh = h * k;
    const ss = Math.max(0.5, stroke * k);
    const list = [];
    const src = Array.isArray(jacks) ? jacks : [];
    for (let i = 0; i < src.length && list.length < OUT_MAX; i += 1) {
      const jack = src[i];
      const r = Math.max(0, Number(jack.r) || 0) * k;
      if (!(r > 0)) continue;
      const jx = (Number(jack.x) || 0) * k;
      const jy = (Number(jack.y) || 0) * k;
      const color = jack.rgba || rgba;
      list.push({ x: jx, y: jy, r: jack.square ? -r : r, rgba: color, inlet: jack.inlet === true, backdrop: Array.isArray(jack.backdrop) ? jack.backdrop : null });
    }
    const backdropJack = list.find((j) => j.backdrop);
    batch.outlines.push({
      // [y0, y1, r, g, b, a]: a band of the plate in another fill (world y, scaled like the plate).
      strip: Array.isArray(strip) && strip.length >= 6 ? [strip[0] * k, strip[1] * k, strip[2], strip[3], strip[4], strip[5]] : null,
      jackBackdrop: backdropJack ? backdropJack.backdrop : null,
      nodeId, selected: selected === true, dimShape: dimShape === true ? 1 : ([2, 3, 4, 5].includes(Number(dimShape)) ? Number(dimShape) : 0), glow: Number(glow) > 0 ? Number(glow) : 0, x: sx, y: sy, w: sw, h: sh, stroke: ss, rgba,
      fill: fill || [0.09, 0.1, 0.12, 1],
      jacks: list,
      cuts: (Array.isArray(cuts) ? cuts : []).slice(0, CUT_MAX).map((c) => [c.y0 * k, c.y1 * k, c.side < 0 ? -1 : 1, 0]),
      // [top radius, top shape, bottom radius, bottom shape, stroke top radius]; radius in the same
      // units as x / y. No stroke top radius: the stroke follows the plate's top radius.
      round: Array.isArray(round) && round.length >= 4
        ? [Math.max(0, Number(round[0]) || 0) * k, Number(round[1]) || 0, Math.max(0, Number(round[2]) || 0) * k, Number(round[3]) || 0,
          (round.length > 4 && Number.isFinite(Number(round[4])) ? Math.max(0, Number(round[4])) : Math.max(0, Number(round[0]) || 0)) * k]
        : null,
    });
  }

  function drawOutlines(batch) {
    const s = batch.s;
    const gl = s.gl;
    if (!s.outProgram) return;
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(s.outProgram);
    bindCam(gl, { pixel: s.outCamPixel, cam: s.outCamCam, vp: s.outCamVp, device: s.outCamDevice }, batch);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.outBuf);
    gl.enableVertexAttribArray(s.outPos);
    gl.enableVertexAttribArray(s.outPx);
    gl.vertexAttribPointer(s.outPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(s.outPx, 2, gl.FLOAT, false, 16, 8);
    const jackData = new Float32Array(OUT_MAX * 4);
    const colorData = new Float32Array(OUT_MAX * 4);
    for (let n = 0; n < batch.outlines.length; n += 1) {
      const shape = batch.outlines[n];
      const pad = shape.dimShape === 4 ? shape.stroke * 3.6 + 6 : shape.stroke + 6;
      const x0 = shape.x - pad;
      const y0 = shape.y - pad;
      const x1 = shape.x + shape.w + pad;
      const y1 = shape.y + shape.h + pad;
      const pix = Boolean(batch.camera);
      const clip = pix
        ? (px, py) => [px, py]
        : (px, py) => [(px / batch.w) * 2 - 1, 1 - (py / batch.h) * 2];
      const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y0], [x1, y1], [x0, y1]];
      const data = new Float32Array(6 * 4);
      for (let i = 0; i < corners.length; i += 1) {
        const xy = clip(corners[i][0], corners[i][1]);
        data[i * 4] = xy[0];
        data[i * 4 + 1] = xy[1];
        data[i * 4 + 2] = corners[i][0];
        data[i * 4 + 3] = corners[i][1];
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.uniform4f(s.outPlate, shape.x, shape.y, shape.w, shape.h);
      const col = shape.rgba || [1, 1, 1, 1];
      // Stroke animation (UI Dev "animate stroke"): the stroke moves with the module's output
      // level toward the amber-pink "loud" colour and toward full alpha. A selected module animates
      // the same way from its brighter selected stroke, so it always reads as selected.
      const baseA = col.length > 3 ? col[3] : 1;
      let pc = [col[0], col[1], col[2], baseA];
      if (!shape.erase && !shape.dimShape && typeof globalThis.nodeGraphModuleStrokeFollowLevel === "function") {
        const k = globalThis.nodeGraphModuleStrokeFollowLevel(shape.nodeId);
        if (k > 0) {
          const loud = (typeof globalThis.nodeGraphStrokeLoudColor === "function" && globalThis.nodeGraphStrokeLoudColor(shape.nodeId)) || [1, 1, 1, 1];
          const loudA = loud.length > 3 ? loud[3] : 1;
          // A selected module keeps its selected colour while it animates: only the brightness (alpha) follows the loudness, so
          // the stroke still reads as selected.
          const to = shape.selected ? col : loud;
          pc = [col[0] + (to[0] - col[0]) * k, col[1] + (to[1] - col[1]) * k, col[2] + (to[2] - col[2]) * k, baseA + (loudA - baseA) * k];
        }
      }
      // Stroke glow rim: the stroke colour moving toward the loud colour with the module level, at a
      // strength that is quiet at rest and a little stronger when active and in a dark room.
      if (shape.glow > 0) {
        const k = typeof globalThis.nodeGraphModuleStrokeFollowLevel === "function" ? globalThis.nodeGraphModuleStrokeFollowLevel(shape.nodeId) : 0;
        const dark = typeof globalThis.nodeGraphRoomAmbientDark === "function" ? globalThis.nodeGraphRoomAmbientDark() : 0;
        const loud = k > 0 && typeof globalThis.nodeGraphStrokeLoudColor === "function" ? globalThis.nodeGraphStrokeLoudColor(shape.nodeId) : null;
        const gr = loud ? col[0] + (loud[0] - col[0]) * k : col[0];
        const gg = loud ? col[1] + (loud[1] - col[1]) * k : col[1];
        const gb = loud ? col[2] + (loud[2] - col[2]) * k : col[2];
        pc = [gr, gg, gb, shape.glow * (0.35 + 0.65 * k) * (0.3 + 0.7 * dark) * 1.0];
      }
      // Output module: glows red while the ear protector is engaged.
      let strokeW = shape.stroke;
      if (!shape.erase && !(shape.glow > 0) && typeof globalThis.nodeGraphOutputOverLevel === "function" && globalThis.nodeGraphIsOutputModule?.(shape.nodeId)) {
        const over = globalThis.nodeGraphOutputOverLevel();
        if (over > 0) {
          const hot = (typeof globalThis.nodeGraphOutputOverheatColor === "function" && globalThis.nodeGraphOutputOverheatColor()) || [1, 0.1, 0.1, 1];
          pc = [pc[0] + (hot[0] - pc[0]) * over, pc[1] + (hot[1] - pc[1]) * over, pc[2] + (hot[2] - pc[2]) * over, pc[3] + ((hot.length > 3 ? hot[3] : 1) - pc[3]) * over];
        }
      }
      gl.uniform4f(s.outPlateColor, pc[0], pc[1], pc[2], pc[3]);
      const fill = shape.fill || [0, 0, 0, 0];
      if (s.outFill) gl.uniform4f(s.outFill, fill[0], fill[1], fill[2], fill.length > 3 ? fill[3] : 1);
      const strip = shape.strip;
      if (s.outStripY) gl.uniform2f(s.outStripY, strip ? strip[0] : 0, strip ? strip[1] : 0);
      if (s.outStripColor) gl.uniform4f(s.outStripColor, strip ? strip[2] : 0, strip ? strip[3] : 0, strip ? strip[4] : 0, strip ? strip[5] : 0);
      gl.uniform1f(s.outStroke, strokeW);
      if (s.outDimShape) {
        gl.uniform1f(s.outDimShape, shape.dimShape || 0);
        // The mouse lamp brightens module TEXT only (see the glyph shader); the body is not lit by it.
        const lamp = null;
        if (s.outLight) gl.uniform4f(s.outLight, lamp ? lamp[0] : 0, lamp ? lamp[1] : 0, lamp ? lamp[2] : 1, lamp ? lamp[3] : 0);
      }
      if (s.outRound) {
        const rd = shape.round || [0, 0, 0, 0];
        gl.uniform4f(s.outRound, rd[0], rd[1], rd[2], rd[3]);
        if (s.outStrokeTop) gl.uniform1f(s.outStrokeTop, rd.length > 4 ? rd[4] : rd[0]);
      }
      jackData.fill(0);
      colorData.fill(0);
      const count = Math.min(OUT_MAX, shape.jacks.length);
      for (let i = 0; i < count; i += 1) {
        const jack = shape.jacks[i];
        jackData[i * 4] = jack.x;
        jackData[i * 4 + 1] = jack.y;
        jackData[i * 4 + 2] = jack.r;
        // w: 1 = inlet, +2 = fill the hole it cuts with uJackBackdrop.
        jackData[i * 4 + 3] = (jack.inlet ? 1 : 0) + (jack.backdrop && shape.jackBackdrop ? 2 : 0);
        const jc = jack.rgba || col;
        colorData[i * 4] = jc[0];
        colorData[i * 4 + 1] = jc[1];
        colorData[i * 4 + 2] = jc[2];
        colorData[i * 4 + 3] = jc.length > 3 ? jc[3] : 1;
      }
      gl.uniform1i(s.outCount, count);
      const cuts = shape.cuts || [];
      if (s.outCutCount) gl.uniform1i(s.outCutCount, cuts.length);
      if (cuts.length && s.outCut) {
        const cutData = new Float32Array(CUT_MAX * 4);
        cuts.forEach((c, i) => cutData.set(c, i * 4));
        gl.uniform4fv(s.outCut, cutData);
      }
      if (s.outJackBackdrop) {
        const jb = shape.jackBackdrop || [0, 0, 0];
        gl.uniform4f(s.outJackBackdrop, jb[0], jb[1], jb[2], 1);
      }
      if (s.outJack) gl.uniform4fv(s.outJack, jackData);
      if (s.outJackColor) gl.uniform4fv(s.outJackColor, colorData);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disableVertexAttribArray(s.outPos);
    gl.disableVertexAttribArray(s.outPx);
  }

  function nodeGraphGlLinesSetGlyphBakePx(px) {
    const next = Math.max(16, Math.min(384, Math.round(Number(px) || TEXT_BAKE_PX)));
    if (next === glyphBakePx) return false;
    glyphBakePx = next;
    const s = ensure();
    if (s?.atlases) {
      if (!s.deadTextures) s.deadTextures = [];
      // Camera atlases are per size and per zoom: the sweep retires them.
      let retired = 0;
      for (const [key, atlas] of [...s.atlases]) {
        if (atlas?.cam || atlas?.face) continue;
        if (atlas?.texture) s.deadTextures.push(atlas.texture);
        s.atlases.delete(key);
        retired += 1;
      }
      if (retired) textAtlasGen += 1;
    }
    return true;
  }

  /** Generation of the glyph atlases; changes when any atlas texture is retired. */
  function nodeGraphGlLinesTextAtlasGen(kind = "") {
    return kind === "cam" ? textAtlasCamGen : textAtlasGen;
  }

  // User fragment quad (emo script display {}). One program per source, an 8-frame
  // ring for delayFrame(ago), and prev = the newest stored frame. Pictures are
  // premultiplied RGBA, same as the 📺 wire.
  const USER_SHADER_DELAY = 8;
  const USER_SHADER_MAX = 512;
  const userShaderReserved = new Set([
    "uv", "time", "resolution", "prev", "rgbaIn", "rgbaLive", "out_color", "delayFrame", "delayFrameAt", "emoDelaySample", "vUv", "gl_FragColor",
  ]);
  for (let i = 0; i < USER_SHADER_DELAY; i += 1) userShaderReserved.add(`delay${i}`);
  const userShaderNodes = new Map();
  let userShaderCompiles = 0;
  /** Smokes: user shader compiles so far (a failed source must not recompile per frame). */
  function nodeGraphGlLinesUserShaderStats() {
    return { compiles: userShaderCompiles, nodes: userShaderNodes.size };
  }
  let userShaderBlack = null;
  let userShaderQuad = null;

  function userShaderSurface(gl, w, h) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const internal = gl.RGBA8 !== undefined ? gl.RGBA8 : gl.RGBA;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!ok) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return null;
    }
    return { texture, framebuffer, width: w, height: h };
  }

  function userShaderDropSurface(gl, surface) {
    if (!surface) return;
    gl.deleteFramebuffer(surface.framebuffer);
    gl.deleteTexture(surface.texture);
  }

  function userShaderBlackTex(gl) {
    if (userShaderBlack) return userShaderBlack;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    userShaderBlack = texture;
    return texture;
  }

  function userShaderSource(userBody, floatNames) {
    const names = [];
    const seen = new Set();
    for (const raw of floatNames || []) {
      const name = String(raw || "");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || userShaderReserved.has(name) || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    const header = [
      "#version 300 es",
      "precision highp float;",
      "in vec2 vUv;",
      "uniform vec2 resolution;",
      "uniform float time;",
      "uniform sampler2D prev;",
      "uniform sampler2D rgbaIn;",
      "uniform float rgbaLive;",
    ];
    for (let i = 0; i < USER_SHADER_DELAY; i += 1) header.push(`uniform sampler2D delay${i};`);
    for (const name of names) header.push(`uniform float ${name};`);
    header.push(
      "out vec4 out_color;",
      "vec4 emoDelaySample(int i, vec2 p) {",
      "  if (i <= 0) return texture(delay0, p);",
      "  if (i == 1) return texture(delay1, p);",
      "  if (i == 2) return texture(delay2, p);",
      "  if (i == 3) return texture(delay3, p);",
      "  if (i == 4) return texture(delay4, p);",
      "  if (i == 5) return texture(delay5, p);",
      "  if (i == 6) return texture(delay6, p);",
      "  return texture(delay7, p);",
      "}",
      "vec4 delayFrameAt(float ago, vec2 p) {",
      "  float x = clamp(ago, 0.0, 7.0);",
      "  int i = int(floor(x));",
      "  vec4 a = emoDelaySample(i, p);",
      "  vec4 b = emoDelaySample(min(i + 1, 7), p);",
      "  return mix(a, b, fract(x));",
      "}",
      "vec4 delayFrame(float ago) {",
      "  return delayFrameAt(ago, vUv);",
      "}",
      "void main() {",
      "  vec2 uv = vUv;",
      "  out_color = vec4(0.0, 0.0, 0.0, 1.0);",
    );
    const body = String(userBody || "");
    const source = `${header.join("\n")}\n${body}\n}\n`;
    return { source, names, headerLines: header.length };
  }

  function userShaderShiftLog(log, headerLines) {
    return String(log || "").replace(/:(\d+):/g, (all, num) => {
      const line = Number(num) - headerLines;
      return line > 0 ? `:${line}:` : all;
    });
  }

  /**
   * Draw one user fragment into the face and the 📺 picture.
   * userBody is the inside of main(): uv, time, resolution, prev, rgbaIn,
   * rgbaLive, delayFrame(ago), and one float uniform per name in floatNames.
   * advance stores this frame in the 8-frame ring (ago 0 = prev).
   * @returns {{ok:boolean, error:string}}
   */
  function nodeGraphGlLinesUserShader(spec) {
    const canvas = spec?.canvas;
    const key = String(spec?.key || "");
    const dev = typeof global.nodeGraphPictureDevice === "function" ? global.nodeGraphPictureDevice() : null;
    const gl = dev?.gl;
    if (!canvas || !gl || gl.isContextLost()) {
      if (canvas && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
      return { ok: false, error: "WebGL2 picture device missing" };
    }
    const w = Math.max(1, Math.min(USER_SHADER_MAX, canvas.width | 0));
    const h = Math.max(1, Math.min(USER_SHADER_MAX, canvas.height | 0));
    let node = userShaderNodes.get(key);
    if (!node || node.w !== w || node.h !== h || node.gl !== gl) {
      if (node) {
        for (const surface of node.ring) userShaderDropSurface(gl, surface);
        userShaderDropSurface(gl, node.scratch);
        if (node.program) gl.deleteProgram(node.program);
      }
      const ring = [];
      for (let i = 0; i < USER_SHADER_DELAY; i += 1) {
        const surface = userShaderSurface(gl, w, h);
        if (!surface) {
          if (typeof global.nodeGraphDisplayGlFailed === "function") {
            global.nodeGraphDisplayGlFailed(canvas, "emo shader surface");
          }
          return { ok: false, error: "shader surface failed" };
        }
        ring.push(surface);
      }
      const scratch = userShaderSurface(gl, w, h);
      if (!scratch) return { ok: false, error: "shader surface failed" };
      node = { gl, w, h, ring, scratch, head: -1, program: null, source: "", locs: null, names: [], failedSource: "", failedError: "", failedSize: "" };
      userShaderNodes.set(key, node);
    }
    const built = userShaderSource(spec.userBody, spec.floatNames);
    // A source that failed to compile stays failed until it changes: no
    // per-frame recompile, no repeated log, the face stays the black plate.
    // The error text is returned every frame for the Code page.
    if (node.failedSource && node.failedSource === built.source) {
      const size = `${canvas.width | 0}x${canvas.height | 0}`;
      const cached = node.failedSize === size;
      if (!cached) {
        // The canvas was resized (cleared): black plate again, once.
        node.failedSize = size;
        nodeGraphGlLinesFillBlack(canvas);
      }
      return { ok: false, error: node.failedError || "shader failed", cached: true };
    }
    if (node.source !== built.source) {
      userShaderCompiles += 1;
      let program = null;
      let error = "";
      try {
        const vs = compile(gl, gl.VERTEX_SHADER, `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`);
        const fs = compile(gl, gl.FRAGMENT_SHADER, built.source);
        program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
          error = userShaderShiftLog(gl.getProgramInfoLog(program) || "link failed", built.headerLines);
          gl.deleteProgram(program);
          program = null;
        }
      } catch (err) {
        error = userShaderShiftLog(err?.message || String(err), built.headerLines);
      }
      if (!program) {
        node.failedSource = built.source;
        node.failedError = error || "shader failed";
        node.failedSize = `${canvas.width | 0}x${canvas.height | 0}`;
        if (typeof global.nodeGraphDisplayGlFailed === "function") {
          global.nodeGraphDisplayGlFailed(canvas, "emo shader", new Error(node.failedError));
        } else {
          nodeGraphGlLinesFillBlack(canvas);
        }
        return { ok: false, error: node.failedError, cached: true };
      }
      node.failedSource = "";
      node.failedError = "";
      if (node.program) gl.deleteProgram(node.program);
      const locs = {
        aPos: gl.getAttribLocation(program, "aPos"),
        resolution: gl.getUniformLocation(program, "resolution"),
        time: gl.getUniformLocation(program, "time"),
        rgbaLive: gl.getUniformLocation(program, "rgbaLive"),
        prev: gl.getUniformLocation(program, "prev"),
        rgbaIn: gl.getUniformLocation(program, "rgbaIn"),
        delay: [],
        floats: {},
      };
      for (let i = 0; i < USER_SHADER_DELAY; i += 1) locs.delay.push(gl.getUniformLocation(program, `delay${i}`));
      for (const name of built.names) locs.floats[name] = gl.getUniformLocation(program, name);
      node.program = program;
      node.locs = locs;
      node.names = built.names;
      node.source = built.source;
    }
    if (!userShaderQuad) {
      userShaderQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, userShaderQuad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    const black = userShaderBlackTex(gl);
    const head = node.head;
    const prevTex = head < 0 ? black : node.ring[head].texture;
    const picture = spec.picture?.texture || black;
    gl.bindFramebuffer(gl.FRAMEBUFFER, node.scratch.framebuffer);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(node.program);
    gl.uniform2f(node.locs.resolution, w, h);
    gl.uniform1f(node.locs.time, Number(spec.time) || 0);
    gl.uniform1f(node.locs.rgbaLive, spec.picture?.texture ? 1 : 0);
    const floats = spec.floats || {};
    for (const name of node.names) {
      const value = Number(floats[name]);
      gl.uniform1f(node.locs.floats[name], Number.isFinite(value) ? value : 0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.uniform1i(node.locs.prev, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, picture);
    gl.uniform1i(node.locs.rgbaIn, 1);
    for (let i = 0; i < USER_SHADER_DELAY; i += 1) {
      const slot = head < 0 ? black : node.ring[(head - i + USER_SHADER_DELAY) % USER_SHADER_DELAY].texture;
      gl.activeTexture(gl.TEXTURE2 + i);
      gl.bindTexture(gl.TEXTURE_2D, slot);
      gl.uniform1i(node.locs.delay[i], 2 + i);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, userShaderQuad);
    gl.enableVertexAttribArray(node.locs.aPos);
    gl.vertexAttribPointer(node.locs.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(node.locs.aPos);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (spec.advance !== false) {
      const next = (head + 1 + USER_SHADER_DELAY) % USER_SHADER_DELAY;
      const stored = node.ring[next];
      node.ring[next] = node.scratch;
      node.scratch = stored;
      node.head = next;
    }
    const shown = node.head < 0 ? node.scratch.texture : node.ring[node.head].texture;
    if (spec.publishNodeId && typeof global.nodeGraphPicturePublish === "function") {
      global.nodeGraphPicturePublish(spec.publishNodeId, shown, w, h);
    }
    if (typeof global.nodeGraphPicturePresent === "function") {
      global.nodeGraphPicturePresent(shown, w, h, canvas, canvas.width, canvas.height);
    }
    return { ok: true, error: "" };
  }

  const api = {
    nodeGraphSpectralWireDefaults: SPECTRAL_WIRE_DEFAULTS,
    nodeGraphGlLinesFillBlack,
    nodeGraphGlLinesExpoSkirt,
    nodeGraphGlLinesBegin,
    nodeGraphGlLinesLayer,
    nodeGraphGlLinesRect,
    nodeGraphGlLinesFadeRect,
    nodeGraphGlLinesModuleOutline,
    nodeGraphGlLinesLights,
    nodeGraphGlLinesVeil,
    nodeGraphGlLinesTriangle,
    nodeGraphGlLinesFillUnder,
    nodeGraphGlLinesSegment,
    nodeGraphGlLinesDot,
    nodeGraphGlLinesPulseTrain,
    nodeGraphGlLinesRoundRect,
    nodeGraphGlLinesRing,
    nodeGraphGlLinesPolyline,
    nodeGraphGlLinesRibbon,
    nodeGraphGlLinesStroke,
    nodeGraphGlLinesAdaptPoints,
    nodeGraphGlLinesCaptureBuilderSize,
    nodeGraphGlLinesInkScale,
    nodeGraphGlLinesPresentFrame,
    nodeGraphGlLinesDash,
    nodeGraphGlLinesPhosphor,
    nodeGraphGlLinesImage,
    nodeGraphGlLinesSnapshot,
    nodeGraphGlLinesReleaseSnapshot,
    nodeGraphGlLinesText,
    nodeGraphGlLinesSetGlyphBakePx,
    nodeGraphGlLinesMeasureText,
    nodeGraphGlLinesMeasureInk,
    nodeGraphGlLinesTextAtlas,
    nodeGraphGlLinesTextAtlasGen,
    nodeGraphGlLinesTextAtlasEpoch,
    nodeGraphGlLinesTextAtlasSweep,
    nodeGraphGlLinesTextAtlasInfo,
    nodeGraphGlLinesTextAtlasStats,
    nodeGraphGlLinesTextAtlasPending,
    nodeGraphGlLinesTextAtlasBakeNext,
    nodeGraphGlLinesTextAtlasSweepUnreferenced,
    nodeGraphGlLinesTextSegments,
    nodeGraphGlLinesEmojiStats,
    nodeGraphGlLinesTextAspectStats,
    nodeGraphGlLinesFaceTextStats,
    nodeGraphGlLinesCss,
    nodeGraphGlLinesHsl,
    nodeGraphGlLinesEnd,
    nodeGraphGlLinesDrawInto,
    nodeGraphGlLinesUserShader,
    nodeGraphGlLinesUserShaderStats,
  };
  Object.assign(global, api);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
