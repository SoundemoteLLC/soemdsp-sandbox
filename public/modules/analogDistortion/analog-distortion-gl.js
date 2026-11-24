const NODE_GRAPH_ANALOG_DISTORTION_GL_REV = 1;
const NODE_GRAPH_ANALOG_DISTORTION_MAX = 4096;

(function initNodeGraphAnalogDistortionGl(global) {
  const KEY = "_analogDistortionGl";
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

  // Analog Distortion: hum bars and a magnet.
  //   Hum bars   uBars dark bars across the picture at position uHP (0..1 up the picture, a phase), uWidth wide, uHum dark (1 is black)
  //   Wiggle     a sideways sin ripple where a bar passes (the bar is its envelope, so it works with Hum at 0); uWig is its angle
  //   Magnet     at uMag: a bulge / pinch (uPull), a swirl (uSwirl) and a colour stain (uPurity: red, green and blue are warped by
  //              different amounts, so they pull apart around it), all inside a gaussian field of radius uMagSize
  const FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uPic;
    uniform float uHasPic;
    uniform float uHum;
    uniform float uBars;
    uniform float uWidth;
    uniform float uHP;
    uniform float uWiggle;
    uniform float uWig;
    uniform float uMagnet;
    uniform vec2 uMag;
    uniform float uPull;
    uniform float uSwirl;
    uniform float uMagSize;
    uniform float uPurity;
    uniform vec2 uSize;

    vec3 pic(vec2 uv) {
      if (uHasPic < 0.5) return vec3(0.0);
      vec4 t = texture2D(uPic, vec2(clamp(uv.x, 0.0, 1.0), clamp(uv.y, 0.0, 1.0)));
      return t.a > 1e-4 ? t.rgb / t.a : vec3(0.0);
    }

    // Where a point of the picture is sampled from under the magnet; k scales the field for this colour channel.
    vec2 warp(vec2 uv, float k) {
      float aspect = uSize.x / max(uSize.y, 1.0);
      vec2 p = uv - uMag;
      vec2 pa = vec2(p.x * aspect, p.y);
      float sz = max(uMagSize * 0.6, 0.02);
      float fall = exp(-dot(pa, pa) / (sz * sz)) * clamp(uMagnet, 0.0, 1.0) * k;
      float ang = uSwirl * fall * 4.0;
      float cs = cos(ang);
      float sn = sin(ang);
      pa = vec2(cs * pa.x - sn * pa.y, sn * pa.x + cs * pa.y);
      // Positive Pull samples nearer the magnet (the picture bulges out), negative farther (it pinches in).
      pa *= 1.0 - 0.7 * uPull * fall;
      return uMag + vec2(pa.x / aspect, pa.y);
    }

    void main() {
      vec2 uv = vUv;
      // Hum bars: distance (in picture heights) to the nearest bar's middle; the bars repeat every 1 / uBars.
      float dy = abs(fract((uv.y - uHP) * uBars + 0.5) - 0.5) / max(uBars, 0.01);
      float w = mix(0.012, 0.16, uWidth) / max(uBars, 0.5);
      float bar = smoothstep(w, 0.0, dy);
      uv.x += bar * uWiggle * 0.012 * sin(uv.y * 60.0 + uWig);
      vec3 col;
      if (uMagnet > 0.002) {
        float s = uPurity * 0.4;
        col = vec3(pic(warp(uv, 1.0 + s)).r, pic(warp(uv, 1.0)).g, pic(warp(uv, 1.0 - s)).b);
      } else {
        col = pic(uv);
      }
      col *= 1.0 - clamp(uHum, 0.0, 1.0) * bar;
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }
  `;

  function link(gl, vsSrc, fsSrc) {
    return SoemGl.link(gl, vsSrc, fsSrc, "analog-distortion-gl.js");
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
    if (sharedDevice?.gl && !sharedDevice.gl.isContextLost() && sharedDevice.rev === NODE_GRAPH_ANALOG_DISTORTION_GL_REV) {
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
      rev: NODE_GRAPH_ANALOG_DISTORTION_GL_REV,
      gl,
      quad: SoemGl.quad(gl),
      program,
      aPos: gl.getAttribLocation(program, "aPos"),
      uPic: gl.getUniformLocation(program, "uPic"),
      uHasPic: gl.getUniformLocation(program, "uHasPic"),
      uHum: gl.getUniformLocation(program, "uHum"),
      uBars: gl.getUniformLocation(program, "uBars"),
      uWidth: gl.getUniformLocation(program, "uWidth"),
      uHP: gl.getUniformLocation(program, "uHP"),
      uWiggle: gl.getUniformLocation(program, "uWiggle"),
      uWig: gl.getUniformLocation(program, "uWig"),
      uMagnet: gl.getUniformLocation(program, "uMagnet"),
      uMag: gl.getUniformLocation(program, "uMag"),
      uPull: gl.getUniformLocation(program, "uPull"),
      uSwirl: gl.getUniformLocation(program, "uSwirl"),
      uMagSize: gl.getUniformLocation(program, "uMagSize"),
      uPurity: gl.getUniformLocation(program, "uPurity"),
      uSize: gl.getUniformLocation(program, "uSize"),
    };
    return sharedDevice;
  }

  function ensureRenderer(host, width, height) {
    const device = getSharedDevice();
    if (!host) return null;
    if (!device?.gl) {
      if (linkFailedGl) reportFailure(host, "Analog Distortion: GL program link failed");
      return null;
    }
    const gl = device.gl;
    const w = Math.max(8, Math.min(NODE_GRAPH_ANALOG_DISTORTION_MAX, width | 0));
    const h = Math.max(8, Math.min(NODE_GRAPH_ANALOG_DISTORTION_MAX, height | 0));
    let renderer = host[KEY];
    if (renderer?.alive && renderer.width === w && renderer.height === h && renderer.rev === NODE_GRAPH_ANALOG_DISTORTION_GL_REV) {
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
      reportFailure(host, "Analog Distortion: framebuffer incomplete");
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
      rev: NODE_GRAPH_ANALOG_DISTORTION_GL_REV,
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
    gl.uniform1f(device.uHum, Number(options.hum) || 0);
    gl.uniform1f(device.uBars, Number(options.humBars));
    gl.uniform1f(device.uWidth, Number(options.humWidth) || 0);
    gl.uniform1f(device.uHP, Number(options.hp) || 0);
    gl.uniform1f(device.uWiggle, Number(options.wiggle) || 0);
    gl.uniform1f(device.uWig, Number(options.wig) || 0);
    gl.uniform1f(device.uMagnet, Number(options.magnet) || 0);
    // The XY pad is -1 .. 1; the magnet sits at that point of the picture (0 .. 1).
    gl.uniform2f(device.uMag, (Number(options.magX) || 0) * 0.5 + 0.5, (Number(options.magY) || 0) * 0.5 + 0.5);
    gl.uniform1f(device.uPull, Number(options.magPull) || 0);
    gl.uniform1f(device.uSwirl, Number(options.magSwirl) || 0);
    gl.uniform1f(device.uMagSize, Number(options.magSize) || 0);
    gl.uniform1f(device.uPurity, Number(options.magPurity) || 0);
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

  global.nodeGraphAnalogDistortionGlEnsure = ensureRenderer;
  global.nodeGraphAnalogDistortionGlDispose = disposeRenderer;
  global.nodeGraphAnalogDistortionGlWipe = wipeRenderer;
  global.nodeGraphAnalogDistortionGlStep = step;
  global.nodeGraphAnalogDistortionGlPresent = presentTo;
})(typeof globalThis !== "undefined" ? globalThis : window);
