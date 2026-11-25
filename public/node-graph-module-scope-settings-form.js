// Display Settings form HTML builders extracted from node-graph-module-scopes.js
// (Phase D). Load after scope-display-mode, before scopes.js.

function nodeGraphDisplaySettingsBuildStepperRowHtml(key, formType = null, options = {}) {
  const meta = nodeGraphDisplaySettingsFieldMeta[key] || { label: key, inputmode: "decimal" };
  // Everything on the dot stage (rings, light and time gauges) is edited there: no rows,
  // just the hidden inputs the form reads and writes.
  if (key === "glowCore" || key === "glowReach" || key === "glowStrength" || nodeGraphDotStageOwnsField(key, formType)) {
    return `<input type="hidden" data-trace-display-field="${key}"${meta.id ? ` id="${meta.id}"` : ""}>`;
  }
  let label = meta.label;
  let title = meta.title;
  // Knob display settings labels.
  if (key === "decimals" && formType === "knobFace") {
    label = "Num decimals";
    title = "Digits after the decimal on the Knob face readout (0–8).";
  }
  if (key === "rotationDegrees" && formType === "knobFace") {
    label = "Span °";
    title = "Centered arc sweep across Bias 0…1 (degrees). Opens left and right together; gap stays opposite center.";
  }
  // Window row in Beats: its own value, windowBeats (lib/visual/scope-sync.js).
  if (key === "windowBeats") {
    label = "Beats";
    title = "";
  }
  if ((key === "historySeconds" || key === "zoomSeconds" || key === "historyHz") && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
    || formType === "vactrolScope"
  )) {
    label = "History (seconds)";
    title = formType === "vactrolScope"
      ? "Seconds of Light / Flt Env / Amp Env / Mem scrolling across the face. Longer = slower scroll. Default 2."
      : "History window duration in seconds across the face. Longer = slower scroll. At 0 the face is the current bar.";
  } else if ((key === "historyHz" || key === "historyCycles" || key === "zoomSeconds" || key === "historySeconds") && (
    formType === "gradientVectorscopeFace"
  )) {
    label = key === "historyCycles" ? "History (cycles)" : "History (Hz)";
    title = "Live history window (Hz when free-run; History (cycles) when synced).";
  }
  // Instant Waterfall History = Beats: the historyCycles value counts beats.
  if (key === "historyCycles" && nodeGraphDisplaySettingsHistoryIsBeats(formType)) {
    label = "History (beats)";
    title = "";
  }
  if (key === "cloudSpeed" && formType === "ensembleCloud") {
    label = "Speed";
    title = "Waterfall scroll. 0 = freeze. 1 = default. Higher = faster.";
  }
  if (key === "lineThickness" && formType === "hypersawBurn") {
    label = "Line thickness (px)";
    title = "Phase-stem width in screen pixels (0–64). Scaled for canvas backing and zoom.";
  } else if (key === "faceBlur" && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
  )) {
    label = "Blur";
    title = "Gaussian blur of the waterfall face, 0 to 1. 0 = sharp bars. 1 = full blur.";
  } else if (key === "lineThickness" && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
  )) {
    label = "Blur";
    title = "Soft vertical skirt on filled Instant Waterfall columns. 0 = hard 1px bar; 1 = soft tips above/below the peak-to-peak core.";
  } else if (false) {
  } else if (key === "stampDensity" && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
  )) {
    label = "Dot density";
    title = "0 = extremely sparse (~200× default gap); 0.5 = recommended; 1 = 2× recommended density.";
  } else if (key === "lineThickness" && (
    formType === "lineBurn" || formType === "scope2d" || formType === "dot"
    || formType === "xyPad" || formType === "phosphorLight" || formType === "videoscopeBurn"
  )) {
    label = "Glow";
    title = "A pinpoint core inside a soft halo. Raise Glow and the hot core pulls in toward a point while a wide dim halo grows around it. 0 = just an antialiased edge.";
  } else if (key === "lineThickness" && formType === "value") {
    label = "Blur";
    title = "0 = Size as a hard line. Raise to fatten a soft halo outward. Lower returns to the thin sharp line.";
  }
  if ((key === "dot1Size" || key === "secondarySize")
    && typeof nodeGraphScopeDotSizeIsUnit === "function" && nodeGraphScopeDotSizeIsUnit(formType)) {
    label = "Size";
    title = "Dot diameter as a share of the display's short side: 0…1, 1 = one dot as big as the display. Fine control near 0. Dot Budget 1 + a big Size prints giant dots.";
  }
  if ((key === "dot1Size" || key === "secondarySize") && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
    || formType === "scope2dTrace"
    || formType === "scope1dTrace"
    || formType === "gradientVectorscopeFace"
    || formType === "value"
    || formType === "lineBurn"
    || formType === "scope2d"
    || formType === "phosphorLight"
    || formType === "xyPad"
    || formType === "dot"
    || formType === "vectorRgbFace"
  )) {
    label = "\u26AA Size";
    title = formType === "scope1dTrace"
      ? "Beam thickness in CSS pixels at a 96px face (TraceWoscope uSize). 0 = gone. Binds like Bright -> intensity."
      : "Phosphor / stroke diameter in CSS pixels at a 96px face (zoom 1). 0 = gone.";
  }
  if ((key === "dot1Brightness" || key === "secondaryBrightness") && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
    || formType === "scope2dTrace"
    || formType === "scope1dTrace"
    || formType === "gradientVectorscopeFace"
    || formType === "value"
    || formType === "scope2d"
    || formType === "lineBurn"
    || formType === "phosphorLight"
    || formType === "xyPad"
    || formType === "vectorRgbFace"
  )) {
    label = "\uD83D\uDCA1 Bright";
    title = (formType === "scope1dTrace" || formType === "scope2dTrace")
      ? "Brightness 0-1 scales the trace channel. The gradient is looked up at that brightness, including the empty area. Not an opacity fade."
      : formType === "waterfall" || formType === "waterfallRgb" || formType === "waterfallXyz" || formType === "gradientVectorscopeFace" || formType === "value"
      ? "Ink light 0…1 (1 = full)."
      : "Stamp brightness 0…1 (single source of truth). 1 = full ink. Preview matches the face.";
  }
  if (key === "pixelDensity" && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
    || formType === "scope2dTrace"
    || formType === "gradientVectorscopeFace"
    || formType === "scope2d"
    || formType === "lineBurn"
    || formType === "phosphorLight"
    || formType === "xyPad"
    || formType === "vectorRgbFace"
  )) {
    label = "Pixel density";
    title = "1 = native face buffer. Below 1 = chunky lo-fi grid (nearest-neighbor).";
  }
  if (key === "strokeThickness" && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
  )) {
    label = "Stroke thickness";
    title = "Stroke width in CSS pixels (0.25–16). Top and bottom of each bar only.";
  }
  if (key === "scale" && (
    formType === "waterfall"
    || formType === "waterfallRgb"
    || formType === "waterfallXyz"
    || formType === "scope2dTrace"
    || formType === "gradientVectorscopeFace"
    || formType === "value"
  )) {
    label = "Scale";
    title = "Amplitude zoom on the face (1 = full-scale). Does not change the Display Settings preview dot.";
  }
  if ((formType === "roundShapeFace" || formType === "basicShapeFace" || formType === "blitFace" || formType === "sinCosFace" || formType === "additiveWaveform" || formType === "clockFace" || formType === "clockDividerFace" || formType === "pulseExplosionFace" || formType === "pulseTrainFace" || formType === "plotFace") && key === "lineThickness") {
    label = "Line thickness";
    title = formType === "clockFace" || formType === "clockDividerFace" || formType === "pulseExplosionFace" || formType === "pulseTrainFace" ? "Line width in CSS pixels (0–16). 0 = no line." : formType === "roundShapeFace"
      ? "Orbit stroke width in CSS pixels (0–16). 0 = no line, only the dot."
      : "Wave stroke width in CSS pixels (0–16). 0 = no line, only the dot.";
  }
  if ((formType === "roundShapeFace" || formType === "basicShapeFace" || formType === "blitFace" || formType === "sinCosFace" || formType === "pulseExplosionFace" || formType === "pulseTrainFace") && key === "dotThickness") {
    label = "Dot size";
    title = "Phase-dot diameter in CSS pixels (0.25–32).";
  }

  if (formType === "sinCosFace" && key === "padExtra") {
    label = "Extra padding";
    title = "Extra CSS pixels inside the plate after the automatic line/dot inset (0 = flush, no clip).";
  }
  if (formType === "plotFace" && key === "lineThickness") {
    title = "Line width in face pixels (0–16). 0 = no line. Scales with the display when zooming.";
  }
  if (formType === "plotFace" && key === "scale") {
    label = "Gain";
    title = "Plot scale: 1 = -1..+1 fills the height (2D Plot: the square, both axes).";
  }
  if (formType === "pluckHitFace" && key === "fadeTime") {
    // No hover pop-up (empty title): the label says it.
    label = "Stack fade (s)";
    title = "";
  }
  if (formType === "pulseTrainFace" && key === "fadeTime") {
    label = "Fade time (s)";
    title = "Lit-dot hang after each pulse. 0 = stay lit until the next trigger. Small values drop immediately. Same exponential residual as phosphor / woscope.";
  }
  if ((formType === "roundShapeFace" || formType === "basicShapeFace" || formType === "blitFace" || formType === "sinCosFace" || formType === "additiveWaveform" || formType === "clockFace" || formType === "clockDividerFace" || formType === "pulseExplosionFace" || formType === "pulseTrainFace" || formType === "plotFace" || formType === "waterfall" || formType === "waterfallRgb" || formType === "waterfallXyz") && key === "lineSmoothing") {
    label = "Line blur";
    title = "Expo antialiasing skirt in CSS pixels (0–8, default 1), outside the line's thickness. 0 = hard core.";
  }
  if (formType === "pulseTrainFace" && (key === "lineSmoothing" || key === "tapLineBlur")) {
    const velvetNode = typeof nodeGraphPatchNode === "function"
      && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
      ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())
      : null;
    if (velvetNode?.type === "velvetReverb") {
      if (key === "lineSmoothing") {
        label = "Dot blur";
        title = "";
      }
      if (key === "tapLineBlur") {
        label = "Line blur";
        title = "";
      }
    }
  }
  if (formType === "robinSinepulseFace" && key === "lineSmoothing") {
    label = "Envelope blur";
    title = "Expo fade on the baseline and top edge (CSS pixels, 0–8, default 1). Thin bars fade to 0 instead of a hard line.";
  }
  if (formType === "robinSinepulseFace" && key === "pixelDensity") {
    label = "Pixel density";
    title = "1.0 = CSS × devicePixelRatio. Below 1 = chunky lo-fi.";
  }
  if ((formType === "roundShapeFace" || formType === "basicShapeFace" || formType === "blitFace") && key === "lineBlur") {
    label = "Line blur";
    title = "Diamond restroke blur in CSS pixels (0 = hard). Path is redrawn at 9 tent-weighted offsets — cheap, no extra canvas.";
  }
  if ((formType === "roundShapeFace" || formType === "basicShapeFace" || formType === "blitFace") && key === "pixelDensity") {
    label = "Pixel density";
    title = "1.0 = CSS × devicePixelRatio. Below 1 = chunky lo-fi.";
  }
  if (formType === "phaserFace" && key === "barThickness") {
    label = "Bar thickness";
    title = "Peak bar width 0…1 of the face min side. Scales with the canvas.";
  }
  if (formType === "phaserFace" && key === "curveThickness") {
    label = "Curve thickness";
    title = "Analytic curve stroke 0…1 of the face min side. Scales with the canvas.";
  }
  if ((key === "zoomMin" || key === "zoomMax") && formType === "graphFace") {
    label = key === "zoomMin" ? "Zoom Min" : "Zoom Max";
    title = "";
  }
  if (formType === "graphFace" && key === "lineThickness") {
    label = "Line";
    title = "";
  }
  if (formType === "graphFace" && key === "lineSmoothing") {
    label = "Line blur";
    title = "";
  }
  if (formType === "graphFace" && key === "dottedThickness") {
    label = "Dotted";
    title = "";
  }
  if (formType === "graphFace" && key === "dotSize") {
    label = "Point";
    title = "";
  }
  if (formType === "graphFace" && key === "ghostAlpha") {
    label = "Ghost Fade";
    title = "";
  }
  if (formType === "graphFace" && key === "dottedAlpha") {
    label = "Dotted Fade";
    title = "";
  }
  if (formType === "graphFace" && key === "gridAlpha") {
    label = "Grid Fade";
    title = "";
  }
  if (formType === "graphFace" && key === "pointAlpha") {
    label = "Point Fade";
    title = "";
  }
  if (formType === "graphFace" && key === "handleAlpha") {
    label = "Handle Fade";
    title = "";
  }
  if (formType === "graphFace" && key === "phaseAlpha") {
    label = "Phase Fade";
    title = "";
  }
  if (key === "innerRadius" && formType === "knobFace") {
    label = "Inner radius";
    title = "Ring hole size 0.3…0.92 of the dial radius (default 0.72; higher = thinner ring).";
  }
  if ((formType === "vectorDot" || formType === "pulseDot" || formType === "lcdDot") && key === "lineThickness") {
    label = "Blur";
    title = "Smoothstep edge softness 0…1 (0 = hard edge, 1 = soft skirt). Baked into the stamp bitmap.";
  }
  if (formType === "vectorRgbFace" && key === "lineThickness") {
    label = "Line";
    title = "Stroke between samples 0…1. 0 = dots only. Raise to fill the path so the beam reads as a line.";
  }
  if ((formType === "vectorDot" || formType === "pulseDot" || formType === "lcdDot") && key === "dot1Size") {
    label = "Size";
    title = "Dot diameter as a fraction of the face min side.";
  }

  if ((formType === "vectorDot" || formType === "pulseDot" || formType === "lcdDot") && key === "shapeParam") {
    const live = document.getElementById("nodeTraceDisplaySettingsPopover")
      ?.querySelector?.(`[data-trace-display-choice="shape"]`)?.value;
    const shape = typeof normalizeTraceStampShape === "function"
      ? normalizeTraceStampShape(live || "circle")
      : String(live || "circle");
    const meta = typeof traceStampShapeParamMeta === "function"
      ? traceStampShapeParamMeta(shape)
      : null;
    label = meta?.label || "Shape";
    title = meta?.title
      || "Shape parameter 0…1. Meaning depends on Shape.";
  }
  if ((formType === "numberReadout" || formType === "lcdDot") && key === "backgroundSaturation") {
    label = "Sat";
    title = "LCD plate saturation 0…1. 0 = grey at the same brightness; 1 = full selected color.";
  }
  if ((formType === "numberReadout" || formType === "lcdDot") && key === "dot1Saturation") {
    const nodeType = typeof nodeGraphPatchNode === "function"
      && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
      ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())?.type
      : null;
    const lcdInk = formType === "lcdDot"
      || nodeType === "valueLcd"
      || nodeType === "helmholtzPitch"
      || nodeType === "edgeDetector";
    label = "Sat";
    title = lcdInk
      ? "LCD ink saturation 0…1. 0 = grey; 1 = full selected color."
      : "LED color saturation 0…1. 0 = grey at this brightness; 1 = the hue×brightness color (black→hue→white).";
  }
  if (formType === "numberReadout" && key === "dot1Brightness") {
    const nodeType = typeof nodeGraphPatchNode === "function"
      && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
      ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())?.type
      : null;
    if (nodeType === "valueLcd") {
      label = "Ink";
      title = "LCD ink strength 0…1 (how hard the dark digits print on the plate). Also scales deposit energy on digit change.";
    } else {
      label = "LED";
      title = "Live light black→hue→white (0 = black, 0.5 = full Hue, 1 = white). Ghost/Trail stay on the gradient. Also scales deposit energy on digit change.";
    }
  }
  if (formType === "numberReadout" && (key === "ghost" || key === "ghostBrightness")) {
    label = "Ghost";
    title = "Extreme analog (super-exp) residual hang 0…1 (not brightness). With Trail at 0 this is the full hang algorithm. Bright only sets deposit light.";
  }
  if (formType === "numberReadout" && key === "ghostBlend") {
    label = "Ghost blend";
    title = "0…1 all-8 plate under the live digits, colored with Ghost Gradient stop t=0. Residual hang still uses the full gradient.";
  }
  if (formType === "numberReadout" && (key === "trail" || key === "residual")) {
    label = "Trail";
    title = "Mix from Ghost-only toward linear, then freeze. 0 = Ghost only; 0.5 = half linear / half Ghost; 0.75 = full linear; 1 = never decay pixels.";
  }
  if (formType === "numberReadout" && key === "burnAmount") {
    label = "Burn ⨯";
    title = "Deposit energy 0…1 on each number change. 0 = print at 0 brightness (skip). 1 = print at energy 1 (Ghost Gradient stop t=1.0). Live LED Bright is unchanged.";
  }
  if (formType === "numberReadout" && key === "unlitSegments") {
    label = "Ghost";
    title =
      "LCD Ghost: permanent dim all-8 segment plate 0…1. Soft fade from 0 (no hard pop). Not residual hang (LED Trail/Ghost).";
  }
  if (formType === "numberReadout" && key === "facePadding") {
    label = "Padding";
    title = "Linear inset on each axis (half-width / half-height). 0 = no inset; +1 = pin pixel; negative grows digits toward the walls (dial in how close ink meets the plate).";
  }
  if (formType === "numberReadout" && key === "innerShadowDistance") {
    label = "Shadow dist";
    title = "How far the Gaussian inset glass shadow reaches from the plate edge (0 = none, 1 = deep). Dial the “behind a screen” depth.";
  }
  if (formType === "numberReadout" && key === "innerShadowSharpness") {
    label = "Shadow hard";
    title =
      "Shadow hardness 0…1. Soft = wide translucent Gaussian; harder = darker. Full hardness = solid black hard rim.";
  }
  if (formType === "numberReadout" && key === "innerShadowOffsetX") {
    label = "Shadow X";
    title = "Inset shadow horizontal offset −1…1 (0 = centered). Positive darkens the left edge.";
  }
  if (formType === "numberReadout" && key === "innerShadowOffsetY") {
    label = "Shadow Y";
    title = "Inset shadow vertical offset −1…1 (0 = centered). Positive darkens the top edge.";
  }
  const titleAttr = title
    ? ` title="${nodeGraphDisplaySettingsEscapeHtml(title)}"`
    : "";
  const idAttr = meta.id ? ` id="${nodeGraphDisplaySettingsEscapeHtml(meta.id)}"` : "";
  const ariaLabel = String(options.ariaLabel || label || key).trim();
  const ariaAttr = options.hideLabel
    ? ` aria-label="${nodeGraphDisplaySettingsEscapeHtml(ariaLabel)}"`
    : "";
  const labelHtml = options.hideLabel
    ? ""
    : ((key === "historySeconds" || key === "zoomSeconds" || key === "historyHz" || key === "historyCycles")
      ? `<span data-trace-display-history-label>${nodeGraphDisplaySettingsEscapeHtml(label)}</span>`
      : (key === "timeMs" || key === "windowCycles" || key === "windowBeats")
        ? `<span data-trace-display-window-label>${nodeGraphDisplaySettingsEscapeHtml(label)}</span>`
        : `<span>${nodeGraphDisplaySettingsEscapeHtml(label)}</span>`);
  const rowClass = options.hideLabel
    ? "node-trace-display-line-burn-row node-trace-display-stepper-only"
    : "node-trace-display-line-burn-row";
  return `
    <label class="${rowClass}" data-trace-display-control-row>
      ${labelHtml}
      <span class="metadata-stepper-control">
        <button type="button" data-trace-display-step-target="${key}" data-trace-display-step-direction="-1">-</button>
        <input type="text" inputmode="${meta.inputmode || "decimal"}" data-trace-display-field="${key}"${idAttr}${titleAttr}${ariaAttr} readonly>
        <button type="button" data-trace-display-step-target="${key}" data-trace-display-step-direction="1">+</button>
      </span>
    </label>`;
}

function nodeGraphDisplaySettingsStereoPairKey(leftKey) {
  if (leftKey === "dot1Size") {
    return "secondarySize";
  }
  if (leftKey === "lineThickness") {
    return "secondaryLineThickness";
  }
  if (leftKey === "dot1Brightness") {
    return "secondaryBrightness";
  }
  return "";
}

function nodeGraphDisplaySettingsStereoSharedLabel(leftKey) {
  if (leftKey === "dot1Size") {
    return "\u26AA Size";
  }
  if (leftKey === "lineThickness") {
    return "Blur";
  }
  if (leftKey === "dot1Brightness") {
    return "\uD83D\uDCA1 Bright";
  }
  return "";
}

function nodeGraphDisplaySettingsBuildStereoPairRowHtml(leftKey, rightKey, formType = null) {
  const shared = nodeGraphDisplaySettingsStereoSharedLabel(leftKey)
    || (nodeGraphDisplaySettingsFieldMeta[leftKey] || {}).label
    || leftKey;
  return `
    <div class="node-trace-display-lr-row" data-trace-display-lr-row>
      <span class="node-trace-display-lr-shared-label">${nodeGraphDisplaySettingsEscapeHtml(shared)}</span>
      <div class="node-trace-display-lr-pair">
        ${nodeGraphDisplaySettingsBuildStepperRowHtml(leftKey, formType, { hideLabel: true, ariaLabel: `${shared} L` })}
        ${nodeGraphDisplaySettingsBuildStepperRowHtml(rightKey, formType, { hideLabel: true, ariaLabel: `${shared} R` })}
      </div>
    </div>`;
}

/**
 * App-wide hue-title stepper: one horizontal row
 *   [ Title on pure-hue fill (drag = hue) ][ value ][ − ][ + ]
 * Smart black/white title ink keeps the label readable on any hue.
 *
 * @param {{
 *   title: string,
 *   stepField: string,
 *   colorField: string,
 *   titleAttr?: string,
 *   formType?: string,
 *   defaultHueHex?: string,
 * }} options
 */
function nodeGraphHueTitleSatFieldName(stepField) {
  const key = String(stepField || "");
  if (key.endsWith("Brightness")) {
    return `${key.slice(0, -"Brightness".length)}Saturation`;
  }
  return `${key}Saturation`;
}

function nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml(options = {}) {
  const title = String(options.title || "Color");
  const stepField = String(options.stepField || "dot1Brightness");
  const colorField = String(options.colorField || "dot1Color");
  const formType = options.formType || null;
  const meta = nodeGraphDisplaySettingsFieldMeta[stepField] || { inputmode: "decimal" };
  let titleTip = options.titleAttr || "";
  if (!titleTip && formType === "numberReadout" && stepField === "dot1Brightness") {
    titleTip = "LED amount 0…1 (0 black, 0.5 full Hue, 1 white). Drag title strip to change hue.";
  }
  const tipAttr = titleTip
    ? ` title="${nodeGraphDisplaySettingsEscapeHtml(titleTip)}"`
    : "";
  const idAttr = meta.id ? ` id="${nodeGraphDisplaySettingsEscapeHtml(meta.id)}"` : "";
  const colorMeta = nodeGraphDisplaySettingsColorRowMeta(colorField, formType);
  const colorIdAttr = colorMeta.id
    ? ` id="${nodeGraphDisplaySettingsEscapeHtml(colorMeta.id)}"`
    : "";
  const defaultHex = nodeGraphDisplaySettingsEscapeHtml(
    options.defaultHueHex || colorMeta.defaultValue || "#ff0000",
  );
  const satField = String(options.satField || nodeGraphHueTitleSatFieldName(stepField));
  return `
    <div
      class="node-trace-display-hbs-widget"
      data-hbs-widget
      data-trace-display-control-row
      data-hue-title-step-field="${nodeGraphDisplaySettingsEscapeHtml(stepField)}"
      data-hue-title-sat-field="${nodeGraphDisplaySettingsEscapeHtml(satField)}"
      data-hue-title-color-field="${nodeGraphDisplaySettingsEscapeHtml(colorField)}"${tipAttr}>
      <div
        class="node-trace-display-color-widget-host"
        data-trace-display-color-widget="${nodeGraphDisplaySettingsEscapeHtml(colorField)}"
        data-hbs-channels="hbs"
        data-hbs-label="${nodeGraphDisplaySettingsEscapeHtml(title)}"
        role="group"
        aria-label="${nodeGraphDisplaySettingsEscapeHtml(title)}"></div>
      <input type="hidden" data-trace-display-field="${nodeGraphDisplaySettingsEscapeHtml(stepField)}"${idAttr} value="0.5">
      <input type="hidden" data-trace-display-field="${nodeGraphDisplaySettingsEscapeHtml(satField)}" value="1">
      <input type="hidden" data-trace-display-color="${nodeGraphDisplaySettingsEscapeHtml(colorField)}"${colorIdAttr} value="${defaultHex}">
    </div>`;
}

