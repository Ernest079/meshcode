// Optional AI: the generate / repair / critique / refine loops against a scripted server (no real model,
// deterministic), the Anthropic SDK wiring, and the CLI end to end in headless Chrome.
// A real local model runs only on request: MESHCODE_OLLAMA_MODEL=dolphin3 pnpm test
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { promisify } from 'node:util';
import { buildFile, generateWithLLM } from '../src/browser.mjs';
import { extractCode, generate, listModels, MAX_REPAIRS, refine } from '../src/core/llm.js';
import { fakeLLM } from './fake-llm.mjs';

const exec = promisify(execFile);
const CLI = path.resolve('src/cli.mjs');
const fence = (/** @type {string} */ code, lang = 'js') => `Here it is:\n\`\`\`${lang}\n${code}\`\`\`\nDone.`;
const BOX = 'export default (THREE) => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());\n';
const tmp = () => mkdtemp(path.join(tmpdir(), 'meshcode-ai-'));

/** @type {Awaited<ReturnType<typeof fakeLLM>>} */ let fake;
before(async () => { fake = await fakeLLM(); });
after(() => fake.close());
beforeEach(() => { fake.replies.length = 0; fake.requests.length = 0; });
/** @returns {import('../src/core/llm.js').LLM} */
const openai = () => ({ provider: 'openai', baseURL: `${fake.url}/v1`, model: 'fake-coder' });
const chats = () => fake.requests.filter((r) => /\/(chat\/completions|messages)$/.test(r.path));

test('extractCode: longest closed block, unclosed fence while streaming, bare source, prose only', () => {
  assert.equal(extractCode('a\n```js\nx\n```\nb\n```\nlonger\n```'), 'longer\n');
  assert.equal(extractCode('ok\n```javascript\nexport default (T) =>'), 'export default (T) =>');
  assert.equal(extractCode('export default 1'), 'export default 1\n');
  assert.equal(extractCode('<svg></svg>'), '<svg></svg>\n');
  assert.equal(extractCode('Let me think about the proportions…'), null);
});

test('generate: a failing candidate goes back with its error, the fix is accepted, text streams', async () => {
  fake.replies.push(fence('BROKEN\n'), fence(BOX));
  /** @type {string[]} */ const streamed = [];
  const r = await generate({
    llm: openai(), mode: '3d', prompt: 'a box', onText: (t) => streamed.push(t),
    run: async (code) => (code.includes('BROKEN') ? { error: 'SyntaxError: Unexpected identifier' } : {}),
  });
  assert.deepEqual({ ok: r.ok, code: r.code, replies: r.replies }, { ok: true, code: BOX, replies: 2 });
  assert.ok(streamed.length > 5, 'streamed in chunks');
  const msgs = chats()[1].body.messages;
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /export default \(THREE\)/);
  assert.deepEqual(msgs.slice(1).map((/** @type {any} */ m) => m.role), ['user', 'assistant', 'user']);
  assert.match(msgs.at(-1).content, /SyntaxError: Unexpected identifier/);
});

test(`generate: gives up after ${MAX_REPAIRS} repairs; an empty model counts as a failure`, async () => {
  for (let i = 0; i <= MAX_REPAIRS; i++) fake.replies.push(fence(BOX));
  const r = await generate({ llm: openai(), mode: '3d', prompt: 'x', run: async () => ({ empty: true }) });
  assert.deepEqual({ ok: r.ok, replies: r.replies, code: r.code }, { ok: false, replies: MAX_REPAIRS + 1, code: BOX });
  assert.match(String(r.error), /no visible geometry/);
});

