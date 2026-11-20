// Picture parameters: the value a picture (shader) module draws with this frame.
//
// A picture module (Kaleidoscope, CRT Raster, Chroma Color, ...) paints once per animation frame. Its parameters can be modulated
// like any other: a cable into a parameter's MOD jack. This file turns knob + MOD cables into one number per parameter per frame,
// with the same fold the audio engine and the slider ghost use (nodeGraphParamFoldOrBase), so the picture, the ghost and the
// engine agree.
//
//   Base       the knob (nodeGraphReadNodeNumber: the patch value).
//   MOD        each cable's source reduced to one value per frame: the MEAN of every sample the source wrote since this module's
//              previous frame. That is what the frame is exposed to (a box filter exactly one frame long), so a signal faster than
//              the picture can show averages out instead of aliasing into slow fake motion. DC and slow CV pass unchanged. Counted
//              by samples written (the ring's total count), not wall time, so a late frame just averages more and nothing is
//              counted twice. A frame with no new samples holds the previous mean.
//   Fold       nodeGraphParamFoldOrBase (unit MOD across the definition's [min, max], clipped to it; "Use real mod values" adds
//              real units), then nodeGraphParamApplyDomainBounds (wraparound, hardClamp, constraint: gpu).
//   Step       a definition step > 0 snaps the result to min + k * step (choices, counts).
//   Smoothing  only when the definition sets frameSmoothingSeconds = tau > 0: a one-pole on the folded value with
//              a = 1 - exp(-dt / tau), dt the measured time between this module's paints. Unset or 0 = none (the default).
//
// Limits come only from the parameter definitions (and patch paramMeta). Nothing here clamps or scales on its own.

const nodeGraphPictureParamState = {
  modIndex: null,
  modIndexPatch: null,
  modIndexModulations: null,
  modIndexCount: -1,
  // `${consumer}\u0000${source}:${port}` -> { total, mean, stamp }
  cursors: new Map(),
  // `${nodeId}\u0000${key}` -> { value, t }
  smoothers: new Map(),
  // `${type}\u0000${key}` -> raw definition parameter (or null)
  definitions: new Map(),
};

function nodeGraphPictureParamFrameStamp() {
  const t = typeof document !== "undefined" ? document.timeline?.currentTime : null;
  return Number.isFinite(t) ? t : (typeof performance !== "undefined" ? performance.now() : Date.now());
}

/** destinationNode -> Map(destinationParam -> [modulation]). Rebuilt only when the patch or its modulation list changes. */
function nodeGraphPictureParamModIndex() {
  const patch = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp?.patch : null;
  const mods = patch?.modulations || [];
  const s = nodeGraphPictureParamState;
  if (s.modIndex && s.modIndexPatch === patch && s.modIndexModulations === patch?.modulations && s.modIndexCount === mods.length) {
    return s.modIndex;
  }
  const index = new Map();
  for (let i = 0; i < mods.length; i += 1) {
    const m = mods[i];
    const node = String(m?.destinationNode || "");
    const param = String(m?.destinationParam || "");
    if (!node || !param || !m?.sourceNode) continue;
    let byParam = index.get(node);
    if (!byParam) index.set(node, (byParam = new Map()));
    const list = byParam.get(param);
    if (list) list.push(m);
    else byParam.set(param, [m]);
  }
  s.modIndex = index;
  s.modIndexPatch = patch;
  s.modIndexModulations = patch?.modulations;
  s.modIndexCount = mods.length;
  return index;
}

/** The raw definition entry of a parameter (fields the metadata normalizer does not carry, such as frameSmoothingSeconds). */
function nodeGraphPictureParamDefinition(type, key) {
  const cacheKey = `${type}\u0000${key}`;
  const cache = nodeGraphPictureParamState.definitions;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const list = typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions?.[type]?.parameters : null;
  const found = Array.isArray(list) ? (list.find((p) => p?.key === key) || null) : null;
  cache.set(cacheKey, found);
  return found;
}

/**
 * One value per frame from a MOD source, for one consumer (a picture node): the mean of the samples the source's capture ring
 * received since that consumer's previous frame. Every parameter of the consumer fed by the same source shares the result within
 * a frame. null when the source has nothing to read yet.
 */
