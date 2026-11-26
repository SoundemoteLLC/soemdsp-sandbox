// Spectrum Circle: FFT of audio In, drawn as a mirrored ring of rays that start
// at the centre (video-feedback-gl.js). Display Settings own the analyzer
// (FFT size, window, dB floor and ceiling, bands; the FFT itself is the
// shared worklet analysis of input A) and the gradient; Min / Max Freq,
// Curve, Decay / Size / Inner / Twist / Bright / Smooth are face params, read
// through their parameter definitions (no limits here).

function nodeGraphVideoFeedbackPortLabel(_node, port) {
  const key = String(port || "");
  if (key === "rgba" || key === "\u{1F4FA}") return "\u{1F4FA}";
  if (key === "A") return "→";
  if (key === "Thru") return "←";
  if (key === "B") return "Spin";
  return key;
}

const NODE_GRAPH_VIDEO_FEEDBACK_DEFAULTS = Object.freeze({
  fftSize: 2048,
  window: 1,
  spectrumDbFloor: -72,
  spectrumDbCeiling: 0,
  spectrumCircleBands: 64,
  spectrumCircleRayWidth: 0.6,
  spectrumCircleColorLevel: "on",
  spectrumCircleColorRadius: "off",
  spectrumCircleSymmetric: "on",
  spectrumCircleReverse: "off", // Default: falling pitch travels from top to bottom.
});

// Choice values come from the shared Display Settings choice table (one list).
function nodeGraphVideoFeedbackChoice(key, raw, fallback) {
  const options = typeof nodeGraphDisplaySettingsChoiceMeta === "object"
    ? nodeGraphDisplaySettingsChoiceMeta?.[key]?.options
    : null;
  const want = String(raw ?? "");
  return Array.isArray(options) && options.some((option) => option.value === want) ? want : String(fallback);
}

function normalizeNodeGraphVideoFeedbackSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const d = NODE_GRAPH_VIDEO_FEEDBACK_DEFAULTS;
  // Patches from before the gradient kept one ink color: black to that ink.
  const legacyInk = source.gradientStops == null
    ? (source.dot1Color || source.spectrumColor || source.color)
    : null;
  const gradientStops = normalizeNodeGraphSpectrogramGradientStops(
    legacyInk ? [{ t: 0, color: "#000000" }, { t: 1, color: legacyInk }] : source.gradientStops,
  );
  const hue = Number(source.backgroundHue);
  const floor = source.spectrumDbFloor == null ? d.spectrumDbFloor : Number(source.spectrumDbFloor);
  const ceiling = source.spectrumDbCeiling == null ? d.spectrumDbCeiling : Number(source.spectrumDbCeiling);
  const width = source.spectrumCircleRayWidth == null ? d.spectrumCircleRayWidth : Number(source.spectrumCircleRayWidth);
  const legacyRadius = source.spectrumCircleColorBy === "radius";
  return {
    fftSize: source.fftSize == null ? d.fftSize : nodeGraphSpectrogramSnapFftSize(source.fftSize),
    window: Number(nodeGraphVideoFeedbackChoice("window", source.window, d.window)),
    spectrumDbFloor: Number.isFinite(floor) ? Math.max(-180, Math.min(48, floor)) : d.spectrumDbFloor,
    spectrumDbCeiling: Number.isFinite(ceiling) ? Math.max(-180, Math.min(48, ceiling)) : d.spectrumDbCeiling,
    spectrumCircleBands: Number(nodeGraphVideoFeedbackChoice("spectrumCircleBands", source.spectrumCircleBands, d.spectrumCircleBands)),
    spectrumCircleRayWidth: Number.isFinite(width) ? Math.max(0, Math.min(1, width)) : d.spectrumCircleRayWidth,
    spectrumCircleColorLevel: nodeGraphVideoFeedbackChoice("spectrumCircleColorLevel", source.spectrumCircleColorLevel, legacyRadius ? "off" : d.spectrumCircleColorLevel),
    spectrumCircleColorRadius: nodeGraphVideoFeedbackChoice("spectrumCircleColorRadius", source.spectrumCircleColorRadius, legacyRadius ? "on" : d.spectrumCircleColorRadius),
    spectrumCircleSymmetric: nodeGraphVideoFeedbackChoice("spectrumCircleSymmetric", source.spectrumCircleSymmetric, d.spectrumCircleSymmetric),
    spectrumCircleReverse: nodeGraphVideoFeedbackChoice("spectrumCircleReverse", source.spectrumCircleReverse, d.spectrumCircleReverse),
    gradientStops,
    backgroundHue: Number.isFinite(hue) ? hue : 0,
  };
}

