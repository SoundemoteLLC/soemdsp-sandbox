// Spectrogram GPU path (docs/WEBGL_DISPLAY_PLAN.md).
//
// The per-pixel work moves into one fragment shader:
//   • Ring history: one texture row per face column holds that column's RAW
//     spectrum bins (4 bins per RGBA float texel). Each emitted pixel column
//     writes one row; uHead says which row is the oldest, so nothing scrolls.
//   • Per-column settings ("permanent ink"): a small meta texture keeps the
//     floorDb, ceilingDb, freq scale, band, Nyquist, bin count and colour
//     row that were live when the column was painted. Changing a knob only
//     affects new columns.
//   • Colour: 256-wide LUT rows (one per gradient that still has ink on face).
//   • Circular Spectrogram reuses the ring, meta and LUT with a second
//     fragment shader (FS_POLAR): angle → column age, radius → frequency.
//   • Shader per pixel: ring lookup → Linear / Mel / Bark row→Hz → bilinear
//     bin lerp → undo log10(1+mag·100) → dBFS → soft floor/ceiling → interpolated LUT.
//   • Moving-head circular ink has a clean current revolution and a separate
//     older-sweep layer whose afterglow lifetime is measured in turns.
//
// Device: the shared picture device (public/lib/visual/picture-device.js).
// Its hidden canvas never resizes; we draw into a bottom-left scissor rect and
// copy that rect into the face texture. No WebGL context per face.
//
// The CPU copy of the ring is kept so a new / restored context re-uploads the
// history.

