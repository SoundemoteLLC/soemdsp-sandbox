// Presets page (Command Center nav: 📄). An empty panel for now: the Preset
// Explorer (HP-07, docs/MODULE_GRADIENTS_AND_PRESETS_PLAN.md section 8)
// fills it. The old static Pages list was removed in HP-01.

function applyNodeGraphPresetsPageSize(size = {}, panelArg = null) {
  const panel = panelArg || document.getElementById("nodePresetsPage");
  if (!panel) {
    return { width: 0, height: 0 };
  }
  if (typeof applyNodeGraphUnifiedWindowShellSize === "function") {
    return applyNodeGraphUnifiedWindowShellSize(panel, size);
  }
  const width = Math.round(nodeGraphFiniteNumber(size.width));
  const height = Math.round(nodeGraphFiniteNumber(size.height));
  if (width >= 24) panel.style.width = `${width}px`;
  if (height >= 120) panel.style.height = `${height}px`;
  return { width, height };
}

function setNodeGraphPresetsPageOpen(open) {
  const panel = document.getElementById("nodePresetsPage");
  if (!panel) {
    return;
  }
  const switching = Boolean(nodeGraphMvp?._unifiedWindowSwitching);
  if (open && !switching && typeof openNodeGraphUnifiedWindowPage === "function") {
    openNodeGraphUnifiedWindowPage("presets");
    return;
  }
  panel.hidden = !open;
  if (open) {
    panel.classList.add("node-unified-window");
    if (typeof markNodeGraphFloatingWindowSurface === "function") {
      markNodeGraphFloatingWindowSurface(panel);
    }
    if (typeof noteNodeGraphUnifiedWindowOpened === "function") {
      noteNodeGraphUnifiedWindowOpened("presets", panel);
    }
  }
}

function bindNodeGraphPresetsPageEvents() {
  if (document.documentElement.dataset.presetsPageBound === "true") {
    return;
  }
  document.documentElement.dataset.presetsPageBound = "true";
  document.getElementById("nodePresetsPageClose")?.addEventListener("click", () => {
    if (typeof closeNodeGraphUnifiedWindowPage === "function") {
      closeNodeGraphUnifiedWindowPage("presets");
      return;
    }
    setNodeGraphPresetsPageOpen(false);
  });
  document
    .querySelector("#nodePresetsPage .scene-context-heading")
    ?.addEventListener("pointerdown", (event) => {
      if (typeof beginNodeGraphRegisteredFloatingWindowDrag === "function") {
        beginNodeGraphRegisteredFloatingWindowDrag(event, "presets");
      }
    });
  document
    .getElementById("nodePresetsPageResizeHandle")
    ?.addEventListener("pointerdown", (event) => {
      if (typeof beginNodeGraphRegisteredFloatingWindowResize === "function") {
        beginNodeGraphRegisteredFloatingWindowResize(event, "presets");
      }
    });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindNodeGraphPresetsPageEvents, { once: true });
  } else {
    bindNodeGraphPresetsPageEvents();
  }
}
