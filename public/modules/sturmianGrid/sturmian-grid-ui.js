// Packed sounding-bar grid and K/S/H/M lane map on the shared face texture;
// standard parameter rows live in the module body. Layout CSS is module-space
// (stable at zoom, no reflow). Cell size is the largest whole-device-pixel
// square that fits the playable area (Steps columns x Track Spread rows) so
// a short pattern zooms in; leftover space is packed with dimmed continuation
// squares, then a centered integer black margin. The
// face texture is snapped to the integer framebuffer size of the on-screen
// quad (CSS x workspace zoom; 4096 cap) so every texel is 1:1. Gutters (when
// the cell is at least 16px), track outline, playhead and lane toggles are
// integer device pixels. Strip and RESET bitmap text use the largest whole-
// pixel scale that fits in the cell (compact "R"/value, then value only, then
// hide) so glyphs never overflow. The playhead is a 16% white column plus a 1px white frame on the
// grid's gutter/edge pixels (no extra inset). A triggered step fills its
// square with the track color (binary on/off; latched at least one frame,
// no fade). Track-span and playhead stroke alphas live in Display Settings
// (default 1). A Reset After drag-number
// cell sits to the right of the K/S/H/M toggles and stays in sync with the
// param-band slider. The shared 2.5x threshold is unchanged; this plate
// pins nearest and opts into compositor pixel-snap.
const STURMIAN_SHADER_URL = "./public/modules/sturmianGrid/sturmian-grid.glsl?v=shader-ui-15-stg1-stg3-stg4-stg5-stg6-stg12-stg13-stg16-stg17-stg18-stg19-stg20-stg21-stg23-stg24-stg25-stg26-stg27-stg28";
const STURMIAN_FLOATS = ["alpha", "beta", "rho", "drift", "rate", "steps", "reset", "spread", "walk", "snap", "view", "stepPattern"];
const STURMIAN_UI_DEFAULT_MASK = 3170;
let sturmianShaderPromise = null;
let sturmianDrag = null;

function sturmianLoadShader() {
  if (!sturmianShaderPromise) {
    sturmianShaderPromise = fetch(STURMIAN_SHADER_URL)
      .then((response) => { if (!response.ok) throw new Error(`GLSL load failed (${response.status})`); return response.text(); })
      .then((source) => {
        const marker = "// --- MAIN ---";
        const split = source.indexOf(marker);
        if (split < 0) throw new Error("GLSL main marker missing");
        return { functions: source.slice(0, split), body: source.slice(split + marker.length) };
      });
  }
  return sturmianShaderPromise;
}

function sturmianReadNode(nodeId) {
  return typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
}

function sturmianValues(nodeId, preview = null) {
  const params = sturmianReadNode(nodeId)?.params || {};
  const result = {};
  for (const key of STURMIAN_FLOATS) {
    const value = Number(preview?.[key] ?? params[key]);
    result[key] = Number.isFinite(value) ? value : 0;
  }
  if (!Number.isFinite(Number(preview?.stepPattern ?? params.stepPattern))) {
    result.stepPattern = STURMIAN_UI_DEFAULT_MASK;
  }
  const cell = Number(preview?.cell ?? params.cell);
  result.cell = Number.isFinite(cell) ? cell : 14;
  return result;
}

function sturmianPlayhead(nodeId, steps) {
  // Engine writes kPortPhase01 every sample as (step % steps) / steps, and
  // kPortTri as the integer bar. Those hidden taps reach this face because
  // the definition sets planScopeCapture (customDisplayArea is layoutOwned
  // and would otherwise be skipped). LatestOutputValue is the last finite
  // sample in the scope ring, updated every capture (Simulation FPS).
  const stepCount = Math.max(1, Number(steps) || 1);
  let playStep = 0;
  let playBar = 0;
  let playing = 0;
  const read = (port) => (typeof nodeGraphModuleScopeLatestOutputValue === "function"
    ? Number(nodeGraphModuleScopeLatestOutputValue(nodeId, port, Number.NaN))
    : Number.NaN);
  const phase = read("__Phase");
  if (Number.isFinite(phase)) {
    playStep = Math.max(0, Math.min(stepCount - 1, Math.floor(phase * stepCount + 1e-6)));
    playing = 1;
  }
  const bar = read("__Bar");
  if (Number.isFinite(bar)) playBar = Math.max(0, Math.floor(bar + 1e-6));
  return { playStep, playBar, playing, phase };
}

// Integer-square packing, same as the shader, in integer texel / screen
// pixels of the grid region. Cell size is the largest whole-device-pixel
// square that fits the sounding bar (Steps columns) and Track Spread
// window (3*spread+1 rows). Extra whole cells pack as dimmed, non-clickable
// continuation; leftover sub-cell space is a centered integer black margin.
function sturmianRowsNeeded(spread) {
  const spreadN = Math.max(1, Math.floor(Number(spread) + 0.5) || 1);
  return 3 * spreadN + 1;
}

function sturmianBaseCell(values) {
  const n = Math.floor(Number(values?.cell ?? 14) + 0.5);
  return Math.max(2, Number.isFinite(n) ? n : 14);
}

