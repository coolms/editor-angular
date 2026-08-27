import type { EditorActionContext, EditorActionHandler } from '../../editor.types';

/**
 * Handles `codeTabs.insert`. Drops a two-variant tabbed code block (JavaScript
 * + PHP) at the cursor as a sensible starting point; the author re-labels each
 * tab via the per-block language picker and can add/remove variants by editing
 * inside the container. Seed content is placeholder text so the block isn't
 * empty (an empty codeBlock+ container would collapse on the next transaction).
 */
export class CodeTabsInsertHandler implements EditorActionHandler {
    execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        ctx.editor
            .chain()
            .focus()
            .insertContent({
                type: 'codeTabs',
                content: [
                    {
                        type: 'codeBlock',
                        attrs: { language: 'javascript' },
                        content: [{ type: 'text', text: "console.log('hello');" }],
                    },
                    {
                        type: 'codeBlock',
                        attrs: { language: 'php' },
                        content: [{ type: 'text', text: "<?php echo 'hello';" }],
                    },
                ],
            })
            .run();
    }
}
