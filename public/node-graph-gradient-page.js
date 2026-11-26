// Gradients page (Stage A3, docs/MODULE_GRADIENTS_AND_PRESETS_PLAN.md sections 4.2, 4.8, 4.9).
// The 🌈 page (#nodeGradientsPage; its own Command Center page since HP-22), the only gradient UI in the app:
// a DOM menu panel (allowed for Command Center pages), one card per gradient.
//
// Model and maths: node-graph-gradients.js (NodeGraphGradients). This file only edits patch.gradients:
//   - while dragging (playhead or a stop) it changes the live gradient in place and asks for a param sync, so sliders and audio glide;
//   - on release, and for every button, it records exactly one undo step (recordNodeGraphHistory).
// node.params (the base) is never written here. Events only: pointer events, selection changes and patch commits; no timers.

const nodeGraphGradientPageState = {
  filter: "all", // "all" | "touching"
  selectedStop: new Map(), // gradientId -> stopId (the stop Delete stop removes)
  renaming: "", // gradientId whose name is being edited
  drag: null,
};

function nodeGraphGradientPageGradients() {
  const patch = nodeGraphMvp?.patch;
  return patch && Array.isArray(patch.gradients) ? patch.gradients : [];
}

/** Replace patch.gradients (normalized), tell the engine, repaint sliders and this page. One undo step unless told otherwise. */
function nodeGraphGradientPageCommit(next, status, options = {}) {
  const patch = nodeGraphMvp?.patch;
  if (!patch) return;
  const before = nodeGraphGradientPageGradients();
  patch.gradients = NodeGraphGradients.normalize(next);
  if (!patch.gradients.length) delete patch.gradients;
  nodeGraphGradientPageRepaintSliders(before.concat(patch.gradients || []));
  nodeGraphGradientsNotifyChanged(status);
  if (options.record !== false && typeof recordNodeGraphHistory === "function") recordNodeGraphHistory();
  renderNodeGraphGradientPage();
}

/** GPU-drawn sliders of every node a gradient touches repaint their value chrome. */
function nodeGraphGradientPageRepaintSliders(gradients) {
  if (typeof nodeGraphGlGraphNoteValueChrome !== "function") return;
  const ids = new Set();
  for (const g of gradients) for (const p of g?.params || []) ids.add(p.nodeId);
  for (const id of ids) nodeGraphGlGraphNoteValueChrome(id);
}

function nodeGraphGradientPageReplace(gradientId, fn) {
  return nodeGraphGradientPageGradients().map((g) => (g.id === gradientId ? fn(g) : g));
}

// ------------------------------------------------------------------------------------------------ labels and values

function nodeGraphGradientPageModuleLabel(nodeId) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!node) return nodeId;
  const alias = String(node.alias || node.title || "").trim();
  if (alias) return alias;
  return nodeGraphModuleDefinitions?.[node.type]?.label || node.type;
}

function nodeGraphGradientPageParamLabel(nodeId, key) {
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const def = node ? (nodeGraphModuleDefinitions?.[node.type]?.parameters || []).find((p) => p.key === key) : null;
  return def?.label || key;
}

/** Offset (slider space) of one param at the playhead: linear for continuous params, the snapped stop for discrete ones. */
function nodeGraphGradientPageOffsetAt(gradient, nodeId, key) {
  const stops = [...(gradient.stops || [])].sort((a, b) => a.pos - b.pos);
  if (!stops.length) return 0;
  const off = (stop) => Number(stop?.offsets?.[nodeId]?.[key]) || 0;
  const pos = Math.max(0, Math.min(1, Number(gradient.position) || 0));
  let last = -1;
  for (let i = 0; i < stops.length; i += 1) if (stops[i].pos <= pos) last = i;
  if (last < 0) return off(stops[0]);
  if (last === stops.length - 1) return off(stops[last]);
  const a = stops[last];
  const b = stops[last + 1];
  const t = (pos - a.pos) / (b.pos - a.pos);
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const meta = node && typeof nodeGraphReadPatchParameterMetadata === "function" ? nodeGraphReadPatchParameterMetadata(node, key) : null;
  if (meta && NodeGraphGradients.isDiscrete(meta)) return t < 0.5 ? off(a) : off(b);
  return off(a) + (off(b) - off(a)) * t;
}