function sturmianGridLayout(width, height, steps, spread, _zoom, _baseCell) {
  const playCols = Math.max(2, Math.floor(Number(steps) + 0.5) || 2);
  const rowsNeeded = Math.max(1, sturmianRowsNeeded(spread));
  // Largest whole-device-pixel square that fits the playable area (Steps
  // columns x Track Spread rows). Workspace zoom already scales the backing
  // size; do not start from baseCell and only shrink. Leftover sub-cell
  // space stays a centered black margin; extra whole cells are continuation.
  const cell = Math.max(2, Math.floor(Math.min(
    Math.max(1, width) / playCols,
    Math.max(1, height) / rowsNeeded
  )));
  const cols = Math.max(1, Math.floor(Math.max(1, width) / cell));
  const rows = Math.max(1, Math.floor(Math.max(1, height) / cell));
  return {
    cols,
    rows,
    playCols,
    // Sounding-bar selection: columns [padLeft, padLeft+playCols). The shader
    // draws one 1-screen-pixel stroke around that strip on each track row
    // (same rect as d7cf6bc8 / soundemote-dev), not a per-cell rim. Gutters
    // and that stroke are 1 texel of a screen-resolution face texture.
    padLeft: Math.max(0, Math.floor((cols - playCols) * 0.5)),
    cell,
    ox: Math.floor((width - cols * cell) * 0.5),
    oy: Math.floor((height - rows * cell) * 0.5),
  };
}

function sturmianNTop(playBar, walk, spread, rows) {
  const spreadN = Math.max(1, Math.floor(Number(spread) + 0.5) || 1);
  const walkN = Math.max(0, Math.floor(Number(walk) + 0.5) || 0);
  const firstN = playBar * walkN;
  const span = 3 * spreadN + 1;
  const above = Math.max(0, Math.floor((rows - span) * 0.5));
  return { firstN, spreadN, nTop: firstN - above };
}

function sturmianTileAt(values, col, n, time) {
  const steps = Math.max(1, Number(values.steps) || 1);
  let aa = Number(values.alpha) || 0;
  let bb = Number(values.beta) || 0;
  if (Number(values.snap) > 0.5) {
    aa = Math.floor(aa * steps + 0.5) / steps;
    bb = Math.floor(bb * steps + 0.5) / steps;
  }
  const rho = Number(values.rho) || 0;
  const drift = Number(values.drift) || 0;
  const z = (col * aa + n * bb + rho + drift * time) % 1;
  const frac = z < 0 ? z + 1 : z;
  if (frac >= 1 - aa) return 1;
  if (frac >= 1 - aa - bb) return 2;
  return 0;
}

function sturmianTrackAtRow(row, firstN, spreadN, nTop) {
  const n = nTop + row;
  for (let track = 0; track < 4; track += 1) {
    if (Math.abs(n - (firstN + track * spreadN)) < 0.5) return track;
  }
  return -1;
}

function sturmianHitFace(face, plate, event, values, play, time) {
  if (!face || !plate) return null;
  const rect = plate.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const texW = Math.max(1, plate.width | 0);
  const texH = Math.max(1, plate.height | 0);
  const dx = (event.clientX - rect.left) / rect.width * texW;
  const dy = (event.clientY - rect.top) / rect.height * texH;
  const layout = plate._sturmianLayout || sturmianFaceLayout(
    plate._sturmianCssW || rect.width,
    plate._sturmianCssH || rect.height,
    texW, texH, sturmianViewZoom(), values.steps, values.spread, sturmianBaseCell(values),
  );
  const reset = layout.lanes.reset;
  if (reset && dx >= reset.x && dx < reset.x + reset.w && dy >= reset.y && dy < reset.y + reset.h) {
    return { kind: "reset" };
  }
  for (const button of layout.lanes.buttons) {
    if (dx >= button.x && dx < button.x + button.w && dy >= button.y && dy < button.y + button.h) {
      return { kind: "lane", bit: button.bit };
    }
  }
  if (dy >= layout.gridH) return null;
  const gx = dx - layout.ox;
  const gy = dy - layout.oy;
  if (gx < 0 || gy < 0 || gx >= layout.cols * layout.cell || gy >= layout.rows * layout.cell) return null;
  const col = Math.floor(gx / layout.cell) - layout.padLeft;
  const row = Math.floor(gy / layout.cell);
  if (col < 0 || col >= layout.playCols) return null;
  const win = sturmianNTop(play.playBar, values.walk, values.spread, layout.rows);
  const track = sturmianTrackAtRow(row, win.firstN, win.spreadN, win.nTop);
  if (track < 0) return null;
  const tile = sturmianTileAt(values, col, win.nTop + row, time);
  return { kind: "cell", col, row, track, tile, bit: track * 3 + tile };
}

function sturmianSharedGl() {
  const pic = typeof nodeGraphSharedGlDevice === "function" ? nodeGraphSharedGlDevice() : null;
  return pic?.gl || null;
}

// One program on the shared WebGL2 device. The picture lives in the face
// texture, so the graph / Canvas / Mini Canvas sample it nearest past 2.5x
// like every other shader face. No private <canvas> context.
let sturmianSharedGpu = null;

