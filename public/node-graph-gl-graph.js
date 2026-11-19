// GB-1: cables and grid in one screen-space GL batch.
// Camera changes only reproject a cached polyline list. Look is approximate on purpose.

const nodeGraphGlGraphState = {
  canvas: null,
  dotsCanvas: null,
  // { rgba: number[4], xy: Float32Array, dots: {x,y,rgba,square}[] } world pixels
  wires: [],
  plates: [],
  displays: [],
  chrome: { titles: [], labels: [], jacks: [], sliders: [], keys: [], graphs: [] },
  screen: new Float32Array(0),
  // null = the workspace camera. Set only while nodeGraphGlGraphPresentTile runs this same pass
  // for a perform / layout canvas whole-module tile: { host, ids, zoom, cam, toWorld }.
  view: null,
};

// Client -> graph point for the pass being built (workspace zoom surface, or the tile's zoom-1 module).
function nodeGraphGlGraphToWorld(clientX, clientY) {
  const view = nodeGraphGlGraphState.view;
  return view ? view.toWorld(clientX, clientY) : nodeGraphClientToZoomSurfacePoint(clientX, clientY);
}

function nodeGraphGlGraphZoom() {
  const view = nodeGraphGlGraphState.view;
  if (view) return view.zoom;
  return typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
}

function nodeGraphGlGraphGeometry(id) {
  const view = nodeGraphGlGraphState.view;
  if (!view) return typeof nodeGraphModuleGeometryGet === "function" ? nodeGraphModuleGeometryGet(id) : null;
  if (!view.ids.has(id) || typeof nodeGraphModuleGeometryPublishFromDom !== "function") return null;
  return nodeGraphModuleGeometryPublishFromDom(id, { toSurface: view.toWorld, store: false });
}

function nodeGraphGlGraphEnsureCanvas(host, key, id, className, beforeSelector) {
  let canvas = nodeGraphGlGraphState[key];
  if (!canvas || !canvas.isConnected) {
    canvas = document.createElement("canvas");
    canvas.id = id;
    canvas.className = className;
    canvas.setAttribute("aria-hidden", "true");
    const before = beforeSelector ? host.querySelector(beforeSelector) : null;
    if (before) host.insertBefore(canvas, before);
    else host.append(canvas);
    nodeGraphGlGraphState[key] = canvas;
  }
  return canvas;
}

function nodeGraphGlGraphCssColor(color) {
  const hex = String(color || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  }
  return [0.75, 0.82, 0.9, 1];
}

function nodeGraphGlGraphParseCssColor(color, fallback) {
  const text = String(color || "").trim();
  const hex = nodeGraphGlGraphCssColor(text);
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return hex;
  const rgb = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+)(%?))?/);
  if (rgb) {
    let alpha = 1;
    if (rgb[4] != null && rgb[4] !== "") {
      alpha = rgb[5] === "%" ? Number(rgb[4]) / 100 : Number(rgb[4]);
      if (alpha > 1) alpha /= 255;
    }
    return [
      Number(rgb[1]) / 255,
      Number(rgb[2]) / 255,
      Number(rgb[3]) / 255,
      Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1,
    ];
  }
  // Computed styles come back as color(srgb r g b [/ a]) for colours given in modern syntax (components 0..1).
  const srgb = text.match(/^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)/);
  if (srgb) {
    let alpha = 1;
    if (srgb[4] != null && srgb[4] !== "") alpha = srgb[5] === "%" ? Number(srgb[4]) / 100 : Number(srgb[4]);
    return [
      Math.max(0, Math.min(1, Number(srgb[1]))),
      Math.max(0, Math.min(1, Number(srgb[2]))),
      Math.max(0, Math.min(1, Number(srgb[3]))),
      Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1,
    ];
  }
  return fallback;
}

function nodeGraphGlGraphPortConnected(moduleEl, port) {
  const name = String(port || "");
  if (moduleEl && name && typeof CSS !== "undefined" && CSS.escape) {
    const esc = CSS.escape(name);
    const el = moduleEl.querySelector(
      `.node-port[data-port="${esc}"], .node-param-port[data-port="${esc}"]`,
    );
    return Boolean(el?.classList.contains("connected-port"));
  }
  return false;
}

function nodeGraphGlGraphPortBrightness(moduleEl, port) {
  const connected = nodeGraphGlGraphPortConnected(moduleEl, port);
  const raw = getComputedStyle(moduleEl || document.documentElement).getPropertyValue(
    connected ? "--node-port-used-brightness" : "--node-port-unused-brightness",
  );
  let amount = Number.parseFloat(raw);
  if (!Number.isFinite(amount)) return connected ? 0.85 : 0.68;
  if (String(raw).includes("%") || amount > 1) amount /= 100;
  return Math.max(0, Math.min(1, amount));
}

// Layout pixels inside the module, before the camera transform. Same space as
// the plate box, so the display and the stroke share one pixel grid.
function nodeGraphGlGraphLayoutBox(el, moduleEl) {
  if (typeof nodeGraphModuleLayoutBox === "function") {
    const laid = nodeGraphModuleLayoutBox(el, moduleEl);
    if (!laid || !(laid.w > 1) || !(laid.h > 1)) return null;
    return laid;
  }
  return null;
}

function nodeGraphGlGraphRebuildPlates() {
  const plates = [];
  const displays = [];
  // Back to front (Module Settings > Layer); hit tests read plates the same way.
  const nodes = nodeGraphModuleStackNodes(nodeGraphMvp?.patch);
  for (let i = 0; i < nodes.length; i += 1) {
    const id = String(nodes[i]?.id || "");
    if (!id) continue;
    const geo = nodeGraphGlGraphGeometry(id);
    const box = geo?.box;
    if (!box || !(box.w > 1) || !(box.h > 1)) continue;
    const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
    if (!el || !el.isConnected || el.hidden || el.classList.contains("removed")) continue;
    if (el.getAttribute("data-hide-module-frame") === "1") continue;
    const textBody = el.querySelector(":scope > .node-text-box-body");
    const style = getComputedStyle(el);
    let fill = nodeGraphGlGraphParseCssColor(
      style.getPropertyValue("--node-module-fill"),
      [0.09, 0.1, 0.12, 1],
    );
    let onTop = false;
    if (textBody) {
      const layout = typeof normalizeNodeGraphTextBoxLayout === "function"
        ? normalizeNodeGraphTextBoxLayout(nodes[i]?.layout)
        : nodes[i]?.layout || {};
      onTop = layout.showOnTop === true;
      const bg = nodeGraphGlGraphParseCssColor(
        style.getPropertyValue("--node-text-box-bg-color") || layout.backgroundColor,
        [0.008, 0.016, 0.027, 1],
      );
      const alpha = Number.isFinite(Number(layout.backgroundAlpha))
        ? Math.max(0, Math.min(1, Number(layout.backgroundAlpha)))
        : Number.parseFloat(style.getPropertyValue("--node-text-box-bg-alpha")) || 0.78;
      fill = [bg[0], bg[1], bg[2], alpha];
    }
    plates.push({
      id,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      fill,
      selected: el.classList.contains("selected"),
      textBox: Boolean(textBody),
      onTop,
    });
    // Hidden / Display Height 0: CSS already display:none on the face.
    // Skip GL collection too so a stale layout box cannot leave a T-module
    // (or any) face painted after the shell has collapsed.
    if (!el.classList.contains("oscilloscope-hidden") && !el.classList.contains("face-track-omitted")) {
      const canvases = el.querySelectorAll(NODE_GRAPH_DISPLAY_FACE_SELECTOR);
      for (let c = 0; c < canvases.length; c += 1) {
        const face = canvases[c];
        const page = face.closest("[data-music-player-page]");
        if (page?.hidden || face.closest("[hidden]")) continue;
        if (face.classList.contains("node-round-shape-canvas")) continue;
        const laid = nodeGraphGlGraphLayoutBox(face, el);
        if (!laid) continue;
        // Spawned while paused: the face box may not have a backing store yet.
        // Size it from the layout rectangle so a black plate can be shown.
        if ((!(face.width > 1) || !(face.height > 1)) && typeof nodeGraphDisplayCanvasSizeCss === "function") {
          nodeGraphDisplayCanvasSizeCss(face, laid.w, laid.h);
        }
        displays.push({
          canvas: face,
          id,
          x: box.x + laid.x,
          y: box.y + laid.y,
          w: laid.w,
          h: laid.h,
          output: String(nodes[i]?.type || "") === "output",
        });
      }
    }
  }
  nodeGraphGlGraphState.plates = plates;
  nodeGraphGlGraphState.displays = displays;
  nodeGraphGlGraphState.stack = nodeGraphGlGraphStackGroups(plates, displays);
  nodeGraphGlGraphRebuildChrome();
}

// Plates closer than this (zoom-1 px) count as overlapping: jacks and the
// stroke reach past the plate box.
const NODE_GRAPH_STACK_OVERLAP_PAD = 12;

/**
 * The one ordered list (docs/DISPLAY_COMPOSITE_LAYERING_PLAN.md 4.2): layer,
 * then module, then its parts (plate, chrome, parameter face, displays, display
 * ink). Arrange is one implicit layer (0); plates arrive in module stack order
 * (node.z from Module Settings > Layer, else patch.nodes order); nothing
 * raises on click. Circuit-builder modules have no blend (Canvas tiles do).
 * Consecutive modules that do not overlap share one draw group, so a patch
 * without overlap costs about the same draw calls as one flat pass.
 * "Show on top" Text Boxes stay a post-pass on the veil batch.
 */
function nodeGraphGlGraphStackGroups(plates, displays) {
  const entries = [];
  const byId = new Map();
  for (let i = 0; i < plates.length; i += 1) {
    const plate = plates[i];
    if (plate.onTop) continue;
    const entry = { layer: 0, z: entries.length, blend: "alpha", plate, displays: [] };
    entries.push(entry);
    byId.set(plate.id, entry);
  }
  for (let i = 0; i < displays.length; i += 1) byId.get(displays[i].id)?.displays.push(displays[i]);
  entries.sort((a, b) => a.layer - b.layer || a.z - b.z);
  const pad = NODE_GRAPH_STACK_OVERLAP_PAD;
  const hits = (a, b) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w
    && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
  const groups = [];
  let group = null;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const plate = entry.plate;
    if (!group || group.layer !== entry.layer || group.blend !== entry.blend
      || group.plates.some((other) => hits(plate, other))) {
      group = { layer: entry.layer, blend: entry.blend, plates: [], displays: [] };
      groups.push(group);
    }
    group.plates.push(plate);
    for (let d = 0; d < entry.displays.length; d += 1) group.displays.push(entry.displays[d]);
  }
  return { entries, groups };
}

/**
 * A face quad's pinned filter, the flags its CSS image-rendering used to
 * carry: "nearest" (.display-canvas-pixelated or inline pixelated, e.g.
 * pixel density < 1) at every zoom; "smooth" (.display-canvas-smooth from
 * pinSmoothWhenOff, or inline auto: Matrix / Asciiscope Sharp) at every
 * zoom; "" = nearest only above 2.5x zoom.
 */
function nodeGraphGlGraphFacePin(canvas) {
  const list = canvas?.classList;
  const inline = canvas?.style?.imageRendering || "";
  if (list?.contains("display-canvas-pixelated") || inline === "pixelated") return "nearest";
  if (list?.contains("display-canvas-smooth") || inline === "auto") return "smooth";
  return "";
}

/** Nearest filter for a face quad: its pin, else `over` (past the 2.5x threshold). */
function nodeGraphGlGraphFaceNearest(canvas, over) {
  const pin = nodeGraphGlGraphFacePin(canvas);
  return pin ? pin === "nearest" : Boolean(over);
}

// Display meets the plate edge. The stroke is the band outside that edge.
function nodeGraphGlGraphDisplayScreenRect(face, toX, toY, zoom) {
  return nodeGraphGlGraphScreenRect(face.id, face, toX, toY, zoom);
}

