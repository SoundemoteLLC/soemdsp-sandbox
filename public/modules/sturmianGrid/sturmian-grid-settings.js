// Sturmian Grid Display Settings (not the param band): separate 0-1 alphas
// for the 1px track-span outline and the 1px playhead frame. Defaults are 1.

const NODE_GRAPH_STURMIAN_GRID_DISPLAY_DEFAULTS = Object.freeze({
  trackStrokeAlpha: 1,
  playheadStrokeAlpha: 1,
});

function sturmianGridUnitAlpha(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function normalizeNodeGraphSturmianGridFaceSettings(settings) {
  const d = NODE_GRAPH_STURMIAN_GRID_DISPLAY_DEFAULTS;
  const src = settings && typeof settings === "object" ? settings : {};
  return {
    trackStrokeAlpha: sturmianGridUnitAlpha(src.trackStrokeAlpha, d.trackStrokeAlpha),
    playheadStrokeAlpha: sturmianGridUnitAlpha(src.playheadStrokeAlpha, d.playheadStrokeAlpha),
  };
}

function nodeGraphSturmianGridDisplaySettingsForNode(node) {
  return normalizeNodeGraphSturmianGridFaceSettings(node?.traceDisplaySettings);
}

function sturmianGridFormatAlpha(value) {
  const n = sturmianGridUnitAlpha(value, 1);
  return String(Number(n.toFixed(2)));
}

function buildNodeGraphSturmianGridDisplaySettingsBodyHtml() {
  const row = (key, label) => `
    <label class="metadata-field-row" data-trace-display-control-row>
      <span class="metadata-field-label">${label}</span>
      <span class="metadata-stepper-control">
        <input type="range" min="0" max="1" step="0.01" data-sturmian-grid-setting="${key}">
        <input type="text" inputmode="decimal" data-sturmian-grid-readout="${key}" readonly>
      </span>
    </label>`;
  return `
    <div data-sturmian-grid-display-settings-panel>
      ${row("trackStrokeAlpha", "Track Stroke Alpha")}
      ${row("playheadStrokeAlpha", "Playhead Stroke Alpha")}
    </div>`;
}

function syncNodeGraphSturmianGridDisplaySettingsControls(root, settings) {
  if (!root) return;
  const s = normalizeNodeGraphSturmianGridFaceSettings(settings);
  const panel = root.querySelector?.("[data-sturmian-grid-display-settings-panel]") || root;
  for (const key of ["trackStrokeAlpha", "playheadStrokeAlpha"]) {
    const slider = panel.querySelector?.(`[data-sturmian-grid-setting="${key}"]`);
    const readout = panel.querySelector?.(`[data-sturmian-grid-readout="${key}"]`);
    const text = sturmianGridFormatAlpha(s[key]);
    if (slider) slider.value = text;
    if (readout) readout.value = text;
  }
}

function bindNodeGraphSturmianGridDisplaySettingsBody(host) {
  if (!host || host.dataset.sturmianGridSettingsBound === "true") return;
  host.dataset.sturmianGridSettingsBound = "true";
  const apply = (persist, record) => {
    if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
      markNodeGraphTraceDisplaySettingsDirty("*");
    }
    if (typeof applyNodeGraphTraceDisplaySettingsForm === "function") {
      applyNodeGraphTraceDisplaySettingsForm({ persist, record, commit: record });
    }
  };
  host.addEventListener("input", (event) => {
    if (event.target?.closest?.("[data-sturmian-grid-setting]")) apply("none", false);
  });
  host.addEventListener("change", (event) => {
    if (event.target?.closest?.("[data-sturmian-grid-setting]")) apply("debounce", true);
  });
}

function readNodeGraphSturmianGridDisplaySettingsForm(root, current) {
  const panel = root?.querySelector?.("[data-sturmian-grid-display-settings-panel]") || root;
  const next = { ...(current && typeof current === "object" ? current : {}) };
  for (const key of ["trackStrokeAlpha", "playheadStrokeAlpha"]) {
    const slider = panel?.querySelector?.(`[data-sturmian-grid-setting="${key}"]`);
    if (slider) next[key] = slider.value;
  }
  return normalizeNodeGraphSturmianGridFaceSettings(next);
}

function applyNodeGraphSturmianGridDisplaySettingsToFace(node) {
  const id = String(node?.id || "").trim();
  if (!id) return;
  const faces = document.querySelectorAll?.(".node-sturmian-grid");
  faces?.forEach?.((face) => {
    if (String(face.dataset?.node || "") !== id) return;
    face._sturmianForce = true;
    if (typeof sturmianPaint === "function") sturmianPaint(face);
  });
}

globalThis.NODE_GRAPH_STURMIAN_GRID_DISPLAY_DEFAULTS = NODE_GRAPH_STURMIAN_GRID_DISPLAY_DEFAULTS;
globalThis.normalizeNodeGraphSturmianGridFaceSettings = normalizeNodeGraphSturmianGridFaceSettings;
globalThis.nodeGraphSturmianGridDisplaySettingsForNode = nodeGraphSturmianGridDisplaySettingsForNode;
globalThis.buildNodeGraphSturmianGridDisplaySettingsBodyHtml = buildNodeGraphSturmianGridDisplaySettingsBodyHtml;
globalThis.syncNodeGraphSturmianGridDisplaySettingsControls = syncNodeGraphSturmianGridDisplaySettingsControls;
globalThis.bindNodeGraphSturmianGridDisplaySettingsBody = bindNodeGraphSturmianGridDisplaySettingsBody;
globalThis.readNodeGraphSturmianGridDisplaySettingsForm = readNodeGraphSturmianGridDisplaySettingsForm;
globalThis.applyNodeGraphSturmianGridDisplaySettingsToFace = applyNodeGraphSturmianGridDisplaySettingsToFace;
