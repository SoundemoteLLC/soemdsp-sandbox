import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/dispersion/dispersion.wasm',import.meta.url)),{})).instance.exports;
const p='soemdsp_dispersion_',call=(name,...a)=>x[p+name](...a);
const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,call('metadata_json'),call('metadata_json_size'))));assert.equal(meta.parameters.length,7);assert.ok(meta.parameters.every(p=>p.tooltip));assert.equal(call('latency'),0);
function render(h,n,sr,options={},input=i=>[i===0?1:0,i===0?1:0]) {
 const a=new Float64Array(n),b=new Float64Array(n);let inputEnergy=0;
 for(let i=0;i<n;++i){const o=typeof options==='function'?options(i):options,[l,r]=input(i);inputEnergy+=l*l+r*r;
  a[i]=call('sample',h,l,r,o.f??300,o.spread??2,o.curve??0,o.stereo??0,o.mix??1,o.stages??32,o.direction??0,sr);b[i]=call('right',h);assert.ok(Number.isFinite(a[i]+b[i]));}
 return {a,b,inputEnergy};
}
const energy=a=>a.reduce((s,v)=>s+v*v,0);
function response(ir,f,sr,count=ir.length){let r=0,i=0;for(let j=0;j<count;++j){const w=2*Math.PI*f*j/sr;r+=ir[j]*Math.cos(w);i-=ir[j]*Math.sin(w);}return Math.hypot(r,i);}
for(const sr of [44100,48000,96000,192000]) {
 const h=call('create');assert.ok(h);let low,high;
 for(const direction of [0,1]){
  call('reset',h);const result=render(h,Math.ceil(sr*.5),sr,{direction});
  assert.deepEqual(result.a,result.b,'zero stereo offset preserves equal input');
  assert.ok(Math.abs(energy(result.a)+energy(result.b)+call('state_energy',h)-2)<1e-8,'impulse output plus stored energy is conserved');
  for(const f of [50,100,300,1000,5000,sr*.4])assert.ok(Math.abs(response(result.a,f,sr)-1)<.002,`static magnitude ${sr}/${direction}/${f}`);
  const bass=call('group_delay_ms',h,0,0),treble=call('group_delay_ms',h,0,sr*.5);
  assert.ok(direction?treble>bass:bass>treble,'direction mirrors delay concentration');
  if(direction)high=result.a;else low=result.a;
 }
 for(let i=0;i<low.length;++i)assert.ok(Math.abs(high[i]-(i%2?-low[i]:low[i]))<1e-10,'mirrored impulse response, not reversed playback');
 // A short generated FIR prefix is not an equivalent exact allpass: its missing tail changes magnitude.
 if(sr===48000)assert.ok(Math.abs(response(low,100,sr,128)-1)>.05,'short FIR truncation loses the allpass response');
 call('reset',h);const dry=render(h,100,sr,{mix:0},i=>[i===0?.2:0,i===0?-.1:0]);assert.equal(dry.a[0],.2);assert.equal(dry.b[0],-.1);assert.equal(energy(dry.a.slice(1)),0);
 call('reset',h);const wire=render(h,100,sr,{stages:0},i=>[i*.001,-i*.002]);for(let i=0;i<100;++i){assert.ok(Math.abs(wire.a[i]-i*.001)<1e-15);assert.ok(Math.abs(wire.b[i]+i*.002)<1e-15);}
 call('reset',h);const isolated=render(h,4000,sr,{stereo:.5},i=>[i===0?1:0,0]);assert.equal(energy(isolated.b),0,'no stereo crossfeed');
 call('reset',h);const stereo=render(h,4000,sr,{stereo:.5});assert.ok(stereo.a.some((v,i)=>Math.abs(v-stereo.b[i])>1e-5));
 call('reset',h);const memory=x.memory.buffer.byteLength,start=performance.now();
 const mod=render(h,sr,sr,i=>({f:300+250*Math.sin(i*.03),spread:2+Math.sin(i*.01),curve:.8*Math.sin(i*.02),stereo:.5,stages:64}),i=>[i%2000===0?.1:0,i%3000===0?-.1:0]);
 const accounted=energy(mod.a)+energy(mod.b)+call('state_energy',h);
 assert.ok(Math.abs(accounted-mod.inputEnergy)<1e-7,'orthogonal lattice does not inject energy during per-sample tuning changes');
 assert.equal(x.memory.buffer.byteLength,memory,'no processing allocation');
 console.log(`${sr}: flat magnitude, causal chirp direction, energy conservation under modulation, stereo and zero latency pass; modulated second ${(performance.now()-start).toFixed(1)}ms including JS overhead.`);
 call('sample',h,NaN,0,300,2,0,0,1,32,0,sr);assert.equal(call('error',h),1);render(h,100,sr);assert.equal(call('error',h),0);call('destroy',h);
}
console.log('Dispersion native contract passes.');
