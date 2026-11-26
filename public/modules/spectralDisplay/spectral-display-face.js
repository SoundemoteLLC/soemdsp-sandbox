// Spectral processor faces (displayType "spectralStyle"): Vocoder, STFT Gate,
// STFT Contrast, Spectral Blur, Freeze, Delay, Warp, Cross Synthesis.
// Data: spectral-display-worklet.js (SpectralHz / SpectralA / ... / SpectralMeta).
// Drawing: the shared style renderer (public/lib/spectral-display-styles.js).
// Display Settings own the look (style, Floor / Ceiling, bars, peaks,
// particles, history, gain span, gradient); the module's Curve parameter owns
// the frequency spacing. Moves only when new data arrives. WebGL only.

// Per module: allowed styles (first is the spawn default) and display defaults.
const NODE_GRAPH_SPECTRAL_FACE_MODULES = Object.freeze({
  vocoder: Object.freeze({ styles: ["bars", "curve", "mirrorBars", "particles", "miniWaterfall"], floorDb: -72, ceilingDb: 0 }),
  stftGate: Object.freeze({ styles: ["bandGain", "bars", "overlay", "curve"], floorDb: -110, ceilingDb: -10, boostDb: 0, rangeDb: 60 }),
  stftContrast: Object.freeze({ styles: ["bandGain", "bars", "overlay", "curve"], floorDb: -110, ceilingDb: -10, boostDb: 18, rangeDb: 24 }),
  spectralBlur: Object.freeze({ styles: ["particles", "curve", "mirrorBars", "bars", "overlay", "miniWaterfall"], floorDb: -90, ceilingDb: 0 }),
  spectralFreeze: Object.freeze({ styles: ["overlay", "curve", "miniWaterfall", "bars"], floorDb: -90, ceilingDb: 0 }),
  spectralDelay: Object.freeze({ styles: ["miniWaterfall", "curve", "overlay", "bars"], floorDb: -84, ceilingDb: 0 }),
  spectralWarp: Object.freeze({ styles: ["overlay", "curve", "mirrorBars", "bars"], floorDb: -90, ceilingDb: 0 }),
  spectralCrossSynthesis: Object.freeze({ styles: ["overlay", "mirrorBars", "curve", "bars"], floorDb: -90, ceilingDb: 0 }),
});

const NODE_GRAPH_SPECTRAL_FACE_DEFAULTS = Object.freeze({
  spectralBarCount: 48,
  spectralPeakHold: "hold",
  spectralPeakDecay: 24,
  spectralParticles: 1200,
  spectralHistory: 40,
});

function nodeGraphSpectralFaceModule(node) {
  return NODE_GRAPH_SPECTRAL_FACE_MODULES[String(node?.type || "")] || NODE_GRAPH_SPECTRAL_FACE_MODULES.spectralBlur;
}

/** Display Settings for a spectral style face. Limits mirror the field specs. */
function normalizeNodeGraphSpectralStyleSettings(settings = {}, node = null) {
  const source = settings && typeof settings === "object" ? settings : {};
  const mod = nodeGraphSpectralFaceModule(node);
  const d = NODE_GRAPH_SPECTRAL_FACE_DEFAULTS;
  const num = (v, fallback, min, max, integer = false) => normalizeNodeGraphTraceDisplayNumber(v, fallback, min, max, integer);
  const style = mod.styles.includes(String(source.spectralStyle)) ? String(source.spectralStyle) : mod.styles[0];
  const floor = num(source.spectralFloorDb, mod.floorDb, -200, 48);
  const ceiling = num(source.spectralCeilingDb, mod.ceilingDb, -200, 48);
  const gradientStops = typeof normalizeNodeGraphSharedGradientStops === "function"
    ? normalizeNodeGraphSharedGradientStops(source.gradientStops, (typeof SPECTRAL_COLD_FIRE_GRADIENT_STOPS !== "undefined" && SPECTRAL_COLD_FIRE_GRADIENT_STOPS) || nodeGraphSpectrogramSettingsDefaults.gradientStops)
    : source.gradientStops;
  return {
    spectralStyle: style,
    spectralFloorDb: floor,
    spectralCeilingDb: ceiling,
    spectralBarCount: num(source.spectralBarCount, d.spectralBarCount, 4, 256, true),
    spectralPeakHold: ["off", "hold", "fall"].includes(String(source.spectralPeakHold)) ? String(source.spectralPeakHold) : d.spectralPeakHold,
    spectralPeakDecay: num(source.spectralPeakDecay, d.spectralPeakDecay, 0.1, 1000),
    spectralParticles: num(source.spectralParticles, d.spectralParticles, 50, 5000, true),
    spectralHistory: num(source.spectralHistory, d.spectralHistory, 8, 96, true),
    spectralGainRangeDb: num(source.spectralGainRangeDb, mod.rangeDb ?? 60, 1, 160),
    spectralGainBoostDb: num(source.spectralGainBoostDb, mod.boostDb ?? 0, 0, 48),
    gradientStops,
    backgroundHue: Number.isFinite(Number(source.backgroundHue)) ? Number(source.backgroundHue) : 0,
  };
}

