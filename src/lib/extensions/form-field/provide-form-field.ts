import { APP_INITIALIZER, type Provider } from '@angular/core';
import { formFieldBuiltins } from '@coolms/editor-client';
import { EditorActionRegistry } from '../../registry/editor-action-registry';
import { EditorExtensionRegistry } from '../../registry/editor-extension-registry';

/**
 * Opt-in: the form-field atom and its `formField.upsert` action, for a host
 * whose editors author forms. Both come from `@coolms/editor-client`; the
 * picker the action opens is this package's, reached through the UI port the
 * editor component supplies.
 */
export function provideCoolmsEditorFormField(): Provider[] {
    return [
        {
            provide: APP_INITIALIZER,
            multi:   true,
            deps:    [EditorActionRegistry, EditorExtensionRegistry],
            useFactory: (
                actions:    EditorActionRegistry,
                extensions: EditorExtensionRegistry,
            ) => () => {
                const { action, extension } = formFieldBuiltins();
                actions.register(...action);
                extensions.register(...extension);
            },
        },
    ];
}