function nodeGraphGradientPageFormat(value) {
  const v = Math.abs(value) < 0.005 ? 0 : value;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;
}

function nodeGraphGradientPageTouchingSelection(gradient) {
  const ids = typeof nodeGraphSelectedNodeIds === "function" ? nodeGraphSelectedNodeIds() : new Set();
  if (!ids || !ids.size) return false;
  return (gradient.params || []).some((p) => ids.has(p.nodeId));
}

// ------------------------------------------------------------------------------------------------ render

function nodeGraphGradientPageButton(text, action, gradientId, extra = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "node-gradient-button";
  b.textContent = text;
  b.dataset.gradientAction = action;
  if (gradientId) b.dataset.gradientId = gradientId;
  if (extra.pressed !== undefined) b.setAttribute("aria-pressed", extra.pressed ? "true" : "false");
  if (extra.disabled) b.disabled = true;
  return b;
}

function nodeGraphGradientPageStrip(gradient) {
  const strip = document.createElement("div");
  strip.className = "node-gradient-strip";
  strip.dataset.gradientId = gradient.id;
  strip.setAttribute("role", "slider");
  strip.setAttribute("aria-label", `${gradient.name} position`);
  strip.setAttribute("aria-valuemin", "0");
  strip.setAttribute("aria-valuemax", "1");
  strip.setAttribute("aria-valuenow", String(gradient.position));
  const stops = [...gradient.stops].sort((a, b) => a.pos - b.pos);
  // One hue per stop, from stop order: a picture of the blend.
  const hue = (i) => `hsl(${(i * 137.5) % 360}, 55%, 50%)`;
  strip.style.background = stops.length > 1
    ? `linear-gradient(90deg, ${stops.map((s, i) => `${hue(i)} ${(s.pos * 100).toFixed(2)}%`).join(", ")})`
    : hue(0);
  const playhead = document.createElement("div");
  playhead.className = "node-gradient-playhead";
  playhead.style.left = `${(gradient.position * 100).toFixed(3)}%`;
  strip.append(playhead);
  const selected = nodeGraphGradientPageState.selectedStop.get(gradient.id);
  stops.forEach((stop, i) => {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "node-gradient-handle";
    if (stop.id === selected) handle.classList.add("is-selected");
    handle.dataset.stopId = stop.id;
    handle.style.left = `${(stop.pos * 100).toFixed(3)}%`;
    handle.setAttribute("aria-label", `Stop ${i + 1} at ${stop.pos.toFixed(2)}`);
    const label = document.createElement("span");
    label.className = `node-gradient-handle-label ${i % 2 ? "is-low" : "is-high"}`;
    label.textContent = stop.pos.toFixed(2);
    handle.append(label);
    strip.append(handle);
  });
  return strip;
}

