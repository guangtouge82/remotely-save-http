import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { findNarrowRange } from "./listSubtree";

export const setNarrowAnchor = StateEffect.define<number | null>();

interface NarrowState {
  anchor: number | null;
  decorations: DecorationSet;
}

function buildNarrowState(state: EditorState, anchor: number | null): NarrowState {
  if (anchor === null) return { anchor: null, decorations: Decoration.none };
  const doc = state.doc;
  const firstLine = doc.lineAt(Math.min(anchor, doc.length)).number - 1;
  const subtree = findNarrowRange(doc.lines, (line) => doc.line(line + 1).text, firstLine);
  if (!subtree) return { anchor: null, decorations: Decoration.none };
  const from = doc.line(subtree.firstLine + 1).from;
  const to = doc.line(subtree.lastLine + 1).to;
  const decorations = [];
  if (from > 0) decorations.push(Decoration.replace({ block: true }).range(0, from));
  if (to < doc.length) decorations.push(Decoration.replace({ block: true }).range(to, doc.length));
  return { anchor: from, decorations: Decoration.set(decorations, true) };
}

export const narrowModeField = StateField.define<NarrowState>({
  create() {
    return { anchor: null, decorations: Decoration.none };
  },
  update(value, transaction) {
    let anchor = value.anchor;
    if (anchor !== null && transaction.docChanged) anchor = transaction.changes.mapPos(anchor, 1);
    for (const effect of transaction.effects) {
      if (effect.is(setNarrowAnchor)) anchor = effect.value;
    }
    if (anchor === null && value.anchor === null) return value;
    return buildNarrowState(transaction.state, anchor);
  },
  provide(field) {
    return [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
    ];
  },
});

export function narrowAnchor(view: EditorView): number | null {
  return view.state.field(narrowModeField, false)?.anchor ?? null;
}

/** Reveal the original note and return the focused node to the editor's center. */
export function exitNarrowMode(view: EditorView): boolean {
  const anchor = narrowAnchor(view);
  if (anchor === null) return false;
  view.dispatch({ effects: setNarrowAnchor.of(null) });
  view.focus();
  requestAnimationFrame(() => {
    if (view.dom.isConnected && view.state.doc.length >= anchor) {
      view.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
    }
  });
  return true;
}

export const narrowExitButton = ViewPlugin.fromClass(class {
  private readonly button: HTMLButtonElement;

  constructor(private readonly view: EditorView) {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "rsh-narrow-exit";
    this.button.textContent = "退出聚焦";
    this.button.setAttribute("aria-label", "退出聚焦编辑");
    this.button.addEventListener("mousedown", (event) => event.preventDefault());
    this.button.addEventListener("click", () => {
      exitNarrowMode(this.view);
    });
    this.view.dom.appendChild(this.button);
    this.refresh();
  }

  update(_update: ViewUpdate) {
    this.refresh();
  }

  destroy() {
    this.view.dom.classList.remove("rsh-narrow-active");
    this.button.remove();
  }

  private refresh() {
    const active = narrowAnchor(this.view) !== null;
    this.button.hidden = !active;
    this.view.dom.classList.toggle("rsh-narrow-active", active);
  }
});
