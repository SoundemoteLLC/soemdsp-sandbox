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
  showGraphs: false,
  selectedStop: new Map(), // gradientId -> stopId (the stop Delete stop removes)
  selectedParam: new Map(), // gradientId -> `${nodeId}\0${key}` for per-param segment curves
  renaming: "", // gradientId whose name is being edited
  drag: null,
  // HP-24: the stop being edited ({ gradientId, stopId }), or null. Editing holds only while the playhead sits on that stop.
  editing: null,
};
let nodeGraphGradientPageColorDirty = false;
let nodeGraphGradientPageGraphResizeObserver = null;

function nodeGraphGradientSelectedParam(gradient) {
  const params = gradient?.params || [];
  if (!params.length) return null;
  const id = nodeGraphGradientPageState.selectedParam.get(gradient.id);
  return params.find((param) => `${param.nodeId}\u0000${param.key}` === id) || params[0];
}

function nodeGraphGradientPageColorControls(gradient, onlyStopId = "") {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "node-gradient-native-color-picker";
  input.setAttribute("aria-label", `${gradient.name} stop color picker`);
  const initial = gradient.stops.find((stop) => stop.id === onlyStopId) || gradient.stops[0];
  input.value = initial?.color || nodeGraphGradientPageColorInputDefault(0);
  const update = () => {
    const stop = gradient.stops.find((item) => item.id === input.dataset.stopId);
    if (!stop || !/^#[0-9a-f]{6}$/i.test(input.value)) return;
    stop.color = input.value.toLowerCase();
    nodeGraphGradientPageColorDirty = true;
    const strip = document.querySelector(`#nodeGradientsBody .node-gradient-card[data-gradient-id="${CSS.escape(gradient.id)}"] .node-gradient-strip`);
    if (strip) strip.style.background = nodeGraphGradientPageStripBackground(gradient);
    nodeGraphGradientsNotifyVisuals();
    if (typeof nodeGraphGradientModuleNoteMoved === "function") nodeGraphGradientModuleNoteMoved();
    if (typeof scheduleNodeGraphWorkspaceAutosave === "function") scheduleNodeGraphWorkspaceAutosave(`${gradient.name} stop color`);
  };
  input.addEventListener("input", update);
  input.addEventListener("change", () => {
    if (nodeGraphGradientPageColorDirty && typeof recordNodeGraphHistory === "function") recordNodeGraphHistory();
    nodeGraphGradientPageColorDirty = false;
  });
  return input;
}

function nodeGraphGradientPageColorInputDefault(index) {
  // Native color inputs need a hex value, while the page's historical stop palette is HSL.
  const i = Number(index) || 0;
  const h = ((i * 137.5) % 360) / 60;
  const c = 0.55 * (1 - Math.abs(2 * 0.5 - 1));
  const x = c * (1 - Math.abs(h % 2 - 1));
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const m = 0.5 - c / 2;
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function nodeGraphGradientPageStripBackground(gradient) {
  const stops = [...(gradient.stops || [])].sort((a, b) => a.pos - b.pos);
  const hue = (index) => `hsl(${(index * 137.5) % 360}, 55%, 50%)`;
  return stops.length > 1
    ? `linear-gradient(90deg, ${stops.map((stop, index) => `${stop.color || hue(index)} ${(stop.pos * 100).toFixed(2)}%`).join(", ")})`
    : (stops[0]?.color || hue(0));
}

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
  const shaped = NodeGraphGradients.curveProgress(t, a, nodeId, key);
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const meta = node && typeof nodeGraphReadPatchParameterMetadata === "function" ? nodeGraphReadPatchParameterMetadata(node, key) : null;
  if (meta && NodeGraphGradients.isDiscrete(meta)) return shaped < 0.5 ? off(a) : off(b);
  return off(a) + (off(b) - off(a)) * shaped;
}

function nodeGraphGradientPageCurveControls(gradient, nodeId, key) {
  const stops = [...(gradient.stops || [])].sort((a, b) => a.pos - b.pos);
  const rows = document.createElement("div");
  rows.className = "node-gradient-curves";
  rows.dataset.selectedCurve = `${nodeId}\u0000${key}`;
  const selectedId = nodeGraphGradientPageState.selectedStop.get(gradient.id);
  const selectedIndex = Math.max(0, stops.findIndex((stop) => stop.id === selectedId));
  const i = Math.min(selectedIndex, Math.max(0, stops.length - 2));
  if (stops.length > 1) {
    const stop = stops[i];
    const curve = NodeGraphGradients.curveOf(stop, nodeId, key);
    const row = document.createElement("div");
    row.className = "node-gradient-curve-row";
    row.dataset.curveStop = stop.id;
    const title = document.createElement("span");
    title.textContent = `Segment ${i + 1} → ${i + 2}`;
    row.append(title);
    const choices = document.createElement("div");
    choices.className = "node-gradient-curve-shapes";
    for (const shape of (window.NODE_GRAPH_SEGMENT_SHAPES || ["rational", "exponential", "log", "smoothstep", "smootherstep", "hold"])) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "node-gradient-button";
      button.dataset.gradientAction = "curveShape";
      button.dataset.gradientId = gradient.id;
      button.dataset.stopId = stop.id;
      button.dataset.nodeId = nodeId;
      button.dataset.paramKey = key;
      button.dataset.shape = shape;
      button.setAttribute("aria-pressed", curve.shape === shape ? "true" : "false");
      button.textContent = shape;
      choices.append(button);
    }
    const skew = document.createElement("input");
    skew.type = "range";
    skew.min = "-1"; skew.max = "1"; skew.step = "0.01"; skew.value = String(curve.skew);
    skew.setAttribute("aria-label", `Segment ${i + 1} skew`);
    skew.dataset.gradientSkew = "1";
    skew.dataset.gradientId = gradient.id;
    skew.dataset.stopId = stop.id;
    skew.dataset.nodeId = nodeId;
    skew.dataset.paramKey = key;
    const value = document.createElement("span");
    value.className = "node-gradient-selected-value";
    value.textContent = `Value ${nodeGraphGradientPageFormat(nodeGraphGradientPageOffsetAt(gradient, nodeId, key))}`;
    row.append(choices, skew, value);
    rows.append(row);
  }
  if (stops.length === 1) {
    const value = document.createElement("span");
    value.className = "node-gradient-selected-value";
    value.textContent = `Value ${nodeGraphGradientPageFormat(nodeGraphGradientPageOffset(stops[0], nodeId, key))}`;
    rows.append(value);
  }
  return rows;
}