function nodeGraphGradientPageCard(gradient) {
  const card = document.createElement("section");
  card.className = "node-gradient-card";
  if (gradient.enabled === false) card.classList.add("is-disabled");
  card.dataset.gradientId = gradient.id;

  const head = document.createElement("div");
  head.className = "node-gradient-card-head";
  if (nodeGraphGradientPageState.renaming === gradient.id) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "node-gradient-name-input";
    input.value = gradient.name;
    input.dataset.gradientRenameInput = gradient.id;
    input.setAttribute("aria-label", "Gradient name");
    head.append(input);
  } else {
    const name = document.createElement("span");
    name.className = "node-gradient-name";
    name.textContent = gradient.name;
    head.append(name);
  }
  const enabled = nodeGraphGradientPageButton(gradient.enabled === false ? "Off" : "On", "toggle", gradient.id, { pressed: gradient.enabled !== false });
  enabled.classList.add("node-gradient-enabled");
  enabled.setAttribute("aria-label", `${gradient.name} enabled`);
  head.append(enabled);
  card.append(head);

  card.append(nodeGraphGradientPageStrip(gradient));

  const buttons = document.createElement("div");
  buttons.className = "node-gradient-buttons";
  const selected = nodeGraphGradientPageState.selectedStop.get(gradient.id);
  buttons.append(
    nodeGraphGradientPageButton("Snapshot", "snapshot", gradient.id),
    nodeGraphGradientPageButton("Delete stop", "deleteStop", gradient.id, { disabled: !selected || gradient.stops.length < 2 }),
    nodeGraphGradientPageButton(nodeGraphGradientPageState.renaming === gradient.id ? "Done" : "Rename", "rename", gradient.id),
    nodeGraphGradientPageButton("Delete gradient", "deleteGradient", gradient.id),
    nodeGraphGradientPageButton("Set start", "setStart", gradient.id),
  );
  card.append(buttons);

  const rows = document.createElement("div");
  rows.className = "node-gradient-params";
  if (!gradient.params.length) {
    const empty = document.createElement("p");
    empty.className = "node-gradient-hint";
    empty.textContent = "Move sliders, then Snapshot (or tap the strip) to record them here.";
    rows.append(empty);
  }
  for (const { nodeId, key } of gradient.params) {
    const row = document.createElement("div");
    row.className = "node-gradient-param";
    const label = document.createElement("span");
    label.className = "node-gradient-param-label";
    label.textContent = `${nodeGraphGradientPageModuleLabel(nodeId)} · ${nodeGraphGradientPageParamLabel(nodeId, key)}`;
    const value = document.createElement("span");
    value.className = "node-gradient-param-value";
    value.dataset.gradientParam = `${nodeId}\u0000${key}`;
    value.textContent = nodeGraphGradientPageFormat(nodeGraphGradientPageOffsetAt(gradient, nodeId, key));
    row.append(label, value);
    rows.append(row);
  }
  card.append(rows);
  return card;
}

function renderNodeGraphGradientPage() {
  const host = document.getElementById("nodeGradientsBody");
  if (!host) return;
  const panel = document.getElementById("nodeGradientsPage");
  if (panel && panel.hidden) return;
  const fragment = document.createDocumentFragment();
  const top = document.createElement("div");
  top.className = "node-gradient-top";
  const filter = document.createElement("div");
  filter.className = "node-gradient-filter";
  filter.setAttribute("role", "group");
  filter.setAttribute("aria-label", "Show gradients");
  for (const [value, text] of [["all", "All"], ["touching", "Touching selected"]]) {
    const b = nodeGraphGradientPageButton(text, "filter", "", { pressed: nodeGraphGradientPageState.filter === value });
    b.dataset.filter = value;
    filter.append(b);
  }
  top.append(filter, nodeGraphGradientPageButton("Snapshot", "newGradient", ""));
  fragment.append(top);
  const gradients = nodeGraphGradientPageGradients();
  const shown = nodeGraphGradientPageState.filter === "touching"
    ? gradients.filter(nodeGraphGradientPageTouchingSelection)
    : gradients;
  if (!gradients.length) {
    const p = document.createElement("p");
    p.className = "node-gradient-hint";
    p.textContent = "Snapshot starts a gradient from the sliders as they are now.";
    fragment.append(p);
  } else if (!shown.length) {
    const p = document.createElement("p");
    p.className = "node-gradient-hint";
    p.textContent = "No gradient touches the selected module.";
    fragment.append(p);
  }
  for (const g of shown) fragment.append(nodeGraphGradientPageCard(g));
  host.replaceChildren(fragment);
  const rename = host.querySelector("[data-gradient-rename-input]");
  if (rename) {
    rename.focus();
    rename.select();
  }
}

