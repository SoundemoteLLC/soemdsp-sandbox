// Pitch Quantizer face: one-octave pitch-class keyboard, drawn by WebGL
// (docs/APP_POLICY.md section 3 / circuit-builder displays). Toggle keys to
// choose which classes quantize -- applied across every octave via the 12-bit
// scale mask (same as the Scale jack). Keys show the OUTPUT pitch classes:
// the mask rotated by Semitone Offset (Octave Offset keeps the pitch class).
// Clicking a key toggles the class that lands on that output note.
//
// Look: inverted piano (dark natural keys, light sharps) drawn through the
// shared Keyboard helper (public/lib/visual/piano-keys-draw.js): the same
// vertical gradients, key proportions, rounded sharp bottoms, and seams
// under opaque sharps. Electric teal highlight on enabled notes, red plate
// stroke when the Scale jack is connected. No hover titles.

const NODE_GRAPH_PITCH_QUANTIZER_GL_FONT = typeof NODE_GRAPH_PIANO_KEYS_LABEL_FONT === "string"
  ? NODE_GRAPH_PIANO_KEYS_LABEL_FONT
  : "\"Cascadia Mono\", Consolas, monospace";

const NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK = Object.freeze({
  bg: [0.027, 0.035, 0.043, 1],
  bedGlow: [0.239, 1, 0.816, 0.06],
  plateStroke: [0.498, 0.780, 0.851, 0.28],
  plateStrokeJacked: [0.89, 0.36, 0.36, 0.8],
  seam: [0.01960784, 0.02352941, 0.02745098, 0.72],
  // Natural (formerly white) keys: dark pads, Keyboard-style top-to-bottom gradient.
  naturalFill: [0.071, 0.086, 0.102, 1],
  naturalTop: [0.118, 0.141, 0.161, 1],
  naturalBottom: [0.071, 0.086, 0.102, 1],
  naturalStroke: [0.173, 0.208, 0.227, 1],
  naturalLabel: [0.55, 0.62, 0.65, 1],
  // Sharp (formerly black) keys: light pads, same gradient shape.
  sharpFill: [0.773, 0.808, 0.827, 1],
  sharpTop: [0.890, 0.910, 0.922, 1],
  sharpBottom: [0.773, 0.808, 0.827, 1],
  sharpStroke: [0.55, 0.60, 0.63, 1],
  sharpLabel: [0.086, 0.102, 0.118, 1],
  // Enabled notes: electric teal accent, flat glow (outset rect, not radial).
  electric: [0.239, 1, 0.816, 1],
  electricFillNatural: [0.055, 0.184, 0.173, 1],
  electricFillSharp: [0.847, 1, 0.965, 1],
  electricTopNatural: [0.090, 0.310, 0.270, 1],
  electricBottomNatural: [0.055, 0.184, 0.173, 1],
  electricTopSharp: [0.92, 1, 0.98, 1],
  electricBottomSharp: [0.847, 1, 0.965, 1],
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
 * Geometry comes from the shared Keyboard helper (same inset, sharp
 * centering, 62% sharp height, 10/16 sharp-to-natural width). Used by
 * both the GL draw and the pointer hit test.
 */
function nodeGraphPitchQuantizerKeyLayout(width, height) {
  const W = Math.max(1, Number(width) || 1);
  const H = Math.max(1, Number(height) || 1);
  const whitesSrc = nodeGraphPitchQuantizerGlWhites();
  const blacksSrc = nodeGraphPitchQuantizerGlBlacks();
  const names = nodeGraphPitchQuantizerGlNames();
  const blacks = blacksSrc.map((key) => ({
    leftWhiteIndex: key.leftWhiteIndex != null ? key.leftWhiteIndex : key.afterWhite,
  }));
  const computed = typeof nodeGraphPianoKeysComputeRects === "function"
    ? nodeGraphPianoKeysComputeRects({
      width: W,
      height: H,
      inModuleFace: true,
      whiteW: typeof NODE_GRAPH_PIANO_KEYS_DEFAULT_WHITE_W === "number" ? NODE_GRAPH_PIANO_KEYS_DEFAULT_WHITE_W : 16,
      blackW: typeof NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_W === "number" ? NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_W : 10,
      blackH: 0,
      blackKeyHeight: typeof NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT === "number"
        ? NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT
        : 62,
      totalUnits: Math.max(1, whitesSrc.length),
      leadPad: 0,
      whites: whitesSrc,
      blacks,
    })
    : { w: W, h: H, inset: 0, inModuleFace: true, whites: [], blacks: [] };
  const keys = [];
  computed.whites.forEach((r, i) => {
    const pc = whitesSrc[i];
    keys.push({
      pc,
      black: false,
      label: names[pc] || String(pc),
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      last: r.last,
    });
  });
  computed.blacks.forEach((r, i) => {
    if (!r) return;
    const src = blacksSrc[i];
    const pc = src.pitchClass;
    keys.push({
      pc,
      black: true,
      label: names[pc] || String(pc),
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
    });
  });
  return {
    width: computed.w,
    height: computed.h,
    inset: computed.inset,
    x0: computed.inset,
    y0: computed.inset,
    innerW: Math.max(0, computed.w - computed.inset * 2),
    innerH: Math.max(0, computed.h - computed.inset * 2),
    keys,
    computed,
  };
}

/** Hit test: sharps first (they overlap the natural key bed). */
function nodeGraphPitchQuantizerKeyAt(layout, x, y) {
  if (!layout) return null;
  if (typeof nodeGraphPianoKeysHit === "function" && layout.computed) {
    const hit = nodeGraphPianoKeysHit(layout.computed, x, y, { whiteYCheck: true });
    if (!hit) return null;
    const group = hit.black
      ? layout.keys.filter((k) => k.black)
      : layout.keys.filter((k) => !k.black);
    return group[hit.index] || null;
  }
  if (!Array.isArray(layout.keys)) return null;
  const blacks = layout.keys.filter((k) => k.black);
  const whites = layout.keys.filter((k) => !k.black);
  const inside = (key) => x >= key.x && x < key.x + key.w && y >= key.y && y < key.y + key.h;
  for (let i = blacks.length - 1; i >= 0; i -= 1) {
    if (inside(blacks[i])) return blacks[i];
  }
  for (let i = 0; i < whites.length; i += 1) {
    if (inside(whites[i])) return whites[i];
  }
  return null;
}

/** Visible natural seams (the lip below a sharp, or full height at E-F). */
function nodeGraphPitchQuantizerSeamRects(layout) {
  if (typeof nodeGraphPianoKeysVisibleSeamRects === "function" && layout?.computed) {
    return nodeGraphPianoKeysVisibleSeamRects(layout.computed);
  }
  return [];
}

if (typeof globalThis !== "undefined") {
  globalThis.NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  globalThis.nodeGraphPitchQuantizerKeyLayout = nodeGraphPitchQuantizerKeyLayout;
  globalThis.nodeGraphPitchQuantizerKeyAt = nodeGraphPitchQuantizerKeyAt;
  globalThis.nodeGraphPitchQuantizerSeamRects = nodeGraphPitchQuantizerSeamRects;
}

function nodeGraphPitchQuantizerKeyPaint(key, mask) {
  const L = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  const on = typeof nodeGraphPitchQuantizerMaskHasClass === "function"
    ? nodeGraphPitchQuantizerMaskHasClass(mask, key.pc)
    : false;
  const mix = typeof nodeGraphPianoKeysMix === "function"
    ? nodeGraphPianoKeysMix
    : (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  const over = typeof nodeGraphPianoKeysOver === "function"
    ? nodeGraphPianoKeysOver
    : (top, under) => [
      top[0] * top[3] + under[0] * (1 - top[3]),
      top[1] * top[3] + under[1] * (1 - top[3]),
      top[2] * top[3] + under[2] * (1 - top[3]),
      1,
    ];
  if (!key.black) {
    const top = on ? L.electricTopNatural : L.naturalTop;
    const bottom = on ? L.electricBottomNatural : L.naturalBottom;
    const mid = mix(top, bottom, 0.5);
    return {
      top,
      bottom,
      stroke: on ? 1 : 0,
      strokeRgba: on ? over(L.electric, mid) : mid,
      text: on ? L.electricLabelNatural : L.naturalLabel,
    };
  }
  const top = on ? L.electricTopSharp : L.sharpTop;
  const bottom = on ? L.electricBottomSharp : L.sharpBottom;
  const mid = mix(top, bottom, 0.5);
  const border = on ? L.electric : L.sharpStroke;
  return {
    top,
    bottom,
    stroke: 1,
    strokeRgba: over(border, mid),
    text: on ? L.electricLabelSharp : L.sharpLabel,
  };
}

function nodeGraphPitchQuantizerGlDrawKeys(batch, layout, mask, jacked, strokeDev) {
  const L = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  const stroke = Math.max(1, strokeDev | 0);
  const glowPad = Math.max(2, stroke * 2);
  const glowPadOuter = Math.max(4, stroke * 4);
  const has = (pc) => (typeof nodeGraphPitchQuantizerMaskHasClass === "function"
    ? nodeGraphPitchQuantizerMaskHasClass(mask, pc)
    : false);
  if (typeof nodeGraphGlLinesRect === "function") {
    for (const key of layout.keys) {
      if (!has(key.pc)) continue;
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
  const whites = layout.keys.filter((k) => !k.black);
  const blacks = layout.keys.filter((k) => k.black);
  const rects = new Map();
  for (const key of layout.keys) {
    rects.set(key, { x: key.x, y: key.y, w: key.w, h: key.h, last: key.last });
  }
  const geom = {
    w: layout.width,
    h: layout.height,
    inset: layout.inset,
    inModuleFace: true,
    rects,
  };
  if (typeof nodeGraphPianoKeysDraw !== "function") return false;
  return nodeGraphPianoKeysDraw(batch, geom, {
    x: 0,
    y: 0,
    w: layout.width,
    h: layout.height,
    look: {
      bed: L.bg,
      bedGlow: L.bedGlow,
      ring: jacked ? L.plateStrokeJacked : L.plateStroke,
      whiteSeam: L.seam,
    },
    whites,
    blacks,
    keys: layout.keys,
    labels: "name",
    totalUnits: Math.max(1, whites.length),
    labelSizeK: 1,
    labelFont: NODE_GRAPH_PITCH_QUANTIZER_GL_FONT,
    paintKey: (key) => nodeGraphPitchQuantizerKeyPaint(key, mask),
  });
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
    const layout = nodeGraphPitchQuantizerKeyLayout(bw, bh);
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
