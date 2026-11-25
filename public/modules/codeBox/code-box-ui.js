// Code box — control-plane document editor for Graph `graph` JSON.
// Publishes Code out on the data bus. Never runs in the audio path.
// Payload is isomorphic to normalizeNodeGraphGraph (optional "v" tag only).

const CODE_BOX_DEFAULT_GRAPH = Object.freeze({
  cursorX: 0.5,
  nodes: Object.freeze([
    Object.freeze({ x: 0, y: 1, c: 0, shape: "rational" }),
    Object.freeze({ x: 1, y: 0, c: 0, shape: "rational" }),
  ]),
});

/** Compact JSON: one line per point, minimal wrapping. Still valid JSON. */
function serializeNodeGraphCurveToCodeText(graph) {
  const g = typeof normalizeNodeGraphGraph === "function"
    ? normalizeNodeGraphGraph(graph)
    : graph;
  const cursorX = Number(g?.cursorX);
  const nodes = (Array.isArray(g?.nodes) ? g.nodes : []).map((node) => ({
    x: Number(node?.x),
    y: Number(node?.y),
    c: Number(node?.c),
    shape: String(node?.shape || "rational"),
  }));
  const nodeLines = nodes.map((node) => `    ${JSON.stringify(node)}`);
  return [
    "{",
    `  "cursorX": ${JSON.stringify(cursorX)},`,
    `  "nodes": [`,
    nodeLines.join(",\n"),
    "  ]",
    "}",
    "",
  ].join("\n");
}

function nodeGraphCodeBoxDefaultLocalText() {
  return serializeNodeGraphCurveToCodeText(CODE_BOX_DEFAULT_GRAPH);
}

const CODE_BOX_DEFAULT_LOCAL_TEXT = nodeGraphCodeBoxDefaultLocalText();

function normalizeNodeGraphCodeBox(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const localText = source.localText != null
    ? String(source.localText)
    : CODE_BOX_DEFAULT_LOCAL_TEXT;
  return { localText };
}

function nodeGraphCodeBoxIsCodeInConnected(nodeId) {
  if (typeof nodeGraphModuleScopeConnectionsTo !== "function") {
    return false;
  }
  const connections = nodeGraphModuleScopeConnectionsTo(nodeId, "Code") || [];
  return connections.some((c) => c?.sourceNode && c?.sourcePort);
}

function nodeGraphCodeBoxIncomingText(nodeId) {
  if (typeof readNodeGraphDataInput !== "function") {
    return undefined;
  }
  const value = readNodeGraphDataInput(nodeId, "Code");
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  // Object on the bus → same compact document form as Graph serialize.
  try {
    if (value && typeof value === "object" && Array.isArray(value.nodes)) {
      return serializeNodeGraphCurveToCodeText(value);
    }
    return `${JSON.stringify(value)}\n`;
  } catch (_error) {
    return String(value ?? "");
  }
}

function nodeGraphCodeBoxSourceGraphText(nodeId) {
  if (typeof nodeGraphModuleScopeConnectionsTo !== "function") {
    return undefined;
  }
  const connection = (nodeGraphModuleScopeConnectionsTo(nodeId, "Code") || [])
    .find((c) => c?.sourceNode && c?.sourcePort);
  if (!connection) {
    return undefined;
  }
  const source = typeof nodeGraphPatchNode === "function"
    ? nodeGraphPatchNode(connection.sourceNode)
    : null;
  if (!source || (source.type !== "smoothGraph" && source.type !== "stepGraph")) {
    return undefined;
  }
  return serializeNodeGraphCurveToCodeText(source.graph);
}

function nodeGraphCodeBoxEffectiveText(patchNode) {
  if (!patchNode) {
    return CODE_BOX_DEFAULT_LOCAL_TEXT;
  }
  const store = normalizeNodeGraphCodeBox(patchNode.codeBox);
  if (nodeGraphCodeBoxIsCodeInConnected(patchNode.id)) {
    const incoming = nodeGraphCodeBoxIncomingText(patchNode.id);
    if (incoming !== undefined && String(incoming).trim() !== "") {
      return String(incoming);
    }
    // Bus empty (publish not run yet) — read the wired Graph object directly.
    const fromSource = nodeGraphCodeBoxSourceGraphText(patchNode.id);
    if (fromSource !== undefined) {
      return fromSource;
    }
  }
  return store.localText;
}

