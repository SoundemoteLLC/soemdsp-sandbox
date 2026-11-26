function dividerSequencerPaint(face) {
  if (!face.isConnected) return;
  const plate = face._dividerPlate;
  const metrics = ensureFaceMetrics(plate, { observe: true });
  if (!(metrics?.cssW > 0 && metrics?.cssH > 0)) return;
  nodeGraphDisplayCanvasSetBacking(plate, Math.ceil(metrics.cssW * metrics.dpr), Math.ceil(metrics.cssH * metrics.dpr));
  const node = nodeGraphPatchNode(face.dataset.node);
  if (!node) return;
  const batch = nodeGraphGlLinesBegin(plate, [0.018, 0.024, 0.028, 1], { scale: metrics.dpr, textInk: false });
  if (!batch) { nodeGraphGlLinesFillBlack(plate); return; }
  const read = (port, fallback = 0) => nodeGraphModuleScopeLatestOutputValue(node.id, port, fallback);
  const w = metrics.cssW, h = metrics.cssH, row = h / 5;
  const left = w * 0.35, right = w * 0.94, width = right - left;
  const tick = read("__Tick"), phase = read("__ClockPhase");
  const colors = [[1, 0.4, 0.45, 1], [1, 0.77, 0.32, 1], [0.36, 0.84, 0.95, 1], [0.64, 0.91, 0.49, 1]];
  const px = Math.max(1, Math.min(row * 0.62, w * 0.075));
  for (let lane = 0; lane < 4; lane += 1) {
    const name = "ABCD"[lane], y = row * (lane + 0.5);
    const n = read(`__Divider${lane}_0`, Number(node.params[`divide${lane + 1}`]));
    const offset = read(`__Divider${lane}_1`, Number(node.params[`offset${lane + 1}`]));
    const position = ((tick + phase - offset) % n + n) % n / n;
    const gate = read(`__Gate${name}`) > 0;
    const label = `${name} /${n}`;
    const labelWidth = nodeGraphGlLinesMeasureText(label, px);
    const labelPx = px * Math.min(1, w * 0.27 / Math.max(1, labelWidth));
    nodeGraphGlLinesText(batch, label, w * 0.04, y, { px: labelPx, align: "left", rgba: colors[lane] });
    nodeGraphGlLinesRect(batch, left, y - 0.5, width, 1, [0.2, 0.24, 0.26, 1]);
    // Tick detail is density-limited by the face, never by a DSP step ceiling.
    const ticks = Math.min(n, Math.max(1, Math.floor(width / 5)));
    for (let i = 0; i < ticks; i += 1) {
      nodeGraphGlLinesRect(batch, left + i / ticks * width, y - row * 0.12, 1, row * 0.24, [0.2, 0.24, 0.26, 1]);
    }
    nodeGraphGlLinesRect(batch, left, y + row * 0.17, width * 0.5, Math.max(1, row * 0.07), [...colors[lane].slice(0, 3), gate ? 0.8 : 0.15]);
    nodeGraphGlLinesDot(batch, left + position * width, y, row * 0.11, 1, colors[lane]);
  }
  const combined = read("__CombinedGate") > 0;
  const logic = ["OR", "XOR", "AND"][Math.trunc(read("__Logic",
    nodeGraphChoiceIdForKey("dividerSequencer", "logic", node.params.logic)))] || "XOR";
  nodeGraphGlLinesText(batch, logic, w * 0.04, row * 4.5, { px, align: "left" });
  nodeGraphGlLinesRect(batch, left, row * 4.3, width, row * 0.4,
    combined ? [0.82, 0.9, 0.87, 1] : [0.1, 0.13, 0.14, 1]);
  nodeGraphGlLinesEnd(batch);
}

registerNodeGraphChromelessModuleUi("dividerSequencer", {
  createBody(nodeId) {
    const face = document.createElement("div");
    face.className = "node-divider-sequencer node-module-scope-window node-module-face";
    face.dataset.node = nodeId;
    face.dataset.nodeType = "dividerSequencer";
    face.dataset.lightSource = "screen";
    face._dividerPlate = nodeGraphDisplayCanvasCreate("node-divider-sequencer-canvas");
    face._dividerPlate.setAttribute("aria-hidden", "true");
    face.append(face._dividerPlate);
    return face;
  },
  afterMount(article, face, nodeId, type) {
    registerNodeGraphModuleScopeSlot(article, { nodeId, scopeElement: face, type, viewDrag: false });
    nodeGraphInstallDrawingFacePump(face, {
      rafKey: "_dividerRaf", forceKey: "_dividerForce", clockKey: "dividerSequencer", paintOnCreate: true,
      shouldAnimate: () => !scopePaintIsVisualPaused() && scopePaintEngineState() !== "paused",
      paint: dividerSequencerPaint,
    });
  },
});
