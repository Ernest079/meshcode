// @ts-check
import './styles.css';
import { javascript } from '@codemirror/lang-javascript';
import { Compartment } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup, EditorView } from 'codemirror';
import walkCode from '../../examples/2d/adventurer-walk.js?raw';
import cobbleCode from '../../examples/2d/cobblestone-texture.js?raw';
import iconsCode from '../../examples/2d/item-icons.svg?raw';
import parallaxCode from '../../examples/2d/parallax-layers.js?raw';
import uiCode from '../../examples/2d/ui-kit.html?raw';
import barrelCode from '../../examples/barrel.js?raw';
import chestCode from '../../examples/chest.js?raw';
import dungeonCode from '../../examples/dungeon-kit.js?raw';
import forestCode from '../../examples/forest.js?raw';
import spaceshipCode from '../../examples/spaceship.js?raw';
import torchCode from '../../examples/torch.js?raw';
import { detectKind } from '../../src/core/image.js';

/** @typedef {'3d' | '2d'} Mode */
/** @type {Record<string, { mode: Mode, code: string }>} */
const EXAMPLES = {
  torch: { mode: '3d', code: torchCode },
  chest: { mode: '3d', code: chestCode },
  barrel: { mode: '3d', code: barrelCode },
  forest: { mode: '3d', code: forestCode },
  spaceship: { mode: '3d', code: spaceshipCode },
  dungeon: { mode: '3d', code: dungeonCode },
  walk: { mode: '2d', code: walkCode },
  cobble: { mode: '2d', code: cobbleCode },
  parallax: { mode: '2d', code: parallaxCode },
  icons: { mode: '2d', code: iconsCode },
  ui: { mode: '2d', code: uiCode },
};
/** @type {Record<Mode, string>} */
const DEFAULT_CODE = { '3d': torchCode, '2d': walkCode };
/** @type {Record<Mode, { value: string, label: string }[]>} */
const FORMATS = {
  '3d': [{ value: 'glb', label: 'GLB' }, { value: 'godot', label: 'Godot .gd' }, { value: 'unity', label: 'Unity .cs' }],
  '2d': [{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WebP' }],
};

const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
const viewer = /** @type {HTMLIFrameElement} */ ($('#viewer'));
const formatSelect = /** @type {HTMLSelectElement} */ ($('#format'));
const errorBox = $('#error');
const status = $('#status');
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;
/** @type {Mode} */
let mode = '3d';
let kind2d = ''; // last rendered 2D source kind: canvas | svg | html

/** Storage is a convenience only: blocked storage (private mode) must never break the app. */
const store = {
  get: (/** @type {string} */ k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (/** @type {string} */ k, /** @type {string} */ v) => { try { localStorage.setItem(k, v); } catch { /* not saved */ } },
  remove: (/** @type {string} */ k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ------------------------------------------------------------------ theme: system / light / dark

const THEME_KEY = 'meshcode:theme';
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const editorTheme = new Compartment();
const editorLanguage = new Compartment();
/** @type {'system' | 'light' | 'dark'} */
let themePref = /** @type {any} */ (['light', 'dark'].includes(store.get(THEME_KEY) ?? '') ? store.get(THEME_KEY) : 'system');
const isDark = () => themePref === 'dark' || (themePref === 'system' && systemDark.matches);

// ------------------------------------------------------------------ editor

let runTimer = 0;
let language = 'js';
const editor = new EditorView({
  parent: $('#editor'),
  extensions: [
    basicSetup,
    editorLanguage.of(javascript()),
    editorTheme.of([]), // set by applyTheme()
    EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      syncLanguage();
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
/** Highlight SVG/HTML markup as HTML, everything else as JavaScript. The HTML grammar (with CSS)
 * is loaded on first use, so 3D-only visitors never download it. */
async function syncLanguage() {
  const next = mode === '2d' && detectKind(getCode()) !== 'canvas' ? 'html' : 'js';
  if (next === language) return;
  language = next;
  const support = next === 'html' ? (await import('@codemirror/lang-html')).html() : javascript();
  if (language === next) editor.dispatch({ effects: editorLanguage.reconfigure(support) });
}

// One draft per mode; the pre-2D key is the 3D draft.
const draftKey = (/** @type {Mode} */ m) => `meshcode:draft:${m}`;
let draftEnabled = false; // the initial load (maybe a shared link) must not overwrite the visitor's draft
function saveDraft() {
  if (draftEnabled) store.set(draftKey(mode), getCode());
}
const loadDraft = (/** @type {Mode} */ m) => store.get(draftKey(m)) ?? (m === '3d' ? store.get('meshcode:draft') : null);

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

/** @param {Record<string, unknown>} msg @param {Transferable[]} [transfer] */
const post = (msg, transfer = []) => viewer.contentWindow?.postMessage(msg, '*', transfer);

function run() {
  if (!ready) return;
  status.textContent = 'running…';
  $('[data-stat="codeKB"]').textContent = kb(new Blob([getCode()]).size);
  post({ type: 'run', code: getCode(), mode });
}

/** @param {string | null} message */
function showError(message) {
  errorBox.hidden = !message;
  errorBox.textContent = message ?? '';
}

/** @param {BlobPart} data @param {string} filename @param {string} mime */
function download(data, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: mime }));
  a.download = filename.replace(/[^\w.-]+/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Export formats for the current mode (+ SVG when the 2D source is SVG markup). */
function syncFormats() {
  const options = [...FORMATS[mode], ...(mode === '2d' && kind2d === 'svg' ? [{ value: 'svg', label: 'SVG' }] : [])];
  const keep = formatSelect.value;
  formatSelect.replaceChildren(...options.map((o) => new Option(o.label, o.value)));
  if (options.some((o) => o.value === keep)) formatSelect.value = keep;
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
      post({ type: 'theme', dark: isDark() });
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
    case 'stats2d':
      kind2d = msg.kind;
      syncFormats();
      $('[data-stat="kind"]').textContent = msg.kind;
      $('[data-stat="size"]').textContent = `${msg.width}×${msg.height}`;
      $('[data-stat="frames"]').textContent = msg.frames > 1 ? `${msg.frames} → sheet ${msg.sheetWidth}×${msg.sheetHeight}` : '1';
      $('[data-stat="pngKB"]').textContent = kb(msg.pngBytes);
      break;
    case 'file':
      download(msg.buffer, String(msg.filename), String(msg.mime));
      status.textContent = msg.warnings?.length ? `exported with ${msg.warnings.length} warnings (see console)` : `exported ${msg.filename}`;
      for (const w of msg.warnings ?? []) console.warn(`meshcode: ${w}`);
      break;
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

function applyTheme() {
  const dark = isDark();
  document.documentElement.classList.toggle('dark', dark); // also set before first paint in index.html
  editor.dispatch({ effects: editorTheme.reconfigure(dark ? oneDark : []) });
  post({ type: 'theme', dark });
  /** @type {HTMLSelectElement} */ ($('#theme')).value = themePref;
}
systemDark.addEventListener('change', applyTheme);
$('#theme').addEventListener('change', (e) => {
  themePref = /** @type {any} */ (/** @type {HTMLSelectElement} */ (e.target).value);
  if (themePref === 'system') store.remove(THEME_KEY);
  else store.set(THEME_KEY, themePref);
  applyTheme();
});
applyTheme();
viewer.srcdoc = BOOT;

// ------------------------------------------------------------------ mode: 3D models / 2D images

/** Switch mode; with no code given, restore that mode's draft (or its default example). @param {Mode} next @param {string} [code] */
function setMode(next, code) {
  if (next !== mode) {
    mode = next;
    for (const el of document.querySelectorAll('[data-mode]')) /** @type {HTMLElement} */ (el).hidden = /** @type {HTMLElement} */ (el).dataset.mode !== mode;
    for (const m of /** @type {Mode[]} */ (['3d', '2d'])) $(`#mode-${m}`).setAttribute('aria-pressed', String(m === mode));
    syncFormats();
    $('#import-label').hidden = mode !== '3d';
    if (code === undefined) code = loadDraft(mode) ?? DEFAULT_CODE[mode];
  }
  if (code !== undefined) {
    const wasEnabled = draftEnabled;
    draftEnabled = false; // switching shows the other draft; don't copy it over this mode's
    setCode(code);
    draftEnabled = wasEnabled;
  }
  syncLanguage();
  clearTimeout(runTimer);
  run();
}
$('#mode-3d').addEventListener('click', () => setMode('3d'));
$('#mode-2d').addEventListener('click', () => setMode('2d'));

// ------------------------------------------------------------------ actions

/** @param {File | Blob & { name?: string }} file */
async function importGLB(file) {
  if (!ready) return;
  if (mode !== '3d') setMode('3d');
  status.textContent = 'decompiling…';
  const buffer = await file.arrayBuffer();
  post({ type: 'import', buffer, name: file.name ?? 'model.glb' }, [buffer]);
}

$('#run').addEventListener('click', run);
$('#export').addEventListener('click', () => {
  if (formatSelect.value === 'svg') download(getCode(), 'image.svg', 'image/svg+xml'); // the source IS the file
  else post({ type: 'export', format: formatSelect.value });
});
$('#import').addEventListener('change', (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  if (input.files?.[0]) importGLB(input.files[0]);
  input.value = '';
});
$('#examples').addEventListener('change', (e) => {
  const select = /** @type {HTMLSelectElement} */ (e.target);
  const example = EXAMPLES[select.value];
  if (example) setMode(example.mode, example.code);
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

// ------------------------------------------------------------------ share links: #mode=2d&code=<deflate-raw, base64url>

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
  const url = `${location.origin}${location.pathname}#mode=${mode}&code=${await encode(getCode())}`;
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

// ------------------------------------------------------------------ initial state: share link > draft > example

const params = new URLSearchParams(location.hash.slice(1));
const shared = params.get('code');
/** @type {Mode} */
const startMode = params.get('mode') === '2d' ? '2d' : '3d';
mode = startMode === '2d' ? '3d' : '2d'; // force setMode to apply every mode-dependent bit
setMode(startMode, shared ? await decode(shared).catch(() => DEFAULT_CODE[startMode]) : undefined);
draftEnabled = true;
