import { type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';

/** Human label for a child code block's `language` attribute. */
function languageLabel(node: ProseMirrorNode, index: number): string {
    const raw = (node.attrs as Record<string, unknown>)['language'];
    if (typeof raw === 'string' && raw) {
        return raw === 'dtmpl' ? 'DTMPL' : raw;
    }
    return `Tab ${index + 1}`;
}

/**
 * ProseMirror NodeView for the `codeTabs` container. Renders a contentEditable
 * tab strip (one tab per child code block, labelled by its language) above the
 * editable panels; clicking a tab shows that child and hides the rest.
 *
 * The active index is NodeView-local (view state, not document data) — the
 * stored HTML is just `<div class="code-tabs">` wrapping N `<pre><code>` blocks,
 * which degrades to a readable stack anywhere the tab JS doesn't run (matches
 * the public theme's progressive-enhancement contract).
 *
 * Panel visibility is toggled via inline `display` on each child's DOM. Those
 * children are CodeBlockLanguageNodeView instances whose `ignoreMutation`
 * already swallows attribute writes on their own `dom`, so this parent's writes
 * never trigger a ProseMirror reparse.
 */
export class CodeTabsNodeView {
    readonly dom: HTMLElement;
    readonly contentDOM: HTMLElement;

    private node: ProseMirrorNode;
    private readonly bar: HTMLElement;
    private active = 0;

    constructor(node: ProseMirrorNode) {
        this.node = node;

        this.dom = document.createElement('div');
        this.dom.className = 'code-tabs cms-code-tabs';

        this.bar = document.createElement('div');
        this.bar.className = 'cms-code-tabs__bar';
        this.bar.contentEditable = 'false';
        this.dom.appendChild(this.bar);

        this.contentDOM = document.createElement('div');
        this.contentDOM.className = 'cms-code-tabs__panels';
        this.dom.appendChild(this.contentDOM);

        this.renderTabs();
        // Panels exist after ProseMirror fills contentDOM; apply on next tick.
        queueMicrotask(() => this.applyActive());
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        if (this.active >= node.childCount) this.active = Math.max(0, node.childCount - 1);
        this.renderTabs();
        this.applyActive();
        return true;
    }

    /** Tab-bar clicks are ours; keep ProseMirror's selection logic out of them. */
    stopEvent(event: Event): boolean {
        const target = event.target as Node | null;
        return target === this.bar || this.bar.contains(target);
    }

    ignoreMutation(mutation: ViewMutationRecord): boolean {
        if (mutation.type === 'selection') return false;
        const target = mutation.target;
        if (target === this.bar || this.bar.contains(target)) return true;
        if (mutation.type === 'attributes') {
            return target === this.dom || target === this.contentDOM;
        }
        return false;
    }

    private renderTabs(): void {
        this.bar.innerHTML = '';
        this.node.forEach((child, _offset, index) => {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'cms-code-tabs__tab';
            tab.textContent = languageLabel(child, index);
            tab.classList.toggle('cms-code-tabs__tab--active', index === this.active);
            tab.addEventListener('mousedown', (e) => e.preventDefault());
            tab.addEventListener('click', () => this.setActive(index));
            this.bar.appendChild(tab);
        });
    }

    private setActive(index: number): void {
        this.active = index;
        this.renderTabs();
        this.applyActive();
    }

    /** Show only the active panel; hide the others. */
    private applyActive(): void {
        const panels = this.contentDOM.children;
        for (let i = 0; i < panels.length; i++) {
            (panels[i] as HTMLElement).style.display = i === this.active ? '' : 'none';
        }
    }
}
