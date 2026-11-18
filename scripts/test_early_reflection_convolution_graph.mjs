import assert from 'node:assert/strict';
import fs from 'node:fs';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/combined/soemdsp_combined.wasm',import.meta.url)),{env:{emo_process_block(){}}})).instance.exports;
const p='soemdsp_early_reflection_convolution_', sr=48000, n=128;
const g=x.soemdsp_graph_create(), h=x[p+'create']();
x.soemdsp_graph_set_sample_rate(g,sr);
for(const [id,type] of [[1,132],[2,274],[3,6]]) assert.equal(x.soemdsp_graph_add_node(g,id,type),0);
for(const port of [1,2]) { x.soemdsp_graph_connect(g,1,port,2,port); x.soemdsp_graph_connect(g,2,port,3,port); }
const params=[[31,4],[43,5],[41,2.5],[70,.3],[71,.3],[30,.5],[80,.6],[81,.7],[82,.5],[20,.6],[10,12000],[1,.18],[22,3],[40,1]];
for(const [id,v] of params) x.soemdsp_graph_set_param(g,2,id,v);
x.soemdsp_graph_snap_controls(g); assert.equal(x.soemdsp_graph_compile(g),0);
const buffer=(id,port)=>new Float64Array(x.memory.buffer,x.soemdsp_graph_node_port_ptr(g,id,port),n);
let energy=0, ready=false;
for(let b=0;b<850;++b) {
  if(b===500) { x.soemdsp_graph_set_param(g,2,31,.7); x.soemdsp_graph_snap_controls(g); }
  const inputs=[1,2].map(port=> {
    const a=buffer(1,port); for(let i=0;i<n;++i) a[i]=b<750 ? .05*Math.sin((b*n+i)*(port===1 ? .07:.11)):0;
    return a.slice();
  });
  x.soemdsp_graph_process_block(g,n);
  const out=[1,2,10,11].map(port=>buffer(2,port).slice());
  for(let i=0;i<n;++i) {
    assert.equal(x[p+'configure'](h,b<500?4:.7,5,2.5,.3,.3,.5,.6,.7,.5,.6,12000,.18,3,sr),0);
    const y=x[p+'sample'](h,inputs[0][i],inputs[1][i],1), r=x[p+'right'](h);
    assert.ok(Math.abs(out[0][i]-y)<1e-9 && Math.abs(out[1][i]-r)<1e-9,'graph and direct native agree');
    assert.equal(out[2][i],x[p+'ready'](h)); assert.equal(out[3][i],0);
    ready ||= !!out[2][i]; if(b>100) energy+=y*y+r*r;
  }
}
assert.ok(ready && energy>1); assert.equal(x.soemdsp_graph_type_uses_pool(274),1);
x.soemdsp_graph_destroy(g); x[p+'destroy'](h);
console.log('Room graph: native stereo routing, all parameter bindings, Ready/Error and retained-history edits match direct processing.');