/** Cheap update while dragging: move the playhead / handles and refresh the offset numbers, no rebuild. */
function nodeGraphGradientPageUpdateLive(gradient) {
  const card = document.querySelector(`#nodeGradientsBody .node-gradient-card[data-gradient-id="${CSS.escape(gradient.id)}"]`);
  if (!card) return;
  const strip = card.querySelector(".node-gradient-strip");
  const playhead = card.querySelector(".node-gradient-playhead");
  if (playhead) playhead.style.left = `${(gradient.position * 100).toFixed(3)}%`;
  strip?.setAttribute("aria-valuenow", String(gradient.position));
  for (const stop of gradient.stops) {
    const handle = strip?.querySelector(`[data-stop-id="${CSS.escape(stop.id)}"]`);
    if (!handle) continue;
    handle.style.left = `${(stop.pos * 100).toFixed(3)}%`;
    const label = handle.querySelector(".node-gradient-handle-label");
    if (label) label.textContent = stop.pos.toFixed(2);
  }
  for (const el of card.querySelectorAll("[data-gradient-param]")) {
    const [nodeId, key] = el.dataset.gradientParam.split("\u0000");
    el.textContent = nodeGraphGradientPageFormat(nodeGraphGradientPageOffsetAt(gradient, nodeId, key));
  }
}

// ------------------------------------------------------------------------------------------------ actions

function nodeGraphGradientPageAction(action, gradientId, button) {
  const patch = nodeGraphMvp?.patch;
  if (!patch) return;
  if (action === "filter") {
    nodeGraphGradientPageState.filter = button.dataset.filter === "touching" ? "touching" : "all";
    renderNodeGraphGradientPage();
    return;
  }
  if (action === "newGradient") {
    const created = NodeGraphGradients.createGradientFromSnapshot(patch);
    nodeGraphGradientPageCommit([...nodeGraphGradientPageGradients(), created], `${created.name} started`);
    return;
  }
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === gradientId);
  if (!gradient) return;
  if (action === "snapshot") {
    // At the playhead (a snapshot on an existing stop replaces it). A gradient that only has its origin stop, with the playhead on it,
    // takes its first later snapshot at 1 (section 4.2), never over the origin.
    const onlyOrigin = gradient.stops.length === 1 && Math.abs(gradient.stops[0].pos - gradient.position) < 1e-9;
    const next = NodeGraphGradients.snapshotIntoGradient(patch, gradient, onlyOrigin ? 1 : gradient.position);
    nodeGraphGradientPageCommit(nodeGraphGradientPageReplace(gradient.id, () => next), `${gradient.name} snapshot`);
  } else if (action === "deleteStop") {
    const stopId = nodeGraphGradientPageState.selectedStop.get(gradient.id);
    if (!stopId || gradient.stops.length < 2) return;
    nodeGraphGradientPageState.selectedStop.delete(gradient.id);
    const next = NodeGraphGradients.dropAllZeroParams({ ...gradient, stops: gradient.stops.filter((s) => s.id !== stopId) });
    nodeGraphGradientPageCommit(nodeGraphGradientPageReplace(gradient.id, () => next), `${gradient.name} stop deleted`);
  } else if (action === "rename") {
    if (nodeGraphGradientPageState.renaming === gradient.id) {
      nodeGraphGradientPageFinishRename(gradient.id);
    } else {
      nodeGraphGradientPageState.renaming = gradient.id;
      renderNodeGraphGradientPage();
    }
  } else if (action === "deleteGradient") {
    nodeGraphGradientPageState.selectedStop.delete(gradient.id);
    nodeGraphGradientPageCommit(nodeGraphGradientPageGradients().filter((g) => g.id !== gradient.id), `${gradient.name} deleted`);
  } else if (action === "setStart") {
    const next = NodeGraphGradients.setStart(patch, gradient);
    nodeGraphGradientPageCommit(nodeGraphGradientPageReplace(gradient.id, () => next), `${gradient.name} start set`);
  } else if (action === "toggle") {
    nodeGraphGradientPageCommit(
      nodeGraphGradientPageReplace(gradient.id, (g) => ({ ...g, enabled: g.enabled === false })),
      `${gradient.name} ${gradient.enabled === false ? "on" : "off"}`,
    );
  }
}

