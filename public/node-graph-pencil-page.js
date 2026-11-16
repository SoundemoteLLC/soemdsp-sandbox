// Pencil page (Command Center nav: ✏️). Drawing options for the canvas pen
// (the snake / hit trail; Ctrl keeps a drawn line). Sizes are screen px at the
// moment a line is drawn; the line then keeps its size relative to the canvas.
// Settings live in nodeGraphPencilSettings() (node-graph-marquee-selection.js).

const nodeGraphPencilFields = Object.freeze([
  Object.freeze({ key: "width", label: "Width", unit: "px", step: "0.5", min: "0", hint: "line thickness on screen when you draw" }),
  Object.freeze({ key: "dash", label: "Dash", unit: "px", step: "1", min: "0", hint: "length of each dash" }),
  Object.freeze({ key: "gap", label: "Gap", unit: "px", step: "1", min: "0", hint: "space between dashes; 0 = solid line" }),
]);

function applyNodeGraphPencilPageSize(size = {}, panelArg = null) {
  const panel = panelArg || document.getElementById("nodePencilPage");
  if (!panel) {
    return null;
  }
  if (typeof applyNodeGraphUnifiedWindowShellSize === "function") {
    return applyNodeGraphUnifiedWindowShellSize(panel, size);
  }
  const width = Math.round(Number(size.width) || panel.getBoundingClientRect().width);
  const height = Math.round(Number(size.height) || panel.getBoundingClientRect().height);
  if (width >= 24) panel.style.width = `${width}px`;
  if (height >= 120) panel.style.height = `${height}px`;
  return { width, height };
}

const nodeGraphPencilTools = Object.freeze([
  Object.freeze({ tool: "select", label: "Select", hint: "drag selects modules and cables; the line is temporary" }),
  Object.freeze({ tool: "draw", label: "Draw", hint: "draw anywhere, over modules too; every stroke is kept in the patch and nothing is selected" }),
  Object.freeze({ tool: "erase", label: "Erase", hint: "click or drag over a stroke (anywhere, over modules too) to remove the whole stroke" }),
]);

function nodeGraphPencilButton(text, attrs, hint) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "node-pencil-button";
  button.textContent = text;
  button.title = hint;
  for (const [k, v] of Object.entries(attrs)) button.dataset[k] = v;
  return button;
}

