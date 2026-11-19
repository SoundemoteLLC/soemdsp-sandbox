import assert from 'node:assert/strict';
import fs from 'node:fs';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/spectral_warp/spectral_warp.wasm',import.meta.url)),{env:{}})).instance.exports;
const call=(s,...a)=>x['soemdsp_spectral_warp_'+s](...a);
const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,call('metadata_json'),call('metadata_json_size'))));
assert.equal(meta.parameters.length,8);assert.ok(meta.parameters.every(p=>p.tooltip));assert.equal(call('latency'),1024);
assert.equal(meta.parameters.find(p=>p.key==='fftSize').defaultValue,'1024');
{const h=call('create');assert.equal(call('fft_size',h),1024);call('destroy',h);}
for(const sr of [44100,48000,96000])for(const size of [512,1024,2048,4096,8192,16384]){
 const h=call('create');assert.equal(call('configure',h,size,0,1,1000,sr),0);let worst=0;
 const signal=i=>.08*Math.sin(i*.137)+.03*Math.cos(i*.41)+.01;
 for(let i=0;i<sr+size;i++){
  const a=signal(i),out=call('sample',h,a,0,1,0);
  worst=Math.max(worst,Math.abs(out-(i>=size?signal(i-size):0)));assert.equal(call('right',h),0);assert.equal(call('error',h),0);
 }
 assert.ok(worst<2e-6,'neutral reconstruction '+[sr,size,worst]);assert.equal(call('latency_for_handle',h),size);call('destroy',h);
}
function amplitude(samples,hz,sr=48000){
 let r=0,i=0;for(let n=0;n<samples.length;n++){r+=samples[n]*Math.cos(2*Math.PI*hz*n/sr);i-=samples[n]*Math.sin(2*Math.PI*hz*n/sr);}
 return 2*Math.hypot(r,i)/samples.length;
}
for(const[frequencies,shift,warp,pivot]of [[[750],375,1,1000],[[750],123,1,1000],[[750],-321,1,1000],[[500,1500],0,2,1000]]){
 const h=call('create');call('configure',h,2048,shift,warp,pivot,48000);const output=[];
 for(let i=0;i<72000;i++){
  const a=frequencies.reduce((sum,f)=>sum+.1*Math.sin(2*Math.PI*f*i/48000),0),out=call('sample',h,a,0,1,0);
  if(i>=24000)output.push(out);assert.equal(call('error',h),0);
 }
 for(const f of frequencies){
  const target=pivot*(f/pivot)**warp+shift;
  const level=amplitude(output,target);
  console.log({f,target,level});
  assert.ok(level>.055&&level<.14,'mapped tone level '+[f,target,level]);
  assert.ok(amplitude(output,target+10)<level*.05&&amplitude(output,target-10)<level*.05,'continuous phase, no hop-rate retuning');
 }
 call('destroy',h);
}
for(const[f,shift]of [[750,-2000],[23000,2000]]){
 const h=call('create');call('configure',h,2048,shift,1,1000,48000);let energy=0;
 for(let i=0;i<48000;i++){const out=call('sample',h,.1*Math.sin(2*Math.PI*f*i/48000),0,1,0);if(i>12000)energy+=out*out;}
 assert.ok(Math.sqrt(energy/36000)<1e-5,'out-of-band must not fold or wrap');call('destroy',h);
}
for(const[pitch,stereo,shift,warp]of [[12,0,0,1],[-12,0,0,1],[0,200,0,1],[12,-200,100,2]]){
 const h=call('create');call('configure',h,2048,shift,warp,1000,48000);call('set_pitch_stereo',h,pitch,stereo);
 const output=[[],[]];
 for(let i=0;i<72000;i++){
  // Repeated graph configuration must not erase the independently set pitch/stereo.
  call('configure',h,2048,shift,warp,1000,48000);
  const a=.1*Math.sin(2*Math.PI*500*i/48000),y=call('sample',h,a,a,1,0);
  if(i>=24000){output[0].push(y);output[1].push(call('right',h));}assert.equal(call('error',h),0);
 }
 const center=1000*(.5**warp)*2**(pitch/12)+shift;
 for(let c=0;c<2;c++){
  const target=center+(c?.5:-.5)*stereo,level=amplitude(output[c],target);
  assert.ok(level>.055&&level<.14,'Pitch/stereo mapping '+[pitch,stereo,c,target,level]);
  if(stereo!==0)assert.ok(amplitude(output[c],center-(c?.5:-.5)*stereo)<level*.03,'independent stereo shifts');
 }
 call('destroy',h);
}
{
 const h=call('create');call('configure',h,2048,0,1,1000,48000);
 assert.equal(call('set_pitch_stereo',h,NaN,0),-2);call('sample',h,0,0,1,0);assert.equal(call('error',h),1);
 call('set_pitch_stereo',h,0,0);call('sample',h,0,0,1,0);assert.equal(call('error',h),0);
 assert.equal(call('sample',h,NaN,0,1,0),0);assert.equal(call('error',h),1);
 call('sample',h,0,0,1,0);assert.equal(call('error',h),0);
 call('destroy',h);
}
for(const nyquist of [false,true]){
 const h=call('create');call('configure',h,2048,0,1,1000,48000);let worst=0;
 for(let i=0;i<12000;i++){
  const v=nyquist?(i%2?-.1:.1):.1,y=call('sample',h,v,0,1,0);
  worst=Math.max(worst,Math.abs(y-(i>=2048?v:0)));
 }
 assert.ok(worst<2e-6,'DC/Nyquist reconstruction');call('destroy',h);
}
{
 const h=call('create');let largest=0;
 for(let i=0;i<72000;i++){
  const size=i<8000?2048:i<9000?16384:i<10000?512:8192;
  call('configure',h,size,0,1,1000,48000);
  const y=call('sample',h,.1,.1,1,0);assert.ok(Number.isFinite(y));assert.equal(call('error',h),0);
  if(i>12000)largest=Math.max(largest,Math.abs(y));
 }
 assert.equal(call('fft_size',h),8192);assert.ok(largest>.09&&largest<.101,'bounded warmed FFT handoff');
 assert.equal(call('configure',h,123,0,1,1000,48000),-2);call('sample',h,0,0,1,0);assert.equal(call('error',h),1);
 call('configure',h,8192,0,1,1000,48000);call('sample',h,0,0,1,0);assert.equal(call('error',h),0);call('destroy',h);
}
console.log('Spectral Warp: reconstruction, phase continuity, out-of-band rejection, pitch, stereo, FFT handoff and local recovery pass.');
