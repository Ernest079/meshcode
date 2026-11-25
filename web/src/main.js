// @ts-check
import './styles.css';
import { javascript } from '@codemirror/lang-javascript';
import { Compartment } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup, EditorView } from 'codemirror';
import walkCode from '../../examples/2d/adventurer-walk.js?raw';
import slimeCode from '../../examples/2d/bouncy-slime-rig.js?raw';
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
import { setupPick } from './pick.js';

/** @typedef {'3d' | '2d'} Mode */
/** @type {Record<string, { mode: Mode, code: string }>} */
const EXAMPLES = {
  torch: { mode: '3d', code: torchCode },
  chest: { mode: '3d', code: chestCode },
  barrel: { mode: '3d', code: barrelCode },
  forest: { mode: '3d', code: forestCode },
  spaceship: { mode: '3d', code: spaceshipCode },
  dungeon: { mode: '3d', code: dungeonCode },
  slime: { mode: '2d', code: slimeCode },
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
const clipSelect2d = /** @type {HTMLSelectElement} */ ($('#clip-2d'));
const playBtn2d = /** @type {HTMLButtonElement} */ ($('#play-2d'));
const smoothBtn2d = /** @type {HTMLButtonElement} */ ($('#smooth-2d'));
const sheetBtn2d = /** @type {HTMLButtonElement} */ ($('#sheet-2d'));
const errorBox = $('#error');
const status = $('#status');
const kb = (/** @type {number} */ n) => `${(n / 1024).toFixed(1)} KB`;
/** @type {Mode} */
let mode = '3d';
let kind2d = ''; // last rendered 2D source kind: canvas | svg | html
/** @type {'auto' | 'smooth' | 'crisp'} */
let smooth2d = 'auto';
let playing2d = true;
let sheetView2d = false;
let imported = false; // the frame holds an imported GLB (reference for AI refine)

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
const editorReview = new Compartment(); // AI: diff against the code before the change
/** @type {'system' | 'light' | 'dark'} */
let themePref = /** @type {any} */ (['light', 'dark'].includes(store.get(THEME_KEY) ?? '') ? store.get(THEME_KEY) : 'system');
const isDark = () => themePref === 'dark' || (themePref === 'system' && systemDark.matches);

// ------------------------------------------------------------------ editor

// Viewer ↔ code: clicking a mesh selects its code; the cursor's block is outlined in the viewer.
const pick = setupPick({ post: (msg) => post(msg), status, active: () => mode === '3d' });

let runTimer = 0;
let language = 'js';
let aiBusy = false; // the AI is streaming code into the editor: no live runs, no draft saves
const editor = new EditorView({
  parent: $('#editor'),
  extensions: [
    basicSetup,
    editorLanguage.of(javascript()),
    editorTheme.of([]), // set by applyTheme()
    editorReview.of([]),
    pick.extension,
    EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged || aiBusy) return;
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
const post = (msg, transfer = []) => {
  if (msg.type === 'run') pick.posted(editor.state.doc.length); // runs always carry the editor's code
  viewer.contentWindow?.postMessage(msg, '*', transfer);
};

/** Post a message and wait for the frame's reply with the same id (used by the AI loops). */
let nextId = 1;
/** @type {Map<number, (msg: any) => void>} */
const pending = new Map();
/** @param {Record<string, unknown>} msg @returns {Promise<any>} */
const request = (msg) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  post({ ...msg, id });
});

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
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
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
      if (mode === '3d') pick.shown();
      showError(null);
      status.textContent = note;
      note = '';
      break;
    case 'error':
      showError(String(msg.message));
      status.textContent = 'error';
      break;
    case 'picked':
      pick.picked(editor, msg);
      break;
    case 'stats':
      for (const key of ['meshes', 'instances', 'triangles']) $(`[data-stat="${key}"]`).textContent = Number(msg.stats[key]).toLocaleString('en');
      $('[data-stat="drawCalls"]').textContent = String(msg.drawCalls);
      $('[data-stat="glbKB"]').textContent = kb(msg.glbBytes);
      break;
    case 'stats2d': {
      kind2d = msg.kind;
      syncFormats();
      $('[data-stat="kind"]').textContent = msg.kind;
      $('[data-stat="size"]').textContent = `${msg.width}×${msg.height}`;
      $('[data-stat="frames"]').textContent = msg.frames > 1 ? `${msg.frames} → sheet ${msg.sheetWidth}×${msg.sheetHeight}` : '1';
      $('[data-stat="pngKB"]').textContent = msg.pngBytes != null ? kb(msg.pngBytes) : '–';
      const clips = /** @type {string[]} */ (msg.clips ?? []);
      clipSelect2d.hidden = clips.length < 2;
      if (clips.length >= 2) {
        clipSelect2d.replaceChildren(...clips.map((c) => new Option(c, c)));
        if (msg.clip) clipSelect2d.value = msg.clip;
      }
      const animated = msg.kind === 'canvas' && (msg.frames > 1 || msg.duration > 0);
      playBtn2d.hidden = !animated;
      sheetBtn2d.hidden = msg.frames < 2;
      syncView2d(msg);
      break;
    }
    case 'view2d':
      syncView2d(msg);
      break;
    case 'file':
      download(msg.buffer, String(msg.filename), String(msg.mime));
      status.textContent = msg.warnings?.length ? `exported with ${msg.warnings.length} warnings (see console)` : `exported ${msg.filename}`;
      for (const w of msg.warnings ?? []) console.warn(`meshcode: ${w}`);
      break;
    case 'decompiled': {
      const kinds = Object.entries(msg.summary).map(([k, v]) => `${k} ×${v}`).join(', ');
      note = `imported: ${kinds || 'no meshes'}${msg.warnings.length ? ` · ${msg.warnings.length} warnings` : ''}`;
      imported = true;
      for (const w of msg.warnings) console.warn(`meshcode: ${w}`);
      app.onReplace?.();
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
    app.onReplace?.();
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

/** @param {{ smoothMode?: 'auto' | 'smooth' | 'crisp', playing?: boolean, sheetView?: boolean }} state */
function syncView2d(state) {
  if (state.smoothMode) smooth2d = state.smoothMode;
  if (state.playing !== undefined) playing2d = state.playing;
  if (state.sheetView !== undefined) sheetView2d = state.sheetView;
  smoothBtn2d.textContent = { auto: 'Auto', smooth: 'Smooth', crisp: 'Crisp' }[smooth2d];
  playBtn2d.textContent = playing2d ? 'Pause' : 'Play';
  sheetBtn2d.textContent = sheetView2d ? 'Anim' : 'Sheet';
}

clipSelect2d.addEventListener('change', () => post({ type: 'setClip', clip: clipSelect2d.value }));
playBtn2d.addEventListener('click', () => post({ type: 'setPlaying', playing: !playing2d }));
smoothBtn2d.addEventListener('click', () => post({ type: 'setSmooth', mode: smooth2d === 'smooth' ? 'crisp' : 'smooth' }));
sheetBtn2d.addEventListener('click', () => post({ type: 'setSheetView', sheet: !sheetView2d }));

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
  if (example) {
    imported = false;
    setMode(example.mode, example.code);
  }
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

// ------------------------------------------------------------------ layout: code panel on any side, resizable

/** @typedef {'left' | 'right' | 'top' | 'bottom'} Side */
/** @type {Record<Side, Side>} */
const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const LAYOUT_KEY = 'meshcode:layout';
const SPLIT_KEY = 'meshcode:split';
const workspace = $('#workspace');
const codePanel = $('#code-panel');
const splitter = $('#splitter');
const layoutSelect = /** @type {HTMLSelectElement} */ ($('#layout'));
const dockHint = $('#dock-hint');
const codeSide = () => /** @type {Side} */ (workspace.dataset.code);

/** @param {Side} side */
function setLayout(side) {
  workspace.dataset.code = side;
  layoutSelect.value = side;
  splitter.setAttribute('aria-orientation', side === 'left' || side === 'right' ? 'vertical' : 'horizontal');
  store.set(LAYOUT_KEY, side);
}
let split = 0.5; // share of the workspace taken by the code panel
/** @param {number} f */
function setSplit(f) {
  split = Math.min(0.85, Math.max(0.15, f));
  codePanel.style.flexBasis = `${split * 100}%`;
  splitter.setAttribute('aria-valuenow', String(Math.round(split * 100)));
}
const savedSide = store.get(LAYOUT_KEY);
setLayout(savedSide && savedSide in OPPOSITE ? /** @type {Side} */ (savedSide) : matchMedia('(min-width: 48rem)').matches ? 'left' : 'top');
setSplit(Number(store.get(SPLIT_KEY)) || 0.5);
layoutSelect.addEventListener('change', () => setLayout(/** @type {Side} */ (layoutSelect.value)));

// Splitter: drag with mouse/touch, or arrow keys when focused. The frame would swallow the pointer, so it ignores it meanwhile.
splitter.addEventListener('pointerdown', (e) => {
  splitter.setPointerCapture(e.pointerId);
  viewer.classList.add('pointer-events-none');
});
splitter.addEventListener('pointermove', (e) => {
  if (!splitter.hasPointerCapture(e.pointerId)) return;
  const r = workspace.getBoundingClientRect();
  const x = e.clientX, y = e.clientY;
  setSplit({ left: (x - r.left) / r.width, right: (r.right - x) / r.width, top: (y - r.top) / r.height, bottom: (r.bottom - y) / r.height }[codeSide()]);
});
splitter.addEventListener('lostpointercapture', () => {
  viewer.classList.remove('pointer-events-none');
  store.set(SPLIT_KEY, String(split));
});
splitter.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 }[e.key];
  if (!step) return;
  e.preventDefault();
  setSplit(split + (codeSide() === 'right' || codeSide() === 'bottom' ? -step : step)); // the divider follows the arrow
  store.set(SPLIT_KEY, String(split));
});

