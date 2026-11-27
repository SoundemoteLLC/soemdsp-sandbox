// Grid Keyboard — Array mbira layout (Bill Wesley).
// Columns: circle of fifths starting at F. Rows: octaves, bottom = low.

const NODE_GRAPH_GRID_KEYBOARD_FIFTHS_FROM_F = Object.freeze([
  5, 0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10,
]);
const NODE_GRAPH_GRID_KEYBOARD_COLS = 12;
const NODE_GRAPH_GRID_KEYBOARD_ROWS = 11;
const NODE_GRAPH_GRID_KEYBOARD_PC_NAMES = Object.freeze([
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
]);

function nodeGraphGridKeyboardMidiAt(col, row) {
  const c = Math.max(0, Math.min(NODE_GRAPH_GRID_KEYBOARD_COLS - 1, col | 0));
  const r = Math.max(0, Math.min(NODE_GRAPH_GRID_KEYBOARD_ROWS - 1, row | 0));
  const pc = NODE_GRAPH_GRID_KEYBOARD_FIFTHS_FROM_F[c];
  const midi = pc + 12 * r;
  return midi >= 0 && midi <= 127 ? midi : -1;
}

/** Unclamped sounding MIDI. ShiftMidi clamps to 0, which turns low F into C. */
function nodeGraphGridKeyboardSoundingMidi(rawMidi, octave) {
  const oct = Number.isFinite(Number(octave)) ? Math.round(Number(octave)) : 0;
  return Math.round(Number(rawMidi)) + oct * 12;
}

function nodeGraphGridKeyboardPadInRange(rawMidi, octave) {
  const sounding = nodeGraphGridKeyboardSoundingMidi(rawMidi, octave);
  return sounding >= 0 && sounding <= 127;
}

function nodeGraphGridKeyboardXY(col, row) {
  return {
    x: col / Math.max(1, NODE_GRAPH_GRID_KEYBOARD_COLS - 1),
    y: row / Math.max(1, NODE_GRAPH_GRID_KEYBOARD_ROWS - 1),
  };
}

