// T16 for Spectral Warble, Cloud and Smear: a maximum raised in the parameter settings reaches the DSP unclamped, and the effect goes past the old max,
// also through modulation. Limits come only from the parameter definitions and the user, never from code.
//   A. native: each raised value is USED (the effect is past what the old max would give), and the graph engine's unit-band modulation reaches past the old max
//   B. browser: the worklet pushes exactly the raised value and the raised max (domain) for every parameter (needs SANDBOX_URL, like the browser test)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const sr = 48000;
const load = async name => (await WebAssembly.instantiate(await WebAssembly.compile(fs.readFileSync(new URL(`../native_modules/${name}/${name}.wasm`, import.meta.url))), {})).exports;
const rms = (a, lo = 0) => { let e = 0; for (let i = lo; i < a.length; ++i) e += a[i] * a[i]; return Math.sqrt(e / (a.length - lo)); };
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const sine = (f0, a = 0.1) => i => a * Math.sin(2 * Math.PI * f0 * i / sr);
const fftInPlace = (re, im) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; ++i) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; ++k) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
};
const spreadHz = out => { // RMS frequency spread of a (nominally single) line: 65536-point Hann PSD, second moment about the strongest bin
  const nfft = 65536, ps = new Float64Array(nfft / 2 + 1); let segs = 0;
  for (let s = 0; s + nfft <= out.length; s += nfft / 2) { const re = new Float64Array(nfft), im = new Float64Array(nfft); for (let i = 0; i < nfft; ++i) re[i] = out[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / nfft)); fftInPlace(re, im); for (let k = 0; k <= nfft / 2; ++k) ps[k] += re[k] * re[k] + im[k] * im[k]; ++segs; }
  let c = 1; for (let k = 2; k < ps.length; ++k) if (ps[k] > ps[c]) c = k;
  let sum = 0, pw = 0; for (let k = 1; k <= ps.length - 1; ++k) { const d = (k - c) * sr / nfft; sum += ps[k] * d * d; pw += ps[k]; }
  return Math.sqrt(sum / pw);
};
// the pitch of a sine in cents against f0 every ms (complex demodulation), as in the Warble test
const track = (sig, f0, bw = 400) => {
  const taps = Math.round(2 * sr / bw) | 1, win = new Float64Array(taps); for (let i = 0; i < taps; ++i) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 1) / (taps + 1));
  const dec = 48, half = taps >> 1, re = new Float64Array(sig.length), im = new Float64Array(sig.length);
  for (let i = 0; i < sig.length; ++i) { const p = 2 * Math.PI * f0 * i / sr; re[i] = sig[i] * Math.cos(p); im[i] = -sig[i] * Math.sin(p); }
  const phases = []; for (let c = sr + half; c + half < sig.length; c += dec) { let a = 0, b = 0; for (let j = 0; j < taps; ++j) { a += re[c - half + j] * win[j]; b += im[c - half + j] * win[j]; } phases.push(Math.atan2(b, a)); }
  const cents = []; for (let i = 1; i < phases.length; ++i) { let d = phases[i] - phases[i - 1]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); cents.push(1200 * Math.log2(Math.max(1e-6, 1 + (d * sr / dec) / (2 * Math.PI * f0)))); }
  return cents;
};

// the raised settings: [parameter key, graph slot, the old max, the raised max, the value set]
const modules = {
  spectralWarble: { native: 'spectral_warble', params: [['depth', 13, 200, 1000, 800], ['rate', 57, 20, 200, 150], ['drunk', 47, 1, 5, 3], ['stereoSpread', 1, 1, 2, 1.5], ['monoBassHz', 10, 1000, 5000, 3000]] },
  spectralBlur: { native: 'spectral_blur', params: [['fuzz', 30, 1200, 4800, 3000], ['grain', 51, 6, 24, 12], ['stereoSpread', 1, 1, 2, 1.5], ['monoBassHz', 10, 1000, 5000, 3000]] },
  spectralSmear: { native: 'spectral_smear', params: [['blurHz', 31, 4000, 24000, 20000], ['blurCents', 10, 1200, 4800, 3000], ['smearSeconds', 52, 10, 60, 40], ['diffusionSpeedHz', 57, 200, 1000, 800], ['stereoSpread', 1, 1, 2, 1.5], ['monoBassHz', 46, 1000, 5000, 3000]] },
};

