// One list of param offset providers: the single place where an "effective param" (the base value in node.params plus whatever moves it
// without rewriting it) is computed. Gradients are first in the list, the Pitch Mutator second (see docs/MODULE_GRADIENTS_AND_PRESETS_PLAN.md
// section 4.4). node.params (the base) is never written here: saving, undo and snapshots stay honest.
//
// A provider is { id, order, applyParams(node, params), applyToBase?(node, key, base, metadata), targets?() }:
//   applyParams   moves values in `params` (a copy of node's params, keyed by param key) in place, for one node.
//   applyToBase   returns the effective value of one key from its base value (the single-value path of the live engine).
//   targets       the [nodeId, key] pairs it can move right now (the ghost sliders ask, so an offset shows like a modulation does).
// Providers run in ascending `order` (ties keep registration order); registering the same id again replaces that provider.
//
// Consumers: node-graph-live-plan-runtime.js (live params), node-graph-live-parameter-runtime.js (one value), plugin-host.js (the diff it
// posts to the native engine). Parameter values only: no camera, cull or drawing code lives here. When a node's offsets change, the GPU
// drawn controls are told with nodeGraphGlGraphNoteValueChrome(id) so they repaint. Events only: nothing here polls or uses a timer.

(function (root) {
  "use strict";

  /** @type {{ id: string, order: number, seq: number, applyParams: Function, applyToBase: Function|null }[]} */
  let providers = [];
  let sequence = 0;
  // Per node id: what its offsets did the last time the live params were built, so a repaint is asked for only when that changed.
  const lastShown = new Map();

  function registerNodeGraphParamOffsetProvider(provider) {
    if (!provider || typeof provider.applyParams !== "function") {
      throw new TypeError("registerNodeGraphParamOffsetProvider: applyParams(node, params) is required");
    }
    const id = String(provider.id || "");
    if (!id) throw new TypeError("registerNodeGraphParamOffsetProvider: id is required");
    const entry = {
      id,
      order: Number.isFinite(Number(provider.order)) ? Number(provider.order) : 0,
      seq: 0,
      applyParams: provider.applyParams,
      applyToBase: typeof provider.applyToBase === "function" ? provider.applyToBase : null,
      targets: typeof provider.targets === "function" ? provider.targets : null,
    };
    const existing = providers.find((p) => p.id === id);
    entry.seq = existing ? existing.seq : sequence++;
    providers = providers.filter((p) => p.id !== id);
    providers.push(entry);
    providers.sort((a, b) => (a.order - b.order) || (a.seq - b.seq));
    return function unregister() {
      providers = providers.filter((p) => p !== entry);
    };
  }

  function noteChrome(nodeId) {
    if (typeof root.nodeGraphGlGraphNoteValueChrome === "function") root.nodeGraphGlGraphNoteValueChrome(nodeId);
  }

  /**
   * Run every provider over `params` (this node's live params, edited in place). options.notify (default true): when the offsets this node
   * gets differ from the last build, ask the GPU controls to repaint. Pass notify: false for a patch that is not the one on screen.
   */
  function applyNodeGraphParamOffsets(node, params, options) {
    if (!node || !params || !providers.length) {
      if (node && lastShown.size && lastShown.delete(String(node.id))) noteChrome(node.id);
      return params;
    }
    const before = {};
    for (const key of Object.keys(params)) before[key] = params[key];
    for (const provider of providers) provider.applyParams(node, params);
    if (!options || options.notify !== false) {
      let signature = "";
      for (const key of Object.keys(params)) {
        const a = before[key];
        const b = params[key];
        if (typeof a === "number" && typeof b === "number" && a !== b) signature += `${key}=${b};`;
      }
      const id = String(node.id);
      if ((lastShown.get(id) || "") !== signature) {
        if (signature) lastShown.set(id, signature);
        else lastShown.delete(id);
        noteChrome(node.id);
      }
    }
    return params;
  }

  /** The effective value of one param from its base value: each provider's applyToBase in order. No repaint request (hot path). */
  function applyNodeGraphParamOffsetsToBase(node, key, base, metadata) {
    let value = base;
    for (let i = 0; i < providers.length; i += 1) {
      const fn = providers[i].applyToBase;
      if (fn) value = fn(node, key, value, metadata);
    }
    return value;
  }

  /** Every [nodeId, key] some provider can move right now, as "nodeId\u0000key" strings (the ghost sliders' map key). */
  function nodeGraphParamOffsetTargetKeys() {
    const out = new Set();
    for (const provider of providers) {
      if (!provider.targets) continue;
      for (const pair of provider.targets() || []) {
        if (Array.isArray(pair) && pair[0] != null && pair[1] != null) out.add(`${String(pair[0])}\u0000${String(pair[1])}`);
      }
    }
    return out;
  }

  /** A copy of a node's numeric params with every provider applied: what the plugin host diffs and sends to the native engine. */
  function nodeGraphEffectiveNodeParams(node) {
    const out = {};
    const source = node && node.params;
    if (source) {
      for (const key of Object.keys(source)) {
        const value = source[key];
        if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
      }
    }
    if (!providers.length) return out;
    return applyNodeGraphParamOffsets(node, out, { notify: false });
  }

  root.registerNodeGraphParamOffsetProvider = registerNodeGraphParamOffsetProvider;
  root.applyNodeGraphParamOffsets = applyNodeGraphParamOffsets;
  root.applyNodeGraphParamOffsetsToBase = applyNodeGraphParamOffsetsToBase;
  root.nodeGraphEffectiveNodeParams = nodeGraphEffectiveNodeParams;
  root.nodeGraphParamOffsetTargetKeys = nodeGraphParamOffsetTargetKeys;
})(typeof window !== "undefined" ? window : globalThis);