function nodeGraphDisplaySettingsColorRowSizes(count) {
  const n = Math.max(0, Math.round(Number(count) || 0));
  if (n <= 4) {
    return n ? [n] : [];
  }
  const table = {
    5: [3, 2],
    6: [3, 3],
    7: [4, 3],
    8: [4, 4],
    9: [3, 3, 3],
    10: [4, 3, 3],
    11: [4, 4, 3],
    12: [4, 4, 4],
  };
  if (table[n]) {
    return table[n];
  }
  const sizes = [];
  let left = n;
  while (left > 0) {
    if (left === 1) {
      if (sizes.length) {
        sizes[sizes.length - 1] -= 1;
        sizes.push(2);
      } else {
        sizes.push(1);
      }
      break;
    }
    const take = left === 5 ? 3 : Math.min(4, left);
    sizes.push(take);
    left -= take;
  }
  return sizes;
}

function nodeGraphDisplaySettingsHbsRow(cells, options) {
  const list = (Array.isArray(cells) ? cells : [cells]).filter(Boolean);
  if (!list.length) {
    return "";
  }
  const n = list.length;
  if (n > 4) {
    return nodeGraphDisplaySettingsColorRows(list);
  }
  // One colour is a half-width cell by default; options.fullWidth makes it span the row (Vector RGB's background).
  const cols = n === 1 && !options?.fullWidth ? 2 : n;
  return `<div class="node-trace-display-hbs-row" style="--color-row-cells:${cols}" data-color-row-cells="${n}">${list.join("")}</div>`;
}

function nodeGraphDisplaySettingsColorRows(cells, groups, options) {
  const list = (Array.isArray(cells) ? cells : [cells]).filter(Boolean);
  if (!list.length) {
    return "";
  }
  let chunks;
  if (Array.isArray(groups) && groups.length) {
    if (Array.isArray(groups[0])) {
      chunks = groups.map((group) => (Array.isArray(group) ? group : [group]).filter(Boolean));
    } else {
      let i = 0;
      chunks = groups.map((size) => {
        const n = Math.max(0, Math.round(Number(size) || 0));
        const slice = list.slice(i, i + n);
        i += n;
        return slice;
      }).filter((slice) => slice.length);
    }
  } else {
    const sizes = nodeGraphDisplaySettingsColorRowSizes(list.length);
    let i = 0;
    chunks = sizes.map((size) => {
      const slice = list.slice(i, i + size);
      i += size;
      return slice;
    });
  }
  for (let c = 0; c < chunks.length; c += 1) {
    const n = chunks[c].length;
    if (n >= 5) {
      throw new Error(`color row has ${n} cells; rows are 2 to 4 (or one half-width cell)`);
    }
  }
  return chunks.map((chunk) => nodeGraphDisplaySettingsHbsRow(chunk, options)).join("");
}


function nodeGraphDisplaySettingsBuildToggleRowHtml(key) {
  const meta = nodeGraphDisplaySettingsToggleMeta[key] || { label: key };
  const idAttr = meta.id ? ` id="${nodeGraphDisplaySettingsEscapeHtml(meta.id)}"` : "";
  if (key === "buildUp") {
    // Build up is the "build" planet on the dot stage: just the hidden checkbox the form reads and writes.
    return `<input type="checkbox" hidden data-trace-display-toggle="${key}"${idAttr}>`;
  }
  const titleAttr = meta.title
    ? ` title="${nodeGraphDisplaySettingsEscapeHtml(meta.title)}"`
    : "";
  return `
    <label class="metadata-checkbox-label" data-trace-display-control-row${titleAttr}>
      <input type="checkbox" data-trace-display-toggle="${key}"${idAttr}${titleAttr}>
      ${nodeGraphDisplaySettingsEscapeHtml(meta.label)}
    </label>`;
}

/** Packing row on phosphor faces: Sync (1D) + Clear only. */
const NODE_GRAPH_DISPLAY_PACKING_TOGGLE_KEYS = Object.freeze([
  "sourceSync",
]);

/**
 * Sync | Clear — continuous packing is always on (no Full Dots / Dots only).
 */
function nodeGraphDisplaySettingsBuildPackingToggleRowHtml(keys) {
  const latch = typeof AppLatchButton !== "undefined" ? AppLatchButton : null;
  const buttons = (keys || []).map((key) => {
    const meta = nodeGraphDisplaySettingsToggleMeta[key] || { label: key };
    return {
      label: meta.label || key,
      title: meta.title || "",
      id: meta.id || "",
      toggleKey: key,
      on: false,
      className: "node-trace-display-packing-latch",
    };
  });
  // Clear is always last: restart burn-in / Scan Grid plate.
  // Multi-select: wipes every display currently targeted by this panel.
  buttons.push({
    label: "Clear",
    title:
      "Wipe the selected face(s) — phosphor residual or Scan Grid plate. "
      + "When several modules share this Display Settings panel, clears all of them.",
    id: "nodeTraceDisplayClearPhosphor",
    action: "clearPhosphor",
    className: "node-trace-display-packing-latch node-trace-display-clear-phosphor",
  });
  if (latch && typeof latch.buildRowHtml === "function") {
    return latch.buildRowHtml(buttons, "node-trace-display-packing-toggles");
  }
  // Fallback if latch-button.js not loaded yet.
  const cells = buttons.map((opts) => {
    if (opts.action) {
      return (
        `<button type="button" class="app-latch-button node-trace-display-packing-latch"`
        + ` data-latch-button="true" data-latch-mode="action" data-trace-display-action="${opts.action}"`
        + ` title="${nodeGraphDisplaySettingsEscapeHtml(opts.title || "")}">`
        + `<span class="app-latch-button-label">${nodeGraphDisplaySettingsEscapeHtml(opts.label)}</span>`
        + `</button>`
      );
    }
    return (
      `<button type="button" class="app-latch-button node-trace-display-packing-latch is-off"`
      + ` data-latch-button="true" data-latch-mode="latch" data-trace-display-toggle="${opts.toggleKey}"`
      + ` aria-pressed="false" data-latch-on="0"`
      + ` title="${nodeGraphDisplaySettingsEscapeHtml(opts.title || "")}"`
      + (opts.id ? ` id="${nodeGraphDisplaySettingsEscapeHtml(opts.id)}"` : "")
      + `>`
      + `<span class="app-latch-button-label">${nodeGraphDisplaySettingsEscapeHtml(opts.label)}</span>`
      + `</button>`
    );
  }).join("");
  const cols = Math.max(1, buttons.length);
  return (
    `<div class="app-latch-button-row node-trace-display-packing-toggles"`
    + ` data-latch-button-row data-trace-display-control-row`
    + ` style="--latch-cols:${cols};grid-template-columns:repeat(${cols},minmax(0,1fr))">`
    + `${cells}</div>`
  );
}


function nodeGraphDisplaySettingsBuildChoiceRowHtml(key) {
  const meta = nodeGraphDisplaySettingsChoiceMeta[key];
  if (!meta) {
    return "";
  }
  const idAttr = meta.id ? ` id="${nodeGraphDisplaySettingsEscapeHtml(meta.id)}"` : "";
  const options = (meta.options || [])
    .map((option) => (
      `<option value="${nodeGraphDisplaySettingsEscapeHtml(option.value)}">${nodeGraphDisplaySettingsEscapeHtml(option.label)}</option>`
    ))
    .join("");
  if (key === "drawMode") {
    // Draw is four square buttons inside the dot preview area (nodeGraphDrawButtonsHtml); the select stays here, hidden,
    // as the value the form reads and writes.
    return `
    <div hidden data-trace-display-choice-row="${key}"><select hidden data-trace-display-choice="${key}"${idAttr} aria-label="${nodeGraphDisplaySettingsEscapeHtml(meta.aria || meta.label)}">${options}</select></div>`;
  }
  return `
    <label class="node-trace-display-line-burn-row" data-trace-display-control-row data-trace-display-choice-row="${key}">
      <span>${nodeGraphDisplaySettingsEscapeHtml(meta.label)}</span>
      <select data-trace-display-choice="${key}"${idAttr} aria-label="${nodeGraphDisplaySettingsEscapeHtml(meta.aria || meta.label)}">
        ${options}
      </select>
    </label>`;
}

/** Four flat square Draw buttons (a word and a tiny graphic each); they sit at the top of the dot preview area. */
function nodeGraphDrawButtonsHtml() {
  const meta = nodeGraphDisplaySettingsChoiceMeta.drawMode;
  if (!meta) {
    return "";
  }
  const tips = {
    budget: "Budget: spends the dots on a solid line and stops.",
    length: "Length: skips samples and draws dots across the full path.",
    dots: "Dots: stamps each sample.",
    lines: "Line: connects each sample to the next.",
  };
  const glyphs = {
    // a solid line that ends in a dot
    budget: '<svg viewBox="0 0 40 14" aria-hidden="true"><rect x="3" y="5.5" width="20" height="3" fill="currentColor"/><circle cx="33" cy="7" r="3.4" fill="currentColor"/></svg>',
    // dots spread across the whole width
    length: '<svg viewBox="0 0 40 14" aria-hidden="true"><circle cx="5" cy="7" r="2.2" fill="currentColor"/><circle cx="15" cy="7" r="2.2" fill="currentColor"/><circle cx="25" cy="7" r="2.2" fill="currentColor"/><circle cx="35" cy="7" r="2.2" fill="currentColor"/></svg>',
    // a dot
    dots: '<svg viewBox="0 0 40 14" aria-hidden="true"><circle cx="20" cy="7" r="3.4" fill="currentColor"/></svg>',
    // a line
    lines: '<svg viewBox="0 0 40 14" aria-hidden="true"><rect x="4" y="5.5" width="32" height="3" fill="currentColor"/></svg>',
  };
  const buttons = (meta.options || [])
    .map((option) => (
      `<button type="button" class="node-trace-display-draw-button" data-draw-mode-button="${nodeGraphDisplaySettingsEscapeHtml(option.value)}" title="${nodeGraphDisplaySettingsEscapeHtml(tips[option.value] || option.label)}"><span>${nodeGraphDisplaySettingsEscapeHtml(option.value === "lines" ? "line" : String(option.label).toLowerCase())}</span>${glyphs[option.value] || ""}</button>`
    ))
    .join("");
  // Build up: a planet (a ring, with a disc in it when on) in the same row. A toggle: one click flips it.
  const build = '<button type="button" class="node-trace-display-draw-button node-trace-display-build-button" data-build-button aria-pressed="false" title="Build up: on, repeated hits on a pixel add up toward full brightness; off, a pixel never gets brighter than one dab."><span>build</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><circle class="build-core" cx="12" cy="12" r="6" fill="currentColor"/></svg></button>';
  return `<div class="node-trace-display-draw-row" data-draw-row><div class="node-trace-display-draw-buttons" role="group" aria-label="${nodeGraphDisplaySettingsEscapeHtml(meta.aria || meta.label)}">${build}${buttons}</div></div>`;
}

/** Mark the Draw button that matches the hidden select (hide the Draw buttons when this display has no Draw choice) and
 * the build planet that matches Build up. */