function nodeGraphGradientPageOffset(stop, nodeId, key) {
  return Number(stop?.offsets?.[nodeId]?.[key]) || 0;
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
  strip.setAttribute("aria-valuemax", "127");
  strip.setAttribute("aria-valuenow", String(gradient.position));
  const stops = [...gradient.stops].sort((a, b) => a.pos - b.pos);
  // One hue per stop, from stop order: a picture of the blend.
  strip.style.background = nodeGraphGradientPageStripBackground(gradient);
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
    if (nodeGraphGradientEditActive()?.stop.id === stop.id && nodeGraphGradientPageState.editing.gradientId === gradient.id) {
      handle.classList.add("is-editing");
      handle.setAttribute("aria-pressed", "true");
    }
    handle.dataset.stopId = stop.id;
    handle.style.left = `${(stop.pos * 100).toFixed(3)}%`;
    handle.style.backgroundColor = stop.color || nodeGraphGradientPageColorInputDefault(i);
    handle.setAttribute("aria-label", `Stop ${i + 1} at ${Math.round(stop.pos * 127)}`);
    const label = document.createElement("span");
    label.className = `node-gradient-handle-label ${i % 2 ? "is-low" : "is-high"}${stop.id === selected ? " is-selected" : ""}`;
    label.textContent = String(Math.round(stop.pos * 127));
    handle.append(label);
    strip.append(handle);
  });
  return strip;
}

function nodeGraphGradientPageCard(gradient) {
  const card = document.createElement("section");
  card.className = "node-gradient-card";
  if (gradient.enabled === false) card.classList.add("is-disabled");
  if (!nodeGraphGradientPageState.showGraphs) card.classList.add("graphs-hidden");
  card.dataset.gradientId = gradient.id;

  const head = document.createElement("div");
  head.className = "node-gradient-card-head";
  // PASTE-8: the grip is the drag handle for the Gradient module (the name is only a label).
  const grip = nodeGraphDragGripButton(`Drag ${gradient.name} into the circuit`);
  grip.dataset.gradientDrag = gradient.id;
  head.append(grip);
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

  const selectedParam = nodeGraphGradientSelectedParam(gradient);
  const chips = document.createElement("div");
  chips.className = "node-gradient-param-chips";
  gradient.params.forEach(({ nodeId, key }, index) => {
    const id = `${nodeId}\u0000${key}`;
    const chip = nodeGraphGradientPageButton(`${nodeGraphGradientPageModuleLabel(nodeId)} · ${nodeGraphGradientPageParamLabel(nodeId, key)}`, "selectCurveParam", gradient.id, { pressed: selectedParam && `${selectedParam.nodeId}\u0000${selectedParam.key}` === id });
    chip.dataset.nodeId = nodeId; chip.dataset.paramKey = key; chip.style.setProperty("--curve-color", nodeGraphCurveColor(index));
    chips.append(chip);
  });
  const addParam = nodeGraphGradientPageButton("+ Param", "snapshot", gradient.id);
  chips.append(addParam);
  card.append(chips);
  const graph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  graph.classList.add("node-gradient-curve-chart");
  graph.dataset.gradientGraph = gradient.id;
  graph.setAttribute("role", "img");
  graph.setAttribute("aria-label", "Gradient parameter curves");
  card.append(graph);
  card.append(nodeGraphGradientPageStrip(gradient));
  const playheadControl = document.createElement("div");
  playheadControl.className = "node-gradient-playhead-control";
  const playheadSlider = document.createElement("input"); playheadSlider.type = "range"; playheadSlider.min = "0"; playheadSlider.max = "1"; playheadSlider.step = "0.001"; playheadSlider.value = String(gradient.position); playheadSlider.dataset.gradientPlayhead = gradient.id;
  playheadSlider.setAttribute("aria-label", `${gradient.name} playhead`);
  playheadSlider.style.setProperty("--gradient-playhead-progress", `${(gradient.position * 100).toFixed(3)}%`);
  playheadControl.append(playheadSlider); card.append(playheadControl);
  if (selectedParam) card.append(nodeGraphGradientPageCurveControls(gradient, selectedParam.nodeId, selectedParam.key));
  const selectedStop = gradient.stops.find((s) => s.id === nodeGraphGradientPageState.selectedStop.get(gradient.id)) || gradient.stops[0];
  if (selectedStop) card.append(nodeGraphGradientPageColorControls(gradient, selectedStop.id));
  // HP-05: one plain line naming the gradient's modules whose non-slider data (graph points, steps, chords) holds still.
  const holds = [];
  for (const { nodeId } of gradient.params) {
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
    if (!node || !NodeGraphGradients.holdsStill(node.type)) continue;
    const label = nodeGraphGradientPageModuleLabel(nodeId);
    if (!holds.includes(label)) holds.push(label);
  }
  if (holds.length) {
    const line = document.createElement("p");
    line.className = "node-gradient-holds";
    line.textContent = `Holds still: ${holds.join(", ")}`;
    card.append(line);
  }
  const buttons = document.createElement("div");
  buttons.className = "node-gradient-buttons";
  const selected = nodeGraphGradientPageState.selectedStop.get(gradient.id);
  buttons.append(
    nodeGraphGradientPageButton("Add stop at playhead", "snapshot", gradient.id),
    nodeGraphGradientPageButton("Duplicate", "duplicateStop", gradient.id, { disabled: true }),
    nodeGraphGradientPageButton("Delete stop", "deleteStop", gradient.id, { disabled: !selected || gradient.stops.length < 2 }),
    nodeGraphGradientPageButton(nodeGraphGradientPageState.renaming === gradient.id ? "Done" : "Rename", "rename", gradient.id),
    nodeGraphGradientPageButton("Delete gradient", "deleteGradient", gradient.id),
    nodeGraphGradientPageButton("Set start", "setStart", gradient.id),
  );
  card.append(buttons);

  return card;
}

