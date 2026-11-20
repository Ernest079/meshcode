// @ts-check
import './styles.css';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup, EditorView } from 'codemirror';
import cratesCode from '../../examples/crates.js?raw';
import torchCode from '../../examples/torch.js?raw';

/** @type {Record<string, string>} */
const EXAMPLES = { torch: torchCode, crates: cratesCode };
const DRAFT_KEY = 'meshcode:draft';

const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const viewer = /** @type {HTMLIFrameElement} */ ($('#viewer'));
const errorBox = $('#error');
const status = $('#status');
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;

// ------------------------------------------------------------------ editor

let runTimer = 0;
const editor = new EditorView({
  parent: $('#editor'),
  extensions: [
    basicSetup,
    javascript(),
    oneDark,
    EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      clearTimeout(runTimer);
      runTimer = window.setTimeout(run, 600); // live preview while typing
      saveDraft();
    }),
    EditorView.domEventHandlers({
      keydown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          run();
          return true;
        }
        return false;
      },
    }),
  ],
});
// Handle for devtools and the end-to-end test.
Object.assign(globalThis, { meshcodeEditor: editor });

const getCode = () => editor.state.doc.toString();
/** @param {string} code */
function setCode(code) {
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: code } });
}

let draftEnabled = false; // the initial load (maybe a shared link) must not overwrite the visitor's draft
function saveDraft() {
  if (!draftEnabled) return;
  try {
    localStorage.setItem(DRAFT_KEY, getCode());
  } catch {
    // storage blocked (private mode): drafts are a convenience only
  }
}
function loadDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ sandbox bridge
// The viewer frame is sandboxed (opaque origin): user code there cannot touch this page or its storage.
// It cannot fetch our modules either (CORS), so we post it the bundled runtime source to import as a blob.

const BOOT = `<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden"><script>
addEventListener('message', function boot(e) {
  if (e.source !== parent || !e.data || e.data.type !== 'boot') return;
  removeEventListener('message', boot);
  import(URL.createObjectURL(new Blob([e.data.source], { type: 'text/javascript' })))
    .catch((err) => parent.postMessage({ type: 'error', message: 'runtime: ' + err.message }, '*'));
});
parent.postMessage({ type: 'booting' }, '*');
<\/script>`;

const runtimeSource = fetch('./runtime.js').then((r) => {
  if (!r.ok) throw new Error(`runtime.js: HTTP ${r.status} (run "pnpm build:runtime")`);
  return r.text();
});
let ready = false;
let note = ''; // shown once the next run finishes (e.g. the import summary)
const dark = matchMedia('(prefers-color-scheme: dark)');

/** @param {Record<string, unknown>} msg @param {Transferable[]} [transfer] */
const post = (msg, transfer = []) => viewer.contentWindow?.postMessage(msg, '*', transfer);

function run() {
  if (!ready) return;
  status.textContent = 'running…';
  $('[data-stat="codeKB"]').textContent = kb(new Blob([getCode()]).size);
  post({ type: 'run', code: getCode() });
}

/** @param {string | null} message */
function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message ?? '';
}

window.addEventListener('message', async (event) => {
  if (event.source !== viewer.contentWindow) return; // only our frame
  const msg = event.data ?? {};
  switch (msg.type) {
    case 'booting':
      post({ type: 'boot', source: await runtimeSource.catch((e) => (showError(e.message), '')) });
      break;
    case 'ready':
      ready = true;
      post({ type: 'theme', dark: dark.matches });
      run();
      break;
    case 'ok':
      showError(null);
      status.textContent = note;
      note = '';
      break;
    case 'error':
      showError(String(msg.message));
      status.textContent = 'error';
      break;
    case 'stats':
      for (const key of ['meshes', 'instances', 'triangles']) $(`[data-stat="${key}"]`).textContent = Number(msg.stats[key]).toLocaleString('en');
      $('[data-stat="drawCalls"]').textContent = String(msg.drawCalls);
      $('[data-stat="glbKB"]').textContent = kb(msg.glbBytes);
      break;
    case 'glb': {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([msg.buffer], { type: 'model/gltf-binary' }));
      a.download = `${String(msg.name).replace(/[^\w.-]+/g, '_') || 'model'}.glb`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'decompiled': {
      const kinds = Object.entries(msg.summary).map(([k, v]) => `${k} ×${v}`).join(', ');
      note = `imported: ${kinds || 'no meshes'}${msg.warnings.length ? ` · ${msg.warnings.length} warnings` : ''}`;
      for (const w of msg.warnings) console.warn(`meshcode: ${w}`);
      setCode(String(msg.code));
      clearTimeout(runTimer); // run now, not after the typing debounce
      run();
      break;
    }
  }
});
dark.addEventListener('change', () => post({ type: 'theme', dark: dark.matches }));
viewer.srcdoc = BOOT;

// ------------------------------------------------------------------ actions

/** @param {File | Blob & { name?: string }} file */
async function importGLB(file) {
  if (!ready) return;
  status.textContent = 'decompiling…';
  const buffer = await file.arrayBuffer();
  post({ type: 'import', buffer, name: file.name ?? 'model.glb' }, [buffer]);
}

$('#run').addEventListener('click', run);
$('#export').addEventListener('click', () => post({ type: 'export' }));
$('#import').addEventListener('change', (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  if (input.files?.[0]) importGLB(input.files[0]);
  input.value = '';
});
$('#examples').addEventListener('change', (e) => {
  const select = /** @type {HTMLSelectElement} */ (e.target);
  if (EXAMPLES[select.value]) setCode(EXAMPLES[select.value]);
  select.value = '';
});

// Drag & drop a .glb anywhere. The iframe would swallow the drop, so it ignores the pointer while dragging.
document.addEventListener('dragenter', () => viewer.classList.add('pointer-events-none'));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  viewer.classList.remove('pointer-events-none');
  const file = e.dataTransfer?.files[0];
  if (file && /\.glb$/i.test(file.name)) importGLB(file);
});
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) viewer.classList.remove('pointer-events-none');
});

// ------------------------------------------------------------------ share links: #code=<deflate-raw, base64url>

/** @param {string} text */
async function encode(text) {
  const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** @param {string} b64url */
async function decode(b64url) {
  const bytes = Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}

$('#share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#code=${await encode(getCode())}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = 'link copied';
  } catch {
    status.textContent = 'link in the address bar';
  }
});

// ------------------------------------------------------------------ PWA

let installPrompt = /** @type {any} */ (null);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#install').hidden = false;
});
$('#install').addEventListener('click', async () => {
  await installPrompt?.prompt();
  installPrompt = null;
  $('#install').hidden = true;
});
// Opening a .glb with the installed app (manifest file_handlers).
if ('launchQueue' in window) {
  /** @type {any} */ (window).launchQueue.setConsumer(async (/** @type {any} */ params) => {
    for (const handle of params.files ?? []) importGLB(await handle.getFile());
  });
}
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

// ------------------------------------------------------------------ initial code: share link > draft > example

const shared = new URLSearchParams(location.hash.slice(1)).get('code');
setCode(shared ? await decode(shared).catch(() => torchCode) : loadDraft() ?? torchCode);
draftEnabled = true;
