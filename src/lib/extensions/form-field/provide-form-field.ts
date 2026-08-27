import { APP_INITIALIZER, type Provider } from '@angular/core';
import { EditorActionRegistry } from '../../registry/editor-action-registry';
import { EditorExtensionRegistry } from '../../registry/editor-extension-registry';
import { FormFieldNode } from './form-field-node';
import { OpenFormFieldPickerHandler } from './open-form-field-picker.handler';

/**
 * Bootstrap providers for the formField Tiptap extension. Spread into
 * `ApplicationConfig.providers` after `provideCoolmsEditor()` so the
 * bridge's registries exist before this initializer runs.
 *
 * Side effects on app boot:
 *   1. Registers `formField.upsert` action handler with EditorActionRegistry.
 *   2. Registers the `formField` Tiptap extension factory with
 *      EditorExtensionRegistry under the canonical name the PHP-side
 *      FormFieldContributor declares in its `extensions` field.
 *
 * Lives inside @coolms/editor-angular (not a feature/ module) because
 * formField is a universal editor primitive — same reason gridLayout's
 * factory registration is inside `provideCoolmsEditor()`. Kept as a
 * separate provider so consumer apps that don't want formField can simply
 * omit `provideCoolmsEditorFormField()` from their composition without
 * forking the bridge.
 */
export function provideCoolmsEditorFormField(): Provider[] {
    return [
        OpenFormFieldPickerHandler,
        {
            provide: APP_INITIALIZER,
            multi:   true,
            deps:    [EditorActionRegistry, EditorExtensionRegistry, OpenFormFieldPickerHandler],
            useFactory: (
                actions:    EditorActionRegistry,
                extensions: EditorExtensionRegistry,
                handler:    OpenFormFieldPickerHandler,
            ) => () => {
                actions.register('formField.upsert', handler);
                extensions.register('formField', () => FormFieldNode);
            },
        },
    ];
}