function nodeGraphCurveColor(index) { return ["#62bce5", "#d99b58", "#67c477", "#c678d2", "#e16c7e", "#c4bd69"][index % 6]; }

function nodeGraphGradientPageDrawGraph(card, gradient) {
  const svg = card.querySelector("[data-gradient-graph]");
  if (!svg || !window.NodeGraphCurveGraph) return;
  const params = gradient.params || [];
  const selected = nodeGraphGradientSelectedParam(gradient);
  const series = params.map((param, index) => {
    const id = `${param.nodeId}\u0000${param.key}`;
    const node = nodeGraphPatchNode(param.nodeId);
    const meta = node && nodeGraphReadPatchParameterMetadata(node, param.key);
    const base = meta && window.PitchMutatorEngine ? PitchMutatorEngine.sliderFromDomain(meta, Number(node.params?.[param.key]) || 0) : 0.5;
    const stops = [...gradient.stops].sort((a, b) => a.pos - b.pos);
    return { id, color: nodeGraphCurveColor(index), selected: selected && id === `${selected.nodeId}\u0000${selected.key}`, points: stops.map((stop) => ({ x: stop.pos, y: Math.max(0, Math.min(1, base + nodeGraphGradientPageOffset(stop, param.nodeId, param.key))), shape: NodeGraphGradients.curveOf(stop, param.nodeId, param.key).shape, skew: NodeGraphGradients.curveOf(stop, param.nodeId, param.key).skew })) };
  });
  window.NodeGraphCurveGraph.render(svg, { series, guides: (gradient.stops || []).map((s) => ({ x: s.pos })), playhead: gradient.position });
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
  top.append(nodeGraphGradientPageButton(nodeGraphGradientPageState.showGraphs ? "Hide graphs" : "Show graphs", "toggleGraphs", "", { pressed: nodeGraphGradientPageState.showGraphs }));
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
  if (typeof ResizeObserver === "function") {
    if (!nodeGraphGradientPageGraphResizeObserver) {
      nodeGraphGradientPageGraphResizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const svg = entry.target;
          if (!svg.isConnected) continue;
          const card = svg.closest(".node-gradient-card");
          const gradient = nodeGraphGradientPageGradients().find((item) => item.id === svg.dataset.gradientGraph);
          if (card && gradient) nodeGraphGradientPageDrawGraph(card, gradient);
        }
      });
    }
    nodeGraphGradientPageGraphResizeObserver.disconnect();
  }
  for (const g of shown) {
    const card = host.querySelector(`.node-gradient-card[data-gradient-id="${CSS.escape(g.id)}"]`);
    if (!card) continue;
    nodeGraphGradientPageDrawGraph(card, g);
    nodeGraphGradientPageUpdateLive(g);
    if (card?.querySelector("[data-gradient-graph]") && nodeGraphGradientPageGraphResizeObserver) {
      nodeGraphGradientPageGraphResizeObserver.observe(card.querySelector("[data-gradient-graph]"));
    }
  }
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
  const shown = Math.max(0, Math.min(1, NodeGraphGradients.positionOf(gradient)));
  if (playhead) playhead.style.left = `${Math.round(shown * (strip?.clientWidth || 0))}px`;
  if (strip) strip.style.background = nodeGraphGradientPageStripBackground(gradient);
  strip?.setAttribute("aria-valuenow", String(gradient.position));
  for (const stop of gradient.stops) {
    const handle = strip?.querySelector(`[data-stop-id="${CSS.escape(stop.id)}"]`);
    if (!handle) continue;
    handle.style.left = `${Math.round(stop.pos * (strip?.clientWidth || 0))}px`;
    const label = handle.querySelector(".node-gradient-handle-label");
    if (label) {
      label.textContent = String(Math.round(stop.pos * 127));
      label.classList.toggle("is-selected", stop.id === nodeGraphGradientPageState.selectedStop.get(gradient.id));
    }
  }
  const slider = card.querySelector("[data-gradient-playhead]");
  if (slider) slider.style.setProperty("--gradient-playhead-progress", `${(shown * 100).toFixed(3)}%`);
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
  if (action === "toggleGraphs") {
    nodeGraphGradientPageState.showGraphs = !nodeGraphGradientPageState.showGraphs;
    renderNodeGraphGradientPage();
    return;
  }
  if (action === "selectCurveParam") {
    nodeGraphGradientPageState.selectedParam.set(gradientId, `${button.dataset.nodeId}\u0000${button.dataset.paramKey}`);
    renderNodeGraphGradientPage();
    if (typeof nodeGraphGradientModuleNoteMoved === "function") nodeGraphGradientModuleNoteMoved();
    return;
  }
  if (action === "newGradient") {
    const created = NodeGraphGradients.createGradientFromSnapshot(patch);
    nodeGraphGradientPageCommit([...nodeGraphGradientPageGradients(), created], `${created.name} started`);
    return;
  }
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === gradientId);
  if (!gradient) return;
  if (action === "curveShape") {
    const next = nodeGraphGradientPageReplace(gradient.id, (g) => ({ ...g, stops: g.stops.map((stop) => stop.id !== button.dataset.stopId ? stop : ({
      ...stop,
      curves: { ...(stop.curves || {}), [button.dataset.nodeId]: { ...(stop.curves?.[button.dataset.nodeId] || {}), [button.dataset.paramKey]: { shape: button.dataset.shape, skew: NodeGraphGradients.curveOf(stop, button.dataset.nodeId, button.dataset.paramKey).skew } } },
    })) }));
    nodeGraphGradientPageCommit(next, `${gradient.name} curve shape`);
    return;
  }
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

