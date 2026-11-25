const nodeGraphPatchViewFallbackSize = Object.freeze({ w: 1280, h: 720 });

function normalizeNodeGraphPatchViewBox(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const x = Number(value.x);
  const y = Number(value.y);
  const w = Number(value.w);
  const h = Number(value.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    return null;
  }
  return { x, y, w, h };
}

function nodeGraphPatchViewGridStep(axis) {
  const step = axis === "y" && typeof nodeGraphGridHeight === "function"
    ? nodeGraphGridHeight()
    : typeof nodeGraphGridWidth === "function"
      ? nodeGraphGridWidth()
      : 28;
  return Number.isFinite(step) && step > 0 ? step : 28;
}

function snapNodeGraphPatchViewValue(value, axis) {
  const step = nodeGraphPatchViewGridStep(axis);
  return Math.round(Number(value) / step) * step;
}

function nodeGraphPatchViewMinSize() {
  return {
    w: nodeGraphPatchViewGridStep("x") * 8,
    h: nodeGraphPatchViewGridStep("y") * 4,
  };
}

/** Default box: current workspace size at zoom 1, centered on the origin. */
function nodeGraphDefaultPatchViewBox() {
  const min = nodeGraphPatchViewMinSize();
  let w = nodeGraphPatchViewFallbackSize.w;
  let h = nodeGraphPatchViewFallbackSize.h;
  const workspace = document.getElementById("nodeGraphWorkspace");
  if (workspace && typeof nodeGraphWorkspaceChromeSize === "function") {
    const rect = workspace.getBoundingClientRect();
    const contentW = Math.max(0, rect.width - nodeGraphWorkspaceChromeSize("x"));
    const contentH = Math.max(0, rect.height - nodeGraphWorkspaceChromeSize("y"));
    if (contentW > 0 && contentH > 0) {
      w = contentW;
      h = contentH;
    }
  }
  w = Math.max(min.w, snapNodeGraphPatchViewValue(w, "x"));
  h = Math.max(min.h, snapNodeGraphPatchViewValue(h, "y"));
  // Even cell counts keep the origin at the exact centre after a grid snap.
  const stepX = nodeGraphPatchViewGridStep("x");
  const stepY = nodeGraphPatchViewGridStep("y");
  if ((Math.round(w / stepX) % 2) !== 0) {
    w += stepX;
  }
  if ((Math.round(h / stepY) % 2) !== 0) {
    h += stepY;
  }
  return {
    x: -w / 2,
    y: -h / 2,
    w,
    h,
  };
}

function nodeGraphPatchViewBox() {
  return normalizeNodeGraphPatchViewBox(nodeGraphMvp?.patch?.patchView);
}

/** Put a default box on the patch in place. No commit, no history, no dirty. */
function ensureNodeGraphPatchViewBox(patch = nodeGraphMvp?.patch) {
  if (!patch) {
    return null;
  }
  let rect = normalizeNodeGraphPatchViewBox(patch.patchView);
  if (!rect) {
    rect = nodeGraphDefaultPatchViewBox();
    patch.patchView = rect;
  }
  return rect;
}

function nodeGraphPatchViewIsVisible() {
  return Boolean(nodeGraphMvp?.patchViewVisible) && Boolean(nodeGraphPatchViewBox() || nodeGraphMvp?.patchViewDragging?.next);
}

function nodeGraphHtmlCameraForWorldEl() {
  const workspace = document.getElementById("nodeGraphWorkspace");
  const zoom = Math.max(
    0.0001,
    typeof nodeGraphZoom === "function" ? nodeGraphZoom() : (nodeGraphMvp?.zoom || 1),
  );
  const pan = nodeGraphMvp?.pan || { x: 0, y: 0 };
  const origin = typeof nodeGraphRenderedOriginOffset === "function" && workspace
    ? nodeGraphRenderedOriginOffset(pan, workspace)
    : pan;
  return {
    zoom,
    transform: `translate(${(Number(origin?.x) || 0) / zoom}px, ${(Number(origin?.y) || 0) / zoom}px)`,
  };
}