function nodeGraphDrawButtonsSync(root) {
  const row = root?.querySelector?.("[data-draw-row]");
  if (!row) {
    return;
  }
  const select = root.querySelector('[data-trace-display-choice="drawMode"]');
  for (const button of root.querySelectorAll("[data-draw-mode-button]")) {
    button.hidden = !select;
    const on = !!select && button.getAttribute("data-draw-mode-button") === select.value;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const buildBox = root.querySelector('[data-trace-display-toggle="buildUp"]');
  const buildButton = root.querySelector("[data-build-button]");
  if (buildButton) {
    buildButton.hidden = !buildBox;
    const lit = !!buildBox?.checked;
    buildButton.classList.toggle("is-on", lit);
    buildButton.setAttribute("aria-pressed", lit ? "true" : "false");
  }
}

// One delegated handler for the Draw buttons (set the hidden select, fire its change event) and the build planet.
if (typeof document !== "undefined" && !globalThis.__nodeGraphDrawButtonsBound) {
  globalThis.__nodeGraphDrawButtonsBound = true;
  document.addEventListener("click", (event) => {
    const buildButton = event.target?.closest?.("[data-build-button]");
    if (buildButton) {
      const root = buildButton.closest("#nodeTraceDisplaySettingsPopover") || document;
      const box = root.querySelector('[data-trace-display-toggle="buildUp"]');
      if (box) {
        box.checked = !box.checked;
        if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") markNodeGraphTraceDisplaySettingsDirty("buildUp");
        applyNodeGraphTraceDisplaySettingsForm({ persist: "immediate", record: true });
        nodeGraphDrawButtonsSync(root);
      }
      return;
    }
    const button = event.target?.closest?.("[data-draw-mode-button]");
    if (!button) {
      return;
    }
    const root = button.closest("#nodeTraceDisplaySettingsPopover") || document;
    const select = root.querySelector('[data-trace-display-choice="drawMode"]');
    if (!select) {
      return;
    }
    const value = button.getAttribute("data-draw-mode-button");
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    nodeGraphDrawButtonsSync(root);
  });
}

/**
 * Switch row: every option of a small choice visible at once (segmented,
 * app-latch-button look). The hidden <select> stays the value carrier, so the
 * form read / write and the popover input / change commit are unchanged.
 * options.sideHtml: extra cell(s) at the row end (Plot: the Sync latch).
 */
function nodeGraphDisplaySettingsBuildSwitchRowHtml(key, options = {}) {
  const meta = nodeGraphDisplaySettingsChoiceMeta[key];
  if (!meta) {
    return "";
  }
  const esc = nodeGraphDisplaySettingsEscapeHtml;
  const label = options.label || meta.label;
  const titleAttr = meta.title ? ` title="${esc(meta.title)}"` : "";
  const idAttr = meta.id ? ` id="${esc(meta.id)}"` : "";
  const list = meta.options || [];
  const short = options.labels || {};
  const buttons = list.map((option) => (
    `<button type="button" class="app-latch-button node-trace-display-switch-option is-off" aria-pressed="false"`
    + ` data-trace-display-switch-option="${esc(option.value)}">`
    + `<span class="app-latch-button-label">${esc(short[option.value] || option.label)}</span></button>`
  )).join("");
  const selectOptions = list
    .map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`)
    .join("");
  return `
    <div class="node-trace-display-line-burn-row node-trace-display-switch-row" data-trace-display-control-row data-trace-display-choice-row="${key}" data-trace-display-switch-for="${key}"${titleAttr}>
      <span>${esc(label)}</span>
      <span class="node-trace-display-switch-cells">
        <span class="app-latch-button-row node-trace-display-switch" role="group" aria-label="${esc(meta.aria || meta.label)}" style="--latch-cols:${Math.max(1, list.length)};grid-template-columns:repeat(${Math.max(1, list.length)},minmax(0,1fr))">${buttons}</span>
        ${options.sideHtml || ""}
      </span>
      <select hidden data-trace-display-choice="${key}"${idAttr} aria-hidden="true" tabindex="-1">${selectOptions}</select>
    </div>`;
}

/** Light the switch option that matches each hidden select. */
function nodeGraphDisplaySettingsSyncSwitches(root) {
  const host = root || document.getElementById("nodeTraceDisplaySettingsPopover");
  const rows = [...(host?.querySelectorAll?.("[data-trace-display-switch-for]") || [])];
  if (host?.matches?.("[data-trace-display-switch-for]")) rows.push(host);
  for (const row of rows) {
    const select = row.querySelector("select[data-trace-display-choice]");
    const value = select ? String(select.value) : "";
    for (const button of row.querySelectorAll("[data-trace-display-switch-option]")) {
      const on = button.getAttribute("data-trace-display-switch-option") === value;
      button.classList.toggle("is-on", on);
      button.classList.toggle("is-off", !on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }
}

if (typeof document !== "undefined" && !globalThis.__nodeGraphDisplaySwitchBound) {
  globalThis.__nodeGraphDisplaySwitchBound = true;
  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-trace-display-switch-option]");
    if (!button) return;
    const row = button.closest("[data-trace-display-switch-for]");
    const select = row?.querySelector("select[data-trace-display-choice]");
    if (!select) return;
    const value = button.getAttribute("data-trace-display-switch-option");
    if (select.value === value) return;
    select.value = value;
    nodeGraphDisplaySettingsSyncSwitches(row);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/**
 * 1D Plot / 1D Plot Stereo / 2D Plot panel, grouped by purpose:
 *   Window  Cycles | Time (+ Sync), the window amount
 *   Signal  Gain, Offset
 *   Line    Draw, Ink (1D plots), Skip discontinuities (wide latch), Thickness + Blur
 * Colours follow in the shared colour section.
 */
function nodeGraphPlotDisplaySettingsRows(type, choiceKeys, toggleKeys, fieldKeys) {
  const rows = [];
  const sub = (text) => `<div class="node-trace-display-subsection-title">${nodeGraphDisplaySettingsEscapeHtml(text)}</div>`;
  const hasChoice = (key) => choiceKeys.includes(key);
  const hasToggle = (key) => toggleKeys.includes(key);
  const hasField = (key) => fieldKeys.includes(key);
  // Window: the mode switch, with Sync beside it (1D Plot) or its own
  // Off / Left / Right / Mono switch (1D Plot Stereo, 2D Plot).
  rows.push(sub("Window"));
  const syncLatch = hasToggle("sourceSync") && typeof AppLatchButton !== "undefined"
    ? AppLatchButton.buildHtml({
      label: (nodeGraphDisplaySettingsToggleMeta.sourceSync || {}).label || "Sync",
      title: (nodeGraphDisplaySettingsToggleMeta.sourceSync || {}).title || "",
      toggleKey: "sourceSync",
      on: false,
      className: "node-trace-display-switch-side",
    })
    : "";
  if (hasChoice("windowMode")) {
    rows.push(nodeGraphDisplaySettingsBuildSwitchRowHtml("windowMode", { sideHtml: syncLatch }));
  }
  if (hasChoice("syncChannel")) {
    rows.push(nodeGraphDisplaySettingsBuildSwitchRowHtml("syncChannel", { label: "Sync" }));
  }
  const windowKey = fieldKeys.find((key) => key === "timeMs" || key === "windowCycles" || key === "windowBeats");
  if (windowKey) rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(windowKey, type));
  // Signal: how the samples map onto the face.
  rows.push(sub("Signal"));
  for (const key of ["scale", "plotOffset"]) {
    if (hasField(key)) rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type));
  }
  // Line: how the samples are drawn.
  rows.push(sub("Line"));
  if (hasChoice("plotDraw")) rows.push(nodeGraphDisplaySettingsBuildSwitchRowHtml("plotDraw"));
  if (hasChoice("barInk")) {
    rows.push(nodeGraphDisplaySettingsBuildSwitchRowHtml("barInk", { labels: { stroke: "Stroke", fill: "Fill", both: "Both" } }));
  }
  if (hasToggle("skipDiscontinuities") && typeof AppLatchButton !== "undefined") {
    const meta = nodeGraphDisplaySettingsToggleMeta.skipDiscontinuities || {};
    rows.push(AppLatchButton.buildRowHtml([{
      label: meta.label || "Skip discontinuities",
      title: meta.title || "",
      toggleKey: "skipDiscontinuities",
      on: false,
      className: "node-trace-display-wide-latch",
    }], "node-trace-display-wide-latch-row"));
  }
  const lineKeys = ["lineThickness", "lineSmoothing"].filter(hasField);
  if (lineKeys.length) {
    rows.push(`<div class="node-trace-display-pair-grid">${lineKeys.map((key) => nodeGraphDisplaySettingsBuildStepperRowHtml(key, type)).join("")}</div>`);
  }
  return rows;
}

function nodeGraphDisplaySettingsColorRowMeta(key, formType = null, options = {}) {
  let base = nodeGraphDisplaySettingsColorMeta[key] || {
    label: "",
    aria: key,
    defaultValue: "#ffffff",
  };
  // Never a side "Color |" column — one contiguous widget row app-wide.
  let aria = base.aria || key;
  if (formType === "pitchModWheelFace") {
    const label = typeof nodeGraphPitchModWheelColorLabel === "function" ? nodeGraphPitchModWheelColorLabel(key) : "";
    const defaults = typeof NODE_GRAPH_PITCH_MOD_WHEEL_DISPLAY_DEFAULTS !== "undefined" ? NODE_GRAPH_PITCH_MOD_WHEEL_DISPLAY_DEFAULTS : {};
    if (label) {
      aria = `${label} color`;
      base = { ...base, label, defaultValue: defaults[key] || base.defaultValue };
    }
  }
  if (formType === "pitchQuantizerFace") {
    const labels = {
      enabledColor: "Enabled",
      playingColor: "Playing",
      naturalColor: "Natural",
      sharpColor: "Sharp",
    };
    const defaults = typeof NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS !== "undefined"
      ? NODE_GRAPH_PITCH_QUANTIZER_DISPLAY_DEFAULTS
      : {
        enabledColor: "#3dffd0",
        playingColor: "#ffcf6b",
        naturalColor: "#20252a",
        sharpColor: "#f7f2e8",
      };
    if (labels[key]) {
      aria = `${labels[key]} color`;
      base = { ...base, label: labels[key], defaultValue: defaults[key] };
    }
  } else
  if (formType === "pluckHitFace" && (key === "backgroundColor" || key === "barColor" || key === "lightColor" || key === "textColor")) {
    const labels = { backgroundColor: "Background", barColor: "Curve", lightColor: "Live", textColor: "Text" };
    const defaults = { backgroundColor: "#05080b", barColor: "#7fc7d9", lightColor: "#ffd27a", textColor: "#8b9daa" };
    base = { ...base, label: labels[key], defaultValue: defaults[key] };
    aria = `${labels[key]} color`;
  } else
  if (formType === "roundingErrorFace" && (key === "backgroundColor" || key === "barColor" || key === "textColor")) {
    const labels = { backgroundColor: "Background", barColor: "Bars", textColor: "Text" };
    const defaults = { backgroundColor: "#06080c", barColor: "#e2b44a", textColor: "#7fc7d9" };
    base = { ...base, label: labels[key], defaultValue: defaults[key] };
    aria = `${labels[key]} color`;
  } else
  if (formType === "vactrolScope" && (key === "backgroundColor" || key === "lightColor" || key === "fltEnvColor" || key === "ampEnvColor" || key === "memColor")) {
    const labels = { backgroundColor: "Background", lightColor: "Light", fltEnvColor: "Flt Env", ampEnvColor: "Amp Env", memColor: "Mem" };
    const defaults = { backgroundColor: "#020609", lightColor: "#c5e07a", fltEnvColor: "#7fc7d9", ampEnvColor: "#e2a86d", memColor: "#c8c8d2" };
    aria = key === "backgroundColor" ? "Background color" : labels[key] + " line color";
    base = { ...base, label: labels[key], defaultValue: defaults[key] };
  } else if (formType === "numberReadout" && key === "dot1Color") {
    const nodeType = typeof nodeGraphPatchNode === "function"
      && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
      ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())?.type
      : null;
    aria = nodeType === "valueLcd"
      ? "LCD Value foreground (digit ink) color"
      : "LED Value digit hue; LED amount maps grey → full hue → white";
  } else if (formType === "numberReadout" && key === "backgroundColor") {
    aria = "Value face background color";
  } else if (formType === "knobFace" && key === "backgroundColor") {
    aria = "Knob face background";
  } else if (formType === "knobFace" && key === "arcFill") {
    aria = "Knob arc fill (value)";
  } else if (formType === "knobFace" && key === "arcTrack") {
    aria = "Knob arc track (unfilled)";
  } else if (formType === "knobFace" && key === "textColor") {
    aria = "Knob label and value text";
    base = { ...base, defaultValue: "#d8d2c4" };
  } else if (formType === "pluginSliderFace" && key === "arcTrack") {
    aria = "Slider track (unfilled)";
  } else if (formType === "keypadFace" && key === "backgroundColor") {
    aria = "Keypad background color";
    base = { ...base, defaultValue: "#f4f3f0" };
  } else if (formType === "keypadFace" && key === "buttonColor") {
    aria = "Keypad button color";
    base = { ...base, defaultValue: "#f3f1ec" };
  } else if (formType === "keypadFace" && key === "hoverColor") {
    aria = "Keypad mouse hover color";
    base = { ...base, defaultValue: "#ddd9d2" };
  } else if (formType === "keypadFace" && key === "downColor") {
    aria = "Keypad mouse down color";
    base = { ...base, defaultValue: "#c4bdb3" };
  } else if ((formType === "toggleButtonFace" || formType === "momentaryButtonFace") && key === "textColor") {
    aria = "Button text color";
    base = { ...base, defaultValue: "#f4f7f8" };
  } else if (formType === "keypadFace" && key === "textColor") {
    aria = "Keypad text color";
  } else if (formType === "keypadFace" && key === "strokeColor") {
    aria = "Keypad stroke color";
  } else if (formType === "additiveWaveform" && key === "backgroundColor") {
    aria = "Additive waveform background color";
    base = { ...base, defaultValue: "#050508" };
  } else if (formType === "additiveWaveform" && key === "strokeColor") {
    aria = "Additive waveform line color";
    base = { ...base, defaultValue: "#ffd228" };
  } else if ((formType === "roundShapeFace" || formType === "basicShapeFace" || formType === "blitFace" || formType === "sinCosFace") && key === "backgroundColor") {
    aria = "RoundShape background color";
    base = { ...base, defaultValue: "#020609" };
  } else if ((formType === "roundShapeFace" || formType === "basicShapeFace" || formType === "blitFace" || formType === "sinCosFace") && key === "strokeColor") {
    aria = "RoundShape foreground / stroke color";
    base = { ...base, defaultValue: "#78dcc8" };
  } else if ((formType === "roundShapeFace" || formType === "basicShapeFace" || formType === "blitFace" || formType === "sinCosFace") && key === "dotColor") {
    aria = "RoundShape cursor dot color";
    base = { ...base, defaultValue: "#ffffff" };
  } else if (formType === "limiterGainFace" && key === "backgroundColor") {
    aria = "Limiter gain face background color";
    base = { ...base, defaultValue: "#020407" };
  } else if (formType === "textBoxFace" && key === "backgroundColor") {
    aria = "Text Box background color";
    base = { ...base, defaultValue: "#020407" };
  } else if (formType === "rasterRgbFace" && key === "backgroundColor") {
    aria = "Scan Grid background color";
    base = { ...base, defaultValue: "#000000" };
  } else if (formType === "waterfall" && options.xyz && key === "dot1Color") {
    aria = "X";
    base = { ...base, defaultValue: "#ff0000" };
  } else if (formType === "waterfall" && options.xyz && key === "secondaryColor") {
    aria = "Y";
    base = { ...base, defaultValue: "#0000ff" };
  } else if (formType === "waterfall" && options.xyz && key === "tertiaryColor") {
    aria = "Z";
    base = { ...base, defaultValue: "#00ff00" };
  } else if (formType === "waterfall" && options.stereo && key === "dot1Color") {
    aria = "Left";
    base = { ...base, defaultValue: "#ff0000" };
  } else if (formType === "waterfall" && options.stereo && key === "secondaryColor") {
    aria = "Right";
    base = { ...base, defaultValue: "#0000ff" };
  } else if (formType === "scope2dTrace" && key === "secondaryColor") {
    aria = "Low-brightness end of the beam gradient";
    base = { ...base, defaultValue: "#0000ff" };
  } else if ((formType === "waterfall" || formType === "waterfallRgb" || formType === "waterfallXyz") && key === "backgroundColor") {
    aria = "Background";
    base = { ...base, defaultValue: "#000000" };
  } else if ((formType === "waterfall" || formType === "waterfallRgb" || formType === "waterfallXyz") && key === "dot1Color") {
    aria = "Left";
    base = { ...base, defaultValue: "#ff0000" };
  } else if ((formType === "waterfall" || formType === "waterfallRgb" || formType === "waterfallXyz") && key === "secondaryColor") {
    aria = "Right";
    base = { ...base, defaultValue: "#0000ff" };
  } else if (formType === "waterfall" && (key === "strokeLeftColor" || key === "strokeRightColor")) {
    aria = typeof nodeGraphTraceDisplayColorWidgetLabel === "function"
      ? `${nodeGraphTraceDisplayColorWidgetLabel(key)} color`
      : (key === "strokeLeftColor" ? "Left stroke color" : "Right stroke color");
    base = { ...base, defaultValue: "#ffffff" };
  } else if (key === "strokeColor" && (formType === "waterfall" || formType === "waterfallRgb" || formType === "waterfallXyz")) {
    aria = "Stroke color";
    base = { ...base, defaultValue: "#ffffff" };
  } else if (key === "strokeColor") {
    aria = "Stroke color";
    base = { ...base, caption: "Stroke", defaultValue: "#ffffff" };
  } else if (formType === "textBoxFace" && key === "textColor") {
    aria = "Text Box text color";
    base = { ...base, defaultValue: "#f3f1ec" };
  }
  return {
    ...base,
    label: "",
    aria,
    sideLabel: false,
  };
}


const NODE_GRAPH_TRACE_STEREO_COLOR_ORDER = Object.freeze([
  "dot1Color",
  "secondaryColor",
  "backgroundColor",
]);

function nodeGraphDisplaySettingsShowsStampPreview(type) {
  return type === "vectorDot"
    || type === "pulseDot"
    || type === "lcdDot"
    || type === "dot"
    || (typeof nodeGraphDisplaySettingsIsVectorTraceFormType === "function"
      && nodeGraphDisplaySettingsIsVectorTraceFormType(type))
    || (typeof nodeGraphDisplaySettingsIsPhosphorFormType === "function"
      && nodeGraphDisplaySettingsIsPhosphorFormType(type));
}

function nodeGraphStampPreviewHtml(stereo = false, kind = "waterfall", xyz = false, rgb = false) {
  // Phosphor beams (not the LUT dot) get the interactive Glow rings over the preview.
  const hasRings = nodeGraphDotStageFormType(kind);
  const ringsHtml = `<canvas class="node-trace-display-dot-rings" data-dot-rings width="192" height="192"
          aria-label="Drag a ring to change its setting: outer to inner, size, halo, glow, core (the form shows the ones it has)."
          title="Drag a ring outward for more, inward for less. Outer to inner: size, halo (dotted), glow (dotted), core (a face shows only the rings it has). The rings stay put, the dot changes."></canvas>`;
  const canvas = (side, label) => `
      <div class="node-trace-display-preview-cell">
        ${side ? `<span class="node-trace-display-preview-side-label" data-preview-side-label="${side}">${label}</span>` : ""}
        <canvas
          class="node-trace-display-dot-preview"
          data-stamp-preview-canvas
          ${side ? `data-preview-side="${side}"` : ""}
          width="192"
          height="192"
          aria-label="${side ? `${label} size, blur, and pixel density preview` : "Stamp size, blur, and pixel density preview"}"></canvas>${!side && hasRings ? ringsHtml : ""}
      </div>`;
  if (rgb) {
    // Labels follow CMY checkbox when the form has already loaded settings;
    // paint path also remaps gun colors from settings.cmyMode.
    return `
    <div class="node-trace-display-preview-shell is-rgb" data-stamp-preview="${kind}" data-preview-rgb="1">
      ${canvas("GunR", "R/C")}
      ${canvas("GunG", "G/M")}
      ${canvas("GunB", "B/Y")}
    </div>`;
  }
  if (xyz) {
    return `
    <div class="node-trace-display-preview-shell is-xyz" data-stamp-preview="${kind}" data-preview-xyz="1">
      ${canvas("X", "X")}
      ${canvas("Y", "Y")}
      ${canvas("Z", "Z")}
    </div>`;
  }
  if (stereo) {
    return `
    <div class="node-trace-display-preview-shell is-stereo" data-stamp-preview="${kind}" data-preview-stereo="1">
      ${canvas("L", "L")}
      ${canvas("R", "R")}
    </div>`;
  }
  const shellHtml = `
    <div class="node-trace-display-preview-shell" data-stamp-preview="${kind}">
      ${canvas("", "")}
    </div>`;
  if (!hasRings) {
    return shellHtml;
  }
  // Dot stage: light gauges | the dot | time gauges.
  return `
    <div class="node-trace-display-dot-area">
      ${nodeGraphDrawButtonsHtml()}
      <div class="node-trace-display-dot-stage">
        <canvas class="node-trace-display-dot-hud" data-dot-hud="left" width="32" height="170" aria-label="Bright: drag the bar"></canvas>
        ${shellHtml}
        <canvas class="node-trace-display-dot-hud" data-dot-hud="right" width="112" height="170" aria-label="Trail, ghost, decay blur and burn: drag a bar"></canvas>
      </div>
    </div>`;
}

function nodeGraphStampPreviewUnit(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const fb = Number(fallback);
    return Math.max(0, Math.min(1, Number.isFinite(fb) ? fb : 0));
  }
  return Math.max(0, Math.min(1, n));
}

function nodeGraphStampPreviewParseHex(hex, fallback = [255, 255, 255]) {
  const s = String(hex || "").replace("#", "");
  if (s.length < 6) {
    return fallback;
  }
  const r = Number.parseInt(s.slice(0, 2), 16);
  const g = Number.parseInt(s.slice(2, 4), 16);
  const b = Number.parseInt(s.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) {
    return fallback;
  }
  return [r, g, b];
}

/** Live module face buffer min-side. Never the preview plate. */
function nodeGraphStampPreviewFaceMinSide(settings) {
  const nodeId = String(nodeGraphMvp?.traceDisplaySettingsTargetNode || "").trim();
  if (nodeId && typeof nodeGraphModuleScopePersistentCanvases !== "undefined") {
    const face = nodeGraphModuleScopePersistentCanvases.get?.(nodeId);
    const w = Number(face?.width);
    const h = Number(face?.height);
    if (w > 0 && h > 0) {
      return Math.min(w, h);
    }
  }
  const density = typeof nodeGraphFacePlateDensity === "function"
    ? nodeGraphFacePlateDensity(settings, 1)
    : nodeGraphStampPreviewUnit(settings?.pixelDensity, 1);
  const dpr = Math.max(1, nodeGraphFiniteNumber(window.devicePixelRatio, 1));
  return Math.max(1, Math.round(128 * dpr * Math.max(0, density)));
}

/** Halo extent in face-buffer px so the full stamp (core + Blur) fits. */
function nodeGraphStampPreviewExtent(radius, blur01, phosphor) {
  const r = Math.max(0, nodeGraphFiniteNumber(radius));
  const blur = nodeGraphStampPreviewUnit(blur01, 0);
  if (phosphor) {
    return r * (1.2 + 5.3 * blur) + 1.5 * (1 - blur);
  }
  return r * (1 + 2 * blur);
}

/**
 * Preview plate size — FIXED square.
 * Stereo L/R and XYZ X/Y/Z must not shrink with column count (that made XYZ
 * previews look like a different design than stereo).
 */
function nodeGraphStampPreviewPlateSize(_canvas) {
  const side = 192;
  return { width: side, height: side };
}

/** Channel color for Instant Waterfall stamp preview (same mapping as waterfall ink). */
function nodeGraphStampPreviewTraceColor(settings, side, kind = "waterfall") {
  // RGB waterfall: fixed guns (never reuse stereo "R" → blue mapping).
  if (kind === "waterfallRgb" || side === "GunR" || side === "GunG" || side === "GunB") {
    const cmy = settings?.cmyMode === true;
    if (side === "GunG" || side === "G") return cmy ? "#ff00ff" : "#00ff00";
    if (side === "GunB" || side === "B") return cmy ? "#ffff00" : "#0000ff";
    return cmy ? "#00ffff" : "#ff0000";
  }
  if (side === "R" || side === "Y") {
    return settings.secondaryColor || "#0000ff";
  }
  if (side === "Z") {
    return settings.tertiaryColor || "#00ff00";
  }
  if (side === "L" || side === "X") {
    return settings.dot1Color || settings.color || "#ff0000";
  }
  return settings.dot1Color || settings.color || "#ffffff";
}

/** Size + color + blur (+ bright for RGB guns) for Instant Waterfall stamp preview. */
function nodeGraphStampPreviewTraceInk(settings, side, kind = "waterfall") {
  const right = side === "R";
  const rgb = kind === "waterfallRgb" || String(side || "").startsWith("Gun");
  const instant = kind === "waterfall" || kind === "waterfallRgb" || kind === "waterfallXyz"
    || rgb || side === "L" || side === "X" || side === "Y" || side === "Z";
  const sizeRaw = right
    ? (settings.secondarySize ?? settings.dot1Size ?? settings.size)
    : (settings.dot1Size ?? settings.size);
  const size = instant && typeof nodeGraphTraceDisplayNormalizeInkPx === "function"
    ? nodeGraphTraceDisplayNormalizeInkPx(sizeRaw, 2)
    : (instant && typeof nodeGraphTraceDisplayClampInkPx === "function"
      ? nodeGraphTraceDisplayClampInkPx(sizeRaw)
      : nodeGraphStampPreviewUnit(sizeRaw, 0));
  return {
    size,
    color: nodeGraphStampPreviewTraceColor(settings, side, kind),
    blur: instant ? nodeGraphStampPreviewUnit(settings.lineThickness, 0) : 0,
    bright: rgb
      ? nodeGraphStampPreviewUnit(settings.dot1Brightness ?? settings.brightness, 1)
      : 1,
  };
}

/**
 * GL stamp plate: plate rect + one SDF dot stamp through the number-readout
 * pen (TraceDotSprite.drawTarget). stamp(pen) returns "ok"|"loading"|"failed".
 */
function nodeGraphStampPreviewPenPlate(canvas, bgHex, stamp) {
  const pen = nodeGraphNumberReadoutGlBeginFace(canvas);
  if (!pen) {
    return;
  }
  const bg = nodeGraphStampPreviewParseHex(bgHex, [2, 4, 5]);
  nodeGraphNumberReadoutGlPenRect(pen, 0, 0, canvas.width, canvas.height, bg, 1);
  nodeGraphNumberReadoutGlPenFlush(pen);
  const r = stamp ? stamp(pen) : "ok";
  if (r === "failed") {
    nodeGraphDisplayGlFailed(canvas, "stamp preview: dot GLSL failed");
    return;
  }
  nodeGraphNumberReadoutGlEndFace(canvas, pen);
  if (r === "loading" && !canvas._stampPreviewRetry) {
    // Shader still compiling: repaint once it is ready.
    canvas._stampPreviewRetry = true;
    requestAnimationFrame(() => {
      canvas._stampPreviewRetry = false;
      if (typeof canvas._stampPreviewRepaint === "function") canvas._stampPreviewRepaint();
    });
  }
}

function paintNodeGraphStampPreviewCanvas(canvas, settings = {}, side = "", kind = "waterfall") {
  if (!canvas) {
    return;
  }
  const plate = nodeGraphStampPreviewPlateSize(canvas);
  if (canvas.width !== plate.width) {
    canvas.width = plate.width;
  }
  if (canvas.height !== plate.height) {
    canvas.height = plate.height;
  }
  canvas._stampPreviewRepaint = () => paintNodeGraphStampPreviewCanvas(canvas, settings, side, kind);
  canvas._dotRingInfo = null;
  const bgHex = typeof nodeGraphFacePlateBackground === "function"
    ? nodeGraphFacePlateBackground(settings, "#020405")
    : "#020405";
  const density = typeof nodeGraphFacePlateDensity === "function"
    ? nodeGraphFacePlateDensity(settings, 1)
    : 1;
  const fillEmpty = () => {
    if (nodeGraphFacePlateFill(canvas, bgHex) === "no-device") {
      nodeGraphDisplayGlFailed(canvas, "stamp preview: shared GL unavailable");
    }
  };
  // Instant Waterfall / RGB waterfall: same dab path as the face (hard or soft).
  // Draw in plate space, scaled so the full stamp (core + blur) fits — never
  // ClampPoint-shift into the right edge of a too-small scratch.
  if (kind === "waterfall" || kind === "waterfallRgb") {
    const ink = nodeGraphStampPreviewTraceInk(settings, side, kind);
    if (!(ink.size > 0)) {
      fillEmpty();
      return;
    }
    const faceMin = nodeGraphStampPreviewFaceMinSide(settings);
    const faceRadius = typeof nodeGraphWaterfallGlRadius === "function"
      ? nodeGraphWaterfallGlRadius(faceMin, ink.size)
      : (typeof TraceStroke !== "undefined" && typeof TraceStroke.radiusPx === "function"
        ? TraceStroke.radiusPx(faceMin, ink.size)
        : faceMin * ink.size * 0.5);
    if (!(faceRadius > 0)) {
      fillEmpty();
      return;
    }
    const blur = nodeGraphFiniteNumber(ink.blur);
    const facePad = typeof nodeGraphWaterfallSoftPad === "function"
      ? nodeGraphWaterfallSoftPad(faceRadius, blur)
      : faceRadius * (1 + blur * 1.65) + 1;
    const plateSide = Math.min(plate.width, plate.height);
    const fit = Math.max(0.001, (plateSide * 0.5 - 1.5) / Math.max(facePad, faceRadius, 0.5));
    const radius = Math.max(0.5, faceRadius * fit);
    const cx = plate.width * 0.5;
    const cy = plate.height * 0.5;
    let rgb = nodeGraphStampPreviewParseHex(ink.color);
    if (typeof nodeGraphWaterfallScaleRgb === "function") {
      rgb = nodeGraphWaterfallScaleRgb(rgb, ink.bright);
    }
    // Same dab profile as the face, drawn centered on a GL batch (no clamp nudge).
    const bg = nodeGraphStampPreviewParseHex(bgHex);
    const batch = typeof nodeGraphGlLinesBegin === "function"
      ? nodeGraphGlLinesBegin(canvas, [bg[0] / 255, bg[1] / 255, bg[2] / 255, 1], { scale: 1 })
      : null;
    if (!batch) {
      nodeGraphDisplayGlFailed(canvas, "stamp preview: no shared GL device");
      return;
    }
    nodeGraphWaterfallDab(batch, cx, cy, radius, rgb, blur);
    if (!nodeGraphGlLinesEnd(batch, "alpha")) {
      nodeGraphDisplayGlFailed(canvas, "stamp preview: GL present failed");
      return;
    }
    canvas.style.imageRendering = density < 0.999 || blur < 0.02 ? "pixelated" : "";
    return;
  }

  // LED / LCD / Pulse Dot: draw the SDF stamp into the 96px plate.
  // Do not size the scratch from the live face buffer — a 5–8px face canvas
  // made a 5×5 pixelated preview, off-center from GL Y-flip on an odd buf.
  if (kind === "vectorDot" || kind === "pulseDot" || kind === "lcdDot") {
    const plateSide = Math.min(plate.width, plate.height);
    const size01 = nodeGraphStampPreviewUnit(settings.dot1Size ?? settings.size, 0.5);
    const blur01 = nodeGraphStampPreviewUnit(settings.lineThickness, 0);
    if (!(size01 > 0)) {
      fillEmpty();
      return;
    }
    const stampShape = typeof normalizeTraceStampShape === "function"
      ? normalizeTraceStampShape(settings.shape)
      : String(settings.shape || "circle");
    const shapeParam = Math.max(0, Math.min(1, nodeGraphFiniteNumber(
      settings.shapeParam ?? (stampShape === "oval" ? settings.pill : settings.squircle),
    )));
    const stretch = stampShape === "oval" ? shapeParam : 0;
    const pad = 3;
    const maxR = Math.max(1, plateSide * 0.5 - pad);
    const radius = Math.max(1, maxR * size01);
    const ext = typeof nodeGraphVectorDotStampExtents === "function"
      ? nodeGraphVectorDotStampExtents(plateSide, plateSide, size01, stretch)
      : { rx: radius * (1 + stretch * 2), ry: radius };
    const cx = plate.width * 0.5;
    const cy = plate.height * 0.5;
    const color = nodeGraphStampPreviewTraceColor(settings, side, kind);
    const bright = Math.max(0, Math.min(1, nodeGraphFiniteNumber(settings.dot1Brightness ?? settings.brightness, 1)));
    const saturation = nodeGraphFiniteNumber(settings.dot1Saturation ?? settings.colorSaturation, 1);
    const shapeStyle = {
      rx: Math.max(1, ext.rx), ry: Math.max(1, ext.ry), shape: stampShape, shapeParam, saturation,
    };
    nodeGraphStampPreviewPenPlate(canvas, bgHex, (pen) => (kind === "lcdDot"
      ? TraceDotSprite.drawTarget(pen, cx, cy, radius, blur01, { ...shapeStyle, color, amount: 1 }, bright)
      : TraceDotSprite.drawTarget(pen, cx, cy, radius, blur01, {
        ...shapeStyle,
        hue: typeof nodeGraphHueDegFromHex === "function" ? nodeGraphHueDegFromHex(color) : 25,
        amount: bright,
      }, 1)));
    canvas.style.imageRendering = density < 0.999 ? "pixelated" : "auto";
    return;
  }

  // The dot stage faces (2D and 1D phosphor, 2D and 1D Trace) are drawn from the display gradient (see
  // nodeGraphStageBokehPreview); everything below is the plain flat-dot preview of the other Trace-style faces.
  if (nodeGraphDotStageFormType(kind)) {
    nodeGraphStageBokehPreview(canvas, settings, kind, plate, bgHex, fillEmpty);
    return;
  }
  const right = side === "R";
  const size = nodeGraphStampPreviewUnit(
    right ? settings.secondarySize : (settings.dot1Size ?? settings.size),
    0,
  );
  if (!(size > 0)) {
    fillEmpty();
    return;
  }
  const blur = Number(right ? settings.secondaryLineThickness : settings.lineThickness);
  const blur01 = Number.isFinite(blur) ? Math.max(0, Math.min(1, blur)) : 0;
  const color = nodeGraphStampPreviewTraceColor(settings, side);
  const faceMin = nodeGraphStampPreviewFaceMinSide(settings);
  const radius = typeof TraceStroke !== "undefined" && typeof TraceStroke.radiusPx === "function"
    ? TraceStroke.radiusPx(faceMin, size)
    : faceMin * size * 0.5;
  if (!(radius > 0) || !(typeof TraceDotSprite !== "undefined" && typeof TraceDotSprite.drawTarget === "function")) {
    fillEmpty();
    return;
  }
  const extent = nodeGraphStampPreviewExtent(radius, blur01, false);
  const buf = Math.max(1, Math.min(2048, Math.ceil(extent * 2 + 2)));
  const bright = Number(settings.dot1Brightness ?? settings.brightness);
  const bright01 = Number.isFinite(bright) ? Math.max(0, bright) : 1;
  // The stamp is laid out in a buf x buf box (stamp + blur) that is fitted to the plate.
  const fit = Math.min(plate.width, plate.height) / buf;
  const rgb = nodeGraphStampPreviewParseHex(color, [117, 235, 255]);
  const gain = Math.max(0, Math.min(1, bright01));
  const hex = "#" + rgb.map((c) => Math.round(c * gain).toString(16).padStart(2, "0")).join("");
  nodeGraphStampPreviewPenPlate(canvas, bgHex,
    (pen) => TraceDotSprite.drawTarget(pen, plate.width * 0.5, plate.height * 0.5, radius * fit, blur01, { color: hex, flat: true }, 1));
  canvas.style.imageRendering = density < 0.999 ? "pixelated" : "";
}

/**
 * The dot stage preview (2D and 1D phosphor, 2D and 1D Trace): the picture is painted straight from the display gradient
 * (a bright core, a hot ramp, a hyperbolic skirt), laid out by nodeGraphDotStageLayout / nodeGraphWaveStageLayout from the
 * REAL Size mapping, with the glow numbers in nodeGraphStageTune.
 */
function nodeGraphStageBokehPreview(canvas, settings, kind, plate, bgHex, fillEmpty) {
  const phosphor = typeof nodeGraphDisplaySettingsIsPhosphorFormType === "function"
    && nodeGraphDisplaySettingsIsPhosphorFormType(kind);
  const stageTune = nodeGraphStageTuneFor(kind);
  const wave = nodeGraphDotStageIsWave(kind);
  const side = Math.round(Math.min(plate.width, plate.height));
  const lay = wave ? nodeGraphWaveStageLayout(settings, side, stageTune, kind) : nodeGraphDotStageLayout(settings, side, kind);
  canvas._dotRingInfo = {
    kind: wave ? "wave" : "dot",
    R: lay.R, buf: side, reachPx: lay.reachPx, rings: lay.rings.filter((r) => nodeGraphDotStageHasKey(canvas, r.key)),
  };
  // The Bright gauge shows the real Bright only while it is dragged, then the preview snaps back to full.
  const hudEl = canvas.closest(".node-trace-display-dot-stage")?.querySelector('[data-dot-hud="left"]');
  const bright = Number(settings.dot1Brightness ?? settings.brightness);
  const amt = Number.isFinite(bright) ? Math.max(0, Math.min(1, bright)) : 1;
  let gain = hudEl?._dotHudDrag?.key === "dot1Brightness" ? amt : 1;
  let tune = stageTune;
  if (phosphor) {
    // Core, Glow and Halo shape the glow; Build up on keeps the core a little under the last stop, off takes it all the way.
    const core = nodeGraphDotRingUnit(settings.glowCore, 0.08);
    const glow = nodeGraphDotRingUnit(settings.lineThickness, 0.35);
    const halo = nodeGraphDotRingUnit(settings.glowStrength, 0.7);
    tune = {
      ...stageTune,
      core: (stageTune.core ?? 1) * (1 - 0.55 * core),
      length: stageTune.length * (0.35 + 1.3 * glow),
      skirtLevel: Math.min(0.6, stageTune.skirtLevel * (0.5 + 1.0 * halo)),
    };
    if (settings.buildUp !== false) gain *= 0.85;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    fillEmpty();
    return;
  }
  canvas.style.imageRendering = "auto";
  nodeGraphStageBokehPaint(ctx, canvas.width, canvas.height, bgHex, settings, lay, wave, gain, tune);
}

// ---------------------------------------------------------------------------------------------
// Dot stage: the dot preview as a small game-like instrument panel. Everything is direct manipulation and
// uses the app-wide mouse rules (same functions as the Display Settings rows):
//   drag = diagonal travel over NODE_GRAPH_DISPLAY_SETTINGS_TRAVEL_PX (right/up increase) per full range;
//   Shift or Ctrl/Cmd = fine x0.1, both = x0.01; Ctrl/Cmd+click (no drag) = reset to default; never the wheel.
//
//   centre : the dot, a still stamp at the centre (nothing here is ever animated). Hover it, or drag Size or
//            Core, and two rings appear:
//              core (inner)  : the hot core, drag = a smaller pinpoint (relative, proportional drag)
//              halo (middle) : where the halo fades to 20%, drag = halo strength
//              reach (dashed): where the halo ends, drag = longer halo
//   left   : light gauge    bright   (size, core, halo and glow are the four fixed rings on the dot)
//   right  : time gauges    trail, ghost, decay (blur), burn
// The rows for everything on the stage are hidden inputs (no duplicate controls). The look of the rings is in
// UI Dev "graphics".
// ---------------------------------------------------------------------------------------------
const NODE_GRAPH_DOT_STAGE_LEFT = Object.freeze([["dot1Brightness", "bright"]]);
const NODE_GRAPH_DOT_STAGE_RIGHT = Object.freeze([["trail", "trail"], ["ghost", "ghost"], ["decayBlur", "decay"], ["burnAmount", "burn"]]);
const NODE_GRAPH_DOT_STAGE_KEYS = Object.freeze([
  ...NODE_GRAPH_DOT_STAGE_LEFT.map((g) => g[0]),
  ...NODE_GRAPH_DOT_STAGE_RIGHT.map((g) => g[0]),
  // Glow (lineThickness), Halo strength (glowStrength) are rings on the dot; Glow reach has no control.
  // Size is the circle on the dot (drag the dot), Glow and Halo are the rings around it.
  "dot1Size", "lineThickness", "glowCore", "glowReach", "glowStrength",
]);

/** True when this field lives on the dot stage (so its row is not drawn) for this form type. */
function nodeGraphDotStageOwnsField(key, formType) {
  return NODE_GRAPH_DOT_STAGE_KEYS.includes(key) && nodeGraphDotStageFormType(formType);
}

/**
 * Forms that use the dot stage: the phosphor faces (2D and 1D) and the 1D and 2D Trace faces. The stage shows only what the form has (a ring or
 * gauge whose setting is not in the form is left out): Trace has Size, Bright, Trail, Ghost, Decay and Burn, plus the
 * Draw buttons and Build, but no Core / Halo / Glow.
 */
function nodeGraphDotStageFormType(type) {
  return (typeof nodeGraphDisplaySettingsIsPhosphorFormType === "function" && nodeGraphDisplaySettingsIsPhosphorFormType(type))
    || type === "scope2dTrace"
    || type === "scope1dTrace";
}

/** True when the form being edited has this setting (the stage skips rings and gauges it has no setting for). */
function nodeGraphDotStageHasKey(el, key) {
  const root = el?.closest?.("#nodeTraceDisplaySettingsPopover") || document;
  return !!root.querySelector(`[data-trace-display-field="${key}"]`);
}

/** Fixed ring look: line width in px and the three alphas (rest, hovering the dot, ring under the pointer). */
function nodeGraphDotRingStyle() {
  return { width: 1.5, rest: 0.16, awake: 0.4, active: 1 };
}

function nodeGraphDotRingExpo(t) {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - Math.exp(-3 * c)) / 0.95021293163;
}

function nodeGraphDotRingUnit(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

/**
 * The dot stage: FIXED handles, a MOVING picture.
 * Four concentric rings sit at fixed radii (never move, whatever the settings), each one a handle for one setting,
 * outermost to innermost:
 *   size (outer)   the dot's size
 *   halo           halo strength
 *   glow           the glow
 *   core (inner)   how small the hot core gets
 * Dragging a ring changes its setting by how far the pointer travels (outward = more); the ring stays put and the dot
 * in the middle changes. Pure functions of the plate side B (preview px), so nothing depends on the settings.
 */
const NODE_GRAPH_DOT_RING_DEFS = Object.freeze([
  // Ascending radius (the hit test relies on rings[0] being the innermost).
  { key: "glowCore", name: "core", frac: 0.14, ang: Math.PI * 1.25 },
  { key: "lineThickness", name: "glow", frac: 0.25, ang: Math.PI * 0.25 },
  { key: "glowStrength", name: "halo", frac: 0.36, ang: -Math.PI * 0.25 },
  { key: "dot1Size", name: "size", frac: 0.46, ang: Math.PI * 0.75 },
]);
/** The glow reaches this far past the dot at full Glow, as a share of the plate. */
const NODE_GRAPH_DOT_PICTURE_REACH_FRAC = 0.23;
/** Pointer travel (preview px) that covers a setting's whole range. */
const NODE_GRAPH_DOT_RING_TRAVEL_PX = 110;

function nodeGraphDotStageRings(B) {
  return NODE_GRAPH_DOT_RING_DEFS.map((d) => ({ ...d, r: d.frac * B }));
}

/**
 * The picture, in preview pixels (B = plate side). Made to be SEEN, not to be accurate: the dot is 26% of the plate at
 * Size 1 and shrinks in proportion (a tiny size is a tiny dot, the minimum is a speck), and the glow is exaggerated (reach reaches
 * the outer ring by Reach 0.6, and the Glow / Halo amounts are boosted in the shader call).
 */
function nodeGraphDotStageLayout(settings, B, kind) {
  const rings = nodeGraphDotStageRings(B);
  const spec = typeof nodeGraphDisplaySettingsFieldSpec === "function" ? nodeGraphDisplaySettingsFieldSpec("dot1Size") : null;
  const v = Number(settings.dot1Size ?? settings.size);
  let c = spec && Number.isFinite(v) ? nodeGraphDisplaySettingsValueToControl(spec, v) : nodeGraphStampPreviewUnit(v, 0.5);
  c = Math.max(0, Math.min(1, Number.isFinite(c) ? c : 0.5));
  const reach = nodeGraphDotRingUnit(settings.glowReach, 0.5);
  const R = nodeGraphStageRealRadius(settings, B, kind);
  // The glow grows with the dot: 10% of the reach for a pinpoint, the full reach once the dot is about a tenth of the plate.
  const grow = Math.max(0.1, Math.min(1, 0.1 + 0.9 * (R / (0.1 * B))));
  return { R, reachPx: Math.min(1, reach * 1.7) * NODE_GRAPH_DOT_PICTURE_REACH_FRAC * B * grow, rings, c };
}

/**
 * 1D faces (1D Phosphor, 1D Trace) get the same fixed-handle idea on a sine wave: the picture is a sine drawn with the
 * face's beam, and the handles are copies of that sine pushed away from it by a fixed distance, above and below, like
 * the rings round the dot. Same settings, same order (outermost: size, halo, glow, core), same drag.
 */
const NODE_GRAPH_WAVE_CYCLES = 1.5;
/** The sine's height; set from the tune of the wave preview that last painted (one panel is open at a time). */
const nodeGraphWaveRuntime = { amp: 0.09 };
/** How far the glow reaches past the beam at full Glow, as a share of the plate. */
const NODE_GRAPH_WAVE_REACH_FRAC = 0.24;

function nodeGraphDotStageIsWave(type) {
  return type === "lineBurn" || type === "scope1dTrace";
}

function nodeGraphWaveY(B, x) {
  return B * 0.5 - B * nodeGraphWaveRuntime.amp * Math.sin((x / B) * Math.PI * 2 * NODE_GRAPH_WAVE_CYCLES);
}

/**
 * The beam's / dot's radius in preview px, from the REAL size mapping of the scope: Size -> authored px (dotUnitInkPx) -> px
 * on the face (the phosphor drawer's radiusFromSize, or the Trace beam's faceInkPx with its floor: 0.5px for 1D, 2px for 2D)
 * -> scaled to the preview plate by plate / face. So a tiny Size is as much of a pinpoint here as in the scope, and a big
 * Size as big.
 */
function nodeGraphStageRealRadius(settings, B, kind) {
  const faceMin = Math.max(1, nodeGraphStampPreviewFaceMinSide(settings));
  const unit = Number(settings.dot1Size ?? settings.size);
  const sizePx = typeof dotUnitInkPx === "function"
    ? dotUnitInkPx(Number.isFinite(unit) ? unit : 0)
    : Math.max(0, Math.min(1, unit || 0)) * 96;
  let radius;
  if (kind === "scope1dTrace" || kind === "scope2dTrace" || kind === "vectorRgbFace") {
    const diameter = typeof faceInkPx === "function" ? faceInkPx(sizePx, faceMin) : sizePx;
    radius = Math.max(kind === "scope2dTrace" ? 2 : 0.5, diameter * 0.5);
  } else if (typeof PhosphorDrawer !== "undefined" && typeof PhosphorDrawer.radiusFromSize === "function") {
    radius = Math.max(0.05, PhosphorDrawer.radiusFromSize(faceMin, sizePx));
  } else {
    radius = Math.max(0.5, sizePx * 0.5);
  }
  return Math.max(0.25, radius * (B / faceMin));
}

function nodeGraphWaveStageLayout(settings, B, T, kind) {
  if (T && Number.isFinite(T.amp)) nodeGraphWaveRuntime.amp = T.amp;
  // The handles' distance from the sine (px); `r` is the same number so the hit test is shared with the dot rings.
  const rings = NODE_GRAPH_DOT_RING_DEFS.map((d) => ({ ...d, r: d.frac * B * 0.5, off: d.frac * B * 0.5 }));
  const spec = typeof nodeGraphDisplaySettingsFieldSpec === "function" ? nodeGraphDisplaySettingsFieldSpec("dot1Size") : null;
  const v = Number(settings.dot1Size ?? settings.size);
  let c = spec && Number.isFinite(v) ? nodeGraphDisplaySettingsValueToControl(spec, v) : nodeGraphStampPreviewUnit(v, 0.5);
  c = Math.max(0, Math.min(1, Number.isFinite(c) ? c : 0.5));
  const reach = nodeGraphDotRingUnit(settings.glowReach, 0.5);
  const R = nodeGraphStageRealRadius(settings, B, kind);
  // The glow grows with the beam: 10% of the reach for a pinpoint, the full reach once the beam is about a tenth of the plate.
  const grow = Math.max(0.1, Math.min(1, 0.1 + 0.9 * (R / (0.1 * B))));
  return {
    R,
    reachPx: Math.min(1, reach * 1.7) * NODE_GRAPH_WAVE_REACH_FRAC * B * grow,
    rings,
    c,
  };
}

/** Paint the wave handles (the sine pushed up and down by each ring's distance) and their labels. */
function nodeGraphDotWaveRingsPaint(ctx, overlay, info, live, look) {
  const awake = !!(overlay._dotRingsOn || overlay._dotRingDrag || overlay._dotRingsForce);
  const active = overlay._dotRingDrag?.key || overlay._dotRingHover || "";
  const ringColor = {
    dot1Size: nodeGraphDotRingColorAt(live, 0.25, "rgb(243,241,236)"),
    glowStrength: nodeGraphDotRingColorAt(live, 0.5, "rgb(127,199,217)"),
    lineThickness: nodeGraphDotRingColorAt(live, 0.75, "rgb(190,225,235)"),
    glowCore: nodeGraphDotRingColorAt(live, 1, "#ffffff"),
  };
  const B = info.buf;
  const labelX = { glowCore: 0.2, lineThickness: 0.4, glowStrength: 0.6, dot1Size: 0.8 };
  ctx.font = "11px sans-serif";
  ctx.textBaseline = "middle";
  for (const ring of info.rings) {
    const on = ring.key === active;
    // The core line runs through the beam itself: only drawn while the pointer is over the preview square (or dragging).
    if (ring.key === "glowCore" && !on && !awake) continue;
    ctx.globalAlpha = on ? look.active : (awake ? look.awake : look.rest);
    ctx.setLineDash(ring.key === "lineThickness" || ring.key === "glowStrength" ? [3.5, 4] : []);
    ctx.lineWidth = look.width;
    ctx.strokeStyle = ringColor[ring.key];
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let x = 0; x <= B; x += 2) {
        const y = nodeGraphWaveY(B, x) + side * ring.off;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (on || awake) {
      const label = `${ring.name} ${formatNodeGraphTraceDisplaySetting(Number(live[ring.key]))}`;
      const x = (labelX[ring.key] || 0.5) * B;
      const y = Math.max(9, nodeGraphWaveY(B, x) - ring.off - 7);
      ctx.globalAlpha = on ? 1 : 0.8;
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(2,4,5,0.9)";
      ctx.strokeText(label, x, y);
      ctx.fillStyle = ringColor[ring.key];
      ctx.fillText(label, x, y);
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Trace faces on the stage: a bokeh dot. Trace has no glow of its own, so the preview is drawn straight from the
 * display's gradient: a bright core disc (the last stops), then a quick hot ramp down through EVERY stop to the first, and a
 * soft low-stop halo outside it. Made to be seen, not accurate. `profile(u)` is the gradient position at u = r / outer
 * radius (0 centre, 1 outer edge).
 */
/**
 * The glow numbers, one set per preview (2D trace, 1D trace, 2D phosphor, 1D phosphor), dialled by Elan and baked in.
 *   Trace sets (drawn from the gradient, bokeh):
 *     core       the flat core disc, as a share of the dot radius
 *     rampEnd    where the hot ramp ends and the skirt starts (0 centre .. 1 outer edge)
 *     skirtLevel strength of the slow glow (the skirt) added on top of the hot ramp
 *     rampExp    hyperbolic sharpness of the hot ramp
 *     skirtExp   hyperbolic sharpness of the skirt (lower = a broader, softer glow; higher = tighter to the line)
 *     length     how far the skirt reaches past the dot (share of the glow reach)
 *   Phosphor sets: the same six. The phosphor preview is drawn the same way (from the gradient) and Core, Glow and Halo
 *   shape it on top: Core shrinks the hot core disc, Glow lengthens the skirt, Halo raises the skirt level.
 *   No set has a core disc: the flat core IS the real dot / beam width (so the preview shows the scope's real size).
 *   1D sets also:
 *     amp        sine height (share of the plate). The beam's thickness is not a slider: it follows the real scope's Size mapping.
 */
const NODE_GRAPH_STAGE_TUNE_DEFAULTS = Object.freeze({
  // Locked in by Elan: the dialled 2D Trace bokeh.
  trace2d: { rampEnd: 0.428864, skirtLevel: 0.152727, rampExp: 5.272727, skirtExp: 0.5, length: 1.100682 },
  // Locked in by Elan: the dialled 1D Trace glow.
  trace1d: { rampEnd: 0.357045, skirtLevel: 1.002727, rampExp: 4.511364, skirtExp: 2.486364, length: 0.9, amp: 0.072273 },
  // Locked in by Elan: the dialled 2D Phosphor glow.
  phos2d: { rampEnd: 0.540228, skirtLevel: 0.043636, rampExp: 2.965909, skirtExp: 1.234091, length: 0.717727 },
  // Locked in by Elan: the dialled 1D Phosphor glow.
  phos1d: { rampEnd: 0.35, skirtLevel: 0.4, rampExp: 1.977273, skirtExp: 3.365909, length: 1.045455, amp: 0.084909 },
});
/** The baked-in glow numbers per preview (2D trace, 1D trace, 2D phosphor, 1D phosphor). */
const nodeGraphStageTune = Object.freeze(Object.fromEntries(
  Object.entries(NODE_GRAPH_STAGE_TUNE_DEFAULTS).map(([group, values]) => [group, Object.freeze({ ...values })]),
));

/** Which tune set a preview kind uses. */
function nodeGraphStageTuneGroup(kind) {
  if (kind === "scope2dTrace" || kind === "vectorRgbFace") return "trace2d";
  if (kind === "scope1dTrace") return "trace1d";
  if (kind === "lineBurn") return "phos1d";
  return "phos2d";
}

function nodeGraphStageTuneFor(kind) {
  return nodeGraphStageTune[nodeGraphStageTuneGroup(kind)];
}

/**
 * The Hyperbolic Decay envelope's curve (modules/hyperbolicDecay/hyperbolic-decay-math.js: env = end / ((1 - end) u + end)),
 * used for the glow falloff: a bright cusp at the line and a long 1/r tail, which is how a glow really falls off (an
 * exponential drops too evenly and goes flat or edgy). Normalised so it is exactly 1 at x = 0 and exactly 0 at x = 1.
 * \`k\` is the sharpness: s = e^k is the envelope's 1/end (k 6.9 is the envelope's 0.001). Higher k = a tighter cusp (the glow
 * hugs the line); lower k = a broader, softer glow; the lowest is close to a straight line.
 */
function nodeGraphExpoFall(x, k) {
  const xc = Math.max(0, Math.min(1, x));
  const sharp = Math.exp(Math.max(0.05, k));
  const h = 1 / (1 + sharp * xc);
  const h1 = 1 / (1 + sharp);
  return (h - h1) / (1 - h1);
}

/**
 * Gradient position at u (0 centre .. 1 outer edge): a flat core, then ONE continuous glow: a fast Expo (the hot ramp, gone by
 * rampEnd) plus a slow Expo (the skirt, amplitude skirtLevel) added together, like the shader's halo + (1 - halo) * core.
 * Raising the skirt (level, or a lower expo) adds glow that reaches further out and never takes anything from the ramp. The old
 * two-piece version (ramp down to the skirt level, then a restarted skirt) flattened at the skirt level and made an edge.
 */
function nodeGraphBokehProfile(u, coreFrac, T) {
  if (u <= coreFrac) return 1;
  const end = Math.max(coreFrac + 0.02, Math.min(0.98, T.rampEnd));
  const fast = u < end ? nodeGraphExpoFall((u - coreFrac) / (end - coreFrac), T.rampExp) : 0;
  const slow = nodeGraphExpoFall((u - coreFrac) / Math.max(0.02, 1 - coreFrac), T.skirtExp);
  // The skirt is ADDED to the ramp (never taken out of it): raising the skirt only ever adds glow. The sum is clipped at the
  // top of the gradient.
  return Math.min(1, fast + T.skirtLevel * slow);
}

function nodeGraphBokehColor(settings, p, gain) {
  const t = Math.max(0, Math.min(1, p * gain));
  const c = nodeGraphDotRingGradientAt(settings, t) || [Math.round(255 * t), Math.round(255 * t), Math.round(255 * t)];
  // Fades into the background at the very edge so the halo has no outline.
  const a = Math.min(1, p * 5);
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a.toFixed(3)})`;
}

/** Paints the plate: background, then the bokeh dot (2D Trace) or bokeh sine (1D Trace). */
function nodeGraphStageBokehPaint(ctx, w, h, bgHex, settings, lay, wave, gain, T) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.fillStyle = bgHex || "#020405";
  ctx.fillRect(0, 0, w, h);
  const outer = lay.R + lay.reachPx * T.length;
  const coreFrac = Math.max(0.05, Math.min(0.9, (lay.R * (T.core ?? 1)) / outer));
  if (!wave) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, outer);
    for (let i = 0; i <= 40; i += 1) {
      const u = i / 40;
      grad.addColorStop(u, nodeGraphBokehColor(settings, nodeGraphBokehProfile(u, coreFrac, T), gain));
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, outer, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // 1D: the same cross-section laid along the sine, computed per pixel from the distance to the wave (stacked strokes made
  // hard colour bands, like a neon tube). The profile is tabulated at quarter-pixel steps, the gradient at 256 steps.
  const bg = nodeGraphStampPreviewParseHex(bgHex || "#020405", [2, 4, 5]);
  const lut = new Array(256);
  for (let i = 0; i < 256; i += 1) {
    lut[i] = nodeGraphDotRingGradientAt(settings, i / 255) || [i, i, i];
  }
  const perPx = 4;
  const table = new Float32Array(Math.ceil(outer * perPx) + 2);
  for (let i = 0; i < table.length; i += 1) {
    const d = i / perPx;
    table[i] = d >= outer ? 0 : nodeGraphBokehProfile(d / outer, coreFrac, T);
  }
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const amp = nodeGraphWaveRuntime.amp;
  const twoPiCyc = Math.PI * 2 * NODE_GRAPH_WAVE_CYCLES;
  for (let x = 0; x < w; x += 1) {
    const xc = x + 0.5;
    // Perpendicular distance to a curve with slope s is the vertical distance / sqrt(1 + s^2).
    const slope = -amp * twoPiCyc * Math.cos((xc / w) * twoPiCyc);
    const inv = 1 / Math.sqrt(1 + slope * slope);
    const wy = nodeGraphWaveY(w, xc);
    for (let y = 0; y < h; y += 1) {
      const dv = Math.abs(y + 0.5 - wy);
      // Near the line the distance is the true perpendicular one (a thin line has an even width). Far from it the vertical
      // distance takes over: a perpendicular distance divided by sqrt(1 + slope^2) wobbles at twice the wave's frequency, which
      // on a thick beam grew extra humps (several peaks instead of one clean sine). Vertical offsets of a sine are always a sine.
      const blend = Math.min(1, Math.max(0, (dv - 3) / 9));
      const dd = dv * (inv + (1 - inv) * blend * blend * (3 - 2 * blend));
      const o = (y * w + x) * 4;
      let r = bg[0];
      let g = bg[1];
      let b = bg[2];
      if (dd < outer) {
        const f = dd * perPx;
        const i0 = Math.floor(f);
        const pr = table[i0] * (1 - (f - i0)) + table[i0 + 1] * (f - i0);
        const c = lut[Math.round(Math.max(0, Math.min(1, pr * gain)) * 255)];
        const al = Math.min(1, pr * 5);
        r = bg[0] * (1 - al) + c[0] * al;
        g = bg[1] * (1 - al) + c[1] * al;
        b = bg[2] * (1 - al) + c[2] * al;
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Colour of the display's gradient at brightness t (0..1), as [r, g, b], or null. */
function nodeGraphDotRingGradientAt(settings, t) {
  const raw = Array.isArray(settings?.gradientStops) ? settings.gradientStops : null;
  if (!raw || raw.length < 2) {
    return null;
  }
  const stops = raw
    .map((st) => ({ t: Number(st?.t), c: nodeGraphStampPreviewParseHex(String(st?.color || ""), null) }))
    .filter((st) => Number.isFinite(st.t) && Array.isArray(st.c))
    .sort((a, b) => a.t - b.t);
  if (stops.length < 2) {
    return null;
  }
  if (t <= stops[0].t) return stops[0].c;
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i].t) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      return a.c.map((v, j) => v + (b.c[j] - v) * k);
    }
  }
  return stops[stops.length - 1].c;
}

