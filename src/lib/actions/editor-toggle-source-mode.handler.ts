import type { EditorActionContext, EditorActionHandler } from '../editor.types';

/**
 * Handles `editor.toggleSourceMode` by deferring to the host component's
 * `toggleSourceMode()` callback (component owns the swap between Tiptap
 * and a textarea/CodeMirror source view, since that mutates component-
 * local DOM, not the Tiptap state).
 *
 * The bridge stays component-coupled here on purpose — source mode is
 * a chrome concern, not a Tiptap action.
 */
export class EditorToggleSourceModeHandler implements EditorActionHandler {
    execute(_params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        ctx.toggleSourceMode();
    }
}
