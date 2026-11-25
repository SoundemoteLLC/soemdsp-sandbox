// 1D Spectrum: classic magnitude-vs-frequency analyzer face (filled / line / bars).
// Data comes from the shared worklet analysis (spectrogram-worklet-evaluator.js,
// FFT and windows from public/lib/spectral-analysis.js):
//   SpectrumRaw      |X[k]| of the last analysis (no EMA, no compression)
//   SpectrumGain     [window sum] so a full-scale sine reads 0 dBFS
//   SpectrumLowRaw   Bass detail: |X[k]| from a 4x longer window
//   SpectrumLowMeta  [fftLen, window sum] for SpectrumLowRaw
//   FftSize          hop meta (fftLen, halfN, bins, hop, sampleRate, hopSerial, …)
// Floor / Ceiling and Min / Max Freq are module parameters (face Level / Freq
// bands). Display only. No DSP here.

const nodeGraphSpectrumLineStates = new Map();
const NODE_GRAPH_SPECTRUM_LINE_PEAK_HOLD_SECONDS = 0.5;

function nodeGraphSpectrumLineBusGet(nodeId, port) {
  if (typeof nodeGraphDataBus === "undefined" || typeof nodeGraphDataBusKey !== "function") return null;
  return nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, port)) || null;
}

// Bass detail blend: below LO the long-window spectrum is used, above HI the
// main one, with a log-frequency smoothstep between (no visible seam).
const NODE_GRAPH_SPECTRUM_LINE_BASS_LO_HZ = 150;
const NODE_GRAPH_SPECTRUM_LINE_BASS_HI_HZ = 300;

