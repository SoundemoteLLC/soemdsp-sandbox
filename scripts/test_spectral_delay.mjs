import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/spectral_delay/spectral_delay.wasm',import.meta.url)),{})).instance.exports;
const prefix='soemdsp_spectral_delay_', call=(k,...args)=>x[prefix+k](...args);
const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer,call('metadata_json'),call('metadata_json_size'))));
assert.equal(meta.parameters.length,7); assert.ok(meta.parameters.every(p=>p.tooltip));
assert.deepEqual(meta.parameters[0].choiceIds,[512,1024,2048,4096,8192,16384]);
function configure(h,sr,n=1024,base=0,spread=0,pivot=1000,curve=0,fb=0) {return call('configure',h,n,base,spread,pivot,curve,fb,sr);}
function settle(h,sr) {
  for(let i=0;i<sr*12;++i) {call('sample',h,0,0,1);if(!call('busy',h))return;}
  throw Error('size handoff timed out');
}
function render(h,count,input,mix=1) {
  const left=new Float64Array(count),right=new Float64Array(count);
  for(let i=0;i<count;++i) {const v=input(i);left[i]=call('sample',h,v[0],v[1],mix);right[i]=call('right',h);assert.ok(Number.isFinite(left[i]+right[i]));}
  return [left,right];
}
for(const sr of [44100,48000,96000,192000]) {
  const h=call('create');assert.ok(h,'memory pool allocates the bounded spectral history');
  for(const n of [512,1024,2048,4096,8192,16384]) {
    assert.equal(configure(h,sr,n),0);settle(h,sr);call('reset',h);
    const count=n*3+2048,input=i=>[.1*Math.sin(i*.071),.07*Math.cos(i*.037)];
    const [a,b]=render(h,count,input);
    let error=0;
    for(let i=n;i<count;++i) {const v=input(i-n);error=Math.max(error,Math.abs(a[i]-v[0]),Math.abs(b[i]-v[1]));}
    assert.ok(error<2e-6,`neutral reconstruction ${sr}/${n}: ${error}`);
    assert.equal(call('latency_for_handle',h),n);
    assert.ok(call('max_delay_ms',h)>2500);
  }
  const n=1024,hop=n/4,base=3*hop*1000/sr;
  configure(h,sr,n,base);settle(h,sr);call('reset',h);
  const impulse=render(h,n*5,i=>[i===0?.1:0,i===0?-.07:0]);
  for(let i=0;i<impulse[0].length;++i) {
    assert.ok(Math.abs(impulse[0][i]-(i===n+3*hop?.1:0))<2e-6,'integer-hop impulse delay');
    assert.ok(Math.abs(impulse[1][i]-(i===n+3*hop?-.07:0))<2e-6,'stereo isolation');
  }
  configure(h,sr,n,3.5*hop*1000/sr);call('reset',h);
  const frequency=15*sr/n, delay=n+3.5*hop;
  const [tone]=render(h,Math.ceil(sr*.25)+delay,i=>[.1*Math.sin(2*Math.PI*frequency*i/sr),0]);
  let error=0,power=0;
  for(let i=delay+n*2;i<tone.length;++i) {error+=(tone[i]-.1*Math.sin(2*Math.PI*frequency*(i-delay)/sr))**2;power+=tone[i]**2;}
  assert.ok(Math.sqrt(error/power)<.01,'phase-aware half-frame delay must not cancel a tone');
  configure(h,sr,n,4*hop*1000/sr,0,1000,0,.5);call('reset',h);
  const [echo]=render(h,n*8,i=>[i===0?.1:0,0]);
  for(let repeat=0;repeat<5;++repeat) assert.ok(Math.abs(echo[n+(repeat+1)*4*hop]-.1*.5**repeat)<2e-6,'feedback echo amplitude and timing');
  configure(h,sr,n,4*hop*1000/sr,0,1000,0,-.5);call('reset',h);
  const [negative]=render(h,n*6,i=>[i===0?.1:0,0]);
  assert.ok(Math.abs(negative[n+8*hop]+.05)<2e-6,'negative feedback reverses echo polarity');
  configure(h,sr,n,20,100,1500);call('reset',h);render(h,n,()=>[0,0]);
  assert.ok(Math.abs(call('bin_delay_ms',h,0)-20)<1e-9);
  assert.ok(Math.abs(call('bin_delay_ms',h,n/2)-120)<1e-9);
  const before=call('max_delay_ms',h);
  assert.equal(configure(h,sr,n,before+1),-3);assert.equal(call('error',h),1);
  assert.equal(configure(h,sr,n),0);assert.equal(call('error',h),0);
  assert.equal(configure(h,sr,123),-2);configure(h,sr,n);
  call('sample',h,NaN,0,1);assert.equal(call('error',h),1);configure(h,sr,n);render(h,n*2,()=>[0,0]);
  assert.equal(call('error',h),0,'nonfinite input resets only local delay state');
  configure(h,sr,n,60,0,1000,0,0);call('reset',h);
  const [dryL,dryR]=render(h,n*3,i=>[i===0?.2:0,i===0?-.1:0],0);
  for(let i=0;i<dryL.length;++i) assert.ok(Math.abs(dryL[i]-(i===n?.2:0))<1e-7&&Math.abs(dryR[i]-(i===n?-.1:0))<1e-7,'dry shares FFT latency, not added band delay');
  const memory=x.memory.buffer.byteLength;
  configure(h,sr,4096,100,300,1000,.3,.6);settle(h,sr);
  const start=performance.now();render(h,sr,i=>[i<sr/4?.03*Math.sin(i*.05):0,i<sr/4?.02*Math.sin(i*.08):0]);
  assert.equal(x.memory.buffer.byteLength,memory,'no allocation during processing or size changes');
  console.log(`${sr}: all FFT sizes, neutral/delayed impulse, phase-aware fractional tone, signed feedback, limits/recovery pass; one audio second ${(performance.now()-start).toFixed(1)}ms including JS overhead.`);
  if(sr===48000) {
    configure(h,sr,16384,100,300,1000,.3,.6);settle(h,sr);
    const times=[];
    for(let b=0;b<400;++b) {
      const start=performance.now();for(let i=0;i<128;++i)call('sample',h,.02*Math.sin((b*128+i)*.1),0,1);
      times.push(performance.now()-start);
    }
    times.sort((a,b)=>a-b);console.log(`FFT 16384 callback p95 ${times[380].toFixed(3)}ms, max ${times[399].toFixed(3)}ms (JS harness, not a host realtime guarantee).`);
  }
  call('destroy',h);
}
// Band-limited bursts establish that highs and lows actually arrive at different times.
const sr=48000,h=call('create'),n=1024;
function burstCentroid(f,spread) {
  configure(h,sr,n,20,spread,1500);settle(h,sr);call('reset',h);
  const [out]=render(h,16000,i=>[i<2048?.1*Math.sin(Math.PI*i/2048)**2*Math.sin(2*Math.PI*f*i/sr):0,0]);
  let p=0,t=0;for(let i=0;i<out.length;++i){p+=out[i]**2;t+=i*out[i]**2;}return t/p;
}
assert.ok(burstCentroid(6000,100)-burstCentroid(375,100)>sr*.05,'positive spread puts highs later');
assert.ok(burstCentroid(375,-100)-burstCentroid(6000,-100)>sr*.05,'negative spread puts lows later');
call('destroy',h);
console.log(`Spectral Delay passes; preallocated instance ${(call('state_bytes')/1048576).toFixed(2)} MiB.`);
