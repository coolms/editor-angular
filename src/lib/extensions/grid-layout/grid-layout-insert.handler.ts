import { Overlay } from '@angular/cdk/overlay';
import type { EditorActionContext, EditorActionHandler } from '../../editor.types';
import { openGridPicker } from './grid-picker';
import { GRID_COLUMN_MAX_WIDTH, GRID_COLUMN_MIN_WIDTH, GRID_COLUMN_TOTAL } from './grid-layout-nodes';

/**
 * Handles `gridLayout.insert`. Opens the visual grid picker anchored to the
 * triggering toolbar button (Excel/Word style: hover to size, click to
 * commit), then inserts a `gridLayout > gridRow+ > gridColumn+` structure
 * with the requested dimensions and equal-width columns.
 *
 * Width math: col-12 splits evenly when 12 mod cols == 0 (2 -> 6/6, 3 ->
 * 4/4/4, 4 -> 3/3/3/3); for non-divisors, leftover units pile onto the
 * leftmost column so each row sums to 12 deterministically. Each column
 * is seeded with an empty paragraph so the grid is editable on insert.
 *
 * The handler reads the picker's `Overlay` lazily through `ctx.injector`
 * to keep the constructor free of CDK deps — the few action handlers that
 * never open an overlay shouldn't pull `@angular/cdk/overlay` into their
 * compilation unit.
 */
export class GridLayoutInsertHandler implements EditorActionHandler {
    async execute(
        _params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Promise<void> {
        const overlay = ctx.injector.get(Overlay);
        const dimensions = await openGridPicker(overlay, ctx.injector, {
            noun: 'grid',
            anchor: ctx.anchor ?? null,
        });
        if (!dimensions) return;

        const content = this.buildRows(dimensions.rows, dimensions.cols);
        ctx.editor.chain().focus().insertContent({ type: 'gridLayout', content }).run();
    }

    private buildRows(
        rows: number,
        cols: number,
    ): Array<{ type: string; content: Array<{ type: string; attrs: { width: number }; content: Array<{ type: string }> }> }> {
        const widths = this.distributeWidths(cols);
        const out = [];
        for (let r = 0; r < rows; r++) {
            const colContent = widths.map((width) => ({
                type: 'gridColumn',
                attrs: { width },
                content: [{ type: 'paragraph' }],
            }));
            out.push({ type: 'gridRow', content: colContent });
        }
        return out;
    }

    private distributeWidths(cols: number): number[] {
        const safeCols = Math.min(GRID_COLUMN_MAX_WIDTH, Math.max(2, Math.floor(cols)));
        const base = Math.floor(GRID_COLUMN_TOTAL / safeCols);
        const leftover = GRID_COLUMN_TOTAL - base * safeCols;
        const widths = Array.from({ length: safeCols }, () => base);
        for (let i = 0; i < leftover; i++) {
            widths[i] = Math.min(GRID_COLUMN_MAX_WIDTH, widths[i] + 1);
        }
        return widths.map((w) => Math.max(GRID_COLUMN_MIN_WIDTH, w));
    }
}