/** Weight of the bass (long-window) spectrum at hz: 1 below LO, 0 above HI. */
function nodeGraphSpectrumLineBassWeight(hz) {
  if (!(hz > NODE_GRAPH_SPECTRUM_LINE_BASS_LO_HZ)) return 1;
  if (hz >= NODE_GRAPH_SPECTRUM_LINE_BASS_HI_HZ) return 0;
  const t = Math.log(hz / NODE_GRAPH_SPECTRUM_LINE_BASS_LO_HZ)
    / Math.log(NODE_GRAPH_SPECTRUM_LINE_BASS_HI_HZ / NODE_GRAPH_SPECTRUM_LINE_BASS_LO_HZ);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Face heights for one magnitude spectrum: 0 = Floor (or silence in Linear),
 * 1 = Ceiling (or full scale in Linear). Values above 1 are kept so the face
 * can mark over-range instead of drawing a fake clip.
 * Each pixel column takes the max over its bin span (narrow peaks survive the
 * log axis), with linear interpolation between bins at the span edges.
 */
function nodeGraphSpectrumLineSpectrumColumns(out, raw, fullMag, map, ctx) {
  const bins = raw.length;
  const v = nodeGraphSpectrumLineScratch(bins);
  const linear = ctx.mode === "linear";
  for (let i = map.firstBin; i <= map.lastBin; i += 1) {
    const amp = Math.max(0, raw[i]) / fullMag;
    v[i] = linear ? amp : (20 * Math.log10(Math.max(amp, 1e-12)) - ctx.floorDb) / ctx.spanDb;
  }
  const at = (xb) => {
    const a = Math.max(0, Math.min(bins - 1, Math.floor(xb)));
    const b = Math.min(bins - 1, a + 1);
    const f = Math.max(0, Math.min(1, xb - a));
    return v[a] * (1 - f) + v[b] * f;
  };
  for (let x = 0; x < out.length; x += 1) {
    // Bins inside the column span plus its interpolated edges (comb-spike fix).
    // Spans tile the axis, so every bin lands at full value in exactly one
    // column: a bin-centred sine reads its true level even when columns are
    // narrower than a bin.
    const cl = map.lo[x];
    const ch = map.hi[x];
    let value = Math.max(at(cl), at(ch));
    const end = Math.floor(ch);
    for (let i = Math.ceil(cl); i <= end; i += 1) if (v[i] > value) value = v[i];
    out[x] = Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  return out;
}

/**
 * Pure column computation (also used by tests). Returns Float32Array(width)
 * of face heights, 0 = bottom, 1 = top; values above 1 are over-range.
 * data: { raw, windowSum, sampleRate, low?: { raw, windowSum } }
 */
function nodeGraphSpectrumLineComputeColumns(width, data, settings) {
  const w = Math.max(1, width | 0);
  const out = new Float32Array(w);
  const raw = data.raw instanceof Float32Array ? data.raw : null;
  if (!raw || raw.length < 2) return out;
  const sampleRate = Math.max(1, nodeGraphFiniteNumber(data.sampleRate, 44100));
  const nyquist = sampleRate / 2;
  const lo = Math.max(1, Math.min(nyquist - 1, nodeGraphFiniteNumber(settings.minFreq, 20)));
  const hi = Math.max(lo + 1, Math.min(nyquist, nodeGraphFiniteNumber(settings.maxFreq, 20000)));
  const floorDb = nodeGraphFiniteNumber(settings.spectrumDbFloor, -96);
  const ceilDb = nodeGraphFiniteNumber(settings.spectrumDbCeiling, 0);
  const ctx = {
    mode: settings.spectrumDbMode === "linear" ? "linear" : "exactDb",
    floorDb,
    // Ceiling at or below Floor is a 0.1 dB window rather than a divide by zero.
    spanDb: Math.max(0.1, ceilDb - floorDb),
  };
  const axis = nodeGraphFiniteNumber(settings.frequencyCurve, 1);
  const fullMag = (src) => Math.max(1e-9, nodeGraphFiniteNumber(src.windowSum, raw.length) / 2);
  const map = nodeGraphSpectrumLineColumnMap(w, raw.length, axis, lo, hi, nyquist);
  nodeGraphSpectrumLineSpectrumColumns(out, raw, fullMag(data), map, ctx);
  const low = data.low;
  if (low?.raw instanceof Float32Array && low.raw.length > raw.length && lo < NODE_GRAPH_SPECTRUM_LINE_BASS_HI_HZ) {
    const lowMap = nodeGraphSpectrumLineColumnMap(w, low.raw.length, axis, lo, hi, nyquist);
    const lowCols = nodeGraphSpectrumLineSpectrumColumns(nodeGraphSpectrumLineLowScratch(w), low.raw, fullMag(low), lowMap, ctx);
    for (let x = 0; x < w; x += 1) {
      const k = map.centerHz[x];
      const wb = nodeGraphSpectrumLineBassWeight(k);
      if (wb > 0) out[x] = out[x] * (1 - wb) + lowCols[x] * wb;
    }
  }
  return out;
}

let nodeGraphSpectrumLineScratchBuf = null;
function nodeGraphSpectrumLineScratch(n) {
  if (!nodeGraphSpectrumLineScratchBuf || nodeGraphSpectrumLineScratchBuf.length < n) {
    nodeGraphSpectrumLineScratchBuf = new Float32Array(n);
  }
  return nodeGraphSpectrumLineScratchBuf;
}

let nodeGraphSpectrumLineLowScratchBuf = null;
function nodeGraphSpectrumLineLowScratch(w) {
  if (!nodeGraphSpectrumLineLowScratchBuf || nodeGraphSpectrumLineLowScratchBuf.length !== w) {
    nodeGraphSpectrumLineLowScratchBuf = new Float32Array(w);
  }
  return nodeGraphSpectrumLineLowScratchBuf;
}

/**
 * Column -> clamped fractional bin span [lo[x], hi[x]] and centre Hz, cached
 * per (width, bins, axis, range, nyquist): the Hz mapping runs once per size or
 * axis change, not every frame. bins = FFT length / 2, so bin k sits at
 * k / bins x Nyquist (k x sampleRate / fftLength).
 */
const nodeGraphSpectrumLineColumnMaps = new Map();
function nodeGraphSpectrumLineColumnMap(w, bins, axis, loHz, hiHz, nyquist) {
  const key = `${w}|${bins}|${axis}|${loHz}|${hiHz}|${nyquist}`;
  let m = nodeGraphSpectrumLineColumnMaps.get(key);
  if (m) return m;
  const hzToBin = (hz) => (Math.max(0, hz) / nyquist) * bins;
  const lo = new Float64Array(w);
  const hi = new Float64Array(w);
  const centerHz = new Float64Array(w);
  let firstBin = bins - 1;
  let lastBin = 0;
  for (let x = 0; x < w; x += 1) {
    const ta = w > 1 ? (x - 0.5) / (w - 1) : 0;
    const tb = w > 1 ? (x + 0.5) / (w - 1) : 1;
    const ba = hzToBin(nodeGraphFrequencyCurveHz(ta, axis, loHz, hiHz));
    const bb = hzToBin(nodeGraphFrequencyCurveHz(tb, axis, loHz, hiHz));
    centerHz[x] = nodeGraphFrequencyCurveHz(w > 1 ? x / (w - 1) : 0, axis, loHz, hiHz);
    lo[x] = Math.max(0, Math.min(bins - 1, Math.min(ba, bb)));
    hi[x] = Math.max(0, Math.min(bins - 1, Math.max(ba, bb)));
    firstBin = Math.min(firstBin, Math.floor(lo[x]));
    lastBin = Math.max(lastBin, Math.min(bins - 1, Math.floor(hi[x]) + 1));
  }
  m = { lo, hi, centerHz, firstBin: Math.max(0, firstBin), lastBin };
  if (nodeGraphSpectrumLineColumnMaps.size > 16) nodeGraphSpectrumLineColumnMaps.clear();
  nodeGraphSpectrumLineColumnMaps.set(key, m);
  return m;
}

function nodeGraphSpectrumLineSettingsForNode(node) {
  const base = typeof normalizeNodeGraphSpectrumLineSettings === "function"
    ? normalizeNodeGraphSpectrumLineSettings(node?.traceDisplaySettings, node)
    : {};
  const p = node?.params && typeof node.params === "object" ? node.params : {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  // Freq and Level bands are module parameters (limits from the definition).
  return {
    ...base,
    minFreq: num(p.minFreq, 20),
    maxFreq: num(p.maxFreq, 20000),
    spectrumDbFloor: num(p.floorDb, -96),
    spectrumDbCeiling: num(p.ceilingDb, 0),
  };
}

function nodeGraphSpectrumLineHexToRgba(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Column heights (0..1) -> polyline points in device px (y down). */
function nodeGraphSpectrumLinePoints(cols, W, H) {
  const pts = new Array(cols.length * 2);
  for (let x = 0; x < cols.length; x += 1) {
    pts[x * 2] = cols.length > 1 ? (x / (cols.length - 1)) * W : 0;
    pts[x * 2 + 1] = H - Math.max(0, Math.min(1, cols[x])) * H;
  }
  return pts;
}

/** Time-based display smoothing, independent of peak hold and frame rate. */
function nodeGraphSpectrumLineSmoothColumns(st, target, milliseconds, dt) {
  if (!st.smoothed || st.smoothed.length !== target.length) {
    st.smoothed = Float32Array.from(target, value => Math.max(0, Math.min(1, value)));
    return milliseconds > 0 ? st.smoothed : target;
  }
  const mix = milliseconds > 0 ? -Math.expm1(-Math.max(0, dt) * 1000 / milliseconds) : 1;
  for (let i = 0; i < target.length; i += 1) {
    const value = Math.max(0, Math.min(1, target[i]));
    st.smoothed[i] += (value - st.smoothed[i]) * mix;
  }
  return milliseconds > 0 ? st.smoothed : target;
}

function nodeGraphSpectrumLineBarLayout(W, sourceCount, count, width, minBarPx = 1, minGapPx = 0) {
  if (!(width > 0) || W < 1 || !sourceCount) return null;
  const ratio = Math.min(1, width);
  const minBar = Math.max(1, Math.round(minBarPx));
  const minGap = ratio < 1 ? Math.max(0, Math.round(minGapPx)) : 0;
  const minSlot = Math.ceil(Math.max(minBar / ratio, minGap > 0 ? minGap / (1 - ratio) : 0, minBar + minGap));
  const n = Math.min(sourceCount, Math.max(1, Math.round(count)), Math.floor(W / minSlot));
  if (n < 1) return null;
  const slot = Math.floor(W / n);
  const barWidth = Math.max(minBar, Math.min(slot - minGap, Math.round(slot * ratio)));
  // Uniform integer widths/gaps; leave centered margins rather than distribute remainder pixels.
  const startX = Math.floor((W - (n - 1) * slot - barWidth) / 2);
  return { count: n, slot, barWidth, startX };
}

/** Shared GL rectangle batches; no connected outline across gaps. */
function nodeGraphSpectrumLineDrawBars(batch, cols, W, H, count, width, rgba, capHeight = 0, minBarPx = 1, minGapPx = 0) {
  const layout = nodeGraphSpectrumLineBarLayout(W, cols.length, count, width, minBarPx, minGapPx);
  if (!layout) return 0;
  const { count: n, slot, barWidth, startX } = layout;
  let drawn = 0;
  for (let i = 0; i < n; i += 1) {
    let level = 0;
    for (let x = Math.floor(i * cols.length / n); x < Math.ceil((i + 1) * cols.length / n); x += 1) {
      level = Math.max(level, cols[x]);
    }
    const rawHeight = Math.max(0, Math.min(1, level)) * H;
    const height = capHeight > 0 ? rawHeight : Math.round(rawHeight);
    if (!(height > 0)) continue;
    nodeGraphGlLinesRect(batch, startX + i * slot,
      H - height, barWidth, capHeight > 0 ? Math.min(capHeight, height) : height, rgba);
    drawn += 1;
  }
  return drawn;
}

/** Stateless bars use the current screen pixel grid; retained scope sizing is unchanged. */
function nodeGraphSpectrumLineSyncCanvas(canvas, screenElement, settings, pixelRatio) {
  if (settings.spectrumDrawStyle !== "bars") {
    delete canvas.dataset.pixelSnap;
    nodeGraphDisplayCanvasPixelated(canvas, false);
    return syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio, 1);
  }
  const rect = screenElement.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return false;
  const dev = nodeGraphPictureDevice();
  if (!dev?.canvas) return false;
  // Match the compositor, not monitor DPR. The graph raster can be 1x or capped
  // below 1x; a DPR-sized face gets resampled and loses whole-pixel gaps.
  const graph = typeof nodeGraphGlGraphState !== "undefined" ? nodeGraphGlGraphState : null;
  const picture = !graph?.view ? graph?.mesh?.pictures?.find(image => image.source === canvas) : null;
  const graphCanvas = graph?.canvas;
  const scale = graphCanvas?.clientWidth > 0 ? graphCanvas.width / graphCanvas.clientWidth : 1;
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const width = Math.max(1, Math.round((picture ? picture.w * zoom : rect.width) * scale));
  const height = Math.max(1, Math.round((picture ? picture.h * zoom : rect.height) * scale));
  const dpr = nodeGraphDisplayCanvasPixelRatio(2);
  const density = Math.min(1, dev.canvas.width / width, dev.canvas.height / height);
  const oldW = canvas.width, oldH = canvas.height;
  if (!nodeGraphDisplayCanvasSizeCss(canvas, width / dpr, height / dpr, density)) return false;
  nodeGraphDisplayCanvasPixelated(canvas, true);
  canvas.dataset.pixelSnap = "1";
  if ((canvas.width !== oldW || canvas.height !== oldH) && typeof nodeGraphGlGraphNoteFaceCanvasSized === "function") {
    nodeGraphGlGraphNoteFaceCanvasSized();
  }
  return true;
}

/** Keep held peaks while the adaptive screen grid changes resolution. */
function nodeGraphSpectrumLineResizeState(st, width) {
  if (!st) return { peak: new Float32Array(width), holdUntil: new Float64Array(width), lastMs: 0 };
  if (st.peak.length === width) return st;
  const resize = (values) => {
    if (!values) return null;
    const out = new values.constructor(width);
    for (let i = 0; i < width; i += 1) {
      let value = 0;
      for (let x = Math.floor(i * values.length / width); x < Math.ceil((i + 1) * values.length / width); x += 1) {
        value = Math.max(value, values[x]);
      }
      out[i] = value;
    }
    return out;
  };
  st.peak = resize(st.peak);
  st.holdUntil = resize(st.holdUntil);
  st.smoothed = resize(st.smoothed);
  return st;
}

function nodeGraphSpectrumLineUpdatePeaks(st, cols, mode, now, dt, decayPerSecond) {
  for (let x = 0; x < cols.length; x += 1) {
    const level = Math.min(1, cols[x]);
    if (level >= st.peak[x]) {
      st.peak[x] = level;
      st.holdUntil[x] = now + (mode === "hold" ? NODE_GRAPH_SPECTRUM_LINE_PEAK_HOLD_SECONDS * 1000 : 0);
    } else if (mode === "fall" || now > st.holdUntil[x]) {
      st.peak[x] = Math.max(cols[x], st.peak[x] - decayPerSecond * dt);
    }
  }
}

/**
 * Over-range cue: a bright cap along the top edge wherever the spectrum is
 * louder than Ceiling, so a level past the view reads as "above the window",
 * not as a flat clipped plateau.
 */
function nodeGraphSpectrumLineDrawOverRange(batch, cols, W, capPx) {
  const scale = cols.length > 1 ? W / cols.length : W;
  let start = -1;
  for (let x = 0; x <= cols.length; x += 1) {
    const over = x < cols.length && cols[x] > 1;
    if (over && start < 0) start = x;
    if (!over && start >= 0) {
      nodeGraphGlLinesRect(batch, Math.floor(start * scale), 0, Math.max(1, Math.ceil((x - start) * scale)), capPx, [1, 1, 1, 0.9]);
      start = -1;
    }
  }
}

function drawNodeGraphSpectrumLineItem(renderer, item, pixelRatio) {
  const nodeId = String(item?.slot?.nodeId || "");
  if (!nodeId) return;
  const canvas = nodeGraphModuleScopeLocalFallbackCanvas(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  if (!canvas || !screenElement) return;
  const node = nodeGraphPatchNode(nodeId);
  const settings = nodeGraphSpectrumLineSettingsForNode(node);
  if (!nodeGraphSpectrumLineSyncCanvas(canvas, screenElement, settings, pixelRatio)) return;
  canvas.style.mixBlendMode = "normal";
  canvas.classList.add("node-spectrum-line-canvas");
  const W = canvas.width | 0;
  const H = canvas.height | 0;
  if (W < 1 || H < 1) return;

  // Offscreen / culled module: no work (wakes and repaints on the next frame).
  if (typeof nodeGraphModuleIsViewportAsleep === "function"
    && nodeGraphModuleIsViewportAsleep(screenElement.closest?.(".dsp-node") || nodeId)) return;
  const bg = settings.backgroundColor || "#05070a";
  const ink = settings.dot1Color || "#4fd1ff";
  if (typeof nodeGraphFacePlateApplyCss === "function") {
    nodeGraphFacePlateApplyCss(screenElement, bg);
  }

  const meta = nodeGraphSpectrumLineBusGet(nodeId, "FftSize");
  const gain = nodeGraphSpectrumLineBusGet(nodeId, "SpectrumGain");
  const lowMeta = settings.spectrumBassDetail === "on" ? nodeGraphSpectrumLineBusGet(nodeId, "SpectrumLowMeta") : null;
  const lowRaw = lowMeta instanceof Float32Array ? nodeGraphSpectrumLineBusGet(nodeId, "SpectrumLowRaw") : null;
  const data = {
    raw: nodeGraphSpectrumLineBusGet(nodeId, "SpectrumRaw"),
    sampleRate: meta instanceof Float32Array && meta.length >= 5
      ? meta[4]
      : nodeGraphFiniteNumber(nodeGraphModuleScopeState?.sampleRate, 44100),
    windowSum: gain instanceof Float32Array ? gain[0] : undefined,
    // Only a long-window spectrum that matches the current FFT size counts.
    low: lowRaw instanceof Float32Array && lowMeta[0] > (meta instanceof Float32Array ? meta[0] : 0)
      ? { raw: lowRaw, windowSum: lowMeta[1] }
      : null,
  };

  // Nothing new since the last paint (same FFT hop, size, settings): the face
  // canvas keeps its pixels, so skip the GL frame. Peak hold animates -> always.
  const hopSerial = meta instanceof Float32Array && meta.length >= 6 ? meta[5] : -1;
  const frozen = typeof nodeGraphModuleScopePhosphorFrozen === "function" && nodeGraphModuleScopePhosphorFrozen();
  const smoothing = Math.max(0, nodeGraphFiniteNumber(settings.spectrumSmoothMs));
  const peakMode = settings.spectrumPeakHold;
  const sig = `${hopSerial}|${W}x${H}|${bg}|${ink}|${settings.frequencyCurve}|${settings.spectrumDbMode}|${settings.spectrumDbFloor}|${settings.spectrumDbCeiling}|${settings.spectrumDrawStyle}|${settings.spectrumSmoothMs}|${settings.spectrumBarCount}|${settings.spectrumBarWidth}|${settings.spectrumMinBarPx}|${settings.spectrumMinGapPx}|${settings.spectrumPeakHold}|${settings.spectrumPeakDecay}|${settings.spectrumBassDetail}|${settings.minFreq}|${settings.maxFreq}|${pixelRatio}`;
  if (hopSerial >= 0 && peakMode !== "hold" && peakMode !== "fall" && !(smoothing > 0 && !frozen) && canvas._spectrumLineSig === sig) return;
  canvas._spectrumLineSig = sig;

  // Device px (face canvas backing), WebGL2 only; no GL -> black.
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, nodeGraphGlLinesCss(bg))
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const inkRgba = nodeGraphGlLinesCss(ink);
  const inkA = (a) => [inkRgba[0], inkRgba[1], inkRgba[2], a];

  const cols = nodeGraphSpectrumLineComputeColumns(W, data, settings);
  const st = nodeGraphSpectrumLineResizeState(nodeGraphSpectrumLineStates.get(nodeId), W);
  nodeGraphSpectrumLineStates.set(nodeId, st);
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = !frozen && st.lastMs ? Math.max(0, (now - st.lastMs) / 1000) : 0;
  const dt = Math.min(0.25, elapsed);
  st.lastMs = now;
  const mapping = `${settings.frequencyCurve}|${settings.minFreq}|${settings.maxFreq}|${settings.fftSize}|${settings.spectrumDbMode}|${settings.spectrumDbFloor}|${settings.spectrumDbCeiling}`;
  if (st.smoothMapping !== mapping) { st.smoothed = null; st.smoothMapping = mapping; }
  const liveCols = nodeGraphSpectrumLineSmoothColumns(st, cols, smoothing, elapsed);

  const lineW = Math.max(1, 1.25 * (Number(pixelRatio) || 1));
  const bars = settings.spectrumDrawStyle === "bars";
  if (bars) {
    nodeGraphSpectrumLineDrawBars(batch, liveCols, W, H, settings.spectrumBarCount, settings.spectrumBarWidth, inkRgba, 0, settings.spectrumMinBarPx, settings.spectrumMinGapPx);
  } else {
    const pts = nodeGraphSpectrumLinePoints(liveCols, W, H);
    if (settings.spectrumDrawStyle !== "line") nodeGraphGlLinesFillUnder(batch, pts, H, inkA(0.35));
    nodeGraphGlLinesPolyline(batch, pts, Math.max(0, lineW * 0.5 - 0.35), 0.7, inkRgba);
  }
  nodeGraphSpectrumLineDrawOverRange(batch, cols, W, Math.max(2, Math.round(lineW * 1.6)));

  if (peakMode === "hold" || peakMode === "fall") {
    // Peak decay is dB/s; in Linear the top-to-bottom span counts as 96 dB.
    const span = settings.spectrumDbMode === "linear"
      ? 96
      : Math.max(0.1, settings.spectrumDbCeiling - settings.spectrumDbFloor);
    nodeGraphSpectrumLineUpdatePeaks(st, cols, peakMode, now, dt, nodeGraphFiniteNumber(settings.spectrumPeakDecay, 12) / span);
    if (bars) {
      nodeGraphSpectrumLineDrawBars(batch, st.peak, W, H, settings.spectrumBarCount, settings.spectrumBarWidth, inkA(0.6), lineW, settings.spectrumMinBarPx, settings.spectrumMinGapPx);
    } else {
      nodeGraphGlLinesPolyline(batch, nodeGraphSpectrumLinePoints(st.peak, W, H), Math.max(0, Math.max(1, lineW * 0.8) * 0.5 - 0.35), 0.7, inkA(0.6));
    }
  } else {
    st.peak.fill(0);
  }
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers !== "undefined") {
  nodeGraphModuleScopeCustomRenderers.spectrumLine = drawNodeGraphSpectrumLineItem;
}
