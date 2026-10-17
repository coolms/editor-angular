import { APP_INITIALIZER, Injector, Optional, type Provider } from '@angular/core';
import { builtinActionHandlers, builtinExtensions } from '@coolms/editor-client';
import { createTableControls } from '../extensions/table/table-controls';
import { EditorActionRegistry } from '../registry/editor-action-registry';
import { EditorExtensionRegistry } from '../registry/editor-extension-registry';
import { EDITOR_TRANSLATE, type EditorTranslate } from '../editor.types';

/**
 * Bootstrap providers for `@coolms/editor-angular`. Consumers add this to
 * their `ApplicationConfig.providers` once.
 *
 * Side effects on app boot:
 *   1. Registers the built-in action handlers under the `actionType` strings
 *      the manifest carries.
 *   2. Registers the built-in Tiptap units under their canonical names, so the
 *      manifest's `extensions` strings resolve at editor mount.
 *
 * Both catalogues are the editor module's own (`@coolms/editor-client`), so an
 * editor in another framework mounts exactly this set. The one unit added here
 * is Angular's: `tableControls`, the in-table bubble menu drawn with a CDK
 * overlay, declared by the `block:table` contributor so it loads exactly when
 * tables are enabled.
 *
 * Module-supplied handlers + extensions (media insert, the link picker, ...)
 * register via their own APP_INITIALIZER alongside this one -- multi: true
 * means everything composes additively.
 */
export function provideCoolmsEditor(): Provider[] {
    return [
        {
            provide: APP_INITIALIZER,
            multi:   true,
            // EDITOR_TRANSLATE is optional (no provider wired today) -- the
            // callout NodeView falls back to English labels when it's null.
            deps:    [EditorActionRegistry, EditorExtensionRegistry, Injector, [new Optional(), EDITOR_TRANSLATE]],
            useFactory: (
                actions: EditorActionRegistry,
                extensions: EditorExtensionRegistry,
                injector: Injector,
                translate: EditorTranslate | null,
            ) => () => {
                for (const [actionType, handler] of builtinActionHandlers()) {
                    actions.register(actionType, handler);
                }
                for (const [name, factory] of builtinExtensions({ translate })) {
                    extensions.register(name, factory);
                }
                extensions.register('tableControls', () => createTableControls(injector));
            },
        },
    ];
}