// ------------------------------------------------------------------------------------------------ the drag grip (PASTE-8)
//
// The one way to bring a Gradient module (🌈 page) or a Pitch Mutator (Mutator page) into the circuit: a visible grip button. Static: no
// hover, no animation, the app's move cursor; it reads as draggable on its own (six dots). Press it and drag past the slop, and the module
// follows the pointer (the store's placement, one undo step on the drop). A module that may exist only once (one per gradient) is selected
// instead of placed, on a drag or a tap.

const nodeGraphDragGripDots = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false">'
  + [3, 8, 13].map((y) => `<circle cx="2.5" cy="${y}" r="1.6"/><circle cx="7.5" cy="${y}" r="1.6"/>`).join("")
  + "</svg>";

/** A grip button's markup (for pages built from HTML strings, the Mutator page). */
function nodeGraphDragGripHtml(label, attrs = "") {
  const safe = String(label || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  return `<button type="button" class="node-drag-grip" aria-label="${safe}" ${attrs}>${nodeGraphDragGripDots}</button>`;
}

function nodeGraphDragGripButton(label) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "node-drag-grip";
  b.setAttribute("aria-label", label);
  b.innerHTML = nodeGraphDragGripDots;
  return b;
}

const nodeGraphDragGripState = { pending: null };

/** The Gradient module already playing a gradient, else null (one per gradient). */
function nodeGraphGradientModuleForGradient(gradientId) {
  const id = String(gradientId || "");
  return (nodeGraphMvp?.patch?.nodes || []).find((n) => n && n.type === "gradient" && String(n.gradientId || "") === id) || null;
}

/**
 * Press on a grip. spec: { type, bind(node) (sets what the new module plays, before the drop commits), existing() (a module that must
 * not be made twice, selected instead), name (for the status line) }.
 */