/** Stage colours come from the display's own gradient (hot end, mid, cool end). */
/** A gradient colour at t, lifted so it stays visible on the dark plate (a bright channel, a touch of white). */
function nodeGraphDotRingColorAt(settings, t, fallback) {
  const c = nodeGraphDotRingGradientAt(settings, t);
  if (!c) return fallback;
  const m = Math.max(c[0], c[1], c[2], 1);
  const k = Math.max(1, 200 / m);
  const v = c.map((x) => Math.min(255, Math.round(x * k * 0.85 + 255 * 0.15)));
  return `rgb(${v[0]},${v[1]},${v[2]})`;
}

function nodeGraphDotRingColors(settings) {
  const fallback = ["#ffffff", "rgb(127,199,217)", "rgb(243,241,236)"];
  return [
    nodeGraphDotRingColorAt(settings, 1, fallback[0]),
    nodeGraphDotRingColorAt(settings, 0.6, fallback[1]),
    nodeGraphDotRingColorAt(settings, 0.3, fallback[2]),
  ];
}

/** The settings the stage should use right now: the painted ones with the live form values on top. */
function nodeGraphDotRingLiveSettings(el) {
  const base = { ...(el._dotRingSettings || el._dotHudSettings || {}) };
  const root = el.closest("#nodeTraceDisplaySettingsPopover") || document;
  for (const key of NODE_GRAPH_DOT_STAGE_KEYS) {
    const input = root.querySelector(`[data-trace-display-field="${key}"]`);
    const v = input ? Number(input.value) : NaN;
    if (Number.isFinite(v)) base[key] = v;
  }
  return base;
}

