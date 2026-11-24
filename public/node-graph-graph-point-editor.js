// Step / Smooth Graph point editor on the module's Display Settings page.
//
// The face is the WebGL picture only (drag dots, playhead, right-click);
// this section edits the selected point. One component for both graphs:
// the fields, limits and writes come from node-graph-graph-face-extras.js
// (nodeGraphGraphPointFieldsForType / ...FieldLimits / applyNodeGraphGraphPointField).
//
// Number fields are drag surfaces on the shared slider engine
// (bindNodeSliderDragSurface, node-graph-slider-dragging.js), driving a hidden
// range input through a value sink, so they get the app's modifiers:
//   drag            relative (never jumps), right/up increase
//   alt + click     jump to the pointer
//   shift or ctrl   fine x0.1, both x0.01
//   ctrl + click    reset to default (touch: double-tap)
//   double-click    type-in (touch: long hold), with math
//                   (nodeGraphEvaluateValueExpression: 0.5*3-1, *2, -1, +0.1, ...)
// Enter or leaving the field commits a type-in, Escape cancels, an invalid
// entry reverts.

const NODE_GRAPH_POINT_EDITOR_DRAG_SPAN_PX = 240;

function nodeGraphGraphPointEditorRoot(nodeId = null) {
  const popover = document.getElementById("nodeTraceDisplaySettingsPopover");
  const root = popover?.querySelector?.("[data-graph-point-editor]") || null;
  if (!root || (nodeId != null && root.dataset.graphPointEditorNode !== String(nodeId))) {
    return null;
  }
  return root;
}

function nodeGraphGraphPointEditorHasSelection(nodeId) {
  return typeof nodeGraphGraphSelectionState === "function" && nodeGraphGraphSelectionState().has(String(nodeId));
}

function nodeGraphGraphPointEditorGraph(patchNode) {
  return typeof nodeGraphGraphPaintDocumentForNode === "function"
    ? nodeGraphGraphPaintDocumentForNode(patchNode)
    : nodeGraphGraphForNode(patchNode);
}

/** Selected point index, or null when the graph has no selected point. */
function nodeGraphGraphPointEditorIndex(nodeId, graph = null) {
  if (!nodeGraphGraphPointEditorHasSelection(nodeId)) {
    return null;
  }
  const patchNode = nodeGraphPatchNode(nodeId);
  const doc = graph || (patchNode ? nodeGraphGraphPointEditorGraph(patchNode) : null);
  return doc ? nodeGraphGraphSelectedNodeIndex(String(nodeId), doc, 0) : null;
}

function nodeGraphGraphPointEditorFormat(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "";
  }
  const text = String(Number(n.toFixed(4)));
  return text === "-0" ? "0" : text;
}

function nodeGraphGraphPointEditorSliderId(nodeId, key) {
  return `nodeGraphPointEditor-${String(nodeId).replace(/[^\w-]/g, "_")}-${key}`;
}

/** Write a field of the selected point (tension needs no selection). */
function nodeGraphGraphPointEditorWrite(nodeId, key, value, record) {
  const index = key === "tension" ? 0 : nodeGraphGraphPointEditorIndex(nodeId);
  if (index == null) {
    return null;
  }
  return applyNodeGraphGraphPointField(nodeId, index, key, value, { record });
}

function nodeGraphGraphPointEditorCurrent(nodeId, key) {
  const patchNode = nodeGraphPatchNode(nodeId);
  if (!patchNode) {
    return NaN;
  }
  const graph = nodeGraphGraphPointEditorGraph(patchNode);
  const index = key === "tension" ? 0 : nodeGraphGraphPointEditorIndex(nodeId, graph);
  return index == null ? NaN : nodeGraphGraphPointFieldValue(patchNode, graph, index, key);
}

function nodeGraphGraphPointEditorSink(nodeId, key) {
  let live = false;
  return {
    // Live drag frames: no undo step.
    set(value) {
      const applied = nodeGraphGraphPointEditorWrite(nodeId, key, value, false);
      if (applied == null) {
        return value;
      }
      live = true;
      return applied;
    },
    // Drag end / reset / key step: one undo step (skipped for a still click).
    commit(value) {
      const current = nodeGraphGraphPointEditorCurrent(nodeId, key);
      if (live || !(Math.abs(Number(value) - current) < 1e-12)) {
        nodeGraphGraphPointEditorWrite(nodeId, key, value, true);
      }
      live = false;
      syncNodeGraphGraphPointEditor(nodeId);
    },
    edit(surface) {
      beginNodeGraphGraphPointEditorTypeIn(surface);
    },
  };
}