// Normalized once per stored settings object (apply replaces the object).
const nodeGraphVideoFeedbackSettingsCache = new WeakMap();
let nodeGraphVideoFeedbackDefaultSettings = null;

function nodeGraphVideoFeedbackSettingsForNode(node) {
  const stored = node?.traceDisplaySettings;
  if (!stored || typeof stored !== "object") {
    nodeGraphVideoFeedbackDefaultSettings ||= normalizeNodeGraphVideoFeedbackSettings();
    return nodeGraphVideoFeedbackDefaultSettings;
  }
  let hit = nodeGraphVideoFeedbackSettingsCache.get(stored);
  if (!hit) {
    hit = normalizeNodeGraphVideoFeedbackSettings(stored);
    nodeGraphVideoFeedbackSettingsCache.set(stored, hit);
  }
  return hit;
}

// Gradient LUT (hue rotation applied) per normalized settings object.
const nodeGraphVideoFeedbackLutCache = new WeakMap();

function nodeGraphVideoFeedbackLutRgb(settings) {
  let lut = nodeGraphVideoFeedbackLutCache.get(settings);
  if (!lut) {
    lut = spectrogramLutRgbForStops(nodeGraphApplyGradientHueRotation(settings.gradientStops, settings));
    nodeGraphVideoFeedbackLutCache.set(settings, lut);
  }
  return lut;
}

function buildNodeGraphVideoFeedbackDisplaySettingsBodyHtml() {
  const type = "videoFeedbackFace";
  return `
    <div class="metadata-field-section" data-video-feedback-display-settings-panel>
      <div class="metadata-section-title">SPECTRUM</div>
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("fftSize")}
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("window")}
      ${nodeGraphDisplaySettingsBuildStepperRowHtml("spectrumDbFloor", type)}
      ${nodeGraphDisplaySettingsBuildStepperRowHtml("spectrumDbCeiling", type)}
      ${nodeGraphDisplaySettingsBuildChoiceRowHtml("spectrumCircleBands")}
      ${nodeGraphDisplaySettingsBuildStepperRowHtml("spectrumCircleRayWidth", type)}
      ${nodeGraphDisplaySettingsBuildSwitchRowHtml("spectrumCircleSymmetric")}
      ${nodeGraphDisplaySettingsBuildSwitchRowHtml("spectrumCircleReverse")}
      ${nodeGraphDisplaySettingsBuildSwitchRowHtml("spectrumCircleColorLevel")}
      ${nodeGraphDisplaySettingsBuildSwitchRowHtml("spectrumCircleColorRadius")}
    </div>
    <div class="metadata-field-section node-trace-display-gradient-section">
      <div
        id="nodeTraceDisplayGradientSelectorHost"
        class="node-gradient-selector-host node-shared-gradient-host node-spectrogram-gradient-host"
        data-gradient-selector-host
        data-shared-gradient-host
        data-spectrogram-gradient-host></div>
    </div>
  `;
}

/** Slot position u (0..1) → Hz through the shared Curve and the Freq params. */
function nodeGraphVideoFeedbackSlotHz(u, view, sampleRate) {
  const band = spectrogramResolveViewBand(view.minFreq, view.maxFreq, sampleRate);
  return nodeGraphFrequencyCurveHz(u, view.frequencyCurve, band.minFreq, band.maxFreq);
}

/**
 * One level 0..1 per slot (band, or texel when Continuous) from the shared
 * worklet analysis of input A (SpectrumRaw / SpectrumGain / FftSize, the same
 * core as 1D Spectrum). Smooth steps only when a new analysis arrives.
 * view: { minFreq, maxFreq, frequencyCurve } from the module parameters.
 */