/** Write one setting through the form's normal apply path (same as dragging its row). */
function nodeGraphDotStageSet(el, key, value, final) {
  const root = el.closest("#nodeTraceDisplaySettingsPopover") || document;
  const input = root.querySelector(`[data-trace-display-field="${key}"]`);
  if (!input || !Number.isFinite(value)) {
    return;
  }
  const next = normalizeNodeGraphTraceDisplaySettingValueForKey(key, value);
  input.value = formatNodeGraphTraceDisplaySetting(next);
  if (typeof markNodeGraphTraceDisplaySettingsDirty === "function") {
    markNodeGraphTraceDisplaySettingsDirty(key);
  }
  applyNodeGraphTraceDisplaySettingsForm(final
    ? { persist: "immediate", record: true }
    : { persist: "debounce", record: false });
}

/** Unit-range setters (the Glow rings) clamp to 0..1 first. */
function nodeGraphDotRingSet(el, key, value, final) {
  nodeGraphDotStageSet(el, key, Math.max(0, Math.min(1, value)), final);
}

function nodeGraphDotStageReset(el, key) {
  nodeGraphDotStageSet(el, key, nodeGraphDisplaySettingsDefaultValue(key), true);
}

function nodeGraphDotRingCenter(info) {
  return { x: info.buf / 2, y: info.buf / 2 };
}

/** Repaint the stage (rings + gauges) after a hover change; value changes repaint through the form's own sync. */
function nodeGraphDotStageRepaint(el) {
  const host = el.closest("#nodeTraceDisplaySettingsPopover");
  if (host) {
    paintNodeGraphStampPreview(host, host._stampPreviewSettings || {});
  }
}

function nodeGraphDotRingHit(overlay, p) {
  const info = overlay._dotPreviewCanvas?._dotRingInfo;
  if (!info) {
    return "";
  }
  const c = nodeGraphDotRingCenter(info);
  // On a 1D wave the distance is how far the pointer is from the sine; on the dot it is the distance from the centre.
  const r = info.kind === "wave"
    ? Math.abs(p.y - nodeGraphWaveY(info.buf, p.x))
    : Math.hypot(p.x - c.x, p.y - c.y);
  // The rings never move and are at least a grab-width apart: the nearest one within reach wins (inside the core ring
  // is the core).
  if (r < info.rings[0].r) {
    return info.rings[0].key;
  }
  let best = "";
  let bestD = 9;
  for (const ring of info.rings) {
    const d = Math.abs(r - ring.r);
    if (d <= bestD) {
      best = ring.key;
      bestD = d;
    }
  }
  return best;
}

function nodeGraphDotRingPoint(overlay, event) {
  const rect = overlay.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (rect.width > 0 ? overlay.width / rect.width : 1),
    y: (event.clientY - rect.top) * (rect.height > 0 ? overlay.height / rect.height : 1),
  };
}

function paintNodeGraphDotRings(overlay, settings = {}) {
  if (!overlay) {
    return;
  }
  const prev = overlay._dotPreviewCanvas
    || overlay.closest(".node-trace-display-preview-cell")?.querySelector("[data-stamp-preview-canvas]");
  overlay._dotPreviewCanvas = prev;
  overlay._dotRingSettings = settings;
  nodeGraphDotRingBind(overlay);
  // Match the preview canvas box exactly (it is centred and capped, the cell is wider).
  if (prev) {
    const pr = prev.getBoundingClientRect();
    const cr = overlay.parentElement.getBoundingClientRect();
    overlay.style.left = `${pr.left - cr.left}px`;
    overlay.style.top = `${pr.top - cr.top}px`;
    overlay.style.width = `${pr.width}px`;
    overlay.style.height = `${pr.height}px`;
  }
  const ctx = overlay.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const info = prev?._dotRingInfo;
  if (!info) {
    return;
  }
  const live = nodeGraphDotRingLiveSettings(overlay);
  const look = nodeGraphDotRingStyle();
  if (info.kind === "wave") {
    nodeGraphDotWaveRingsPaint(ctx, overlay, info, live, look);
    return;
  }
  const c = nodeGraphDotRingCenter(info);
  // The rings are a faint hint at rest, brighter while the pointer is on the stage, bright under the pointer.
  const awake = !!(overlay._dotRingsOn || overlay._dotRingDrag || overlay._dotRingsForce);
  const active = overlay._dotRingDrag?.key || overlay._dotRingHover || "";
  // The rings catch the light: the outermost ring is the lowest gradient stop, the innermost the highest.
  const ringColor = {
    dot1Size: nodeGraphDotRingColorAt(live, 0.25, "rgb(243,241,236)"),
    glowStrength: nodeGraphDotRingColorAt(live, 0.5, "rgb(127,199,217)"),
    lineThickness: nodeGraphDotRingColorAt(live, 0.75, "rgb(190,225,235)"),
    glowCore: nodeGraphDotRingColorAt(live, 1, "#ffffff"),
  };
  ctx.font = "11px sans-serif";
  ctx.textBaseline = "middle";
  for (const ring of info.rings) {
    const on = ring.key === active;
    // The core ring sits inside the dot, so it is only drawn while the pointer is over the preview square (or dragging).
    if (ring.key === "glowCore" && !on && !awake) continue;
    ctx.globalAlpha = on ? look.active : (awake ? look.awake : look.rest);
    ctx.beginPath();
    ctx.arc(c.x, c.y, ring.r, 0, Math.PI * 2);
    // Glow and halo are dotted, size and core are solid.
    ctx.setLineDash(ring.key === "lineThickness" || ring.key === "glowStrength" ? [3.5, 4] : []);
    ctx.lineWidth = look.width;
    ctx.strokeStyle = ringColor[ring.key];
    ctx.stroke();
    ctx.setLineDash([]);
    if (on || awake) {
      const label = `${ring.name} ${formatNodeGraphTraceDisplaySetting(Number(live[ring.key]))}`;
      const lx = c.x + Math.cos(ring.ang) * ring.r;
      const ly = c.y + Math.sin(ring.ang) * ring.r;
      ctx.globalAlpha = on ? 1 : 0.8;
      const left = Math.cos(ring.ang) < 0;
      ctx.textAlign = left ? "right" : "left";
      const tw = ctx.measureText(label).width;
      const tx = left
        ? Math.max(4 + tw, Math.min(overlay.width - 4, lx - 6))
        : Math.max(4, Math.min(overlay.width - 4 - tw, lx + 6));
      const ty = Math.max(9, Math.min(overlay.height - 9, ly));
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(2,4,5,0.9)";
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = ringColor[ring.key];
      ctx.fillText(label, tx, ty);
    }
  }
  ctx.globalAlpha = 1;
}

function nodeGraphDotRingDrag(overlay, event, final) {
  const drag = overlay._dotRingDrag;
  const info = overlay._dotPreviewCanvas?._dotRingInfo;
  if (!drag || !info) {
    return;
  }
  const p = nodeGraphDotRingPoint(overlay, event);
  const c = nodeGraphDotRingCenter(info);
  const rdx = p.x - c.x;
  const rdy = p.y - c.y;
  let r;
  if (info.kind === "wave") {
    // Distance from the sine; once the pointer crosses to the other side of it the distance counts as negative.
    const dy = p.y - nodeGraphWaveY(info.buf, p.x);
    r = Math.abs(dy);
    if (Math.abs(dy) > 0.5 && Math.sign(dy) !== drag.side) {
      r = -r;
    }
  } else {
    r = Math.hypot(rdx, rdy);
    // Signed: past the centre the distance counts as negative, so dragging in keeps reducing the value.
    if (rdx * drag.ux + rdy * drag.uy < 0) {
      r = -r;
    }
  }
  if (drag.resetClick && Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) > 2) {
    drag.resetClick = false;
  }
  if (drag.resetClick) {
    return;
  }
  // The ring stays where it is: the value follows how far the pointer travelled (outward = more), through the
  // setting's own control curve, times the app-wide fine modifier (Shift / Ctrl).
  const mult = nodeGraphTraceDisplayNumberDragMultiplier(event);
  const control = Math.max(0, Math.min(1, drag.c0 + (r - drag.rp0) * mult / NODE_GRAPH_DOT_RING_TRAVEL_PX));
  const spec = nodeGraphDisplaySettingsFieldSpec(drag.key);
  nodeGraphDotStageSet(overlay, drag.key, spec ? nodeGraphDisplaySettingsControlToValue(spec, control) : control, final);
}

function nodeGraphDotRingBind(overlay) {
  if (overlay._dotRingBound) {
    return;
  }
  overlay._dotRingBound = true;
  overlay.addEventListener("pointerenter", () => {
    overlay._dotRingsOn = true;
    nodeGraphDotStageRepaint(overlay);
  });
  overlay.addEventListener("pointerleave", () => {
    if (!overlay._dotRingDrag) {
      overlay._dotRingsOn = false;
      overlay._dotRingHover = "";
    }
    nodeGraphDotStageRepaint(overlay);
  });
  overlay.addEventListener("pointerdown", (event) => {
    if (event.button > 0) {
      return;
    }
    if (typeof nodeGraphNumericModifierReserved === "function" && nodeGraphNumericModifierReserved(event)) {
      return;
    }
    const key = nodeGraphDotRingHit(overlay, nodeGraphDotRingPoint(overlay, event));
    if (!key) {
      return;
    }
    const p0 = nodeGraphDotRingPoint(overlay, event);
    const info0 = overlay._dotPreviewCanvas?._dotRingInfo;
    const live0 = nodeGraphDotRingLiveSettings(overlay);
    const c0 = info0 ? nodeGraphDotRingCenter(info0) : { x: 0, y: 0 };
    const gx = p0.x - c0.x;
    const gy = p0.y - c0.y;
    const gl = Math.hypot(gx, gy) || 1;
    const waveDy = info0 && info0.kind === "wave" ? p0.y - nodeGraphWaveY(info0.buf, p0.x) : 0;
    const spec0 = nodeGraphDisplaySettingsFieldSpec(key);
    const v0 = Number(live0[key]);
    overlay._dotRingDrag = {
      key,
      // c0 = the setting's control position at the start, rp0 = the pointer's radius at the start.
      c0: spec0 && Number.isFinite(v0) ? nodeGraphDisplaySettingsValueToControl(spec0, v0) : (Number.isFinite(v0) ? v0 : 0),
      rp0: info0 && info0.kind === "wave" ? Math.abs(waveDy) : gl,
      side: waveDy < 0 ? -1 : 1,
      ux: gx / gl,
      uy: gy / gl,
      sx: event.clientX,
      sy: event.clientY,
      // Ctrl/Cmd press: a click (no drag) resets this setting to its default; moving = fine drag.
      resetClick: typeof nodeGraphNumericResetClickModifier === "function" && nodeGraphNumericResetClickModifier(event),
    };
    try {
      overlay.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // capture is a nicety; a failed capture must never stop the drag or its commit
    }
    event.preventDefault();
    event.stopPropagation();
    nodeGraphDotStageRepaint(overlay);
  });
  overlay.addEventListener("pointermove", (event) => {
    if (overlay._dotRingDrag) {
      nodeGraphDotRingDrag(overlay, event, false);
      event.preventDefault();
      return;
    }
    const hit = nodeGraphDotRingHit(overlay, nodeGraphDotRingPoint(overlay, event));
    if (hit !== overlay._dotRingHover) {
      overlay._dotRingHover = hit;
      nodeGraphDotStageRepaint(overlay);
    }
  });
  const end = (event) => {
    const drag = overlay._dotRingDrag;
    if (!drag) {
      return;
    }
    if (event.type !== "pointercancel") {
      if (drag.resetClick) {
        nodeGraphDotStageReset(overlay, drag.key);
      } else {
        nodeGraphDotRingDrag(overlay, event, true);
      }
    }
    try {
      overlay.releasePointerCapture?.(event.pointerId);
    } catch (_) {
      // capture is a nicety; a failed capture must never stop the drag or its commit
    }
    overlay._dotRingDrag = null;
    nodeGraphDotStageRepaint(overlay);
  };
  overlay.addEventListener("pointerup", end);
  overlay.addEventListener("pointercancel", end);
}

// ------------------------------- gauges (left: light, right: time) -------------------------------

function nodeGraphDotHudGauges(hud) {
  const all = hud.dataset.dotHud === "left" ? NODE_GRAPH_DOT_STAGE_LEFT : NODE_GRAPH_DOT_STAGE_RIGHT;
  const have = all.filter((g) => nodeGraphDotStageHasKey(hud, g[0]));
  return have.length ? have : all;
}

function nodeGraphDotHudLayout(hud) {
  const gauges = nodeGraphDotHudGauges(hud);
  const w = hud._cssW || 80;
  const h = hud._cssH || 150;
  const slot = w / gauges.length;
  const top = 18;
  const bottom = h - 18;
  return { gauges, w, h, slot, top, bottom, barH: Math.max(20, bottom - top) };
}

function nodeGraphDotHudControl(hud, key) {
  const input = (hud.closest("#nodeTraceDisplaySettingsPopover") || document).querySelector(`[data-trace-display-field="${key}"]`);
  const value = input ? Number(input.value) : NaN;
  const spec = typeof nodeGraphDisplaySettingsFieldSpec === "function" ? nodeGraphDisplaySettingsFieldSpec(key) : null;
  if (!spec || !Number.isFinite(value)) {
    return { value: NaN, control: 0, spec };
  }
  return { value, control: Math.max(0, Math.min(1, nodeGraphDisplaySettingsValueToControl(spec, value))), spec };
}

function paintNodeGraphDotHud(hud, settings = {}, previewRect = null) {
  if (!hud) {
    return;
  }
  hud._dotHudSettings = settings;
  nodeGraphDotHudBind(hud);
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  // Fixed height (CSS): the sliders never follow the preview's size.
  const cssH = hud.getBoundingClientRect().height || hud._cssH || 170;
  const cssW = hud.getBoundingClientRect().width || hud._cssW || 80;
  hud._cssW = cssW;
  hud._cssH = cssH;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (hud.width !== bw) hud.width = bw;
  if (hud.height !== bh) hud.height = bh;
  const ctx = hud.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const L = nodeGraphDotHudLayout(hud);
  const cols = nodeGraphDotRingColors(nodeGraphDotRingLiveSettings(hud));
  const awake = !!hud._dotHudOn || !!hud._dotHudDrag;
  ctx.textBaseline = "middle";
  L.gauges.forEach(([key, label], i) => {
    const cx = L.slot * (i + 0.5);
    const on = (hud._dotHudDrag?.key || hud._dotHudHover) === key;
    const { value, control } = nodeGraphDotHudControl(hud, key);
    const color = hud.dataset.dotHud === "left" ? cols[i % 2 === 0 ? 0 : 1] : cols[2 - (i % 2)];
    // Flat track and flat fill: no rounding, no knob, no animation (less clutter, less eye strain).
    const barW = 8;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(127,199,217,0.10)";
    ctx.fillRect(cx - barW / 2, L.top, barW, L.barH);
    ctx.globalAlpha = on ? 1 : (awake ? 0.6 : 0.4);
    const fh = Math.max(1, Math.round(L.barH * control));
    ctx.fillStyle = color;
    ctx.fillRect(cx - barW / 2, L.bottom - fh, barW, fh);
    // Label under the bar; the live number over it while hovering or dragging.
    ctx.globalAlpha = on ? 1 : 0.75;
    ctx.fillStyle = "rgba(243,241,236,0.9)";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, cx, L.h - 7);
    if (on && Number.isFinite(value)) {
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(formatNodeGraphTraceDisplaySetting(value), cx, 8);
    }
  });
  ctx.globalAlpha = 1;
}

function nodeGraphDotHudSlotAt(hud, event) {
  const rect = hud.getBoundingClientRect();
  const L = nodeGraphDotHudLayout(hud);
  const i = Math.floor(((event.clientX - rect.left) / Math.max(1, rect.width)) * L.gauges.length);
  return L.gauges[Math.max(0, Math.min(L.gauges.length - 1, i))][0];
}

function nodeGraphDotHudBind(hud) {
  if (hud._dotHudBound) {
    return;
  }
  hud._dotHudBound = true;
  hud.addEventListener("pointerenter", () => {
    hud._dotHudOn = true;
    nodeGraphDotStageRepaint(hud);
  });
  hud.addEventListener("pointerleave", () => {
    if (!hud._dotHudDrag) {
      hud._dotHudOn = false;
      hud._dotHudHover = "";
    }
    nodeGraphDotStageRepaint(hud);
  });
  hud.addEventListener("pointerdown", (event) => {
    if (event.button > 0) {
      return;
    }
    if (typeof nodeGraphNumericModifierReserved === "function" && nodeGraphNumericModifierReserved(event)) {
      event.preventDefault();
      return;
    }
    const key = nodeGraphDotHudSlotAt(hud, event);
    const { value, spec } = nodeGraphDotHudControl(hud, key);
    if (!spec) {
      return;
    }
    hud._dotHudDrag = {
      key,
      spec,
      startControl: nodeGraphDisplaySettingsValueToControl(spec, Number.isFinite(value) ? value : nodeGraphDisplaySettingsDefaultValue(key)),
      startX: event.clientX,
      startY: event.clientY,
      multiplier: nodeGraphTraceDisplayNumberDragMultiplier(event),
      resetClick: typeof nodeGraphNumericResetClickModifier === "function" && nodeGraphNumericResetClickModifier(event),
    };
    try {
      hud.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // capture is a nicety; a failed capture must never stop the drag or its commit
    }
    event.preventDefault();
    event.stopPropagation();
    nodeGraphDotStageRepaint(hud);
  });
  hud.addEventListener("pointermove", (event) => {
    const drag = hud._dotHudDrag;
    if (!drag) {
      const slot = nodeGraphDotHudSlotAt(hud, event);
      if (slot !== hud._dotHudHover) {
        hud._dotHudHover = slot;
        nodeGraphDotStageRepaint(hud);
      }
      return;
    }
    if (drag.resetClick) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <= 2) {
        return;
      }
      drag.resetClick = false;
    }
    // Same drag law as the Display Settings rows: diagonal travel (right/up increase) over the app-wide travel,
    // re-anchored when the fine modifier changes mid-drag so releasing it does not jump.
    const mult = nodeGraphTraceDisplayNumberDragMultiplier(event);
    if (mult !== drag.multiplier) {
      const live = nodeGraphDotHudControl(hud, drag.key).value;
      if (Number.isFinite(live)) drag.startControl = nodeGraphDisplaySettingsValueToControl(drag.spec, live);
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.multiplier = mult;
      return;
    }
    const delta = nodeGraphPointerDragTravelDelta(drag.startX, drag.startY, event.clientX, event.clientY, NODE_GRAPH_DISPLAY_SETTINGS_TRAVEL_PX, drag.multiplier);
    nodeGraphDotStageSet(hud, drag.key, nodeGraphDisplaySettingsControlToValue(drag.spec, drag.startControl + delta), false);
    event.preventDefault();
  });
  const end = (event) => {
    const drag = hud._dotHudDrag;
    if (!drag) {
      return;
    }
    try {
      hud.releasePointerCapture?.(event.pointerId);
    } catch (_) {
      // capture is a nicety; a failed capture must never stop the drag or its commit
    }
    hud._dotHudDrag = null;
    {
      const ringsEl = hud.closest(".node-trace-display-dot-stage")?.querySelector("[data-dot-rings]");
      if (ringsEl) ringsEl._dotRingsForce = false;
    }
    if (event.type === "pointercancel") {
      return;
    }
    if (drag.resetClick) {
      nodeGraphDotStageReset(hud, drag.key);
    } else {
      // Commit as one undo step.
      const live = nodeGraphDotHudControl(hud, drag.key).value;
      nodeGraphDotStageSet(hud, drag.key, live, true);
    }
  };
  hud.addEventListener("pointerup", end);
  hud.addEventListener("pointercancel", end);
}

/** The painted settings with the live form values of everything on the stage on top. */
function nodeGraphDotStageMergeLive(root, settings) {
  const out = { ...(settings || {}) };
  for (const key of NODE_GRAPH_DOT_STAGE_KEYS) {
    const input = root.querySelector(`[data-trace-display-field="${key}"]`);
    const v = input ? Number(input.value) : NaN;
    if (Number.isFinite(v)) out[key] = v;
  }
  return out;
}

