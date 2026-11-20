// @ts-check
// Viewer ↔ code. Click a mesh in the viewer: the code block that created it is selected. Put the cursor
// in a block: the meshes it creates are outlined in the viewer. The frame reports offsets in the code it
// last ran successfully; edits made since then are mapped through CodeMirror change sets.
import { ensureSyntaxTree } from '@codemirror/language';
import { ChangeSet, EditorSelection } from '@codemirror/state';
import { EditorView } from 'codemirror';

const DECLARATION = /^(?:const|let|var)\s+([\w$]+)\s*=/;
// `v.prop = …` or `v.prop.x…`: configures v (unlike `v.add(…)`, which only uses it).
const CONFIG = /^([\w$]+)\.[\w$]+(?:\s*=(?!=)|\s*\.)/;

/**
 * The block of code around `pos`: its innermost statement, widened from `const v = …` over the following
 * statements that configure v (`v.name = …`, `v.position.set(…)`). From such a statement, back to `const v`.
 * @param {import('@codemirror/state').EditorState} state @param {number} pos
 */
export function blockAt(state, pos) {
  const line = state.doc.lineAt(pos);
  let node = ensureSyntaxTree(state, state.doc.length, 200)?.resolveInner(pos, 1);
  while (node?.parent && node.parent.name !== 'Block' && node.parent.name !== 'Script') node = node.parent;
  if (!node?.parent) return { from: line.from, to: line.to }; // no syntax tree in time: the line
  const text = (/** @type {import('@lezer/common').SyntaxNode} */ n) => state.sliceDoc(n.from, n.to);
  const isStatement = (/** @type {import('@lezer/common').SyntaxNode | null} */ n) => !!n && n.name !== '{' && n.name !== '}' && !n.name.endsWith('Comment');
  let first = node, last = node;
  let name = DECLARATION.exec(text(node))?.[1];
  if (!name && (name = CONFIG.exec(text(node))?.[1])) {
    for (let p = node.prevSibling; isStatement(p); p = p.prevSibling) {
      const s = /** @type {import('@lezer/common').SyntaxNode} */ (p);
      if (DECLARATION.exec(text(s))?.[1] === name) { first = s; break; }
      if (CONFIG.exec(text(s))?.[1] !== name) break;
      first = s;
    }
  }
  if (name) {
    for (let n = last.nextSibling; isStatement(n) && CONFIG.exec(text(/** @type {any} */ (n)))?.[1] === name; n = /** @type {any} */ (n).nextSibling) last = /** @type {any} */ (n);
  }
  return { from: first.from, to: last.to };
}

/**
 * @param {{ post: (msg: Record<string, unknown>) => void, status: HTMLElement, active: () => boolean }} o
 */
export function setupPick({ post, status, active }) {
  /** @type {ChangeSet | null} */ let sincePost = null; // edits since the last run was posted
  /** @type {ChangeSet | null} */ let sinceShown = null; // edits since the code the viewer shows

  const extension = EditorView.updateListener.of((u) => {
    if (u.docChanged) {
      sincePost = sincePost?.compose(u.changes) ?? null;
      sinceShown = sinceShown?.compose(u.changes) ?? null;
      return;
    }
    // Cursor moved by the user (not by a pick): outline what that block creates.
    if (!u.selectionSet || !sinceShown || !active() || !u.transactions.some((tr) => tr.isUserEvent('select'))) return;
    const b = blockAt(u.state, u.state.selection.main.head);
    const back = sinceShown.invertedDesc;
    post({ type: 'highlight', from: back.mapPos(b.from), to: back.mapPos(b.to) });
  });

  return {
    extension,
    /** A run was posted with the editor's current code. @param {number} length */
    posted(length) {
      sincePost = ChangeSet.empty(length);
    },
    /** That run succeeded: the viewer now shows it. */
    shown() {
      sinceShown = sincePost;
    },
    /** The viewer reports a click. @param {EditorView} view @param {{ at: number | null, name?: string, instance?: number | null }} msg */
    picked(view, msg) {
      if (msg.at == null || !sinceShown) return void (status.textContent = '');
      const b = blockAt(view.state, sinceShown.mapPos(Math.min(msg.at, sinceShown.length)));
      view.dispatch({ selection: EditorSelection.single(b.from, b.to), effects: EditorView.scrollIntoView(b.from, { y: 'center' }) });
      const what = `${msg.name || 'mesh'}${msg.instance != null ? ` (instance ${msg.instance})` : ''}`;
      status.textContent = `${what} → line ${view.state.doc.lineAt(b.from).number}`;
    },
  };
}
