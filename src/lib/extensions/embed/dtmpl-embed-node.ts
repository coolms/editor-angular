import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Bootstrap `ratio-*` aspect ratios an author may pick. First entry is the
 * default. Mirrors the backend EmbedWidgetRenderer's `RATIOS` allow-list so the
 * editor never offers a ratio the renderer would reject + fall back on.
 */
export const EMBED_RATIOS = ['16x9', '4x3', '21x9', '1x1'] as const;
export type EmbedRatio = (typeof EMBED_RATIOS)[number];

/** Coerce an arbitrary string to a known ratio, defaulting to `16x9`. */
export function normalizeRatio(raw: string | null | undefined): EmbedRatio {
    return (EMBED_RATIOS as readonly string[]).includes(raw ?? '')
        ? (raw as EmbedRatio)
        : EMBED_RATIOS[0];
}

/**
 * Embed kinds, carried as the token's `_id` segment (`{widget:embed:<kind> …}`).
 * Mirrors the backend EmbedWidgetRenderer dispatch:
 *   - video  — YouTube / Vimeo → responsive iframe.
 *   - iframe — maps + code playgrounds → responsive iframe.
 *   - audio  — Spotify / SoundCloud player, or a direct audio file.
 */
export const EMBED_KINDS = ['video', 'iframe', 'audio'] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

/** Coerce an arbitrary string to a known kind, defaulting to `video`. */
export function normalizeKind(raw: string | null | undefined): EmbedKind {
    return (EMBED_KINDS as readonly string[]).includes(raw ?? '')
        ? (raw as EmbedKind)
        : EMBED_KINDS[0];
}

/** Bootstrap-icon token shown on the placeholder card per kind. */
export function iconForKind(kind: EmbedKind): string {
    switch (kind) {
        case 'iframe': return 'bi-window';
        case 'audio':  return 'bi-music-note-beamed';
        default:       return 'bi-camera-video';
    }
}

/** True when the kind uses an aspect ratio (audio does not). */
export function kindUsesRatio(kind: EmbedKind): boolean {
    return kind !== 'audio';
}

/**
 * Attribute set for the `{widget:embed:<kind> src=`URL` …}` dtmpl tag, mirrored
 * as a Tiptap node so authors see a placeholder card in place of the eventual
 * embed.
 *
 *   kind   - 'video' | 'iframe' | 'audio'; the token's `_id`, drives the backend
 *            resolver + which placeholder/icon the editor shows.
 *   url    - the author-supplied provider URL. Stored verbatim; the backend
 *            EmbedUrlResolver allow-lists + canonicalizes it at render time (an
 *            unknown host renders nothing — no raw iframe).
 *   ratio  - Bootstrap aspect ratio token ('16x9' | '4x3' | '21x9' | '1x1');
 *            ignored for audio.
 *   title  - optional iframe / audio title / accessible label.
 */
export interface EmbedWidgetAttrs {
    kind:  EmbedKind;
    url:   string;
    ratio: EmbedRatio;
    title: string;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        dtmplEmbed: {
            upsertEmbed: (attrs: Partial<EmbedWidgetAttrs>) => ReturnType;
        };
    }
}

/**
 * Block atom Tiptap node mirroring a `{widget:embed:video …}` dtmpl tag.
 *
 * In-editor: renders as an informational placeholder card (icon + title/URL +
 *            ratio) — no live iframe; the actual responsive embed is produced
 *            server-side by EmbedWidgetRenderer when the page is rendered.
 *            Block + atom because an embed is a standalone block the author
 *            doesn't type inside; the dialog (embed.insert handler) is the sole
 *            config UI.
 * On save:   `embedHtmlToDtmpl()` swaps each marker `<div data-widget="embed">`
 *            back into `{widget:embed:video src=`…` …}`.
 * On load:   `embedDtmplToHtml()` produces the marker div from the dtmpl tag.
 *
 * The per-attribute renderHTML overrides return `{}` so Tiptap doesn't emit each
 * attribute as a same-named HTML attribute; the node-level renderHTML below
 * composes the canonical `data-widget`/`data-url`/`data-ratio`/`data-title` set
 * from node.attrs directly, and parseHTML reads those back — lossless round-trip.
 */
export const DtmplEmbedNode = Node.create({
    name:       'dtmplEmbed',
    group:      'block',
    inline:     false,
    atom:       true,
    selectable: true,
    draggable:  true,

    addAttributes() {
        return {
            kind: {
                default: EMBED_KINDS[0],
                parseHTML: (el: HTMLElement) => normalizeKind(el.getAttribute('data-kind')),
                renderHTML: () => ({}),
            },
            url: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-url') ?? '',
                renderHTML: () => ({}),
            },
            ratio: {
                default: EMBED_RATIOS[0],
                parseHTML: (el: HTMLElement) => normalizeRatio(el.getAttribute('data-ratio')),
                renderHTML: () => ({}),
            },
            title: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-title') ?? '',
                renderHTML: () => ({}),
            },
        };
    },

    parseHTML() {
        // Higher priority than any generic div rule so a marker div is claimed
        // by us rather than wrapped as a paragraph.
        return [{ tag: 'div[data-widget="embed"]', priority: 100 }];
    },

    renderHTML({ node, HTMLAttributes }) {
        const attrs = node.attrs as Record<string, unknown>;
        const kind  = normalizeKind(attrs['kind'] as string);
        const url   = String(attrs['url'] ?? '');
        const ratio = normalizeRatio(attrs['ratio'] as string);
        const title = String(attrs['title'] ?? '');
        // Card label: the title, else the URL, else a generic word.
        const label = title !== '' ? title : (url !== '' ? url : 'Embed');
        // Summary shows the kind, plus the ratio for kinds that use one.
        const summary = kindUsesRatio(kind) ? `${kind} · ${ratio}` : kind;

        return ['div', mergeAttributes(HTMLAttributes, {
            'data-widget': 'embed',
            'data-kind':   kind,
            'data-url':    url,
            'data-ratio':  ratio,
            'data-title':  title,
            class:         'cms-embed-placeholder',
        }),
            ['span', { class: 'cms-embed-placeholder__icon' },
                ['i', { class: `bi ${iconForKind(kind)}` }],
            ],
            ['span', { class: 'cms-embed-placeholder__label' }, label],
            ['span', { class: 'cms-embed-placeholder__summary' }, ` (${summary})`],
        ];
    },

    addCommands() {
        return {
            upsertEmbed: (attrs: Partial<EmbedWidgetAttrs>) => ({ chain, state }) => {
                // When the active selection is already on a dtmplEmbed node,
                // patch its attrs in place; otherwise insert a new node.
                const node = (state.selection as { node?: { type?: { name?: string } } }).node;
                if (node?.type?.name === 'dtmplEmbed') {
                    return chain().updateAttributes('dtmplEmbed', attrs).run();
                }
                return chain().insertContent({ type: 'dtmplEmbed', attrs }).run();
            },
        };
    },
});
