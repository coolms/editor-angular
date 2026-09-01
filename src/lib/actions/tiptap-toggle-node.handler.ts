import type { EditorActionContext, EditorActionHandler } from '../editor.types';

/**
 * Handles `tiptap.toggleNode` for block-level nodes (bulletList, orderedList,
 * blockquote, future codeBlock). The Tiptap chain's `toggleX` commands are
 * keyed by node name, so a generic dispatcher lets the manifest add new
 * nodes without a per-node handler.
 *
 * Tiptap's chain API exposes `toggleBulletList`, `toggleOrderedList`,
 * `toggleBlockquote` etc. — we look them up dynamically so manifest-driven
 * additions don't require a code change here.
 */
export class TiptapToggleNodeHandler implements EditorActionHandler {
    execute(params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        const name = params['name'];
        if (typeof name !== 'string' || name === '') return;

        // Convert e.g. 'bulletList' -> 'toggleBulletList' on the chain.
        const command = `toggle${name.charAt(0).toUpperCase()}${name.slice(1)}`;
        const chain = ctx.editor.chain().focus() as unknown as Record<string, () => Record<string, () => boolean>>;
        const fn = chain[command];
        if (typeof fn !== 'function') {
             
            console.warn(`[coolms-editor] tiptap.toggleNode: editor chain has no '${command}' command`);
            return;
        }
        fn.call(chain)['run']();
    }
}
