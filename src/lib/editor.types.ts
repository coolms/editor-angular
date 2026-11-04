import { InjectionToken, type Injector } from '@angular/core';
import type {
    EditorActionContext as ClientActionContext,
    EditorManifestProvider,
    EditorTranslate,
} from '@coolms/editor-client';

/**
 * The editor's wire and adapter types are framework-free and live in
 * `@coolms/editor-client`; re-exported under the names this package has always
 * published, so an importer of `@coolms/editor-angular` changes nothing.
 */
export type {
    ContentAdapter,
    EditorManifestProvider,
    EditorProfileManifest,
    EditorToolbarNodeManifest,
    EditorTranslate,
} from '@coolms/editor-client';

export const EDITOR_MANIFEST_PROVIDER = new InjectionToken<EditorManifestProvider>('EDITOR_MANIFEST_PROVIDER');

/**
 * The context an action handler is given in an Angular host: the framework-free
 * context -- editor, profile, the UI port, the anchor rectangle -- plus the
 * injector.
 *
 * The built-in handlers never read `injector`: what they ask of the person goes
 * through `ui`, so the same handlers run in any host. It is kept for handlers
 * an Angular APPLICATION registers (the admin's media, link, form and document
 * pickers), which open their own Angular dialogs and have no other way to reach
 * DI from a registry of plain objects.
 */
export interface EditorActionContext extends ClientActionContext {
    readonly injector: Injector;
}

/**
 * An action handler in an Angular host. A framework-free handler from
 * `@coolms/editor-client` is one too: it reads the part of the context it
 * declares.
 */
export interface EditorActionHandler {
    execute(params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void | Promise<void>;
}

/** DI token consumers can override to plug a real translation backend. */
export const EDITOR_TRANSLATE = new InjectionToken<EditorTranslate>('EDITOR_TRANSLATE');
