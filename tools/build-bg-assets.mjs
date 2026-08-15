/**
 * Vendors the background remover's ML assets into public/ (Phase 8, plan §3.4).
 *
 * Everything the tool needs is SELF-HOSTED — no third-party CDN is ever
 * contacted at runtime — so both halves live in the repo and ship with the
 * build:
 *
 *   public/models/u2netp.onnx            the segmentation model (~4.4MB)
 *   public/ort/ort-wasm-simd-threaded.wasm   ONNX Runtime Web's kernels (~11MB)
 *   public/ort/ort-wasm-simd-threaded.mjs    its loader module (~20KB)
 *
 * Licenses (verified before adoption, per plan §3.4.3):
 *   - U^2-Net / u2netp — Apache-2.0 (github.com/xuebinqin/U-2-Net). The
 *     ONNX conversion is redistributed by rembg (also Apache-2.0/MIT), which
 *     is where the file below comes from. Deliberately NOT BriaAI RMBG or
 *     @imgly/background-removal: both carry non-commercial terms.
 *   - onnxruntime-web — MIT (Microsoft). Both files are copied verbatim out
 *     of node_modules, so they always match the installed package version.
 *
 * Usage: node tools/build-bg-assets.mjs          (skips files already present)
 *        node tools/build-bg-assets.mjs --force  (re-download / re-copy)
 *
 * The generated files are committed — a fresh clone must build a working app
 * without network access, exactly like the bundled GeoNames dataset.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MODEL_URL =
  'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx';
const MODEL_OUT = resolve('public/models/u2netp.onnx');
// The .wasm kernels AND the loader .mjs that instantiates them. The bundled
// build claims to inline the loader, but the production bundle still resolves
// it as a sibling URL (…/_astro/ort-wasm-simd-threaded.mjs, which nothing
// emits), so runtime.ts points ORT at these hosted copies explicitly.
const ORT_FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
const ortSrc = (name) => resolve(`node_modules/onnxruntime-web/dist/${name}`);
const ortOut = (name) => resolve(`public/ort/${name}`);
const ORT_WASM_SRC = ortSrc('ort-wasm-simd-threaded.wasm');
const ORT_WASM_OUT = ortOut('ort-wasm-simd-threaded.wasm');

const force = process.argv.includes('--force');

async function fetchModel() {
  if (existsSync(MODEL_OUT) && !force) {
    console.log(`model present (${(statSync(MODEL_OUT).size / 1048576).toFixed(1)}MB) — skipping`);
    return;
  }
  console.log(`downloading ${MODEL_URL} …`);
  const response = await fetch(MODEL_URL, { redirect: 'follow' });
  if (!response.ok) throw new Error(`model download failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  mkdirSync(resolve('public/models'), { recursive: true });
  writeFileSync(MODEL_OUT, bytes);
  console.log(`wrote ${MODEL_OUT} (${(bytes.length / 1048576).toFixed(1)}MB)`);
}

function copyRuntime() {
  mkdirSync(resolve('public/ort'), { recursive: true });
  for (const name of ORT_FILES) {
    if (!existsSync(ortSrc(name))) {
      throw new Error('onnxruntime-web is not installed — run npm install first');
    }
    if (existsSync(ortOut(name)) && !force) {
      console.log(`${name} present — skipping`);
      continue;
    }
    copyFileSync(ortSrc(name), ortOut(name));
    console.log(`wrote ${ortOut(name)} (${(statSync(ortOut(name)).size / 1024).toFixed(0)}KB)`);
  }
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

await fetchModel();
copyRuntime();

// A provenance record next to the binaries: what they are, where they came
// from, and how to tell a corrupted or swapped file from the real one.
const ortVersion = JSON.parse(
  readFileSync(resolve('node_modules/onnxruntime-web/package.json'), 'utf8')
).version;
writeFileSync(
  resolve('public/models/PROVENANCE.txt'),
  [
    'u2netp.onnx',
    `  source:  ${MODEL_URL}`,
    '  model:   U^2-Net (small variant, 320x320 input) — github.com/xuebinqin/U-2-Net',
    '  license: Apache-2.0',
    `  bytes:   ${statSync(MODEL_OUT).size}`,
    `  sha256:  ${sha256(MODEL_OUT)}`,
    '',
    ...ORT_FILES.flatMap((name) => [
      `../ort/${name}`,
      `  source:  npm onnxruntime-web@${ortVersion} (dist/)`,
      '  license: MIT',
      `  bytes:   ${statSync(ortOut(name)).size}`,
      `  sha256:  ${sha256(ortOut(name))}`,
      '',
    ]).slice(0, -1),
    '',
    'Regenerate both with: node tools/build-bg-assets.mjs --force',
    '',
  ].join('\n')
);
console.log('wrote public/models/PROVENANCE.txt');
