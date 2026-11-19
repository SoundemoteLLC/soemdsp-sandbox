import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = async name => (await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/'+name+'/'+name+'.wasm', import.meta.url)), {env:{}})).instance.exports;
const d=await load('dispersion'), r=await load('robin_sinepulse_allpass');
const D=(name,...args)=>d['soemdsp_dispersion_'+name](...args);
const R=(name,...args)=>r['soemdsp_robin_sinepulse_allpass_'+name](...args);
let worst=0;
for(const sr of [44100,48000,96000]) for(const mode of [0,1]) for(const count of [1,8,50,256]) {
  const h=D('create'), old=R('create');
  const low=130,high=7200,fs=.8,ql=.7,qh=3,qs=-.4;
  assert.equal(D('configure',h,mode,1,low,high,fs,ql,qh,qs,0,0),0);
  R('set_params',old,count,mode,low,high,fs,ql,qh,qs,sr);
  let inputEnergy=0,outputEnergy=0;
  for(let i=0;i<24000;i++) {
    const input=i===0?1: i<4000?.01*Math.sin(i*.143):0;
    const a=D('sample',h,input,input,300,2,0,0,1,count,0,sr);
    const b=R('sample',old,0,input,0,1,1,1);
    worst=Math.max(worst,Math.abs(a-b));
    assert.ok(Math.abs(a-b)<2e-7, 'static Robin response mismatch '+[sr,mode,count,i,a,b]);
    inputEnergy+=2*input*input;outputEnergy+=2*a*a;
  }
  assert.ok(Math.abs(inputEnergy-outputEnergy-D('state_energy',h))<1e-8,'lattice energy accounting');
  assert.equal(D('error',h),0);
  D('destroy',h);R('destroy',old);
}
// Range endpoints, Q focus and explicit output gain remain measurable.
{
 const h=D('create');
 const setup=q=>{D('reset',h);D('configure',h,1,1,400,400,0,q,q,0,0,0);D('sample',h,0,0,123,2,0,0,1,1,0,48000);return D('group_delay_ms',h,0,400);};
 const broad=setup(1),focused=setup(5);
 assert.ok(focused>4.9*broad&&focused<5.1*broad,'Q focuses group delay');
 assert.ok(Math.abs(D('stage_frequency',h,0,0)-400)<1e-9,'unwired Range ignores Center knob');
 D('configure',h,1,1,400,400,0,5,5,0,1,0);
 D('sample',h,0,0,800,2,0,0,1,1,0,48000);
 assert.ok(Math.abs(D('stage_frequency',h,0,0)-800)<1e-9,'wired f retunes Range');
 D('configure',h,1,1,400,400,0,5,5,0,1,6);
 const out=D('sample',h,.25,.25,800,2,0,0,0,1,0,48000);
 assert.ok(Math.abs(out-.25*Math.pow(10,6/20))<1e-6,'explicit dB gain (shared fast exp tolerance)');
 D('destroy',h);
}
// Aggressive per-sample Q/frequency modulation must not create lattice energy.
{
 const h=D('create');let inputEnergy=0,outputEnergy=0;
 for(let i=0;i<48000;i++) {
  const q=.1+9*(.5+.5*Math.sin(i*.03));
  D('configure',h,1,1,100,2000,.5,q,q,-.2,1,0);
  const v=i<24000?.02*Math.sin(i*.17):0;
  const a=D('sample',h,v,v,400+300*Math.sin(i*.02),2,0,.5,1,50,0,48000);
  const b=D('right',h);inputEnergy+=2*v*v;outputEnergy+=a*a+b*b;
  assert.equal(D('error',h),0);
 }
 assert.ok(Math.abs(inputEnergy-outputEnergy-D('state_energy',h))<1e-8,'modulated biquad energy');
 D('destroy',h);
}
console.log('Dispersion/Robin static response and modulated energy pass; worst sample difference',worst);
