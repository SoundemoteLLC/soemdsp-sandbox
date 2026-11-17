// Pitch Quantizer face: one-octave pitch-class keyboard, drawn by WebGL
// (docs/APP_POLICY.md section 3 / circuit-builder displays). Toggle keys to
// choose which classes quantize -- applied across every octave via the 12-bit
// scale mask (same as the Scale jack). Keys show the OUTPUT pitch classes:
// the mask rotated by Semitone Offset (Octave Offset keeps the pitch class).
// Clicking a key toggles the class that lands on that output note.
//
// Look: inverted piano (dark natural keys, light sharps), flat circuit-board
// fills, thin trace strokes, electric accent on enabled notes. No radial
// gradients and no hover titles.

const NODE_GRAPH_PITCH_QUANTIZER_GL_FONT = '"Cascadia Mono", "Cascadia Code", Consolas, sans-serif';

const NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK = Object.freeze({
  bg: [0.027, 0.035, 0.043, 1],
  plateStroke: [0.498, 0.780, 0.851, 0.28],
  plateStrokeJacked: [0.89, 0.36, 0.36, 0.8],
  // Natural (formerly white) keys: dark pads.
  naturalFill: [0.071, 0.086, 0.102, 1],
  naturalStroke: [0.173, 0.208, 0.227, 1],
  naturalLabel: [0.55, 0.62, 0.65, 1],
  // Sharp (formerly black) keys: light pads.
  sharpFill: [0.773, 0.808, 0.827, 1],
  sharpStroke: [0.55, 0.60, 0.63, 1],
  sharpLabel: [0.086, 0.102, 0.118, 1],
  // Enabled notes: electric teal accent, flat glow (outset rect, not radial).
  electric: [0.239, 1, 0.816, 1],
  electricFillNatural: [0.055, 0.184, 0.173, 1],
  electricFillSharp: [0.847, 1, 0.965, 1],
  electricLabelNatural: [0.91, 1, 0.985, 1],
  electricLabelSharp: [0.024, 0.133, 0.118, 1],
  glow: [0.239, 1, 0.816, 0.28],
  glowOuter: [0.239, 1, 0.816, 0.10],
});

function nodeGraphPitchQuantizerGlWhites() {
  return typeof nodeGraphPitchQuantizerWhiteClasses !== "undefined"
    ? nodeGraphPitchQuantizerWhiteClasses
    : [0, 2, 4, 5, 7, 9, 11];
}

function nodeGraphPitchQuantizerGlBlacks() {
  return typeof nodeGraphPitchQuantizerBlackKeys !== "undefined"
    ? nodeGraphPitchQuantizerBlackKeys
    : [
      { pitchClass: 1, afterWhite: 0 },
      { pitchClass: 3, afterWhite: 1 },
      { pitchClass: 6, afterWhite: 3 },
      { pitchClass: 8, afterWhite: 4 },
      { pitchClass: 10, afterWhite: 5 },
    ];
}

function nodeGraphPitchQuantizerGlNames() {
  return typeof nodeGraphPitchQuantizerNoteNames !== "undefined"
    ? nodeGraphPitchQuantizerNoteNames
    : ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
}

/**
 * Key rectangles in the same space as width/height (backing or CSS px).
 * Shared by the GL draw and the pointer hit test.
 */
function nodeGraphPitchQuantizerKeyLayout(width, height, insetPx = 0) {
  const W = Math.max(1, Number(width) || 1);
  const H = Math.max(1, Number(height) || 1);
  const inset = Math.max(0, Math.round(Number(insetPx) || 0));
  const x0 = inset;
  const y0 = inset;
  const innerW = Math.max(1, W - inset * 2);
  const innerH = Math.max(1, H - inset * 2);
  const whites = nodeGraphPitchQuantizerGlWhites();
  const blacks = nodeGraphPitchQuantizerGlBlacks();
  const names = nodeGraphPitchQuantizerGlNames();
  const n = Math.max(1, whites.length);
  const whiteW = innerW / n;
  const keys = [];
  whites.forEach((pc, i) => {
    keys.push({
      pc,
      black: false,
      label: names[pc] || String(pc),
      x: x0 + i * whiteW,
      y: y0,
      w: whiteW,
      h: innerH,
    });
  });
  for (const key of blacks) {
    const left = x0 + ((key.afterWhite + 0.65) / n) * innerW;
    const widthFrac = (0.62 / n) * innerW;
    const pc = key.pitchClass;
    keys.push({
      pc,
      black: true,
      label: names[pc] || String(pc),
      x: left,
      y: y0,
      w: widthFrac,
      h: innerH * 0.58,
    });
  }
  return { width: W, height: H, inset, x0, y0, innerW, innerH, keys };
}

