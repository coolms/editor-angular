import { type Node as ProseMirrorNode } from '@tiptap/pm/model';

/** Narrow shape of the one KaTeX entry point the preview needs. */
type KatexRenderToString = (
    tex: string,
    opts?: { displayMode?: boolean; throwOnError?: boolean; output?: string },
) => string;

/**
 * Lazily import KaTeX once for the whole SPA (its own bundle chunk) — only when
 * a math NodeView first needs a preview, so editors without math pay nothing.
 * Mirrors the public theme's `math-render.js` lazy strategy; the stylesheet is
 * loaded globally via angular.json (`katex.min.css`) since the application
 * builder can't side-effect-import CSS from a `.ts` the way Vite does.
 */
let katexPromise: Promise<{ renderToString: KatexRenderToString }> | null = null;
function loadKatex(): Promise<{ renderToString: KatexRenderToString }> {
    if (!katexPromise) {
        katexPromise = import('katex').then((mod) => {
            const k = (mod as unknown as { default?: unknown }).default ?? mod;
            return k as { renderToString: KatexRenderToString };
        });
    }
    return katexPromise;
}

/**
 * ProseMirror NodeView for the inline `math` atom. Renders a live KaTeX preview
 * of the node's `latex` (in inline or display mode per the `display` attr); the
 * raw source stays visible until KaTeX resolves and as the fallback if KaTeX
 * errors, so a malformed formula never blanks out — the author still sees what
 * they typed (matching the public theme's graceful degradation). The source is
 * also surfaced via the element `title` on hover.
 *
 * Editing happens through the toolbar's `math.insert` dialog: selecting the node
 * + clicking the button re-opens it pre-filled (see MathInsertHandler), mirroring
 * how the embed placeholder is edited. `renderHTML` on the node still emits the
 * bare `.katex-src` span, so `getHTML()` / stored content carries only the source.
 */
export class MathNodeView {
    readonly dom: HTMLElement;

    private node: ProseMirrorNode;

    constructor(node: ProseMirrorNode) {
        this.node = node;
        this.dom = document.createElement('span');
        this.dom.className = 'cms-math';
        this.dom.contentEditable = 'false';
        this.render();
    }

    /** Re-render whenever the node's attrs change (e.g. an in-place edit). */
    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.render();
        return true;
    }

    private get latex(): string {
        return String((this.node.attrs as Record<string, unknown>)['latex'] ?? '');
    }

    private get display(): boolean {
        return Boolean((this.node.attrs as Record<string, unknown>)['display']);
    }

    private render(): void {
        const latex = this.latex;
        const display = this.display;
        this.dom.setAttribute('title', latex || 'Empty formula');
        this.dom.classList.toggle('cms-math--display', display);

        if (latex === '') {
            this.dom.classList.add('cms-math--empty');
            this.dom.textContent = '∅ math';
            return;
        }

        this.dom.classList.remove('cms-math--empty', 'cms-math--error');
        // Show the raw source until (and unless) KaTeX renders successfully.
        this.dom.textContent = latex;
        void this.preview(latex, display);
    }

    private async preview(latex: string, display: boolean): Promise<void> {
        try {
            const katex = await loadKatex();
            // Drop a stale async result if the node was edited meanwhile.
            if (this.latex !== latex || this.display !== display) return;
            this.dom.innerHTML = katex.renderToString(latex, {
                displayMode: display,
                throwOnError: false,
                output: 'html',
            });
        } catch {
            // KaTeX failed to load/parse: keep the raw source visible.
            this.dom.classList.add('cms-math--error');
        }
    }
}
