// soemdsp-native-module: spectral_delay
// soemdsp-native-label: Spectral Delay
// soemdsp-native-target: spectralDelay
// soemdsp-native-kind: effect
#include "delay_engine.h"
#include <soemdsp/utility/memory_pool.h>
namespace {
using State=soemdsp_spectral_delay::State;
State* pool[64]{};
State* get(int h) { return h>0 && h<=64 ? pool[h-1]:nullptr; }
const char metadata[]=R"json({"module":"spectral_delay","targetType":"spectralDelay","label":"Spectral Delay","kind":"effect","inputs":["In","Left","Right"],"outputs":["Mono","Left","Right","Error"],"parameters":[
{"key":"fftSize","label":"FFT Size","kind":"choice","choices":["512","1024","2048","4096","8192","16384"],"choiceKeys":["512","1024","2048","4096","8192","16384"],"choiceIds":[512,1024,2048,4096,8192,16384],"defaultValue":"4096","min":"0","mid":"2.5","max":"5","step":"1","unit":"samples","linearSmoothing":false,"displayChoices":true,"divideChoicesVisibly":false,"tooltip":"STFT window and dry-path latency in samples. Smaller windows give tighter timing; larger windows separate nearby frequencies. Size changes run a new delay engine alongside the old one until its window and requested delays are filled, then crossfade over 50 ms. Old feedback history is not translated between resolutions. Plugin-host latency compensation is unverified."},
{"key":"baseDelayMs","label":"Base Delay","kind":"time","defaultValue":"120","min":"0","mid":"200","max":"2000","step":"any","unit":"ms","nonlinearSlider":true,"tooltip":"Minimum added spectral delay in milliseconds, beyond FFT Size latency. Continuous read-head movement can change pitch while delay is edited. Zero Spread and zero Feedback make all bands share this delay; integer-hop delays reconstruct exactly within FFT rounding."},
{"key":"spreadMs","label":"Delay Spread","kind":"time","defaultValue":"180","min":"-2000","mid":"0","max":"2000","step":"any","unit":"ms","tooltip":"Additional delay range in milliseconds. Positive puts highs later; negative puts lows later. Base Delay is always the minimum. Base plus absolute Spread must fit the reported native capacity: roughly 10.8 seconds at 48 kHz or 2.7 seconds at 192 kHz. Invalid requests retain the previous valid settings and raise Error."},
{"key":"pivotHz","label":"Frequency Pivot","kind":"frequency","defaultValue":"1000","min":"20","mid":"1000","max":"16000","step":"any","unit":"Hz","nonlinearSlider":true,"tooltip":"Frequency at the midpoint of the uncurved delay distribution. Must be above zero and below Nyquist. Curve warps that distribution; DC and Nyquist remain its endpoints."},
{"key":"curve","label":"Delay Curve","defaultValue":"0","min":"-1","mid":"0","max":"1","step":"any","tooltip":"Rational delay-distribution contour. Zero follows the Pivot mapping; positive moves more frequencies toward the high endpoint, negative toward the low endpoint. This changes timing, not spectral amplitude."},
{"key":"feedback","label":"Feedback","defaultValue":"0.35","min":"-1","mid":"0","max":"1","step":"any","unit":"%","tooltip":"Spectral delay feedback coefficient; negative reverses feedback polarity. Absolute values below 100% decay; 100% can sustain and larger user-defined values can grow. Tilt attenuates one frequency region; Crossfeed routes the feedback between channels. No hidden limiter or clipping. The feedback loop has at least one STFT hop of delay even when a band's requested delay is shorter."},
{"key":"feedbackTiltDb","label":"Feedback Tilt","defaultValue":"0","min":"-24","mid":"0","max":"24","step":"any","unit":"dB","tooltip":"Feedback endpoint contrast in dB, shaped around Frequency Pivot. Positive retains high-frequency feedback and attenuates lows; negative retains lows and attenuates highs. At the Pivot, attenuation is half the absolute Tilt. Zero is flat. This is attenuation-only, not dB per octave or a hidden boost, and does not filter the first echo."},
{"key":"crossfeed","label":"Stereo Crossfeed","defaultValue":"0","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Feedback routing between independent stereo delay histories. Zero keeps each channel separate; 50% mixes both feedback lanes equally; 100% swaps them so a left-only excitation alternates channels on later echoes. The first echo and dry signal stay in their original channels. Mono excitation stays centered; no extra lookahead or latency."},
{"key":"mix","label":"Mix","defaultValue":"1","min":"0","mid":"0.5","max":"1","step":"any","unit":"%","tooltip":"Dry/wet mix. Dry is aligned to FFT Size latency, not to the additional band delays. Left and Right spectral histories remain independent; no mono downmix or stereo crossfeed."}
]})json";
}
extern "C" int soemdsp_spectral_delay_create() {
  for(int i=0;i<64;++i) if(!pool[i]) {
    auto* s=static_cast<State*>(soemdsp::memory_pool::alloc(sizeof(State)));
    if(!s) return 0; s->initialize(); pool[i]=s; return i+1;
  }
  return 0;
}
extern "C" void soemdsp_spectral_delay_destroy(int h) { if(auto* s=get(h)) {soemdsp::memory_pool::release(s);pool[h-1]=nullptr;} }
extern "C" void soemdsp_spectral_delay_reset(int h) { if(auto* s=get(h)) s->reset(); }
extern "C" int soemdsp_spectral_delay_configure(int h,int size,double base,double spread,double pivot,double curve,double feedback,double rate,double tiltDb,double crossfeed) {
  auto* s=get(h); if(!s) return -1;
  const double values[]={base,spread,pivot,curve,feedback,rate,tiltDb,crossfeed};
  for(double v:values) if(!__builtin_isfinite(v)) {s->error=1;return -2;}
  using namespace soemdsp_spectral_delay;
  if(!validSize(size) || rate<8000 || rate>192000 || base<0 || pivot<=0 || pivot>=rate*.5) {s->error=1;return -2;}
  const double total=base+(spread<0?-spread:spread);
  double limit=maxDelayMs(size,rate);
  const double activeLimit=maxDelayMs(s->cores[s->current].size,rate); if(activeLimit<limit) limit=activeLimit;
  if(s->changing) {const double other=maxDelayMs(s->cores[1-s->current].size,rate);if(other<limit)limit=other;}
  if(total>limit) {s->error=1;return -3;}
  s->desired=size;
  if(s->settings.rate!=rate) s->reset();
  s->settings={base,spread,pivot,soemdsp::math::clamp11(curve),feedback,rate,tiltDb,soemdsp::math::clamp01(crossfeed)};s->error=0;
  return 0;
}
extern "C" double soemdsp_spectral_delay_sample(int h,double l,double r,double mix) {auto* s=get(h);return s?s->tick(l,r,mix):0;}
extern "C" double soemdsp_spectral_delay_right(int h) {auto* s=get(h);return s?s->right:0;}
extern "C" double soemdsp_spectral_delay_error(int h) {auto* s=get(h);return s?s->error:1;}
extern "C" int soemdsp_spectral_delay_fft_size(int h) {auto* s=get(h);return s?s->cores[s->current].size:0;}
extern "C" int soemdsp_spectral_delay_busy(int h) {auto* s=get(h);return s&&(s->changing||s->cores[s->current].size!=s->desired)?1:0;}
extern "C" int soemdsp_spectral_delay_latency() {return 4096;}
extern "C" int soemdsp_spectral_delay_latency_for_handle(int h) {return soemdsp_spectral_delay_fft_size(h);}
extern "C" double soemdsp_spectral_delay_max_delay_ms(int h) {auto* s=get(h);return s?soemdsp_spectral_delay::maxDelayMs(s->cores[s->current].size,s->settings.rate):0;}
extern "C" double soemdsp_spectral_delay_state_bytes() {return sizeof(State);}
extern "C" double soemdsp_spectral_delay_bin_delay_ms(int h,int bin) {
  auto* s=get(h);if(!s)return 0;const auto& c=s->cores[s->current];
  return bin>=0&&bin<=c.size/2?c.delays[bin]*(c.size/4)*1000.0/s->settings.rate:0;
}
extern "C" double soemdsp_spectral_delay_feedback_gain(int h,int bin) {
  auto* s=get(h);if(!s)return 0;const auto& c=s->cores[s->current];
  return bin>=0&&bin<=c.size/2?c.feedbackGains[bin]:0;
}
extern "C" int soemdsp_spectral_delay_version() {return 2;}
extern "C" const char* soemdsp_spectral_delay_metadata_json() {return metadata;}
extern "C" int soemdsp_spectral_delay_metadata_json_size() {return sizeof(metadata)-1;}
