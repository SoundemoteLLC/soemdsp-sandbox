// Gradient lanes, main thread (HP-23): every enabled gradient plays at audio rate in the native graph.
//
// What goes to the worklet (plan.gradientLanes and every setParams): one lane per gradient, { gradientId, sourceId, hidden, playhead,
// targets: [{ nodeId, key, base, lut }] }. The source is the Gradient module bound to that gradient (node.gradientId), else a hidden
// Gradient node the worklet adds ("__gradient:<id>", its Playhead knob = the gradient's position). Each LUT is the domain offset at 257
// playheads, from the param's current base (NodeGraphGradients.laneLut: the same slider-curve maths as the UI). The engine reads the
// playhead every sample and adds the LUT offset after the target's smoother (graph_engine.cpp ParamModEdge.lut).
//
// The 🌈 page playhead and a Gradient module's knob move one value (gradient.position): a drag posts one "gradientPlayhead" message
// (one engine knob, smoothed there) instead of re-sending every param, so a mouse drag sounds as smooth as a cable. A module driven by
// its In cable reports its playhead on the data bus ("Playhead"); the page, the ghosts and the displays follow it (signal motion: not
// saved, not undoable). Events only: patch commits, drags, data-bus snapshots. No timers.

(function (root) {
  "use strict";

  const HIDDEN_PREFIX = "__gradient:";
  const lutCache = new Map(); // `${gradientId}|${nodeId}|${key}` -> { sig, lut }

  /** Lanes run where the engine has them: the efficient native worklet. Elsewhere the UI-rate offsets in the params stay. */
  function nodeGraphGradientLanesEnabled() {
    const live = root.nodeGraphMvp && root.nodeGraphMvp.live;
    if (!live || !live.usesWorklet) return false;
    return typeof root.nodeGraphEfficientProductEnabled === "function" ? root.nodeGraphEfficientProductEnabled() !== false : true;
  }

  function patchNodeById(patch, id) {
    return (patch && Array.isArray(patch.nodes) ? patch.nodes : []).find((n) => n && n.id === id) || null;
  }

  /** The Gradient module bound to a gradient (first in patch order), or null. */
  function nodeGraphGradientModuleFor(gradientId, patch) {
    const p = patch || (root.nodeGraphMvp && root.nodeGraphMvp.patch);
    return (p && Array.isArray(p.nodes) ? p.nodes : []).find((n) => n && n.type === "gradient" && String(n.gradientId || "") === String(gradientId)) || null;
  }

  function nodeGraphGradientSourceId(gradientId, patch) {
    const module = nodeGraphGradientModuleFor(gradientId, patch);
    return module ? module.id : HIDDEN_PREFIX + gradientId;
  }

  function lutFor(gradient, node, key) {
    const base = Number(node.params && node.params[key]);
    const meta = root.NodeGraphGradients.metaFor(node, key);
    const sig = JSON.stringify([base, meta && meta.min, meta && meta.max, gradient.stops, gradient.origin && gradient.origin[node.id]]);
    const cacheKey = `${gradient.id}|${node.id}|${key}`;
    const hit = lutCache.get(cacheKey);
    if (hit && hit.sig === sig) return hit.lut;
    const lut = root.NodeGraphGradients.laneLut(node, key, gradient, 257);
    lutCache.set(cacheKey, { sig, lut });
    return lut;
  }

  /** The lanes message for the live engine, or undefined where lanes do not run. */
  function nodeGraphGradientLanesForLive(patchArg) {
    if (!nodeGraphGradientLanesEnabled() || !root.NodeGraphGradients) return undefined;
    const patch = patchArg || (root.nodeGraphMvp && root.nodeGraphMvp.patch);
    const lanes = [];
    for (const gradient of (patch && Array.isArray(patch.gradients) ? patch.gradients : [])) {
      if (!gradient || gradient.enabled === false || !Array.isArray(gradient.params) || !gradient.params.length) continue;
      const module = nodeGraphGradientModuleFor(gradient.id, patch);
      const targets = [];
      for (const { nodeId, key } of gradient.params) {
        const node = patchNodeById(patch, nodeId);
        if (!node) continue;
        const lut = lutFor(gradient, node, key);
        if (!lut) continue;
        targets.push({ nodeId, key, base: Number(node.params[key]), lut });
      }
      if (!targets.length) continue;
      lanes.push({
        gradientId: gradient.id,
        sourceId: module ? module.id : HIDDEN_PREFIX + gradient.id,
        hidden: !module,
        playhead: Number(gradient.position) || 0,
        targets,
      });
    }
    return lanes;
  }

  /**
   * A playhead move from the page or the module knob. With lanes: one engine knob write, plus the UI (ghosts, displays, page) on the
   * event; no param resync. Without lanes: the old path (params re-sent with the UI-rate offset).
   */
  function nodeGraphGradientsNotifyPlayhead(gradient, status) {
    if (!gradient) return;
    const module = nodeGraphGradientModuleFor(gradient.id);
    if (module) {
      // The module's knob is the same value: keep its param and slider on it.
      module.params = { ...(module.params || {}), playhead: Number(gradient.position) || 0 };
      const slider = typeof root.nodeGraphSliderForParameter === "function" ? root.nodeGraphSliderForParameter(module.id, "playhead") : null;
      if (slider) {
        slider.dataset.domainValue = String(module.params.playhead);
        slider.value = String(module.params.playhead);
        if (typeof root.syncNodeSliderReadout === "function") root.syncNodeSliderReadout(slider);
      }
      if (typeof root.nodeGraphGlGraphNoteValueChrome === "function") root.nodeGraphGlGraphNoteValueChrome(module.id);
    }
    const port = root.nodeGraphMvp && root.nodeGraphMvp.live && root.nodeGraphMvp.live.node && root.nodeGraphMvp.live.node.port;
    if (nodeGraphGradientLanesEnabled() && port) {
      port.postMessage({ type: "gradientPlayhead", sourceId: nodeGraphGradientSourceId(gradient.id), value: Number(gradient.position) || 0 });
      if (typeof root.nodeGraphGradientsNotifyVisuals === "function") root.nodeGraphGradientsNotifyVisuals();
      if (typeof root.scheduleNodeGraphWorkspaceAutosave === "function") root.scheduleNodeGraphWorkspaceAutosave(status || "Gradient position");
      return;
    }
    if (typeof root.nodeGraphGradientsNotifyChanged === "function") root.nodeGraphGradientsNotifyChanged(status);
  }

  /** Data-bus snapshot: a module-driven playhead (knob + In) moves the page, the ghosts and the displays. Signal motion only. */
  function nodeGraphGradientLanesOnSnapshot() {
    const patch = root.nodeGraphMvp && root.nodeGraphMvp.patch;
    if (!patch || !Array.isArray(patch.gradients) || !root.NodeGraphGradients) return;
    let moved = false;
    for (const gradient of patch.gradients) {
      const module = nodeGraphGradientModuleFor(gradient.id, patch);
      let live = NaN;
      if (module && typeof root.nodeGraphDataBus !== "undefined" && typeof root.nodeGraphDataBusKey === "function") {
        const v = root.nodeGraphDataBus.get(root.nodeGraphDataBusKey(module.id, "Playhead"));
        if (v && v.length) live = Number(v[0]);
      }
      const before = root.NodeGraphGradients.positionOf(gradient);
      root.NodeGraphGradients.setLivePlayhead(gradient.id, Number.isFinite(live) ? live : null);
      if (Math.abs(root.NodeGraphGradients.positionOf(gradient) - before) > 1e-6) {
        moved = true;
        if (typeof root.nodeGraphGradientPageUpdateLive === "function") root.nodeGraphGradientPageUpdateLive(gradient);
        if (typeof root.nodeGraphGradientModuleNoteMoved === "function") root.nodeGraphGradientModuleNoteMoved(gradient);
      }
    }
    if (moved && typeof root.nodeGraphGradientsNotifyVisuals === "function") root.nodeGraphGradientsNotifyVisuals();
  }

  root.nodeGraphGradientLanesEnabled = nodeGraphGradientLanesEnabled;
  root.nodeGraphGradientLanesForLive = nodeGraphGradientLanesForLive;
  root.nodeGraphGradientModuleFor = nodeGraphGradientModuleFor;
  root.nodeGraphGradientSourceId = nodeGraphGradientSourceId;
  root.nodeGraphGradientsNotifyPlayhead = nodeGraphGradientsNotifyPlayhead;
  if (typeof root.addNodeGraphModuleScopeSnapshotListener === "function") {
    root.addNodeGraphModuleScopeSnapshotListener(nodeGraphGradientLanesOnSnapshot);
  }
})(typeof window !== "undefined" ? window : globalThis);
