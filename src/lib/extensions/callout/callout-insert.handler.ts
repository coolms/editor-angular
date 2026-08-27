import type { EditorActionContext, EditorActionHandler } from '../../editor.types';
import { CALLOUT_TYPES, type CalloutType } from './callout-node';

/**
 * Handles `callout.insert`. Each `callout:note|warning|tip` toolbar button
 * passes its kind via `actionParams.type`; this inserts an empty callout of
 * that kind (seeded with one paragraph so it's immediately editable). No picker
 * overlay — the kind is fixed by which button fired.
 */
export class CalloutInsertHandler implements EditorActionHandler {
    execute(
        params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): void {
        const raw = params['type'];
        const type: CalloutType = CALLOUT_TYPES.includes(raw as CalloutType)
            ? (raw as CalloutType)
            : 'note';

        ctx.editor
            .chain()
            .focus()
            .insertContent({
                type: 'callout',
                attrs: { type },
                content: [{ type: 'paragraph' }],
            })
            .run();
    }
}
