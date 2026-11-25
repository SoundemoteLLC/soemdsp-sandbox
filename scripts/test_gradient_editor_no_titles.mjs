#!/usr/bin/env node
// No hover text: the Spectrogram gradient-stops editor must not set title attributes or
// .title properties (App Policy 12). Accessible names go through aria-label.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "public/modules/spectrogram/spectrogram-gradient-editor.js"), "utf8");
const bad = [];
src.split(/\r?\n/).forEach((line, i) => {
  if (/\btitle=["'\\]|[\w\]\)]\.title\s*=[^=]|setAttribute\(\s*["']title["']/.test(line)) bad.push(`${i + 1}: ${line.trim()}`);
});
if (bad.length) {
  console.error("tooltip/title usage in spectrogram-gradient-editor.js:\n" + bad.join("\n"));
  process.exit(1);
}
console.log("test_gradient_editor_no_titles: ok");