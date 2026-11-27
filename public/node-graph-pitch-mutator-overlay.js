// Pitch Mutator first-slice overlay, binding, and live hooks.
// Horizontal docked editor. Bindings are rings and chips, never cables.

(function (root) {
  const COLORS = Object.freeze([
    "#c45a7a", "#d9983a", "#6caf5a", "#3aa0c7",
    "#7a6ad9", "#d35cc7", "#d14b4b", "#c7b14a",
  ]);

  const ONE_LANE_NOTICE = "One knob lane for now";
  const FREQ_DROPPED_NOTICE = "Dropped a Frequency pin. The Pitch Mutator's frequency is not pinnable";
  const NO_LANE_NOTICE = "Bind a knob first: press Arm, then turn the knob you want to control";
  const SELF_NOTICE = "A Mutator can't mutate itself";

  const ui = {
    open: false,
    selectedId: "",
    navHooked: false,
    raf: 0,
    notice: "",
    // Auto-Pin off: the value a knob turn set at the playhead, not yet pinned. { mut, lane, x, offset } or null.
    pending: null,
    // A pin being dragged: { pointerId, laneId, x, startX, startY, moved, timer }.
    keyDrag: null,
    pinMsg: "",
    // Last frequency each possible Pitch In source (keyboard / MIDI module) was heard at, from the signals it sends. Not a poll: set by the send hooks.
    sourceHz: new Map(),
    // The Mutator playhead's smoothed Hz as the audio engine reports it (data bus PlayheadHz), per Mutator id.
    heardHz: new Map(),
    redrawFull: false,
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

  // The module wired into this Mutator's Pitch In ("" when nothing is).
  function freqInSourceId(node) {
    const p = patch();
    const cables = p && Array.isArray(p.connections) ? p.connections : [];
    for (const c of cables) {
      if (c && String(c.destinationNode) === String(node && node.id) && String(c.destinationPort) === "pitch") return String(c.sourceNode);
    }
    return "";
  }

  // Hz arriving on a wired Pitch In, as far as the page can know it (the source's last signal); null when unwired or not heard yet.
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

  // The playhead is a knob in keyboard units (0..127 keys, the "playhead" param); anything on the Pitch In adds to it, so the Mutator's own
  // keyboard, its knob and every cable mix like any other param. Modulation lands after the smoother (the knob's smoothing never touches a signal).
  function biasNote(node) {
    if (!node) return 0;
    const v = typeof root.nodeGraphReadPatchParameterValue === "function"
      ? root.nodeGraphReadPatchParameterValue(node, "playhead")
      : Number(node.params && node.params.playhead);
    return Number.isFinite(v) ? v : 0;
  }

  // Pitch In as a note: the page only hears the source's Hz, so it converts; the native engine reads the real cable.
  function incomingNote(node) {
    const E = engine();
    const hz = E ? incomingHz(node) : null;
    return hz ? E.noteFromHz(hz) : 0;
  }

  // The Mutator keyboard shows both contributions: the solid key is the Pitch knob (-1 when it is 0 = off), the outlined key is what arrives on Pitch In.
  function knobKeyOf(node) {
    const v = biasNote(node);
    return v > 0 ? Math.min(127, Math.round(v)) : -1;
  }

  function wireKeyOf(node) {
    return freqInSourceId(node) && incomingHz(node) ? Math.min(127, Math.max(0, Math.round(incomingNote(node)))) : -1;
  }

  // True when any Mutator's Pitch knob is off 0: the nav button is tinted so a forgotten knob is not a mystery with the overlay closed.
  function anyPitchSet() {
    return mutatorNodes().some((n) => biasNote(n) > 0);
  }

  // The playhead: Pitch In + the Playhead knob, clamped to the keyboard (only the lookup range is clamped; the knob itself is not).
  function soundingNote(node) {
    const E = engine();
    const snap = !!(node && node.mutator && node.mutator.snap);
    const raw = Math.min(127, Math.max(0, incomingNote(node) + biasNote(node)));
    return E ? E.snapNote(raw, snap) : raw;
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

  // The playhead the engine actually evaluates the lane from: its smoothed Hz, relayed on the data bus while the audio engine runs. Pin placement
  // keeps using the target note (soundingNote); knob / chip paint and the main-thread offset use this one.
  function shownNote(node) {
    const E = engine();
    const live = root.nodeGraphMvp && root.nodeGraphMvp.live;
    const hz = E && live && live.node ? ui.heardHz.get(node.id) : 0;
    return hz > 0 ? E.noteFromHz(hz) : soundingNote(node);
  }

  // The lane's offset for painting: a pending (unpinned) value is held flat, otherwise the pinned curve at the smoothed playhead.
  function paintOffset(node, lane) {
    const pending = ui.pending;
    if (pending && pending.mut === node.id && pending.lane === lane.id) return pending.offset;
    return offsetAt(node, lane, shownNote(node));
  }

  // Data-bus event (arrives with the engine's scope message): the Mutator's smoothed playhead moved.
  function playheadHeard(nodeId, hz) {
    const id = String(nodeId);
    const next = Number(hz) > 0 ? Number(hz) : 0;
    const prev = ui.heardHz.get(id) || 0;
    if (Math.abs(Math.log2((next || 1) / (prev || 1))) < 1e-5 && (next > 0) === (prev > 0)) return;
    if (next > 0) ui.heardHz.set(id, next);
    else ui.heardHz.delete(id);
    if (!mutatorNodes().some((n) => n.id === id)) return;
    dropPendingIfMoved();
    document.querySelectorAll('[data-unified-action="mutators"]').forEach((btn) => btn.classList.toggle("pm-nav-pitched", anyPitchSet()));
    paintBoundKnobs();
    queueRedraw(true);
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
  function queueRedraw(light) {
    if (!ui.open) return;
    if (!light) ui.redrawFull = true;
    if (ui.raf) return;
    ui.raf = root.requestAnimationFrame(() => {
      ui.raf = 0;
      const full = ui.redrawFull;
      ui.redrawFull = false;
      if (!ui.open) return;
      const el = document.getElementById("pitchMutatorOverlay");
      const typing = el && document.activeElement && el.contains(document.activeElement)
        && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (typing || !full) refreshPlayhead();
      else renderOverlay();
    });
  }

  // The playhead moved: key highlight and readouts only. The keyboard keeps its DOM (a pan in progress holds a key element).
  function refreshPlayhead() {
    const el = document.getElementById("pitchMutatorOverlay");
    const node = selectedNode();
    if (!el || el.hidden || !node) return;
    const x = soundingNote(node);
    el.querySelectorAll(".pm-key.audition, .pm-key.wire").forEach((k) => k.classList.remove("audition", "wire"));
    const knobKey = knobKeyOf(node);
    const wireKey = wireKeyOf(node);
    const key = knobKey >= 0 ? el.querySelector('.pm-key[data-note="' + knobKey + '"]') : null;
    if (key) key.classList.add("audition");
    const wireEl = wireKey >= 0 ? el.querySelector('.pm-key[data-note="' + wireKey + '"]') : null;
    if (wireEl) wireEl.classList.add("wire");
    const readout = el.querySelector("[data-pm=playhead]");
    if (readout) readout.textContent = playheadText(node, x);
    const state = ensureState(node);
    const statusEl = el.querySelector("[data-pm=status]");
    if (statusEl) statusEl.textContent = statusText(node);
    el.querySelectorAll("[data-pm=chip-value]").forEach((chip) => {
      const l = (state.lanes || []).find((q) => q.id === chip.getAttribute("data-lane"));
      if (l) chip.textContent = laneValueText(node, l);
    });
    const off = el.querySelector('[data-pm="offset"]');
    const lane = state && (state.lanes || []).find((l) => l.id === state.activeLane);
    if (off && lane && document.activeElement !== off && !off.classList.contains("value-dragging")) off.value = offsetAt(node, lane, x).toFixed(3);
  }

  // The effective value the bound knob has right now, as a short number (the face readout is GL; this is the chip's own copy).
  function laneValueText(node, lane) {
    const E = engine();
    if (!E || !lane) return "";
    const meta = paramMeta(lane.target);
    const base = E.sliderFromDomain(meta, baseDomain(lane.target));
    const value = E.domainFromSlider(meta, E.finalSlider(base, paintOffset(node, lane), meta));
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
    if (!lane) return "Not armed. Press Arm, then turn the knob you want to control.";
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
    button.classList.toggle("pm-nav-pitched", anyPitchSet());
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
      for (const lane of (state && state.lanes) || []) {
        const knob = knobFor(lane.target.nodeId, lane.target.paramKey);
        if (!knob || !knob.dataset) continue;
        const meta = paramMeta(lane.target);
        const base = E.sliderFromDomain(meta, baseDomain(lane.target));
        const final = E.domainFromSlider(meta, E.finalSlider(base, paintOffset(node, lane), meta));
        if (!Number.isFinite(final) || Number(knob.dataset.domainValue) === final) continue;
        knob.dataset.domainValue = String(final);
        knob.value = String(final);
        if (typeof root.syncNodeSliderReadout === "function") root.syncNodeSliderReadout(knob);
      }
    }
  }

  function playheadText(node, x) {
    const E = engine();
    const wired = freqInSourceId(node) && incomingHz(node);
    const knob = biasNote(node);
    const parts = wired ? " = Pitch knob " + (knob > 0 ? midiName(Math.round(knob)) : "off") + " + \u266f/\u266d " + midiName(Math.round(incomingNote(node))) : "";
    return "Playhead " + midiName(x) + " (" + (Number.isFinite(x) ? x.toFixed(2) : "") + ")" + parts;
  }

  function setBias(node, note) {
    const value = Math.min(127, Math.max(0, note));
    const slider = knobFor(node.id, "playhead");
    if (slider && typeof root.setNodeSliderValue === "function") {
      root.setNodeSliderValue(slider, value, { interaction: "drag" });
    } else {
      node.params = { ...(node.params || {}), playhead: value };
    }
  }

  function setAuditionNote(note) {
    const E = engine();
    if (!E || !Number.isFinite(Number(note))) return;
    // The Mutator keyboard is the Playhead knob's mirror: a key sets the knob (a wired Pitch In still adds to it).
    // Selecting only: clearing is a separate gesture (mouse up on the key that was already selected, see onAxisPointerUp).
    const node = selectedNode();
    if (node) setBias(node, Number(note));
    dropPendingIfMoved();
    refreshNav();
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
      ui.notice = NO_LANE_NOTICE;
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
    // A Mutator never lists its own parameters: refused with an inline note, nothing added, Arm stays on for the real knob.
    if (node.id === nodeId) {
      ui.notice = SELF_NOTICE;
      renderOverlay();
      return null;
    }
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

  // The Mutator's own live params and tables. Its knob lane is NOT folded into the target's params: the target's smoother keeps chasing the
  // target's base value, and the native engine adds the lane offset after that smoother, from the Mutator's smoothed playhead
  // (graph_engine.cpp, Control.laneUnit). Here the host only hands the engine the lane table.
  function applyLiveParams(sourceNode, params) {
    const E = engine();
    if (!E || !params || !sourceNode || sourceNode.type !== "pitchMutator") return;
    const state = ensureState(sourceNode);
    sourceNode._mutatorFreqLut = E.bakeFreqLane(state.freqLane);
    sourceNode._mutatorLane = bakeKnobLane(sourceNode);
  }

  // The single-value path for the main-thread live evaluators (they read a smoother output that now chases the BASE, so the lane is added once,
  // here, after the smoother). Audio never comes through here: the native engine adds the same offset after its own smoother.
  function applyToBase(node, key, base, metadata) {
    const E = engine();
    if (!E || !node || !key) return base;
    const offsets = [];
    for (const mut of mutatorNodes()) {
      const state = ensureState(mut);
      if (!state) continue;
      for (const lane of state.lanes || []) {
        if (lane.target.nodeId === node.id && lane.target.paramKey === key) {
          offsets.push(paintOffset(mut, lane));
        }
      }
    }
    if (!offsets.length) return base;
    const meta = metadata || paramMeta({ nodeId: node.id, paramKey: key });
    return E.domainFromSlider(meta, E.finalSlider(E.sliderFromDomain(meta, base), offsets, meta));
  }

  // One entry per MIDI note: the signed slider-unit offset of the bound knob, plus the target. A pending (unpinned) value is held flat so it
  // is heard at the playhead until it is pinned or the note moves (which drops it and re-bakes).
  function bakeKnobLane(node) {
    const E = engine();
    const state = ensureState(node);
    const lane = state && state.lanes[0];
    if (!E || !lane) return { valid: false, table: null, target: null };
    const pending = ui.pending;
    if (pending && pending.mut === node.id && pending.lane === lane.id) {
      return { valid: true, table: new Float32Array(128).fill(pending.offset), target: lane.target };
    }
    const baked = E.bakeOffsetLane(lane);
    return { valid: !!baked.valid, table: baked.valid ? Float32Array.from(baked.table) : null, target: lane.target };
  }

  function toggleOverlay(force) {
    ui.open = typeof force === "boolean" ? force : !ui.open;
    if (ui.open && !ui.selectedId) {
      const first = mutatorNodes()[0];
      if (first) ui.selectedId = first.id;
    }
    if (ui.open) {
      // Reopening lands on the knob lane, not on the Frequency view the last session left behind.
      const node = selectedNode();
      const state = node && ensureState(node);
      if (state && state.lanes.length) state.activeLane = state.lanes[0].id;
    }
    renderOverlay();
    refreshNav();
  }

  function ensureCss() {
    if (document.getElementById("pitchMutatorOverlayCss")) return;
    const link = document.createElement("link");
    link.id = "pitchMutatorOverlayCss";
    link.rel = "stylesheet";
    link.href = "./public/node-graph-pitch-mutator.css?v=mutator-slice-4-hp09e2-grip1";
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
    el.addEventListener("dblclick", onOverlayDoubleClick);
    el.addEventListener("focusout", (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.hasAttribute("data-unit-stepper-drag")) {
        input.readOnly = true;
        input.classList.remove("editing");
      }
    });
    el.addEventListener("keydown", (event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.hasAttribute("data-unit-stepper-drag") && (event.key === "Enter" || event.key === "Escape")) {
        event.preventDefault();
        input.blur();
      }
    });
    return el;
  }

  // The app-wide note name (MIDI 0 = C-2, MIDI 60 = C3): one shared helper (nodeGraphKeyboardPitchLabel, node-graph-view-controls.js).
  function midiName(note) {
    const n = Math.round(Number(note));
    if (!Number.isFinite(n)) return "";
    return root.nodeGraphKeyboardPitchLabel(n);
  }

  // A labeled key (the Cs) shows the octave number over the note letter, stacked, so the label stays inside its own key at any key count.
  // The name still comes from the one shared helper (MIDI 0 = C-2, MIDI 60 = C3).
  function keyLabelHtml(n) {
    if (n % 12 !== 0) return "";
    const m = /^([A-G][#b\u266f\u266d]?)(-?\d+)$/.exec(midiName(n));
    if (!m) return escapeHtml(midiName(n));
    return '<span class="pm-key-oct">' + m[2] + '</span><span class="pm-key-letter">' + m[1] + "</span>";
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
  // The shared scrub-number move / up handlers are document level and normally bound when a settings window first opens; the Mutator may be
  // used before that, so bind the same functions here once (a second binding of them is harmless: they are idempotent).
  let scrubBound = false;
  function bindScrubListeners() {
    if (scrubBound || typeof root.dragNodeGraphUnitStepper !== "function" || typeof root.endNodeGraphUnitStepperDrag !== "function") return;
    scrubBound = true;
    document.addEventListener("pointermove", root.dragNodeGraphUnitStepper, true);
    document.addEventListener("pointerup", root.endNodeGraphUnitStepperDrag, true);
    document.addEventListener("pointercancel", root.endNodeGraphUnitStepperDrag, true);
  }

  function onOverlayDoubleClick(event) {
    const scrub = event.target.closest && event.target.closest("input[data-unit-stepper-drag]");
    if (!scrub) return;
    scrub.readOnly = false;
    scrub.classList.add("editing");
    scrub.focus();
    scrub.select();
    event.preventDefault();
  }

  function onAxisPointerDown(event) {
    const grip = event.target.closest && event.target.closest("[data-pm=grip]");
    if (grip) {
      // Drag past the slop: a new Pitch Mutator follows the pointer into the circuit (the store's placement).
      if (typeof root.nodeGraphDragGripBegin === "function") root.nodeGraphDragGripBegin(event, { type: "pitchMutator", name: "Pitch Mutator" });
      return;
    }
    const scrub = event.target.closest && event.target.closest("input[data-unit-stepper-drag]");
    if (scrub) {
      // The app-wide scrub number (data-unit-stepper-drag): its move / up listeners are bound with the settings windows.
      bindScrubListeners();
      if (typeof root.beginNodeGraphUnitStepperDrag === "function" && scrub.readOnly) root.beginNodeGraphUnitStepperDrag(event);
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
    const mouse = event.pointerType === "mouse";
    if (mouse && keyEl) {
      // A mouse press on the keyboard plays like a keyboard: the key under the pointer sounds, dragging across keys plays each one.
      // It never scrolls the view (the wheel and the view buttons do that; touch drags the view).
      if (event.button !== 0 && event.button !== undefined) return;
      const pressed = Number(keyEl.getAttribute("data-note"));
      const was = knobKeyOf(selectedNode());
      ui.keyDrag = { pointerId: event.pointerId, startNote: pressed, startSelected: was === pressed, moved: false, lastNote: pressed };
      try { axis.setPointerCapture(event.pointerId); } catch (err) {}
      if (was !== pressed) setAuditionNote(pressed);
      return;
    }
    if (mouse) return; // a mouse press outside keyboard keys does not pan
    if (keyEl) {
      const pressed = Number(keyEl.getAttribute("data-note"));
      const was = knobKeyOf(selectedNode());
      ui.pan = { kind: "maybe-key", pointerId: event.pointerId, x: event.clientX, scroll0: axis.scrollLeft, axis: axis, startNote: pressed, startSelected: was === pressed };
      // The note changes now, on pointerdown; a drag past the threshold below still turns into a pan.
      if (was !== pressed) setAuditionNote(pressed);
      return;
    }
    if (!event.target.closest(".pm-kbd")) return;
    event.preventDefault();
    try { axis.setPointerCapture(event.pointerId); } catch (err) {}
    ui.pan = { kind: "pan", pointerId: event.pointerId, x: event.clientX, scroll0: axis.scrollLeft, axis: axis };
  }

  function onAxisPointerMove(event) {
    if (ui.keyDrag && ui.keyDrag.pointerId === event.pointerId) {
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const key = under && under.closest && under.closest("[data-pm=key]");
      if (key) {
        const note = Number(key.getAttribute("data-note"));
        if (note !== ui.keyDrag.lastNote) {
          ui.keyDrag.lastNote = note;
          ui.keyDrag.moved = true; // the last key dragged to wins; no toggling during a drag
          setAuditionNote(note);
        }
      }
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
    if (ui.keyDrag && ui.keyDrag.pointerId === event.pointerId) {
      const drag = ui.keyDrag;
      ui.keyDrag = null;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const upKey = under && under.closest && under.closest("[data-pm=key]");
      // A key toggles off only on mouse up, and only if the press began on the key that was already selected and the pointer stayed on it.
      if (drag.startSelected && !drag.moved && upKey && Number(upKey.getAttribute("data-note")) === drag.startNote) setAuditionNote(0);
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
      if (ui.pan.kind === "maybe-key" && ui.pan.startSelected) setAuditionNote(0); // a tap on the selected key, released: toggle off
      if (ui.pan.kind === "pan") persistViewSoon();
      ui.pan = null;
    }
    // suppressKeyClick is consumed by the click handler, or cleared on the next pointerdown.
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
    )).join("") || '<span>Drag the grip into the circuit to add a Pitch Mutator.</span>';
    // PASTE-8: the grip (the same as the 🌈 page's) is the way to bring a Pitch Mutator into the circuit: the store no longer lists it.
    const grip = typeof root.nodeGraphDragGripHtml === "function"
      ? root.nodeGraphDragGripHtml("Drag a new Pitch Mutator into the circuit", 'data-pm="grip"')
      : "";
    const swatches = COLORS.map((c) => (
      '<button type="button" class="pm-swatch' + (c === color ? " active" : "") + '" data-pm="color" data-color="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '"></button>'
    )).join("");
    const lanes = [];
    if (state) {
      for (const lane of state.lanes) {
        const label = laneLabel(lane);
        lanes.push(
          '<button type="button" class="pm-chip' + (state.activeLane === lane.id ? " active" : "") + '" data-pm="lane" data-lane="' + lane.id + '">' +
          '<span class="pm-chip-dot"></span>' + escapeHtml(label) + ' <span data-pm="chip-value" data-lane="' + lane.id + '">' +
          escapeHtml(laneValueText(node, lane)) + "</span></button>"
        );
      }
    }
    const range = E ? (E.MIDI_RANGE || E.KEYBOARD_SPAN) : { min: 0, max: 127 };
    const view = state ? viewOf(state) : viewOf(null);
    let kbd = "";
    const knobKey = node ? knobKeyOf(node) : -1;
    const wireKey = node ? wireKeyOf(node) : -1;
    for (let n = range.min; n <= range.max; n++) {
      kbd += '<button type="button" class="pm-key' + (isBlack(n) ? " black" : "") + (knobKey === n ? " audition" : "") + (wireKey === n ? " wire" : "") + '" data-pm="key" data-note="' + n + '">' +
        keyLabelHtml(n) + "</button>";
    }
    const x = node ? soundingNote(node) : 0;
    const activeLane = state ? (state.lanes || []).find((l) => l.id === state.activeLane) : null;
    const offValue = activeLane ? String(offsetAt(node, activeLane, x).toFixed(3)) : "";
    el.innerHTML = [
      '<div class="pm-overlay-chrome">',
        '<span class="pm-overlay-title">Mutators</span>',
        grip,
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
        node ? '<button type="button" class="pm-btn" data-pm="glide">Glide</button>' : "",
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
            '<div class="pm-kbd">' + kbd + "</div>",
          "</div>",
        "</div>",
        '<div class="pm-side">',
          '<div data-pm="playhead">' + escapeHtml(node ? playheadText(node, x) : "") + "</div>",
          activeLane
            ? '<label>Offset<input type="number" readonly data-pm="offset" data-unit-stepper-drag="true" data-unit-min="-1" data-unit-max="1" step="0.001" autocomplete="off" value="' + escapeAttr(offValue) + '"></label>'
            : "",
          "<div>Pin Keyframe adds a point at the current note.</div>",
        "</div>",
      "</div>",
      activeLane ? '<section class="pm-curve-controls"><h3>Segment curves · ' + escapeHtml(laneLabel(activeLane)) + '</h3>' + laneCurveControlsHtml(activeLane) + '</section>' : "",
    ].join("");
    el.style.setProperty("--pm-visible", String(view.visible));
    el.style.setProperty("--pm-key-count", String(range.max - range.min + 1));
    applyAxisView(view);
    root.requestAnimationFrame(() => {
      applyAxisView(view);
    });
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function laneCurveControlsHtml(lane) {
    const keys = (lane?.keys || []).slice().sort((a, b) => a.x - b.x);
    if (keys.length < 2) return '<div class="pm-curve-empty">Pin at least two keyframes to set a segment curve.</div>';
    const shapes = root.NODE_GRAPH_SEGMENT_SHAPES || ["rational", "exponential", "log", "smoothstep", "smootherstep", "hold"];
    return keys.slice(0, -1).map((key, index) => {
      const buttons = shapes.map((shape) => '<button type="button" class="pm-btn pm-curve-shape" data-pm="curve-shape" data-lane="'
        + escapeAttr(lane.id) + '" data-x="' + key.x + '" data-shape="' + shape + '" aria-pressed="'
        + (key.shape === shape ? 'true' : 'false') + '">' + shape + '</button>').join("");
      return '<div class="pm-curve-segment"><span>' + escapeHtml(midiName(key.x)) + ' → ' + escapeHtml(midiName(keys[index + 1].x))
        + '</span><div class="pm-curve-shapes">' + buttons + '</div><label>Skew <input type="range" min="-1" max="1" step="0.01" value="'
        + Number(key.skew || 0) + '" data-pm="curve-skew" data-lane="' + escapeAttr(lane.id) + '" data-x="' + key.x + '"></label></div>';
    }).join("");
  }

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
    if (act === "curve-shape" && node) {
      const state = ensureState(node);
      const lane = state.lanes.find((item) => item.id === btn.dataset.lane);
      const key = lane?.keys?.find((item) => Math.abs(item.x - Number(btn.dataset.x)) < 1e-9);
      if (!key) return;
      key.shape = engine().normalizeShape(btn.dataset.shape);
      state.activeLane = lane.id;
      recordChange("Mutator curve shape");
      if (typeof root.recordNodeGraphHistory === "function") root.recordNodeGraphHistory();
      return renderOverlay();
    }
    if (act === "key") {
      if (event.detail > 0) return; // a pointer press already acted on pointerdown; this serves Enter / Space (detail 0)
      if (ui.suppressKeyClick) {
        ui.suppressKeyClick = false;
        return;
      }
      // Pointer taps already set the note on pointerdown; this serves keyboard activation (Enter / Space).
      const note = Number(btn.getAttribute("data-note"));
      const node0 = selectedNode();
      setAuditionNote(node0 && knobKeyOf(node0) === note ? 0 : note);
    }
    if (act === "glide" && node) {
      const slider = knobFor(node.id, "playhead");
      const readout = slider && slider.id
        ? document.querySelector('.node-slider-readout[data-slider-target="' + slider.id + '"]')
        : null;
      if (readout && typeof root.openNodeMetadataPopover === "function") root.openNodeMetadataPopover(event, readout);
      else { ui.notice = "Add the Mutator's Pitch knob to the canvas to open its menu"; renderOverlay(); }
      return;
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
    if (act === "curve-skew") {
      const state = ensureState(node);
      const lane = state.lanes.find((item) => item.id === el.dataset.lane);
      const key = lane?.keys?.find((item) => Math.abs(item.x - Number(el.dataset.x)) < 1e-9);
      if (!key) return;
      key.skew = Math.max(-1, Math.min(1, Number(el.value) || 0));
      state.activeLane = lane.id;
      recordChange("Mutator curve skew");
      if (event.type === "change" && typeof root.recordNodeGraphHistory === "function") root.recordNodeGraphHistory();
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
      if (Math.abs(next - cur) < 1e-9) return; // a press and release without a change (the scrub number always sends change) rebuilds nothing
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
      const hz = Number(signal && (signal.hz ?? signal.frequency));
      const E = engine();
      // A MIDI module wired to a Pitch In sends its note as that module's frequency.
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
    refreshNav();
    paintBoundKnobs();
    refreshRings();
    queueRedraw();
  }

  root.togglePitchMutatorOverlay = toggleOverlay;
  root.pitchMutatorPlayheadHeard = playheadHeard;
  root.pitchMutatorPlayheadNote = soundingNote;
  // Order 20, after the gradients (order 0). applyParams only fills in the Mutator's own node (target offsets are added after the target's
  // smoother, natively); applyToBase serves the main-thread evaluators.
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
