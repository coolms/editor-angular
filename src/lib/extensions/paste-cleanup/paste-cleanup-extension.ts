import { Extension } from '@tiptap/core';
import type { Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { cleanPastedHtml, type PasteCleanupOptions } from './paste-cleanup';
import { parsePastedText } from './paste-text';

const PASTE_CLEANUP_KEY = new PluginKey('coolmsPasteCleanup');

/**
 * `pasteCleanup` extension -- runs {@link cleanPastedHtml} through
 * ProseMirror's `transformPastedHTML` hook so Word / Google-Docs cruft is
 * scrubbed before the clipboard HTML is parsed into the document. Non-Office
 * pastes (including intra-editor copies of widgets) pass through unchanged.
 * Plain text keeps its structure through {@link parsePastedText}: a blank line
 * starts a paragraph, a single line break stays a line break.
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
                        // A null answer leaves the paste to the editor's own text parser.
                        clipboardTextParser: (text, $context, _plain, view) =>
                            parsePastedText(text, view.state.schema, $context) as Slice,
                    },
                }),
            ];
        },
    });
}
