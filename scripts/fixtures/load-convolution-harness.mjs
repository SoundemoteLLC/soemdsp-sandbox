import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
export async function loadConvolutionHarness(exports) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-stft-test-"));
  try {
    const output = path.join(temporary, "harness.wasm");
    execFileSync(process.env.CLANGXX || "C:/Program Files/LLVM/bin/clang++.exe", [
      "--target=wasm32", "-O3", "-msimd128", "-nostdlib", "-fno-exceptions", "-fno-rtti",
      "-Ilibrary/include", "-Wl,--no-entry", "-Wl,--export-memory", "-Wl,--max-memory=134217728",
      ...exports.map(key => `-Wl,--export=test_${key}`),
      "scripts/fixtures/convolution_vocoder_harness.cpp", "-o", output,
    ], { cwd: root, stdio: "pipe" });
    return (await WebAssembly.instantiate(fs.readFileSync(output))).instance.exports;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