// ---- A. native: the raised values are used
{
  // Warble: a depth of 800 cents is an 800 cent RMS wobble, not 200
  const w = await load('spectral_warble');
  const warble = depth => { const h = w.soemdsp_spectral_warble_create(); w.soemdsp_spectral_warble_set_warble(h, depth, 4, 0, 1, 1); w.soemdsp_spectral_warble_set_stereo(h, 0, 0); const o = []; for (let i = 0; i < 8 * sr; ++i) { const v = sine(1760)(i); o.push(w.soemdsp_spectral_warble_sample(h, v, v, 1, sr)); } w.soemdsp_spectral_warble_destroy(h); return o; };
  const sp200 = spreadHz(warble(200).slice(sr)), sp800 = spreadHz(warble(800).slice(sr));
  console.log(`A Warble: the output spreads ${sp200.toFixed(0)} Hz at Depth 200 and ${sp800.toFixed(0)} Hz at Depth 800`);
  assert.ok(sp800 > sp200 * 2.5, `Warble Depth 800 is used, not capped at 200 (${sp800} vs ${sp200})`);
  // Cloud: Fuzz 3000 is wider than Fuzz 1200, and Grain 12 does not boost
  const c = await load('spectral_blur');
  const cloud = (fuzz, grain) => { const h = c.soemdsp_spectral_blur_create(); c.soemdsp_spectral_blur_set_cloud(h, fuzz, grain, 3, 1); c.soemdsp_spectral_blur_set_stereo(h, 0, 0); const o = []; for (let i = 0; i < 7 * sr; ++i) { const v = sine(1760)(i); o.push(c.soemdsp_spectral_blur_sample(h, v, v, 1, sr)); } c.soemdsp_spectral_blur_destroy(h); return o.slice(sr); };
  const s1200 = spreadHz(cloud(1200, 0)), s3000 = spreadHz(cloud(3000, 0));
  console.log(`A Cloud: spread ${s1200.toFixed(0)} Hz at Fuzz 1200, ${s3000.toFixed(0)} Hz at Fuzz 3000`);
  assert.ok(s3000 > s1200 * 1.15, `Cloud Fuzz 3000 is wider than 1200 (${s3000} vs ${s1200})`);
  const g0 = cloud(1200, 0), g12 = cloud(1200, 12);
  assert.ok(rms(g12) <= rms(g0) * 10 ** (0.1 / 20) + 1e-9, 'Cloud Grain 12 never raises the level');
  // Smear: Frequency Blur 20000 Hz, Pitch Blur 3000 cents, Time Smear 40 s, Diffusion Speed 800 Hz, Stereo Spread 1.5
  const s = await load('spectral_smear');
  const smear = (o, n = 7 * sr, input = sine(1760)) => { const h = s.soemdsp_spectral_smear_create(); s.soemdsp_spectral_smear_set_stereo(h, o.spread ?? 0, 0, o.speed ?? 30); s.soemdsp_spectral_smear_set_blur_cents(h, o.cents ?? 0); const l = [], r = []; for (let i = 0; i < n; ++i) { const v = input(i); l.push(s.soemdsp_spectral_smear_sample(h, v, v, o.smear ?? 0, o.hz ?? 0, o.diff ?? 0, 1, sr)); r.push(s.soemdsp_spectral_smear_right(h)); } s.soemdsp_spectral_smear_destroy(h); return [l.slice(sr), r.slice(sr)]; };
  const hz4000 = spreadHz(smear({ hz: 4000 })[0]), hz20000 = spreadHz(smear({ hz: 20000 })[0]);
  console.log(`A Smear: Frequency Blur spreads ${hz4000.toFixed(0)} Hz at 4000, ${hz20000.toFixed(0)} Hz at 20000`);
  assert.ok(hz20000 > hz4000 * 1.05, `Smear Frequency Blur 20000 reaches the DSP (no radius cap): wider than 4000 (${hz20000} vs ${hz4000})`);
  const c1200 = spreadHz(smear({ cents: 1200 })[0]), c3000 = spreadHz(smear({ cents: 3000 })[0]);
  console.log(`A Smear: Pitch Blur spreads ${c1200.toFixed(0)} Hz at 1200 cents, ${c3000.toFixed(0)} Hz at 3000`);
  assert.ok(c3000 > c1200 * 1.1, `Smear Pitch Blur 3000 is wider than 1200 (${c3000} vs ${c1200})`);
  // Time Smear 40 s: the tail time constant of a noise-free burst is about 40 s (energy ratio between two windows 20 s apart)
  const burst = i => i < 2 * sr ? sine(1760)(i) : 0;
  const tail = smear({ smear: 40 }, 62 * sr, burst)[0]; // already without the first second
  const e = (t, d) => { let a = 0; for (let i = Math.round(t * sr); i < Math.round((t + d) * sr); ++i) a += tail[i] * tail[i]; return a / d; };
  const tau = 20 / Math.log(e(10, 1) / e(30, 1));
  console.log(`A Smear: Time Smear 40 s gives a tail time constant of ${tau.toFixed(1)} s`);
  assert.ok(tau > 30 && tau < 52, `Smear Time Smear 40 s is used (${tau})`);
  // (at hop N/4 the phase walk is already fully random above about 12 Hz, so 800 is compared with an unsaturated 2 Hz)
  const sp8 = smear({ diff: 1, speed: 800 }), sp2 = smear({ diff: 1, speed: 2 });
  assert.ok(spreadHz(sp8[0]) > spreadHz(sp2[0]) * 1.2, `Smear Diffusion Speed 800 Hz is used (wider than 2 Hz: ${spreadHz(sp8[0])} vs ${spreadHz(sp2[0])})`);
  // Stereo Spread 1.5 differs from 1 (it is used as given, above 1)
  const a1 = smear({ diff: 1, spread: 1 }), a15 = smear({ diff: 1, spread: 1.5 }); let d = 0; for (let i = 0; i < a1[1].length; ++i) d += (a1[1][i] - a15[1][i]) ** 2;
  assert.ok(d > 0, 'Smear Stereo Spread 1.5 is used as given');
}

