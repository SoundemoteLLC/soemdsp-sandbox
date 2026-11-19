import assert from 'node:assert/strict';
import fs from 'node:fs';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/spectral_cross_synthesis/spectral_cross_synthesis.wasm',import.meta.url)),{env:{}})).instance.exports;
const call=(s,...args)=>x['soemdsp_spectral_cross_synthesis_'+s](...args);
const latency=call('latency');assert.equal(latency,2048);
const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,call('metadata_json'),call('metadata_json_size'))));
assert.equal(meta.parameters.length,6);assert.ok(meta.parameters.every(p=>p.tooltip));
for(const sr of [44100,48000,96000]) {
 for(const identity of ['zero transfer','same donors','dry']) {
  const h=call('create'),n=sr+latency,input=new Float64Array(n);let worst=0;
  for(let i=0;i<n;i++) {
   input[i]=.1*Math.sin(i*.137)+.03*Math.cos(i*.41);
   const v=identity==='same donors'?input[i]:0;
   const out=call('sample',h,v,0,input[i],0,identity==='zero transfer'?0:1,300,5,50,identity==='dry'?0:1,0,sr);
   const expected=i>=latency?input[i-latency]:0;
   worst=Math.max(worst,Math.abs(out-expected));
   assert.equal(call('right',h),0,'stereo isolation');assert.equal(call('error',h),0);
  }
  assert.ok(worst<2e-6,identity+' reconstruction '+worst);call('destroy',h);
 }
 for(const silent of ['voice','synth']) {
  const h=call('create');let max=0;
  for(let i=0;i<sr;i++){
   const a=.1*Math.sin(i*.2),out=call('sample',h,silent==='voice'?0:a,0,silent==='synth'?0:a,0,1,300,0,0,1,0,sr);
   max=Math.max(max,Math.abs(out));assert.equal(call('error',h),0);
  }
  assert.equal(max,0,'silent '+silent);call('destroy',h);
 }
 // Same spectral pattern at a different level transfers Voice magnitude, not phase.
 const h=call('create');let err=0;
 for(let i=0;i<sr;i++){
  const a=.1*Math.sin(i*.137),out=call('sample',h,2*a,0,a,0,1,500,0,0,1,0,sr);
  if(i>4096)err=Math.max(err,Math.abs(out-.2*Math.sin((i-latency)*.137)));
 }
 assert.ok(err<2e-6,'donor amplitude ownership');call('destroy',h);
 console.log(sr+': reconstruction, stereo isolation, silence and donor ownership pass');
}
for(const edge of [0,1]) {
 const h=call('create');let worst=0;
 for(let i=0;i<8192;i++){
  const a=edge?(i%2?-.1:.1):.1;
  const y=call('sample',h,a,0,a,0,1,0,0,0,1,0,48000);
  if(i>=2048)worst=Math.max(worst,Math.abs(y-(edge?((i-2048)%2?-.1:.1):.1)));
 }
 assert.ok(worst<2e-6,'DC/Nyquist reconstruction');call('destroy',h);
}
const h=call('create');
assert.equal(call('sample',h,NaN,0,0,0,1,300,5,50,1,0,48000),0);assert.equal(call('error',h),1);
call('sample',h,0,0,0,0,1,300,5,50,1,0,48000);assert.equal(call('error',h),0);call('destroy',h);
console.log('Spectral Cross-Synthesis native contract passes.');
