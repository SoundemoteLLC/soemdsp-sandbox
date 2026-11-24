const NODE_GRAPH_CHROMA_COLOR_GL_REV = 1;
const NODE_GRAPH_CHROMA_COLOR_MAX = 4096;

(function initNodeGraphChromaColorGl(global) {
  const KEY = "_chromaColorGl";
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

  // Chroma Color: one pass of colour grading, in this order:
  //   1. hue: the whole picture's colours turned around the wheel (uHue, plus the drifting phase uDrift, plus the Spread gradient across the picture)
  //   2. channel gains (uGain), saturation (chroma about the pixel's grey), contrast (about mid grey), gamma (midtones, black and white held)
  //   3. lightness (toward white when positive, toward black when negative), the tint (a wash of one colour), invert
  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform float uHasPic;
    uniform vec3 uGain;
    uniform float uHue;
    uniform float uSat;
    uniform float uLight;
    uniform float uContrast;
    uniform float uGamma;
    uniform float uTintHue;
    uniform float uTint;
    uniform float uInvert;
    uniform float uSpread;
    uniform float uDrift;

    vec3 hueTurn(vec3 c, float turns) {
      float a = turns * 6.28318530718;
      float cs = cos(a);
      float sn = sin(a);
      vec3 k = vec3(0.57735026919);
      return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
    }
    // A fully saturated colour for a position on the wheel (0..1).
    vec3 wheel(float h) {
      vec3 r = abs(fract(vec3(h) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0;
      return clamp(r, 0.0, 1.0);
    }

    void main() {
      vec3 col = vec3(0.0);
      if (uHasPic > 0.5) {
        vec4 t = texture2D(uPic, vUv);
        col = t.a > 1e-4 ? t.rgb / t.a : vec3(0.0);
      }
      // Hue: the base turn, the drift, and a gradient across the picture.
      float turns = uHue + uDrift + uSpread * (vUv.x + vUv.y - 1.0) * 0.5;
      col = hueTurn(col, turns);
      col *= uGain;
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      float satMul = uSat >= 0.0 ? 1.0 + uSat * 2.0 : 1.0 + uSat;
      col = vec3(luma) + (col - vec3(luma)) * satMul;
      float cMul = uContrast >= 0.0 ? 1.0 + uContrast * 2.0 : 1.0 + uContrast;
      col = (col - 0.5) * cMul + 0.5;
      col = pow(max(col, vec3(0.0)), vec3(1.0 / max(uGamma, 0.05)));
      col = uLight >= 0.0 ? mix(col, vec3(1.0), uLight) : col * (1.0 + uLight);
      if (uTint > 0.002) col *= mix(vec3(1.0), wheel(uTintHue) * 1.6 + 0.1, uTint);
      col = mix(col, 1.0 - col, uInvert);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "chroma-color-gl.js");
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
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_CHROMA_COLOR_GL_REV) {
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
      rev: NODE_GRAPH_CHROMA_COLOR_GL_REV,
      gl,
      quad: SoemGl.quad(gl),
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uGain: gl.getUniformLocation(program, "uGain"),
      uHue: gl.getUniformLocation(program, "uHue"),
      uSat: gl.getUniformLocation(program, "uSat"),
      uLight: gl.getUniformLocation(program, "uLight"),
      uContrast: gl.getUniformLocation(program, "uContrast"),
      uGamma: gl.getUniformLocation(program, "uGamma"),
      uTintHue: gl.getUniformLocation(program, "uTintHue"),
      uTint: gl.getUniformLocation(program, "uTint"),
      uInvert: gl.getUniformLocation(program, "uInvert"),
      uSpread: gl.getUniformLocation(program, "uSpread"),
      uDrift: gl.getUniformLocation(program, "uDrift"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Chroma Color: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_CHROMA_COLOR_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_CHROMA_COLOR_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_CHROMA_COLOR_GL_REV) {
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
      reportFailure(host, "Chroma Color: framebuffer incomplete");
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
      rev: NODE_GRAPH_CHROMA_COLOR_GL_REV,
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
    gl.uniform3f(device.uGain, Number(options.red) ?? 1, Number(options.green) ?? 1, Number(options.blue) ?? 1);
    gl.uniform1f(device.uHue, Number(options.hue) || 0);
    gl.uniform1f(device.uSat, Number(options.saturation) || 0);
    gl.uniform1f(device.uLight, Number(options.lightness) || 0);
    gl.uniform1f(device.uContrast, Number(options.contrast) || 0);
    gl.uniform1f(device.uGamma, Number.isFinite(Number(options.gamma)) ? Number(options.gamma) : 1);
    gl.uniform1f(device.uTintHue, Number(options.tintHue) || 0);
    gl.uniform1f(device.uTint, Number(options.tint) || 0);
    gl.uniform1f(device.uInvert, Number(options.invert) || 0);
    gl.uniform1f(device.uSpread, Number(options.spread) || 0);
    gl.uniform1f(device.uDrift, Number(options.drift) || 0);
    gl.uniform2f(device.uSize, renderer.width, renderer.height);
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

  global.nodeGraphChromaColorGlEnsure = ensureRenderer;
  global.nodeGraphChromaColorGlDispose = disposeRenderer;
  global.nodeGraphChromaColorGlWipe = wipeRenderer;
  global.nodeGraphChromaColorGlStep = step;
  global.nodeGraphChromaColorGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