// ---- A2. the graph engine: unit-band modulation reaches past the old max when the domain's max is raised, and stops at the old max when it is not
{
  const g = await WebAssembly.instantiate(await WebAssembly.compile(fs.readFileSync(new URL('../native_modules/combined/soemdsp_combined.wasm', import.meta.url))), { env: { emo_process_block() {} } });
  const x = g.exports, N = 128, rate = sr;
  const cases = [
    { name: 'Smear Frequency Blur', native: 'spectral_smear', type: 282, slot: 31, base: 3000, oldMax: 4000, newMax: 24000, unit: 0.25,
      sample: (ref, a, z, v) => { x.soemdsp_spectral_smear_set_stereo(ref, 1, 120, 30); x.soemdsp_spectral_smear_set_smoothing(ref, 10, 0); x.soemdsp_spectral_smear_set_seed(ref, 0); x.soemdsp_spectral_smear_set_overlap(ref, 4); x.soemdsp_spectral_smear_set_blur_cents(ref, 0); return x.soemdsp_spectral_smear_sample(ref, a, z, 2, v, 1, 1, rate); }, create: () => x.soemdsp_spectral_smear_create(), destroy: h => x.soemdsp_spectral_smear_destroy(h) },
    { name: 'Cloud Fuzz', native: 'spectral_blur', type: 272, slot: 30, base: 1000, oldMax: 1200, newMax: 4800, unit: 0.25,
      sample: (ref, a, z, v) => { x.soemdsp_spectral_blur_set_cloud(ref, v, 1, 3, 0); x.soemdsp_spectral_blur_set_stereo(ref, 1, 0); return x.soemdsp_spectral_blur_sample(ref, a, z, 1, rate); }, create: () => x.soemdsp_spectral_blur_create(), destroy: h => x.soemdsp_spectral_blur_destroy(h) },
    { name: 'Warble Depth', native: 'spectral_warble', type: 281, slot: 13, base: 180, oldMax: 200, newMax: 1000, unit: 0.25,
      sample: (ref, a, z, v) => { x.soemdsp_spectral_warble_set_warble(ref, v, 4, 0.5, 3, 0); x.soemdsp_spectral_warble_set_stereo(ref, 1, 120); return x.soemdsp_spectral_warble_sample(ref, a, z, 1, rate); }, create: () => x.soemdsp_spectral_warble_create(), destroy: h => x.soemdsp_spectral_warble_destroy(h) },
  ];
  for (const c of cases) for (const [label, max] of [['raised', c.newMax], ['old', c.oldMax]]) {
    const gr = x.soemdsp_graph_create(), ref = c.create(); x.soemdsp_graph_set_sample_rate(gr, rate);
    for (const [id, kind] of [[1, 132], [2, c.type], [3, 6]]) assert.equal(x.soemdsp_graph_add_node(gr, id, kind), 0);
    x.soemdsp_graph_connect(gr, 1, 0, 2, 0); for (const p of [1, 2]) x.soemdsp_graph_connect(gr, 2, p, 3, p);
    x.soemdsp_graph_set_param(gr, 2, c.slot, c.base); x.soemdsp_graph_set_param_domain(gr, 2, c.slot, 0, max, 0); x.soemdsp_graph_set_param_mod(gr, 2, c.slot, c.unit, 0);
    x.soemdsp_graph_snap_controls(gr); assert.equal(x.soemdsp_graph_compile(gr), 0);
    const expected = Math.min(max, Math.max(0, c.base + c.unit * max)); // unit-band: base as a share of the domain, plus the modulation, then clamped to the DOMAIN (the user's range)
    const buf = (id, p) => new Float64Array(x.memory.buffer, x.soemdsp_graph_node_port_ptr(gr, id, p), N);
    let err = 0;
    for (let b = 0; b < 40; ++b) {
      const a = buf(1, 0); for (let i = 0; i < N; ++i) a[i] = 0.1 * Math.sin((b * N + i) * 0.07); const src = a.slice();
      x.soemdsp_graph_process_block(gr, N);
      const out = [buf(2, 1).slice(), buf(2, 2).slice()];
      for (let i = 0; i < N; ++i) { const y = c.sample(ref, src[i], src[i], expected); err = Math.max(err, Math.abs(out[0][i] - y)); }
    }
    assert.ok(err < 1e-9, `${c.name}: the engine uses the modulated value ${expected} (${label} max ${max}; error ${err})`);
    if (label === 'raised') assert.ok(expected > c.oldMax, `${c.name}: the effective value ${expected} is past the old max ${c.oldMax}`); else assert.equal(expected, c.oldMax, `${c.name}: with the old max the modulation stops there`);
    c.destroy(ref); x.soemdsp_graph_destroy(gr);
  }
  console.log('A2 the graph engine follows the raised domain through modulation for Smear, Cloud and Warble');
}

