// Room light — one number, 0 = full light, 1 = dark.
//
// The workspace (plates, text, cables, grid, module lights, screens) is lit and darkened INSIDE the GL scene
// (node-graph-gl-graph.js, gl-line-renderer.js), in the same pass and the same camera as everything else, so panning and zooming
// never leave a light behind. This file only owns the number, the lightbulb control that sets it, and the plain translucent veil
// over the toolbar and the bottom bar (outside the workspace). No shader, no cutouts, no per-frame work: the veil is a CSS fill
// with a clip, updated when the number or the layout changes.
//
// Lightbulb control drag = room light (up brighter / down darker). The lightbulb itself is left out of the veil so you can always
// drag back from full dark. The graph's displays stay lit by the GL scene.

(() => {
  "use strict";

  const STORAGE_KEY = "soemdsp-sandbox.roomDimmer.v1";
  // Persist at most half-dark so a refresh never restores a pure-black UI.
  const PERSIST_DIM_MAX = 0.5;

  const state = {
    dim: 0,
    raf: 0,
    drag: null,
    persistTimer: 0,
  };

  function clamp01(value, fallback = 0) {
    return globalThis.SoemMath.clamp01(value, fallback);
  }

  function clampDim(n) {
    return clamp01(n);
  }

  function clampPersistDim(n) {
    return Math.min(PERSIST_DIM_MAX, clamp01(n));
  }

  /** 0 below half-dim; 1 at full black. The workspace stays lit through the first half. */
  function dimDeep(dim = state.dim) {
    const d = clampDim(dim);
    return d <= 0.5 ? 0 : Math.min(1, (d - 0.5) * 2);
  }

  // 0 = full light, 1 = dark (read by the GL graph when it builds its layers).
  globalThis.nodeGraphRoomAmbientDark = () => dimDeep(state.dim);

  function workspace() {
    return document.getElementById("nodeGraphWorkspace");
  }

  /** Host the "room-dimmer-on" class goes on (the whole app). */
  function veilHost() {
    return document.body || document.documentElement;
  }

  function veilEl() {
    return document.getElementById("nodeRoomDimmerCanvas");
  }

  function buttonEl() {
    return document.getElementById("nodeRoomDimmerButton");
  }

  function setVeilActive(on) {
    for (const el of [veilHost(), workspace()]) el?.classList?.toggle("room-dimmer-on", on);
  }

  /**
   * The veil: a black fill at the dim level, clipped to the chrome around the workspace and with the lightbulb cut out. Plain CSS
   * (a clip polygon, evenodd), so it costs nothing per frame; it is recomputed only when the level or the layout changes.
   */
  function drawVeil() {
    state.raf = 0;
    const veil = veilEl();
    if (!veil) return;
    const dim = clampDim(state.dim);
    if (dim <= 0.0005) {
      setVeilActive(false);
      veil.style.background = "";
      veil.style.clipPath = "";
      return;
    }
    setVeilActive(true);
    veil.style.background = `rgba(0, 0, 0, ${dim})`;
    const vr = veil.getBoundingClientRect();
    if (!(vr.width > 0) || !(vr.height > 0)) {
      veil.style.clipPath = "";
      return;
    }
    // One closed sub-path per rectangle (a polygon() would need bridge edges, which draw a sliver across the veil).
    const rect = (box, pad = 0) => {
      const l = box.left - vr.left - pad;
      const t = box.top - vr.top - pad;
      const r = box.right - vr.left + pad;
      const b = box.bottom - vr.top + pad;
      return `M${l} ${t}H${r}V${b}H${l}Z`;
    };
    let d = `M0 0H${vr.width}V${vr.height}H0Z`;
    const ws = workspace()?.getBoundingClientRect();
    if (ws && ws.width > 0 && ws.height > 0) d += rect(ws);
    const btn = buttonEl()?.getBoundingClientRect();
    if (btn && btn.width > 0 && btn.height > 0) d += rect(btn, 2);
    veil.style.clipPath = `path(evenodd, "${d}")`;
  }

  function scheduleDraw() {
    if (state.raf) return;
    state.raf = window.requestAnimationFrame(drawVeil);
  }

  function load() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
      state.dim = clampPersistDim(raw.dim);
    } catch {
      state.dim = 0;
    }
  }

  function saveSoon() {
    if (state.persistTimer) return;
    state.persistTimer = window.setTimeout(() => {
      state.persistTimer = 0;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 4, dim: clampPersistDim(state.dim) }));
      } catch { /* ignore */ }
    }, 120);
  }

  function syncButton() {
    const btn = buttonEl();
    if (!btn) return;
    const dim = clampDim(state.dim);
    const on = dim > 0.0005;
    const pct = Math.round(dim * 100);
    const deep = dimDeep(dim);
    // Drives the CSS crossfade: on opacity = 1 - dim, off opacity = dim.
    for (const el of [btn, workspace(), veilHost()]) {
      el?.style?.setProperty?.("--room-dim", String(dim));
      el?.style?.setProperty?.("--room-dim-deep", String(deep));
    }
    const lightPct = 100 - pct;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-valuenow", String(lightPct));
    btn.setAttribute("aria-valuemin", "0");
    btn.setAttribute("aria-valuemax", "100");
    btn.setAttribute(
      "aria-valuetext",
      lightPct >= 100
        ? "Room light full on"
        : lightPct <= 0
          ? "Room dark; displays stay lit"
          : `Room ${lightPct} percent light; displays stay lit`,
    );
    btn.title = on
      ? `Room ${lightPct}% light · drag up brighter, down darker (displays stay lit)`
      : "Room light · drag up to brighten, down to darken (displays stay lit)";
  }

  function setDim(value, options = {}) {
    state.dim = clampDim(value);
    syncButton();
    // The GL graph reads the ambient level when it builds its layers.
    if (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState?.canvas) {
      nodeGraphGlGraphState.gen = (nodeGraphGlGraphState.gen || 0) + 1;
      if (typeof nodeGraphGlGraphPresentSoon === "function") nodeGraphGlGraphPresentSoon();
    }
    // The mouse light's amount follows the room level (the heatmap update reads nodeGraphRoomDim()).
    if (typeof scheduleNodeGraphGridHeatmapUpdate === "function") {
      scheduleNodeGraphGridHeatmapUpdate();
    } else if (typeof updateNodeGraphGridHeatmap === "function") {
      try { updateNodeGraphGridHeatmap({ force: true }); } catch { /* ignore */ }
    }
    scheduleDraw();
    if (options.persist !== false) saveSoon();
    return state.dim;
  }

  function bindButton() {
    const btn = buttonEl();
    if (!btn || btn.dataset.roomDimmerBound === "1") return;
    btn.dataset.roomDimmerBound = "1";
    btn.setAttribute("role", "slider");
    btn.setAttribute("aria-orientation", "vertical");

    const end = (event) => {
      if (!state.drag) return;
      state.drag = null;
      btn.classList.remove("room-dimmer-dragging");
      try { btn.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
      saveSoon();
    };

    btn.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      event.preventDefault();
      state.drag = { id: event.pointerId, y0: event.clientY, d0: clampDim(state.dim) };
      btn.classList.add("room-dimmer-dragging");
      try { btn.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
    });
    btn.addEventListener("pointermove", (event) => {
      if (!state.drag || state.drag.id !== event.pointerId) return;
      const dy = state.drag.y0 - event.clientY;
      setDim(state.drag.d0 - dy / 140, { persist: false });
    });
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointercancel", end);
    btn.addEventListener("keydown", (event) => {
      const d = clampDim(state.dim);
      if (event.key === "ArrowUp" || event.key === "ArrowRight") {
        event.preventDefault();
        setDim(d - 0.05);
      } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
        event.preventDefault();
        setDim(d + 0.05);
      } else if (event.key === "Home") {
        event.preventDefault();
        setDim(1);
      } else if (event.key === "End") {
        event.preventDefault();
        setDim(0);
      }
    });
  }

  // UI Dev's mouse-light options live on nodeGraphMvp (the GL mouse light reads them); the old veil cutout they once also drove is gone.
  function setDimmerCutoutOptions(opts = {}) {
    if (typeof nodeGraphMvp !== "undefined" && nodeGraphMvp && opts && typeof opts === "object") {
      if (typeof opts.mouse === "boolean") nodeGraphMvp.dimmerCutoutMouseEnabled = opts.mouse;
      if (Number.isFinite(Number(opts.mouseSize))) nodeGraphMvp.dimmerMouseSize = Number(opts.mouseSize);
      if (Number.isFinite(Number(opts.mouseSoftness))) nodeGraphMvp.dimmerMouseSoftness = Number(opts.mouseSoftness);
      if (Number.isFinite(Number(opts.mouseShape))) nodeGraphMvp.dimmerMouseShape = Number(opts.mouseShape);
    }
    if (typeof scheduleNodeGraphGridHeatmapUpdate === "function") scheduleNodeGraphGridHeatmapUpdate();
  }

  function bind() {
    load();
    bindButton();
    syncButton();
    scheduleDraw();
    if (typeof scheduleNodeGraphGridHeatmapUpdate === "function") scheduleNodeGraphGridHeatmapUpdate();
    window.addEventListener("resize", scheduleDraw);
    // Layout changes that move the workspace or the bulb (toolbar wraps, panels) redo the clip once, not every frame.
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(scheduleDraw);
      for (const el of [workspace(), buttonEl(), document.body]) if (el) ro.observe(el);
    }
  }

  window.setNodeGraphRoomDim = setDim;
  window.nodeGraphRoomDim = () => clampDim(state.dim);
  window.nodeGraphRoomDimDeep = () => dimDeep();
  window.nodeGraphRoomDimMax = () => 1;
  window.bindNodeGraphRoomDimmer = bind;
  // A light strength per screen used to open a veil hole over it. The GL scene lights screens itself now; kept so callers still work.
  window.setNodeGraphLightStrength = (el, strength) => {
    if (el) el.dataset.lightStrength = String(clamp01(strength));
  };
  window.scheduleNodeGraphRoomDimmerDraw = scheduleDraw;
  window.setNodeGraphDimmerCutoutOptions = setDimmerCutoutOptions;

  window.setNodeGraphShaderScriptEnabled = (on) => {
    if (!on) setDim(0);
    else if (clampDim(state.dim) < 0.001) setDim(0.55);
  };
  window.bindNodeGraphShaderScriptEvents = bind;
  window.openNodeGraphGlobalShaderScript = () => {};
  window.openNodeGraphScopeShaderScript = () => false;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind, { once: true });
  } else {
    bind();
  }
})();