function paintNodeGraphStampPreview(root, settings = {}) {
  nodeGraphDrawButtonsSync(root);
  if (root?.querySelector?.("[data-dot-rings]")) {
    settings = nodeGraphDotStageMergeLive(root, settings);
  }
  const shell = root?.querySelector?.("[data-stamp-preview]");
  const kind = shell?.getAttribute?.("data-stamp-preview") || "waterfall";
  const canvases = root?.querySelectorAll?.("[data-stamp-preview-canvas]");
  if (!canvases?.length) {
    return;
  }
  for (const canvas of canvases) {
    paintNodeGraphStampPreviewCanvas(
      canvas,
      settings,
      canvas.getAttribute("data-preview-side") || "",
      kind,
    );
  }
  const rings = root?.querySelector?.("[data-dot-rings]");
  if (rings) {
    paintNodeGraphDotRings(rings, settings);
    const previewBox = rings._dotPreviewCanvas?.getBoundingClientRect?.() || null;
    for (const hud of root.querySelectorAll("[data-dot-hud]")) {
      paintNodeGraphDotHud(hud, settings, previewBox);
    }
  }
}

/** Hide Shape param for Circle; retitle Stretch/Corners/Sides/… from live Shape. */
/** Window row key per mode: windowCycles (Cycles), windowBeats (Beats), timeMs (Time) (lib/visual/scope-sync.js). */
function nodeGraphScopeWindowKeyForMode(mode) {
  const m = nodeGraphScopeWindowMode(mode);
  return m === "time" ? "timeMs" : (m === "beats" ? "windowBeats" : "windowCycles");
}

function nodeGraphDisplaySettingsWindowRowKey(formType) {
  const settings = typeof nodeGraphTraceDisplayCurrentSettingsForFormType === "function"
    ? nodeGraphTraceDisplayCurrentSettingsForFormType(formType)
    : null;
  return nodeGraphScopeWindowKeyForMode(settings?.windowMode);
}

/** Instant Waterfall / RGB / XYZ form whose History is Beats. */
function nodeGraphDisplaySettingsHistoryIsBeats(formType) {
  if (formType !== "waterfall" && formType !== "waterfallRgb" && formType !== "waterfallXyz") {
    return false;
  }
  if (typeof nodeGraphTraceDisplayCurrentSettingsForFormType !== "function") {
    return false;
  }
  return nodeGraphTraceDisplayCurrentSettingsForFormType(formType)?.historyMode === "beats";
}

/** Whether the form's Window is Beats (the Cycles stepper then reads Beats). */
function nodeGraphDisplaySettingsWindowRowIsBeats(formType) {
  if (!formType || typeof nodeGraphTraceDisplayCurrentSettingsForFormType !== "function") {
    return false;
  }
  const settings = nodeGraphTraceDisplayCurrentSettingsForFormType(formType);
  return nodeGraphScopeWindowMode(settings?.windowMode) === "beats";
}

/**
 * Window: Cycles / Beats / Time. Retargets the one stepper to windowCycles,
 * windowBeats or timeMs, so each mode keeps its own stored value.
 */
function syncNodeGraphScopeWindowRow(root, settings = {}) {
  const host = root?.querySelector?.("[data-trace-display-window-label]")
    ? root
    : document.getElementById("nodeTraceDisplaySettingsPopover");
  const field = host?.querySelector?.(`[data-trace-display-field="timeMs"], [data-trace-display-field="windowCycles"], [data-trace-display-field="windowBeats"]`);
  if (!field) {
    return;
  }
  const mode = nodeGraphScopeWindowMode(settings?.windowMode);
  const key = nodeGraphScopeWindowKeyForMode(mode);
  const fieldMeta = nodeGraphDisplaySettingsFieldMeta[key] || { label: key };
  // Beats: its own value, no hover text.
  const meta = mode === "beats" ? { label: "Beats", title: "" } : fieldMeta;
  const titleSpan = host.querySelector("[data-trace-display-window-label]");
  if (titleSpan) {
    titleSpan.textContent = meta.label;
  }
  const row = field.closest?.("[data-trace-display-control-row]");
  if (row) {
    row.title = meta.title || "";
  }
  field.setAttribute("data-trace-display-field", key);
  field.title = meta.title || "";
  field.setAttribute("aria-label", `${meta.label} amount`);
  for (const btn of row?.querySelectorAll?.("[data-trace-display-step-target]") || []) {
    btn.setAttribute("data-trace-display-step-target", key);
  }
  const editing = typeof nodeGraphTraceDisplayFieldIsEditing === "function"
    ? nodeGraphTraceDisplayFieldIsEditing(field)
    : field.classList.contains("trace-display-field-editing");
  if (!editing) {
    const value = settings?.[key];
    if (value != null) {
      field.value = typeof formatNodeGraphTraceDisplayFieldValue === "function"
        ? formatNodeGraphTraceDisplayFieldValue(key, value)
        : String(value);
    }
  }
}

/**
 * Instant Waterfall History is seconds, 1D Onset Sync included.
 */
function syncNodeGraphWaterfallHistoryLabel(root, settings = {}) {
  const host = root?.querySelector?.(
    "[data-trace-display-history-label], [data-trace-display-field=\"historySeconds\"], [data-trace-display-field=\"zoomSeconds\"], [data-trace-display-field=\"historyHz\"], [data-trace-display-field=\"historyCycles\"]",
  )
    ? root
    : document.getElementById("nodeTraceDisplaySettingsPopover");
  if (!host) {
    return;
  }
  const titleSpan = host.querySelector("[data-trace-display-history-label]");
  const field = host.querySelector(`[data-trace-display-field="historySeconds"]`)
    || host.querySelector(`[data-trace-display-field="historyCycles"]`)
    || host.querySelector(`[data-trace-display-field="historyHz"]`)
    || host.querySelector(`[data-trace-display-field="zoomSeconds"]`);
  if (!titleSpan && !field) {
    return;
  }
  // History = Beats (Instant Waterfall): the stepper is historyCycles, in beats.
  const beats = settings?.historyMode === "beats";
  const key = beats ? "historyCycles" : "historySeconds";
  const label = beats ? "History (beats)" : "History (seconds)";
  const title = beats ? "" : "History window duration in seconds across the face. Longer = slower scroll. At 0 the face is the current bar.";
  if (titleSpan) {
    titleSpan.textContent = label;
  }
  const row = field?.closest?.("[data-trace-display-control-row]");
  if (row) {
    row.title = title;
  }
  if (field) {
    field.dataset.traceDisplayField = key;
    field.setAttribute("data-trace-display-field", key);
    field.title = title;
    field.setAttribute("aria-label", `${label} amount`);
    // Drag requires readOnly when idle. Never yank value while typing.
    const editing = typeof nodeGraphTraceDisplayFieldIsEditing === "function"
      ? nodeGraphTraceDisplayFieldIsEditing(field)
      : field.classList.contains("trace-display-field-editing");
    const stepBtns = row?.querySelectorAll?.("[data-trace-display-step-target]");
    if (stepBtns) {
      for (const btn of stepBtns) {
        btn.setAttribute("data-trace-display-step-target", key);
      }
    }
    if (!editing) {
      field.readOnly = true;
      field.classList.toggle("trace-display-field-editing", false);
      const value = settings?.[key];
      if (value != null && typeof formatNodeGraphTraceDisplayFieldValue === "function") {
        field.value = formatNodeGraphTraceDisplayFieldValue(key, value);
      } else if (value != null) {
        field.value = String(value);
      }
    }
  }
}

function syncNodeGraphStampShapeControls(root, settings = {}) {
  const host = root?.querySelector?.(`[data-trace-display-choice="shape"]`)
    ? root
    : document.getElementById("nodeTraceDisplaySettingsPopover");
  if (!host) {
    return;
  }
  const shapeSelect = host.querySelector(`[data-trace-display-choice="shape"]`);
  if (!shapeSelect) {
    return;
  }
  const shape = typeof normalizeTraceStampShape === "function"
    ? normalizeTraceStampShape(shapeSelect.value || settings.shape || "circle")
    : String(shapeSelect.value || settings.shape || "circle");
  const usesParam = typeof traceStampShapeUsesParam === "function"
    ? traceStampShapeUsesParam(shape)
    : shape !== "circle";
  const meta = typeof traceStampShapeParamMeta === "function"
    ? traceStampShapeParamMeta(shape)
    : { label: "Shape", title: "" };
  const field = host.querySelector(`[data-trace-display-field="shapeParam"]`);
  const row = field?.closest?.("[data-trace-display-control-row]") || null;
  if (row) {
    row.hidden = !usesParam;
    row.style.display = usesParam ? "" : "none";
  }
  if (!usesParam) {
    return;
  }
  // Stepper rows: first child <span> is the field title.
  const titleSpan = row?.querySelector?.(":scope > span:not(.metadata-stepper-control)");
  if (titleSpan) {
    titleSpan.textContent = meta.label;
  }
  if (row && meta.title) {
    row.title = meta.title;
  }
  if (field) {
    if (meta.title) {
      field.title = meta.title;
    }
    field.setAttribute("aria-label", meta.label);
  }
}

function syncNodeGraphStampPreview(root, settings) {
  const host = root?.querySelector?.("[data-stamp-preview]")
    ? root
    : document.getElementById("nodeTraceDisplaySettingsPopover");
  if (typeof syncNodeGraphStampShapeControls === "function") {
    syncNodeGraphStampShapeControls(host || root, settings);
  }
  if (!host?.querySelector?.("[data-stamp-preview-canvas]")) {
    return;
  }
  host._stampPreviewSettings = settings || {};
  const paint = () => paintNodeGraphStampPreview(host, host._stampPreviewSettings || {});
  const shell = host.querySelector("[data-stamp-preview]");
  if (typeof ResizeObserver === "function" && shell && host._stampPreviewResizeTarget !== shell) {
    host._stampPreviewResize?.disconnect?.();
    host._stampPreviewResize = new ResizeObserver(() => {
      paint();
    });
    host._stampPreviewResize.observe(shell);
    host._stampPreviewResizeTarget = shell;
  }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(paint);
  } else {
    paint();
  }
}

/** @deprecated Use syncNodeGraphStampPreview. */
function syncNodeGraphInstantTracePreview(root, settings) {
  return syncNodeGraphStampPreview(root, settings);
}

function nodeGraphDisplaySettingsPushBackgroundHueRow(rows, type) {
  rows.push(nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml({
    title: "Background",
    stepField: "backgroundBrightness",
    colorField: "backgroundColor",
    formType: type,
    defaultHueHex: typeof nodeGraphHueUnitHex === "function"
      ? nodeGraphHueUnitHex(0)
      : "#ff0000",
    titleAttr: "Plate brightness 0…1 (black → full hue at 0.5 → white). Drag the title to change hue.",
  }));
}

function buildNodeGraphInstantTraceDisplaySettingsBodyHtml(type, node, allowKey) {
  const activeFields = nodeGraphTraceDisplayActiveControlSet("fields", type);
  const activeColors = nodeGraphTraceDisplayActiveControlSet("colors", type);
  const activeToggles = nodeGraphTraceDisplayActiveControlSet("toggles", type);
  const activeChoices = nodeGraphTraceDisplayActiveControlSet("choices", type);
  const isStereoWaterfallNode = typeof nodeGraphModuleUsesStereoWaterfall === "function"
    ? nodeGraphModuleUsesStereoWaterfall(node?.type)
    : node?.type === "output";
  const isXyzWaterfallNode = typeof nodeGraphModuleUsesXyzWaterfall === "function"
    ? nodeGraphModuleUsesXyzWaterfall(node?.type)
    : false;
  const allow = typeof allowKey === "function" ? allowKey : () => true;
  const fieldList = [...activeFields].filter((key) => allow("fields", key));
  const isInstantWaterfall = type === "waterfall" || type === "waterfallRgb" || type === "waterfallXyz";
  const primaryOrder = isInstantWaterfall && typeof nodeGraphInstantWaterfallDisplayFieldOrder !== "undefined"
    ? nodeGraphInstantWaterfallDisplayFieldOrder
    : (typeof nodeGraphInstantTraceDisplayFieldOrder !== "undefined"
      ? nodeGraphInstantTraceDisplayFieldOrder
      : ["scale", "historySeconds", "zoomSeconds", "backgroundBrightness", "backgroundHue", "dot1Size", "lineThickness", "dot1Brightness", "dotBudget", "pixelDensity"]);
  const secondaryOrder = isInstantWaterfall
    ? ["secondaryBrightness"]
    : (typeof nodeGraphTraceDisplaySecondaryInkFieldOrder !== "undefined"
      ? nodeGraphTraceDisplaySecondaryInkFieldOrder
      : ["secondarySize", "secondaryLineThickness", "secondaryBrightness"]);
  const primarySet = new Set(primaryOrder);
  const secondarySet = new Set(secondaryOrder);
  const capSet = new Set(["capSize", "capLength", "capPadding"]);
  const orderedPrimary = primaryOrder.filter((key) => fieldList.includes(key));
  const orderedSecondary = secondaryOrder.filter((key) => fieldList.includes(key));
  const leftover = fieldList.filter(
    (key) => !primarySet.has(key) && !secondarySet.has(key) && !capSet.has(key),
  );
  const capKeys = ["capSize", "capLength", "capPadding"].filter((key) => fieldList.includes(key));
  const choiceKeys = [...activeChoices].filter((key) => allow("choices", key));
  const toggleKeys = [...activeToggles].filter((key) => allow("toggles", key));
  const inkColors = (isXyzWaterfallNode && type === "waterfall"
    ? ["dot1Color", "secondaryColor", "tertiaryColor", "backgroundColor"]
    : (isStereoWaterfallNode && type === "waterfall"
      ? ["dot1Color", "secondaryColor", "backgroundColor"]
      : ((type === "waterfall" || type === "waterfallRgb" || type === "waterfallXyz")
        ? ["dot1Color", "secondaryColor", "backgroundColor"]
        : (type === "scope2dTrace"
          ? ["dot1Color", "secondaryColor"]
          : ["dot1Color"])))
  ).concat(type === "waterfall" ? ["thresholdColor"] : []).filter((key) => activeColors.has(key) && allow("colors", key));
  const parts = [];
  const rows = [];
  const xyzInk = isXyzWaterfallNode && type === "waterfall";
  const rgbInk = type === "waterfallRgb";
  const stereoInk = isStereoWaterfallNode && type === "waterfall" && !xyzInk;
  // Stereo (Output, 1D Waterfall Stereo, 2D Onset): Background, Left, Right, Stroke.
  // Mono waterfall: Background, one In color, Stroke.
  const quadInk = stereoInk;
  const monoInk = type === "waterfall" && !xyzInk && !stereoInk;
  const inkHueTitle = false;
  // Preview sits after Bright when present (RGB); otherwise after Size.
  const previewAfter = orderedPrimary.includes("dot1Brightness")
    ? "dot1Brightness"
    : "dot1Size";
  let previewPlaced = false;
  const pushPreview = () => {
    if (previewPlaced || isInstantWaterfall) {
      previewPlaced = true;
      return;
    }
    rows.push(nodeGraphStampPreviewHtml(stereoInk, type, xyzInk, rgbInk));
    previewPlaced = true;
  };
  const usedChoices = new Set();
  const usedToggles = new Set();
  if (toggleKeys.includes("skipDiscontinuities")) {
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml("skipDiscontinuities"));
    usedToggles.add("skipDiscontinuities");
  }
  if (isInstantWaterfall) {
    // Scroll+stamp history cannot lock to a zero-crossing. sourceSync stays hidden.
    if (choiceKeys.includes("syncChannel")) usedChoices.add("syncChannel");
    if (toggleKeys.includes("sourceSync")) usedToggles.add("sourceSync");
  } else if (toggleKeys.includes("sourceSync")) {
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml("sourceSync"));
    usedToggles.add("sourceSync");
  }
  if (choiceKeys.includes("drawMode")) {
    rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml("drawMode"));
    usedChoices.add("drawMode");
  }
  const stackHead = new Set([
    "scale",
    "historyHz",
    "historyCycles",
    "historySeconds",
    "zoomSeconds",
    "strokeThickness",
    "lineSmoothing",
    "framePadding",
    "fadeAmount",
    "timeMs",
    "backgroundBrightness",
    "backgroundHue",
  ]);
  const syncOnForStack = isInstantWaterfall
    ? false
    : (typeof nodeGraphTraceDisplaySyncChannel === "function"
      ? nodeGraphTraceDisplaySyncChannel(
        typeof nodeGraphTraceDisplaySettingsForNode === "function"
          ? nodeGraphTraceDisplaySettingsForNode(node)
          : null,
      ) !== "off"
      : false);
  const pushStackField = (key) => {
    if (!orderedPrimary.includes(key)) {
      return;
    }
    if (key === "zoomSeconds" && (
      orderedPrimary.includes("historySeconds")
      || orderedPrimary.includes("historyHz")
    )) {
      return;
    }
    if (key === "historySeconds" && orderedPrimary.includes("historyHz")) {
      return;
    }
    if (key === "historyCycles") {
      return;
    }
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type, { syncOn: syncOnForStack }));
  };
  // One Scale row (a second one read back empty and reset Scale).
  if (orderedPrimary.includes("scale") || (isInstantWaterfall && activeFields.has("scale"))) {
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml("scale", type, { syncOn: syncOnForStack }));
  }
  if (isInstantWaterfall && choiceKeys.includes("facePolarity")) {
    rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml("facePolarity"));
    usedChoices.add("facePolarity");
  }
  if (choiceKeys.includes("stereoBlend")) {
    rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml("stereoBlend"));
    usedChoices.add("stereoBlend");
  }
  // Instant Waterfall: History (seconds). Other faces may still swap to Cycles.
  if (orderedPrimary.includes("historySeconds") || orderedPrimary.includes("historyCycles")
    || orderedPrimary.includes("historyHz")) {
    const freeRunKey = orderedPrimary.includes("historySeconds") || !orderedPrimary.includes("historyHz")
      ? "historySeconds"
      : "historyHz";
    // Instant Waterfall: History Seconds | Beats right above its one stepper.
    const historyBeats = isInstantWaterfall && choiceKeys.includes("historyMode")
      && nodeGraphDisplaySettingsHistoryIsBeats(type);
    if (isInstantWaterfall && choiceKeys.includes("historyMode")) {
      rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml("historyMode"));
      usedChoices.add("historyMode");
    }
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(
      historyBeats || (!isInstantWaterfall && syncOnForStack) ? "historyCycles" : freeRunKey,
      type,
      { syncOn: !isInstantWaterfall && syncOnForStack },
    ));
  } else {
    pushStackField("historySeconds");
    pushStackField("zoomSeconds");
  }
  if (orderedPrimary.includes("timeMs")) {
    // Window (Cycles | Time) sits right above its one stepper.
    if (choiceKeys.includes("windowMode")) {
      rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml("windowMode"));
      usedChoices.add("windowMode");
    }
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(nodeGraphDisplaySettingsWindowRowKey(type), type));
  }
  if (node?.type === "onset" && toggleKeys.includes("autoRange")) {
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml("autoRange"));
  }
  usedToggles.add("autoRange");
  if (isInstantWaterfall && choiceKeys.includes("barInk")) {
    rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml("barInk"));
    usedChoices.add("barInk");
  }
  // Stroke thickness | Line blur side by side, as 1D Plot's line pair.
  const strokeKeys = isInstantWaterfall
    ? ["strokeThickness", "lineSmoothing"].filter((key) => orderedPrimary.includes(key))
    : [];
  if (strokeKeys.length > 1) {
    rows.push(`<div class="node-trace-display-pair-grid">${strokeKeys.map((key) => nodeGraphDisplaySettingsBuildStepperRowHtml(key, type)).join("")}</div>`);
  } else if (strokeKeys.length) {
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(strokeKeys[0], type));
  }
  const frameKeys = isInstantWaterfall
    ? ["framePadding", "fadeAmount"].filter((key) => orderedPrimary.includes(key))
    : [];
  if (frameKeys.length > 1) {
    rows.push(`<div class="node-trace-display-pair-grid">${frameKeys.map((key) => nodeGraphDisplaySettingsBuildStepperRowHtml(key, type)).join("")}</div>`);
  } else if (frameKeys.length) {
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(frameKeys[0], type));
  }
  if (isInstantWaterfall && toggleKeys.includes("pauseOnSilence")) {
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml("pauseOnSilence"));
    usedToggles.add("pauseOnSilence");
  }
  if (node?.type === "onset" && toggleKeys.includes("pauseAtEnd")) {
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml("pauseAtEnd"));
  }
  usedToggles.add("pauseAtEnd");
  pushStackField("backgroundBrightness");
  if (!(typeof nodeGraphDisplaySettingsFormTypeUsesGradient === "function"
    && nodeGraphDisplaySettingsFormTypeUsesGradient(type))) {
    pushStackField("backgroundHue");
  }
  const inkPrimary = orderedPrimary.filter((key) => !stackHead.has(key));
  if (stereoInk) {
    rows.push(`
      <div class="metadata-section-title node-trace-display-dot1-title node-trace-display-stereo-title">
        <button type="button" id="nodeTraceDisplaySwapStereoLook" class="node-trace-display-swap-lr">Swap L/R</button>
        <span id="nodeTraceDisplayDot1TitleLabel" class="node-trace-display-lr-pair node-trace-display-lr-heads">
          <span class="node-trace-display-lr-col-head">L</span>
          <span class="node-trace-display-lr-col-head">R</span>
        </span>
      </div>`);
  }

  const pairedSecondary = new Set();
  for (const key of inkPrimary) {
    const rightKey = stereoInk ? nodeGraphDisplaySettingsStereoPairKey(key) : "";
    if (rightKey && orderedSecondary.includes(rightKey)) {
      rows.push(nodeGraphDisplaySettingsBuildStereoPairRowHtml(key, rightKey, type));
      pairedSecondary.add(rightKey);
    } else if (inkHueTitle && key === "dot1Brightness") {
      rows.push(nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml({
        title: "Trace",
        stepField: "dot1Brightness",
        colorField: "dot1Color",
        formType: type,
        defaultHueHex: typeof nodeGraphHueUnitHex === "function"
          ? nodeGraphHueUnitHex(
            typeof nodeGraphHueDegFromHex === "function"
              && typeof nodeGraphScopePhosphorLookDefaults !== "undefined"
              ? nodeGraphHueDegFromHex(nodeGraphScopePhosphorLookDefaults.peakColor)
              : 60,
          )
          : "#fcfdbf",
        titleAttr: "Beam brightness 0…1 (black → full hue at 0.5 → white). Drag the title to change hue.",
      }));
    } else {
      rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type));
    }
    if (key === previewAfter) {
      pushPreview();
    }
  }
  if (!previewPlaced) {
    pushPreview();
  }
  for (const key of leftover) {
    if (key === "backgroundHue"
      && typeof nodeGraphDisplaySettingsFormTypeUsesGradient === "function"
      && nodeGraphDisplaySettingsFormTypeUsesGradient(type)) {
      continue;
    }
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type));
  }
  for (const key of choiceKeys) {
    if (usedChoices.has(key)) {
      continue;
    }
    rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml(key));
  }
  for (const key of toggleKeys) {
    if (key === "secondaryEnabled" || usedToggles.has(key)) {
      continue;
    }
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml(key));
  }
  if (capKeys.length) {
    rows.push(`<div class="metadata-section-title node-trace-display-caps-title">Caps</div>`);
    for (const key of capKeys) {
      rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type));
    }
  }
  if (orderedSecondary.length && !stereoInk) {
    const enabledToggle = activeToggles.has("secondaryEnabled")
      ? `<input id="nodeTraceDisplaySecondaryEnabled" type="checkbox" aria-label="Secondary on" data-trace-display-toggle="secondaryEnabled">`
      : "";
    rows.push(`
      <div class="metadata-section-title node-trace-display-secondary-title">
        <span id="nodeTraceDisplaySecondaryTitleLabel">Secondary</span>
        ${enabledToggle}
      </div>`);
    for (const key of orderedSecondary) {
      rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type));
    }
  } else if (orderedSecondary.length) {
    for (const key of orderedSecondary) {
      if (pairedSecondary.has(key)) {
        continue;
      }
      rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type));
    }
  }
  const stereoColorPair = stereoInk
    && inkColors.includes("dot1Color")
    && inkColors.includes("secondaryColor");
  const xyzColorTriple = xyzInk
    && inkColors.includes("dot1Color")
    && inkColors.includes("secondaryColor")
    && inkColors.includes("tertiaryColor");
  if (quadInk) {
    rows.push(nodeGraphDisplaySettingsColorRows([
      nodeGraphDisplaySettingsBuildColorRowHtml("backgroundColor", type),
      nodeGraphDisplaySettingsBuildColorRowHtml("dot1Color", type),
      nodeGraphDisplaySettingsBuildColorRowHtml("secondaryColor", type),
      nodeGraphDisplaySettingsBuildColorRowHtml("strokeLeftColor", type),
      nodeGraphDisplaySettingsBuildColorRowHtml("strokeRightColor", type),
    ], [3, 2]));
  } else if (monoInk) {
    rows.push(nodeGraphDisplaySettingsColorRows([
      nodeGraphDisplaySettingsBuildColorRowHtml("backgroundColor", type),
      nodeGraphDisplaySettingsBuildColorRowHtml("dot1Color", type),
      nodeGraphDisplaySettingsBuildColorRowHtml("strokeColor", type),
    ]));
  } else if (xyzColorTriple) {
    rows.push(nodeGraphDisplaySettingsHbsRow([
      nodeGraphDisplaySettingsBuildColorRowHtml("dot1Color", type, { xyz: true }),
      nodeGraphDisplaySettingsBuildColorRowHtml("secondaryColor", type, { xyz: true }),
      nodeGraphDisplaySettingsBuildColorRowHtml("tertiaryColor", type, { xyz: true }),
    ]));
  } else if (stereoColorPair) {
    rows.push(nodeGraphDisplaySettingsHbsRow([
      nodeGraphDisplaySettingsBuildColorRowHtml("dot1Color", type, { stereo: true }),
      nodeGraphDisplaySettingsBuildColorRowHtml("secondaryColor", type, { stereo: true }),
    ]));
  }
  const leftoverColors = [];
  for (const key of inkColors) {
    if ((quadInk || monoInk) && (key === "backgroundColor" || key === "dot1Color" || key === "secondaryColor" || key === "strokeColor" || key === "strokeLeftColor" || key === "strokeRightColor")) {
      continue;
    }
    if (xyzColorTriple && (key === "dot1Color" || key === "secondaryColor" || key === "tertiaryColor")) {
      continue;
    }
    if (stereoColorPair && (key === "dot1Color" || key === "secondaryColor")) {
      continue;
    }
    if (inkHueTitle && key === "dot1Color") {
      continue;
    }
    leftoverColors.push(nodeGraphDisplaySettingsBuildColorRowHtml(key, type, {
      stereo: stereoInk,
    }));
  }
  if (leftoverColors.length) {
    rows.push(nodeGraphDisplaySettingsColorRows(leftoverColors));
  }
  if (
    typeof nodeGraphDisplaySettingsFormTypeUsesGradient === "function"
    && nodeGraphDisplaySettingsFormTypeUsesGradient(type)
  ) {
    rows.push(`
      <div class="metadata-field-section node-trace-display-gradient-section">
        <div
          id="nodeTraceDisplayGradientSelectorHost"
          class="node-gradient-selector-host node-shared-gradient-host node-spectrogram-gradient-host"
          data-gradient-selector-host
          data-shared-gradient-host
          data-spectrogram-gradient-host></div>
      </div>`);
  }
  parts.push(`<div class="metadata-field-section node-trace-display-trace-section">${rows.join("")}</div>`);
  return parts.join("\n");
}

