import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire(new URL('../../soemdsp-sandbox/package.json', import.meta.url))('playwright')); }
const browser = await chromium.launch({ headless: true, channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
  await page.goto((process.env.SANDBOX_URL || 'http://127.0.0.1:9447/') + '?mode=circuitbuilder',
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof showNodeGraphModule === 'function'
    && document.body.dataset.nodeBootFinished === 'interface-ready', null, { timeout: 60000 });
  const report = await page.evaluate(async () => {
    const id = showNodeGraphModule('noiseConvReverb', { x: 40, y: 40 },
      { record: false, autosaveWorkingPatch: false, skipLivePlan: true });
    const slider = nodeGraphSliderForParameter(id, 'decay');
    const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
    const node = patch.nodes.find(n => n.id === id);
    node.params.decay = 0.001;
    node.params.brightness = 0;
    commitNodeGraphPatch(patch, { record: false, autosaveWorkingPatch: false, skipLivePlan: true });
    const response = await fetch(nodeGraphLiveCombinedNativeModuleUrl);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(),
      { env: { emo_process_block() {} } });
    return { min: Number(slider.min), mid: Number(node.paramMeta.decay.mid),
      value: Number(nodeGraphPatchNode(id).params.decay),
      brightness: Number(nodeGraphPatchNode(id).params.brightness),
      nativeVersion: instance.exports.soemdsp_noise_conv_reverb_version() };
  });
  assert.equal(report.min, 0.001);
  assert.equal(report.mid, 0.1);
  assert.equal(report.value, 0.001);
  assert.equal(report.brightness, 0);
  assert.equal(report.nativeVersion, 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...report, errors }));
} finally { await browser.close(); }
