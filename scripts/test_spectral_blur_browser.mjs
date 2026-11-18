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
  await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
  await page.goto((process.env.SANDBOX_URL || 'http://127.0.0.1:9447/') + '?mode=circuitbuilder',
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof showNodeGraphModule === 'function'
    && document.body.dataset.nodeBootFinished === 'interface-ready', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const id = await page.evaluate(() => {
    const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
    const source = showNodeGraphModule('polyBlep', { x: 20, y: 40 }, options);
    const blur = showNodeGraphModule('spectralBlur', { x: 300, y: 40 }, options);
    if (!source || !blur) throw new Error('Spectral Blur must be spawnable');
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    patch.nodes = patch.nodes.filter(n => [source, blur].includes(n.id) || n.type === 'output');
    const output = patch.nodes.find(n => n.type === 'output');
    patch.nodes.find(n => n.id === source).params = { waveform: 1, frequency: 187.5, amplitude: 0.2 };
    patch.connections = [
      { sourceNode: source, sourcePort: 'Wave', destinationNode: blur, destinationPort: 'In' },
      { sourceNode: blur, sourcePort: 'Mono', destinationNode: output.id, destinationPort: 'Mono' },
    ];
    patch.modulations = [];
    commitNodeGraphPatch(patch, { status: 'Spectral Blur browser test' });
    const plan = nodeGraphBuildLivePlan();
    if (plan.issues?.length) throw new Error(JSON.stringify(plan.issues));
    return blur;
  });
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(true));
  await page.waitForFunction(() => nodeGraphMvp.live.node && nodeGraphMvp.live.outputLevelSmooth > 0.00001,
    null, { timeout: 60000 });
  const reports = [];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(id => {
      const box = nodeGraphSliderForParameter(id, 'mix').closest('article').getBoundingClientRect();
      const area = document.getElementById('nodeGraphWorkspace').getBoundingClientRect();
      nodeGraphMvp.pan.x += (innerWidth - box.width) / 2 - box.left;
      nodeGraphMvp.pan.y += area.top + 25 - box.top; applyNodeGraphViewportCssLight();
    }, id);
    await page.waitForTimeout(300);
    reports.push(await page.evaluate(id => {
      const node = nodeGraphPatchNode(id);
      return { renderer: nodeGraphModuleDisplayRendererForNode(node),
        seconds: node.paramMeta.smearSeconds.unit, hz: node.paramMeta.blurHz.unit,
        peak: nodeGraphMvp.live.outputLevelSmooth };
    }, id));
    await page.screenshot({ path: path.join(os.tmpdir(), `spectral-blur-${width}.png`), timeout: 15000 });
  }
  assert.ok(reports.every(r => r.renderer === 'scope1dTrace' && r.seconds === 's' && r.hz === 'Hz' && r.peak > 0));
  assert.deepEqual(errors, []);
  await page.evaluate(() => setNodeGraphLiveOutputEnabled(false));
  console.log(JSON.stringify({ reports, errors }));
} finally { await browser.close(); }
