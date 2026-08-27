import { Overlay } from '@angular/cdk/overlay';
import type { Editor } from '@tiptap/core';
import type { EditorActionContext, EditorActionHandler } from '../../editor.types';
import { openGridPicker } from '../grid-layout/grid-picker';

/** Tiptap's table extension augments Editor's command map with insertTable. */
type EditorWithTable = Editor & {
    commands: Editor['commands'] & {
        insertTable: (options: { rows: number; cols: number; withHeaderRow?: boolean }) => boolean;
    };
};

/**
 * Handles `table.insert`. Reuses the same visual picker as `gridLayout.insert`
 * — only the noun differs in the live label — and dispatches Tiptap's
 * `insertTable` command with `withHeaderRow: true` so freshly-inserted tables
 * carry a `<th>` header row by default.
 *
 * Tables are tabular-data primitives, distinct from gridLayout which is a
 * layout primitive. Keep them separate at authoring time so future export
 * adapters (DOCX in F.6, email later) can decide how to map each one to the
 * target's available constructs.
 */
export class TableInsertHandler implements EditorActionHandler {
    async execute(
        _params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Promise<void> {
        const overlay = ctx.injector.get(Overlay);
        const dimensions = await openGridPicker(overlay, ctx.injector, {
            noun: 'table',
            anchor: ctx.anchor ?? null,
        });
        if (!dimensions) return;

        const editor = ctx.editor as EditorWithTable;
        editor.chain().focus().insertTable({
            rows: dimensions.rows,
            cols: dimensions.cols,
            withHeaderRow: true,
        }).run();
    }
}
