// Code boxes (code-edit-1): compact Apply in the box corner, no format
// captions, commit when the user stops editing (blur / pointerdown outside /
// Ctrl+Enter), invalid text kept + marked, one undo step per edit.
// Covers the Code module face and the Script code box window.
//   node scripts/test_code_edit_commit.mjs   (CODE_EDIT_SHOTS=dir for screenshots)
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const check = (ok, msg) => { if (!ok) bad += 1; console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const shots = process.env.CODE_EDIT_SHOTS || "";

// ---- static ------------------------------------------------------------------
{
  const face = read("public/modules/codeBox/code-box-ui.js");
  const helper = read("public/node-graph-code-edit-commit.js");
  const win = read("public/node-graph-code-box-window.js");
  check(!face.includes("JSON graph document") && !face.includes("Apply validates"), "Code face has no format caption");
  check(!/\.title\s*=|setAttribute\(\s*["']title["']|title=/.test(face + helper), "code boxes set no hover titles");
  check(/bindNodeGraphCodeEditCommit\(area/.test(face) && /bindNodeGraphCodeEditCommit\(source/.test(win), "face and Script window share bindNodeGraphCodeEditCommit");
  check(!/"(code ok|draft ok)"/.test(win), "Script window has no ok-status chatter");
  for (const html of ["public/index.html", "public/perform.html"]) {
    const t = read(html);
    check(/node-graph-code-edit-commit\.js\?v=/.test(t), `${html} loads the shared code-edit helper`);
    const win = t.slice(t.indexOf('id="nodeCodeBoxWindow"'), t.indexOf('id="nodeCodeBoxWindow"') + 4000);
    check(!win.includes("```js"), `${html}: no format caption in the Script code box`);
    check(/<textarea id="nodeCodeBoxSource"[^>]*><\/textarea>\s*<button id="nodeCodeBoxApplyCode" class="node-code-edit-apply"/.test(win), `${html}: Script Apply sits in the editor`);
  }
}

// ---- browser -----------------------------------------------------------------
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const { chromium } = await import("playwright");
let server = null;
let browser = null;
let baseUrl = process.env.SANDBOX_URL || "";
try {
  if (!baseUrl) {
    const port = await freePort();
    server = spawn(process.platform === "win32" ? "python" : "python3", [path.join(ROOT, "server.py"), "--port", String(port)], { cwd: ROOT, stdio: "ignore" });
    baseUrl = `http://127.0.0.1:${port}/`;
  }
  for (let i = 0; i < 240; i += 1) { try { if ((await fetch(baseUrl)).ok) break; } catch { /* not up */ } await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${baseUrl}?v=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const start = page.locator("#nodeBootStartButton");
  if (await start.count()) await start.click().catch(() => {});
  await page.waitForFunction(() => typeof createNodeGraphPatchNode === "function" && typeof commitNodeGraphPatch === "function"
    && typeof createNodeGraphCodeBoxFace === "function" && typeof bindNodeGraphCodeEditCommit === "function", null, { timeout: 180000 });
  await page.waitForFunction(() => { const b = document.querySelector(".node-boot-loading-screen"); return !b || b.hidden || getComputedStyle(b).display === "none" || b.getBoundingClientRect().height === 0; }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(500);

  await page.evaluate(async () => {
    const base = typeof emptyNodeGraphPatch === "function" ? emptyNodeGraphPatch() : { nodes: [], cables: [] };
    const cb = createNodeGraphPatchNode("codeBox", { id: "cb", gx: 2, gy: 3 });
    commitNodeGraphPatch({ ...base, nodes: [cb], cables: [] }, { status: "code edit test" });
    if (typeof setNodeGraphZoom === "function") setNodeGraphZoom(1);
    await new Promise((r) => setTimeout(r, 800));
  });
  const sel = '.dsp-node[data-node="cb"] .node-code-box-source';
  await page.waitForSelector(sel, { timeout: 20000 });
  const stored = () => page.evaluate(() => nodeGraphPatchNode("cb")?.codeBox?.localText ?? null);
  const box = () => page.evaluate(() => {
    const face = document.querySelector('.dsp-node[data-node="cb"] .node-code-box-face');
    const area = face?.querySelector(".node-code-box-source");
    const apply = face?.querySelector(".node-code-edit-apply");
    const hint = face?.querySelector(".node-code-box-hint");
    const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; };
    return {
      toolbar: Boolean(face?.querySelector(".node-code-box-toolbar")),
      face: r(face), area: r(area), apply: r(apply), applyVisible: Boolean(apply && !apply.hidden && apply.getBoundingClientRect().height > 0),
      applyDirty: apply?.classList.contains("is-dirty") ?? null,
      hintText: hint?.textContent || "", hintShown: Boolean(hint && hint.getBoundingClientRect().height > 0),
      invalid: area?.classList.contains("is-invalid") ?? null, ariaInvalid: area?.getAttribute("aria-invalid") ?? null,
      value: area?.value ?? null, focused: document.activeElement === area,
      titles: face ? face.querySelectorAll("[title]").length : -1,
    };
  });

  let b = await box();
  check(!b.toolbar && b.applyVisible, `face: no toolbar row, Apply visible (${JSON.stringify({ toolbar: b.toolbar, apply: b.apply })})`);
  check(b.apply && b.area && b.apply.h <= 18 && b.apply.w <= 48
    && b.apply.x >= b.area.x && b.apply.x + b.apply.w <= b.area.x + b.area.w + 0.5
    && b.apply.y >= b.area.y && b.apply.y + b.apply.h <= b.area.y + b.area.h, `face: Apply is a small chip inside the box corner (${JSON.stringify(b.apply)})`);
  check(!b.hintShown && b.hintText === "", "face: no caption line under the box");
  check(b.area && b.face && b.area.h >= b.face.h - 12, `face: box fills the face (${b.area?.h.toFixed(1)} of ${b.face?.h.toFixed(1)} px)`);
  check(b.titles === 0, "face: no hover titles");
  if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.locator('.dsp-node[data-node="cb"]').screenshot({ path: path.join(shots, "code-face.png") }); }

  const original = await stored();
  const typeDoc = async (text) => {
    await page.click(sel);
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(text);
  };
  const empty = { x: 1400, y: 850 };
  // 1. valid edit, then click empty workspace -> committed
  await typeDoc('{"cursorX":0.25,"nodes":[{"x":0,"y":0.5,"c":0,"shape":"rational"},{"x":1,"y":0.1,"c":0,"shape":"rational"}]}');
  b = await box();
  check(b.applyDirty === true, "face: Apply lights up while there are unsaved edits");
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(150);
  let s = await stored();
  b = await box();
  check(Boolean(s) && s.includes('"cursorX": 0.25') && s.includes('"y":0.1'), "face: clicking the workspace commits the edit");
  check(!b.focused && b.value === s && !b.invalid && b.applyDirty === false, "face: box shows the stored canonical text, clean");
  // 2. undo restores the previous document, box follows
  await page.evaluate(() => undoNodeGraphPatch());
  await page.waitForTimeout(400);
  s = await stored();
  b = await box();
  check(s === original && b.value === original, "face: one undo restores the previous document");
  await page.evaluate(() => redoNodeGraphPatch());
  await page.waitForTimeout(300);
  // 3. invalid text + Tab away -> kept, marked, stored untouched, survives the 250 ms sync
  const beforeBad = await stored();
  await typeDoc("{ \"cursorX\": 0.5, nodes: oops");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(700);
  s = await stored();
  b = await box();
  check(s === beforeBad, "face: invalid JSON does not change the stored document");
  check(b.value === "{ \"cursorX\": 0.5, nodes: oops" && b.invalid && b.ariaInvalid === "true", `face: invalid text stays in the box, marked invalid (${JSON.stringify({ value: b.value, invalid: b.invalid, aria: b.ariaInvalid, focused: b.focused })})`);
  check(b.hintShown && /JSON/i.test(b.hintText) && b.titles === 0, `face: error line shown, no tooltip (${b.hintText})`);
  if (shots) await page.locator('.dsp-node[data-node="cb"]').screenshot({ path: path.join(shots, "code-face-invalid.png") });
  // 3b. (code-edit-2) invalid -> type the exact saved text back: error clears live, chip clean,
  //     Apply still pressable and records nothing, leaving records nothing, refresh doesn't resurrect it
  {
    const saved = await stored();
    const depth0 = await page.evaluate(() => nodeGraphMvp.historyIndex);
    await typeDoc(saved);
    await page.waitForTimeout(450);
    b = await box();
    check(b.focused && !b.invalid && b.ariaInvalid === "false" && !b.hintShown && b.applyDirty === false, `face: typing the saved text back clears the error while typing (${JSON.stringify({ invalid: b.invalid, hint: b.hintText, dirty: b.applyDirty })})`);
    const r = await page.evaluate(() => { const e = document.querySelector('.dsp-node[data-node="cb"] .node-code-edit-apply'); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, hidden: e.hidden, disabled: e.disabled }; });
    check(!r.hidden && !r.disabled, "face: Apply stays pressable on a clean box");
    await page.mouse.move(r.x, r.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(150);
    await page.keyboard.press("Tab");
    await page.waitForTimeout(700);
    b = await box();
    const depth1 = await page.evaluate(() => nodeGraphMvp.historyIndex);
    check(depth1 === depth0 && (await stored()) === saved, `face: Apply / leave on the saved text record nothing (${depth0} -> ${depth1})`);
    check(!b.invalid && !b.hintShown && b.value === saved, "face: the 250 ms refresh does not bring the error back");
  }
  // 3c. invalid again (flagged while typing), then different valid JSON: error clears, save happens
  {
    const depth0 = await page.evaluate(() => nodeGraphMvp.historyIndex);
    await typeDoc('{"cursorX": 0.4, "nodes": [');
    await page.waitForTimeout(450);
    b = await box();
    check(b.focused && b.invalid && b.hintShown, `face: invalid text is flagged while typing (${b.hintText})`);
    await typeDoc('{"cursorX":0.4,"nodes":[{"x":0,"y":0.2,"c":0,"shape":"rational"},{"x":1,"y":0.6,"c":0,"shape":"rational"}]}');
    await page.waitForTimeout(450);
    b = await box();
    check(b.focused && !b.invalid && !b.hintShown && b.applyDirty === true, "face: different valid JSON clears the error while typing, chip shows unsaved");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(400);
    const s2 = await stored();
    b = await box();
    const depth1 = await page.evaluate(() => nodeGraphMvp.historyIndex);
    check(s2.includes('"cursorX": 0.4') && s2.includes('"y":0.6') && depth1 === depth0 + 1 && !b.invalid && !b.hintShown, `face: the corrected JSON saves as one undo step (${depth0} -> ${depth1})`);
  }
  // make it invalid once more for the Ctrl+Enter step below
  await typeDoc("{ nope");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  // 4. fix it, commit with Ctrl+Enter (focus stays)
  await typeDoc('{"cursorX":0.75,"nodes":[{"x":0,"y":0,"c":0,"shape":"rational"},{"x":1,"y":1,"c":0,"shape":"rational"}]}');
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(150);
  s = await stored();
  b = await box();
  check(s.includes('"cursorX": 0.75') && !b.invalid && !b.hintShown && b.focused, "face: Ctrl+Enter commits, clears the error, keeps focus");
  // 5. Apply chip commits without stealing focus
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText('{"cursorX":0.1,"nodes":[{"x":0,"y":0,"c":0,"shape":"rational"},{"x":1,"y":0.3,"c":0,"shape":"rational"}]}');
  await page.evaluate(() => {
    window.__ceClicks = [];
    const log = (name) => (e) => window.__ceClicks.push(`${name}:${String(e.target?.className || e.target?.tagName).slice(0, 30)}`);
    for (const n of ["pointerdown", "mousedown", "focusout", "click"]) document.addEventListener(n, log(n), true);
    document.addEventListener("focusout", () => window.__ceClicks.push("stack:" + String(new Error().stack).split("\n").slice(2, 7).map((l) => l.trim().replace(/^at /, "").replace(/\(?https?:\/\/[^/]+\/public\//, "")).join(" < ")), true);
    const orig = commitNodeGraphCodeBoxLocalText;
    window.commitNodeGraphCodeBoxLocalText = function (...a) { const r = orig.apply(this, a); window.__ceClicks.push(`commit:${a[2]}:${r?.ok}:${String(a[1]).slice(0, 16)}`); return r; };
  });
  if (process.env.CODE_EDIT_DEBUG) console.log(await page.evaluate(() => { const a = document.querySelector('.dsp-node[data-node="cb"] .node-code-edit-apply'); const ta = document.querySelector('.dsp-node[data-node="cb"] .node-code-box-source'); const cs = (e) => { const c = getComputedStyle(e); return { pos: c.position, z: c.zIndex, pe: c.pointerEvents }; }; const r = a.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return JSON.stringify({ btn: cs(a), ta: cs(ta), wrap: cs(a.parentElement), hit: hit?.className }); }));
  const depthBeforeApply = await page.evaluate(() => nodeGraphMvp.historyIndex);
  {
    const r = await page.evaluate(() => { const e = document.querySelector('.dsp-node[data-node="cb"] .node-code-edit-apply').getBoundingClientRect(); return { x: e.x + e.width / 2, y: e.y + e.height / 2 }; });
    await page.mouse.move(r.x, r.y, { steps: 4 });
    await page.mouse.down();
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  s = await stored();
  b = await box();
  const depthAfterApply = await page.evaluate(() => nodeGraphMvp.historyIndex);
  check(depthAfterApply === depthBeforeApply + 1, `face: Apply records exactly one undo step (${depthBeforeApply} -> ${depthAfterApply})`);
  check(s.includes('"cursorX": 0.1') && b.focused, `face: Apply chip commits and leaves the caret in the box (${JSON.stringify({ focused: b.focused, events: await page.evaluate(() => window.__ceClicks.filter((e) => !e.startsWith("stack:"))) })})`);
  // 6. no-op leave adds no undo step
  const undoDepth = () => page.evaluate(() => nodeGraphMvp.historyIndex);
  const d0 = await undoDepth();
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(150);
  check((await undoDepth()) === d0, `face: leaving without changes records nothing (undo depth ${d0})`);

  // ---- Script code box window --------------------------------------------------
  const scriptOk = await page.evaluate(async () => {
    const ret = typeof showNodeGraphModule === "function" ? showNodeGraphModule("script", { x: 1000, y: 300 }, { status: "script added" }) : null;
    let id = typeof ret === "string" ? ret : null;
    for (let i = 0; i < 40 && !id; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      id = (nodeGraphMvp.patch?.nodes || []).find((n) => n.type === "script")?.id || null;
    }
    if (!id) return { id: null, ret: String(ret), nodes: (nodeGraphMvp.patch?.nodes || []).map((n) => `${n.id}:${n.type}`).join(",") };
    await new Promise((r) => setTimeout(r, 600));
    await new Promise((r) => setTimeout(r, 400));
    let opened = await Promise.resolve(openNodeGraphCodeBoxWindowForNode(id)).catch((e) => String(e));
    for (let i = 0; i < 100 && document.documentElement.dataset.codeScreenUiLoaded !== "true"; i += 1) await new Promise((r) => setTimeout(r, 100));
    if (document.getElementById("nodeCodeBoxWindow")?.hidden !== false) opened = openNodeGraphCodeBoxWindowForNode(id);
    await new Promise((r) => setTimeout(r, 300));
    return { id, opened: document.getElementById("nodeCodeBoxWindow")?.hidden === false, ret: String(opened), type: nodeGraphPatchNode(id)?.type ?? null, nodes: (nodeGraphMvp.patch?.nodes || []).map((n) => `${n.id}:${n.type}`).join(","), made: (() => { try { const n = createNodeGraphPatchNode("script", { id: "zz" }); return `${n?.id}:${n?.type}`; } catch (e) { return String(e); } })(), loaded: document.documentElement.dataset.codeScreenUiLoaded ?? null };
  });
  if (!scriptOk.id) {
    // Script is not a placeable module in this build (no nodeGraphModuleDefinitions.script).
    console.log(`skip Script code box window commit checks: Script module not placeable here (${JSON.stringify(scriptOk)})`);
    const lay = await page.evaluate(async () => {
      await Promise.resolve(openNodeGraphCodeBoxWindowFromHeader()).catch(() => {});
      for (let i = 0; i < 100 && document.documentElement.dataset.codeScreenUiLoaded !== "true"; i += 1) await new Promise((r) => setTimeout(r, 100));
      if (typeof setNodeGraphCodeBoxWindowVisible === "function") setNodeGraphCodeBoxWindowVisible(true);
      await new Promise((r) => setTimeout(r, 300));
      const w = document.getElementById("nodeCodeBoxWindow");
      const src = document.getElementById("nodeCodeBoxSource");
      const apply = document.getElementById("nodeCodeBoxApplyCode");
      const ed = w.querySelector(".node-code-box-editor");
      const ar = apply?.getBoundingClientRect(); return { applyH: ar?.height ?? 0, applyW: ar?.width ?? 0, shown: w.hidden === false, caption: Boolean(w.querySelector(".node-code-box-source-label > span")), inEditor: Boolean(ed?.contains(apply)), bound: Boolean(src?._nodeGraphCodeEdit), applyTab: apply?.tabIndex, titles: w.querySelectorAll("[title]").length };
    });
    check(lay.shown && !lay.caption && lay.inEditor && lay.bound && lay.applyTab === -1 && lay.applyH <= 18 && lay.applyW <= 48, `Script window layout: no caption, Apply in the editor, box bound to the shared commit (${JSON.stringify(lay)})`);
    if (shots && lay.shown) await page.locator("#nodeCodeBoxWindow").screenshot({ path: path.join(shots, "script-window-empty.png") });
  } else {
    check(scriptOk.opened, `Script code box window opens (${JSON.stringify(scriptOk)})`);
  }
  if (scriptOk.opened) {
    const win = () => page.evaluate((id) => {
      const w = document.getElementById("nodeCodeBoxWindow");
      const src = document.getElementById("nodeCodeBoxSource");
      const apply = document.getElementById("nodeCodeBoxApplyCode");
      const status = document.getElementById("nodeCodeBoxStatus");
      const ed = w.querySelector(".node-code-box-editor");
      const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; };
      return {
        caption: Boolean(w.querySelector(".node-code-box-source-label > span")),
        applyInEditor: Boolean(ed && apply && ed.contains(apply)), apply: r(apply), editor: r(ed),
        status: status?.textContent || "", statusShown: Boolean(status && status.getBoundingClientRect().height > 0),
        invalid: src?.classList.contains("is-invalid"), value: src?.value, stored: nodeGraphPatchNode(id)?.scriptSource ?? null,
        titles: w.querySelectorAll("[title]").length,
      };
    }, scriptOk.id);
    let w = await win();
    check(!w.caption && w.applyInEditor && w.apply && w.apply.h <= 18, `Script window: no caption row, compact Apply in the editor (${JSON.stringify(w.apply)})`);
    check(!w.statusShown, `Script window: no status line while the code is fine (${JSON.stringify(w.status)})`);
    if (shots) await page.locator("#nodeCodeBoxWindow").screenshot({ path: path.join(shots, "script-window.png") });
    const good = `${w.value || ""}\n// edited by test\n`;
    await page.click("#nodeCodeBoxSource");
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText(good);
    await page.mouse.click(empty.x, 40);
    await page.waitForTimeout(250);
    w = await win();
    check(w.stored === good, "Script window: leaving the box commits the code");
    await page.click("#nodeCodeBoxSource");
    await page.keyboard.press("Control+A");
    await page.keyboard.insertText("this is not ) valid emo (");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    w = await win();
    check(w.value === "this is not ) valid emo (" && w.invalid === true && w.statusShown && /error/i.test(w.status), `Script window: bad code is kept, marked, error line shown (${w.status})`);
    check(w.titles === 0, "Script window: no hover titles");
    if (shots) await page.locator("#nodeCodeBoxWindow").screenshot({ path: path.join(shots, "script-window-invalid.png") });
  }
  check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 3).join(" | ")})`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}
console.log(bad ? `${bad} check(s) failed` : "all checks passed");
process.exit(bad ? 1 : 0);
