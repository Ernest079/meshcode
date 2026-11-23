// @ts-check
// Optional AI. Talks to an OpenAI-compatible server (Ollama, LM Studio, llama.cpp, OpenAI, OpenRouter,
// Groq…) with plain fetch, or to Claude through the official SDK (llm-anthropic.js, loaded on demand).
// The loops never execute code themselves: the caller passes run / capture / verify callbacks
// (sandboxed iframe in the web app, headless Chrome in the CLI). Works in browsers and Node 22.

/** @typedef {{ provider: 'openai' | 'anthropic', model: string, baseURL?: string, apiKey?: string }} LLM */
/** @typedef {{ role: 'user' | 'assistant', text: string, images?: string[], raw?: unknown }} Msg images: base64 PNG; raw: provider blocks to echo back */
/** @typedef {{ onText?: (text: string) => void, onStatus?: (status: string) => void, signal?: AbortSignal }} Hooks */

export const DEFAULT_BASE_URL = 'http://localhost:11434/v1'; // Ollama
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export const MAX_REPAIRS = 3;
export const MIN_IOU = 0.95;

const REPLY_RULE = 'Reply with exactly one fenced code block that contains the whole file, then at most two short sentences.';

export const SYSTEM = {
  '3d': `You write 3D game models as JavaScript modules for meshcode (three.js r187).
Contract: the default export receives the THREE namespace and returns a THREE.Object3D (it may be async):
  export default (THREE) => { const root = new THREE.Group(); /* … */ return root; };
Optional animation of rigid parts (only when asked): sampled into keyframes and exported in the GLB.
  export const duration = 2; // seconds, loops
  export const animate = (root, t) => { root.getObjectByName('lid').rotation.x = -Math.sin((Math.PI * t) / duration); };
  animate sets absolute position/rotation/scale from t (no increments); find parts by name; t = 0 is the rest pose.
Rules:
- No imports and no network: use only the THREE argument. Textures are drawn on a canvas (document.createElement('canvas')) and wrapped in THREE.CanvasTexture; set colorSpace = THREE.SRGBColorSpace on colour maps.
- Metres, Y up; the model stands on y = 0, centred on x and z. Give each part a mesh.name.
- MeshStandardMaterial with sensible roughness/metalness; emissive or MeshBasicMaterial for glowing parts.
- Build shapes from primitives (Box, Cylinder, Sphere, Cone, Torus, Capsule), LatheGeometry for turned profiles, ExtrudeGeometry for flat outlines. Many copies of one part: THREE.InstancedMesh.
- Aim for a recognisable, detailed silhouette in under 200 lines; deterministic (seeded random if needed).
${REPLY_RULE}`,
  '2d': `You write 2D game images as code for meshcode. Use one of three source kinds:
1. Canvas module (sprites, textures, animation):
  export const size = [64, 64];   // one frame, pixels
  export const frames = 8;        // optional: sprite-sheet frames, laid out left to right
  export const fps = 8;           // optional preview speed
  export default (ctx, { width, height, frame, frames }) => { /* CanvasRenderingContext2D drawing */ };
2. SVG markup (icons, vector art): one <svg xmlns="http://www.w3.org/2000/svg" width="…" height="…"> element.
3. HTML + CSS (game UI): first line <!-- size: 512x256 -->, then <style> and markup; system fonts, images only as data: URLs.
Rules: no imports, no network, deterministic output (seeded random). Transparent background unless asked otherwise.
${REPLY_RULE}`,
};

const REFINE = `Below is code that meshcode generated from a GLB file. Rewrite it as clean, readable three.js code a game developer would enjoy editing: named constants for sizes and colours, helper functions for repeated parts, loops instead of copy-paste, a short comment per part.
Your code is checked automatically, so keep:
- the same meshes in the same scene order, with the same materials (type, colours, values, textures);
- the same shape: silhouettes from 6 directions must match (IoU ≥ ${MIN_IOU});
- every string like '@@BLOB3@@' exactly as written where it is used: each stands for a large base64 blob (vertex data or an image) that is put back after your reply;
- the module contract: export default (THREE) => Object3D, no imports.
${REPLY_RULE}`;

