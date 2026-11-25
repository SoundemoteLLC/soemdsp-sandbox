// Pitch Mutator first-slice overlay, binding, and live hooks.
// Horizontal docked editor. Bindings are rings and chips, never cables.

(function (root) {
  const COLORS = Object.freeze([
    "#c45a7a", "#d9983a", "#6caf5a", "#3aa0c7",
    "#7a6ad9", "#d35cc7", "#d14b4b", "#c7b14a",
  ]);

  const ONE_LANE_NOTICE = "One knob lane for now";
  const FREQ_DROPPED_NOTICE = "Dropped a Frequency pin. The Pitch Mutator's frequency is not pinnable";
  const FREQ_NOT_PINNABLE = "The Pitch Mutator's frequency cannot be pinned. Bind a knob on another module (Arm, then turn it).";

  const ui = {
    open: false,
    selectedId: "",
    auditionNote: 60,
    navHooked: false,
    raf: 0,
    notice: "",
    // Auto-Pin off: the value a knob turn set at the playhead, not yet pinned. { mut, lane, x, offset } or null.
    pending: null,
    // A pin being dragged: { pointerId, laneId, x, startX, startY, moved, timer }.
    pinDrag: null,
    pinMsg: "",
    // Last frequency each possible Freq In source (keyboard / MIDI module) was heard at, from the signals it sends. Not a poll: set by the send hooks.
    sourceHz: new Map(),
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

  // The state object each node was last normalized into. Normalizing builds new lane objects, so it happens once per state object: a lane
  // handed out by bindKnob stays the one inside node.mutator.lanes.
  const normalizedStates = new WeakMap();

  function ensureState(node) {
    const E = engine();
    if (!node || node.type !== "pitchMutator" || !E) return null;
    if (!node.mutator || normalizedStates.get(node) !== node.mutator) {
      node.mutator = E.normalizeMutatorState(node.mutator);
      normalizedStates.set(node, node.mutator);
      // The Pitch Mutator's own frequency is not pinnable. A patch saved before that rule may hold Frequency pins: drop them once, here,
      // where the state is first normalized for this load or patch. The bound knob lane is not touched.
      if (node.mutator.freqLane.keys.length) {
        node.mutator.freqLane.keys = [];
        ui.notice = FREQ_DROPPED_NOTICE;
      }
      if (node.mutator.lanes.length && node.mutator.activeLane === "freq") node.mutator.activeLane = node.mutator.lanes[0].id;
    }
    node.color = E.normalizeColor(node.color);
    return node.mutator;
  }

  // The module a slider belongs to, the way the app finds it (the .dsp-node article), with dataset.node as a fallback.
  function sliderNodeId(slider) {
    const article = slider && typeof slider.closest === "function" ? slider.closest(".dsp-node") : null;
    const id = (article && article.dataset && article.dataset.node) || (slider && slider.dataset && slider.dataset.node) || "";
    return String(id).trim();
  }

  // The real range input of a parameter, never its port buttons.
  function knobFor(nodeId, paramKey) {
    if (typeof root.nodeGraphSliderForParameter === "function") {
      try {
        const s = root.nodeGraphSliderForParameter(nodeId, paramKey);
        if (s) return s;
      } catch (err) { /* fall through to the DOM query */ }
    }
    return document.querySelector('.dsp-node[data-node="' + nodeId + '"] input[type="range"][data-param="' + paramKey + '"]');
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

  // The module wired into this Mutator's Freq In ("" when nothing is).
  function freqInSourceId(node) {
    const p = patch();
    const cables = p && Array.isArray(p.connections) ? p.connections : [];
    for (const c of cables) {
      if (c && String(c.destinationNode) === String(node && node.id) && String(c.destinationPort) === "f") return String(c.sourceNode);
    }
    return "";
  }

  // Hz arriving on a wired Freq In, as far as the page can know it (the source's last signal); null when unwired or not heard yet.
  function incomingHz(node) {
    if (!node) return null;
    const id = freqInSourceId(node);
    let hz = id ? ui.sourceHz.get(id) : 0;
    if (!(hz > 0) && id) {
      // Not heard since load: the keyboard module may already hold a note.
      const rt = root.nodeGraphMvp && root.nodeGraphMvp.keyboardRuntimeByNode;
      const held = rt instanceof Map ? rt.get(id) : null;
      hz = Number(held && held.signal && held.signal.frequency);
    }
    return hz > 0 ? hz : null;
  }

  // D-M2: a wired Freq In drives the playhead; unwired (or not heard yet) falls back to the audition key.
  function soundingNote(node) {
    const E = engine();
    const snap = !!(node && node.mutator && node.mutator.snap);
    const hz = E ? incomingHz(node) : null;
    const raw = hz ? E.noteFromHz(hz) : ui.auditionNote;
    return E ? E.snapNote(raw, snap) : raw;
  }

  // Hz on Freq Out at note x (D-M3: an empty Frequency lane passes the incoming frequency through, like the native engine).
  function freqOutHz(node, x) {
    const E = engine();
    if (!E || !node) return NaN;
    return E.freqOutHz(E.bakeFreqLane(node.mutator && node.mutator.freqLane), x, incomingHz(node));
  }

  function mutatorsFedBy(sourceId) {
    return mutatorNodes().filter((n) => freqInSourceId(n) === String(sourceId));
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

  // The lane's offset at note x: the pending (unpinned) value when one was set at exactly this note, otherwise the pinned curve.
  function laneOffsetAt(node, lane, x) {
    const pending = ui.pending;
    if (pending && pending.mut === node.id && pending.lane === lane.id && pending.x === x) return pending.offset;
    return offsetAt(node, lane, x);
  }

  // Moving the playhead to another note drops a pending value; the knob goes back to what the lane says there.
  function dropPendingIfMoved() {
    if (!ui.pending) return;
    const node = nodeById(ui.pending.mut);
    if (!node || soundingNote(node) !== ui.pending.x) {
      ui.pending = null;
      ui.pinMsg = "";
    }
  }

  // Redraw work is queued, never looped: one rAF while the overlay is open and something changed, nothing while closed or idle.
  function queueRedraw() {
    if (!ui.open || ui.raf) return;
    ui.raf = root.requestAnimationFrame(() => {
      ui.raf = 0;
      if (!ui.open) return;
      const el = document.getElementById("pitchMutatorOverlay");
      const typing = el && document.activeElement && el.contains(document.activeElement)
        && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (typing) refreshPlayhead();
      else renderOverlay();
    });
  }

  // The playhead moved: key highlight, plot and readouts only. The strip keeps its DOM (a pan in progress holds a key element).
  function refreshPlayhead() {
    const el = document.getElementById("pitchMutatorOverlay");
    const node = selectedNode();
    if (!el || el.hidden || !node) return;
    const x = soundingNote(node);
    const lit = Math.round(x);
    el.querySelectorAll(".pm-key.audition").forEach((k) => k.classList.remove("audition"));
    const key = el.querySelector('.pm-key[data-note="' + lit + '"]');
    if (key) key.classList.add("audition");
    const readout = el.querySelector("[data-pm=playhead]");
    if (readout) readout.textContent = playheadText(node, x);
    const plot = el.querySelector("[data-pm=plot]");
    if (plot) drawPlot(plot, node);
    const state = ensureState(node);
    const field = el.querySelector('[data-pm="hz"]');
    if (field && document.activeElement !== field) field.value = hzText(node, x);
    const statusEl = el.querySelector("[data-pm=status]");
    if (statusEl) statusEl.textContent = statusText(node);
    el.querySelectorAll("[data-pm=chip-value]").forEach((chip) => {
      const l = (state.lanes || []).find((q) => q.id === chip.getAttribute("data-lane"));
      if (l) chip.textContent = laneValueText(node, l, x);
    });
    const off = el.querySelector('[data-pm="offset"]');
    const lane = state && (state.lanes || []).find((l) => l.id === state.activeLane);
    if (off && lane && document.activeElement !== off) off.value = offsetAt(node, lane, x).toFixed(3);
  }

  // The effective value the bound knob has right now, as a short number (the face readout is GL; this is the chip's own copy).
  function laneValueText(node, lane, x) {
    const E = engine();
    if (!E || !lane) return "";
    const meta = paramMeta(lane.target);
    const base = E.sliderFromDomain(meta, baseDomain(lane.target));
    const value = E.domainFromSlider(meta, E.finalSlider(base, laneOffsetAt(node, lane, x), meta));
    return Number.isFinite(value) ? String(Number(value.toPrecision(3))) : "";
  }

  function laneLabel(lane) {
    const targetNode = nodeById(lane.target.nodeId);
    const meta = paramMeta(lane.target);
    return (targetNode ? titleOf(targetNode) : lane.target.nodeId) + " / " + ((meta && meta.label) || lane.target.paramKey);
  }

  // One plain line that says where the knob lane stands. Always visible; no hover text.
  function statusText(node) {
    if (!node) return "Add a Pitch Mutator module to the canvas.";
    const state = ensureState(node);
    if (ui.notice) return ui.notice + ".";
    if (node._mutatorArmed) return "Armed: turn the knob you want to bind.";
    const lane = state && state.lanes && state.lanes[0];
    if (!lane) return "Not armed. Press Arm, then turn the knob you want to control. The Pitch Mutator's frequency cannot be pinned.";
    const parts = ["Bound: " + laneLabel(lane) + "."];
    parts.push(state.autoPin
      ? "Auto-Pin on: each knob turn pins at the playing note."
      : "Play a note, set the knob, then Pin Keyframe.");
    if (ui.pinMsg) parts.push(ui.pinMsg);
    const n = (lane.keys || []).length;
    if (n) parts.push(n + (n === 1 ? " pin: " : " pins: ") + lane.keys.map((k) => midiName(k.x)).join(", ") + ".");
    if (ui.pending) parts.push("Not pinned yet.");
    return parts.join(" ");
  }

  // The Mutators nav button, like the other pages: the DNA emoji. While armed it says so in words beside the emoji; no title / hover text.
  function paintNavButton(button) {
    const node = selectedNode();
    const armed = !!(node && node._mutatorArmed);
    button.setAttribute("aria-label", armed ? "Mutators, armed" : "Mutators");
    button.textContent = "\u{1F9EC}";
    if (armed) {
      const word = document.createElement("span");
      word.className = "pm-nav-armed";
      word.textContent = "armed";
      button.append(word);
    }
  }

  // The bound knob shows what the lane says at the playhead, so it moves with the note. Display only: the stored base value is never written.
  // The face repaints through the existing slider readout path (which calls the GL chrome hook); no GL file is touched.
  function paintBoundKnobs() {
    const E = engine();
    if (!E) return;
    for (const node of mutatorNodes()) {
      const state = ensureState(node);
      const x = soundingNote(node);
      for (const lane of (state && state.lanes) || []) {
        const knob = knobFor(lane.target.nodeId, lane.target.paramKey);
        if (!knob || !knob.dataset) continue;
        const meta = paramMeta(lane.target);
        const base = E.sliderFromDomain(meta, baseDomain(lane.target));
        const final = E.domainFromSlider(meta, E.finalSlider(base, laneOffsetAt(node, lane, x), meta));
        if (!Number.isFinite(final) || Number(knob.dataset.domainValue) === final) continue;
        knob.dataset.domainValue = String(final);
        knob.value = String(final);
        if (typeof root.syncNodeSliderReadout === "function") root.syncNodeSliderReadout(knob);
      }
    }
  }

  // Frequency is not pinnable, so its Hz field only shows Freq Out. With a cable on Freq In it is "driven by Freq In" and disabled.
  function frequencyReadoutHtml(node, hzValue) {
    const driven = !!freqInSourceId(node);
    const cls = driven ? ' class="node-under-construction-control"' : "";
    const dis = driven ? ' disabled aria-disabled="true"' : " readonly";
    return "<label>Frequency Hz" + (driven ? " (driven by Freq In)" : " (not pinnable)") +
      '<input type="number" data-pm="hz"' + cls + dis + ' value="' + escapeAttr(hzValue) + '"></label>';
  }

  function hzText(node, x) {
    const hz = freqOutHz(node, x);
    return hz > 0 ? hz.toFixed(2) : "";
  }

  function playheadText(node, x) {
    const E = engine();
    const wired = freqInSourceId(node) && incomingHz(node);
    return "Playhead " + midiName(x) + " (" + (Number.isFinite(x) ? x.toFixed(2) : "") + ")" + (wired ? " from Freq In" : "");
  }

  function setAuditionNote(note) {
    const E = engine();
    if (!E || !Number.isFinite(Number(note))) return;
    ui.auditionNote = Number(note);
    dropPendingIfMoved();
    if (typeof root.scheduleNodeGraphLiveParameterSync === "function") root.scheduleNodeGraphLiveParameterSync();
    paintBoundKnobs();
    refreshPlayhead();
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

  // Pin Keyframe always commits the knob lane. Frequency is never a pin target: with no knob bound there is nothing to pin.
  function pinActiveLane() {
    const E = engine();
    const node = selectedNode();
    if (!E || !node) return;
    const state = ensureState(node);
    const lane = state.lanes[0];
    if (!lane) {
      ui.notice = FREQ_NOT_PINNABLE;
      renderOverlay();
      return;
    }
    const x = soundingNote(node);
    if (!Number.isFinite(x)) return;
    const meta = paramMeta(lane.target);
    // What the knob shows at this note: the pending value if one was set here, else what the lane already says.
    lane.keys = E.pinKey(lane.keys, x, "offset", laneOffsetAt(node, lane, x), state.snap);
    lane.discrete = isDiscreteMeta(meta);
    state.activeLane = lane.id;
    ui.pending = null;
    ui.pinMsg = "Pinned " + midiName(x) + ".";
    ui.notice = "";
    recordChange("Pin Keyframe");
    renderOverlay();
    refreshRings();
  }

  function bindKnob(nodeId, paramKey) {
    const E = engine();
    const node = selectedNode();
    if (!E || !node || !node.mutator || !nodeId || !paramKey) return null;
    // Never the Mutator's own controls: its only parameter is the hidden playhead, which is the note, not something to pin.
    if (node.id === nodeId || paramKey === "playheadHz" || mutatorNodes().some((m) => m.id === nodeId)) return null;
    const state = ensureState(node);
    const existing = state.lanes.find((l) => l.target.nodeId === nodeId && l.target.paramKey === paramKey);
    if (existing) {
      state.activeLane = existing.id;
      return existing;
    }
    if (state.lanes.length) {
      // D-M1: one knob lane for now. The second knob stays free; the overlay's status line says so.
      node._mutatorArmed = false;
      ui.notice = ONE_LANE_NOTICE;
      refreshNav();
      renderOverlay();
      return null;
    }
    const meta = paramMeta({ nodeId, paramKey });
    const lane = {
      id: "L1",
      target: { nodeId, paramKey },
      keys: [],
      discrete: isDiscreteMeta(meta),
    };
    state.lanes.push(lane);
    state.activeLane = lane.id;
    ui.notice = "";
    ui.pinMsg = "";
    ui.pending = null;
    node._mutatorArmed = false; // D-M8: Arm ends with the first bind (one knob lane)
    refreshNav();
    recordChange("Bind Mutator knob");
    return lane;
  }

  function isArmed() {
    // D-M8: Arm stays on with the overlay closed, until a knob is bound or Arm is turned off.
    const node = selectedNode();
    return !!(node && node._mutatorArmed);
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
    const nodeId = sliderNodeId(slider);
    const paramKey = String((slider.dataset && slider.dataset.param) || "").trim();
    if (!nodeId || !paramKey) return false;

    let bound = boundLaneFor(nodeId, paramKey);
    if (!bound && isArmed()) {
      const lane = bindKnob(nodeId, paramKey);
      if (lane) bound = { node: selectedNode(), lane };
    }
    if (!bound) return false;

    // A turn on a bound knob is always taken: the base parameter is never written while a lane exists.
    const { node } = bound;
    const state = ensureState(node);
    const lane = state.lanes.find((l) => l.id === bound.lane.id) || bound.lane;
    state.activeLane = lane.id;
    const meta = paramMeta(lane.target);
    const baseSlider = E.sliderFromDomain(meta, baseDomain(lane.target));
    const nextSlider = E.sliderFromDomain(meta, domainValue);
    const x = soundingNote(node);
    const offset = nextSlider - baseSlider;
    if (state.autoPin && Number.isFinite(x)) {
      // Auto-Pin on: every turn pins at the playing note.
      lane.keys = E.pinKey(lane.keys, x, "offset", offset, state.snap);
      lane.discrete = isDiscreteMeta(meta);
      ui.pending = null;
      ui.pinMsg = "Pinned " + midiName(x) + ".";
    } else {
      // Auto-Pin off: the turn is a pending value at the playhead until Pin Keyframe (or another note drops it).
      ui.pending = { mut: node.id, lane: lane.id, x, offset };
      ui.pinMsg = "";
    }

    const final = E.domainFromSlider(meta, E.finalSlider(baseSlider, laneOffsetAt(node, lane, x), meta));
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
      // The playhead the native graph reads: the Hz arriving on a wired Freq In, otherwise the audition key.
      params.playheadHz = incomingHz(sourceNode) || E.hzFromNote(soundingNote(sourceNode));
      sourceNode._mutatorFreqLut = baked;
      return;
    }
    const offsets = [];
    for (const node of mutatorNodes()) {
      const state = ensureState(node);
      if (!state) continue;
      for (const lane of state.lanes || []) {
        if (lane.target.nodeId !== sourceNode.id) continue;
        if (!(lane.target.paramKey in params)) continue;
        offsets.push({ key: lane.target.paramKey, meta: paramMeta(lane.target), offset: laneOffsetAt(node, lane, soundingNote(node)), discrete: lane.discrete });
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
          offsets.push(laneOffsetAt(mut, lane, soundingNote(mut)));
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
    link.href = "./public/node-graph-pitch-mutator.css?v=mutator-slice-4-hp09d";
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
    el.addEventListener("contextmenu", onOverlayContextMenu);
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

  // ---- pins: drag to edit, right-click (long-press on touch) to delete. Keys store signed slider offsets.
  function pinLaneAndKey(dot) {
    const node = selectedNode();
    const state = node && ensureState(node);
    const lane = state && state.lanes.find((l) => l.id === dot.getAttribute("data-lane"));
    const x = Number(dot.getAttribute("data-x"));
    return { node, state, lane, x };
  }

  function deletePin(laneId, x) {
    const node = selectedNode();
    const state = node && ensureState(node);
    const lane = state && state.lanes.find((l) => l.id === laneId);
    if (!lane) return false;
    const keys = lane.keys.filter((k) => k.x !== x);
    if (keys.length === lane.keys.length) return false;
    lane.keys = keys;
    ui.pending = null;
    ui.pinMsg = "Deleted the pin at " + midiName(x) + ".";
    recordChange("Pin deleted");
    paintBoundKnobs();
    renderOverlay();
    return true;
  }

  function onOverlayContextMenu(event) {
    const dot = event.target.closest && event.target.closest("[data-pm=pin-dot]");
    if (!dot) return;
    // Like the graph modules: right-click removes the point, no context menu, no change of module or workspace selection.
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    deletePin(dot.getAttribute("data-lane"), Number(dot.getAttribute("data-x")));
  }

  function plotPointToPin(event, lane, state) {
    const E = engine();
    const svg = document.querySelector("#pitchMutatorOverlay [data-pm=plot]");
    if (!E || !svg) return null;
    const rect = svg.getBoundingClientRect();
    const range = midiRange();
    const count = range.max - range.min + 1;
    const note = range.min + ((event.clientX - rect.left) / Math.max(1, rect.width)) * count - 0.5;
    const x = Math.min(range.max, Math.max(range.min, state.snap ? Math.round(note) : note));
    // Height is the knob's position on its own definition range (3 px inset like the drawing); only the definition clamps it.
    const h = Math.max(1, rect.height);
    const slider = Math.min(1, Math.max(0, 1 - ((event.clientY - rect.top) - 3) / Math.max(1, h - 6)));
    const meta = paramMeta(lane.target);
    const base = E.sliderFromDomain(meta, baseDomain(lane.target));
    return { x, offset: slider - base };
  }

  function startPinDrag(event, dot) {
    const { node, lane, x } = pinLaneAndKey(dot);
    if (!node || !lane) return;
    ui.pan = null;
    const axis = event.target.closest("[data-pm=axis]");
    try { axis.setPointerCapture(event.pointerId); } catch (err) {}
    const drag = { pointerId: event.pointerId, laneId: lane.id, x, startX: event.clientX, startY: event.clientY, moved: false, timer: 0 };
    ui.pinDrag = drag;
    ui.suppressKeyClick = true;
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      // Phone fallback for right-click: hold still on the pin to delete it. One-shot, tied to this press.
      drag.timer = root.setTimeout(() => {
        drag.timer = 0;
        if (ui.pinDrag === drag && !drag.moved) {
          ui.pinDrag = null;
          deletePin(drag.laneId, drag.x);
        }
      }, 600);
    }
  }

  function movePinDrag(event) {
    const drag = ui.pinDrag;
    const E = engine();
    if (!drag || drag.pointerId !== event.pointerId || !E) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      drag.moved = true;
      if (drag.timer) { root.clearTimeout(drag.timer); drag.timer = 0; }
    }
    const node = selectedNode();
    const state = node && ensureState(node);
    const lane = state && state.lanes.find((l) => l.id === drag.laneId);
    if (!lane) return;
    const to = plotPointToPin(event, lane, state);
    if (!to) return;
    const rest = lane.keys.filter((k) => k.x !== drag.x);
    lane.keys = E.pinKey(rest, to.x, "offset", to.offset, state.snap);
    const landed = lane.keys.find((k) => Math.abs(k.x - to.x) < 1e-9) || lane.keys.find((k) => k.x === drag.x);
    drag.x = landed ? landed.x : to.x;
    ui.pinMsg = "";
    recordChange();
    paintBoundKnobs();
    refreshPlayhead();
  }

  function onAxisPointerDown(event) {
    const pinDot = event.target.closest && event.target.closest("[data-pm=pin-dot]");
    if (pinDot) {
      // A pin press is never a pan or a key tap. Only the primary button drags; right-click is the delete (contextmenu).
      if (event.button === 0 || event.button === undefined) startPinDrag(event, pinDot);
      return;
    }
    const axis = event.target.closest("[data-pm=axis]");
    if (!axis) return;
    // A leftover suppress from a drag that never got a click is finished; a new gesture starts clean.
    if (ui.pointers.size === 0) ui.suppressKeyClick = false;
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
    const keyEl = event.target.closest("[data-pm=key]");
    if (keyEl) {
      ui.pan = { kind: "maybe-key", pointerId: event.pointerId, x: event.clientX, scroll0: axis.scrollLeft, axis: axis };
      // The note changes now, on pointerdown; a drag past the threshold below still turns into a pan.
      setAuditionNote(Number(keyEl.getAttribute("data-note")));
      return;
    }
    if (!event.target.closest(".pm-plot-wrap") && !event.target.closest(".pm-kbd")) return;
    event.preventDefault();
    try { axis.setPointerCapture(event.pointerId); } catch (err) {}
    ui.pan = { kind: "pan", pointerId: event.pointerId, x: event.clientX, scroll0: axis.scrollLeft, axis: axis };
  }

  function onAxisPointerMove(event) {
    if (ui.pinDrag) {
      movePinDrag(event);
      return;
    }
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
    if (ui.pinDrag && ui.pinDrag.pointerId === event.pointerId) {
      const drag = ui.pinDrag;
      ui.pinDrag = null;
      if (drag.timer) root.clearTimeout(drag.timer);
      if (drag.moved) {
        recordChange("Pin moved");
        renderOverlay();
      }
      return;
    }
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
    // suppressKeyClick is consumed by the click handler, or cleared on the next pointerdown.
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
    for (const lane of (state && state.lanes) || []) {
      const baked = E.bakeOffsetLane(lane);
      if (!baked.valid) continue;
      const laneMeta = paramMeta(lane.target);
      const laneBase = E.sliderFromDomain(laneMeta, baseDomain(lane.target));
      const xs = [];
      const ys = [];
      for (let n = range.min; n <= range.max; n++) {
        const off = E.lookupOffset(baked.table, n, true) || 0;
        // Height is the knob's own position (0 = its minimum, 1 = its maximum): the effective value, not the signed offset.
        const t = laneBase + off;
        xs.push(xCenter(n));
        ys.push((1 - Math.min(1, Math.max(0, t))) * (cssH - 6) + 3);
      }
      drawLane(xs, ys, node.color, state.activeLane !== lane.id);
    }
    // One dot per pin: at this note (column) the knob is set to this value (height). A 44 px invisible disc around each is its hit target.
    const heightOf = (slider) => (1 - Math.min(1, Math.max(0, slider))) * (cssH - 6) + 3;
    const dot = (cx, cy, color, hollow, laneId, keyX) => {
      if (keyX != null) {
        parts.push('<circle class="pm-pin-hit" data-pm="pin-dot" data-lane="' + laneId + '" data-x="' + keyX + '" cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="22" fill="transparent"/>');
      }
      parts.push(
        '<circle class="pm-pin" cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) + '" r="3.5" fill="' + (hollow ? "none" : color) + '" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"/>',
      );
    };
    for (const lane of (state && state.lanes) || []) {
      const laneMeta = paramMeta(lane.target);
      const laneBase = E.sliderFromDomain(laneMeta, baseDomain(lane.target));
      for (const k of lane.keys || []) dot(xCenter(k.x), heightOf(laneBase + k.offset), node.color, false, lane.id, k.x);
      const pending = ui.pending;
      if (pending && pending.mut === node.id && pending.lane === lane.id) {
        dot(xCenter(pending.x), heightOf(laneBase + pending.offset), node.color, true, lane.id, null);
      }
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
      '<button type="button" class="pm-lane-btn' + (node && freqInSourceId(node) ? " node-under-construction-control" : "") + (state && state.activeLane === "freq" ? " active" : "") + '" data-pm="lane" data-lane="freq">Frequency' + (node && freqInSourceId(node) ? " (driven by Freq In)" : "") + "</button>"
    );
    if (state) {
      for (const lane of state.lanes) {
        const label = laneLabel(lane);
        lanes.push(
          '<button type="button" class="pm-chip' + (state.activeLane === lane.id ? " active" : "") + '" data-pm="lane" data-lane="' + lane.id + '">' +
          '<span class="pm-chip-dot"></span>' + escapeHtml(label) + ' <span data-pm="chip-value" data-lane="' + lane.id + '">' +
          escapeHtml(laneValueText(node, lane, soundingNote(node))) + "</span></button>"
        );
      }
    }
    const range = E ? (E.MIDI_RANGE || E.KEYBOARD_SPAN) : { min: 0, max: 127 };
    const view = state ? viewOf(state) : viewOf(null);
    let kbd = "";
    const lit = Math.round(node ? soundingNote(node) : ui.auditionNote);
    for (let n = range.min; n <= range.max; n++) {
      const on = lit === n;
      kbd += '<button type="button" class="pm-key' + (isBlack(n) ? " black" : "") + (on ? " audition" : "") + '" data-pm="key" data-note="' + n + '">' +
        (n % 12 === 0 ? midiName(n) : "") + "</button>";
    }
    const x = node ? soundingNote(node) : ui.auditionNote;
    const activeLane = state && state.activeLane !== "freq"
      ? (state.lanes || []).find((l) => l.id === state.activeLane)
      : null;
    const hzValue = node ? hzText(node, x) : "";
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
        '<button type="button" class="pm-btn" data-pm="arm" aria-pressed="' + (node && node._mutatorArmed ? "true" : "false") + '">Arm: ' + (node && node._mutatorArmed ? "On" : "Off") + "</button>",
        '<button type="button" class="pm-btn' + (state && state.lanes.length ? "" : " node-under-construction-control") + '" data-pm="pin"' + (state && state.lanes.length ? "" : ' disabled aria-disabled="true"') + ">Pin Keyframe</button>",
        '<button type="button" class="pm-btn" data-pm="autopin" aria-pressed="' + (state && state.autoPin ? "true" : "false") + '">Auto-Pin: ' + (state && state.autoPin ? "On" : "Off") + "</button>",
        '<button type="button" class="pm-btn" data-pm="snap" aria-pressed="' + (state && state.snap ? "true" : "false") + '">Snap</button>',
        '<div class="pm-view">',
          "<label>Keys <input type=\"range\" data-pm=\"visible\" min=\"12\" max=\"128\" step=\"1\" value=\"" + view.visible + "\"><span data-pm=\"visible-count\">" + view.visible + "</span></label>",
          '<span class="pm-view-readout" data-pm="view-readout">' + escapeHtml(viewReadout(view)) + "</span>",
          '<button type="button" class="pm-btn" data-pm="view-c0c8">C0–C8</button>',
          '<button type="button" class="pm-btn" data-pm="view-c1c7">C1–C7</button>',
          '<button type="button" class="pm-btn" data-pm="view-all">0–127</button>',
        "</div>",
      "</div>",
      '<div class="pm-status" data-pm="status">' + escapeHtml(statusText(node)) + "</div>",
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
          '<div data-pm="playhead">' + escapeHtml(node ? playheadText(node, x) : "") + "</div>",
          state && state.activeLane === "freq"
            ? frequencyReadoutHtml(node, hzValue)
            : (activeLane ? '<label>Offset<input type="number" data-pm="offset" step="0.001" value="' + escapeAttr(offValue) + '"></label>' : "<div>Select a lane.</div>"),
          "<div>Wire Freq Out into a FREQUENCY input. Arm, turn one knob to bind it, then Pin Keyframe at each note (or turn Auto-Pin on and turn the knob).</div>",
          "<div>Dot = pin: at this note the knob is set to this value.</div>",
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
      ui.notice = "";
      refreshNav();
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
      if (ui.suppressKeyClick) {
        ui.suppressKeyClick = false;
        return;
      }
      // Pointer taps already set the note on pointerdown; this serves keyboard activation (Enter / Space).
      const note = Number(btn.getAttribute("data-note"));
      if (note !== ui.auditionNote) setAuditionNote(note);
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
        const knob = knobFor(lane.target.nodeId, lane.target.paramKey);
        [knob].filter(Boolean).forEach((el) => {
          const host = el.closest(".node-slider, .node-knob, .module-param, .node-graph-slider") || el;
          host.classList.add("pitch-mutator-knob-ring");
          host.style.setProperty("--pitch-mutator-color", node.color);
        });
      }
    }
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
      paintNavButton(button);
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
    document.querySelectorAll('[data-unified-action="mutators"]').forEach((btn) => paintNavButton(btn));
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
      // A MIDI module wired to a Freq In sends its note as that module's frequency.
      const heardHz = hz > 0 ? hz : (Number.isFinite(note) && E ? E.hzFromNote(note) : 0);
      if (heardHz > 0) {
        for (const n of (patch() && patch().nodes) || []) {
          if (n && n.type === "keyboardController") noteMoved(n.id, heardHz);
        }
      }
      noteMoved("", 0);
      return orig.apply(this, arguments);
    }
    wrapped._pitchMutatorHooked = true;
    root.sendNodeGraphLiveMidiKeyboardSignal = wrapped;
  }

  // A keyboard module's own signal (the Keyboard on the canvas): remember its Hz for any Mutator wired to it.
  function hookKeyboardModuleSignal() {
    const orig = root.sendNodeGraphLiveKeyboardModuleSignal;
    if (typeof orig !== "function" || orig._pitchMutatorHooked) return;
    function wrapped(nodeId, signal) {
      const hz = Number(signal && signal.frequency);
      noteMoved(nodeId, hz > 0 ? hz : 0);
      return orig.apply(this, arguments);
    }
    wrapped._pitchMutatorHooked = true;
    root.sendNodeGraphLiveKeyboardModuleSignal = wrapped;
  }

  // A source module's frequency changed (or, with no id, the audition key did): everything that reads the playhead follows.
  function noteMoved(sourceId, hz) {
    const id = String(sourceId || "");
    if (id) {
      if (hz > 0) ui.sourceHz.set(id, hz);
      else ui.sourceHz.delete(id);
      if (!mutatorsFedBy(id).length) return;
    }
    dropPendingIfMoved();
    if (typeof root.scheduleNodeGraphLiveParameterSync === "function") root.scheduleNodeGraphLiveParameterSync();
    paintBoundKnobs();
    queueRedraw();
  }

  // The patch changed (cables, knobs re-rendered, mutators added or removed): rings, the wired source and the overlay catch up.
  function onPatchCommit() {
    paintBoundKnobs();
    refreshRings();
    queueRedraw();
  }

  root.togglePitchMutatorOverlay = toggleOverlay;
  // After the gradients (order 0): the Mutator's offsets are added on top of theirs.
  root.registerNodeGraphParamOffsetProvider({
    id: "pitchMutator",
    order: 20,
    applyParams: applyLiveParams,
    applyToBase,
  });
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
    hookNav();
    hookMidiKeyboard();
    hookKeyboardModuleSignal();
    if (typeof root.addNodeGraphPatchCommitListener === "function") {
      root.addNodeGraphPatchCommitListener(onPatchCommit);
    } else {
      (root.__nodeGraphPatchCommitPending || (root.__nodeGraphPatchCommitPending = [])).push(onPatchCommit);
    }
    refreshRings();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
