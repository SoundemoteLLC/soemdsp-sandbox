// Scope enable / draw kick / plate background (Phase D).
// Load after scopes.js. Extract-only.

function nodeGraphModuleScopeCanvas() {
  return document.getElementById("nodeModuleScopeCanvas");
}

function nodeGraphModuleScopeLightCanvas() {
  return document.getElementById("nodeModuleScopeLightCanvas");
}

function nodeGraphModuleScopesEnabled() {
  return Boolean(nodeGraphModuleScopeState.enabled);
}

function setNodeGraphModuleScopesEnabled(enabled) {
  nodeGraphModuleScopeState.enabled = Boolean(enabled);
  document.getElementById("nodeGraphWorkspace")
    ?.classList.toggle("module-scopes-enabled", nodeGraphModuleScopesEnabled());
  syncNodeGraphModuleScopeHeartbeat();
  syncNodeGraphModuleScopeCanvas();
}

// no-poll-2: no 100 ms heartbeat. Live draws are scheduled by snapshot
// arrival (buffer-io -> scopePaintOnSampleSnapshot) and each draw request has
// its own one-shot watchdog (draw-orchestrator). What the heartbeat also did
// -- restart a draw left pending (hidden tab), hold frozen faces -- now runs
// once on the events that need it: scopes enabled, tab visible again / page
// shown / window focus, and every patch commit. The GPU debug readout follows
// snapshots (at most 4 per second, by timestamp).
const nodeGraphModuleScopeKickState = { hooked: false, debugAt: 0 };

function kickNodeGraphModuleScopeDraws() {
  if (!nodeGraphModuleScopesEnabled() || !nodeGraphModuleScopeHasDrawableSlots()) {
    return;
  }
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }
  const livePaint = typeof scopePaintIsLive === "function"
    ? scopePaintIsLive()
    : (typeof nodeGraphModuleScopeLivePaintActive === "function"
      ? nodeGraphModuleScopeLivePaintActive()
      : !nodeGraphModuleScopePaused());
  if (!livePaint) {
    // Stopped/cold: nothing to restart. Hold residual while intentionally
    // frozen (pause with engine still up).
    if (typeof scopePaintIsFrozen === "function" && scopePaintIsFrozen()) {
      if (nodeGraphModuleScopeState.buffers?.size) {
        absorbNodeGraphModuleScopePhosphorDrawCursors();
      }
      if (typeof holdNodeGraphScope2dTraceFaces === "function") {
        holdNodeGraphScope2dTraceFaces();
      }
    }
    return;
  }
  syncNodeGraphScopeGpuDebugDisplay();
  const pendingFrame = nodeGraphFiniteNumber(nodeGraphModuleScopeState.drawFrame);
  const requestedAt = nodeGraphFiniteNumber(nodeGraphModuleScopeState.drawFrameRequestedAt);
  const now = (performance.now?.() || Date.now());
  if (pendingFrame && requestedAt > 0 && now - requestedAt <= 250) {
    return;
  }
  if (pendingFrame) {
    window.cancelAnimationFrame(pendingFrame);
    nodeGraphModuleScopeState.drawFrame = 0;
    nodeGraphModuleScopeState.drawFrameRequestedAt = 0;
  }
  if (nodeGraphModuleScopeState.drawFrameWatchdog) {
    window.clearTimeout(nodeGraphModuleScopeState.drawFrameWatchdog);
    nodeGraphModuleScopeState.drawFrameWatchdog = 0;
  }
  if (nodeGraphModuleScopeState.drawBusy) {
    return;
  }
  scheduleNodeGraphModuleScopeDraw();
}

function syncNodeGraphModuleScopeHeartbeat() {
  if (nodeGraphModuleScopeState.drawFrameHeartbeat) {
    // An interval from an older build of this file.
    window.clearInterval(nodeGraphModuleScopeState.drawFrameHeartbeat);
    nodeGraphModuleScopeState.drawFrameHeartbeat = 0;
  }
  if (!nodeGraphModuleScopeKickState.hooked && typeof window !== "undefined") {
    nodeGraphModuleScopeKickState.hooked = true;
    const kick = () => kickNodeGraphModuleScopeDraws();
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("pageshow", kick);
    window.addEventListener("focus", kick);
    if (typeof addNodeGraphPatchCommitListener === "function") {
      addNodeGraphPatchCommitListener(kick);
    } else {
      (globalThis.__nodeGraphPatchCommitPending ||= []).push(kick);
    }
    const onSnapshot = () => {
      const now = (performance.now?.() || Date.now());
      if (now - nodeGraphModuleScopeKickState.debugAt < 250) return;
      nodeGraphModuleScopeKickState.debugAt = now;
      if (typeof syncNodeGraphScopeGpuDebugDisplay === "function") syncNodeGraphScopeGpuDebugDisplay();
    };
    if (typeof addNodeGraphModuleScopeSnapshotListener === "function") {
      addNodeGraphModuleScopeSnapshotListener(onSnapshot);
    } else {
      (globalThis.__nodeGraphScopeSnapshotPending ||= []).push(onSnapshot);
    }
  }
  if (nodeGraphModuleScopesEnabled()) {
    kickNodeGraphModuleScopeDraws();
  }
}

// Scope slots → node-graph-module-scope-slots.js
function resetNodeGraphModuleScopeFrameClocks() {
  nodeGraphModuleScopeState.modelFrameTimes.clear();
  nodeGraphModuleScopeState.clockPhasors.clear();
  nodeGraphModuleScopeState.phosphorFrame = {
    key: "",
    lastUpdate: 0,
  };
}

/**
 * Resolve the LCD/plate color under a face canvas (CSS token, then solid bg).
 * Used when simulation stops so screens return to a cold dark plate, not a
 * frozen last frame.
 */
function nodeGraphModuleScopePlateBackgroundForElement(element) {
  if (!element || typeof getComputedStyle !== "function") {
    return nodeGraphFacePlateDefaultBackground;
  }
  const host = element.closest?.(
    ".node-module-scope-window, .node-module-scope-window-surface, .node-xy-pad, .node-led-face, .dsp-node",
  ) || element.parentElement || element;
  try {
    const style = getComputedStyle(host);
    const token = String(style.getPropertyValue("--node-scope-background") || "").trim();
    if (token) {
      return token;
    }
    const bg = String(style.backgroundColor || "").trim();
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
      return bg;
    }
  } catch (_error) {
    // Best-effort; fall through to default plate.
  }
  return nodeGraphFacePlateDefaultBackground;
}

/**
 * Wipe every module screen back to idle plate — same cold look as app start.
 * Drops phosphor residual FBOs and paints face canvases solid plate color so
 * stop feels like powering the simulation off (not freezing mid-trail).
 */
// Scope wipe → node-graph-module-scope-wipe.js
