const NODE_GRAPH_KALEIDOSCOPE_GL_REV = 1;
const NODE_GRAPH_KALEIDOSCOPE_MAX = 4096;

(function initNodeGraphKaleidoscopeGl(global) {
  const KEY = "_kaleidoscopeGl";
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

  // Kaleidoscope with feedback, one pass:
  //   1. The pixel's coordinate is FOLDED into one wedge around the centre (uSegments wedges; Mirror reflects every other wedge, Rotate
  //      repeats the wedge; uAngle turns it), so the output is symmetric by construction.
  //   2. The incoming picture is sampled at the folded coordinate, and so is the module's previous output, transformed by the per-frame
  //      step (scale about the centre, turn, shift): the previous picture comes back zoomed / turned / shifted, folded again, every frame.
  //   3. The previous output is softened (uBlur), its colours turned (uHue, per frame) and faded by uDecay, then combined with the new picture
  //      (uBlend: Screen, Add, Max or Over; the picture itself is looked at through uSrcZoom / uSrcOff), with about one 8-bit step of
  //      noise before the result is stored: rounding to 8 bits alone would leave dim values stuck instead of fading out; noise rounds them
  //      up or down at random, so on average they decay as they should.
  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform sampler2D uPrev;
    uniform float uHasPic;
    uniform float uSegments;
    uniform float uAngle;
    uniform float uMirror;
    uniform vec2 uCenter;
    uniform float uInput;
    uniform float uDecay;
    uniform float uZoom;
    uniform float uRotate;
    uniform vec2 uShift;
    uniform float uBlend;
    uniform float uHue;
    uniform float uBlur;
    uniform float uSat;
    uniform float uPunch;
    uniform vec2 uSrcOff;
    uniform float uSrcZoom;
    uniform float uFrame;
    uniform vec2 uSize;

    float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    vec3 pic(vec2 uv) {
      if (uHasPic < 0.5) return vec3(0.0);
      vec4 t = texture2D(uPic, clamp(uv, 0.0, 1.0));
      return t.a > 1e-4 ? t.rgb / t.a : vec3(0.0);
    }

    // Turn a colour about the grey axis by "turns" of a full turn (the same rotation every picture module uses for hue).
    vec3 hueTurn(vec3 c, float turns) {
      float a = turns * 6.28318530718;
      float cs = cos(a);
      float sn = sin(a);
      vec3 k = vec3(0.57735026919);
      return c * cs + cross(k, c) * sn + k * dot(k, c) * (1.0 - cs);
    }

    void main() {
      float aspect = uSize.x / max(uSize.y, 1.0);
      // The fold (in aspect-corrected coordinates, centre at the origin).
      vec2 p = (vUv - uCenter) * vec2(aspect, 1.0);
      float r = length(p);
      float wedge = 6.28318530718 / max(uSegments, 2.0);
      float th = atan(p.y, p.x) - uAngle;
      th = mod(th, wedge);
      if (uMirror < 0.5) th = abs(th - 0.5 * wedge) ;
      th += uAngle;
      vec2 f = vec2(cos(th), sin(th)) * r;
      // Which part of the incoming picture the wedge looks at: a zoom about the centre and a slide.
      vec2 q = (f / max(uSrcZoom, 0.05)) / vec2(aspect, 1.0) + uCenter + uSrcOff * 0.5;
      // The previous output, stepped: scaled about the centre, turned, shifted (per frame).
      float cs = cos(uRotate);
      float sn = sin(uRotate);
      vec2 fp = f / uZoom;
      fp = vec2(cs * fp.x - sn * fp.y, sn * fp.x + cs * fp.y);
      vec2 qp = fp / vec2(aspect, 1.0) + uCenter + uShift;
      vec3 src = clamp(pic(q) * uInput, 0.0, 1.0);
      vec3 prev = texture2D(uPrev, clamp(qp, 0.0, 1.0)).rgb;
      if (uBlur > 0.002) {
        // A cross of taps around the sample: the previous frame softens a little more every frame.
        vec2 b = uBlur * 2.5 / uSize;
        prev = prev * 0.4 + 0.15 * (texture2D(uPrev, clamp(qp + vec2(b.x, 0.0), 0.0, 1.0)).rgb + texture2D(uPrev, clamp(qp - vec2(b.x, 0.0), 0.0, 1.0)).rgb
          + texture2D(uPrev, clamp(qp + vec2(0.0, b.y), 0.0, 1.0)).rgb + texture2D(uPrev, clamp(qp - vec2(0.0, b.y), 0.0, 1.0)).rgb);
      }
      if (abs(uHue) > 1e-5) prev = hueTurn(prev, uHue);
      // Punch: a contrast curve on the fed-back picture (dim mixes fade faster, bright cores stay).
      prev = pow(clamp(prev, 0.0, 1.0), vec3(1.0 + uPunch * 1.5));
      prev = clamp(prev * uDecay, 0.0, 1.0);
      vec3 col;
      if (uBlend < 0.5) col = 1.0 - (1.0 - src) * (1.0 - prev);                   // Screen
      else if (uBlend < 1.5) col = src + prev;                                     // Add
      else if (uBlend < 2.5) col = max(src, prev);                                 // Max
      else col = src + prev * (1.0 - clamp(max(src.r, max(src.g, src.b)), 0.0, 1.0)); // Over: the picture covers what it is bright over
      col = clamp(col, 0.0, 1.0);
      // Saturation: the chroma around the grey of each pixel is scaled every frame, so it compounds through the feedback.
      float luma = dot(col, vec3(0.299, 0.587, 0.114));
      col = clamp(vec3(luma) + (col - vec3(luma)) * (1.0 + uSat * 0.35), 0.0, 1.0);
      float n = hash21(gl_FragCoord.xy + vec2(uFrame * 13.0, uFrame * 29.0)) - 0.5;
      col += n / 255.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "kaleidoscope-gl.js");
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
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_KALEIDOSCOPE_GL_REV) {
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
      rev: NODE_GRAPH_KALEIDOSCOPE_GL_REV,
      gl,
      quad: SoemGl.quad(gl),
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uPrev: gl.getUniformLocation(program, "uPrev"),
      uSegments: gl.getUniformLocation(program, "uSegments"),
      uAngle: gl.getUniformLocation(program, "uAngle"),
      uMirror: gl.getUniformLocation(program, "uMirror"),
      uCenter: gl.getUniformLocation(program, "uCenter"),
      uInput: gl.getUniformLocation(program, "uInput"),
      uDecay: gl.getUniformLocation(program, "uDecay"),
      uZoom: gl.getUniformLocation(program, "uZoom"),
      uRotate: gl.getUniformLocation(program, "uRotate"),
      uShift: gl.getUniformLocation(program, "uShift"),
      uBlend: gl.getUniformLocation(program, "uBlend"),
      uHue: gl.getUniformLocation(program, "uHue"),
      uBlur: gl.getUniformLocation(program, "uBlur"),
      uSat: gl.getUniformLocation(program, "uSat"),
      uPunch: gl.getUniformLocation(program, "uPunch"),
      uSrcOff: gl.getUniformLocation(program, "uSrcOff"),
      uSrcZoom: gl.getUniformLocation(program, "uSrcZoom"),
      uFrame: gl.getUniformLocation(program, "uFrame"),
      uSize: gl.getUniformLocation(program, "uSize"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Kaleidoscope: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_KALEIDOSCOPE_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_KALEIDOSCOPE_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_KALEIDOSCOPE_GL_REV) {
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
      reportFailure(host, "Kaleidoscope: framebuffer incomplete");
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
      rev: NODE_GRAPH_KALEIDOSCOPE_GL_REV,
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
    // The previous output is the other half of the ping-pong pair: read from the shown surface, write the spare, swap.
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, renderer.shown.texture);
    gl.uniform1i(device.uPrev, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(device.uSegments, Math.max(2, Number(options.segments) || 6));
    gl.uniform1f(device.uAngle, Number(options.angle) || 0);
    gl.uniform1f(device.uMirror, options.mirror ? 1 : 0);
    // The XY pad is -1 .. 1; the centre is that point of the picture (0 .. 1).
    gl.uniform2f(device.uCenter, (Number(options.centerX) || 0) * 0.5 + 0.5, (Number(options.centerY) || 0) * 0.5 + 0.5);
    gl.uniform1f(device.uInput, Number.isFinite(Number(options.input)) ? Number(options.input) : 1);
    gl.uniform1f(device.uDecay, Number(options.decay) || 0);
    gl.uniform1f(device.uZoom, Math.max(0.5, Number(options.zoom) || 1));
    gl.uniform1f(device.uRotate, Number(options.rotate) || 0);
    gl.uniform2f(device.uShift, Number(options.shiftX) || 0, Number(options.shiftY) || 0);
    gl.uniform1f(device.uBlend, Number(options.blend) || 0);
    gl.uniform1f(device.uHue, Number(options.hue) || 0);
    gl.uniform1f(device.uBlur, Number(options.blur) || 0);
    gl.uniform1f(device.uSat, Number(options.saturation) || 0);
    gl.uniform1f(device.uPunch, Number(options.punch) || 0);
    gl.uniform2f(device.uSrcOff, Number(options.srcX) || 0, Number(options.srcY) || 0);
    gl.uniform1f(device.uSrcZoom, Number.isFinite(Number(options.srcZoom)) ? Number(options.srcZoom) : 1);
    gl.uniform1f(device.uFrame, Number(options.frame) || 0);
    gl.uniform2f(device.uSize, renderer.width, renderer.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
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

  global.nodeGraphKaleidoscopeGlEnsure = ensureRenderer;
  global.nodeGraphKaleidoscopeGlDispose = disposeRenderer;
  global.nodeGraphKaleidoscopeGlWipe = wipeRenderer;
  global.nodeGraphKaleidoscopeGlStep = step;
  global.nodeGraphKaleidoscopeGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
