// Noise Convolution Reverb face: a static wash of the IR's amplitude
// envelope and spectral decay. No lines, no per-tap marks, no live input
// animation. Time runs left to right over Length. The filled silhouette is
// the amplitude envelope (linear-in-dB to -60 dB, then the same 20 ms
// cosine fade the audio uses; 0 dB at the top, -60 dB at the bottom).
// Inside the shape, vertical gradient bands follow the time-varying
// two-pole lowpass (Brightness early, Darkness late, Spectral Shape warps
// the sweep with the same Step Graph segment_rational01 curve as the DSP).
// Left #FF7171 and Right #5454F9 draw additively, like Dark Velvet Reverb;
// Spread 0 stacks them (they add toward white) and Spread 1 eases them
// apart vertically so the two independent IRs read as a stereo wash.
// Soft antialiased edges and a glow; the shape is not clipped unless the
// envelope itself goes above 0 dB. Limits come from the parameter
// definitions. GPU present only (gl-line-renderer); this file does not
// edit that shared renderer.

const NODE_GRAPH_NOISE_CONV_LEFT = "#FF7171";
const NODE_GRAPH_NOISE_CONV_RIGHT = "#5454F9";
const NODE_GRAPH_NOISE_CONV_BG = "#020609";
const NODE_GRAPH_NOISE_CONV_AMP_FLOOR_DB = -60;
const NODE_GRAPH_NOISE_CONV_FADE_SECONDS = 0.020;
const NODE_GRAPH_NOISE_CONV_PLANCK = 1e-7;

function nodeGraphNoiseConvParam(node, key, engineDefault) {
  const def = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions?.[node?.type]?.parameters?.find?.((p) => p.key === key)
    : null;
  const d = Number(def?.defaultValue);
  const fallback = Number.isFinite(d) ? d : engineDefault;
  const live = typeof nodeGraphSinCosLiveParam === "function" ? nodeGraphSinCosLiveParam(node, key, fallback) : node?.params?.[key];
  const n = Number(live);
  return Number.isFinite(n) ? n : fallback;
}

function nodeGraphNoiseConvDefNumber(node, key, field, fallback) {
  const def = typeof nodeGraphModuleDefinitions === "object"
    ? nodeGraphModuleDefinitions?.[node?.type]?.parameters?.find?.((p) => p.key === key)
    : null;
  const n = Number(def?.[field]);
  return Number.isFinite(n) ? n : fallback;
}

function nodeGraphNoiseConvClamp(value, lo, hi, fallback) {
  const n = Number(value);
  const v = Number.isFinite(n) ? n : fallback;
  return Math.max(lo, Math.min(hi, v));
}

function nodeGraphNoiseConvSoftCap(contour) {
  const c = nodeGraphNoiseConvClamp(contour, -1, 1, 0);
  if (c > 1 - NODE_GRAPH_NOISE_CONV_PLANCK) return 1 - NODE_GRAPH_NOISE_CONV_PLANCK;
  if (c < -(1 - NODE_GRAPH_NOISE_CONV_PLANCK)) return -(1 - NODE_GRAPH_NOISE_CONV_PLANCK);
  return c;
}

function nodeGraphNoiseConvRational01(p, contour) {
  if (typeof nodeGraphSegmentRational01 === "function") return nodeGraphSegmentRational01(p, contour);
  const u = nodeGraphNoiseConvClamp(p, 0, 1, 0);
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const c = nodeGraphNoiseConvClamp(contour, -1, 1, 0);
  if (Math.abs(c) < NODE_GRAPH_NOISE_CONV_PLANCK) return u;
  return c < 0 ? (u * (1 + c)) / (1 + c * u) : u / (1 - c + c * u);
}

