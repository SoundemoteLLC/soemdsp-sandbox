import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/early_reflection_convolution/early_reflection_convolution.wasm',import.meta.url)),{})).instance.exports;
const p='soemdsp_early_reflection_convolution_';
const call=(name,...args)=>x[p+name](...args);
const metadata=JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,call('metadata_json'),call('metadata_json_size'))));
assert.equal(metadata.targetType,'earlyReflectionConvolution'); assert.equal(metadata.parameters.length,16);
assert.ok(metadata.parameters.every(p=>p.tooltip && p.defaultValue!==undefined));
const defaults=[4,5,2.5,.3,.3,.5,.6,.7,.5,.6,12000,.18,3];
function configure(h,rate,changes={}) {
  const names=['width','depth','height','sx','sy','sz','lx','ly','lz','absorption','damping','ears','order'];
  const args=defaults.map((v,i)=>changes[names[i]]??v);
  return call('configure',h,...args,rate,changes.diffusion??0,changes.diffusionMs??8);
}
function settle(h,rate) {
  for(let i=0;i<rate*4;++i) {
    call('sample',h,0,0,1);
    if(call('ready',h) && !call('busy',h)) return i;
  }
  throw Error('kernel did not become ready');
}
for(const rate of [44100,48000,96000,192000]) {
  const h=call('create'); assert.ok(h); assert.equal(configure(h,rate),0);
  const build=settle(h,rate), size=call('ir_length',h), latency=call('latency');
  const ir=[0,1].map(ear=>Float64Array.from({length:size},(_,i)=>call('ir_sample',h,ear,i)));
  // Empty histories on initial preparation; consume queued zeros before the impulse.
  for(let i=0;i<512;++i) call('sample',h,0,0,1);
  let error=0, stereo=0;
  for(let i=0;i<size+latency+512;++i) {
    const left=call('sample',h,i===0?1:0,i===0?1:0,1), right=call('right',h);
    const at=i-latency;
    error=Math.max(error,Math.abs(left-(ir[0][at]||0)),Math.abs(right-(ir[1][at]||0)));
    stereo+=Math.abs(left-right);
    assert.ok(Number.isFinite(left+right));
  }
  assert.ok(error<2e-6,`impulse equals generated IR at ${rate}: ${error}`);
  assert.ok(stereo>.001,'spaced receivers produce stereo');
  assert.ok(ir[0].some(v=>Math.abs(v)>1e-5),'IR has audible reflections');
  const first=ir[0].findIndex(v=>Math.abs(v)>1e-10);
  assert.ok(first>1,'no hidden direct path');
  // Partition boundaries and arbitrary input are checked against direct convolution.
  const positions=[0,127,255,256,511,900], amplitudes=[.2,-.1,.3,.05,-.2,.1];
  for(let i=0;i<size+1500;++i) {
    const index=positions.indexOf(i), value=index<0?0:amplitudes[index];
    const out=call('sample',h,value,value,1);
    let expected=0; for(let j=0;j<positions.length;++j) expected+=amplitudes[j]*(ir[0][i-latency-positions[j]]||0);
    assert.ok(Math.abs(out-expected)<3e-6,`direct convolution at ${i}: ${out} vs ${expected}`);
  }
  for(let i=0;i<size+768;++i) {
    const left=call('sample',h,i===0?.37:0,i===0?-.21:0,0), right=call('right',h);
    assert.ok(Math.abs(left-(i===256?.37:0))<2e-8 && Math.abs(right-(i===256?-.21:0))<2e-8,'dry stereo shares exact latency');
  }
  // First-order image geometry: six walls; two-sample fractional arrival.
  assert.equal(configure(h,rate,{order:1,ears:0,damping:1e9}),0); settle(h,rate);
  const distances=[Math.hypot(-1.2-2.4,1.5-3.5,0),Math.hypot(8-1.2-2.4,1.5-3.5,0),
    Math.hypot(1.2-2.4,-1.5-3.5,0),Math.hypot(1.2-2.4,10-1.5-3.5,0),
    Math.hypot(1.2-2.4,1.5-3.5,-1.25-1.25),Math.hypot(1.2-2.4,1.5-3.5,5-1.25-1.25)];
  const expected=new Float64Array(call('ir_length',h));
  for(const d of distances) { const t=d*rate/343, i=Math.floor(t), f=t-i, g=Math.sqrt(.4)/d; expected[i]+=g*(1-f); expected[i+1]+=g*f; }
  for(let i=0;i<expected.length;++i) {
    assert.ok(Math.abs(call('ir_sample',h,0,i)-expected[i])<1e-6,'physical wall arrival and inverse-distance gain');
    assert.equal(call('ir_sample',h,0,i),call('ir_sample',h,1,i),'zero receiver spacing links stereo');
  }
  const diffuseSettings={order:1,ears:0,damping:1e9,diffusion:1,diffusionMs:20};
  configure(h,rate,diffuseSettings); settle(h,rate);
  const diffuse=Float64Array.from({length:call('ir_length',h)},(_,i)=>call('ir_sample',h,0,i));
  assert.ok(diffuse.length>expected.length,'diffusion extends arrivals, not buffering latency');
  const sum=a=>a.reduce((s,v)=>s+v,0);
  assert.ok(Math.abs(sum(diffuse)-sum(expected))<2e-6,'signed cluster preserves DC path sum without output normalization');
  assert.ok(diffuse.some(v=>v<-.001),'diffusion is a signed scatter, not just an extra lowpass');
  assert.ok(diffuse.filter(v=>Math.abs(v)>1e-6).length>3*expected.filter(v=>Math.abs(v)>1e-6).length,'reflections spread into more arrivals');
  for(let i=0;i<diffuse.length+512;++i) {
    const value=call('sample',h,i===0?1:0,i===0?1:0,1);
    assert.ok(Math.abs(value-(diffuse[i-256]||0))<2e-6,'diffused IR convolves correctly with unchanged latency');
  }
  call('reset',h); settle(h,rate);
  for(let i=0;i<diffuse.length;++i) {
    assert.equal(call('ir_sample',h,0,i),diffuse[i],'static diffusion rebuilds deterministically');
    assert.equal(call('ir_sample',h,1,i),diffuse[i],'zero ear distance still links stereo');
  }
  configure(h,rate,{...diffuseSettings,diffusion:.5}); settle(h,rate);
  for(let i=0;i<diffuse.length;++i) assert.ok(Math.abs(call('ir_sample',h,0,i)-.5*((expected[i]||0)+diffuse[i]))<2e-6,'Diffusion blends the original and scattered IR');
  configure(h,rate,{...diffuseSettings,diffusion:0,diffusionMs:5000}); settle(h,rate);
  for(let i=0;i<expected.length;++i) assert.ok(Math.abs(call('ir_sample',h,0,i)-expected[i])<1e-6,'zero diffusion retains geometric response regardless of time');
  configure(h,rate,{...diffuseSettings,diffusionMs:5000}); settle(h,rate);
  assert.equal(call('error',h),1,'over-capacity diffusion time reports an error');
  assert.equal(configure(h,rate,{absorption:1}),0); settle(h,rate);
  for(let i=0;i<call('ir_length',h);++i) assert.equal(call('ir_sample',h,0,i),0,'fully absorbed room is silent');
  assert.equal(configure(h,rate,{width:10000}),0); settle(h,rate);
  assert.equal(call('error',h),1,'over-capacity geometry is explicit and retains old IR');
  assert.equal(configure(h,rate),0); settle(h,rate); assert.equal(call('error',h),0);
  assert.equal(configure(h,rate,{damping:NaN}),-2); assert.equal(call('error',h),1);
  assert.equal(configure(h,rate),0); assert.equal(call('error',h),0,'valid same settings clear a configuration error');
  const memory=x.memory.buffer.byteLength;
  let maxStep=0,last=0;
  const start=performance.now();
  for(let i=0;i<rate;++i) {
    if(i===Math.floor(rate/4)) configure(h,rate,{width:.2,depth:.3,height:.4,order:4,damping:200,diffusion:1,diffusionMs:20});
    const out=call('sample',h,.01,.01,1); assert.ok(Number.isFinite(out));
    maxStep=Math.max(maxStep,Math.abs(out-last)); last=out;
  }
  assert.ok(maxStep<.1,`crossfaded DC room edit: ${maxStep}`);
  assert.equal(x.memory.buffer.byteLength,memory,'no processing-time memory growth');
  console.log(`${rate}: IR/direct convolution error ${error.toExponential(2)}, geometry, stereo, absorption, bounded edits; build ${(build/rate).toFixed(3)}s; one audio second ${(performance.now()-start).toFixed(1)}ms (JS overhead included).`);
  if(rate===48000) {
    configure(h,rate,{width:10,depth:10,height:10,order:4,damping:100,diffusion:1,diffusionMs:30}); settle(h,rate);
    const times=[];
    for(let b=0;b<400;++b) {
      const start=performance.now();
      for(let i=0;i<128;++i) assert.ok(Number.isFinite(call('sample',h,.01,-.005,1)));
      times.push(performance.now()-start);
    }
    times.sort((a,b)=>a-b);
    console.log(`Large order-4 room: 128-sample callback p95 ${times[380].toFixed(3)}ms, max ${times[399].toFixed(3)}ms; JS harness, not a host realtime guarantee.`);
  }
  call('sample',h,NaN,0,1); assert.equal(call('ready',h),0); settle(h,rate);
  call('destroy',h);
}
console.log('Early Reflection Convolution: zero/full/partial diffusion, deterministic clusters, DC sum, timing/capacity and native convolution pass.');