function nodeGraphGradientPageFinishRename(gradientId) {
  const input = document.querySelector(`[data-gradient-rename-input="${CSS.escape(gradientId)}"]`);
  nodeGraphGradientPageState.renaming = "";
  const name = String(input?.value || "").trim();
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === gradientId);
  if (!gradient || !name || name === gradient.name) {
    renderNodeGraphGradientPage();
    return;
  }
  nodeGraphGradientPageCommit(nodeGraphGradientPageReplace(gradientId, (g) => ({ ...g, name })), `Renamed to ${name}`);
}

// ------------------------------------------------------------------------------------------------ strip pointer handling

function nodeGraphGradientPageStripPos(strip, clientX) {
  const rect = strip.getBoundingClientRect();
  return rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
}

function nodeGraphGradientPagePointerDown(event) {
  const strip = event.target?.closest?.(".node-gradient-strip");
  if (!strip || event.button > 0) return;
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === strip.dataset.gradientId);
  if (!gradient) return;
  const handle = event.target.closest(".node-gradient-handle");
  event.preventDefault();
  try { strip.setPointerCapture(event.pointerId); } catch (_e) { /* ignore */ }
  nodeGraphGradientPageState.drag = {
    pointerId: event.pointerId,
    strip,
    gradientId: gradient.id,
    stopId: handle?.dataset.stopId || "",
    startX: event.clientX,
    moved: false,
  };
  if (handle) {
    nodeGraphGradientPageState.selectedStop.set(gradient.id, handle.dataset.stopId);
    for (const h of strip.querySelectorAll(".node-gradient-handle")) h.classList.toggle("is-selected", h === handle);
    const del = strip.parentElement?.querySelector('[data-gradient-action="deleteStop"]');
    if (del) del.disabled = gradient.stops.length < 2;
  }
}

function nodeGraphGradientPagePointerMove(event) {
  const drag = nodeGraphGradientPageState.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  if (!drag.moved && Math.abs(event.clientX - drag.startX) < 4) return;
  drag.moved = true;
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === drag.gradientId);
  if (!gradient) return;
  const pos = nodeGraphGradientPageStripPos(drag.strip, event.clientX);
  // Live edit of the gradient object; the undo step is recorded on release.
  if (drag.stopId) {
    const stop = gradient.stops.find((s) => s.id === drag.stopId);
    if (stop) stop.pos = pos;
  } else {
    gradient.position = pos;
  }
  nodeGraphGradientPageRepaintSliders([gradient]);
  nodeGraphGradientsNotifyChanged(drag.stopId ? `${gradient.name} stop moved` : `${gradient.name} position`);
  nodeGraphGradientPageUpdateLive(gradient);
}

function nodeGraphGradientPagePointerUp(event) {
  const drag = nodeGraphGradientPageState.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  nodeGraphGradientPageState.drag = null;
  try { drag.strip.releasePointerCapture(event.pointerId); } catch (_e) { /* ignore */ }
  if (event.type === "pointercancel") return;
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === drag.gradientId);
  if (!gradient) return;
  if (drag.moved) {
    // One undo step per release, never per move.
    nodeGraphGradientPageCommit(nodeGraphGradientPageGradients(), drag.stopId ? `${gradient.name} stop moved` : `${gradient.name} position`);
    return;
  }
  if (!drag.stopId) {
    // Tap on an empty spot: a new stop there, a snapshot of the current bases.
    const pos = nodeGraphGradientPageStripPos(drag.strip, event.clientX);
    const next = NodeGraphGradients.snapshotIntoGradient(nodeGraphMvp.patch, gradient, pos);
    const added = next.stops.find((s) => Math.abs(s.pos - pos) < 1e-9);
    if (added) nodeGraphGradientPageState.selectedStop.set(gradient.id, added.id);
    nodeGraphGradientPageCommit(nodeGraphGradientPageReplace(gradient.id, () => next), `${gradient.name} stop added`);
  }
}

// ------------------------------------------------------------------------------------------------ wiring

/** Selection changed (node-graph-selection.js): the "Touching selected" filter follows it. */
function nodeGraphGradientPageSelectionChanged() {
  if (nodeGraphGradientPageState.filter === "touching") renderNodeGraphGradientPage();
}

