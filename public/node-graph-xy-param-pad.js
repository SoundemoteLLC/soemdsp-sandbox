// XY parameter pad: ONE square pad that edits TWO parameters (an X and a Y), shared by every module that has a position pair
// (Aberration Ch 1 / 2 / 3, Screen Glass Glare ...), optionally with ONE more parameter as a tall slider beside it.
//
// A module opts in by tagging the parameter definitions, listed X, Y, side:
//   { key: "ch1X",      ..., parameterOutput: false, xyPad: { axis: "x",    pair: "ch1Y", label: "Ch 1" } }
//   { key: "ch1Y",      ..., parameterOutput: false, xyPad: { axis: "y",    pair: "ch1X", label: "Ch 1" } }
//   { key: "ch1Bright", ..., parameterOutput: false, xyPad: { axis: "side", pair: "ch1X", label: "Ch 1" } }   (optional)
// The parameters stay exactly what they were: same keys, same ranges, same saved values, same engine reads, and each keeps its
// own modulation (CV) jack. Only the sliders are replaced:
//   - the X parameter's row becomes a tall row holding the pad (and the side slider on its right); the Y row and the side row
//     take no height of their own, their jacks move into that row, stacked down the pad's left edge;
//   - the pad is a transparent DOM box (hit target + layout); WebGL draws it (nodeGraphGlGraphDrawXyPads in node-graph-gl-graph.js).
//
// Mouse: the app-wide parameter behavior (node-graph-slider-dragging.js).
//   drag          relative: the handle moves by how far the mouse moves (a full pad width is the full range)
//   Alt + click   jump the handle to the mouse, then keep dragging relative
//   Ctrl + click  reset both to their defaults (Ctrl / Shift / Alt held while dragging scale the movement like any slider)
(function () {
  const ROWS_DEFAULT = 4;
  const MOVE_PX = 1;

  function art(pad) {
    return pad.closest(".dsp-node");
  }
  function inputFor(pad, key) {
    const host = art(pad);
    if (!host || !key) return null;
    return host.querySelector(`input[type="range"][data-param="${CSS.escape(String(key))}"]`) || null;
  }
  function domainValue(input) {
    const d = Number(input?.dataset?.domainValue);
    const v = Number.isFinite(d) ? d : Number(input?.value);
    return Number.isFinite(v) ? v : 0;
  }
  function range(input) {
    const min = Number(input?.min);
    const max = Number(input?.max);
    return {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) && max > min ? max : (Number.isFinite(min) ? min + 1 : 1),
    };
  }
  function toUnit(input, value) {
    const { min, max } = range(input);
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }
  function fromUnit(input, unit) {
    const { min, max } = range(input);
    return min + Math.max(0, Math.min(1, unit)) * (max - min);
  }
  function locked() {
    return typeof nodeGraphPatchIsLocked === "function" && nodeGraphPatchIsLocked();
  }
  function dragMultiplier(event) {
    return typeof nodeGraphNumericDragMultiplier === "function" ? nodeGraphNumericDragMultiplier(event) : (event.shiftKey ? 0.1 : 1);
  }

  /** Current position of a pad: u (0 left .. 1 right), v (0 bottom .. 1 top), and both values. null while its inputs are missing. */
  function read(pad) {
    const xi = inputFor(pad, pad?.dataset?.xKey);
    const yi = inputFor(pad, pad?.dataset?.yKey);
    if (!xi || !yi) return null;
    const x = domainValue(xi);
    const y = domainValue(yi);
    return { xi, yi, x, y, u: toUnit(xi, x), v: toUnit(yi, y) };
  }
  window.nodeGraphXyParamPadRead = read;

  function write(xi, yi, u, v, drag) {
    if (typeof setNodeSliderValue !== "function") return;
    const opts = drag ? { interaction: "drag" } : {};
    setNodeSliderValue(xi, fromUnit(xi, u), opts);
    setNodeSliderValue(yi, fromUnit(yi, v), opts);
    if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
  }
  function commit(xi, yi, status) {
    if (typeof commitNodeSliderDragValue !== "function") return;
    commitNodeSliderDragValue(xi, status);
    commitNodeSliderDragValue(yi, status);
  }

  function defaultUnit(input) {
    const d = typeof nodeSliderCtrlClickDefaultValue === "function"
      ? nodeSliderCtrlClickDefaultValue(input)
      : Number(input.dataset.paramDefault ?? input.dataset.default);
    return toUnit(input, Number.isFinite(d) ? d : 0);
  }
  function resetPad(pad) {
    const cur = read(pad);
    if (!cur || locked()) return;
    write(cur.xi, cur.yi, defaultUnit(cur.xi), defaultUnit(cur.yi), false);
    commit(cur.xi, cur.yi, "parameter reset to default");
  }

  function wirePad(pad) {
    let drag = null;
    const finish = (event) => {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      const done = drag;
      drag = null;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      try { if (pad.hasPointerCapture?.(done.pointerId)) pad.releasePointerCapture(done.pointerId); } catch (_) { /* gone */ }
      if (done.resetOnClick && !done.moved) {
        resetPad(pad);
        return;
      }
      commit(done.xi, done.yi, "XY pad moved");
    };
    const onMove = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      if (!drag.moved && (Math.abs(event.clientX - drag.startX) > MOVE_PX || Math.abs(event.clientY - drag.startY) > MOVE_PX)) {
        drag.moved = true;
      }
      if (!drag.moved) return;
      const rect = pad.getBoundingClientRect();
      // Relative, like every slider: the movement since the last event, scaled live by the modifier keys.
      const k = dragMultiplier(event);
      drag.u = Math.max(0, Math.min(1, drag.u + ((event.clientX - drag.lastX) / Math.max(1, rect.width)) * k));
      drag.v = Math.max(0, Math.min(1, drag.v - ((event.clientY - drag.lastY) / Math.max(1, rect.height)) * k));
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      write(drag.xi, drag.yi, drag.u, drag.v, true);
    };
    // The GL graph owns pointer input on the workspace (every module element is pointer-events:none there), so its hit test calls
    // this too (nodeGraphXyParamPadPointerDown); the DOM listener below covers a pad outside the GL graph.
    const onDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (locked()) return;
      const cur = read(pad);
      if (!cur) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const resetOnClick = ctrl && !event.altKey && !event.shiftKey;
      const jumpOnClick = event.altKey && !(event.shiftKey && ctrl);
      drag = {
        pointerId: event.pointerId,
        xi: cur.xi,
        yi: cur.yi,
        u: cur.u,
        v: cur.v,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        resetOnClick,
      };
      if (jumpOnClick) {
        const rect = pad.getBoundingClientRect();
        drag.u = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
        drag.v = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / Math.max(1, rect.height)));
        write(drag.xi, drag.yi, drag.u, drag.v, true);
      }
      try { pad.setPointerCapture(event.pointerId); } catch (_) { /* window listeners carry the drag */ }
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", finish, true);
      window.addEventListener("pointercancel", finish, true);
    };
    pad._xyPointerDown = onDown;
    pad.addEventListener("pointerdown", onDown);
  }

  /** Start a pad drag from a pointerdown the GL hit layer routed to this pad. */
  window.nodeGraphXyParamPadPointerDown = function (pad, event) {
    if (pad && typeof pad._xyPointerDown === "function") pad._xyPointerDown(event);
  };

  // The row (before this one) that holds the pad of this group.
  function padRowFor(row) {
    let el = row.previousElementSibling;
    while (el) {
      if (el.dataset?.xyPadAxis === "x" && el.dataset.xyPadGroup === row.dataset.xyPadGroup) return el;
      el = el.previousElementSibling;
    }
    return null;
  }

  function decorate(row, node, type, parameter, spec) {
    const axis = spec.axis === "y" ? "y" : spec.axis === "side" ? "side" : "x";
    row.classList.add("node-parameter-row-xypad", `node-parameter-row-xypad-${axis}`);
    row.dataset.xyPadAxis = axis;
    row.dataset.xyPadGroup = String(spec.group || spec.label || parameter.key);
    row.style.setProperty("--xy-pad-rows", String(Math.max(2, Math.round(Number(spec.rows) || ROWS_DEFAULT))));
    if (axis !== "x") {
      // The Y row and the side row take no space of their own: their jacks (and, for the side row, its slider) move into the X
      // row, the one holding the pad, and the row hides.
      const tryMove = () => {
        const xRow = padRowFor(row);
        const port = row.querySelector(".node-param-port.modulation-input");
        if (!port || !xRow) return false;
        if (axis === "y") {
          port.classList.add("node-xy-param-ypad-port");
        } else {
          const control = row.querySelector(":scope > .node-parameter-control");
          if (!control) return false;
          control.classList.add("node-xy-pad-side");
          const labelEl = control.querySelector(".node-slider-readout-label");
          if (labelEl && spec.shortLabel) labelEl.dataset.shortLabel = String(spec.shortLabel);
          port.classList.add("node-xy-param-sidepad-port");
          xRow.classList.add("node-parameter-row-xypad-has-side");
          xRow.append(control);
        }
        xRow.append(port);
        row.hidden = true;
        row.classList.add("node-parameter-row-hidden");
        return true;
      };
      queueMicrotask(() => { if (!tryMove()) requestAnimationFrame(tryMove); });
      return;
    }
    // The X row spans the grid tracks the pad needs (the module body is a grid of fixed-height rows).
    row.style.gridRow = `span ${Math.max(2, Math.round(Number(spec.rows) || ROWS_DEFAULT))}`;
    const pad = document.createElement("div");
    pad.className = "node-xy-param-pad";
    pad.dataset.node = node;
    pad.dataset.xKey = parameter.key;
    pad.dataset.yKey = String(spec.pair || "");
    pad.dataset.label = String(spec.label || "");
    pad.setAttribute("role", "group");
    pad.setAttribute("aria-label", `${spec.label || "XY"} position`);
    pad.title = "Drag to move. Alt + click: jump to the mouse. Ctrl + click: reset. Shift / Ctrl while dragging: fine.";
    wirePad(pad);
    row.append(pad);
  }

  // Wrap the row factory so every tagged parameter row gets the pad treatment.
  if (typeof createNodeGraphParameter === "function" && !createNodeGraphParameter.__xyPadWrapped) {
    const orig = createNodeGraphParameter;
    const wrapped = function (node, type, parameter) {
      const row = orig.apply(this, arguments);
      if (parameter && parameter.xyPad && row) decorate(row, node, type, parameter, parameter.xyPad);
      return row;
    };
    wrapped.__xyPadWrapped = true;
    // eslint-disable-next-line no-global-assign
    createNodeGraphParameter = wrapped;
  }

  /** Body rows a tagged parameter takes (sizing): the X parameter carries the pad's height, the Y and side parameters none. */
  window.nodeGraphXyPadRowCount = function (parameter) {
    const spec = parameter?.xyPad;
    if (!spec) return 1;
    if (spec.axis === "y" || spec.axis === "side") return 0;
    return Math.max(2, Math.round(Number(spec.rows) || ROWS_DEFAULT));
  };
})();
