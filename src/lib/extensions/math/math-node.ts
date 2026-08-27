import { Node, mergeAttributes } from '@tiptap/core';
import { MathNodeView } from './math-node-view';

/** Editor attribute set for an inline math atom. */
export interface MathAttrs {
    /** Raw LaTeX (no `$`/`$$` delimiters) — stored as the span's text content. */
    latex: string;
    /** `true` → KaTeX display mode (centred block); `false` → inline. */
    display: boolean;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        math: {
            /**
             * Insert a math node, or update the one already selected in place
             * (so the toolbar button edits a selected formula rather than
             * stacking a duplicate). A blank `latex` is a no-op.
             */
            upsertMath: (attrs: Partial<MathAttrs>) => ReturnType;
        };
    }
}

/**
 * Inline math atom — Track B #7 (KaTeX).
 *
 * Stored HTML shape is **byte-identical to what the server-side `MathProcessor`
 * emits** for hand-typed `$…$` / `$$…$$`:
 *
 *     <span class="katex-src" data-display="0|1">LATEX</span>
 *
 * so the public theme's `math-render.js` renders BOTH contracts (editor-inserted
 * spans *and* author-typed `$…$` that the server wraps) with one code path. The
 * LaTeX lives in the element's text content; `data-display` carries inline vs
 * display. `MathProcessor` fast-paths bodies with no `$`, so a stored span (which
 * has none) round-trips untouched on the public render.
 *
 * In-editor a {@link MathNodeView} renders a live KaTeX preview; `renderHTML`
 * below still emits the bare `.katex-src` span, so `getHTML()` (and the stored
 * content) never carries the rendered KaTeX markup — only the source span. The
 * `DtmplContentAdapter` passes the span through untouched (its transforms target
 * `<img>`/`<a>`/widget markers, not spans), so save/reload is lossless.
 */
export const MathNode = Node.create({
    name: 'math',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
        return {
            latex: {
                default: '',
                parseHTML: (el: HTMLElement) => el.textContent ?? '',
                // Emitted as the span's text content by the node-level renderHTML,
                // never as a same-named attribute.
                renderHTML: () => ({}),
            },
            display: {
                default: false,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-display') === '1',
                renderHTML: (attributes: Record<string, unknown>) => ({
                    'data-display': attributes['display'] ? '1' : '0',
                }),
            },
        };
    },

    parseHTML() {
        // Priority over any generic span rule so the marker is claimed by us.
        return [{ tag: 'span.katex-src', priority: 100 }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const latex = String((node.attrs as Record<string, unknown>)['latex'] ?? '');
        // HTMLAttributes already carries `data-display` (from the attr renderHTML).
        return ['span', mergeAttributes({ class: 'katex-src' }, HTMLAttributes), latex];
    },

    addCommands() {
        return {
            upsertMath: (attrs: Partial<MathAttrs>) => ({ chain, state }) => {
                const latex = (attrs.latex ?? '').trim();
                if (latex === '') return false; // never insert an empty formula

                const next = { latex, display: attrs.display ?? false };
                const sel = state.selection as { node?: { type?: { name?: string } } };
                if (sel.node?.type?.name === 'math') {
                    return chain().updateAttributes('math', next).run();
                }
                return chain().insertContent({ type: 'math', attrs: next }).run();
            },
        };
    },

    addNodeView() {
        return ({ node }) => new MathNodeView(node);
    },
});
