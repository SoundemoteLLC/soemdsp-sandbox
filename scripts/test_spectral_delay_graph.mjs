import assert from 'node:assert/strict';
import fs from 'node:fs';
const x=(await WebAssembly.instantiate(fs.readFileSync(new URL('../native_modules/combined/soemdsp_combined.wasm',import.meta.url)),{env:{emo_process_block(){}}})).instance.exports;
const p='soemdsp_spectral_delay_',sr=48000,n=128;
for(const sides of [[0],[1],[2],[1,2],[0,1,2]]) {
  const g=x.soemdsp_graph_create(),h=x[p+'create']();assert.ok(g&&h);
  x.soemdsp_graph_set_sample_rate(g,sr);
  for(const [id,type] of [[1,132],[2,275],[3,6]]) assert.equal(x.soemdsp_graph_add_node(g,id,type),0);
  for(const port of sides) x.soemdsp_graph_connect(g,1,port,2,port);
  for(const port of [1,2]) x.soemdsp_graph_connect(g,2,port,3,port);
  for(const [id,v] of [[22,1024],[55,10],[31,30],[10,1000],[13,.3],[50,.4],[40,1],[30,-12],[1,.7]]) x.soemdsp_graph_set_param(g,2,id,v);
  x.soemdsp_graph_snap_controls(g);assert.equal(x.soemdsp_graph_compile(g),0);
  const buffer=(id,port)=>new Float64Array(x.memory.buffer,x.soemdsp_graph_node_port_ptr(g,id,port),n);
  let energy=0;
  for(let b=0;b<400;++b) {
    if(b===200) {x.soemdsp_graph_set_param(g,2,31,-30);x.soemdsp_graph_snap_controls(g);}
    const input=[0,1,2].map(port=>{const a=buffer(1,port);for(let i=0;i<n;++i)a[i]=b<300?.04*Math.sin((b*n+i)*(.037+port*.03)):0;return a.slice();});
    x.soemdsp_graph_process_block(g,n);const output=[1,2,11].map(port=>buffer(2,port).slice());
    for(let i=0;i<n;++i) {
      assert.equal(x[p+'configure'](h,1024,10,b<200?30:-30,1000,.3,.4,sr,-12,.7),0);
      const m=sides.includes(0)?input[0][i]:0,l=sides.includes(1)?input[1][i]:0,r=sides.includes(2)?input[2][i]:0;
      const stereo=sides.includes(1)&&sides.includes(2),a=stereo?m+l:m+l+r,z=stereo?m+r:a;
      const y=x[p+'sample'](h,a,z,1),yr=x[p+'right'](h);
      assert.ok(Math.abs(output[0][i]-y)<1e-9&&Math.abs(output[1][i]-yr)<1e-9,'stereo routes and parameter changes match direct native');
      assert.equal(output[2][i],0);energy+=y*y+yr*yr;
    }
  }
  assert.ok(energy>1);assert.equal(x.soemdsp_graph_type_uses_pool(275),1);
  x.soemdsp_graph_destroy(g);x[p+'destroy'](h);
}
console.log('Spectral Delay graph: all stereo routes, controls, spread-direction edit, Error and pooled native lifecycle pass.');