function nodeGraphNoiseConvCutoffHz(u, startCutoffHz, endCutoffHz, spectralShape, sampleRate) {
  // Same curve as cutoff_hz in noise_conv_reverb.cpp: Start -> End in Hz.
  const sr = sampleRate > 1 && Number.isFinite(sampleRate) ? sampleRate : 48000;
  const ny = 0.45 * sr;
  const fStart = nodeGraphNoiseConvClamp(startCutoffHz, 0, ny, Math.min(1500, ny));
  const fEnd = nodeGraphNoiseConvClamp(endCutoffHz, 0, ny, Math.min(120, ny));
  const w = nodeGraphNoiseConvRational01(u, spectralShape);
  if (fStart === 0 || fEnd === 0) return fStart + (fEnd - fStart) * w;
  return fStart * Math.pow(fEnd / fStart, w);
}

function nodeGraphNoiseConvEnvelope(u, ampShape, fadeStartU) {
  const w = nodeGraphNoiseConvRational01(u, ampShape);
  let env = Math.pow(10, (NODE_GRAPH_NOISE_CONV_AMP_FLOOR_DB / 20) * w);
  if (fadeStartU < 1 && u >= fadeStartU) {
    const x = nodeGraphNoiseConvClamp((u - fadeStartU) / (1 - fadeStartU), 0, 1, 1);
    env *= 0.5 * (1 + Math.cos(Math.PI * x));
  }
  return env;
}

function nodeGraphNoiseConvEnvHeight(env) {
  if (!(env > 0)) return 0;
  const db = 20 * Math.log10(env);
  // 0 dB at the top, -60 dB on the floor. Below the window stays at 0;
  // above 0 dB (a clipped envelope) is allowed to extend past 1.
  return (db - NODE_GRAPH_NOISE_CONV_AMP_FLOOR_DB) / -NODE_GRAPH_NOISE_CONV_AMP_FLOOR_DB;
}

function nodeGraphNoiseConvParseRgb(css, fallback) {
  const rgba = typeof nodeGraphGlGraphParseCssColor === "function"
    ? nodeGraphGlGraphParseCssColor(css, fallback)
    : fallback;
  return [
    nodeGraphNoiseConvClamp(rgba[0], 0, 4, fallback[0]),
    nodeGraphNoiseConvClamp(rgba[1], 0, 4, fallback[1]),
    nodeGraphNoiseConvClamp(rgba[2], 0, 4, fallback[2]),
  ];
}

function nodeGraphNoiseConvEnsureCanvas(section, key, width, height) {
  let canvas = section[key];
  if (!canvas) {
    canvas = document.createElement("canvas");
    section[key] = canvas;
  }
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return canvas;
}

function nodeGraphNoiseConvSmoothstep(t) {
  const x = nodeGraphNoiseConvClamp(t, 0, 1, 0);
  return x * x * (3 - 2 * x);
}

