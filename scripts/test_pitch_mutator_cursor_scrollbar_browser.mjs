// Mutator cursor policy + no scrollbar, on the real page. Own server.py on a free port (never 8765 / 8766 / 8080) unless SANDBOX_URL is set.
//  - no element in the Mutator overlay has a scrollbar (offsetWidth/Height equals clientWidth/Height on every scroller)
//  - hover cursor is the little + (--node-dot-cursor), never `pointer`; the pressed cursor is the little dot (--node-adjust-cursor)
//  - the circuit Keyboard surface follows the same rule
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = createRequire(path.join(ROOT, "package.json"))("playwright")); }
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const shots = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : "";
if (shots) fs.mkdirSync(shots, { recursive: true });

let server = null;
let browser = null;
try {
  let baseUrl = process.env.SANDBOX_URL;
  if (!baseUrl) {
    const port = await freePort();
    if ([8765, 8766, 8080].includes(port)) throw new Error(`landed on reserved port ${port}`);
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
    for (let i = 0; i < 240; i += 1) {
      try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(baseUrl + "?mode=circuitbuilder&v=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 120000 });
  const startBtn = page.locator("#nodeBootStartButton");
  if (await startBtn.count()) await startBtn.click().catch(() => {});
  await page.waitForFunction(() => typeof showNodeGraphModule === "function" && document.body.dataset.nodeBootFinished === "interface-ready", null, { timeout: 180000 });
  await page.waitForFunction(() => {
    const patch = nodeGraphMvp.patch; const n = patch && patch.nodes ? patch.nodes.length : -1; const now = performance.now();
    if (!window.__settle || window.__settle.patch !== patch || window.__settle.n !== n) window.__settle = { patch, n, since: now };
    return now - window.__settle.since > 2000;
  }, null, { timeout: 120000, polling: 100 });

  await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    showNodeGraphModule("pitchMutator", { x: 60, y: 60 }, options);
    showNodeGraphModule("keyboard", { x: 60, y: 300 }, options);
  });
  await page.waitForFunction(() => !!document.querySelector(".node-keyboard-surface"));
  if (!(await page.locator("#nodeSceneContextMenu").isVisible())) await page.locator("#nodeCommandCenterButton").click();
  await page.locator('#nodeSceneContextMenu [data-unified-action="mutators"]').click();
  await page.waitForFunction(() => !document.getElementById("pitchMutatorOverlay").hidden && !!document.querySelector("#pitchMutatorOverlay .pm-key"));

  // no scrollbar anywhere in the overlay (all 128 keys visible too)
  const bars = () => page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("#pitchMutatorOverlay, #pitchMutatorOverlay *")) {
      const cs = getComputedStyle(el);
      const sx = el.offsetHeight - el.clientHeight - (parseFloat(cs.borderTopWidth) || 0) - (parseFloat(cs.borderBottomWidth) || 0);
      const sy = el.offsetWidth - el.clientWidth - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      if (el.clientWidth && !/^(INPUT|TEXTAREA|BUTTON)$/.test(el.tagName) && (sx > 0.5 || sy > 0.5)) out.push(`${el.className || el.tagName}: ${sx}/${sy}`);
    }
    return out;
  });
  if (process.env.MEASURE) console.log(JSON.stringify(await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.height)]; }; const k = document.querySelector("#pitchMutatorOverlay .pm-key"); return { vh: innerHeight, overlay: r("#pitchMutatorOverlay"), axis: r("#pitchMutatorOverlay [data-pm=axis]"), inner: r(".pm-axis-inner"), kbd: r(".pm-kbd"), key: r(".pm-key"), radius: getComputedStyle(k).borderRadius, shape: getComputedStyle(k).cornerShape, padding: getComputedStyle(k).padding }; })));
  assert.deepEqual(await bars(), [], "no scrollbar in the Mutator overlay");
  const sbw = await page.evaluate(() => [...document.querySelectorAll("#pitchMutatorOverlay [data-pm=axis]")].map((e) => getComputedStyle(e).scrollbarWidth));
  assert.ok(sbw.length && sbw.every((v) => v === "none"), `axis scrollbar-width none (${sbw})`);

  // cursors: hover = + , pressed = dot, never pointer
  const cursors = await page.evaluate(() => {
    const plus = getComputedStyle(document.documentElement).getPropertyValue("--node-dot-cursor").trim();
    const dot = getComputedStyle(document.documentElement).getPropertyValue("--node-adjust-cursor").trim();
    const of = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).cursor : null; };
    return { plus, dot, key: of("#pitchMutatorOverlay .pm-key"), btn: of("#pitchMutatorOverlay .pm-btn"), lane: of("#pitchMutatorOverlay .pm-lane-btn"), axis: of("#pitchMutatorOverlay [data-pm=axis]"), surface: of(".node-keyboard-surface") };
  });
  for (const k of ["key", "btn", "lane", "axis", "surface"]) {
    if (cursors[k] == null) continue;
    assert.ok(!/pointer|grab|default|^auto/.test(cursors[k].split(",").pop().trim()) || /url\(/.test(cursors[k]), `${k} cursor is not the hand/arrow (${cursors[k].slice(0, 40)})`);
    assert.ok(/url\(/.test(cursors[k]), `${k} cursor is the custom + (${cursors[k].slice(0, 40)})`);
  }
  // pressed: the dot (rules: :active on the key and on the keyboard surface)
  const pressed = await page.evaluate(() => {
    const rules = [];
    for (const sheet of document.styleSheets) { let list; try { list = sheet.cssRules; } catch { continue; } for (const r of list) if (r.selectorText && /:active/.test(r.selectorText) && /pitchMutatorOverlay|node-keyboard-surface/.test(r.selectorText)) rules.push(r.selectorText + " => " + r.style.cursor); }
    return rules;
  });
  assert.ok(pressed.some((r) => /pitchMutatorOverlay/.test(r) && /adjust-cursor/.test(r)), "Mutator pressed cursor is the dot: " + pressed.join(" | "));
  assert.ok(pressed.some((r) => /node-keyboard-surface/.test(r) && /adjust-cursor/.test(r)), "Keyboard pressed cursor is the dot: " + pressed.join(" | "));

  // A mouse drag never scrolls the view; on the keyboard it plays each key it crosses; a double click on the graph answers (no knob lane here: the notice).
  const scrollOf = () => page.evaluate(() => document.querySelector("#pitchMutatorOverlay [data-pm=axis]").scrollLeft);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const s0 = await scrollOf();
  const keys = page.locator("#pitchMutatorOverlay .pm-key"); // data-note = index here (range 0..127)
  const keyBox = (n) => page.locator(`#pitchMutatorOverlay .pm-key[data-note="${n}"]`).boundingBox();
  const kb = await keyBox(60);
  const kb2 = await keyBox(66);
  const audition = () => page.evaluate(() => Number(document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note")));
  const note40 = 60;
  const note46 = 66;
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
  await page.mouse.down();
  await page.mouse.down();
  await page.waitForFunction((n) => Number(document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note")) === n, note40);
  await page.mouse.move(kb2.x + kb2.width / 2, kb2.y + kb2.height / 2, { steps: 8 });
  await page.waitForFunction((n) => Number(document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note")) === n, note46);
  await page.mouse.up();
  assert.equal(await scrollOf(), s0, "dragging on the keys does not scroll the view");
  const plot = await page.locator("#pitchMutatorOverlay .pm-plot-wrap").boundingBox();
  await page.mouse.move(plot.x + 400, plot.y + 60);
  await page.mouse.down();
  await page.mouse.move(plot.x + 200, plot.y + 60, { steps: 8 });
  await page.mouse.up();
  assert.equal(await scrollOf(), s0, "dragging on the graph does not scroll the view");
  void audition;

  // The Mutator keys toggle: a press on the solid key clears the Pitch knob; the nav button is tinted while the knob is off 0.
  const knobKey = () => page.evaluate(() => document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note") ?? null);
  const tinted = () => page.evaluate(() => [...document.querySelectorAll('[data-unified-action="mutators"]')].some((b) => b.classList.contains("pm-nav-pitched")));
  assert.equal(await knobKey(), "66", "the last drag left the knob on key 66");
  assert.equal(await tinted(), true, "nav button is tinted while the Pitch knob is set");
  const again = await keyBox(66);
  await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
  await page.waitForFunction(() => !document.querySelector("#pitchMutatorOverlay .pm-key.audition"));
  assert.equal(await tinted(), false, "pressing the solid key again clears the knob and the tint");
  const k0 = await page.evaluate(() => { const n = nodeGraphMvp.patch.nodes.find((q) => q.type === "pitchMutator"); return Number(n.params.playhead); });
  assert.equal(k0, 0, "the Pitch knob is 0 after the toggle");
  await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
  await page.waitForFunction(() => document.querySelector("#pitchMutatorOverlay .pm-key.audition")?.getAttribute("data-note") === "66");
  if (shots) await page.screenshot({ path: path.join(shots, "mutator-all-keys.png") });
  console.log("test_pitch_mutator_cursor_scrollbar_browser: ok");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
