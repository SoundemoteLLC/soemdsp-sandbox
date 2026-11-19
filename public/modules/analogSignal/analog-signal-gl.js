const NODE_GRAPH_ANALOG_SIGNAL_GL_REV = 1;
const NODE_GRAPH_ANALOG_SIGNAL_MAX = 4096;

(function initNodeGraphAnalogSignalGl(global) {
  const KEY = "_analogSignalGl";
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

  // Analog Signal: what an analog video signal does to a picture before the tube.
  //   Jitter    each scanline (240 across the picture) lands a little left or right. The offset is correlated: a smooth drift across
  //             the lines and through time (neighbouring lines move together), blended toward an independent value per line by Roughness
  //   Wobble    a slow sideways sway down the picture
  //   Ringing   faint echoes trailing sharp edges in the direction of the Ring X / Y pad (alternating sign, as a rung cable overshoots)
  //   Bleed     a sideways smear (limited bandwidth)
  //   Noise     a light grain (the streaky static, dropouts and glitches are the Analog Glitch module's)
  // Each effect has its own phase (uJA / uJB / uJTick jitter, uWAng wobble) so each has its own speed. Horizontal only, so vertical
  // resolution and the picture's rows stay as they are.
  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform float uHasPic;
    uniform float uJitter;
    uniform float uRough;
    uniform float uWobble;
    uniform float uNoise;
    uniform float uRinging;
    uniform float uBleed;
    uniform vec2 uJA;
    uniform vec2 uJB;
    uniform float uJTick;
    uniform vec2 uWAng;
    uniform vec2 uRingDir;
    uniform float uTick;
    uniform vec2 uSize;

    float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
    float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    // Smooth value noise in -1..1 (a new random value at every whole number, blended with a cubic ease). The coordinate is base + a
    // phase that arrives split into a whole part and a fraction, so it stays exact however far the phase has run.
    float vnoise(float base, vec2 phase) {
      float s = base + phase.y;
      float i = floor(s) + phase.x;
      float f = fract(s);
      f = f * f * (3.0 - 2.0 * f);
      return mix(hash11(i), hash11(i + 1.0), f) * 2.0 - 1.0;
    }

    vec3 pic(vec2 uv) {
      if (uHasPic < 0.5) return vec3(0.0);
      vec4 t = texture2D(uPic, vec2(clamp(uv.x, 0.0, 1.0), clamp(uv.y, 0.0, 1.0)));
      return t.a > 1e-4 ? t.rgb / t.a : vec3(0.0);
    }

    void main() {
      vec2 uv = vUv;
      float line = floor(uv.y * 240.0);
      // Jitter: smooth across ~22 lines (and a finer layer across ~5), drifting with the jitter phase; Roughness blends toward an
      // independent random value per line that re-rolls with the phase.
      float smoothJ = vnoise(line / 22.0, uJA) * 0.7 + vnoise(line / 5.0, uJB) * 0.3;
      float roughJ = hash11(line * 13.7 + uJTick * 7.13) * 2.0 - 1.0;
      float shift = mix(smoothJ * 1.5, roughJ, clamp(uRough, 0.0, 1.0)) * uJitter * 0.012;
      shift += sin(uv.y * 8.0 + uWAng.x) * uWobble * 0.015 * (0.65 + 0.35 * sin(uWAng.y));
      uv.x += shift;

      // Bleed: a horizontal smear of up to ~10 px. Ringing: alternating echoes to the right of the edge.
      float px = 1.0 / max(uSize.x, 1.0);
      float b = uBleed * 5.0 * px;
      vec3 col = pic(uv);
      if (uBleed > 0.002) {
        col = col * 0.34 + (pic(uv - vec2(b, 0.0)) + pic(uv + vec2(b, 0.0))) * 0.2 + (pic(uv - vec2(2.0 * b, 0.0)) + pic(uv + vec2(2.0 * b, 0.0))) * 0.13;
      }
      if (uRinging > 0.002) {
        // The echoes trail along the Ring X / Y direction (X = 1, Y = 0 is to the right of an edge); the vector's length is the spacing.
        vec2 d = uRingDir * 3.0 * vec2(px, 1.0 / max(uSize.y, 1.0));
        col += uRinging * (0.42 * pic(uv - d) - 0.26 * pic(uv - 2.0 * d) + 0.15 * pic(uv - 3.0 * d) - 0.08 * pic(uv - 4.0 * d))
               - uRinging * 0.23 * pic(uv);
      }
      // Light grain: a new pattern each tick.
      float grain = hash21(gl_FragCoord.xy + vec2(uTick * 17.0, uTick * 31.0)) - 0.5;
      col += grain * uNoise * 0.35;
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "analog-signal-gl.js");
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
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_ANALOG_SIGNAL_GL_REV) {
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
      rev: NODE_GRAPH_ANALOG_SIGNAL_GL_REV,
      gl,
      quad: SoemGl.quad(gl),
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uJitter: gl.getUniformLocation(program, "uJitter"),
      uRough: gl.getUniformLocation(program, "uRough"),
      uWobble: gl.getUniformLocation(program, "uWobble"),
      uNoise: gl.getUniformLocation(program, "uNoise"),
      uRinging: gl.getUniformLocation(program, "uRinging"),
      uBleed: gl.getUniformLocation(program, "uBleed"),
      uJA: gl.getUniformLocation(program, "uJA"),
      uJB: gl.getUniformLocation(program, "uJB"),
      uJTick: gl.getUniformLocation(program, "uJTick"),
      uWAng: gl.getUniformLocation(program, "uWAng"),
      uRingDir: gl.getUniformLocation(program, "uRingDir"),
      uTick: gl.getUniformLocation(program, "uTick"),
      uSize: gl.getUniformLocation(program, "uSize"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Analog Signal: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_ANALOG_SIGNAL_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_ANALOG_SIGNAL_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_ANALOG_SIGNAL_GL_REV) {
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
      reportFailure(host, "Analog Signal: framebuffer incomplete");
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
      rev: NODE_GRAPH_ANALOG_SIGNAL_GL_REV,
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
    gl.uniform1f(device.uJitter, Number(options.jitter) || 0);
    gl.uniform1f(device.uRough, Number(options.roughness) || 0);
    gl.uniform1f(device.uWobble, Number(options.wobble) || 0);
    gl.uniform1f(device.uNoise, Number(options.noise) || 0);
    gl.uniform1f(device.uRinging, Number(options.ringing) || 0);
    gl.uniform1f(device.uBleed, Number(options.bleed) || 0);
    const pair = (v) => (Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0] : [0, 0]);
    const ja = pair(options.jA);
    const jb = pair(options.jB);
    gl.uniform2f(device.uJA, ja[0], ja[1]);
    gl.uniform2f(device.uJB, jb[0], jb[1]);
    gl.uniform1f(device.uJTick, Number(options.jTick) || 0);
    const wa = Array.isArray(options.wAng) ? options.wAng : [0, 0];
    gl.uniform2f(device.uWAng, Number(wa[0]) || 0, Number(wa[1]) || 0);
    gl.uniform2f(device.uRingDir, Number.isFinite(Number(options.ringX)) ? Number(options.ringX) : 1, Number(options.ringY) || 0);
    gl.uniform1f(device.uTick, Number(options.tick) || 0);
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

  global.nodeGraphAnalogSignalGlEnsure = ensureRenderer;
  global.nodeGraphAnalogSignalGlDispose = disposeRenderer;
  global.nodeGraphAnalogSignalGlWipe = wipeRenderer;
  global.nodeGraphAnalogSignalGlStep = step;
  global.nodeGraphAnalogSignalGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
