// Shared piano-key geometry, hit test, and WebGL draw
// (docs/APP_POLICY.md section 3 / circuit-builder displays).
//
// Used by the Keyboard signal-source face (keyboard-face-gl.js) and the
// Pitch Quantizer scale face. The Keyboard look -- vertical key gradients,
// square natural pads, sharps with rounded bottoms, 1px natural seams drawn
// under fully opaque sharps -- is the starting point. Palettes are passed
// in so Pitch Quantizer can invert the keys without a second draw path.

const NODE_GRAPH_PIANO_KEYS_INSET_FRAC = 0.00101627;
const NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT = 62;
const NODE_GRAPH_PIANO_KEYS_DEFAULT_WHITE_W = 16;
const NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_W = 10;
const NODE_GRAPH_PIANO_KEYS_LABEL_FONT = "\"Cascadia Mono\", Consolas, monospace";
const NODE_GRAPH_PIANO_KEYS_WHITE_LABEL_CQI = 0.17560976;
const NODE_GRAPH_PIANO_KEYS_BLACK_LABEL_CQI = 0.14146342;
const NODE_GRAPH_PIANO_KEYS_LABEL_CHAR_ASPECT = 0.62;

function nodeGraphPianoKeysHex(hex, alpha = 1) {
  const h = String(hex).replace("#", "");
  return [
    Number.parseInt(h.slice(0, 2), 16) / 255,
    Number.parseInt(h.slice(2, 4), 16) / 255,
    Number.parseInt(h.slice(4, 6), 16) / 255,
    alpha,
  ];
}

function nodeGraphPianoKeysRgba(r, g, b, a = 1) {
  return [r / 255, g / 255, b / 255, a];
}

/** `top` composited over an opaque `under` (straight alpha). */
function nodeGraphPianoKeysOver(top, under) {
  const a = top[3];
  return [
    top[0] * a + under[0] * (1 - a),
    top[1] * a + under[1] * (1 - a),
    top[2] * a + under[2] * (1 - a),
    1,
  ];
}

function nodeGraphPianoKeysMix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/**
 * Key rectangles in layout px. Same numbers the Keyboard face has always used.
 * opts: { width, height, inModuleFace, whiteW, blackW, blackH, blackKeyHeight,
 *         totalUnits, leadPad, whites, blacks: [{ leftWhiteIndex }], flushEdge }
 * Returns { w, h, inset, inModuleFace, whites: [{x,y,w,h,last}], blacks: [rect|null] }.
 * flushEdge: Pitch Quantizer only. Keys start at y=0 / x=0 with no bed inset.
 * Keyboard omits it so the golden draw stays identical.
 */
function nodeGraphPianoKeysComputeRects(opts) {
  const layout = opts || {};
  const W = Math.max(0, Number(layout.width) || 0);
  const H = Math.max(0, Number(layout.height) || 0);
  const inset = layout.flushEdge === true ? 0 : W * NODE_GRAPH_PIANO_KEYS_INSET_FRAC;
  const iw = Math.max(0, W - inset * 2);
  const ih = Math.max(0, H - inset * 2);
  const whitesIn = Array.isArray(layout.whites) ? layout.whites : [];
  const blacksIn = Array.isArray(layout.blacks) ? layout.blacks : [];
  const units = Math.max(1, Number(layout.totalUnits) || whitesIn.length || 1);
  const unitW = iw / units;
  const lead = Number(layout.leadPad) || 0;
  const whites = whitesIn.map((_, i) => ({
    x: inset + (lead + i) * unitW,
    y: inset,
    w: unitW,
    h: ih,
    last: i === whitesIn.length - 1,
  }));
  const whiteW = Math.max(1, Number(layout.whiteW) || NODE_GRAPH_PIANO_KEYS_DEFAULT_WHITE_W);
  const blackW = Math.max(1, Number(layout.blackW) || NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_W);
  const widthFrac = Math.min(0.9 / units, (blackW / whiteW) / units);
  const bw = widthFrac * iw;
  const pct = Math.max(28, Math.min(82, Number(layout.blackKeyHeight) || NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT));
  const blackH = Number(layout.blackH) || 0;
  const bh = Math.max(0, (layout.inModuleFace || !(blackH > 0))
    ? Math.min(ih * (pct / 100), ih - 12)
    : Math.min(blackH, ih));
  const blacks = blacksIn.map((key) => {
    const leftIdx = key.leftWhiteIndex;
    if (!(leftIdx >= 0 || (leftIdx === -1 && lead > 0))) return null;
    let centre = ((leftIdx + 1 + lead) / units) * iw;
    centre = Math.max(bw * 0.5, Math.min(iw - bw * 0.5, centre));
    return { x: inset + centre - bw * 0.5, y: inset, w: bw, h: bh };
  });
  return { w: W, h: H, inset, inModuleFace: Boolean(layout.inModuleFace), whites, blacks };
}