function nodeGraphVideoFeedbackSpectrumLevels(canvas, nodeId, settings, view, smooth) {
  const bus = (port) => {
    if (typeof nodeGraphDataBus === "undefined") return null;
    const v = nodeGraphDataBus.get(nodeGraphDataBusKey(nodeId, port));
    return v instanceof Float32Array ? v : null;
  };
  const raw = bus("SpectrumRaw");
  const gain = bus("SpectrumGain");
  const meta = bus("FftSize");
  const count = settings.spectrumCircleBands > 0 ? settings.spectrumCircleBands : NODE_GRAPH_VIDEO_FEEDBACK_WAVE;
  let st = canvas._videoFeedbackSpectrum;
  if (!st) {
    st = canvas._videoFeedbackSpectrum = {
      smooth: new Float32Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE),
      layoutKey: "",
      serial: -1,
      lo: new Int32Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE),
      hi: new Int32Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE),
      center: new Float32Array(NODE_GRAPH_VIDEO_FEEDBACK_WAVE),
    };
  }
  const serial = meta && meta.length >= 6 ? meta[5] : -1;
  if (!raw || !(raw.length > 1) || serial === st.serial) return { values: st.smooth, count };
  st.serial = serial;
  const bins = raw.length;
  const fftLen = meta[0] > 0 ? meta[0] : bins * 2;
  const sampleRate = meta[4] > 0 ? meta[4] : (nodeGraphMvp?.sampleRate || 44100);
  const fullMag = Math.max(1e-9, (gain ? gain[0] : bins) / 2);
  const layoutKey = `${count}|${view.frequencyCurve}|${view.minFreq}|${view.maxFreq}|${sampleRate}|${bins}|${fftLen}`;
  if (st.layoutKey !== layoutKey) {
    const binHz = sampleRate / fftLen;
    for (let j = 0; j < count; j += 1) {
      const f0 = nodeGraphVideoFeedbackSlotHz(j / count, view, sampleRate) / binHz;
      const f1 = nodeGraphVideoFeedbackSlotHz((j + 1) / count, view, sampleRate) / binHz;
      st.center[j] = Math.min(bins - 1, nodeGraphVideoFeedbackSlotHz((j + 0.5) / count, view, sampleRate) / binHz);
      st.lo[j] = Math.max(0, Math.min(bins - 1, Math.ceil(f0)));
      st.hi[j] = Math.max(0, Math.min(bins - 1, Math.floor(f1)));
    }
    st.layoutKey = layoutKey;
  }
  const floor = settings.spectrumDbFloor;
  const span = Math.max(0.1, settings.spectrumDbCeiling - floor);
  const attack = 1 - 0.97 * smooth;
  for (let j = 0; j < count; j += 1) {
    let mag;
    if (st.hi[j] > st.lo[j]) {
      // Wide slot: peak of its bins, so a pure tone keeps its full height.
      mag = 0;
      for (let k = st.lo[j]; k <= st.hi[j]; k += 1) mag = Math.max(mag, raw[k]);
    } else {
      const c = st.center[j];
      const k0 = Math.floor(c);
      const k1 = Math.min(bins - 1, k0 + 1);
      mag = raw[k0] + (raw[k1] - raw[k0]) * (c - k0);
    }
    const db = 20 * Math.log10(Math.max(0, mag) / fullMag + 1e-12);
    const v = Math.max(0, Math.min(1, (db - floor) / span));
    st.smooth[j] += (v - st.smooth[j]) * attack;
  }
  return { values: st.smooth, count };
}

function nodeGraphVideoFeedbackEnsureCanvas(face) {
  if (!face) return null;
  for (const leftover of face.querySelectorAll(":scope > .node-module-scope-local-fallback-canvas")) {
    leftover.remove();
  }
  let canvas = face.querySelector(":scope > .node-video-feedback-canvas");
  if (!canvas) {
    canvas = nodeGraphDisplayCanvasCreate("node-video-feedback-canvas");
    canvas.setAttribute("aria-hidden", "true");
    face.appendChild(canvas);
  }
  // Shared sizing (layout css x dpr, never zoom); backing stays >= 8 px.
  if (typeof nodeGraphDisplayCanvasSize === "function") {
    const m = nodeGraphDisplayCanvasSize(face, canvas);
    if (m && (m.width < 8 || m.height < 8) && typeof nodeGraphDisplayCanvasSizeCss === "function") {
      nodeGraphDisplayCanvasSizeCss(canvas, Math.max(8, m.width) / m.pixelRatio, Math.max(8, m.height) / m.pixelRatio, 1);
    }
  }
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.zIndex = "5";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  return canvas;
}