function nodeGraphDragGripBegin(event, spec) {
  if (!spec?.type || event.button > 0) return false;
  nodeGraphDragGripState.pending = { ...spec, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  return true;
}

function nodeGraphDragGripSelectExisting(pending) {
  const existing = typeof pending.existing === "function" ? pending.existing() : null;
  if (!existing) return false;
  if (typeof setNodeGraphNodeSelection === "function") setNodeGraphNodeSelection([existing.id]);
  if (typeof setNodeInteractionHelp === "function") setNodeInteractionHelp(`${pending.name || "It"} already has its module: selected it.`);
  return true;
}

function nodeGraphDragGripMove(event) {
  const pending = nodeGraphDragGripState.pending;
  if (!pending || pending.pointerId !== event.pointerId) return;
  if (pending.selectedExisting || Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 6) return;
  if (nodeGraphDragGripSelectExisting(pending)) {
    pending.selectedExisting = true; // the rest of this press only selects it again on release
    return;
  }
  nodeGraphDragGripState.pending = null;
  if (typeof beginNodeGraphModulePlacement !== "function") return;
  const id = beginNodeGraphModulePlacement(pending.type, nodeGraphClientPoint(event), {
    overWorkspace: typeof nodeGraphClientPointInsideWorkspace === "function" ? nodeGraphClientPointInsideWorkspace(event) : true,
  });
  const node = id ? nodeGraphPatchNode(id) : null;
  if (!node) return;
  // Bound before the drop commits, so the placement's one undo step holds the binding.
  if (typeof pending.bind === "function") pending.bind(node);
  if (nodeGraphMvp.modulePlacement) nodeGraphMvp.modulePlacement.pointerId = event.pointerId;
}

function nodeGraphDragGripUp(event) {
  const pending = nodeGraphDragGripState.pending;
  if (!pending || pending.pointerId !== event.pointerId) return;
  nodeGraphDragGripState.pending = null;
  // A tap on the grip of a gradient that already has its module, or a drag of one: select that module.
  if (event.type === "pointerup") nodeGraphDragGripSelectExisting(pending);
}

if (typeof document !== "undefined") {
  document.addEventListener("pointermove", nodeGraphDragGripMove);
  document.addEventListener("pointerup", nodeGraphDragGripUp);
  document.addEventListener("pointercancel", nodeGraphDragGripUp);
}

/** Press on a gradient's grip: a Gradient module playing that gradient, or the one that already does. */
function nodeGraphGradientPageDragOutDown(event) {
  const grip = event.target?.closest?.("[data-gradient-drag]");
  if (!grip) return false;
  const gradientId = grip.dataset.gradientDrag;
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === gradientId);
  if (!gradient) return false;
  return nodeGraphDragGripBegin(event, {
    type: "gradient",
    name: gradient.name,
    existing: () => nodeGraphGradientModuleForGradient(gradientId),
    bind: (node) => {
      const live = nodeGraphGradientPageGradients().find((g) => g.id === gradientId);
      if (!live) return;
      node.gradientId = live.id;
      node.params = { ...(node.params || {}), playhead: Number(live.position) || 0 };
    },
  });
}

function nodeGraphGradientPagePointerDown(event) {
  if (nodeGraphGradientPageDragOutDown(event)) return;
  const strip = event.target?.closest?.(".node-gradient-strip");
  const graph = event.target?.closest?.(".node-gradient-curve-chart");
  if ((!strip && !graph) || event.button > 0) return;
  const card = event.target.closest(".node-gradient-card");
  const gradientId = strip?.dataset.gradientId || graph?.dataset.gradientGraph;
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === gradientId);
  if (!gradient) return;
  if (graph) {
    const point = event.target.closest("[data-curve-point]");
    const series = event.target.closest("[data-curve-series], [data-curve-series-hit]");
    const rawParamId = point?.dataset.curveSeries || series?.dataset.curveSeries || series?.dataset.curveSeriesHit;
    if (rawParamId) {
      const paramId = decodeURIComponent(rawParamId);
      const [nodeId, key] = paramId.split("\u0000");
      nodeGraphGradientPageState.selectedParam.set(gradient.id, paramId);
      const stop = point && gradient.stops[Number(point.dataset.curvePoint)];
      if (stop) nodeGraphGradientPageState.selectedStop.set(gradient.id, stop.id);
      if (stop) {
        event.preventDefault();
        const captureTarget = event.currentTarget;
        try { captureTarget.setPointerCapture(event.pointerId); } catch (_e) { /* capture on the persistent page host */ }
        nodeGraphGradientPageState.drag = {
          pointerId: event.pointerId, graph: true, captureTarget, gradientId: gradient.id,
          stopId: stop.id, paramId, startX: event.clientX, startY: event.clientY,
          startPos: stop.pos, startOffset: nodeGraphGradientPageOffset(stop, nodeId, key), moved: false, axis: "",
        };
      }
      renderNodeGraphGradientPage();
      return;
    }
    return;
  }
  const handle = event.target.closest(".node-gradient-handle");
  event.preventDefault();
  try { strip.setPointerCapture(event.pointerId); } catch (_e) { /* ignore */ }
  nodeGraphGradientPageState.drag = {
    pointerId: event.pointerId,
    strip,
    gradientId: gradient.id,
    stopId: handle?.dataset.stopId || "",
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
  if (handle) {
    nodeGraphGradientPageState.selectedStop.set(gradient.id, handle.dataset.stopId);
    for (const h of strip.querySelectorAll(".node-gradient-handle")) {
      const selected = h === handle;
      h.classList.toggle("is-selected", selected);
      h.querySelector(".node-gradient-handle-label")?.classList.toggle("is-selected", selected);
    }
    const del = strip.parentElement?.querySelector('[data-gradient-action="deleteStop"]');
    if (del) del.disabled = gradient.stops.length < 2;
  }
}

