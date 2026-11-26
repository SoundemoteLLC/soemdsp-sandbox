// Shared spectral style renderer (docs/SPECTRAL_DISPLAY_VISION.md §1.2).
// One renderer, many styles, drawn with the shared WebGL line batch
// (public/lib/visual/gl-line-renderer.js) on the shared picture device.
//
// Input: points sorted by frequency, all in dB:
//   { hz, a, b?, c?, gain?, hz2?, a2?, weight, serial }
//   a     the main level (output / held / wet / band envelope)
//   b, c  ghosts (input, second source)
//   gain  per-point gain in dB (Gate / Contrast)
//   hz2 / a2 / weight   Vocoder incoming bank while Bands crossfades
// Frequency runs left to right through the shared Curve
// (nodeGraphFrequencyCurveHz, 0 linear Hz .. 1 log Hz). Level is placed
// between Floor and Ceiling; above Ceiling is marked, never faked as a clip.
//
// Styles: curve, bars, particles, mirrorBars, miniWaterfall, overlay, bandGain.

const NODE_GRAPH_SPECTRAL_STYLES = Object.freeze([
  Object.freeze({ value: "curve", label: "Curve", needs: "a" }),
  Object.freeze({ value: "bars", label: "Bars", needs: "a" }),
  Object.freeze({ value: "particles", label: "Particles", needs: "a" }),
  Object.freeze({ value: "mirrorBars", label: "Mirror bars", needs: "a" }),
  Object.freeze({ value: "miniWaterfall", label: "Waterfall", needs: "a" }),
  Object.freeze({ value: "overlay", label: "Overlay", needs: "b" }),
  Object.freeze({ value: "bandGain", label: "Band gain", needs: "gain" }),
]);

/** Column edges in Hz through the shared Curve, cached per layout. */
const nodeGraphSpectralEdgeCache = new Map();
function nodeGraphSpectralColumnEdges(count, curve, lo, hi) {
  const key = `${count}|${curve}|${lo}|${hi}`;
  let edges = nodeGraphSpectralEdgeCache.get(key);
  if (edges) return edges;
  edges = new Float64Array(count + 1);
  for (let i = 0; i <= count; i += 1) edges[i] = nodeGraphFrequencyCurveHz(i / count, curve, lo, hi);
  if (nodeGraphSpectralEdgeCache.size > 32) nodeGraphSpectralEdgeCache.clear();
  nodeGraphSpectralEdgeCache.set(key, edges);
  return edges;
}

/** First index with hz[i] >= f (hz ascending). */
function nodeGraphSpectralLowerBound(hz, f) {
  let lo = 0;
  let hi = hz.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hz[mid] < f) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Per-column dB: max of the points inside each column's Hz span (narrow peaks
 * survive a log axis); a column with no point interpolates its neighbours in
 * log frequency, so a sparse band set still draws a continuous shape.
 */
function nodeGraphSpectralColumns(count, hz, db, curve, lo, hi, out = new Float32Array(count)) {
  const n = Math.min(hz?.length || 0, db?.length || 0);
  if (!n) return out.fill(-Infinity);
  const edges = nodeGraphSpectralColumnEdges(count, curve, lo, hi);
  for (let c = 0; c < count; c += 1) {
    const i0 = nodeGraphSpectralLowerBound(hz, edges[c]);
    const i1 = nodeGraphSpectralLowerBound(hz, edges[c + 1]);
    let v = -Infinity;
    for (let i = i0; i < i1 && i < n; i += 1) if (db[i] > v) v = db[i];
    if (v === -Infinity) {
      const f = 0.5 * (edges[c] + edges[c + 1]);
      const r = Math.min(n - 1, i0);
      const l = Math.max(0, r - 1);
      if (hz[r] <= f || l === r) v = db[r];
      else {
        const a = Math.log(Math.max(1e-6, hz[l]));
        const b = Math.log(Math.max(1e-6, hz[r]));
        const t = b > a ? Math.max(0, Math.min(1, (Math.log(Math.max(1e-6, f)) - a) / (b - a))) : 0;
        v = db[l] + (db[r] - db[l]) * t;
      }
    }
    out[c] = v;
  }
  return out;
}