// Drag a panel's title onto the workspace: the half nearest the pointer is where that panel goes.
let draggedPanel = ''; // 'code' | 'preview' while a title is dragged
/** @param {DragEvent} e @returns {Side} */
function sideAt(e) {
  const r = workspace.getBoundingClientRect();
  const dx = (e.clientX - r.left) / r.width - 0.5, dy = (e.clientY - r.top) / r.height - 0.5;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom';
}
const HINT_INSET = { left: '0 50% 0 0', right: '0 0 0 50%', top: '0 0 50% 0', bottom: '50% 0 0 0' };
for (const grip of document.querySelectorAll('[data-panel]')) {
  grip.addEventListener('dragstart', (e) => {
    draggedPanel = /** @type {HTMLElement} */ (grip).dataset.panel ?? '';
    /** @type {DragEvent} */ (e).dataTransfer?.setData('application/x-meshcode-panel', draggedPanel); // Firefox needs data to start a drag; not text, or the editor would paste it
  });
  grip.addEventListener('dragend', () => {
    draggedPanel = '';
    dockHint.hidden = true;
    viewer.classList.remove('pointer-events-none');
  });
}
workspace.addEventListener('dragover', (e) => {
  if (!draggedPanel) return;
  dockHint.style.inset = HINT_INSET[sideAt(e)];
  dockHint.hidden = false;
});
workspace.addEventListener('dragleave', (e) => {
  if (!workspace.contains(/** @type {Node | null} */ (e.relatedTarget))) dockHint.hidden = true;
});
workspace.addEventListener('drop', (e) => {
  if (!draggedPanel) return;
  const side = sideAt(e);
  setLayout(draggedPanel === 'code' ? side : OPPOSITE[side]);
});