/** Parse Code-jack payload → normalized graph, or { ok:false, message }. */
function nodeGraphParseCodeGraphDocument(textOrValue) {
  let raw = textOrValue;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { ok: false, message: "Empty document." };
    }
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      return { ok: false, message: `Invalid JSON: ${error?.message || "parse error"}` };
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Document must be a JSON object ({ cursorX, nodes })." };
  }
  // Allow optional version tag; ignore unknown keys after normalize.
  const candidate = {
    cursorX: raw.cursorX,
    nodes: raw.nodes,
  };
  if (!Array.isArray(candidate.nodes)) {
    return { ok: false, message: "Missing nodes array." };
  }
  if (candidate.nodes.length < 2) {
    return { ok: false, message: "Need at least 2 points in nodes." };
  }
  if (typeof normalizeNodeGraphGraph !== "function") {
    return { ok: false, message: "Graph normalize unavailable." };
  }
  const graph = normalizeNodeGraphGraph(candidate);
  if (!Array.isArray(graph?.nodes) || graph.nodes.length < 2) {
    return { ok: false, message: "Normalize produced fewer than 2 points." };
  }
  return { ok: true, graph, message: "ok" };
}

function commitNodeGraphCodeBoxLocalText(nodeId, localText, status = "Code local text") {
  if (typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked()) {
    return { ok: false, message: "Patch is locked." };
  }
  if (typeof nodeGraphScriptReadyForGraphAction === "function"
    && !nodeGraphScriptReadyForGraphAction("codeBox")) {
    return { ok: false, message: "Scripts not ready." };
  }
  if (!nodeId || (typeof nodeGraphMvp !== "undefined" && !nodeGraphMvp.activeNodes?.has?.(nodeId))) {
    return { ok: false, message: "Module not active." };
  }
  if (nodeGraphCodeBoxIsCodeInConnected(nodeId)) {
    return { ok: false, message: "Code in connected — local Apply disabled." };
  }
  const parsed = nodeGraphParseCodeGraphDocument(localText);
  if (!parsed.ok) {
    return parsed;
  }
  const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
  const patchNode = patch.nodes.find((n) => n.id === nodeId);
  if (!patchNode) {
    return { ok: false, message: "Node missing." };
  }
  // Persist canonical JSON (what the object is), not whatever the user typed with junk keys.
  const canonical = serializeNodeGraphCurveToCodeText(parsed.graph);
  patchNode.codeBox = normalizeNodeGraphCodeBox({ localText: canonical });
  commitNodeGraphPatch(patch, { status, record: true });
  if (typeof writeNodeGraphDataOutput === "function") {
    writeNodeGraphDataOutput(nodeId, "Code", canonical);
  }
  return { ok: true, graph: parsed.graph, message: "ok" };
}

function publishNodeGraphCodeBoxOutput(nodeId) {
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!patchNode || patchNode.type !== "codeBox") {
    return;
  }
  if (typeof writeNodeGraphDataOutput !== "function") {
    return;
  }
  writeNodeGraphDataOutput(nodeId, "Code", nodeGraphCodeBoxEffectiveText(patchNode));
}

function syncNodeGraphCodeBoxFace(face, nodeId) {
  if (!face || !nodeId) {
    return;
  }
  const area = face.querySelector(".node-code-box-source");
  const hint = face.querySelector(".node-code-box-hint");
  if (!area) {
    return;
  }
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  if (!patchNode) {
    return;
  }
  const driven = nodeGraphCodeBoxIsCodeInConnected(nodeId);
  const patchLocked = typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked();
  const effective = nodeGraphCodeBoxEffectiveText(patchNode);
  area.readOnly = driven || patchLocked;
  // code-edit-1: no caption — a dashed border shows a cable-driven box; an
  // error line appears only after a failed commit.
  // Don't fight the caret while the user is typing local text.
  if (!driven && document.activeElement === area) {
    area._nodeGraphCodeEdit?.refresh();
    publishNodeGraphCodeBoxOutput(nodeId);
    return;
  }
  // Invalid text stays in the box until the stored document changes (undo,
  // cable, another edit) — then the box follows the patch again. code-edit-2:
  // only while the text really is invalid, so a stale error never survives.
  const keepDraft = !driven
    && area.classList.contains("is-invalid")
    && area.dataset.codeEditBase === effective
    && area.value !== effective
    && !nodeGraphParseCodeGraphDocument(area.value).ok;
  if (!keepDraft) {
    if (area.classList.contains("is-invalid") && typeof setNodeGraphCodeEditInvalid === "function") {
      setNodeGraphCodeEditInvalid(area, false);
    }
    if (hint && hint.textContent) {
      hint.textContent = "";
    }
    if (area.value !== effective) {
      area.value = effective;
    }
  }
  area._nodeGraphCodeEdit?.refresh();
  publishNodeGraphCodeBoxOutput(nodeId);
}