function applyNodeGraphHtmlCameraToWorldEl(el, extraTransform) {
  if (!el) {
    return;
  }
  const cam = nodeGraphHtmlCameraForWorldEl();
  const zoomText = String(cam.zoom);
  const transform = extraTransform ? `${cam.transform} ${extraTransform}` : cam.transform;
  if (el.style.zoom !== zoomText) el.style.zoom = zoomText;
  if (el.style.transformOrigin !== "0px 0px") el.style.transformOrigin = "0 0";
  if (el.style.transform !== transform) el.style.transform = transform;
}

function syncNodeGraphPatchViewButtons() {
  const toggle = document.getElementById("nodePatchViewToggleButton");
  const visible = nodeGraphPatchViewIsVisible();
  if (typeof setNodeGraphVisibilityToggleLabel === "function") {
    setNodeGraphVisibilityToggleLabel(toggle, visible, "Patch View");
  } else if (toggle) {
    toggle.textContent = visible ? "⬜ Patch View" : "⬛ Patch View";
    toggle.setAttribute("aria-pressed", visible ? "true" : "false");
    toggle.setAttribute("aria-label", `Patch View, ${visible ? "visible" : "hidden"}`);
  }
}

function syncNodeGraphPatchViewChrome() {
  const boxEl = document.getElementById("nodeGraphPatchViewBox");
  const live = nodeGraphMvp?.patchViewDragging?.next || nodeGraphPatchViewBox();
  const visible = Boolean(live) && Boolean(nodeGraphMvp?.patchViewVisible);
  if (boxEl) {
    boxEl.hidden = !visible;
    boxEl.setAttribute("aria-hidden", visible ? "false" : "true");
    if (live) {
      boxEl.style.left = `${live.x}px`;
      boxEl.style.top = `${live.y}px`;
      boxEl.style.width = `${live.w}px`;
      boxEl.style.height = `${live.h}px`;
      applyNodeGraphHtmlCameraToWorldEl(boxEl);
    }
  }
  syncNodeGraphPatchViewButtons();
}

function setNodeGraphPatchViewBox(rect, status) {
  const next = normalizeNodeGraphPatchViewBox(rect) || ensureNodeGraphPatchViewBox();
  if (!next || !nodeGraphMvp?.patch) {
    return;
  }
  const patch = typeof cloneNodeGraphPatch === "function"
    ? cloneNodeGraphPatch(nodeGraphMvp.patch)
    : { ...(nodeGraphMvp.patch || {}) };
  patch.patchView = next;
  commitNodeGraphPatch(patch, {
    status: status || "patch view updated",
  });
}

function showNodeGraphPatchView() {
  if (!nodeGraphMvp) {
    return;
  }
  ensureNodeGraphPatchViewBox();
  nodeGraphMvp.patchViewVisible = true;
  syncNodeGraphPatchViewChrome();
}

function hideNodeGraphPatchView() {
  if (!nodeGraphMvp) {
    return;
  }
  nodeGraphMvp.patchViewVisible = false;
  syncNodeGraphPatchViewChrome();
}

function toggleNodeGraphPatchView() {
  if (nodeGraphPatchViewIsVisible()) {
    hideNodeGraphPatchView();
  } else {
    showNodeGraphPatchView();
  }
}

function nodeGraphPatchViewRectFromDrag(point) {
  const drag = nodeGraphMvp?.patchViewDragging;
  if (!drag) {
    return null;
  }
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  const base = drag.rect;
  const min = nodeGraphPatchViewMinSize();
  const handle = drag.handle;
  let x = base.x;
  let y = base.y;
  let w = base.w;
  let h = base.h;
  const right = base.x + base.w;
  const bottom = base.y + base.h;
  if (handle === "move") {
    x = snapNodeGraphPatchViewValue(base.x + dx, "x");
    y = snapNodeGraphPatchViewValue(base.y + dy, "y");
  } else {
    if (handle.includes("w")) {
      x = snapNodeGraphPatchViewValue(Math.min(right - min.w, base.x + dx), "x");
      w = right - x;
    } else if (handle.includes("e")) {
      w = Math.max(min.w, snapNodeGraphPatchViewValue(base.w + dx, "x"));
    }
    if (handle.includes("n")) {
      y = snapNodeGraphPatchViewValue(Math.min(bottom - min.h, base.y + dy), "y");
      h = bottom - y;
    } else if (handle.includes("s")) {
      h = Math.max(min.h, snapNodeGraphPatchViewValue(base.h + dy, "y"));
    }
  }
  return { x, y, w: Math.max(min.w, w), h: Math.max(min.h, h) };
}