function nodeGraphGridKeyboardPadFromPointer(event, surface) {
  if (surface?._gridKeyModel) {
    return nodeGraphGridKeyboardKeyAtClient(surface, event.clientX, event.clientY);
  }
  const raw = event.target?.closest?.("[data-grid-midi]");
  if (raw && surface.contains(raw) && Number(raw.dataset.gridMidi) >= 0) {
    return raw;
  }
  const x = event.clientX;
  const y = event.clientY;
  const pads = surface.querySelectorAll("[data-grid-midi]");
  for (let i = 0; i < pads.length; i += 1) {
    const el = pads[i];
    if (Number(el.dataset.gridMidi) < 0) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}

/** Retained surface-local rectangles, shared by GL drawing and pointer hits. */
function nodeGraphGridKeyboardLayoutKeyRects(surface) {
  const w = surface.clientWidth;
  const h = surface.clientHeight;
  if (!(w > 0) || !(h > 0)) return null;
  const style = getComputedStyle(surface);
  const gapX = Number.parseFloat(style.columnGap) || 0;
  const gapY = Number.parseFloat(style.rowGap) || 0;
  const padW = Math.max(0, (w - gapX * (NODE_GRAPH_GRID_KEYBOARD_COLS - 1)) / NODE_GRAPH_GRID_KEYBOARD_COLS);
  const padH = Math.max(0, (h - gapY * (NODE_GRAPH_GRID_KEYBOARD_ROWS - 1)) / NODE_GRAPH_GRID_KEYBOARD_ROWS);
  const keys = [...surface.querySelectorAll("[data-grid-midi]")].map((pad) => ({
    pad,
    state: pad.classList,
    black: pad.classList.contains("black-pc"),
    x: Number(pad.dataset.gridCol) * (padW + gapX),
    y: (NODE_GRAPH_GRID_KEYBOARD_ROWS - 1 - Number(pad.dataset.gridRow)) * (padH + gapY),
    w: padW,
    h: padH,
  }));
  surface._gridKeyModel = { w, h, keys };
  return surface._gridKeyModel;
}

function nodeGraphGridKeyboardKeyAtClient(surface, clientX, clientY) {
  const model = surface?._gridKeyModel;
  if (!model) return null;
  const box = surface.getBoundingClientRect();
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const x = (clientX - box.left) * model.w / box.width;
  const y = (clientY - box.top) * model.h / box.height;
  const key = model.keys.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  return key?.pad || null;
}

/** Hook: CollectChromeForNode adds Grid to the existing keyboard record list. */
function nodeGraphGridKeyboardCollectChrome(id, el, keyboards) {
  const surface = el.querySelector(".node-grid-keyboard-surface");
  if (!surface) return;
  const box = nodeGraphGlGraphWorldBox(surface);
  if (!box || !nodeGraphGridKeyboardLayoutKeyRects(surface)) return;
  keyboards.push({ id, surface, ...box, draw: nodeGraphGridKeyboardGlDraw });
}

let nodeGraphGridKeyboardLook = null;

/** Keep Grid's dark idle pads; every highlight uses the shared piano paint logic. */
function nodeGraphGridKeyboardKeyPaint(key) {
  if (!nodeGraphGridKeyboardLook) {
    const look = NODE_GRAPH_MIDI_KEY_LOOK;
    const white = nodeGraphKeyboardRgba(18, 22, 26, 0.92);
    const black = nodeGraphKeyboardRgba(8, 10, 12, 0.95);
    nodeGraphGridKeyboardLook = {
      ...look,
      white: { ...look.white, base: { top: white, bottom: white, text: nodeGraphKeyboardRgba(243, 241, 236) } },
      black: { ...look.black, base: { ...look.black.base, top: black, bottom: black } },
    };
  }
  return nodeGraphPianoKeysPaint(nodeGraphGridKeyboardLook, key.state, { black: key.black, wideLabels: true });
}

/** The Keyboard highlight palette/precedence, drawn by the shared GL picture device. */
function nodeGraphGridKeyboardGlDraw(batch, surface, x, y, w, h) {
  const model = surface?._gridKeyModel;
  if (!batch || !model || !(w > 0) || !(h > 0)) return false;
  const sx = w / model.w;
  const sy = h / model.h;
  const scale = Math.min(sx, sy);
  const textOpts = typeof nodeGraphGlGraphTextOpts === "function" ? nodeGraphGlGraphTextOpts : (o) => o;
  nodeGraphGlLinesRoundRect(batch, x, y, w, h, { radius: 0, fill: NODE_GRAPH_MIDI_KEY_LOOK.bed, feather: 0 });
  for (const key of model.keys) {
    const paint = nodeGraphGridKeyboardKeyPaint(key);
    const px = x + key.x * sx;
    const py = y + key.y * sy;
    const pw = key.w * sx;
    const ph = key.h * sy;
    nodeGraphGlLinesRoundRect(batch, px, py, pw, ph, {
      radius: Math.min(3 * scale, pw * 0.2, ph * 0.2),
      fill: paint.top,
      fillBottom: paint.bottom,
      stroke: Math.max(1, paint.stroke) * scale,
      strokeRgba: paint.stroke > 0 ? paint.strokeRgba : NODE_GRAPH_MIDI_KEY_LOOK.ring,
      feather: 0.75,
    });
    const label = key.pad.textContent || "";
    if (!label || typeof nodeGraphGlLinesText !== "function") continue;
    nodeGraphGlLinesText(batch, label, px + pw / 2, py + ph / 2, textOpts({
      px: Math.max(1, Math.min(ph * 0.45, (pw - 4 * sx) / Math.max(1, label.length) / 0.62)),
      maxWidth: Math.max(1, pw - 4 * sx),
      rgba: paint.text,
      align: "center",
      baseline: "middle",
      weight: 700,
      family: NODE_GRAPH_MIDI_KEY_LABEL_FONT,
    }));
  }
  return true;
}

/** Hook: route an overlay press before the shared plate/title drag hit test. */
function nodeGraphGridKeyboardGlPointerDown(event, point) {
  const records = nodeGraphGlGraphState.chrome?.keyboards || [];
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (record.draw !== nodeGraphGridKeyboardGlDraw
      || !nodeGraphGlHitInside(point.x, point.y, record)
      || nodeGraphGlHitCovered(record.id, point.x, point.y)) continue;
    event.preventDefault();
    event.stopPropagation();
    if (typeof nodeGraphModuleRaiseToFront === "function") nodeGraphModuleRaiseToFront(record.id);
    // Capture on the real surface: its existing listeners receive move/up/cancel.
    try { record.surface.setPointerCapture(event.pointerId); } catch (_e) { /* detached pointer */ }
    updateNodeGraphGridKeyboardSignal(nodeGraphGlHitRetarget(event, record.surface));
    return true;
  }
  return false;
}

