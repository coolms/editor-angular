import type { Injector } from '@angular/core';
import type { EditorToolbarNodeManifest } from '../../editor.types';

/**
 * One entry in the `/`-command palette. Built from a slashable
 * `EditorToolbarNodeManifest` / — the palette is
 * 100% manifest-driven, so `node` is carried through verbatim and dispatched
 * back through the same `EditorActionRegistry` the toolbar buttons use.
 *
 *   label     already resolved to a human string (via EDITOR_TRANSLATE or the
 *             built-in fallback dictionary) so the popup renders plain text.
 *   keywords  extra fuzzy-search aliases declared by the contributor.
 *   node      the original manifest entry — `actionType` + `actionParams`
 *             feed the action bridge unchanged.
 */
export interface SlashCommandItem {
    readonly id:       string;
    readonly group:    string;
    readonly label:    string;
    readonly icon:     string;
    readonly keywords: ReadonlyArray<string>;
    readonly node:     EditorToolbarNodeManifest;
}

/** A group of palette items sharing a `group` bucket, with a display heading. */
export interface SlashCommandGroup {
    /** Raw manifest group key ('block' | 'insert' | …). */
    readonly key:     string;
    /** Humanised heading shown above the group ('Blocks', 'Insert'). */
    readonly heading: string;
    readonly items:   ReadonlyArray<SlashCommandItem>;
}

/**
 * Host wiring for the slash extension. The CoolmsEditorComponent supplies
 * these closures at mount time so the extension stays storage- and
 * state-agnostic (it never reaches into the component or NgXS directly):
 *
 *   items     current profile's slashable palette (re-read live, so a profile
 *             swap is reflected without re-instantiating the extension).
 *   onSelect  dispatch the chosen entry through the editor action bridge —
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
