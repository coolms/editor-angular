import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { cleanPastedHtml, type PasteCleanupOptions } from './paste-cleanup';

const PASTE_CLEANUP_KEY = new PluginKey('coolmsPasteCleanup');

/**
 * `pasteCleanup` extension (Track B #9) — runs {@link cleanPastedHtml} through
 * ProseMirror's `transformPastedHTML` hook so Word / Google-Docs cruft is
 * scrubbed before the clipboard HTML is parsed into the document. Non-Office
 * pastes (including intra-editor copies of widgets) pass through unchanged.
 *
 * Editor-wide, not contributor-scoped: the CoolmsEditorComponent seeds it on
 * every mount.
 */
export function createPasteCleanup(options: PasteCleanupOptions = {}): Extension {
    return Extension.create({
        name: 'coolmsPasteCleanup',
        addProseMirrorPlugins() {
            return [
                new Plugin({
                    key: PASTE_CLEANUP_KEY,
                    props: {
                        transformPastedHTML: (html: string): string => cleanPastedHtml(html, options),
                    },
                }),
            ];
        },
    });
}