test('edit + visual critique: current code is sent, renders go as images, LGTM keeps the working code', async () => {
  fake.replies.push(fence(BOX), 'LGTM');
  const r = await generate({
    llm: openai(), mode: '3d', prompt: 'make it a box', code: 'export default (T) => new T.Group();\n', critique: true,
    run: async () => ({}), capture: async () => ['iVBORw0KGgo='],
  });
  assert.deepEqual({ ok: r.ok, code: r.code, replies: r.replies }, { ok: true, code: BOX, replies: 2 });
  assert.match(chats()[0].body.messages[1].content, /Current code:[\s\S]*new T\.Group\(\)[\s\S]*Change it: make it a box/);
  const critique = chats()[1].body.messages.at(-1);
  assert.equal(critique.content[0].type, 'text');
  assert.deepEqual(critique.content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } });
});

test('refine: base64 never reaches the model, is restored for the check, and a failed check is fed back', async () => {
  const blob = 'QUJD'.repeat(100);
  const code = `export default (THREE) => { const d = '${blob}'; return new THREE.Group(); };\n`;
  fake.replies.push(
    fence("// wrong\nexport default (THREE) => { const d = '@@BLOB0@@'; return new THREE.Group(); };\n"),
    fence("// readable\nexport default (THREE) => { const d = '@@BLOB0@@'; return new THREE.Group(); };\n"),
  );
  /** @type {string[]} */ const checked = [];
  const r = await refine({
    llm: openai(), code,
    verify: async (c) => (checked.push(c), c.includes('wrong') ? { mean: 0.5, materials: ['mesh 0: color ff0000 vs 00ff00'] } : { mean: 0.99, materials: [] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.mean, 0.99);
  assert.ok(!JSON.stringify(fake.requests).includes(blob), 'blob sent to the model');
  assert.ok(checked.every((c) => c.includes(blob)), 'blob restored before the check');
  assert.match(chats()[1].body.messages.at(-1).content, /IoU 0\.500 \(needs ≥ 0\.95\); materials differ: mesh 0: color/);
});

test('refine: invented placeholders are rejected; if nothing passes, the original code comes back', async () => {
  for (let i = 0; i <= MAX_REPAIRS; i++) fake.replies.push(fence("export default (T) => '@@BLOB7@@';\n"));
  const code = `export default (T) => '${'QUJD'.repeat(50)}';\n`;
  const r = await refine({ llm: openai(), code, verify: async () => ({ mean: 1, materials: [] }) });
  assert.deepEqual({ ok: r.ok, code: r.code }, { ok: false, code });
  assert.match(String(r.error), /@@BLOB7@@ does not exist/);
});

test('OpenAI-compatible: model list, bearer key, clear error when the server is down', async () => {
  assert.deepEqual(await listModels({ ...openai(), apiKey: 'sk-local' }), ['fake-coder']);
  assert.equal(fake.requests[0].headers.authorization, 'Bearer sk-local');
  await assert.rejects(listModels({ provider: 'openai', baseURL: 'http://127.0.0.1:9/v1', model: '' }), /cannot reach .*OLLAMA_ORIGINS/);
});

test('Claude via the Anthropic SDK: streaming, browser header, effort + refusal fallbacks, blocks echoed back', async () => {
  fake.replies.push(fence('BROKEN\n'), fence(BOX));
  /** @type {import('../src/core/llm.js').LLM} */
  const llm = { provider: 'anthropic', baseURL: fake.url, model: 'claude-opus-5-5', apiKey: 'sk-ant-test' };
  const r = await generate({ llm, mode: '3d', prompt: 'a box', run: async (c) => (c.includes('BROKEN') ? { error: 'boom' } : {}) });
  assert.equal(r.code, BOX);
  const [first, second] = chats();
  assert.equal(first.path, '/v1/messages');
  assert.equal(first.headers.authorization, 'Bearer sk-ant-test');
  assert.equal(first.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.match(String(first.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(first.body.fallbacks, 'default');
  assert.deepEqual(first.body.output_config, { effort: 'high' });
  assert.equal(first.body.stream, true);
  assert.match(first.body.system, /export default \(THREE\)/);
  assert.equal(second.body.messages[1].role, 'assistant');
  assert.equal(second.body.messages[1].content[0].type, 'text', 'assistant blocks echoed as returned');

  fake.replies.push(fence(BOX));
  await generate({ llm: { ...llm, model: 'claude-haiku-4-5' }, mode: '3d', prompt: 'a box', run: async () => ({}) });
  assert.equal(chats()[2].body.fallbacks, undefined, 'older models: no fallbacks/effort');
  assert.equal(chats()[2].body.output_config, undefined);
  assert.deepEqual(await listModels(llm), ['fake-coder']);
});

test('CLI generate: candidates run in headless Chrome, a runtime error is repaired, model picked from the list', async () => {
  fake.replies.push(fence("export default (THREE) => { throw new Error('boom'); };\n"), fence(BOX));
  const out = path.join(await tmp(), 'box.js');
  const { stdout, stderr } = await exec('node', [CLI, 'generate', 'a box', '-o', out, '--base-url', `${fake.url}/v1`]);
  assert.match(stderr, /using model fake-coder/);
  assert.match(stderr, /repair: Error: boom/);
  assert.match(stdout, /wrote .*box\.js {2}1 line, 2 replies/);
  assert.equal(await readFile(out, 'utf8'), BOX);
});

test('CLI generate --2d --critique: SVG answer saved as .svg, its render sent to the model as a PNG', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#e33"/></svg>\n';
  fake.replies.push(fence(svg, 'svg'), 'LGTM');
  const dir = await tmp();
  await exec('node', [CLI, 'generate', 'a red bar', '--2d', '--critique', '--base-url', `${fake.url}/v1`, '--model', 'fake-coder'], { cwd: dir });
  assert.equal(await readFile(path.join(dir, 'image.svg'), 'utf8'), svg);
  const image = chats()[1].body.messages.at(-1).content[1].image_url.url;
  const png = Buffer.from(image.split(',')[1], 'base64');
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [512, 256], 'small images are scaled up crisply for the model');
});

test('CLI decompile --llm: the rewrite is kept only once silhouettes and materials match the GLB', async () => {
  const dir = await tmp();
  const glb = path.join(dir, 'torch.glb');
  await writeFile(glb, (await buildFile('test/fixtures/primitives.js')).glb);
  // The fixture is readable code for this GLB; GLTFLoader flips normalScale.y (no tangents), so a faithful rewrite keeps that.
  const readable = (await readFile('test/fixtures/primitives.js', 'utf8'))
    .replace('  return torch;', '  for (const m of [wood, iron, flame]) m.normalScale.set(1, -1);\n  return torch;');
  fake.replies.push(fence(BOX), fence(readable));
  const out = path.join(dir, 'torch.js');
  const { stdout } = await exec('node', [CLI, 'decompile', glb, '--llm', '-o', out, '--base-url', `${fake.url}/v1`, '--model', 'fake-coder']);
  assert.match(stdout, /readable code: silhouette IoU 1\.0000, materials identical \(2 replies\)/);
  assert.equal(await readFile(out, 'utf8'), readable);
  assert.match(chats()[1].body.messages.at(-1).content, /Automatic check failed: silhouette IoU 0\.\d+/);
});

const OLLAMA = process.env.MESHCODE_OLLAMA_MODEL;
test('a real local model writes a working model (Ollama)', { skip: !OLLAMA && 'opt-in: MESHCODE_OLLAMA_MODEL=<model> pnpm test' }, async () => {
  const r = await generateWithLLM({
    llm: { provider: 'openai', model: /** @type {string} */ (OLLAMA) }, mode: '3d', prompt: 'a red cube, 1 metre wide',
    onStatus: (s) => console.error(`  ollama: ${s}`),
  });
  console.error(`  ollama: ${r.ok ? 'ok' : 'failed'} after ${r.replies} replies\n${r.code}`);
  assert.equal(r.ok, true, r.error);
});
