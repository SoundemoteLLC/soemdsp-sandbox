// Keyboard face, drawn by WebGL (docs/APP_POLICY.md section 3).
// Key geometry, vertical gradients, rounded sharp bottoms, and seam layering
// live in public/lib/visual/piano-keys-draw.js and are shared with the
// Pitch Quantizer face. This file owns the Keyboard model and look table;
// key-state paint also lives in that helper so both faces share one path.
// Callers pass the Keyboard palette (which brightens an active key).
//
// No key elements exist. Each .node-keyboard-surface carries a key model
// (surface._midiKeyModel): one plain object per key with its MIDI note, its
// window index, white / black, its label text and its state set (active,
// held, ghost-play, chord-memory, ...). The layout pass
// (keyboard-layout-settings.js) turns the Display Settings numbers into one
// rect per key (model.geom, surface-local layout px). Both the GL draw and the
// pointer hit test read those same rects, so what is drawn is what is hit.
//
// Where it is drawn:
//   workspace + whole-module tiles: node-graph-gl-graph.js chrome pass
//   Mini Performance View: node-graph-gl-mini-perform.js keyboard tile
//   face-only tiles (layout canvas face, solo stage, metamodule stage): a face
//     canvas inside the surface, presented through the shared GL present path.

/** classList-shaped key state; any change schedules one repaint. */
class NodeGraphMidiKeyState {
  constructor() {
    this._on = new Set();
  }

  contains(name) {
    return this._on.has(name);
  }

  add(name) {
    if (this._on.has(name)) return;
    this._on.add(name);
    nodeGraphKeyboardRequestPaint();
  }

  remove(name) {
    if (!this._on.has(name)) return;
    this._on.delete(name);
    nodeGraphKeyboardRequestPaint();
  }

