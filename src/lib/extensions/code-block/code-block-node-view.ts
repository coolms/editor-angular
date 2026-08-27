import { type Editor } from '@tiptap/core';
import { type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';

export interface CodeBlockLanguageOption {
    readonly value: string;
    readonly label: string;
}

/**
 * ProseMirror NodeView for the lowlight `codeBlock`. Wraps the canonical
 * `<pre><code>` in a relative container carrying a `<select>` language picker
 * (top-right, contentEditable=false). Picking a language writes the node's
 * `language` attribute; the extension's `renderHTML` then serialises it to the
 * stored `class="language-x"`.
 *
 * Highlight COLOURS come from CodeBlockLowlight's ProseMirror plugin, which
 * paints inline decorations over the code text — those decorations live in the
 * view layer only, never in the document, so `editor.getHTML()` still emits
 * clean `<pre><code class="language-x">source</code></pre>` (no `hljs-*` spans).
 * That keeps the stored output inside the HtmlProfileSanitizer's allow-list
 * (`<pre>`/`<code class>` for the codeBlock contributor; spans are not stored,
 * so none are whitelisted).
 *
 * Mirrors the GridColumnNodeView pattern: imperative DOM + a tight
 * `ignoreMutation` so the picker's chrome and our cosmetic class writes don't
 * trigger a ProseMirror reparse of the editable code.
 */
export class CodeBlockLanguageNodeView {
    readonly dom: HTMLElement;
    readonly contentDOM: HTMLElement;

    private node: ProseMirrorNode;
    private readonly select: HTMLSelectElement;

    constructor(
        node: ProseMirrorNode,
        private readonly editor: Editor,
        private readonly getPos: () => number | undefined,
        languages: ReadonlyArray<CodeBlockLanguageOption>,
    ) {
        this.node = node;

        this.dom = document.createElement('div');
        this.dom.className = 'cms-code-block';

        this.select = document.createElement('select');
        this.select.className = 'cms-code-block__lang';
        this.select.contentEditable = 'false';
        this.select.setAttribute('aria-label', 'Code language');
        for (const lang of languages) {
            const opt = document.createElement('option');
            opt.value = lang.value;
            opt.textContent = lang.label;
            this.select.appendChild(opt);
        }
        this.select.value = this.currentLanguage();
        // Keep ProseMirror's selection machinery off the control entirely.
        this.select.addEventListener('mousedown', (e) => e.stopPropagation());
        this.select.addEventListener('change', () => this.onLanguageChange());
        this.dom.appendChild(this.select);

        const pre = document.createElement('pre');
        const code = document.createElement('code');
        pre.appendChild(code);
        this.dom.appendChild(pre);
        this.contentDOM = code;
        this.applyLanguageClass();
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        const lang = this.currentLanguage();
        if (this.select.value !== lang) this.select.value = lang;
        this.applyLanguageClass();
        return true;
    }

    /** The picker owns its own pointer/keyboard interaction. */
    stopEvent(event: Event): boolean {
        const target = event.target as Node | null;
        return target === this.select || this.select.contains(target);
    }

    /** Cosmetic attribute writes (our `language-x` class, the picker chrome)
     *  must never make ProseMirror reparse the editable code. Edits inside the
     *  `<code>` (childList / characterData) fall through to ProseMirror. */
    ignoreMutation(mutation: ViewMutationRecord): boolean {
        if (mutation.type === 'selection') return false;
        if (mutation.type === 'attributes') {
            const target = mutation.target;
            return target === this.contentDOM
                || target === this.dom
                || target === this.select
                || this.select.contains(target);
        }
        return false;
    }

    private currentLanguage(): string {
        const raw = (this.node.attrs as Record<string, unknown>)['language'];
        return typeof raw === 'string' && raw ? raw : '';
    }

    private applyLanguageClass(): void {
        const lang = this.currentLanguage();
        this.contentDOM.className = lang ? `language-${lang}` : '';
    }

    private onLanguageChange(): void {
        const pos = this.getPos();
        if (pos === undefined) return;
        // Empty option = "Plain text" → null language (no class on save).
        const value = this.select.value || null;
        const tr = this.editor.state.tr.setNodeMarkup(pos, undefined, {
            ...this.node.attrs,
            language: value,
        });
        this.editor.view.dispatch(tr);
        // Return focus to the code so the author keeps typing after picking.
        this.editor.view.focus();
    }
}
