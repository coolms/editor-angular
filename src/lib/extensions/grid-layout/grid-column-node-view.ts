import { type Editor } from '@tiptap/core';
import { type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';
import {
    GRID_COLUMN_MAX_WIDTH,
    GRID_COLUMN_MIN_WIDTH,
    GRID_COLUMN_TOTAL,
} from './grid-layout-nodes';

const HANDLE_HIT_AREA_PX = 8;

/**
 * ProseMirror NodeView for the `gridColumn` Tiptap node. Wraps the column's
 * content in a `<div class="col-N">` whose right edge carries an absolutely-
 * positioned hit area; mousedown initiates a width-rebalance drag against
 * the next sibling column.
 *
 * Mirrors the MediaNodeView pattern: live width preview via inline
 * style during drag, single transaction commit on mouseup so undo treats the
 * resize as one operation. The handle is hidden when no next sibling exists
 * (last column has nothing to rebalance against — full-width single-column
 * grids therefore have no resize affordance).
 *
 * Width invariant: dragging never changes the sum of (this.width +
 * next.width). The pair is rebalanced; widths < 1 or > 11 are clamped so
 * neither column collapses.
 */
export class GridColumnNodeView {
    readonly dom: HTMLElement;
    readonly contentDOM: HTMLElement;

    private node: ProseMirrorNode;
    private readonly handle: HTMLElement;

    /** Drag state captured on mousedown; null when no drag is active. */
    private drag: {
        startX: number;
        rowEl: HTMLElement;
        startWidth: number;
        startNextWidth: number;
        currentWidth: number;
        currentNextWidth: number;
    } | null = null;

    constructor(
        node: ProseMirrorNode,
        private readonly editor: Editor,
        private readonly getPos: () => number | undefined,
    ) {
        this.node = node;

        this.dom = document.createElement('div');
        this.applyClass();

        this.contentDOM = document.createElement('div');
        this.contentDOM.className = 'cms-grid-column__content';
        this.dom.appendChild(this.contentDOM);

        this.handle = document.createElement('span');
        this.handle.className = 'cms-grid-column__handle';
        this.handle.contentEditable = 'false';
        this.handle.addEventListener('mousedown', (e) => this.onHandleDown(e));
        this.dom.appendChild(this.handle);

        // Defer the next-sibling probe to a microtask: at construction time
        // ProseMirror has not yet attached this NodeView's parent to the
        // tree, so resolving getPos() on the very next frame would falsely
        // report no sibling. The microtask runs after the initial mount.
        queueMicrotask(() => this.syncHandleVisibility());
    }

    update(node: ProseMirrorNode): boolean {
        if (node.type !== this.node.type) return false;
        this.node = node;
        this.applyClass();
        // A drag in progress owns inline styling — don't overwrite mid-drag.
        if (!this.drag) {
            this.dom.style.removeProperty('flex');
        }
        this.syncHandleVisibility();
        return true;
    }

    /** Tell ProseMirror to ignore handle interactions so its own selection
     *  logic doesn't fight our drag. */
    stopEvent(event: Event): boolean {
        const target = event.target as HTMLElement | null;
        return target?.classList.contains('cms-grid-column__handle') ?? false;
    }

    /** Inline-style mutations during drag must not trigger ProseMirror reparse. */
    ignoreMutation(mutation: ViewMutationRecord): boolean {
        // Selection-record branch (no attributeName) — let ProseMirror handle.
        if (mutation.type !== 'attributes') return false;
        if (mutation.attributeName === 'style') return true;
        if (mutation.attributeName === 'class') {
            const target = mutation.target as HTMLElement;
            if (target === this.dom || target === this.handle) return true;
        }
        return false;
    }

    destroy(): void {
        this.endDrag();
    }

    private applyClass(): void {
        const width = this.currentWidth();
        this.dom.className = `cms-grid-column col-${width}`;
    }

    private currentWidth(): number {
        const raw = (this.node.attrs as Record<string, unknown>)['width'];
        const w = typeof raw === 'number' ? raw : 6;
        return Math.min(GRID_COLUMN_MAX_WIDTH, Math.max(GRID_COLUMN_MIN_WIDTH, w));
    }

    /**
     * Resolve the position of the immediate next sibling column inside the
     * same gridRow. Returns null when this is the last column or when the
     * position can't be resolved (NodeView still mounting). Accepts both
     * `gridRow` (F.1.1+ schema) and `gridLayout` (F.1 legacy where columns
     * sat directly under gridLayout) so legacy-shaped docs that slip past
     * the migration regex still get a working resize handle.
     */
    private resolveSiblingInfo(): { thisPos: number; nextPos: number; nextNode: ProseMirrorNode } | null {
        const thisPos = this.getPos();
        if (thisPos === undefined) return null;
        const $pos = this.editor.state.doc.resolve(thisPos);
        const parent = $pos.parent;
        if (parent.type.name !== 'gridRow' && parent.type.name !== 'gridLayout') return null;
        const indexInParent = $pos.index();
        if (indexInParent + 1 >= parent.childCount) return null;
        const thisNode = parent.child(indexInParent);
        const nextNode = parent.child(indexInParent + 1);
        const nextPos = thisPos + thisNode.nodeSize;
        return { thisPos, nextPos, nextNode };
    }

    private syncHandleVisibility(): void {
        const has = this.resolveSiblingInfo() !== null;
        this.handle.style.display = has ? '' : 'none';
    }

    private onHandleDown(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        const sibling = this.resolveSiblingInfo();
        if (!sibling) return;
        const rowEl = this.dom.parentElement;
        if (!(rowEl instanceof HTMLElement)) return;

        const startWidth = this.currentWidth();
        const nextRaw = (sibling.nextNode.attrs as Record<string, unknown>)['width'];
        const startNextWidth = Math.min(
            GRID_COLUMN_MAX_WIDTH,
            Math.max(GRID_COLUMN_MIN_WIDTH, typeof nextRaw === 'number' ? nextRaw : 6),
        );

        this.drag = {
            startX: event.clientX,
            rowEl,
            startWidth,
            startNextWidth,
            currentWidth: startWidth,
            currentNextWidth: startNextWidth,
        };
        this.handle.classList.add('cms-grid-column__handle--dragging');

        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
    }

    private readonly onMouseMove = (event: MouseEvent): void => {
        const drag = this.drag;
        if (!drag) return;
        const rowWidth = drag.rowEl.getBoundingClientRect().width;
        if (rowWidth <= 0) return;
        const delta = event.clientX - drag.startX;
        // Convert pixel delta into integer Bootstrap-grid units.
        const unitDelta = Math.round((delta / rowWidth) * GRID_COLUMN_TOTAL);
        const pairTotal = drag.startWidth + drag.startNextWidth;
        const newWidth = Math.min(
            pairTotal - GRID_COLUMN_MIN_WIDTH,
            Math.max(GRID_COLUMN_MIN_WIDTH, drag.startWidth + unitDelta),
        );
        const newNext = pairTotal - newWidth;
        drag.currentWidth = newWidth;
        drag.currentNextWidth = newNext;
        // Live preview: restyle the DOM only — ProseMirror sees no doc change
        // until mouseup commits the transaction below. The temporary class
        // overrides Bootstrap's col-N width via the CSS in this extension's
        // stylesheet (--cms-grid-preview-width takes precedence).
        this.applyPreviewClass(newWidth);
        const nextEl = this.dom.nextElementSibling as HTMLElement | null;
        if (nextEl) this.applyPreviewClassTo(nextEl, newNext);
    };

    private readonly onMouseUp = (): void => {
        const drag = this.drag;
        if (!drag) {
            this.endDrag();
            return;
        }
        const sibling = this.resolveSiblingInfo();
        if (sibling) {
            const { thisPos, nextPos } = sibling;
            // Single transaction so undo unwinds the resize as one step.
            const tr = this.editor.state.tr
                .setNodeMarkup(thisPos, undefined, {
                    ...this.node.attrs,
                    width: drag.currentWidth,
                })
                .setNodeMarkup(nextPos, undefined, {
                    ...sibling.nextNode.attrs,
                    width: drag.currentNextWidth,
                });
            this.editor.view.dispatch(tr);
        }
        this.endDrag();
    };

    private endDrag(): void {
        if (!this.drag) {
            this.handle.classList.remove('cms-grid-column__handle--dragging');
            return;
        }
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        this.drag = null;
        this.handle.classList.remove('cms-grid-column__handle--dragging');
        this.clearPreview(this.dom);
        const nextEl = this.dom.nextElementSibling as HTMLElement | null;
        if (nextEl) this.clearPreview(nextEl);
    }

    private applyPreviewClass(width: number): void {
        this.applyPreviewClassTo(this.dom, width);
    }

    private applyPreviewClassTo(el: HTMLElement, width: number): void {
        // CSS uses the data-cms-grid-preview attribute to short-circuit
        // Bootstrap's col-N width. Avoiding inline `style` keeps PM's
        // mutation observer from spuriously re-parsing.
        el.dataset['cmsGridPreview'] = String(width);
    }

    private clearPreview(el: HTMLElement): void {
        delete el.dataset['cmsGridPreview'];
    }

    /** Hit area is invisible when not hovered; CSS lights it up on hover. */
    static handleWidthPx = HANDLE_HIT_AREA_PX;
}