function nodeGraphNoiseConvPaint(section, width, height, pixelRatio, params) {
  const raw = nodeGraphNoiseConvEnsureCanvas(section, "_noiseConvRaw", width, height);
  const ctx = raw.getContext("2d", { alpha: false });
  if (!ctx) return null;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const bg = nodeGraphNoiseConvParseRgb(NODE_GRAPH_NOISE_CONV_BG, [2 / 255, 6 / 255, 9 / 255]);
  const left = nodeGraphNoiseConvParseRgb(NODE_GRAPH_NOISE_CONV_LEFT, [1, 113 / 255, 113 / 255]);
  const right = nodeGraphNoiseConvParseRgb(NODE_GRAPH_NOISE_CONV_RIGHT, [84 / 255, 84 / 255, 249 / 255]);
  const bgR = bg[0] * 255, bgG = bg[1] * 255, bgB = bg[2] * 255;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bgR;
    data[i + 1] = bgG;
    data[i + 2] = bgB;
    data[i + 3] = 255;
  }

  const padX = Math.max(3, 0.03 * width);
  const padY = Math.max(3, 0.08 * height);
  const innerW = Math.max(1, width - padX * 2);
  const innerH = Math.max(1, height - padY * 2);
  const feather = Math.max(1.25 * pixelRatio, 0.045 * innerH);
  const blur = Math.max(2 * pixelRatio, 0.07 * innerH);
  const decorrelate = nodeGraphNoiseConvClamp(params.decorrelate, 0, 1, 1);
  const offset = decorrelate * 0.22 * innerH;
  const fadeStartU = params.length > NODE_GRAPH_NOISE_CONV_FADE_SECONDS
    ? 1 - NODE_GRAPH_NOISE_CONV_FADE_SECONDS / params.length
    : 0;
  const fLow = 80;
  const fHigh = 0.45 * params.sampleRate;
  const logSpan = Math.log(fHigh / fLow);
  // Per-channel gain so a stacked (Spread 0) pair glows toward white
  // without flattening the envelope on contact.
  const ink = 0.72;

  const add = (px, py, rgb, a) => {
    if (!(a > 1 / 512) || px < 0 || py < 0 || px >= width || py >= height) return;
    const i = (py * width + px) * 4;
    const aa = a * ink;
    const v = data[i] + rgb[0] * 255 * aa;
    const g = data[i + 1] + rgb[1] * 255 * aa;
    const b = data[i + 2] + rgb[2] * 255 * aa;
    data[i] = v > 255 ? 255 : v;
    data[i + 1] = g > 255 ? 255 : g;
    data[i + 2] = b > 255 ? 255 : b;
  };

  for (let x = 0; x < width; x += 1) {
    const u = nodeGraphNoiseConvClamp((x + 0.5 - padX) / innerW, 0, 1, 0);
    const env = nodeGraphNoiseConvEnvelope(u, params.ampShape, fadeStartU);
    const heightNorm = nodeGraphNoiseConvEnvHeight(env);
    if (!(heightNorm > 0)) continue;
    const fc = nodeGraphNoiseConvCutoffHz(u, params.startCutoffHz, params.endCutoffHz, params.spectralShape, params.sampleRate);
    const yEnv = padY + innerH * (1 - heightNorm);
    for (let y = 0; y < height; y += 1) {
      const fy = (y + 0.5 - padY) / innerH;
      if (fy <= 0) continue;
      const tFreq = nodeGraphNoiseConvClamp(1 - fy, 0, 1, 0);
      const f = fLow * Math.exp(logSpan * tFreq);
      const ratio = f / (fc > 1 ? fc : 1);
      const spec = 1 / (1 + ratio * ratio);
      const edge = nodeGraphNoiseConvSmoothstep(((y + 0.5) - (yEnv - feather)) / (2 * feather));
      const bottom = nodeGraphNoiseConvSmoothstep((height - padY + feather - (y + 0.5)) / (2 * feather));
      const a = heightNorm * spec * edge * bottom;
      if (!(a > 1 / 512)) continue;
      const yL = y - offset;
      const yR = y + offset;
      const pyL = yL | 0;
      const pyR = yR | 0;
      const fL = yL - pyL;
      const fR = yR - pyR;
      add(x, pyL, left, a * (1 - fL));
      add(x, pyL + 1, left, a * fL);
      add(x, pyR, right, a * (1 - fR));
      add(x, pyR + 1, right, a * fR);
    }
  }
  ctx.putImageData(image, 0, 0);

  const out = nodeGraphNoiseConvEnsureCanvas(section, "_noiseConvOut", width, height);
  const ox = out.getContext("2d", { alpha: false });
  if (!ox) return raw;
  ox.globalCompositeOperation = "copy";
  ox.filter = "none";
  ox.fillStyle = NODE_GRAPH_NOISE_CONV_BG;
  ox.fillRect(0, 0, width, height);
  if (typeof ox.filter === "string") {
    ox.globalCompositeOperation = "source-over";
    ox.filter = `blur(${blur.toFixed(2)}px)`;
    ox.drawImage(raw, 0, 0);
    ox.filter = "none";
    ox.globalCompositeOperation = "lighter";
    ox.drawImage(raw, 0, 0);
    ox.globalCompositeOperation = "source-over";
  } else {
    ox.globalCompositeOperation = "copy";
    ox.drawImage(raw, 0, 0);
  }
  return out;
}