function nodeGraphGlGraphCssPx(el, name) {
  const raw = el?.style?.getPropertyValue?.(name) || "";
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function nodeGraphGlGraphClientWorldBox(el) {
  if (!el || typeof nodeGraphClientToZoomSurfacePoint !== "function") return null;
  const rect = el.getBoundingClientRect();
  if (!(rect.width > 1) || !(rect.height > 1)) return null;
  const tl = nodeGraphGlGraphToWorld(rect.left, rect.top);
  const br = nodeGraphGlGraphToWorld(rect.right, rect.bottom);
  const w = br.x - tl.x;
  const h = br.y - tl.y;
  if (!(w > 0.5) || !(h > 0.5)) return null;
  return { x: tl.x, y: tl.y, w, h };
}

function nodeGraphGlGraphWorldBox(el) {
  if (!el) return null;
  // Tiles map through the face's client rect. The workspace uses layout pixels.
  if (nodeGraphGlGraphState.view) return nodeGraphGlGraphClientWorldBox(el);
  const moduleEl = el.classList?.contains("dsp-node") ? el : el.closest?.(".dsp-node");
  if (!moduleEl || typeof nodeGraphModuleLayoutBox !== "function") return nodeGraphGlGraphClientWorldBox(el);
  const origin = nodeGraphModuleLayoutBox(moduleEl);
  if (!origin) return null;
  if (el === moduleEl) return origin;
  const laid = nodeGraphModuleLayoutBox(el, moduleEl);
  if (!laid) return null;
  return { x: origin.x + laid.x, y: origin.y + laid.y, w: laid.w, h: laid.h };
}

// Project a layout box and snap any edge that sits on the plate to the plate's pixel.
function nodeGraphGlGraphScreenRect(id, world, toX, toY, zoom) {
  let x = toX(world.x);
  let y = toY(world.y);
  let x2 = toX(world.x + world.w);
  let y2 = toY(world.y + world.h);
  const plates = nodeGraphGlGraphState.plates;
  let plate = null;
  for (let i = 0; i < plates.length; i += 1) {
    if (plates[i].id === id) {
      plate = plates[i];
      break;
    }
  }
  if (!plate) return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
  const minX = Math.round(toX(plate.x));
  const minY = Math.round(toY(plate.y));
  const maxX = minX + Math.max(1, Math.round(plate.w * zoom));
  const maxY = minY + Math.max(1, Math.round(plate.h * zoom));
  if (world.x - plate.x <= 1) x = minX;
  if (plate.x + plate.w - (world.x + world.w) <= 1) x2 = maxX;
  if (world.y - plate.y <= 1) y = minY;
  if (plate.y + plate.h - (world.y + world.h) <= 1) y2 = maxY;
  x = Math.max(x, minX);
  y = Math.max(y, minY);
  x2 = Math.min(x2, maxX);
  y2 = Math.min(y2, maxY);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

function nodeGraphGlGraphTextAnchor(el, box) {
  const align = String(getComputedStyle(el).textAlign || "left");
  if (align === "right" || align === "end") {
    return { align: "right", x: box.x + box.w };
  }
  if (align === "center") {
    return { align: "center", x: box.x + box.w * 0.5 };
  }
  return { align: "left", x: box.x };
}

function nodeGraphGlGraphRebuildChrome() {
  const titles = [];
  const labels = [];
  const jacks = [];
  const sliders = [];
  const seeds = [];
  const keys = [];
  const keypads = [];
  const keyboards = [];
  const graphs = [];
  const headerButtons = [];
  const host = document.getElementById("nodeGraphWorkspace");
  // --node-port-diameter is a calc()/round() expression, so read the resolved pixel size from a probe element.
  let diameter = 0;
  if (host) {
    let probe = host.querySelector(":scope > .node-port-diameter-probe");
    if (!probe) {
      probe = document.createElement("div");
      probe.className = "node-port-diameter-probe";
      probe.setAttribute("aria-hidden", "true");
      probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:var(--node-port-diameter);height:0;";
      host.append(probe);
    }
    diameter = Number.parseFloat(getComputedStyle(probe).width) || 0;
  }
  diameter = diameter || 14;
  const radius = diameter * 0.5;
  // Back to front, like the plates: the hit test walks each list from the end.
  const nodes = nodeGraphModuleStackNodes(nodeGraphMvp?.patch);
  for (let i = 0; i < nodes.length; i += 1) {
    const id = String(nodes[i]?.id || "");
    if (nodeGraphGlGraphState.view && !nodeGraphGlGraphState.view.ids.has(id)) continue;
    const el = id && typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
    if (!el || !el.isConnected || el.hidden) continue;
    const title = el.classList.contains("title-hidden")
      ? null
      : el.querySelector(".node-header-title");
    const titleRow = title
      ? (el.querySelector(".node-header-title-row") || title)
      : null;
    const titleBox = titleRow && !titleRow.hidden && !titleRow.closest("[hidden]")
      ? nodeGraphGlGraphWorldBox(titleRow)
      : null;
    if (title && titleBox) {
      titles.push({
        id,
        el: title,
        box: titleBox,
        x: titleBox.x + titleBox.w * 0.5,
        y: titleBox.y + titleBox.h * 0.5,
        h: titleBox.h,
        fill: nodeGraphGlGraphParseCssColor(
          getComputedStyle(el).getPropertyValue("--node-module-title-fill"),
          [0.012, 0.004, 0.075, 1],
        ),
      });
    }
    const ioLabels = el.querySelectorAll(".node-io-label");
    for (let n = 0; n < ioLabels.length; n += 1) {
      const box = nodeGraphGlGraphWorldBox(ioLabels[n]);
      if (!box) continue;
      const output = Boolean(ioLabels[n].closest(".node-io-row.output, .node-io-column.output"));
      const align = output ? "right" : "left";
      const fontPx = Number.parseFloat(getComputedStyle(ioLabels[n]).fontSize) || 13;
      labels.push({
        id,
        el: ioLabels[n],
        box,
        x: align === "right" ? box.x + box.w : box.x,
        y: box.y + box.h * 0.5,
        fontPx,
        align,
      });
    }
    const geo = nodeGraphGlGraphGeometry(id);
    const pins = []
      .concat(geo?.ports || [])
      .concat(geo?.paramJacks || []);
    for (let p = 0; p < pins.length; p += 1) {
      const pin = pins[p];
      if (!pin || pin.visible === false) continue;
      const px = Number(pin.x);
      const py = Number(pin.y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      const io = pin.io || (pin.kind === "output" ? "output" : pin.kind || "input");
      const port = pin.port || pin.key || "";
      const color = typeof nodeGraphPortWireColor === "function"
        ? nodeGraphPortWireColor(id, port, io)
        : "";
      const key = `${Math.round(px)}:${Math.round(py)}`;
      if (jacks.some((jack) => jack.key === key)) continue;
      const rgba = nodeGraphGlGraphParseCssColor(color, nodeGraphGlGraphCssColor(color));
      rgba[3] *= nodeGraphGlGraphPortBrightness(el, port);
      const lit = nodeGraphGlGraphPortConnected(el, port);
      const squareJack = typeof nodeGraphWireJackIsSquare === "function"
        && nodeGraphWireJackIsSquare(id, port, io);
      jacks.push({
        key,
        id,
        port,
        io,
        kind: pin.kind || "",
        signal: Boolean(pin.port),
        x: px,
        y: py,
        r: radius,
        square: squareJack,
        rail: !pin.port && typeof nodeGraphModuleRailOwnsParam === "function"
          && nodeGraphModuleRailOwnsParam(id, pin.key),
        inwardRight: io !== "output",
        inlet: true,
        lit,
        rgba,
      });
    }
    const readouts = el.querySelectorAll(".node-slider-readout");
    for (let s = 0; s < readouts.length; s += 1) {
      const readout = readouts[s];
      const box = nodeGraphGlGraphWorldBox(readout);
      if (!box) continue;
      const input = readout.closest("label")?.querySelector("input[type='range']") || null;
      const valueEl = readout.querySelector(".node-slider-readout-value");
      const labelEl = readout.querySelector(".node-slider-readout-label");
      const unitEl = readout.querySelector(".node-slider-readout-unit");
      const valueBox = nodeGraphGlGraphWorldBox(valueEl);
      const labelBox = nodeGraphGlGraphWorldBox(labelEl);
      const unitBox = nodeGraphGlGraphWorldBox(unitEl);
      const row = readout.closest(".node-parameter-row");
      const rowBox = nodeGraphGlGraphWorldBox(row);
      if (readout.closest(".node-seed-control, .node-parameter-row-seed")) {
        continue;
      }
      sliders.push({
        id,
        readout,
        input,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        hitX: rowBox ? rowBox.x : box.x,
        hitY: rowBox ? rowBox.y : box.y,
        hitW: rowBox ? rowBox.w : box.w,
        hitH: rowBox ? rowBox.h : box.h,
        valueEl,
        valueBox,
        valueAnchor: valueEl && valueBox ? nodeGraphGlGraphTextAnchor(valueEl, valueBox) : null,
        labelEl,
        labelBox,
        labelAnchor: labelEl && labelBox ? nodeGraphGlGraphTextAnchor(labelEl, labelBox) : null,
        unitEl,
        unitBox,
        unitAnchor: unitEl && unitBox ? nodeGraphGlGraphTextAnchor(unitEl, unitBox) : null,
        // 2+ sliders side by side in one param-band row: vertical handle.
        vertical: nodeGraphGlGraphSliderSharesRow(readout, row),
        // Text metrics read once here (ZP-5); presents never call getComputedStyle.
        ...nodeGraphGlGraphSliderTextMetrics(labelEl, valueEl, unitEl),
      });
    }
    const seedControls = el.querySelectorAll(".node-seed-control");
    for (let se = 0; se < seedControls.length; se += 1) {
      const control = seedControls[se];
      const box = nodeGraphGlGraphWorldBox(control);
      if (!box) continue;
      const valueEl = control.querySelector(".node-slider-readout-value");
      const dice = control.querySelector(".node-seed-btn-dice");
      const plus = control.querySelector(".node-seed-btn-plus");
      const minus = control.querySelector(".node-seed-btn-minus");
      seeds.push({
        id,
        control,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        valueEl,
        valueBox: nodeGraphGlGraphWorldBox(valueEl),
        readoutBox: nodeGraphGlGraphWorldBox(control.querySelector(".node-slider-readout")),
        valuePx: Number.parseFloat(valueEl ? getComputedStyle(valueEl).fontSize : "") || 0,
        dice,
        plus,
        minus,
        diceBox: nodeGraphGlGraphWorldBox(dice),
        plusBox: nodeGraphGlGraphWorldBox(plus),
        minusBox: nodeGraphGlGraphWorldBox(minus),
        hover: (dice?.matches?.(":hover") && "dice")
          || (plus?.matches?.(":hover") && "plus")
          || (minus?.matches?.(":hover") && "minus")
          || "",
      });
    }
    const keypadFace = el.querySelector(".node-keypad-face");
    const keypadFaceBox = keypadFace ? nodeGraphGlGraphWorldBox(keypadFace) : null;
    if (keypadFaceBox) {
      keypads.push({ id, face: keypadFace, x: keypadFaceBox.x, y: keypadFaceBox.y, w: keypadFaceBox.w, h: keypadFaceBox.h });
    }
    const keypadKeys = el.querySelectorAll(".node-keypad-key");
    for (let k = 0; k < keypadKeys.length; k += 1) {
      const key = keypadKeys[k];
      const keyBox = nodeGraphGlGraphWorldBox(key);
      if (!keyBox) continue;
      keys.push({
        id,
        el: key,
        face: keypadFace,
        slot: String(key.dataset.slot ?? ""),
        x: keyBox.x,
        y: keyBox.y,
        w: keyBox.w,
        h: keyBox.h,
        label: String(key.querySelector(".node-keypad-key-label")?.textContent || "").trim(),
      });
    }
    // Piano Keyboard: no key elements; keyboard-face-gl.js draws its key model
    // into this surface box (rects from the same layout as the hit test).
    const keyboardSurface = el.querySelector(".node-keyboard-module .node-keyboard-surface");
    const keyboardBox = keyboardSurface ? nodeGraphGlGraphWorldBox(keyboardSurface) : null;
    if (keyboardBox) {
      keyboards.push({ id, surface: keyboardSurface, x: keyboardBox.x, y: keyboardBox.y, w: keyboardBox.w, h: keyboardBox.h });
    }
    const graphFace = el.querySelector(".node-module-graph-display");
    const graphBox = nodeGraphGlGraphWorldBox(graphFace);
    if (graphBox) {
      graphs.push({ id, x: graphBox.x, y: graphBox.y, w: graphBox.w, h: graphBox.h });
    }
    const headerEls = el.querySelectorAll(
      ".node-drag-handle, .node-display-settings-button, .node-metaparameter-button, .node-action-button, .node-bypass-button, .node-execution-order-badge",
    );
    for (let h = 0; h < headerEls.length; h += 1) {
      const box = nodeGraphGlGraphWorldBox(headerEls[h]);
      if (box) headerButtons.push({ id, el: headerEls[h], box });
    }
  }
  const root = document.documentElement;
  const ghostHost = host || root;
  nodeGraphGlGraphState.chrome = {
    titles, labels, jacks, sliders, seeds, keys, keypads, keyboards, graphs, headerButtons,
    // Read once per rebuild, not per present.
    seedLine: typeof nodeGraphGlLinesCss === "function"
      ? nodeGraphGlLinesCss(getComputedStyle(root).getPropertyValue("--line") || "#3a4248")
      : [0.23, 0.26, 0.28, 1],
    ghostFill: typeof nodeGraphGlLinesCss === "function"
      ? nodeGraphGlLinesCss(getComputedStyle(ghostHost).getPropertyValue("--node-slider-ghost-color") || "hsl(262 100% 76% / 0.38)")
      : [0.78, 0.55, 1, 0.38],
    bakePx: 0,
    constraints: nodeGraphGlGraphCollectConstraintBoxes(),
  };
  nodeGraphGlGraphState.chrome.bakePx = nodeGraphGlGraphChromeBakePx(nodeGraphGlGraphState.chrome);
  nodeGraphGlGraphState.chrome.byId = nodeGraphGlGraphChromeById(nodeGraphGlGraphState.chrome);
}

const NODE_GRAPH_CHROME_LISTS = [
  "titles", "labels", "jacks", "sliders", "seeds", "keys", "keypads", "keyboards", "graphs", "headerButtons",
];

function nodeGraphGlGraphChromePart(chrome) {
  const part = { seedLine: chrome.seedLine, ghostFill: chrome.ghostFill, bakePx: chrome.bakePx, constraints: [] };
  for (const name of NODE_GRAPH_CHROME_LISTS) part[name] = [];
  return part;
}

// Each module's chrome on its own, so the present draws it in that module's
// slot of the ordered list (docs/DISPLAY_COMPOSITE_LAYERING_PLAN.md 4.2).
function nodeGraphGlGraphChromeById(chrome) {
  const byId = new Map();
  byId.empty = nodeGraphGlGraphChromePart(chrome);
  for (const name of NODE_GRAPH_CHROME_LISTS) {
    const list = chrome[name] || [];
    for (let i = 0; i < list.length; i += 1) {
      const id = String(list[i]?.id || "");
      let part = byId.get(id);
      if (!part) {
        part = nodeGraphGlGraphChromePart(chrome);
        byId.set(id, part);
      }
      part[name].push(list[i]);
    }
  }
  return byId;
}

// ZP-6: constraint badge boxes are world boxes read at rebuild. The badges
// are drawn into the veil batch, so they ride the cached mesh mid-gesture.
function nodeGraphGlGraphCollectConstraintBoxes() {
  const out = [];
  const nodes = document.querySelectorAll(".node-graph-workspace [data-node-constraint]");
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    if (el.closest(".node-layout-canvas-tile, .node-screen-solo-stage")) continue;
    const keys = String(el.dataset.nodeConstraint || "").split(/\s+/).filter(Boolean);
    if (!keys.length) continue;
    const box = nodeGraphGlGraphWorldBox(el);
    if (box) out.push({ box, keys });
  }
  return out;
}

function nodeGraphGlGraphSliderTextMetrics(labelEl, valueEl, unitEl) {
  const px = (el) => Number.parseFloat(el ? getComputedStyle(el).fontSize : "") || 0;
  const out = { labelPx: px(labelEl), valuePx: px(valueEl), unitPx: 0, unitInk: null };
  if (unitEl) {
    const unitStyle = getComputedStyle(unitEl);
    out.unitPx = Number.parseFloat(unitStyle.fontSize) || 0;
    out.unitInk = nodeGraphGlGraphParseCssColor(
      unitStyle.getPropertyValue("--node-slider-unit-color"),
      [127 / 255, 199 / 255, 217 / 255, 1],
    );
  }
  return out;
}

// ZP-5: one glyph bake size per rebuild, from zoom-1 text sizes. The camera
// scales the atlas (nearest above 2.5x); zooming never re-bakes it.
const NODE_GRAPH_GL_TEXT_BAKE_FLOOR = 64;
function nodeGraphGlGraphChromeBakePx(chrome) {
  let maxPx = NODE_GRAPH_GL_TEXT_BAKE_FLOOR;
  for (const title of chrome.titles || []) {
    const chars = Math.max(1, String(title.el?.textContent || "").trim().length);
    maxPx = Math.max(maxPx, Math.min((title.h || 16) * 0.62, (title.box?.w || 16) / chars / 0.62));
  }
  const buttonNodes = (nodeGraphGlGraphState.view?.host || document)
    .querySelectorAll(".node-plugin-momentary-button, .node-plugin-toggle-button");
  for (let i = 0; i < buttonNodes.length; i += 1) {
    const box = nodeGraphGlGraphWorldBox(buttonNodes[i]);
    if (box) maxPx = Math.max(maxPx, Math.min(box.h * 0.42, box.w * 0.5));
  }
  for (const label of chrome.labels || []) maxPx = Math.max(maxPx, label.fontPx || 13);
  for (const slider of chrome.sliders || []) {
    maxPx = Math.max(maxPx, slider.labelPx || 0, slider.valuePx || 0, slider.unitPx || 0);
  }
  return Math.max(16, Math.min(384, Math.round(maxPx)));
}

function nodeGraphGlGraphTextOpts(opts) {
  const emojiPx = nodeGraphGlGraphState.emojiPx;
  if (emojiPx > 0) opts.emojiPx = emojiPx;
  return opts;
}

function nodeGraphGlGraphSettleTextBake() {
  const chrome = nodeGraphGlGraphState.chrome || {};
  let px = chrome.bakePx || NODE_GRAPH_GL_TEXT_BAKE_FLOOR;
  // Tiles only raise the shared bake, so several tiles never rebake against each other.
  if (nodeGraphGlGraphState.view) px = Math.max(px, nodeGraphGlGraphState.emojiPx || 0);
  nodeGraphGlGraphState.emojiPx = px;
  if (typeof nodeGraphGlLinesSetGlyphBakePx === "function") nodeGraphGlLinesSetGlyphBakePx(px);
}

function nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH, pad = 48) {
  if (nodeGraphGlGraphState.frameCamera) return false;
  return x + w < -pad || y + h < -pad || x > cssW + pad || y > cssH + pad;
}

function nodeGraphGlGraphDrawSliderGhost(batch, readout, x, y, h, zoom, hideGhost, ghostFill) {
  if (hideGhost || !readout?.classList.contains("has-ghost-slider")) return;
  const start = nodeGraphGlGraphCssPx(readout, "--ghost-start");
  const end = nodeGraphGlGraphCssPx(readout, "--ghost-end");
  if (!(end > start)) return;
  nodeGraphGlLinesRect(batch, x + start * zoom, y, (end - start) * zoom, h, ghostFill);
}

/**
 * True when this slider's parameter row sits on one line with another visible
 * parameter row (any module's packed param band). Those draw vertical. A row
 * alone on its line, and choice controls, stay horizontal.
 */
function nodeGraphGlGraphSliderSharesRow(readout, row) {
  if (!readout || !row?.parentElement) return false;
  if (readout.classList.contains("displays-choices") || readout.classList.contains("choices-divided")) return false;
  const top = row.offsetTop;
  const height = row.offsetHeight;
  if (!(height > 0)) return false;
  let onLine = 0;
  for (const sibling of row.parentElement.children) {
    if (!sibling.classList?.contains("node-parameter-row") || sibling.hidden || !(sibling.offsetHeight > 0)) continue;
    if (Math.abs(sibling.offsetTop - top) < Math.max(1, height * 0.5)) onLine += 1;
    if (onLine >= 2) return true;
  }
  return false;
}

/**
 * Vertical param-band slider text: Clock's face-cell layout
 * (node-graph-module-face.js, vertical "cell"): centred lines, label 12.6 px,
 * value 13.8 px, unit as large as the value in the unit ink, 14 px apart.
 * A cell at least 52 px tall stacks Label / Value / Unit (a unitless cell
 * centres Label / Value; a two-word value too wide wraps onto the unit line);
 * a shorter cell draws Label above Value with the unit after the value.
 */
function nodeGraphGlGraphDrawSliderStackedText(batch, slider, x, y, w, h, zoom, labelInk, valueInk, unitInk) {
  const label = String(slider.labelEl?.textContent || "").replace(/\s+/g, " ").trim();
  let text = String(slider.valueEl?.textContent || "").replace(/\s+/g, " ").trim();
  let unit = slider.unitEl && !slider.unitEl.classList.contains("is-empty")
    ? String(slider.unitEl.textContent || "").replace(/\s+/g, " ").trim()
    : "";
  if (slider.input && typeof nodeGraphModuleFaceValueParts === "function") {
    const parts = nodeGraphModuleFaceValueParts(slider.input);
    text = String(parts.text ?? text);
    unit = String(parts.unit || "");
  }
  const z = zoom;
  const cx = x + w * 0.5;
  const maxWidth = Math.max(1, w - 4 * z);
  const put = (str, cy, px, rgba) => {
    if (!str) return;
    nodeGraphGlLinesText(batch, str, cx, cy, nodeGraphGlGraphTextOpts({
      px: Math.max(4, px * z), rgba, align: "center", baseline: "middle", weight: 400, maxWidth,
    }));
  };
  const cellH = h / Math.max(1e-6, z);
  const cw = w / Math.max(1e-6, z);
  const step = 14 * z;
  const cy = y + h * 0.5;
  if (cellH >= 52) {
    const sp = text.indexOf(" ");
    const wraps = !unit && sp > 0 && text.length * 7.6 > cw - 4;
    if (!unit && !wraps) {
      put(label, cy - step * 0.5, 12.6, labelInk);
      put(text, cy + step * 0.5, 13.8, valueInk);
      return;
    }
    put(label, cy - step, 12.6, labelInk);
    if (wraps) {
      put(text.slice(0, sp), cy, 13.8, valueInk);
      put(text.slice(sp + 1), cy + step, 13.8, valueInk);
    } else {
      put(text, cy, 13.8, valueInk);
      put(unit, cy + step, 13.8, unitInk);
    }
    return;
  }
  put(label, cy - 7 * z, 12.6, labelInk);
  put(unit ? `${text} ${unit}` : text, cy + 7 * z, 13.8, valueInk);
}

/** Travel 0..1 of a slider value (thumb base, or a given domain value). */
function nodeGraphGlGraphSliderTravel(input, value) {
  if (!input || typeof nodeSliderTravelFromValue !== "function") return NaN;
  const t = Number(nodeSliderTravelFromValue(input, value));
  return Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : NaN;
}

/**
 * Vertical param-band slider: a fill, no grab handle, the same geometry as the
 * vertical face cells (node-graph-module-face.js): unipolar fills from the
 * bottom up to the value, bipolar fills out from the middle (the mid value's
 * travel) to the value. The MOD ghost is a translucent fill of the same
 * geometry at the modulated value, drawn over the real fill.
 */
function nodeGraphGlGraphDrawSliderFillVertical(batch, readout, input, x, y, w, h, hideGhost, fill, ghostFill) {
  if (!(w > 0) || !(h > 0) || !input) return;
  const domainRaw = Number(input.dataset?.domainValue);
  const t = nodeGraphGlGraphSliderTravel(input, Number.isFinite(domainRaw) ? domainRaw : Number(input.value));
  if (!Number.isFinite(t)) return;
  const bipolar = input.dataset?.bipolar === "true";
  let mid = 0.5;
  if (bipolar) {
    const midValue = Number(input.dataset?.mid);
    const midTravel = Number.isFinite(midValue) ? nodeGraphGlGraphSliderTravel(input, midValue) : NaN;
    if (Number.isFinite(midTravel)) mid = midTravel;
  }
  const span = (travel) => (bipolar
    ? { top: 1 - Math.max(mid, travel), size: Math.abs(travel - mid) }
    : { top: 1 - travel, size: travel });
  const real = span(t);
  if (real.size > 0) nodeGraphGlLinesRect(batch, x, y + real.top * h, w, real.size * h, fill);
  if (hideGhost || !readout?.classList.contains("has-ghost-slider")) return;
  const sentRaw = Number(input.dataset?.sentDomainValue);
  const tg = Number.isFinite(sentRaw) ? nodeGraphGlGraphSliderTravel(input, sentRaw) : NaN;
  if (!Number.isFinite(tg)) return;
  const ghost = span(tg);
  if (ghost.size > 0) nodeGraphGlLinesRect(batch, x, y + ghost.top * h, w, ghost.size * h, ghostFill);
}

// Wraparound handle: the part that would leave the track is clipped, and that
// same width is drawn on the opposite edge. Matches --portal-left-width /
// --portal-right-width from syncNodeSliderPortalHandle.
function nodeGraphGlGraphDrawSliderHandle(batch, readout, x, y, h, zoom, layoutW, fill) {
  const valueStart = nodeGraphGlGraphCssPx(readout, "--value-start");
  const valueEnd = nodeGraphGlGraphCssPx(readout, "--value-end");
  if (!(valueEnd > valueStart) || !(layoutW > 0)) return;
  const wrap = readout?.classList?.contains("wraparound-slider");
  const start = wrap ? Math.max(0, valueStart) : valueStart;
  const end = wrap ? Math.min(layoutW, valueEnd) : valueEnd;
  if (end > start) {
    nodeGraphGlLinesRect(batch, x + start * zoom, y, (end - start) * zoom, h, fill);
  }
  if (!wrap) return;
  const portalLeft = nodeGraphGlGraphCssPx(readout, "--portal-left-width");
  const portalRight = nodeGraphGlGraphCssPx(readout, "--portal-right-width");
  if (portalLeft > 0) {
    nodeGraphGlLinesRect(batch, x, y, Math.min(layoutW, portalLeft) * zoom, h, fill);
  }
  if (portalRight > 0) {
    const width = Math.min(layoutW, portalRight);
    nodeGraphGlLinesRect(batch, x + (layoutW - width) * zoom, y, width * zoom, h, fill);
  }
}

function nodeGraphGlGraphWrapTextBoxLine(text, maxW, px, family, weight) {
  const str = String(text ?? "");
  const measure = (s) => (typeof nodeGraphGlLinesMeasureText === "function"
    ? nodeGraphGlLinesMeasureText(s, px, family, weight)
    : s.length * px * 0.58);
  if (!str) return [""];
  if (!(maxW > 8) || measure(str) <= maxW) return [str];
  const out = [];
  let line = "";
  for (const ch of str) {
    const next = line + ch;
    if (line && measure(next) > maxW) {
      out.push(line);
      line = ch === " " ? "" : ch;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

function nodeGraphGlGraphDrawTextBox(batch, plate, toX, toY, zoom, cssW, cssH) {
  if (!batch || !plate?.textBox) return;
  const x = toX(plate.x);
  const y = toY(plate.y);
  const w = plate.w * zoom;
  const h = plate.h * zoom;
  if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) return;
  const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(plate.id) : null;
  const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plate.id) : null;
  const field = el?.querySelector?.(".node-text-box-input");
  if (field && (document.activeElement === field || field.contains(document.activeElement))) {
    return;
  }
  const layout = typeof normalizeNodeGraphTextBoxLayout === "function"
    ? normalizeNodeGraphTextBoxLayout(node?.layout)
    : node?.layout || {};
  const text = String(layout.text ?? "");
  if (!text && layout.backgroundAlpha === 0) return;
  const grid = Number.parseFloat(
    getComputedStyle(document.getElementById("nodeGraphWorkspace") || document.documentElement)
      .getPropertyValue("--node-grid-size"),
  ) || 28;
  const family = typeof nodeGraphTextBoxFontFamily === "function"
    ? nodeGraphTextBoxFontFamily(layout.font)
    : "Cascadia Mono, Consolas, monospace";
  const weight = Math.max(100, Math.min(900, Number(layout.textWeight) || 400));
  const px = Math.max(6, grid * 0.36 * ((Number(layout.textSizePercent) || 100) / 100) * zoom);
  const lineH = Math.max(0.5, Number(layout.lineHeight) || 1.2);
  const newH = Math.max(0.5, Number(layout.newLineHeight) || lineH);
  const align = layout.horizontalAlign === "left" || layout.horizontalAlign === "right"
    ? layout.horizontalAlign
    : "center";
  const ink = nodeGraphGlGraphParseCssColor(layout.textColor, [0.95, 0.94, 0.92, 1]);
  const paragraphs = String(text).split("\n");
  const lines = [];
  for (let p = 0; p < paragraphs.length; p += 1) {
    const wrapped = nodeGraphGlGraphWrapTextBoxLine(paragraphs[p], w, px, family, weight);
    for (let i = 0; i < wrapped.length; i += 1) {
      lines.push({ text: wrapped[i], gap: i === 0 && p > 0 ? newH : lineH });
    }
  }
  const t = ((Number(layout.verticalAlignPercent) || 50) - 50) / 50;
  const offset = t * h * 2;
  let yy = y + offset + px * 0.5;
  const ax = align === "left" ? x : (align === "right" ? x + w : x + w * 0.5);
  if (typeof nodeGraphGlLinesText !== "function") return;
  for (let i = 0; i < lines.length; i += 1) {
    if (i) yy += px * lines[i].gap;
    if (yy < y - px || yy > y + h + px) continue;
    nodeGraphGlLinesText(batch, lines[i].text, ax, yy, nodeGraphGlGraphTextOpts({
      px,
      rgba: ink,
      align,
      baseline: "middle",
      weight,
      family,
      maxWidth: w,
    }));
  }
}

// UI Dev "lighting: jacks": a connected jack's ring light (1 = its own colour, full strength) and an
// unconnected jack's (how far its colour shows over the workspace background). syncNodeUiDevLightingLevels
// sets them from their definitions; these are only the values before it runs.
var nodeGraphJackActiveLight = 1;
var nodeGraphJackInactiveLight = 0.55;
// A jack below full light keeps at least this much of its colour's own saturation (HSV), so a dim red
// jack still reads red and a dim blue one blue (a white jack stays grey).
const NODE_JACK_MIN_SATURATION = 0.8;

// The workspace background under the plates right now (it darkens with the room dimmer), read once a
// frame. A see-through jack showed the module's stroke light (which follows loudness) through its ring
// and the hole it cuts in the plate, so inlets / outlets brightened and dimmed with loudness. A jack
// below full light is drawn opaque instead: its ring premixed over this colour, and the hole filled
// with it (the plate shader, jack flag `backdrop`).
let nodeGraphGlGraphJackBackdropCache = null;
function nodeGraphGlGraphJackBackdrop() {
  if (nodeGraphGlGraphJackBackdropCache) return nodeGraphGlGraphJackBackdropCache;
  let rgb = [0, 0, 0];
  const el = typeof document !== "undefined" ? document.getElementById("nodeGraphWorkspace") : null;
  const css = el ? String(getComputedStyle(el).backgroundColor || "") : "";
  const srgb = css.match(/color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/);
  if (srgb) rgb = [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])];
  else {
    const parsed = nodeGraphGlGraphParseCssColor(css, null);
    if (parsed) rgb = [parsed[0], parsed[1], parsed[2]];
  }
  nodeGraphGlGraphJackBackdropCache = rgb.map((v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0));
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => { nodeGraphGlGraphJackBackdropCache = null; });
  else nodeGraphGlGraphJackBackdropCache = null;
  return nodeGraphGlGraphJackBackdropCache || rgb;
}

// A jack ring at `light` (0..1): its own colour at 1; below, its colour shown that far over the
// workspace background, opaque, keeping at least NODE_JACK_MIN_SATURATION of the colour's saturation.
function nodeGraphGlGraphJackRing(rgba, light) {
  const a = Math.max(0, Math.min(1, Number(light) || 0));
  if (a >= 1) return [rgba[0], rgba[1], rgba[2], 1];
  const bg = nodeGraphGlGraphJackBackdrop();
  let m = [0, 1, 2].map((i) => bg[i] + (rgba[i] - bg[i]) * a);
  const hsv = (c) => {
    const hi = Math.max(c[0], c[1], c[2]);
    const lo = Math.min(c[0], c[1], c[2]);
    return { hi, lo, s: hi > 0 ? (hi - lo) / hi : 0 };
  };
  const own = hsv(rgba);
  const mixed = hsv(m);
  const floor = own.s * NODE_JACK_MIN_SATURATION;
  if (mixed.hi > 0 && mixed.s < floor && own.hi > own.lo) {
    // Same brightness (HSV value) and hue as the colour, saturation raised to the floor.
    m = [0, 1, 2].map((i) => mixed.hi * (1 - floor * (own.hi - rgba[i]) / (own.hi - own.lo)));
  }
  return [m[0], m[1], m[2], 1];
}

// A connected jack lights its stroke in its own colour. An outlet and the inlet it feeds keep their
// own colours, so a colour change along a cable shows at the jacks.
function nodeGraphGlGraphLitStroke(rgba) {
  return nodeGraphGlGraphJackRing(rgba, Math.max(0, Number(nodeGraphJackActiveLight) || 0));
}

// An unconnected jack: its colour at the "inactive jack light".
function nodeGraphGlGraphUnlitStroke(rgba) {
  return nodeGraphGlGraphJackRing(rgba, Math.max(0, Number(nodeGraphJackInactiveLight) || 0));
}

// mode: "" = the module plate; "dim" = the ambient-light darkening of that plate's body (black fill
// at alpha `dark`, no stroke: the stroke band and jack rings are left alone, so the stroke and its
// loudness animation keep full strength under the dimmer); "emit" = only the stroke (and jack rings).
// Soft light coming out of a module's stroke: one shape per module whose shader fades the light out
// smoothly from the edge (like the module lights in the heatmap, but in the stroke colour). Their colour and strength are resolved at draw time (renderer, `glow`), so they follow the
// module's stroke animation on every replayed frame.
// Module text (and the rest of a module body) stays at least this visible however dark the room is.
const NODE_TEXT_FLOOR = 0.25;
// A module face (slider wells and fills) is a weak light source: this much of its brightness holds in
// a fully dark room.
const NODE_FACE_LIGHT = 0.6;
// Pencil drawings stay at least this bright however dark the room is.
const NODE_DRAWING_FLOOR = 0.9;
// Smooth light out of a module's stroke: falloff radius in screen px, and its peak strength at the edge.
const NODE_STROKE_GLOW_REACH_PX = 16;
const NODE_STROKE_GLOW_ALPHA = 0.85;
// Cables never go fully dark with the room: this much of them stays visible at full dark.
const NODE_CABLE_FLOOR = 0.35;
// UI Dev "lighting: wires": how much light the cables and, apart, their end dots keep in a fully dark
// room (0 = black "shadow" wires, 1 = not dimmed). syncNodeUiDevLightingLevels sets them from their
// definitions; the room floor above stays the default.
var nodeGraphWireDarkLight = NODE_CABLE_FLOOR;
var nodeGraphWireDotDarkLight = NODE_CABLE_FLOOR;
// UI Dev "lighting: wire dots": end dot brightness when lit (1 = its colour, 0 = black, >1 lifts toward white).
var nodeGraphWireDotLitLight = 1;

// Colour of a wire end dot right now: its lit brightness times the light it keeps in the room. The colour
// goes toward black (alpha kept, so a dark dot is a black dot, not a hole); above 1 it lifts toward white.
function nodeGraphGlGraphWireDotLight() {
  const lit = Number(nodeGraphWireDotLitLight);
  return Math.max(0, Number.isFinite(lit) ? lit : 1) * nodeGraphGlGraphWireLight(true);
}

function nodeGraphGlGraphWireDotRgba(rgba) {
  const light = nodeGraphGlGraphWireDotLight();
  if (!rgba || !(light > 1)) return nodeGraphGlGraphShadeRgba(rgba, light);
  const lift = Math.min(1, light - 1);
  return [rgba[0] + (1 - rgba[0]) * lift, rgba[1] + (1 - rgba[1]) * lift, rgba[2] + (1 - rgba[2]) * lift, rgba.length > 3 ? rgba[3] : 1];
}

// Brightness (0..1) a cable (dot = true: a wire end dot) keeps in the room right now. The colour goes
// toward black; the alpha is kept, so a dark cable is a shadow, not a fade-out.
function nodeGraphGlGraphWireLight(dot) {
  if (nodeGraphGlGraphState.view || typeof nodeGraphRoomAmbientDark !== "function") return 1;
  const dark = Math.max(0, Math.min(1, nodeGraphRoomAmbientDark()));
  const keep = Math.max(0, Math.min(1, Number(dot ? nodeGraphWireDotDarkLight : nodeGraphWireDarkLight)));
  return Math.max(Number.isFinite(keep) ? keep : NODE_CABLE_FLOOR, 1 - dark);
}

function nodeGraphGlGraphShadeRgba(rgba, light) {
  if (!rgba || !(light < 1)) return rgba;
  const k = Math.max(0, light);
  return [rgba[0] * k, rgba[1] * k, rgba[2] * k, rgba.length > 3 ? rgba[3] : 1];
}

function nodeGraphGlGraphDrawStrokeGlow(layer, plates, toX, toY, zoom, camera, borderOn, borderIdle) {
  if (!layer || typeof nodeGraphGlLinesModuleOutline !== "function") return;
  const look = typeof nodeGraphModulePlateLook === "function" ? nodeGraphModulePlateLook() : null;
  const reach = NODE_STROKE_GLOW_REACH_PX / (camera ? Math.max(zoom, 1e-3) : 1); // screen px -> batch units
  for (let i = 0; i < plates.length; i += 1) {
    const plate = plates[i];
    const x = Math.round(toX(plate.x));
    const y = Math.round(toY(plate.y));
    const w = Math.max(1, Math.round(plate.w * (camera ? 1 : zoom)));
    const h = Math.max(1, Math.round(plate.h * (camera ? 1 : zoom)));
    const selected = typeof nodeGraphNodeElement === "function"
      && nodeGraphNodeElement(plate.id)?.classList.contains("selected");
    const base = selected ? borderOn : borderIdle;
    const round = look
      ? [look.topRadius * (camera ? 1 : zoom), look.topShape, look.bottomRadius * (camera ? 1 : zoom), look.bottomShape, (look.strokeTopRadius ?? look.topRadius) * (camera ? 1 : zoom)]
      : null;
    // One smooth glow shape per module (mode 4): exponential falloff outside the plate.
    nodeGraphGlLinesModuleOutline(layer, x, y, w, h, reach, base, [], [0, 0, 0, 0], null, round, plate.id, selected === true, 4, NODE_STROKE_GLOW_ALPHA);
  }
}

/**
 * Jack cutouts through a module's display picture, in world units: the same hole the plate shader cuts
 * (radius minus the rim width, inner half only), so the display, plate and stroke are cut by one shape.
 */
function nodeGraphGlGraphJackHoles(jacks, plate, plateStyle, camera, device) {
  const strokeCss = Number.parseFloat(plateStyle.getPropertyValue("--node-module-idle-stroke-width")) || 1;
  const zoom = camera?.zoom > 0 ? camera.zoom : 1;
  const k = Math.max(0.0001, zoom * device);
  const rimPx = Math.max(1, Math.floor(strokeCss * k + 0.5));
  const rimWorld = rimPx / k;
  // The plate's walls snapped to whole screen pixels, as the plate shader does; a wall jack's centre is the
  // snapped wall plus one stroke width outward.
  const camX = camera?.x || 0;
  const wallMinPx = plate ? Math.ceil((plate.x - camX) * k - 0.5) : 0;
  const wallMaxPx = plate ? Math.max(Math.ceil((plate.x + plate.w - camX) * k - 0.5), wallMinPx + 1) : 0;
  const holes = [];
  for (let i = 0; i < jacks.length && holes.length < 16; i += 1) {
    const jack = jacks[i];
    if (jack.rail) continue;
    const r = Math.max(0, jack.r - rimWorld);
    if (!(r > 0)) continue;
    const side = jack.io === "output" ? -1 : 1;
    let x = jack.x;
    if (plate) {
      const wallPx = side > 0 ? wallMinPx : wallMaxPx;
      if (Math.abs((x - camX) * k - wallPx) < (jack.r * k + rimPx + 1)) x = camX + (wallPx - side * rimPx) / k;
    }
    holes.push({ x, y: jack.y, r: jack.square ? -r : r, side });
  }
  return holes;
}

/** The IO view has the jack cutouts switched off (View A). */
function nodeGraphGlGraphIoJacksOff() {
  const cfg = typeof nodeGraphIoViewConfig === "function" ? nodeGraphIoViewConfig() : null;
  return Boolean(cfg && cfg.jacks === false);
}

/** Module opted in to drawing its jacks and labels over its display (definition.ioOverlay). */
function nodeGraphGlGraphIoOverlay(id) {
  const type = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id)?.type : "";
  return Boolean(type && typeof nodeGraphModuleUsesLayoutB === "function" && nodeGraphModuleUsesLayoutB(type));
}