const EMPTY = { '3d': 'The model has no visible geometry (0 triangles).', '2d': 'The image is empty (every pixel is transparent).' };

const critiquePrompt = (/** @type {string} */ request, /** @type {'3d' | '2d'} */ mode) =>
  `${mode === '3d' ? 'These are renders of your model: front, right, top and three-quarter view.' : 'This is your image as rendered.'}
Compare them with the request: "${request}". If they already match it well, reply with just LGTM. Otherwise reply with the whole improved code (shape, proportions, colours, missing parts).`;

const fixPrompt = (/** @type {string} */ error) => `${error}\nFix it and reply with the whole corrected file in one code block.`;

/**
 * The code in a reply: the longest closed fenced block; while streaming, an unclosed fence; or a bare module/markup.
 * @param {string} text @returns {string | null}
 */
export function extractCode(text) {
  const blocks = [...text.matchAll(/```[\w+-]*[^\S\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length) return blocks.reduce((a, b) => (b.length > a.length ? b : a)).trimEnd() + '\n';
  const open = text.match(/```[\w+-]*[^\S\n]*\n([\s\S]*)$/);
  if (open) return open[1];
  return /^\s*(export\s|<)/.test(text) ? text.trim() + '\n' : null;
}

/** @param {LLM} llm @param {string} path @param {AbortSignal} [signal] @param {unknown} [body] */
async function request(llm, path, signal, body) {
  const base = (llm.baseURL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  /** @type {Response} */ let res;
  try {
    res = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      signal,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(llm.apiKey ? { authorization: `Bearer ${llm.apiKey}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(`cannot reach ${base} (${/** @type {Error} */ (err).message}). Is the server running? Ollama called from another site needs OLLAMA_ORIGINS.`);
  }
  if (!res.ok) throw new Error(`${base}${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

/** @param {Msg} m */
const toOpenAI = (m) => ({
  role: m.role,
  content: m.images?.length
    ? [{ type: 'text', text: m.text }, ...m.images.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }))]
    : m.text,
});

/**
 * One streamed completion. Returns the assistant message to append to the conversation.
 * @param {LLM} llm @param {string} system @param {Msg[]} messages @param {Hooks} [hooks]
 * @returns {Promise<Msg>}
 */
export async function chat(llm, system, messages, hooks = {}) {
  if (llm.provider === 'anthropic') return (await import('./llm-anthropic.js')).chat(llm, system, messages, hooks);
  const res = await request(llm, '/chat/completions', hooks.signal, {
    model: llm.model, stream: true, messages: [{ role: 'system', content: system }, ...messages.map(toOpenAI)],
  });
  if (res.headers.get('content-type')?.includes('application/json')) { // server ignored stream: true
    return { role: 'assistant', text: (await res.json()).choices?.[0]?.message?.content ?? '' };
  }
  let text = '', buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (res.body))) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      const json = JSON.parse(data);
      if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
      const delta = json.choices?.[0]?.delta?.content;
      if (!delta) continue;
      text += delta;
      hooks.onText?.(text);
    }
  }
  return { role: 'assistant', text };
}

/** Model ids the provider offers. @param {LLM} llm @returns {Promise<string[]>} */
export async function listModels(llm) {
  if (llm.provider === 'anthropic') return (await import('./llm-anthropic.js')).listModels(llm);
  const json = await (await request(llm, '/models')).json();
  return (json.data ?? []).map((/** @type {{ id: string }} */ m) => m.id).sort();
}

/**
 * Write new code from a description, or change `code`. Each candidate is run; failures go back to the
 * model (at most MAX_REPAIRS times). With `critique`, the first working result is rendered and shown to
 * the model once (vision models), which may approve it or revise it.
 * @param {Hooks & {
 *   llm: LLM, mode: '3d' | '2d', prompt: string, code?: string, critique?: boolean,
 *   run: (code: string) => Promise<{ error?: string, empty?: boolean }>,
 *   capture?: () => Promise<string[]>,
 * }} o
 * @returns {Promise<{ ok: boolean, code: string | null, error?: string, replies: number }>}
 */
