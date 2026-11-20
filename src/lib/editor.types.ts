import { InjectionToken, type Injector } from '@angular/core';
import type { Editor } from '@tiptap/core';

/**
 * Wire-shape for a single toolbar entry. Mirrors PHP `EditorToolbarNode`
 * field-for-field so the bridge can render straight from the API manifest
 * without an intermediate transform step.
 */
export interface EditorToolbarNodeManifest {
    readonly id:           string;
    readonly group:        string;
    readonly priority:     number;
    readonly icon:         string;
    readonly label:        string;
    readonly actionType:   string;
    readonly actionParams: Readonly<Record<string, unknown>>;
    readonly extensions:   ReadonlyArray<string>;
    readonly stateKeys:    ReadonlyArray<string>;
    readonly shortcut?:    string | null;
    /**
     * Whether this entry belongs in the `/`-triggered slash-insert palette
 *. Derived server-side from `group` — block-structure and
     * insert-widget actions are slashable; inline format marks (bold/italic)
     * and meta actions are not. Serialized by the backend's ObjectNormalizer
 * from `EditorToolbarNode::isSlashable()`. Optional on the
 * wire-type so a older manifest still type-checks; the slash extension
     * treats a missing value as `false`.
     */
    readonly slashable?:   boolean;
    /**
     * Extra search aliases for the slash palette (`['h1', 'title']` for
     * Heading 1) — the FE fuzzy-matches these alongside `label`. Opt-in per
     * contributor; defaults to `[]` server-side, optional here for the same
     * back-compat reason as `slashable`.
     */
    readonly keywords?:    ReadonlyArray<string>;
}

/**
 * One profile slice of the editor sub-manifest. Mirrors PHP
 * `EditorApiManifestProfile`: the contributors array is pre-resolved to
 * the IDs the profile picks (already sorted by group/priority), and
 * `allowedWidgets` is the storage-axis allow-list the backend
 * ContentSanitizer enforces. The frontend uses it for defense-in-depth
 * stripping during `toEditor` (see `ContentAdapter.stripDisallowedWidgets`).
 */
export interface EditorProfileManifest {
    readonly contributors:   ReadonlyArray<EditorToolbarNodeManifest>;
    readonly allowedWidgets: ReadonlyArray<string>;
}

/**
 * Source-of-profiles for the bridge. The bridge never reads NgXS or
 * any consumer-app state directly — instead consumers provide an
 * implementation through the EDITOR_MANIFEST_PROVIDER token.
 *
 * Sub-prompt E swapped the contract from `contributors(editorId)` to
 * `getProfile(name)` to match the schemaVersion-2 wire shape; the bridge
 * now consumes profile slices directly so allowedWidgets travels with the
 * contributor list.
 */
export interface EditorManifestProvider {
    getProfile(name: string): EditorProfileManifest | null;
}

export const EDITOR_MANIFEST_PROVIDER = new InjectionToken<EditorManifestProvider>('EDITOR_MANIFEST_PROVIDER');

/**
 * Minimal context passed to every action handler. The bridge builds one
 * per dispatch — the editor instance + the profile name let handlers run
 * Tiptap chains, while `injector` lets module-supplied handlers (Media
 * insert, future Taxonomy link) reach DI services without owning a
 * component reference.
 *
 *   profile         the named profile that's currently active.
 *   allowedWidgets  the namespaces this profile permits on save.
 *                   Module handlers (media insert, future link picker)
 *                   can defensively early-return when their namespace
 *                   isn't in the list — a logic safety net even if the
 *                   profile filter already removed the contributor button.
 *
 * Component-supplied helpers (`toggleSourceMode`, `getContent`,
 * `setContent`) are wired by the host CoolmsEditorComponent so handlers
 * for `editor.toggleSourceMode` / `editor.openLinkDialog` / etc. don't
 * need to reach across DI to manipulate component-local state.
 */
export interface EditorActionContext {
    readonly editor:           Editor;
    readonly profile:          string;
    readonly allowedWidgets:   ReadonlyArray<string>;
    readonly injector:         Injector;
    readonly toggleSourceMode: () => void;
    readonly getContent:       () => string;
    readonly setContent:       (html: string) => void;
    /**
     * The DOM element that triggered the action — the toolbar button when
     * the action came from a toolbar click, the chip element when a
     * NodeView dispatched it, or null for programmatic invocations. Used
     * by handlers that anchor an Overlay popup (grid picker, table picker,
     * future colour swatch). Backwards-compatible: handlers that don't
     * read it ignore the field.
     */
    readonly anchor?:          HTMLElement | null;
}

/**
 * Bridge action handler contract. Implementations register against an
 * `actionType` string and receive the params declared in the manifest's
 * `actionParams` field plus the runtime context above.
 */
export interface EditorActionHandler {
    execute(params: Readonly<Record<string, unknown>>, ctx: EditorActionContext): void | Promise<void>;
}

/**
 * Storage adapter — lets consumers map the editor's HTML to/from a custom
 * storage format (page-editor passes a dtmpl adapter; comment editor uses
 * the identity default). Sub-prompt B3 wires this for the page editor;
 * sub-prompt E adds the optional `stripDisallowedWidgets` hook.
 *
 *   toEditor                  Stored format -> editor HTML. May be async
 *                             (e.g. dtmpl preview-URL resolution).
 *   toStorage                 Editor HTML -> stored format.
 *   stripDisallowedWidgets    Optional defense-in-depth: invoked by the
 *                             bridge during the toEditor chain, given the
 *                             active profile's allowedWidgets list.
 *                             Adapters that understand widget grammar
 *                             (DtmplContentAdapter) drop disallowed
 *                             references so an editor mounted with a
 *                             narrowed profile can't render content the
 *                             backend would have rejected anyway. Backend
 *                             remains authoritative on save; this is just
 *                             a UX guardrail.
 */
export interface ContentAdapter {
    toEditor(stored: string): string | Promise<string>;
    toStorage(html: string): string;
    stripDisallowedWidgets?(content: string, allowedWidgets: ReadonlyArray<string>): string;
}

/**
 * Translation function the toolbar uses to resolve label keys
 * ('editor.toolbar.format.bold'). When the host app has no i18n
 * infrastructure (true today), the bridge falls back to a built-in
 * dictionary covering the 10 built-ins, then to the bare key string.
 */
export type EditorTranslate = (key: string) => string;

/** DI token consumers can override to plug a real translation backend. */
export const EDITOR_TRANSLATE = new InjectionToken<EditorTranslate>('EDITOR_TRANSLATE');