// ------------------------------------------------------------------ optional AI (web/src/ai.js, loaded on first open)

/** What ai.js may touch. */
const app = {
  editor, getCode, request, status,
  mode: () => mode,
  imported: () => imported,
  /** @param {boolean} busy */
  setBusy(busy) {
    aiBusy = busy;
    if (!busy) syncLanguage();
  },
  /** @param {string} code */
  setCode,
  run() {
    clearTimeout(runTimer);
    run();
  },
  saveDraft,
  review: editorReview,
  /** Status text to show once the next run finishes. @param {string} text */
  notify(text) {
    note = text;
  },
  /** Set by ai.js: called when an example or an import replaces the code. @type {(() => void) | undefined} */
  onReplace: undefined,
};
let aiLoaded = /** @type {Promise<unknown> | null} */ (null);
$('#ai-toggle').addEventListener('click', async () => {
  const panel = $('#ai-panel');
  panel.hidden = !panel.hidden;
  $('#ai-toggle').setAttribute('aria-expanded', String(!panel.hidden));
  aiLoaded ??= import('./ai.js').then((m) => m.setupAI(app));
  await aiLoaded;
  if (!panel.hidden) $('#ai-prompt').focus();
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

// Embedded in another site (itch.io): the host does not pass its URL's #hash or ?query on to this frame, so a share
// link must point at this frame's own URL, and the visible address bar is the host's, not ours.
const embedded = window.top !== window;
$('#share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#mode=${mode}&code=${await encode(getCode())}`;
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = embedded ? 'link copied (it opens meshcode on its own page)' : 'link copied';
  } catch {
    if (!embedded) {
      status.textContent = 'link in the address bar';
      return;
    }
    const input = /** @type {HTMLInputElement} */ ($('#share-url'));
    input.value = url;
    /** @type {HTMLDialogElement} */ ($('#share-dialog')).showModal();
    input.select();
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
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

// ------------------------------------------------------------------ initial state: share link > draft > example

const params = new URLSearchParams(location.hash.slice(1));
const shared = params.get('code');
/** @type {Mode} */
const startMode = params.get('mode') === '2d' ? '2d' : '3d';
mode = startMode === '2d' ? '3d' : '2d'; // force setMode to apply every mode-dependent bit
setMode(startMode, shared ? await decode(shared).catch(() => DEFAULT_CODE[startMode]) : undefined);
draftEnabled = true;