/** Face-only tiles use the same painter, not a DOM/C2D fallback. */
function nodeGraphGridKeyboardPresentFaceCanvases() {
  if (typeof document === "undefined" || typeof nodeGraphGlLinesBegin !== "function") return;
  document.querySelectorAll(".node-grid-keyboard-surface").forEach((surface) => {
    let canvas = surface.querySelector(":scope > canvas.node-grid-keyboard-face-canvas");
    if (!surface.closest(".node-layout-canvas-face, .node-screen-solo-stage, .node-metamodule-canvas-stage, .node-mini-perform-keyboard")
      || surface.closest(".node-whole-module-face")) {
      if (canvas) canvas.hidden = true;
      return;
    }
    const model = nodeGraphGridKeyboardLayoutKeyRects(surface);
    if (!model) return;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "node-grid-keyboard-face-canvas";
      canvas.setAttribute("aria-hidden", "true");
      Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
      surface.style.position = "relative";
      surface.append(canvas);
    }
    canvas.hidden = false;
    const rect = surface.getBoundingClientRect();
    const scale = Math.max(0.25, rect.width / model.w * (window.devicePixelRatio || 1));
    const pw = Math.max(1, Math.round(model.w * scale));
    const ph = Math.max(1, Math.round(model.h * scale));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale, transparent: true, publishNodeId: "" });
    if (!batch) return;
    nodeGraphGridKeyboardGlDraw(batch, surface, 0, 0, model.w, model.h);
    nodeGraphGlLinesEnd(batch, "alpha");
  });
}

function nodeGraphGridKeyboardSignalFromPad(pad, event, options = {}) {
  const nodeId = nodeGraphKeyboardNodeIdFromElement(pad);
  const col = Number(pad.dataset.gridCol);
  const row = Number(pad.dataset.gridRow);
  const rawMidi = Number(pad.dataset.gridMidi);
  const { x, y } = nodeGraphGridKeyboardXY(col, row);
  const gate = event.buttons > 0 || event.type === "pointerdown" ? 1 : 0;
  const strike = 1;
  const refreshVelocity = options.refreshVelocity === true
    || event.type === "pointerdown"
    || options.gatePulse === true;
  const rawStrike = refreshVelocity
    ? strike
    : (Number(nodeGraphKeyboardRuntime(nodeId).signal?._strikeVelocity) > 0
      ? Number(nodeGraphKeyboardRuntime(nodeId).signal._strikeVelocity)
      : strike);
  const velocity = nodeGraphKeyboardMapStrikeVelocity01(nodeId, rawStrike);
  const signal = nodeGraphKeyboardSignalFromRaw(nodeId, rawMidi, {
    source: "pointer",
    gate,
    gatePulse: 0,
    x,
    y,
    velocity,
  });
  signal._strikeVelocity = rawStrike;
  signal._gridCol = col;
  signal._gridRow = row;
  return signal;
}

