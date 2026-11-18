import assert from 'node:assert/strict';
import fs from 'node:fs';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/combined/soemdsp_combined.wasm',import.meta.url)),{env:{emo_process_block(){}}})).instance.exports;
const p='soemdsp_material_resonator_',sr=48000,n=128;
for(const sides of [[0],[1],[2],[1,2],[0,1,2]]) {
 const g=x.soemdsp_graph_create(),h=x[p+'create']();x.soemdsp_graph_set_sample_rate(g,sr);
 for(const [id,type]of [[1,132],[2,276],[3,6]])assert.equal(x.soemdsp_graph_add_node(g,id,type),0);
 for(const port of sides)x.soemdsp_graph_connect(g,1,port,2,port);
 x.soemdsp_graph_connect(g,1,3,2,16);
 for(const port of [1,2])x.soemdsp_graph_connect(g,2,port,3,port);
 for(const [id,value]of [[21,1],[22,16],[10,123],[52,.7],[59,5000],[13,.8],[30,.31],[1,.5],[90,6],[40,1]])x.soemdsp_graph_set_param(g,2,id,value);
 x.soemdsp_graph_snap_controls(g);assert.equal(x.soemdsp_graph_compile(g),0);
 const buf=(id,port)=>new Float64Array(x.memory.buffer,x.soemdsp_graph_node_port_ptr(g,id,port),n);let energy=0;
 for(let b=0;b<250;++b) {
  const input=[0,1,2,3].map(port=>{const a=buf(1,port);for(let i=0;i<n;++i)a[i]=port===3?(b<200?330+50*Math.sin((b*n+i)*.01):0):b<150?.03*Math.sin((b*n+i)*(.04+port*.01)):0;return a.slice();});
  x.soemdsp_graph_process_block(g,n);const out=[1,2,11].map(port=>buf(2,port).slice());
  for(let i=0;i<n;++i) {
   const m=sides.includes(0)?input[0][i]:0,l=sides.includes(1)?input[1][i]:0,r=sides.includes(2)?input[2][i]:0,stereo=sides.includes(1)&&sides.includes(2);
   const a=stereo?m+l:m+l+r,z=stereo?m+r:a;
   const y=x[p+'sample'](h,a,z,input[3][i],.7,5000,.8,.31,.5,6,1,1,16,sr),yr=x[p+'right'](h);
   assert.ok(Math.abs(y-out[0][i])<1e-9&&Math.abs(yr-out[1][i])<1e-9,'native graph matches direct material processing');assert.equal(out[2][i],0);energy+=y*y+yr*yr;
   if(b>=200)assert.equal(out[0][i],0,'wired zero f overrides the nonzero knob');
  }
 }
 assert.ok(energy>1e-6);assert.equal(x.soemdsp_graph_type_uses_pool(276),1);x.soemdsp_graph_destroy(g);x[p+'destroy'](h);
}
console.log('Material graph: all stereo routes, sample-accurate f override including zero, params and lifecycle match direct native.');
