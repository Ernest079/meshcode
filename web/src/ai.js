// @ts-check
// Optional AI panel: generate, edit and refine code with a local model or the user's own API key.
// Loaded on first open. Requests go from this page straight to the provider (meshcode has no server);
// the key stays in this page and never reaches the sandboxed frame that runs the code.
import { unifiedMergeView } from '@codemirror/merge';
import { DEFAULT_BASE_URL, DEFAULT_CLAUDE_MODEL, extractCode, generate, listModels, refine } from '../../src/core/llm.js';

const SETTINGS_KEY = 'meshcode:ai'; // provider, base URL, model, critique: not secret
const KEY_KEY = 'meshcode:ai-key';

/** Storage can be blocked (private mode, policies): the panel must work without it. @template T @param {() => T} fn */
const safe = (fn) => { try { return fn(); } catch { return null; } };
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

/**
 * @param {{
 *   editor: import('codemirror').EditorView, review: import('@codemirror/state').Compartment, status: HTMLElement,
 *   getCode: () => string, setCode: (code: string) => void, run: () => void, saveDraft: () => void,
 *   request: (msg: Record<string, unknown>) => Promise<any>, mode: () => '3d' | '2d', imported: () => boolean,
 *   setBusy: (busy: boolean) => void, notify: (text: string) => void, onReplace?: () => void,
 * }} app
 */
