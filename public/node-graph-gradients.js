// Gradients (Stage A2, no UI): patch.gradients, the capture helpers the Gradients page will call, and the param offset provider that makes a
// gradient move effective param values. docs/MODULE_GRADIENTS_AND_PRESETS_PLAN.md sections 4.1 to 4.6.
//
// A gradient is patch-level data: { id, name, enabled, position (0..1), origin: { nodeId: { key: slider } }, params: [{ nodeId, key }],
// stops: [{ id, pos (0..1), offsets: { nodeId: { key: sliderOffset } } }] }. Everything is in SLIDER space: the normalized knob travel of a
// parameter, 0..1, mapped to the domain by the definition's own curve and min / max (nodeGraphParamControlPosition and
// nodeGraphParamDomainFromControlPosition), so a log Hz slider and a linear slider blend the same way. A stop stores OFFSETS from the origin,
// and a missing key means 0. node.params (the base) is never written here.
//
// Effective value (continuous params):  finalSlider = clamp01(baseSlider + sum of the enabled gradients' offsets at their positions), then the
// definition's curve and min / max. The clamp is the definition's range: nothing is hardcoded and nothing is per gradient. A param nobody
// moves is left exactly as it came (no round trip through slider space). Choice, switch and integer-step params do not use the sum: they
// snap at the halfway point between neighbouring stops (t < 0.5 keeps stop A, otherwise stop B; two stops at one position switch hard).
// Outside the end stops the offset holds the end value (D-G2, Argi t449u). Missing node ids and param keys are skipped when applying and
// the stored list is never rewritten.
//
// Events only: the page changes a gradient and calls nodeGraphGradientsNotifyChanged; nothing here polls or uses a timer.

