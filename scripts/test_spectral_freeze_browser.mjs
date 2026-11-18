import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire(new URL('../../soemdsp-sandbox/package.json', import.meta.url))('playwright')); }
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: [
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') console.log('browser error:', m.text()); });
  await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
  await page.route(/node-live-audio-worklet-native-graph\.js/, async route => {
    const response = await route.fetch();
    const probe = `
const originalFreezeQuantum = NodeLiveAudioProcessor.prototype.processNativeGraphQuantum;
NodeLiveAudioProcessor.prototype.processNativeGraphQuantum = function(...args) {
  const result = originalFreezeQuantum.apply(this, args);
  if (this.nativeGraph && this.nativeGraphHandle && this.nodes) for (const [id, node] of this.nodes) {
    if (node.type !== 'spectralFreeze') continue;
    const h = this.nativeGraph.soemdsp_graph_node_native_handle(this.nativeGraphHandle, this.fnv1aHash32(String(id)));
    const held = this.nativeGraph.soemdsp_spectral_freeze_held(h);
    if (held !== this.testFreezeHeld) { this.testFreezeHeld = held; this.port.postMessage({ type: 'test-freeze-held', held }); }
  }
  return result;
};`;
    await route.fulfill({ response, body: await response.text() + probe });
  });
  await page.goto((process.env.SANDBOX_URL || 'http://127.0.0.1:9447/') + '?mode=circuitbuilder',
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof showNodeGraphModule === 'function'
    && document.body.dataset.nodeBootFinished === 'interface-ready', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const placeholder = await page.evaluate(() => ({
    listed: nodeGraphModuleStoreTypesList().includes('fftReconstruction'),
    category: nodeGraphModuleStoreCatalog.fftReconstruction.category,
    parked: nodeGraphModuleTypeIsUnderConstruction('fftReconstruction'),
    spawn: showNodeGraphModule('fftReconstruction', { x: 20, y: 20 }),
  }));
  assert.equal(placeholder.listed, true); assert.equal(placeholder.category, 'sample');
  assert.equal(placeholder.parked, true); assert.ok(!placeholder.spawn, 'placeholder cannot spawn fake DSP');
  const ids = await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const source = showNodeGraphModule('polyBlep', { x: 20, y: 40 }, options);
    const freeze = showNodeGraphModule('spectralFreeze', { x: 300, y: 40 }, options);
    if (!source || !freeze) throw new Error('Freeze must be spawnable');
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.nodes = patch.nodes.filter(n => [source, freeze].includes(n.id) || n.type === 'output');
    const output = patch.nodes.find(n => n.type === 'output');
    patch.nodes.find(n => n.id === source).params = { waveform: 1, frequency: 187.5, amplitude: 0.2 };
    patch.connections = [
      { sourceNode: source, sourcePort: 'Wave', destinationNode: freeze, destinationPort: 'In' },
      { sourceNode: freeze, sourcePort: 'Mono', destinationNode: output.id, destinationPort: 'Mono' },
    ];
    patch.modulations = []; commitNodeGraphPatch(patch, { status: 'Freeze test' });
    const plan = nodeGraphBuildLivePlan(); if (plan.issues?.length) throw new Error(JSON.stringify(plan.issues));
    return { source, freeze };
  });
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(true));
  try {
    await page.waitForFunction(() => nodeGraphMvp.live.node && nodeGraphMvp.live.outputLevelSmooth > 0.00001, null, { timeout: 30000 });
  } catch (error) {
    console.log(await page.evaluate(() => Object.fromEntries(Object.entries(nodeGraphMvp.live).filter(([,v]) => v == null || ['string','number','boolean'].includes(typeof v)))));
    throw error;
  }
  await page.evaluate(() => {
    window.testHeld = -1;
    nodeGraphMvp.live.node.port.addEventListener('message', e => { if (e.data?.type === 'test-freeze-held') window.testHeld = e.data.held; });
    nodeGraphMvp.live.node.port.start();
  });
  const clickFreeze = async () => {
    const point = await page.evaluate(id => {
      const article = nodeGraphSliderForParameter(id, 'freeze').closest('article');
      const face = article.querySelector('.node-face');
      const widgets = nodeGraphModuleFaceWidgets(nodeGraphModuleFaceSpecForElement(article), face.offsetWidth, article);
      const wd = widgets.find(w => w.param === 'freeze');
      if (!wd?.button || wd.horizontal) throw new Error('Freeze must use the shared click-only button');
      const rect = face.getBoundingClientRect(), z = rect.width / face.offsetWidth;
      return { x: rect.left + (wd.x + wd.w / 2) * z, y: rect.top + (wd.y + wd.h / 2) * z };
    }, ids.freeze);
    await page.mouse.click(point.x, point.y);
  };
  await clickFreeze();
  await page.waitForFunction(() => window.testHeld === 1, null, { timeout: 15000 });
  await page.evaluate(id => updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id, 'amplitude'), '0'), ids.source);
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => nodeGraphMvp.live.outputLevelSmooth > 0.00001), 'freeze sustains after source silence');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(id => {
      const box = nodeGraphSliderForParameter(id, 'mix').closest('article').getBoundingClientRect();
      const area = document.getElementById('nodeGraphWorkspace').getBoundingClientRect();
      nodeGraphMvp.pan.x += (innerWidth - box.width) / 2 - box.left;
      nodeGraphMvp.pan.y += area.top + 25 - box.top; applyNodeGraphViewportCssLight();
    }, ids.freeze);
    await page.screenshot({ path: path.join(os.tmpdir(), `spectral-freeze-${width}.png`), timeout: 15000 });
  }
  await clickFreeze();
  await page.waitForFunction(() => window.testHeld === 0 && nodeGraphMvp.live.outputLevelSmooth < 0.00001, null, { timeout: 15000 });
  assert.deepEqual(errors, []);
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(false));
  console.log('Browser: real native capture/hold, sustained audio with silent source, Live release, GL desktop/mobile and no page errors pass.');
} finally { await browser.close(); }
