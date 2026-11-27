// Ideal normalized wet M/S coefficients, drawn linearly from settings.
// Shared WebGL geometry only; no second analysis, timer, or retained face cache.
const NODE_GRAPH_PRISM_GRADIENT = Object.freeze([
  { t: 0, color: "#7350fa" },
  { t: .25, color: "#536bff" },
  { t: .5, color: "#32d9c0" },
  { t: .8, color: "#f6c75b" },
  { t: 1, color: "#fff4d7" },
]);

function normalizeNodeGraphSpectralPrismSettings(settings = {}) {
  const curve = Number(settings?.spectralFrequencyCurve);
  return {
    // Curve (frequency spacing) is a display setting: 0 linear Hz, 1 logarithmic.
    spectralFrequencyCurve: Number.isFinite(curve) ? Math.max(0, Math.min(1, curve)) : 1,
    gradientStops: normalizeNodeGraphSharedGradientStops(settings?.gradientStops, NODE_GRAPH_PRISM_GRADIENT),
    backgroundHue: Number.isFinite(Number(settings?.backgroundHue)) ? Number(settings.backgroundHue) : 0,
  };
}

function drawNodeGraphSpectralPrismItem(renderer, item, pixelRatio) {
  const nodeId = String(item?.slot?.nodeId || "");
  const node = nodeGraphPatchNode(nodeId);
  const canvas = nodeGraphModuleScopeLocalFallbackCanvas(item?.slot);
  const screen = item?.screenElement || item?.slot?.scopeElement;
  if (!node || !canvas || !screen) return;
  if (!syncNodeGraphModuleScopeLocalFallbackCanvas(canvas, screen, pixelRatio, 1)) return;
  const W = canvas.width | 0, H = canvas.height | 0;
  if (W < 1 || H < 1) return;
  if (scopePaintIsFacePoweredOff(nodeId)) {
    delete canvas._prismSignature;
    return;
  }
  const p = {};
  for (const spec of nodeGraphModuleDefinitions.spectralPrism.parameters) {
    const value = Number(node.params?.[spec.key] ?? spec.defaultValue);
    p[spec.key] = Number.isFinite(value) ? value : Number(spec.defaultValue);
  }
  const look = normalizeNodeGraphSpectralPrismSettings(node.traceDisplaySettings);
  p.frequencyCurve = look.spectralFrequencyCurve;
  const meta = nodeGraphSpectralFaceBus(nodeId, "PrismMeta");
  const rate = meta?.[3] || nodeGraphModuleScopeState?.sampleRate || 48000;
  const shimmerOffset = (meta?.[2] || 0) + (meta?.[4] || 0);
  const evolution = (meta?.[5] || 0) + (meta?.[6] || 0);
  const sig = `${meta?.[0] || 0}|${W}x${H}|${JSON.stringify(p)}|${JSON.stringify(look)}`;
  if (canvas._prismSignature === sig) return;
  const batch = nodeGraphGlLinesBegin(canvas, [0.008, 0.01, 0.016, 1]);
  if (!batch) return;
  const ink = Math.min(W,H)/96;
  nodeGraphGlLinesSegment(batch, 0, H/2, W, H/2, .35*ink, .6, [.38,.48,.55,.3]);
  const lut = spectrogramLutRgbForStops(nodeGraphApplyGradientHueRotation(look.gradientStops, look));
  const response=NodeGraphSpectralPrismCurve.points(W,H,rate,p,shimmerOffset,evolution);
  const points=response.side;
  nodeGraphGlLinesPolyline(batch,response.centre,.6*ink,.65,[.65,.75,.8,.6]);
  // Fixed screen bands keep adaptive vertex counts from shifting the colours.
  let start=0;
  for(let band=0;band<32;band++){
    let end=start;
    const edge=W*(band+1)/32;
    while(end+2<points.length&&points[end+2]<=edge+1e-4)end+=2;
    const j=Math.round((band+.5)/32*(lut.length/3-1))*3;
    nodeGraphGlLinesPolyline(batch,points.subarray(start,end+2),.8*ink,.65,[lut[j]/255,lut[j+1]/255,lut[j+2]/255,.9]);
    start=end;
  }
  nodeGraphGlLinesText(batch,"wet M/S",W-40,10,{px:8,family:"monospace",rgba:[.75,.8,.85,.7]});
  nodeGraphGlLinesText(batch,"+1",3,10,{px:8,family:"monospace",rgba:[.75,.8,.85,.7]});
  nodeGraphGlLinesText(batch,"-1",3,H-3,{px:8,family:"monospace",rgba:[.75,.8,.85,.7]});
  if (nodeGraphGlLinesEnd(batch)) canvas._prismSignature=sig;
}

nodeGraphModuleScopeCustomRenderers.spectralPrism = drawNodeGraphSpectralPrismItem;
nodeGraphRegisterFacePaintKind("spectralPrism", "param");