/**
 * Hit test in layout px. Sharps win inside their rect; below a sharp the
 * natural at that X answers (front lip).
 * opts.whiteYCheck: if true (Pitch Quantizer), naturals must also contain Y.
 * The Keyboard omits the Y check, matching its existing pointer path.
 */
function nodeGraphPianoKeysHit(computed, x, y, opts = {}) {
  if (!computed) return null;
  const whites = computed.whites || [];
  const blacks = computed.blacks || [];
  for (let i = 0; i < blacks.length; i += 1) {
    const r = blacks[i];
    if (r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      return { index: i, black: true, rect: r };
    }
  }
  const checkY = Boolean(opts && opts.whiteYCheck);
  for (let i = 0; i < whites.length; i += 1) {
    const r = whites[i];
    if (r && x >= r.x && x < r.x + r.w && (!checkY || (y >= r.y && y < r.y + r.h))) {
      return { index: i, black: false, rect: r };
    }
  }
  return null;
}

/**
 * The 1px natural-key seams the Keyboard draws (full height of the natural,
 * at the shared edge). The draw path paints these first, then fully opaque
 * sharps on top, so they never show through a sharp pad.
 */
function nodeGraphPianoKeysSeamRects(computed) {
  if (!computed || !Array.isArray(computed.whites)) return [];
  const seams = [];
  for (const r of computed.whites) {
    if (!r || r.last) continue;
    seams.push({ x: r.x + r.w - 1, y: r.y, w: 1, h: r.h });
  }
  return seams;
}

/**
 * The part of each natural seam that is not covered by a sharp key rect
 * (the lip below the sharp, or the full height at a joint with no sharp).
 */
function nodeGraphPianoKeysVisibleSeamRects(computed) {
  const sharps = (computed && computed.blacks) || [];
  const visible = [];
  for (const seam of nodeGraphPianoKeysSeamRects(computed)) {
    let y0 = seam.y;
    const y1 = seam.y + seam.h;
    const midX = seam.x + seam.w * 0.5;
    for (const sharp of sharps) {
      if (sharp && sharp.x < midX + 0.5 && sharp.x + sharp.w > midX - 0.5) {
        y0 = Math.max(y0, sharp.y + sharp.h);
      }
    }
    const h = y1 - y0;
    if (h > 0) visible.push({ x: seam.x, y: y0, w: seam.w, h });
  }
  return visible;
}

/**
 * Draw a keyboard bed + keys into a gl-line-renderer batch at (opts.x, y, w, h)
 * in batch units. Geometry and layering match the Keyboard face exactly:
 * bed, bed glow, naturals + full-height seams, then opaque rounded sharps,
 * then the plate ring, then labels.
 *
 * opts: { x, y, w, h, look: { bed, bedGlow, ring, whiteSeam }, whites, blacks,
 *         keys, labels, totalUnits, labelSizeK, labelFont, paintKey, textOpts }
 * geom: { w, h, inset, inModuleFace, rects: Map(key -> {x,y,w,h,last}) }
 */
/**
 * Label size in destination px. Default is the Keyboard CQI path (one size
 * for all naturals, one for all sharps). labelFit: "width" sizes each label
 * to nearly fill that key's width, with a small margin, capped by the natural
 * lower-lip height or the sharp's height so it stays in its area.
 */