function createNodeGraphGridKeyboardBody(node = null) {
  const section = document.createElement("section");
  section.className = "node-grid-keyboard-panel node-grid-keyboard-module node-module-face";
  section.dataset.moduleBand = "face";
  if (node) section.dataset.node = node;
  section.setAttribute("aria-label", "Grid Keyboard");

  const heading = document.createElement("div");
  heading.className = "node-keyboard-heading";
  const controls = document.createElement("div");
  controls.className = "node-keyboard-midi-controls";
  const modeLabel = typeof createNodeGraphMidiModeControl === "function"
    ? createNodeGraphMidiModeControl()
    : document.createElement("span");
  const octave = typeof createNodeGraphPlusMinusControl === "function"
    ? createNodeGraphPlusMinusControl({
      ariaLabel: "Keyboard octave transpose",
      downKey: "keyboardOctaveDown",
      valueKey: "keyboardOctaveValue",
      upKey: "keyboardOctaveUp",
      downAria: "Transpose keyboard down one octave",
      upAria: "Transpose keyboard up one octave",
      valueText: "+0",
    })
    : document.createElement("span");
  const liveReadouts = document.createElement("span");
  liveReadouts.className = "node-keyboard-live-readouts";
  liveReadouts.setAttribute("aria-live", "polite");
  for (const [key, labelText, valueText] of [
    ["frequency", "freq", "-"],
    ["pitch", "pitch", "-"],
    ["midi", "midi", "-"],
    ["velocity", "vel", "-"],
  ]) {
    const item = document.createElement("span");
    item.append(document.createTextNode(`${labelText} `));
    const value = document.createElement("strong");
    value.dataset.keyboardSignal = key;
    value.textContent = valueText;
    item.append(value);
    liveReadouts.append(item);
  }
  const velRow = document.createElement("div");
  velRow.className = "node-keyboard-vel-range";
  const velMinLabel = document.createElement("label");
  velMinLabel.className = "node-keyboard-vel-field";
  const velMinCaption = document.createElement("span");
  velMinCaption.textContent = "Vel Min";
  const velMinInput = document.createElement("input");
  velMinInput.type = "number";
  velMinInput.min = "0";
  velMinInput.max = "127";
  velMinInput.step = "1";
  velMinInput.dataset.keyboardVelMin = "true";
  velMinInput.value = "127";
  velMinLabel.append(velMinCaption, velMinInput);
  const velMaxLabel = document.createElement("label");
  velMaxLabel.className = "node-keyboard-vel-field";
  const velMaxCaption = document.createElement("span");
  velMaxCaption.textContent = "Vel Max";
  const velMaxInput = document.createElement("input");
  velMaxInput.type = "number";
  velMaxInput.min = "0";
  velMaxInput.max = "127";
  velMaxInput.step = "1";
  velMaxInput.dataset.keyboardVelMax = "true";
  velMaxInput.value = "127";
  velMaxLabel.append(velMaxCaption, velMaxInput);
  velRow.append(velMinLabel, velMaxLabel);
  controls.append(modeLabel, octave, liveReadouts);
  heading.append(controls, velRow);

  const performance = document.createElement("div");
  performance.className = "node-grid-keyboard-performance";
  const surface = document.createElement("div");
  surface.className = "node-grid-keyboard-surface";
  surface.setAttribute("aria-label", "Array grid keyboard");
  surface.style.gridTemplateColumns = `repeat(${NODE_GRAPH_GRID_KEYBOARD_COLS}, minmax(0, 1fr))`;
  surface.style.gridTemplateRows = `repeat(${NODE_GRAPH_GRID_KEYBOARD_ROWS}, minmax(0, 1fr))`;
  performance.append(surface);

  const signalBar = document.createElement("div");
  signalBar.className = "node-keyboard-signal-bar";
  signalBar.dataset.midiKeyboardSignalBar = "true";
  for (const [key, labelText, valueText] of [
    ["gate", "Gate", "0"],
    ["gatePulse", "Trigger", "0"],
    ["octave", "Octave", "+0"],
    ["frequency", "ƒ", "-"],
  ]) {
    const item = document.createElement("span");
    item.append(document.createTextNode(`${labelText} `));
    const value = document.createElement("strong");
    value.dataset.keyboardSignal = key;
    value.textContent = valueText;
    item.append(value);
    signalBar.append(item);
  }

  section.append(heading, performance, signalBar);
  return section;
}

