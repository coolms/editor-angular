import {
    iconForKind, kindUsesRatio, normalizeKind, normalizeRatio, type EmbedKind,
} from './dtmpl-embed-node';

/**
 * Bidirectional HTML <-> dtmpl transform for the DtmplEmbedNode Tiptap atom.
 *
 * On save:  embedHtmlToDtmpl rewrites every `<div data-widget="embed" …>…</div>`
 *           marker into its `{widget:embed:<kind> src=`URL` …}` source form
 *           (kind = video | iframe | audio, carried as the token's `_id`). Audio
 *           omits `ratio` (the backend ignores it) so its round-trip stays exact.
 * On load:  embedDtmplToHtml does the inverse, rebuilding the marker div so
 *           Tiptap's parseHTML can rehydrate DtmplEmbedNode instances.
 *
 * The pair is required to be lossless for the supported attribute set (modulo
 * attribute ordering inside the widget tag) so a save/reload cycle never mutates
 * user content.
 *
 * Param encoding — every value is BACKTICK-delimited (`src=`…` ratio=`…`
 * title=`…``), not double-quoted. The DTMPL tag lexer's only string delimiter is
 * the backtick (Lexer::scanTag); a double-quoted value throws "Unexpected
 * character" -> HTTP 500 at SSR render. Even `ratio` (a digit-led token like
 * `16x9`) must be backtick-quoted — a bare `16x9` lexes as the number `16`
 * followed by an unexpected `x` — which is why the proven render token is
 * `ratio=`4x3`` (EmbedWidgetRenderIntegrationTest), mirroring how the URL must
 * ride `src=` exactly like `{widget:link:url href=…}`.
 *
 * Storage limitation (matching the media/link/formField transforms): a `}` or a
 * lone trailing `\` inside a string value can't be represented; the insert
 * dialog never produces such URLs/titles in practice.
 */

const EMBED_DIV_RE = /<div\b[^>]*\bdata-widget=(["'])embed\1[^>]*>[\s\S]*?<\/div>/gi;
const EMBED_WIDGET_TAG_RE = /\{widget:embed:(video|iframe|audio)\s*([^}]*)\}/gi;
const ATTR_RE = (name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');

function matchAttr(html: string, name: string): string | null {
    const m = ATTR_RE(name).exec(html);
    if (!m) return null;
    return m[1] ?? m[2] ?? m[3] ?? null;
}

/**
 * Escape a string for use inside a BACKTICK-delimited dtmpl param value. The
 * lexer's only in-string escape is `\``, so only literal backticks are escaped;
 * every other character (incl. `:` `/` `?` `=` `&` in URLs) is safe verbatim.
 * The stored value is RAW text — the theme partial HTML-escapes it on output via
 * the `escape` filter, so we must NOT pre-encode here.
 */
function escapeBacktick(s: string): string {
    return s.replace(/`/g, '\\`');
}

/** HTML-attribute escape for the inverse path. */
function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Decode HTML entities back to their literal form. */
function decodeHtmlEntities(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * Parse a dtmpl widget params string into a plain key/value map. Backtick is the
 * canonical (and only lex-safe) delimiter we emit; the double/single-quote
 * branches remain only to read any pre-fix editor draft that still carries
 * quoted params. Mirrors media-widget-transform's parseParams.
 */
function parseParams(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /(\w[\w-]*)\s*=\s*(?:`((?:\\`|[^`])*)`|"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|([^\s}]+))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
        const key = m[1];
        let val = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
        if (m[2] !== undefined) val = val.replace(/\\`/g, '`');
        else if (m[3] !== undefined) val = val.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        else if (m[4] !== undefined) val = val.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        out[key] = val;
    }
    return out;
}

/**
 * Convert editor HTML into stored dtmpl. Rewrites every marker
 * `<div data-widget="embed" …>…</div>` into a `{widget:embed:video …}` tag.
 * A marker without a usable `data-url` passes through unchanged so source-mode
 * editing doesn't silently drop content.
 */
export function embedHtmlToDtmpl(html: string): string {
    return html.replace(EMBED_DIV_RE, (match) => {
        const url = matchAttr(match, 'data-url');
        if (!url || url === '') return match; // malformed: keep as-is

        const kind  = normalizeKind(matchAttr(match, 'data-kind'));
        const ratio = normalizeRatio(matchAttr(match, 'data-ratio'));
        const title = decodeHtmlEntities(matchAttr(match, 'data-title') ?? '').trim();

        // All params backtick-delimited (the lexer's only string form); values
        // are RAW text the theme partial escapes once on output.
        const params: string[] = [`src=\`${escapeBacktick(decodeHtmlEntities(url))}\``];
        // Audio carries no aspect ratio (the backend ignores it) — omit so the
        // round-trip is lossless for audio tokens.
        if (kindUsesRatio(kind)) params.push(`ratio=\`${ratio}\``);
        if (title !== '') params.push(`title=\`${escapeBacktick(title)}\``);

        return `{widget:embed:${kind} ${params.join(' ')}}`;
    });
}

/**
 * Convert stored dtmpl into editor HTML by replacing each
 * `{widget:embed:video …}` with a marker `<div data-widget="embed">` placeholder
 * that DtmplEmbedNode's parseHTML rule rehydrates into a node. A tag without a
 * `src` passes through verbatim so authors can spot + fix it in source view.
 *
 * The produced markup mirrors DtmplEmbedNode.renderHTML so the source -> visual
 * round-trip is stable even before Tiptap re-runs the node renderer.
 */
export function embedDtmplToHtml(content: string): string {
    return content.replace(EMBED_WIDGET_TAG_RE, (full, type: string, paramsStr: string | undefined) => {
        const params = parseParams(paramsStr ?? '');
        const url = params['src'] ?? '';
        if (url === '') return full; // malformed (no src): keep so author can fix

        const kind: EmbedKind = normalizeKind(type);
        const ratio = normalizeRatio(params['ratio']);
        const title = params['title'] ?? '';
        const label = title !== '' ? title : url;
        const summary = kindUsesRatio(kind) ? `${kind} · ${ratio}` : kind;

        const dataAttrs: string[] = [
            ` data-widget="embed"`,
            ` data-kind="${escapeAttr(kind)}"`,
            ` data-url="${escapeAttr(url)}"`,
            ` data-ratio="${escapeAttr(ratio)}"`,
            ` data-title="${escapeAttr(title)}"`,
        ];

        return `<div${dataAttrs.join('')} class="cms-embed-placeholder">`
            + `<span class="cms-embed-placeholder__icon"><i class="bi ${iconForKind(kind)}"></i></span>`
            + `<span class="cms-embed-placeholder__label">${escapeAttr(label)}</span>`
            + `<span class="cms-embed-placeholder__summary"> (${escapeAttr(summary)})</span>`
            + `</div>`;
    });
}