function nodeGraphGlGraphDrawPlate(batch, plate, toX, toY, zoom, cssW, cssH, plateStyle, borderOn, borderIdle, mode = "", dark = 0) {
  const x = toX(plate.x);
  const y = toY(plate.y);
  const w = plate.w * zoom;
  const h = plate.h * zoom;
  if (!batch?.camera) {
    if (x + w < 0 || y + h < 0 || x > cssW || y > cssH) return;
  }
  const strokeW = Number.parseFloat(plateStyle.getPropertyValue("--node-module-idle-stroke-width")) || 1;
  const edge = strokeW * zoom;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const w0 = Math.max(1, Math.round(w));
  const h0 = Math.max(1, Math.round(h));
  const selected = typeof nodeGraphNodeElement === "function"
    && nodeGraphNodeElement(plate.id)?.classList.contains("selected");
  let color = selected ? borderOn : borderIdle;
  // The dim covers the body only. Its stroke is transparent: darkening the stroke band and then
  // redrawing a translucent stroke over it left the (loudness-animated) stroke dimmed by the room.
  if (mode === "dim" || mode === "rim") color = [0, 0, 0, 0];
  // "shine": the module reflecting the mouse lamp, in its own stroke colour (strongest near the lamp).
  if (mode === "shine") color = [color[0], color[1], color[2], 0.5];
  const plateJacks = [];
  const allJacks = nodeGraphGlGraphState.chrome?.jacks || [];
  for (let j = 0; j < allJacks.length; j += 1) {
    const jack = allJacks[j];
    if (jack.id !== plate.id || jack.rail) continue;
    // The plate keeps its jack notches, so its stroke wraps each jack instead of crossing it; the display is
    // cut the same way afterwards (nodeGraphGlGraphDrawJackHalves). The IO view can switch jacks off.
    if (mode === "" && nodeGraphGlGraphIoJacksOff()) continue;
    // Connected, or a wire is being dragged out of it right now.
    const lit = jack.lit || nodeGraphGlGraphJackDragging(jack);
    plateJacks.push({
      x: toX(jack.x),
      y: toY(jack.y),
      r: jack.r * zoom,
      // Stroke only: a connected jack draws its stroke at the active jack light, an unconnected one
      // at the inactive jack light (UI Dev "lighting: jacks").
      rgba: mode === "dim" || mode === "shine"
        ? [0, 0, 0, 0]
        : (lit ? nodeGraphGlGraphLitStroke(jack.rgba) : nodeGraphGlGraphUnlitStroke(jack.rgba)),
      square: jack.square === true,
      inlet: jack.inlet === true,
      // Below full light: the plate shader fills the hole this jack cuts in the plate with the workspace
      // background, so the module's stroke light (it follows loudness) does not show through.
      backdrop: mode === "" && (lit ? Number(nodeGraphJackActiveLight) : Number(nodeGraphJackInactiveLight)) < 1
        ? nodeGraphGlGraphJackBackdrop() : null,
    });
  }
  if (typeof nodeGraphGlLinesModuleOutline === "function") {
    const cuts = typeof nodeGraphModuleRailBorderCuts === "function" ? nodeGraphModuleRailBorderCuts(batch, plate, toX, toY, zoom) : null;
    const look = typeof nodeGraphModulePlateLook === "function" ? nodeGraphModulePlateLook() : null;
    const round = look
      ? [look.topRadius * zoom, look.topShape, look.bottomRadius * zoom, look.bottomShape, (look.strokeTopRadius ?? look.topRadius) * zoom]
      : null;
    const fill = mode === "rim" ? [0, 0, 0, 0] : mode === "dim" ? [0, 0, 0, dark]
      : (mode === "emit" ? [0, 0, 0, 0]
        : (mode === "shine" ? [color[0], color[1], color[2], 0.28] : plate.fill));
    nodeGraphGlLinesModuleOutline(batch, x0, y0, w0, h0, edge, color, plateJacks, fill, cuts, round, mode === "dim" || mode === "shine" ? "" : plate.id, selected === true, mode === "dim" ? true : (mode === "shine" ? 2 : (mode === "rim" ? 5 : false)));
  }
}

// Keypad look from the face's inline vars (nodeGraphKeypadApplyLayout and
// nodeGraphKeypadSyncLookPixels write them), falling back to keypad-ui.css.
function nodeGraphGlGraphKeypadLook(face) {
  const style = face?.style;
  const read = (name, fallback) => String(style?.getPropertyValue(name) || "").trim() || fallback;
  const color = (name, fallback) => nodeGraphGlGraphParseCssColor(read(name, fallback), nodeGraphGlGraphCssColor(fallback));
  const number = (name, fallback) => {
    const n = Number.parseFloat(read(name, ""));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    background: color("--node-keypad-background-color", "#000000"),
    button: color("--node-keypad-button-color", "#f4f2e2"),
    hover: color("--node-keypad-hover-color", "#c7edea"),
    down: color("--node-keypad-down-color", "#ffffff"),
    text: color("--node-keypad-text-color", "#1f1f1f"),
    stroke: color("--node-keypad-stroke-color", "#e2dcc7"),
    // Fractions, not cached px: the draw sizes them from the key it draws, so a
    // Size / Width / Height drag never leaves the corners sized for the old key.
    strokeT: typeof nodeGraphKeypadClampStroke === "function"
      ? nodeGraphKeypadClampStroke(face?.dataset?.keypadStroke)
      : Math.max(0, Math.min(1, Number(face?.dataset?.keypadStroke) || 0)),
    rounding: Math.max(0, Math.min(100, Number(face?.dataset?.keypadRounding) || 0)),
    // Smootherstep edge width, CSS px (Display Settings Smoothing).
    smoothing: Number.isFinite(Number.parseFloat(face?.dataset?.keypadSmoothing))
      ? Math.max(0, Number.parseFloat(face.dataset.keypadSmoothing))
      : 1,
    textSize: Math.max(0, number("--node-keypad-text-size", 0.87708066581306)),
    weight: number("--node-keypad-text-weight", 900),
    family: read("--node-keypad-font", "\"Thasadith\", sans-serif"),
  };
}

function nodeGraphGlGraphDrawOver(batch, draw) {
  if (!batch) return;
  batch._over = true;
  draw();
  batch._over = false;
}

function nodeGraphGlGraphSeedCell(el, toX, toY, zoom) {
  const box = nodeGraphGlGraphWorldBox(el);
  if (!box) return null;
  return { x: toX(box.x), y: toY(box.y), w: box.w * zoom, h: box.h * zoom };
}

function nodeGraphGlGraphDrawSeedBar(batch, cx, cy, w, h, ink) {
  nodeGraphGlLinesRect(batch, cx - w * 0.5, cy - h * 0.5, w, h, ink);
}

function nodeGraphGlGraphDrawSeedDie(batch, cell, ink) {
  const side = Math.min(cell.w, cell.h) * 0.62;
  const stroke = Math.max(1, Math.min(cell.w, cell.h) * 0.07);
  const x = cell.x + (cell.w - side) * 0.5;
  const y = cell.y + (cell.h - side) * 0.5;
  nodeGraphGlLinesRect(batch, x, y, side, stroke, ink);
  nodeGraphGlLinesRect(batch, x, y + side - stroke, side, stroke, ink);
  nodeGraphGlLinesRect(batch, x, y, stroke, side, ink);
  nodeGraphGlLinesRect(batch, x + side - stroke, y, stroke, side, ink);
  const r = side * 0.08;
  const pips = [
    [0.24, 0.24], [0.76, 0.24], [0.5, 0.5], [0.24, 0.76], [0.76, 0.76],
  ];
  if (typeof nodeGraphGlLinesDot !== "function") return;
  for (let i = 0; i < pips.length; i += 1) {
    nodeGraphGlLinesDot(batch, x + side * pips[i][0], y + side * pips[i][1], r, 0.7, ink);
  }
}

function nodeGraphGlGraphDrawSeeds(batch, toX, toY, zoom, cssW, cssH) {
  const seeds = nodeGraphGlGraphState.chrome?.seeds || [];
  if (!seeds.length) return;
  const line = nodeGraphGlGraphState.chrome?.seedLine || [0.23, 0.26, 0.28, 1];
  // World boxes come from the rebuild (no layout reads per present).
  const cell = (box) => (box ? { x: toX(box.x), y: toY(box.y), w: box.w * zoom, h: box.h * zoom } : null);
  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];
    const host = cell(seed);
    if (!host || nodeGraphGlGraphOutside(host.x, host.y, host.w, host.h, cssW, cssH)) continue;
    const valueEl = seed.valueEl;
    const { dice, plus, minus } = seed;
    const valueCell = cell(seed.readoutBox);
    const diceCell = cell(seed.diceBox);
    const plusCell = cell(seed.plusBox);
    const minusCell = cell(seed.minusBox);
    const hoverCell = (dice?.matches?.(":hover") && diceCell)
      || (plus?.matches?.(":hover") && plusCell)
      || (minus?.matches?.(":hover") && minusCell)
      || null;
    const text = String(valueEl?.textContent || "").replace(/\s+/g, " ").trim();
    // The seed fit writes an inline size per value; else the rebuild's computed size.
    const cssPx = Number.parseFloat(valueEl?.style?.fontSize || "") || seed.valuePx || 0;
    nodeGraphGlGraphDrawSeedWidget(batch, { host, value: valueCell, dice: diceCell, plus: plusCell, minus: minusCell }, text, zoom, { hoverCell, cssPx, line });
  }
}

/**
 * The one seed widget: [code][die][+][-] (screen px cells). Every seed /
 * random control draws through this (param rows and hand-written faces).
 */
function nodeGraphGlGraphDrawSeedWidget(batch, cells, text, zoom, opts = {}) {
  const ink = [0.98, 0.992, 1, 0.92];
  const well = [0.031, 0.043, 0.051, 1];
  const line = opts.line || nodeGraphGlGraphState.chrome?.seedLine || [0.23, 0.26, 0.28, 1];
  const hover = [1, 1, 1, 0.08];
  const { host, value: valueCell, dice: diceCell, plus: plusCell, minus: minusCell } = cells;
  const hoverCell = opts.hoverCell || null;
  const cssPx = opts.cssPx || 0;
  nodeGraphGlGraphDrawOver(batch, () => {
    nodeGraphGlLinesRect(batch, host.x, host.y, host.w, host.h, well);
    const stroke = Math.max(1, zoom);
    nodeGraphGlLinesRect(batch, host.x, host.y, host.w, stroke, line);
    nodeGraphGlLinesRect(batch, host.x, host.y + host.h - stroke, host.w, stroke, line);
    nodeGraphGlLinesRect(batch, host.x, host.y, stroke, host.h, line);
    nodeGraphGlLinesRect(batch, host.x + host.w - stroke, host.y, stroke, host.h, line);
    const split = (cell) => {
      if (!cell) return;
      nodeGraphGlLinesRect(batch, cell.x, cell.y, stroke, cell.h, line);
    };
    split(diceCell);
    split(plusCell);
    split(minusCell);
    if (hoverCell) {
      nodeGraphGlLinesRect(batch, hoverCell.x, hoverCell.y, hoverCell.w, hoverCell.h, hover);
    }
    if (diceCell) nodeGraphGlGraphDrawSeedDie(batch, diceCell, ink);
    const bar = (cell, cross) => {
      if (!cell) return;
      const t = Math.max(1, Math.min(cell.w, cell.h) * 0.09);
      const len = Math.min(cell.w, cell.h) * 0.62;
      const cx = cell.x + cell.w * 0.5;
      const cy = cell.y + cell.h * 0.5;
      nodeGraphGlGraphDrawSeedBar(batch, cx, cy, len, t, ink);
      if (cross) nodeGraphGlGraphDrawSeedBar(batch, cx, cy, t, len, ink);
    };
    bar(minusCell, false);
    bar(plusCell, true);
  });
  if (text && valueCell && typeof nodeGraphGlLinesText === "function") {
    const pad = Math.max(2, valueCell.h * 0.12) + 4 * zoom;
    const fillPx = Math.max(
      6,
      Math.min((valueCell.h - pad * 2) / 0.78, (valueCell.w - pad * 2) / Math.max(1, text.length) / 0.58),
    );
    nodeGraphGlLinesText(batch, text, valueCell.x + valueCell.w * 0.5, valueCell.y + valueCell.h * 0.5, nodeGraphGlGraphTextOpts({
      px: Math.max(6, Math.min(cssPx > 4 ? cssPx * zoom : fillPx, fillPx)),
      rgba: ink,
      align: "center",
      baseline: "middle",
      weight: 600,
      family: "Consolas, \"Courier New\", monospace",
    }));
  }
}

function nodeGraphGlGraphDrawLabels(batch, toX, toY, zoom, cssW, cssH) {
  const labels = nodeGraphGlGraphState.chrome?.labels || [];
  const ink = [1, 1, 1, 1];
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    let text = String(label.el?.textContent || "").replace(/\s+/g, " ").trim();
    if (typeof nodeGraphIoViewLabelText === "function") text = nodeGraphIoViewLabelText(text);
    if (!text || typeof nodeGraphGlLinesText !== "function") continue;
    const lx = toX(label.x);
    const ly = toY(label.y);
    if (nodeGraphGlGraphOutside(lx, ly, 0, 0, cssW, cssH, 480)) continue;
    nodeGraphGlLinesText(batch, text, lx, ly, nodeGraphGlGraphTextOpts({
      px: Math.max(1, (label.fontPx || 13) * zoom),
      rgba: ink,
      align: label.align,
      baseline: "middle",
      weight: 400,
    }));
  }
}

function nodeGraphGlGraphDrawChrome(batch, toX, toY, zoom, cssW, cssH, skipLabels = false) {
  const chrome = nodeGraphGlGraphState.chrome;
  if (!chrome) return;
  // Face-cell palette (node-graph-module-face.js NodeGraphFaceInk): cellFill
  // well, cellValueFill fill, label / value ink.
  const ink = [1, 1, 1, 1];
  const labelInk = [0xcf / 255, 0xdd / 255, 0xe5 / 255, 1];
  const well = [0x0e / 255, 0x11 / 255, 0x17 / 255, 1];
  const cellFill = [0x1c / 255, 0x33 / 255, 0x4c / 255, 1];
  // Position handle: the old handle's size and shape in the face palette (choiceOn).
  const valueFill = [0x1c / 255, 0x33 / 255, 0x4c / 255, 1]; // face column fill (#1c334c)
  const ghostHost = document.getElementById("nodeGraphWorkspace");
  const hideGhost = ghostHost?.classList.contains("hide-slider-position");
  const ghostFill = chrome.ghostFill || [0.78, 0.55, 1, 0.38];
  const sliders = chrome.sliders || [];
  for (let i = 0; i < sliders.length; i += 1) {
    const slider = sliders[i];
    const screen = nodeGraphGlGraphScreenRect(slider.id, {
      x: slider.x, y: slider.y, w: slider.w, h: slider.h,
    }, toX, toY, zoom);
    const x = screen.x;
    const y = screen.y;
    const w = screen.w;
    const h = screen.h;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) continue;
    if (slider.readout?.closest?.(".node-seed-control, .node-parameter-row-seed")) {
      continue;
    }
    nodeGraphGlGraphDrawOver(batch, () => {
      nodeGraphGlLinesRect(batch, x, y, w, h, well);
      const readout = slider.readout;
      const divided = readout?.classList?.contains("choices-divided");
      if (divided) {
        // Switch: the selected slot's handle, inset 2 px from the slot on
        // every side (no dividers) so it reads as a movable object. Placed
        // exactly against the well (same unrounded coordinates as the well
        // rect above): rounding only the handle shifted it against the well
        // at fractional positions, taking the top gap into the bottom one.
        const cell = readout.querySelector(".node-choice-debug-cell-fill");
        const fx = Number(cell?.getAttribute("x"));
        const fw = Number(cell?.getAttribute("width"));
        if (fw > 0) {
          const gap = 2 * zoom;
          const sx0 = x + Math.max(0, fx) * zoom;
          const sx1 = x + Math.min(slider.w, Math.max(0, fx) + fw) * zoom;
          const hw = sx1 - sx0 - 2 * gap;
          const hh = h - 2 * gap;
          if (hw > 0 && hh > 0) nodeGraphGlLinesRect(batch, sx0 + gap, y + gap, hw, hh, cellFill);
        }
        nodeGraphGlGraphDrawSliderGhost(batch, readout, x, y, h, zoom, hideGhost, ghostFill);
        return;
      }
      if (slider.vertical) {
        nodeGraphGlGraphDrawSliderFillVertical(batch, readout, slider.input, x, y, w, h, hideGhost, valueFill, ghostFill);
        return;
      }
      // Generic slider: position handle only, on the face-cell well.
      // Wraparound clips it to the track and draws the overflow on the other edge.
      nodeGraphGlGraphDrawSliderHandle(batch, readout, x, y, h, zoom, slider.w, valueFill);
      nodeGraphGlGraphDrawSliderGhost(batch, readout, x, y, h, zoom, hideGhost, ghostFill);
    });
    if (slider.vertical && typeof nodeGraphGlLinesText === "function") {
      nodeGraphGlGraphDrawSliderStackedText(batch, slider, x, y, w, h, zoom, labelInk, ink, slider.unitInk || [127 / 255, 199 / 255, 217 / 255, 1]);
      continue;
    }
    if (typeof nodeGraphGlLinesText === "function") {
      const labelText = String(slider.labelEl?.textContent || "").replace(/\s+/g, " ").trim();
      const valueText = String(slider.valueEl?.textContent || "").replace(/\s+/g, " ").trim();
      if (labelText && slider.labelBox && slider.labelAnchor) {
        nodeGraphGlLinesText(
          batch,
          labelText,
          toX(slider.labelAnchor.x),
          toY(slider.labelBox.y + slider.labelBox.h * 0.5),
          nodeGraphGlGraphTextOpts({
            px: Math.max(8, (slider.labelPx || 12.6) * zoom),
            rgba: labelInk,
            align: slider.labelAnchor.align,
            baseline: "middle",
            weight: 400,
          }),
        );
      }
      if (valueText && slider.valueBox && slider.valueAnchor) {
        nodeGraphGlLinesText(
          batch,
          valueText,
          toX(slider.valueAnchor.x),
          toY(slider.valueBox.y + slider.valueBox.h * 0.5),
          nodeGraphGlGraphTextOpts({
            px: Math.max(8, (slider.valuePx || 13.8) * zoom),
            rgba: ink,
            align: slider.valueAnchor.align,
            baseline: "middle",
            weight: 400,
          }),
        );
      }
      const unitText = String(slider.unitEl?.textContent || "").replace(/\s+/g, " ").trim();
      if (unitText && slider.unitBox && slider.unitAnchor && !slider.unitEl.classList.contains("is-empty")) {
        const unitInk = slider.unitInk || [127 / 255, 199 / 255, 217 / 255, 1];
        nodeGraphGlLinesText(
          batch,
          unitText,
          toX(slider.unitAnchor.x),
          toY(slider.unitBox.y + slider.unitBox.h * 0.5),
          nodeGraphGlGraphTextOpts({
            px: Math.max(8, (slider.unitPx || 11) * zoom),
            rgba: unitInk,
            align: slider.unitAnchor.align,
            baseline: "middle",
            weight: 400,
          }),
        );
      }
    }
  }
  nodeGraphGlGraphDrawSeeds(batch, toX, toY, zoom, cssW, cssH);
  if (!skipLabels) nodeGraphGlGraphDrawLabels(batch, toX, toY, zoom, cssW, cssH);
  const titles = chrome.titles || [];
  for (let i = 0; i < titles.length; i += 1) {
    const title = titles[i];
    if (title.fill && title.box && typeof nodeGraphGlLinesRect === "function") {
      const screen = nodeGraphGlGraphScreenRect(title.id, title.box, toX, toY, zoom);
      const bx = screen.x;
      const by = screen.y;
      const bw = screen.w;
      const bh = screen.h;
      nodeGraphGlGraphDrawOver(batch, () => {
        nodeGraphGlLinesRect(batch, bx, by, bw, bh, title.fill);
      });
    }
    if (title.el?.dataset?.titleEditing === "1") continue;
    const text = String(title.el?.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || typeof nodeGraphGlLinesText !== "function") continue;
    const tx = toX(title.x);
    const ty = toY(title.y);
    if (nodeGraphGlGraphOutside(tx, ty, 0, 0, cssW, cssH, 480)) continue;
    const chars = Math.max(1, text.length);
    const fit = Math.min(title.h * 0.62, (title.box?.w || title.h) / chars / 0.62);
    const room = Math.max(8, ((title.box?.w || 0) - 12) * zoom);
    nodeGraphGlLinesText(batch, text, tx, ty, nodeGraphGlGraphTextOpts({
      px: Math.max(8, fit * zoom),
      maxWidth: room,
      rgba: [1, 1, 1, 1],
      align: "center",
      baseline: "middle",
      weight: 400,
    }));
  }
  // Keypad: the DOM face is transparent in GL mode, so its Display Settings
  // (keypad-ui.css vars set inline by nodeGraphKeypadApplyLayout) draw here.
  const keypadList = chrome.keypads || [];
  for (let i = 0; i < keypadList.length; i += 1) {
    const pad = keypadList[i];
    const x = toX(pad.x);
    const y = toY(pad.y);
    const w = pad.w * zoom;
    const h = pad.h * zoom;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) continue;
    const look = nodeGraphGlGraphKeypadLook(pad.face);
    nodeGraphGlGraphDrawOver(batch, () => nodeGraphGlLinesRect(batch, x, y, w, h, look.background));
  }
  const keyList = chrome.keys || [];
  for (let i = 0; i < keyList.length; i += 1) {
    const key = keyList[i];
    if (key.face?.classList?.contains("is-empty")) continue;
    const x = toX(key.x);
    const y = toY(key.y);
    const w = key.w * zoom;
    const h = key.h * zoom;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) continue;
    const look = nodeGraphGlGraphKeypadLook(key.face);
    const cls = key.el?.classList;
    const down = cls?.contains("is-down") || cls?.contains("is-active");
    const hover = !down && (cls?.contains("is-hover")
      || (key.face?.dataset.keypadHoverSlot ?? null) === key.slot);
    const fill = down ? look.down : (hover ? look.hover : look.button);
    // keypad-ui.js nodeGraphKeypadSyncLookPixels, from this key's own size.
    const halfMin = Math.min(key.w, key.h) * 0.5;
    const stroke = Math.round(look.strokeT * halfMin) * zoom;
    const radius = Math.round((look.rounding / 100) * halfMin) * zoom;
    // One SDF box: the stroke sits inside the edge and shares the corner
    // curve with the fill, smootherstep edges (gl-line-renderer round rect).
    nodeGraphGlLinesRoundRect(batch, x, y, w, h, {
      radius, stroke, feather: look.smoothing, fill, strokeRgba: look.stroke,
    });
    if (key.label && typeof nodeGraphGlLinesText === "function") {
      // keypad-ui.css: font-size = text-size * min(100cqw, 100cqh) of the key's content box.
      const px = look.textSize * Math.max(0, Math.min(w, h) - stroke * 2);
      if (px >= 1) {
        nodeGraphGlLinesText(batch, key.label, x + w * 0.5, y + h * 0.5, nodeGraphGlGraphTextOpts({
          px,
          rgba: look.text,
          align: "center",
          baseline: "middle",
          weight: look.weight,
          family: look.family,
        }));
      }
    }
  }
  // Piano Keyboard faces: key model state + layout rects (keyboard-face-gl.js).
  const keyboardList = chrome.keyboards || [];
  for (let i = 0; i < keyboardList.length; i += 1) {
    const kb = keyboardList[i];
    const x = toX(kb.x);
    const y = toY(kb.y);
    const w = kb.w * zoom;
    const h = kb.h * zoom;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH)) continue;
    if (typeof nodeGraphKeyboardGlDraw === "function") nodeGraphKeyboardGlDraw(batch, kb.surface, x, y, w, h);
  }
  // Step / Smooth Graph faces are display canvases (node-graph-graph-face-gl.js),
  // composited with the module's other displays; chrome.graphs is hit-only.
}

function nodeGraphGlGraphPlateVeiled(plate) {
  const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(plate.id) : null;
  return Boolean(el && (el.classList.contains("bypassed")
    || el.querySelector(":scope > .node-module-under-construction")));
}

/** Veils over the bypassed / under-construction plates of `plates` (layer is made only when one is veiled). */
function nodeGraphGlGraphDrawVeils(target, plates, toX, toY, zoom) {
  if (!target || typeof nodeGraphGlLinesVeil !== "function") return;
  let layer = null;
  for (let i = 0; i < plates.length; i += 1) {
    const plate = plates[i];
    if (!nodeGraphGlGraphPlateVeiled(plate)) continue;
    layer = layer || nodeGraphGlLinesLayer(target);
    if (!layer) return;
    nodeGraphGlLinesVeil(layer, toX(plate.x), toY(plate.y), plate.w * zoom, plate.h * zoom, 18 * zoom);
  }
}

/** Module id -> elements matching selector, from one query per present. */
function nodeGraphGlGraphElementsById(root, selector) {
  const byId = new Map();
  const found = root.querySelectorAll(selector);
  for (let i = 0; i < found.length; i += 1) {
    const id = String(found[i].closest(".dsp-node")?.dataset?.node || "");
    if (!id) continue;
    let list = byId.get(id);
    if (!list) {
      list = [];
      byId.set(id, list);
    }
    list.push(found[i]);
  }
  return byId;
}

function nodeGraphGlGraphDrawButtonCaptions(batch, toX, toY, zoom, cssW, cssH, buttons) {
  if (!batch || typeof nodeGraphGlLinesText !== "function") return;
  for (let i = 0; i < buttons.length; i += 1) {
    const button = buttons[i];
    const caption = String(button.dataset.glCaption || "").replace(/\s+/g, " ").trim();
    if (!caption) continue;
    const box = nodeGraphGlGraphWorldBox(button);
    if (!box) continue;
    const x = toX(box.x);
    const y = toY(box.y);
    const w = box.w * zoom;
    const h = box.h * zoom;
    if (nodeGraphGlGraphOutside(x, y, w, h, cssW, cssH, 480)) continue;
    const px = Math.min(h * 0.42, w * 0.5);
    nodeGraphGlLinesText(batch, caption, x + w * 0.5, y + h * 0.5, nodeGraphGlGraphTextOpts({
      px: Math.max(8, px),
      maxWidth: Math.max(8, w * 0.86),
      rgba: nodeGraphGlGraphCssColor(button.dataset.glCaptionColor || "#ffffff"),
      align: "center",
      baseline: "middle",
      weight: 400,
    }));
  }
}

// Cable cubics are sampled split-and-prune (soemdsp AdaptiveCache, in 2D on
// t): halve a t span while its midpoint sits farther than tolerance / 4 from
// the chord, then drop points within tolerance of a straight run
// (Ramer-Douglas-Peucker). The cubic is point-symmetric, so its midpoint lies
// on the end-to-end line: the first split is forced into
// NODE_GRAPH_WIRE_CURVE_SPANS even spans. NODE_GRAPH_WIRE_CURVE_DEPTH halvings
// per span cap the count (8 << 8 = 2048 pieces before pruning).
const NODE_GRAPH_WIRE_CURVE_SPANS = 8;
const NODE_GRAPH_WIRE_CURVE_DEPTH = 8;

/** Ramer-Douglas-Peucker on a flat xy list: keep points farther than tolerance from the run. */
function nodeGraphGlGraphPrune(pts, tolerance) {
  const n = pts.length / 2;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [0, n - 1];
  while (stack.length) {
    const j = stack.pop();
    const i = stack.pop();
    const x0 = pts[i * 2];
    const y0 = pts[i * 2 + 1];
    const dx = pts[j * 2] - x0;
    const dy = pts[j * 2 + 1] - y0;
    const len2 = dx * dx + dy * dy;
    let far = tolerance;
    let at = -1;
    for (let k = i + 1; k < j; k += 1) {
      const px = pts[k * 2] - x0;
      const py = pts[k * 2 + 1] - y0;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - dx * t, py - dy * t);
      if (d > far) {
        far = d;
        at = k;
      }
    }
    if (at >= 0) {
      keep[at] = 1;
      stack.push(i, at, at, j);
    }
  }
  let count = 0;
  for (let k = 0; k < n; k += 1) count += keep[k];
  const xy = new Float32Array(count * 2);
  for (let k = 0, o = 0; k < n; k += 1) {
    if (!keep[k]) continue;
    xy[o] = pts[k * 2];
    xy[o + 1] = pts[k * 2 + 1];
    o += 2;
  }
  return xy;
}

