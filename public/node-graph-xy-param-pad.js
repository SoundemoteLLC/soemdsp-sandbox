// XY parameter pad: ONE square pad that edits TWO parameters (an X and a Y), shared by every module that has a position pair
// (Aberration Ch 1 / 2 / 3, Screen Glass Glare ...).
//
// A module opts in by tagging the two parameter definitions:
//   { key: "ch1X", ..., parameterOutput: false, xyPad: { axis: "x", pair: "ch1Y", label: "Ch 1" } }
//   { key: "ch1Y", ..., parameterOutput: false, xyPad: { axis: "y", pair: "ch1X", label: "Ch 1" } }
// (the X one is listed first). The two parameters stay exactly what they were: same keys, same ranges, same saved values, same
// engine reads, and each keeps its own modulation (CV) jack. Only the sliders are replaced by the pad:
//   - the X parameter's row becomes a tall row that holds the pad, with the X jack beside its upper half;
//   - the Y parameter's row takes no height and its jack sits beside the pad's lower half.
// The pad is a transparent DOM hit target; WebGL draws it (nodeGraphGlGraphDrawXyPads in node-graph-gl-graph.js).
//   drag / click : set both values (absolute: the handle goes where the pointer is)
//   Shift + drag : fine, relative (a tenth of the movement)
//   double-click : both back to their defaults
(function () {
  const ROWS_DEFAULT = 4;
  const FINE = 0.1;

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

  function resetPad(pad) {
    const cur = read(pad);
    if (!cur || locked()) return;
    const dx = Number(cur.xi.dataset.default);
    const dy = Number(cur.yi.dataset.default);
    write(cur.xi, cur.yi, toUnit(cur.xi, Number.isFinite(dx) ? dx : 0), toUnit(cur.yi, Number.isFinite(dy) ? dy : 0), false);
    commit(cur.xi, cur.yi, "XY pad reset");
  }

  function wirePad(pad) {
    let drag = null;
    const apply = (event) => {
      if (!drag) return;
      const rect = pad.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      let u;
      let v;
      if (drag.fine) {
        u = drag.u0 + ((event.clientX - drag.x0) / w) * FINE;
        v = drag.v0 - ((event.clientY - drag.y0) / h) * FINE;
      } else {
        u = (event.clientX - rect.left) / w;
        v = 1 - (event.clientY - rect.top) / h;
      }
      u = Math.max(0, Math.min(1, Number.isFinite(u) ? u : 0));
      v = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
      write(drag.xi, drag.yi, u, v, true);
    };
    const finish = (event) => {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
      const done = drag;
      drag = null;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      try { if (pad.hasPointerCapture?.(done.pointerId)) pad.releasePointerCapture(done.pointerId); } catch (_) { /* gone */ }
      commit(done.xi, done.yi, "XY pad moved");
    };
    const onMove = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      apply(event);
    };
    pad.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (locked()) return;
      const cur = read(pad);
      if (!cur) return;
      drag = {
        pointerId: event.pointerId,
        xi: cur.xi,
        yi: cur.yi,
        fine: event.shiftKey,
        u0: cur.u,
        v0: cur.v,
        x0: event.clientX,
        y0: event.clientY,
      };
      try { pad.setPointerCapture(event.pointerId); } catch (_) { /* window listeners carry the drag */ }
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", finish, true);
      window.addEventListener("pointercancel", finish, true);
      apply(event);
    });
    pad.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetPad(pad);
    });
  }

  function decorate(row, node, type, parameter, spec) {
    const axis = spec.axis === "y" ? "y" : "x";
    row.classList.add("node-parameter-row-xypad", `node-parameter-row-xypad-${axis}`);
    row.dataset.xyPadAxis = axis;
    row.dataset.xyPadGroup = String(spec.group || spec.label || parameter.key);
    row.style.setProperty("--xy-pad-rows", String(Math.max(2, Math.round(Number(spec.rows) || ROWS_DEFAULT))));
    if (axis !== "x") {
      // The Y row takes no space: its jack moves into the X row (the one holding the pad) and the row hides.
      const tryMove = () => {
        const xRow = row.previousElementSibling;
        const port = row.querySelector(".node-param-port.modulation-input");
        if (!port || !xRow || xRow.dataset.xyPadAxis !== "x" || xRow.dataset.xyPadGroup !== row.dataset.xyPadGroup) return false;
        port.classList.add("node-xy-param-ypad-port");
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
    pad.title = "Drag to set X and Y. Shift: fine. Double-click: reset.";
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

  /** Body rows a tagged pair takes (sizing): the X parameter carries the pad's height, the Y parameter none. */
  window.nodeGraphXyPadRowCount = function (parameter) {
    const spec = parameter?.xyPad;
    if (!spec) return 1;
    if (spec.axis === "y") return 0;
    return Math.max(2, Math.round(Number(spec.rows) || ROWS_DEFAULT));
  };
})();