function createNodeGraphCodeBoxFace(nodeId) {
  const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null;
  const store = normalizeNodeGraphCodeBox(patchNode?.codeBox);

  const face = document.createElement("div");
  face.className = "node-code-box-face";
  face.dataset.node = nodeId;
  face.dataset.nodeType = "codeBox";
  face.setAttribute("aria-label", "Code box");

  // code-edit-1: the box fills the face; a compact Apply sits in its corner.
  // A <label> wrapper: the app's pointerdown blur-outside rule keeps the caret
  // when Apply (inside the same label) is pressed.
  const editor = document.createElement("label");
  editor.className = "node-code-box-editor-wrap node-code-edit";

  // An <input type=button>: the GL graph hit layer passes form fields through
  // as live HTML, so the chip clicks instead of grabbing the module.
  const applyBtn = document.createElement("input");
  applyBtn.type = "button";
  applyBtn.className = "node-code-box-apply node-code-edit-apply";
  applyBtn.value = "Apply";

  const area = document.createElement("textarea");
  area.className = "node-code-box-source";
  area.spellcheck = false;
  area.autocomplete = "off";
  area.value = store.localText;
  area.setAttribute("aria-label", "Graph JSON document");

  const hint = document.createElement("div");
  hint.className = "node-code-box-hint";

  const storedText = () => nodeGraphCodeBoxEffectiveText(
    typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(nodeId) : null,
  );
  const commit = (reason) => commitNodeGraphCodeBoxLocalText(
    nodeId,
    area.value,
    reason === "leave" ? "Code edit" : "Code Apply",
  );
  // code-edit-2: the error line always describes the text in the box.
  const onValidate = (result) => {
    if (result && result.ok === false) {
      // Remember which stored document this draft failed against.
      area.dataset.codeEditBase = storedText();
      hint.textContent = result.message || "Not applied.";
      return;
    }
    hint.textContent = "";
  };
  const onResult = (result) => {
    if (result && result.ok === false) {
      onValidate(result);
      return;
    }
    hint.textContent = "";
    syncNodeGraphCodeBoxFace(face, nodeId);
  };
  if (typeof bindNodeGraphCodeEditCommit === "function") {
    bindNodeGraphCodeEditCommit(area, {
      commit,
      validate: (text) => nodeGraphParseCodeGraphDocument(text),
      isDirty: () => area.value !== storedText(),
      applyButton: applyBtn,
      onValidate,
      onResult,
    });
  } else {
    applyBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!area.readOnly) onResult(commit("apply"));
    });
  }
  area.addEventListener("pointerdown", (e) => e.stopPropagation());
  area.addEventListener("keydown", (e) => e.stopPropagation());

  editor.append(area, applyBtn);
  face.append(editor, hint);
  face.addEventListener("pointerdown", (event) => {
    if (event.target.closest("textarea, button")) {
      event.stopPropagation();
    }
  });

  // Never commit during face mount — that re-enters applyNodeGraphPatchToDom and freezes the app.
  if (patchNode && (!patchNode.codeBox || patchNode.codeBox.localText == null)) {
    patchNode.codeBox = normalizeNodeGraphCodeBox({ localText: store.localText });
  }

  syncNodeGraphCodeBoxFace(face, nodeId);
  return face;
}

function syncAllNodeGraphCodeBoxFaces() {
  document.querySelectorAll(".node-code-box-face[data-node]").forEach((face) => {
    syncNodeGraphCodeBoxFace(face, face.dataset.node);
  });
}

// Graph id -> Code-in text last applied to it (code-sync-1).
const nodeGraphCodeGraphApplied = new Map();