function nodeGraphGridKeyboardFillSurface(surface, octave) {
  const black = typeof nodeGraphKeyboardBlackPitchClasses !== "undefined"
    ? nodeGraphKeyboardBlackPitchClasses
    : new Set([1, 3, 6, 8, 10]);
  surface.replaceChildren();
  surface.dataset.gridOctave = String(octave);
  for (let row = 0; row < NODE_GRAPH_GRID_KEYBOARD_ROWS; row += 1) {
    for (let col = 0; col < NODE_GRAPH_GRID_KEYBOARD_COLS; col += 1) {
      const layoutMidi = nodeGraphGridKeyboardMidiAt(col, row);
      if (layoutMidi < 0) continue;
      const midi = nodeGraphGridKeyboardSoundingMidi(layoutMidi, octave);
      if (midi < 0 || midi > 127) continue;
      const pad = document.createElement("button");
      pad.type = "button";
      pad.className = "node-grid-keyboard-pad";
      pad.style.opacity = "0";
      pad.dataset.gridCol = String(col);
      pad.dataset.gridRow = String(row);
      pad.dataset.gridMidi = String(midi);
      pad.style.gridColumn = String(col + 1);
      pad.style.gridRow = String(NODE_GRAPH_GRID_KEYBOARD_ROWS - row);
      const pc = ((midi % 12) + 12) % 12;
      if (black.has(pc)) pad.classList.add("black-pc");
      pad.textContent = typeof nodeGraphKeyboardPitchLabel === "function"
        ? nodeGraphKeyboardPitchLabel(midi)
        : (NODE_GRAPH_GRID_KEYBOARD_PC_NAMES[pc] || "");
      surface.append(pad);
    }
  }
  surface._gridKeyModel = null;
  nodeGraphGridKeyboardLayoutKeyRects(surface);
  if (typeof nodeGraphKeyboardRequestPaint === "function") nodeGraphKeyboardRequestPaint(surface);
}

function renderNodeGraphGridKeyboardPads() {
  // Grid faces paint their own press / latch / chord-memory only.
  // Hardware MIDI must not light a Grid Keyboard; wire MIDI Play Keys in.
  document.querySelectorAll(".node-grid-keyboard-surface").forEach((surface) => {
    const nodeId = nodeGraphKeyboardNodeIdFromElement(surface);
    const octave = nodeGraphKeyboardOctaveFor(nodeId);
    if (surface.dataset.gridOctave !== String(octave)) {
      nodeGraphGridKeyboardFillSurface(surface, octave);
    }
    const rt = nodeGraphKeyboardRuntime(nodeId);
    const signal = rt.signal;
    const playing = Number(signal?.gate) > 0 ? Number(signal.midi) : NaN;
    const playMask = typeof nodeGraphHeldKeysDemux === "function"
      ? nodeGraphHeldKeysDemux(rt.facePlayTransmit, rt.playRegs)
      : null;
    const gold = nodeGraphKeyboardArpLatchView(nodeId).mask;
    const momMask = typeof nodeGraphChordMemoryMomentaryMaskForNode === "function"
      ? nodeGraphChordMemoryMomentaryMaskForNode(nodeId)
      : null;
    surface.querySelectorAll(".node-grid-keyboard-pad[data-grid-midi]").forEach((pad) => {
      const midi = Number(pad.dataset.gridMidi);
      if (!(midi >= 0 && midi <= 127)) return;
      const previousState = pad.className;
      const goldOn = Boolean(gold[midi]);
      pad.classList.toggle("held", goldOn);
      const fromPlay = playMask instanceof Uint8Array && typeof noteMaskGet === "function"
        && noteMaskGet(playMask, midi);
      pad.classList.toggle("active", (Number.isFinite(playing) && playing === midi) || Boolean(fromPlay));
      const playGhost = typeof noteMaskGet === "function"
        && (momMask instanceof Uint8Array && noteMaskGet(momMask, midi));
      pad.classList.toggle("ghost-play", Boolean(playGhost) && !goldOn);
      pad.classList.remove("ghost-arp");
      if (pad.className !== previousState && typeof nodeGraphKeyboardRequestPaint === "function") {
        nodeGraphKeyboardRequestPaint(surface);
      }
    });
  });
  if (typeof nodeGraphChordMemoryPaintKeys === "function") {
    nodeGraphChordMemoryPaintKeys();
  }
}