/** Cable cubic as a polyline within `tolerance` world px of the true curve. */
function nodeGraphGlGraphCubic(ax, ay, bx, by, tolerance, departSign = 1) {
  // Wire curve 0..1 (normalized, finite): 0 is a straight line, not a fallback to full curve.
  const curve = typeof nodeGraphWireCurve === "function" ? nodeGraphWireCurve() : 1;
  const span = Math.min(
    96,
    (Math.abs(bx - ax) * 0.48 + Math.abs(by - ay) * 0.12) * curve,
  );
  // Outlets leave to the right. Inlets leave to the left, out of the module.
  const sign = departSign < 0 ? -1 : 1;
  const c1x = ax + sign * span;
  const c1y = ay;
  const c2x = bx - sign * span;
  const c2y = by;
  const cx = (t) => {
    const u = 1 - t;
    return u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx;
  };
  const cy = (t) => {
    const u = 1 - t;
    return u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by;
  };
  const split = tolerance * 0.25;
  const pts = [ax, ay];
  const sample = (t0, x0, y0, t1, x1, y1, depth) => {
    const tm = (t0 + t1) * 0.5;
    const xm = cx(tm);
    const ym = cy(tm);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const off = len > 0 ? Math.abs((xm - x0) * dy - (ym - y0) * dx) / len : Math.hypot(xm - x0, ym - y0);
    if (depth > 0 && off > split) {
      sample(t0, x0, y0, tm, xm, ym, depth - 1);
      sample(tm, xm, ym, t1, x1, y1, depth - 1);
    } else {
      pts.push(x1, y1);
    }
  };
  const n = NODE_GRAPH_WIRE_CURVE_SPANS;
  for (let i = 0; i < n; i += 1) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    sample(t0, cx(t0), cy(t0), t1, i + 1 === n ? bx : cx(t1), i + 1 === n ? by : cy(t1), NODE_GRAPH_WIRE_CURVE_DEPTH);
  }
  return nodeGraphGlGraphPrune(pts, tolerance);
}

function nodeGraphGlGraphShape(from, to, wire, tolerance) {
  const ax = Number(from.x);
  const ay = Number(from.y);
  const bx = Number(to.x);
  const by = Number(to.y);
  let trace = null;
  if (wire && typeof nodeGraphManualTracePathOptions === "function") {
    const opts = nodeGraphManualTracePathOptions(wire, from, to);
    if (Array.isArray(opts?.tracePoints) && opts.tracePoints.length) {
      trace = opts.tracePoints;
    }
  }
  const style = typeof normalizeNodeGraphWireType === "function"
    ? normalizeNodeGraphWireType(wire?.wireType)
    : (wire?.wireType === "trace" ? "trace" : "ribbon");
  if (style === "trace") {
    const routed = typeof nodeGraphTraceOrthogonalPoints === "function"
      ? nodeGraphTraceOrthogonalPoints({ x: ax, y: ay }, trace || [], { x: bx, y: by })
      : null;
    const pts = routed && routed.length >= 2 ? routed : [{ x: ax, y: ay }, { x: bx, y: by }];
    const xy = new Float32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i += 1) {
      xy[i * 2] = Number(pts[i].x);
      xy[i * 2 + 1] = Number(pts[i].y);
    }
    return xy;
  }
  const depart = Number(from?.departSign) < 0 ? -1 : 1;
  return nodeGraphGlGraphCubic(ax, ay, bx, by, tolerance, depart);
}

function nodeGraphGlGraphDragFrom(point, endpoint) {
  if (!point) return point;
  const io = endpoint?.io;
  if (io && io !== "output") {
    return { x: point.x, y: point.y, departSign: -1 };
  }
  return point;
}

/**
 * Whether a wire is being dragged out of this jack (a new wire, or the wires a port-connection
 * gesture holds): the jack shows the active jack light at once, not only once the wire lands.
 * Read every frame, so a cancelled drag (wireDragging cleared) is inactive again on the next draw.
 */
function nodeGraphGlGraphJackDragging(jack) {
  const state = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp : null;
  if (!state || !jack) return false;
  const match = (endpoint) => {
    if (!endpoint || String(endpoint.node ?? "") !== String(jack.id ?? "")) return false;
    const port = String(endpoint.port || endpoint.param || endpoint.graphInput || "");
    return port === String(jack.port || "") && (endpoint.io === "output") === (jack.io === "output");
  };
  const drag = state.wireDragging;
  if (drag?.active && match(drag.endpoint)) return true;
  const mode = state.portConnectionMode;
  if (mode?.cursorPoint && mode.selected && typeof mode.selected.values === "function") {
    for (const entry of mode.selected.values()) {
      if (entry?.from && match(entry.endpoint)) return true;
    }
  }
  return false;
}

/** One wire end dot (square jack or round) into `batch`. */
function nodeGraphGlGraphDrawWireEnd(batch, end, feather) {
  // UI Dev "lighting: wire dots": lit brightness, and in a dark room toward black with their own
  // light setting, alpha kept.
  const rgba = nodeGraphGlGraphWireDotRgba(end.rgba);
  if (end.square) {
    nodeGraphGlLinesRect(batch, end.x - end.reach, end.y - end.reach, end.reach * 2, end.reach * 2, rgba);
  } else {
    nodeGraphGlLinesDot(batch, end.x, end.y, end.reach, feather, rgba);
  }
}

function nodeGraphGlGraphPushWire(wires, from, to, color, zoom, wire, squareFrom, squareTo, kind, index, railFrom = false, railTo = false, toColor = "", fromNode = "", toNode = "") {
  if (!from || !to) return;
  const ax = Number(from.x);
  const ay = Number(from.y);
  const bx = Number(to.x);
  const by = Number(to.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
    return;
  }
  // Wire colour (single source): the IN (destination) jack decides it, via
  // nodeGraphPortWireColor (mod inlet purple, ...); source colour only when
  // there is no destination colour (drag / port-connection previews). One
  // solid colour per wire, end dots included.
  const rgba = nodeGraphGlGraphCssColor(toColor || color);
  // The first cable leaving a module gives its stroke animation its colour (nodeGraphStrokeLoudColor).
  if (fromNode && nodeGraphGlGraphState.firstCable && !nodeGraphGlGraphState.firstCable.has(String(fromNode))) {
    nodeGraphGlGraphState.firstCable.set(String(fromNode), rgba);
  }
  // A module with no outgoing cable (the Output module) takes the colour of its first incoming one.
  if (toNode && nodeGraphGlGraphState.firstCableIn && !nodeGraphGlGraphState.firstCableIn.has(String(toNode))) {
    nodeGraphGlGraphState.firstCableIn.set(String(toNode), rgba);
  }
  // Every cable colour per module, out and in: Left (red) plus Right (blue) cables mix the
  // stroke light additively (nodeGraphStrokeLoudColor).
  const addCable = (map, node) => {
    if (!node || !map) return;
    const key = String(node);
    const list = map.get(key);
    if (!list) map.set(key, [rgba]);
    else if (list.length < 16) list.push(rgba);
  };
  addCable(nodeGraphGlGraphState.cablesOut, fromNode);
  addCable(nodeGraphGlGraphState.cablesIn, toNode);
  // Curve tolerance in world px: 0.2 screen px at the rebuild zoom. A cable
  // with a patch slot under UIDEV pixelate wires is baked as a zoom-1
  // picture, so it uses 0.25 world px and stays the same at every zoom.
  const baked = Boolean(kind) && Number.isInteger(index) && index >= 0
    && typeof nodeGraphPixelateWiresOnZoom === "function" && nodeGraphPixelateWiresOnZoom();
  const tolerance = baked ? 0.25 : 0.2 / Math.max(1e-3, Number(zoom) || 1);
  wires.push({
    rgba,
    kind: kind || "",
    style: typeof normalizeNodeGraphWireType === "function"
      ? normalizeNodeGraphWireType(wire?.wireType)
      : "ribbon",
    index: Number.isInteger(index) ? index : -1,
    xy: nodeGraphGlGraphShape(from, to, wire, tolerance),
    // A param wire (an end on a rail IO box) has its own width and a tiny
    // round end dot where it meets the box.
    param: railFrom === true || railTo === true,
    // node: the module whose stack draws the end dot ("" = a free end).
    dots: [
      { x: ax, y: ay, rgba, square: !railFrom && squareFrom === true, param: railFrom === true, node: String(fromNode || "") },
      { x: bx, y: by, rgba, square: !railTo && squareTo === true, param: railTo === true, node: String(toNode || "") },
    ],
  });
}

/**
 * A cable that is not drawn (an end's jack is hidden: sliders hidden, the param
 * hidden, Hide In/Out) keeps a wire dot on each of its jacks that is still
 * visible, anchored to that jack. No stroke, no patch slot, not pickable, and
 * never a dot at a hidden jack, over a module body or along the hidden path.
 * ends: [{ at, el, square, rail, node }] - at is the jack centre (null when
 * not laid out), el the jack element (checked for layout visibility).
 */
function nodeGraphGlGraphPushWireJackDots(wires, color, ends) {
  const rgba = nodeGraphGlGraphCssColor(color);
  const dots = [];
  for (const end of ends) {
    const x = Number(end?.at?.x);
    const y = Number(end?.at?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (typeof nodeGraphPortElementIsRenderableForWire === "function" && !nodeGraphPortElementIsRenderableForWire(end.el)) continue;
    dots.push({ x, y, rgba, square: !end.rail && end.square === true, param: end.rail === true, node: String(end.node || "") });
  }
  if (!dots.length) return;
  wires.push({
    rgba,
    kind: "",
    style: "ribbon",
    index: -1,
    dotOnly: true,
    xy: new Float32Array([dots[0].x, dots[0].y, dots[0].x, dots[0].y]),
    param: dots[0].param,
    dots,
  });
}

/** The jack element of a wire end, for the layout-visibility check (null = none laid out). */
function nodeGraphGlGraphWireJackEl(node, port, io) {
  if (io === "modulation") {
    const surface = typeof nodeGraphZoomSurface === "function" ? nodeGraphZoomSurface() : null;
    return typeof nodeGraphModulationPortSelector === "function"
      ? surface?.querySelector(nodeGraphModulationPortSelector(node, port)) || null
      : null;
  }
  return typeof nodeGraphPortElementForWireEndpoint === "function"
    ? nodeGraphPortElementForWireEndpoint(node, port, io) || null
    : null;
}

function nodeGraphGlGraphRebuild(options = {}) {
  nodeGraphGlGraphState.gen = (nodeGraphGlGraphState.gen || 0) + 1;
  nodeGraphGlGraphState.firstCable = new Map();
  nodeGraphGlGraphState.firstCableIn = new Map();
  nodeGraphGlGraphState.cablesOut = new Map();
  nodeGraphGlGraphState.cablesIn = new Map();
  const lite = options.lite === true;
  const wires = [];
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const rail = (node, param) => typeof nodeGraphModuleRailOwnsParam === "function"
    && nodeGraphModuleRailOwnsParam(node, param);
  const colorOf = (node, port, io) => (
    typeof nodeGraphPortWireColor === "function" ? nodeGraphPortWireColor(node, port, io) : ""
  );
  const square = (node, port, io) => (
    typeof nodeGraphWireJackIsSquare === "function" && nodeGraphWireJackIsSquare(node, port, io)
  );
  if (!lite && nodeGraphMvp) {
    const mode = nodeGraphMvp.portConnectionMode;
    const hiddenMovingWires = new Set(
      mode?.movingWires && Array.isArray(mode.hideWireKeys)
        ? mode.hideWireKeys
        : [],
    );
    const signalWires = nodeGraphMvp.connections || [];
    for (let i = 0; i < signalWires.length; i += 1) {
      if (hiddenMovingWires.has(`signal:${i}`)) {
        continue;
      }
      const connection = signalWires[i];
      if (typeof nodeGraphSignalWireDestinationIsRenderable === "function"
        && !nodeGraphSignalWireDestinationIsRenderable(connection)) {
        continue;
      }
      const from = nodeGraphPortCenter(connection.sourceNode, connection.sourcePort, "output");
      const to = nodeGraphPortCenter(connection.destinationNode, connection.destinationPort, "input");
      const fromColor = colorOf(connection.sourceNode, connection.sourcePort, "output");
      if (!from || !to || nodeGraphIoViewHidesWire?.(connection.sourceNode, connection.destinationNode)) {
        // One end's jack is hidden: no cable, dots on the visible jacks only.
        nodeGraphGlGraphPushWireJackDots(wires, colorOf(connection.destinationNode, connection.destinationPort, "input") || fromColor, [
          { at: from, el: nodeGraphGlGraphWireJackEl(connection.sourceNode, connection.sourcePort, "output"), square: square(connection.sourceNode, connection.sourcePort, "output"), rail: rail(connection.sourceNode, connection.sourcePort), node: connection.sourceNode },
          { at: to, el: nodeGraphGlGraphWireJackEl(connection.destinationNode, connection.destinationPort, "input"), square: square(connection.destinationNode, connection.destinationPort, "input"), rail: false, node: connection.destinationNode },
        ]);
        continue;
      }
      nodeGraphGlGraphPushWire(
        wires, from, to, fromColor, zoom, connection,
        square(connection.sourceNode, connection.sourcePort, "output"),
        square(connection.destinationNode, connection.destinationPort, "input"),
        "signal",
        i,
        rail(connection.sourceNode, connection.sourcePort),
        false,
        colorOf(connection.destinationNode, connection.destinationPort, "input"),
        connection.sourceNode,
        connection.destinationNode,
      );
    }
    const modulationWires = nodeGraphMvp.modulations || [];
    for (let i = 0; i < modulationWires.length; i += 1) {
      if (hiddenMovingWires.has(`modulation:${i}`)) {
        continue;
      }
      const modulation = modulationWires[i];
      if (typeof nodeGraphModulationWireDestinationIsRenderable === "function"
        && !nodeGraphModulationWireDestinationIsRenderable(modulation)) {
        continue;
      }
      const from = nodeGraphPortCenter(modulation.sourceNode, modulation.sourcePort, "output");
      const to = typeof nodeGraphModulationPortCenter === "function"
        ? nodeGraphModulationPortCenter(modulation.destinationNode, modulation.destinationParam)
        : null;
      const fromColor = colorOf(modulation.sourceNode, modulation.sourcePort, "output");
      if (!from || !to || nodeGraphIoViewHidesWire?.(modulation.sourceNode, modulation.destinationNode)) {
        // Target param row hidden (sliders hidden or the param hidden) or the
        // outlet hidden: no cable, dots on the visible jacks only.
        nodeGraphGlGraphPushWireJackDots(wires, colorOf(modulation.destinationNode, modulation.destinationParam, "modulation") || fromColor, [
          { at: from, el: nodeGraphGlGraphWireJackEl(modulation.sourceNode, modulation.sourcePort, "output"), square: square(modulation.sourceNode, modulation.sourcePort, "output"), rail: rail(modulation.sourceNode, modulation.sourcePort), node: modulation.sourceNode },
          { at: to, el: nodeGraphGlGraphWireJackEl(modulation.destinationNode, modulation.destinationParam, "modulation"), square: square(modulation.destinationNode, modulation.destinationParam, "modulation"), rail: rail(modulation.destinationNode, modulation.destinationParam), node: modulation.destinationNode },
        ]);
        continue;
      }
      nodeGraphGlGraphPushWire(
        wires, from, to, fromColor, zoom, modulation,
        square(modulation.sourceNode, modulation.sourcePort, "output"),
        square(modulation.destinationNode, modulation.destinationParam, "modulation"),
        "modulation",
        i,
        rail(modulation.sourceNode, modulation.sourcePort),
        rail(modulation.destinationNode, modulation.destinationParam),
        colorOf(modulation.destinationNode, modulation.destinationParam, "modulation"),
        modulation.sourceNode,
        modulation.destinationNode,
      );
    }
    const graphWires = nodeGraphMvp.graphConnections || [];
    for (let i = 0; i < graphWires.length; i += 1) {
      if (hiddenMovingWires.has(`graph:${i}`)) {
        continue;
      }
      const graphConnection = graphWires[i];
      const from = nodeGraphPortCenter(graphConnection.sourceNode, graphConnection.sourcePort, "output");
      const to = typeof nodeGraphGraphInputPortCenter === "function"
        ? nodeGraphGraphInputPortCenter(graphConnection.destinationNode, graphConnection.destinationGraphInput)
        : null;
      const fromColor = colorOf(graphConnection.sourceNode, graphConnection.sourcePort, "output") || "#e6d36a";
      nodeGraphGlGraphPushWire(
        wires, from, to, fromColor, zoom, graphConnection,
        square(graphConnection.sourceNode, graphConnection.sourcePort, "output"),
        false,
        "graph",
        i,
        false,
        false,
        "",
        graphConnection.sourceNode,
        graphConnection.destinationNode,
      );
    }
    const endpointColor = (endpoint) => {
      if (!endpoint) return "#ffffff";
      const port = endpoint.port || endpoint.param || endpoint.graphInput || "";
      return colorOf(endpoint.node, port, endpoint.io) || "#ffffff";
    };
    const drag = nodeGraphMvp.wireDragging;
    if (drag?.active && drag.from && drag.cursorPoint) {
      const dragColor = endpointColor(drag.endpoint);
      nodeGraphGlGraphPushWire(
        wires,
        nodeGraphGlGraphDragFrom(drag.from, drag.endpoint),
        drag.cursorPoint,
        dragColor,
        zoom,
        null,
        false,
        false,
        "",
        -1,
        false,
        false,
        "",
        drag.endpoint?.node,
      );
    }
    if (mode?.cursorPoint && mode.selected && typeof mode.selected.values === "function") {
      for (const entry of mode.selected.values()) {
        if (entry?.from) {
          const modeColor = entry.previewColor || mode.interactColor || endpointColor(entry.endpoint);
          nodeGraphGlGraphPushWire(
            wires,
            nodeGraphGlGraphDragFrom(entry.from, entry.endpoint),
            mode.cursorPoint,
            modeColor,
            zoom,
            entry.wire || entry.connectOptions || null,
            false,
            false,
            "",
            -1,
            false,
            false,
            "",
            entry.endpoint?.node,
          );
        }
      }
    }
  }
  if (!lite || !nodeGraphGlGraphState.wires.length) {
    nodeGraphGlGraphState.wires = wires;
    if (!lite) nodeGraphGlGraphRebuildPlates();
  }
}

function nodeGraphGlGraphFit(canvas, cssW, cssH) {
  const bw = Math.min(4096, cssW);
  const bh = Math.min(4096, cssH);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  return bw / cssW;
}

// UIDEV "pixelate wires on zoom" (off by default; off = the vector replay
// above, untouched). On: the patch cables are rasterized once at zoom 1
// (world px) into a 2D bake canvas, and every present / gesture replay just
// draws that picture onto the wire canvas with the live camera: smooth at or
// below 2.5x, nearest-neighbour above (the display faces' rule). Cables are
// never re-tessellated or re-baked mid-gesture. A settled present re-bakes
// only when the cable picture changes (geometry, colour, selection, widths,
// dip, rail ends) or the baked region has to move. A wire being dragged (no
// patch slot) stays a live vector stroke drawn on top of the bake. End dots
// stay vector in the module stacks, so z-order is unchanged.
// Cap: NODE_GRAPH_WIRE_BAKE_MAX px per side (the picture device size). When
// the cables span more than that, the bake covers the cap around the view
// (re-baked on settle; panning past it mid-gesture shows the edge until the
// settle). When the view itself is wider than the cap (far zoomed out), the
// bake drops below 1 px per world px, still at or above screen resolution.
const NODE_GRAPH_WIRE_BAKE_MAX = 4096;

function nodeGraphGlGraphWireBakeWanted(view, frameCamera, wireCanvas) {
  if (view || !frameCamera || !wireCanvas) return false;
  if (typeof nodeGraphPixelateWiresOnZoom !== "function" || !nodeGraphPixelateWiresOnZoom()) return false;
  // A Screen Space Shader source keeps its picture in a GPU face texture
  // (no 2D bitmap to draw the bake onto): those frames stay vector.
  return !(typeof nodeGraphSharedGlFaceTextureOnly === "function" && nodeGraphSharedGlFaceTextureOnly(wireCanvas));
}

function nodeGraphGlGraphWireBakeDrop() {
  const bake = nodeGraphGlGraphState.wireBake;
  nodeGraphGlGraphState.wireBake = null;
  if (bake?.canvas) {
    bake.canvas.width = 1;
    bake.canvas.height = 1;
  }
}

/** A wire with no patch slot (drag / port-connection preview) stays a live vector stroke. */
function nodeGraphGlGraphWireIsLive(wire) {
  return !wire.kind || !(wire.index >= 0);
}

const nodeGraphGlGraphWireBakeHashF = new Float32Array(1);
const nodeGraphGlGraphWireBakeHashU = new Uint32Array(nodeGraphGlGraphWireBakeHashF.buffer);
function nodeGraphGlGraphWireBakeMix(h, v) {
  nodeGraphGlGraphWireBakeHashF[0] = Number(v) || 0;
  return Math.imul(h ^ nodeGraphGlGraphWireBakeHashU[0], 16777619) >>> 0;
}

/**
 * Bake (or reuse) the zoom-1 cable picture. p: { cam, zoom, cssW, cssH,
 * halfWorld, traceHalf, paramHalf, feather, railEnds, railEnd, gesturing }.
 * Returns the bake, or null (nothing baked: the caller strokes vectors).
 */
function nodeGraphGlGraphWireBakeUpdate(p) {
  const st = nodeGraphGlGraphState;
  const prev = st.wireBake;
  // Mid-gesture: keep the picture we have; the settle present re-bakes.
  if (p.gesturing && prev?.canvas) return prev;
  const selected = typeof nodeGraphSelectedWireEntries === "function" ? nodeGraphSelectedWireEntries() : [];
  const list = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < st.wires.length; i += 1) {
    const wire = st.wires[i];
    if (nodeGraphGlGraphWireIsLive(wire)) continue;
    const xy = wire.xy;
    if (!xy || xy.length < 4) continue;
    const picked = selected.some((entry) =>
      (entry.kind || "signal") === wire.kind && Number(entry.index) === wire.index,
    );
    list.push({ wire, picked });
    for (let q = 0; q < xy.length; q += 2) {
      const x = xy[q];
      const y = xy[q + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!list.length || !Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    nodeGraphGlGraphWireBakeDrop();
    return null;
  }
  const edge = Math.ceil(Math.max(p.halfWorld, p.traceHalf, p.paramHalf) + p.feather + 4);
  const bx0 = Math.floor(x0) - edge;
  const by0 = Math.floor(y0) - edge;
  const bx1 = Math.ceil(x1) + edge;
  const by1 = Math.ceil(y1) + edge;
  const max = NODE_GRAPH_WIRE_BAKE_MAX;
  let scale = 1;
  let rx0 = bx0;
  let ry0 = by0;
  let rx1 = bx1;
  let ry1 = by1;
  if (bx1 - bx0 > max || by1 - by0 > max) {
    const viewW = p.cssW / p.zoom;
    const viewH = p.cssH / p.zoom;
    scale = Math.min(1, max / viewW, max / viewH);
    const span = Math.floor(max / scale);
    const fit = (lo, hi, centre) => {
      if (hi - lo <= span) return [lo, hi];
      const a = Math.max(lo, Math.min(Math.floor(centre - span * 0.5), hi - span));
      return [a, a + span];
    };
    [rx0, rx1] = fit(bx0, bx1, p.cam.x + viewW * 0.5);
    [ry0, ry1] = fit(by0, by1, p.cam.y + viewH * 0.5);
  }
  const pw = Math.max(1, Math.min(max, Math.ceil((rx1 - rx0) * scale)));
  const ph = Math.max(1, Math.min(max, Math.ceil((ry1 - ry0) * scale)));
  const mix = nodeGraphGlGraphWireBakeMix;
  let h = 2166136261;
  for (const v of [rx0, ry0, pw, ph, scale, p.halfWorld, p.traceHalf, p.paramHalf, p.feather,
    st.wireDip ?? 0.35, st.wireDipWidth ?? 0.5, list.length, p.railEnds.length, nodeGraphGlGraphWireLight(false)]) h = mix(h, v);
  for (let i = 0; i < p.railEnds.length; i += 1) {
    h = mix(h, p.railEnds[i].x);
    h = mix(h, p.railEnds[i].y);
  }
  for (let i = 0; i < list.length; i += 1) {
    const { wire, picked } = list[i];
    h = mix(h, picked ? 1 : 0);
    h = mix(h, wire.param ? 1 : 0);
    h = mix(h, wire.style === "trace" ? 1 : 0);
    const c = wire.rgba || [];
    for (let k = 0; k < 4; k += 1) h = mix(h, c[k]);
    const xy = wire.xy;
    h = mix(h, xy.length);
    for (let q = 0; q < xy.length; q += 1) h = mix(h, xy[q]);
  }
  if (prev?.canvas && prev.sig === h) return prev;
  const canvas = prev?.canvas || document.createElement("canvas");
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale: 1, transparent: true, camera: { x: rx0, y: ry0, zoom: scale } })
    : null;
  if (!batch) {
    nodeGraphGlGraphWireBakeDrop();
    return null;
  }
  nodeGraphGlGraphWireBakeStroke(batch, list, p);
  if (nodeGraphGlLinesEnd(batch, "alpha") === false) {
    nodeGraphGlGraphWireBakeDrop();
    return null;
  }
  st.wireBake = { canvas, x: rx0, y: ry0, w: pw / scale, h: ph / scale, scale, sig: h };
  return st.wireBake;
}

/** Same strokes as the vector path, in zoom-1 world px (camera uniform). list: [{ wire, picked }]. */
function nodeGraphGlGraphWireBakeStroke(batch, list, p) {
  const st = nodeGraphGlGraphState;
  const light = nodeGraphGlGraphWireLight(false);
  for (let i = 0; i < list.length; i += 1) {
    const { wire, picked } = list[i];
    const style = wire.style === "trace" ? "trace" : "ribbon";
    const stroke = style === "trace" ? p.traceHalf : (wire.param ? p.paramHalf : p.halfWorld);
    const feather = style === "trace" ? 0 : p.feather;
    const rgba = nodeGraphGlGraphShadeRgba(picked ? [0.95, 0.86, 0.45, 1] : wire.rgba, light);
    let pts = wire.xy;
    if (wire.param && p.railEnds.length) {
      pts = Float32Array.from(pts);
      for (const ix of [0, pts.length - 2]) {
        const e = p.railEnd(pts[ix], pts[ix + 1]);
        if (e) { pts[ix] = e.x; pts[ix + 1] = e.y; }
      }
    }
    if (style === "trace") {
      nodeGraphGlLinesPolyline(batch, pts, stroke, feather, rgba, "ortho");
    } else if (typeof nodeGraphGlLinesRibbon !== "function") {
      nodeGraphGlLinesPolyline(batch, pts, stroke, feather, rgba, "butt");
    } else {
      nodeGraphGlLinesRibbon(batch, pts, stroke, feather, rgba, wire.param && !picked ? (st.wireDip ?? 0.35) : 0, st.wireDipWidth ?? 0.5);
    }
  }
}