function beginNodeGraphPatchViewDrag(event) {
  if (event.button !== 0) {
    return;
  }
  const handle = event.currentTarget.dataset.patchViewHandle;
  const rect = nodeGraphPatchViewBox();
  if (!handle || !rect || typeof nodeGraphClientPoint !== "function") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  target.setPointerCapture?.(event.pointerId);
  nodeGraphMvp.patchViewDragging = {
    handle,
    pointerId: event.pointerId,
    rect: { ...rect },
    start: nodeGraphClientPoint(event),
    next: { ...rect },
  };
  target.addEventListener("pointermove", dragNodeGraphPatchView);
  target.addEventListener("pointerup", endNodeGraphPatchViewDrag);
  target.addEventListener("pointercancel", endNodeGraphPatchViewDrag);
}

function dragNodeGraphPatchView(event) {
  const drag = nodeGraphMvp?.patchViewDragging;
  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const next = nodeGraphPatchViewRectFromDrag(nodeGraphClientPoint(event));
  if (!next) {
    return;
  }
  drag.next = next;
  syncNodeGraphPatchViewChrome();
}

function endNodeGraphPatchViewDrag(event) {
  const drag = nodeGraphMvp?.patchViewDragging;
  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }
  const target = event.currentTarget;
  target.releasePointerCapture?.(event.pointerId);
  target.removeEventListener("pointermove", dragNodeGraphPatchView);
  target.removeEventListener("pointerup", endNodeGraphPatchViewDrag);
  target.removeEventListener("pointercancel", endNodeGraphPatchViewDrag);
  const next = nodeGraphPatchViewRectFromDrag(nodeGraphClientPoint(event)) || drag.next;
  nodeGraphMvp.patchViewDragging = null;
  const prev = nodeGraphPatchViewBox();
  if (!next || !prev) {
    syncNodeGraphPatchViewChrome();
    return;
  }
  if (next.x === prev.x && next.y === prev.y && next.w === prev.w && next.h === prev.h) {
    syncNodeGraphPatchViewChrome();
    return;
  }
  setNodeGraphPatchViewBox(next, "patch view adjusted");
}

/** After a patch load: the patch always has a box; frame the camera on it. Visibility is session-only. */
function frameNodeGraphPatchViewAfterLoad() {
  if (!nodeGraphMvp) {
    return;
  }
  const rect = ensureNodeGraphPatchViewBox();
  syncNodeGraphPatchViewChrome();
  // viewFrame(rect): fit + centre. Visibility is not changed here.
  if (rect && typeof viewFrame === "function") {
    viewFrame(rect);
  }
}

function bindNodeGraphPatchViewControls() {
  const toggle = document.getElementById("nodePatchViewToggleButton");
  const boxEl = document.getElementById("nodeGraphPatchViewBox");
  if (toggle && toggle.dataset.boundPatchView !== "true") {
    toggle.addEventListener("click", toggleNodeGraphPatchView);
    toggle.dataset.boundPatchView = "true";
  }
  if (boxEl && boxEl.dataset.boundPatchView !== "true") {
    boxEl.querySelectorAll("[data-patch-view-handle]").forEach((el) => {
      el.addEventListener("pointerdown", beginNodeGraphPatchViewDrag);
    });
    boxEl.dataset.boundPatchView = "true";
  }
  if (bindNodeGraphPatchViewControls.boundCommit) {
    syncNodeGraphPatchViewChrome();
    return;
  }
  bindNodeGraphPatchViewControls.boundCommit = true;
  const listen = typeof addNodeGraphPatchCommitListener === "function"
    ? addNodeGraphPatchCommitListener
    : (fn) => {
      globalThis.__nodeGraphPatchCommitPending = globalThis.__nodeGraphPatchCommitPending || [];
      globalThis.__nodeGraphPatchCommitPending.push(fn);
    };
  listen(() => {
    syncNodeGraphPatchViewChrome();
  });
  syncNodeGraphPatchViewChrome();
}

bindNodeGraphPatchViewControls();
