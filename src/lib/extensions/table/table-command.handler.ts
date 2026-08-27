import type { EditorActionContext, EditorActionHandler } from '../../editor.types';
import { runTableCommand } from './table-commands';

/**
 * Handles `tiptap.tableCommand`. A generic bridge action that runs one named
 * in-table command (`params.command`) against the editor's current selection
 * via {@link runTableCommand}.
 *
 * The table bubble menu is the primary caller (its buttons call
 * `runTableCommand` directly — same single source of truth), but registering
 * this as a first-class action means a manifest toolbar node or any other
 * dispatcher can drive table edits the same declarative way the other
 * built-ins do (`tiptap.toggleMark`, `table.insert`, …).
 */
export class TableCommandHandler implements EditorActionHandler {
    execute(params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void {
        const command = params['command'];
        if (typeof command !== 'string' || command === '') return;
        runTableCommand(ctx.editor, command);
    }
}
