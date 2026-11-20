#!/usr/bin/env node
// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { buildFile, buildImageFile, decompileFile, exportEngineFile, generateWithLLM, inspectGLB, refineGLB, verifyFiles } from './browser.mjs';
import { detectKind } from './core/image.js';
import { DEFAULT_BASE_URL, DEFAULT_CLAUDE_MODEL, listModels } from './core/llm.js';
import { meshoptGLB } from './optimize.mjs';

const USAGE = `meshcode — 3D models as code ↔ GLB

Usage:
  meshcode build <model.js> [-o out.glb] [--meshopt]   run a three.js model module, write GLB
  meshcode build <image.js|.svg|.html> -o out.png      2D: render code to PNG / JPG / WebP [--quality 0.92]
  meshcode inspect <file.glb>                          print meshes, triangles, bounding box
  meshcode decompile <file.glb> [-o out.js]            GLB → model module (+ textures), checks fidelity
  meshcode export <model.js|.glb> --to godot|unity [-o file]
                                                       engine-native code: Godot GDScript, Unity C# (experimental)
  meshcode verify <a> <b> [--min 0.99]                 silhouette IoU of two models (.glb or .js);
                                                       exits 1 if mean IoU < --min

Optional AI (every result is run, and repaired up to 3 times if it fails):
  meshcode generate "<description>" [-o file] [--2d] [--critique]
                                                       write a model (or a 2D image) from a description;
                                                       --critique: show the render to a vision model once
  meshcode decompile <file.glb> --llm [-o out.js]      rewrite the decompiled code as readable code; kept only
                                                       if silhouettes (IoU ≥ 0.95) and materials match
  --provider openai|anthropic   openai = any OpenAI-compatible server (default: Ollama at ${DEFAULT_BASE_URL})
  --base-url <url>  --model <id>   keys: OPENAI_API_KEY, or ANTHROPIC_API_KEY (default model ${DEFAULT_CLAUDE_MODEL})

A model module is:  export default (THREE) => new THREE.Mesh(...)   // any Object3D
A 2D canvas module: export default (ctx, { width, height, frame }) => {…}  (+ export const size, frames)
Chrome is required (set MESHCODE_CHROME to use a specific binary).`;

/** @param {import('./browser.mjs').Stats} s */
const fmt = (s) =>
  `${s.meshes} meshes, ${s.instances} instances, ${s.triangles.toLocaleString('en')} tris, ` +
  `bbox [${s.min.map((v) => +v.toFixed(4))}] → [${s.max.map((v) => +v.toFixed(4))}]`;

const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;
/** @type {Record<string, 'image/png' | 'image/jpeg' | 'image/webp'>} */
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const extname = (/** @type {string} */ f) => (f.match(/\.[^./]+$/)?.[0] ?? '').toLowerCase();
const mats = (/** @type {string[]} */ d) => (d.length ? `materials: ${d.length} differences` : 'materials: identical');
const iou = (/** @type {{ mean: number, min: number }} */ r) => `silhouette IoU mean ${r.mean.toFixed(4)}, min ${r.min.toFixed(4)}`;

