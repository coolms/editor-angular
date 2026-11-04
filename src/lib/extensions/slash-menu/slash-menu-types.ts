import type { Injector } from '@angular/core';
import type { EditorToolbarNodeManifest, SlashCommandItem } from '@coolms/editor-client';

/** The palette's items are framework-free; the popup that shows them is Angular's. */
export type { SlashCommandGroup, SlashCommandItem } from '@coolms/editor-client';

/**
 * Host wiring for the slash extension. The CoolmsEditorComponent supplies
 * these closures at mount time so the extension stays storage- and
 * state-agnostic (it never reaches into the component or NgXS directly):
 *
 *   items     current profile's slashable palette (re-read live, so a profile
 *             swap is reflected without re-instantiating the extension).
 *   onSelect  dispatch the chosen entry through the editor action bridge --
 *             the component builds the EditorActionContext and forwards to
 *             EditorActionRegistry, identical to a toolbar click.
 *   injector  lets the ProseMirror plugin reach CDK Overlay for the popup.
 *
 * Item labels are already resolved (via the host's translator) by the time
 * `items()` returns, so the config needs no translator of its own.
 */
export interface SlashMenuConfig {
    items(): ReadonlyArray<SlashCommandItem>;
    onSelect(node: EditorToolbarNodeManifest): void;
    readonly injector: Injector;
}
