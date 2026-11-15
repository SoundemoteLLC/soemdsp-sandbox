import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.log("page error:", error.message));
  await page.setContent("<style>.node-display-face{visibility:hidden!important}.node-arp-keys-face{position:relative}.node-arp-keys-canvas{position:absolute;inset:0;width:100%;height:100%}</style>");
  await page.evaluate(() => {
    window.nodeGraphMvp = { _arpFaceByNode: { test: { notes: [60, 62, 64], play: -1 } } };
    window.nodeGraphDisplayCanvasCreate = (name) => {
      const el = document.createElement("div");
      el.className = `${name} node-display-face`;
      return el;
    };
    window.nodeGraphDisplayCanvasSize = () => ({ width: 300, height: 100, pixelRatio: 1 });
    window.normalizeNodeGraphArpKeysSettings = () => ({
      strokeColor: "#fff", strokeBrightness: 1, strokeSaturation: 1,
      fontColor: "#fff", fontBrightness: 1, fontSaturation: 1,
      inactiveFillColor: "#000", inactiveFillBrightness: 0, inactiveFillSaturation: 1,
      activeFillColor: "#fff", activeFillBrightness: 1, activeFillSaturation: 1,
      inactiveTextColor: "#fff", inactiveTextBrightness: 1, inactiveTextSaturation: 1,
      activeTextColor: "#000", activeTextBrightness: 0, activeTextSaturation: 1,
      previousColor: "#fff", previousBrightness: 1, previousSaturation: 1,
      previousFadeSeconds: 0, trail: 0, ghost: 0, cornerShape: "square",
      cornerRadius: 0, edgeSpacing: 0, strokeThickness: 0.01,
    });
    window.nodeGraphGlLinesBegin = () => ({});
    window.nodeGraphGlLinesEnd = () => true;
    window.nodeGraphGlLinesCss = () => [1, 1, 1, 1];
    window.nodeGraphGlLinesRect = () => {};
    window.nodeGraphGlLinesTriangle = () => {};
    window.nodeGraphGlLinesPolyline = () => {};
    window.nodeGraphGlLinesText = () => {};
    window.nodeGraphGlLinesMeasureText = () => 12;
    window.PhosphorResidual = { ghostKeep: () => 0 };
    window.__arpHits = [];
    window.sendNodeGraphArpOverride = (...args) => window.__arpHits.push(args);
  });
  await page.addScriptTag({ path: fileURLToPath(new URL("../public/modules/arp/arp-display.js", import.meta.url)) });
  await page.evaluate(() => {
    const face = createNodeGraphArpKeysDisplay("test");
    Object.assign(face.style, { width: "300px", height: "100px", position: "relative", display: "block" });
    document.body.append(face);
  });
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".node-arp-keys-canvas").evaluate((el) => getComputedStyle(el).visibility), "hidden");
  await page.locator(".node-arp-keys-face").click({ position: { x: 150, y: 50 } });
  const hits = await page.evaluate(() => window.__arpHits);
  assert.ok(hits.some((args) => args[0] === "test" && args[1] === 62 && args[2] === true),
    `Clicking visible arp face should trigger the middle note: ${JSON.stringify(hits)}`);
  console.log("arp face click smoke passed");
} finally {
  await browser.close();
}
