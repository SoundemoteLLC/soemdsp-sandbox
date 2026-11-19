import assert from 'node:assert/strict';
import fs from 'node:fs';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/spectral_cross_synthesis/spectral_cross_synthesis.wasm',import.meta.url)),{env:{}})).instance.exports;
const call=(s,...a)=>x['soemdsp_spectral_cross_synthesis_'+s](...a),sr=48000;
const sample=(h,v,s,amount=1,mix=1)=>call('sample',h,v,0,s,0,amount,0,0,0,mix,0,sr);
for(const size of [512,1024,2048,4096,8192,16384]) {
 const h=call('create');assert.equal(call('set_fft_size',h,size),0);
 assert.equal(call('latency_for_handle',h),size);
 let worst=0;
 for(let i=0;i<sr+size;i++){
  const a=.1*Math.sin(i*.137)+.03*Math.cos(i*.41),y=sample(h,a,a);
  const expected=i>=size?.1*Math.sin((i-size)*.137)+.03*Math.cos((i-size)*.41):0;
  worst=Math.max(worst,Math.abs(y-expected));assert.equal(call('error',h),0);
 }
 assert.ok(worst<2e-6,'FFT reconstruction '+size+': '+worst);
 call('reset',h);assert.equal(call('fft_size',h),size,'reset preserves selection');call('destroy',h);
}
function amplitude(samples,hz) {
 let re=0,im=0;for(let i=0;i<samples.length;i++){re+=samples[i]*Math.cos(2*Math.PI*hz*i/sr);im-=samples[i]*Math.sin(2*Math.PI*hz*i/sr);}
 return 2*Math.hypot(re,im)/samples.length;
}
for(const shift of [-12,0,12]) {
 const h=call('create');call('set_formant_shift',h,shift);const output=[];
 for(let i=0;i<sr;i++) {
  const voice=.1*Math.sin(2*Math.PI*750*i/sr);
  const synth=[375,750,1500].reduce((sum,hz)=>sum+.1*Math.sin(2*Math.PI*hz*i/sr),0);
  const y=sample(h,voice,synth);if(i>=24000)output.push(y);assert.equal(call('error',h),0);
 }
 const target=750*2**(shift/12),levels=[375,750,1500].map(hz=>[hz,amplitude(output,hz)]);
 const wanted=levels.find(([hz])=>hz===target)[1];
 assert.ok(wanted>.01,'shifted envelope must remain audible');
 for(const[hz,level]of levels)if(hz!==target)assert.ok(wanted>50*level,'envelope must move without changing Synth pitches '+levels);
 call('destroy',h);
}
{
 const h=call('create');let energy=0,largest=0;
 for(let i=0;i<96000;i++){
  if(i===8000)call('set_fft_size',h,16384);
  if(i===9000)call('set_fft_size',h,512);
  if(i===10000)call('set_fft_size',h,8192);
  const y=sample(h,.1,.1);assert.ok(Number.isFinite(y));assert.equal(call('error',h),0);
  if(i>12000){energy+=y*y;largest=Math.max(largest,Math.abs(y));}
 }
 assert.equal(call('fft_size',h),8192,'latest queued size wins');
 assert.ok(energy>10&&largest<.101,'warm handoff remains bounded and nonblank');
 assert.equal(call('set_fft_size',h,123),-2);
 sample(h,0,0);assert.equal(call('error',h),1,'invalid size is diagnosed');
 call('set_fft_size',h,8192);sample(h,0,0);assert.equal(call('error',h),0);
 assert.equal(call('set_formant_shift',h,NaN),-2);sample(h,0,0);assert.equal(call('error',h),1);
 call('set_formant_shift',h,0);sample(h,0,0);assert.equal(call('error',h),0);
 call('destroy',h);
}
console.log('Cross-Synthesis controls: all FFT sizes reconstruct, octave formant ownership, queued warm handoff and local errors pass.');
