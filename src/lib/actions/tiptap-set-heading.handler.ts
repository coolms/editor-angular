import type { EditorActionContext, EditorActionHandler } from '../editor.types';

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Handles `tiptap.setHeading` — toggles the active paragraph's heading level. */
export class TiptapSetHeadingHandler implements EditorActionHandler {
    execute(params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        const level = params['level'];
        if (typeof level !== 'number' || level < 1 || level > 6) return;
        ctx.editor.chain().focus().toggleHeading({ level: level as HeadingLevel }).run();
    }
}
