// View probe: Stage 0 of docs/MODULE_DISPLAY_REWRITE_PLAN.md. Read-only.
// It measures what the circuit builder shows while the camera moves and
// changes nothing on screen. Console:
//   __viewDump()                 -> object (copy it; nothing is printed)
//   __viewDump({ reset: true })  -> same, then clears the counters
//   __viewExportPatch()          -> the live patch as a plain object
// Recording starts on wheel / pointer / camera-key input and stops 1.5 s
// after the last one, so an idle page pays nothing. Visibility is read from
// inline --node-x/--node-y and published geometry (no layout reads).
(() => {
  "use strict";
  if (typeof window === "undefined" || window.__viewProbe) return;

  const VERSION = "view-probe-1";
  const RING = 900;
  const IDLE_STOP_MS = 1500;
  const INSET_PX = 24;
  const CAMERA_KEYS = new Set(["w", "a", "s", "d", "q", "e"]);

  const probe = {
    version: VERSION,
    sampleVisibility: true,
    frames: [],
    longTasks: [],
    raf: 0,
    last: 0,
    until: 0,
    inputs: { wheel: 0, pointer: 0, keys: 0 },
    // id -> { enteredAt, enteredMoving, kind }
    entering: new Map(),
    lastCam: null,
    lastMoveAt: -1e9,
    popIns: [],
    // Modules that came into view (blank or not) since the last reset.
    entered: { n: 0, whileMoving: 0 },
    inViewPrev: new Set(),
    wsW: 0,
    wsH: 0,
    ro: null,
  };
  window.__viewProbe = probe;

  const now = () => (performance.now?.() || Date.now());
  const strSize = (w, h) => `${Number(w) || 0}x${Number(h) || 0}`;

  function workspaceSize() {
    const ws = document.getElementById("nodeGraphWorkspace");
    if (!ws) return null;
    if (!probe.ro && typeof ResizeObserver === "function") {
      probe.ro = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.contentRect;
        if (box) { probe.wsW = box.width; probe.wsH = box.height; }
      });
      probe.ro.observe(ws);
    }
    const cached = (typeof nodeGraphMvp === "object" && nodeGraphMvp?._workspaceLayoutMetrics) || null;
    const w = probe.wsW || Number(cached?.width) || 0;
    const h = probe.wsH || Number(cached?.height) || 0;
    return w > 32 && h > 32 ? { w, h } : null;
  }

  function gestureState() {
    const perf = typeof nodeGraphViewportPerf === "object" ? nodeGraphViewportPerf : {};
    return {
      active: Boolean(nodeGraphMvp?.workspacePanning || nodeGraphMvp?.smoothZoomDragging || nodeGraphMvp?.workspacePinchZooming),
      frozen: false,
      kind: String(perf.lastGestureKind || ""),
      panning: Boolean(nodeGraphMvp?.workspacePanning),
      smoothZoom: Boolean(nodeGraphMvp?.smoothZoomDragging),
      pinch: Boolean(nodeGraphMvp?.workspacePinchZooming),
      wheelWindow: false,
      settlePending: false,
    };
  }

  function camera() {
    const zoom = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1);
    const o = typeof nodeGraphRenderedOriginOffset === "function" ? nodeGraphRenderedOriginOffset() : { x: 0, y: 0 };
    return { zoom: +zoom.toFixed(4), x: +(Number(o.x) || 0).toFixed(1), y: +(Number(o.y) || 0).toFixed(1) };
  }

  // World box of a module without layout reads: inline position + the
  // published geometry box (the GL plate uses the same box). If geometry was
  // wiped, fall back to the CPU plate, the chrome-cache origin, the cull
  // size, or a conservative default so the module is still counted in view.
  function moduleBox(el) {
    const id = String(el.dataset?.node || "");
    const geo = id && typeof nodeGraphModuleGeometryGet === "function" ? nodeGraphModuleGeometryGet(id) : null;
    const gl = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState : null;
    let plate = null;
    const plates = gl?.plates || [];
    for (let i = 0; i < plates.length; i += 1) {
      if (plates[i]?.id === id) { plate = plates[i]; break; }
    }
    const cache = id && typeof nodeGraphGlGraphChromeCache !== "undefined" ? nodeGraphGlGraphChromeCache.get(id) : null;
    const x = Number.parseFloat(el.style.getPropertyValue("--node-x"));
    const y = Number.parseFloat(el.style.getPropertyValue("--node-y"));
    const ox = Number.isFinite(x) ? x : (Number.isFinite(Number(plate?.x)) ? Number(plate.x) : Number(cache?.ox));
    const oy = Number.isFinite(y) ? y : (Number.isFinite(Number(plate?.y)) ? Number(plate.y) : Number(cache?.oy));
    const w = Number(geo?.box?.w) || Number(plate?.w) || Number(el._viewportCullW) || 220;
    const h = Number(geo?.box?.h) || Number(plate?.h) || Number(el._viewportCullH) || 140;
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !(w > 1) || !(h > 1)) return null;
    return { x: ox, y: oy, w, h };
  }

  function meshPlateIds(gl) {
    const ids = new Set();
    const layers = gl?.mesh?.plateGroupLayers || [];
    for (let i = 0; i < layers.length; i += 1) {
      const list = layers[i]?.ids || [];
      for (let j = 0; j < list.length; j += 1) ids.add(String(list[j]));
    }
    return ids;
  }

  function visibility(t, gesture) {
    const size = workspaceSize();
    const surface = typeof nodeGraphZoomSurface === "function" ? nodeGraphZoomSurface() : null;
    if (!size || !surface) return null;
    const cam = camera();
    const z = Math.max(0.0001, cam.zoom);
    const L = (INSET_PX - cam.x) / z;
    const T = (INSET_PX - cam.y) / z;
    const R = (size.w - INSET_PX - cam.x) / z;
    const B = (size.h - INSET_PX - cam.y) / z;
    const gl = typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState : null;
    const plates = new Set((gl?.plates || []).map((p) => String(p?.id || "")));
    const meshed = meshPlateIds(gl);
    const chrome = gl?.chrome?.byId instanceof Map ? gl.chrome.byId : null;
    const meshFresh = Boolean(gl?.mesh && gl.mesh.gen === gl.gen);
    const lastPresent = gl?.lastPresent || null;
    const out = { total: 0, awake: 0, asleep: 0, inView: 0, blank: 0, asleepInView: 0, unplated: 0, noChrome: 0, unmeshed: 0, meshFresh, lastPresent, blankIds: [], chromeGaps: [] };
    const inViewNow = new Set();
    for (const el of surface.querySelectorAll(".dsp-node:not(.removed)")) {
      if (el.hidden) continue;
      out.total += 1;
      const asleep = el.classList.contains("viewport-asleep");
      if (asleep) out.asleep += 1; else out.awake += 1;
      const id = String(el.dataset?.node || "");
      if (!id) continue;
      const box = moduleBox(el);
      if (!box || !(box.x < R && box.x + box.w > L && box.y < B && box.y + box.h > T)) continue;
      out.inView += 1;
      inViewNow.add(id);
      if (!probe.inViewPrev.has(id)) {
        probe.entered.n += 1;
        if (gesture.moving) probe.entered.whileMoving += 1;
      }
      const plated = plates.has(id);
      const inMesh = meshed.has(id);
      // GL chrome (title, labels, jacks, parameter sliders) is measured from
      // the module's layout. A module with a title in its DOM must have a GL
      // title, or its chrome is missing even if the plate is there.
      const titled = !el.classList.contains("title-hidden") && Boolean(el.querySelector(".node-header-title"));
      const rec = chrome ? chrome.get(id) : null;
      const cacheRec = typeof nodeGraphGlGraphChromeCache !== "undefined" ? nodeGraphGlGraphChromeCache.get(id) : null;
      const titlesN = (rec?.titles?.length || 0) || (cacheRec?.lists?.titles?.length || 0);
      const jacksN = (rec?.jacks?.length || 0) || (cacheRec?.lists?.jacks?.length || 0);
      const slidersN = (rec?.sliders?.length || 0) || (cacheRec?.lists?.sliders?.length || 0);
      const titleMissing = titled && !titlesN;
      const laidOut = !el.classList.contains("viewport-asleep") && !el.hidden;
      const jackMissing = laidOut && Boolean(el.querySelector(".node-port, .node-param-port")) && !jacksN;
      // has-module-face hides .node-parameter-control (display:none). Params
      // live on the face / as other GL chrome. Scope/display faces (Onset,
      // plot, waterfall, …) also own their params — Position is the playhead
      // on the face, and the params band may be hidden — even when the
      // Clock-style has-module-face class is absent. Do not offsetWidth /
      // computed style here: this probe runs every wheel frame.
      const type = el.dataset.nodeType || "";
      const hasFace = el.classList.contains("has-module-face")
        || (typeof nodeGraphModuleHasFace === "function" && nodeGraphModuleHasFace(type))
        || Boolean(el.querySelector(".node-face, .node-module-face, .node-module-trace-display-window, .node-module-scope-window, .node-module-graph-display"));
      const paramMissing = laidOut && !hasFace && Boolean(el.querySelector(".node-slider-readout")) && !slidersN;
      const chromeMissing = titleMissing || jackMissing || paramMissing;
      if (asleep) out.asleepInView += 1;
      if (!plated) out.unplated += 1;
      if (!inMesh) out.unmeshed += 1;
      if (chromeMissing) out.noChrome += 1;
      // Stage 2: HTML may still be display:none. The module is blank when the
      // GPU mesh (what ReplayMesh actually draws mid-gesture) or the CPU
      // plate / chrome record is missing. CPU-only lists used to hide a
      // stale mesh, so wheel / Q/E pop-ins were reported as zero.
      const blank = !inMesh || !plated || chromeMissing;
      if (blank) {
        out.blank += 1;
        if (out.blankIds.length < 8) out.blankIds.push(id);
        if (out.chromeGaps.length < 8) {
          out.chromeGaps.push({
            id, plated, inMesh, asleep, laidOut,
            titlesN, jacksN, slidersN,
            titleMissing, jackMissing, paramMissing,
            cacheTitles: cacheRec?.lists?.titles?.length || 0,
            cacheJacks: cacheRec?.lists?.jacks?.length || 0,
            cacheLabels: cacheRec?.lists?.labels?.length || 0,
            cacheSliders: cacheRec?.lists?.sliders?.length || 0,
            hasFace,
            hasFaceClass: el.classList.contains("has-module-face"),
          });
        }
        if (!probe.entering.has(id)) {
          probe.entering.set(id, { id, enteredAt: t, enteredMoving: gesture.moving, kind: gesture.kind || "none" });
        }
      } else if (probe.entering.has(id)) {
        const e = probe.entering.get(id);
        probe.entering.delete(id);
        probe.popIns.push({ ...e, waitMs: +(t - e.enteredAt).toFixed(1), shownWhileMoving: gesture.moving });
        if (probe.popIns.length > RING) probe.popIns.shift();
      }
    }
    // Left the view while still blank: not a pop-in, drop it.
    for (const id of [...probe.entering.keys()]) if (!inViewNow.has(id)) probe.entering.delete(id);
    probe.inViewPrev = inViewNow;
    return out;
  }

  function tick(t) {
    probe.raf = 0;
    const dt = probe.last ? t - probe.last : 0;
    probe.last = t;
    const gesture = gestureState();
    // "Moving": a pan/zoom gesture is held or settling, or the camera changed
    // in the last 150 ms (W/A/S/D and Q/E key easing are not "gestures").
    const cam = camera();
    const prev = probe.lastCam;
    if (prev && (prev.zoom !== cam.zoom || prev.x !== cam.x || prev.y !== cam.y)) probe.lastMoveAt = t;
    probe.lastCam = cam;
    gesture.moving = gesture.active || (t - probe.lastMoveAt) < 150;
    const entry = { t: +t.toFixed(1), dt: +dt.toFixed(2), moving: gesture.moving, gesture: gesture.active, frozen: gesture.frozen, kind: gesture.kind };
    if (probe.sampleVisibility) {
      try {
        const v = visibility(t, gesture);
        if (v) {
          entry.inView = v.inView;
          entry.blank = v.blank;
          entry.asleepInView = v.asleepInView;
          entry.unplated = v.unplated;
          entry.noChrome = v.noChrome;
          entry.meshFresh = v.meshFresh;
        }
      } catch (_error) {
        // A probe must never break the page.
      }
    }
    probe.frames.push(entry);
    if (probe.frames.length > RING) probe.frames.shift();
    if (now() < probe.until || gesture.moving) {
      probe.raf = window.requestAnimationFrame(tick);
    } else {
      probe.last = 0;
    }
  }

  function kick() {
    probe.until = now() + IDLE_STOP_MS;
    if (!probe.raf) probe.raf = window.requestAnimationFrame(tick);
  }

  function inWorkspace(target) {
    return Boolean(target?.closest?.("#nodeGraphWorkspace"));
  }

  window.addEventListener("wheel", (event) => {
    if (!inWorkspace(event.target)) return;
    probe.inputs.wheel += 1;
    kick();
  }, { capture: true, passive: true });
  window.addEventListener("pointerdown", (event) => {
    if (!inWorkspace(event.target)) return;
    probe.inputs.pointer += 1;
    kick();
  }, { capture: true, passive: true });
  window.addEventListener("pointermove", (event) => {
    if (event.buttons && probe.raf) kick();
  }, { capture: true, passive: true });
  window.addEventListener("keydown", (event) => {
    if (!CAMERA_KEYS.has(String(event.key || "").toLowerCase())) return;
    probe.inputs.keys += 1;
    kick();
  }, { capture: true, passive: true });
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        probe.longTasks.push({ t: +e.startTime.toFixed(1), ms: +e.duration.toFixed(1) });
        if (probe.longTasks.length > 200) probe.longTasks.shift();
      }
    });
    obs.observe({ type: "longtask", buffered: false });
  } catch (_error) {
    // No longtask API.
  }

  function stats(list) {
    const d = list.filter((v) => v > 0).sort((a, b) => a - b);
    const n = d.length;
    if (!n) return { n: 0 };
    const at = (q) => +d[Math.min(n - 1, Math.floor(n * q))].toFixed(2);
    return {
      n,
      mean: +(d.reduce((s, v) => s + v, 0) / n).toFixed(2),
      p50: at(0.5),
      p95: at(0.95),
      max: +d[n - 1].toFixed(2),
      over33: d.filter((v) => v > 33.4).length,
      over50: d.filter((v) => v > 50).length,
    };
  }

  window.__viewDump = function viewDump(options = {}) {
    const frames = probe.frames;
    const movingFrames = frames.filter((f) => f.moving);
    const pops = probe.popIns;
    const waits = pops.map((p) => p.waitMs).sort((a, b) => a - b);
    const visNow = (() => {
      try { const g = gestureState(); g.moving = g.active || (now() - probe.lastMoveAt) < 150; return visibility(now(), g); } catch (_error) { return null; }
    })();
    const lastPresent = (typeof nodeGraphGlGraphState === "object" && nodeGraphGlGraphState)
      ? nodeGraphGlGraphState.lastPresent || null
      : null;
    let jacks = null;
    try {
      if (typeof nodeGraphJackVisibilityCensus === "function") {
        const c = nodeGraphJackVisibilityCensus();
        jacks = {
          ok: c.ok,
          painted: c.paintedCount,
          considered: c.consideredCount,
          hidden: (c.hidden || []).slice(0, 4).map((row) => ({
            node: row.node, port: row.port, size: strSize(row.width, row.height),
            layout: strSize(row.layoutW, row.layoutH),
            screen: strSize(row.screenW, row.screenH),
            reasons: row.reasons,
          })),
        };
      }
    } catch (_error) { jacks = { error: true }; }
    const result = {
      version: VERSION,
      at: +now().toFixed(1),
      camera: camera(),
      gesture: gestureState(),
      present: lastPresent,
      jacks,
      modules: visNow,
      frames: stats(frames.map((f) => f.dt)),
      movingFrames: stats(movingFrames.map((f) => f.dt)),
      blankFrames: {
        whileMoving: movingFrames.filter((f) => f.blank > 0).length,
        total: frames.filter((f) => f.blank > 0).length,
        maxBlank: Math.max(0, ...frames.map((f) => f.blank || 0)),
      },
      entered: { ...probe.entered },
      popIns: {
        n: pops.length,
        shownWhileMoving: pops.filter((p) => p.shownWhileMoving).length,
        shownOnlyAfterStop: pops.filter((p) => p.enteredMoving && !p.shownWhileMoving).length,
        waitP50: waits.length ? waits[Math.floor(waits.length * 0.5)] : 0,
        waitMax: waits.length ? waits[waits.length - 1] : 0,
        stillBlank: [...probe.entering.values()].map((e) => ({ id: e.id, kind: e.kind, waitingMs: +(now() - e.enteredAt).toFixed(1) })),
        recent: pops.slice(-20),
      },
      longTasks: { n: probe.longTasks.length, longest: Math.max(0, ...probe.longTasks.map((l) => l.ms)), recent: probe.longTasks.slice(-10) },
      inputs: { ...probe.inputs },
      recentFrames: frames.slice(-Math.max(0, Number(options.frames ?? 120))),
    };
    if (options.reset) {
      probe.frames = [];
      probe.longTasks = [];
      probe.popIns = [];
      probe.entering.clear();
      probe.entered = { n: 0, whileMoving: 0 };
      probe.inputs = { wheel: 0, pointer: 0, keys: 0 };
      probe.lastMoveAt = -1e9;
    }
    return result;
  };

  
  window.__viewPopInReport = function viewPopInReport() {
    const dump = window.__viewDump({ frames: 180 });
    return {
      zoom: dump.camera,
      gesture: dump.gesture,
      present: dump.present,
      jacks: dump.jacks,
      modules: dump.modules,
      entered: dump.entered,
      popIns: dump.popIns,
      blankFrames: dump.blankFrames,
      movingFrames: dump.movingFrames,
      longTasks: dump.longTasks,
    };
  };

  window.__viewExportPatch = function viewExportPatch() {
    const patch = typeof serializeNodeGraphPatch === "function"
      ? serializeNodeGraphPatch()
      : nodeGraphMvp?.patch;
    return JSON.parse(JSON.stringify(patch));
  };
})();