function drawNodeGraphNoiseConvDisplay(section) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(section?.dataset?.node || "") : null;
  const canvas = section?.querySelector?.(".node-display-face");
  if (!node || !canvas || typeof nodeGraphCycleLineGlMetrics !== "function") return;
  const metrics = nodeGraphCycleLineGlMetrics(section, canvas, 1);
  if (!metrics) return;
  const { cssWidth: w, cssHeight: h, pixelRatio, width, height } = metrics;
  if (!(w > 0) || !(h > 0) || !(width > 0) || !(height > 0)) return;

  const lengthMin = nodeGraphNoiseConvDefNumber(node, "decay", "min", 0.001);
  const lengthMax = nodeGraphNoiseConvDefNumber(node, "decay", "max", 6);
  const params = {
    length: nodeGraphNoiseConvClamp(nodeGraphNoiseConvParam(node, "decay", 1.5), lengthMin, lengthMax, 1.5),
    ampShape: nodeGraphNoiseConvSoftCap(nodeGraphNoiseConvParam(node, "ampShape", 0)),
    spectralShape: nodeGraphNoiseConvSoftCap(nodeGraphNoiseConvParam(node, "spectralShape", 0)),
    startCutoffHz: Math.max(0, Number(nodeGraphNoiseConvParam(node, "startCutoffHz", 1500)) || 0),
    endCutoffHz: Math.max(0, Number(nodeGraphNoiseConvParam(node, "endCutoffHz", 120)) || 0),
    decorrelate: nodeGraphNoiseConvClamp(nodeGraphNoiseConvParam(node, "decorrelate", 1), 0, 1, 1),
    sampleRate: Number(nodeGraphMvp?.live?.context?.sampleRate) || 48000,
  };
  const key = [params.length, params.ampShape, params.spectralShape, params.startCutoffHz, params.endCutoffHz, params.decorrelate, params.sampleRate, width, height].join(",");
  if (section._noiseConvKey !== key || !section._noiseConvPicture) {
    section._noiseConvPicture = nodeGraphNoiseConvPaint(section, width, height, pixelRatio, params);
    section._noiseConvKey = key;
  }

  const bg = typeof nodeGraphGlGraphParseCssColor === "function"
    ? nodeGraphGlGraphParseCssColor(NODE_GRAPH_NOISE_CONV_BG, [2 / 255, 6 / 255, 9 / 255, 1])
    : [2 / 255, 6 / 255, 9 / 255, 1];
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, bg, { scale: pixelRatio })
    : null;
  if (!batch) {
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "noise conv face: no shared GL device");
    return;
  }
  if (section._noiseConvPicture && typeof nodeGraphGlLinesImage === "function") {
    nodeGraphGlLinesImage(batch, section._noiseConvPicture, 0, 0, w, h, { nearest: false });
  }
  if (!nodeGraphGlLinesEnd(batch, "alpha") && typeof nodeGraphDisplayGlFailed === "function") {
    nodeGraphDisplayGlFailed(canvas, "noise conv face: GL present failed");
  }
}

function createNodeGraphNoiseConvDisplay(nodeId, type = "noiseConvReverb") {
  const id = nodeId && typeof nodeId === "object" ? String(nodeId.dataset?.node || nodeId.id || "") : String(nodeId || "");
  const section = document.createElement("section");
  section.className = "node-filter-curve-display node-noise-conv-display node-module-face";
  section.dataset.node = id;
  section.dataset.nodeType = String(type || "noiseConvReverb");
  section.dataset.parameterVisual = "true";
  section.append(nodeGraphDisplayCanvasCreate("node-filter-curve-canvas node-noise-conv-canvas"));
  nodeGraphInstallDrawingFacePump(section, {
    clockKey: (el) => `noiseConv:${el.dataset?.node || ""}`,
    forceKey: "_noiseConvForceDraw",
    rafKey: "_noiseConvRaf",
    paint: drawNodeGraphNoiseConvDisplay,
    onResize: (el) => {
      el._noiseConvKey = "";
      if (typeof syncFaceMetrics === "function") syncFaceMetrics(el);
    },
    paintOnCreate: false,
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawNodeGraphNoiseConvDisplay(section);
    section._startFaceLoop?.();
  }));
  return section;
}