function syncNodeGraphGraphCodeInputs() {
  if (typeof nodeGraphPatchNode !== "function" || typeof nodeGraphMvp === "undefined") return;
  const patchNodes = nodeGraphMvp.patch?.nodes || [];
  for (const patchNode of patchNodes) {
    if (!patchNode || (patchNode.type !== "smoothGraph" && patchNode.type !== "stepGraph")) continue;
    if (typeof nodeGraphCodeBoxIsCodeInConnected !== "function" || !nodeGraphCodeBoxIsCodeInConnected(patchNode.id)) {
      continue;
    }
    const incoming = nodeGraphCodeBoxIncomingText(patchNode.id);
    if (incoming === undefined) continue;
    const text = String(incoming ?? "");
    // code-sync-1: the stored fingerprint does not survive commit (ui is
    // normalized), so this used to commit the whole patch on every 250 ms
    // tick (~200 ms each). Remember what was applied here, and skip when the
    // graph already says the same thing.
    if (nodeGraphCodeGraphApplied.get(patchNode.id) === text) continue;
    if (patchNode.ui?.codeDrivenFingerprint === text) continue;
    const parsed = nodeGraphParseCodeGraphDocument(text);
    if (!parsed.ok) continue;
    if (serializeNodeGraphCurveToCodeText(parsed.graph) === serializeNodeGraphCurveToCodeText(patchNode.graph)) {
      nodeGraphCodeGraphApplied.set(patchNode.id, text);
      continue;
    }
    if (typeof cloneNodeGraphPatch !== "function" || typeof commitNodeGraphPatch !== "function") continue;
    nodeGraphCodeGraphApplied.set(patchNode.id, text);
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    const node = patch.nodes.find((n) => n.id === patchNode.id);
    if (!node) continue;
    node.graph = parsed.graph;
    node.ui = { ...(node.ui || {}), codeDriven: true, codeDrivenFingerprint: text };
    commitNodeGraphPatch(patch, { status: "Graph Code in", record: false });
  }
}

function publishNodeGraphGraphCodeOutputs() {
  if (typeof nodeGraphMvp === "undefined" || typeof writeNodeGraphDataOutput !== "function") return;
  for (const patchNode of nodeGraphMvp.patch?.nodes || []) {
    if (!patchNode || (patchNode.type !== "smoothGraph" && patchNode.type !== "stepGraph")) continue;
    let text;
    if (typeof nodeGraphCodeBoxIsCodeInConnected === "function"
      && nodeGraphCodeBoxIsCodeInConnected(patchNode.id)) {
      const incoming = nodeGraphCodeBoxIncomingText(patchNode.id);
      text = incoming !== undefined ? String(incoming ?? "") : serializeNodeGraphCurveToCodeText(patchNode.graph);
    } else {
      text = serializeNodeGraphCurveToCodeText(patchNode.graph);
    }
    writeNodeGraphDataOutput(patchNode.id, "Code", text);
  }
}

function syncAllNodeGraphCodeSurfaces() {
  syncAllNodeGraphCodeBoxFaces();
  syncNodeGraphGraphCodeInputs();
  publishNodeGraphGraphCodeOutputs();
}

// code-sync-1: event-driven, no timer. Everything here derives from the
// patch (Code box text, Graph curves, the Code cables, patch lock), and only
// Code boxes write "Code" outputs, so a patch commit is the one trigger.
// Typing in a box is handled by its own input/commit listeners; a new face
// syncs itself when it is created.
function nodeGraphCodeBoxStartSurfaceSync() {
  if (nodeGraphCodeBoxStartSurfaceSync.started) {
    return;
  }
  nodeGraphCodeBoxStartSurfaceSync.started = true;
  const run = (info) => {
    if (info?.layoutOnly) return;
    syncAllNodeGraphCodeSurfaces();
  };
  if (typeof addNodeGraphPatchCommitListener === "function") {
    addNodeGraphPatchCommitListener(run);
  } else if (typeof window !== "undefined") {
    // patch-core loads first; if it ever does not, hook up once it has.
    window.addEventListener("nodeSandboxInterfaceReady", () => {
      if (typeof addNodeGraphPatchCommitListener === "function") addNodeGraphPatchCommitListener(run);
    }, { once: true });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("nodeSandboxInterfaceReady", () => run(), { once: true });
  }
  // Prime bus + faces once scripts are up.
  try {
    syncAllNodeGraphCodeSurfaces();
  } catch (_error) {
    // First run is best-effort.
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", nodeGraphCodeBoxStartSurfaceSync);
  } else {
    nodeGraphCodeBoxStartSurfaceSync();
  }
}