/** Tool highlight and undo / redo / clear enabled state. */
function syncNodeGraphPencilPageButtons() {
  const body = document.getElementById("nodePencilPageBody");
  if (!body) return;
  const tool = typeof nodeGraphPencilTool === "function" ? nodeGraphPencilTool() : "select";
  for (const b of body.querySelectorAll("[data-pencil-tool]")) {
    const on = b.dataset.pencilTool === tool;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const history = typeof nodeGraphDrawingHistory === "function" ? nodeGraphDrawingHistory() : { undo: [], redo: [] };
  const count = typeof nodeGraphHitTrailKeptStrokes === "function" ? nodeGraphHitTrailKeptStrokes().length : 0;
  const set = (action, enabled) => {
    const b = body.querySelector(`[data-pencil-action="${action}"]`);
    if (b) b.disabled = !enabled;
  };
  set("undo", history.undo.length > 0);
  set("redo", history.redo.length > 0);
  set("clear", count > 0);
  const counter = body.querySelector(".node-pencil-count");
  if (counter) counter.textContent = `${count} drawing${count === 1 ? "" : "s"} in this patch`;
}

function renderNodeGraphPencilPage() {
  const body = document.getElementById("nodePencilPageBody");
  if (!body || typeof nodeGraphPencilSettings !== "function") {
    return;
  }
  const pencil = nodeGraphPencilSettings();
  const fragment = document.createDocumentFragment();
  const tools = document.createElement("div");
  tools.className = "node-pencil-buttons";
  tools.setAttribute("role", "group");
  tools.setAttribute("aria-label", "Pencil tool");
  for (const t of nodeGraphPencilTools) tools.append(nodeGraphPencilButton(t.label, { pencilTool: t.tool }, t.hint));
  fragment.append(tools);
  const actions = document.createElement("div");
  actions.className = "node-pencil-buttons";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Drawing history");
  actions.append(
    nodeGraphPencilButton("Undo", { pencilAction: "undo" }, "undo the last drawing change (separate from the patch Undo)"),
    nodeGraphPencilButton("Redo", { pencilAction: "redo" }, "redo a drawing change"),
    nodeGraphPencilButton("Clear", { pencilAction: "clear" }, "remove every drawing in this patch (Undo brings them back)"),
  );
  fragment.append(actions);
  const count = document.createElement("p");
  count.className = "node-pencil-count";
  fragment.append(count);
  for (const field of nodeGraphPencilFields) {
    const row = document.createElement("label");
    row.className = "node-pencil-row";
    const name = document.createElement("span");
    name.className = "node-pencil-label";
    name.textContent = field.label;
    const input = document.createElement("input");
    input.type = "number";
    input.inputMode = "decimal";
    input.min = field.min;
    input.step = field.step;
    input.value = String(pencil[field.key]);
    input.dataset.pencilKey = field.key;
    input.setAttribute("aria-label", `Pencil ${field.label} (${field.unit})`);
    input.title = field.hint;
    const unit = document.createElement("span");
    unit.className = "node-pencil-unit";
    unit.textContent = field.unit;
    row.append(name, input, unit);
    fragment.append(row);
  }
  body.replaceChildren(fragment);
  syncNodeGraphPencilPageButtons();
}

function setNodeGraphPencilPageOpen(open) {
  const panel = document.getElementById("nodePencilPage");
  if (!panel) {
    return;
  }
  const switching = Boolean(nodeGraphMvp?._unifiedWindowSwitching);
  if (open && !panel.hidden) {
    if (!switching && typeof openNodeGraphUnifiedWindowPage === "function") {
      openNodeGraphUnifiedWindowPage("pencil");
      return;
    }
    if (typeof pulseNodeGraphFloatingWindowAttention === "function") {
      pulseNodeGraphFloatingWindowAttention(panel);
    }
    return;
  }
  if (open && !switching && typeof openNodeGraphUnifiedWindowPage === "function") {
    openNodeGraphUnifiedWindowPage("pencil");
    return;
  }
  panel.hidden = !open;
  if (open) {
    panel.classList.add("node-unified-window");
    if (typeof markNodeGraphFloatingWindowSurface === "function") {
      markNodeGraphFloatingWindowSurface(panel);
    }
    if (typeof noteNodeGraphUnifiedWindowOpened === "function") {
      noteNodeGraphUnifiedWindowOpened("pencil", panel);
    }
    renderNodeGraphPencilPage();
  }
}

function bindNodeGraphPencilPageEvents() {
  if (document.documentElement.dataset.pencilPageBound === "true") {
    return;
  }
  document.documentElement.dataset.pencilPageBound = "true";
  document.getElementById("nodePencilPageClose")?.addEventListener("click", () => {
    if (typeof closeNodeGraphUnifiedWindowPage === "function") {
      closeNodeGraphUnifiedWindowPage("pencil");
      return;
    }
    setNodeGraphPencilPageOpen(false);
  });
  document
    .querySelector("#nodePencilPage .scene-context-heading")
    ?.addEventListener("pointerdown", (event) => {
      if (typeof beginNodeGraphRegisteredFloatingWindowDrag === "function") {
        beginNodeGraphRegisteredFloatingWindowDrag(event, "pencil");
      }
    });
  document
    .getElementById("nodePencilPageResizeHandle")
    ?.addEventListener("pointerdown", (event) => {
      if (typeof beginNodeGraphRegisteredFloatingWindowResize === "function") {
        beginNodeGraphRegisteredFloatingWindowResize(event, "pencil");
      }
    });
  document.getElementById("nodePencilPageBody")?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button) return;
    if (button.dataset.pencilTool && typeof setNodeGraphPencilTool === "function") {
      setNodeGraphPencilTool(button.dataset.pencilTool);
      return;
    }
    const action = button.dataset.pencilAction;
    if (action === "undo" && typeof undoNodeGraphDrawing === "function") undoNodeGraphDrawing();
    else if (action === "redo" && typeof redoNodeGraphDrawing === "function") redoNodeGraphDrawing();
    else if (action === "clear" && typeof clearNodeGraphHitTrailKept === "function") clearNodeGraphHitTrailKept();
  });
  document.getElementById("nodePencilPageBody")?.addEventListener("input", (event) => {
    const input = event.target;
    const key = input?.dataset?.pencilKey;
    if (!key || typeof setNodeGraphPencilSetting !== "function") return;
    if (input.value === "") return; // mid-typing: keep the last value
    setNodeGraphPencilSetting(key, input.value);
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNodeGraphPencilPageEvents, { once: true });
  } else {
    bindNodeGraphPencilPageEvents();
  }
}