/** Hit test: sharps first (they overlap the natural key bed). */
function nodeGraphPitchQuantizerKeyAt(layout, x, y) {
  if (!layout || !Array.isArray(layout.keys)) return null;
  const blacks = layout.keys.filter((k) => k.black);
  const whites = layout.keys.filter((k) => !k.black);
  const hit = (key) => x >= key.x && x < key.x + key.w && y >= key.y && y < key.y + key.h;
  for (let i = blacks.length - 1; i >= 0; i -= 1) {
    if (hit(blacks[i])) return blacks[i];
  }
  for (let i = 0; i < whites.length; i += 1) {
    if (hit(whites[i])) return whites[i];
  }
  return null;
}

if (typeof globalThis !== "undefined") {
  globalThis.NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  globalThis.nodeGraphPitchQuantizerKeyLayout = nodeGraphPitchQuantizerKeyLayout;
  globalThis.nodeGraphPitchQuantizerKeyAt = nodeGraphPitchQuantizerKeyAt;
}

function nodeGraphPitchQuantizerGlStrokeRect(batch, x, y, w, h, rgba, stroke) {
  const s = Math.max(1, Number(stroke) || 1);
  if (!(w > 0) || !(h > 0) || typeof nodeGraphGlLinesRect !== "function") return;
  nodeGraphGlLinesRect(batch, x, y, w, s, rgba);
  nodeGraphGlLinesRect(batch, x, y + h - s, w, s, rgba);
  const midH = Math.max(0, h - s * 2);
  if (midH > 0) {
    nodeGraphGlLinesRect(batch, x, y + s, s, midH, rgba);
    nodeGraphGlLinesRect(batch, x + w - s, y + s, s, midH, rgba);
  }
}

function nodeGraphPitchQuantizerGlDrawKeys(batch, layout, mask, jacked, strokeDev) {
  const L = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  const stroke = Math.max(1, strokeDev | 0);
  const glowPad = Math.max(2, stroke * 2);
  const glowPadOuter = Math.max(4, stroke * 4);
  const has = (pc) => (typeof nodeGraphPitchQuantizerMaskHasClass === "function"
    ? nodeGraphPitchQuantizerMaskHasClass(mask, pc)
    : false);
  const plate = jacked ? L.plateStrokeJacked : L.plateStroke;
  nodeGraphGlLinesRect(batch, 0, 0, layout.width, layout.height, L.bg);
  nodeGraphPitchQuantizerGlStrokeRect(batch, 0, 0, layout.width, layout.height, plate, stroke);

  const naturals = layout.keys.filter((k) => !k.black);
  const sharps = layout.keys.filter((k) => k.black);
  const layers = [...naturals, ...sharps];

  for (const key of layers) {
    const on = has(key.pc);
    if (on) {
      nodeGraphGlLinesRect(
        batch,
        key.x - glowPadOuter,
        key.y - glowPadOuter,
        key.w + glowPadOuter * 2,
        key.h + glowPadOuter * 2,
        L.glowOuter,
      );
      nodeGraphGlLinesRect(
        batch,
        key.x - glowPad,
        key.y - glowPad,
        key.w + glowPad * 2,
        key.h + glowPad * 2,
        L.glow,
      );
    }
  }

  for (const key of layers) {
    const on = has(key.pc);
    const fill = on
      ? (key.black ? L.electricFillSharp : L.electricFillNatural)
      : (key.black ? L.sharpFill : L.naturalFill);
    const ink = on
      ? L.electric
      : (key.black ? L.sharpStroke : L.naturalStroke);
    nodeGraphGlLinesRect(batch, key.x, key.y, key.w, key.h, fill);
    nodeGraphPitchQuantizerGlStrokeRect(batch, key.x, key.y, key.w, key.h, ink, stroke);
  }

  // Natural-key seams (thin traces on the shared edges).
  const seam = L.naturalStroke;
  for (let i = 1; i < naturals.length; i += 1) {
    const x = naturals[i].x;
    nodeGraphGlLinesRect(batch, x - stroke * 0.5, naturals[i].y, stroke, naturals[i].h, seam);
  }

  const textOpts = {
    px: 12,
    weight: 700,
    family: NODE_GRAPH_PITCH_QUANTIZER_GL_FONT,
    align: "center",
    baseline: "alphabetic",
    maxWidth: 0,
    rgba: null,
  };
  for (const key of layers) {
    const on = has(key.pc);
    const labelRgba = on
      ? (key.black ? L.electricLabelSharp : L.electricLabelNatural)
      : (key.black ? L.sharpLabel : L.naturalLabel);
    const maxW = Math.max(4, key.w - stroke * 4);
    const maxH = Math.max(4, key.h * 0.28);
    let fontPx = Math.max(4, Math.min(key.w * (key.black ? 0.42 : 0.36), maxH));
    if (typeof nodeGraphGlLinesMeasureText === "function") {
      const width = nodeGraphGlLinesMeasureText(key.label, fontPx, NODE_GRAPH_PITCH_QUANTIZER_GL_FONT, 700);
      if (width > maxW && width > 0) fontPx = Math.max(4, fontPx * (maxW / width));
    }
    textOpts.px = fontPx;
    textOpts.maxWidth = maxW;
    textOpts.rgba = labelRgba;
    const baseline = key.y + key.h - Math.max(stroke * 3, fontPx * 0.45);
    if (typeof nodeGraphGlLinesText === "function") {
      nodeGraphGlLinesText(batch, key.label, key.x + key.w * 0.5, baseline, textOpts);
    }
  }
}

