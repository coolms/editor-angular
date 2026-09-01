import type { EditorActionContext, EditorActionHandler } from '../../editor.types';
import { FOOTNOTE_REFERENCE_NODE_NAME, nextFootnoteId } from './footnote-reference-node';

/**
 * Handles `cmsFootnote.insert` — drops a reference to a new note at the caret.
 *
 * ## The id is allocated from the DOCUMENT, not from the notes panel
 *
 * The handler cannot see the note bodies: they live in the `.ddoc` the dialog
 * holds, not in the editor. What it can see is every reference already in the
 * document, and one more than the highest of those is free by construction.
 *
 *  That leaves one case worth naming: a note whose reference an author
 * deleted keeps its BODY — the editing seam drops nothing for being
 * unreferenced — so an id above every remaining reference can be handed out
 * again, and the new marker then points at that old text. It is visible rather
 * than silent (the notes panel shows the note with its text in it), and it is
 * the friendly reading of a body that was kept on purpose.
 *
 * `focus()` before the insert, for the same reason the page break does it: a
 * toolbar click takes focus out of the editor, and a transaction applied
 * without restoring the selection lands at whatever position ProseMirror last
 * knew about.
 */
export class CmsFootnoteInsertHandler implements EditorActionHandler {
    execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        const id = nextFootnoteId(ctx.editor.state.doc);

        ctx.editor.chain().focus().insertContent({
            type: FOOTNOTE_REFERENCE_NODE_NAME,
            attrs: { id },
        }).run();
    }
}
