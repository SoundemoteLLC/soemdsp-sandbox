// soemdsp-native-module: early_reflection_convolution
// soemdsp-native-label: Early Reflection Convolution
// soemdsp-native-target: earlyReflectionConvolution
// soemdsp-native-kind: reverb
#include "room_engine.h"
#include <soemdsp/utility/memory_pool.h>
namespace {
using State=soemdsp_room_ir::State;
State* pool[64]{};
State* get(int h) { return h>0 && h<=64 ? pool[h-1] : nullptr; }
const char metadata[]=R"json({
  "module":"early_reflection_convolution", "targetType":"earlyReflectionConvolution",
  "label":"Early Reflection Convolution", "kind":"reverb",
  "inputs":["In","Left","Right"], "outputs":["Mono","Left","Right","Ready","Error"],
  "parameters":[
    {"key":"diffusion","label":"Diffusion","defaultValue":"0","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Blend each geometric reflection into a deterministic nine-tap signed cluster. Zero preserves the original room IR. Static scattering breaks up regular reflection spacing without moving delays or pitch wobble. Cluster weights retain the path DC sum; no automatic output normalization is applied."},
    {"key":"diffusionMs","label":"Diffusion Time","defaultValue":"8","min":"0","mid":"10","max":"100","step":"any","unit":"ms","tooltip":"Maximum additional arrival spread for each reflection cluster in milliseconds. Zero disables spreading. Longer clusters can sound more diffuse but change coloration; they are an imaginary rough-wall model, not exact rectangular-room geometry. Edits rebuild and crossfade the IR; capacity errors retain the previous response."},
    {"key":"roomWidth","label":"Room Width","defaultValue":"4","min":"0.1","mid":"3","max":"10","step":"any","unit":"m","nonlinearSlider":true,"tooltip":"Room X dimension in meters. Image-source wall reflections generate a finite impulse response; edits queue an incremental rebuild and 50 ms crossfade. Capacity is 65536 samples; Error reports requests too large for that capacity."},
    {"key":"roomDepth","label":"Room Depth","defaultValue":"5","min":"0.1","mid":"3","max":"10","step":"any","unit":"m","nonlinearSlider":true,"tooltip":"Room Y dimension in meters. Short dimensions create tighter reflection spacing and stronger comb coloration, not an STFT smear."},
    {"key":"roomHeight","label":"Room Height","defaultValue":"2.5","min":"0.1","mid":"3","max":"10","step":"any","unit":"m","nonlinearSlider":true,"tooltip":"Room Z dimension in meters. Sound speed is 343 m/s. No diffuse late reverb or feedback loop is added."},
    {"key":"reflectionOrder","label":"Reflection Order","defaultValue":"3","min":"1","mid":"2","max":"4","step":"1","linearSmoothing":false,"tooltip":"Maximum wall bounces, 1 through 4: 6, 24, 62 or 128 image-source paths per ear. Higher order gives denser reflections and costs more IR-build and convolution work."},
    {"key":"sourceX","label":"Source X","defaultValue":"0.3","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Source position as a fraction of room width: 0% at the left wall, 100% at the right wall. Wet input is the average of Left and Right; dry stereo is retained."},
    {"key":"sourceY","label":"Source Y","defaultValue":"0.3","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Source position as a fraction of room depth, front to back."},
    {"key":"sourceZ","label":"Source Z","defaultValue":"0.5","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Source position as a fraction of room height, floor to ceiling."},
    {"key":"listenerX","label":"Listener X","defaultValue":"0.6","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Listener center as a fraction of room width. Left and right receivers are separated along X by Ear Distance and kept at least 1 mm inside the side walls."},
    {"key":"listenerY","label":"Listener Y","defaultValue":"0.7","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Listener position as a fraction of room depth. Position changes regenerate reflection distances and amplitudes."},
    {"key":"listenerZ","label":"Listener Z","defaultValue":"0.5","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Listener position as a fraction of room height."},
    {"key":"absorption","label":"Absorption","defaultValue":"0.6","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Energy absorbed at each wall bounce: 100% removes all reflections; 0% gives undamped reflection gains. Distance uses 1/r amplitude with a 1 mm singularity floor. No hidden loudness normalization or limiter."},
    {"key":"dampingHz","label":"Damping","defaultValue":"12000","min":"100","mid":"2000","max":"20000","step":"any","unit":"Hz","nonlinearSlider":true,"tooltip":"Wall lowpass pole frequency in Hz, divided by reflection order for darker later paths. Finite exponential IR tails end at -100 dB amplitude. Fractional arrivals use two-sample interpolation, with its inherent high-frequency rolloff."},
    {"key":"earDistance","label":"Ear Distance","defaultValue":"0.18","min":"0","mid":"0.18","max":"0.5","step":"any","unit":"m","tooltip":"Stereo receiver separation in meters. Zero makes identical wet channels. This is a spaced-receiver model, not an HRTF or binaural head simulation."},
    {"key":"mix","label":"Mix","defaultValue":"0.35","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Delayed dry stereo versus reflected sound. Direct path is excluded from the IR; dry and wet share 256 samples of convolution buffering latency. Ready becomes high after the first kernel is built; Error reports an invalid or over-capacity request."}
  ]
})json";
}
extern "C" int soemdsp_early_reflection_convolution_create() {
  for (int i=0;i<64;++i) if (!pool[i]) {
    auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if (!s) return 0; s->initialize(); pool[i]=s; return i+1;
  }
  return 0;
}
extern "C" void soemdsp_early_reflection_convolution_destroy(int h) {
  if (auto* s=get(h)) { soemdsp::memory_pool::release(s); pool[h-1]=nullptr; }
}
extern "C" void soemdsp_early_reflection_convolution_reset(int h) { if (auto* s=get(h)) s->reset(); }
extern "C" int soemdsp_early_reflection_convolution_configure(int h,double width,double depth,double height,
  double sx,double sy,double sz,double lx,double ly,double lz,double absorption,double damping,double ears,int order,double rate,double diffusion,double diffusionMs) {
  auto* s=get(h); if (!s) return -1;
  const double values[]={width,depth,height,sx,sy,sz,lx,ly,lz,absorption,damping,ears,rate,diffusion,diffusionMs};
  for (double v:values) if (!__builtin_isfinite(v)) { s->badConfig=true; return -2; }
  if (width<.01 || depth<.01 || height<.01 || damping<=0 || ears<0 || diffusionMs<0 || order<1 || order>4 || rate<8000 || rate>192000) { s->badConfig=true; return -2; }
  if (s->requested.rate!=rate) s->reset();
  s->badConfig=false;
  using soemdsp_room_ir::bounded;
  s->requested={width,depth,height,bounded(sx,0,1),bounded(sy,0,1),bounded(sz,0,1),
    bounded(lx,0,1),bounded(ly,0,1),bounded(lz,0,1),bounded(absorption,0,1),damping,ears,bounded(diffusion,0,1),diffusionMs,rate,order};
  return 0;
}
extern "C" double soemdsp_early_reflection_convolution_sample(int h,double l,double r,double mix) {
  auto* s=get(h); return s ? s->tick(l,r,mix) : 0;
}
extern "C" double soemdsp_early_reflection_convolution_right(int h) { auto* s=get(h); return s ? s->right : 0; }
extern "C" double soemdsp_early_reflection_convolution_ready(int h) { auto* s=get(h); return s ? s->ready : 0; }
extern "C" double soemdsp_early_reflection_convolution_error(int h) { auto* s=get(h); return s ? (s->error || s->badConfig ? 1 : 0) : 1; }
extern "C" int soemdsp_early_reflection_convolution_latency() { return soemdsp_room_ir::hop; }
extern "C" int soemdsp_early_reflection_convolution_version() { return 2; }
extern "C" const char* soemdsp_early_reflection_convolution_metadata_json() { return metadata; }
extern "C" int soemdsp_early_reflection_convolution_metadata_json_size() { return sizeof(metadata)-1; }
extern "C" int soemdsp_early_reflection_convolution_ir_length(int h) { auto* s=get(h); return s && s->valid ? s->kernels[s->active].length : 0; }
extern "C" double soemdsp_early_reflection_convolution_ir_sample(int h,int ear,int sample) {
  auto* s=get(h); return s && s->valid && ear>=0 && ear<2 && sample>=0 && sample<s->kernels[s->active].length ? s->kernels[s->active].ir[ear][sample] : 0;
}
extern "C" int soemdsp_early_reflection_convolution_busy(int h) { auto* s=get(h); return s && (s->stage || s->transitioning || (!s->valid && !s->error) || !s->requested.same(s->applied)) ? 1 : 0; }