function createNodeGraphPitchQuantizerFace(nodeIdOrEl, _type) {
  const nodeId = nodeIdOrEl && typeof nodeIdOrEl === "object"
    ? String(nodeIdOrEl.dataset?.node || nodeIdOrEl.id || "")
    : String(nodeIdOrEl || "");
  const section = document.createElement("div");
  section.className = "node-module-scope-window node-pitch-quantizer-face";
  section.dataset.node = nodeId;
  section.dataset.nodeType = "pitchQuantizer";
  section.setAttribute("aria-label", "Pitch quantizer scale keyboard");
  if (typeof tagNodeGraphModuleBand === "function") {
    tagNodeGraphModuleBand(section, "face");
  }
  const canvas = typeof nodeGraphDisplayCanvasCreate === "function"
    ? nodeGraphDisplayCanvasCreate("node-pitch-quantizer-canvas")
    : document.createElement("div");
  if (canvas && !canvas.classList.contains("node-pitch-quantizer-canvas")) {
    canvas.classList.add("node-pitch-quantizer-canvas");
  }
  section.append(canvas);

  let lastSig = "";
  let hitLayout = null;

  function faceState() {
    const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
    const mask = typeof nodeGraphPitchQuantizerDisplayMaskForNode === "function"
      ? nodeGraphPitchQuantizerDisplayMaskForNode(patchNode)
      : 0;
    const jacked = typeof nodeGraphPitchQuantizerScaleJackConnected === "function"
      && nodeGraphPitchQuantizerScaleJackConnected(nodeId);
    const shift = typeof nodeGraphPitchQuantizerSemitoneShift === "function"
      ? nodeGraphPitchQuantizerSemitoneShift(patchNode)
      : 0;
    return { mask, jacked, shift };
  }

  function keyAtClientXY(clientX, clientY) {
    if (!hitLayout) return null;
    const host = canvas.getBoundingClientRect ? canvas : section;
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const x = ((clientX - rect.left) / w) * hitLayout.width;
    const y = ((clientY - rect.top) / h) * hitLayout.height;
    return nodeGraphPitchQuantizerKeyAt(hitLayout, x, y);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const key = keyAtClientXY(event.clientX, event.clientY);
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    const { jacked, shift } = faceState();
    if (jacked) return;
    const sourceClass = (((key.pc - shift) % 12) + 12) % 12;
    if (typeof toggleNodeGraphPitchQuantizerKey === "function") {
      toggleNodeGraphPitchQuantizerKey(nodeId, sourceClass, event);
    }
  }

  section.addEventListener("pointerdown", onPointerDown);

  function paint() {
    const { mask, jacked } = faceState();
    const m = typeof nodeGraphDisplayCanvasSize === "function"
      ? nodeGraphDisplayCanvasSize(section, canvas)
      : null;
    if (!m) return;
    const dpr = Math.max(1, m.pixelRatio || 1);
    const bw = Math.max(1, m.width);
    const bh = Math.max(1, m.height);
    const strokeDev = Math.max(1, Math.round(dpr));
    const inset = Math.max(strokeDev * 2, Math.round(Math.min(bw, bh) * 0.03));
    const sig = `${bw}x${bh}:s${strokeDev}:m${mask}:j${jacked ? 1 : 0}`;
    if (sig === lastSig) return;
    lastSig = sig;
    const batch = typeof nodeGraphGlLinesBegin === "function"
      ? nodeGraphGlLinesBegin(canvas, NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK.bg)
      : null;
    if (!batch) {
      lastSig = "";
      if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
      return;
    }
    const layout = nodeGraphPitchQuantizerKeyLayout(bw, bh, inset);
    hitLayout = layout;
    nodeGraphPitchQuantizerGlDrawKeys(batch, layout, mask, jacked, strokeDev);
    if (typeof nodeGraphGlLinesEnd === "function" && !nodeGraphGlLinesEnd(batch)) {
      lastSig = "";
      if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    }
    section.classList.toggle("scale-jacked", jacked);
  }

  function dirty() {
    lastSig = "";
    paint();
  }
  section._pqRepaint = dirty;

  let rafId = 0;
  let onScreen = false;
  function armTick() {
    if (rafId || !onScreen || !section.isConnected) return;
    rafId = requestAnimationFrame(tick);
  }
  function tick() {
    rafId = 0;
    if (!section.isConnected || !onScreen) return;
    paint();
    armTick();
  }
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      lastSig = "";
      if (onScreen) paint();
    });
    ro.observe(section);
  }
  if (typeof IntersectionObserver === "function") {
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((entry) => entry.isIntersecting);
      if (!onScreen) return;
      lastSig = "";
      armTick();
    });
    io.observe(section);
  } else {
    onScreen = true;
    armTick();
  }
  return section;
}

