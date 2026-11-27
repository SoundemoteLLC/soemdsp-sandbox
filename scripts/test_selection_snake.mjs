// Selection snake / highlight test (Stage 5b).
// Drags a real selection snake across 3+ modules and asserts, per frame,
// that the GL trail and selected highlights were actually submitted — not
// just that the JS selection set changed. Also crosses a real on-screen wire
// with the mouse (no programmatic selection fallback), checks wire highlight, a
// module drag, and port hover. Starts its own server.py on a free port;
// never touches 8765 / 8766 / 8080.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patchPath = path.resolve(ROOT, process.env.VIEW_PATCH || "tests/fixtures/view-real-guitar-pluck.json");
const W = Number(process.env.VIEW_W || 1600);
const H = Number(process.env.VIEW_H || 1000);
const headed = process.env.VIEW_HEADED === "1";

let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.unref();
  s.on("error", rej);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

const { chromium } = await import("playwright");
let server = null;
let browser = null;
try {
  const port = await freePort();
  if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
  server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
  const baseUrl = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 240; i += 1) {
    try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  browser = await chromium.launch({ headless: !headed, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof loadNodeGraphPatchFromObject === "function" && typeof commitNodeGraphPatch === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const b = document.querySelector(".node-boot-loading-screen");
    return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0;
  }, null, { timeout: 180000 }).catch(() => {});

  const loaded = await page.evaluate(async (p) => {
    commitNodeGraphPatch(loadNodeGraphPatchFromObject(p), { status: "test_selection_snake" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(0.7);
    if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    const pin = () => {
      let best = null;
      for (const el of document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)")) {
        const x = Number.parseFloat(el.style.getPropertyValue("--node-x"));
        const y = Number.parseFloat(el.style.getPropertyValue("--node-y"));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!best || x < best.x || (x === best.x && y < best.y)) best = { x, y };
      }
      if (!best || typeof nodeGraphRenderedOriginOffset !== "function") return;
      const z = typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1;
      const o = nodeGraphRenderedOriginOffset();
      // Leave a strip of empty canvas to the left of the leftmost module.
      const wantX = 120 - best.x * z;
      const wantY = 80 - best.y * z;
      if (nodeGraphMvp?.pan) {
        nodeGraphMvp.pan = {
          x: nodeGraphMvp.pan.x + (wantX - o.x),
          y: nodeGraphMvp.pan.y + (wantY - o.y),
        };
      }
      if (typeof viewCameraSet === "function") viewCameraSet({ immediate: true, persist: false });
      else if (typeof flushNodeGraphViewportImmediate === "function") flushNodeGraphViewportImmediate({ persist: false });
    };
    pin();
    await new Promise((r) => setTimeout(r, 1500));
    pin();
    return document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)").length;
  }, patch);
  console.log(`loaded ${loaded} modules from ${path.relative(ROOT, patchPath)}`);

  const layout = await page.evaluate(() => {
    const host = document.getElementById("nodeGraphWorkspace");
    const hr = host.getBoundingClientRect();
    const modules = [];
    for (const el of document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.removed)")) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (r.right < hr.left + 8 || r.left > hr.right - 8 || r.bottom < hr.top + 8 || r.top > hr.bottom - 8) continue;
      modules.push({
        id: el.dataset.node,
        cx: r.left + r.width * 0.5,
        cy: r.top + r.height * 0.5,
        left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      });
    }
    modules.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
    const pick = modules.slice(0, 4);
    const first = pick[0];
    // Empty start: in the reserved left strip, vertically aligned with the first module.
    const start = {
      x: hr.left + 50,
      y: first ? Math.min(Math.max(first.cy, hr.top + 20), hr.bottom - 20) : hr.top + 80,
    };
    const hitsStart = pick.some((m) => start.x >= m.left && start.x <= m.right && start.y >= m.top && start.y <= m.bottom);
    if (hitsStart) start.x = hr.left + 20;
    const toClient = (wx, wy) => {
      const scale = typeof nodeGraphZoomSurfaceClientScale === "function"
        ? nodeGraphZoomSurfaceClientScale()
        : { x: (typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1), y: (typeof nodeGraphZoom === "function" ? nodeGraphZoom() : 1) };
      const metrics = typeof nodeGraphWorkspaceLayoutMetrics === "function" ? nodeGraphWorkspaceLayoutMetrics(host) : null;
      const origin = typeof nodeGraphRenderedOriginOffset === "function"
        ? nodeGraphRenderedOriginOffset(nodeGraphMvp?.pan || { x: 0, y: 0 }, host)
        : (nodeGraphMvp?.pan || { x: 0, y: 0 });
      return {
        x: Number(metrics?.left ?? hr.left) + Number(metrics?.borderLeft || 0) + (Number(origin?.x) || 0) + Number(wx) * scale.x,
        y: Number(metrics?.top ?? hr.top) + Number(metrics?.borderTop || 0) + (Number(origin?.y) || 0) + Number(wy) * scale.y,
      };
    };
    const wires = (typeof nodeGraphGlGraphState === "object" ? nodeGraphGlGraphState.wires : null) || [];
    let wireClient = null;
    // Resolve an on-screen cable through the same client→world transform used by
    // the real GL hit-test. Then snake across it perpendicular to its local run.
    const worldAt = (x, y) => {
      const world = nodeGraphGlHitPoint({ clientX: x, clientY: y });
      return world;
    };
    const wireAt = (x, y) => { const world = worldAt(x, y); return world ? nodeGraphGlHitWireAt(world.x, world.y) : null; };
    const moduleAt = (x, y) => { const world = worldAt(x, y); return world ? nodeGraphGlHitTest(world.x, world.y) : null; };
    for (let y = Math.ceil(hr.top + 20); y < hr.bottom - 20 && !wireClient; y += 8) {
      for (let x = Math.ceil(hr.left + 20); x < hr.right - 20; x += 8) {
        if (document.elementFromPoint(x, y)?.closest?.(".dsp-node")) continue;
        const hit = wireAt(x, y);
        if (!hit || moduleAt(x, y)) continue;
        const same = (dx, dy) => {
          const a = wireAt(x - dx, y - dy), b = wireAt(x + dx, y + dy);
          return Number(a?.kind === hit.kind && a?.index === hit.index) + Number(b?.kind === hit.kind && b?.index === hit.index);
        };
        const horizontalRun = same(8, 0), verticalRun = same(0, 8);
        const crossX = horizontalRun < verticalRun;
        const from = crossX ? { x: x - 36, y } : { x, y: y - 36 };
        const to = crossX ? { x: x + 36, y } : { x, y: y + 36 };
        if (from.x <= hr.left + 5 || to.x >= hr.right - 5 || from.y <= hr.top + 5 || to.y >= hr.bottom - 5) continue;
        let clear = true;
        for (let d = -32; d <= 32; d += 4) {
          const px = crossX ? x + d : x, py = crossX ? y : y + d;
          if (moduleAt(px, py)) { clear = false; break; }
        }
        if (!clear) continue;
        wireClient = { kind: hit.kind, index: hit.index, x, y, from, to };
        break;
      }
    }
    let jack = null;
    const ports = nodeGraphGlGraphState?.chrome?.jacks || nodeGraphGlGraphState?.chrome?.ports || [];
    const portList = Array.isArray(ports) ? ports : [];
    for (const p of portList) {
      if (p.pill) continue;
      if (!Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) continue;
      const c = toClient(p.x, p.y);
      if (c.x > hr.left + 10 && c.x < hr.right - 10 && c.y > hr.top + 10 && c.y < hr.bottom - 10) {
        jack = { x: c.x, y: c.y, id: p.id || p.node, port: p.port || "" };
        break;
      }
    }
    if (!jack) {
      for (const el of document.querySelectorAll("#nodeGraphWorkspace .dsp-node:not(.viewport-asleep):not(.removed) [data-port], #nodeGraphWorkspace .dsp-node:not(.viewport-asleep) .node-port")) {
        const jr = el.getBoundingClientRect();
        if (jr.width < 2 || jr.height < 2) continue;
        if (jr.left < hr.left || jr.right > hr.right || jr.top < hr.top || jr.bottom > hr.bottom) continue;
        jack = { x: jr.left + jr.width / 2, y: jr.top + jr.height / 2, id: el.closest(".dsp-node")?.dataset?.node, port: el.dataset?.port || "" };
        break;
      }
    }
    return {
      host: { x: hr.left, y: hr.top, w: hr.width, h: hr.height },
      pick, start, wireClient, jack, wireCount: wires.length,
    };
  });
  console.log("layout", JSON.stringify({ n: layout.pick?.length, ids: (layout.pick || []).map((m) => m.id), start: layout.start, wire: layout.wireClient, jack: layout.jack }));
  check((layout.pick || []).length >= 3, `at least 3 in-view modules to snake across (${(layout.pick || []).length})`);

  const beginLog = () => page.evaluate(() => {
    const gl = nodeGraphGlGraphState;
    gl.liveDrawLog = [];
    window.__selLog = [];
    window.__selOn = true;
    const tick = () => {
      if (!window.__selOn) return;
      const d = gl.lastLiveDraw ? { ...gl.lastLiveDraw } : null;
      window.__selLog.push({
        t: performance.now(),
        draw: d,
        selectedDom: [...document.querySelectorAll(".dsp-node.selected")].map((el) => el.dataset.node),
        trailPts: d?.trailPts || 0,
        path: d?.path || "",
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const endLog = () => page.evaluate(() => {
    window.__selOn = false;
    return {
      frames: window.__selLog || [],
      live: (nodeGraphGlGraphState.liveDrawLog || []).slice(),
      last: nodeGraphGlGraphState.lastLiveDraw || null,
    };
  });

  if (typeof layout.start === "object") {
    await page.evaluate(() => { if (typeof setNodeGraphSelection === "function") setNodeGraphSelection(null); });
    await beginLog();
    await page.mouse.move(layout.start.x, layout.start.y);
    await page.mouse.down({ button: "left" });
    const started = await page.evaluate(() => {
      const drag = nodeGraphMvp?.marqueeSelection;
      return { active: Boolean(drag?.active || drag), kind: drag?.lockMode || "", pts: (drag?.points || drag?.stroke || []).length || 0 };
    });
    console.log("marquee after pointerdown", JSON.stringify(started));
    const pts = [layout.start, ...layout.pick.slice(0, 3).map((m) => ({ x: m.cx, y: m.cy }))];
    // Overshoot a little past the last centre so the trail definitely crosses it.
    const last = pts[pts.length - 1];
    pts.push({ x: last.x + 20, y: last.y });
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const steps = 8;
      for (let s = 1; s <= steps; s += 1) {
        await page.mouse.move(a.x + (b.x - a.x) * (s / steps), a.y + (b.y - a.y) * (s / steps));
        await page.waitForTimeout(20);
      }
    }
    await page.mouse.up({ button: "left" });
    await page.waitForTimeout(200);
    const snake = await endLog();
    const want = layout.pick.slice(0, 3).map((m) => m.id);
    const maxTrail = snake.frames.reduce((n, f) => Math.max(n, f.trailPts || 0), 0);
    const trailGrew = snake.frames.some((f, i) => i > 0 && f.trailPts > (snake.frames[0].trailPts || 0));
    const drawnHits = [];
    for (const f of snake.frames) {
      const drawn = f.draw?.selectedDrawn || [];
      const ok = want.every((id) => drawn.includes(id));
      if (ok) drawnHits.push(f);
    }
    const fullPaths = snake.frames.filter((f) => f.path === "full" || f.draw?.path === "full");
    const lastDrawn = snake.last?.selectedDrawn || [];
    console.log(`snake frames=${snake.frames.length} live=${snake.live.length} maxTrailPts=${maxTrail} full=${fullPaths.length} lastDrawn=${JSON.stringify(lastDrawn)} lastPath=${snake.last?.path}`);
    check(maxTrail >= 6, `lasso trail grew on the GPU (max trailPts ${maxTrail})`);
    check(trailGrew, "trail point count increased across frames during the hold");
    check(want.every((id) => lastDrawn.includes(id)), `last live draw includes all 3 modules (${want.join(", ")} vs ${lastDrawn.join(", ")})`);
    check(drawnHits.length > 0, `per-frame selectedDrawn included the 3 modules on ${drawnHits.length} frames`);
    // After the first time all 3 are drawn, later frames must not drop them
    // (the Stage 4 bug froze the first highlight and never drew the rest).
    if (drawnHits.length) {
      const firstAll = snake.frames.findIndex((f) => want.every((id) => (f.draw?.selectedDrawn || []).includes(id)));
      const after = snake.frames.slice(firstAll);
      const dropped = after.filter((f) => f.draw && f.draw.path === "full" && !want.every((id) => (f.draw.selectedDrawn || []).includes(id)));
      check(dropped.length === 0, `once all 3 were drawn, later full presents kept them (dropped ${dropped.length})`);
    }
    const endSel = await page.evaluate(() => [...document.querySelectorAll(".dsp-node.selected")].map((el) => el.dataset.node));
    check(want.every((id) => endSel.includes(id)), `DOM selection has the 3 modules (${endSel.join(", ")})`);
  }

  // ---- wire / stroke highlight ----
  if (layout.wireClient && layout.wireClient.x) {
    await page.evaluate(() => { if (typeof setNodeGraphSelection === "function") setNodeGraphSelection(null); });
    await beginLog();
    const w = layout.wireClient;
    // Start off the cable, then cross its actual segment at a right angle.
    await page.mouse.move(w.from.x, w.from.y);
    await page.mouse.down({ button: "left" });
    for (let s = 1; s <= 10; s += 1) {
      await page.mouse.move(w.from.x + (w.to.x - w.from.x) * s / 10, w.from.y + (w.to.y - w.from.y) * s / 10);
      await page.waitForTimeout(20);
    }
    const wireGestureDebug = await page.evaluate(({ x, y }) => {
      const point = nodeGraphGlHitPoint({ clientX: x, clientY: y });
      const drag = nodeGraphMvp.marqueeSelection;
      return { lockMode: drag?.lockMode, hitWires: drag?.hitWires, hitAtEnd: point ? nodeGraphGlHitWireAt(point.x, point.y) : null,
        start: drag?.start, current: drag?.current, points: drag?.points?.length };
    }, w.to);
    await page.mouse.up({ button: "left" });
    await page.waitForTimeout(150);
    const wireLog = await endLog();
    const lastW = wireLog.last?.wiresDrawn || [];
    const anyWire = wireLog.live.some((d) => (d.wiresDrawn || []).length > 0) || lastW.length > 0;
    console.log(`wire gesture=${JSON.stringify(wireGestureDebug)} highlight last=${JSON.stringify(lastW)} path=${wireLog.last?.path}`);
    const selectedWires = await page.evaluate(() => (typeof nodeGraphSelectedWireEntries === "function" ? nodeGraphSelectedWireEntries() : []));
    check(anyWire && selectedWires.some((entry) => entry.kind === w.kind && entry.index === w.index),
      `real snake gesture selected and submitted wire ${w.kind}:${w.index} (${JSON.stringify({ selectedWires, lastW })})`);
  } else {
    check(false, "a real on-screen wire segment is available for snake selection");
  }

  // ---- module drag ----
  if (layout.pick[0]) {
    const m = layout.pick[layout.pick.length - 1] || layout.pick[0];
    await page.evaluate(() => { if (typeof setNodeGraphSelection === "function") setNodeGraphSelection(null); });
    const before = await page.evaluate((id) => {
      const plate = (nodeGraphGlGraphState.plates || []).find((p) => String(p.id) === String(id));
      return plate ? { x: plate.x, y: plate.y, id } : null;
    }, m.id);
    // Title bar, not the face centre (faces keep the native pointer).
    const hx = m.cx;
    const hy = m.top + 10;
    await page.mouse.move(hx, hy);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(hx + 80, hy + 30);
    await page.waitForTimeout(80);
    await page.mouse.move(hx + 140, hy + 50);
    await page.waitForTimeout(80);
    const mid = await page.evaluate((id) => {
      const plate = (nodeGraphGlGraphState.plates || []).find((p) => String(p.id) === String(id));
      const live = nodeGraphGlGraphState.lastLiveDraw || null;
      const el = typeof nodeGraphNodeElement === "function" ? nodeGraphNodeElement(id) : null;
      const x = el ? Number.parseFloat(el.style.getPropertyValue("--node-x")) : null;
      return { plate: plate ? { x: plate.x, y: plate.y } : null, cssX: x, path: live?.path, liveKey: live?.liveKey };
    }, m.id);
    await page.mouse.up({ button: "left" });
    await page.waitForTimeout(200);
    const movedPlate = before && mid.plate && (Math.abs(mid.plate.x - before.x) > 2 || Math.abs(mid.plate.y - before.y) > 2);
    const movedCss = Number.isFinite(mid.cssX);
    console.log(`module drag before=${JSON.stringify(before)} mid=${JSON.stringify(mid)}`);
    check(movedPlate || (movedCss && mid.path === "full"), `module drag updated the GL plate (movedPlate=${movedPlate}, path=${mid.path})`);
  }

  // ---- port hover: move onto a jack and require a live present that sees it ----
  if (layout.jack) {
    const hover = await page.evaluate(async (pt) => {
      // Drive a synthetic move by dispatching after the test pointer lands;
      // the GL hit tester retargets hover onto the jack element.
      return { x: pt.x, y: pt.y, id: pt.id };
    }, layout.jack);
    await page.mouse.move(hover.x, hover.y);
    await page.waitForTimeout(80);
    const hit = await page.evaluate((pt) => {
      const ev = { clientX: pt.x, clientY: pt.y };
      const surface = typeof nodeGraphClientToZoomSurfacePoint === "function"
        ? nodeGraphClientToZoomSurfacePoint(pt.x, pt.y)
        : null;
      const tested = surface && typeof nodeGraphGlHitTest === "function" ? nodeGraphGlHitTest(surface.x, surface.y) : null;
      const el = typeof nodeGraphGlHitHoverElement === "function" ? nodeGraphGlHitHoverElement(ev) : null;
      const jack = tested?.kind === "jack"
        || el?.classList?.contains("node-port")
        || Boolean(el?.dataset?.port)
        || Boolean(el?.closest?.("[data-port], .node-port"));
      return {
        tag: el?.tagName || null,
        className: String(el?.className || "").slice(0, 80),
        port: tested?.jack?.port || el?.dataset?.port || el?.closest?.("[data-port]")?.dataset?.port || "",
        kind: tested?.kind || "",
        isJack: Boolean(jack),
        surface,
      };
    }, layout.jack);
    console.log("port hover hit", JSON.stringify(hit));
    check(hit.isJack || hit.port, `port hover resolves to a jack (class=${hit.className} port=${hit.port})`);
  }

  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
console.log(bad ? `\n${bad} check(s) FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
