"use strict";
const nodeGraphConvolutionDisplayScript = typeof document === "undefined" ? "" : document.currentScript?.src || "";
const nodeGraphConvolutionProbeState = { worker: null, busy: null, nextId: 0, nextFace: 0, pending: new Map(), cache: new Map(), fatal: "" };
const nodeGraphConvolutionProbeDefaults = Object.freeze({
  frequency: 110, bodySize: 4, body: 0, bodyDecay: 0.08,
  crunch: 0.25, response: 0, bandwidth: 0, formantShift: 0,
});

// Only an active authored knob drag overrides patch state, never wired pitch,
// input buffers or live MOD/ghost values.
function nodeGraphConvolutionAuthoredValue(node, key, fallback) {
  const drag = typeof nodeGraphMvp === "undefined" ? null : nodeGraphMvp.sliderDragging;
  if (drag?.slider?.dataset?.node === String(node?.id) && drag.slider.dataset.param === key) {
    const value = Number(drag.slider.dataset.domainValue);
    if (Number.isFinite(value)) return value;
  }
  return node?.params?.[key] ?? fallback;
}
function nodeGraphConvolutionProbeParameters(node, sampleRate) {
  const params = { sampleRate };
  for (const [key, fallback] of Object.entries(nodeGraphConvolutionProbeDefaults)) {
    const raw = nodeGraphConvolutionAuthoredValue(node, key, fallback);
    const value = raw !== "" && raw != null ? Number(raw) : NaN;
    params[key] = Number.isFinite(value) ? value : fallback;
  }
  return params;
}
function nodeGraphConvolutionComparisonView(node) {
  const raw = nodeGraphConvolutionAuthoredValue(node, "vocoderModel", 0);
  const parameter = typeof nodeGraphModuleDefinitions === "undefined" ? null
    : nodeGraphModuleDefinitions.convolutionResonator?.parameters.find(p => p.key === "vocoderModel");
  const choice = (parameter?.choiceKeys || []).indexOf(String(raw));
  const label = (parameter?.choices || []).indexOf(String(raw));
  const index = choice >= 0 ? choice : label;
  const model = Number.isFinite(Number(raw)) ? Number(raw) : Number(parameter?.choiceIds?.[index] ?? index);
  return { model: model >= 0 ? model : 0,
    width: Number(nodeGraphConvolutionAuthoredValue(node, "bankWidth", 0.75)),
    follower: 0.001 * Number(nodeGraphConvolutionAuthoredValue(node, "bankFollowerMs", 0.25)) };
}

function nodeGraphConvolutionProbeDispatch() {
  const state = nodeGraphConvolutionProbeState;
  if (state.busy || !state.pending.size) return;
  const [id, job] = state.pending.entries().next().value;
  state.pending.delete(id);
  if (!job.current()) { nodeGraphConvolutionProbeDispatch(); return; }
  if (state.fatal) { job.done(null, state.fatal); return; }
  try {
    if (!state.worker) {
      const source = nodeGraphConvolutionDisplayScript || new URL("./public/modules/convolutionResonator/convolution-resonator-display.js", document.baseURI).href;
      state.worker = new Worker(new URL("./convolution-resonator-probe-worker.js?v=cres10", source));
      state.worker.onmessage = ({ data }) => {
        const active = state.busy;
        if (!active || active.id !== data.id) return;
        state.busy = null;
        if (data.packet) {
          state.cache.set(active.key, data.packet);
          if (state.cache.size > 12) state.cache.delete(state.cache.keys().next().value);
        }
        if (data.error) console.error("[convolution-display]", data.error);
        active.done(data.packet || null, data.error || "");
        nodeGraphConvolutionProbeDispatch();
      };
      state.worker.onerror = event => {
        state.fatal = event.message || "Native probe worker failed";
        console.error("[convolution-display]", state.fatal);
        const active = state.busy; state.busy = null;
        active?.done(null, state.fatal);
        for (const pending of state.pending.values()) pending.done(null, state.fatal);
        state.pending.clear(); state.worker.terminate(); state.worker = null;
      };
    }
    state.busy = job;
    state.worker.postMessage({ id: job.id, params: job.params });
  } catch (error) {
    state.busy = null;
    const message = String(error?.message || error);
    console.error("[convolution-display]", message);
    job.done(null, message);
  }
}

function nodeGraphConvolutionProbeRequest(section, params, key) {
  const state = nodeGraphConvolutionProbeState;
  section._convolutionRequestKey = key;
  const id = ++state.nextId;
  const job = { id, params, key, current: () => section.isConnected && section._convolutionRequestKey === key, done: (packet, error) => {
    if (!section.isConnected || section._convolutionRequestKey !== key) return;
    section._convolutionPacket = packet; section._convolutionError = error;
    section._convolutionForce = true;
    section.syncFromParameters?.();
  } };
  if (state.cache.has(key)) { job.done(state.cache.get(key), ""); return; }
  section._convolutionProbeId ||= ++state.nextFace;
  state.pending.set(section._convolutionProbeId, job);
  nodeGraphConvolutionProbeDispatch();
}