/** @param {Record<string, string | boolean | undefined>} values @returns {Promise<import('./core/llm.js').LLM>} */
async function llmConfig(values) {
  const provider = values.provider ?? 'openai';
  if (provider !== 'openai' && provider !== 'anthropic') throw new Error(`--provider must be openai or anthropic, got "${provider}"`);
  const llm = {
    provider, model: String(values.model ?? ''), baseURL: /** @type {string | undefined} */ (values['base-url']),
    apiKey: provider === 'openai' ? process.env.OPENAI_API_KEY : undefined, // the Anthropic SDK reads its own env/profile
  };
  if (!llm.model) {
    llm.model = provider === 'anthropic' ? DEFAULT_CLAUDE_MODEL : (await listModels(llm))[0];
    if (!llm.model) throw new Error('the server lists no models: pass --model');
    console.error(`using model ${llm.model} (--model to change)`);
  }
  return llm;
}
const onStatus = (/** @type {string} */ s) => console.error(`  ${s}`);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      meshopt: { type: 'boolean', default: false },
      min: { type: 'string' },
      quality: { type: 'string' },
      to: { type: 'string' },
      '2d': { type: 'boolean', default: false },
      critique: { type: 'boolean', default: false },
      llm: { type: 'boolean', default: false },
      provider: { type: 'string' },
      model: { type: 'string' },
      'base-url': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [cmd, input] = positionals;
  if (values.help || !cmd) return console.log(USAGE);
  if (!input) throw new Error(`missing ${cmd === 'generate' ? 'description' : 'input file'}\n\n${USAGE}`);

  if (cmd === 'build' && (IMAGE_TYPES[extname(values.out ?? '')] || /\.(svg|html?)$/i.test(input))) {
    const out = values.out ?? input.replace(/\.[^.]+$/, '') + '.png';
    const type = IMAGE_TYPES[extname(out)];
    if (!type) throw new Error(`2D output must be .png, .jpg or .webp, got "${out}"`);
    const { bytes, meta } = await buildImageFile(input, type, values.quality ? Number(values.quality) : undefined);
    await writeFile(out, bytes);
    const sheet = meta.frames > 1 ? ` × ${meta.frames} frames → sheet ${meta.sheetWidth}×${meta.sheetHeight}` : '';
    console.log(`wrote ${out}  ${kb(bytes.length)}\n  ${meta.kind} ${meta.width}×${meta.height}${sheet}, ${(meta.coverage * 100).toFixed(1)}% non-transparent`);
  } else if (cmd === 'build') {
    const { glb, stats } = await buildFile(input);
    const final = values.meshopt ? await meshoptGLB(glb) : glb;
    const out = values.out ?? input.replace(/\.[cm]?js$/, '') + '.glb';
    await writeFile(out, final);
    console.log(`wrote ${out}  ${kb(final.length)}${values.meshopt ? ` (raw ${kb(glb.length)})` : ''}`);
    console.log(`  ${fmt(stats)}`);
  } else if (cmd === 'inspect') {
    const buf = await readFile(input);
    console.log(`${input}  ${kb(buf.length)}\n  ${fmt(await inspectGLB(buf))}`);
  } else if (cmd === 'generate') {
    const mode = values['2d'] ? '2d' : '3d';
    const r = await generateWithLLM({ llm: await llmConfig(values), mode, prompt: input, critique: values.critique, onStatus });
    if (!r.code) throw new Error(`no code after ${r.replies} replies: ${r.error}`);
    const out = values.out ?? (mode === '3d' ? 'model.js' : `image.${{ canvas: 'js', svg: 'svg', html: 'html' }[detectKind(r.code)]}`);
    await writeFile(out, r.code);
    const lines = r.code.split('\n').length - 1;
    console.log(`wrote ${out}  ${lines} ${lines === 1 ? 'line' : 'lines'}, ${r.replies} ${r.replies === 1 ? 'reply' : 'replies'}`);
    if (!r.ok) {
      console.error(`meshcode: the last version still fails: ${r.error}`);
      process.exitCode = 1;
    }
  } else if (cmd === 'decompile' && values.llm) {
    const out = values.out ?? input.replace(/\.glb$/i, '') + '.js';
    const r = await refineGLB(input, { llm: await llmConfig(values), onStatus });
    await writeFile(out, r.code);
    if (r.ok) console.log(`wrote ${out}  readable code: silhouette IoU ${r.mean?.toFixed(4)}, materials identical (${r.replies} replies)`);
    else console.log(`wrote ${out}  deterministic code (textures inline): no AI rewrite passed the check — ${r.error}`);
  } else if (cmd === 'decompile') {
    const out = values.out ?? input.replace(/\.glb$/i, '') + '.js';
    const r = await decompileFile(input, out);
    const kinds = Object.entries(r.summary).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none';
    console.log(`wrote ${out}  ${kb(Buffer.byteLength(r.code))}${r.textureFiles.length ? ` + ${r.textureFiles.join(', ')}` : ''}`);
    console.log(`  geometry: ${kinds}`);
    console.log(`  fidelity: ${iou(r.fidelity)} · tris ${r.fidelity.a.triangles} → ${r.fidelity.b.triangles} · ${mats(r.fidelity.materials)}`);
    for (const w of r.warnings) console.warn(`  warning: ${w}`);
  } else if (cmd === 'export') {
    if (values.to !== 'godot' && values.to !== 'unity') throw new Error(`--to must be godot or unity (Unreal: use the GLB, it imports natively)\n\n${USAGE}`);
    const r = await exportEngineFile(input, values.to);
    const out = values.out ?? r.filename;
    await writeFile(out, r.code);
    const prims = r.meshes.filter((m) => m.kind === 'primitive').length;
    console.log(`wrote ${out}  ${kb(Buffer.byteLength(r.code))}\n  ${r.meshes.length} meshes (${prims} engine primitives, ${r.meshes.length - prims} vertex data)`);
    for (const w of r.warnings) console.warn(`  warning: ${w}`);
  } else if (cmd === 'verify') {
    const other = positionals[2];
    if (!other) throw new Error(`verify needs two files\n\n${USAGE}`);
    const r = await verifyFiles(input, other);
    console.log(`${iou(r)}\n  views: ${r.views.map((v) => v.toFixed(4)).join(' ')}\n  ${mats(r.materials)}\n  a: ${fmt(r.a)}\n  b: ${fmt(r.b)}`);
    for (const d of r.materials) console.log(`    ${d}`);
    if (values.min !== undefined && r.mean < Number(values.min)) {
      console.error(`meshcode: mean IoU ${r.mean.toFixed(4)} < --min ${values.min}`);
      process.exitCode = 1;
    }
  } else {
    throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
  }
}

main().catch((err) => {
  console.error(`meshcode: ${err.message.replace(/^page\.evaluate: /, '')}`);
  process.exit(1);
});