function nodeGraphPianoKeysLabelPx(key, r, o, geom, sx, sy) {
  const opts = o || {};
  const sizeK = Math.max(0.5, Math.min(4, Number(opts.labelSizeK) || 1));
  const units = Math.max(1, Number(opts.totalUnits) || 1);
  const scaleX = Number(sx) || 1;
  const scaleY = Number(sy) || scaleX;
  if (opts.labelFit === "width" && r) {
    const margin = Number.isFinite(Number(opts.labelMargin)) ? Math.max(0, Number(opts.labelMargin)) : 1;
    const maxW = Math.max(1, (r.w - margin * 2) * scaleX);
    const chars = Math.max(1, String(key && key.label != null ? key.label : "").length);
    const aspect = Number.isFinite(Number(opts.labelCharAspect))
      ? Math.max(0.3, Number(opts.labelCharAspect))
      : NODE_GRAPH_PIANO_KEYS_LABEL_CHAR_ASPECT;
    const pxByW = maxW / (chars * aspect);
    const sharpFrac = Number.isFinite(Number(opts.sharpHeightFrac))
      ? Number(opts.sharpHeightFrac)
      : (typeof NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT === "number"
        ? NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT / 100
        : 0.62);
    const lipFrac = Math.max(0.08, 1 - sharpFrac);
    const maxH = key && key.black
      ? Math.max(1, (r.h - margin * 2) * scaleY)
      : Math.max(1, (r.h * lipFrac - margin * 2) * scaleY);
    return Math.max(1, Math.min(pxByW, maxH) * sizeK);
  }
  const cqi = (key && key.black)
    ? NODE_GRAPH_PIANO_KEYS_BLACK_LABEL_CQI
    : NODE_GRAPH_PIANO_KEYS_WHITE_LABEL_CQI;
  const gw = geom && geom.w ? geom.w : 0;
  return (cqi * gw / units) * scaleX * sizeK;
}

function nodeGraphPianoKeysDraw(batch, geom, opts) {
  const o = opts || {};
  const x = Number(o.x) || 0;
  const y = Number(o.y) || 0;
  const w = Number(o.w) || 0;
  const h = Number(o.h) || 0;
  if (!batch || !geom || !(geom.w > 0) || !(geom.h > 0) || !(w > 0) || !(h > 0)) return false;
  if (typeof nodeGraphGlLinesRoundRect !== "function") return false;
  const L = o.look || {};
  const sx = w / geom.w;
  const sy = h / geom.h;
  const rr = (rx, ry, rw, rh, spec) => nodeGraphGlLinesRoundRect(batch, x + rx * sx, y + ry * sy, rw * sx, rh * sy, spec);
  const outerRadius = 6 * Math.min(sx, sy);
  rr(0, 0, geom.w, geom.h, { radius: geom.inModuleFace ? 0 : outerRadius, fill: L.bed, feather: 1 });
  if (L.bedGlow) {
    rr(0, 0, geom.w, geom.h * 0.34, {
      radius: 0, fill: L.bedGlow, fillBottom: [L.bedGlow[0], L.bedGlow[1], L.bedGlow[2], 0], feather: 0,
    });
  }
  const paintKey = typeof o.paintKey === "function" ? o.paintKey : () => ({
    top: [0, 0, 0, 1],
    bottom: [0, 0, 0, 1],
    stroke: 0,
    strokeRgba: [0, 0, 0, 1],
    text: [1, 1, 1, 1],
  });
  const rectOf = (key) => (geom.rects ? geom.rects.get(key) : (key && key.rect));
  const whites = o.whites || [];
  const blacks = o.blacks || [];
  for (const key of whites) {
    const r = rectOf(key);
    if (!r) continue;
    const paint = paintKey(key);
    rr(r.x, r.y, r.w, r.h, {
      radius: 0,
      fill: paint.top,
      fillBottom: paint.bottom,
      stroke: paint.stroke * Math.min(sx, sy),
      strokeRgba: paint.strokeRgba,
      feather: 0.75,
    });
    if (!r.last) {
      rr(r.x + r.w - 1, r.y, 1, r.h, { radius: 0, fill: L.whiteSeam, feather: 0.5 });
    }
  }
  for (const key of blacks) {
    const r = rectOf(key);
    if (!r) continue;
    const paint = paintKey(key);
    rr(r.x, r.y, r.w, r.h, {
      // Only the corners are round: the radius never passes a fifth of the key, so a narrow key (all 128 shown) is not a pill.
      radius: Math.min(4 * Math.min(sx, sy), 0.2 * r.w * sx, 0.2 * r.h * sy),
      radiusTop: 0,
      fill: paint.top,
      fillBottom: paint.bottom,
      stroke: paint.stroke * Math.min(sx, sy),
      strokeRgba: paint.strokeRgba,
      feather: 1,
    });
  }
  if (L.ring) {
    const ringStroke = Number.isFinite(Number(o.ringStroke))
      ? Math.max(0, Number(o.ringStroke))
      : Math.max(0.75, geom.inset * Math.min(sx, sy));
    if (ringStroke > 0) {
      rr(0, 0, geom.w, geom.h, {
        radius: outerRadius,
        stroke: ringStroke,
        fill: [0, 0, 0, 0],
        strokeRgba: L.ring,
        feather: 1,
      });
    }
  }
  if (o.labels && o.labels !== "off" && Array.isArray(o.keys) && typeof nodeGraphGlLinesText === "function") {
    const units = Math.max(1, o.totalUnits || 1);
    const sizeK = Math.max(0.5, Math.min(4, Number(o.labelSizeK) || 1));
    const whitePx = (NODE_GRAPH_PIANO_KEYS_WHITE_LABEL_CQI * geom.w / units) * sx * sizeK;
    const blackPx = (NODE_GRAPH_PIANO_KEYS_BLACK_LABEL_CQI * geom.w / units) * sx * sizeK;
    const fitWidth = o.labelFit === "width";
    const textOpts = typeof o.textOpts === "function" ? o.textOpts : (spec) => spec;
    const family = o.labelFont || NODE_GRAPH_PIANO_KEYS_LABEL_FONT;
    for (const key of o.keys) {
      const r = rectOf(key);
      if (!r || !key.label) continue;
      const px = fitWidth
        ? nodeGraphPianoKeysLabelPx(key, r, o, geom, sx, sy)
        : (key.black ? blackPx : whitePx);
      if (px < 1) continue;
      const paint = paintKey(key);
      nodeGraphGlLinesText(batch, key.label, x + (r.x + r.w * 0.5) * sx, y + (r.y + r.h - (key.black ? 2 : 1)) * sy, textOpts({
        px,
        rgba: paint.text,
        align: "center",
        baseline: "bottom",
        weight: 700,
        family,
        maxWidth: Math.max(1, (r.w - 2) * sx),
      }));
    }
  }
  return true;
}