/** Style choices for the Display Settings menu: only styles this module has data for. */
function nodeGraphSpectralStyleOptionsForNode(node) {
  const allowed = nodeGraphSpectralFaceModule(node).styles;
  return NODE_GRAPH_SPECTRAL_STYLES.filter((s) => allowed.includes(s.value));
}

const nodeGraphSpectralFaceStates = new Map();

function nodeGraphSpectralFaceBus(nodeId, port) {
  if (typeof nodeGraphDataBus === "undefined" || typeof nodeGraphDataBusKey !== "function") return null;
  const v = nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, port));
  return v instanceof Float32Array ? v : null;
}

function drawNodeGraphSpectralStyleItem(renderer, item, pixelRatio) {
  const nodeId = String(item?.slot?.nodeId || "");
  if (!nodeId) return;
  const canvas = nodeGraphModuleScopeLocalFallbackCanvas(item?.slot);
  const screenElement = item?.screenElement || item?.slot?.scopeElement;
  if (!canvas || !screenElement) return;
  if (!syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screenElement, pixelRatio, 1)) return;
  canvas.style.mixBlendMode = "normal";
  const W = canvas.width | 0;
  const H = canvas.height | 0;
  if (W < 1 || H < 1) return;
  if (typeof nodeGraphModuleIsViewportAsleep === "function"
    && nodeGraphModuleIsViewportAsleep(screenElement.closest?.(".dsp-node") || nodeId)) return;

  const node = nodeGraphPatchNode(nodeId);
  const settings = normalizeNodeGraphSpectralStyleSettings(node?.traceDisplaySettings, node);
  const stops = typeof nodeGraphApplyGradientHueRotation === "function"
    ? nodeGraphApplyGradientHueRotation(settings.gradientStops, settings)
    : settings.gradientStops;
  const lut = spectrogramLutRgbForStops(stops);
  const plate = spectrogramCssAtBrightness(lut, 0);
  if (typeof nodeGraphFacePlateApplyCss === "function") nodeGraphFacePlateApplyCss(screenElement, plate);

  const meta = nodeGraphSpectralFaceBus(nodeId, "SpectralMeta");
  const data = {
    hz: nodeGraphSpectralFaceBus(nodeId, "SpectralHz"),
    a: nodeGraphSpectralFaceBus(nodeId, "SpectralA"),
    b: nodeGraphSpectralFaceBus(nodeId, "SpectralB"),
    c: nodeGraphSpectralFaceBus(nodeId, "SpectralC"),
    gain: nodeGraphSpectralFaceBus(nodeId, "SpectralGain"),
    hz2: nodeGraphSpectralFaceBus(nodeId, "SpectralHz2"),
    a2: nodeGraphSpectralFaceBus(nodeId, "SpectralA2"),
    weight: meta ? meta[1] : 0,
    serial: meta ? meta[0] : 0,
  };
  // A finished Bands crossfade must not keep drawing the old incoming bank.
  if (!(data.weight > 0)) { data.hz2 = null; data.a2 = null; }
  const curve = Math.max(0, Math.min(1, nodeGraphFiniteNumber(node?.params?.frequencyCurve, 1)));
  const sampleRate = nodeGraphFiniteNumber(nodeGraphModuleScopeState?.sampleRate, 48000);
  const lo = 20;
  const hi = Math.max(lo + 1, Math.min(20000, sampleRate / 2));
  // Nothing new and nothing changed: the face keeps its pixels.
  const sig = `${data.serial}|${W}x${H}|${curve}|${JSON.stringify(settings)}`;
  if (canvas._spectralSig === sig) return;
  canvas._spectralSig = sig;

  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, nodeGraphGlLinesCss(plate))
    : null;
  if (!batch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  let state = nodeGraphSpectralFaceStates.get(nodeId);
  if (!state) {
    state = {};
    nodeGraphSpectralFaceStates.set(nodeId, state);
  }
  if (data.hz && data.a) {
    nodeGraphSpectralDraw(batch, { W, H, lo, hi, curve }, data, { ...settings, lut }, state);
  }
  if (!nodeGraphGlLinesEnd(batch) && typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
}

if (typeof nodeGraphModuleScopeCustomRenderers !== "undefined") {
  nodeGraphModuleScopeCustomRenderers.spectralStyle = drawNodeGraphSpectralStyleItem;
}
