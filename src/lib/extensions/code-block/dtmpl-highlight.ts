import type { HLJSApi, Language } from 'highlight.js';

/**
 * DTMPL tag keywords — the highlightable token set of the platform's PHP-only
 * template language (`{var:…}`, `{if:…}`, `{widget:…}`, `{verbatim}…{endverbatim}`).
 *
 * SOURCE OF TRUTH: `src/DTMPL/Domain/Lexer/Lexer.php` `KEYWORDS` map. Keep this
 * list in sync when the lexer gains/drops a keyword. A grammar that lags the
 * lexer only mis-colours a snippet — it never affects rendering — so this is a
 * cosmetic mirror, not a correctness dependency.
 *
 * NOTE: this file is intentionally duplicated, byte-for-byte in spirit, into
 * the highlighter the SSR theme ships.
 * There is no shared npm workspace across the admin SPA and the themes, so the
 * grammar ships as a self-contained highlight.js `LanguageFn` that any frontend
 * (lowlight in the editor, highlight.js in a theme, a future SPA) can register.
 */
export const DTMPL_KEYWORDS: ReadonlyArray<string> = [
    'var', 'loop', 'endloop', 'item',
    'if', 'endif', 'ifno', 'unless', 'endno', 'endunless', 'else',
    'def', 'define', 'include', 'endinclude',
    'slot', 'endslot', 'fill', 'endfill',
    'widget', 'const', 't',
];

/**
 * highlight.js / lowlight language definition for DTMPL. A hand-written grammar
 * over the known token set (the prompt's spec) — deliberately a *snippet*
 * highlighter, not a full reimplementation of the lexer: it colours the common
 * surface (tags, keywords, filters, strings, operators, variable paths) and
 * does not track brace-nesting depth, which is irrelevant for display.
 *
 * Register with:  lowlight.register('dtmpl', dtmpl)  /  hljs.registerLanguage('dtmpl', dtmpl)
 */
export function dtmpl(_hljs: HLJSApi): Language {
    const kwAlt = DTMPL_KEYWORDS.join('|');

    // `\`backtick string\`` — DTMPL's only string literal form, with \` escape.
    const STRING = {
        scope: 'string',
        begin: '`',
        end: '`',
        contains: [{ begin: /\\`/ }],
    };

    const NUMBER = { scope: 'number', begin: /\b\d+(?:\.\d+)?\b/ };

    // `| filter` / `| php.fn` — the pipe is an operator, the filter name a
    // built-in. Group 2 (whitespace) is left unscoped.
    const FILTER = {
        match: [/\|/, /\s*/, /(?:php\.)?[A-Za-z_]\w*/],
        scope: { 1: 'operator', 3: 'built_in' },
    };

    // `@alias` entity-alias prefix (tag-body only in the lexer; harmless here).
    const ALIAS = { scope: 'symbol', begin: /@[A-Za-z_]\w*/ };

    // Comparison + separators. `|` is intentionally absent — FILTER owns it.
    const OPERATOR = { scope: 'operator', begin: /!=|>=|<=|[=><:,.[\]]/ };

    // Dotted variable path (`page.extras.author`), but never a leading tag
    // keyword — the negative look-ahead lets the keyword scanner colour
    // `var`/`if`/… while `varName` (not a bare keyword) still reads as a var.
    const VARIABLE = {
        scope: 'variable',
        begin: new RegExp('\\b(?!(?:' + kwAlt + ')\\b)[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)*'),
    };

    // A tag region: `{` immediately followed by a keyword … up to the first `}`.
    // The opening `{` only enters tag mode when a keyword follows (mirrors the
    // lexer's `isTagStart`), so literal `{` in prose stays plain text.
    const TAG = {
        begin: new RegExp('\\{(?=(?:' + kwAlt + ')\\b)'),
        beginScope: 'punctuation',
        end: /\}/,
        endScope: 'punctuation',
        keywords: { keyword: [...DTMPL_KEYWORDS], literal: ['true', 'false'] },
        contains: [STRING, NUMBER, FILTER, ALIAS, OPERATOR, VARIABLE],
    };

    return {
        name: 'DTMPL',
        aliases: ['dtmpl'],
        case_insensitive: false,
        contains: [
            // `{{` / `}}` literal-brace escapes.
            { match: /\{\{|\}\}/, scope: 'meta' },
            // `{verbatim}` / `{endverbatim}` markers (interior stays plain).
            { match: /\{(?:verbatim|endverbatim)\}/, scope: 'meta' },
            TAG,
        ],
    };
}
