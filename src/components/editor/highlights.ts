// Editor decorations for the passage mark (?quote=) and the sentence being read aloud.
// Decorations never change the note, so they don't trigger autosave.
import { Extension } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type Range = { from: number; to: number };
type Meta = { passage?: Range | null; speaking?: Range | null };
type PluginState = { passage: Range | null; speaking: Range | null; set: DecorationSet };

export const highlightKey = new PluginKey<PluginState>("studynestHighlights");

function build(doc: PMNode, s: Omit<PluginState, "set">): DecorationSet {
  const decos: Decoration[] = [];
  if (s.passage) decos.push(Decoration.inline(s.passage.from, s.passage.to, { class: "mark mark-fade", "data-testid": "passage-mark" }));
  if (s.speaking) decos.push(Decoration.inline(s.speaking.from, s.speaking.to, { class: "mark", "data-testid": "speaking-mark" }));
  return DecorationSet.create(doc, decos);
}

export const Highlights = Extension.create({
  name: "studynestHighlights",
  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: highlightKey,
        state: {
          init: () => ({ passage: null, speaking: null, set: DecorationSet.empty }),
          apply(tr, prev, _old, state) {
            const meta = tr.getMeta(highlightKey) as Meta | undefined;
            const map = (r: Range | null) => (r && tr.docChanged ? { from: tr.mapping.map(r.from), to: tr.mapping.map(r.to) } : r);
            const next = {
              passage: meta && "passage" in meta ? meta.passage ?? null : map(prev.passage),
              speaking: meta && "speaking" in meta ? meta.speaking ?? null : map(prev.speaking),
            };
            if (!meta && !tr.docChanged) return prev;
            return { ...next, set: build(state.doc, next) };
          },
        },
        props: { decorations: (state) => highlightKey.getState(state)?.set },
      }),
    ];
  },
});

export type FlatText = { text: string; toPos: (index: number) => number; skippedCode: boolean };

/**
 * The note as plain text (blocks separated by "\n") with a map from text offsets back to
 * document positions. With `skipCode`, code blocks are left out (read-aloud skips them).
 */
export function flatten(doc: PMNode, skipCode = false): FlatText {
  let text = "";
  const pieces: { start: number; pos: number; len: number }[] = [];
  let skippedCode = false;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (skipCode && node.type.name === "codeBlock") { skippedCode = true; return false; }
      if (text.length) text += "\n";
      node.forEach((child, offset) => {
        if (child.isText && child.text) {
          pieces.push({ start: text.length, pos: pos + 1 + offset, len: child.text.length });
          text += child.text;
        }
      });
      return false;
    }
    return true;
  });
  const toPos = (i: number) => {
    let best = pieces[0];
    for (const p of pieces) { if (p.start <= i) best = p; else break; }
    if (!best) return 1;
    return best.pos + Math.min(Math.max(0, i - best.start), best.len);
  };
  return { text, toPos, skippedCode };
}