// Clip geometry, not signal values: excursions terminate at the viewport edge
// rather than becoming artificial horizontal "clipped audio" plateaus.
function nodeGraphConvolutionClipY(points, top, bottom) {
  const runs = []; let run = [];
  const flush = () => { if (run.length >= 4) runs.push(run); run = []; };
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i - 2], y = points[i - 1], dx = points[i] - x, dy = points[i + 1] - y;
    let lo = 0, hi = 1;
    if (dy === 0) { if (y < top || y > bottom) { flush(); continue; } }
    else {
      const a = (top - y) / dy, b = (bottom - y) / dy;
      lo = Math.max(0, Math.min(a, b)); hi = Math.min(1, Math.max(a, b));
    }
    if (lo > hi) { flush(); continue; }
    const ax = x + lo * dx, ay = y + lo * dy, bx = x + hi * dx, by = y + hi * dy;
    if (run.length && (Math.abs(run[run.length - 2] - ax) > 1e-6 || Math.abs(run[run.length - 1] - ay) > 1e-6)) flush();
    if (!run.length) run.push(ax, ay);
    run.push(bx, by);
    if (hi < 1) flush();
  }
  flush(); return runs;
}

function drawNodeGraphConvolutionResonatorDisplay(section) {
  if (!section?.isConnected) return;
  const canvas = section.querySelector(".node-display-face");
  const metrics = canvas && nodeGraphSizeDisplayCanvas(section, canvas);
  if (!metrics || metrics.cssWidth < 8 || metrics.cssHeight < 8) return;
  const node = nodeGraphPatchNode(section.dataset.node);
  const audio = typeof nodeGraphAudioDerivation === "function" ? nodeGraphAudioDerivation() : null;
  const sr = Number(audio?.clampedEngineSampleRate)
    || Number(typeof nodeGraphMvp === "undefined" ? 0 : nodeGraphMvp.sampleRate) || 48000;
  const params = nodeGraphConvolutionProbeParameters(node, sr);
  const comparison = nodeGraphConvolutionComparisonView(node);
  const probeKey = JSON.stringify(params);
  if (section._convolutionRequestKey !== probeKey) nodeGraphConvolutionProbeRequest(section, params, probeKey);
  const { cssWidth: w, cssHeight: h, pixelRatio: dpr } = metrics;
  const paintKey = `${probeKey}|${w}|${h}|${dpr}|${JSON.stringify(comparison)}`;
  if (section._convolutionPaintKey === paintKey && !section._convolutionForce) return;
  section._convolutionForce = false;
  const batch = nodeGraphGlLinesBegin(canvas, [0.015, 0.022, 0.028, 1], { scale: dpr, textInk: false });
  if (!batch) { nodeGraphDisplayGlFailed?.(canvas, "convolution resonator: no shared GL device"); return; }
  const ink = [0.87, 0.91, 0.9, 0.85], grid = [0.75, 0.85, 0.9, 0.14];
  const colors = [[0.44, 0.87, 0.92, 0.9], [1, 0.76, 0.4, 0.9], [0.78, 0.62, 0.94, 0.9], [0.53, 0.91, 0.63, 0.9]];
  const font = Math.min(10, Math.max(7, h / 23));
  const text = (value, x, y, align = "left", color = ink) => nodeGraphGlLinesText(batch, value, x, y,
    { px: font, rgba: color, align, baseline: "top", family: "monospace" });
  const line = (x0, y0, x1, y1) => nodeGraphGlLinesSegment(batch, x0, y0, x1, y1, 0.35, 1 / dpr, grid);
  const p = section._convolutionPacket;
  if (!p) text(section._convolutionError ? "Native probe unavailable" : "Evaluating native response...", 5, 5);
  else {
    const n = p[1], count = p[2], duration = p[3], peak = p[4], bandBase = 16 + 2 * n;
    const expanded = h >= 100, labeled = h >= 48 && w >= 100;
    const left = labeled ? 25 : 1, right = Math.max(left + 4, w - (labeled ? 6 : 1));
    const top = labeled ? font + 8 : 1, irBottom = expanded ? h * 0.44 : h - (labeled ? font + 5 : 1);
    const spacious = h >= 180, bandTitleY = irBottom + font + 5;
    const bandTop = bandTitleY + font + (spacious ? font + 5 : 4), bandBottom = h - font - 5;
    if (labeled) {
      text(comparison.model !== 0 ? (w >= 240 ? "Body IR (bypassed)" : "IR off")
        : w < 180 ? "IR" : p[15] ? "IR envelope" : "Body IR", 5, 3);
      const value = peak >= 100 ? peak.toExponential(1) : peak.toFixed(2);
      text(`${w >= 180 ? "peak " : ""}${value}x`, w - 5, 3, "right", peak > 1 ? colors[1] : ink);
    }
    else if (peak > 1 && h >= 12) text(w >= 80 ? `peak ${peak.toFixed(1)}x` : ">1x", w - 2, 1, "right", colors[1]);
    const irMid = (top + irBottom) / 2, irScale = (irBottom - top) / 2;
    for (const a of [-1, 0, 1]) { const y = irMid - a * irScale; line(left, y, right, y); if (labeled) text(String(a), left - 4, y - font / 2, "right"); }
    const points = [];
    for (let i = 0; i < n; ++i) points.push(left + p[16 + 2 * i] / duration * (right - left), irMid - p[17 + 2 * i] * irScale);
    for (const run of nodeGraphConvolutionClipY(points, top, irBottom)) nodeGraphGlLinesPolyline(batch, run, 0.65, 1 / dpr, colors[0]);
    if (labeled) {
      text("0", left, irBottom + 2);
      text(`${(1000 * duration).toFixed(duration < 0.01 ? 2 : 0)} ms${p[5] ? (w >= 220 ? " (tail continues)" : " +") : ""}`, right, irBottom + 2, "right");
    }
    if (expanded) {
      if (comparison.model === 2) {
        text(w >= 200 ? "Filter bank / 32 bands" : "Bank: 32", 5, bandTitleY);
        text(`${comparison.width.toFixed(2)} oct`, left, bandTop + 4);
        text(`${(1000 * comparison.follower).toFixed(2)} ms${w >= 200 ? " follower" : ""}`, left, bandTop + font + 9);
      } else {
        text(w >= 190 ? "Band kernels (peak-normalized)" : "Band (norm)", 5, bandTitleY);
        const logMin = Math.log(p[10]), logRange = Math.log(p[11] / p[10]);
        const xAt = hz => left + (Math.log(hz) - logMin) / logRange * (right - left);
        for (const hz of [100, 1000, 10000]) if (hz < p[11]) { const x = xAt(hz); line(x, bandTop, x, bandBottom); text(hz < 1000 ? String(hz) : `${hz / 1000}k`, x, bandBottom + 2, "center"); }
        line(left, bandBottom, right, bandBottom);
        for (let band = 0; band < 4; ++band) {
          const curve = [];
          for (let i = 0; i < count; ++i) curve.push(xAt(p[bandBase + i]), bandBottom - p[bandBase + count * (band + 1) + i] * (bandBottom - bandTop));
          nodeGraphGlLinesPolyline(batch, curve, 0.6, 1 / dpr, colors[band]);
        }
        const frameText = p[8] === 0 ? `${p[6]}` : `${p[6]}/${p[7]}`;
        if (w >= 180 && spacious) {
          ["100", "500", "2k", "8k"].forEach((label, i) => text(label, left + i * font * 2.6, bandTop - font - 2, "left", colors[i]));
          text(w >= 300 ? `${frameText} samples | BW ${p[9].toFixed(2)}` : `${frameText} samples`, right, bandTop - font - 2, "right");
        }
      }
    }
  }
  if (nodeGraphGlLinesEnd(batch, "alpha")) section._convolutionPaintKey = paintKey;
  else nodeGraphDisplayGlFailed?.(canvas, "convolution resonator: GL present failed");
}

function createNodeGraphConvolutionResonatorDisplay(nodeId, type = "convolutionResonator") {
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-convolution-resonator-display node-module-face";
  section.dataset.node = String(typeof nodeId === "object" ? nodeId.dataset?.node || nodeId.id : nodeId);
  section.dataset.nodeType = type; section.dataset.parameterVisual = "true";
  markCurveFacePlate?.(section, "convolutionResonatorFace");
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-convolution-resonator-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: el => `convolutionResonatorFace:${el.dataset.node}`, forceKey: "_convolutionForce",
    paint: drawNodeGraphConvolutionResonatorDisplay, paintKind: "param",
  });
  return section;
}
if (typeof nodeGraphModuleScopeCustomRenderers === "object") nodeGraphModuleScopeCustomRenderers.convolutionResonatorFace = () => {};
if (typeof registerNodeGraphModuleFaceCreator === "function") registerNodeGraphModuleFaceCreator("convolutionResonatorFace", createNodeGraphConvolutionResonatorDisplay);
if (typeof module !== "undefined" && module.exports) module.exports = { nodeGraphConvolutionProbeParameters, nodeGraphConvolutionClipY };
