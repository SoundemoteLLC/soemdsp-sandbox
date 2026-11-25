const NODE_GRAPH_SCREEN_BEND_GL_REV = 6;
const NODE_GRAPH_SCREEN_BEND_MAX = 4096;

(function initNodeGraphScreenBendGl(global) {
  const KEY = "_screenBendGl";
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

  // Screen Glass. Width bows the sides (x grows with y²), Height bows the top and bottom. Positive is outer, like a CRT glass,
  // negative pinches inward. Full knob throw is 0.42, strong without folding the picture over itself.
  // Then the glass itself: Roundness shapes the screen edge as a squircle (a superellipse, |x|^n + |y|^n = 1: n 40 is a
  // plain rectangle, n 4 a squircle, n 2 an ellipse), Vignette darkens toward the edges, Glare is a soft reflection on the glass.
  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform float uHasPic;
    uniform float uWidth;
    uniform float uHeight;
    uniform float uRound;
    uniform float uVignette;
    uniform float uGlare;
    uniform vec2 uGlarePos;
    uniform float uGlareSize;
    uniform float uVigReach;
    uniform float uVigCurve;
    uniform float uVigShape;
    uniform float uShadowAlpha;
    uniform float uShadowThick;
    // (min(1, H / W), min(1, W / H)): scales the short side's pixels back to normalized x / y.
    uniform vec2 uAspectScale;

    // Distance to the glass edge (1.0 on the edge) measured in the same pixels on every side. The plain superellipse distance d is
    // in normalized coordinates, so on a wide screen a band of 0.1 is W/20 px at the left and right but only H/20 px at the top and
    // bottom: the sides came out softer than the top and bottom. Dividing the gap (1 - d) by how many normalized units one
    // short-side pixel spans along the local edge normal makes every soft edge the same pixel width on all four sides. On a square
    // screen uAspectScale is (1, 1), so the result is d unchanged.
    float edgeDist(vec2 p, float n) {
      vec2 a = pow(abs(p), vec2(n));
      float d = pow(a.x + a.y, 1.0 / n);
      if (d < 1e-3) return d;
      vec2 g = pow(abs(p) / d, vec2(n - 1.0));
      float r = length(g * uAspectScale) / max(length(g), 1e-4);
      return 1.0 - (1.0 - d) / max(r, 1e-3);
    }

    void main() {
      vec2 p = vUv * 2.0 - 1.0;
      vec2 q = p;
      q.x *= 1.0 + uWidth * 0.42 * p.y * p.y;
      q.y *= 1.0 + uHeight * 0.42 * p.x * p.x;
      vec2 uv = q * 0.5 + 0.5;
      vec2 e = 0.003 * uAspectScale;
      float inside = smoothstep(0.0, e.x, uv.x) * smoothstep(0.0, e.x, 1.0 - uv.x)
                   * smoothstep(0.0, e.y, uv.y) * smoothstep(0.0, e.y, 1.0 - uv.y);
      vec3 col = vec3(0.0);
      if (uHasPic > 0.5 && inside > 0.0) {
        vec4 t = texture2D(uPic, uv);
        col = (t.a > 1e-4 ? t.rgb / t.a : vec3(0.0)) * inside;
      }
      // Glass edge: superellipse exponent from Roundness (0 = square corners, 1 = ellipse).
      float n = 2.0 + 38.0 * pow(1.0 - uRound, 2.0);
      float d = edgeDist(p, n);
      float mask = 1.0 - smoothstep(0.985, 1.0, d);
      // Vignette: the edges of the glass fall away from the middle. Reach is how far in the dark starts, Curve is how sudden the
      // fall is (soft gradient ... a hard shadow edge); at full Vignette the outside goes fully black.
      // Dark starts at vStart (Reach) and is full at vEnd (Curve: soft = out at the corners, hard = right after the start). As
      // Vignette comes up vEnd pulls in to the glass edge, so at full Vignette everything from the edge outward is pure black.
      float vAmt = uVignette;
      float vStart = mix(0.95, 0.0, uVigReach);
      float vEnd = mix(1.4, vStart + 0.05, pow(uVigCurve, 0.7));
      vEnd = mix(vEnd, min(vEnd, 1.0), vAmt);
      // The distance the vignette is measured by: a superellipse like the glass edge. Vig Shape 0 is a circle (oval on a wide
      // screen), 1 is the glass edge's own shape (Roundness), so the dark follows the screen outline and reaches full black exactly
      // at the glass edge: at full Vignette there is no screen edge to see, only the shadow.
      float nv = mix(2.0, n, uVigShape);
      float dv = edgeDist(p, nv);
      float vig = 1.0 - vAmt * smoothstep(vStart, max(vEnd, vStart + 0.02), dv);
      // Glare: a soft window-like reflection where Glare X / Y put it (size from Glare Size), plus a faint sheen along the rim.
      vec2 g = (p - uGlarePos) * vec2(1.1, 1.7);
      float blob = exp(-dot(g, g) * mix(14.0, 1.2, uGlareSize));
      float rim = smoothstep(0.84, 0.985, d);
      col += uGlare * (0.32 * blob + 0.07 * rim) * vec3(1.0);
      // Rim shadow: a band hugging the glass edge, like the shadow the enclosure casts on the screen. Thick is how far in it reaches,
      // Alpha how dark it gets at the edge (1 is black). It follows the glass outline (Roundness), and falls off softly into the picture.
      float shadowW = 0.02 + 0.45 * uShadowThick;
      float rimShadow = pow(smoothstep(1.0 - shadowW, 1.0, d), 1.6);
      float shade = 1.0 - uShadowAlpha * rimShadow;
      // The vignette and the rim shadow multiply everything, glare included, so full Vignette is pure black out there (nothing is added back).
      gl_FragColor = vec4(col * vig * shade * mask, 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "screen-bend-gl.js");
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

  function getSharedDevice() {
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_SCREEN_BEND_GL_REV) {
      return sharedDevice;
    }
    sharedDevice = null;
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const { gl } = picture;
    if (linkFailedGl === gl && !gl.isContextLost()) return null;
    const program = link(gl, VERT, FRAG);
    if (!program) {
      linkFailedGl = gl;
      return null;
    }
    sharedDevice = {
      rev: NODE_GRAPH_SCREEN_BEND_GL_REV,
      gl,
      quad: SoemGl.quad(gl),
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uWidth: gl.getUniformLocation(program, "uWidth"),
      uHeight: gl.getUniformLocation(program, "uHeight"),
      uRound: gl.getUniformLocation(program, "uRound"),
      uVignette: gl.getUniformLocation(program, "uVignette"),
      uGlare: gl.getUniformLocation(program, "uGlare"),
      uGlarePos: gl.getUniformLocation(program, "uGlarePos"),
      uGlareSize: gl.getUniformLocation(program, "uGlareSize"),
      uVigReach: gl.getUniformLocation(program, "uVigReach"),
      uVigCurve: gl.getUniformLocation(program, "uVigCurve"),
      uVigShape: gl.getUniformLocation(program, "uVigShape"),
      uShadowAlpha: gl.getUniformLocation(program, "uShadowAlpha"),
      uShadowThick: gl.getUniformLocation(program, "uShadowThick"),
      uAspectScale: gl.getUniformLocation(program, "uAspectScale"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Screen Bend: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_SCREEN_BEND_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_SCREEN_BEND_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_SCREEN_BEND_GL_REV) {
      renderer.device = device;
      renderer.gl = gl;
      return renderer;
    }
    const size = `${w}x${h}`;
    if (host[KEY + "Failed"] === size) return null;
    disposeRenderer(host);
    const shown = createSurface(gl, w, h);
    const spare = createSurface(gl, w, h);
    if (!shown || !spare) {
      destroySurface(gl, shown);
      destroySurface(gl, spare);
      host[KEY + "Failed"] = size;
      reportFailure(host, "Screen Bend: framebuffer incomplete");
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
    renderer = {
      alive: true,
      rev: NODE_GRAPH_SCREEN_BEND_GL_REV,
      gl,
      device,
      shown,
      spare,
      width: w,
      height: h,
      blackTex,
    };
    host[KEY] = renderer;
    return renderer;
  }

  function disposeRenderer(host) {
    const renderer = host?.[KEY];
    if (!renderer) return;
    renderer.alive = false;
    const gl = renderer.gl;
    if (gl && !gl.isContextLost()) {
      destroySurface(gl, renderer.shown);
      destroySurface(gl, renderer.spare);
      if (renderer.blackTex) gl.deleteTexture(renderer.blackTex);
    }
    host[KEY] = null;
  }

  function wipeRenderer(host) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return;
    const gl = renderer.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.shown.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.spare.framebuffer);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function step(host, options) {
    const renderer = host?.[KEY];
    if (!renderer?.alive) return false;
    const { gl, device } = renderer;
    const picTex = options.picture?.texture || renderer.blackTex;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.spare.framebuffer);
    gl.viewport(0, 0, renderer.width, renderer.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(device.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, device.quad);
    gl.enableVertexAttribArray(device.aPos);
    gl.vertexAttribPointer(device.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, picTex);
    gl.uniform1i(device.uPic, 0);
    gl.uniform1f(device.uHasPic, options.picture?.texture ? 1 : 0);
    gl.uniform1f(device.uWidth, Number(options.width) || 0);
    gl.uniform1f(device.uHeight, Number(options.height) || 0);
    gl.uniform1f(device.uRound, Number(options.round) || 0);
    gl.uniform1f(device.uVignette, Number(options.vignette) || 0);
    gl.uniform1f(device.uGlare, Number(options.glare) || 0);
    gl.uniform2f(device.uGlarePos, Number(options.glareX) || 0, Number(options.glareY) || 0);
    gl.uniform1f(device.uGlareSize, Number(options.glareSize) || 0);
    gl.uniform1f(device.uVigReach, Number(options.vigReach) || 0);
    gl.uniform1f(device.uVigCurve, Number(options.vigCurve) || 0);
    gl.uniform1f(device.uVigShape, Number.isFinite(Number(options.vigShape)) ? Number(options.vigShape) : 1);
    gl.uniform1f(device.uShadowAlpha, Number(options.shadowAlpha) || 0);
    gl.uniform1f(device.uShadowThick, Number.isFinite(Number(options.shadowThick)) ? Number(options.shadowThick) : 0.3);
    gl.uniform2f(
      device.uAspectScale,
      Math.min(1, renderer.height / renderer.width),
      Math.min(1, renderer.width / renderer.height),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
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

  global.nodeGraphScreenBendGlEnsure = ensureRenderer;
  global.nodeGraphScreenBendGlDispose = disposeRenderer;
  global.nodeGraphScreenBendGlWipe = wipeRenderer;
  global.nodeGraphScreenBendGlStep = step;
  global.nodeGraphScreenBendGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
