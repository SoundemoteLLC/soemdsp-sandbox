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
  // Disabled naturals: near-black pads, Keyboard-style top-to-bottom gradient.
  naturalFill: [0.035, 0.040, 0.046, 1],
  naturalTop: [0.070, 0.078, 0.086, 1],
  naturalBottom: [0.035, 0.040, 0.046, 1],
  naturalStroke: [0.12, 0.14, 0.15, 1],
  naturalLabel: [0.42, 0.46, 0.48, 1],
  // Disabled sharps: dim desaturated grey, still lighter than naturals.
  sharpFill: [0.28, 0.30, 0.32, 1],
  sharpTop: [0.40, 0.42, 0.44, 1],
  sharpBottom: [0.28, 0.30, 0.32, 1],
  sharpStroke: [0.18, 0.20, 0.21, 1],
  sharpLabel: [0.10, 0.11, 0.12, 1],
  // Enabled notes: solid bright teal fill plus electric stroke, flat glow.
  electric: [0.239, 1, 0.816, 1],
  electricFillNatural: [0.12, 0.78, 0.62, 1],
  electricFillSharp: [0.16, 0.85, 0.68, 1],
  electricTopNatural: [0.22, 0.98, 0.80, 1],
  electricBottomNatural: [0.12, 0.78, 0.62, 1],
  electricTopSharp: [0.28, 1.00, 0.84, 1],
  electricBottomSharp: [0.16, 0.85, 0.68, 1],
  electricLabelNatural: [0.02, 0.10, 0.08, 1],
  electricLabelSharp: [0.02, 0.10, 0.08, 1],
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

function nodeGraphPitchQuantizerDarkenRgba(rgba, amount) {
  const t = Math.max(0, Math.min(1, Number(amount) || 0));
  return [rgba[0] * (1 - t), rgba[1] * (1 - t), rgba[2] * (1 - t), rgba[3]];
}

/**
 * Keyboard-shaped look tables for the shared state-paint path. Idle
 * (disabled: near-black naturals, dim grey sharps) and enabled (solid
 * bright teal fill plus stroke) each have a base plus an inverted "blue"
 * (active) slot: where Keyboard brightens a sounding key, these darken it
 * and add a dark ring so the live class stays distinct from the teal.
 */
function nodeGraphPitchQuantizerPaintLooks() {
  const L = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  const darkRing = [0.02, 0.05, 0.05, 0.85];
  const darkTealRing = [0.02, 0.12, 0.10, 0.88];
  return {
    idle: {
      white: {
        base: { top: L.naturalTop, bottom: L.naturalBottom, text: L.naturalLabel },
        blue: {
          top: nodeGraphPitchQuantizerDarkenRgba(L.naturalTop, 0.55),
          bottom: nodeGraphPitchQuantizerDarkenRgba(L.naturalBottom, 0.7),
          text: L.naturalLabel,
          inset: darkRing,
        },
      },
      black: {
        base: { top: L.sharpTop, bottom: L.sharpBottom, text: L.sharpLabel, border: L.sharpStroke },
        blue: {
          top: nodeGraphPitchQuantizerDarkenRgba(L.sharpTop, 0.55),
          bottom: nodeGraphPitchQuantizerDarkenRgba(L.sharpBottom, 0.65),
          text: [0.90, 0.93, 0.94, 1],
          border: darkRing,
        },
      },
    },
    enabled: {
      white: {
        base: {
          top: L.electricTopNatural,
          bottom: L.electricBottomNatural,
          text: L.electricLabelNatural,
          inset: L.electric,
        },
        blue: {
          top: nodeGraphPitchQuantizerDarkenRgba(L.electricTopNatural, 0.5),
          bottom: nodeGraphPitchQuantizerDarkenRgba(L.electricBottomNatural, 0.65),
          text: L.electricLabelNatural,
          inset: darkTealRing,
        },
      },
      black: {
        base: {
          top: L.electricTopSharp,
          bottom: L.electricBottomSharp,
          text: L.electricLabelSharp,
          border: L.electric,
        },
        blue: {
          top: nodeGraphPitchQuantizerDarkenRgba(L.electricTopSharp, 0.5),
          bottom: nodeGraphPitchQuantizerDarkenRgba(L.electricBottomSharp, 0.6),
          text: [0.85, 1, 0.96, 1],
          border: darkTealRing,
        },
      },
    },
  };
}

/**
 * Live quantized pitch class from the module's `pitch` scope buffer, only
 * while the engine is playing. Cleared when stopped so the face does not
 * freeze a stale note (audio-only-during-play).
 */
function nodeGraphPitchQuantizerLivePitchClass(nodeId) {
  const playing = typeof scopePaintIsEnginePlaying === "function"
    && scopePaintIsEnginePlaying();
  if (!playing) return null;
  if (typeof nodeGraphModuleScopeLatestOutputValue !== "function") return null;
  const pitch = Number(nodeGraphModuleScopeLatestOutputValue(nodeId, "pitch", Number.NaN));
  if (!Number.isFinite(pitch)) return null;
  return (((Math.round(pitch) % 12) + 12) % 12);
}

function nodeGraphPitchQuantizerFacePaintSig(bw, bh, strokeDev, mask, jacked, livePc) {
  const liveSig = livePc == null ? "-" : String(livePc);
  return `${Math.max(1, bw | 0)}x${Math.max(1, bh | 0)}:s${Math.max(1, strokeDev | 0)}:m${mask}:j${jacked ? 1 : 0}:p${liveSig}`;
}

function nodeGraphPitchQuantizerKeyPaint(key, mask, livePc) {
  const looks = nodeGraphPitchQuantizerPaintLooks();
  const on = typeof nodeGraphPitchQuantizerMaskHasClass === "function"
    ? nodeGraphPitchQuantizerMaskHasClass(mask, key.pc)
    : false;
  const live = livePc != null && Number(livePc) === Number(key.pc);
  const look = on ? looks.enabled : looks.idle;
  const state = typeof nodeGraphPianoKeysFlagState === "function"
    ? nodeGraphPianoKeysFlagState({ active: live })
    : { contains: (name) => name === "active" && live };
  return nodeGraphPianoKeysPaint(look, state, { black: key.black, wideLabels: true });
}

function nodeGraphPitchQuantizerGlDrawKeys(batch, layout, mask, jacked, strokeDev, livePc) {
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
    paintKey: (key) => nodeGraphPitchQuantizerKeyPaint(key, mask, livePc),
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
    const livePc = nodeGraphPitchQuantizerLivePitchClass(nodeId);
    return { mask, jacked, shift, livePc };
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
    const { mask, jacked, livePc } = faceState();
    const m = typeof nodeGraphDisplayCanvasSize === "function"
      ? nodeGraphDisplayCanvasSize(section, canvas)
      : null;
    if (!m) return;
    const dpr = Math.max(1, m.pixelRatio || 1);
    const bw = Math.max(1, m.width);
    const bh = Math.max(1, m.height);
    const strokeDev = Math.max(1, Math.round(dpr));
    const sig = nodeGraphPitchQuantizerFacePaintSig(bw, bh, strokeDev, mask, jacked, livePc);
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
    nodeGraphPitchQuantizerGlDrawKeys(batch, layout, mask, jacked, strokeDev, livePc);
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