  toggle(name, force) {
    const on = force === undefined ? !this._on.has(name) : Boolean(force);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

/** The surface's key model, or null before its first render. */
function nodeGraphKeyboardKeyModel(surface) {
  return surface?._midiKeyModel || null;
}

/** Every key of every rendered piano Keyboard face (optionally one face / surface). */
function nodeGraphKeyboardAllKeys(root = null) {
  const scope = root && typeof root.querySelectorAll === "function" ? root : document;
  const surfaces = scope.matches?.(".node-keyboard-surface")
    ? [scope]
    : [...scope.querySelectorAll(".node-keyboard-module .node-keyboard-surface")];
  const out = [];
  for (const surface of surfaces) {
    const model = nodeGraphKeyboardKeyModel(surface);
    if (model) out.push(...model.keys);
  }
  return out;
}

/**
 * (Re)build one surface's key model from its window. Returns true when the
 * model changed. States start empty (the held / active / chord passes refill
 * them right after, as they did for the old spans).
 */
function nodeGraphKeyboardBuildKeyModel(surface, start, count, labels) {
  const sig = `${start}:${count}`;
  const prev = nodeGraphKeyboardKeyModel(surface);
  if (prev && prev.sig === sig) {
    nodeGraphKeyboardSetKeyLabels(surface, labels);
    return false;
  }
  const generated = nodeGraphKeyboardGenerateKeys(start, count);
  const keys = [];
  const add = (src, black) => {
    keys.push({
      surface,
      midi: src.midi,
      index: src.index,
      black,
      leftWhiteIndex: black ? src.leftWhiteIndex : -1,
      label: "",
      aria: "",
      state: new NodeGraphMidiKeyState(),
    });
  };
  for (const key of generated.whiteKeys) add(key, false);
  for (const key of generated.blackKeys) add(key, true);
  surface._midiKeyModel = {
    sig,
    start,
    count,
    keys,
    whites: keys.filter((k) => !k.black),
    blacks: keys.filter((k) => k.black),
    byMidi: new Map(keys.map((k) => [k.midi, k])),
    totalWhite: generated.totalWhite,
    leadPad: generated.leadPad || 0,
    trailPad: generated.trailPad || 0,
    totalUnits: generated.totalUnits || generated.totalWhite || 1,
    labels: "",
    geom: null,
  };
  nodeGraphKeyboardSetKeyLabels(surface, labels);
  nodeGraphKeyboardRequestPaint();
  return true;
}

/** Label text per key from the Labels setting (off / name / number). */
function nodeGraphKeyboardSetKeyLabels(surface, labels) {
  const model = nodeGraphKeyboardKeyModel(surface);
  if (!model) return;
  let changed = model.labels !== labels;
  model.labels = labels;
  for (const key of model.keys) {
    const text = typeof nodeGraphKeyboardKeyCapText === "function"
      ? nodeGraphKeyboardKeyCapText(key.midi, labels)
      : "";
    if (key.label !== text) {
      key.label = text;
      changed = true;
    }
    key.aria = typeof nodeGraphKeyboardPitchLabel === "function"
      ? `${nodeGraphKeyboardPitchLabel(key.midi)} / MIDI ${key.midi}`
      : `MIDI ${key.midi}`;
  }
  if (changed) nodeGraphKeyboardRequestPaint();
}

/**
 * Key rects from the layout numbers (the one source for draw and hit).
 * layout: { width, height, inModuleFace, whiteW, blackW, blackH, blackKeyHeight }
 * Rects are surface-local layout px (zoom 1). Returns true when they changed.
 */
function nodeGraphKeyboardLayoutKeyRects(surface, layout) {
  const model = nodeGraphKeyboardKeyModel(surface);
  if (!model || typeof nodeGraphPianoKeysComputeRects !== "function") return false;
  const computed = nodeGraphPianoKeysComputeRects({
    width: layout.width,
    height: layout.height,
    inModuleFace: layout.inModuleFace,
    whiteW: layout.whiteW,
    blackW: layout.blackW,
    blackH: layout.blackH,
    blackKeyHeight: layout.blackKeyHeight,
    totalUnits: model.totalUnits,
    leadPad: model.leadPad,
    whites: model.whites,
    blacks: model.blacks,
  });
  const W = computed.w;
  const H = computed.h;
  const rects = new Map();
  computed.whites.forEach((r, i) => {
    rects.set(model.whites[i], r);
  });
  computed.blacks.forEach((r, i) => {
    if (r) rects.set(model.blacks[i], r);
  });
  const sig = [W, H, model.sig, ...[...rects.values()].map((r) => `${r.x.toFixed(2)},${r.w.toFixed(2)},${r.h.toFixed(2)}`)].join("|");
  const changed = model.geom?.sig !== sig;
  model.geom = {
    sig,
    w: W,
    h: H,
    inset: computed.inset,
    inModuleFace: computed.inModuleFace,
    rects,
  };
  if (changed) {
    nodeGraphKeyboardRequestGlRebuild();
  }
  return changed;
}

/** Client-px mapping of one surface (post-transform: workspace zoom, tile scale). */
function nodeGraphKeyboardClientFrame(surface) {
  const model = nodeGraphKeyboardKeyModel(surface);
  const geom = model?.geom;
  if (!geom || !(geom.w > 0) || !(geom.h > 0)) return null;
  const rect = surface.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return { model, geom, rect, kx: rect.width / geom.w, ky: rect.height / geom.h };
}

/**
 * Key under client coordinates. A black key wins inside its rect; below it
 * the white at that X answers (front lip). Null on the empty lead / trail bed.
 */
function nodeGraphKeyboardKeyAtClient(surface, clientX, clientY) {
  const frame = nodeGraphKeyboardClientFrame(surface);
  if (!frame) return null;
  const x = (clientX - frame.rect.left) / frame.kx;
  const y = (clientY - frame.rect.top) / frame.ky;
  for (const key of frame.model.blacks) {
    const r = frame.geom.rects.get(key);
    if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return key;
  }
  for (const key of frame.model.whites) {
    const r = frame.geom.rects.get(key);
    if (r && x >= r.x && x < r.x + r.w) return key;
  }
  return null;
}

/** One key's rect in client px (DOMRect-shaped), or null. */
function nodeGraphKeyboardKeyClientRect(key) {
  const frame = key?.surface ? nodeGraphKeyboardClientFrame(key.surface) : null;
  const r = frame?.geom.rects.get(key);
  if (!r) return null;
  const left = frame.rect.left + r.x * frame.kx;
  const top = frame.rect.top + r.y * frame.ky;
  const width = r.w * frame.kx;
  const height = r.h * frame.ky;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

// ---------------------------------------------------------------- repaint

let nodeGraphKeyboardPaintFrame = 0;

/** Key state / labels changed: repaint every place that draws a keyboard, once per frame. */
function nodeGraphKeyboardRequestPaint() {
  if (nodeGraphKeyboardPaintFrame || typeof requestAnimationFrame !== "function") return;
  nodeGraphKeyboardPaintFrame = requestAnimationFrame(() => {
    nodeGraphKeyboardPaintFrame = 0;
    if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
    if (typeof nodeGraphMiniPerformShown === "function" && nodeGraphMiniPerformShown()
      && typeof nodeGraphGlMiniPerformPresent === "function") {
      nodeGraphGlMiniPerformPresent();
    }
    nodeGraphKeyboardPresentFaceCanvases();
  });
}

let nodeGraphKeyboardChromeFrame = 0;

/** Key rects moved / resized: the GL chrome cache holds the surface boxes, rebuild it. */
function nodeGraphKeyboardRequestGlRebuild() {
  if (nodeGraphKeyboardChromeFrame || typeof requestAnimationFrame !== "function") return;
  nodeGraphKeyboardChromeFrame = requestAnimationFrame(() => {
    nodeGraphKeyboardChromeFrame = 0;
    if (typeof nodeGraphGlGraphRebuildChrome === "function") nodeGraphGlGraphRebuildChrome();
    nodeGraphKeyboardRequestPaint();
  });
}

// ---------------------------------------------------------------- look

function nodeGraphKeyboardHex(hex, alpha = 1) {
  return nodeGraphPianoKeysHex(hex, alpha);
}

function nodeGraphKeyboardRgba(r, g, b, a = 1) {
  return nodeGraphPianoKeysRgba(r, g, b, a);
}

/** `top` composited over an opaque `under` (straight alpha). */
function nodeGraphKeyboardOver(top, under) {
  return nodeGraphPianoKeysOver(top, under);
}

function nodeGraphKeyboardMix(a, b, t) {
  return nodeGraphPianoKeysMix(a, b, t);
}

// The old styles.css key gradients (top stop, bottom stop) and label colours.
const NODE_GRAPH_MIDI_KEY_LOOK = (() => {
  const hex = nodeGraphKeyboardHex;
  const rgba = nodeGraphKeyboardRgba;
  return Object.freeze({
    bed: hex("050607"),
    bedGlow: rgba(241, 184, 75, 0.06),
    ring: rgba(243, 241, 236, 0.16),
    whiteSeam: rgba(5, 6, 7, 0.72),
    white: {
      base: { top: hex("f7f2e8"), bottom: hex("a79f93"), text: rgba(5, 6, 7, 0.92) },
      blue: { top: hex("7edcff"), bottom: hex("0a3f9a"), text: hex("eaf8ff"), inset: rgba(207, 246, 255, 0.82) },
      gold: { top: hex("ffcf6b"), bottom: hex("7a3f06"), text: hex("1a1200"), inset: rgba(255, 226, 173, 0.82) },
      green: { top: hex("7dffb0"), bottom: hex("0a4a28"), text: hex("041a0c"), inset: rgba(180, 255, 210, 0.82) },
      slot: { top: hex("c8ffd8"), bottom: hex("0d6b38"), text: hex("041a0c"), inset: rgba(230, 255, 240, 0.95) },
      red: { top: hex("ff8a8a"), bottom: hex("7a1010"), text: hex("2a0606"), inset: rgba(255, 210, 210, 0.85) },
    },
    black: {
      base: { top: hex("20252a"), bottom: hex("090b0e"), text: rgba(243, 241, 236, 0.82), border: rgba(127, 199, 217, 0.25) },
      ghostBase: { top: hex("2a2a2c"), bottom: hex("111113") },
      blue: { top: hex("236ec9"), bottom: hex("081a43"), text: hex("eaf8ff"), border: rgba(118, 215, 255, 0.96) },
      gold: { top: hex("c9760f"), bottom: hex("4a2604"), text: hex("1a1200"), border: rgba(255, 200, 110, 0.96) },
      green: { top: hex("1f9a55"), bottom: hex("062818"), text: hex("041a0c"), border: rgba(120, 255, 180, 0.96) },
      slot: { top: hex("3dff8a"), bottom: hex("0a4a28"), text: hex("041a0c"), border: rgba(230, 255, 240, 0.98) },
      red: { top: hex("c62828"), bottom: hex("4a0a0a"), text: hex("ffffff"), border: rgba(255, 170, 170, 0.96) },
    },
    ghost: {
      play: rgba(74, 163, 255, 0.45),
      chord: { top: rgba(61, 220, 132, 0.28), bottom: rgba(31, 154, 85, 0.16), ring: rgba(61, 220, 132, 0.38) },
      patch: { top: rgba(255, 120, 120, 0.28), bottom: rgba(220, 90, 90, 0.16), ring: rgba(255, 120, 120, 0.38) },
      patchSet: { top: rgba(255, 170, 170, 0.72), bottom: rgba(220, 90, 90, 0.34) },
      blackChord: { top: rgba(61, 220, 132, 0.32), bottom: rgba(31, 154, 85, 0.18), border: rgba(125, 255, 176, 0.45) },
      blackPatch: { top: rgba(255, 120, 120, 0.32), bottom: rgba(220, 90, 90, 0.18), border: rgba(255, 170, 170, 0.45) },
      blackPatchSet: { top: rgba(255, 140, 140, 0.55), bottom: rgba(90, 18, 18, 0.92), border: rgba(255, 160, 160, 0.7) },
    },
    // Outer marks the old box-shadow rings carried (2px), drawn inside the key.
    goldRing: rgba(241, 184, 75, 0.55),
    greenRing: rgba(61, 220, 132, 0.9),
    slotEditRing: hex("f4fff4"),
  });
})();

/**
 * Fill / stroke / text for one key from its state, in the old CSS precedence.
 * Returns { top, bottom, stroke, strokeRgba, text } (stroke in layout px).
 */
function nodeGraphKeyboardKeyPaint(key, wideLabels) {
  return nodeGraphPianoKeysPaint(NODE_GRAPH_MIDI_KEY_LOOK, key.state, {
    black: key.black,
    wideLabels,
  });
}

const NODE_GRAPH_MIDI_KEY_LABEL_FONT = "\"Cascadia Mono\", Consolas, monospace";

/**
 * Draw one keyboard surface into a gl-line-renderer batch at (x, y, w, h)
 * in batch units (the caller's screen / tile / canvas px).
 */
function nodeGraphKeyboardGlDraw(batch, surface, x, y, w, h) {
  const model = nodeGraphKeyboardKeyModel(surface);
  const geom = model?.geom;
  if (!batch || !geom || !(geom.w > 0) || !(geom.h > 0) || !(w > 0) || !(h > 0)) return false;
  if (typeof nodeGraphPianoKeysDraw !== "function") return false;
  const L = NODE_GRAPH_MIDI_KEY_LOOK;
  const sizeK = Math.max(0.5, Math.min(4, (Number(model.keys[0]?.surface?.dataset?.keyLabelSize) || 100) / 100));
  const textOpts = typeof nodeGraphGlGraphTextOpts === "function" ? nodeGraphGlGraphTextOpts : (o) => o;
  return nodeGraphPianoKeysDraw(batch, geom, {
    x,
    y,
    w,
    h,
    look: L,
    whites: model.whites,
    blacks: model.blacks,
    keys: model.keys,
    labels: model.labels,
    totalUnits: model.totalUnits,
    labelSizeK: sizeK,
    labelFont: NODE_GRAPH_MIDI_KEY_LABEL_FONT,
    paintKey: (key) => nodeGraphKeyboardKeyPaint(key, geom.w >= 520),
    textOpts,
  });
}

// ---------------------------------------------------------------- face canvases

/** Faces shown outside the GL graph pass (no plate pass draws them there). */
function nodeGraphKeyboardNeedsFaceCanvas(surface) {
  if (!surface?.isConnected) return false;
  if (surface.closest(".node-whole-module-face")) return false;
  return Boolean(surface.closest(".node-layout-canvas-face, .node-screen-solo-stage, .node-metamodule-canvas-stage"));
}

/** Present every face-canvas keyboard (WebGL batch -> the shared present into its canvas). */
function nodeGraphKeyboardPresentFaceCanvases() {
  if (typeof document === "undefined" || typeof nodeGraphGlLinesBegin !== "function") return;
  document.querySelectorAll(".node-keyboard-module .node-keyboard-surface").forEach((surface) => {
    let canvas = surface.querySelector(":scope > canvas.node-keyboard-face-canvas");
    if (!nodeGraphKeyboardNeedsFaceCanvas(surface)) {
      if (canvas) canvas.hidden = true;
      return;
    }
    const geom = nodeGraphKeyboardKeyModel(surface)?.geom;
    const cssW = surface.clientWidth;
    const cssH = surface.clientHeight;
    if (!geom || !(cssW > 0) || !(cssH > 0)) return;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "node-keyboard-face-canvas";
      canvas.setAttribute("aria-hidden", "true");
      surface.append(canvas);
    }
    canvas.hidden = false;
    // Device px from the on-screen size (tiles scale the face).
    const rect = surface.getBoundingClientRect();
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const scale = Math.max(0.25, (rect.width / cssW) * dpr);
    const pw = Math.max(1, Math.round(cssW * scale));
    const ph = Math.max(1, Math.round(cssH * scale));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale, transparent: true, publishNodeId: "" });
    if (!batch) return;
    nodeGraphKeyboardGlDraw(batch, surface, 0, 0, cssW, cssH);
    nodeGraphGlLinesEnd(batch, "alpha");
  });
}