function nodeGraphGradientPageOpenStopColorPicker(event) {
  const handle = event.target?.closest?.(".node-gradient-handle");
  if (!handle) return;
  const card = handle.closest(".node-gradient-card");
  const gradient = nodeGraphGradientPageGradients().find((item) => item.id === handle.closest(".node-gradient-strip")?.dataset.gradientId);
  const stop = gradient?.stops.find((item) => item.id === handle.dataset.stopId);
  const picker = card?.querySelector(".node-gradient-native-color-picker");
  if (!stop || !picker) return;
  event.preventDefault();
  event.stopPropagation();
  const index = [...gradient.stops].sort((a, b) => a.pos - b.pos).findIndex((item) => item.id === stop.id);
  picker.dataset.stopId = stop.id;
  picker.value = stop.color || nodeGraphGradientPageColorInputDefault(index);
  try {
    if (typeof picker.showPicker === "function") picker.showPicker();
    else picker.click();
  } catch (_error) {
    picker.click();
  }
}

function nodeGraphGradientPagePointerMove(event) {
  const drag = nodeGraphGradientPageState.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    if (drag.graph) drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
  }
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === drag.gradientId);
  if (!gradient) return;
  const graphDrag = !!drag.graph;
  const graph = graphDrag ? document.querySelector(`.node-gradient-card[data-gradient-id="${CSS.escape(gradient.id)}"] .node-gradient-curve-chart`) : null;
  const bounds = (graph || drag.strip).getBoundingClientRect();
  const pos = graphDrag
    ? Math.max(0, Math.min(1, drag.startPos + dx / Math.max(1, bounds.width - 16)))
    : nodeGraphGradientPageStripPos(drag.strip, event.clientX);
  // Live edit of the gradient object; the undo step is recorded on release.
  if (drag.stopId) {
    const stop = gradient.stops.find((s) => s.id === drag.stopId);
    if (stop && (!graphDrag || drag.axis === "x")) stop.pos = pos;
    if (graphDrag && drag.axis === "y" && stop) {
      const [nodeId, key] = drag.paramId.split("\u0000");
      (stop.offsets[nodeId] || (stop.offsets[nodeId] = {}))[key] = Math.max(-1, Math.min(1, drag.startOffset - dy / Math.max(1, bounds.height - 12)));
    }
  } else {
    gradient.position = pos;
  }
  nodeGraphGradientPageRepaintSliders([gradient]);
  // A playhead drag moves one engine knob (audio-rate lanes, HP-23); a stop drag changes the lanes' tables.
  if (drag.stopId) nodeGraphGradientsNotifyChanged(`${gradient.name} stop moved`);
  else if (typeof nodeGraphGradientsNotifyPlayhead === "function") nodeGraphGradientsNotifyPlayhead(gradient, `${gradient.name} position`);
  else nodeGraphGradientsNotifyChanged(`${gradient.name} position`);
  nodeGraphGradientPageUpdateLive(gradient);
  nodeGraphGradientPageDrawGraph(document.querySelector(`.node-gradient-card[data-gradient-id="${CSS.escape(gradient.id)}"]`), gradient);
}

function nodeGraphGradientPagePointerUp(event) {
  const drag = nodeGraphGradientPageState.drag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  nodeGraphGradientPageState.drag = null;
  try { (drag.captureTarget || drag.graph || drag.strip)?.releasePointerCapture(event.pointerId); } catch (_e) { /* ignore */ }
  if (event.type === "pointercancel") return;
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === drag.gradientId);
  if (!gradient) return;
  if (drag.moved) {
    // One undo step per release, never per move. A playhead that left the edited stop ends the editing (no outlines between stops).
    nodeGraphGradientPageCommit(nodeGraphGradientPageGradients(), drag.stopId ? `${gradient.name} stop moved` : `${gradient.name} position`);
    if (nodeGraphGradientPageState.editing && !nodeGraphGradientEditActive()) nodeGraphGradientEditEnd();
    return;
  }
  if (drag.graph) return;
  if (drag.stopId) {
    // Tap on a stop: edit it (the playhead snaps there). Tap the edited stop again: stop editing.
    const editing = nodeGraphGradientPageState.editing;
    if (editing && editing.gradientId === gradient.id && editing.stopId === drag.stopId) nodeGraphGradientEditEnd();
    else nodeGraphGradientEditBegin(gradient.id, drag.stopId);
    return;
  }
  if (nodeGraphGradientPageState.editing) {
    // An empty bar click moves the playhead; it never creates a stop.
    nodeGraphGradientEditEnd();
  }
  gradient.position = nodeGraphGradientPageStripPos(drag.strip, event.clientX);
  nodeGraphGradientPageRepaintSliders([gradient]);
  if (typeof nodeGraphGradientsNotifyPlayhead === "function") nodeGraphGradientsNotifyPlayhead(gradient, `${gradient.name} position`);
  else nodeGraphGradientsNotifyChanged(`${gradient.name} position`);
  nodeGraphGradientPageCommit(nodeGraphGradientPageGradients(), `${gradient.name} position`);
}

