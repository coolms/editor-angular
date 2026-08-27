import { Node, mergeAttributes } from '@tiptap/core';
import { GridColumnNodeView } from './grid-column-node-view';

/**
 * Bootstrap-grid column count carried as an attribute on `gridColumn`. The
 * sum of `width` across siblings inside a single `gridRow` is expected to
 * equal 12 — the resize NodeView preserves this invariant by rebalancing
 * the pair of columns adjacent to the dragged handle.
 */
export const GRID_COLUMN_MIN_WIDTH = 1;
export const GRID_COLUMN_MAX_WIDTH = 12;
export const GRID_COLUMN_TOTAL = 12;

/**
 * Three-level hierarchy mirroring the saved HTML shape:
 *
 *     <div class="cms-grid">           <-- gridLayout
 *       <div class="row">              <-- gridRow (1+)
 *         <div class="col-6">…</div>   <-- gridColumn (1+)
 *       </div>
 *     </div>
 *
 * F.1 emitted a flat gridLayout → gridColumn structure (no row wrapper).
 * F.1.1 introduces gridRow so the layout supports multiple rows. Documents
 * authored under F.1 are migrated client-side by `migrateLegacyGridLayout`
 * (see dtmpl-content-adapter) which wraps a bare `<div class="row">` with
 * a `<div class="cms-grid">` before Tiptap's parser runs, so a single-row
 * legacy doc enters the new schema as one gridRow inside one gridLayout.
 */
export const GridLayoutNode = Node.create({
    name: 'gridLayout',
    group: 'block',
    content: 'gridRow+',
    isolating: true,
    defining: true,

    parseHTML() {
        return [{ tag: 'div.cms-grid', priority: 100 }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { class: 'cms-grid' }), 0];
    },
});

export const GridRowNode = Node.create({
    name: 'gridRow',
    group: 'block',
    content: 'gridColumn+',
    isolating: true,
    defining: true,

    parseHTML() {
        // Match a `row` div that contains at least one `col-…` child. The
        // legacy-migration regex in DtmplContentAdapter ensures that on
        // load, every such `div.row` lives inside a `div.cms-grid`, so the
        // `gridRow+` schema constraint on gridLayout is always satisfiable.
        return [{
            tag: 'div.row',
            getAttrs: (node) => {
                if (!(node instanceof HTMLElement)) return false;
                const hasCol = node.querySelector(':scope > div[class*="col-"]') !== null;
                return hasCol ? null : false;
            },
        }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', mergeAttributes(HTMLAttributes, { class: 'row' }), 0];
    },
});

export const GridColumnNode = Node.create({
    name: 'gridColumn',
    group: 'block',
    content: 'block+',
    isolating: true,
    defining: true,

    addAttributes() {
        return {
            width: {
                default: 6,
                parseHTML: (el: HTMLElement) => {
                    const match = el.className.match(/\bcol-(\d+)\b/);
                    if (!match) return 6;
                    const parsed = parseInt(match[1], 10);
                    if (!Number.isFinite(parsed)) return 6;
                    return Math.min(GRID_COLUMN_MAX_WIDTH, Math.max(GRID_COLUMN_MIN_WIDTH, parsed));
                },
                renderHTML: (attrs: Record<string, unknown>) => {
                    const w = typeof attrs['width'] === 'number' ? attrs['width'] : 6;
                    const clamped = Math.min(GRID_COLUMN_MAX_WIDTH, Math.max(GRID_COLUMN_MIN_WIDTH, w));
                    return { class: `col-${clamped}` };
                },
            },
        };
    },

    parseHTML() {
        return [{
            tag: 'div[class*="col-"]',
            getAttrs: (node) => {
                if (!(node instanceof HTMLElement)) return false;
                return /\bcol-\d+\b/.test(node.className) ? null : false;
            },
        }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', HTMLAttributes, 0];
    },

    addNodeView() {
        return ({ node, editor, getPos }) =>
            new GridColumnNodeView(node, editor, getPos);
    },
});
