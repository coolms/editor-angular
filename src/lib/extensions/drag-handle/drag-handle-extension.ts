import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

const DRAG_HANDLE_KEY = new PluginKey('coolmsDragHandle');

/**
 * Left-gutter drag handle for reordering top-level blocks. A
 * floating grip follows the block under the pointer; dragging it moves that
 * whole block via ProseMirror's native node drag-and-drop.
 *
 * Implemented as a bare ProseMirror plugin (no `@tiptap/extension-drag-handle`
 * dependency — same "stay off extra deps" stance as the table bubble-menu).
 * The handle lives in the editor mount's left padding, so it never overlaps
 * prose; clicking it selects the block, dragging it reorders.
 */
class DragHandleController {
    private readonly container: HTMLElement | null;
    private readonly handle: HTMLElement;
    /** Document position immediately before the block the handle currently targets. */
    private targetPos: number | null = null;

    private readonly onMove = (e: MouseEvent): void => this.track(e);
    private readonly onLeave = (): void => this.hide();

    constructor(private readonly view: EditorView) {
        this.container = view.dom.parentElement;
        this.handle = this.buildHandle();
        if (this.container) {
            this.container.appendChild(this.handle);
            this.container.addEventListener('mousemove', this.onMove);
            this.container.addEventListener('mouseleave', this.onLeave);
        }
    }

    destroy(): void {
        if (this.container) {
            this.container.removeEventListener('mousemove', this.onMove);
            this.container.removeEventListener('mouseleave', this.onLeave);
        }
        this.handle.remove();
    }

    private buildHandle(): HTMLElement {
        const el = document.createElement('div');
        el.className = 'cms-drag-handle';
        el.setAttribute('draggable', 'true');
        el.setAttribute('contenteditable', 'false');
        el.setAttribute('title', 'Drag to move · click to select');
        el.setAttribute('aria-label', 'Drag to move block');
        el.innerHTML = '<i class="bi bi-grip-vertical"></i>';
        el.style.display = 'none';

        // Clicking selects the whole block (handy before delete / cut).
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.selectTarget();
        });
        el.addEventListener('dragstart', (e) => this.startDrag(e));
        el.addEventListener('dragend', () => { this.view.dragging = null; });
        return el;
    }

    /** Find the top-level block element under the pointer and park the handle beside it. */
    private track(e: MouseEvent): void {
        if (!this.container || !this.view.editable) { this.hide(); return; }
        const target = e.target as HTMLElement | null;
        if (target && this.handle.contains(target)) return; // over the handle itself

        const block = this.topLevelBlockFrom(target);
        // Over the gutter / padding (no block resolved) but still inside the
        // editor: keep the current handle so the user can reach it. Only an
        // actual `mouseleave` of the container hides it.
        if (!block) return;

        const pos = this.posBeforeBlock(block);
        if (pos === null) { this.hide(); return; }
        this.targetPos = pos;

        const blockRect = block.getBoundingClientRect();
        const containerRect = this.container.getBoundingClientRect();
        const top = blockRect.top - containerRect.top + this.container.scrollTop;
        this.handle.style.top = `${Math.max(0, top)}px`;
        this.handle.style.display = 'flex';
    }

    private hide(): void {
        this.handle.style.display = 'none';
        this.targetPos = null;
    }

    /** Walk up from `el` to the element that is a direct child of the ProseMirror root. */
    private topLevelBlockFrom(el: HTMLElement | null): HTMLElement | null {
        let cur: HTMLElement | null = el;
        while (cur && cur.parentElement !== this.view.dom) {
            cur = cur.parentElement;
        }
        return cur && cur.parentElement === this.view.dom ? cur : null;
    }

    private posBeforeBlock(block: HTMLElement): number | null {
        try {
            const inside = this.view.posAtDOM(block, 0);
            if (inside < 0) return null;
            return this.view.state.doc.resolve(inside).before(1);
        } catch {
            return null;
        }
    }

    private selectTarget(): void {
        if (this.targetPos === null) return;
        const { state } = this.view;
        const sel = NodeSelection.create(state.doc, this.targetPos);
        this.view.dispatch(state.tr.setSelection(sel));
        this.view.focus();
    }

    private startDrag(e: DragEvent): void {
        if (this.targetPos === null || !e.dataTransfer) return;
        const { state } = this.view;
        const sel = NodeSelection.create(state.doc, this.targetPos);
        this.view.dispatch(state.tr.setSelection(sel));

        const slice = this.view.state.selection.content();
        // Tell ProseMirror this is a node move; its built-in drop handler does
        // the actual reorder when the user releases over a valid position.
        this.view.dragging = { slice, move: true };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.clearData();
        e.dataTransfer.setData('text/html', '');

        const dom = this.view.nodeDOM(this.targetPos);
        if (dom instanceof HTMLElement) {
            e.dataTransfer.setDragImage(dom, 0, 0);
        }
    }
}

export function createDragHandle(): Extension {
    return Extension.create({
        name: 'coolmsDragHandle',
        addProseMirrorPlugins() {
            return [
                new Plugin({
                    key: DRAG_HANDLE_KEY,
                    view: (view: EditorView) => new DragHandleController(view),
                }),
            ];
        },
    });
}
