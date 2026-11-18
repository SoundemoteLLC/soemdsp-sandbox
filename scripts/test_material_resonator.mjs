import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/material_resonator/material_resonator.wasm',import.meta.url)),{})).instance.exports;
const p='soemdsp_material_resonator_',call=(name,...args)=>x[p+name](...args);
const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,call('metadata_json'),call('metadata_json_size'))));
assert.equal(meta.parameters.length,10);assert.ok(meta.parameters.every(p=>p.tooltip));assert.equal(call('latency'),0);
function render(h,n,sr,options={},input=i=>[i===0?1:0,i===0?1:0]) {
  const a=new Float64Array(n),b=new Float64Array(n);
  for(let i=0;i<n;++i) {
    const [l,r]=input(i),o=typeof options==='function'?options(i):options;
    a[i]=call('sample',h,l,r,o.f??440,o.decay??.5,o.damping??1e9,o.inharm??1,o.pos??.31,o.spread??0,o.gain??0,o.mix??1,o.material??1,o.modes??32,sr);
    b[i]=call('right',h);assert.ok(Number.isFinite(a[i]+b[i]));
  }
  return [a,b];
}
const energy=(a,start=0,end=a.length)=>{let p=0;for(let i=start;i<end;++i)p+=a[i]*a[i];return p;};
for(const sr of [44100,48000,96000,192000]) {
  const h=call('create');assert.ok(h);const spectra=[];
  for(const material of [0,1,2]) {
    call('reset',h);const [a,b]=render(h,Math.ceil(sr*.2),sr,{material,modes:16});
    assert.ok(energy(a)>1e-8,'impulse excites a ringing body');assert.deepEqual(a,b,'linked pickup geometry preserves mono');
    spectra.push(Array.from({length:8},(_,i)=>call('mode_frequency',h,i)));
    assert.ok(Math.abs(spectra.at(-1)[0]-440)<1e-9);
  }
  assert.notDeepEqual(spectra[0],spectra[1]);assert.notDeepEqual(spectra[1],spectra[2]);assert.notDeepEqual(spectra[0],spectra[2]);
  call('reset',h);render(h,32,sr,{inharm:0,modes:16});
  for(let i=0;i<16;++i)assert.ok(Math.abs(call('mode_frequency',h,i)-440*(i+1))<1e-8,'zero inharmonicity is harmonic');
  call('reset',h);const [ring]=render(h,Math.ceil(sr*.7),sr,{modes:1,decay:.5});
  const early=energy(ring,Math.round(sr*.1),Math.round(sr*.15)),late=energy(ring,Math.round(sr*.6),Math.round(sr*.65));
  assert.ok(Math.abs(Math.sqrt(late/early)-.001)<2e-5,`RT60 in actual seconds: ${Math.sqrt(late/early)}`);
  call('reset',h);const [dryL,dryR]=render(h,100,sr,{mix:0},i=>[i===0?.2:0,i===0?-.1:0]);
  assert.equal(dryL[0],.2);assert.equal(dryR[0],-.1);assert.equal(energy(dryL,1),0,'dry has no buffering latency');
  call('reset',h);const isolated=render(h,5000,sr,{spread:.8},i=>[i===0?1:0,0]);assert.equal(energy(isolated[1]),0,'stereo input histories are independent');
  call('reset',h);const pickups=render(h,5000,sr,{spread:.8});assert.ok(pickups[0].some((v,i)=>Math.abs(v-pickups[1][i])>1e-7),'pickup positions produce stereo from mono');
  call('reset',h);const [a]=render(h,3000,sr,{gain:0});call('reset',h);const [b]=render(h,3000,sr,{gain:12});
  for(let i=0;i<a.length;++i)assert.ok(Math.abs(b[i]-a[i]*10**(.6))<1e-8,'explicit input gain has dB units');
  call('reset',h);const [zero]=render(h,5000,sr,{f:0});assert.equal(energy(zero),0,'zero frequency does not leak DC');
  call('reset',h);const [high]=render(h,5000,sr,{f:sr*.6});assert.equal(energy(high),0,'out-of-band modes do not alias back');
  const memory=x.memory.buffer.byteLength,start=performance.now();call('reset',h);
  const [moving]=render(h,sr,sr,i=>({f:220+100*Math.sin(2*Math.PI*10*i/sr),modes:64,material:Math.floor(i/(sr/3))%3,spread:.5,damping:4000,gain:12}),i=>[.03*Math.sin(i*.07),.02*Math.sin(i*.11)]);
  assert.ok(energy(moving)>1e-8);assert.equal(x.memory.buffer.byteLength,memory,'no callback allocation during modulation/material changes');
  console.log(`${sr}: material ratios, RT60, zero latency, stereo, gain, Nyquist and audio-rate retuning pass; 64-mode modulated second ${(performance.now()-start).toFixed(1)}ms including JS overhead.`);
  call('sample',h,NaN,0,440,1,4000,1,.31,0,0,1,1,32,sr);assert.equal(call('error',h),1);
  const recovered=render(h,2000,sr);assert.ok(energy(recovered[0])>0);assert.equal(call('error',h),0);
  call('destroy',h);
}
console.log('Material Resonator native contract passes.');
