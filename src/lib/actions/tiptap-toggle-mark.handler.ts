import type { EditorActionContext, EditorActionHandler } from '../editor.types';

/**
 * Handles `tiptap.toggleMark` from the manifest. The manifest emits this
 * for every text-formatting button (bold, italic, future strikethrough,
 * underline, etc.) so a single handler covers them all — the differentiator
 * is the `name` actionParam.
 */
export class TiptapToggleMarkHandler implements EditorActionHandler {
    execute(params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        const name = params['name'];
        if (typeof name !== 'string' || name === '') return;
        ctx.editor.chain().focus().toggleMark(name).run();
    }
}
