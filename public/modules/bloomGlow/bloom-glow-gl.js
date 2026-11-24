const NODE_GRAPH_BLOOM_GLOW_GL_REV = 1;
const NODE_GRAPH_BLOOM_GLOW_MAX = 4096;

// Bloom & Glow, in passes:
//   1. bright   the picture's bright parts (above the Threshold, with a soft knee) into a half-size surface A
//   2. bloom    A is blurred sideways then up-and-down (a 5-tap gaussian using linear filtering, so it is 9 taps wide), the step set by Spread
//   3. glow     the blurred bloom is carried to a quarter-size surface C and blurred wider (twice), the step set by Glow Size
//   4. combine  picture * (1 - Dim) + bloom * Bloom + glow * Glow, into the output surface
// Everything below the picture is small, so the cost is mostly the one full-size pass at the end.
(function initNodeGraphBloomGlowGl(global) {
  const KEY = "_bloomGlowGl";
  let sharedDevice = null;
  let linkFailedGl = null;

  function reportFailure(host, reason) {
    if (host && typeof nodeGraphDisplayGlFailed === "function") nodeGraphDisplayGlFailed(host, reason);
  }

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const FRAG_BRIGHT = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform float uHasPic;
    uniform float uThreshold;
    void main() {
      vec3 c = vec3(0.0);
      if (uHasPic > 0.5) {
        vec4 t = texture2D(uPic, vUv);
        c = t.a > 1e-4 ? t.rgb / t.a : vec3(0.0);
      }
      float m = max(c.r, max(c.g, c.b));
      float w = smoothstep(uThreshold, uThreshold + 0.25, m);
      gl_FragColor = vec4(c * w, 1.0);
    }
  `;

  const FRAG_BLUR = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2 uStep;
    void main() {
      vec3 s = texture2D(uTex, vUv).rgb * 0.2270270270;
      s += (texture2D(uTex, vUv + uStep * 1.3846153846).rgb + texture2D(uTex, vUv - uStep * 1.3846153846).rgb) * 0.3162162162;
      s += (texture2D(uTex, vUv + uStep * 3.2307692308).rgb + texture2D(uTex, vUv - uStep * 3.2307692308).rgb) * 0.0702702703;
      gl_FragColor = vec4(s, 1.0);
    }
  `;

  const FRAG_COPY = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    void main() {
      gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
    }
  `;

  const FRAG_COMBINE = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform sampler2D uBloom;
    uniform sampler2D uGlow;
    uniform float uHasPic;
    uniform float uBloomAmt;
    uniform float uGlowAmt;
    uniform float uDim;
    void main() {
      vec3 c = vec3(0.0);
      if (uHasPic > 0.5) {
        vec4 t = texture2D(uPic, vUv);
        c = t.a > 1e-4 ? t.rgb / t.a : vec3(0.0);
      }
      c *= 1.0 - uDim;
      c += texture2D(uBloom, vUv).rgb * uBloomAmt + texture2D(uGlow, vUv).rgb * uGlowAmt;
      gl_FragColor = vec4(min(c, vec3(1.0)), 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "bloom-glow-gl.js");
  }

  function createSurface(gl, w, h) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const internal = (gl.RGBA8 !== undefined) ? gl.RGBA8 : gl.RGBA;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!ok) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return null;
    }
    return { texture, framebuffer, width: w, height: h };
  }

  function destroySurface(gl, surface) {
    if (!surface || !gl) return;
    if (surface.framebuffer) gl.deleteFramebuffer(surface.framebuffer);
    if (surface.texture) gl.deleteTexture(surface.texture);
  }

  function program(gl, fs, names) {
    const p = link(gl, VERT, fs);
    if (!p) return null;
    const out = { program: p, aPos: gl.getAttribLocation(p, "aPos") };
    for (const n of names) out[n] = gl.getUniformLocation(p, n);
    return out;
  }

  function getSharedDevice() {
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_BLOOM_GLOW_GL_REV) {
      return sharedDevice;
    }
    sharedDevice = null;
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const { gl } = picture;
    if (linkFailedGl === gl && !gl.isContextLost()) return null;
    const bright = program(gl, FRAG_BRIGHT, ["uPic", "uHasPic", "uThreshold"]);
    const blur = program(gl, FRAG_BLUR, ["uTex", "uStep"]);
    const copy = program(gl, FRAG_COPY, ["uTex"]);
    const combine = program(gl, FRAG_COMBINE, ["uPic", "uBloom", "uGlow", "uHasPic", "uBloomAmt", "uGlowAmt", "uDim"]);
    if (!bright || !blur || !copy || !combine) {
      linkFailedGl = gl;
      return null;
    }
    sharedDevice = { rev: NODE_GRAPH_BLOOM_GLOW_GL_REV, gl, quad: SoemGl.quad(gl), bright, blur, copy, combine };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Bloom & Glow: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_BLOOM_GLOW_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_BLOOM_GLOW_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_BLOOM_GLOW_GL_REV) {
      renderer.device = device;
      renderer.gl = gl;
      return renderer;
    }
    const size = `${w}x${h}`;
    if (host[KEY + "Failed"] === size) return null;
    disposeRenderer(host);
    const hw = Math.max(8, w >> 1);
    const hh = Math.max(8, h >> 1);
    const qw = Math.max(8, w >> 2);
    const qh = Math.max(8, h >> 2);
    const surfaces = {
      shown: createSurface(gl, w, h),
      spare: createSurface(gl, w, h),
      a: createSurface(gl, hw, hh),
      b: createSurface(gl, hw, hh),
      c: createSurface(gl, qw, qh),
      d: createSurface(gl, qw, qh),
    };
    if (Object.values(surfaces).some((s) => !s)) {
      for (const s of Object.values(surfaces)) destroySurface(gl, s);
      host[KEY + "Failed"] = size;
      reportFailure(host, "Bloom & Glow: framebuffer incomplete");
      return null;
    }
    host[KEY + "Failed"] = "";
    const blackTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blackTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.bindTexture(gl.TEXTURE_2D, null);
    renderer = { alive: true, rev: NODE_GRAPH_BLOOM_GLOW_GL_REV, gl, device, ...surfaces, width: w, height: h, blackTex };
    host[KEY] = renderer;
    return renderer;
  }

  function disposeRenderer(host) {
    const renderer = host?.[KEY];
    if (!renderer) return;
    renderer.alive = false;
    const gl = renderer.gl;
    if (gl && !gl.isContextLost()) {
      for (const k of ["shown", "spare", "a", "b", "c", "d"]) destroySurface(gl, renderer[k]);
      if (renderer.blackTex) gl.deleteTexture(renderer.blackTex);
    }
    host[KEY] = null;
  }

  function wipeRenderer(host) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return;
    const gl = renderer.gl;
    for (const k of ["shown", "spare"]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, renderer[k].framebuffer);
      gl.viewport(0, 0, renderer.width, renderer.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // One full-screen pass of `prog` into `target`; `textures` are bound to units 0.. in order, `setup` sets the uniforms.
  function pass(gl, device, prog, target, textures, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(prog.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
    for (let i = 0; i < textures.length; i += 1) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, textures[i]);
    }
    setup(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function step(host, options) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return false;
    const { gl, device } = renderer;
    const hasPic = Boolean(options.picture?.texture);
    const picTex = options.picture?.texture || renderer.blackTex;
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    // 1. bright parts, half size, into a
    pass(gl, device, device.bright, renderer.a, [picTex], (p) => {
      gl.uniform1i(p.uPic, 0);
      gl.uniform1f(p.uHasPic, hasPic ? 1 : 0);
      gl.uniform1f(p.uThreshold, Number(options.threshold) || 0);
    });
    // 2. bloom: a -> b (sideways) -> a (up and down); the step is Spread, in texels of the half-size surface
    const bloomStep = 0.6 + (Number(options.spread) || 0) * 5;
    const blur = (src, dst, dx, dy, k) => pass(gl, device, device.blur, dst, [src.texture], (p) => {
      gl.uniform1i(p.uTex, 0);
      gl.uniform2f(p.uStep, (dx * k) / src.width, (dy * k) / src.height);
    });
    blur(renderer.a, renderer.b, 1, 0, bloomStep);
    blur(renderer.b, renderer.a, 0, 1, bloomStep);
    // 3. glow: a -> c (quarter size), then blurred wide, twice
    pass(gl, device, device.copy, renderer.c, [renderer.a.texture], (p) => gl.uniform1i(p.uTex, 0));
    const glowStep = 1.0 + (Number(options.glowSize) || 0) * 7;
    blur(renderer.c, renderer.d, 1, 0, glowStep);
    blur(renderer.d, renderer.c, 0, 1, glowStep);
    blur(renderer.c, renderer.d, 1, 0, glowStep * 1.7);
    blur(renderer.d, renderer.c, 0, 1, glowStep * 1.7);
    // 4. combine into the spare output
    pass(gl, device, device.combine, renderer.spare, [picTex, renderer.a.texture, renderer.c.texture], (p) => {
      gl.uniform1i(p.uPic, 0);
      gl.uniform1i(p.uBloom, 1);
      gl.uniform1i(p.uGlow, 2);
      gl.uniform1f(p.uHasPic, hasPic ? 1 : 0);
      gl.uniform1f(p.uBloomAmt, Number(options.bloom) || 0);
      gl.uniform1f(p.uGlowAmt, Number(options.glow) || 0);
      gl.uniform1f(p.uDim, Number(options.dim) || 0);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let i = 2; i >= 0; i -= 1) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
    const finished = renderer.spare;
    renderer.spare = renderer.shown;
    renderer.shown = finished;
    if (options.nodeId && typeof nodeGraphPicturePublish === "function") {
      nodeGraphPicturePublish(options.nodeId, renderer.shown.texture, renderer.width, renderer.height, { byReference: true });
    }
    return true;
  }

  function presentTo(host, destCtx, width, height) {
    const renderer = host?.[KEY];
    if (!renderer?.alive || !destCtx) return false;
    if (typeof nodeGraphPicturePresent !== "function") return false;
    return nodeGraphPicturePresent(
      renderer.shown.texture,
      renderer.width,
      renderer.height,
      destCtx?.canvas || destCtx,
      width,
      height,
    );
  }

  global.nodeGraphBloomGlowGlEnsure = ensureRenderer;
  global.nodeGraphBloomGlowGlDispose = disposeRenderer;
  global.nodeGraphBloomGlowGlWipe = wipeRenderer;
  global.nodeGraphBloomGlowGlStep = step;
  global.nodeGraphBloomGlowGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