function nodeGraphPictureParamSourceMean(consumerId, sourceNode, sourcePort, stamp) {
  const src = String(sourceNode || "").trim();
  const port = String(sourcePort || "").trim();
  if (!src || !port) return null;
  const key = `${consumerId}\u0000${src}:${port}`;
  const cursors = nodeGraphPictureParamState.cursors;
  const prev = cursors.get(key);
  if (prev && prev.stamp === stamp) return prev.mean;
  const buffer = typeof nodeGraphModuleScopeState !== "undefined"
    ? nodeGraphModuleScopeState?.buffers?.get?.(`${src}:${port}`)
    : null;
  if (!buffer?.length) {
    // No capture ring for this port (a controller Bias, a parameter-out thru, a portal): the ghost's one-sample read, held.
    const sample = typeof nodeGraphGhostSliderModSample === "function" ? nodeGraphGhostSliderModSample(src, port) : null;
    const n = sample == null ? NaN : Number(sample);
    const mean = Number.isFinite(n) ? n : (prev ? prev.mean : null);
    cursors.set(key, { total: prev ? prev.total : 0, mean, stamp });
    return mean;
  }
  const total = Math.max(0, Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeTotalSampleCount)));
  const retained = Math.floor(nodeGraphFiniteNumber(buffer.nodeGraphScopeRetainedSampleCount));
  const available = retained > 0 ? Math.min(buffer.length, retained) : buffer.length;
  let fresh;
  if (!prev || total < prev.total) {
    // First read (or the ring was rebuilt): there is no previous frame, so the newest sample is the value.
    fresh = 1;
  } else {
    fresh = total - prev.total;
  }
  if (fresh <= 0) {
    // Nothing arrived since the last frame (posts come in blocks): hold.
    cursors.set(key, { total, mean: prev.mean, stamp });
    return prev.mean;
  }
  // A cursor further behind than the ring holds (hidden tab): average what the ring still has.
  const n = Math.max(1, Math.min(fresh, available));
  let sum = 0;
  let count = 0;
  for (let i = buffer.length - n; i < buffer.length; i += 1) {
    const v = buffer[i];
    if (v - v === 0) {
      sum += v;
      count += 1;
    }
  }
  const mean = count ? sum / count : (prev ? prev.mean : null);
  cursors.set(key, { total, mean, stamp });
  return mean;
}

/** Knob + this frame's MOD for one parameter, folded and bounded by its definition. */
function nodeGraphPictureParam(nodeId, key, stamp = nodeGraphPictureParamFrameStamp()) {
  const id = String(nodeId || "");
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
  const type = String(patchNode?.type || (typeof nodeGraphPatchNodeType === "function" ? nodeGraphPatchNodeType(id) : "") || "");
  const metadata = (typeof nodeGraphReadPatchParameterMetadata === "function"
    ? nodeGraphReadPatchParameterMetadata(patchNode || id, key)
    : null) || {};
  let base = typeof nodeGraphReadNodeNumber === "function" ? Number(nodeGraphReadNodeNumber(id, key)) : NaN;
  if (!Number.isFinite(base)) {
    base = typeof nodeGraphParameterFallback === "function" ? Number(nodeGraphParameterFallback(type, key)) : 0;
  }
  const mods = nodeGraphPictureParamModIndex().get(id)?.get(key);
  const sources = [];
  if (mods && mods.length) {
    const domain = metadata.outputDomain === true;
    for (let i = 0; i < mods.length; i += 1) {
      const mean = nodeGraphPictureParamSourceMean(id, mods[i].sourceNode, mods[i].sourcePort, stamp);
      if (mean == null || !Number.isFinite(mean)) continue;
      sources.push(domain ? { value: mean, domain: true } : mean);
    }
  }
  let value = typeof nodeGraphParamFoldOrBase === "function"
    ? Number(nodeGraphParamFoldOrBase(base, sources, metadata))
    : base;
  if (typeof nodeGraphParamApplyDomainBounds === "function") {
    value = Number(nodeGraphParamApplyDomainBounds(value, metadata));
  }
  const definition = nodeGraphPictureParamDefinition(type, key);
  const tau = Number(definition?.frameSmoothingSeconds);
  if (tau > 0) {
    const sKey = `${id}\u0000${key}`;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const prev = nodeGraphPictureParamState.smoothers.get(sKey);
    if (prev && Number.isFinite(prev.value)) {
      const dt = Math.max(0, now - prev.t);
      value = prev.value + (value - prev.value) * (1 - Math.exp(-dt / tau));
    }
    nodeGraphPictureParamState.smoothers.set(sKey, { value, t: now });
  }
  const step = Number(metadata.step);
  if (step > 0) {
    const origin = Number.isFinite(Number(metadata.min)) ? Number(metadata.min) : 0;
    value = origin + Math.round((value - origin) / step) * step;
  }
  return Number.isFinite(value) ? value : base;
}

/** Every listed parameter of a picture node for this frame: { key: value }. Call once per paint. */
function nodeGraphPictureParams(nodeId, keys) {
  const stamp = nodeGraphPictureParamFrameStamp();
  const out = {};
  for (let i = 0; i < keys.length; i += 1) {
    out[keys[i]] = nodeGraphPictureParam(nodeId, keys[i], stamp);
  }
  return out;
}

/** The keys of a module's definition parameters (what a picture face reads). */
function nodeGraphPictureParamKeys(type) {
  const list = typeof nodeGraphModuleDefinitions === "object" ? nodeGraphModuleDefinitions?.[type]?.parameters : null;
  return Array.isArray(list) ? list.map((p) => p?.key).filter(Boolean) : [];
}

if (typeof window !== "undefined") {
  window.nodeGraphPictureParam = nodeGraphPictureParam;
  window.nodeGraphPictureParams = nodeGraphPictureParams;
  window.nodeGraphPictureParamKeys = nodeGraphPictureParamKeys;
}
