import type { EditorActionContext, EditorActionHandler } from '../../editor.types';

/**
 * Handles `pageBreak.insert` — drops a page break at the cursor.
 *
 * No dialog: a page break has nothing to configure. The only decision is
 * WHERE, and the caret already answers that.
 *
 * `focus()` before the insert so the break lands at the caret rather than at
 * the document end — clicking a toolbar button takes focus out of the editor,
 * and without restoring it ProseMirror applies the transaction at whatever
 * position it last knew about.
 */
export class PageBreakInsertHandler implements EditorActionHandler {
    execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        ctx.editor.chain().focus().insertPageBreak().run();
    }
}