function nodeGraphGlGraphWireLiveBakeDrop() {
  const bake = nodeGraphGlGraphState.wireLiveBake;
  nodeGraphGlGraphState.wireLiveBake = null;
  if (bake?.canvas) {
    bake.canvas.width = 1;
    bake.canvas.height = 1;
  }
}

/**
 * Live wires (drag / port-connection preview) under UIDEV pixelate wires:
 * rasterized at zoom 1 into their own small picture every present, so a
 * cable being dragged gets the same pixels as the baked ones instead of a
 * smooth vector stroke. Drawn on top of the patch-cable bake. Same p as
 * nodeGraphGlGraphWireBakeUpdate. Returns the picture, or null (none live).
 */
function nodeGraphGlGraphWireLiveBakeUpdate(p) {
  const st = nodeGraphGlGraphState;
  const list = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < st.wires.length; i += 1) {
    const wire = st.wires[i];
    if (!nodeGraphGlGraphWireIsLive(wire)) continue;
    if (wire.dotOnly) continue;
    const xy = wire.xy;
    if (!xy || xy.length < 4) continue;
    list.push({ wire, picked: false });
    for (let q = 0; q < xy.length; q += 2) {
      const x = xy[q];
      const y = xy[q + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!list.length || !Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    nodeGraphGlGraphWireLiveBakeDrop();
    return null;
  }
  const edge = Math.ceil(Math.max(p.halfWorld, p.traceHalf, p.paramHalf) + p.feather + 4);
  const max = NODE_GRAPH_WIRE_BAKE_MAX;
  const rx0 = Math.floor(x0) - edge;
  const ry0 = Math.floor(y0) - edge;
  const spanW = Math.ceil(x1) + edge - rx0;
  const spanH = Math.ceil(y1) + edge - ry0;
  // Same rule as the patch bake: 1 px per world px, below that only when
  // the cable is longer than the cap.
  const scale = Math.min(1, max / Math.max(1, spanW), max / Math.max(1, spanH));
  const pw = Math.max(1, Math.min(max, Math.ceil(spanW * scale)));
  const ph = Math.max(1, Math.min(max, Math.ceil(spanH * scale)));
  const canvas = st.wireLiveBake?.canvas || document.createElement("canvas");
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const batch = typeof nodeGraphGlLinesBegin === "function"
    ? nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale: 1, transparent: true, camera: { x: rx0, y: ry0, zoom: scale } })
    : null;
  if (!batch) {
    nodeGraphGlGraphWireLiveBakeDrop();
    return null;
  }
  nodeGraphGlGraphWireBakeStroke(batch, list, p);
  if (nodeGraphGlLinesEnd(batch, "alpha") === false) {
    nodeGraphGlGraphWireLiveBakeDrop();
    return null;
  }
  st.wireLiveBake = { canvas, x: rx0, y: ry0, w: pw / scale, h: ph / scale, scale };
  return st.wireLiveBake;
}

// UIDEV "pixelate wire dots on zoom" (off by default; off = the live vector
// end dots below, untouched). On: each module's wire end dots are baked at
// zoom 1 (world px) into that module's own small picture, and the picture is
// drawn as an image quad in that module's stack layer (where the vector dots
// were), so a module in front still covers the dots of the one behind. Its
// filter follows the module pictures (nearest above 2.5x, set at replay).
// Never re-baked mid-gesture; a settled present re-bakes only the modules
// whose dots changed (position, size, colour, selection, square/round).
// Dots of a live wire (drag / port-connection preview) and free ends stay
// vector. Independent of "pixelate wires on zoom".
function nodeGraphGlGraphDotBakeWanted(view, frameCamera) {
  if (view || !frameCamera) return false;
  return typeof nodeGraphPixelateWireDotsOnZoom === "function" && nodeGraphPixelateWireDotsOnZoom();
}

function nodeGraphGlGraphDotBakeDrop() {
  const bake = nodeGraphGlGraphState.dotBake;
  nodeGraphGlGraphState.dotBake = null;
  if (!bake) return;
  for (const entry of bake.byNode.values()) {
    entry.canvas.width = 1;
    entry.canvas.height = 1;
  }
}

/**
 * Bake (or reuse) every stacked module's end dots. p: { stackedIds, railEnds,
 * railEnd, dotWorld, paramDotWorld, feather, gesturing }. Returns the bake
 * ({ byNode: id -> { canvas, x, y, w, h, sig } }), or null (vector dots).
 */
function nodeGraphGlGraphDotBakeUpdate(p) {
  const st = nodeGraphGlGraphState;
  const prev = st.dotBake;
  // Mid-gesture: keep the pictures we have; the settle present re-bakes.
  if (p.gesturing && prev) return prev;
  const selected = typeof nodeGraphSelectedWireEntries === "function" ? nodeGraphSelectedWireEntries() : [];
  const selectedRgba = [0.95, 0.86, 0.45, 1];
  const perNode = new Map();
  for (let i = 0; i < st.wires.length; i += 1) {
    const wire = st.wires[i];
    if (nodeGraphGlGraphWireIsLive(wire)) continue;
    if (!wire.xy || wire.xy.length < 4) continue;
    const picked = selected.some((entry) =>
      (entry.kind || "signal") === wire.kind && Number(entry.index) === wire.index,
    );
    const dots = wire.dots || [];
    for (let d = 0; d < dots.length; d += 1) {
      const dot = dots[d];
      if (!dot.node || !p.stackedIds.has(dot.node)) continue;
      let x = dot.x;
      let y = dot.y;
      const snapEnd = dot.param && p.railEnds.length ? p.railEnd(x, y) : null;
      if (snapEnd) { x = snapEnd.x; y = snapEnd.y; }
      const reach = dot.param ? p.paramDotWorld : p.dotWorld;
      if (!(reach > 0) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      let own = perNode.get(dot.node);
      if (!own) perNode.set(dot.node, (own = []));
      own.push({ x, y, reach, rgba: picked ? selectedRgba : dot.rgba, square: dot.square });
    }
  }
  const mix = nodeGraphGlGraphWireBakeMix;
  const max = NODE_GRAPH_WIRE_BAKE_MAX;
  const byNode = new Map();
  let failed = false;
  for (const [id, ends] of perNode) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const e of ends) {
      if (e.x - e.reach < x0) x0 = e.x - e.reach;
      if (e.y - e.reach < y0) y0 = e.y - e.reach;
      if (e.x + e.reach > x1) x1 = e.x + e.reach;
      if (e.y + e.reach > y1) y1 = e.y + e.reach;
    }
    const edge = Math.ceil(p.feather + 2);
    const rx0 = Math.floor(x0) - edge;
    const ry0 = Math.floor(y0) - edge;
    const pw = Math.max(1, Math.min(max, Math.ceil(x1) + edge - rx0));
    const ph = Math.max(1, Math.min(max, Math.ceil(y1) + edge - ry0));
    let h = 2166136261;
    for (const v of [rx0, ry0, pw, ph, p.feather, ends.length, nodeGraphGlGraphWireDotLight()]) h = mix(h, v);
    for (const e of ends) {
      h = mix(h, e.x);
      h = mix(h, e.y);
      h = mix(h, e.reach);
      h = mix(h, e.square ? 1 : 0);
      const c = e.rgba || [];
      for (let k = 0; k < 4; k += 1) h = mix(h, c[k]);
    }
    const old = prev?.byNode.get(id);
    if (old && old.sig === h) {
      byNode.set(id, old);
      continue;
    }
    const canvas = old?.canvas || document.createElement("canvas");
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    const batch = typeof nodeGraphGlLinesBegin === "function"
      ? nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale: 1, transparent: true, camera: { x: rx0, y: ry0, zoom: 1 } })
      : null;
    if (!batch) {
      failed = true;
      break;
    }
    for (const e of ends) nodeGraphGlGraphDrawWireEnd(batch, e, p.feather);
    // "max": straight coverage, same as the free-end dot canvas, so the
    // image quad composites like the vector dot (no dark fringe).
    if (nodeGraphGlLinesEnd(batch, "max") === false) {
      failed = true;
      break;
    }
    // New picture: a fresh key makes the cached texture re-upload once.
    st.dotBakeSerial = (st.dotBakeSerial || 0) + 1;
    canvas.src = `wiredots:${st.dotBakeSerial}`;
    byNode.set(id, { canvas, x: rx0, y: ry0, w: pw, h: ph, sig: h });
  }
  if (failed) {
    nodeGraphGlGraphDotBakeDrop();
    return null;
  }
  if (prev) {
    for (const [id, entry] of prev.byNode) {
      if (byNode.get(id) === entry) continue;
      if (byNode.get(id)?.canvas === entry.canvas) continue;
      entry.canvas.width = 1;
      entry.canvas.height = 1;
    }
  }
  st.dotBake = { byNode };
  return st.dotBake;
}

/** The baked cables, under whatever the wire batch just presented (live drag strokes stay on top). */
function nodeGraphGlGraphWireBakeDraw(wireCanvas, cam, zoom, backing) {
  const bake = nodeGraphGlGraphState.wireBake;
  const live = nodeGraphGlGraphState.wireLiveBake;
  if ((!bake?.canvas && !live?.canvas) || !wireCanvas || !cam || !(zoom > 0)) return;
  if (typeof nodeGraphSharedGlFaceTextureOnly === "function" && nodeGraphSharedGlFaceTextureOnly(wireCanvas)) return;
  const ctx = wireCanvas.getContext("2d");
  if (!ctx) return;
  const k = zoom * (backing > 0 ? backing : 1);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  // Same filter rule as the module pictures: nearest-neighbour above 2.5x.
  ctx.imageSmoothingEnabled = !(zoom > 2.5);
  if (bake?.canvas) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.drawImage(bake.canvas, (bake.x - cam.x) * k, (bake.y - cam.y) * k, bake.w * k, bake.h * k);
  }
  // A cable being dragged: its own zoom-1 picture, on top of the patch cables.
  if (live?.canvas) {
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(live.canvas, (live.x - cam.x) * k, (live.y - cam.y) * k, live.w * k, live.h * k);
  }
  ctx.restore();
}

function nodeGraphGlGraphConstraintMarksAllowed() {
  const body = document.body;
  if (!body || body.classList.contains("node-screen-solo-active")) return false;
  if (body.classList.contains("keyboard-debug-hidden") && !body.classList.contains("constraint-guide-visible")) {
    return false;
  }
  return true;
}

const NODE_GRAPH_CONSTRAINT_INK = {
  cpu: [240 / 255, 179 / 255, 95 / 255, 1],
  ram: [95 / 255, 199 / 255, 238 / 255, 1],
  gpu: [192 / 255, 131 / 255, 255 / 255, 1],
};

function nodeGraphGlGraphDrawConstraintBadges(batch, toX, toY, zoom, cssW, cssH) {
  if (!batch || !nodeGraphGlGraphConstraintMarksAllowed()) return;
  const marks = nodeGraphGlGraphState.chrome?.constraints || [];
  const bodyClasses = document.body.classList;
  for (let i = 0; i < marks.length; i += 1) {
    const box = marks[i].box;
    const keys = marks[i].keys.filter((key) =>
      NODE_GRAPH_CONSTRAINT_INK[key] && bodyClasses.contains(`node-constraint-${key}-active`));
    if (!keys.length) continue;
    const s = zoom > 0 ? zoom : 1;
    let right = box.x + box.w - 4;
    for (let k = keys.length - 1; k >= 0; k -= 1) {
      const key = keys[k];
      const label = key.toUpperCase();
      const bwWorld = 10 + label.length * 6;
      const bhWorld = 12;
      right -= bwWorld;
      const ink = NODE_GRAPH_CONSTRAINT_INK[key];
      const fill = [ink[0] * 0.28 + 0.02, ink[1] * 0.28 + 0.02, ink[2] * 0.28 + 0.03, 0.94];
      const x = toX(right);
      const y = toY(box.y + 3);
      const bw = bwWorld * s;
      const bh = bhWorld * s;
      if (nodeGraphGlGraphOutside(x, y, bw, bh, cssW, cssH)) {
        right -= 2;
        continue;
      }
      nodeGraphGlLinesRect(batch, x - 1, y - 1, bw + 2, bh + 2, ink);
      nodeGraphGlLinesRect(batch, x, y, bw, bh, fill);
      if (typeof nodeGraphGlLinesText === "function") {
        nodeGraphGlLinesText(batch, label, x + bw * 0.5, y + bh * 0.5, nodeGraphGlGraphTextOpts({
          px: Math.max(8, 9 * s),
          rgba: ink,
          align: "center",
          baseline: "middle",
          weight: 700,
        }));
      }
      right -= 2;
    }
  }
}

function nodeGraphGlConstraintGuidePresent() {
  // A screen HUD, not camera content. It reads its own layout, so never
  // mid-gesture: mark it and redraw on the settle rebuild (ZP-6).
  if (typeof nodeGraphHtmlFrozen === "function" && nodeGraphHtmlFrozen()) {
    nodeGraphGlGraphState.guideDirty = true;
    return;
  }
  nodeGraphGlGraphState.guideDirty = false;
  const guide = document.querySelector(".node-constraint-color-guide");
  if (!guide || typeof nodeGraphGlLinesBegin !== "function") return;
  guide.classList.add("gl-constraint-hits");
  let canvas = document.getElementById("nodeGlConstraintHud");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "nodeGlConstraintHud";
    canvas.className = "node-gl-constraint-hud";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
  }
  const hidden = !nodeGraphGlGraphConstraintMarksAllowed()
    || getComputedStyle(guide).display === "none";
  canvas.hidden = hidden;
  if (hidden) return;
  const width = Math.max(1, Math.ceil(guide.offsetWidth));
  const height = Math.max(1, Math.ceil(guide.offsetHeight));
  const host = document.getElementById("nodeGraphWorkspace");
  const hostRect = host?.getBoundingClientRect();
  const left = hostRect ? hostRect.left + Math.max(0, (hostRect.width - width) * 0.5) : 8;
  const top = hostRect ? Math.max(8, hostRect.bottom - height - 8) : 8;
  guide.style.left = `${left}px`;
  guide.style.top = `${top}px`;
  canvas.style.left = `${left}px`;
  canvas.style.top = `${top}px`;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const batch = nodeGraphGlLinesBegin(canvas, [0.012, 0.02, 0.027, 0.86], {
    scale: 1,
    transparent: true,
    camera: { x: 0, y: 0, zoom: 1 },
  });
  if (!batch) return;
  const stacks = guide.querySelectorAll(".node-constraint-stack");
  for (let i = 0; i < stacks.length; i += 1) {
    const stack = stacks[i];
    const key = stack.getAttribute("data-constraint-stack") || "cpu";
    const ink = NODE_GRAPH_CONSTRAINT_INK[key] || [1, 1, 1, 1];
    const parts = stack.querySelectorAll(".node-constraint-chip, .node-constraint-metrics");
    for (let p = 0; p < parts.length; p += 1) {
      const part = parts[p];
      if (getComputedStyle(part).display === "none") continue;
      const box = part.getBoundingClientRect();
      const x = box.left - left;
      const y = box.top - top;
      if (!(box.width > 1) || !(box.height > 1)) continue;
      const checked = Boolean(part.querySelector("input")?.checked);
      const mix = checked ? 0.42 : 0.16;
      const fill = [ink[0] * mix + 0.02, ink[1] * mix + 0.02, ink[2] * mix + 0.03, 0.92];
      nodeGraphGlLinesRect(batch, x, y, box.width, box.height, fill);
      const text = String(part.textContent || "").replace(/\s+/g, " ").trim();
      if (text && typeof nodeGraphGlLinesText === "function") {
        nodeGraphGlLinesText(batch, text, x + box.width * 0.5, y + box.height * 0.5, nodeGraphGlGraphTextOpts({
          px: 11,
          rgba: ink,
          align: "center",
          baseline: "middle",
          weight: 700,
        }));
      }
    }
  }
  nodeGraphGlLinesEnd(batch, "alpha");
}

// Replay the cached mesh with the live camera (ZP-2 / ZP-3). Face quads in it
// sample each face's GPU texture (picture-device face textures), so a replay
// shows the latest display frame with no rebuild, no CSS reads and no upload.
// layers: "all" (gesture) or "dots" (a display frame: only the dots layer holds
// face quads). Returns false when there is no valid cached mesh.
function nodeGraphGlGraphReplayMesh(layers = "all") {
  const mesh = nodeGraphGlGraphState.mesh;
  if (!mesh || mesh.gen !== nodeGraphGlGraphState.gen || nodeGraphGlGraphState.view) return false;
  const canvas = nodeGraphGlGraphState.canvas;
  if (!canvas || mesh.w !== canvas.width || mesh.h !== canvas.height) return false;
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host) return false;
  const zoom = nodeGraphGlGraphZoom();
  const cam = typeof nodeGraphWireCameraViewBox === "function" ? nodeGraphWireCameraViewBox(host) : { x: 0, y: 0 };
  const frameCamera = { x: cam.x, y: cam.y, zoom };
  // Zoom-1 pictures, nearest-neighbour above 2.5x, chosen at replay time.
  const pixelated = zoom > 2.5;
  const pictures = mesh.pictures || [];
  for (let i = 0; i < pictures.length; i += 1) {
    const pin = pictures[i].pin;
    pictures[i].nearest = pin ? pin === "nearest" : pixelated;
  }
  // mesh.batches: [plates, wires, contacts, veil, trail]. The module stacks
  // (display quads + ink) live in the plates batch; a displays-only frame
  // replays that batch alone (it clears its own canvas).
  const displaysOnly = layers === "displays";
  const to = displaysOnly ? 1 : mesh.batches.length;
  let ok = true;
  for (let i = 0; i < to; i += 1) {
    const held = mesh.batches[i];
    if (!held) continue;
    held.camera = frameCamera;
    held.textPixelated = pixelated;
    if (nodeGraphGlLinesEnd(held, held._blend || "alpha") === false) ok = false;
  }
  if (!displaysOnly && mesh.wireBake) {
    nodeGraphGlGraphWireBakeDraw(mesh.batches[1]?.canvas, frameCamera, zoom, mesh.wireScale);
  }
  if (!displaysOnly) {
    mesh.cam = { x: frameCamera.x, y: frameCamera.y, zoom };
    if (typeof nodeGraphPositionGridHtml === "function") nodeGraphPositionGridHtml();
  }
  return ok;
}

// Live scopes painted their face textures. Replay the batch that holds the
// module stacks (face quads). A full present would rebuild every cable and re-read CSS.
function nodeGraphGlGraphPresentDisplaysOnly() {
  if (nodeGraphGlGraphState.view) return false;
  return nodeGraphGlGraphReplayMesh("displays");
}

/**
 * True when a GPU pass composites this face and draws its frame and face
 * text at screen resolution (stage 2): a live workspace face, or one in a
 * Canvas view tile / screen solo face host. A face still shown as its own 2D
 * canvas keeps them in the picture.
 */
function nodeGraphGlGraphDisplayInkInPass(canvas) {
  return Boolean(canvas?._wfGlSession)
    && typeof nodeGraphSharedGlFaceTextureOnly === "function"
    && nodeGraphSharedGlFaceTextureOnly(canvas);
}

/**
 * Screen-resolution ink of one waterfall face, over its picture quad at
 * (x, y, w, h) in the batch's units: the frame (left plate margin + fade,
 * NODE_GRAPH_WATERFALL_FRAME via nodeGraphWaterfallFramePx) and the face text
 * strip (nodeGraphFaceTextSet). Layout is the face's own pixel grid, so
 * insets match the plot box at any zoom; only the ink resolution changes.
 */
function nodeGraphGlGraphDrawDisplayInk(batch, canvas, x, y, w, h) {
  if (!batch || !nodeGraphGlGraphDisplayInkInPass(canvas)) return;
  const fw = canvas.width;
  const fh = canvas.height;
  if (!(fw > 0) || !(fh > 0) || !(w > 0) || !(h > 0)) return;
  const kx = w / fw;
  const ky = h / fh;
  const plate = nodeGraphGlGraphParseCssColor(canvas._wfGlSession.plateCss || "#000000", [0, 0, 0, 1]);
  const frame = typeof nodeGraphWaterfallFramePx === "function" ? nodeGraphWaterfallFramePx(canvas) : null;
  if (frame) {
    // Solid plate margin, then a continuous dithered fade over fadeLeft
    // (a mask; the tape is unchanged). Same helper as the module present.
    if (typeof nodeGraphWaterfallFramePresent === "function") {
      nodeGraphWaterfallFramePresent(batch, x, y, h, frame, plate, kx);
    }
  }
  const cells = canvas._faceText;
  if (!Array.isArray(cells) || !cells.length) return;
  // Face px per CSS px x ink scale, the same grid the present used.
  const ink = typeof nodeGraphGlLinesInkScale === "function" ? nodeGraphGlLinesInkScale(canvas) : 1;
  const dpr = Math.max(1, fw / Math.max(1, canvas.clientWidth || fw)) * ink;
  const px = 13 * dpr;
  const stripH = Math.min(fh, canvas._faceTextReservePx || 0);
  if (stripH > 0) {
    nodeGraphGlLinesRect(batch, x, y + (fh - stripH) * ky, w, stripH * ky, [plate[0], plate[1], plate[2], 1]);
    nodeGraphGlLinesRect(batch, x, y + (fh - stripH) * ky, w, Math.max(1, Math.round(dpr)) * ky, [0.22, 0.26, 0.33, 1]);
  }
  const family = "\"Cascadia Mono\", Consolas, \"Courier New\", monospace";
  const opts = (rgba) => nodeGraphGlGraphTextOpts({ px: px * ky, rgba, align: "left", baseline: "bottom", weight: 400, family });
  const dim = opts([0.5, 0.78, 0.85, 1]);
  const bright = opts([0.95, 0.96, 1, 1]);
  const measure = (t) => (typeof nodeGraphGlLinesMeasureText === "function"
    ? nodeGraphGlLinesMeasureText(t, px, family, 400)
    : t.length * px * 0.6);
  const baseY = y + (fh - 6 * dpr) * ky;
  const colW = fw / cells.length;
  for (let i = 0; i < cells.length; i += 1) {
    const l = String(cells[i][0]);
    const v = String(cells[i][1]);
    const gap = px * 0.45;
    const lw = measure(l);
    const fx = colW * i + Math.max(4 * dpr, (colW - (lw + gap + measure(v))) * 0.5);
    nodeGraphGlLinesText(batch, l, x + fx * kx, baseY, dim);
    nodeGraphGlLinesText(batch, v, x + (fx + lw + gap) * kx, baseY, bright);
  }
}

/** A group's display ink: face frame + text, then Output pause bars while paused. */
function nodeGraphGlGraphDrawGroupInk(ink, group, toX, toY, zoom, cssW, cssH, cameraOn) {
  if (!ink) return;
  const outputPaused = typeof nodeGraphLiveEngineIsPaused === "function" && nodeGraphLiveEngineIsPaused();
  for (let i = 0; i < group.displays.length; i += 1) {
    const face = group.displays[i];
    if (!face.canvas || !(face.w > 0) || !(face.h > 0)) continue;
    const rect = nodeGraphGlGraphDisplayScreenRect(face, toX, toY, zoom);
    if (!(rect.w > 1) || !(rect.h > 1)) continue;
    if (!cameraOn && (rect.x + rect.w < 0 || rect.y + rect.h < 0 || rect.x > cssW || rect.y > cssH)) continue;
    nodeGraphGlGraphDrawDisplayInk(ink, face.canvas, rect.x, rect.y, rect.w, rect.h);
    if (outputPaused && face.output && typeof paintNodeGraphOutputPauseBars === "function") {
      paintNodeGraphOutputPauseBars(ink, rect.w, rect.h, { x: rect.x, y: rect.y });
    }
  }
}

/**
 * Face text or frame changed (nodeGraphFaceTextSet): rewrite that group's ink
 * layer in the held mesh and replay the displays. The picture is not re-presented.
 */
function nodeGraphGlGraphDisplayInkDirty(canvas) {
  const mesh = nodeGraphGlGraphState.mesh;
  const held = mesh && mesh.gen === nodeGraphGlGraphState.gen ? mesh.inks?.get(canvas) : null;
  if (!held || !mesh.cam) {
    nodeGraphGlGraphPresentSoon();
    return;
  }
  const layer = held.layer;
  layer.n = 0;
  layer.on = 0;
  layer.tn = 0;
  layer.texts = [];
  layer.strokes = null;
  // The held mesh is in zoom-1 world px (camera uniform): identity projection.
  const same = (v) => v;
  nodeGraphGlGraphDrawGroupInk(layer, held.group, same, same, 1, mesh.w, mesh.h, true);
  nodeGraphGlGraphPresentDisplaysSoon();
}

/** The display (published zoom-1 rect, same as its quad) of module id under a world point. */
function nodeGraphGlGraphDisplayAt(id, x, y) {
  const displays = nodeGraphGlGraphState.displays || [];
  for (let i = displays.length - 1; i >= 0; i -= 1) {
    const face = displays[i];
    if (face.id === id && x >= face.x && x <= face.x + face.w && y >= face.y && y <= face.y + face.h) return face;
  }
  return null;
}

