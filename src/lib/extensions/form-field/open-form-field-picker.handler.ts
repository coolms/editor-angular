import { Injectable, inject } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorActionContext, EditorActionHandler } from '../../editor.types';
import { FormFieldAttrs } from './form-field-node';
import {
    FormFieldPickerComponent, FormFieldPickerData, FormFieldPickerResult,
} from './form-field-picker.component';

/**
 * Handles the `formField.upsert` action. Opens the picker dialog with the
 * current attrs (when a formField node is selected, or when the action
 * params carry an `attrs` payload from a NodeView click event), waits for
 * the user to apply or cancel, then commits the result via the
 * `upsertFormField` command on the active editor.
 *
 * The handler is `@Injectable()` so DI delivers it through the
 * provideCoolmsEditorFormField() APP_INITIALIZER. CDK Dialog is pulled
 * lazily so the handler stays test-friendly (no Dialog dep to mock when
 * the test doesn't open the picker).
 */
@Injectable()
export class OpenFormFieldPickerHandler implements EditorActionHandler {
    private readonly dialog = inject(Dialog);

    async execute(
        params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Promise<void> {
        const initialAttrs = this.resolveInitialAttrs(params, ctx);

        const ref = this.dialog.open<FormFieldPickerResult | null, FormFieldPickerData>(
            FormFieldPickerComponent,
            {
                data: { attrs: initialAttrs },
                backdropClass: 'cdk-overlay-dark-backdrop',
                disableClose: false,
            },
        );
        const result = await firstValueFrom(ref.closed);
        if (!result) return;

        // upsertFormField (declared on FormFieldNode.addCommands) inserts when
        // the cursor isn't on a formField, updates attrs in place when it is.
        ctx.editor.chain().focus().upsertFormField(result).run();
    }

    /**
     * Three sources, in priority order:
     *   1. params.attrs — passed by the editor host when the NodeView's chip
     *                     was clicked (carries the exact node attrs).
     *   2. NodeSelection on a formField — when the toolbar fires while a
     *                     formField node is selected.
     *   3. {} — fresh insert.
     */
    private resolveInitialAttrs(
        params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Partial<FormFieldAttrs> {
        const fromParams = params['attrs'];
        if (fromParams && typeof fromParams === 'object') {
            return fromParams;
        }
        const sel = ctx.editor.state.selection;
        if (sel instanceof NodeSelection && sel.node.type.name === 'formField') {
            return sel.node.attrs;
        }
        return {};
    }
}