// ------------------------------------------------------------------------------------------------ editing a stop (HP-24)
//
// Tap a stop: the playhead snaps to it and every slider of that gradient gets an outline (face sliders draw it; a slider input carries
// data-gradient-edit="1" for any other paint site). Moving an outlined slider writes into that stop's offset, one undo step per release;
// other sliders act as usual. Tap the stop again, tap empty strip or press Esc to stop. Between stops nothing is outlined or written.

/** The edited stop while it holds ({ gradient, stop }), else null. */
function nodeGraphGradientEditActive() {
  const editing = nodeGraphGradientPageState.editing;
  if (!editing) return null;
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === editing.gradientId);
  const stop = gradient?.stops?.find((s) => s.id === editing.stopId);
  if (!gradient || !stop || gradient.enabled === false) return null;
  if (Math.abs((Number(gradient.position) || 0) - stop.pos) > 1e-9) return null;
  return { gradient, stop };
}

/** "nodeId\u0000key" of every slider the edited stop writes (the outlined ones). */
function nodeGraphGradientEditTargetKeys() {
  const active = nodeGraphGradientEditActive();
  const out = new Set();
  if (active) for (const { nodeId, key } of active.gradient.params) out.add(`${nodeId}\u0000${key}`);
  return out;
}

let nodeGraphGradientEditMarked = new Set();

/** Put the outline marks on the edited stop's sliders and take them off the others; repaint only the nodes that changed. */
function nodeGraphGradientEditSyncOutlines() {
  const next = nodeGraphGradientEditTargetKeys();
  const touched = new Set();
  for (const mapKey of nodeGraphGradientEditMarked) {
    if (next.has(mapKey)) continue;
    const [nodeId, key] = mapKey.split("\u0000");
    const input = typeof nodeGraphSliderForParameter === "function" ? nodeGraphSliderForParameter(nodeId, key) : null;
    if (input) delete input.dataset.gradientEdit;
    input?.closest?.("label")?.querySelector(".node-slider-readout")?.classList.remove("is-gradient-edit");
    touched.add(nodeId);
  }
  for (const mapKey of next) {
    if (nodeGraphGradientEditMarked.has(mapKey)) continue;
    const [nodeId, key] = mapKey.split("\u0000");
    const input = typeof nodeGraphSliderForParameter === "function" ? nodeGraphSliderForParameter(nodeId, key) : null;
    if (input) input.dataset.gradientEdit = "1";
    input?.closest?.("label")?.querySelector(".node-slider-readout")?.classList.add("is-gradient-edit");
    touched.add(nodeId);
  }
  nodeGraphGradientEditMarked = next;
  if (typeof nodeGraphGlGraphNoteValueChrome === "function") for (const id of touched) nodeGraphGlGraphNoteValueChrome(id);
  if (touched.size && typeof markNodeGraphRenderPending === "function") markNodeGraphRenderPending();
}

function nodeGraphGradientEditBegin(gradientId, stopId) {
  const gradient = nodeGraphGradientPageGradients().find((g) => g.id === gradientId);
  const stop = gradient?.stops?.find((s) => s.id === stopId);
  if (!gradient || !stop) return;
  nodeGraphGradientPageState.selectedStop.set(gradientId, stopId);
  nodeGraphGradientPageState.editing = { gradientId, stopId };
  // The playhead snaps to the stop: the sound and every display show the stop being edited. Navigation, not an edit: no undo step.
  if (gradient.position !== stop.pos) {
    gradient.position = stop.pos;
    nodeGraphGradientsNotifyChanged(`${gradient.name} editing stop`);
  }
  nodeGraphGradientEditSyncOutlines();
  renderNodeGraphGradientPage();
}

function nodeGraphGradientEditEnd() {
  if (!nodeGraphGradientPageState.editing) return;
  nodeGraphGradientPageState.editing = null;
  nodeGraphGradientEditSyncOutlines();
  renderNodeGraphGradientPage();
}

/**
 * Slider intercept (node-graph-slider-dragging.js, ahead of the Pitch Mutator): while a stop is edited, a move of one of its sliders sets
 * that stop's offset so the sounding value lands where the slider was moved; the base param is not written. Returns true when taken.
 * options.commit: the release (one undo step).
 */