function updateNodeGraphGridKeyboardSignal(event) {
  const surface = event.currentTarget;
  if (!surface) return;
  const mode = typeof nodeGraphKeyboardModeForElement === "function"
    ? nodeGraphKeyboardModeForElement(surface)
    : "press";
  const pointerId = event.pointerId;
  const pad = nodeGraphGridKeyboardPadFromPointer(event, surface);
  const nodeId = nodeGraphKeyboardNodeIdFromElement(surface);
  const rt = nodeGraphKeyboardRuntime(nodeId);

  const altDown = Boolean(event.altKey || event.getModifierState?.("Alt"));

  if (typeof nodeGraphChordMemoryHandlePointer === "function") {
    const midi = pad ? Number(pad.dataset.gridMidi) : NaN;
    if (nodeGraphChordMemoryHandlePointer(event, surface, midi, {
      nodeId,
      onArpToggle: (slotMidi) => {
        nodeGraphKeyboardToggleHeldMidi(nodeId, slotMidi, 1);
      },
    })) {
      return;
    }
  }

  if (event.type === "pointerdown" && event.ctrlKey && altDown) {
    nodeGraphKeyboardClearArpKeys(nodeId);
    nodeGraphKeyboardClearPlayGate(nodeId);
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.type === "pointerdown" && event.ctrlKey) {
    rt.arpLatchPointerId = pointerId;
    nodeGraphKeyboardClearPlayGate(nodeId);
    clearNodeGraphKeyboardPointerHold(nodeId);
    if (pad) {
      nodeGraphKeyboardToggleHeldMidi(nodeId, Number(pad.dataset.gridMidi), 1);
    }
    try { surface.setPointerCapture?.(pointerId); } catch (_e) { /* ignore */ }
    event.preventDefault();
    return;
  }
  if (rt.arpLatchPointerId === pointerId) {
    if (event.type === "pointerup" || event.type === "pointercancel") {
      try { surface.releasePointerCapture?.(pointerId); } catch (_e) { /* ignore */ }
      rt.arpLatchPointerId = null;
    }
    event.preventDefault();
    return;
  }

  if (event.type === "pointerdown" && !event.ctrlKey && !event.shiftKey && !altDown && pad) {
    const held = nodeGraphKeyboardHeldPointerSignal(nodeId);
    if (held && held.midi === Number(pad.dataset.gridMidi)) {
      clearNodeGraphKeyboardPointerHold(nodeId);
      event.preventDefault();
      return;
    }
  }

  if (event.type === "pointerdown" && mode === "toggle" && !event.ctrlKey) {
    if (pad) nodeGraphKeyboardToggleHeldMidi(nodeId, Number(pad.dataset.gridMidi), 1);
    event.preventDefault();
    return;
  }

  if (event.type === "pointerdown" && (event.shiftKey || mode === "hold")) {
    if (pad) {
      const next = nodeGraphGridKeyboardSignalFromPad(pad, event);
      const held = nodeGraphKeyboardHeldPointerSignal(nodeId);
      if (held && held.midi === next.midi) {
        clearNodeGraphKeyboardPointerHold(nodeId);
      } else {
        rt.pointerHeldSignal = { ...next, gate: 1, gatePulse: 0, source: "pointerHold" };
        renderNodeGraphKeyboardSignal(nodeId, rt.pointerHeldSignal);
      }
    }
    try { surface.setPointerCapture?.(event.pointerId); } catch (_e) { /* ignore */ }
    event.preventDefault();
    return;
  }

  if (event.type === "pointermove") {
    if (rt.arpLatchPointerId != null) return;
    if ((mode === "slide" || mode === "press") && event.buttons > 0 && !event.ctrlKey && pad) {
      const prevRaw = Number(rt.signal?.rawMidi);
      const rawMidi = Number(pad.dataset.gridMidi);
      const next = nodeGraphGridKeyboardSignalFromPad(pad, event, {
        gatePulse: Number.isFinite(prevRaw) && prevRaw !== rawMidi,
        refreshVelocity: true,
      });
      next.gate = 1;
      renderNodeGraphKeyboardSignal(nodeId, next);
      renderNodeGraphGridKeyboardPads();
    }
    event.preventDefault();
    return;
  }

  if (event.type === "pointerup" || event.type === "pointercancel" || event.type === "lostpointercapture") {
    try { surface.releasePointerCapture?.(event.pointerId); } catch (_e) { /* ignore */ }
    const held = nodeGraphKeyboardHeldPointerSignal(nodeId);
    if (held) {
      renderNodeGraphKeyboardSignal(nodeId, { ...held, gate: 1, gatePulse: 0 });
      return;
    }
    const current = rt.signal;
    if (current) {
      renderNodeGraphKeyboardSignal(nodeId, { ...current, gate: 0, gatePulse: 0 });
    }
    renderNodeGraphGridKeyboardPads();
    return;
  }

  if (event.type === "pointerdown" && pad) {
    try { surface.setPointerCapture?.(event.pointerId); } catch (_e) { /* ignore */ }
    renderNodeGraphKeyboardSignal(nodeId, nodeGraphGridKeyboardSignalFromPad(pad, event));
    renderNodeGraphGridKeyboardPads();
  }
}

