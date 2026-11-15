// soemdsp::memory_pool -- one shared pool of big buffers for native modules.
//
// Why: the engine has no malloc, so every module used to reserve its worst-case
// buffers in static memory for EVERY instance slot (a reverb: ~20 MB x 4 slots,
// used or not), and modules that wanted better (Ping-Pong Delay, Audio Player)
// each wrote a private grower that could not see the others. With one pool a
// module takes what its settings need when it is created and gives it back when
// it is destroyed. APP_POLICY section 2b: pay for what you use.
//
// Model (deliberately plain):
//   alloc(bytes)   a zeroed block of whole 64 KB wasm pages, or nullptr when the
//                  memory budget is used up (or the host refuses to grow memory).
//                  Meant for BIG buffers (delay lines, wavetables): each block is
//                  at least one page. Small per-instance state stays in the
//                  module's static slot array.
//   release(p)     gives the block back; it is reused (split if larger than needed) by a later alloc,
//                  and touching free blocks are merged.
//                  Memory is never returned to the host (wasm cannot shrink), so a
//                  released block is simply free for the next request.
//   Growth is one memory.grow per new block, taking the new pages from the end of
//   memory, so it never assumes nothing else grew memory in between.
//
// The engine rebuilds (clear + compile) when a module that uses the pool is
// added or removed, so blocks are all released and re-taken together and the
// free list stays tidy. Nothing here needs to be clever about fragmentation.
//
// One pool for the whole combined binary: the state is an inline variable, so
// every module that includes this header shares the same one when linked
// together (each standalone module build has its own).
#pragma once

namespace soemdsp {
namespace memory_pool {

static const unsigned long kPageBytes = 65536UL;
static const int kMaxLiveBlocks = 8192;
static const int kMaxFreeBlocks = 8192;

struct Block {
  unsigned long addr;  // start of the block (0 = empty slot)
  unsigned long pages;
};

struct State {
  Block live[kMaxLiveBlocks];
  Block freed[kMaxFreeBlocks];
  int liveCount;
  int freedCount;
  unsigned long usedBytes;       // live blocks
  unsigned long committedBytes;  // everything the pool ever grew (live + free)
  unsigned long peakBytes;       // highest usedBytes seen
  unsigned long budgetBytes;     // 0 = default budget
  unsigned long failedBytes;     // size of the last request that could not be met (0 = none)
};

inline State& state() {
  static State s;
  return s;
}

static const unsigned long kDefaultBudgetBytes = 3072UL * 1024UL * 1024UL;  // 3 GiB (128 big reverbs fit); the user setting overrides (combined max-memory is 4 GiB)

inline unsigned long budget() {
  const State& s = state();
  return s.budgetBytes ? s.budgetBytes : kDefaultBudgetBytes;
}

inline void set_budget(unsigned long bytes) { state().budgetBytes = bytes; }

inline unsigned long pages_for(unsigned long bytes) {
  return bytes ? (bytes + kPageBytes - 1) / kPageBytes : 1;
}

inline void zero_block(unsigned long addr, unsigned long bytes) {
  unsigned char* p = (unsigned char*)addr;
  for (unsigned long i = 0; i < bytes; i++) p[i] = 0;
}

inline void* alloc(unsigned long bytes) {
  State& s = state();
  const unsigned long pages = pages_for(bytes);
  const unsigned long size = pages * kPageBytes;
  if (s.liveCount >= kMaxLiveBlocks || s.usedBytes + size > budget()) {
    s.failedBytes = size;
    return nullptr;
  }
  unsigned long addr = 0;
  unsigned long blockPages = pages;
  // Reuse the smallest released block that fits.
  int best = -1;
  for (int i = 0; i < s.freedCount; i++) {
    if (s.freed[i].pages >= pages && (best < 0 || s.freed[i].pages < s.freed[best].pages)) best = i;
  }
  if (best >= 0) {
    addr = s.freed[best].addr;
    if (s.freed[best].pages > pages) {
      // Take only what is needed from the front; the rest stays free (so a small block never ties up a big one).
      s.freed[best].addr += pages * kPageBytes;
      s.freed[best].pages -= pages;
    } else {
      s.freed[best] = s.freed[s.freedCount - 1];
      s.freedCount -= 1;
    }
    zero_block(addr, pages * kPageBytes);
  } else {
    if (s.committedBytes + size > budget()) {
      s.failedBytes = size;
      return nullptr;
    }
#if defined(__wasm__)
    const long previous = __builtin_wasm_memory_grow(0, (unsigned long)pages);
    if (previous < 0) {
      s.failedBytes = size;
      return nullptr;
    }
    addr = (unsigned long)previous * kPageBytes;  // new pages are zero
    s.committedBytes += size;
#else
    s.failedBytes = size;
    return nullptr;
#endif
  }
  s.live[s.liveCount].addr = addr;
  s.live[s.liveCount].pages = blockPages;
  s.liveCount += 1;
  s.usedBytes += blockPages * kPageBytes;
  if (s.usedBytes > s.peakBytes) s.peakBytes = s.usedBytes;
  return (void*)addr;
}

inline void release(void* block) {
  if (!block) return;
  State& s = state();
  const unsigned long addr = (unsigned long)block;
  for (int i = s.liveCount - 1; i >= 0; i--) {
    if (s.live[i].addr != addr) continue;
    s.usedBytes -= s.live[i].pages * kPageBytes;
    Block b = s.live[i];
    // Merge with free blocks that touch this one, so freed space comes back as big blocks again.
    for (bool merged = true; merged;) {
      merged = false;
      for (int k = 0; k < s.freedCount; k++) {
        if (s.freed[k].addr + s.freed[k].pages * kPageBytes == b.addr) {
          b.addr = s.freed[k].addr;
          b.pages += s.freed[k].pages;
        } else if (b.addr + b.pages * kPageBytes == s.freed[k].addr) {
          b.pages += s.freed[k].pages;
        } else {
          continue;
        }
        s.freed[k] = s.freed[s.freedCount - 1];
        s.freedCount -= 1;
        merged = true;
        break;
      }
    }
    if (s.freedCount < kMaxFreeBlocks) {
      s.freed[s.freedCount] = b;
      s.freedCount += 1;
    }
    s.live[i] = s.live[s.liveCount - 1];
    s.liveCount -= 1;
    return;
  }
}

// Size of a request that failed since the last call (0 = none): lets the engine tell "out of memory" from "no free slot".
inline unsigned long take_failure() {
  State& s = state();
  const unsigned long v = s.failedBytes;
  s.failedBytes = 0;
  return v;
}

}  // namespace memory_pool
}  // namespace soemdsp
