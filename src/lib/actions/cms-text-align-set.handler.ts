import type { EditorActionContext, EditorActionHandler } from '../editor.types';

const ALIGNMENTS = ['left', 'center', 'right', 'justify'];

/**
 * Handles `cmsTextAlign.set` — one handler for all four alignment buttons,
 * which differ only by the `align` action parameter.
 *
 * ⚠️ `focus()` first, always. A toolbar click moves focus to the button, and a
 * command applied without restoring the selection lands nowhere — the classic
 * "the button does nothing" bug in a rich-text toolbar.
 *
 * The command itself TOGGLES: pressing the button a paragraph already carries
 * clears the alignment back to unstated, which is what Word's ribbon does and
 * the only way an author can get back to "inherits" without knowing that is
 * what it is called.
 */
export class CmsTextAlignSetHandler implements EditorActionHandler {
    execute(params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        const align = params['align'];
        if ('string' !== typeof align || !ALIGNMENTS.includes(align)) {
            return;
        }

        const chain = ctx.editor.chain().focus() as unknown as
            Record<string, (value: string) => Record<string, () => boolean>>;
        const command = chain['setCmsTextAlign'];
        if ('function' !== typeof command) {
            // The extension is loaded only where a DOCUMENT is being edited, so
            // a profile that offers the button without it is a wiring mistake
            // worth saying out loud rather than a silent no-op.

            console.warn('[coolms-editor] cmsTextAlign.set: the alignment extension is not loaded');

            return;
        }

        command.call(chain, align)['run']();
    }
}