/**
 * Light-button-style vertical fill slider (magnifier zoom, mouse smoother).
 * Drag 140px = full range. options: { min, max, get, set, format }.
 */
function bindNodeGraphToolbarFillSlider(button, options = {}) {
  if (!(button instanceof HTMLElement) || button.dataset.toolbarFillSliderBound === "true") {
    return;
  }
  const min = Number.isFinite(Number(options.min)) ? Number(options.min) : 0;
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : 1;
  const span = max - min || 1;
  const get = typeof options.get === "function" ? options.get : () => min;
  const set = typeof options.set === "function" ? options.set : () => {};
  const format = typeof options.format === "function"
    ? options.format
    : (value) => String(value);
  const toUnit = (value) => SoemMath.clamp01((Number(value) - min) / span);
  const fromUnit = (unit) => min + SoemMath.clamp01(unit) * span;

  const sync = () => {
    const value = get();
    const unit = toUnit(value);
    const label = format(value);
    button.style.setProperty("--toolbar-fill", String(unit));
    button.style.setProperty("--room-dim", String(unit));
    button.setAttribute("aria-valuenow", String(value));
    button.setAttribute("aria-valuetext", label);
    button.setAttribute("aria-pressed", unit > 0.001 ? "true" : "false");
    const readout = button.querySelector("[data-toolbar-fill-value]");
    if (readout) {
      readout.textContent = label;
    }
    const tip = String(button.getAttribute("data-toolbar-fill-tip") || button.getAttribute("aria-label") || "").trim();
    button.title = tip ? `${tip} · ${label} · drag up/down` : `${label} · drag up/down`;
  };

  button.dataset.toolbarFillSliderBound = "true";
  button.setAttribute("role", "slider");
  button.setAttribute("aria-orientation", "vertical");
  button.setAttribute("aria-valuemin", String(min));
  button.setAttribute("aria-valuemax", String(max));

  let drag = null;
  const end = (event) => {
    if (!drag) {
      return;
    }
    drag = null;
    button.classList.remove("room-dimmer-dragging");
    try {
      button.releasePointerCapture?.(event.pointerId);
    } catch (_error) {
      /* ignore */
    }
    set(get(), { persist: true });
  };

  button.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) {
      return;
    }
    event.preventDefault();
    drag = {
      id: event.pointerId,
      y0: event.clientY,
      u0: toUnit(get()),
    };
    button.classList.add("room-dimmer-dragging");
    try {
      button.setPointerCapture?.(event.pointerId);
    } catch (_error) {
      /* ignore */
    }
  });
  button.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) {
      return;
    }
    const dy = drag.y0 - event.clientY;
    set(fromUnit(drag.u0 + dy / 140), { persist: false });
  });
  button.addEventListener("pointerup", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("keydown", (event) => {
    const unit = toUnit(get());
    const step = event.shiftKey ? 0.02 : 0.05;
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      set(fromUnit(unit + step), { persist: true });
    } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      set(fromUnit(unit - step), { persist: true });
    } else if (event.key === "Home") {
      event.preventDefault();
      set(min, { persist: true });
    } else if (event.key === "End") {
      event.preventDefault();
      set(max, { persist: true });
    }
  });
  button._syncToolbarFill = sync;
  sync();
}