function nodeGraphGradientMaybeInterceptSlider(slider, domainValue, options = {}) {
  const active = nodeGraphGradientEditActive();
  if (!active || !slider) return false;
  const nodeId = slider.closest?.(".dsp-node")?.dataset?.node || "";
  const key = String(slider.dataset?.param || "");
  if (!nodeId || !key || !active.gradient.params.some((p) => p.nodeId === nodeId && p.key === key)) return false;
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const meta = node ? NodeGraphGradients.metaFor(node, key) : null;
  const value = Number(domainValue);
  if (!node || !meta || !Number.isFinite(value)) return false;
  const { gradient, stop } = active;
  const current = Number(stop.offsets?.[nodeId]?.[key]) || 0;
  const target = NodeGraphGradients.toSlider(meta, value);
  let offset;
  if (NodeGraphGradients.isDiscrete(meta)) {
    // Discrete params take the stop's value outright: origin + offset.
    const origin = Number(gradient.origin?.[nodeId]?.[key]);
    offset = target - (Number.isFinite(origin) ? origin : NodeGraphGradients.toSlider(meta, Number(node.params[key])));
  } else {
    // Continuous: move this stop's offset by what is still missing, so other gradients and providers keep their share.
    const base = Number(node.params[key]);
    const sounding = typeof applyNodeGraphParamOffsetsToBase === "function"
      ? applyNodeGraphParamOffsetsToBase(node, key, base, meta)
      : base;
    offset = current + (target - NodeGraphGradients.toSlider(meta, sounding));
  }
  if (Number.isFinite(offset)) {
    stop.offsets = { ...(stop.offsets || {}) };
    stop.offsets[nodeId] = { ...(stop.offsets[nodeId] || {}), [key]: offset };
  }
  // The thumb follows the hand (the sounding value); the base stays in node.params.
  slider.dataset.domainValue = String(value);
  nodeGraphGradientsNotifyChanged(`${gradient.name} stop value`);
  nodeGraphGradientPageUpdateLive(gradient);
  if (options.commit) nodeGraphGradientPageCommit(nodeGraphGradientPageGradients(), `${gradient.name} stop value`);
  return true;
}

function nodeGraphGradientEditKeydown(event) {
  if (event.key !== "Escape" || !nodeGraphGradientPageState.editing) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  nodeGraphGradientEditEnd();
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
  host.addEventListener("input", (event) => {
    const playhead = event.target?.closest?.("[data-gradient-playhead]");
    if (playhead) {
      const gradient = nodeGraphGradientPageGradients().find((g) => g.id === playhead.dataset.gradientPlayhead);
      if (!gradient) return;
      gradient.position = Number(playhead.value);
      playhead.style.setProperty("--gradient-playhead-progress", `${(gradient.position * 100).toFixed(3)}%`);
      nodeGraphGradientPageRepaintSliders([gradient]);
      if (typeof nodeGraphGradientsNotifyPlayhead === "function") nodeGraphGradientsNotifyPlayhead(gradient, `${gradient.name} position`);
      nodeGraphGradientPageUpdateLive(gradient);
      nodeGraphGradientPageDrawGraph(playhead.closest(".node-gradient-card"), gradient);
      const value = playhead.closest(".node-gradient-card")?.querySelector(".node-gradient-selected-value");
      const selected = nodeGraphGradientSelectedParam(gradient);
      if (value && selected) value.textContent = `Value ${nodeGraphGradientPageFormat(nodeGraphGradientPageOffsetAt(gradient, selected.nodeId, selected.key))}`;
      return;
    }
    const input = event.target?.closest?.("[data-gradient-skew]");
    if (!input) return;
    const { gradientId, stopId, nodeId, paramKey } = input.dataset;
    const gradient = nodeGraphGradientPageGradients().find((g) => g.id === gradientId);
    if (!gradient) return;
    const next = nodeGraphGradientPageReplace(gradientId, (g) => ({ ...g, stops: g.stops.map((stop) => stop.id !== stopId ? stop : ({
      ...stop,
      curves: { ...(stop.curves || {}), [nodeId]: { ...(stop.curves?.[nodeId] || {}), [paramKey]: { ...NodeGraphGradients.curveOf(stop, nodeId, paramKey), skew: Number(input.value) } } },
    })) }));
    nodeGraphMvp.patch.gradients = NodeGraphGradients.normalize(next);
    nodeGraphGradientsNotifyChanged(`${gradient.name} curve skew`);
  });
  host.addEventListener("change", (event) => {
    const playhead = event.target?.closest?.("[data-gradient-playhead]");
    if (playhead) {
      const gradient = nodeGraphGradientPageGradients().find((g) => g.id === playhead.dataset.gradientPlayhead);
      if (gradient) nodeGraphGradientPageCommit(nodeGraphGradientPageGradients(), `${gradient.name} position`);
      return;
    }
    if (!event.target?.matches?.("[data-gradient-skew]")) return;
    if (typeof recordNodeGraphHistory === "function") recordNodeGraphHistory();
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
  host.addEventListener("dblclick", nodeGraphGradientPageOpenStopColorPicker);
  // Undo / redo / load replace the patch: re-render from the committed patch (an edited stop that is gone ends the editing).
  if (typeof addNodeGraphPatchCommitListener === "function") {
    addNodeGraphPatchCommitListener(() => {
      if (nodeGraphGradientPageState.editing && !nodeGraphGradientEditActive()) nodeGraphGradientPageState.editing = null;
      nodeGraphGradientEditSyncOutlines();
      if (!nodeGraphGradientPageState.drag) renderNodeGraphGradientPage();
    });
  }
  document.addEventListener("keydown", nodeGraphGradientEditKeydown, true);
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
  // Closing the page ends stop editing: outlines never outlive the page that explains them.
  if (!open) nodeGraphGradientEditEnd();
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