function mountNodeGraphGraphPointEditor(host, patchNode) {
  if (!host || !patchNode || (typeof nodeGraphModuleIsGraphType === "function" && !nodeGraphModuleIsGraphType(patchNode.type))) {
    return null;
  }
  host.querySelector(":scope > [data-graph-point-editor]")?.remove();
  const nodeId = String(patchNode.id);
  const root = document.createElement("div");
  root.className = "metadata-field-section node-graph-point-editor is-empty";
  root.dataset.graphPointEditor = "true";
  root.dataset.graphPointEditorNode = nodeId;

  const head = document.createElement("div");
  head.className = "node-graph-point-editor-head";
  const title = document.createElement("span");
  title.textContent = "Point";
  const which = document.createElement("span");
  which.className = "node-graph-point-editor-which";
  which.dataset.graphPointEditorWhich = "true";
  head.append(title, which);
  const empty = document.createElement("div");
  empty.className = "node-graph-point-editor-empty";
  empty.textContent = "No point selected";

  const fields = document.createElement("div");
  fields.className = "node-graph-point-editor-fields";
  for (const field of nodeGraphGraphPointFieldsForType(patchNode.type)) {
    const label = document.createElement("span");
    label.className = "node-graph-point-editor-label";
    label.textContent = field.label;
    if (field.kind === "shape") {
      const select = document.createElement("select");
      select.className = "node-graph-point-editor-select";
      select.dataset.graphPointField = field.key;
      select.setAttribute("aria-label", field.label);
      for (const choice of nodeGraphGraphPointShapeChoices()) {
        const option = document.createElement("option");
        option.value = choice.key;
        option.textContent = choice.label;
        select.append(option);
      }
      select.addEventListener("change", () => {
        nodeGraphGraphPointEditorWrite(nodeId, field.key, select.value, true);
        syncNodeGraphGraphPointEditor(nodeId);
      });
      fields.append(label, select);
      continue;
    }
    const slider = document.createElement("input");
    slider.type = "range";
    slider.hidden = true;
    slider.tabIndex = -1;
    slider.id = nodeGraphGraphPointEditorSliderId(nodeId, field.key);
    slider.step = "any";
    slider.dataset.hardClamp = "true";
    // Already driven by the shared engine; keep settings auto-binders off it.
    slider.dataset.nativeSliderModifiersBound = "true";
    if (field.key === "c") {
      slider.dataset.contourTaper = "true";
    }
    const surface = document.createElement("div");
    surface.className = "node-graph-point-editor-value";
    surface.tabIndex = 0;
    surface.setAttribute("role", "spinbutton");
    surface.setAttribute("aria-label", field.label);
    surface.dataset.graphPointField = field.key;
    surface.dataset.sliderTarget = slider.id;
    surface.dataset.sliderDragSurface = "horizontal";
    surface.dataset.sliderDragSpan = String(NODE_GRAPH_POINT_EDITOR_DRAG_SPAN_PX);
    if (typeof registerNodeSliderValueSink === "function") {
      registerNodeSliderValueSink(slider, nodeGraphGraphPointEditorSink(nodeId, field.key));
    }
    if (typeof bindNodeSliderDragSurface === "function") {
      bindNodeSliderDragSurface(surface);
    }
    fields.append(label, surface, slider);
  }
  root.append(head, empty, fields);
  // Editor edits are graph edits, not Display Settings form fields.
  root.addEventListener("input", (event) => event.stopPropagation());
  root.addEventListener("change", (event) => event.stopPropagation());
  host.prepend(root);
  syncNodeGraphGraphPointEditor(nodeId);
  return root;
}