export function setupAI(app) {
  const [provider, baseURL, key, remember, model, critique, prompt] =
    ['ai-provider', 'ai-base-url', 'ai-key', 'ai-remember', 'ai-model', 'ai-critique', 'ai-prompt'].map($);
  const dialog = /** @type {HTMLDialogElement} */ ($('ai-settings'));
  const settingsStatus = $('ai-settings-status');

  // ---------------------------------------------------------------- settings
  const saved = safe(() => JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')) ?? {};
  provider.value = saved.provider === 'anthropic' ? 'anthropic' : 'openai';
  baseURL.value = saved.baseURL ?? '';
  model.value = saved.model ?? '';
  critique.checked = !!saved.critique;
  const rememberedKey = safe(() => localStorage.getItem(KEY_KEY));
  key.value = safe(() => sessionStorage.getItem(KEY_KEY)) ?? rememberedKey ?? '';
  remember.checked = !!rememberedKey;
  baseURL.placeholder = DEFAULT_BASE_URL;
  $('ai-ollama-hint').textContent = `OLLAMA_ORIGINS=${location.origin} ollama serve`;

  function syncProvider() {
    const anthropic = provider.value === 'anthropic';
    for (const el of document.querySelectorAll('[data-provider]')) /** @type {HTMLElement} */ (el).hidden = /** @type {HTMLElement} */ (el).dataset.provider !== provider.value;
    model.placeholder = anthropic ? DEFAULT_CLAUDE_MODEL : 'e.g. qwen2.5-coder:14b — Load list';
    key.placeholder = anthropic ? 'sk-ant-…' : 'not needed for local servers';
  }
  function save() {
    safe(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify({ provider: provider.value, baseURL: baseURL.value, model: model.value, critique: critique.checked })));
    // The key lives in this tab only, unless the user opts in to remembering it.
    safe(() => sessionStorage.setItem(KEY_KEY, key.value));
    safe(() => (remember.checked && key.value ? localStorage.setItem(KEY_KEY, key.value) : localStorage.removeItem(KEY_KEY)));
    syncProvider();
  }
  for (const el of [provider, baseURL, key, remember, model, critique]) el.addEventListener('change', save);
  provider.addEventListener('change', () => { // another provider's model ids do not apply
    model.value = '';
    $('ai-models').replaceChildren();
    save();
  });
  syncProvider();

  /** @returns {import('../../src/core/llm.js').LLM} */
  const config = () => {
    const anthropic = provider.value === 'anthropic';
    return {
      provider: anthropic ? 'anthropic' : 'openai',
      apiKey: key.value.trim() || undefined,
      baseURL: anthropic ? undefined : baseURL.value.trim() || DEFAULT_BASE_URL,
      model: model.value.trim() || (anthropic ? DEFAULT_CLAUDE_MODEL : ''),
    };
  };
  const problem = (/** @type {import('../../src/core/llm.js').LLM} */ llm) =>
    llm.provider === 'anthropic' && !llm.apiKey ? 'Claude needs an API key (console.anthropic.com).' : !llm.model ? 'Choose a model (Load list).' : '';

  $('ai-settings-open').addEventListener('click', () => dialog.showModal());
  $('ai-load-models').addEventListener('click', async () => {
    const llm = config();
    if (llm.provider === 'anthropic' && !llm.apiKey) return void (settingsStatus.textContent = problem(llm));
    settingsStatus.textContent = 'loading…';
    try {
      const ids = await listModels(llm);
      $('ai-models').replaceChildren(...ids.map((id) => new Option(id, id)));
      if (!model.value && ids[0]) model.value = ids[0];
      save();
      settingsStatus.textContent = `${ids.length} ${ids.length === 1 ? 'model' : 'models'}: pick one in the Model field.`;
    } catch (err) {
      settingsStatus.textContent = /** @type {Error} */ (err).message;
    }
  });

  // ---------------------------------------------------------------- review: accept or reject the AI's change
  /** @type {string | null} */ let before = null;
  /** @param {string} original @param {boolean} diff */
  function startReview(original, diff) {
    before = original;
    if (diff) app.editor.dispatch({ effects: app.review.reconfigure(unifiedMergeView({ original })) });
    $('ai-review').hidden = false;
  }
  /** @param {boolean} accept */
  function endReview(accept) {
    if (before === null) return;
    app.editor.dispatch({ effects: app.review.reconfigure([]) });
    $('ai-review').hidden = true;
    if (!accept) app.setCode(before);
    before = null;
    app.saveDraft();
  }
  $('ai-accept').addEventListener('click', () => endReview(true));
  $('ai-reject').addEventListener('click', () => endReview(false));
  app.onReplace = () => endReview(true); // an example or import replaces the code: the review is over

  // ---------------------------------------------------------------- actions
  /** @type {AbortController | null} */ let controller = null;
  const setUIBusy = (/** @type {boolean} */ busy) => {
    for (const id of ['ai-generate', 'ai-edit', 'ai-refine']) $(id).disabled = busy;
    $('ai-stop').hidden = !busy;
  };
  $('ai-stop').addEventListener('click', () => controller?.abort());

  /** @param {'generate' | 'edit' | 'refine'} kind */
  async function act(kind) {
    if (controller) return;
    const llm = config(), mode = app.mode(), ask = prompt.value.trim();
    const blocker = problem(llm) ||
      (kind === 'refine' && !app.imported() ? 'Import a GLB first: Refine rewrites it as readable code.' : '') ||
      (kind !== 'refine' && !ask ? 'Describe what you want first.' : '');
    if (blocker) {
      app.status.textContent = blocker;
      if (problem(llm)) dialog.showModal();
      return;
    }
    endReview(true);
    const original = app.getCode();
    controller = new AbortController();
    setUIBusy(true);
    app.setBusy(true);
    let frame = 0, latest = '';
    const flush = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const hooks = {
      llm, signal: controller.signal,
      onStatus: (/** @type {string} */ s) => (app.status.textContent = `AI: ${s}`),
      /** Stream the code into the editor (refine: only a line count, its code holds placeholders). @param {string} text */
      onText: (text) => {
        if (kind === 'refine') return void (app.status.textContent = `AI: writing… ${text.split('\n').length} lines`);
        latest = extractCode(text) ?? '';
        if (latest && !frame) frame = requestAnimationFrame(() => { frame = 0; app.setCode(latest); });
      },
    };
    let message = '';
    try {
      const r = kind === 'refine'
        ? await refine({
          ...hooks, code: original, prompt: ask,
          verify: async (code) => { const m = await app.request({ type: 'verify', code }); return m.type === 'error' ? { error: m.message } : m; },
        })
        : await generate({
          ...hooks, mode, prompt: ask, code: kind === 'edit' ? original : undefined, critique: critique.checked,
          run: async (code) => {
            flush();
            app.setCode(code);
            const m = await app.request({ type: 'run', code, mode });
            return m.type === 'error' ? { error: m.message } : { empty: m.empty };
          },
          capture: async () => (await app.request({ type: 'capture' })).images ?? [],
        });
      flush();
      const replies = `${r.replies} ${r.replies === 1 ? 'reply' : 'replies'}`;
      if (!r.code || r.code === original) {
        app.setCode(original);
        message = r.ok ? 'AI: no changes' : `AI: ${kind === 'refine' ? 'no rewrite passed the check' : 'gave up'} after ${replies} — ${r.error}`;
      } else {
        app.setCode(r.code);
        startReview(original, kind !== 'generate');
        const fidelity = 'mean' in r && r.mean ? ` · silhouette IoU ${r.mean.toFixed(3)}, materials identical` : '';
        message = r.ok ? `AI: done in ${replies}${fidelity}. Accept or reject.` : `AI: still failing after ${replies}: ${r.error}`;
      }
    } catch (err) {
      flush();
      app.setCode(original);
      message = controller.signal.aborted ? 'AI: stopped' : `AI error: ${/** @type {Error} */ (err).message}`;
    } finally {
      controller = null;
      app.setBusy(false);
      setUIBusy(false);
      app.notify(message);
      app.run();
    }
  }
  $('ai-panel').addEventListener('submit', (/** @type {Event} */ e) => {
    e.preventDefault();
    act('generate');
  });
  $('ai-edit').addEventListener('click', () => act('edit'));
  $('ai-refine').addEventListener('click', () => act('refine'));
}
