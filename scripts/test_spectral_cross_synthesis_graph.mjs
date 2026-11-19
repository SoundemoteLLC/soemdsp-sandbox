import assert from 'node:assert/strict';
import fs from 'node:fs';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/combined/soemdsp_combined.wasm',import.meta.url)),{env:{emo_process_block(){}}})).instance.exports;
const call=(s,...a)=>x['soemdsp_spectral_cross_synthesis_'+s](...a);
for(const stereo of [false,true]) {
 const g=x.soemdsp_graph_create(),h=call('create');x.soemdsp_graph_set_sample_rate(g,48000);
 for(const[id,type]of [[1,132],[2,278],[3,6]])assert.equal(x.soemdsp_graph_add_node(g,id,type),0);
 for(const[from,to]of stereo?[[0,1],[1,2],[2,3],[3,4]]:[[0,1],[2,3]])assert.equal(x.soemdsp_graph_connect(g,1,from,2,to),0);
 x.soemdsp_graph_connect(g,2,1,3,1);x.soemdsp_graph_connect(g,2,2,3,2);
 for(const[id,v]of [[13,.8],[31,600],[42,10],[50,80],[40,.9],[90,-3]])x.soemdsp_graph_set_param(g,2,id,v);
 x.soemdsp_graph_snap_controls(g);assert.equal(x.soemdsp_graph_compile(g),0);
 const buf=(id,port)=>new Float64Array(x.memory.buffer,x.soemdsp_graph_node_port_ptr(g,id,port),128);
 let energy=0;
 for(let block=0;block<300;block++){
  const input=[0,1,2,3].map(port=>{const a=buf(1,port);for(let i=0;i<128;i++)a[i]=.03*Math.sin((block*128+i)*(.04+port*.02));return a.slice();});
  x.soemdsp_graph_process_block(g,128);const left=buf(2,1).slice(),right=buf(2,2).slice();
  for(let i=0;i<128;i++){
   const y=call('sample',h,input[0][i],input[stereo?1:0][i],input[2][i],input[stereo?3:2][i],.8,600,10,80,.9,-3,48000);
   assert.ok(Math.abs(y-left[i])<1e-9&&Math.abs(call('right',h)-right[i])<1e-9,'graph/native parity');
   assert.equal(buf(2,11)[i],0);energy+=y*y;
  }
 }
 assert.ok(energy>.01);assert.equal(x.soemdsp_graph_type_uses_pool(278),1);
 call('destroy',h);x.soemdsp_graph_destroy(g);
}
console.log('Spectral Cross-Synthesis graph: stereo/one-cable donors, controls and native parity pass.');