(function initSpectrogramGl(global) {
  const LUT_ROWS = 16;
  const META_FLOATS = 8; // 2 RGBA texels per column

  const VS = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

  const FS_HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uRing;   // RGBA float, 4 raw bins per texel, one row per column
uniform sampler2D uMeta;   // RGBA float, 2 texels per column
uniform sampler2D uLut;    // RGBA8, 256 x uLutRows
uniform vec2 uSize;        // buffer W (= ring rows), H
uniform float uHead;       // ring row of the oldest (leftmost) column
uniform float uSub;        // leftover hop-time in buffer pixels [0,1)
uniform vec3 uPlate;       // darkest LUT color (right sliver while uSub > 0)
uniform float uRingTexW;   // texels per ring row
uniform float uLutRows;
uniform float uFullMag;    // windowSum/2: 1.0 in dBFS is a full-scale sine

const float LN10 = 2.302585092994046;

float binAt(float rowV, float b) {
  float texel = floor(b / 4.0);
  float lane = b - texel * 4.0;
  vec4 v = texture2D(uRing, vec2((texel + 0.5) / uRingTexW, rowV));
  vec4 pick = step(abs(vec4(lane) - vec4(0.0, 1.0, 2.0, 3.0)), vec4(0.5));
  return dot(v, pick);
}

float hzToMel(float hz) { return 2595.0 * (log(1.0 + max(0.0, hz) / 700.0) / LN10); }
float melToHz(float mel) { return 700.0 * (exp((mel / 2595.0) * LN10) - 1.0); }
float hzToBark(float hz) {
  float x = max(0.0, hz) / 600.0;
  return 6.0 * log(x + sqrt(x * x + 1.0));
}
float barkToHz(float bark) {
  float x = bark / 6.0;
  return 600.0 * 0.5 * (exp(x) - exp(-x));
}

float powPos(float x, float e) { return x <= 0.0 ? 0.0 : pow(x, e); }

// Worklet stores c = log10(1 + ema·100). Recover linear mag, then dBFS.
// Soft knees occupy the outer 20% of the range; the middle stays linear.
float spectrogramSoftLevel(float v) {
  v = clamp(v, 0.0, 1.0);
  const float knee = 0.2;
  float edge = min(v, 1.0 - v);
  if (edge >= knee) return v;
  float t = edge / knee;
  float shaped = knee * t * t * (2.0 - t);
  return v < 0.5 ? shaped : 1.0 - shaped;
}

// Map the explicit dBFS floor/ceiling range into the gradient, without gain or gamma.
vec3 spectrogramGradient(float level, float row) {
  float index = clamp(level, 0.0, 1.0) * 255.0;
  float lo = floor(index);
  float hi = min(lo + 1.0, 255.0);
  float y = (row + 0.5) / uLutRows;
  vec3 a = texture2D(uLut, vec2((lo + 0.5) / 256.0, y)).rgb;
  vec3 b = texture2D(uLut, vec2((hi + 0.5) / 256.0, y)).rgb;
  return mix(a, b, index - lo);
}

float hzForU(float u, float scale, float lo, float hi) {
  if (scale >= 3.5) {
    float l = max(lo, 1e-3);
    float linearHz = mix(lo, hi, u);
    float logHz = l * exp(u * log(max(hi, l * 1.000001) / l));
    return mix(linearHz, logHz, clamp(scale - 4.0, 0.0, 1.0));
  }
  if (scale > 2.5) {
    float l = max(lo, 1e-3);
    return l * exp(u * log(max(hi, l * 1.000001) / l));
  }
  if (scale > 0.5 && scale < 1.5) {
    float a = hzToMel(lo);
    float b = hzToMel(hi);
    return melToHz(a + u * (b - a));
  }
  if (scale >= 1.5) {
    float a = hzToBark(lo);
    float b = hzToBark(hi);
    return barkToHz(a + u * (b - a));
  }
  return lo + u * (hi - lo);
}

float grade01(float x, float floorDb, float ceilingDb) {
  float ema = max(0.0, (powPos(10.0, x) - 1.0) / 100.0);
  float amp = ema / max(uFullMag, 1e-9);
  float db = 20.0 * log(max(amp, 1e-12)) / LN10;
  return spectrogramSoftLevel((db - floorDb) / max(ceilingDb - floorDb, 0.01));
}
`;

  const FS = FS_HEAD + `
void main() {
  // Same leftover-time scroll as Instant Waterfall uSub: hop duration stays
  // in seconds; the remainder of one buffer pixel slides the plate left.
  float x = gl_FragCoord.x + uSub;
  if (x >= uSize.x) {
    gl_FragColor = vec4(uPlate, 1.0);
    return;
  }
  float px = floor(x);
  // GL rows count up from the bottom; face row 0 is the top.
  float yTop = uSize.y - 1.0 - floor(gl_FragCoord.y);
  float row = mod(px + uHead, uSize.x);
  float rowV = (row + 0.5) / uSize.x;
  vec4 m0 = texture2D(uMeta, vec2(0.25, rowV));
  vec4 m1 = texture2D(uMeta, vec2(0.75, rowV));
  float floorDb = m0.x;
  float ceilingDb = m0.y;
  float scale = m0.z;
  float bins = m0.w;
  float lo = m1.x;
  float hi = m1.y;
  float nyq = m1.z;
  float lutRow = m1.w;

  float mag = 0.0;
  if (bins >= 1.0) {
    // spectrogramRowTToHz: t=0 top → Max freq.
    float t = yTop / max(1.0, uSize.y - 1.0);
    float u = clamp(1.0 - t, 0.0, 1.0);
    float hz = hzForU(u, scale, lo, hi);
    // spectrogramHzToLinearBin + bilinear bin blend.
    float lb = max(1.0, bins);
    float binF = clamp(max(0.0, hz) / max(1e-9, nyq) * (lb - 1.0), 0.0, lb - 1.0);
    float b0 = clamp(floor(binF), 0.0, lb - 1.0);
    float b1 = min(lb - 1.0, b0 + 1.0);
    float bf = binF - b0;
    mag = binAt(rowV, b0) * (1.0 - bf) + binAt(rowV, b1) * bf;
  }
  float v = grade01(mag, floorDb, ceilingDb);
  // Interpolate within the selected LUT row without blending neighboring histories' palettes.
  vec3 rgb = spectrogramGradient(v, lutRow);
  gl_FragColor = vec4(rgb, 1.0);
}
`;

  // Circular Spectrogram. uSize is the face raster; the ring has uCols columns
  // (uHead = oldest). uPolar: x mirror, y up, z rotate (rad), w inner radius.
  // Head (newest) at 12 o'clock for Down, 6 o'clock for Up, turned by z.
  // Mirror: age = |angle from head| / pi on both halves. Else one sweep:
  // clockwise from the head for Down, anticlockwise for Up. Radius → Hz with
  // bass at the inner radius; meta scale 3 is log Hz.
  const POLAR_AGE_GLSL = `
float polarAge(vec2 xy) {
  vec2 p = xy - 0.5 * uSize;
  float ang = atan(p.x, p.y);
  float head = uPolar.z + (uPolar.y > 0.5 ? 3.141592653589793 : 0.0);
  float d = mod(ang - head + 3.141592653589793, 6.283185307179586) - 3.141592653589793;
  if (uPolar.x > 0.5) return abs(d) / 3.141592653589793;
  return mod(uPolar.y > 0.5 ? -d : d, 6.283185307179586) / 6.283185307179586;
}
`;

  const FS_POLAR = FS_HEAD + `
uniform float uCols;
uniform vec4 uPolar;
uniform float uReverseFrequency;
uniform vec2 uHeadMode;
uniform float uEnergy; // retained current sweep rather than opaque presentation
${POLAR_AGE_GLSL}



void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * uSize;
  float outerPx = max(1.0, 0.5 * min(uSize.x, uSize.y));
  float rPx = length(p);
  float r = rPx / outerPx;
  float inner = clamp(uPolar.w, 0.0, 0.95);
  // 1 px soft rim on both edges so the circle is not stair-stepped.
  float edge = clamp(outerPx - rPx, 0.0, 1.0) * clamp(rPx - inner * outerPx + 1.0, 0.0, 1.0);
  if (edge <= 0.0) {
    if (uEnergy > 0.5) discard;
    gl_FragColor = vec4(uPlate, 1.0);
    return;
  }
  float age = polarAge(gl_FragCoord.xy);
  if (uHeadMode.x > 0.5) age = fract(uHeadMode.y - age);
  float cols = max(1.0, uCols);
  // Same leftover-time slide as the waterfall: the head gets a plate sliver.
  float x = (1.0 - age) * cols + uSub;
  if (x >= cols) {
    if (uEnergy > 0.5) discard;
    gl_FragColor = vec4(uPlate, 1.0);
    return;
  }
  float px = clamp(floor(x), 0.0, cols - 1.0);
  float row = mod(px + uHead, cols);
  float rowV = (row + 0.5) / cols;
  vec4 m0 = texture2D(uMeta, vec2(0.25, rowV));
  vec4 m1 = texture2D(uMeta, vec2(0.75, rowV));
  float bins = m0.w;
  float nyq = m1.z;
  float mag = 0.0;
  if (bins >= 1.0) {
    float u = clamp((r - inner) / max(1e-6, 1.0 - inner), 0.0, 1.0);
    if (uReverseFrequency > 0.5) u = 1.0 - u;
    float hz = hzForU(u, m0.z, m1.x, m1.y);
    float lb = max(1.0, bins);
    float binF = clamp(max(0.0, hz) / max(1e-9, nyq) * (lb - 1.0), 0.0, lb - 1.0);
    float b0 = clamp(floor(binF), 0.0, lb - 1.0);
    float b1 = min(lb - 1.0, b0 + 1.0);
    float bf = binF - b0;
    mag = binAt(rowV, b0) * (1.0 - bf) + binAt(rowV, b1) * bf;
  }
  float v = grade01(mag, m0.x, m0.y);
  vec3 rgb = spectrogramGradient(v, m1.w);
  if (uEnergy > 0.5) {
    vec3 energy = max(rgb - uPlate, vec3(0.0)) * edge;
    gl_FragColor = vec4(energy, clamp(max(energy.r, max(energy.g, energy.b)), 0.0, 1.0));
    return;
  }
  gl_FragColor = vec4(mix(uPlate, rgb, edge), 1.0);
}
`;

  /** @type {WeakMap<WebGLRenderingContext, object>} */
  const programs = new WeakMap();
  const polarPrograms = new WeakMap();
  const watchedCanvases = new WeakSet();

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      if (!gl.isContextLost()) {
        console.error("[spectrogram-gl] shader compile failed", gl.getShaderInfoLog(shader));
      }
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function buildProgram(dev, cache, fsSource, extraUniforms) {
    const gl = dev?.gl;
    if (!gl || gl.isContextLost()) return null;
    let entry = cache.get(gl);
    if (entry) return entry.ok ? entry : null;
    entry = { ok: false };
    cache.set(gl, entry);
    if (dev.canvas && !watchedCanvases.has(dev.canvas)) {
      watchedCanvases.add(dev.canvas);
      // Restored context: every texture/program is gone. Drop the cache so
      // rings rebuild from their CPU copy.
      dev.canvas.addEventListener("webglcontextrestored", () => {
        programs.delete(gl);
        polarPrograms.delete(gl);
      }, false);
    }
    // WebGL2 (the shared device) has float textures in core and does not
    // expose OES_texture_float; WebGL1 needs the extension.
    const isGl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    const floatExt = isGl2 || gl.getExtension("OES_texture_float");
    const hp = gl.getShaderPrecisionFormat
      ? gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
      : null;
    if (!floatExt || !hp || !(hp.precision >= 16)) {
      return null;
    }
    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) {
        console.error("[spectrogram-gl] program link failed", gl.getProgramInfoLog(program));
      }
      gl.deleteProgram(program);
      return null;
    }
    entry.ok = true;
    entry.program = program;
    // WebGL2 needs a sized float internal format (RGBA + FLOAT is WebGL1-only).
    entry.floatInternal = isGl2 ? gl.RGBA32F : gl.RGBA;
    entry.aPos = gl.getAttribLocation(program, "aPos");
    entry.maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048;
    entry.u = {
      uRing: gl.getUniformLocation(program, "uRing"),
      uMeta: gl.getUniformLocation(program, "uMeta"),
      uLut: gl.getUniformLocation(program, "uLut"),
      uSize: gl.getUniformLocation(program, "uSize"),
      uHead: gl.getUniformLocation(program, "uHead"),
      uSub: gl.getUniformLocation(program, "uSub"),
      uPlate: gl.getUniformLocation(program, "uPlate"),
      uRingTexW: gl.getUniformLocation(program, "uRingTexW"),
      uLutRows: gl.getUniformLocation(program, "uLutRows"),
      uFullMag: gl.getUniformLocation(program, "uFullMag"),
    };
    for (const name of extraUniforms || []) {
      entry.u[name] = gl.getUniformLocation(program, name);
    }
    return entry;
  }

  function programFor(dev) {
    return buildProgram(dev, programs, FS, null);
  }

  function polarProgramFor(dev) {
    return buildProgram(dev, polarPrograms, FS_POLAR, ["uCols", "uPolar", "uReverseFrequency", "uHeadMode", "uEnergy"]);
  }

  function pictureDevice() {
    return typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
  }

  // ---------------------------------------------------------------- ring (CPU)

  function writeLutRow(ring, row, lutRgb) {
    const o = row * 256 * 4;
    for (let i = 0; i < 256; i += 1) {
      const s = i * 3;
      const d = o + i * 4;
      ring.lut[d] = lutRgb && lutRgb.length > s ? lutRgb[s] : 0;
      ring.lut[d + 1] = lutRgb && lutRgb.length > s + 1 ? lutRgb[s + 1] : 0;
      ring.lut[d + 2] = lutRgb && lutRgb.length > s + 2 ? lutRgb[s + 2] : 0;
      ring.lut[d + 3] = 255;
    }
    ring.lutSrc[row] = lutRgb || null;
    ring.lutDirty = true;
  }

  function lutRowMatches(ring, row, lutRgb) {
    if (ring.lutSrc[row] && ring.lutSrc[row] === lutRgb) return true;
    if (!lutRgb || lutRgb.length < 768) return false;
    const o = row * 256 * 4;
    for (let i = 0; i < 256; i += 1) {
      const s = i * 3;
      const d = o + i * 4;
      if (ring.lut[d] !== lutRgb[s] || ring.lut[d + 1] !== lutRgb[s + 1] || ring.lut[d + 2] !== lutRgb[s + 2]) {
        return false;
      }
    }
    ring.lutSrc[row] = lutRgb;
    return true;
  }

  /** Empty ring: every column uses the darkest color on LUT row 0. */
  function spectrogramGlRingCreate(width, lutRgb) {
    const w = Math.max(1, width | 0);
    const ring = {
      w,
      stride: 4, // floats per row (multiple of 4)
      mags: new Float32Array(w * 4),
      meta: new Float32Array(w * META_FLOATS),
      head: 0, // next row to write = oldest column (leftmost)
      dirtyFrom: 0,
      dirtyCount: w,
      lut: new Uint8Array(256 * 4 * LUT_ROWS),
      lutSrc: new Array(LUT_ROWS).fill(null),
      lutRow: 0,
      lutDirty: true,
      pending: new Float32Array(4),
      pendingBins: 0,
      pendingValid: false,
      gpu: null,
    };
    writeLutRow(ring, 0, lutRgb);
    return ring;
  }

  function markAllDirty(ring) {
    ring.dirtyFrom = 0;
    ring.dirtyCount = ring.w;
  }

  function ensureStride(ring, bins) {
    const need = Math.max(4, Math.ceil(Math.max(1, bins | 0) / 4) * 4);
    if (need <= ring.stride) return;
    const old = ring.mags;
    const oldStride = ring.stride;
    const next = new Float32Array(ring.w * need);
    for (let r = 0; r < ring.w; r += 1) {
      next.set(old.subarray(r * oldStride, (r + 1) * oldStride), r * need);
    }
    ring.mags = next;
    ring.stride = need;
    const pending = new Float32Array(need);
    pending.set(ring.pending.subarray(0, Math.min(ring.pending.length, need)));
    ring.pending = pending;
    markAllDirty(ring);
  }

  /** Max-pool one raw spectrum into the column waiting for the next whole pixel. */
  function spectrogramGlRingPool(ring, spectrum, spectrumBins) {
    const bins = Math.max(0, spectrumBins | 0);
    if (!ring || !spectrum || bins < 1) return;
    ensureStride(ring, bins);
    const p = ring.pending;
    if (!ring.pendingValid || ring.pendingBins !== bins) {
      p.fill(0);
      for (let b = 0; b < bins; b += 1) {
        const v = Number(spectrum[b]);
        p[b] = Number.isFinite(v) ? v : 0;
      }
      ring.pendingBins = bins;
      ring.pendingValid = true;
      return;
    }
    for (let b = 0; b < bins; b += 1) {
      const v = Number(spectrum[b]);
      const x = Number.isFinite(v) ? v : 0;
      if (x > p[b]) p[b] = x;
    }
  }

  /** LUT row for new ink. Reuses a matching row, else an unreferenced one. */
  function lutRowFor(ring, lutRgb) {
    const cur = ring.lutRow;
    if (lutRowMatches(ring, cur, lutRgb)) return cur;
    for (let r = 0; r < LUT_ROWS; r += 1) {
      if (r !== cur && lutRowMatches(ring, r, lutRgb)) {
        ring.lutRow = r;
        return r;
      }
    }
    const used = new Uint8Array(LUT_ROWS);
    used[cur] = 1;
    for (let c = 0; c < ring.w; c += 1) {
      const r = ring.meta[c * META_FLOATS + 7] | 0;
      if (r >= 0 && r < LUT_ROWS) used[r] = 1;
    }
    let row = -1;
    for (let k = 1; k < LUT_ROWS; k += 1) {
      const r = (cur + k) % LUT_ROWS;
      if (!used[r]) {
        row = r;
        break;
      }
    }
    // Every row still has ink (fast gradient drags): overwrite the newest one,
    // which only recolours the most recent columns.
    if (row < 0) row = cur;
    writeLutRow(ring, row, lutRgb);
    ring.lutRow = row;
    return row;
  }

  /**
   * Emit n identical columns from the pending pool (same as the Canvas2D
   * scroll-and-paint). params: floorDb, ceilingDb, freqScale, minFreq,
   * maxFreq (already band-resolved), nyquist, lutRgb.
   */
  function spectrogramGlRingWrite(ring, nPixels, params) {
    if (!ring || !ring.pendingValid) return;
    const n = Math.min(ring.w, Math.max(0, Math.floor(nPixels)));
    if (n < 1) return;
    const p = params || {};
    const row = lutRowFor(ring, p.lutRgb);
    const floorRaw = Number(p.floorDb);
    const ceilingRaw = Number(p.ceilingDb);
    // Missing / NaN only. Explicit 0 stays 0.
    const floorDb = Number.isFinite(floorRaw) ? floorRaw : -80;
    const ceilingDb = Number.isFinite(ceilingRaw) ? ceilingRaw : 0;
    // 0 Linear, 1 Mel, 2 Bark; 3 log Hz (Circular Spectrogram only).
    // 0..3 retain legacy named scales; 4..5 encode the continuous polar curve.
    const scale = p.frequencyCurve == null
      ? SoemMath.clamp(Math.round(nodeGraphFiniteNumber(p.freqScale)), 0, 3)
      : 4 + SoemMath.clamp(nodeGraphFiniteNumber(p.frequencyCurve, 1), 0, 1);
    const lo = nodeGraphFiniteNumber(p.minFreq, 20);
    const hi = nodeGraphFiniteNumber(p.maxFreq, 20000);
    const nyq = nodeGraphFiniteNumber(p.nyquist, 22050);
    const stride = ring.stride;
    const src = ring.pending.subarray(0, stride);
    for (let k = 0; k < n; k += 1) {
      const r = (ring.head + k) % ring.w;
      ring.mags.set(src, r * stride);
      const m = r * META_FLOATS;
      ring.meta[m] = floorDb;
      ring.meta[m + 1] = ceilingDb;
      ring.meta[m + 2] = scale;
      ring.meta[m + 3] = ring.pendingBins;
      ring.meta[m + 4] = lo;
      ring.meta[m + 5] = hi;
      ring.meta[m + 6] = nyq;
      ring.meta[m + 7] = row;
    }
    if (ring.dirtyCount <= 0) {
      ring.dirtyFrom = ring.head;
      ring.dirtyCount = 0;
    }
    ring.dirtyCount = Math.min(ring.w, ring.dirtyCount + n);
    ring.head = (ring.head + n) % ring.w;
    ring.pendingValid = false;
    ring.pending.fill(0);
  }

  /**
   * New face width: resample history in time (pixel-centre aligned, like the
   * Canvas2D bilinear stretch). Height needs nothing — the shader maps bins.
   */
  function spectrogramGlRingResize(ring, width) {
    const w = Math.max(1, width | 0);
    if (!ring || ring.w === w) return ring;
    const oldW = ring.w;
    const stride = ring.stride;
    const mags = new Float32Array(w * stride);
    const meta = new Float32Array(w * META_FLOATS);
    for (let j = 0; j < w; j += 1) {
      const s = Math.max(0, Math.min(oldW - 1, ((j + 0.5) * oldW) / w - 0.5));
      const i0 = Math.floor(s);
      const i1 = Math.min(oldW - 1, i0 + 1);
      const f = s - i0;
      const r0 = (ring.head + i0) % oldW;
      const r1 = (ring.head + i1) % oldW;
      const near = f < 0.5 ? r0 : r1;
      meta.set(ring.meta.subarray(near * META_FLOATS, (near + 1) * META_FLOATS), j * META_FLOATS);
      const sameBins = ring.meta[r0 * META_FLOATS + 3] === ring.meta[r1 * META_FLOATS + 3];
      const o = j * stride;
      if (sameBins && f > 0) {
        for (let b = 0; b < stride; b += 1) {
          mags[o + b] = ring.mags[r0 * stride + b] * (1 - f) + ring.mags[r1 * stride + b] * f;
        }
      } else {
        mags.set(ring.mags.subarray(near * stride, (near + 1) * stride), o);
      }
    }
    ring.w = w;
    ring.mags = mags;
    ring.meta = meta;
    ring.head = 0; // chronological layout: row 0 is the oldest column
    markAllDirty(ring);
    return ring;
  }

  // ---------------------------------------------------------------- GPU

  function makeTexture(gl) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function releaseGpu(ring) {
    const g = ring?.gpu;
    if (!g) return;
    ring.gpu = null;
    const gl = g.gl;
    if (!gl || gl.isContextLost()) return;
    if (g.ringTex) gl.deleteTexture(g.ringTex);
    if (g.metaTex) gl.deleteTexture(g.metaTex);
    if (g.lutTex) gl.deleteTexture(g.lutTex);
  }

  function uploadRows(gl, g, ring, r0, n) {
    if (n < 1) return;
    const stride = ring.stride;
    gl.bindTexture(gl.TEXTURE_2D, g.ringTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, r0, stride / 4, n, gl.RGBA, gl.FLOAT,
      ring.mags.subarray(r0 * stride, (r0 + n) * stride),
    );
    gl.bindTexture(gl.TEXTURE_2D, g.metaTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, r0, 2, n, gl.RGBA, gl.FLOAT,
      ring.meta.subarray(r0 * META_FLOATS, (r0 + n) * META_FLOATS),
    );
  }

  function syncGpu(ring, gl, entry) {
    let g = ring.gpu;
    if (!g || g.gl !== gl || g.entry !== entry) {
      releaseGpu(ring);
      g = {
        gl,
        entry,
        ringTex: makeTexture(gl),
        metaTex: makeTexture(gl),
        lutTex: makeTexture(gl),
        texW: 0,
        texH: 0,
      };
      ring.gpu = g;
      ring.lutDirty = true;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const texW = ring.stride / 4;
    if (g.texW !== texW || g.texH !== ring.w) {
      gl.bindTexture(gl.TEXTURE_2D, g.ringTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, g.entry.floatInternal, texW, ring.w, 0, gl.RGBA, gl.FLOAT, ring.mags);
      gl.bindTexture(gl.TEXTURE_2D, g.metaTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, g.entry.floatInternal, 2, ring.w, 0, gl.RGBA, gl.FLOAT, ring.meta);
      g.texW = texW;
      g.texH = ring.w;
      ring.dirtyCount = 0;
    } else if (ring.dirtyCount > 0) {
      const count = Math.min(ring.w, ring.dirtyCount);
      if (count >= ring.w) {
        uploadRows(gl, g, ring, 0, ring.w);
      } else {
        const from = ((ring.dirtyFrom % ring.w) + ring.w) % ring.w;
        const first = Math.min(count, ring.w - from);
        uploadRows(gl, g, ring, from, first);
        uploadRows(gl, g, ring, 0, count - first);
      }
      ring.dirtyCount = 0;
    }
    if (ring.lutDirty) {
      gl.bindTexture(gl.TEXTURE_2D, g.lutTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, LUT_ROWS, 0, gl.RGBA, gl.UNSIGNED_BYTE, ring.lut);
      ring.lutDirty = false;
    }
    return g;
  }

  /** True when this face can draw through the shared device this frame. */
  function spectrogramGlUsable(ring, bufW, bufH) {
    if (!ring) return false;
    const dev = pictureDevice();
    if (!dev?.gl || !dev.canvas || dev.gl.isContextLost()) return false;
    const entry = programFor(dev);
    if (!entry) return false;
    const w = bufW | 0;
    const h = bufH | 0;
    if (w < 1 || h < 1 || w > dev.canvas.width || h > dev.canvas.height) return false;
    if (w > entry.maxTex || ring.stride / 4 > entry.maxTex) return false;
    return true;
  }

  /**
   * Shade the ring into the shared canvas (bottom-left w x h, scissored).
   * base owns the ring textures (the waterfall program); entry is the program
   * drawn with; extra(gl, u) sets its own uniforms. False when GL is lost.
   */
  function shadeRing(dev, base, entry, ring, w, h, subPx, plateRgb, fullMag, extra, target = null) {
    const gl = dev.gl;
    const g = syncGpu(ring, gl, base);

    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo || null);
    gl.viewport(0, 0, w, h);
    gl.scissor(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(entry.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, dev.quad);
    gl.enableVertexAttribArray(entry.aPos);
    gl.vertexAttribPointer(entry.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.ringTex);
    gl.uniform1i(entry.u.uRing, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g.metaTex);
    gl.uniform1i(entry.u.uMeta, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, g.lutTex);
    gl.uniform1i(entry.u.uLut, 2);
    gl.uniform2f(entry.u.uSize, w, h);
    gl.uniform1f(entry.u.uHead, ring.head);
    const sub = Number(subPx);
    gl.uniform1f(entry.u.uSub, Number.isFinite(sub) && sub > 0 ? Math.min(0.999, sub) : 0);
    const pr = plateRgb && plateRgb.length >= 3 ? plateRgb : [0, 0, 0];
    gl.uniform3f(
      entry.u.uPlate,
      nodeGraphFiniteNumber(pr[0]),
      nodeGraphFiniteNumber(pr[1]),
      nodeGraphFiniteNumber(pr[2]),
    );
    gl.uniform1f(entry.u.uRingTexW, ring.stride / 4);
    gl.uniform1f(entry.u.uLutRows, LUT_ROWS);
    const magRef = nodeGraphFiniteNumber(fullMag);
    gl.uniform1f(entry.u.uFullMag, magRef > 0 ? magRef : 1e-9);
    if (extra) extra(gl, entry.u);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return !gl.isContextLost();
  }

  /** Copy the shaded rect onto the face: 1:1 crisp, else smooth. */
  function copyOut(dev, destCtx, w, h, destW, destH) {
    const dw = Math.max(1, destW | 0);
    const dh = Math.max(1, destH | 0);
    const exact = w === dw && h === dh;
    nodeGraphSharedGlCopyToContext(destCtx, 0, dev.canvas.height - h, w, h, 0, 0, dw, dh, !exact);
    return true;
  }

  /**
   * Waterfall: shade the ring and copy that rect onto the face. Returns false
   * when GL cannot draw (the caller logs once and fills black).
   */
  function spectrogramGlRingPresent(ring, bufW, bufH, destCtx, destW, destH, subPx, plateRgb, fullMag) {
    if (!ring || !destCtx) return false;
    const w = bufW | 0;
    const h = bufH | 0;
    if (ring.w !== w || !spectrogramGlUsable(ring, w, h)) return false;
    const dev = pictureDevice();
    const entry = programFor(dev);
    if (!entry) return false;
    if (!shadeRing(dev, entry, entry, ring, w, h, subPx, plateRgb, fullMag, null)) return false;
    return copyOut(dev, destCtx, w, h, destW, destH);
  }

  /**
   * Circular Spectrogram: same ring, polar lookup (FS_POLAR). bufW x bufH is
   * the face raster; ring.w is the column count around the circle.
   * polar: { mirror, up, rotate (rad), inner (0…0.95 of the radius) }.
   */
  function spectrogramGlRingPresentPolar(ring, bufW, bufH, destCtx, destW, destH, subPx, plateRgb, fullMag, polar) {
    if (!ring || !destCtx) return false;
    const w = bufW | 0;
    const h = bufH | 0;
    if (!spectrogramGlUsable(ring, w, h)) return false;
    const dev = pictureDevice();
    const base = programFor(dev);
    const entry = polarProgramFor(dev);
    if (!base || !entry || ring.w > entry.maxTex) return false;
    const p = polar || {};
    const shaded = shadeRing(dev, base, entry, ring, w, h, subPx, plateRgb, fullMag, (gl, u) => {
      gl.uniform1f(u.uCols, ring.w);
      gl.uniform1f(u.uReverseFrequency, p.reverseFrequency ? 1 : 0);
      gl.uniform2f(u.uHeadMode, p.movingHead ? 1 : 0, nodeGraphFiniteNumber(p.sweepPhase));
      gl.uniform1f(u.uEnergy, 0);
      gl.uniform4f(
        u.uPolar,
        p.mirror ? 1 : 0,
        p.up ? 1 : 0,
        nodeGraphFiniteNumber(p.rotate),
        nodeGraphFiniteNumber(p.inner),
      );
    });
    if (!shaded) return false;
    return copyOut(dev, destCtx, w, h, destW, destH);
  }

  const FS_CIRCULAR_SWEEPS = `
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uCurrent;
uniform vec2 uSize;
uniform vec4 uPolar;
uniform float uPhase;
uniform float uMoving;
uniform float uShift;
uniform float uColumns;
uniform float uCols;
uniform float uKeep;
uniform float uAfterglow;
uniform float uSweepFade;
uniform float uPass;
uniform vec3 uBg;
${POLAR_AGE_GLSL}
vec4 sweepSample(sampler2D image, vec2 uv) {
  vec2 p = uv * uSize - 0.5;
  vec2 base = floor(p), f = fract(p);
  vec2 a = (base + 0.5) / uSize;
  vec2 px = 1.0 / uSize;
  return mix(mix(texture2D(image, a), texture2D(image, a + vec2(px.x, 0.0)), f.x),
    mix(texture2D(image, a + vec2(0.0, px.y)), texture2D(image, a + px), f.x), f.y);
}
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float sweepAge = polarAge(gl_FragCoord.xy);
  float age = uMoving > 0.5 ? fract(uPhase - sweepAge) : sweepAge;
  if (uPass < 0.5 && uMoving < 0.5) {
    // Fixed head: scroll existing layers by angular travel before retiring the tail.
    vec2 p = gl_FragCoord.xy - 0.5 * uSize;
    float head = uPolar.z + (uPolar.y > 0.5 ? 3.141592653589793 : 0.0);
    float d = mod(atan(p.x, p.y) - head + 3.141592653589793, 6.283185307179586) - 3.141592653589793;
    float previousAge = fract(sweepAge - uShift);
    float direction = uPolar.x > 0.5 ? (d < 0.0 ? -1.0 : 1.0) : (uPolar.y > 0.5 ? -1.0 : 1.0);
    float angle = head + direction * previousAge * (uPolar.x > 0.5 ? 3.141592653589793 : 6.283185307179586);
    uv = (0.5 * uSize + length(p) * vec2(sin(angle), cos(angle))) / uSize;
  }
  vec4 old = texture2D(uSrc, uv);
  vec4 current = texture2D(uCurrent, uv);
  if (uPass < 0.5 && uMoving < 0.5) {
    old = sweepSample(uSrc, uv);
    current = sweepSample(uCurrent, uv);
  }
  if (uPass < 0.5) {
    old *= uKeep;
    // Retire only the part of the old sweep being revisited, before replacing it.
    if (age * uCols < uColumns) old = max(old, current);
    gl_FragColor = old;
  } else {
    // Zero preserves a hard sweep boundary; nonzero eases only the chosen tail width.
    float fade = uSweepFade > 0.0 ? smoothstep(1.0 - uSweepFade, 1.0, age) : 0.0;
    current *= mix(1.0, uAfterglow, fade);
    vec4 ink = max(current, old * uAfterglow);
    gl_FragColor = vec4(ink.rgb + uBg * (1.0 - clamp(ink.a, 0.0, 1.0)), 1.0);
  }
}
`;

  /** One clean revolution plus older ink whose lifetime is measured in turns. */
  function spectrogramGlRingPresentPolarRetained(ring, canvas, plateRgb, fullMag, polar, settings, columns, turns) {
    if (!ring || !canvas) return false;
    const plate = nodeGraphResidualFaceGlPlate(canvas, "circular-sweeps");
    if (!plate) return false;
    ring.polarCanvas = canvas;
    const gl = plate.gl;
    if (!plate.circularCurrent) {
      plate.circularCurrent = nodeGraphResidualFaceGlTarget(gl, plate.w, plate.h);
      if (!plate.circularCurrent) return false;
    }
    const dev = pictureDevice();
    const base = programFor(dev), entry = polarProgramFor(dev);
    if (!base || !entry || ring.w > entry.maxTex) return false;
    const p = polar;
    const moving = p.movingHead !== false;
    const hang = Math.max(0, nodeGraphFiniteNumber(settings.circularHangTurns, 1));
    const amount = hang > 0 ? Math.max(0, Math.min(1, nodeGraphFiniteNumber(settings.circularAfterglow, 0.2))) : 0;
    // Hang = number of turns to 1%, not seconds. Spin 0 therefore holds both layers.
    const keep = hang > 0 ? Math.exp(-Math.LN10 * 2 * Math.max(0, turns) / hang) : 0;
    const uniforms = (pass) => (g, prog) => {
      g.activeTexture(g.TEXTURE1);
      g.bindTexture(g.TEXTURE_2D, plate.circularCurrent.tex);
      g.uniform1i(g.getUniformLocation(prog, "uCurrent"), 1);
      g.uniform4f(g.getUniformLocation(prog, "uPolar"), p.mirror ? 1 : 0, p.up ? 1 : 0, p.rotate, p.inner);
      g.uniform1f(g.getUniformLocation(prog, "uPhase"), p.sweepPhase);
      g.uniform1f(g.getUniformLocation(prog, "uMoving"), moving ? 1 : 0);
      g.uniform1f(g.getUniformLocation(prog, "uShift"), Math.max(0, turns) % 1);
      g.uniform1f(g.getUniformLocation(prog, "uColumns"), Math.min(columns, ring.w));
      g.uniform1f(g.getUniformLocation(prog, "uCols"), ring.w);
      g.uniform1f(g.getUniformLocation(prog, "uKeep"), keep);
      g.uniform1f(g.getUniformLocation(prog, "uAfterglow"), amount);
      g.uniform1f(g.getUniformLocation(prog, "uSweepFade"), Math.max(0, Math.min(1, nodeGraphFiniteNumber(settings.circularSweepFade))));
      g.uniform1f(g.getUniformLocation(prog, "uPass"), pass);
      g.uniform3f(g.getUniformLocation(prog, "uBg"), plateRgb[0], plateRgb[1], plateRgb[2]);
      g.activeTexture(g.TEXTURE0);
    };
    nodeGraphResidualFaceGlReset(gl);
    if (columns > 0) {
      if (!nodeGraphResidualFaceGlFullPass(plate, plate.write.fbo, FS_CIRCULAR_SWEEPS, "circular-sweeps", uniforms(0))) return false;
      nodeGraphResidualFaceGlSwap(plate);
    }
    if (columns > 0 || !plate.circularCurrentReady || plate.circularMoving !== moving) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, plate.circularCurrent.fbo);
      gl.viewport(0, 0, plate.w, plate.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const ok = shadeRing(dev, base, entry, ring, plate.w, plate.h, 0, plateRgb, fullMag, (g, u) => {
        g.uniform1f(u.uCols, ring.w);
        g.uniform1f(u.uReverseFrequency, p.reverseFrequency ? 1 : 0);
        g.uniform2f(u.uHeadMode, moving ? 1 : 0, p.sweepPhase);
        g.uniform1f(u.uEnergy, 1);
        g.uniform4f(u.uPolar, p.mirror ? 1 : 0, p.up ? 1 : 0, p.rotate, p.inner);
      }, plate.circularCurrent);
      if (!ok) return false;
      plate.circularCurrentReady = true;
      plate.circularMoving = moving;
    }
    const ctx = nodeGraphSharedGlPresentTarget(canvas);
    if (!ctx) return false;
    nodeGraphResidualFaceGlReset(gl);
    nodeGraphSharedGlBindPresent(gl, plate.w, plate.h);
    const ok = nodeGraphResidualFaceGlFullPass(plate, null, FS_CIRCULAR_SWEEPS, "circular-sweeps", uniforms(1));
    nodeGraphSharedGlEndPresent(gl);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    if (!ok || gl.isContextLost()) return false;
    return copyOut(dev, ctx, plate.w, plate.h, canvas.width, canvas.height);
  }

  function spectrogramGlRingRelease(ring) {
    if (ring?.polarCanvas) {
      nodeGraphResidualFaceGlDrop(ring.polarCanvas);
      ring.polarCanvas = null;
    }
    releaseGpu(ring);
  }

  // JS twin of grade01 (smoke + 1D-style dBFS checks). x is log10(1+ema·100).
  const SPECTROGRAM_GRADE_WINDOW_DB = 80;
  function spectrogramGrade01(x, floorDb, ceilingDb, fullMag) {
    const floor = Number.isFinite(Number(floorDb)) ? Number(floorDb) : -80;
    const ceiling = Number.isFinite(Number(ceilingDb)) ? Number(ceilingDb) : 0;
    const ema = Math.max(0, (Math.pow(10, Number(x)) - 1) / 100);
    const db = 20 * Math.log10(Math.max(ema / Math.max(Number(fullMag) || 0, 1e-9), 1e-12));
    const v = Math.min(1, Math.max(0, (db - floor) / Math.max(ceiling - floor, 0.01)));
    const knee = 0.2;
    const edge = Math.min(v, 1 - v);
    if (edge >= knee) return v;
    const t = edge / knee;
    const shaped = knee * t * t * (2 - t);
    return v < 0.5 ? shaped : 1 - shaped;
  }

  global.SPECTROGRAM_GL_LUT_ROWS = LUT_ROWS;
  global.SPECTROGRAM_GL_FRAGMENT_SHADER = FS;
  global.SPECTROGRAM_GRADE_WINDOW_DB = SPECTROGRAM_GRADE_WINDOW_DB;
  global.spectrogramGrade01 = spectrogramGrade01;
  global.spectrogramGlRingCreate = spectrogramGlRingCreate;
  global.spectrogramGlRingPool = spectrogramGlRingPool;
  global.spectrogramGlRingWrite = spectrogramGlRingWrite;
  global.spectrogramGlRingResize = spectrogramGlRingResize;
  global.spectrogramGlUsable = spectrogramGlUsable;
  global.spectrogramGlRingPresent = spectrogramGlRingPresent;
  global.spectrogramGlRingPresentPolar = spectrogramGlRingPresentPolar;
  global.spectrogramGlRingPresentPolarRetained = spectrogramGlRingPresentPolarRetained;
  global.spectrogramGlRingRelease = spectrogramGlRingRelease;
})(typeof globalThis !== "undefined" ? globalThis : window);
