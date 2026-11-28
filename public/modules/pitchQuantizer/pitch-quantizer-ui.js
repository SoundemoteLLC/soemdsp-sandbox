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
  // Face bed matches the unlit Keyboard plate (no teal wash).
  bg: [5 / 255, 6 / 255, 7 / 255, 1],
  bedGlow: [0, 0, 0, 0],
  plateStroke: [243 / 255, 241 / 255, 236 / 255, 0.16],
  plateStrokeJacked: [0.89, 0.36, 0.36, 0.8],
  seam: [5 / 255, 6 / 255, 7 / 255, 0.72],
  // Disabled naturals: Keyboard black-key gradient (NODE_GRAPH_MIDI_KEY_LOOK.black.base).
  naturalFill: [9 / 255, 11 / 255, 14 / 255, 1],
  naturalTop: [32 / 255, 37 / 255, 42 / 255, 1],
  naturalBottom: [9 / 255, 11 / 255, 14 / 255, 1],
  naturalStroke: [127 / 255, 199 / 255, 217 / 255, 0.25],
  naturalLabel: [243 / 255, 241 / 255, 236 / 255, 0.82],
  // Disabled sharps: Keyboard white-key gradient (NODE_GRAPH_MIDI_KEY_LOOK.white.base).
  sharpFill: [167 / 255, 159 / 255, 147 / 255, 1],
  sharpTop: [247 / 255, 242 / 255, 232 / 255, 1],
  sharpBottom: [167 / 255, 159 / 255, 147 / 255, 1],
  sharpStroke: [5 / 255, 6 / 255, 7 / 255, 0.16],
  sharpLabel: [5 / 255, 6 / 255, 7 / 255, 0.92],
  // Playing: Keyboard-style pressed highlight (bright gold, not darkened).
  playing: [1, 207 / 255, 107 / 255, 1],
  playingTop: [1, 207 / 255, 107 / 255, 1],
  playingBottom: [122 / 255, 63 / 255, 6 / 255, 1],
  playingLabel: [26 / 255, 18 / 255, 0, 1],
  playingInset: [1, 226 / 255, 173 / 255, 0.82],
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
function nodeGraphPitchQuantizerKeyLayout(width, height, settings = {}) {
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
      blackW: Number(settings.blackKeyWidth) || NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_W || 10,
      blackH: 0,
      blackKeyHeight: Number(settings.blackKeyHeight) || NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT || 62,
      totalUnits: Math.max(1, whitesSrc.length),
      leadPad: 0,
      whites: whitesSrc,
      blacks,
      flushEdge: true,
    })
    : { w: W, h: H, inset: 0, inModuleFace: true, whites: [], blacks: [] };
  const keys = [];
  computed.whites.forEach((r, i) => {
    const pc = whitesSrc[i];
    keys.push({
      pc,
      black: false,
      label: settings.keyLabels === "number" ? String(pc) : (names[pc] || String(pc)),
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
      label: settings.keyLabels === "number" ? String(pc) : (names[pc] || String(pc)),
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

function nodeGraphPitchQuantizerHexFromRgba(rgba, fallback) {
  if (!Array.isArray(rgba) || rgba.length < 3) return fallback;
  const h = (c) => {
    const n = Math.max(0, Math.min(255, Math.round(Number(c) * 255)));
    return n.toString(16).padStart(2, "0");
  };
  return `#${h(rgba[0])}${h(rgba[1])}${h(rgba[2])}`;
}

function nodeGraphPitchQuantizerRgbaFromHex(value, fallbackRgba) {
  const fallback = Array.isArray(fallbackRgba) && fallbackRgba.length >= 3
    ? fallbackRgba
    : [1, 1, 1, 1];
  const raw = String(value || "").trim();
  let hex = raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    hex = `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return [fallback[0], fallback[1], fallback[2], fallback[3] ?? 1];
  }
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ];
}

function nodeGraphPitchQuantizerNormalizeHex(value, fallbackHex) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  }
  return String(fallbackHex || "#ffffff").toLowerCase();
}

function nodeGraphPitchQuantizerLabelRgba(fill, light, dark) {
  const lum = 0.2126 * fill[0] + 0.7152 * fill[1] + 0.0722 * fill[2];
  return lum > 0.45 ? dark : light;
}

const NODE_GRAPH_PITCH_QUANTIZER_COLOR_FIELDS = Object.freeze([
  "enabledColor",
  "playingColor",
  "naturalColor",
  "sharpColor",
]);
const NODE_GRAPH_PITCH_QUANTIZER_KEY_FIELDS = Object.freeze([
  "blackKeyWidth", "blackKeyHeight", "keyLabels", "keyLabelSize",
]);

const NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS = Object.freeze({
  enabledColor: nodeGraphPitchQuantizerHexFromRgba(
    NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK.electric,
    "#3dffd0",
  ),
  playingColor: nodeGraphPitchQuantizerHexFromRgba(
    NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK.playingTop,
    "#ffcf6b",
  ),
  naturalColor: nodeGraphPitchQuantizerHexFromRgba(
    NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK.naturalTop,
    "#20252a",
  ),
  sharpColor: nodeGraphPitchQuantizerHexFromRgba(
    NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK.sharpTop,
    "#f7f2e8",
  ),
  blackKeyWidth: 10,
  blackKeyHeight: 62,
  keyLabels: "name",
  keyLabelSize: 315,
});

function normalizeNodeGraphPitchQuantizerFaceSettings(settings) {
  const d = NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS;
  const src = settings && typeof settings === "object" ? settings : {};
  return {
    enabledColor: nodeGraphPitchQuantizerNormalizeHex(src.enabledColor, d.enabledColor),
    playingColor: nodeGraphPitchQuantizerNormalizeHex(src.playingColor, d.playingColor),
    naturalColor: nodeGraphPitchQuantizerNormalizeHex(src.naturalColor, d.naturalColor),
    sharpColor: nodeGraphPitchQuantizerNormalizeHex(src.sharpColor, d.sharpColor),
    blackKeyWidth: Math.max(4, Math.min(28, Number.isFinite(Number(src.blackKeyWidth)) ? Number(src.blackKeyWidth) : d.blackKeyWidth)),
    blackKeyHeight: Math.max(28, Math.min(82, Number.isFinite(Number(src.blackKeyHeight)) ? Number(src.blackKeyHeight) : d.blackKeyHeight)),
    keyLabels: ["off", "name", "number"].includes(src.keyLabels) ? src.keyLabels : d.keyLabels,
    keyLabelSize: Math.max(50, Math.min(400, Number.isFinite(Number(src.keyLabelSize)) ? Number(src.keyLabelSize) : d.keyLabelSize)),
  };
}

function nodeGraphPitchQuantizerDisplaySettingsForNode(node) {
  return normalizeNodeGraphPitchQuantizerFaceSettings(node?.traceDisplaySettings);
}

function nodeGraphPitchQuantizerSettingsAreDefault(settings) {
  const s = normalizeNodeGraphPitchQuantizerFaceSettings(settings);
  const d = NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS;
  return NODE_GRAPH_PITCH_QUANTIZER_COLOR_FIELDS.every((key) => s[key] === d[key])
    && NODE_GRAPH_PITCH_QUANTIZER_KEY_FIELDS.every((key) => s[key] === d[key]);
}

/**
 * Keyboard-shaped look tables for the shared state-paint path. Base /
 * disabled keys use unlit Keyboard gradients with the colors swapped
 * (naturals = Keyboard black keys, sharps = Keyboard white keys). Bright
 * colors are reserved for enabled (teal fill + stroke) and playing
 * (Keyboard-style pressed highlight in the playing color, not darkened).
 */
function nodeGraphPitchQuantizerDefaultPaintLooks() {
  const L = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  const playing = {
    top: L.playingTop,
    bottom: L.playingBottom,
    text: L.playingLabel,
    inset: L.playingInset,
    border: L.playingInset,
  };
  return {
    idle: {
      white: {
        base: { top: L.naturalTop, bottom: L.naturalBottom, text: L.naturalLabel, inset: L.naturalStroke },
        blue: playing,
      },
      black: {
        base: { top: L.sharpTop, bottom: L.sharpBottom, text: L.sharpLabel },
        blue: playing,
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
        blue: { ...playing, inset: L.electric },
      },
      black: {
        base: {
          top: L.electricTopSharp,
          bottom: L.electricBottomSharp,
          text: L.electricLabelSharp,
          border: L.electric,
        },
        blue: { ...playing, border: L.electric },
      },
    },
  };
}

function nodeGraphPitchQuantizerPaintLooksFromColors(settings) {
  const L = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  const s = normalizeNodeGraphPitchQuantizerFaceSettings(settings);
  const playing = nodeGraphPitchQuantizerRgbaFromHex(s.playingColor, L.playingTop);
  const enabled = nodeGraphPitchQuantizerRgbaFromHex(s.enabledColor, L.electric);
  const natural = nodeGraphPitchQuantizerRgbaFromHex(s.naturalColor, L.naturalTop);
  const sharp = nodeGraphPitchQuantizerRgbaFromHex(s.sharpColor, L.sharpTop);
  // Keyboard black keys drop the bottom stop to ~30% of the top; white keys to ~66%.
  const naturalBottom = nodeGraphPitchQuantizerDarkenRgba(natural, 0.7);
  const sharpBottom = nodeGraphPitchQuantizerDarkenRgba(sharp, 0.34);
  const enabledBottom = nodeGraphPitchQuantizerDarkenRgba(enabled, 0.22);
  // Keyboard pressed/held highlights keep a bright top and a deep bottom of the same hue.
  const playingBottom = nodeGraphPitchQuantizerDarkenRgba(playing, 0.55);
  const playingInset = [playing[0], playing[1], playing[2], 0.82];
  const lightLabel = [234 / 255, 248 / 255, 1, 1];
  const darkLabel = [26 / 255, 18 / 255, 0, 1];
  const playingText = nodeGraphPitchQuantizerLabelRgba(playing, lightLabel, darkLabel);
  const playingLook = {
    top: playing,
    bottom: playingBottom,
    text: playingText,
    inset: playingInset,
    border: playingInset,
  };
  return {
    idle: {
      white: {
        base: {
          top: natural,
          bottom: naturalBottom,
          text: nodeGraphPitchQuantizerLabelRgba(natural, lightLabel, darkLabel),
          inset: [natural[0], natural[1], natural[2], 0.25],
        },
        blue: playingLook,
      },
      black: {
        base: {
          top: sharp,
          bottom: sharpBottom,
          text: nodeGraphPitchQuantizerLabelRgba(sharp, lightLabel, darkLabel),
        },
        blue: playingLook,
      },
    },
    enabled: {
      white: {
        base: {
          top: enabled,
          bottom: enabledBottom,
          text: nodeGraphPitchQuantizerLabelRgba(enabled, lightLabel, darkLabel),
          inset: enabled,
        },
        blue: { ...playingLook, inset: enabled },
      },
      black: {
        base: {
          top: enabled,
          bottom: enabledBottom,
          text: nodeGraphPitchQuantizerLabelRgba(enabled, lightLabel, darkLabel),
          border: enabled,
        },
        blue: { ...playingLook, border: enabled },
      },
    },
  };
}

function nodeGraphPitchQuantizerPaintLooks(settings) {
  return nodeGraphPitchQuantizerSettingsAreDefault(settings)
    ? nodeGraphPitchQuantizerDefaultPaintLooks()
    : nodeGraphPitchQuantizerPaintLooksFromColors(settings);
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

function nodeGraphPitchQuantizerFacePaintSig(bw, bh, strokeDev, mask, jacked, livePc, settings) {
  const liveSig = livePc == null ? "-" : String(livePc);
  const s = normalizeNodeGraphPitchQuantizerFaceSettings(settings);
  const colorSig = `${s.enabledColor}:${s.playingColor}:${s.naturalColor}:${s.sharpColor}:${s.blackKeyWidth}:${s.blackKeyHeight}:${s.keyLabels}:${s.keyLabelSize}`;
  return `${Math.max(1, bw | 0)}x${Math.max(1, bh | 0)}:s${Math.max(1, strokeDev | 0)}:m${mask}:j${jacked ? 1 : 0}:p${liveSig}:c${colorSig}`;
}

function nodeGraphPitchQuantizerKeyPaint(key, mask, livePc, settings) {
  const looks = nodeGraphPitchQuantizerPaintLooks(settings);
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

function nodeGraphPitchQuantizerGlDrawKeys(batch, layout, mask, jacked, strokeDev, livePc, settings) {
  const base = NODE_GRAPH_PITCH_QUANTIZER_GL_LOOK;
  const s = normalizeNodeGraphPitchQuantizerFaceSettings(settings);
  const enabled = nodeGraphPitchQuantizerRgbaFromHex(s.enabledColor, base.electric);
  const L = {
    ...base,
    glow: [enabled[0], enabled[1], enabled[2], base.glow[3]],
    glowOuter: [enabled[0], enabled[1], enabled[2], base.glowOuter[3]],
  };
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
  for (const key of whites) key.roundNaturalCorners = true;
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
      // No plate ring when unjacked: the 0.75px min stroke would cover the
      // flush key tops and make the row look 1px too low.
      ring: jacked ? L.plateStrokeJacked : null,
      whiteSeam: L.seam,
    },
    whites,
    blacks,
    keys: layout.keys,
    labels: settings?.keyLabels || "name",
    totalUnits: Math.max(1, whites.length),
    labelSizeK: (Number(settings?.keyLabelSize) || 315) / 315,
    labelFit: "width",
    labelMargin: 1,
    sharpHeightFrac: typeof NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT === "number"
      ? NODE_GRAPH_PIANO_KEYS_DEFAULT_BLACK_HEIGHT / 100
      : 0.62,
    labelFont: NODE_GRAPH_PITCH_QUANTIZER_GL_FONT,
    paintKey: (key) => nodeGraphPitchQuantizerKeyPaint(key, mask, livePc, settings),
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
    const display = nodeGraphPitchQuantizerDisplaySettingsForNode(patchNode);
    return { mask, jacked, shift, livePc, display };
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
    const { mask, jacked, livePc, display } = faceState();
    const m = typeof nodeGraphDisplayCanvasSize === "function"
      ? nodeGraphDisplayCanvasSize(section, canvas)
      : null;
    if (!m) return;
    const dpr = Math.max(1, m.pixelRatio || 1);
    const bw = Math.max(1, m.width);
    const bh = Math.max(1, m.height);
    const strokeDev = Math.max(1, Math.round(dpr));
    const sig = nodeGraphPitchQuantizerFacePaintSig(bw, bh, strokeDev, mask, jacked, livePc, display);
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
    const layout = nodeGraphPitchQuantizerKeyLayout(bw, bh, display);
    hitLayout = layout;
    nodeGraphPitchQuantizerGlDrawKeys(batch, layout, mask, jacked, strokeDev, livePc, display);
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

function buildNodeGraphPitchQuantizerDisplaySettingsBodyHtml() {
  const type = "pitchQuantizerFace";
  const colorRow = (key) => (typeof nodeGraphDisplaySettingsBuildColorRowHtml === "function"
    ? nodeGraphDisplaySettingsBuildColorRowHtml(key, type)
    : "");
  const keys = NODE_GRAPH_PITCH_QUANTIZER_COLOR_FIELDS;
  const rows = keys.map(colorRow);
  return `
    <div data-pitch-quantizer-display-settings-panel>
      <div class="metadata-section-title">Colors</div>
      <div class="metadata-field-section">${typeof nodeGraphDisplaySettingsColorRows === "function"
        ? nodeGraphDisplaySettingsColorRows(rows, [2, 2])
        : rows.join("")}</div>
      <div class="metadata-section-title">Keys</div>
      <label class="node-trace-display-line-burn-row"><span>Sharp width</span><input type="range" min="4" max="28" step="1" data-pq-key-setting="blackKeyWidth" aria-label="Sharp key width"></label>
      <label class="node-trace-display-line-burn-row"><span>Sharp height</span><input type="range" min="28" max="82" step="1" data-pq-key-setting="blackKeyHeight" aria-label="Sharp key height"></label>
      <label class="node-trace-display-line-burn-row"><span>Labels</span><select data-pq-key-setting="keyLabels" aria-label="Key labels"><option value="off">Off</option><option value="name">Pitch class name</option><option value="number">Pitch class number</option></select></label>
      <label class="node-trace-display-line-burn-row"><span>Label size</span><input type="range" min="50" max="400" step="5" data-pq-key-setting="keyLabelSize" aria-label="Key label size"></label>
    </div>`;
}

function syncNodeGraphPitchQuantizerDisplaySettingsControls(root, settings) {
  if (!root || !settings) return;
  const s = normalizeNodeGraphPitchQuantizerFaceSettings(settings);
  const panel = root.querySelector?.("[data-pitch-quantizer-display-settings-panel]") || root;
  for (const key of NODE_GRAPH_PITCH_QUANTIZER_COLOR_FIELDS) {
    const input = panel?.querySelector?.(`[data-trace-display-color="${key}"]`);
    if (input) input.value = s[key];
  }
  for (const key of NODE_GRAPH_PITCH_QUANTIZER_KEY_FIELDS) {
    const input = panel?.querySelector?.(`[data-pq-key-setting="${key}"]`);
    if (input) input.value = String(s[key]);
  }
}

function bindNodeGraphPitchQuantizerDisplaySettingsBody(host) {
  if (!host || host.dataset.pqSettingsBound === "true") return;
  host.dataset.pqSettingsBound = "true";
  const apply = (persist, record) => {
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty("*");
    }
    if (typeof applyNodeGraphTraceDisplaySettingsForm === "function") {
      applyNodeGraphTraceDisplaySettingsForm({ persist, record, commit: record });
    }
  };
  host.addEventListener("input", (event) => {
    if (event.target?.closest?.("[data-trace-display-color], [data-pq-key-setting]")) apply("none", false);
  });
  host.addEventListener("change", (event) => {
    if (event.target?.closest?.("[data-trace-display-color], [data-pq-key-setting]")) apply("immediate", true);
  });
}

function readNodeGraphPitchQuantizerDisplaySettingsForm(root, current) {
  const panel = root?.querySelector?.("[data-pitch-quantizer-display-settings-panel]") || root;
  const next = { ...(current && typeof current === "object" ? current : {}) };
  for (const key of NODE_GRAPH_PITCH_QUANTIZER_COLOR_FIELDS) {
    const input = panel?.querySelector?.(`[data-trace-display-color="${key}"]`);
    if (input && input.value) next[key] = input.value;
  }
  for (const key of NODE_GRAPH_PITCH_QUANTIZER_KEY_FIELDS) {
    const input = panel?.querySelector?.(`[data-pq-key-setting="${key}"]`);
    if (input) next[key] = key === "keyLabels" ? input.value : Number(input.value);
  }
  return normalizeNodeGraphPitchQuantizerFaceSettings(next);
}

function applyNodeGraphPitchQuantizerDisplaySettingsToFace(node) {
  const id = String(node?.id || "").trim();
  if (id && typeof syncNodeGraphPitchQuantizerFace === "function") {
    syncNodeGraphPitchQuantizerFace(id);
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS = NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS;
  globalThis.NODE_GRAPH_PITCH_QUANTIZER_COLOR_FIELDS = NODE_GRAPH_PITCH_QUANTIZER_COLOR_FIELDS;
  globalThis.normalizeNodeGraphPitchQuantizerFaceSettings = normalizeNodeGraphPitchQuantizerFaceSettings;
  globalThis.nodeGraphPitchQuantizerDisplaySettingsForNode = nodeGraphPitchQuantizerDisplaySettingsForNode;
  globalThis.buildNodeGraphPitchQuantizerDisplaySettingsBodyHtml = buildNodeGraphPitchQuantizerDisplaySettingsBodyHtml;
  globalThis.syncNodeGraphPitchQuantizerDisplaySettingsControls = syncNodeGraphPitchQuantizerDisplaySettingsControls;
  globalThis.bindNodeGraphPitchQuantizerDisplaySettingsBody = bindNodeGraphPitchQuantizerDisplaySettingsBody;
  globalThis.readNodeGraphPitchQuantizerDisplaySettingsForm = readNodeGraphPitchQuantizerDisplaySettingsForm;
  globalThis.applyNodeGraphPitchQuantizerDisplaySettingsToFace = applyNodeGraphPitchQuantizerDisplaySettingsToFace;
}

if (typeof nodeGraphModuleScopeCustomRenderers === "object" && nodeGraphModuleScopeCustomRenderers) {
  nodeGraphModuleScopeCustomRenderers.pitchQuantizerFace = () => {};
}
if (typeof registerNodeGraphModuleFaceCreator === "function") {
  registerNodeGraphModuleFaceCreator("pitchQuantizerFace", createNodeGraphPitchQuantizerFace);
}