function setNodeGraphPitchQuantizerMask(nodeId, mask, event, statusLabel = "scale") {
  if (!globalThis.soemdspPerformMode
    && typeof nodeGraphScriptReadyForGraphAction === "function"
    && !nodeGraphScriptReadyForGraphAction("pitch quantizer")) {
    return false;
  }
  if (!nodeId) return false;
  if (!globalThis.soemdspPerformMode
    && typeof nodeGraphMvp !== "undefined"
    && !nodeGraphMvp.activeNodes?.has?.(nodeId)) {
    return false;
  }
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const patchNode = patch.nodes.find((candidate) => candidate.id === nodeId);
  if (!patchNode) {
    return false;
  }
  const nextMask = typeof nodeGraphPitchQuantizerNormalizeMask === "function"
    ? nodeGraphPitchQuantizerNormalizeMask(mask)
    : (Math.round(Number(mask)) || 0) & 0xFFF;
  patchNode.params = {
    ...(patchNode.params || {}),
    scaleMask: normalizeNodeGraphPatchParameter(
      patchNode.type,
      "scaleMask",
      nextMask,
      patchNode.paramMeta?.scaleMask,
    ),
  };
  commitNodeGraphPatch(patch, {
    status: `pitch quantizer ${statusLabel}`,
    faceEdit: true,
    liveParamsOnly: true,
  });
  if (typeof syncNodeGraphPitchQuantizerFace === "function") {
    syncNodeGraphPitchQuantizerFace(nodeId);
  }
  event?.preventDefault?.();
  event?.stopPropagation?.();
  return true;
}

function toggleNodeGraphPitchQuantizerKey(nodeId, pitchClass, event) {
  if (!globalThis.soemdspPerformMode
    && typeof nodeGraphScriptReadyForGraphAction === "function"
    && !nodeGraphScriptReadyForGraphAction("pitch quantizer")) {
    return false;
  }
  if (!nodeId) return false;
  if (!globalThis.soemdspPerformMode
    && typeof nodeGraphMvp !== "undefined"
    && !nodeGraphMvp.activeNodes?.has?.(nodeId)) {
    return false;
  }
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const patchNode = patch.nodes.find((candidate) => candidate.id === nodeId);
  if (!patchNode) {
    return false;
  }
  const current = typeof nodeGraphPitchQuantizerMaskForNode === "function"
    ? nodeGraphPitchQuantizerMaskForNode(patchNode)
    : 0;
  const nextMask = typeof nodeGraphPitchQuantizerMaskToggleClass === "function"
    ? nodeGraphPitchQuantizerMaskToggleClass(current, pitchClass)
    : (current ^ (1 << (((pitchClass % 12) + 12) % 12)));
  const names = nodeGraphPitchQuantizerGlNames();
  const shift = typeof nodeGraphPitchQuantizerSemitoneShift === "function"
    ? nodeGraphPitchQuantizerSemitoneShift(patchNode)
    : 0;
  const shown = (((pitchClass + shift) % 12) + 12) % 12;
  const label = names[shown] || String(shown);
  const on = typeof nodeGraphPitchQuantizerMaskHasClass === "function"
    ? nodeGraphPitchQuantizerMaskHasClass(nextMask, pitchClass)
    : false;
  return setNodeGraphPitchQuantizerMask(
    nodeId,
    nextMask,
    event,
    `${label} ${on ? "on" : "off"}`,
  );
}

function syncNodeGraphPitchQuantizerFace(nodeId) {
  const id = String(nodeId || "");
  if (!id || typeof document === "undefined") return;
  for (const root of document.querySelectorAll(
    `.node-pitch-quantizer-face[data-node="${CSS.escape(id)}"]`,
  )) {
    if (typeof root._pqRepaint === "function") root._pqRepaint();
  }
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.pitchQuantizerFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("pitchQuantizerFace", createNodeGraphPitchQuantizerFace);
}
