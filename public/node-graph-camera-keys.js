// Camera keys, for smooth pans and zooms (recording a video):
//   W A S D   move the camera (pan) while held; it eases in and out
//   Q / E     zoom out / in while held, toward the mouse cursor (like the wheel); the middle of the screen when the mouse is off the workspace
//   Wheel     while a camera key is held, changes the camera speed (remembered); it does not zoom then
//   R (hold)  peek: the plain circuit view while Viewport Out's effect chain keeps running; release and the effect is back
// Keys act only when no modifier is held and the user is not typing. Shift+D is the constraint guide (D alone moved here).

(() => {
  "use strict";

  const SPEED_KEY = "soemdsp-sandbox.cameraSpeed.v1";
  // Pan: the content moves the opposite way to the camera. [x, y] pixels per second at speed 1, on screen.
  const PAN_KEYS = { w: [0, 1], s: [0, -1], a: [1, 0], d: [-1, 0] };
  const ZOOM_KEYS = { e: 1, q: -1 };
  const PAN_PX_PER_S = 620;
  const ZOOM_LN_PER_S = 0.75;
  // How quickly the camera reaches its speed and comes to rest (seconds): the ease that makes a pan look smooth.
  const EASE_S = 0.16;
  const SPEED_MIN = 0.05;
  const SPEED_MAX = 20;

  const pressed = new Set();
  // The last mouse position: the zoom keys zoom toward it, like the wheel does.
  let pointer = null;
  const cam = { raf: 0, last: 0, vx: 0, vy: 0, vz: 0, speed: 1, moving: false };

  try {
    const saved = Number(window.localStorage.getItem(SPEED_KEY));
    if (Number.isFinite(saved) && saved >= SPEED_MIN && saved <= SPEED_MAX) cam.speed = saved;
  } catch { /* storage unavailable: keep the default */ }

  function blocked(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return true;
    if (typeof nodeGraphAppHotkeysLocked === "function" && nodeGraphAppHotkeysLocked()) return true;
    if (typeof nodeGraphEventTargetIsTextEditable === "function" && nodeGraphEventTargetIsTextEditable(event.target)) return true;
    // A focused graph display uses A (add a point) and its own keys.
    if (document.activeElement?.closest?.(".node-module-graph-display")) return true;
    return false;
  }

  function isCameraKey(k) {
    return k in PAN_KEYS || k in ZOOM_KEYS;
  }

  function setSpeed(next) {
    cam.speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, next));
    try { window.localStorage.setItem(SPEED_KEY, String(cam.speed)); } catch { /* ignore */ }
    if (typeof setNodeInteractionHelp === "function") {
      setNodeInteractionHelp(`Camera speed ${cam.speed.toFixed(2)}x`);
    }
  }

  function finish() {
    cam.moving = false;
    cam.vx = 0;
    cam.vy = 0;
    cam.vz = 0;
    if (typeof clearNodeGraphViewportGestureClass === "function") clearNodeGraphViewportGestureClass();
    if (typeof flushNodeGraphViewportImmediate === "function") {
      flushNodeGraphViewportImmediate({ zoom: true, pan: true, persist: true });
    }
  }

  function tick(now) {
    cam.raf = 0;
    const dt = cam.last ? Math.max(0.001, Math.min(0.05, (now - cam.last) / 1000)) : 1 / 60;
    cam.last = now;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    for (const k of pressed) {
      if (k in PAN_KEYS) {
        tx += PAN_KEYS[k][0];
        ty += PAN_KEYS[k][1];
      } else if (k in ZOOM_KEYS) {
        tz += ZOOM_KEYS[k];
      }
    }
    // Diagonals are not faster than straight lines.
    const len = Math.hypot(tx, ty);
    if (len > 1) {
      tx /= len;
      ty /= len;
    }
    // Ease the velocity toward the target (the same smoothing whether speeding up or slowing down).
    const a = 1 - Math.exp(-dt / EASE_S);
    cam.vx += (tx * PAN_PX_PER_S * cam.speed - cam.vx) * a;
    cam.vy += (ty * PAN_PX_PER_S * cam.speed - cam.vy) * a;
    cam.vz += (tz * ZOOM_LN_PER_S * Math.sqrt(cam.speed) - cam.vz) * a;
    const moving = Math.abs(cam.vx) > 0.5 || Math.abs(cam.vy) > 0.5 || Math.abs(cam.vz) > 0.0005;
    if (moving) {
      if (typeof nodeGraphMarkUserAdjustedView === "function") nodeGraphMarkUserAdjustedView();
      cam.moving = true;
      if (Math.abs(cam.vz) > 0.0005 && typeof setNodeGraphZoom === "function" && typeof nodeGraphZoom === "function") {
        const ws = document.getElementById("nodeGraphWorkspace")?.getBoundingClientRect();
        const inside = pointer && ws && pointer.x >= ws.left && pointer.x <= ws.right && pointer.y >= ws.top && pointer.y <= ws.bottom;
        setNodeGraphZoom(nodeGraphZoom() * Math.exp(cam.vz * dt), inside ? pointer : null);
      }
      if ((Math.abs(cam.vx) > 0.5 || Math.abs(cam.vy) > 0.5) && typeof setNodeGraphPan === "function") {
        const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
        setNodeGraphPan(pan.x + cam.vx * dt, pan.y + cam.vy * dt, { gesture: true, persist: false });
      }
      if (typeof viewFrame === "function" && nodeGraphViewCamera?.dirty) {
        viewFrame();
      }
    }
    if (pressed.size || moving) {
      cam.raf = window.requestAnimationFrame(tick);
    } else if (cam.moving) {
      finish();
    }
  }

  function start() {
    if (!cam.raf) {
      cam.last = 0;
      cam.raf = window.requestAnimationFrame(tick);
    }
  }

  // Peek: Viewport Out's chain keeps running; the screen shows the plain circuit while P is held.
  function peek(on) {
    if (typeof nodeGraphScreenFxState === "object" && nodeGraphScreenFxState) nodeGraphScreenFxState.peek = on;
  }

  document.addEventListener("keydown", (event) => {
    const k = String(event.key || "").toLowerCase();
    if (k === "r" && !blocked(event) && typeof nodeGraphScreenFxState === "object" && nodeGraphScreenFxState?.active) {
      event.preventDefault();
      peek(true);
      return;
    }
    if (!isCameraKey(k) || blocked(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    if (!event.repeat) pressed.add(k);
    start();
  }, true);

  document.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
  }, { capture: true, passive: true });

  document.addEventListener("keyup", (event) => {
    const k = String(event.key || "").toLowerCase();
    if (k === "r") peek(false);
    if (isCameraKey(k)) pressed.delete(k);
  }, true);

  window.addEventListener("blur", () => {
    pressed.clear();
    peek(false);
  });

  // The wheel sets the camera speed while a camera key is held (the speed is a multiplier, a notch is about 12%).
  window.addEventListener("wheel", (event) => {
    if (!pressed.size) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    setSpeed(cam.speed * Math.exp(-Math.sign(event.deltaY || 0) * 0.12));
  }, { capture: true, passive: false });

  window.nodeGraphCameraSpeed = () => cam.speed;
  window.setNodeGraphCameraSpeed = setSpeed;
})();