function sturmianEnsureGpu(shader) {
  const gl = sturmianSharedGl();
  if (!gl || gl.isContextLost?.()) {
    sturmianSharedGpu = null;
    return null;
  }
  if (sturmianSharedGpu?.gl === gl && sturmianSharedGpu.program) return sturmianSharedGpu;
  const compile = (kind, source) => {
    const shaderObj = gl.createShader(kind);
    gl.shaderSource(shaderObj, source);
    gl.compileShader(shaderObj);
    if (!gl.getShaderParameter(shaderObj, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shaderObj));
    return shaderObj;
  };
  const uniforms = STURMIAN_FLOATS.map((key) => `uniform float ${key};`).join("\n")
    + "\nuniform float playStep; uniform float playBar; uniform float playing; uniform float pixelRatio;"
    + " uniform uint hitBits[4];"
    + " uniform float gridH; uniform float stripPadX; uniform float stripPadY;"
    + " uniform float stripGapX; uniform float stripGapY; uniform float btnSize;"
    + " uniform float labelW; uniform float innerGap;"
    + " uniform float layoutCell; uniform float layoutCols; uniform float layoutRows;"
    + " uniform float layoutOx; uniform float layoutOy; uniform float layoutPadLeft;"
    + " uniform float trackStrokeAlpha; uniform float playheadStrokeAlpha;"
    + " uniform float resetCellX; uniform float resetCellY;"
    + " uniform float resetCellSize; uniform float resetGap;";
  const vertex = compile(gl.VERTEX_SHADER, "#version 300 es\nin vec2 aPos; out vec2 vUv; void main(){vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0);}");
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\nin vec2 vUv; out vec4 out_color; uniform vec2 resolution; uniform float time;\n${uniforms}\n${shader.functions}\nvoid main(){ vec2 uv=vUv; ${shader.body}\n}`);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  sturmianSharedGpu = {
    gl,
    program,
    quad,
    position: gl.getAttribLocation(program, "aPos"),
    resolution: gl.getUniformLocation(program, "resolution"),
    time: gl.getUniformLocation(program, "time"),
    playStep: gl.getUniformLocation(program, "playStep"),
    playBar: gl.getUniformLocation(program, "playBar"),
    playing: gl.getUniformLocation(program, "playing"),
    pixelRatio: gl.getUniformLocation(program, "pixelRatio"),
    hitBits: gl.getUniformLocation(program, "hitBits[0]"),
    gridH: gl.getUniformLocation(program, "gridH"),
    stripPadX: gl.getUniformLocation(program, "stripPadX"),
    stripPadY: gl.getUniformLocation(program, "stripPadY"),
    stripGapX: gl.getUniformLocation(program, "stripGapX"),
    stripGapY: gl.getUniformLocation(program, "stripGapY"),
    btnSize: gl.getUniformLocation(program, "btnSize"),
    labelW: gl.getUniformLocation(program, "labelW"),
    innerGap: gl.getUniformLocation(program, "innerGap"),
    layoutCell: gl.getUniformLocation(program, "layoutCell"),
    layoutCols: gl.getUniformLocation(program, "layoutCols"),
    layoutRows: gl.getUniformLocation(program, "layoutRows"),
    layoutOx: gl.getUniformLocation(program, "layoutOx"),
    layoutOy: gl.getUniformLocation(program, "layoutOy"),
    layoutPadLeft: gl.getUniformLocation(program, "layoutPadLeft"),
    trackStrokeAlpha: gl.getUniformLocation(program, "trackStrokeAlpha"),
    playheadStrokeAlpha: gl.getUniformLocation(program, "playheadStrokeAlpha"),
    resetCellX: gl.getUniformLocation(program, "resetCellX"),
    resetCellY: gl.getUniformLocation(program, "resetCellY"),
    resetCellSize: gl.getUniformLocation(program, "resetCellSize"),
    resetGap: gl.getUniformLocation(program, "resetGap"),
    floats: Object.fromEntries(STURMIAN_FLOATS.map((key) => [key, gl.getUniformLocation(program, key)])),
  };
  return sturmianSharedGpu;
}

function sturmianFiredMask(values, step, bar, time) {
  const mask = Math.round(values.stepPattern);
  const walk = Math.max(0, Math.floor(Number(values.walk) + 0.5) || 0);
  const spread = Math.max(1, Math.floor(Number(values.spread) + 0.5) || 1);
  let fired = 0;
  for (let track = 0; track < 4; track += 1) {
    if ((mask >> (12 + track)) & 1) continue;
    const n = bar * walk + track * spread;
    const tile = sturmianTileAt(values, step, n, time);
    if ((mask >> (track * 3 + tile)) & 1) fired |= (1 << track);
  }
  return fired;
}

function sturmianOrHit(latch, step, mask) {
  const s = Math.max(0, Math.min(31, Math.floor(Number(step) + 0.5) || 0));
  const bit = 1 << s;
  for (let track = 0; track < 4; track += 1) {
    if (mask & (1 << track)) latch[track] |= bit;
  }
}

function sturmianCurrentHitLatch(values, play, time) {
  const latch = new Uint32Array(4);
  if (play.playing > 0.5) {
    sturmianOrHit(latch, play.playStep, sturmianFiredMask(values, play.playStep, play.playBar, time));
  }
  return latch;
}

// Hits are binary. Latch every step that fired since the last paint so a
// high-rate trigger still shows as on for at least one frame, then drop
// latched-only steps after that frame is drawn.
function sturmianAccumulateHits(face, values, play, time) {
  const stepCount = Math.max(1, Math.floor(Number(values.steps) + 0.5) || 1);
  if (!face._sturmianHits) {
    face._sturmianHits = {
      playStep: play.playStep,
      playBar: play.playBar,
      playing: play.playing,
      latch: sturmianCurrentHitLatch(values, play, time),
    };
    return face._sturmianHits.latch;
  }
  const prev = face._sturmianHits;
  if (play.playing > 0.5) {
    if (!(prev.playing > 0.5)) {
      sturmianOrHit(prev.latch, play.playStep, sturmianFiredMask(values, play.playStep, play.playBar, time));
    } else if (prev.playStep !== play.playStep || prev.playBar !== play.playBar) {
      let delta = (play.playBar - prev.playBar) * stepCount + (play.playStep - prev.playStep);
      if (!Number.isFinite(delta) || delta < 0) delta = 1;
      const limit = Math.min(Math.max(delta, 0), stepCount);
      let step = play.playStep;
      let bar = play.playBar;
      for (let i = 0; i < limit; i += 1) {
        sturmianOrHit(prev.latch, step, sturmianFiredMask(values, step, bar, time));
        if (i === limit - 1) break;
        step -= 1;
        if (step < 0) {
          step = stepCount - 1;
          bar -= 1;
        }
      }
    }
  }
  prev.playStep = play.playStep;
  prev.playBar = play.playBar;
  prev.playing = play.playing;
  return prev.latch;
}

function sturmianClearDrawnHits(face, values, play, time) {
  if (!face._sturmianHits) return;
  face._sturmianHits.latch = sturmianCurrentHitLatch(values, play, time);
  face._sturmianHits.playStep = play.playStep;
  face._sturmianHits.playBar = play.playBar;
  face._sturmianHits.playing = play.playing;
}

const STURMIAN_BACKING_CAP = 4096;
const STURMIAN_STRIP_CSS = 53;

function sturmianViewZoom() {
  const z = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : Number(nodeGraphMvp?.zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

function sturmianScreenSize(cssW, cssH, plate) {
  const zoom = sturmianViewZoom();
  let rw = 0;
  let rh = 0;
  if (plate && typeof plate.getBoundingClientRect === "function") {
    const r = plate.getBoundingClientRect();
    rw = r.width;
    rh = r.height;
  }
  let width;
  let height;
  // Workspace modules stay zoom-1 in the DOM (the GL camera zooms). Tiles and
  // solo faces already have their on-screen CSS size in the client rect.
  if (rw > 1 && Math.abs(rw - cssW) <= 2 && Math.abs(cssW * zoom - cssW) > 2) {
    width = Math.max(1, Math.round(cssW * zoom));
    height = Math.max(1, Math.round(cssH * zoom));
  } else if (rw > 1 && rh > 1) {
    width = Math.max(1, Math.round(rw));
    height = Math.max(1, Math.round(rh));
  } else {
    width = Math.max(1, Math.round(cssW * zoom));
    height = Math.max(1, Math.round(cssH * zoom));
  }
  if (width > STURMIAN_BACKING_CAP || height > STURMIAN_BACKING_CAP) {
    const scale = STURMIAN_BACKING_CAP / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  return { width, height, zoom };
}

function sturmianLaneMetrics(texW, stripH, zoom) {
  const padX = Math.max(1, Math.round(4 * zoom));
  const padY = Math.max(1, Math.round(3 * zoom));
  const gapX = Math.max(1, Math.round(8 * zoom));
  const gapY = Math.max(1, Math.round(3 * zoom));
  let btn = Math.max(6, Math.round(22 * zoom));
  let labelW = Math.max(6, Math.round(11 * zoom));
  let innerGap = Math.max(1, Math.round(2 * zoom));
  const resetGap = Math.max(1, Math.round(4 * zoom));
  const minReset = Math.max(12, Math.round(22 * zoom));
  let resetSize = Math.max(minReset, stripH - padY * 2);
  const minColNeed = labelW + innerGap + 4 * btn + 3 * innerGap;
  const chrome = padX * 2 + gapX + resetGap;
  let colSpace = texW - chrome - resetSize;
  if (colSpace < minColNeed * 2) {
    resetSize = Math.max(minReset, texW - chrome - minColNeed * 2);
    colSpace = texW - chrome - resetSize;
  }
  if (resetSize > texW - chrome - 8) {
    resetSize = Math.max(6, Math.floor((texW - chrome) * 0.3));
    colSpace = texW - chrome - resetSize;
  }
  const colW = Math.max(1, Math.floor(Math.max(1, colSpace) / 2));
  const need = labelW + innerGap + 4 * btn + 3 * innerGap;
  if (need > colW && colW > 16) {
    const scale = colW / need;
    btn = Math.max(6, Math.floor(btn * scale));
    labelW = Math.max(6, Math.floor(labelW * scale));
    innerGap = Math.max(1, Math.floor(innerGap * scale));
  }
  return { padX, padY, gapX, gapY, btn, labelW, innerGap, stripH, resetSize, resetGap };
}

function sturmianLaneButtons(texW, stripY, stripH, zoom) {
  const m = sturmianLaneMetrics(texW, stripH, zoom);
  const colW = Math.max(1, Math.floor((texW - m.padX * 2 - m.gapX - m.resetGap - m.resetSize) / 2));
  const rowH = Math.max(1, Math.floor((stripH - m.padY * 2 - m.gapY) / 2));
  if (m.btn > rowH) m.btn = rowH;
  const buttons = [];
  for (let lane = 0; lane < 4; lane += 1) {
    const lc = lane % 2;
    const lr = Math.floor(lane / 2);
    const x0 = m.padX + lc * (colW + m.gapX);
    const y0 = stripY + m.padY + lr * (rowH + m.gapY);
    const by = y0 + Math.floor((rowH - m.btn) / 2);
    let bx = x0 + m.labelW + m.innerGap;
    for (let t = 0; t < 4; t += 1) {
      buttons.push({
        x: bx,
        y: by,
        w: m.btn,
        h: m.btn,
        bit: t < 3 ? lane * 3 + t : 12 + lane,
        lane,
        tile: t,
      });
      bx += m.btn + m.innerGap;
    }
  }
  const innerH = Math.max(1, stripH - m.padY * 2);
  const resetSize = Math.max(1, Math.min(m.resetSize, innerH));
  const reset = {
    x: texW - m.padX - resetSize,
    y: stripY + m.padY + Math.floor((innerH - resetSize) / 2),
    w: resetSize,
    h: resetSize,
  };
  return { ...m, colW, rowH, resetSize, reset, buttons };
}

function sturmianFaceLayout(cssW, cssH, texW, texH, zoom, steps, spread, baseCell) {
  // Prefer the actual texel scale (tex/css) so the strip still fits when the
  // 4096 backing cap shrinks the texture below CSS x zoom.
  const layoutZoom = cssH > 0 ? texH / cssH : zoom;
  let stripH = Math.max(1, Math.round(STURMIAN_STRIP_CSS * layoutZoom));
  if (stripH > texH - 8) stripH = Math.max(1, Math.floor(texH * 0.28));
  const gridH = Math.max(1, texH - stripH);
  const grid = sturmianGridLayout(texW, gridH, steps, spread, layoutZoom, baseCell);
  const lanes = sturmianLaneButtons(texW, gridH, stripH, layoutZoom);
  return { ...grid, texW, texH, gridH, stripH, zoom, layoutZoom, lanes };
}

function sturmianPlateBox(plate) {
  const metrics = typeof ensureFaceMetrics === "function"
    ? ensureFaceMetrics(plate, { observe: true })
    : null;
  const cssWidth = Number(metrics?.cssW);
  const cssHeight = Number(metrics?.cssH);
  if (cssWidth > 1 && cssHeight > 1) {
    return {
      cssWidth,
      cssHeight,
      dpr: Math.max(1, Number(metrics.dpr) || window.devicePixelRatio || 1),
    };
  }
  if (plate._sturmianCssW > 1 && plate._sturmianCssH > 1) {
    return {
      cssWidth: plate._sturmianCssW,
      cssHeight: plate._sturmianCssH,
      dpr: Math.max(1, window.devicePixelRatio || 1),
    };
  }
  const sized = typeof nodeGraphDisplayCanvasSize === "function"
    ? nodeGraphDisplayCanvasSize(plate, plate)
    : null;
  if (!sized) return null;
  return {
    cssWidth: Math.max(1, sized.cssWidth),
    cssHeight: Math.max(1, sized.cssHeight),
    dpr: Math.max(1, Number(sized.devicePixelRatio) || window.devicePixelRatio || 1),
  };
}

function sturmianPaint(face) {
  if (!face?.isConnected || !face._sturmianShader) return;
  const plate = face._sturmianPlate || face.querySelector(".node-sturmian-grid-canvas");
  if (!plate) return;
  // Layout CSS is module-space. Backing is the integer framebuffer size of
  // the on-screen quad (workspace: CSS x zoom, tiles: client rect), 1:1.
  const box = sturmianPlateBox(plate);
  if (!box) return;
  const logicalWidth = box.cssWidth;
  const logicalHeight = box.cssHeight;
  plate._sturmianCssW = logicalWidth;
  plate._sturmianCssH = logicalHeight;
  const screen = sturmianScreenSize(logicalWidth, logicalHeight, plate);
  if (typeof nodeGraphDisplayCanvasSetBacking === "function") {
    nodeGraphDisplayCanvasSetBacking(plate, screen.width, screen.height);
  } else {
    plate.width = screen.width;
    plate.height = screen.height;
  }
  const width = Math.max(1, plate.width | 0);
  const height = Math.max(1, plate.height | 0);
  let gpu;
  try {
    gpu = sturmianEnsureGpu(face._sturmianShader);
  } catch (error) {
    face.dataset.shaderError = String(error.message || error);
    console.error("[Sturmian Grid] GLSL", error);
    return;
  }
  if (!gpu) {
    face.dataset.shaderError = "WebGL2 unavailable";
    return;
  }
  const { gl, program, quad } = gpu;
  const nodeId = face.dataset.node;
  if (typeof nodeGraphSharedGlBindPresent === "function") nodeGraphSharedGlBindPresent(gl, width, height);
  else gl.viewport(0, 0, width, height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(gpu.position);
  gl.vertexAttribPointer(gpu.position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(gpu.resolution, width, height);
  const time = (performance.now() - face._sturmianStarted) / 1000;
  gl.uniform1f(gpu.time, time);
  const values = sturmianValues(nodeId, face._sturmianPreview);
  const layout = sturmianFaceLayout(
    logicalWidth, logicalHeight, width, height, screen.zoom, values.steps, values.spread, sturmianBaseCell(values),
  );
  plate._sturmianLayout = layout;
  for (const key of STURMIAN_FLOATS) gl.uniform1f(gpu.floats[key], values[key]);
  const play = sturmianPlayhead(nodeId, values.steps);
  gl.uniform1f(gpu.playStep, play.playStep);
  gl.uniform1f(gpu.playBar, play.playBar);
  gl.uniform1f(gpu.playing, play.playing);
  gl.uniform1f(gpu.pixelRatio, 1);
  const hitBits = sturmianAccumulateHits(face, values, play, time);
  gl.uniform1uiv(gpu.hitBits, hitBits);
  gl.uniform1f(gpu.gridH, layout.gridH);
  gl.uniform1f(gpu.stripPadX, layout.lanes.padX);
  gl.uniform1f(gpu.stripPadY, layout.lanes.padY);
  gl.uniform1f(gpu.stripGapX, layout.lanes.gapX);
  gl.uniform1f(gpu.stripGapY, layout.lanes.gapY);
  gl.uniform1f(gpu.btnSize, layout.lanes.btn);
  gl.uniform1f(gpu.labelW, layout.lanes.labelW);
  gl.uniform1f(gpu.innerGap, layout.lanes.innerGap);
  gl.uniform1f(gpu.layoutCell, layout.cell);
  gl.uniform1f(gpu.layoutCols, layout.cols);
  gl.uniform1f(gpu.layoutRows, layout.rows);
  gl.uniform1f(gpu.layoutOx, layout.ox);
  gl.uniform1f(gpu.layoutOy, layout.oy);
  gl.uniform1f(gpu.layoutPadLeft, layout.padLeft);
  const look = typeof nodeGraphSturmianGridDisplaySettingsForNode === "function"
    ? nodeGraphSturmianGridDisplaySettingsForNode(sturmianReadNode(nodeId))
    : { trackStrokeAlpha: 1, playheadStrokeAlpha: 1 };
  gl.uniform1f(gpu.trackStrokeAlpha, look.trackStrokeAlpha);
  gl.uniform1f(gpu.playheadStrokeAlpha, look.playheadStrokeAlpha);
  const resetCell = layout.lanes.reset;
  gl.uniform1f(gpu.resetCellX, resetCell ? resetCell.x : 0);
  gl.uniform1f(gpu.resetCellY, resetCell ? resetCell.y : 0);
  gl.uniform1f(gpu.resetCellSize, resetCell ? resetCell.w : 0);
  gl.uniform1f(gpu.resetGap, layout.lanes.resetGap || 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  sturmianClearDrawnHits(face, values, play, time);
  if (typeof nodeGraphSharedGlEndPresent === "function") nodeGraphSharedGlEndPresent(gl);
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(plate)
    : null;
  if (ctx && typeof nodeGraphSharedGlPresent === "function") {
    nodeGraphSharedGlPresent(ctx, width, height);
  }
  face.dataset.shaderError = "";
}


const STURMIAN_RESET_THROW_PX = 180;

function sturmianResetMetadata() {
  const param = typeof nodeGraphParameterByKey === "function"
    ? nodeGraphParameterByKey("sturmianGrid", "reset")
    : null;
  const meta = param && typeof nodeGraphParameterDefinitionMetadata === "function"
    ? nodeGraphParameterDefinitionMetadata(param)
    : null;
  if (meta && Number.isFinite(Number(meta.min)) && Number.isFinite(Number(meta.max))) {
    return meta;
  }
  return { min: 0, max: 128, mid: 8, step: 1, nonlinearSlider: true, sliderCurve: "skew" };
}

function sturmianResetControlPosition(value, meta) {
  if (typeof nodeGraphParamControlPosition === "function") {
    const unit = Number(nodeGraphParamControlPosition(value, meta));
    if (Number.isFinite(unit)) return Math.max(0, Math.min(1, unit));
  }
  const min = Number(meta.min);
  const max = Number(meta.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.max(0, Math.min(1, (Number(value) - min) / (max - min)));
}

function sturmianResetFromPointer(startUnit, startClientY, clientY) {
  const meta = sturmianResetMetadata();
  const unit = Math.max(0, Math.min(1, startUnit + (startClientY - clientY) / STURMIAN_RESET_THROW_PX));
  let next;
  if (typeof nodeGraphParamDomainFromControlPosition === "function") {
    next = Number(nodeGraphParamDomainFromControlPosition(unit, meta));
  } else {
    const min = Number(meta.min);
    const max = Number(meta.max);
    next = min + (max - min) * unit;
  }
  const step = Number(meta.step);
  if (Number.isFinite(step) && step > 0) next = Math.round(next / step) * step;
  const min = Number(meta.min);
  const max = Number(meta.max);
  if (Number.isFinite(min)) next = Math.max(min, next);
  if (Number.isFinite(max)) next = Math.min(max, next);
  return next;
}

function sturmianWriteReset(nodeId, face, value, phase) {
  const next = Number(value);
  if (!Number.isFinite(next) || !face) return;
  face._sturmianPreview = { ...(face._sturmianPreview || {}), reset: next };
  const slider = typeof nodeGraphSliderForParameter === "function"
    ? nodeGraphSliderForParameter(nodeId, "reset")
    : null;
  if (slider && typeof setNodeSliderValue === "function") {
    setNodeSliderValue(slider, next, { interaction: phase === "up" ? "set" : "drag" });
    if (phase === "up" && typeof commitNodeSliderDragValue === "function") {
      commitNodeSliderDragValue(slider, "Reset After");
    }
  } else {
    sturmianCommit(nodeId, { reset: next }, "Reset After", { record: phase === "up" });
  }
  face._sturmianForce = true;
  sturmianPaint(face);
}

function sturmianCommit(nodeId, values, status = "Sturmian Grid", options = {}) {
  if (!nodeId || !nodeGraphMvp?.patch || typeof cloneNodeGraphPatch !== "function") return false;
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const patchNode = patch.nodes.find((item) => item.id === nodeId);
  if (!patchNode) return false;
  const next = { ...(patchNode.params || {}) };
  for (const [key, value] of Object.entries(values)) {
    next[key] = normalizeNodeGraphPatchParameter(patchNode.type, key, value, patchNode.paramMeta?.[key]);
  }
  patchNode.params = next;
  commitNodeGraphPatch(patch, { status, ...options });
  return true;
}

function sturmianApplyBit(nodeId, face, bit, turnOn) {
  const current = Math.round(sturmianValues(nodeId, face?._sturmianPreview).stepPattern);
  const next = turnOn ? (current | (1 << bit)) : (current & ~(1 << bit));
  if (next === current) return current;
  face._sturmianPreview = { ...(face._sturmianPreview || {}), stepPattern: next };
  sturmianCommit(nodeId, { stepPattern: next }, "Sturmian lane map");
  return next;
}

function sturmianCreateBody(node) {
  const face = document.createElement("div");
  face.className = "node-sturmian-grid node-module-scope-window node-module-face";
  face.dataset.node = node;
  face.dataset.nodeType = "sturmianGrid";
  face.dataset.lightSource = "screen";
  face._sturmianStarted = performance.now();
  const plate = nodeGraphDisplayCanvasCreate("node-sturmian-grid-canvas");
  plate.setAttribute("aria-hidden", "true");
  plate.dataset.pixelSnap = "1";
  plate.classList.add("display-canvas-pixel-snap");
  if (typeof nodeGraphDisplayCanvasPixelated === "function") {
    nodeGraphDisplayCanvasPixelated(plate, true);
  }
  face._sturmianPlate = plate;
  face.append(plate);
  sturmianLoadShader().then((shader) => {
    face._sturmianShader = shader;
    if (!face.isConnected) return;
    face._sturmianForce = true;
    sturmianPaint(face);
  }).catch((error) => { console.error("[Sturmian Grid] GLSL load failed", error); });
  return face;
}

function sturmianShouldAnimate(face) {
  return !(typeof scopePaintIsVisualPaused === "function" && scopePaintIsVisualPaused())
    && !(typeof scopePaintEngineState === "function" && scopePaintEngineState() === "paused");
}

function sturmianParamRowGroups(type) {
  const groups = (typeof nodeGraphModuleDefinitions === "object" && nodeGraphModuleDefinitions[type]?.parameterRows) || [];
  return Array.isArray(groups) ? groups : [];
}

/** Pack common sliders into the compact rows from definition.parameterRows. */
function sturmianLayoutParamRows(article) {
  const body = article?.querySelector(":scope > .dsp-node-body");
  if (!body) return;
  const type = article.dataset?.nodeType || "sturmianGrid";
  for (const group of sturmianParamRowGroups(type)) {
    const keys = Array.isArray(group) ? group : [group];
    const rows = keys
      .map((key) => body.querySelector(`:scope > .node-parameter-row[data-param="${CSS.escape(key)}"]`))
      .filter((row) => row && !row.hidden && !row.classList.contains("node-parameter-row-hidden"));
    if (rows.length < 2) continue;
    const wrap = document.createElement("div");
    wrap.className = "sturmian-param-row";
    wrap.style.setProperty("--sturmian-param-cols", String(rows.length));
    rows[0].before(wrap);
    for (const row of rows) wrap.append(row);
  }
}

registerNodeGraphChromelessModuleUi("sturmianGrid", {
  createBody: sturmianCreateBody,
  afterMount(article, face, node, type) {
    if (typeof registerNodeGraphModuleScopeSlot === "function") {
      registerNodeGraphModuleScopeSlot(article, { nodeId: node, scopeElement: face, type, viewDrag: false });
    }
    if (typeof nodeGraphInstallDrawingFacePump === "function") {
      nodeGraphInstallDrawingFacePump(face, {
        rafKey: "_sturmianRaf", forceKey: "_sturmianForce", clockKey: "sturmianGrid",
        shouldAnimate: sturmianShouldAnimate, paintOnCreate: true,
        paint: sturmianPaint,
      });
    }
    // Param rows are appended after this hook returns; pack them on the next turn.
    queueMicrotask(() => sturmianLayoutParamRows(article));
  },
});

function sturmianPointerFace(event) {
  return event.target.closest?.(".node-sturmian-grid") || sturmianDrag?.face || null;
}

function sturmianOnPointerDown(event) {
  if (event.button !== 0) return;
  const face = sturmianPointerFace(event);
  // By id, not closest('.dsp-node'): Canvas view moves the face out of its module.
  const nodeId = face?.dataset.node || "";
  if (!face || !nodeId) return;
  const plate = face._sturmianPlate || face.querySelector(".node-sturmian-grid-canvas");
  const values = sturmianValues(nodeId, face._sturmianPreview);
  const play = sturmianPlayhead(nodeId, values.steps);
  const time = (performance.now() - face._sturmianStarted) / 1000;
  const hit = sturmianHitFace(face, plate, event, values, play, time);
  if (!hit) return;
  if (hit.kind === "reset") {
    const meta = sturmianResetMetadata();
    const current = values.reset;
    sturmianDrag = {
      kind: "reset",
      face,
      nodeId,
      pointerId: event.pointerId,
      startY: event.clientY,
      startUnit: sturmianResetControlPosition(current, meta),
      lastValue: current,
    };
    face._sturmianPreview = { ...(face._sturmianPreview || {}), reset: current };
    try { face.setPointerCapture?.(event.pointerId); } catch (_error) { /* ignore */ }
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const mask = Math.round(values.stepPattern);
  const turnOn = ((mask >> hit.bit) & 1) === 0;
  if (hit.kind === "lane") {
    sturmianCommit(nodeId, { stepPattern: mask ^ (1 << hit.bit) }, "Sturmian lane map");
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  sturmianDrag = { kind: hit.kind, face, nodeId, turnOn, lastBit: hit.bit, pointerId: event.pointerId };
  face._sturmianPreview = { stepPattern: mask };
  sturmianApplyBit(nodeId, face, hit.bit, turnOn);
  try { face.setPointerCapture?.(event.pointerId); } catch (_error) { /* ignore */ }
  event.preventDefault();
  event.stopPropagation();
}

function sturmianOnPointerMove(event) {
  if (!sturmianDrag || event.pointerId !== sturmianDrag.pointerId) return;
  const { face, nodeId, turnOn } = sturmianDrag;
  if (sturmianDrag.kind === "reset") {
    const next = sturmianResetFromPointer(sturmianDrag.startUnit, sturmianDrag.startY, event.clientY);
    if (next !== sturmianDrag.lastValue) {
      sturmianDrag.lastValue = next;
      sturmianWriteReset(nodeId, face, next, "move");
    }
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const plate = face._sturmianPlate || face.querySelector(".node-sturmian-grid-canvas");
  const values = sturmianValues(nodeId, face._sturmianPreview);
  const play = sturmianPlayhead(nodeId, values.steps);
  const time = (performance.now() - face._sturmianStarted) / 1000;
  const hit = sturmianHitFace(face, plate, event, values, play, time);
  if (!hit || hit.kind !== "cell" || hit.bit === sturmianDrag.lastBit) return;
  sturmianDrag.lastBit = hit.bit;
  sturmianApplyBit(nodeId, face, hit.bit, turnOn);
  event.preventDefault();
  event.stopPropagation();
}

function sturmianOnPointerUp(event) {
  if (!sturmianDrag || event.pointerId !== sturmianDrag.pointerId) return;
  const drag = sturmianDrag;
  const face = drag.face;
  if (drag.kind === "reset") {
    sturmianWriteReset(drag.nodeId, face, drag.lastValue, "up");
  }
  try { face?.releasePointerCapture?.(event.pointerId); } catch (_error) { /* ignore */ }
  if (face) delete face._sturmianPreview;
  sturmianDrag = null;
}

document.addEventListener("pointerdown", sturmianOnPointerDown, true);
document.addEventListener("pointermove", sturmianOnPointerMove, true);
document.addEventListener("pointerup", sturmianOnPointerUp, true);
document.addEventListener("pointercancel", sturmianOnPointerUp, true);