/**
 * ClassList-shaped state bag so callers can pass a plain flags object
 * (`{ active: true }`) into nodeGraphPianoKeysPaint, the same path Keyboard
 * uses with its key.state.contains() set.
 */
function nodeGraphPianoKeysFlagState(flags) {
  const bag = flags && typeof flags === "object" ? flags : {};
  return {
    contains: (name) => Boolean(bag[name]),
  };
}

/**
 * Shared key-state paint. Maps a look table plus state flags to a vertical
 * gradient, optional ring stroke, and label colour. Keyboard and Pitch
 * Quantizer both call this; they only differ in the look they pass.
 * Keyboard brightens an active (pressed/held) key. Pitch Quantizer uses the
 * same path with a swapped unlit palette and a bright playing highlight.
 */
function nodeGraphPianoKeysPaint(look, state, opts) {
  const L = look || {};
  const s = state;
  const has = (name) => Boolean(
    s && typeof s.contains === "function" ? s.contains(name) : s && s[name],
  );
  const black = Boolean(opts && opts.black);
  const wideLabels = Boolean(opts && opts.wideLabels);
  if (!black) {
    const W = L.white || {};
    let style = W.base || {};
    let ring = null;
    let ringPx = 1;
    let top = null;
    let bottom = null;
    if (has("chord-edit-note")) style = W.red;
    else if (has("slot-edit")) { style = W.slot; ring = L.slotEditRing; ringPx = 2; }
    else if (has("chord-memory") && has("slot-on")) style = W.slot;
    else if (has("chord-memory") && has("active")) { style = W.blue; ring = L.greenRing; ringPx = 2; }
    else if (has("chord-memory") && has("held")) { style = W.gold; ring = L.greenRing; ringPx = 2; }
    else if (has("chord-memory")) style = W.green;
    else if (has("held") && has("active")) { style = W.blue; ring = L.goldRing; ringPx = 2; }
    else if (has("held")) style = W.gold;
    else if (has("active")) style = W.blue;
    else if (has("ghost-chord") && !has("slot-on")) {
      top = nodeGraphPianoKeysOver(L.ghost.chord.top, W.base.top);
      bottom = nodeGraphPianoKeysOver(L.ghost.chord.bottom, W.base.bottom);
      ring = L.ghost.chord.ring;
      ringPx = 2;
    }
    if (!ring && style && style.inset) ring = style.inset;
    // MIDI / chord Play Keys ghost: the sequencer.css inset ring (not on gold / chord slots).
    if (has("ghost-play") && !has("held") && !has("chord-memory")) { ring = L.ghost.play; ringPx = 2; }
    top = top || (style && style.top);
    bottom = bottom || (style && style.bottom);
    const mid = nodeGraphPianoKeysMix(top, bottom, 0.5);
    return {
      top,
      bottom,
      stroke: ring ? ringPx : 0,
      strokeRgba: ring ? nodeGraphPianoKeysOver(ring, mid) : mid,
      text: style && style.text,
    };
  }
  const B = L.black || {};
  let style = B.base || {};
  let top = null;
  let bottom = null;
  let border = null;
  let ringPx = 1;
  if (has("chord-edit-note")) style = B.red;
  else if (has("slot-edit")) { style = B.slot; border = L.slotEditRing; ringPx = 2; }
  else if (has("chord-memory") && has("slot-on")) style = B.slot;
  else if (has("chord-memory") && has("active")) { style = B.blue; border = L.greenRing; ringPx = 2; }
  else if (has("chord-memory") && has("held")) { style = B.gold; border = L.greenRing; ringPx = 2; }
  else if (has("chord-memory")) style = B.green;
  else if (has("held") && has("active")) { style = B.blue; border = L.goldRing; ringPx = 2; }
  else if (has("held")) style = B.gold;
  else if (has("active")) style = B.blue;
  else if (has("ghost-chord") && !has("slot-on")) {
    top = nodeGraphPianoKeysOver(L.ghost.blackChord.top, B.ghostBase.top);
    bottom = nodeGraphPianoKeysOver(L.ghost.blackChord.bottom, B.ghostBase.bottom);
    border = L.ghost.blackChord.border;
    ringPx = 2;
  }
  if (has("ghost-play") && !has("held") && !has("chord-memory")) { border = L.ghost.play; ringPx = 2; }
  top = top || (style && style.top);
  bottom = bottom || (style && style.bottom);
  border = border || (style && style.border);
  const mid = nodeGraphPianoKeysMix(top, bottom, 0.5);
  const hasBorder = Boolean(border);
  return {
    top,
    bottom,
    stroke: hasBorder ? ringPx : 0,
    strokeRgba: hasBorder ? nodeGraphPianoKeysOver(border, mid) : mid,
    // Black labels only take the state colour on wide keyboards (old @container 520px).
    text: wideLabels ? (style && style.text) : (B.base && B.base.text),
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.NODE_GRAPH_PIANO_KEYS_INSET_FRAC = NODE_GRAPH_PIANO_KEYS_INSET_FRAC;
  globalThis.NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT = NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT;
  globalThis.NODE_GRAPH_PIANO_KEYS_DEFAULT_WHITE_W = NODE_GRAPH_PIANO_KEYS_DEFAULT_WHITE_W;
  globalThis.NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_W = NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_W;
  globalThis.NODE_GRAPH_PIANO_KEYS_LABEL_FONT = NODE_GRAPH_PIANO_KEYS_LABEL_FONT;
  globalThis.NODE_GRAPH_PIANO_KEYS_WHITE_LABEL_CQI = NODE_GRAPH_PIANO_KEYS_WHITE_LABEL_CQI;
  globalThis.NODE_GRAPH_PIANO_KEYS_BLACK_LABEL_CQI = NODE_GRAPH_PIANO_KEYS_BLACK_LABEL_CQI;
  globalThis.NODE_GRAPH_PIANO_KEYS_LABEL_CHAR_ASPECT = NODE_GRAPH_PIANO_KEYS_LABEL_CHAR_ASPECT;
  globalThis.nodeGraphPianoKeysHex = nodeGraphPianoKeysHex;
  globalThis.nodeGraphPianoKeysLabelPx = nodeGraphPianoKeysLabelPx;
  globalThis.nodeGraphPianoKeysRgba = nodeGraphPianoKeysRgba;
  globalThis.nodeGraphPianoKeysOver = nodeGraphPianoKeysOver;
  globalThis.nodeGraphPianoKeysMix = nodeGraphPianoKeysMix;
  globalThis.nodeGraphPianoKeysComputeRects = nodeGraphPianoKeysComputeRects;
  globalThis.nodeGraphPianoKeysHit = nodeGraphPianoKeysHit;
  globalThis.nodeGraphPianoKeysSeamRects = nodeGraphPianoKeysSeamRects;
  globalThis.nodeGraphPianoKeysVisibleSeamRects = nodeGraphPianoKeysVisibleSeamRects;
  globalThis.nodeGraphPianoKeysDraw = nodeGraphPianoKeysDraw;
  globalThis.nodeGraphPianoKeysFlagState = nodeGraphPianoKeysFlagState;
  globalThis.nodeGraphPianoKeysPaint = nodeGraphPianoKeysPaint;
}
