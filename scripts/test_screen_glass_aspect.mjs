#!/usr/bin/env node
// Screen Glass: soft edges (rim shadow, glass edge, vignette) must be the same pixel width
// on all four sides of a rectangular screen. Compiles the real fragment shader in headless
// Chromium, renders 800x300 and 300x300, and measures the rim-shadow falloff from the left
// edge and from the top edge.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/modules/screenBend/screen-bend-gl.js"), "utf8");
function assert(c, m) { if (!c) throw new Error(m); }
const grab = (name) => {
  const m = src.match(new RegExp("const " + name + " = `([\\s\\S]*?)`;"));
  assert(m, name + " not found");
  return m[1];
};
const VERT = grab("VERT");
const FRAG = grab("FRAG");
assert(/uniform vec2 uAspectScale/.test(FRAG), "shader must take an aspect uniform");
assert(/uAspectScale/.test(src.split("function step")[1]), "step() must set the aspect uniform");

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(({ VERT, FRAG }) => {
    function run(W, H) {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const gl = c.getContext("webgl", { preserveDrawingBuffer: true });
      if (!gl) return { error: "no webgl" };
      const mk = (type, s) => { const sh = gl.createShader(type); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const u = (n, ...v) => { const l = gl.getUniformLocation(prog, n); if (l == null) return; v.length === 2 ? gl.uniform2f(l, v[0], v[1]) : gl.uniform1f(l, v[0]); };
      u("uPic", 0); u("uHasPic", 1); u("uWidth", 0); u("uHeight", 0); u("uRound", 0); u("uVignette", 0);
      u("uGlare", 0); u("uGlarePos", 0, 0); u("uGlareSize", 0); u("uVigReach", 0); u("uVigCurve", 0); u("uVigShape", 1);
      u("uShadowAlpha", 1); u("uShadowThick", 0.3);
      u("uAspectScale", Math.min(1, H / W), Math.min(1, W / H));
      gl.viewport(0, 0, W, H);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const at = (x, y) => px[((H - 1 - y) * W + x) * 4] / 255; // y from the top
      const reach = (get, len) => { for (let i = 0; i < len; i++) if (get(i) >= 0.5) return i; return len; };
      return {
        left: reach((i) => at(i, H >> 1), W >> 1),
        right: reach((i) => at(W - 1 - i, H >> 1), W >> 1),
        top: reach((i) => at(W >> 1, i), H >> 1),
        bottom: reach((i) => at(W >> 1, H - 1 - i), H >> 1),
      };
    }
    return { wide: run(800, 300), square: run(300, 300), tall: run(300, 800) };
  }, { VERT, FRAG });
  console.log(JSON.stringify(result));
  for (const [name, r] of Object.entries(result)) {
    assert(!r.error, name + ": " + r.error);
    const all = [r.left, r.right, r.top, r.bottom];
    assert(Math.max(...all) - Math.min(...all) <= 3, `${name}: soft edge width differs between sides: ${JSON.stringify(r)}`);
    assert(Math.min(...all) > 5, `${name}: rim shadow missing: ${JSON.stringify(r)}`);
  }
  console.log("test_screen_glass_aspect: ok");
} finally {
  await browser.close();
}