/** Follow the selected point (called from every face repaint). */
function syncNodeGraphGraphPointEditor(nodeId, selectedIndex = null) {
  const root = nodeGraphGraphPointEditorRoot(nodeId);
  if (!root) {
    return;
  }
  const patchNode = nodeGraphPatchNode(String(nodeId));
  if (!patchNode) {
    return;
  }
  const graph = nodeGraphGraphPointEditorGraph(patchNode);
  const last = graph.nodes.length - 1;
  const has = selectedIndex != null || nodeGraphGraphPointEditorHasSelection(nodeId);
  const index = !has
    ? null
    : (selectedIndex != null
      ? nodeGraphGraphNodeIndexFromValue(graph, selectedIndex)
      : nodeGraphGraphSelectedNodeIndex(String(nodeId), graph, 0));
  root.classList.toggle("is-empty", !has);
  root.dataset.selectedIndex = has ? String(index) : "";
  const which = root.querySelector("[data-graph-point-editor-which]");
  if (which) {
    which.textContent = has
      ? `${index + 1} / ${graph.nodes.length}${index === 0 ? " start" : index === last ? " end" : ""}`
      : "";
  }
  for (const el of root.querySelectorAll("[data-graph-point-field]")) {
    const key = el.dataset.graphPointField;
    const curve = key === "tension";
    const active = curve || has;
    const at = curve ? 0 : (index ?? 0);
    const value = nodeGraphGraphPointFieldValue(patchNode, graph, at, key);
    if (el.tagName === "SELECT") {
      el.disabled = !active;
      if (document.activeElement !== el) {
        el.value = active ? String(value) : "";
      }
      continue;
    }
    if (el.dataset.editing === "true") {
      continue;
    }
    const limits = nodeGraphGraphPointFieldLimits(patchNode, graph, at, key);
    const slider = document.getElementById(el.dataset.sliderTarget || "");
    if (slider) {
      slider.min = String(limits.min);
      slider.max = String(limits.max);
      slider.dataset.default = String(limits.defaultValue);
      const dragging = typeof nodeSliderDragForSurface === "function" && nodeSliderDragForSurface(el);
      if (!dragging && Number.isFinite(value)) {
        slider.dataset.domainValue = String(value);
        slider.value = String(value);
      }
    }
    const locked = !active || Boolean(limits.locked);
    el.textContent = active ? nodeGraphGraphPointEditorFormat(value) : "\u2013";
    el.classList.toggle("is-locked", locked);
    el.setAttribute("aria-disabled", locked ? "true" : "false");
    el.tabIndex = locked ? -1 : 0;
  }
}

/** Double-click / long-hold type-in on a field, with math. */
function beginNodeGraphGraphPointEditorTypeIn(surface) {
  if (!surface || surface.dataset.editing === "true" || surface.classList.contains("is-locked")) {
    return false;
  }
  const root = surface.closest("[data-graph-point-editor]");
  const nodeId = root?.dataset?.graphPointEditorNode || "";
  const key = surface.dataset.graphPointField || "";
  if (!nodeId || !key) {
    return false;
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "node-graph-point-editor-typein";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", surface.getAttribute("aria-label") || key);
  input.value = surface.textContent || "";
  surface.dataset.editing = "true";
  surface.textContent = "";
  surface.append(input);
  let done = false;
  const finish = (commit) => {
    if (done) {
      return;
    }
    done = true;
    const text = input.value;
    input.remove();
    delete surface.dataset.editing;
    if (commit) {
      const next = nodeGraphEvaluateValueExpression(text, nodeGraphGraphPointEditorCurrent(nodeId, key));
      if (Number.isFinite(next)) {
        nodeGraphGraphPointEditorWrite(nodeId, key, next, true);
      }
    }
    syncNodeGraphGraphPointEditor(nodeId);
  };
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
      surface.focus?.({ preventScroll: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
      surface.focus?.({ preventScroll: true });
    }
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("pointerdown", (event) => event.stopPropagation());
  input.addEventListener("mousedown", (event) => event.stopPropagation());
  input.focus({ preventScroll: true });
  input.select();
  return true;
}

// A plain click on a face point selects it without repainting the face (the
// face keeps its hit targets for double-click), so the open editor also
// re-reads the selection after any press or release on a graph face.
let nodeGraphGraphPointEditorResyncFrame = 0;
function scheduleNodeGraphGraphPointEditorResync(event) {
  if (!event?.target?.closest?.(".node-module-graph-display, .node-module-graph-face")) {
    return;
  }
  if (nodeGraphGraphPointEditorResyncFrame) {
    return;
  }
  nodeGraphGraphPointEditorResyncFrame = requestAnimationFrame(() => {
    nodeGraphGraphPointEditorResyncFrame = 0;
    for (const root of document.querySelectorAll("[data-graph-point-editor][data-graph-point-editor-node]")) {
      if (root.isConnected) {
        syncNodeGraphGraphPointEditor(root.dataset.graphPointEditorNode);
      }
    }
  });
}
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", scheduleNodeGraphGraphPointEditorResync, true);
  document.addEventListener("pointerup", scheduleNodeGraphGraphPointEditorResync, true);
}
