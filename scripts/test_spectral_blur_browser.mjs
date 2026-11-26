// Browser check for Spectral Blur, Spectral Warble and Spectral Smear: spawn, patch to Output, live audio, FFT Size changes reach the native
// module, the face controls exist and turning them keeps the audio running. SANDBOX_URL picks the server.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire(new URL('../../soemdsp-sandbox/package.json', import.meta.url))('playwright')); }
const modules = [
  { type: 'spectralBlur', prefix: 'soemdsp_spectral_blur', set: { fuzz: '300', grain: '3', stereoSpread: '0.5', monoBassHz: '200', voices: '4', seed: '7' }, defaults: { fuzz: 100, grain: 1, stereoSpread: 1, monoBassHz: 0, voices: 3 } },
  { type: 'spectralWarble', prefix: 'soemdsp_spectral_warble', set: { depth: '60', rate: '6', drunk: '0.8', voices: '4', stereoSpread: '0.5', monoBassHz: '200', seed: '7' }, defaults: { depth: 25, rate: 4, drunk: 0.5, voices: 3, stereoSpread: 1, monoBassHz: 120 } },
  { type: 'spectralSmear', prefix: 'soemdsp_spectral_smear', set: { smearSeconds: '0.5', blurHz: '200', blurCents: '100', diffusion: '0.5', diffusionSpeedHz: '60', stereoSpread: '0.5', monoBassHz: '200', amplitudeSmoothMs: '20', seed: '7' }, defaults: { smearSeconds: 2, blurHz: 100, blurCents: 0, diffusion: 1, diffusionSpeedHz: 30, stereoSpread: 1, monoBassHz: 120, phaseSmoothMs: 10, amplitudeSmoothMs: 0 } },
];
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: [
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const reports = [];
try {
  for (const mod of modules) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
    // Test-only observation: report the actual core size after native processing.
    await page.route(/node-live-audio-worklet-native-graph\.js/, async route => {
      const response = await route.fetch();
      const probe = `
const originalBlurQuantum = NodeLiveAudioProcessor.prototype.processNativeGraphQuantum;
NodeLiveAudioProcessor.prototype.processNativeGraphQuantum = function(...args) {
  const result = originalBlurQuantum.apply(this, args);
  if (this.nativeGraph && this.nativeGraphHandle && this.nodes) for (const [id, node] of this.nodes) {
    if (node.type !== ${JSON.stringify(mod.type)}) continue;
    const h = this.nativeGraph.soemdsp_graph_node_native_handle(this.nativeGraphHandle, this.fnv1aHash32(String(id)));
    const length = this.nativeGraph.${mod.prefix}_fft_size(h);
    if (length && length !== this.testBlurSize) {
      this.testBlurSize = length; this.port.postMessage({ type: 'test-blur-size', length });
    }
    ${mod.type === 'spectralSmear' ? `const ov = this.nativeGraph.soemdsp_spectral_smear_overlap(h);
    if (ov && ov !== this.testOverlap) { this.testOverlap = ov; this.port.postMessage({ type: 'test-overlap', overlap: ov }); }` : ''}
  }
  return result;
};`;
      await route.fulfill({ response, body: await response.text() + probe });
    });
    await page.goto((process.env.SANDBOX_URL || 'http://127.0.0.1:9447/') + '?mode=circuitbuilder',
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof showNodeGraphModule === 'function'
      && document.body.dataset.nodeBootFinished === 'interface-ready', null, { timeout: 150000, polling: 500 });
    await page.waitForTimeout(500);
    const id = await page.evaluate((type) => {
      const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
      const source = showNodeGraphModule('polyBlep', { x: 20, y: 40 }, options);
      const blur = showNodeGraphModule(type, { x: 300, y: 40 }, options);
      if (!source || !blur) throw new Error(type + ' must be spawnable');
      const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
      patch.nodes = patch.nodes.filter(n => [source, blur].includes(n.id) || n.type === 'output');
      const output = patch.nodes.find(n => n.type === 'output');
      patch.nodes.find(n => n.id === source).params = { waveform: 1, frequency: 187.5, amplitude: 0.2 };
      patch.connections = [
        { sourceNode: source, sourcePort: 'Wave', destinationNode: blur, destinationPort: 'In' },
        { sourceNode: blur, sourcePort: 'Mono', destinationNode: output.id, destinationPort: 'Mono' },
      ];
      patch.modulations = [];
      commitNodeGraphPatch(patch, { status: type + ' browser test' });
      const plan = nodeGraphBuildLivePlan();
      if (plan.issues?.length) throw new Error(JSON.stringify(plan.issues));
      return blur;
    }, mod.type);
    await page.evaluate(() => setNodeGraphLiveOutputEnabled(true));
    await page.waitForFunction(() => nodeGraphMvp.live.node && nodeGraphMvp.live.outputLevelSmooth > 0.00001, null, { timeout: 60000 });
    await page.evaluate(() => {
      window.testBlurSizes = []; window.testOverlaps = [];
      nodeGraphMvp.live.node.port.addEventListener('message', e => { if (e.data?.type === 'test-blur-size') window.testBlurSizes.push(e.data.length); if (e.data?.type === 'test-overlap') window.testOverlaps.push(e.data.overlap); });
      nodeGraphMvp.live.node.port.start();
    });
    for (const size of [512, 2048, 4096, 8192, 16384, 1024]) {
      await page.evaluate(({ id, size }) => updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id, 'fftSize'), String(size)), { id, size });
      await page.waitForFunction(size => window.testBlurSizes.includes(size), size, { timeout: 15000 });
    }
    if (mod.type === 'spectralSmear') {
      // Hop: flipping the choice at runtime reaches the native module (overlap 4 <-> 8), more than once, and the delay stays the FFT size
      for (const [value, overlap] of [['1', 8], ['0', 4], ['1', 8], ['0', 4]]) {
        await page.evaluate(({ id, value }) => updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id, 'hopMode'), value), { id, value });
        await page.waitForFunction(o => window.testOverlaps.at(-1) === o, overlap, { timeout: 15000 });
      }
    }
    const state = await page.evaluate(({ id, keys }) => {
      const n = nodeGraphPatchNode(id);
      return { values: keys.map(k => nodeGraphReadPatchParameterValue(n, k)), sliders: keys.map(k => !!nodeGraphSliderForParameter(id, k)),
        mixOnFace: !!nodeGraphSliderForParameter(id, 'mix'), renderer: nodeGraphModuleDisplayRendererForNode(n) };
    }, { id, keys: Object.keys(mod.defaults) });
    assert.deepEqual(state.values, Object.values(mod.defaults), `${mod.type} defaults`);
    assert.ok(state.sliders.every(Boolean) && state.mixOnFace, `${mod.type}: its controls are on the face`);
    assert.equal(state.renderer, 'spectralStyle');
    // T13: the inactive-parameter rules name only parameters this module has, and the table is the one the face draws from
    const rules = await page.evaluate(({ id, type }) => { const r = NODE_GRAPH_FACE_INACTIVE_PARAMS[type] || {}; const n = nodeGraphPatchNode(id); const has = k => !!nodeGraphSliderForParameter(id, k); return Object.entries(r).map(([k, rule]) => [k, has(k), rule.anyOf.every(c => has(c.when))]); }, { id, type: mod.type });
    assert.ok(rules.every(([k, ok, whens]) => ok && whens), `${mod.type}: every inactive rule names real parameters (${JSON.stringify(rules)})`);
    if (mod.type === 'spectralSmear') assert.deepEqual(rules.map(r => r[0]).sort(), ['diffusionSpeedHz', 'monoBassHz', 'phaseSmoothMs', 'stereoSpread']);
    await page.evaluate(({ id, set }) => { for (const [k, v] of Object.entries(set)) updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id, k), v); }, { id, set: mod.set });
    await page.waitForFunction(() => nodeGraphMvp.live.outputLevelSmooth > 0.00001, null, { timeout: 30000 });
    const peak = await page.evaluate(() => nodeGraphMvp.live.outputLevelSmooth);
    await page.evaluate(id => {
      const box = nodeGraphSliderForParameter(id, 'mix').closest('article').getBoundingClientRect();
      const area = document.getElementById('nodeGraphWorkspace').getBoundingClientRect();
      nodeGraphMvp.pan.x += (innerWidth - box.width) / 2 - box.left;
      nodeGraphMvp.pan.y += area.top + 25 - box.top; applyNodeGraphViewportCssLight();
    }, id);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(os.tmpdir(), `${mod.type}.png`), timeout: 15000 });
    reports.push({ type: mod.type, peak });
    assert.ok(peak > 0);
    await page.evaluate(() => setNodeGraphLiveOutputEnabled(false));
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ reports, errors }));
} finally { await browser.close(); }