let nodeGraphGridKeyboardResizeObserver = null;

function bindNodeGraphGridKeyboardEvents() {
  if (!nodeGraphGridKeyboardResizeObserver && typeof ResizeObserver !== "undefined") {
    nodeGraphGridKeyboardResizeObserver = new ResizeObserver((entries) => {
      for (const { target: surface } of entries) {
        const prev = surface._gridKeyModel;
        if (prev && prev.w === surface.clientWidth && prev.h === surface.clientHeight) continue;
        if (!nodeGraphGridKeyboardLayoutKeyRects(surface)) continue;
        if (typeof nodeGraphKeyboardRequestGlRebuild === "function") nodeGraphKeyboardRequestGlRebuild();
        if (typeof nodeGraphKeyboardRequestPaint === "function") nodeGraphKeyboardRequestPaint(surface);
      }
    });
  }
  document.querySelectorAll(".node-grid-keyboard-surface").forEach((surface) => {
    if (surface.dataset.gridKeyboardBound === "true") return;
    surface.dataset.gridKeyboardBound = "true";
    nodeGraphGridKeyboardResizeObserver?.observe(surface);
    surface.addEventListener("pointerdown", updateNodeGraphGridKeyboardSignal);
    surface.addEventListener("pointermove", updateNodeGraphGridKeyboardSignal);
    surface.addEventListener("pointerup", updateNodeGraphGridKeyboardSignal);
    surface.addEventListener("pointercancel", updateNodeGraphGridKeyboardSignal);
    surface.addEventListener("lostpointercapture", updateNodeGraphGridKeyboardSignal);
  });
  renderNodeGraphGridKeyboardPads();
}

if (typeof globalThis !== "undefined") {
  globalThis.createNodeGraphGridKeyboardBody = createNodeGraphGridKeyboardBody;
  globalThis.bindNodeGraphGridKeyboardEvents = bindNodeGraphGridKeyboardEvents;
  globalThis.renderNodeGraphGridKeyboardPads = renderNodeGraphGridKeyboardPads;
  globalThis.nodeGraphGridKeyboardMidiAt = nodeGraphGridKeyboardMidiAt;
}