export async function generate(o) {
  const ask = o.code ? `Current code:\n\`\`\`\n${o.code}\`\`\`\n\nChange it: ${o.prompt}` : o.prompt;
  /** @type {Msg[]} */ const messages = [{ role: 'user', text: ask }];
  /** @type {string | null} */ let good = null, last = null;
  let error = '', replies = 0, critiqued = !o.critique || !o.capture;
  while (replies < 1 + MAX_REPAIRS + (o.critique ? 1 : 0)) {
    o.onStatus?.(replies ? 'writing a fix…' : 'writing…');
    const reply = await chat(o.llm, SYSTEM[o.mode], messages, o);
    messages.push(reply);
    replies++;
    const candidate = extractCode(reply.text);
    if (!candidate) {
      if (good && /\bLGTM\b/.test(reply.text)) break; // critique approved the working version
      error = 'Your reply had no code block.';
    } else {
      last = candidate;
      o.onStatus?.('running…');
      const r = await o.run(candidate);
      error = r.error ?? (r.empty ? EMPTY[o.mode] : '');
      if (!error) {
        good = candidate;
        if (critiqued) break;
        critiqued = true;
        o.onStatus?.('critiquing the render…');
        messages.push({ role: 'user', text: critiquePrompt(o.prompt, o.mode), images: await /** @type {() => Promise<string[]>} */ (o.capture)() });
        continue;
      }
    }
    o.onStatus?.(`repair: ${error.split('\n')[0].slice(0, 120)}`);
    messages.push({ role: 'user', text: fixPrompt(error) });
  }
  return good ? { ok: true, code: good, replies } : { ok: false, code: last, error, replies };
}

/**
 * Rewrite decompiled code as readable code. Large base64 strings are swapped for placeholders before the
 * model sees them and restored after. A candidate is accepted only if `verify` finds the same silhouettes
 * (IoU ≥ MIN_IOU) and the same materials as the original GLB.
 * @param {Hooks & {
 *   llm: LLM, code: string, prompt?: string,
 *   verify: (code: string) => Promise<{ error?: string, mean?: number, materials?: string[] }>,
 * }} o
 * @returns {Promise<{ ok: boolean, code: string, mean?: number, error?: string, replies: number }>}
 */
export async function refine(o) {
  /** @type {string[]} */ const blobs = [];
  const short = o.code.replace(/(['"])([A-Za-z0-9+/]{120,}={0,2})\1/g, (_, q, b64) => `${q}@@BLOB${blobs.push(b64) - 1}@@${q}`);
  const restore = (/** @type {string} */ s) => s.replace(/@@BLOB(\d+)@@/g, (m, i) => blobs[Number(i)] ?? m);
  /** @type {Msg[]} */ const messages = [{ role: 'user', text: `${REFINE}${o.prompt ? `\nAlso: ${o.prompt}` : ''}\n\n\`\`\`js\n${short}\`\`\`` }];
  let error = '', replies = 0;
  while (replies < 1 + MAX_REPAIRS) {
    o.onStatus?.(replies ? 'writing a fix…' : 'writing…');
    const reply = await chat(o.llm, SYSTEM['3d'], messages, o);
    messages.push(reply);
    replies++;
    const candidate = extractCode(reply.text);
    const full = candidate && restore(candidate);
    const unknown = full?.match(/@@BLOB\d+@@/);
    if (!full) error = 'Your reply had no code block.';
    else if (unknown) error = `${unknown[0]} does not exist: use only the placeholders that appear in my code.`;
    else {
      o.onStatus?.('checking against the GLB…');
      const r = await o.verify(full);
      const mean = r.mean ?? 0, materials = r.materials ?? [];
      if (!r.error && mean >= MIN_IOU && !materials.length) return { ok: true, code: full, mean, replies };
      error = r.error ?? `Automatic check failed: silhouette IoU ${mean.toFixed(3)} (needs ≥ ${MIN_IOU})` +
        (materials.length ? `; materials differ: ${materials.slice(0, 8).join('; ')}` : '') + '.';
    }
    o.onStatus?.(`repair: ${error.split('\n')[0].slice(0, 120)}`);
    messages.push({ role: 'user', text: fixPrompt(error) });
  }
  return { ok: false, code: o.code, error, replies };
}
