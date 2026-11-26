let euclideanShaderPromise;
let euclideanRingDrag = null;

function euclideanShader() {
  return euclideanShaderPromise ||= fetch("./public/modules/euclideanSequencer/euclidean-sequencer.glsl?v=euclidean-1")
    .then((response) => {
      if (!response.ok) throw new Error(`Euclidean shader load failed (${response.status})`);
      return response.text();
    });
}

function euclideanPaint(face) {
  if (!face.isConnected || !face._euclideanShader) return;
  const plate = face._euclideanPlate;
  const metrics = ensureFaceMetrics(plate, { observe: true });
  if (!(metrics?.cssW > 0 && metrics?.cssH > 0)) return;
  // Stable module-space backing: workspace zoom only transforms the picture.
  const scale = Math.max(1, Number(metrics.dpr) || 1);
  nodeGraphDisplayCanvasSetBacking(plate, Math.ceil(metrics.cssW * scale), Math.ceil(metrics.cssH * scale));
  const node = nodeGraphPatchNode(face.dataset.node);
  if (!node) return;
  const floats = { engineActive: 0 };
  const read = (lane, field) => Number(nodeGraphModuleScopeLatestOutputValue(node.id, `__Ring${lane}_${field}`, NaN));
  for (let lane = 0; lane < 4; lane += 1) {
    const n = read(lane, 0);
    const live = Number.isFinite(n) && n >= 1;
    if (live) floats.engineActive = 1;
    floats[`n${lane}`] = live ? n : Number(node.params[`steps${lane + 1}`]);
    floats[`k${lane}`] = live ? read(lane, 1) : Number(node.params[`hits${lane + 1}`]);
    floats[`r${lane}`] = live ? read(lane, 2) : Number(node.params[`rotate${lane + 1}`]);
    floats[`phase${lane}`] = live ? read(lane, 3) : 0;
    floats[`last${lane}`] = live ? read(lane, 5) : 0;
    floats[`flash${lane}`] = live && read(lane, 4) > 0 ? Math.exp(-read(lane, 6) / 0.12) : 0;
  }
  const result = nodeGraphGlLinesUserShader({ key: `euclidean:${node.id}`, nodeId: node.id,
    canvas: plate, userBody: face._euclideanShader, floatNames: Object.keys(floats), floats, advance: false });
  if (!result.ok && face.dataset.shaderError !== result.error) console.error("[Euclidean Sequencer]", result.error);
  face.dataset.shaderError = result.error || "";
}

registerNodeGraphChromelessModuleUi("euclideanSequencer", {
  createBody(nodeId) {
    const face = document.createElement("div");
    face.className = "node-euclidean-sequencer node-module-scope-window node-module-face";
    face.dataset.node = nodeId;
    face.dataset.nodeType = "euclideanSequencer";
    face.dataset.lightSource = "screen";
    const plate = nodeGraphDisplayCanvasCreate("node-euclidean-sequencer-canvas");
    plate.setAttribute("aria-hidden", "true");
    face._euclideanPlate = plate;
    face.append(plate);
    euclideanShader().then((shader) => {
      face._euclideanShader = shader;
      face._euclideanForce = true;
      euclideanPaint(face);
    }).catch((error) => console.error("[Euclidean Sequencer]", error));
    return face;
  },
  afterMount(article, face, nodeId, type) {
    registerNodeGraphModuleScopeSlot(article, { nodeId, scopeElement: face, type, viewDrag: false });
    nodeGraphInstallDrawingFacePump(face, {
      rafKey: "_euclideanRaf", forceKey: "_euclideanForce", clockKey: "euclideanSequencer",
      shouldAnimate: () => !scopePaintIsVisualPaused() && scopePaintEngineState() !== "paused",
      paintOnCreate: true, paint: euclideanPaint,
    });
  },
});

// Hit testing shares the shader's center, outer radius, and ring spacing.
document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const face = event.target.closest?.(".node-euclidean-sequencer");
  if (!face) return;
  const rect = face.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width / 2;
  const y = rect.height / 2 - (event.clientY - rect.top);
  const outer = Math.min(rect.width, rect.height) * 0.43;
  const gap = outer * 0.21;
  const radius = Math.hypot(x, y);
  const lane = Math.round((outer - radius) / gap);
  if (lane < 0 || lane > 3 || Math.abs(radius - (outer - lane * gap)) > gap * 0.45) return;
  const node = nodeGraphPatchNode(face.dataset.node);
  if (!node) return;
  euclideanRingDrag = { face, nodeId: node.id, pointerId: event.pointerId, lane,
    rect, gap, radius, angle: Math.atan2(x, y), angleDelta: 0, mode: null,
    steps: Number(node.params[`steps${lane + 1}`]),
    hits: Number(node.params[`hits${lane + 1}`]), rotate: Number(node.params[`rotate${lane + 1}`]) };
  face.setPointerCapture(event.pointerId);
  face.classList.add("is-ring-dragging");
  event.preventDefault();
  event.stopPropagation();
}, true);

document.addEventListener("pointermove", (event) => {
  const drag = euclideanRingDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const x = event.clientX - drag.rect.left - drag.rect.width / 2;
  const y = drag.rect.height / 2 - (event.clientY - drag.rect.top);
  const angle = Math.atan2(x, y);
  drag.angleDelta += Math.atan2(Math.sin(angle - drag.angle), Math.cos(angle - drag.angle));
  drag.angle = angle;
  const radial = Math.hypot(x, y) - drag.radius;
  if (!drag.mode && Math.max(Math.abs(radial), Math.abs(drag.angleDelta * drag.radius)) > 3) {
    drag.mode = Math.abs(radial) > Math.abs(drag.angleDelta * drag.radius) ? "hits" : "rotate";
  }
  if (!drag.mode) return;
  const key = `${drag.mode}${drag.lane + 1}`;
  const fine = event.shiftKey ? 0.1 : 1;
  const delta = drag.mode === "hits" ? radial / drag.gap * 4 : drag.angleDelta / (2 * Math.PI) * drag.steps;
  const value = Math.round(drag[drag.mode] + delta * fine);
  const slider = nodeGraphSliderForParameter(drag.nodeId, key);
  if (slider) {
    setNodeSliderValue(slider, value, { interaction: "drag" });
    drag.slider = slider;
  }
  event.preventDefault();
  event.stopPropagation();
}, true);

function euclideanEndDrag(event) {
  const drag = euclideanRingDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (drag.slider) commitNodeSliderDragValue(drag.slider, "Euclidean ring");
  if (drag.face.hasPointerCapture(event.pointerId)) drag.face.releasePointerCapture(event.pointerId);
  drag.face.classList.remove("is-ring-dragging");
  euclideanRingDrag = null;
  event.stopPropagation();
}
document.addEventListener("pointerup", euclideanEndDrag, true);
document.addEventListener("pointercancel", euclideanEndDrag, true);