// ---- B. browser: the worklet pushes exactly the raised value and the raised max for every parameter
if (process.env.SANDBOX_URL) {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = createRequire(new URL('../../soemdsp-sandbox/package.json', import.meta.url))('playwright')); }
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  try {
    for (const [type, mod] of Object.entries(modules)) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.on('pageerror', e => errors.push(String(e)));
      await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
      await page.route(/node-live-audio-worklet-native-graph\.js/, async route => {
        const response = await route.fetch();
        // Report the values the worklet hands to the engine by adding a message at the two call sites that do it (the test edits the SERVED text only).
        let body = await response.text();
        const setCall = 'native.soemdsp_graph_set_param(this.nativeGraphHandle, hash, paramId, v);';
        const domainCall = '  const lo = Number(min);\n  const hi = Number(max);';
        assert.ok(body.includes(setCall) && body.includes(domainCall), 'the worklet push sites are where the test expects them');
        body = body.replace(setCall, 'this.port.postMessage({ type: "test-param", paramId, value: v }); ' + setCall)
          .replace(domainCall, domainCall + '\n  this.port.postMessage({ type: "test-domain", paramId, min: lo, max: hi });');
        await route.fulfill({ response, body });
      });
      await page.addInitScript(() => { window.testSeen = { params: [], domains: [] }; const Original = window.AudioWorkletNode; window.AudioWorkletNode = class extends Original { constructor(...a) { super(...a); this.port.addEventListener('message', e => { if (e.data?.type === 'test-param') window.testSeen.params.push([e.data.paramId, e.data.value]); if (e.data?.type === 'test-domain') window.testSeen.domains.push([e.data.paramId, e.data.min, e.data.max]); }); this.port.start(); } }; });
      await page.goto(process.env.SANDBOX_URL + '?mode=circuitbuilder', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => typeof showNodeGraphModule === 'function' && document.body.dataset.nodeBootFinished === 'interface-ready', null, { timeout: 150000, polling: 500 });
      await page.waitForTimeout(500);
      const setup = JSON.stringify(mod.params.map(([key, , , max, value]) => ({ key, max, value })));
      await page.evaluate(({ type, setup }) => {
        const options = { record: false, autosaveWorkingPatch: false, skipLivePlan: true };
        const source = showNodeGraphModule('polyBlep', { x: 20, y: 40 }, options), node = showNodeGraphModule(type, { x: 300, y: 40 }, options);
        const patch = cloneNodeGraphPatch(nodeGraphMvp.patch);
        patch.nodes = patch.nodes.filter(n => [source, node].includes(n.id) || n.type === 'output');
        const output = patch.nodes.find(n => n.type === 'output'), target = patch.nodes.find(n => n.id === node);
        patch.nodes.find(n => n.id === source).params = { waveform: 1, frequency: 187.5, amplitude: 0.2 };
        for (const { key, max, value } of JSON.parse(setup)) { target.paramMeta[key].max = max; target.params[key] = value; } // raised in the parameter settings
        patch.connections = [{ sourceNode: source, sourcePort: 'Wave', destinationNode: node, destinationPort: 'In' }, { sourceNode: node, sourcePort: 'Mono', destinationNode: output.id, destinationPort: 'Mono' }];
        patch.modulations = [];
        commitNodeGraphPatch(patch, { status: type + ' raised max' });
        const plan = nodeGraphBuildLivePlan(); if (plan.issues?.length) throw new Error(JSON.stringify(plan.issues));
      }, { type, setup });
      await page.evaluate(() => setNodeGraphLiveOutputEnabled(true));
      await page.waitForFunction(() => nodeGraphMvp.live.node && nodeGraphMvp.live.outputLevelSmooth > 0.00001, null, { timeout: 60000 });
      const nodeId = await page.evaluate(({ type }) => nodeGraphMvp.patch.nodes.find(n => n.type === type).id, { type });
      // move each parameter on its slider (to half, then to the raised value) so the worklet is certain to push it while the listener is attached
      for (const [key, , , , value] of mod.params) {
        await page.evaluate(({ id, key, value }) => updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id, key), String(value * 0.5)), { id: nodeId, key, value });
        await page.waitForTimeout(400);
        await page.evaluate(({ id, key, value }) => updateNodeSliderCurrentValue(nodeGraphSliderForParameter(id, key), String(value)), { id: nodeId, key, value });
        await page.waitForTimeout(400);
      }
      const seen = await page.evaluate(() => window.testSeen);
      for (const [key, slot, oldMax, newMax, value] of mod.params) {
        const pushed = seen.params.filter(([id]) => id === slot).map(([, v]) => v), domains = seen.domains.filter(([id]) => id === slot).map(([, , max]) => max);
        assert.ok(pushed.includes(value), `${type}.${key}: the worklet pushed exactly ${value} (saw ${JSON.stringify(pushed.slice(-6))}); a clamp to the old max ${oldMax} would have pushed that instead`);
        assert.ok(domains.includes(newMax) && !domains.every(m => m === oldMax), `${type}.${key}: the pushed domain carries the raised max ${newMax} (saw ${JSON.stringify([...new Set(domains)])})`);
      }
      console.log(`B ${type}: the worklet pushed the raised values and domains for ${mod.params.map(p => p[0]).join(', ')}`);
      await page.evaluate(() => setNodeGraphLiveOutputEnabled(false)); await page.close();
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
} else console.log('B skipped: set SANDBOX_URL to run the browser half');
console.log('T16 raised maxima reach the DSP unclamped for Warble, Cloud and Smear.');
