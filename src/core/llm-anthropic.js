// @ts-check
// Claude through the official Anthropic SDK. llm.js loads this file only when the provider is Anthropic,
// so nobody else downloads the SDK. Calling the API from the browser is deliberate here: the key is the
// user's own and never leaves their machine except to api.anthropic.com.
import Anthropic from '@anthropic-ai/sdk';

// Current models: they take the effort control and server-side refusal fallbacks ("default" routing).
const CURRENT = /^claude-(fable-5-[12]|mythos-5-[12]|opus-5(-5)?|sonnet-5-5)$/;

/** @param {import('./llm.js').LLM} llm */
const client = (llm) => new Anthropic({ apiKey: llm.apiKey || undefined, baseURL: llm.baseURL || undefined, dangerouslyAllowBrowser: true });

/** @param {import('./llm.js').Msg} m */
const toClaude = (m) => ({
  role: m.role,
  content: /** @type {any} */ (m.raw) ?? [
    ...(m.images ?? []).map((data) => ({ type: /** @type {const} */ ('image'), source: { type: /** @type {const} */ ('base64'), media_type: /** @type {const} */ ('image/png'), data } })),
    { type: /** @type {const} */ ('text'), text: m.text },
  ],
});

/**
 * @param {import('./llm.js').LLM} llm @param {string} system @param {import('./llm.js').Msg[]} messages @param {import('./llm.js').Hooks} hooks
 * @returns {Promise<import('./llm.js').Msg>}
 */
export async function chat(llm, system, messages, hooks) {
  const current = CURRENT.test(llm.model);
  const stream = client(llm).beta.messages.stream({
    model: llm.model,
    max_tokens: current ? 64000 : 16000,
    system,
    messages: messages.map(toClaude),
    ...(current ? { output_config: { effort: 'high' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  }, { signal: hooks.signal });
  let text = '';
  stream.on('text', (delta) => {
    text += delta;
    hooks.onText?.(text);
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') {
    throw new Error(`the model declined this request${msg.stop_details?.category ? ` (${msg.stop_details.category})` : ''}`);
  }
  // Echo the blocks back unchanged next turn (thinking included), except after a mid-answer fallback,
  // whose echo rules are stricter: then only the text goes back.
  const fellBack = msg.content.some((b) => /** @type {{ type: string }} */ (b).type === 'fallback');
  const final = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  return { role: 'assistant', text: final, raw: fellBack ? undefined : msg.content };
}

/** @param {import('./llm.js').LLM} llm @returns {Promise<string[]>} */
export async function listModels(llm) {
  const ids = [];
  for await (const m of client(llm).models.list()) ids.push(m.id);
  return ids;
}