function nodeGraphGlGraphPresent(options = {}) {
  // Scope frames must not rebuild cables. A failed stamp leaves the last
  // picture; falling through read the whole workspace and pinned Play at a few fps.
  if (options?.displaysOnly) {
    // No cached mesh yet (first frame, or the patch changed): one full present.
    if (nodeGraphGlGraphPresentDisplaysOnly()) {
      nodeGraphGlGraphPresentTiles(true);
      return true;
    }
  }
  const view = nodeGraphGlGraphState.view;
  const host = view ? view.host : document.getElementById("nodeGraphWorkspace");
  if (!host || typeof nodeGraphGlLinesBegin !== "function") return false;
  if (!view) {
    nodeGraphGlGraphPresentTiles(options?.displaysOnly === true);
    // Perform mode hides the workspace: nothing of it is on screen (its modules live in tiles).
    if (!host.clientWidth && document.body?.classList.contains("node-perform-mode")) return true;
    host.classList.add("gl-graph-on");
  }
  if (!view && typeof nodeGraphEnsureTextWireLayers === "function") nodeGraphEnsureTextWireLayers(host);
  const canvas = nodeGraphGlGraphEnsureCanvas(
    host, "canvas", view ? "" : "nodeGlGraphCanvas", "node-gl-graph-canvas",
    view ? ":scope > .dsp-node" : ".node-graph-zoom-surface",
  );
  const wireCanvas = nodeGraphGlGraphEnsureCanvas(
    host, "wireCanvas", view ? "" : "nodeGlGraphWires", "node-gl-graph-wires",
    view ? null : ".node-graph-text-front",
  );
  const dotsCanvas = nodeGraphGlGraphEnsureCanvas(
    host, "dotsCanvas", view ? "" : "nodeGlGraphDots", "node-gl-graph-dots", null,
  );
  // Snake trail is its own overlay so it paints above the mini view (z 8).
  // Pencil PE-4 In-front takes z 7, between mini (6) and this canvas.
  const snakeCanvas = view ? null : nodeGraphGlGraphEnsureCanvas(
    host, "snakeCanvas", "nodeGlGraphSnake", "node-gl-graph-snake", null,
  );
  const cssW = Math.max(1, host.clientWidth || 1);
  const cssH = Math.max(1, host.clientHeight || 1);
  const scale = nodeGraphGlGraphFit(canvas, cssW, cssH);
  nodeGraphGlGraphFit(wireCanvas, cssW, cssH);
  nodeGraphGlGraphFit(dotsCanvas, cssW, cssH);
  if (snakeCanvas) nodeGraphGlGraphFit(snakeCanvas, cssW, cssH);
  const zoom = nodeGraphGlGraphZoom();
  let cam = { x: 0, y: 0 };
  if (view) cam = view.cam;
  else if (typeof nodeGraphWireCameraViewBox === "function") cam = nodeGraphWireCameraViewBox(host);
  const frameCamera = view ? null : { x: cam.x, y: cam.y, zoom };
  nodeGraphGlGraphState.frameCamera = frameCamera;
  const gesturingEarly = typeof nodeGraphViewportGestureActive === "function" && nodeGraphViewportGestureActive();
  // Gesture: camera uniform only. The cached mesh replays and its face quads
  // sample the live face textures, so displays keep running while zooming
  // without a rebuild (display hold stays off).
  if (!view && frameCamera && gesturingEarly && nodeGraphGlGraphReplayMesh("all")) return true;
  const beginOpts = { scale, transparent: true, camera: frameCamera, keepMesh: !view || view.hold === true };
  const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], beginOpts);
  const wireBatch = nodeGraphGlLinesBegin(wireCanvas, [0, 0, 0, 0], beginOpts);
  // Free wire ends (drag cursor) as straight coverage, then "Show on top"
  // Text Boxes and badges. Ends on a module draw in that module's stack.
  const contactBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], beginOpts);
  const veilBatch = nodeGraphGlLinesBegin(dotsCanvas, [0, 0, 0, 0], { ...beginOpts, keep: true });
  // Snake select trail on its own canvas. Do not keep: this is the only batch,
  // so the previous stroke must be cleared or each drag sticks forever.
  const trailBatch = view ? null : nodeGraphGlLinesBegin(snakeCanvas, [0, 0, 0, 0], beginOpts);
  if (!batch || !wireBatch || !contactBatch || !veilBatch || (!view && !trailBatch)) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(canvas);
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(canvas, "GL graph begin");
    return false;
  }
  const gesturing = typeof nodeGraphViewportHoldsDisplays === "function"
    && nodeGraphViewportHoldsDisplays();
  if (!gesturing) nodeGraphGlGraphSettleTextBake();
  let thick = nodeGraphGlGraphState.thick;
  let dotSize = nodeGraphGlGraphState.dotSize;
  if (nodeGraphGlGraphState.thickGen !== nodeGraphGlGraphState.gen || !(thick > 0)) {
    nodeGraphGlGraphState.thickGen = nodeGraphGlGraphState.gen;
    const style = getComputedStyle(host);
    thick = Number.parseFloat(style.getPropertyValue("--node-wire-thickness")) || 3;
    const parsedDot = Number.parseFloat(style.getPropertyValue("--node-wire-patch-point-size"));
    // Same default as UIDEV nodeUiDevWirePatchPointSize (locked 7.86).
    dotSize = Number.isFinite(parsedDot) ? parsedDot : 7.86;
    nodeGraphGlGraphState.thick = thick;
    nodeGraphGlGraphState.dotSize = dotSize;
    nodeGraphGlGraphState.traceThick = Number.parseFloat(style.getPropertyValue("--node-trace-wire-thickness")) || 1;
    nodeGraphGlGraphState.paramThick = Number.parseFloat(style.getPropertyValue("--node-param-wire-thickness")) || 1;
    const paramDot = Number.parseFloat(style.getPropertyValue("--node-param-wire-dot-size"));
    nodeGraphGlGraphState.paramDot = Number.isFinite(paramDot) ? paramDot : 3.3;
    const wireDip = Number.parseFloat(style.getPropertyValue("--node-wire-dip"));
    nodeGraphGlGraphState.wireDip = Number.isFinite(wireDip) ? Math.min(1, Math.max(0, wireDip)) : 0.35;
    const wireDipWidth = Number.parseFloat(style.getPropertyValue("--node-wire-dip-width"));
    nodeGraphGlGraphState.wireDipWidth = Number.isFinite(wireDipWidth) ? Math.min(1, Math.max(0, wireDipWidth)) : 0.5;
  }
  // Widths are zoom-1 px. The line shader scales them by the live camera,
  // and the cable fade stays 2 screen px. Traces are a 2px stroke that scales.
  const halfWorld = Math.max(0, thick * 0.5);
  const traceHalf = 1;
  const dotWorld = Math.max(0, dotSize * 0.5);
  const paramHalf = Math.max(0, (nodeGraphGlGraphState.paramThick || 0.5) * 0.5);
  const paramDotWorld = Math.max(0, (nodeGraphGlGraphState.paramDot ?? 0.267) * 0.5);
  const wireFeather = 2;
  const screenX = (x) => (x - cam.x) * zoom;
  const screenY = (y) => (y - cam.y) * zoom;
  // Camera uniform: geometry stays in zoom-1 px. Tiles still project on the CPU.
  const toX = frameCamera ? (x) => x : screenX;
  const toY = frameCamera ? (y) => y : screenY;
  const layoutZoom = frameCamera ? 1 : zoom;

  // Param wires on an open rail end on the drawn IO box's outer edge (same
  // boxes the rail painter draws), snapped here so the two never disagree.
  const railEnds = typeof nodeGraphModuleRailWireEnds === "function"
    ? nodeGraphModuleRailWireEnds(batch, nodeGraphGlGraphState.plates, toX, toY, layoutZoom) : [];
  const railTol = 3 * layoutZoom;
  const railEnd = (x, y) => railEnds.find((e) => Math.abs(e.x - x) <= railTol && Math.abs(e.y - y) <= railTol) || null;
  const pad = 120;
  // UIDEV pixelate wires on zoom: patch cables come from the zoom-1 bake.
  const wireBake = nodeGraphGlGraphWireBakeWanted(view, frameCamera, wireCanvas)
    ? nodeGraphGlGraphWireBakeUpdate({
      cam, zoom, cssW, cssH, halfWorld, traceHalf, paramHalf, feather: wireFeather, railEnds, railEnd,
      gesturing: gesturingEarly || gesturing,
    })
    : null;
  if (!wireBake && !view && nodeGraphGlGraphState.wireBake) nodeGraphGlGraphWireBakeDrop();
  // The cable being dragged follows the same pixels (its own picture, every
  // present), also when no patch cable exists yet to make the main bake.
  const wireLiveBake = nodeGraphGlGraphWireBakeWanted(view, frameCamera, wireCanvas)
    ? nodeGraphGlGraphWireLiveBakeUpdate({ halfWorld, traceHalf, paramHalf, feather: wireFeather, railEnds, railEnd })
    : null;
  if (!wireLiveBake && !view && nodeGraphGlGraphState.wireLiveBake) nodeGraphGlGraphWireLiveBakeDrop();
  // Wire end dots by module id: drawn in the module's stack below, so a
  // module in front hides the dots of the one behind (cables stay under).
  const stackedIds = new Set((nodeGraphGlGraphState.stack?.entries || []).map((entry) => entry.plate.id));
  const endsByNode = new Map();
  // UIDEV pixelate wire dots on zoom: stacked dots come from per-module bakes.
  const dotBake = nodeGraphGlGraphDotBakeWanted(view, frameCamera)
    ? nodeGraphGlGraphDotBakeUpdate({
      stackedIds, railEnds, railEnd, dotWorld, paramDotWorld, feather: wireFeather,
      gesturing: gesturingEarly || gesturing,
    })
    : null;
  if (!dotBake && !view && nodeGraphGlGraphState.dotBake) nodeGraphGlGraphDotBakeDrop();
  // Room light on the cable canvas: a black quad UNDER the cables darkens the workspace seen through
  // it (same amount as before). The cables darken by their own colour (UI Dev "lighting: wires"), so
  // at 0 they turn into black shadow wires instead of fading out.
  const wireLight = view ? 1 : nodeGraphGlGraphWireLight(false);
  const roomDarkUnderWires = !view && typeof nodeGraphRoomAmbientDark === "function"
    ? Math.max(0, Math.min(1, nodeGraphRoomAmbientDark())) : 0;
  if (roomDarkUnderWires > 0 && typeof nodeGraphGlLinesRect === "function") {
    const kx = frameCamera ? 1 : zoom;
    nodeGraphGlLinesRect(
      wireBatch, toX(cam.x - 16), toY(cam.y - 16), (cssW / zoom + 32) * kx, (cssH / zoom + 32) * kx,
      [0, 0, 0, Math.min(roomDarkUnderWires, 1 - NODE_CABLE_FLOOR)],
    );
  }
  for (let i = 0; i < nodeGraphGlGraphState.wires.length; i += 1) {
    const wire = nodeGraphGlGraphState.wires[i];
    const src = wire.xy;
    if (!src || src.length < 4) continue;
    let screen = nodeGraphGlGraphState.screen;
    if (screen.length < src.length) {
      screen = new Float32Array(src.length);
      nodeGraphGlGraphState.screen = screen;
    }
    for (let p = 0; p < src.length; p += 2) {
      screen[p] = screenX(src[p]);
      screen[p + 1] = screenY(src[p + 1]);
    }
    // Keep a wire when any segment crosses the view. Endpoint-only culling
    // dropped curves whose ends were offscreen and whose middle was not.
    const left = -pad;
    const top = -pad;
    const right = cssW + pad;
    const bottom = cssH + pad;
    let visible = false;
    for (let p = 2; p < src.length; p += 2) {
      const ax = screen[p - 2];
      const ay = screen[p - 1];
      const bx = screen[p];
      const by = screen[p + 1];
      const minX = ax < bx ? ax : bx;
      const maxX = ax < bx ? bx : ax;
      const minY = ay < by ? ay : by;
      const maxY = ay < by ? by : ay;
      if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) {
        visible = true;
        break;
      }
    }
    if (!visible) continue;
    const style = wire.style === "trace" ? "trace" : "ribbon";
    const strokeWorld = style === "trace" ? traceHalf : (wire.param ? paramHalf : halfWorld);
    const feather = style === "trace" ? 0 : wireFeather;
    let rgba = wire.rgba;
    let picked = false;
    if (wire.kind && wire.index >= 0 && typeof nodeGraphSelectedWireEntries === "function") {
      picked = nodeGraphSelectedWireEntries().some((entry) =>
        (entry.kind || "signal") === wire.kind && Number(entry.index) === wire.index,
      );
      if (picked) {
        rgba = [0.95, 0.86, 0.45, 1];
      }
    }
    rgba = nodeGraphGlGraphShadeRgba(rgba, wireLight);
    // Baked cables are already in the zoom-1 picture, and so is a live one
    // whenever its own picture was made; otherwise it strokes here.
    const isLive = nodeGraphGlGraphWireIsLive(wire);
    if (!wire.dotOnly && (isLive ? !wireLiveBake : !wireBake)) {
      const stroke = frameCamera ? strokeWorld : strokeWorld * zoom;
      let pts = frameCamera ? src : screen.subarray(0, src.length);
      if (wire.param && railEnds.length) {
        pts = Float32Array.from(pts);
        for (const ix of [0, pts.length - 2]) {
          const e = railEnd(pts[ix], pts[ix + 1]);
          if (e) { pts[ix] = e.x; pts[ix + 1] = e.y; }
        }
      }
      if (style === "trace") {
        nodeGraphGlLinesPolyline(wireBatch, pts, stroke, feather, rgba, "ortho");
      } else if (typeof nodeGraphGlLinesRibbon !== "function") {
        nodeGraphGlLinesPolyline(wireBatch, pts, stroke, feather, rgba, "butt");
      } else {
        // Param wires dip-darken their middle; selected wires stay plain.
        nodeGraphGlLinesRibbon(wireBatch, pts, stroke, feather, rgba, wire.param && !picked ? (nodeGraphGlGraphState.wireDip ?? 0.35) : 0, nodeGraphGlGraphState.wireDipWidth ?? 0.5);
      }
    }
    const dots = wire.dots || [];
    const selectedRgba = [0.95, 0.86, 0.45, 1];
    const dotsBaked = Boolean(dotBake) && !nodeGraphGlGraphWireIsLive(wire);
    for (let d = 0; d < dots.length; d += 1) {
      const dot = dots[d];
      // Already in its module's dot picture.
      if (dotsBaked && dot.node && stackedIds.has(dot.node)) continue;
      const dx = screenX(dot.x);
      const dy = screenY(dot.y);
      let dotX = frameCamera ? dot.x : dx;
      let dotY = frameCamera ? dot.y : dy;
      const snapEnd = dot.param && railEnds.length ? railEnd(dotX, dotY) : null;
      if (snapEnd) { dotX = snapEnd.x; dotY = snapEnd.y; }
      const dotHalf = dot.param ? paramDotWorld : dotWorld;
      if (!(dotHalf > 0)) continue;
      const dotReach = frameCamera ? dotHalf : dotHalf * zoom;
      if (dx < -dotReach || dy < -dotReach || dx > cssW + dotReach || dy > cssH + dotReach) continue;
      const end = { x: dotX, y: dotY, reach: dotReach, rgba: picked ? selectedRgba : dot.rgba, square: dot.square };
      if (dot.node && stackedIds.has(dot.node)) {
        let own = endsByNode.get(dot.node);
        if (!own) endsByNode.set(dot.node, (own = []));
        own.push(end);
      } else {
        nodeGraphGlGraphDrawWireEnd(contactBatch, end, wireFeather);
      }
    }
  }
  // Plate stroke vars: read once per rebuild generation, not per present.
  if (nodeGraphGlGraphState.plateStyleGen !== nodeGraphGlGraphState.gen || !nodeGraphGlGraphState.plateStyle) {
    const cs = getComputedStyle(host);
    const props = {};
    for (const name of ["--node-module-idle-stroke", "--node-module-selected-stroke", "--node-module-idle-stroke-width"]) {
      props[name] = cs.getPropertyValue(name);
    }
    nodeGraphGlGraphState.plateStyle = { getPropertyValue: (name) => props[name] ?? "" };
    nodeGraphGlGraphState.plateStyleGen = nodeGraphGlGraphState.gen;
  }
  const plateStyle = nodeGraphGlGraphState.plateStyle;
  const borderIdle = nodeGraphGlGraphParseCssColor(
    plateStyle.getPropertyValue("--node-module-idle-stroke"),
    [0.631, 0.608, 0.608, 0.9],
  );
  const borderOn = nodeGraphGlGraphParseCssColor(
    plateStyle.getPropertyValue("--node-module-selected-stroke"),
    [0.95, 0.86, 0.45, 1],
  );
  // DISPLAY_COMPOSITE_LAYERING_PLAN: every module stack (plate, chrome,
  // parameter face, displays, display ink) draws back to front on the plate
  // canvas, one colour buffer, so a front module hides a back module's plate,
  // display and display text. The wire canvas paints under the plate canvas,
  // so all cables sit under the module stacks. Text Box plates keep their
  // stack slot here; the wire sandwich is unchanged.
  const pixelated = zoom > 2.5;
  batch.textPixelated = pixelated;
  const pictures = [];
  const inks = view ? null : new Map();
  const captionsById = nodeGraphGlGraphElementsById(
    view?.host || document, ".node-plugin-momentary-button, .node-plugin-toggle-button",
  );
  const shapesById = nodeGraphGlGraphElementsById(document, ".node-round-shape-display");
  const chromeAll = nodeGraphGlGraphState.chrome;
  const chromeById = chromeAll?.byId || null;
  const groups = nodeGraphGlGraphState.stack?.groups || [];
  // Room light: how dark the workspace is (0 = full light). The Canvas / solo tiles keep the old veil.
  const ambientDark = !view && typeof nodeGraphRoomAmbientDark === "function"
    ? Math.max(0, Math.min(1, nodeGraphRoomAmbientDark())) : 0;
  // Drawings (the pencil strokes on the snake canvas) are not dimmed below this fraction of their brightness.
  if (!view && snakeCanvas) snakeCanvas.style.opacity = ambientDark > 0 ? String(1 - ambientDark * (1 - NODE_DRAWING_FLOOR)) : "";
  // Stroke glow: a tight, soft rim of light just outside each module, in its stroke colour. It is the
  // first layer, so every module stack draws over it and only the rim outside shows.
  // Module lights on the GPU: one pass under every module stack (see the renderer). The base light is
  // the original ellipse; the stroke light follows the module's own shape.
  if (!view && frameCamera && typeof nodeGraphGlLinesLights === "function"
    && (typeof nodeGraphHeatmapWantsLight !== "function" || nodeGraphHeatmapWantsLight()
      || (typeof nodeGraphHeatmapWantsGrid === "function" && nodeGraphHeatmapWantsGrid()))) {
    const spread = typeof nodeGraphHeatmapFloatProperty === "function"
      ? Math.max(0.1, Math.min(2.2, nodeGraphHeatmapFloatProperty(host, "--node-module-light-spread", 0.78))) : 0.78;
    const gridMinX = (typeof nodeGraphGridWidth === "function" ? nodeGraphGridWidth() : 28) * 5;
    const gridMinY = (typeof nodeGraphGridHeight === "function" ? nodeGraphGridHeight() : 28) * 5;
    const look = typeof nodeGraphModulePlateLook === "function" ? nodeGraphModulePlateLook() : null;
    const items = [];
    const plates = nodeGraphGlGraphState.plates || [];
    const wantsLight = typeof nodeGraphHeatmapWantsLight !== "function" || nodeGraphHeatmapWantsLight();
    for (let i = 0; i < plates.length; i += 1) {
      if (!wantsLight && !(typeof nodeGraphHeatmapWantsGrid === "function" && nodeGraphHeatmapWantsGrid())) break;
      const plate = plates[i];
      const reach = 0.45 * spread * Math.max(gridMinX, 1.18 * Math.max(plate.w, plate.h));
      // Skip modules whose light cannot reach the view.
      if (plate.x + plate.w + reach < cam.x || plate.x - reach > cam.x + cssW / zoom
        || plate.y + plate.h + reach < cam.y || plate.y - reach > cam.y + cssH / zoom) continue;
      const selected = typeof nodeGraphNodeElement === "function"
        && nodeGraphNodeElement(plate.id)?.classList.contains("selected");
      const base = selected ? borderOn : borderIdle;
      items.push({ x: plate.x, y: plate.y, w: plate.w, h: plate.h, id: plate.id, base: [base[0], base[1], base[2]], reach, round: look ? look.topRadius : 0 });
    }
    nodeGraphGlLinesLights(batch, items, { spread, gridMinX, gridMinY });
  }
  try {
    for (let g = 0; g < groups.length; g += 1) {
      const group = groups[g];
      const body = nodeGraphGlLinesLayer(batch);
      if (!body) continue;
      // Ambient light layers, created now so they draw after the body: the dim and the module text
      // (routed out of the body so the dim does not double up on it). The dim skips the stroke band,
      // so the body's own stroke stays lit; no second "emit" stroke is drawn over it.
      let dimLayer = null;
      if (ambientDark > 0) {
        dimLayer = nodeGraphGlLinesLayer(batch);
        // The face (slider wells and fills) is a weak light source of its own: drawn after the dim,
        // dimmed only a little, and it does not spill onto anything.
        const faceLayer = nodeGraphGlLinesLayer(batch);
        if (faceLayer) {
          faceLayer.alphaMul = 1 - ambientDark * (1 - NODE_FACE_LIGHT);
          body.overLayer = faceLayer;
        }
        const textLayer = nodeGraphGlLinesLayer(batch);
        if (textLayer) {
          textLayer.textDark = Math.min(ambientDark, 1 - NODE_TEXT_FLOOR);
          body.textLayer = textLayer;
        }
      }
      const captions = [];
      const shapes = [];
      for (let i = 0; i < group.plates.length; i += 1) {
        const plate = group.plates[i];
        nodeGraphGlGraphState.chrome = chromeById?.get(plate.id) || chromeById?.empty || chromeAll;
        nodeGraphGlGraphDrawPlate(body, plate, toX, toY, layoutZoom, cssW, cssH, plateStyle, borderOn, borderIdle);
        nodeGraphGlGraphDrawChrome(body, toX, toY, layoutZoom, cssW, cssH, nodeGraphGlGraphIoOverlay(plate.id));
        const ownCaptions = captionsById.get(plate.id);
        if (ownCaptions) captions.push(...ownCaptions);
        const ownShapes = shapesById.get(plate.id);
        if (ownShapes) shapes.push(...ownShapes);
      }
      nodeGraphGlGraphState.chrome = chromeAll;
      if (typeof nodeGraphModuleFaceDrawAllGl === "function") {
        nodeGraphModuleFaceDrawAllGl(body, group.plates, toX, toY, layoutZoom, cssW, cssH);
      }
      if (typeof nodeGraphModuleRailsDrawGl === "function") {
        nodeGraphModuleRailsDrawGl(body, group.plates, toX, toY, layoutZoom, cssW, cssH);
      }
      // Ambient light: darken what the body drew inside the plate (plate, chrome, parameter face); the
      // stroke is outside the dim. Displays and their ink are drawn after this, so they stay lit too.
      if (ambientDark > 0) {
        if (dimLayer) {
          // The body (plate, chrome) is darkened; text and the face are lit layers drawn after this.
          for (let i = 0; i < group.plates.length; i += 1) {
            nodeGraphGlGraphState.chrome = chromeById?.get(group.plates[i].id) || chromeById?.empty || chromeAll;
            nodeGraphGlGraphDrawPlate(dimLayer, group.plates[i], toX, toY, layoutZoom, cssW, cssH, plateStyle, borderOn, borderIdle, "dim", ambientDark);
          }
          nodeGraphGlGraphState.chrome = chromeAll;
        }
      }
      if (group.displays.length) {
        // Pictures (cheap zoom-1 face textures), then their screen-res ink.
        const pics = nodeGraphGlLinesLayer(batch);
        for (let i = 0; i < group.displays.length; i += 1) {
          const face = group.displays[i];
          if (!face.canvas || !(face.w > 0) || !(face.h > 0)) continue;
          const rect = nodeGraphGlGraphDisplayScreenRect(face, toX, toY, layoutZoom);
          if (!(rect.w > 1) || !(rect.h > 1)) continue;
          if (!frameCamera && (rect.x + rect.w < 0 || rect.y + rect.h < 0 || rect.x > cssW || rect.y > cssH)) continue;
          // A face that pins its filter keeps it at every zoom.
          const pin = nodeGraphGlGraphFacePin(face.canvas);
          const hasTex = typeof nodeGraphSharedGlFaceTexture === "function"
            ? Boolean(nodeGraphSharedGlFaceTexture(face.canvas))
            : true;
          if (!hasTex && typeof nodeGraphGlLinesRect === "function") {
            // No live ink yet (dragged in while paused): still show the black screen.
            nodeGraphGlLinesRect(pics, rect.x, rect.y, rect.w, rect.h, [0, 0, 0, 1]);
            continue;
          }
          const picture = nodeGraphGlLinesImage(pics, face.canvas, rect.x, rect.y, rect.w, rect.h, {
            nearest: pin ? pin === "nearest" : pixelated,
            // Pan/zoom already froze the face pixels. Re-upload only when displays paint.
            cache: gesturing,
            alpha: 1,
          });
          if (picture) {
            picture.pin = pin;
            picture.holes = nodeGraphGlGraphIoJacksOff() ? [] : nodeGraphGlGraphJackHoles(
              chromeById?.get(face.id)?.jacks || [],
              group.plates.find((p) => p.id === face.id) || null,
              plateStyle,
              frameCamera || { x: 0, y: 0, zoom: layoutZoom },
              batch.scale || 1,
            );
            pictures.push(picture);
          }
        }
        const ink = nodeGraphGlLinesLayer(batch);
        nodeGraphGlGraphDrawGroupInk(ink, group, toX, toY, layoutZoom, cssW, cssH, Boolean(frameCamera));
        if (inks) for (let i = 0; i < group.displays.length; i += 1) inks.set(group.displays[i].canvas, { layer: ink, group });
      }
      // View B: a dark veil over each whole module, under its jacks, labels and wire dots.
      const veilAlpha = typeof nodeGraphIoViewConfig === "function" ? Number(nodeGraphIoViewConfig().veil) || 0 : 0;
      if (veilAlpha > 0) {
        const veil = nodeGraphGlLinesLayer(batch);
        if (veil) {
          for (let i = 0; i < group.plates.length; i += 1) {
            const plate = group.plates[i];
            if (!nodeGraphGlGraphIoOverlay(plate.id)) continue;
            nodeGraphGlLinesRect(veil, toX(plate.x), toY(plate.y), plate.w * layoutZoom, plate.h * layoutZoom, [0, 0, 0, veilAlpha]);
          }
        }
      }
      // IO overlay: jacks and labels of opted-in modules, drawn over their display.
      let ioLayer = null;
      for (let i = 0; i < group.plates.length; i += 1) {
        const plate = group.plates[i];
        if (!nodeGraphGlGraphIoOverlay(plate.id)) continue;
        ioLayer = ioLayer || nodeGraphGlLinesLayer(batch);
        if (!ioLayer) break;
        nodeGraphGlGraphState.chrome = chromeById?.get(plate.id) || chromeById?.empty || chromeAll;
        if (!nodeGraphGlGraphIoJacksOff()) {
          nodeGraphGlGraphDrawPlate(ioLayer, plate, toX, toY, layoutZoom, cssW, cssH, plateStyle, borderOn, borderIdle, "rim");
        }
        nodeGraphGlGraphDrawLabels(ioLayer, toX, toY, layoutZoom, cssW, cssH);
        nodeGraphGlGraphState.chrome = chromeAll;
      }
      if (endsByNode.size || dotBake) {
        // UIDEV wire dot shadows off: the dots' soft edge lands unmultiplied
        // where nothing is under it on this canvas, so it reads as part of the
        // cable below instead of a dim ring (see "straight" in gl-line-renderer).
        const dotsStraight = typeof nodeGraphWireDotShadows === "function" && !nodeGraphWireDotShadows();
        let endsLayer = null;
        const newEndsLayer = () => {
          const layer = nodeGraphGlLinesLayer(batch);
          if (layer && dotsStraight) layer.quadBlend = "straight";
          return layer;
        };
        for (let i = 0; i < group.plates.length; i += 1) {
          const bakedDots = dotBake ? dotBake.byNode.get(group.plates[i].id) : null;
          if (bakedDots) {
            // This module's baked dots, in its own stack (front modules cover them).
            endsLayer = endsLayer || newEndsLayer();
            const picture = nodeGraphGlLinesImage(endsLayer, bakedDots.canvas, bakedDots.x, bakedDots.y, bakedDots.w, bakedDots.h, {
              nearest: pixelated,
              cache: true,
              alpha: 1,
            });
            if (picture) {
              picture.pin = "";
              if (dotsStraight) picture.blend = "straight";
              pictures.push(picture);
            }
          }
          const own = endsByNode.get(group.plates[i].id);
          if (!own) continue;
          endsLayer = endsLayer || newEndsLayer();
          for (let d = 0; d < own.length; d += 1) nodeGraphGlGraphDrawWireEnd(endsLayer, own[d], wireFeather);
        }
      }
      // Own layer, after the face textures: the button fill is part of the face picture, so a caption in the
      // body layer would sit under it (Toggle / Momentary showed no Off / On text).
      if (captions.length) {
        nodeGraphGlGraphDrawButtonCaptions(nodeGraphGlLinesLayer(batch) || body, toX, toY, layoutZoom, cssW, cssH, captions);
      }
      // Round shapes paint their own plate: above this group's plate fill.
      if (shapes.length) {
        nodeGraphGlGraphDrawRoundShapes(nodeGraphGlLinesLayer(batch), toX, toY, zoom, Boolean(frameCamera), shapes);
      }
      nodeGraphGlGraphDrawVeils(batch, group.plates, toX, toY, layoutZoom);
    }
  } finally {
    nodeGraphGlGraphState.chrome = chromeAll;
  }
  for (let i = 0; i < nodeGraphGlGraphState.plates.length; i += 1) {
    const plate = nodeGraphGlGraphState.plates[i];
    if (!plate.onTop) continue;
    nodeGraphGlGraphDrawPlate(veilBatch, plate, toX, toY, layoutZoom, cssW, cssH, plateStyle, borderOn, borderIdle);
  }
  nodeGraphGlGraphDrawConstraintBadges(veilBatch, toX, toY, layoutZoom, cssW, cssH);
  if (trailBatch) nodeGraphGlGraphDrawTrail(trailBatch, zoom);
  batch._blend = "alpha";
  wireBatch._blend = "alpha";
  contactBatch._blend = "max";
  veilBatch._blend = "alpha";
  const platesOk = nodeGraphGlLinesEnd(batch, "alpha") !== false;
  const wiresOk = nodeGraphGlLinesEnd(wireBatch, "alpha") !== false;
  if (!view) {
    nodeGraphGlGraphBindRoomLight();
    nodeGraphGlGraphPresentLight();
  }
  if (wireBake || wireLiveBake) nodeGraphGlGraphWireBakeDraw(wireCanvas, frameCamera, zoom, scale);
  const contactOk = nodeGraphGlLinesEnd(contactBatch, "max") !== false;
  const veilOk = nodeGraphGlLinesEnd(veilBatch, "alpha") !== false;
  // "max" stores straight coverage. SRC_ALPHA on this premultipliedAlpha:false
  // blit is multiplied again and leaves a dark edge on a bright picture.
  if (trailBatch) trailBatch._blend = "max";
  const trailOk = !trailBatch || nodeGraphGlLinesEnd(trailBatch, "max") !== false;
  if (!view) {
    nodeGraphGlGraphState.mesh = {
      gen: nodeGraphGlGraphState.gen,
      displayGen: nodeGraphGlGraphState.displayGen || 0,
      w: canvas.width,
      h: canvas.height,
      cam: frameCamera ? { x: frameCamera.x, y: frameCamera.y, zoom: frameCamera.zoom } : null,
      batches: [batch, wireBatch, contactBatch, veilBatch, trailBatch],
      wireBake: Boolean(wireBake || wireLiveBake),
      wireScale: scale,
      pictures,
      inks,
    };
  }
  if (view?.hold) {
    // Whole-module tile: replayed on displays-only frames (nodeGraphGlGraphReplayTile).
    view.held = { gen: nodeGraphGlGraphState.gen, w: cssW, h: cssH, batches: [batch, wireBatch, contactBatch, veilBatch] };
  }
  if (typeof nodeGraphPositionGridHtml === "function") nodeGraphPositionGridHtml();
  // The guide HUD changes with the constraint toggles/metrics (they call it
  // directly) and with the layout: once per rebuild here, not per present.
  if (!view && (nodeGraphGlGraphState.guideGen !== nodeGraphGlGraphState.gen || nodeGraphGlGraphState.guideDirty)) {
    nodeGraphGlGraphState.guideGen = nodeGraphGlGraphState.gen;
    nodeGraphGlConstraintGuidePresent();
  }
  return platesOk && wiresOk && contactOk && veilOk && trailOk;
}