function nodeGraphDisplaySettingsBuildColorRowHtml(key, formType = null, options = {}) {
  const meta = nodeGraphDisplaySettingsColorRowMeta(key, formType, options);
  const idAttr = meta.id ? ` id="${nodeGraphDisplaySettingsEscapeHtml(meta.id)}"` : "";
  const caption = String(meta.caption || "").trim();
  const captionHtml = caption
    ? `<div class="node-trace-display-color-caption">${nodeGraphDisplaySettingsEscapeHtml(caption)}</div>`
    : "";
  return `
    <div class="node-trace-display-color-widget-row no-side-label${caption ? " has-color-caption" : ""}" data-trace-display-control-row data-trace-display-color-row="${key}">
      ${captionHtml}
      <div
        class="node-trace-display-color-widget-host"
        data-trace-display-color-widget="${key}"
        role="group"
        aria-label="${nodeGraphDisplaySettingsEscapeHtml(meta.aria || key)}"></div>
      <input type="hidden" data-trace-display-color="${key}"${idAttr} value="${nodeGraphDisplaySettingsEscapeHtml(meta.defaultValue || "#ffffff")}">
    </div>`;
}


function buildNodeGraphPhosphorDisplaySettingsBodyHtml(type, node, allowKey) {
  const activeFields = nodeGraphTraceDisplayActiveControlSet("fields", type);
  const activeColors = nodeGraphTraceDisplayActiveControlSet("colors", type);
  const activeToggles = nodeGraphTraceDisplayActiveControlSet("toggles", type);
  const activeChoices = nodeGraphTraceDisplayActiveControlSet("choices", type);
  const allow = typeof allowKey === "function" ? allowKey : () => true;
  const fieldList = [...activeFields].filter((key) => allow("fields", key));
  const toggleKeys = [...activeToggles].filter((key) => allow("toggles", key));
  const choiceKeys = [...activeChoices].filter((key) => allow("choices", key));
  const colorKeys = [...activeColors].filter((key) => allow("colors", key));
  const order = typeof nodeGraphPhosphorDisplayFieldOrder !== "undefined"
    ? nodeGraphPhosphorDisplayFieldOrder
    : (typeof nodeGraphDisplaySettingsSharedStackOrder !== "undefined"
      ? nodeGraphDisplaySettingsSharedStackOrder
      : fieldList);
  const ordered = order.filter((key) => fieldList.includes(key));
  const leftover = fieldList.filter((key) => !order.includes(key));
  // Clear always; Sync is placed above as its own checkbox when present.
  const packingKeys = [];
  const packingKeySet = new Set(packingKeys);
  const usedToggles = new Set();
  const usedChoices = new Set();
  const rows = [];
  let previewPlaced = false;
  const pushPreview = () => {
    if (previewPlaced) {
      return;
    }
    rows.push(nodeGraphStampPreviewHtml(false, type));
    previewPlaced = true;
  };
  // Clear sits at the very top, above Skip Discontinuity.
  rows.push(nodeGraphDisplaySettingsBuildPackingToggleRowHtml(packingKeys));
  if (toggleKeys.includes("skipDiscontinuities")) {
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml("skipDiscontinuities"));
    usedToggles.add("skipDiscontinuities");
  }
  if (toggleKeys.includes("sourceSync")) {
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml("sourceSync"));
    usedToggles.add("sourceSync");
  }
  for (const key of choiceKeys) {
    // Window (Cycles | Time) goes right above its stepper, below.
    if (key === "windowMode" && ordered.includes("timeMs")) {
      continue;
    }
    rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml(key));
    usedChoices.add(key);
  }
  for (const key of ordered) {
    if (key === "timeMs" && choiceKeys.includes("windowMode")) {
      rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml("windowMode"));
      usedChoices.add("windowMode");
    }
    if (key === "backgroundHue"
      && typeof nodeGraphDisplaySettingsFormTypeUsesGradient === "function"
      && nodeGraphDisplaySettingsFormTypeUsesGradient(type)) {
      continue;
    }
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(
      key === "timeMs" ? nodeGraphDisplaySettingsWindowRowKey(type) : key,
      type,
    ));
    if (key === "dot1Brightness") {
      pushPreview();
    }
  }
  if (!previewPlaced) {
    pushPreview();
  }
  for (const key of leftover) {
    if (key === "backgroundHue"
      && typeof nodeGraphDisplaySettingsFormTypeUsesGradient === "function"
      && nodeGraphDisplaySettingsFormTypeUsesGradient(type)) {
      continue;
    }
    rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type));
  }
  for (const key of toggleKeys) {
    if (usedToggles.has(key) || packingKeySet.has(key)) {
      continue;
    }
    rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml(key));
  }
  if (colorKeys.length) {
    rows.push(nodeGraphDisplaySettingsColorRows(
      colorKeys.map((key) => nodeGraphDisplaySettingsBuildColorRowHtml(key, type)),
      undefined,
      { fullWidth: true },
    ));
  }
  if (
    typeof nodeGraphDisplaySettingsFormTypeUsesGradient === "function"
    && nodeGraphDisplaySettingsFormTypeUsesGradient(type)
  ) {
    rows.push(`
      <div class="metadata-field-section node-trace-display-gradient-section">
        <div
          id="nodeTraceDisplayGradientSelectorHost"
          class="node-gradient-selector-host node-shared-gradient-host node-spectrogram-gradient-host"
          data-gradient-selector-host
          data-shared-gradient-host
          data-spectrogram-gradient-host></div>
      </div>`);
  }
  return `<div class="metadata-field-section node-trace-display-trace-section">${rows.join("")}</div>`;
}


const NODE_GRAPH_VACTROL_SCOPE_THICKNESS_KEYS = Object.freeze([
  "lightThickness",
  "fltThickness",
  "ampThickness",
  "memThickness",
]);

/**
 * Per-line Vactrol groups: standing title + Thickness (px). Structure can host
 * more per-line settings later. Labels stand alone (no title / hover tooltip).
 */
function nodeGraphVactrolScopeLineGroupsHtml() {
  const groups = [
    { title: "Light", key: "lightThickness" },
    { title: "Flt Env", key: "fltThickness" },
    { title: "Amp Env", key: "ampThickness" },
    { title: "Mem", key: "memThickness" },
  ];
  return groups.map(({ title, key }) => (
    `<div class="node-trace-display-line-group" data-vactrol-line-group="${key}">`
    + `<div class="node-trace-display-line-group-title">${nodeGraphDisplaySettingsEscapeHtml(title)}</div>`
    + nodeGraphDisplaySettingsBuildStepperRowHtml(key, "vactrolScope")
    + `</div>`
  )).join("");
}

