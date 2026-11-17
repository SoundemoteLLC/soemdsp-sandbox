// Packed sounding-bar grid on the shared face texture; standard parameter
// rows live in the module body. Zoom samples nearest past the existing 2.5x
// threshold like other shader faces. Steps sets the square cell size.
const STURMIAN_SHADER_URL = "./public/modules/sturmianGrid/sturmian-grid.glsl?v=shader-ui-15-stg1-stg3-stg4-stg5-stg6";
const STURMIAN_FLOATS = ["alpha", "beta", "rho", "drift", "rate", "steps", "reset", "spread", "walk", "snap", "view", "stepPattern"];
const STURMIAN_LANE_NAMES = ["Kick", "Snare", "Hat", "Melody"];
const STURMIAN_LANE_SHORT = ["K", "S", "H", "M"];
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
  return result;
}

function sturmianPlayhead(nodeId, steps) {
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
  return { playStep, playBar, playing };
}

// Same integer-square packing as the shader: Steps columns fill the width,
// whole rows stack in the leftover height, equal margins, no half cells.
function sturmianGridLayout(width, height, steps) {
  const cols = Math.max(2, Math.floor(Number(steps) + 0.5) || 2);
  const cell = Math.max(2, Math.floor(Math.max(1, width) / cols));
  const rows = Math.max(1, Math.floor(Math.max(1, height) / cell));
  return {
    cols,
    rows,
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

function sturmianHitCell(face, plate, event, values, play, time) {
  if (!face || !plate) return null;
  const rect = plate.getBoundingClientRect();
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const x = (event.clientX - rect.left) * (plate._sturmianCssW || rect.width) / rect.width;
  const y = (event.clientY - rect.top) * (plate._sturmianCssH || rect.height) / rect.height;
  const layout = sturmianGridLayout(plate._sturmianCssW || rect.width, plate._sturmianCssH || rect.height, values.steps);
  const gx = x - layout.ox;
  const gy = y - layout.oy;
  if (gx < 0 || gy < 0 || gx >= layout.cols * layout.cell || gy >= layout.rows * layout.cell) return null;
  const col = Math.floor(gx / layout.cell);
  const row = Math.floor(gy / layout.cell);
  const win = sturmianNTop(play.playBar, values.walk, values.spread, layout.rows);
  const track = sturmianTrackAtRow(row, win.firstN, win.spreadN, win.nTop);
  if (track < 0) return null;
  const tile = sturmianTileAt(values, col, win.nTop + row, time);
  return { col, row, track, tile, bit: track * 3 + tile };
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
    + " uniform float flashStep; uniform float flashMask; uniform float flashAmt;";
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
    flashStep: gl.getUniformLocation(program, "flashStep"),
    flashMask: gl.getUniformLocation(program, "flashMask"),
    flashAmt: gl.getUniformLocation(program, "flashAmt"),
    floats: Object.fromEntries(STURMIAN_FLOATS.map((key) => [key, gl.getUniformLocation(program, key)])),
  };
  return sturmianSharedGpu;
}

function sturmianUpdateFlash(face, values, play, time) {
  if (face._sturmianFlash === undefined) {
    face._sturmianFlash = { playStep: play.playStep, playBar: play.playBar, step: play.playStep, mask: 0, at: 0 };
  } else if (play.playing > 0.5 && (face._sturmianFlash.playStep !== play.playStep || face._sturmianFlash.playBar !== play.playBar)) {
    const mask = Math.round(values.stepPattern);
    const walk = Math.max(0, Math.floor(values.walk + 0.5) || 0);
    const spread = Math.max(1, Math.floor(values.spread + 0.5) || 1);
    let fired = 0;
    for (let track = 0; track < 4; track += 1) {
      if ((mask >> (12 + track)) & 1) continue;
      const n = play.playBar * walk + track * spread;
      const tile = sturmianTileAt(values, play.playStep, n, time);
      if ((mask >> (track * 3 + tile)) & 1) fired |= (1 << track);
    }
    face._sturmianFlash = {
      playStep: play.playStep,
      playBar: play.playBar,
      step: play.playStep,
      mask: fired,
      at: performance.now(),
    };
  }
  const flash = face._sturmianFlash;
  if (!flash || !flash.mask) return { step: 0, mask: 0, amt: 0 };
  const beatMs = 60000 / Math.max(1, Number(values.rate) || 120);
  const amt = Math.max(0, Math.min(1, 1 - (performance.now() - flash.at) / beatMs));
  return { step: flash.step, mask: flash.mask, amt };
}

function sturmianSyncLanes(face, values) {
  const mask = Math.round(Number(values?.stepPattern) || 0);
  face.querySelectorAll("[data-sturmian-bit]").forEach((button) => {
    const on = ((mask >> Number(button.dataset.sturmianBit)) & 1) === 1;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function sturmianPaint(face) {
  if (!face?.isConnected || !face._sturmianShader) return;
  const plate = face._sturmianPlate || face.querySelector(".node-sturmian-grid-canvas");
  if (!plate) return;
  // Layout CSS box x dpr, never workspace zoom. Size the texture to the plate,
  // not the whole face (the lane strip below must not stretch the squares).
  const sized = typeof nodeGraphDisplayCanvasSize === "function"
    ? nodeGraphDisplayCanvasSize(plate, plate)
    : null;
  if (!sized) return;
  const logicalWidth = Math.max(1, sized.cssWidth);
  const logicalHeight = Math.max(1, sized.cssHeight);
  plate._sturmianCssW = logicalWidth;
  plate._sturmianCssH = logicalHeight;
  const width = Math.max(1, sized.width);
  const height = Math.max(1, sized.height);
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
  gl.uniform2f(gpu.resolution, logicalWidth, logicalHeight);
  const time = (performance.now() - face._sturmianStarted) / 1000;
  gl.uniform1f(gpu.time, time);
  const values = sturmianValues(nodeId, face._sturmianPreview);
  for (const key of STURMIAN_FLOATS) gl.uniform1f(gpu.floats[key], values[key]);
  const play = sturmianPlayhead(nodeId, values.steps);
  gl.uniform1f(gpu.playStep, play.playStep);
  gl.uniform1f(gpu.playBar, play.playBar);
  gl.uniform1f(gpu.playing, play.playing);
  gl.uniform1f(gpu.pixelRatio, Math.max(1, Number(sized.pixelRatio) || 1));
  const flash = sturmianUpdateFlash(face, values, play, time);
  gl.uniform1f(gpu.flashStep, flash.step);
  gl.uniform1f(gpu.flashMask, flash.mask);
  gl.uniform1f(gpu.flashAmt, flash.amt);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (typeof nodeGraphSharedGlEndPresent === "function") nodeGraphSharedGlEndPresent(gl);
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(plate)
    : null;
  if (ctx && typeof nodeGraphSharedGlPresent === "function") {
    nodeGraphSharedGlPresent(ctx, width, height);
  }
  sturmianSyncLanes(face, values);
  face.dataset.shaderError = "";
}

function sturmianCommit(nodeId, values, status = "Sturmian Grid") {
  if (!nodeId || !nodeGraphMvp?.patch || typeof cloneNodeGraphPatch !== "function") return false;
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const patchNode = patch.nodes.find((item) => item.id === nodeId);
  if (!patchNode) return false;
  const next = { ...(patchNode.params || {}) };
  for (const [key, value] of Object.entries(values)) {
    next[key] = normalizeNodeGraphPatchParameter(patchNode.type, key, value, patchNode.paramMeta?.[key]);
  }
  patchNode.params = next;
  commitNodeGraphPatch(patch, { status });
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

function sturmianCreateLaneMap() {
  const map = document.createElement("div");
  map.className = "sturmian-lane-map";
  const tiles = ["0", "1", "2", "M"];
  for (let row = 0; row < 4; row++) {
    const group = document.createElement("div");
    group.className = "sturmian-lane-group";
    group.dataset.lane = String(row);
    const label = document.createElement("span");
    label.className = "sturmian-lane-label";
    label.textContent = STURMIAN_LANE_SHORT[row];
    group.append(label);
    for (let col = 0; col < 4; col++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sturmian-lane-toggle";
      button.dataset.sturmianBit = String(col < 3 ? row * 3 + col : 12 + row);
      button.setAttribute("aria-label", `${STURMIAN_LANE_NAMES[row]} ${col === 3 ? "mute" : `tile ${col}`}`);
      button.setAttribute("aria-pressed", "false");
      button.textContent = tiles[col];
      group.append(button);
    }
    map.append(group);
  }
  return map;
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
  face._sturmianPlate = plate;
  const side = document.createElement("div");
  side.className = "sturmian-side";
  side.append(sturmianCreateLaneMap());
  face.append(plate, side);
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
  const button = event.target.closest?.(".sturmian-lane-toggle");
  if (button) {
    sturmianCommit(nodeId, { stepPattern: Math.round(sturmianValues(nodeId).stepPattern) ^ (1 << Number(button.dataset.sturmianBit)) }, "Sturmian lane map");
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const plate = face._sturmianPlate || face.querySelector(".node-sturmian-grid-canvas");
  const values = sturmianValues(nodeId, face._sturmianPreview);
  const play = sturmianPlayhead(nodeId, values.steps);
  const time = (performance.now() - face._sturmianStarted) / 1000;
  const hit = sturmianHitCell(face, plate, event, values, play, time);
  if (!hit) return;
  const mask = Math.round(values.stepPattern);
  const turnOn = ((mask >> hit.bit) & 1) === 0;
  sturmianDrag = { face, nodeId, turnOn, lastBit: hit.bit, pointerId: event.pointerId };
  face._sturmianPreview = { stepPattern: mask };
  sturmianApplyBit(nodeId, face, hit.bit, turnOn);
  try { face.setPointerCapture?.(event.pointerId); } catch (_error) { /* ignore */ }
  event.preventDefault();
  event.stopPropagation();
}

function sturmianOnPointerMove(event) {
  if (!sturmianDrag || event.pointerId !== sturmianDrag.pointerId) return;
  const { face, nodeId, turnOn } = sturmianDrag;
  const plate = face._sturmianPlate || face.querySelector(".node-sturmian-grid-canvas");
  const values = sturmianValues(nodeId, face._sturmianPreview);
  const play = sturmianPlayhead(nodeId, values.steps);
  const time = (performance.now() - face._sturmianStarted) / 1000;
  const hit = sturmianHitCell(face, plate, event, values, play, time);
  if (!hit || hit.bit === sturmianDrag.lastBit) return;
  sturmianDrag.lastBit = hit.bit;
  sturmianApplyBit(nodeId, face, hit.bit, turnOn);
  event.preventDefault();
  event.stopPropagation();
}

function sturmianOnPointerUp(event) {
  if (!sturmianDrag || event.pointerId !== sturmianDrag.pointerId) return;
  const face = sturmianDrag.face;
  try { face?.releasePointerCapture?.(event.pointerId); } catch (_error) { /* ignore */ }
  if (face) delete face._sturmianPreview;
  sturmianDrag = null;
}

document.addEventListener("pointerdown", sturmianOnPointerDown, true);
document.addEventListener("pointermove", sturmianOnPointerMove, true);
document.addEventListener("pointerup", sturmianOnPointerUp, true);
document.addEventListener("pointercancel", sturmianOnPointerUp, true);