/**
 * Perform / layout canvas whole-module tiles: the module was moved out of the (hidden) workspace,
 * so run this same rebuild + present once per tile, mapped onto it (zoom = the tile's fit scale,
 * camera = the module's offset in the tile, that module only, no cables).
 */
function nodeGraphGlGraphPresentTiles(displaysOnly = false) {
  const faces = document.querySelectorAll(".node-layout-canvas-tile > .dsp-node.node-whole-module-face");
  for (let i = 0; i < faces.length; i += 1) {
    // A displays-only frame replays the held tile mesh (its quads sample the
    // live face textures), so tile displays keep running without a rebuild.
    if (!displaysOnly || !nodeGraphGlGraphReplayTile(faces[i])) nodeGraphGlGraphPresentTile(faces[i]);
  }
  nodeGraphGlGraphPresentFaceHosts();
}

function nodeGraphGlGraphReplayTile(face) {
  const tile = face?.parentElement;
  const held = tile?._glGraphHeld;
  if (!held || held.gen !== nodeGraphGlGraphState.gen || !tile._glGraphCanvas?.isConnected
    || tile.clientWidth !== held.w || tile.clientHeight !== held.h) return false;
  let ok = true;
  for (let i = 0; i < held.batches.length; i += 1) {
    const batch = held.batches[i];
    if (batch && nodeGraphGlLinesEnd(batch, batch._blend || "alpha") === false) ok = false;
  }
  return ok;
}

const NODE_GRAPH_FACE_HOST = ".node-screen-solo-face:not(.node-whole-module-face)";

/**
 * Canvas view tiles and screen solo (DISPLAY_COMPOSITE_LAYERING_PLAN stage 4):
 * a face section moved out of its module. Its displays draw from their face
 * textures at their boxes, with their screen-res ink, into one GL canvas
 * behind the face's own DOM (z -1 in the face's stacking context); the hidden
 * display canvas is only the layout record and hit target. A face back in
 * the workspace (or on a Meta root view, which the workspace pass draws)
 * drops its host canvas.
 */
function nodeGraphGlGraphPresentFaceHosts() {
  const faces = document.querySelectorAll(`${NODE_GRAPH_FACE_HOST}, .gl-face-host:not(.node-layout-canvas-tile)`);
  for (let i = 0; i < faces.length; i += 1) {
    const face = faces[i];
    if (face.matches(NODE_GRAPH_FACE_HOST) && !face.closest("#nodeGraphWorkspace")) nodeGraphGlGraphPresentFaceHost(face);
    else nodeGraphGlGraphDropFaceHost(face);
  }
}

function nodeGraphGlGraphDropFaceHost(face) {
  face.classList.remove("gl-face-host");
  face._glFaceCanvas?.remove();
  face._glFaceCanvas = null;
}

function nodeGraphGlGraphPresentFaceHost(face) {
  const displays = face.querySelectorAll(NODE_GRAPH_DISPLAY_FACE_SELECTOR);
  const cssW = face.clientWidth;
  const cssH = face.clientHeight;
  if (!displays.length || !(cssW > 1) || !(cssH > 1)) {
    nodeGraphGlGraphDropFaceHost(face);
    return;
  }
  let canvas = face._glFaceCanvas;
  if (!canvas || canvas.parentElement !== face) {
    canvas = document.createElement("canvas");
    canvas.className = "node-gl-face-host-canvas";
    canvas.setAttribute("aria-hidden", "true");
    face.prepend(canvas);
    face._glFaceCanvas = canvas;
  }
  const scale = nodeGraphGlGraphFit(canvas, cssW, cssH);
  const batch = nodeGraphGlLinesBegin(canvas, [0, 0, 0, 0], { scale, transparent: true });
  if (!batch) {
    nodeGraphGlGraphDropFaceHost(face);
    return;
  }
  // Client px -> the face's own CSS px (the stage or tile may be scaled).
  const box = face.getBoundingClientRect();
  const kx = box.width > 0 ? face.offsetWidth / box.width : 1;
  const ky = box.height > 0 ? face.offsetHeight / box.height : 1;
  const left = box.left + face.clientLeft / kx;
  const top = box.top + face.clientTop / ky;
  // Output: the same screen-res pause bars as its workspace stack ink.
  const outputPaused = typeof nodeGraphPatchNode === "function"
    && String(nodeGraphPatchNode(face.dataset.node)?.type || "") === "output"
    && typeof nodeGraphLiveEngineIsPaused === "function" && nodeGraphLiveEngineIsPaused();
  for (let i = 0; i < displays.length; i += 1) {
    const display = displays[i];
    if (!(display.width > 1) || !(display.height > 1) || display.closest("[hidden]")) continue;
    const r = display.getBoundingClientRect();
    if (!(r.width > 1) || !(r.height > 1)) continue;
    const x = (r.left - left) * kx;
    const y = (r.top - top) * ky;
    const w = r.width * kx;
    const h = r.height * ky;
    // Same rule as the Mini Canvas: nearest once a face pixel covers more
    // than 2.5 screen pixels, unless the face pins its filter.
    nodeGraphGlLinesImage(batch, display, x, y, w, h, {
      nearest: nodeGraphGlGraphFaceNearest(display, w / display.width > 2.5),
      alpha: 1,
    });
    nodeGraphGlGraphDrawDisplayInk(batch, display, x, y, w, h);
    if (outputPaused && typeof paintNodeGraphOutputPauseBars === "function") {
      paintNodeGraphOutputPauseBars(batch, w, h, { x, y });
    }
  }
  if (nodeGraphGlLinesEnd(batch, "alpha") !== false) face.classList.add("gl-face-host");
}

function nodeGraphGlGraphPresentTile(face) {
  const tile = face?.parentElement;
  const nat = face?._wholeModuleNatural;
  const id = String(face?.dataset?.node || "");
  if (!tile || !id || !(nat?.w > 0) || !(tile.clientWidth > 0) || !(tile.clientHeight > 0)) return;
  const faceRect = face.getBoundingClientRect();
  const tileRect = tile.getBoundingClientRect();
  if (!(faceRect.width > 1) || !(tileRect.width > 1)) return;
  const k = faceRect.width / nat.w; // client px per zoom-1 px
  const state = nodeGraphGlGraphState;
  const saved = {
    canvas: state.canvas, dotsCanvas: state.dotsCanvas, wires: state.wires, plates: state.plates,
    displays: state.displays, stack: state.stack, chrome: state.chrome, thick: state.thick, dotSize: state.dotSize,
  };
  state.view = {
    host: tile,
    hold: true,
    ids: new Set([id]),
    zoom: k * (tile.clientWidth / tileRect.width),
    cam: { x: -(faceRect.left - tileRect.left) / k, y: -(faceRect.top - tileRect.top) / k },
    toWorld: (clientX, clientY) => ({ x: (clientX - faceRect.left) / k, y: (clientY - faceRect.top) / k }),
  };
  state.canvas = tile._glGraphCanvas || null;
  state.dotsCanvas = tile._glGraphDots || null;
  state.wires = [];
  try {
    nodeGraphGlGraphRebuildPlates();
    const ok = nodeGraphGlGraphPresent() !== false;
    tile._glGraphCanvas = state.canvas;
    tile._glGraphDots = state.dotsCanvas;
    tile._glGraphHeld = ok ? state.view.held || null : null;
    // The tile's displays are its plate pass quads now: hide their bitmaps.
    tile.classList.toggle("gl-face-host", ok);
  } finally {
    state.view = null;
    Object.assign(state, saved);
  }
}

/** Full rebuild from the patch. Returns true when GL owns cables. */
function nodeGraphGlGraphPaint(options = {}) {
  if (!options.lite && nodeGraphMvp) {
    for (const connection of nodeGraphMvp.connections || []) {
      if (typeof markNodeGraphWireEndpointsConnected === "function") {
        markNodeGraphWireEndpointsConnected(connection);
      }
    }
    for (const modulation of nodeGraphMvp.modulations || []) {
      if (typeof markNodeGraphWireEndpointsConnected === "function") {
        markNodeGraphWireEndpointsConnected(modulation, "modulation");
      }
    }
  }
  nodeGraphGlGraphRebuild(options);
  nodeGraphGlGraphPresent();
  nodeGraphGlHitInstall();
  return true;
}

// The mouse is a lamp: it LIFTS the ambient darkness around it (the dim quads are lightened in the
// shader), so what it lights shows at its own colour, never washed toward white.
globalThis.nodeGraphRoomLightUniform = function nodeGraphRoomLightUniform() {
  const mouse = nodeGraphRoomLight.mouse;
  const host = document.getElementById("nodeGraphWorkspace");
  const cam0 = nodeGraphGlGraphState.frameCamera;
  if (!mouse || !host || !cam0) return null;
  const rect = host.getBoundingClientRect();
  const cssW = Math.max(1, host.clientWidth || 1);
  const ratio = rect.width > 0 ? rect.width / cssW : 1;
  const zoom = cam0.zoom || 1;
  return [
    cam0.x + (mouse.x - rect.left) / ratio / zoom,
    cam0.y + (mouse.y - rect.top) / ratio / zoom,
    280 / zoom,
    1.0,
  ];
};

// ---- Room light: the mouse lamp only -------------------------------------------------------------
// (Module halos were tried and dropped: the module lamps in the heatmap already give each module its
// subtle glow.) The lamp itself lives in the dim quads' shader; this keeps its state.
const nodeGraphRoomLight = { mouse: null, frame: 0, had: false };

// Kept as a no-op so the callers need no change; removes a leftover light canvas.
function nodeGraphGlGraphPresentLight() {
  const canvas = nodeGraphGlGraphState.lightCanvas;
  if (canvas) {
    canvas.remove();
    nodeGraphGlGraphState.lightCanvas = null;
  }
}

function nodeGraphGlGraphPresentLightSoon() {
  if (nodeGraphRoomLight.frame) return;
  nodeGraphRoomLight.frame = window.requestAnimationFrame(() => {
    nodeGraphRoomLight.frame = 0;
    nodeGraphGlGraphPresentLight();
  });
}

// Re-draw the cached scene so the dim quads pick up the new lamp position.
function nodeGraphGlGraphRoomLampSoon() {
  if (nodeGraphRoomLight.lampFrame) return;
  nodeGraphRoomLight.lampFrame = window.requestAnimationFrame(() => {
    nodeGraphRoomLight.lampFrame = 0;
    if (!nodeGraphGlGraphReplayMesh("all")) nodeGraphGlGraphPresent();
    nodeGraphGlGraphPresentLight();
  });
}

function nodeGraphGlGraphBindRoomLight() {
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host || host.dataset.roomLightBound === "1") return;
  host.dataset.roomLightBound = "1";
  host.addEventListener("pointermove", (event) => {
    nodeGraphRoomLight.mouse = { x: event.clientX, y: event.clientY };
    // The lamp moves the text light in a dark room, and the grid lines light up under it in any room.
    if ((typeof nodeGraphRoomAmbientDark === "function" && nodeGraphRoomAmbientDark() > 0)
      || (typeof nodeGraphHeatmapWantsGrid === "function" && nodeGraphHeatmapWantsGrid())) nodeGraphGlGraphRoomLampSoon();
  }, { passive: true });
  host.addEventListener("pointerleave", () => {
    nodeGraphRoomLight.mouse = null;
    nodeGraphGlGraphRoomLampSoon();
  }, { passive: true });
}

function nodeGraphGlGraphPresentSoon() {
  if (nodeGraphGlGraphPresentSoon._frame) return;
  nodeGraphGlGraphPresentSoon._frame = window.requestAnimationFrame(() => {
    nodeGraphGlGraphPresentSoon._frame = 0;
    nodeGraphGlGraphPresent();
  });
}

/** One displays-only stamp next frame (face textures repainted, nothing else changed). */
function nodeGraphGlGraphPresentDisplaysSoon() {
  if (nodeGraphGlGraphPresentDisplaysSoon._frame) return;
  nodeGraphGlGraphPresentDisplaysSoon._frame = window.requestAnimationFrame(() => {
    nodeGraphGlGraphPresentDisplaysSoon._frame = 0;
    nodeGraphGlGraphPresent({ displaysOnly: true });
  });
}

// Unit-orbit step longer than this is a jump, not a side. It is not stroked.
const NODE_GRAPH_ROUND_ORBIT_JUMP = 0.45;

function nodeGraphGlGraphRoundOrbitRuns(unitPts) {
  const n = unitPts.length;
  if (n < 2) return [];
  const brk = new Array(n);
  let any = false;
  for (let i = 0; i < n; i += 1) {
    const a = unitPts[i];
    const b = unitPts[(i + 1) % n];
    brk[i] = Math.hypot(b.x - a.x, b.y - a.y) > NODE_GRAPH_ROUND_ORBIT_JUMP;
    if (brk[i]) any = true;
  }
  const compact = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const prev = out[out.length - 1];
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.02) continue;
      out.push(p);
    }
    return out;
  };
  if (!any) return [{ closed: true, pts: compact(unitPts) }];
  let start = 0;
  for (let i = 0; i < n; i += 1) {
    if (brk[i]) {
      start = (i + 1) % n;
      break;
    }
  }
  const runs = [];
  let cur = [unitPts[start]];
  for (let k = 0; k < n; k += 1) {
    const i = (start + k) % n;
    const j = (i + 1) % n;
    if (brk[i]) {
      const packed = compact(cur);
      if (packed.length) runs.push({ closed: false, pts: packed });
      cur = [];
    }
    if (k < n - 1) cur.push(unitPts[j]);
  }
  const tail = compact(cur);
  if (tail.length) runs.push({ closed: false, pts: tail });
  return runs;
}

/**
 * RoundShape orbit. Continuous runs are one ribbon. A jump is not stroked:
 * a run that collapses to a point is a dot, so a full square is four dots.
 */
function nodeGraphGlGraphDrawRoundShapes(batch, toX, toY, zoom, cameraOn, faces) {
  if (!batch || typeof nodeGraphGlLinesPolyline !== "function") return;
  const samples = 256;
  for (let i = 0; i < faces.length; i += 1) {
    const section = faces[i];
    if (section.offsetWidth < 8 || section.offsetHeight < 8) continue;
    const nodeEl = section.closest(".dsp-node");
    if (!nodeEl || nodeEl.classList.contains("oscilloscope-hidden") || nodeEl.classList.contains("face-track-omitted")) continue;
    const box = typeof nodeGraphGlGraphWorldBox === "function" ? nodeGraphGlGraphWorldBox(section) : null;
    if (!box || !(box.w > 4) || !(box.h > 4)) continue;
    const id = String(nodeEl.dataset.node || "");
    const node = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(id) : null;
    if (!node) continue;
    const isOsc = node.type === "ellipsoidOsc";
    let shape = typeof nodeGraphRoundShapeLiveParam === "function"
      ? Number(nodeGraphRoundShapeLiveParam(node, "morph", 0))
      : Number(node.params?.morph);
    if (!Number.isFinite(shape)) shape = 0;
    shape = Math.max(0, Math.min(1, shape));
    const look = typeof nodeGraphRoundShapeFaceLook === "function"
      ? nodeGraphRoundShapeFaceLook(node)
      : {};
    // Line thickness 0 = no orbit line (the dot stays).
    const strokeRaw = Number(look.lineThickness);
    const strokeW = Number.isFinite(strokeRaw) ? Math.max(0, strokeRaw) : 2;
    // Dot size 0 = no dot.
    const dotRaw = Number(look.dotThickness);
    const dotW = Number.isFinite(dotRaw) ? Math.max(0, dotRaw) : 5;
    const bg = nodeGraphGlGraphParseCssColor(look.backgroundPaint || look.background || "#020609", [0.008, 0.024, 0.035, 1]);
    const stroke = nodeGraphGlGraphParseCssColor(look.strokePaint || look.strokeColor || "#7fc7d9", [0.5, 0.86, 0.78, 1]);
    const dotColor = nodeGraphGlGraphParseCssColor(look.dotPaint || look.dotColor || "#ffffff", [1, 1, 1, 1]);
    const scale = cameraOn ? 1 : zoom;
    const x = toX(box.x);
    const y = toY(box.y);
    const w = box.w * scale;
    const h = box.h * scale;
    nodeGraphGlLinesRect(batch, x, y, w, h, bg);
    const pad = Math.max(6, Math.min(box.w, box.h) * 0.08) + strokeW * 0.5 + 1;
    const half = Math.max(4, Math.min(box.w, box.h) * 0.5 - pad);
    const cx = box.w * 0.5;
    const cy = box.h * 0.5;
    const unit = new Array(samples);
    const eps = 0.5 / samples;
    let px = cx;
    let py = cy;
    for (let s = 0; s < samples; s += 1) {
      let phase = s / samples + eps;
      phase -= Math.floor(phase);
      let pt;
      if (isOsc && typeof nodeGraphRoundShapeEllipsoidOscPoint === "function") {
        pt = nodeGraphRoundShapeEllipsoidOscPoint(phase, node);
      } else if (typeof nodeGraphRoundShapeEllipsoidPoint === "function") {
        pt = nodeGraphRoundShapeEllipsoidPoint(phase, shape);
      } else {
        const a = phase * Math.PI * 2;
        pt = { x: Math.cos(a), y: Math.sin(a) };
      }
      unit[s] = {
        x: Number.isFinite(pt.x) ? pt.x : 0,
        y: Number.isFinite(pt.y) ? pt.y : 0,
      };
      if (s === 0) {
        px = cx + unit[s].x * half;
        py = cy - unit[s].y * half;
      }
    }
    const halfStroke = strokeW * 0.5 * (cameraOn ? 1 : scale);
    const feather = cameraOn ? 1.25 : scale;
    const place = (p) => [toX(box.x + cx + p.x * half), toY(box.y + cy - p.y * half)];
    const runs = nodeGraphGlGraphRoundOrbitRuns(unit);
    const cornerDots = [];
    for (let r = 0; r < runs.length; r += 1) {
      const run = runs[r];
      if (run.pts.length < 2) {
        if (run.pts[0]) cornerDots.push(run.pts[0]);
        continue;
      }
      const seq = run.closed ? run.pts.concat([run.pts[0]]) : run.pts;
      const flat = new Float32Array(seq.length * 2);
      for (let p = 0; p < seq.length; p += 1) {
        const at = place(seq[p]);
        flat[p * 2] = at[0];
        flat[p * 2 + 1] = at[1];
      }
      if (strokeW > 0) nodeGraphGlLinesStroke(batch, flat, halfStroke, feather, stroke);
    }
    for (let d = 0; strokeW > 0 && d < cornerDots.length; d += 1) {
      const at = place(cornerDots[d]);
      nodeGraphGlLinesStroke(batch, [at[0], at[1]], halfStroke, feather, stroke);
    }
    if (typeof nodeGraphRoundShapeLiveCursor === "function" && !isOsc) {
      const cursor = nodeGraphRoundShapeLiveCursor(id, node, section);
      if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
        px = cx + cursor.x * half;
        py = cy - cursor.y * half;
      }
    } else if (isOsc) {
      const liveX = typeof nodeGraphRoundShapeReadScopePort === "function"
        ? nodeGraphRoundShapeReadScopePort(id, "Left")
        : Number.NaN;
      const liveY = typeof nodeGraphRoundShapeReadScopePort === "function"
        ? nodeGraphRoundShapeReadScopePort(id, "Right")
        : Number.NaN;
      if (Number.isFinite(liveX) && Number.isFinite(liveY)) {
        const amp = Math.max(1e-9, Math.abs(Number(node.params?.amplitude)) || 1);
        px = cx + (liveX / amp) * half;
        py = cy - (liveY / amp) * half;
      } else {
        let phase = typeof nodeGraphRoundShapeReadScopePort === "function"
          ? nodeGraphRoundShapeReadScopePort(id, "__Phase")
          : Number.NaN;
        if (!Number.isFinite(phase) && typeof nodeGraphRoundShapeLiveCursor === "function") {
          const cursor = nodeGraphRoundShapeLiveCursor(id, node, section);
          if (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)) {
            px = cx + cursor.x * half;
            py = cy - cursor.y * half;
            phase = Number.NaN;
          }
        }
        if (Number.isFinite(phase) && typeof nodeGraphRoundShapeEllipsoidOscPoint === "function") {
          const pt = nodeGraphRoundShapeEllipsoidOscPoint(phase, node);
          px = cx + pt.x * half;
          py = cy - pt.y * half;
        }
      }
    }
    if (dotW > 0 && typeof nodeGraphGlLinesDot === "function") {
      nodeGraphGlLinesDot(batch, toX(box.x + px), toY(box.y + py), Math.max(0.5, dotW * 0.5) * scale, Math.max(0.75, scale), dotColor);
    }
  }
}

/**
 * Snake select trail. The centerline is uploaded once. Dash phase, round caps,
 * and the fringe are one fragment shader, in zoom-1 px, so zoom only moves uCam.
 */
function nodeGraphGlGraphDrawTrail(trailBatch) {
  if (!trailBatch || typeof nodeGraphHitTrailAllStrokes !== "function") return;
  if (typeof nodeGraphStrokeSmoothPoints !== "function" || typeof nodeGraphGlLinesDash !== "function") return;
  const strokes = nodeGraphHitTrailAllStrokes();
  if (!strokes.length) return;
  const host = document.getElementById("nodeGraphWorkspace");
  const style = host ? getComputedStyle(host) : null;
  const rgba = nodeGraphGlGraphParseCssColor(
    style?.getPropertyValue("--node-selection-hit-trail-color") || "",
    [0, 208 / 255, 1, 1],
  ).slice();
  const alpha = Number.parseFloat(style?.getPropertyValue("--node-selection-hit-trail-alpha") || "");
  rgba[3] = (rgba[3] ?? 1) * (Number.isFinite(alpha) ? alpha : 0.95);
  const zoom = Math.max(1e-4, Number(trailBatch.camera?.zoom) || 1);
  for (let i = 0; i < strokes.length; i += 1) {
    const stroke = strokes[i];
    // worldWidth / worldDash: sizes fixed in world units when the line was
    // drawn (screen px / zoom then), so a drawn line scales with zoom. The
    // trail batch draws through the camera, which applies the zoom itself:
    // widths and dashes go in as world units (multiplying by zoom here
    // applied it twice, so lines ballooned as you zoomed in).
    const world = Number(stroke.worldWidth) > 0;
    const half = world
      ? Math.max(0.25 / zoom, stroke.worldWidth * 0.5)
      : Math.max(0.5, (Number(stroke.width) || 6) * 0.5);
    const dash = world && Array.isArray(stroke.worldDash) ? stroke.worldDash
      : (Array.isArray(stroke.dash) ? stroke.dash : [14, 11]);
    // Fine resample (1.5 world px) so every dash bends with the curve.
    const flat = nodeGraphStrokeSmoothPoints(stroke.points, 1.5);
    if (flat.length < 4) continue;
    // Each dash is its own joined, round-capped stroke along the smoothed
    // curve. The old per-segment rectangles (nodeGraphGlLinesDash) kinked on
    // tight swirls: straight 14 px chunks with notches at every joint.
    if (typeof nodeGraphStrokeDashes === "function" && typeof nodeGraphGlLinesPolyline === "function") {
      // Gap 0 = one solid line.
      const pieces = dash[1] > 0
        ? nodeGraphStrokeDashes(flat, Math.max(1e-3, dash[0]), dash[1])
        : [flat];
      for (let p = 0; p < pieces.length; p += 1) {
        const piece = pieces[p];
        if (piece.length >= 4) nodeGraphGlLinesPolyline(trailBatch, piece, half, 1, rgba);
        else if (piece.length >= 2 && typeof nodeGraphGlLinesDot === "function") nodeGraphGlLinesDot(trailBatch, piece[0], piece[1], half, 1, rgba);
      }
    } else {
      nodeGraphGlLinesDash(trailBatch, flat, half, Math.max(0.5, dash[0]), Math.max(0, dash[1]), rgba);
    }
  }
}