(function (root) {
  "use strict";

  const EPSILON = 1e-4; // a base differing from the origin by more than this fraction of slider travel is "moved"
  // Module-level data that is not a slider: it holds still under a gradient.
  const HOLDS_STILL = new Set(["stepGraph", "smoothGraph", "stepRegister", "chordMemory"]);

  function finite(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function plain(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  // ------------------------------------------------------------------------------------------------ parameter metadata and slider space

  function metaFor(node, key) {
    if (typeof root.nodeGraphReadPatchParameterMetadata === "function") {
      try {
        const meta = root.nodeGraphReadPatchParameterMetadata(node, key);
        if (plain(meta) && Number.isFinite(Number(meta.max) - Number(meta.min))) return meta;
      } catch (error) { /* fall through to the stored metadata */ }
    }
    const stored = node && node.paramMeta && node.paramMeta[key];
    return plain(stored) ? stored : null;
  }

  function hasChoices(meta) {
    return Array.isArray(meta && meta.choices) && meta.choices.length > 0;
  }

  // Choice, switch and integer-step params (Seed, step counts) cannot be blended: they snap.
  function isDiscrete(meta) {
    if (!meta) return false;
    if (hasChoices(meta) || meta.kind === "seed") return true;
    const step = Number(meta.step);
    return Number.isFinite(step) && step >= 1;
  }

  function toSlider(meta, value) {
    if (typeof root.nodeGraphParamControlPosition === "function") return root.nodeGraphParamControlPosition(value, meta);
    const min = Number(meta.min);
    const range = Number(meta.max) - min;
    return range > 0 ? clamp01((Number(value) - min) / range) : 0;
  }

  function fromSlider(meta, slider) {
    if (typeof root.nodeGraphParamDomainFromControlPosition === "function") return root.nodeGraphParamDomainFromControlPosition(slider, meta);
    const min = Number(meta.min);
    return min + (Number(meta.max) - min) * clamp01(slider);
  }

  function snapToStep(meta, value) {
    const step = Number(meta.step);
    if (!Number.isFinite(step) || step <= 0) return value;
    const min = Number(meta.min);
    return min + Math.round((value - min) / step) * step;
  }

  // ------------------------------------------------------------------------------------------------ evaluation

  function sortedStops(gradient) {
    return (gradient.stops || [])
      .map((stop, index) => ({ stop, index }))
      .sort((a, b) => (a.stop.pos - b.stop.pos) || (a.index - b.index))
      .map((entry) => entry.stop);
  }

  // The neighbouring stops and where the position sits between them. Hold outside the ends; two stops at one position switch hard (the
  // later one wins from that position on).
  function segmentAt(stops, position) {
    const n = stops.length;
    if (!n) return null;
    let last = -1;
    for (let i = 0; i < n; i += 1) if (stops[i].pos <= position) last = i;
    if (last < 0) return { a: stops[0], b: stops[0], t: 0 };
    if (last === n - 1) return { a: stops[n - 1], b: stops[n - 1], t: 0 };
    const a = stops[last];
    const b = stops[last + 1];
    return { a, b, t: (position - a.pos) / (b.pos - a.pos) };
  }

  function offsetOf(stop, nodeId, key) {
    const byNode = stop && stop.offsets && stop.offsets[nodeId];
    return byNode ? finite(byNode[key], 0) : 0;
  }

  function usable(gradient) {
    return plain(gradient) && gradient.enabled !== false && Array.isArray(gradient.stops) && Array.isArray(gradient.params);
  }

  function currentGradients() {
    const patch = root.nodeGraphMvp && root.nodeGraphMvp.patch;
    return patch && Array.isArray(patch.gradients) ? patch.gradients : null;
  }

  /**
   * Apply every enabled gradient to one node's live params (edited in place). Continuous params get the summed slider offset, discrete ones
   * the snapped stop value. Params that are not on the node, or have no usable metadata, are skipped.
   */
  function applyParams(node, params) {
    const gradients = currentGradients();
    if (!gradients || !gradients.length || !node || !params) return;
    const sums = new Map();
    const metas = new Map();
    for (const gradient of gradients) {
      if (!usable(gradient)) continue;
      const mine = gradient.params.filter((entry) => plain(entry) && entry.nodeId === node.id && typeof params[entry.key] === "number");
      if (!mine.length) continue;
      const stops = sortedStops(gradient);
      const segment = segmentAt(stops, clamp01(finite(gradient.position, 0)));
      if (!segment) continue;
      for (const { key } of mine) {
        let meta = metas.get(key);
        if (meta === undefined) {
          meta = metaFor(node, key);
          metas.set(key, meta);
        }
        if (!meta) continue;
        if (isDiscrete(meta)) {
          const stop = segment.t < 0.5 ? segment.a : segment.b;
          const originSlider = gradient.origin && gradient.origin[node.id] && Number.isFinite(Number(gradient.origin[node.id][key]))
            ? Number(gradient.origin[node.id][key])
            : toSlider(meta, params[key]);
          params[key] = snapToStep(meta, fromSlider(meta, clamp01(originSlider + offsetOf(stop, node.id, key))));
        } else {
          const offset = offsetOf(segment.a, node.id, key) + (offsetOf(segment.b, node.id, key) - offsetOf(segment.a, node.id, key)) * segment.t;
          sums.set(key, (sums.get(key) || 0) + offset);
        }
      }
    }
    for (const [key, sum] of sums) {
      if (sum === 0) continue; // nobody moves it: the value stays exactly as it came
      const meta = metas.get(key);
      params[key] = fromSlider(meta, clamp01(toSlider(meta, params[key]) + sum));
    }
  }

  /** The single-value path of the live engine: the effective value of one key from its base value. */
  function applyToBase(node, key, base, metadata) {
    if (typeof base !== "number") return base;
    const holder = { [key]: base };
    const meta = plain(metadata) && Number.isFinite(Number(metadata.max) - Number(metadata.min)) ? metadata : null;
    if (meta) {
      const probe = { id: node.id, type: node.type, params: { [key]: base }, paramMeta: { [key]: meta } };
      applyParams(probe, holder);
    } else {
      applyParams(node, holder);
    }
    return holder[key];
  }

  // ------------------------------------------------------------------------------------------------ normalize

  function uniqueId(used, prefix, start) {
    let n = start;
    while (used.has(`${prefix}${n}`)) n += 1;
    const id = `${prefix}${n}`;
    used.add(id);
    return id;
  }

  /** Shape-only normalization (types, finite numbers, unique ids). Dangling node ids and keys are kept: they are skipped when applying. */
  function normalizeGradients(input) {
    if (!Array.isArray(input)) return [];
    const out = [];
    const usedGradientIds = new Set();
    for (const raw of input) {
      if (!plain(raw)) continue;
      let id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : "";
      if (!id || usedGradientIds.has(id)) id = uniqueId(usedGradientIds, "g", out.length + 1);
      else usedGradientIds.add(id);
      const origin = {};
      if (plain(raw.origin)) {
        for (const [nodeId, byKey] of Object.entries(raw.origin)) {
          if (!plain(byKey)) continue;
          const row = {};
          for (const [key, value] of Object.entries(byKey)) if (Number.isFinite(Number(value)) && value !== null) row[key] = Number(value);
          if (Object.keys(row).length) origin[nodeId] = row;
        }
      }
      const params = [];
      const seenParam = new Set();
      for (const entry of Array.isArray(raw.params) ? raw.params : []) {
        if (!plain(entry) || typeof entry.nodeId !== "string" || typeof entry.key !== "string") continue;
        const tag = `${entry.nodeId}\u0000${entry.key}`;
        if (seenParam.has(tag)) continue;
        seenParam.add(tag);
        params.push({ nodeId: entry.nodeId, key: entry.key });
      }
      const usedStopIds = new Set();
      const stops = [];
      for (const rawStop of Array.isArray(raw.stops) ? raw.stops : []) {
        if (!plain(rawStop) || !Number.isFinite(Number(rawStop.pos)) || rawStop.pos === null) continue;
        let stopId = typeof rawStop.id === "string" && rawStop.id.trim() ? rawStop.id.trim() : "";
        if (!stopId || usedStopIds.has(stopId)) stopId = uniqueId(usedStopIds, "s", stops.length + 1);
        else usedStopIds.add(stopId);
        const offsets = {};
        if (plain(rawStop.offsets)) {
          for (const [nodeId, byKey] of Object.entries(rawStop.offsets)) {
            if (!plain(byKey)) continue;
            const row = {};
            for (const [key, value] of Object.entries(byKey)) if (Number.isFinite(Number(value)) && value !== null) row[key] = Number(value);
            if (Object.keys(row).length) offsets[nodeId] = row;
          }
        }
        stops.push({ id: stopId, pos: clamp01(Number(rawStop.pos)), offsets });
      }
      out.push({
        id,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name : `Gradient ${out.length + 1}`,
        enabled: raw.enabled !== false,
        position: clamp01(finite(raw.position, 0)),
        origin,
        params,
        stops,
      });
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ capture (pure: they return new objects)

  // Every slider-space base value in the patch that can take part in a gradient, as { nodeId: { key: slider } }.
  function baseSliders(patch) {
    const out = {};
    for (const node of (patch && Array.isArray(patch.nodes)) ? patch.nodes : []) {
      if (!node || typeof node.id !== "string" || !plain(node.params) || HOLDS_STILL.has(node.type)) continue;
      const row = {};
      for (const key of Object.keys(node.params)) {
        const value = node.params[key];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        const meta = metaFor(node, key);
        if (meta) row[key] = toSlider(meta, value);
      }
      if (Object.keys(row).length) out[node.id] = row;
    }
    return out;
  }

  /** First snapshot: a new gradient named "Gradient N" (next unused N), origin = the current BASE sliders, one stop at position 0. */
  function createGradientFromSnapshot(patch) {
    const gradients = patch && Array.isArray(patch.gradients) ? patch.gradients : [];
    const names = new Set(gradients.map((g) => g && g.name));
    const ids = new Set(gradients.map((g) => g && g.id));
    let n = 1;
    while (names.has(`Gradient ${n}`)) n += 1;
    return {
      id: uniqueId(ids, "g", n),
      name: `Gradient ${n}`,
      enabled: true,
      position: 0,
      origin: baseSliders(patch),
      params: [],
      stops: [{ id: "s1", pos: 0, offsets: {} }],
    };
  }

  /** A param whose offset is zero at every stop is removed from `params` and from the stops. */
  function dropAllZeroParams(gradient) {
    const params = gradient.params.filter((entry) => gradient.stops.some((stop) => offsetOf(stop, entry.nodeId, entry.key) !== 0));
    const keep = new Set(params.map((entry) => `${entry.nodeId}\u0000${entry.key}`));
    const stops = gradient.stops.map((stop) => {
      const offsets = {};
      for (const [nodeId, byKey] of Object.entries(stop.offsets || {})) {
        const row = {};
        for (const [key, value] of Object.entries(byKey)) if (keep.has(`${nodeId}\u0000${key}`) && value !== 0) row[key] = value;
        if (Object.keys(row).length) offsets[nodeId] = row;
      }
      return { ...stop, offsets };
    });
    return { ...gradient, params, stops };
  }

  /**
   * Later snapshot at `position`: every param whose BASE slider differs from the origin by more than 1e-4 of slider travel is registered and
   * the stop stores its offset. A param that first moves at a later stop joins `params` (earlier stops have an implicit zero). A snapshot on
   * an existing stop replaces it. Reads base params only, never the effective values, so a gradient never learns from its own output.
   */
  function snapshotIntoGradient(patch, gradient, position) {
    const pos = clamp01(finite(position, 0));
    const now = baseSliders(patch);
    const offsets = {};
    const params = gradient.params.map((entry) => ({ ...entry }));
    const known = new Set(params.map((entry) => `${entry.nodeId}\u0000${entry.key}`));
    for (const [nodeId, byKey] of Object.entries(now)) {
      for (const [key, slider] of Object.entries(byKey)) {
        const origin = gradient.origin && gradient.origin[nodeId] && gradient.origin[nodeId][key];
        if (!Number.isFinite(origin)) continue; // a param that did not exist at the first snapshot has no origin
        const delta = slider - origin;
        if (Math.abs(delta) <= EPSILON) continue;
        (offsets[nodeId] || (offsets[nodeId] = {}))[key] = delta;
        if (!known.has(`${nodeId}\u0000${key}`)) {
          known.add(`${nodeId}\u0000${key}`);
          params.push({ nodeId, key });
        }
      }
    }
    const stops = gradient.stops.map((stop) => ({ ...stop, offsets: { ...stop.offsets } }));
    const existing = stops.findIndex((stop) => Math.abs(stop.pos - pos) < 1e-9);
    if (existing >= 0) {
      stops[existing] = { ...stops[existing], offsets };
    } else {
      const used = new Set(stops.map((stop) => stop.id));
      stops.push({ id: uniqueId(used, "s", stops.length + 1), pos, offsets });
      stops.sort((a, b) => a.pos - b.pos);
    }
    return dropAllZeroParams({ ...gradient, params, stops });
  }

  /** Set start: re-record the origin from the current base sliders. Stored offsets keep their numbers. */
  function setStart(patch, gradient) {
    return { ...gradient, origin: baseSliders(patch) };
  }

  /**
   * D-G1 (Argi t449u): deleting modules drops their params from every gradient (origin, params and stop offsets), in the same commit as
   * the delete, so no dangling refs are saved. Gradients themselves stay, even when nothing is left in them. Pure: returns a new list.
   */
  function dropNodes(gradients, nodeIds) {
    const gone = nodeIds instanceof Set ? nodeIds : new Set(nodeIds || []);
    if (!Array.isArray(gradients) || !gone.size) return gradients;
    return gradients.map((gradient) => {
      if (!plain(gradient)) return gradient;
      const origin = {};
      for (const [nodeId, row] of Object.entries(gradient.origin || {})) if (!gone.has(nodeId)) origin[nodeId] = row;
      const stops = (gradient.stops || []).map((stop) => {
        const offsets = {};
        for (const [nodeId, row] of Object.entries(stop.offsets || {})) if (!gone.has(nodeId)) offsets[nodeId] = row;
        return { ...stop, offsets };
      });
      const params = (gradient.params || []).filter((entry) => !gone.has(entry.nodeId));
      return { ...gradient, origin, params, stops };
    });
  }

  /** The [nodeId, key] pairs the enabled gradients move (offset-provider targets: ghosts and displays show them). */
  function targets() {
    const out = [];
    for (const gradient of currentGradients() || []) {
      if (!usable(gradient)) continue;
      for (const entry of gradient.params) if (plain(entry)) out.push([entry.nodeId, entry.key]);
    }
    return out;
  }

  /** Tell the engine and the autosave that a gradient changed (a position or stop edit). Events only. */
  function notifyChanged(status) {
    if (typeof root.markNodeGraphRenderPending === "function") root.markNodeGraphRenderPending();
    // The moved values show at once where a modulated value shows: ghost, slider number and every display reading the param.
    if (typeof root.syncNodeGraphGhostSliders === "function") root.syncNodeGraphGhostSliders();
    // Every gradient's nodes, enabled or not: a gradient just switched Off must repaint its nodes back to their base too.
    const ids = new Set();
    for (const gradient of currentGradients() || []) {
      for (const entry of (plain(gradient) && Array.isArray(gradient.params) ? gradient.params : [])) if (plain(entry)) ids.add(String(entry.nodeId));
    }
    for (const id of ids) {
      if (typeof root.nodeGraphGlGraphNoteValueChrome === "function") root.nodeGraphGlGraphNoteValueChrome(id);
      const el = typeof root.nodeGraphNodeElement === "function" ? root.nodeGraphNodeElement(id) : null;
      if (el && typeof root.syncNodeGraphParameterVisualsForNodeElement === "function") root.syncNodeGraphParameterVisualsForNodeElement(el);
    }
    if (ids.size && typeof root.scheduleNodeGraphModuleScopeDrawIfNeeded === "function") root.scheduleNodeGraphModuleScopeDrawIfNeeded();
    if (typeof root.scheduleNodeGraphLiveParameterSync === "function") root.scheduleNodeGraphLiveParameterSync();
    if (typeof root.scheduleNodeGraphWorkspaceAutosave === "function") root.scheduleNodeGraphWorkspaceAutosave(status || "Gradient changed");
  }

  root.NodeGraphGradients = {
    normalize: normalizeGradients,
    createGradientFromSnapshot,
    snapshotIntoGradient,
    setStart,
    dropAllZeroParams,
    dropNodes,
    isDiscrete,
    holdsStill: (type) => HOLDS_STILL.has(type),
  };
  root.nodeGraphNormalizeGradients = normalizeGradients;
  root.nodeGraphGradientsNotifyChanged = notifyChanged;

  if (typeof root.registerNodeGraphParamOffsetProvider === "function") {
    // Gradients first, the Pitch Mutator (order 20) after them: docs/MODULE_GRADIENTS_AND_PRESETS_PLAN.md section 4.4.
    root.registerNodeGraphParamOffsetProvider({ id: "gradients", order: 10, applyParams, applyToBase, targets });
  }
})(typeof window !== "undefined" ? window : globalThis);