function buildNodeGraphDisplaySettingsBodyHtml(formType, node = null) {
  const type = formType || "blank";
  // Modules with no face-specific schema — canvas pin lives in the chrome above.
  // Hint text is on tooltips (Show in canvas + blank body), not inline copy.
  if (type === "blank" || type === "none") {
    return `
      <div
        class="node-display-settings-blank"
        data-display-settings-blank="true"
        data-tooltip-key="displaySettings.blankBody"
        aria-label="No display-specific controls"></div>`;
  }
  if (type === "keypadFace" && typeof buildNodeGraphKeypadDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphKeypadDisplaySettingsBodyHtml();
  }
  if (type === "pluginSliderFace" && typeof buildNodeGraphSliderFaceDisplaySettingsHtml === "function") {
    return buildNodeGraphSliderFaceDisplaySettingsHtml();
  }
  if (
    (type === "toggleButtonFace" || type === "momentaryButtonFace")
    && typeof buildNodeGraphPluginButtonDisplaySettingsBodyHtml === "function"
  ) {
    return buildNodeGraphPluginButtonDisplaySettingsBodyHtml(type);
  }
  if (type === "sampleWaveform" && typeof buildNodeGraphSampleWaveformDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphSampleWaveformDisplaySettingsBodyHtml();
  }
  if (type === "arpKeysFace" && typeof buildNodeGraphArpKeysDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphArpKeysDisplaySettingsBodyHtml();
  }
  if (type === "transportBpm" && typeof buildNodeGraphTransportDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphTransportDisplaySettingsBodyHtml();
  }
  if (type === "ensembleCloud") {
    return `<div class="metadata-field-section node-trace-display-trace-section">${
      nodeGraphDisplaySettingsBuildStepperRowHtml("cloudSpeed", "ensembleCloud")
    }</div>`;
  }
  // Lone t Torch face: one Hue row (0..1 cycle).
  if (type === "torchFace") {
    return `<div class="metadata-field-section node-trace-display-trace-section">${
      nodeGraphDisplaySettingsBuildStepperRowHtml("torchHue", "torchFace")
    }</div>`;
  }
  if (type === "softpopFace" && typeof buildNodeGraphSoftpopDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphSoftpopDisplaySettingsBodyHtml();
  }
  if (type === "limiterGainFace" && typeof buildNodeGraphLimiterGainDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphLimiterGainDisplaySettingsBodyHtml();
  }
  if (type === "harmonicLines" && typeof buildNodeGraphHarmonicLinesDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphHarmonicLinesDisplaySettingsBodyHtml();
  }
  if (type === "portalFace" && typeof buildNodeGraphPortalDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphPortalDisplaySettingsBodyHtml();
  }
  if (type === "textBoxFace" && typeof buildNodeGraphTextBoxDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphTextBoxDisplaySettingsBodyHtml();
  }
  if (type === "rgbPictureFace" && typeof buildNodeGraphRgbPictureDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphRgbPictureDisplaySettingsBodyHtml();
  }
  if (type === "imageBurnFace" && typeof buildNodeGraphImageBurnDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphImageBurnDisplaySettingsBodyHtml();
  }
  if (type === "videoFeedbackFace" && typeof buildNodeGraphVideoFeedbackDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphVideoFeedbackDisplaySettingsBodyHtml();
  }
  // Matrix Waterfall / Matrix Display custom bodies.
  if (
    (type === "matrixFace" || type === "matrixWaterfallFace" || type === "matrixDisplayFace")
    && typeof buildNodeGraphMatrixFaceDisplaySettingsBodyHtml === "function"
  ) {
    return buildNodeGraphMatrixFaceDisplaySettingsBodyHtml(type);
  }
  if (type === "keyboardFace" && typeof buildNodeGraphKeyboardFaceDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphKeyboardFaceDisplaySettingsBodyHtml();
  }
  if (type === "pitchModWheelFace" && typeof buildNodeGraphPitchModWheelDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphPitchModWheelDisplaySettingsBodyHtml();
  }
  if (type === "pitchQuantizerFace" && typeof buildNodeGraphPitchQuantizerDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphPitchQuantizerDisplaySettingsBodyHtml();
  }
  if (type === "sturmianGridFace" && typeof buildNodeGraphSturmianGridDisplaySettingsBodyHtml === "function") {
    return buildNodeGraphSturmianGridDisplaySettingsBodyHtml();
  }
  const activeFields = nodeGraphTraceDisplayActiveControlSet("fields", type);
  const activeColors = nodeGraphTraceDisplayActiveControlSet("colors", type);
  const activeToggles = nodeGraphTraceDisplayActiveControlSet("toggles", type);
  const activeChoices = nodeGraphTraceDisplayActiveControlSet("choices", type);
  const isStereoWaterfallNode = typeof nodeGraphModuleUsesStereoWaterfall === "function"
    ? nodeGraphModuleUsesStereoWaterfall(node?.type)
    : node?.type === "output";
  const isXyzWaterfallNode = typeof nodeGraphModuleUsesXyzWaterfall === "function"
    ? nodeGraphModuleUsesXyzWaterfall(node?.type)
    : false;
  const parts = [];

  // Filter keys that only apply on stereo Trace faces (Output / SoEmReverb / …).
  const hasGateStrip = Boolean(
    typeof nodeGraphModuleDefinitions === "object" && nodeGraphModuleDefinitions?.[node?.type]?.gateStripPort,
  );
  const allowKey = (kind, key) => {
    // Threshold line + gate strip settings belong to RMS Meter only.
    if ((key === "thresholdThickness" || key === "thresholdColor") && (type !== "waterfall" || !hasGateStrip)) {
      return false;
    }
    if (type !== "waterfall") {
      return true;
    }
    if (key === "sourceSync" || key === "syncChannel") {
      return false;
    }
    if (isXyzWaterfallNode) {
      if (
        key === "secondarySize"
        || key === "secondaryBrightness"
        || key === "secondaryLineThickness"
        || key === "secondaryEnabled"
        || key === "syncChannel"
      ) {
        return false;
      }
      if (key === "sourceSync") {
        return true;
      }
      return true;
    }
    if (!isStereoWaterfallNode) {
      if (
        key === "secondarySize" ||
        key === "secondaryBrightness" ||
        key === "secondaryLineThickness" ||
        key === "secondaryEnabled" ||
        key === "secondaryColor" ||
        key === "tertiaryColor" ||
        key === "strokeLeftColor" ||
        key === "strokeRightColor" ||
        key === "syncChannel" ||
        key === "stereoBlend"
      ) {
        return false;
      }
    } else if (key === "sourceSync") {
      // Stereo Trace uses syncChannel select, not the legacy Sync checkbox.
      return false;
    } else if (key === "tertiaryColor") {
      return false;
    }
    return true;
  };

  const isVectorTraceForm = typeof nodeGraphDisplaySettingsIsVectorTraceFormType === "function"
    && nodeGraphDisplaySettingsIsVectorTraceFormType(type);
  if (isVectorTraceForm) {
    return buildNodeGraphInstantTraceDisplaySettingsBodyHtml(type, node, allowKey);
  }
  if (
    typeof nodeGraphDisplaySettingsIsPhosphorFormType === "function"
    && nodeGraphDisplaySettingsIsPhosphorFormType(type)
  ) {
    return buildNodeGraphPhosphorDisplaySettingsBodyHtml(type, node, allowKey);
  }
  const sectionOrder = nodeGraphDisplaySettingsIsPhosphorFormType(type)
    ? nodeGraphPhosphorDisplaySettingsSectionOrder
    : (isVectorTraceForm && typeof nodeGraphTraceDisplaySettingsSectionOrder !== "undefined"
      ? nodeGraphTraceDisplaySettingsSectionOrder
      : nodeGraphDisplaySettingsSectionOrder);
  const collectedColorCells = [];
  for (const section of sectionOrder) {
    if (section === "gradient") {
      if (!nodeGraphDisplaySettingsFormTypeUsesGradient(type)) {
        continue;
      }
      // Number Readout: gradient sits inside the Readout section (no gap after Background).
      if (type === "numberReadout") {
        continue;
      }
      parts.push(`
        <div class="metadata-field-section node-trace-display-gradient-section">
          <div
            id="nodeTraceDisplayGradientSelectorHost"
            class="node-gradient-selector-host node-shared-gradient-host node-spectrogram-gradient-host"
            data-gradient-selector-host
            data-shared-gradient-host
            data-spectrogram-gradient-host></div>
        </div>`);
      continue;
    }

    // Value LED / Value LCD: single Readout stack — no separate "Light" section title.
    // Order: Decimals → LED|Ink → Ghost → Trail → blend → Background → Ghost Gradient.
    if (type === "numberReadout" && section === "dot1") {
      continue;
    }
    if (type === "lcdDot" && section === "dot1") {
      continue;
    }
    if ((type === "vectorDot" || type === "pulseDot") && section === "dot1") {
      continue;
    }
    if ((type === "roundShapeFace" || type === "basicShapeFace" || type === "blitFace" || type === "sinCosFace" || type === "clockFace" || type === "clockDividerFace" || type === "pulseExplosionFace" || type === "pulseTrainFace" || type === "robinSinepulseFace" || type === "plotFace") && section === "dot1") {
      continue;
    }
    if (type === "additiveWaveform" && section === "dot1") continue;

    const sectionControls = nodeGraphTraceDisplaySectionControls[section];
    if (!sectionControls) {
      continue;
    }
    let fieldKeys = (sectionControls.fields || []).filter(
      (key) => activeFields.has(key) && allowKey("fields", key)
        // Trail / Ghost fade the stem plate; the reverb line displays draw their own way.
        && !(type === "hypersawBurn" && (key === "trail" || key === "ghost")
          && ["reverbEffect", "sabrinaReverbOriginal"].includes(String(node?.type || ""))),
    );
    if (type === "robinSinepulseFace" && section === "waterfall") {
      fieldKeys = ["lineSmoothing", "pixelDensity"].filter(
        (key) => activeFields.has(key) && allowKey("fields", key),
      );
    }
    if ((type === "roundShapeFace" || type === "basicShapeFace" || type === "blitFace" || type === "sinCosFace" || type === "clockFace" || type === "clockDividerFace" || type === "pulseExplosionFace" || type === "pulseTrainFace") && section === "waterfall") {
      fieldKeys = [
        "lineThickness",
        ...(type === "pulseTrainFace" && node?.type === "velvetReverb" ? ["tapLineBlur"] : []),
        "lineSmoothing",
        ...(type === "clockFace" ? ["startThickness", "blinkTime", "gateHeight"] : []),
        "dotThickness",
        ...(type === "sinCosFace" ? ["padExtra"] : []),
        ...(type === "pulseTrainFace" && node?.type !== "velvetReverb" ? ["fadeTime"] : []),
        "pixelDensity",
      ].filter((key) => activeFields.has(key) && allowKey("fields", key));
    }
    // Hit view: only the Stack fade time (old traces fading under a new hit).
    if (type === "pluckHitFace" && section === "waterfall") {
      fieldKeys = ["fadeTime"].filter((key) => activeFields.has(key) && allowKey("fields", key));
    }
    if (type === "formantFilterFace" && section === "waterfall") {
      fieldKeys = ["dotSize", "formantCurveThickness", "bodyThickness"]
        .filter((key) => activeFields.has(key) && allowKey("fields", key));
    }
    if (type === "additiveWaveform" && section === "waterfall") {
      fieldKeys = ["lineThickness", "lineSmoothing"]
        .filter((key) => activeFields.has(key) && allowKey("fields", key));
    }
    if (type === "plotFace" && section === "waterfall") {
      fieldKeys = ["timeMs", "scale", "plotOffset", "lineThickness", "lineSmoothing"]
        .filter((key) => activeFields.has(key) && allowKey("fields", key))
        .map((key) => (key === "timeMs" ? nodeGraphDisplaySettingsWindowRowKey(type) : key));
    }
    if (isVectorTraceForm && typeof nodeGraphDisplaySettingsOrderTraceInkFields === "function") {
      fieldKeys = nodeGraphDisplaySettingsOrderTraceInkFields(fieldKeys);
    }
    let colorKeys = (sectionControls.colors || []).filter(
      (key) => activeColors.has(key) && allowKey("colors", key),
    );
    if ((type === "roundShapeFace" || type === "basicShapeFace" || type === "blitFace" || type === "sinCosFace" || type === "clockFace" || type === "clockDividerFace" || type === "pulseExplosionFace" || type === "pulseTrainFace" || type === "robinSinepulseFace" || type === "plotFace") || type === "vectorDot" || type === "pulseDot" || type === "lcdDot" || type === "value") {
      colorKeys = [];
    }
    if (type === "waterfall" && isStereoWaterfallNode) {
      colorKeys = colorKeys.filter((key) => !NODE_GRAPH_TRACE_STEREO_COLOR_ORDER.includes(key));
    }
    let toggleKeys = (sectionControls.toggles || []).filter(
      (key) => activeToggles.has(key) && allowKey("toggles", key)
        // auto-zoom lines only draws on the reverb line displays, not Hypersaw stems.
        && (key !== "autoZoomLines" || ["reverbEffect", "sabrinaReverbOriginal"].includes(String(node?.type || ""))),
    );
    let choiceKeys = (sectionControls.choices || []).filter(
      (key) => activeChoices.has(key) && allowKey("choices", key),
    );
    if (type === "plotFace" && section === "waterfall") {
      // 1D Plot: Sync on/off. 1D Plot Stereo / 2D Plot: Sync = Off / Left / Right / Mono.
      const plotType = typeof nodeGraphPatchNode === "function"
        && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
        ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())?.type
        : null;
      const twoChannel = plotType === "plot1dStereo" || plotType === "plot2d" || plotType === "output";
      toggleKeys = toggleKeys.filter((key) => !(twoChannel && key === "sourceSync"));
      choiceKeys = (plotType === "plot2d" ? ["windowMode", "syncChannel", "plotDraw"] : (twoChannel ? ["windowMode", "syncChannel", "plotDraw", "barInk"] : ["windowMode", "plotDraw", "barInk"])).filter((key) => activeChoices.has(key));
    }
    if (type === "robinSinepulseFace" && section === "waterfall") {
      choiceKeys = ["faceView"].filter(
        (key) => activeChoices.has(key) && allowKey("choices", key),
      );
    }
    // Dot family: Shape lives in activeChoices; ensure it appears in the Dot section
    // even if an older section map omitted it.
    if (section === "dot1"
      && (type === "vectorDot" || type === "pulseDot" || type === "lcdDot")
      && activeChoices.has("shape")
      && !choiceKeys.includes("shape")) {
      choiceKeys = ["shape", ...choiceKeys];
    }
    if (section === "dot1"
      && (type === "vectorDot" || type === "pulseDot" || type === "lcdDot")
      && activeFields.has("shapeParam")
      && !fieldKeys.includes("shapeParam")) {
      // After Size/Blur so silhouette tweaks sit with stamp geometry.
      const blurIdx = fieldKeys.indexOf("lineThickness");
      if (blurIdx >= 0) {
        fieldKeys.splice(blurIdx + 1, 0, "shapeParam");
      } else {
        fieldKeys.push("shapeParam");
      }
    }
    if ((type === "vectorDot" || type === "pulseDot") && section === "waterfall") {
      fieldKeys = [
        "dot1Size",
        "lineThickness",
        "shapeParam",
        "backgroundBrightness",
        "dot1Brightness",
      ].filter((key) => activeFields.has(key) && allowKey("fields", key));
      colorKeys = [];
      choiceKeys = ["shape", "stereoBlend"].filter((key) => activeChoices.has(key) && allowKey("choices", key));
    }
    if (type === "lcdDot" && section === "waterfall") {
      const lcdDotModule = node?.type === "lcdDot";
      fieldKeys = [
        ...(lcdDotModule ? [] : ["dot1Size"]),
        "lineThickness",
        "shapeParam",
        "backgroundBrightness",
        // Sat lives on the shared hue-title color row (not a duplicate stepper).
        "dot1Brightness",
        "unlitSegments",
        "innerShadowDistance",
        "innerShadowSharpness",
        "innerShadowOffsetX",
        "innerShadowOffsetY",
      ].filter((key) => activeFields.has(key));
      colorKeys = [];
      choiceKeys = ["shape"].filter((key) => activeChoices.has(key));
    }
    if (type === "numberReadout" && section === "waterfall") {
      const nrNodeType = node?.type
        || (typeof nodeGraphPatchNode === "function"
          && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
          ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())?.type
          : null);
      if (["valueLcd", "helmholtzPitch", "edgeDetector"].includes(nrNodeType)) {
        // Value LCD (vector): Digits/Decimals + padding, Ghost plate, glass shadow — no residual hang.
        fieldKeys = [
          "digits",
          "decimals",
          "facePadding",
          "backgroundBrightness",
          // Sat lives on the shared hue-title color row (not a duplicate stepper).
          "dot1Brightness",
          "unlitSegments",
          ...(["helmholtzPitch", "edgeDetector"].includes(nrNodeType) ? ["centsBand"] : []),
          "innerShadowDistance",
          "innerShadowSharpness",
          "innerShadowOffsetX",
          "innerShadowOffsetY",
        ].filter((key) => activeFields.has(key));
        // Sign UI is showMinus / showPlus toggles (not polarity choice).
        choiceKeys = [];
        colorKeys = [];
      } else {
        // Value LED: Digits -> Decimals -> Padding -> LED -> Background -> Ghost -> Trail -> Burn x.
        fieldKeys = [
          "digits",
          "decimals",
          "facePadding",
          "dot1Brightness",
          "backgroundBrightness",
          "ghost",
          "ghostBlend",
          "trail",
          "burnAmount",
        ].filter((key) => activeFields.has(key));
        colorKeys = [];
        // Sign UI is showMinus / showPlus toggles (not polarity choice).
        choiceKeys = [];
      }
    }
    // syncChannel / stereoBlend live in activeChoices but are listed under
    // "waterfall" sectionChoices only for spectrogram historically — include
    // Output sync choices from active set even if not in section map.
    if (section === "waterfall" && type === "waterfall" && isStereoWaterfallNode) {
      for (const key of ["syncChannel", "stereoBlend"]) {
        if (activeChoices.has(key) && !choiceKeys.includes(key)) {
          choiceKeys.push(key);
        }
      }
    }
    if (section === "waterfall" && type === "waterfallXyz") {
      for (const key of ["stereoBlend", "xyzLayout"]) {
        if (activeChoices.has(key) && !choiceKeys.includes(key)) {
          choiceKeys.push(key);
        }
      }
    }
    if (!fieldKeys.length && !colorKeys.length && !toggleKeys.length && !choiceKeys.length) {
      // secondaryEnabled is only in section title for secondary; handle below.
      if (!(section === "secondary" && activeToggles.has("secondaryEnabled") && isStereoWaterfallNode && type === "waterfall")) {
        continue;
      }
    }

    let titleText = section === "waterfall"
      ? (nodeGraphDisplaySettingsFormTypeTitles[type] || "Trace")
      : section === "value"
        ? "Line"
        : section === "dot1"
          ? (isStereoWaterfallNode && type === "waterfall" ? "Left" : "Dot")
          : section === "secondary"
            ? (isStereoWaterfallNode && type === "waterfall" ? "Right" : "Secondary")
            : section === "caps"
              ? "Caps"
              : section;
    // Skip redundant section titles: NR chrome, phosphor "2D"/"Stamp" headers.
    const isPhosphorForm = typeof nodeGraphDisplaySettingsIsPhosphorFormType === "function"
      && nodeGraphDisplaySettingsIsPhosphorFormType(type);
    const skipSectionTitle =
      (type === "numberReadout" && section === "waterfall")
      || (type === "lcdDot" && section === "waterfall")
      || ((type === "vectorDot" || type === "pulseDot") && section === "waterfall")
      || (isPhosphorForm && (section === "waterfall" || section === "dot1"))
      || (isVectorTraceForm && section === "dot1" && !(isStereoWaterfallNode && type === "waterfall"));
    if (skipSectionTitle) {
      // no title row
    } else if (section === "waterfall" && isStereoWaterfallNode && type === "waterfall") {
      parts.push(`<div class="metadata-section-title node-trace-display-${section}-title">${nodeGraphDisplaySettingsEscapeHtml(titleText)}</div>`);
    } else if (section === "secondary") {
      const enabledToggle = isStereoWaterfallNode && type === "waterfall" && activeToggles.has("secondaryEnabled")
        ? `<input id="nodeTraceDisplaySecondaryEnabled" type="checkbox" aria-label="${isStereoWaterfallNode ? "Right on" : "Secondary on"}" data-trace-display-toggle="secondaryEnabled">`
        : "";
      parts.push(`
        <div class="metadata-section-title node-trace-display-secondary-title">
          <span id="nodeTraceDisplaySecondaryTitleLabel">${nodeGraphDisplaySettingsEscapeHtml(titleText)}</span>
          ${enabledToggle}
        </div>`);
    } else if (section === "dot1") {
      const dotTitle = type === "xyPad" ? "Beam & puck" : titleText;
      const swapHtml = isStereoWaterfallNode && type === "waterfall"
        ? `<button type="button" id="nodeTraceDisplaySwapStereoLook" class="node-trace-display-swap-lr">Swap L/R</button>`
        : "";
      parts.push(`
        <div class="metadata-section-title node-trace-display-dot1-title${swapHtml ? " node-trace-display-stereo-title" : ""}">
          <span id="nodeTraceDisplayDot1TitleLabel">${nodeGraphDisplaySettingsEscapeHtml(dotTitle)}</span>
          ${swapHtml}
        </div>`);
    } else {
      parts.push(`<div class="metadata-section-title node-trace-display-${section}-title">${nodeGraphDisplaySettingsEscapeHtml(titleText)}</div>`);
    }

    const rows = [];
    const hbsCells = [];
    // Sync | Clear sit *below* Dot Budget on phosphor faces.
    const packingCandidates = NODE_GRAPH_DISPLAY_PACKING_TOGGLE_KEYS.filter((key) => toggleKeys.includes(key));
    const packingKeys = packingCandidates;
    const packingKeySet = new Set(packingKeys);
    // 1D Plot / 1D Plot Stereo / 2D Plot: Window / Signal / Line groups.
    const plotLayout = type === "plotFace" && section === "waterfall";
    if (plotLayout) rows.push(...nodeGraphPlotDisplaySettingsRows(type, choiceKeys, toggleKeys, fieldKeys));
    // Preferred order: choices → toggles (except packing) → fields → packing → colors.
    // Spectrogram: one column, one row per control (label | dropdown).
    // Other faces may pack 2+ short choices into a two-column grid.
    if (plotLayout) {
      // Built above.
    } else if (type === "spectrogramBurn" || type === "spectrumLine" || choiceKeys.length < 2) {
      for (const key of choiceKeys) {
        rows.push(nodeGraphDisplaySettingsBuildChoiceRowHtml(key));
      }
    } else {
      rows.push(
        `<div class="node-trace-display-choice-grid">${
          choiceKeys.map((key) => nodeGraphDisplaySettingsBuildChoiceRowHtml(key)).join("")
        }</div>`,
      );
    }
    for (const key of plotLayout ? [] : toggleKeys) {
      if (section === "secondary" && key === "secondaryEnabled") {
        continue; // already in title
      }
      if (packingKeySet.has(key)) {
        continue; // after fields / Dot Budget
      }
      rows.push(nodeGraphDisplaySettingsBuildToggleRowHtml(key));
    }
    let vactrolLineGroupsPushed = false;
    for (const key of plotLayout ? [] : fieldKeys) {
      if (type === "vactrolScope" && NODE_GRAPH_VACTROL_SCOPE_THICKNESS_KEYS.includes(key)) {
        if (!vactrolLineGroupsPushed) {
          rows.push(nodeGraphVactrolScopeLineGroupsHtml());
          vactrolLineGroupsPushed = true;
        }
        continue;
      }
      if (key === "backgroundHue"
        && typeof nodeGraphDisplaySettingsFormTypeUsesGradient === "function"
        && nodeGraphDisplaySettingsFormTypeUsesGradient(type)) {
        continue;
      }
      // Individual Sat steppers are redundant — hue-title row already has Sat.
      if ((type === "numberReadout" || type === "lcdDot" || type === "vectorDot" || type === "pulseDot")
        && (key === "backgroundSaturation" || key === "dot1Saturation" || key === "colorSaturation")) {
        continue;
      }
      if (type === "numberReadout" && key === "backgroundBrightness") {
        const nrBgType = typeof nodeGraphPatchNode === "function"
          && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
          ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())?.type
          : null;
        const lcdPlate = ["valueLcd", "helmholtzPitch", "edgeDetector"].includes(nrBgType);
        hbsCells.push(nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml({
          title: "Background",
          stepField: "backgroundBrightness",
          colorField: "backgroundColor",
          formType: type,
          defaultHueHex: typeof nodeGraphHueUnitHex === "function"
            ? nodeGraphHueUnitHex(lcdPlate
              ? (typeof nodeGraphValueLcdDefaultHueDeg === "number" ? nodeGraphValueLcdDefaultHueDeg : 82)
              : 240)
            : (lcdPlate ? "#a2ff00" : "#0000ff"),
          titleAttr: lcdPlate
            ? "LCD plate brightness 0…1 (black → full hue at 0.5 → white). Drag the title to change hue."
            : "LED plate brightness 0…1 (black → full hue at 0.5 → white). Drag the title to change hue. Sat is on this row.",
        }));
        continue;
      }
      if (type === "numberReadout" && key === "dot1Brightness" && activeColors.has("dot1Color")) {
        const nrNodeType = typeof nodeGraphPatchNode === "function"
          && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
          ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())?.type
          : null;
        const lcdInk = ["valueLcd", "helmholtzPitch", "edgeDetector"].includes(nrNodeType);
        hbsCells.push(nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml({
          title: lcdInk ? "Foreground" : "LED",
          stepField: "dot1Brightness",
          colorField: "dot1Color",
          formType: type,
          defaultHueHex: lcdInk && typeof nodeGraphHueUnitHex === "function"
            ? nodeGraphHueUnitHex(typeof nodeGraphValueLcdDefaultHueDeg === "number"
              ? nodeGraphValueLcdDefaultHueDeg
              : 82)
            : undefined,
          titleAttr: lcdInk
            ? "LCD ink brightness 0…1 (black → full hue at 0.5 → white). Drag the title to change hue."
            : undefined,
        }));
        continue;
      }
      if ((type === "vectorDot" || type === "pulseDot" || type === "lcdDot") && key === "backgroundBrightness") {
        hbsCells.push(nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml({
          title: type === "lcdDot" ? "Background" : "BG",
          stepField: "backgroundBrightness",
          colorField: "backgroundColor",
          formType: type,
          defaultHueHex: typeof nodeGraphHueUnitHex === "function"
            ? nodeGraphHueUnitHex(type === "lcdDot"
              ? (typeof nodeGraphValueLcdDefaultHueDeg === "number" ? nodeGraphValueLcdDefaultHueDeg : 82)
              : 220)
            : (type === "lcdDot" ? "#a2ff00" : "#0055ff"),
          titleAttr: type === "lcdDot"
            ? "LCD plate brightness 0…1 (black → full hue at 0.5 → white). Drag the title to change hue."
            : "Plate brightness 0…1 (black → full hue at 0.5 → white). Drag the title to change hue. Sat is on this row.",
        }));
        continue;
      }
      if ((type === "vectorDot" || type === "pulseDot" || type === "lcdDot") && key === "dot1Brightness") {
        hbsCells.push(nodeGraphDisplaySettingsBuildHueTitleStepperRowHtml({
          title: type === "lcdDot" ? "Foreground" : "Dot",
          stepField: "dot1Brightness",
          colorField: "dot1Color",
          formType: type,
          defaultHueHex: typeof nodeGraphHueUnitHex === "function"
            ? nodeGraphHueUnitHex(type === "lcdDot" ? 210 : 30)
            : (type === "lcdDot" ? "#00aaff" : "#ff8000"),
          titleAttr: type === "lcdDot"
            ? "LCD ink brightness 0…1 (black → full hue at 0.5 → white). Drag the title to change hue."
            : "Dot brightness gain 0…1 (black → full hue at 0.5 → white). Signal energy scales this. Drag the title to change hue. Sat is on this row.",
        }));
        rows.push(nodeGraphStampPreviewHtml(false, type));
        continue;
      }
      if ((type === "roundShapeFace" || type === "basicShapeFace" || type === "blitFace" || type === "sinCosFace")
        && (key === "lineBrightness" || key === "dotBrightness" || key === "backgroundBrightness")) {
        continue;
      }
      rows.push(nodeGraphDisplaySettingsBuildStepperRowHtml(key, type));
    }
    if ((type === "roundShapeFace" || type === "basicShapeFace" || type === "blitFace" || type === "sinCosFace" || type === "clockFace" || type === "clockDividerFace" || type === "pulseExplosionFace" || type === "pulseTrainFace") && section === "waterfall") {
      // Background first, then Line, then Dot (same order as every other display).
      // Clock: Background, Pulse (line), Playhead (dot), Fill, Start, Blink.
      // Clock Divider: Background, Ring (line), Count (dot), Tick (start), Fire (blink).
      const clock = type === "clockFace";
      const divider = type === "clockDividerFace";
      const lamps = [
        ["background", "Background", "backgroundHue", "backgroundBrightness", "backgroundSaturation"],
        // Dark Velvet Reverb tap face: the line lamp only colours the text, so it is "Text".
        ["line", clock ? "Pulse" : divider ? "Ring" : (type === "pulseTrainFace" && node?.type === "velvetReverb") ? "Text" : "Line", "lineHue", "lineBrightness", "lineSaturation"],
      ];
      // Dark Velvet Reverb tap face (pulseTrainFace look): Background, Line
      // = Text (the readouts), Left / Right channel inks; no playhead.
      const velvetTaps = type === "pulseTrainFace" && node?.type === "velvetReverb";
      if (velvetTaps) {
        lamps.push(["left", "Left", "leftHue", "leftBrightness", "leftSaturation"]);
        lamps.push(["right", "Right", "rightHue", "rightBrightness", "rightSaturation"]);
      } else {
        lamps.push(["dot", clock ? "Playhead" : divider ? "Count" : "Dot", "dotHue", "dotBrightness", "dotSaturation"]);
      }
      if ((type === "pulseExplosionFace" || type === "pulseTrainFace") && !velvetTaps) {
        lamps.push(["playhead", "Playhead", "playheadHue", "playheadBrightness", "playheadSaturation"]);
        lamps.push(["lit", "Lit", "litHue", "litBrightness", "litSaturation"]);
      }
      if (clock) {
        lamps.push(["fill", "Fill", "fillHue", "fillBrightness", "fillSaturation"]);
        lamps.push(["start", "Tick", "startHue", "startBrightness", "startSaturation"]);
        lamps.push(["blink", "Blink", "blinkHue", "blinkBrightness", "blinkSaturation"]);
      }
      if (divider) {
        lamps.push(["start", "Tick", "startHue", "startBrightness", "startSaturation"]);
        lamps.push(["blink", "Fire", "blinkHue", "blinkBrightness", "blinkSaturation"]);
      }
      hbsCells.push(...lamps.map(([id, label, hue, bright, sat]) => `
          <div class="node-trace-display-hsl-lamp node-trace-display-color-widget-host" data-hsl-lamp="${id}" data-hsl-label="${label}">
            <input type="hidden" data-trace-display-field="${hue}" value="">
            <input type="hidden" data-trace-display-field="${bright}" value="">
            <input type="hidden" data-trace-display-field="${sat}" value="">
          </div>`));
    }
    if (type === "formantFilterFace" && section === "waterfall") {
      // Background, then one lamp per drawn element (Brightness 0 = not drawn).
      const lamps = [
        ["background", "Background", "backgroundHue", "backgroundBrightness", "backgroundSaturation"],
        ["dot", "Dots", "dotHue", "dotBrightness", "dotSaturation"],
        ["curve", "Curve", "curveHue", "curveBrightness", "curveSaturation"],
        ["body", "Body", "bodyHue", "bodyBrightness", "bodySaturation"],
      ];
      hbsCells.push(...lamps.map(([id, label, hue, bright, sat]) => `
          <div class="node-trace-display-hsl-lamp node-trace-display-color-widget-host" data-hsl-lamp="${id}" data-hsl-label="${label}">
            <input type="hidden" data-trace-display-field="${hue}" value="">
            <input type="hidden" data-trace-display-field="${bright}" value="">
            <input type="hidden" data-trace-display-field="${sat}" value="">
          </div>`));
    }
    if (type === "plotFace" && section === "waterfall") {
      // Background, then the line(s): Line (1D / 2D Plot), Left / Right
      // (1D Plot Stereo / Output), or one lamp per displaySignalPort (MIDI CC Raw / Out).
      const plotNode = typeof nodeGraphPatchNode === "function"
        && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
        ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())
        : null;
      const plotNodeType = plotNode?.type || null;
      const plotPorts = (typeof nodeGraphModuleDefinitions !== "undefined"
        && nodeGraphModuleDefinitions[plotNodeType]
        && Array.isArray(nodeGraphModuleDefinitions[plotNodeType].displaySignalPorts))
        ? nodeGraphModuleDefinitions[plotNodeType].displaySignalPorts
        : null;
      const stereo = plotNodeType === "plot1dStereo" || plotNodeType === "output";
      // Two 1D traces share this face (not XY). Each line gets its own HBS lamp
      // on the same row; values persist on lineHue* / dotHue* in the patch.
      const twoTrace = stereo
        || (plotNodeType !== "plot2d" && Array.isArray(plotPorts) && plotPorts.length > 1);
      const lineA = stereo ? "Left" : (twoTrace && plotPorts && plotPorts[0] ? String(plotPorts[0]) : "Line");
      const lineB = stereo ? "Right" : (plotPorts && plotPorts[1] ? String(plotPorts[1]) : "Out");
      const lamps = [
        ["background", "Background", "backgroundHue", "backgroundBrightness", "backgroundSaturation"],
        ["line", lineA, "lineHue", "lineBrightness", "lineSaturation"],
      ];
      if (twoTrace) lamps.push(["dot", lineB, "dotHue", "dotBrightness", "dotSaturation"]);
      hbsCells.push(...lamps.map(([id, label, hue, bright, sat]) => `
          <div class="node-trace-display-hsl-lamp node-trace-display-color-widget-host" data-hsl-lamp="${id}" data-hsl-label="${label}">
            <input type="hidden" data-trace-display-field="${hue}" value="">
            <input type="hidden" data-trace-display-field="${bright}" value="">
            <input type="hidden" data-trace-display-field="${sat}" value="">
          </div>`));
    }
    // Sync | Clear — one row under Dot Budget (1D + 2D phosphor).
    // Plot: Sync sits in the Window row and there is nothing to Clear.
    if (!plotLayout && (packingKeys.length || type === "lineBurn" || type === "scope2d" || type === "xyPad")) {
      rows.push(nodeGraphDisplaySettingsBuildPackingToggleRowHtml(packingKeys));
    }
    for (const key of colorKeys) {
      hbsCells.push(nodeGraphDisplaySettingsBuildColorRowHtml(key, type));
    }
    if (hbsCells.length) {
      collectedColorCells.push(...hbsCells);
    }
    // Value LED: Ghost Gradient under Background. Value LCD skips (reflective ink model).
    if (type === "numberReadout" && section === "waterfall"
      && typeof nodeGraphDisplaySettingsFormTypeUsesGradient === "function"
      && nodeGraphDisplaySettingsFormTypeUsesGradient(type)) {
      const nrNodeType = typeof nodeGraphPatchNode === "function"
        && typeof nodeGraphTraceDisplaySettingsTargetNodeId === "function"
        ? nodeGraphPatchNode(nodeGraphTraceDisplaySettingsTargetNodeId())?.type
        : null;
      if (!["valueLcd", "helmholtzPitch", "edgeDetector"].includes(nrNodeType)) {
        rows.push(`
        <div class="metadata-section-title node-trace-display-gradient-title">Ghost Gradient</div>
        <div
          id="nodeTraceDisplayGradientSelectorHost"
          class="node-gradient-selector-host node-shared-gradient-host node-spectrogram-gradient-host"
          data-gradient-selector-host
          data-shared-gradient-host
          data-spectrogram-gradient-host></div>`);
      }
    }
    parts.push(`<div class="metadata-field-section node-trace-display-${section}-section">${rows.join("")}</div>`);
  }

  // Scan Grid: Clear packing row, above the colors (APP_POLICY §21b) (wipe rolling W×H plate + re-arm ingest).
  if (type === "rasterRgbFace") {
    parts.push(
      `<div class="metadata-field-section node-trace-display-packing-section">${
        nodeGraphDisplaySettingsBuildPackingToggleRowHtml([])
      }</div>`,
    );
  }

  if (collectedColorCells.length) {
    parts.push(
      `<div class="metadata-field-section node-trace-display-colors-section">${
        nodeGraphDisplaySettingsColorRows(collectedColorCells)
      }</div>`,
    );
  }

  return parts.join("\n");
}