function bindNodeGraphGradientPage() {
  const host = document.getElementById("nodeGradientsBody");
  if (!host || host.dataset.gradientPageBound === "true") return;
  host.dataset.gradientPageBound = "true";
  host.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-gradient-action]");
    if (!button || button.disabled) return;
    nodeGraphGradientPageAction(button.dataset.gradientAction, button.dataset.gradientId || "", button);
  });
  host.addEventListener("keydown", (event) => {
    const input = event.target?.closest?.("[data-gradient-rename-input]");
    if (!input) return;
    if (event.key === "Enter") {
      event.preventDefault();
      nodeGraphGradientPageFinishRename(input.dataset.gradientRenameInput);
    } else if (event.key === "Escape") {
      nodeGraphGradientPageState.renaming = "";
      renderNodeGraphGradientPage();
    }
  });
  host.addEventListener("pointerdown", nodeGraphGradientPagePointerDown);
  host.addEventListener("pointermove", nodeGraphGradientPagePointerMove);
  host.addEventListener("pointerup", nodeGraphGradientPagePointerUp);
  host.addEventListener("pointercancel", nodeGraphGradientPagePointerUp);
  // Undo / redo / load replace the patch: re-render from the committed patch.
  if (typeof addNodeGraphPatchCommitListener === "function") {
    addNodeGraphPatchCommitListener(() => {
      if (!nodeGraphGradientPageState.drag) renderNodeGraphGradientPage();
    });
  }
}

// ------------------------------------------------------------------------------------------------ the 🌈 page window

function applyNodeGraphGradientsPageSize(size = {}, panelArg = null) {
  const panel = panelArg || document.getElementById("nodeGradientsPage");
  if (!panel) return { width: 0, height: 0 };
  if (typeof applyNodeGraphUnifiedWindowShellSize === "function") return applyNodeGraphUnifiedWindowShellSize(panel, size);
  const width = Math.round(nodeGraphFiniteNumber(size.width));
  const height = Math.round(nodeGraphFiniteNumber(size.height));
  if (width >= 24) panel.style.width = `${width}px`;
  if (height >= 120) panel.style.height = `${height}px`;
  return { width, height };
}

function setNodeGraphGradientsPageOpen(open) {
  const panel = document.getElementById("nodeGradientsPage");
  if (!panel) return;
  const switching = Boolean(nodeGraphMvp?._unifiedWindowSwitching);
  if (open && !switching && typeof openNodeGraphUnifiedWindowPage === "function") {
    openNodeGraphUnifiedWindowPage("gradients");
    return;
  }
  panel.hidden = !open;
  if (!open) return;
  panel.classList.add("node-unified-window");
  if (typeof markNodeGraphFloatingWindowSurface === "function") markNodeGraphFloatingWindowSurface(panel);
  if (typeof noteNodeGraphUnifiedWindowOpened === "function") noteNodeGraphUnifiedWindowOpened("gradients", panel);
  bindNodeGraphGradientPage();
  renderNodeGraphGradientPage();
}

function bindNodeGraphGradientsPageWindow() {
  if (document.documentElement.dataset.gradientsPageBound === "true") return;
  document.documentElement.dataset.gradientsPageBound = "true";
  document.getElementById("nodeGradientsPageClose")?.addEventListener("click", () => {
    if (typeof closeNodeGraphUnifiedWindowPage === "function") {
      closeNodeGraphUnifiedWindowPage("gradients");
      return;
    }
    setNodeGraphGradientsPageOpen(false);
  });
  document.querySelector("#nodeGradientsPage .scene-context-heading")?.addEventListener("pointerdown", (event) => {
    if (typeof beginNodeGraphRegisteredFloatingWindowDrag === "function") beginNodeGraphRegisteredFloatingWindowDrag(event, "gradients");
  });
  document.getElementById("nodeGradientsPageResizeHandle")?.addEventListener("pointerdown", (event) => {
    if (typeof beginNodeGraphRegisteredFloatingWindowResize === "function") beginNodeGraphRegisteredFloatingWindowResize(event, "gradients");
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNodeGraphGradientsPageWindow, { once: true });
  } else {
    bindNodeGraphGradientsPageWindow();
  }
}