/** dB → 0..1 between Floor and Ceiling (above 1 is over-range, kept). */
function nodeGraphSpectralLevel01(db, floorDb, ceilingDb) {
  const span = Math.max(0.1, ceilingDb - floorDb);
  const v = (db - floorDb) / span;
  return Number.isFinite(v) ? Math.max(0, v) : 0;
}

/** Gradient color at v (0..1) from a 256-entry RGB LUT. */
function nodeGraphSpectralColor(lut, v, alpha = 1) {
  const i = Math.max(0, Math.min(255, Math.round(Math.max(0, Math.min(1, v)) * 255))) * 3;
  return [lut[i] / 255, lut[i + 1] / 255, lut[i + 2] / 255, alpha];
}

/** Deterministic 0..1 hash (particles keep their place between hops). */
function nodeGraphSpectralHash01(a, b, c) {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Peak envelope over columns; moves only when new data arrives (dt > 0). */
function nodeGraphSpectralPeaks(state, key, cols, mode, dt, decayPerSecond) {
  let peak = state[key];
  if (!peak || peak.length !== cols.length) {
    peak = state[key] = { v: Float32Array.from(cols, (x) => Math.min(1, x)), age: new Float32Array(cols.length) };
    return peak.v;
  }
  for (let i = 0; i < cols.length; i += 1) {
    const level = Math.min(1, cols[i]);
    if (level >= peak.v[i]) {
      peak.v[i] = level;
      peak.age[i] = 0;
    } else {
      peak.age[i] += dt;
      if (mode === "fall" || peak.age[i] > 0.5) peak.v[i] = Math.max(level, peak.v[i] - decayPerSecond * dt);
    }
  }
  return peak.v;
}

/** Bar slots that keep whole-pixel widths: at least 2 px bar + 1 px gap. */
function nodeGraphSpectralBarLayout(W, wanted) {
  const n = Math.max(1, Math.min(Math.round(wanted), Math.floor(W / 3)));
  const slot = W / n;
  const bar = Math.max(1, Math.floor(slot * 0.78));
  return { n, slot, bar };
}

/**
 * Draw one spectral frame into a GL line batch.
 * view: { W, H, lo, hi, curve }
 * settings: normalized spectral style settings + lut (Uint8Array 768)
 * state: per-node retained state (peaks, waterfall rows, last serial)
 */
function nodeGraphSpectralDraw(batch, view, data, settings, state) {
  const { W, H, lo, hi, curve } = view;
  const lut = settings.lut;
  const floorDb = settings.spectralFloorDb;
  const ceilingDb = settings.spectralCeilingDb;
  const style = settings.spectralStyle;
  const fresh = data.serial !== state.serial;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const dt = fresh && state.serialMs ? Math.min(0.25, Math.max(0, (now - state.serialMs) / 1000)) : 0;
  if (fresh) {
    state.serial = data.serial;
    state.serialMs = now;
  }
  const span = Math.max(0.1, ceilingDb - floorDb);
  const decay = settings.spectralPeakDecay / span;
  const level = (db) => nodeGraphSpectralLevel01(db, floorDb, ceilingDb);
  const colsFor = (count, hz, db) => {
    const c = nodeGraphSpectralColumns(count, hz, db, curve, lo, hi);
    for (let i = 0; i < count; i += 1) c[i] = level(c[i]);
    return c;
  };
  // Vocoder Bands change: the incoming bank fades in with the DSP's own weight.
  const mainCols = (count) => {
    const c = colsFor(count, data.hz, data.a);
    if (data.a2 && data.hz2 && data.weight > 0) {
      const d = colsFor(count, data.hz2, data.a2);
      for (let i = 0; i < count; i += 1) c[i] += (d[i] - c[i]) * data.weight;
    }
    return c;
  };
  // Silence leaves a faint floor, not a black tile.
  nodeGraphGlLinesRect(batch, 0, H - 1, W, 1, nodeGraphSpectralColor(lut, 0.12, 0.8));
  const overRange = (cols, slot, width) => {
    for (let i = 0; i < cols.length; i += 1) {
      if (cols[i] > 1) nodeGraphGlLinesRect(batch, Math.floor(i * slot), 0, Math.max(1, Math.ceil(width)), 2, [1, 1, 1, 0.9]);
    }
  };
  const peaksOn = settings.spectralPeakHold !== "off";

  if (style === "bars" || style === "mirrorBars") {
    const { n, slot, bar } = nodeGraphSpectralBarLayout(W, settings.spectralBarCount);
    const a = mainCols(n);
    const mirror = style === "mirrorBars";
    const b = mirror ? (data.b ? colsFor(n, data.hz, data.b) : a) : null;
    const base = mirror ? H * 0.5 : H;
    const reach = mirror ? H * 0.5 - 1 : H - 2;
    const peaks = peaksOn ? nodeGraphSpectralPeaks(state, `bars${n}`, a, settings.spectralPeakHold, dt, decay) : null;
    for (let i = 0; i < n; i += 1) {
      const x = Math.round(i * slot + (slot - bar) / 2);
      const h = Math.round(Math.min(1, a[i]) * reach);
      if (h > 0) nodeGraphGlLinesRect(batch, x, base - h, bar, h, nodeGraphSpectralColor(lut, 0.35 + 0.65 * Math.min(1, a[i])));
      if (mirror) {
        const hb = Math.round(Math.min(1, b[i]) * reach);
        if (hb > 0) nodeGraphGlLinesRect(batch, x, base, bar, hb, nodeGraphSpectralColor(lut, 0.3 + 0.6 * Math.min(1, b[i]), 0.75));
      }
      if (peaks && peaks[i] > 0) {
        nodeGraphGlLinesRect(batch, x, Math.round(base - peaks[i] * reach) - 2, bar, 2, nodeGraphSpectralColor(lut, 1, 0.9));
      }
    }
    overRange(a, slot, bar);
    return;
  }

  if (style === "particles") {
    const n = Math.max(8, Math.min(256, Math.floor(W / 3)));
    const a = mainCols(n);
    const slot = W / n;
    const cap = settings.spectralParticles;
    let total = 0;
    for (let i = 0; i < n; i += 1) total += Math.min(1, a[i]);
    const perUnit = total > 0 ? cap / total : 0;
    const serial = Math.floor(state.serial);
    const r = Math.max(1, Math.min(4, slot * 0.6));
    let budget = cap;
    for (let i = 0; i < n && budget > 0; i += 1) {
      const v = Math.min(1, a[i]);
      const count = Math.min(Math.floor(v * perUnit), Math.round(cap / 4), budget);
      budget -= count;
      const ridge = H - v * (H - 2);
      for (let k = 0; k < count; k += 1) {
        // Fog gathers under the ridge and thins with depth; jitter changes per hop.
        const u = nodeGraphSpectralHash01(i, k, serial);
        const w = nodeGraphSpectralHash01(k, serial, i + 7919);
        const depth = u * u;
        const x = (i + w) * slot;
        const y = ridge + depth * (H - ridge) + (nodeGraphSpectralHash01(serial, i, k + 104729) - 0.5) * slot;
        const c = nodeGraphSpectralColor(lut, 0.25 + 0.75 * v * (1 - depth * 0.6), 0.18 + 0.32 * (1 - depth));
        c[0] += (1 - c[0]) * 0.25; c[1] += (1 - c[1]) * 0.25; c[2] += (1 - c[2]) * 0.25;
        nodeGraphGlLinesDot(batch, x, y, r, r, c);
      }
    }
    overRange(a, slot, slot);
    return;
  }

  if (style === "miniWaterfall") {
    const n = Math.max(8, Math.min(160, Math.floor(W / 3)));
    const rows = settings.spectralHistory;
    if (!state.rows || state.rows.n !== n || state.rows.count !== rows) {
      state.rows = { n, count: rows, data: new Float32Array(n * rows), head: 0 };
    }
    const ring = state.rows;
    if (fresh) {
      const a = mainCols(n);
      ring.head = (ring.head + rows - 1) % rows;
      ring.data.set(a, ring.head * n);
    }
    const slot = W / n;
    const rowH = H / rows;
    for (let r = 0; r < rows; r += 1) {
      const o = ((ring.head + r) % rows) * n;
      const fade = 1 - (r / rows) * 0.7;
      for (let i = 0; i < n; i += 1) {
        const v = Math.min(1, ring.data[o + i]);
        if (!(v > 0.02)) continue;
        nodeGraphGlLinesRect(batch, Math.floor(i * slot), Math.floor(r * rowH), Math.ceil(slot), Math.ceil(rowH), nodeGraphSpectralColor(lut, v * fade, 0.95));
      }
    }
    return;
  }

  if (style === "bandGain" && data.gain) {
    const { n, slot, bar } = nodeGraphSpectralBarLayout(W, settings.spectralBarCount);
    const g = nodeGraphSpectralColumns(n, data.hz, data.gain, curve, lo, hi);
    const boost = settings.spectralGainBoostDb;
    const cut = settings.spectralGainRangeDb;
    const zero = Math.round(H * (boost / Math.max(0.1, boost + cut)));
    nodeGraphGlLinesRect(batch, 0, zero, W, 1, nodeGraphSpectralColor(lut, 0.55, 0.9));
    for (let i = 0; i < n; i += 1) {
      const x = Math.round(i * slot + (slot - bar) / 2);
      const gain = Number.isFinite(g[i]) ? g[i] : 0;
      // Open / unity reads light, shut / cut reads slate; boosts rise warm.
      const open = Math.max(0, Math.min(1, 1 + gain / Math.max(0.1, cut)));
      if (gain < 0) {
        const h = Math.round(Math.min(1, -gain / Math.max(0.1, cut)) * (H - zero));
        const slate = [0.2, 0.24, 0.3, 0.95];
        const light = nodeGraphSpectralColor(lut, 0.85, 0.95);
        const col = slate.map((s, k) => s + (light[k] - s) * open);
        if (h > 0) nodeGraphGlLinesRect(batch, x, zero, bar, h, col);
        nodeGraphGlLinesRect(batch, x, Math.max(0, zero - Math.round(open * zero)), bar, Math.round(open * zero), nodeGraphSpectralColor(lut, 0.4 + 0.5 * open, 0.35));
      } else if (gain > 0 && boost > 0) {
        const h = Math.round(Math.min(1, gain / boost) * zero);
        if (h > 0) nodeGraphGlLinesRect(batch, x, zero - h, bar, h, nodeGraphSpectralColor(lut, 0.85, 0.95));
      } else {
        nodeGraphGlLinesRect(batch, x, Math.max(0, zero - 3), bar, 3, nodeGraphSpectralColor(lut, 0.9, 0.95));
      }
    }
    return;
  }

  // curve (default) and overlay: a filled mountain with a sharp stroke; overlay
  // adds the ghost(s) as thin lines over it.
  const n = Math.max(2, Math.min(W, 512));
  const a = mainCols(n);
  const pts = new Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    pts[i * 2] = n > 1 ? (i / (n - 1)) * W : 0;
    pts[i * 2 + 1] = H - Math.min(1, a[i]) * (H - 2) - 1;
  }
  nodeGraphGlLinesFillUnder(batch, pts, H, nodeGraphSpectralColor(lut, 0.45, 0.4));
  nodeGraphGlLinesPolyline(batch, pts, 0.75, 0.7, nodeGraphSpectralColor(lut, 0.92, 1));
  if (style === "overlay") {
    const ghost = (db, v) => {
      if (!db) return;
      const g = colsFor(n, data.hz, db);
      const gp = new Array(n * 2);
      for (let i = 0; i < n; i += 1) {
        gp[i * 2] = pts[i * 2];
        gp[i * 2 + 1] = H - Math.min(1, g[i]) * (H - 2) - 1;
      }
      nodeGraphGlLinesPolyline(batch, gp, 0.5, 0.7, nodeGraphSpectralColor(lut, v, 0.7));
    };
    ghost(data.b, 0.6);
    ghost(data.c, 0.3);
  }
  if (peaksOn) {
    const peaks = nodeGraphSpectralPeaks(state, `curve${n}`, a, settings.spectralPeakHold, dt, decay);
    const step = Math.max(2, Math.round(n / 64));
    for (let i = 0; i < n; i += step) {
      if (!(peaks[i] > 0)) continue;
      nodeGraphGlLinesRect(batch, Math.round(pts[i * 2]) - 1, Math.round(H - peaks[i] * (H - 2) - 2), 3, 1, nodeGraphSpectralColor(lut, 1, 0.85));
    }
  }
  overRange(a, W / n, Math.max(1, W / n));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NODE_GRAPH_SPECTRAL_STYLES, nodeGraphSpectralColumns, nodeGraphSpectralLevel01, nodeGraphSpectralDraw, nodeGraphSpectralBarLayout };
}
