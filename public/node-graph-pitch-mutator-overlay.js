// Pitch Mutator first-slice overlay, binding, and live hooks.
// Horizontal docked editor. Bindings are rings and chips, never cables.

(function (root) {
  const COLORS = Object.freeze([
    "#c45a7a", "#d9983a", "#6caf5a", "#3aa0c7",
    "#7a6ad9", "#d35cc7", "#d14b4b", "#c7b14a",
  ]);

  const ui = {
    open: false,
    selectedId: "",
    auditionNote: 60,
    ccInjected: false,
    navHooked: false,
    raf: 0,
    pan: null,
    pointers: new Map(),
    suppressKeyClick: false,
    viewSaveTimer: 0,
  };

  function engine() {
    return root.PitchMutatorEngine || null;
  }

  function patch() {
    return root.nodeGraphMvp && root.nodeGraphMvp.patch;
  }

  function mutatorNodes() {
    const p = patch();
    return (p && Array.isArray(p.nodes) ? p.nodes : []).filter((n) => n && n.type === "pitchMutator");
  }

  function nodeById(id) {
    const p = patch();
    return (p && p.nodes ? p.nodes : []).find((n) => n && n.id === String(id || "")) || null;
  }

  function ensureState(node) {
    const E = engine();
    if (!node || node.type !== "pitchMutator" || !E) return null;
    node.mutator = E.normalizeMutatorState(node.mutator);
    node.color = E.normalizeColor(node.color);
    return node.mutator;
  }

  function selectedNode() {
    const nodes = mutatorNodes();
    if (!nodes.length) return null;
    let node = nodes.find((n) => n.id === ui.selectedId) || nodes[0];
    ui.selectedId = node.id;
    ensureState(node);
    return node;
  }

  function titleOf(node) {
    if (typeof root.nodeGraphPatchNodeTitle === "function") {
      return root.nodeGraphPatchNodeTitle(node);
    }
    return (node && node.alias) || (engine() && engine().DEFAULT_NAME) || "Pitch Mutator";
  }

  function soundingNote(node) {
    const E = engine();
    const snap = !!(node && node.mutator && node.mutator.snap);
    const x = E ? E.snapNote(ui.auditionNote, snap) : ui.auditionNote;
    return x;
  }

  function paramMeta(target) {
    const node = target && nodeById(target.nodeId);
    if (!node) return { min: 0, max: 1 };
    if (typeof root.nodeGraphReadPatchParameterMetadata === "function") {
      return root.nodeGraphReadPatchParameterMetadata(node, target.paramKey) || { min: 0, max: 1 };
    }
    return (node.paramMeta && node.paramMeta[target.paramKey]) || { min: 0, max: 1 };
  }

  function baseDomain(target) {
    const node = target && nodeById(target.nodeId);
    if (!node) return 0;
    if (typeof root.nodeGraphReadPatchParameterValue === "function") {
      const v = root.nodeGraphReadPatchParameterValue(node, target.paramKey);
      if (Number.isFinite(v)) return v;
    }
    const v = Number(node.params && node.params[target.paramKey]);
    return Number.isFinite(v) ? v : 0;
  }

  function isDiscreteMeta(meta) {
    if (!meta) return false;
    if (Array.isArray(meta.choices) && meta.choices.length) return true;
    const step = Number(meta.step);
    return Number.isFinite(step) && step >= 1;
  }

  function offsetAt(node, lane, x) {
    const E = engine();
    if (!E || !lane) return 0;
    const baked = E.bakeOffsetLane(lane);
    const off = E.lookupOffset(baked.table, x, baked.valid);
    return off == null ? 0 : off;
  }

  function freqAt(node, x) {
    const E = engine();
    if (!E || !node) return null;
    const baked = E.bakeFreqLane(node.mutator && node.mutator.freqLane);
    return E.lookupFreqHz(baked.table, x, baked.valid);
  }

  function setAuditionNote(note) {
    const E = engine();
    if (!E || !Number.isFinite(Number(note))) return;
    ui.auditionNote = Number(note);
    const node = selectedNode();
    if (node) {
      if (!node.params) node.params = {};
      node.params.playheadHz = E.hzFromNote(ui.auditionNote);
      if (typeof root.scheduleNodeGraphLiveParameterSync === "function") {
        root.scheduleNodeGraphLiveParameterSync();
      }
    }
    renderOverlay();
    refreshRings();
  }

  function recordChange(status) {
    if (typeof root.markNodeGraphRenderPending === "function") root.markNodeGraphRenderPending();
    if (typeof root.scheduleNodeGraphLiveParameterSync === "function") {
      root.scheduleNodeGraphLiveParameterSync();
    }
    if (typeof root.scheduleNodeGraphWorkspaceAutosave === "function") {
      root.scheduleNodeGraphWorkspaceAutosave(status || "Mutator changed");
    }
  }

  function pinActiveLane() {
    const E = engine();
    const node = selectedNode();
    if (!E || !node) return;
    const state = ensureState(node);
    const x = soundingNote(node);
    if (!Number.isFinite(x)) return;
    const active = state.activeLane || "freq";
    if (active === "freq") {
      let hz = freqAt(node, x);
      if (!(hz > 0)) hz = E.hzFromNote(x);
      state.freqLane.keys = E.pinKey(state.freqLane.keys, x, "hz", hz, state.snap);
    } else {
      const lane = state.lanes.find((l) => l.id === active);
      if (!lane) return;
      const meta = paramMeta(lane.target);
      const baseSlider = E.sliderFromDomain(meta, baseDomain(lane.target));
      const current = document.querySelector(
        '[data-node="' + lane.target.nodeId + '"][data-param="' + lane.target.paramKey + '"]',
      );
      let finalSlider = baseSlider + offsetAt(node, lane, x);
      if (current && typeof root.nodeSliderTravelFromValue === "function") {
        const shown = Number(current.dataset.domainValue || current.value);
        if (Number.isFinite(shown)) finalSlider = E.sliderFromDomain(meta, shown);
      }
      const offset = finalSlider - baseSlider;
      lane.keys = E.pinKey(lane.keys, x, "offset", offset, state.snap);
      lane.discrete = isDiscreteMeta(meta);
    }
    recordChange("Pin Keyframe");
    renderOverlay();
    refreshRings();
  }

  function bindKnob(nodeId, paramKey) {
    const E = engine();
    const node = selectedNode();
    if (!E || !node || !node.mutator || !nodeId || !paramKey) return null;
    if (node.id === nodeId) return null;
    const state = ensureState(node);
    const existing = state.lanes.find((l) => l.target.nodeId === nodeId && l.target.paramKey === paramKey);
    if (existing) return existing;
    if (state.lanes.length) return state.lanes[0];
    const meta = paramMeta({ nodeId, paramKey });
    const lane = {
      id: "L1",
      target: { nodeId, paramKey },
      keys: [],
      discrete: isDiscreteMeta(meta),
    };
    state.lanes.push(lane);
    state.activeLane = lane.id;
    recordChange("Bind Mutator knob");
    return lane;
  }

  function isArmed() {
    const node = selectedNode();
    return !!(ui.open && node && node._mutatorArmed);
  }

  function boundLaneFor(nodeId, paramKey) {
    for (const node of mutatorNodes()) {
      const state = ensureState(node);
      if (!state) continue;
      const lane = (state.lanes || []).find((l) => l.target.nodeId === nodeId && l.target.paramKey === paramKey);
      if (lane) return { node, lane };
    }
    return null;
  }

  function applySliderIntercept(slider, domainValue, options) {
    const E = engine();
    if (!E || !slider) return false;
    const nodeId = String(slider.dataset.node || "").trim();
    const paramKey = String(slider.dataset.param || "").trim();
    if (!nodeId || !paramKey) return false;

    let bound = boundLaneFor(nodeId, paramKey);
    if (!bound && isArmed()) {
      const lane = bindKnob(nodeId, paramKey);
      if (lane) bound = { node: selectedNode(), lane };
    }
    if (!bound) return false;

    const { node, lane } = bound;
    const state = ensureState(node);
    const meta = paramMeta(lane.target);
    const baseSlider = E.sliderFromDomain(meta, baseDomain(lane.target));
    const nextSlider = E.sliderFromDomain(meta, domainValue);
    const x = soundingNote(node);
    const pinNow = state.autoPin && Number.isFinite(x);
    if (pinNow) {
      const offset = nextSlider - baseSlider;
      lane.keys = E.pinKey(lane.keys, x, "offset", offset, state.snap);
      lane.discrete = isDiscreteMeta(meta);
    } else if (lane.keys.length) {
      const currentOff = offsetAt(node, lane, x);
      const currentFinal = E.finalSlider(baseSlider, currentOff, meta);
      const delta = nextSlider - currentFinal;
      lane.keys = E.shiftOffsets(lane.keys, delta, meta);
    } else {
      return false;
    }

    const off = offsetAt(node, lane, x);
    const final = E.domainFromSlider(meta, E.finalSlider(baseSlider, off, meta));
    slider.dataset.domainValue = String(final);
    slider.value = String(final);
    if (options && options.commit) recordChange("Mutator lane");
    else recordChange();
    renderOverlay();
    refreshRings();
    return true;
  }

  function applyLiveParams(sourceNode, params) {
    const E = engine();
    if (!E || !params) return;
    if (sourceNode && sourceNode.type === "pitchMutator") {
      const state = ensureState(sourceNode);
      const baked = E.bakeFreqLane(state.freqLane);
      params.playheadHz = Number(sourceNode.params && sourceNode.params.playheadHz);
      if (!Number.isFinite(params.playheadHz)) params.playheadHz = E.hzFromNote(ui.auditionNote);
      sourceNode._mutatorFreqLut = baked;
      return;
    }
    const x = ui.auditionNote;
    const offsets = [];
    for (const node of mutatorNodes()) {
      const state = ensureState(node);
      if (!state) continue;
      for (const lane of state.lanes || []) {
        if (lane.target.nodeId !== sourceNode.id) continue;
        if (!(lane.target.paramKey in params)) continue;
        offsets.push({ key: lane.target.paramKey, meta: paramMeta(lane.target), offset: offsetAt(node, lane, soundingNote(node) || x), discrete: lane.discrete });
      }
    }
    const byKey = {};
    for (const item of offsets) {
      (byKey[item.key] || (byKey[item.key] = [])).push(item);
    }
    for (const key of Object.keys(byKey)) {
      const meta = byKey[key][0].meta;
      const baseSlider = E.sliderFromDomain(meta, params[key]);
      const sum = byKey[key].map((item) => item.offset);
      params[key] = E.domainFromSlider(meta, E.finalSlider(baseSlider, sum, meta));
    }
  }

  function applyToBase(node, key, base, metadata) {
    const E = engine();
    if (!E || !node || !key) return base;
    const offsets = [];
    for (const mut of mutatorNodes()) {
      const state = ensureState(mut);
      if (!state) continue;
      for (const lane of state.lanes || []) {
        if (lane.target.nodeId === node.id && lane.target.paramKey === key) {
          offsets.push(offsetAt(mut, lane, soundingNote(mut)));
        }
      }
    }
    if (!offsets.length) return base;
    const meta = metadata || paramMeta({ nodeId: node.id, paramKey: key });
    const finalSlider = E.finalSlider(E.sliderFromDomain(meta, base), offsets, meta);
    return E.domainFromSlider(meta, finalSlider);
  }

  function toggleOverlay(force) {
    ui.open = typeof force === "boolean" ? force : !ui.open;
    if (ui.open && !ui.selectedId) {
      const first = mutatorNodes()[0];
      if (first) ui.selectedId = first.id;
    }
    renderOverlay();
    refreshNav();
  }

  function ensureCss() {
    if (document.getElementById("pitchMutatorOverlayCss")) return;
    const link = document.createElement("link");
    link.id = "pitchMutatorOverlayCss";
    link.rel = "stylesheet";
    link.href = "./public/node-graph-pitch-mutator.css?v=mutator-slice-4";
    document.head.append(link);
  }

  function ensureOverlay() {
    ensureCss();
    let el = document.getElementById("pitchMutatorOverlay");
    if (el) return el;
    el = document.createElement("div");
    el.id = "pitchMutatorOverlay";
    el.hidden = true;
    document.body.append(el);
    el.addEventListener("click", onOverlayClick);
    el.addEventListener("input", onOverlayInput);
    el.addEventListener("change", onOverlayInput);
    el.addEventListener("scroll", onAxisScroll, true);
    el.addEventListener("wheel", onAxisWheel, { passive: false });
    el.addEventListener("pointerdown", onAxisPointerDown);
    el.addEventListener("pointermove", onAxisPointerMove);
    el.addEventListener("pointerup", onAxisPointerUp);
    el.addEventListener("pointercancel", onAxisPointerUp);
    return el;
  }

  function midiName(note) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const n = Math.round(Number(note));
    if (!Number.isFinite(n)) return "";
    const pc = ((n % 12) + 12) % 12;
    const oct = Math.floor(n / 12) - 1;
    return names[pc] + oct;
  }

  function isBlack(note) {
    const pc = ((Math.round(note) % 12) + 12) % 12;
    return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
  }


  function midiRange() {
    const E = engine();
    return (E && E.MIDI_RANGE) || { min: 0, max: 127 };
  }

  function noteCount() {
    const r = midiRange();
    return r.max - r.min + 1;
  }

  function viewOf(state) {
    const E = engine();
    if (E) return E.clampView(state || {});
    return { start: 12, visible: 97 };
  }

  function viewReadout(view) {
    return midiName(view.start) + "–" + midiName(view.start + view.visible - 1);
  }

  function persistViewSoon() {
    if (ui.viewSaveTimer) root.clearTimeout(ui.viewSaveTimer);
    ui.viewSaveTimer = root.setTimeout(() => {
      ui.viewSaveTimer = 0;
      recordChange("Mutator view");
    }, 300);
  }

  function applyAxisView(view) {
    const el = document.getElementById("pitchMutatorOverlay");
    if (!el || !view) return;
    el.style.setProperty("--pm-visible", String(view.visible));
    el.style.setProperty("--pm-key-count", String(noteCount()));
    const scroller = el.querySelector("[data-pm=axis]");
    if (scroller && scroller.clientWidth > 0) {
      const sl = view.start * (scroller.clientWidth / view.visible);
      if (Math.abs(scroller.scrollLeft - sl) > 0.5) scroller.scrollLeft = sl;
    }
    const readout = el.querySelector("[data-pm=view-readout]");
    if (readout) readout.textContent = viewReadout(view);
    const count = el.querySelector("[data-pm=visible-count]");
    if (count) count.textContent = String(view.visible);
    const slider = el.querySelector('[data-pm="visible"]');
    if (slider && Number(slider.value) !== view.visible) slider.value = String(view.visible);
  }

  function setAxisView(node, next, persist) {
    const state = ensureState(node);
    const E = engine();
    if (!state || !E) return null;
    const view = E.clampView(next);
    state.viewStart = view.start;
    state.visibleKeys = view.visible;
    applyAxisView(view);
    const plot = document.querySelector("#pitchMutatorOverlay [data-pm=plot]");
    if (plot) drawPlot(plot, node);
    if (persist) persistViewSoon();
    return view;
  }

  function onAxisScroll(event) {
    const scroller = event.target;
    if (!scroller || scroller.getAttribute("data-pm") !== "axis") return;
    const node = selectedNode();
    const state = node && ensureState(node);
    const E = engine();
    if (!state || !E || !(scroller.clientWidth > 0)) return;
    const start = Math.round(scroller.scrollLeft / (scroller.clientWidth / state.visibleKeys));
    const view = E.clampView({ start: start, visible: state.visibleKeys });
    if (view.start !== state.viewStart) {
      state.viewStart = view.start;
      const readout = document.querySelector("#pitchMutatorOverlay [data-pm=view-readout]");
      if (readout) readout.textContent = viewReadout(view);
      persistViewSoon();
    }
  }

  function onAxisWheel(event) {
    const axis = event.target.closest("[data-pm=axis]");
    if (!axis) return;
    const node = selectedNode();
    const state = node && ensureState(node);
    if (!state) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = axis.getBoundingClientRect();
      const noteAtCursor = state.viewStart + ((event.clientX - rect.left) / Math.max(1, rect.width)) * state.visibleKeys;
      const nextVisible = Math.round(state.visibleKeys * (event.deltaY > 0 ? 1.12 : 0.88));
      setAxisView(node, {
        visible: nextVisible,
        start: noteAtCursor - ((event.clientX - rect.left) / Math.max(1, rect.width)) * nextVisible,
      }, true);
      return;
    }
    if (event.deltaX || event.deltaY) {
      event.preventDefault();
      axis.scrollLeft += (event.deltaX || event.deltaY);
    }
  }

  function onAxisPointerDown(event) {
    const axis = event.target.closest("[data-pm=axis]");
    if (!axis) return;
    ui.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, axis: axis });
    if (ui.pointers.size === 2) {
      const pts = [...ui.pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const node = selectedNode();
      const state = node && ensureState(node);
      ui.pan = {
        kind: "pinch",
        axis: axis,
        dist0: dist || 1,
        visible0: state ? state.visibleKeys : 97,
        midNote: state ? state.viewStart + state.visibleKeys / 2 : 60,
      };
      ui.suppressKeyClick = true;
      return;
    }
    if (event.target.closest("[data-pm=key]")) {
      ui.pan = { kind: "maybe-key", pointerId: event.pointerId, x: event.clientX, scroll0: axis.scrollLeft, axis: axis };
      return;
    }
    if (!event.target.closest(".pm-plot-wrap") && !event.target.closest(".pm-kbd")) return;
    event.preventDefault();
    try { axis.setPointerCapture(event.pointerId); } catch (err) {}
    ui.pan = { kind: "pan", pointerId: event.pointerId, x: event.clientX, scroll0: axis.scrollLeft, axis: axis };
  }

  function onAxisPointerMove(event) {
    if (ui.pointers.has(event.pointerId)) {
      ui.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, axis: event.target.closest("[data-pm=axis]") });
    }
    if (ui.pan && ui.pan.kind === "pinch" && ui.pointers.size >= 2) {
      const pts = [...ui.pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const node = selectedNode();
      if (!node || !(ui.pan.dist0 > 0)) return;
      const nextVisible = Math.round(ui.pan.visible0 * (ui.pan.dist0 / Math.max(dist, 1)));
      setAxisView(node, { visible: nextVisible, start: ui.pan.midNote - nextVisible / 2 }, false);
      return;
    }
    if (!ui.pan || ui.pan.pointerId !== event.pointerId) return;
    const dx = event.clientX - ui.pan.x;
    if (ui.pan.kind === "maybe-key") {
      if (Math.abs(dx) < 8) return;
      ui.pan.kind = "pan";
      ui.suppressKeyClick = true;
    }
    if (ui.pan.kind === "pan") {
      ui.pan.axis.scrollLeft = ui.pan.scroll0 - dx;
    }
  }

  function onAxisPointerUp(event) {
    ui.pointers.delete(event.pointerId);
    if (ui.pan && ui.pan.kind === "pinch") {
      if (ui.pointers.size < 2) {
        persistViewSoon();
        ui.pan = null;
      }
      return;
    }
    if (ui.pan && ui.pan.pointerId === event.pointerId) {
      if (ui.pan.kind === "pan") persistViewSoon();
      ui.pan = null;
    }
    if (ui.pointers.size === 0) {
      root.setTimeout(() => { ui.suppressKeyClick = false; }, 0);
    }
  }

  function drawPlot(svg, node) {
    const E = engine();
    if (!E || !svg) return;
    const state = node && ensureState(node);
    const range = midiRange();
    const count = range.max - range.min + 1;
    const wrap = svg.parentElement;
    const cssW = Math.max(1, (wrap && wrap.clientWidth) || svg.clientWidth || 128);
    const cssH = Math.max(1, (wrap && wrap.clientHeight) || svg.clientHeight || 80);
    const dpr = Math.max(1, root.devicePixelRatio || 1);
    const snap = (x) => Math.round(x * dpr) / dpr;
    const hair = 1 / dpr;
    svg.setAttribute("viewBox", "0 0 " + cssW + " " + cssH);
    svg.setAttribute("width", String(cssW));
    svg.setAttribute("height", String(cssH));
    svg.setAttribute("preserveAspectRatio", "none");
    const colW = cssW / count;
    const xCenter = (note) => (note - range.min + 0.5) * colW;
    const xLeft = (note) => (note - range.min) * colW;
    const parts = [];
    for (let n = range.min; n <= range.max; n++) {
      if (!isBlack(n)) continue;
      const x = snap(xLeft(n));
      const w = Math.max(hair, snap(xLeft(n + 1)) - x);
      parts.push('<rect x="' + x + '" y="0" width="' + w + '" height="' + cssH + '" fill="#ffffff" opacity="0.045" shape-rendering="crispEdges"/>');
    }
    for (let n = range.min; n <= range.max; n++) {
      if (n % 12 !== 0) continue;
      const x = snap(xLeft(n));
      parts.push('<line x1="' + x + '" x2="' + x + '" y1="0" y2="' + cssH + '" stroke="#ffffff" stroke-width="' + hair + '" opacity="0.12" shape-rendering="crispEdges" vector-effect="non-scaling-stroke"/>');
    }
    const drawLane = (xs, ys, color, faint) => {
      if (!xs.length) return;
      let d = "";
      for (let i = 0; i < xs.length; i++) {
        d += (i ? " L " : "M ") + xs[i].toFixed(2) + " " + ys[i].toFixed(2);
      }
      parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (faint ? 1 : 1.5) + '" opacity="' + (faint ? "0.35" : "1") + '" vector-effect="non-scaling-stroke"/>');
    };
    const freqBake = state ? E.bakeFreqLane(state.freqLane) : { valid: false };
    if (freqBake.valid) {
      const minHz = E.hzFromNote(range.min);
      const maxHz = E.hzFromNote(range.max);
      const ys = [];
      const xs = [];
      for (let n = range.min; n <= range.max; n++) {
        const hz = E.lookupFreqHz(freqBake.table, n, true) || minHz;
        const t = (E.log2Hz(hz) - E.log2Hz(minHz)) / (E.log2Hz(maxHz) - E.log2Hz(minHz));
        xs.push(xCenter(n));
        ys.push((1 - Math.min(1, Math.max(0, t))) * (cssH - 6) + 3);
      }
      drawLane(xs, ys, node.color, state.activeLane !== "freq");
    }
    for (const lane of (state && state.lanes) || []) {
      const baked = E.bakeOffsetLane(lane);
      if (!baked.valid) continue;
      const xs = [];
      const ys = [];
      for (let n = range.min; n <= range.max; n++) {
        const off = E.lookupOffset(baked.table, n, true) || 0;
        const t = (off + 1) * 0.5;
        xs.push(xCenter(n));
        ys.push((1 - Math.min(1, Math.max(0, t))) * (cssH - 6) + 3);
      }
      drawLane(xs, ys, node.color, state.activeLane !== lane.id);
    }
    const px = snap(xCenter(soundingNote(node)));
    parts.push('<line x1="' + px + '" x2="' + px + '" y1="0" y2="' + cssH + '" stroke="#fff" stroke-width="' + hair + '" opacity="0.7" shape-rendering="crispEdges" vector-effect="non-scaling-stroke"/>');
    svg.innerHTML = parts.join("");
  }

  function renderOverlay() {
    const el = ensureOverlay();
    const node = selectedNode();
    el.hidden = !ui.open;
    if (!ui.open) return;
    const E = engine();
    const color = (node && node.color) || (E && E.DEFAULT_COLOR) || "#c45a7a";
    el.style.setProperty("--pitch-mutator-color", color);
    const nodes = mutatorNodes();
    const state = node ? ensureState(node) : null;
    const tabs = nodes.map((n) => (
      '<button type="button" class="pm-tab' + (n.id === (node && node.id) ? " active" : "") + '" data-pm="tab" data-id="' + n.id + '">' +
      escapeHtml(titleOf(n)) + "</button>"
    )).join("") || '<span>Add a Pitch Mutator module to the canvas.</span>';
    const swatches = COLORS.map((c) => (
      '<button type="button" class="pm-swatch' + (c === color ? " active" : "") + '" data-pm="color" data-color="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '"></button>'
    )).join("");
    const lanes = [];
    lanes.push(
      '<button type="button" class="pm-lane-btn' + (state && state.activeLane === "freq" ? " active" : "") + '" data-pm="lane" data-lane="freq">Frequency</button>'
    );
    if (state) {
      for (const lane of state.lanes) {
        const targetNode = nodeById(lane.target.nodeId);
        const label = (targetNode ? titleOf(targetNode) : lane.target.nodeId) + " / " + lane.target.paramKey;
        lanes.push(
          '<button type="button" class="pm-chip' + (state.activeLane === lane.id ? " active" : "") + '" data-pm="lane" data-lane="' + lane.id + '">' +
          '<span class="pm-chip-dot"></span>' + escapeHtml(label) + "</button>"
        );
      }
    }
    const range = E ? (E.MIDI_RANGE || E.KEYBOARD_SPAN) : { min: 0, max: 127 };
    const view = state ? viewOf(state) : viewOf(null);
    let kbd = "";
    for (let n = range.min; n <= range.max; n++) {
      const on = Math.round(ui.auditionNote) === n;
      kbd += '<button type="button" class="pm-key' + (isBlack(n) ? " black" : "") + (on ? " audition" : "") + '" data-pm="key" data-note="' + n + '">' +
        (n % 12 === 0 ? midiName(n) : "") + "</button>";
    }
    const x = node ? soundingNote(node) : ui.auditionNote;
    const freq = node ? freqAt(node, x) : null;
    const activeLane = state && state.activeLane !== "freq"
      ? (state.lanes || []).find((l) => l.id === state.activeLane)
      : null;
    const hzValue = freq && freq > 0 ? freq.toFixed(2) : "";
    const offValue = activeLane ? String(offsetAt(node, activeLane, x).toFixed(3)) : "";
    el.innerHTML = [
      '<div class="pm-overlay-chrome">',
        '<span class="pm-overlay-title">Mutators</span>',
        '<div class="pm-tabs">' + tabs + "</div>",
        node ? ('<input class="pm-name" data-pm="name" maxlength="48" value="' + escapeAttr(titleOf(node)) + '">') : "",
        '<span>' + swatches + "</span>",
        '<button type="button" class="pm-btn" data-pm="close">Close</button>',
      "</div>",
      '<div class="pm-tools">',
        '<button type="button" class="pm-btn" data-pm="arm" aria-pressed="' + (node && node._mutatorArmed ? "true" : "false") + '">Arm</button>',
        '<button type="button" class="pm-btn" data-pm="pin">Pin Keyframe</button>',
        '<button type="button" class="pm-btn" data-pm="autopin" aria-pressed="' + (state && state.autoPin ? "true" : "false") + '">Auto-Pin</button>',
        '<button type="button" class="pm-btn" data-pm="snap" aria-pressed="' + (state && state.snap ? "true" : "false") + '">Snap</button>',
        '<div class="pm-view">',
          "<label>Keys <input type=\"range\" data-pm=\"visible\" min=\"12\" max=\"128\" step=\"1\" value=\"" + view.visible + "\"><span data-pm=\"visible-count\">" + view.visible + "</span></label>",
          '<span class="pm-view-readout" data-pm="view-readout">' + escapeHtml(viewReadout(view)) + "</span>",
          '<button type="button" class="pm-btn" data-pm="view-c0c8">C0–C8</button>',
          '<button type="button" class="pm-btn" data-pm="view-c1c7">C1–C7</button>',
          '<button type="button" class="pm-btn" data-pm="view-all">0–127</button>',
        "</div>",
      "</div>",
      '<div class="pm-body">',
        '<div class="pm-lanes">',
          lanes.join(""),
        "</div>",
        '<div class="pm-axis-scroll" data-pm="axis">',
          '<div class="pm-axis-inner">',
            '<div class="pm-plot-wrap"><svg data-pm="plot"></svg></div>',
            '<div class="pm-kbd">' + kbd + "</div>",
          "</div>",
        "</div>",
        '<div class="pm-side">',
          "<div>Playhead " + escapeHtml(midiName(x)) + " (" + (Number.isFinite(x) ? x.toFixed(2) : "") + ")</div>",
          state && state.activeLane === "freq"
            ? '<label>Frequency Hz<input type="number" data-pm="hz" min="0" step="any" value="' + escapeAttr(hzValue) + '"></label>'
            : (activeLane ? '<label>Offset<input type="number" data-pm="offset" step="0.001" value="' + escapeAttr(offValue) + '"></label>' : "<div>Select a lane.</div>"),
          "<div>Wire Freq Out into a FREQUENCY input. Arm, then turn one knob to bind.</div>",
        "</div>",
      "</div>",
    ].join("");
    el.style.setProperty("--pm-visible", String(view.visible));
    el.style.setProperty("--pm-key-count", String(range.max - range.min + 1));
    drawPlot(el.querySelector("[data-pm=plot]"), node);
    applyAxisView(view);
    root.requestAnimationFrame(() => {
      applyAxisView(view);
      const plot = el.querySelector("[data-pm=plot]");
      if (plot) drawPlot(plot, node);
    });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function onOverlayClick(event) {
    const btn = event.target.closest("[data-pm]");
    if (!btn) return;
    const act = btn.getAttribute("data-pm");
    const node = selectedNode();
    if (act === "close") return toggleOverlay(false);
    if (act === "tab") {
      ui.selectedId = btn.getAttribute("data-id") || "";
      return renderOverlay();
    }
    if (act === "color" && node) {
      node.color = engine().normalizeColor(btn.getAttribute("data-color"));
      recordChange("Mutator color");
      return renderOverlay();
    }
    if (act === "arm" && node) {
      node._mutatorArmed = !node._mutatorArmed;
      return renderOverlay();
    }
    if (act === "pin") return pinActiveLane();
    if (act === "autopin" && node) {
      node.mutator.autoPin = !node.mutator.autoPin;
      recordChange();
      return renderOverlay();
    }
    if (act === "snap" && node) {
      node.mutator.snap = !node.mutator.snap;
      recordChange();
      return renderOverlay();
    }
    if (act === "lane" && node) {
      node.mutator.activeLane = btn.getAttribute("data-lane") || "freq";
      return renderOverlay();
    }
    if (act === "key") {
      if (ui.suppressKeyClick) return;
      setAuditionNote(Number(btn.getAttribute("data-note")));
    }
    if (act === "view-c0c8" && node) setAxisView(node, { start: 12, visible: 97 }, true);
    if (act === "view-c1c7" && node) setAxisView(node, { start: 24, visible: 73 }, true);
    if (act === "view-all" && node) setAxisView(node, { start: 0, visible: 128 }, true);
  }

  function onOverlayInput(event) {
    const el = event.target.closest("[data-pm]");
    if (!el) return;
    const act = el.getAttribute("data-pm");
    const node = selectedNode();
    const E = engine();
    if (!node || !E) return;
    if (act === "name") {
      if (typeof root.commitNodeGraphModuleTitleFromHeaderInput === "function") {
        root.commitNodeGraphModuleTitleFromHeaderInput(node.id, el.value);
      } else {
        node.alias = el.value;
      }
      renderOverlay();
      return;
    }
    if (act === "hz") {
      const hz = Number(el.value);
      if (!(hz > 0)) return;
      const state = ensureState(node);
      const x = soundingNote(node);
      if (event.type === "change" || state.autoPin) {
        if (state.autoPin || event.type === "change") {
          if (state.freqLane.keys.length && !state.autoPin) {
            const cur = freqAt(node, x);
            if (cur > 0) state.freqLane.keys = E.shiftFreqKeysLog(state.freqLane.keys, E.log2Hz(hz) - E.log2Hz(cur));
          } else {
            state.freqLane.keys = E.pinKey(state.freqLane.keys, x, "hz", hz, state.snap);
          }
          recordChange("Frequency lane");
          renderOverlay();
        }
      }
    }
    if (act === "visible") {
      const nextVisible = Number(el.value);
      if (!Number.isFinite(nextVisible)) return;
      const viewState = ensureState(node);
      const center = viewState.viewStart + (viewState.visibleKeys - 1) / 2;
      setAxisView(node, { visible: nextVisible, start: center - (nextVisible - 1) / 2 }, event.type === "change");
      return;
    }
    if (act === "offset") {
      const next = Number(el.value);
      if (!Number.isFinite(next)) return;
      const state = ensureState(node);
      const lane = (state.lanes || []).find((l) => l.id === state.activeLane);
      if (!lane) return;
      const x = soundingNote(node);
      const cur = offsetAt(node, lane, x);
      const meta = paramMeta(lane.target);
      if (state.autoPin || event.type === "change") {
        if (lane.keys.length && !state.autoPin) lane.keys = E.shiftOffsets(lane.keys, next - cur, meta);
        else lane.keys = E.pinKey(lane.keys, x, "offset", next, state.snap);
        recordChange("Knob lane");
        renderOverlay();
        refreshRings();
      }
    }
  }

  function refreshRings() {
    document.querySelectorAll(".pitch-mutator-knob-ring").forEach((el) => {
      el.classList.remove("pitch-mutator-knob-ring");
      el.style.removeProperty("--pitch-mutator-color");
    });
    for (const node of mutatorNodes()) {
      const state = ensureState(node);
      if (!state) continue;
      for (const lane of state.lanes || []) {
        const sliders = document.querySelectorAll(
          '[data-node="' + lane.target.nodeId + '"][data-param="' + lane.target.paramKey + '"]',
        );
        sliders.forEach((el) => {
          const host = el.closest(".node-slider, .node-knob, .module-param, .node-graph-slider") || el;
          host.classList.add("pitch-mutator-knob-ring");
          host.style.setProperty("--pitch-mutator-color", node.color);
        });
      }
    }
  }

  function injectCommandCenter() {
    if (ui.ccInjected) {
      const existing = document.getElementById("pitchMutatorCcToggle");
      if (existing) return;
    }
    const menu = document.getElementById("nodeSceneContextMenu");
    if (!menu) return;
    const heading = menu.querySelector(".scene-context-heading");
    const bar = document.createElement("div");
    bar.id = "pitchMutatorCcToggle";
    bar.className = "pitch-mutator-cc-toggle";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pm-btn";
    btn.id = "pitchMutatorCcButton";
    btn.textContent = "Mutators";
    btn.setAttribute("aria-pressed", ui.open ? "true" : "false");
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleOverlay();
    });
    bar.append(btn);
    if (heading && heading.nextSibling) heading.parentNode.insertBefore(bar, heading.nextSibling.nextSibling || heading.nextSibling);
    else menu.prepend(bar);
    ui.ccInjected = true;
  }

  function hookNav() {
    if (ui.navHooked) return;
    const orig = root.buildNodeGraphUnifiedWindowNav;
    if (typeof orig !== "function") return;
    ui.navHooked = true;
    root.buildNodeGraphUnifiedWindowNav = function (activePage) {
      const nav = orig(activePage);
      if (!nav) return nav;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "node-unified-window-nav-button";
      button.dataset.unifiedAction = "mutators";
      button.setAttribute("aria-label", "Mutators");
      button.setAttribute("aria-pressed", ui.open ? "true" : "false");
      if (ui.open) button.classList.add("active");
      button.textContent = "Mutators";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleOverlay();
      });
      nav.append(button);
      return nav;
    };
    if (typeof root.syncNodeGraphUnifiedWindowNavBars === "function") {
      root.syncNodeGraphUnifiedWindowNavBars();
    }
  }

  function refreshNav() {
    document.querySelectorAll('[data-unified-action="mutators"]').forEach((btn) => {
      btn.classList.toggle("active", ui.open);
      btn.setAttribute("aria-pressed", ui.open ? "true" : "false");
    });
    const cc = document.getElementById("pitchMutatorCcButton");
    if (cc) cc.setAttribute("aria-pressed", ui.open ? "true" : "false");
  }

  function hookMidiKeyboard() {
    const orig = root.sendNodeGraphLiveMidiKeyboardSignal;
    if (typeof orig !== "function" || orig._pitchMutatorHooked) return;
    function wrapped(signal) {
      const note = Number(signal && (signal.note ?? signal.pitch ?? signal.midiNote));
      if (Number.isFinite(note)) ui.auditionNote = note;
      const hz = Number(signal && (signal.hz ?? signal.frequency));
      const E = engine();
      if (E && hz > 0) ui.auditionNote = E.noteFromHz(hz);
      if (ui.open) renderOverlay();
      return orig.apply(this, arguments);
    }
    wrapped._pitchMutatorHooked = true;
    root.sendNodeGraphLiveMidiKeyboardSignal = wrapped;
  }

  function tick() {
    injectCommandCenter();
    hookNav();
    hookMidiKeyboard();
    if (ui.open) {
      const el = document.getElementById("pitchMutatorOverlay");
      if (el && !el.hidden) {
        const plot = el.querySelector("[data-pm=plot]");
        if (plot) drawPlot(plot, selectedNode());
      }
    }
    refreshRings();
    ui.raf = root.requestAnimationFrame(tick);
  }

  root.togglePitchMutatorOverlay = toggleOverlay;
  root.pitchMutatorApplyLiveParams = applyLiveParams;
  root.pitchMutatorApplyToBase = applyToBase;
  root.pitchMutatorMaybeInterceptSlider = applySliderIntercept;
  root.pitchMutatorRefreshOverlay = renderOverlay;
  root.pitchMutatorFreqLutForNode = function (node) {
    const E = engine();
    if (!E || !node) return null;
    return E.bakeFreqLane((ensureState(node) || {}).freqLane);
  };

  function boot() {
    ensureCss();
    ensureOverlay();
    injectCommandCenter();
    hookNav();
    hookMidiKeyboard();
    if (!ui.raf) ui.raf = root.requestAnimationFrame(tick);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
