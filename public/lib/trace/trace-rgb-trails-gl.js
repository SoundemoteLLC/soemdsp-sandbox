// RGB DestFade trails — phosphor STEP_FRAG dual residual in RGB.
// Shared picture-device context (no per-face WebGL). Hot = Trail keepFast;
// Ghost = max(min(prev*keepSlow, cap), hot). Additive RGB point stamps.
// Canvas2D DestFade remains the fallback when this device is unavailable.

(function initTraceRgbTrailsGl(global) {
  const KEY = "_traceRgbTrailsGl";
  const REV = 1;
  let shared = null;

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  // RGB dual residual (matches PhosphorResidual / mono STEP_FRAG intent).
  const STEP_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPrev;
    uniform float uKeepFast;
    uniform float uKeepSlow;
    uniform float uFrames;
    uniform vec3 uPlate;
    void main() {
      vec3 prev = texture2D(uPrev, vUv).rgb;
      // Hot relative to plate so plate colour doesn't bleach the trail.
      vec3 hot = max(prev - uPlate, 0.0);
      float keepFast = clamp(uKeepFast, 0.0, 1.0);
      float keepSlow = max(keepFast, clamp(uKeepSlow, 0.0, 0.9998));
      // two-component decay (monotone): the first 0.5 of energy is the dim tail (Ghost rate), only the energy above it is hot
      // (Trail rate). The old per-pixel blend of the two rates made a full-energy pixel decay at the Trail rate alone, so with
      // Trail below Ghost hot pixels vanished while dimmer neighbours kept a tail: dark holes inside bright areas. With Trail
      // >= Ghost the two rates are equal and the result is identical to before.
      float frames = max(uFrames, 0.0);
      float tailDecay = frames > 0.0 ? pow(keepSlow, frames) : 1.0;
      float hotDecay = frames > 0.0 ? pow(keepFast, frames) : 1.0;
      vec3 e = min(hot, vec3(0.5)) * tailDecay + max(hot - vec3(0.5), vec3(0.0)) * hotDecay;
      gl_FragColor = vec4(uPlate + e, 1.0);
    }
  `;

  // Decay blur: the same fade with a 3x3 diffusion of the stored picture first. A SEPARATE program, compiled the first time a face
  // asks for a bleed and used only while it is above 0, so Decay 0 (the default) costs nothing.
  const STEP_FRAG_BLEED = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPrev;
    uniform float uKeepFast;
    uniform float uKeepSlow;
    uniform float uFrames;
    uniform vec3 uPlate;
    uniform vec2 uTexel;
    uniform float uBleed;
    void main() {
      vec3 c0 = texture2D(uPrev, vUv).rgb;
      vec3 s = texture2D(uPrev, vUv + vec2( uTexel.x, 0.0)).rgb + texture2D(uPrev, vUv + vec2(-uTexel.x, 0.0)).rgb
             + texture2D(uPrev, vUv + vec2(0.0,  uTexel.y)).rgb + texture2D(uPrev, vUv + vec2(0.0, -uTexel.y)).rgb;
      vec3 k = texture2D(uPrev, vUv + vec2( uTexel.x,  uTexel.y)).rgb + texture2D(uPrev, vUv + vec2(-uTexel.x,  uTexel.y)).rgb
             + texture2D(uPrev, vUv + vec2( uTexel.x, -uTexel.y)).rgb + texture2D(uPrev, vUv + vec2(-uTexel.x, -uTexel.y)).rgb;
      vec3 prev = mix(c0, (c0 * 4.0 + s * 2.0 + k) / 16.0, clamp(uBleed, 0.0, 1.0));
      vec3 hot = max(prev - uPlate, 0.0);
      float keepFast = clamp(uKeepFast, 0.0, 1.0);
      float keepSlow = max(keepFast, clamp(uKeepSlow, 0.0, 0.9998));
      float frames = max(uFrames, 0.0);
      float tailDecay = frames > 0.0 ? pow(keepSlow, frames) : 1.0;
      float hotDecay = frames > 0.0 ? pow(keepFast, frames) : 1.0;
      vec3 e = min(hot, vec3(0.5)) * tailDecay + max(hot - vec3(0.5), vec3(0.0)) * hotDecay;
      gl_FragColor = vec4(uPlate + e, 1.0);
    }
  `;

  const COPY_FRAG = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uTexture;
    void main() {
      gl_FragColor = texture2D(uTexture, vUv);
    }
  `;

  const POINT_VS = `
    precision mediump float;
    uniform vec2 uCanvas;
    uniform float uSize;
    attribute vec2 aPos;
    attribute vec3 aRgb;
    varying vec3 vRgb;
    void main() {
      vRgb = aRgb;
      vec2 ndc = vec2(
        (aPos.x / max(uCanvas.x, 1.0)) * 2.0 - 1.0,
        1.0 - (aPos.y / max(uCanvas.y, 1.0)) * 2.0
      );
      gl_Position = vec4(ndc, 0.0, 1.0);
      gl_PointSize = max(1.0, uSize);
    }
  `;

  const POINT_FS = `
    precision mediump float;
    varying vec3 vRgb;
    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float d2 = dot(p, p);
      if (d2 > 1.0) discard;
      float a = exp(-d2 * 2.2);
      gl_FragColor = vec4(vRgb * a, a);
    }
  `;

  const PRESENT_FRAG = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uPlate;
    void main() {
      gl_FragColor = texture2D(uPlate, vUv);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "trace-rgb-trails-gl.js");
  }

  function hexToRgb01(hex, fallback = [0, 0, 0]) {
    const color = typeof normalizeNodeGraphTraceDisplayColor === "function"
      ? normalizeNodeGraphTraceDisplayColor(hex, "#000000")
      : String(hex || "#000000");
    const m = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) return fallback;
    const n = Number.parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function textureFormats(gl) {
    // WebGL2 float formats; the WebGL1 OES half-float extension is null on
    // WebGL2, which left these trails rgba8 (sub-1/255 deposits lost).
    return global.SoemGl.energyFormats(gl, { blend: true });
  }

  function createSurface(gl, w, h, fmt) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, fmt.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, fmt.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (!ok) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      return null;
    }
    return { texture: tex, framebuffer: fbo, width: w, height: h };
  }

  function getShared() {
    if (shared?.gl && !shared.gl.isContextLost() && shared.rev === REV) return shared;
    shared = null;
    const picture = typeof nodeGraphPictureDevice === "function" ? nodeGraphPictureDevice() : null;
    if (!picture?.gl) return null;
    const gl = picture.gl;
    const step = link(gl, VERT, STEP_FRAG);
    const copy = link(gl, VERT, COPY_FRAG);
    const present = link(gl, VERT, PRESENT_FRAG);
    const points = link(gl, POINT_VS, POINT_FS);
    if (!step || !copy || !present || !points) return null;
    shared = {
      rev: REV,
      gl,
      canvas: picture.canvas,
      quad: picture.quad,
      step: {
        program: step,
        aPos: gl.getAttribLocation(step, "aPos"),
        uPrev: gl.getUniformLocation(step, "uPrev"),
        uKeepFast: gl.getUniformLocation(step, "uKeepFast"),
        uKeepSlow: gl.getUniformLocation(step, "uKeepSlow"),
        uFrames: gl.getUniformLocation(step, "uFrames"),
        uPlate: gl.getUniformLocation(step, "uPlate"),
      },
      copy: {
        program: copy,
        aPos: gl.getAttribLocation(copy, "aPos"),
        uTexture: gl.getUniformLocation(copy, "uTexture"),
      },
      present: {
        program: present,
        aPos: gl.getAttribLocation(present, "aPos"),
        uPlate: gl.getUniformLocation(present, "uPlate"),
      },
      points: {
        program: points,
        aPos: gl.getAttribLocation(points, "aPos"),
        aRgb: gl.getAttribLocation(points, "aRgb"),
        uCanvas: gl.getUniformLocation(points, "uCanvas"),
        uSize: gl.getUniformLocation(points, "uSize"),
        buf: gl.createBuffer(),
        scratch: new Float32Array(8192 * 5),
      },
    };
    return shared;
  }

  function bindQuad(gl, loc, quad) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  function ensure(host, width, height) {
    if (!host) return null;
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    const device = getShared();
    if (!device) return null;
    let state = host[KEY];
    if (state?.alive && state.width === w && state.height === h && state.device === device) {
      return state;
    }
    if (state) destroy(host);
    const gl = device.gl;
    let read = null;
    let write = null;
    let fmtLabel = "";
    for (const fmt of textureFormats(gl)) {
      read = createSurface(gl, w, h, fmt);
      write = createSurface(gl, w, h, fmt);
      if (read && write) {
        fmtLabel = fmt.label;
        break;
      }
      if (read) {
        gl.deleteFramebuffer(read.framebuffer);
        gl.deleteTexture(read.texture);
      }
      if (write) {
        gl.deleteFramebuffer(write.framebuffer);
        gl.deleteTexture(write.texture);
      }
      read = write = null;
    }
    if (!read || !write) return null;
    // Clear to black plate.
    for (const s of [read, write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.framebuffer);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    state = {
      alive: true,
      device,
      width: w,
      height: h,
      read,
      write,
      fmtLabel,
      frame: 0,
    };
    host[KEY] = state;
    return state;
  }

  function destroy(host) {
    const state = host?.[KEY];
    if (!state) return;
    const gl = state.device?.gl;
    if (gl) {
      for (const s of [state.read, state.write]) {
        if (!s) continue;
        if (s.framebuffer) gl.deleteFramebuffer(s.framebuffer);
        if (s.texture) gl.deleteTexture(s.texture);
      }
    }
    host[KEY] = null;
  }

  function swap(state) {
    const t = state.read;
    state.read = state.write;
    state.write = t;
  }

  function ensureBleedStep(device) {
    if (device.stepBleed !== undefined) return device.stepBleed;
    const gl = device.gl;
    const program = link(gl, VERT, STEP_FRAG_BLEED);
    device.stepBleed = program ? {
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPrev: gl.getUniformLocation(program, "uPrev"),
      uKeepFast: gl.getUniformLocation(program, "uKeepFast"),
      uKeepSlow: gl.getUniformLocation(program, "uKeepSlow"),
      uFrames: gl.getUniformLocation(program, "uFrames"),
      uPlate: gl.getUniformLocation(program, "uPlate"),
      uTexel: gl.getUniformLocation(program, "uTexel"),
      uBleed: gl.getUniformLocation(program, "uBleed"),
    } : null;
    return device.stepBleed;
  }

  function stepFade(host, trail, ghost, plateCss, bleed) {
    const state = host?.[KEY];
    if (!state?.alive) return false;
    const { gl, device } = { gl: state.device.gl, device: state.device };
    const keeps = global.PhosphorResidual.residualKeeps(trail, ghost);
    const plate = hexToRgb01(plateCss);
    // Decay blur 0 (the default) takes the plain program below, untouched.
    const bleedAmt = Number.isFinite(Number(bleed)) ? Math.max(0, Math.min(1, Number(bleed))) : 0;
    const bleedStep = bleedAmt > 0.0001 ? ensureBleedStep(device) : null;
    const prog = bleedStep || device.step;
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.write.framebuffer);
    gl.viewport(0, 0, state.width, state.height);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.program);
    bindQuad(gl, prog.aPos, device.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.read.texture);
    gl.uniform1i(prog.uPrev, 0);
    gl.uniform1f(prog.uKeepFast, keeps.keepFast);
    gl.uniform1f(prog.uKeepSlow, keeps.keepSlow);
    gl.uniform1f(prog.uFrames, global.PhosphorResidual.stepFrames(state));
    gl.uniform3f(prog.uPlate, plate[0], plate[1], plate[2]);
    if (bleedStep) {
      gl.uniform2f(bleedStep.uTexel, 1 / state.width, 1 / state.height);
      gl.uniform1f(bleedStep.uBleed, bleedAmt);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    swap(state);
    state.frame += 1;
    return true;
  }

  /** options.max: Build up off, a pixel takes the brightest stamp (MAX blend) instead of adding them up. */
  function stampPoints(host, packed, count, sizePx, options) {
    const state = host?.[KEY];
    if (!state?.alive || !packed || !(count > 0)) return false;
    const device = state.device;
    const gl = device.gl;
    const n = Math.max(0, Math.floor(count));
    const FLOATS = 5;
    const BATCH = 8192;
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.read.framebuffer);
    gl.viewport(0, 0, state.width, state.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(options?.max ? gl.MAX : gl.FUNC_ADD);
    gl.useProgram(device.points.program);
    gl.uniform2f(device.points.uCanvas, state.width, state.height);
    gl.uniform1f(device.points.uSize, Math.max(1, Number(sizePx) || 2));
    gl.bindBuffer(gl.ARRAY_BUFFER, device.points.buf);
    gl.enableVertexAttribArray(device.points.aPos);
    gl.enableVertexAttribArray(device.points.aRgb);
    gl.vertexAttribPointer(device.points.aPos, 2, gl.FLOAT, false, FLOATS * 4, 0);
    gl.vertexAttribPointer(device.points.aRgb, 3, gl.FLOAT, false, FLOATS * 4, 8);
    let offset = 0;
    while (offset < n) {
      const take = Math.min(BATCH, n - offset);
      const floats = take * FLOATS;
      const srcStart = offset * FLOATS;
      device.points.scratch.set(packed.subarray(srcStart, srcStart + floats), 0);
      gl.bufferData(gl.ARRAY_BUFFER, device.points.scratch.subarray(0, floats), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, take);
      offset += take;
    }
    gl.disableVertexAttribArray(device.points.aPos);
    gl.disableVertexAttribArray(device.points.aRgb);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  function presentTo(host, destCtx, plateCss) {
    const state = host?.[KEY];
    if (!state?.alive || !destCtx) return false;
    const device = state.device;
    const gl = device.gl;
    const rw = state.width;
    const rh = state.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, rw, rh);
    gl.scissor(0, 0, rw, rh);
    gl.enable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(device.present.program);
    bindQuad(gl, device.present.aPos, device.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.read.texture);
    gl.uniform1i(device.present.uPlate, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.SCISSOR_TEST);
    // Opaque plate texture: the shared display-canvas blit (nearest) replaces the face.
    const srcY = Math.max(0, device.canvas.height - rh);
    return nodeGraphSharedGlCopyToContext(
      destCtx, 0, srcY, rw, rh, 0, 0, destCtx.canvas.width, destCtx.canvas.height, false,
    );
  }

  function clear(host, plateCss) {
    const state = host?.[KEY];
    if (!state?.alive) return false;
    const gl = state.device.gl;
    const plate = hexToRgb01(plateCss);
    for (const s of [state.read, state.write]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.framebuffer);
      gl.viewport(0, 0, state.width, state.height);
      gl.clearColor(plate[0], plate[1], plate[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  global.TraceRgbTrailsGl = {
    ensure,
    destroy,
    stepFade,
    stampPoints,
    presentTo,
    clear,
    available: () => Boolean(getShared()),
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