function nodeGraphVideoFeedbackCircuitLive() {
  // While Viewport In / Out are in the patch the circuit view is the picture being worked on, so a screen effect keeps working with the
  // engine stopped (it would otherwise sit on a wiped black frame and the screen would go black).
  if (typeof nodeGraphScreenFxState === "object" && nodeGraphScreenFxState?.active) return true;
  try {
    if (typeof nodeGraphModuleScopeEnginePaused === "function" && nodeGraphModuleScopeEnginePaused()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  try {
    if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  try {
    if (typeof nodeGraphModuleScopePhosphorFrozen === "function" && nodeGraphModuleScopePhosphorFrozen()) {
      return false;
    }
  } catch (_e) { /* fall through */ }
  return true;
}

function drawNodeGraphVideoFeedbackFaceItem(_renderer, item) {
  const slot = item?.slot;
  const face = item?.screenElement || slot?.scopeElement;
  if (!slot || !face) return;
  // The face pump owns the clock: one FFT + one plate step per video frame.
  if (face._videoFeedbackOwnsClock && item?.fromFaceLoop !== true && item?.force !== true) {
    return;
  }
  const canvas = nodeGraphVideoFeedbackEnsureCanvas(face);
  if (!canvas) return;
  // Present surface for the shared-GL blit (display-canvas.js); no 2D drawing here.
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function" ? nodeGraphSharedGlPresentTarget(canvas) : null;
  if (!ctx) return;
  if (typeof nodeGraphVideoFeedbackGlEnsure !== "function") {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const host = canvas;
  const renderer = nodeGraphVideoFeedbackGlEnsure(host, canvas.width, canvas.height);
  if (!renderer) {
    nodeGraphGlLinesFillBlack(canvas);
    return;
  }
  const nodeId = slot.nodeId;
  if (nodeGraphVideoFeedbackCircuitLive()) {
    const node = typeof nodeGraphModuleScopeNodeForSlot === "function"
      ? nodeGraphModuleScopeNodeForSlot(slot)
      : nodeGraphPatchNode(nodeId);
    const settings = nodeGraphVideoFeedbackSettingsForNode(node);
    // Knob + this frame's MOD cables, bounded by the parameter definitions (node-graph-picture-params.js).
    const param = (key) => (typeof nodeGraphPictureParam === "function" ? nodeGraphPictureParam(nodeId, key) : nodeGraphReadNodeNumber(nodeId, key));
    const smooth = param("smooth");
    // VG-6: block mode for the spectrum (A), control mode for spin (B).
    const view = { minFreq: param("minFreq"), maxFreq: param("maxFreq"), frequencyCurve: param("frequencyCurve") };
    const levels = nodeGraphVideoFeedbackSpectrumLevels(canvas, nodeId, settings, view, smooth);
    nodeGraphVideoFeedbackGlStep(host, {
      nodeId,
      decay: param("decay"),
      size: param("size"),
      inner: param("zoom"),
      twist: param("twist"),
      spin: nodeGraphVideoGraphAudioLatest(nodeId, "B"),
      bright: param("bright"),
      smooth,
      levels: levels.values,
      count: levels.count,
      bands: settings.spectrumCircleBands,
      rayWidth: settings.spectrumCircleRayWidth,
      colorByLevel: settings.spectrumCircleColorLevel === "on",
      colorByRadius: settings.spectrumCircleColorRadius === "on",
      symmetric: settings.spectrumCircleSymmetric === "on",
      reverseFrequency: settings.spectrumCircleReverse === "on",
      lutRgb: nodeGraphVideoFeedbackLutRgb(settings),
    });
  }
  nodeGraphVideoFeedbackGlPresent(host, ctx, canvas.width, canvas.height);
  if (typeof nodeGraphModuleScopeMarkScreenLit === "function") {
    nodeGraphModuleScopeMarkScreenLit(face, 1);
  }
}

function wipeNodeGraphVideoFeedbackScreensToColdBoot(canvas) {
  const host = canvas || null;
  if (host && typeof nodeGraphVideoFeedbackGlWipe === "function") {
    nodeGraphVideoFeedbackGlWipe(host);
  }
  if (canvas && typeof nodeGraphGlLinesFillBlack === "function") {
    nodeGraphGlLinesFillBlack(canvas);
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.videoFeedbackFace = drawNodeGraphVideoFeedbackFaceItem;
}
if (typeof nodeGraphModuleScopeRegisterFaceWipe === "function") {
  nodeGraphModuleScopeRegisterFaceWipe("videoFeedbackFace", (canvas) => {
    wipeNodeGraphVideoFeedbackScreensToColdBoot(canvas);
  });
}