/**
 * Redraw only the trail. Reuses the held mesh for everything else (same path
 * the pan/zoom gesture takes), so a drag does not rebuild plates and wires.
 */
function nodeGraphGlGraphPresentTrail() {
  const state = nodeGraphGlGraphState;
  const mesh = state.mesh;
  const held = mesh?.batches?.[5];
  const camera = held?.camera;
  if (state.view || !mesh || !held || !camera || mesh.gen !== state.gen
    || mesh.w !== held.canvas.width || mesh.h !== held.canvas.height) {
    nodeGraphGlGraphPresentSoon();
    return;
  }
  const trailBatch = nodeGraphGlLinesBegin(held.canvas, [0, 0, 0, 0], {
    scale: held.scale, transparent: true, camera, keepMesh: true,
  });
  if (!trailBatch) {
    if (typeof nodeGraphGlLinesFillBlack === "function") nodeGraphGlLinesFillBlack(held.canvas);
    if (typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(held.canvas, "GL snake trail begin");
    return;
  }
  nodeGraphGlGraphDrawTrail(trailBatch);
  trailBatch._blend = "max";
  mesh.batches[5] = trailBatch;
  for (let i = 0; i < mesh.batches.length; i += 1) {
    const b = mesh.batches[i];
    if (b) nodeGraphGlLinesEnd(b, b._blend || "alpha");
  }
  const wireHeld = mesh.batches[1];
  if (mesh.wireBake && wireHeld?.camera) {
    nodeGraphGlGraphWireBakeDraw(wireHeld.canvas, wireHeld.camera, wireHeld.camera.zoom, mesh.wireScale);
  }
}

function nodeGraphGlGraphPresentCamera() {
  if (!nodeGraphGlGraphState.canvas && !nodeGraphGlGraphState.wires.length) return;
  nodeGraphGlGraphPresent();
}

function nodeGraphGlHitIsLiveHtml(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true'], [popover], .metadata-popover, .node-floating-window, .node-context-menu")) {
    return true;
  }
  return Boolean(target.closest(".node-header-title[data-title-editing='1']"));
}

function nodeGraphGlHitKeepsNativeTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    ".node-face, .node-module-graph-face, .node-module-graph-display, .node-keypad-face, .node-knob-face, .node-xy-pad-canvas, .node-sequencer-roll, .acid-seq-face, .node-step-register-display, .node-clock-face, .node-sturmian-grid, .node-arp-keys-face, .node-pitch-quantizer-face, .node-plugin-toggle-button, .node-plugin-momentary-button, .node-sample-waveform-display, .node-keyboard-surface, .node-keyboard-module, .node-grid-keyboard-surface, .node-grid-keyboard-pad, .node-seed-control, .sabrina-preset-shell, [data-vactrol-show-key]",
  ));
}

function nodeGraphGlHitWireAt(x, y) {
  const wires = nodeGraphGlGraphState.wires || [];
  const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const reach = 9 / Math.max(0.2, zoom);
  let best = null;
  let bestD = reach;
  for (let w = 0; w < wires.length; w += 1) {
    const wire = wires[w];
    const pts = wire.xy;
    if (!wire.kind || wire.index < 0 || !pts || pts.length < 4) continue;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i];
      const ay = pts[i + 1];
      const bx = pts[i + 2];
      const by = pts[i + 3];
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / len2)) : 0;
      const dx = x - (ax + abx * t);
      const dy = y - (ay + aby * t);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = wire;
      }
    }
  }
  return best ? { kind: best.kind, index: best.index } : null;
}

function nodeGraphGlHitWireAtEvent(event) {
  const point = nodeGraphGlHitPoint(event);
  if (!point) return null;
  return nodeGraphGlHitWireAt(point.x, point.y);
}

function nodeGraphGlHitPoint(event) {
  if (typeof nodeGraphClientToZoomSurfacePoint !== "function") return null;
  return nodeGraphClientToZoomSurfacePoint(event.clientX, event.clientY);
}

/**
 * True when a module plate in front of module `id` covers (x, y): that front
 * module takes the hit, not the jacks / labels / sliders / title showing
 * through from behind. Text Box plates never cover (unchanged sandwich).
 */
function nodeGraphGlHitCovered(id, x, y) {
  const plates = nodeGraphGlGraphState.plates || [];
  let covered = false;
  for (let i = plates.length - 1; i >= 0; i -= 1) {
    const plate = plates[i];
    if (plate.id === id) return covered;
    if (!covered && !plate.textBox && !plate.onTop && nodeGraphGlHitInside(x, y, plate)) covered = true;
  }
  return false;
}

function nodeGraphGlHitTest(x, y) {
  const chrome = nodeGraphGlGraphState.chrome || {};
  const jacks = chrome.jacks || [];
  let jackHit = null;
  let jackDist = Infinity;
  const jackRadius = typeof nodeGraphJackHitRadiusPx === "function"
    ? nodeGraphJackHitRadiusPx()
    : 8;
  for (let i = 0; i < jacks.length; i += 1) {
    const jack = jacks[i];
    const reach = Math.max(jack.r || 0, jackRadius);
    const dx = jack.x - x;
    const dy = jack.y - y;
    // B-099: square hit box over every jack (nearest center still wins).
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist > reach || dist >= jackDist || nodeGraphGlHitCovered(jack.id, x, y)) continue;
    jackDist = dist;
    jackHit = jack;
  }
  if (jackHit) return { kind: "jack", x: jackHit.x, y: jackHit.y, jack: jackHit };
  const labels = chrome.labels || [];
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const label = labels[i];
    if (nodeGraphGlHitInside(x, y, label.box) && !nodeGraphGlHitCovered(label.id, x, y)) {
      return { kind: "label", el: label.el };
    }
  }
  const sliders = chrome.sliders || [];
  for (let i = sliders.length - 1; i >= 0; i -= 1) {
    const slider = sliders[i];
    const sx = slider.hitX ?? slider.x;
    const sy = slider.hitY ?? slider.y;
    const sw = slider.hitW ?? slider.w;
    const sh = slider.hitH ?? slider.h;
    if (x >= sx && x <= sx + sw && y >= sy && y <= sy + sh && !nodeGraphGlHitCovered(slider.id, x, y)) {
      let readout = slider.readout;
      if (readout && !readout.isConnected && typeof nodeSliderResolveLiveReadout === "function") {
        readout = nodeSliderResolveLiveReadout(readout);
      }
      if (!readout?.isConnected && slider.input) {
        readout = slider.input.closest?.("label")?.querySelector?.(".node-slider-readout") || null;
      }
      if (!readout?.isConnected) continue;
      return { kind: "slider", readout };
    }
  }
  const titles = chrome.titles || [];
  for (let i = titles.length - 1; i >= 0; i -= 1) {
    const title = titles[i];
    const box = title.box;
    if (!box) continue;
    const inset = 6;
    if (x >= box.x + inset && x <= box.x + box.w - inset && y >= box.y && y <= box.y + box.h
      && !nodeGraphGlHitCovered(title.id, x, y)) {
      return { kind: "title", el: title.el };
    }
  }
  const plates = nodeGraphGlGraphState.plates || [];
  for (let i = plates.length - 1; i >= 0; i -= 1) {
    const plate = plates[i];
    if (x >= plate.x && x <= plate.x + plate.w && y >= plate.y && y <= plate.y + plate.h) {
      return { kind: "plate", id: plate.id };
    }
  }
  return null;
}

function nodeGraphGlHitRetarget(event, element) {
  return new Proxy(event, {
    get(source, key) {
      if (key === "target" || key === "currentTarget") return element;
      const value = source[key];
      return typeof value === "function" ? value.bind(source) : value;
    },
  });
}

function nodeGraphGlHitJackElement(jack) {
  const moduleEl = jack && typeof nodeGraphNodeElement === "function"
    ? nodeGraphNodeElement(jack.id)
    : null;
  if (!moduleEl) return null;
  const name = String(jack.port || "");
  if (!name || typeof CSS === "undefined" || !CSS.escape) {
    return nodeGraphGlHitPortElement(moduleEl, jack.x, jack.y);
  }
  const esc = CSS.escape(name);
  if (jack.kind === "modulation" || jack.io === "modulation") {
    return moduleEl.querySelector(`.node-param-port.modulation-input[data-param="${esc}"]`);
  }
  if (jack.kind === "graph" || jack.io === "graph") {
    return moduleEl.querySelector(`.node-param-port.graph-input[data-graph-input="${esc}"]`);
  }
  if (!jack.signal && jack.kind === "output") {
    return moduleEl.querySelector(`.node-param-port.parameter-output[data-param="${esc}"], .node-param-port.parameter-output[data-port="${esc}"]`)
      || moduleEl.querySelector(`.node-port.output[data-port="${esc}"]`);
  }
  const io = jack.io === "output" ? "output" : "input";
  return moduleEl.querySelector(`.node-port.${io}[data-port="${esc}"]`)
    || nodeGraphGlHitPortElement(moduleEl, jack.x, jack.y);
}

function nodeGraphGlHitPortElement(moduleEl, x, y) {
  if (!moduleEl) return null;
  const ports = moduleEl.querySelectorAll(".node-port, .node-param-port");
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < ports.length; i += 1) {
    const port = ports[i];
    const box = nodeGraphGlGraphWorldBox(port);
    if (!box) continue;
    const dx = box.x + box.w * 0.5 - x;
    const dy = box.y + box.h * 0.5 - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = port;
    }
  }
  return best;
}

const nodeGraphGlHitState = { lastTitleDown: null, lastMetaDown: null };

function nodeGraphGlHitLabelPort(label) {
  const row = label?.closest?.(".node-io-row, .node-io-column, .node-parameter-row");
  return row?.querySelector?.(".node-port, .node-param-port") || null;
}

/** Parameter row under a client point, using the same world box that scrubs the slider. */
function nodeGraphGlParamRowAtClient(clientX, clientY) {
  if (typeof nodeGraphClientToZoomSurfacePoint !== "function") return null;
  const point = nodeGraphClientToZoomSurfacePoint(clientX, clientY);
  if (!point) return null;
  const sliders = nodeGraphGlGraphState.chrome?.sliders || [];
  for (let i = sliders.length - 1; i >= 0; i -= 1) {
    const slider = sliders[i];
    const sx = slider.hitX ?? slider.x;
    const sy = slider.hitY ?? slider.y;
    const sw = slider.hitW ?? slider.w;
    const sh = slider.hitH ?? slider.h;
    if (point.x < sx || point.x > sx + sw || point.y < sy || point.y > sy + sh) continue;
    let readout = slider.readout;
    if (readout && !readout.isConnected && typeof nodeSliderResolveLiveReadout === "function") {
      readout = nodeSliderResolveLiveReadout(readout);
    }
    const row = readout?.closest?.(".node-parameter-row")
      || slider.input?.closest?.(".node-parameter-row")
      || null;
    if (row) return row;
  }
  return null;
}

/**
 * An armed wire lands on the parameter control (mod inlet, or the thru when
 * the pending end is an input). The mod jack itself has no box until the
 * rail opens, so the jack hit test cannot take this click.
 * Returns true when the gesture was a wire completion.
 */
function nodeGraphFinishArmedWireOnParamRow(row, event) {
  const mode = nodeGraphMvp?.portConnectionMode;
  if (!row || !mode || mode.movingWires) return false;
  if (event?.ctrlKey || event?.metaKey || (event?.button !== undefined && event.button !== 0)) return false;
  const port = row.querySelector(":scope > .node-param-port.modulation-input")
    || row.querySelector(":scope > .node-param-port.parameter-output");
  const handler = nodeGraphWireInteractions?.handlePortClick;
  if (!port || typeof handler !== "function") return false;
  event.glParamDrop = true;
  handler(nodeGraphGlHitRetarget(event, port));
  return true;
}

function nodeGraphGlHitPointerDown(event) {
  if (event.button !== 0 && event.button !== 2) return;
  if (nodeGraphGlHitIsLiveHtml(event.target) || nodeGraphGlHitKeepsNativeTarget(event.target)) return;
  if (event.target instanceof Element && event.target.closest(".node-text-box-body, .node-text-box-input")) return;
  const point = nodeGraphGlHitPoint(event);
  if (!point) return;
  const hit = nodeGraphGlHitTest(point.x, point.y);
  if (!hit) {
    const wire = nodeGraphGlHitWireAt(point.x, point.y);
    if (wire && typeof selectNodeGraphWire === "function") {
      event.preventDefault();
      event.stopPropagation();
      selectNodeGraphWire(event, wire.index, wire.kind);
    }
    return;
  }
  if (hit.kind === "slider" && hit.readout) {
    const row = hit.readout.closest?.(".node-parameter-row")
      || hit.readout.closest?.("label")?.closest?.(".node-parameter-row");
    if (row && nodeGraphFinishArmedWireOnParamRow(row, event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 0 && typeof beginNodeSliderDrag === "function") {
      beginNodeSliderDrag(nodeGraphGlHitRetarget(event, hit.readout));
    }
    return;
  }
  if (hit.kind === "label" && hit.el) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    const port = nodeGraphGlHitLabelPort(hit.el);
    const handler = nodeGraphWireInteractions?.handlePortPointerDown;
    if (port && typeof handler === "function") {
      handler(nodeGraphGlHitRetarget(event, port));
    }
    return;
  }
  if (hit.kind === "jack") {
    const port = nodeGraphGlHitJackElement(hit.jack);
    const handler = nodeGraphWireInteractions?.handlePortPointerDown;
    if (port && typeof handler === "function") {
      event.preventDefault();
      event.stopPropagation();
      handler(nodeGraphGlHitRetarget(event, port));
    }
    return;
  }
  if (hit.kind === "title" && hit.el) {
    const now = performance.now();
    const last = nodeGraphGlHitState.lastTitleDown;
    const repeat = last && last.el === hit.el && now - last.time < 400;
    nodeGraphGlHitState.lastTitleDown = { el: hit.el, time: now };
    // Alt + click bypasses, so Alt + double click is two quick bypass toggles, never a rename.
    if (repeat && !event.altKey && typeof startNodeGraphModuleTitleEdit === "function") {
      event.preventDefault();
      event.stopPropagation();
      startNodeGraphModuleTitleEdit(hit.el, event);
      nodeGraphGlHitState.lastTitleDown = null;
      return;
    }
    const row = hit.el.closest(".node-header-title-row") || hit.el;
    if (typeof beginNodeGraphNodeDrag === "function") {
      event.preventDefault();
      event.stopPropagation();
      beginNodeGraphNodeDrag(nodeGraphGlHitRetarget(event, row));
    }
    return;
  }
  if (hit.kind === "plate" && typeof beginNodeGraphNodeDrag === "function") {
    const moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(hit.id) : null;
    const patchNode = typeof nodeGraphPatchNode === "function" ? nodeGraphPatchNode(hit.id) : null;
    // Overlay pointerdown preventDefault kills native dblclick. Same 400ms
    // repeat as title-edit: second plate hit on a Metamodule/Group enters it.
    if (typeof nodeGraphIsContainerShellType === "function" && nodeGraphIsContainerShellType(patchNode?.type)) {
      const now = performance.now();
      const last = nodeGraphGlHitState.lastMetaDown;
      const repeat = last && last.id === hit.id && now - last.time < 400;
      nodeGraphGlHitState.lastMetaDown = { id: hit.id, time: now };
      if (repeat) {
        event.preventDefault();
        event.stopPropagation();
        const drag = typeof nodeGraphMvp !== "undefined" ? nodeGraphMvp.nodeDragging : null;
        if (drag) {
          for (const dragged of drag.draggedNodes || []) {
            dragged.element?.classList?.remove("dragging");
          }
          drag.handle?.classList?.remove("dragging");
          nodeGraphMvp.nodeDragging = null;
        }
        if (typeof enterNodeGraphMetamoduleView === "function") {
          enterNodeGraphMetamoduleView(hit.id);
        }
        nodeGraphGlHitState.lastMetaDown = null;
        return;
      }
    }
    const shell = moduleEl?.querySelector(".node-solid-module-shell, .node-module-chrome-layout-b-shell, .node-header-title-row") || moduleEl;
    if (!shell) return;
    event.preventDefault();
    event.stopPropagation();
    beginNodeGraphNodeDrag(nodeGraphGlHitRetarget(event, shell));
  }
}

function nodeGraphGlHitInside(x, y, box) {
  return Boolean(box) && x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
}

function nodeGraphGlHitChromeBoxes(point, list, pick) {
  if (!point || !list || !list.length) return null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i];
    const box = item.box || item;
    if (!nodeGraphGlHitInside(point.x, point.y, box) || nodeGraphGlHitCovered(item.id, point.x, point.y)) continue;
    const el = typeof pick === "function" ? pick(item) : (item.el || item.control || null);
    if (el) return el;
  }
  return null;
}

function nodeGraphGlHitHoverElement(event) {
  const point = nodeGraphGlHitPoint(event);
  if (!point) return null;
  const chrome = nodeGraphGlGraphState.chrome || {};
  const header = nodeGraphGlHitChromeBoxes(point, chrome.headerButtons);
  if (header) return header;
  const seed = nodeGraphGlHitChromeBoxes(point, chrome.seeds, (item) => item.control);
  if (seed) return seed;
  const context = nodeGraphGlHitContextElement(point);
  if (context) return context;
  const wire = nodeGraphGlHitWireAt(point.x, point.y);
  if (!wire) return null;
  if (!nodeGraphGlHitState.wireHoverEl) {
    const el = document.createElement("div");
    el.className = "node-wire-path";
    nodeGraphGlHitState.wireHoverEl = el;
  }
  return nodeGraphGlHitState.wireHoverEl;
}

function nodeGraphGlHitContextElement(point) {
  const chrome = nodeGraphGlGraphState.chrome || {};
  const keys = chrome.keys || [];
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const key = keys[i];
    if (nodeGraphGlHitInside(point.x, point.y, key) && key.el && !nodeGraphGlHitCovered(key.id, point.x, point.y)) return key.el;
  }
  const graphs = chrome.graphs || [];
  for (let i = graphs.length - 1; i >= 0; i -= 1) {
    const face = graphs[i];
    if (!nodeGraphGlHitInside(point.x, point.y, face) || nodeGraphGlHitCovered(face.id, point.x, point.y)) continue;
    const moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(face.id) : null;
    return moduleEl?.querySelector(".node-module-graph-display") || moduleEl;
  }
  const hit = nodeGraphGlHitTest(point.x, point.y);
  if (!hit) return null;
  if (hit.kind === "slider" && hit.readout) return hit.readout;
  if (hit.kind === "label" && hit.el) return nodeGraphGlHitLabelPort(hit.el) || hit.el;
  if (hit.kind === "title" && hit.el) return hit.el;
  if (hit.kind === "jack") {
    return nodeGraphGlHitJackElement(hit.jack);
  }
  if (hit.kind === "plate") {
    const moduleEl = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(hit.id) : null;
    if (!moduleEl) return null;
    if (typeof nodeGraphModuleFaceHoverControlAtWorld === "function") {
      const faceControl = nodeGraphModuleFaceHoverControlAtWorld(moduleEl, point.x, point.y);
      if (faceControl) return faceControl;
    }
    const knob = moduleEl.querySelector(".node-knob-face");
    const knobBox = nodeGraphGlGraphWorldBox(knob);
    if (nodeGraphGlHitInside(point.x, point.y, knobBox)) return knob;
    const display = nodeGraphGlGraphDisplayAt(hit.id, point.x, point.y);
    if (display?.canvas) return display.canvas;
    // Real controls (GW-4) stay transparent HTML hit targets.
    const control = moduleEl.querySelector(".node-module-scope-canvas, .node-xy-pad-canvas");
    if (nodeGraphGlHitInside(point.x, point.y, nodeGraphGlGraphWorldBox(control))) return control;
    return moduleEl;
  }
  return null;
}

function nodeGraphGlHitContextMenu(event) {
  if (event.glGraphRetarget) return;
  if (nodeGraphGlHitIsLiveHtml(event.target) || nodeGraphGlHitKeepsNativeTarget(event.target)) return;
  if (event.target instanceof Element && event.target.closest(".node-text-box-body, .node-text-box-input")) return;
  const point = nodeGraphGlHitPoint(event);
  if (!point) return;
  const element = nodeGraphGlHitContextElement(point);
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  const readout = element.closest?.(".node-slider-readout") || (element.classList?.contains("node-slider-readout") ? element : null);
  if (readout && typeof openNodeMetadataPopover === "function") {
    openNodeMetadataPopover(event, readout);
    return;
  }
  const forwarded = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    button: 2,
    view: window,
  });
  forwarded.glGraphRetarget = true;
  element.dispatchEvent(forwarded);
}

function nodeGraphGlHitPointerUp(event) {
  if (event.button !== 0) return;
  if (event.ctrlKey || event.metaKey) {
    // Ctrl/Cmd+click on a jack toggles its module's selection (handlePortClick).
    const point = nodeGraphGlHitPoint(event);
    const hit = point ? nodeGraphGlHitTest(point.x, point.y) : null;
    const port = hit?.kind === "jack" ? nodeGraphGlHitJackElement(hit.jack) : null;
    if (port && typeof nodeGraphWireInteractions?.handlePortClick === "function") {
      nodeGraphWireInteractions.handlePortClick(nodeGraphGlHitRetarget(event, port));
    }
    return;
  }
  const drag = nodeGraphMvp?.wireDragging;
  if (!drag || drag.active) return;
  const hitbox = drag.element;
  const port = hitbox?.querySelector?.(".node-port, .node-param-port") || hitbox;
  if (!(port instanceof Element) || typeof nodeGraphWireInteractions?.handlePortClick !== "function") return;
  // A click that never crossed the drag threshold arms the wire so it can be
  // finished without holding the button.
  event.glArmClick = true;
  nodeGraphWireInteractions.handlePortClick(nodeGraphGlHitRetarget(event, port));
  if (nodeGraphMvp.wireDragging && !nodeGraphMvp.wireDragging.active) {
    nodeGraphMvp.wireDragging = null;
  }
}

function nodeGraphGlHitInstall() {
  if (nodeGraphGlHitState.installed) return;
  const host = document.getElementById("nodeGraphWorkspace");
  if (!host) return;
  host.addEventListener("pointerdown", nodeGraphGlHitPointerDown, true);
  host.addEventListener("pointerup", nodeGraphGlHitPointerUp, true);
  host.addEventListener("contextmenu", nodeGraphGlHitContextMenu, true);
  nodeGraphGlHitState.installed = true;
}

/**
 * GB-5. Same four traces every time: zoom out 40→0.35, zoom in 0.35→40,
 * pan at 40×, pan at 0.35×. Restores the camera. Logs a table.
 * Run from the console on the patch you care about: nodeGraphGlGraphMeasureGb5()
 */
function nodeGraphGlGraphMeasureGb5() {
  const frames = 24;
  const traces = [
    { name: "zoom-out 40 to 0.35", from: 40, to: 0.35 },
    { name: "zoom-in 0.35 to 40", from: 0.35, to: 40 },
    { name: "pan at 40x", zoom: 40, pan: true },
    { name: "pan at 0.35x", zoom: 0.35, pan: true },
  ];
  const savedZoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
  const savedPan = {
    x: Number(nodeGraphMvp?.pan?.x) || 0,
    y: Number(nodeGraphMvp?.pan?.y) || 0,
  };
  const rows = [];
  let traceIndex = 0;
  let step = 0;
  const write = (line) => {
    console.warn(line);
    try {
      if (window.SE && typeof window.SE.NOTE === "function") window.SE.NOTE(line);
      else if (window.SE && typeof window.SE.VM === "function") window.SE.VM(line);
    } catch (_error) {
      // The debug log is optional. The console line is the record.
    }
  };
  write("GB-5 started");
  const finish = () => {
    write("GB-5 done");
    try {
      if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(savedZoom);
      if (nodeGraphMvp) nodeGraphMvp.pan = { x: savedPan.x, y: savedPan.y };
      if (typeof applyNodeGraphViewportCssLight === "function") {
        applyNodeGraphViewportCssLight({ zoom: true, pan: true });
      }
      if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
      if (typeof flushNodeGraphViewportOnPointerUp === "function") {
        flushNodeGraphViewportOnPointerUp();
      }
    } catch (error) {
      write(`GB-5 restore failed: ${error && error.message ? error.message : error}`);
    }
    return rows;
  };
  const tick = () => {
    try {
      if (traceIndex >= traces.length) {
        finish();
        return;
      }
      const trace = traces[traceIndex];
      const t0 = performance.now();
      if (trace.pan) {
        if (step === 0 && typeof setNodeGraphZoom === "function") setNodeGraphZoom(trace.zoom);
        const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
        if (nodeGraphMvp) {
          nodeGraphMvp.pan = { x: Number(pan.x) + 48, y: Number(pan.y) + 28 };
        }
        if (typeof markNodeGraphViewportGesture === "function") markNodeGraphViewportGesture("pan");
        if (typeof applyNodeGraphViewportCssLight === "function") {
          applyNodeGraphViewportCssLight({ zoom: false, pan: true, readouts: false });
        }
      } else if (typeof setNodeGraphZoom === "function") {
        const u = frames <= 1 ? 1 : step / (frames - 1);
        setNodeGraphZoom(trace.from + (trace.to - trace.from) * u);
      }
      const mid = performance.now();
      if (typeof nodeGraphGlGraphPresent === "function") nodeGraphGlGraphPresent();
      const total = performance.now() - t0;
      if (!trace.samples) trace.samples = [];
      trace.samples.push(total);
      trace.present = (trace.present || 0) + (performance.now() - mid);
      step += 1;
      if (step >= frames) {
        const samples = trace.samples;
        const sum = samples.reduce((acc, ms) => acc + ms, 0);
        const row = {
          trace: trace.name,
          frames: samples.length,
          totalMs: Math.round(sum),
          presentMs: Math.round(trace.present),
          maxFrameMs: Math.round(samples.reduce((acc, ms) => Math.max(acc, ms), 0)),
        };
        rows.push(row);
        write(`${row.trace}: total ${row.totalMs} ms, present ${row.presentMs} ms, max frame ${row.maxFrameMs} ms`);
        traceIndex += 1;
        step = 0;
      }
    } catch (error) {
      write(`GB-5 stopped: ${error && error.message ? error.message : error}`);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return "GB-5 started. Each trace prints in the console and in the debug log.";
}
