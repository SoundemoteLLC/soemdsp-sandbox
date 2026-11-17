// GLSL draws every visible pixel onto the shared face texture, so zoom
// samples nearest past the existing 2.5x threshold like other shader faces.
// Transparent standard control surfaces use the sandbox's shared slider
// gestures and modifier rules.
const STURMIAN_SHADER_URL = "./public/modules/sturmianGrid/sturmian-grid.glsl?v=shader-ui-15-stg1";
const STURMIAN_FLOATS = ["alpha", "beta", "rho", "drift", "rate", "steps", "reset", "spread", "walk", "snap", "view", "cell", "stepPattern"];
const STURMIAN_PARAMS = [
  { key: "alpha", min: 0.001, max: 0.999, scale: "linear" }, { key: "beta", min: 0.001, max: 0.999, scale: "linear" },
  { key: "rho", min: 0, max: 1, scale: "linear" }, { key: "drift", min: -0.2, max: 0.2, scale: "linear" },
  { key: "rate", min: 40, max: 300000, scale: "log" }, { key: "steps", min: 2, max: 32, scale: "int" },
  { key: "reset", min: 0, max: 65536, scale: "int" }, { key: "spread", min: 1, max: 16, scale: "int" },
  { key: "walk", min: 0, max: 8, scale: "int" }, { key: "snap", min: 0, max: 1, scale: "int" },
  { key: "view", min: 0, max: 2, scale: "int" }, { key: "cell", min: 2, max: 48, scale: "int" },
];
const STURMIAN_PRESET_VALUES = [
  [0.2955977425, 0.1607132448], [0.4142135624, 0.1830127019], [0.3819660113, 0.2360679775],
  [0.3337, 0.2004], [0.0213, 0.4991], [5 / 16, 3 / 16],
];
const STURMIAN_UI_DEFAULT_MASK = 3170;
// One layout table for both the shader and the transparent hit targets, so the
// two cannot drift apart. Fractions of the face; mapPad is in pixels.
const STURMIAN_LAYOUT = Object.freeze({
  mapTop: 0.30, mapRow: 0.06, mapLabel: 0.17, mapPad: 8,
  ctrlTop: 0.565, ctrlBottom: 0.905, presetTop: 0.92,
});
const STURMIAN_PRESET_COUNT = STURMIAN_PRESET_VALUES.length;
const sturmianGlsl = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
// Constants prepended to the shader: layout plus each slider's own range.
function sturmianGlslConstants() {
  const L = STURMIAN_LAYOUT;
  const arr = (name, pick) => `const float ${name}[${STURMIAN_PARAMS.length}] = float[${STURMIAN_PARAMS.length}](${STURMIAN_PARAMS.map((m) => sturmianGlsl(pick(m))).join(",")});`;
  return [
    `const int STURM_PRESET_COUNT=${STURMIAN_PRESET_COUNT};`,
    `const float STURM_MAP_TOP=${sturmianGlsl(L.mapTop)}; const float STURM_MAP_ROW=${sturmianGlsl(L.mapRow)};`,
    `const float STURM_MAP_LABEL=${sturmianGlsl(L.mapLabel)}; const float STURM_MAP_PAD=${sturmianGlsl(L.mapPad)};`,
    `const float STURM_CTRL_TOP=${sturmianGlsl(L.ctrlTop)}; const float STURM_CTRL_BOTTOM=${sturmianGlsl(L.ctrlBottom)}; const float STURM_PRESET_TOP=${sturmianGlsl(L.presetTop)};`,
    arr("STURM_LO", (m) => m.min), arr("STURM_HI", (m) => m.max),
    `const int STURM_LOG_PARAM=${STURMIAN_PARAMS.findIndex((m) => m.scale === "log")};`,
  ].join("\n");
}
let sturmianShaderPromise = null;

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
  for (const { key } of STURMIAN_PARAMS) {
    const value = Number(preview?.[key] ?? params[key]);
    result[key] = Number.isFinite(value) ? value : 0;
  }
  const pattern = Number(preview?.stepPattern ?? params.stepPattern);
  result.stepPattern = Number.isFinite(pattern) ? pattern : STURMIAN_UI_DEFAULT_MASK;
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
  // playBar stays 0 until a native hidden bar tap exists. Default Reset after
  // == Steps already keeps the engine bar at 0, which matches this view.
  return { playStep, playBar, playing };
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
    + "\nuniform float playStep; uniform float playBar; uniform float playing;";
  const vertex = compile(gl.VERTEX_SHADER, "#version 300 es\nin vec2 aPos; out vec2 vUv; void main(){vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0);}");
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float;\nin vec2 vUv; out vec4 out_color; uniform vec2 resolution; uniform float time;\n${sturmianGlslConstants()}\n${uniforms}\n${shader.functions}\nvoid main(){ vec2 uv=vUv; ${shader.body}\n}`);
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
    floats: Object.fromEntries(STURMIAN_FLOATS.map((key) => [key, gl.getUniformLocation(program, key)])),
  };
  return sturmianSharedGpu;
}

function sturmianPaint(face) {
  if (!face?.isConnected || !face._sturmianShader) return;
  const plate = face._sturmianPlate || face.querySelector(".node-sturmian-grid-canvas");
  if (!plate) return;
  // Layout CSS box x dpr, never workspace zoom. The shared face-texture path
  // then samples that zoom-1 picture nearest past the existing 2.5x threshold.
  const sized = typeof nodeGraphDisplayCanvasSize === "function"
    ? nodeGraphDisplayCanvasSize(face, plate)
    : null;
  if (!sized) return;
  const logicalWidth = Math.max(1, sized.cssWidth);
  const logicalHeight = Math.max(1, sized.cssHeight);
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
  gl.uniform1f(gpu.time, (performance.now() - face._sturmianStarted) / 1000);
  const values = sturmianValues(nodeId, face._sturmianPreview);
  for (const key of STURMIAN_FLOATS) gl.uniform1f(gpu.floats[key], values[key]);
  const play = sturmianPlayhead(nodeId, values.steps);
  gl.uniform1f(gpu.playStep, play.playStep);
  gl.uniform1f(gpu.playBar, play.playBar);
  gl.uniform1f(gpu.playing, play.playing);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (typeof nodeGraphSharedGlEndPresent === "function") nodeGraphSharedGlEndPresent(gl);
  const ctx = typeof nodeGraphSharedGlPresentTarget === "function"
    ? nodeGraphSharedGlPresentTarget(plate)
    : null;
  if (ctx && typeof nodeGraphSharedGlPresent === "function") {
    nodeGraphSharedGlPresent(ctx, width, height);
  }
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

registerNodeGraphChromelessModuleUi("sturmianGrid", {
  createBody: sturmianCreateBody,
  afterMount(article, face, node, type) {
    queueMicrotask(() => { if (typeof createNodeSliderReadoutButton === "function") {
      STURMIAN_PARAMS.forEach((meta, index) => {
        const slider = article.querySelector(`input[data-param="${meta.key}"]`);
        if (!slider) return;
        const control = createNodeSliderReadoutButton(slider.id, slider, {
          paramLabel: meta.key,
          ariaLabel: `Sturmian Grid ${meta.key}`,
          mirror: true,
        });
        control.classList.add("sturmian-hit-control");
        const rowH = (STURMIAN_LAYOUT.ctrlBottom - STURMIAN_LAYOUT.ctrlTop) / (STURMIAN_PARAMS.length / 2);
        control.style.left = `${(index % 2) * 50 + 2}%`;
        control.style.top = `${(STURMIAN_LAYOUT.ctrlTop + Math.floor(index / 2) * rowH) * 100}%`;
        control.style.width = "46%";
        control.style.height = `${rowH * 100}%`;
        face.append(control);
      });
    }
    });
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sturmian-hit-control";
      button.setAttribute("aria-label", `Track ${row + 1} ${col === 3 ? "mute" : `tile ${col}`}`); button.dataset.sturmianBit = String(col < 3 ? row * 3 + col : 12 + row);
      // Same cell width as the shader: (face - label - pad) / 4.
      const cellW = `((100% - ${STURMIAN_LAYOUT.mapLabel * 100}% - ${STURMIAN_LAYOUT.mapPad}px) / 4)`;
      button.style.left = `calc(${STURMIAN_LAYOUT.mapLabel * 100}% + ${col} * ${cellW})`;
      button.style.top = `${(STURMIAN_LAYOUT.mapTop + row * STURMIAN_LAYOUT.mapRow) * 100}%`;
      button.style.width = `calc(${cellW})`;
      button.style.height = `${STURMIAN_LAYOUT.mapRow * 100}%`;
      face.append(button);
    }
    STURMIAN_PRESET_VALUES.forEach((preset, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sturmian-hit-control";
      button.setAttribute("aria-label", `Sturmian preset ${index + 1}`); button.dataset.sturmianPreset = String(index);
      button.style.left = `${index * 100 / STURMIAN_PRESET_COUNT}%`;
      button.style.top = `${STURMIAN_LAYOUT.presetTop * 100}%`;
      button.style.width = `${100 / STURMIAN_PRESET_COUNT}%`;
      button.style.height = `${(1 - STURMIAN_LAYOUT.presetTop) * 100}%`;
      face.append(button);
    });
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

document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest?.(".sturmian-hit-control[data-sturmian-preset], .sturmian-hit-control[data-sturmian-bit]");
  if (!button || event.button !== 0) return;
  const nodeId = button.closest(".node-sturmian-grid")?.dataset.node;
  if (button.dataset.sturmianPreset !== undefined) {
    const preset = STURMIAN_PRESET_VALUES[Number(button.dataset.sturmianPreset)];
    sturmianCommit(nodeId, { alpha: preset[0], beta: preset[1] }, "Sturmian preset");
  } else {
    sturmianCommit(nodeId, { stepPattern: Math.round(sturmianValues(nodeId).stepPattern) ^ (1 << Number(button.dataset.sturmianBit)) }, "Sturmian lane map");
  }
  event.preventDefault();
  event.stopPropagation();
}, true);
