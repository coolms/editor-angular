/**
 * Word / Google-Docs paste cleanup. A pure HTML->HTML transform
 * wired into the editor via `props.transformPastedHTML` (see
 * `paste-cleanup-extension.ts`).
 *
 * Design: only HTML that *looks* like it came from Word or Google Docs is
 * rewritten. Everything else — including copy/paste *within* the editor, where
 * our own widget markup (`class="callout …"`, `data-widget`, grid/table
 * structure) must survive — passes through untouched, leaving ProseMirror's
 * schema-aware parser in charge. The backend `HtmlProfileSanitizer` remains
 * authoritative on save; this is an editor-side ergonomics pass.
 *
 * What it does to Office/Docs HTML:
 *   - drops cruft tags (`<style>`, `<xml>`, `<o:p>`, `<w:…>`, conditional
 *     comments) and all comment nodes;
 *   - converts Google-Docs style-encoded emphasis (`<span style="font-weight:
 *     700">` -> `<strong>`, italic -> `<em>`, underline -> `<u>`, line-through ->
 *     `<s>`) BEFORE stripping styles, so bold/italic survive;
 *   - unwraps the leftover `<span>` / `<font>` wrappers;
 *   - strips presentational attributes (`style`, `class`, `lang`, …), keeping
 *     only structural ones (`href`, `src`/`alt`, `colspan`/`rowspan`);
 *   - removes the empty `MsoNormal` filler paragraphs Word emits;
 *   - optionally normalises smart quotes (off by default — they are valid
 *     content).
 *
 * Headings, lists, links, tables and inline emphasis are preserved throughout.
 */

export interface PasteCleanupOptions {
    /** Convert “smart” quotes / apostrophes to straight ones. Default: false. */
    readonly normalizeSmartQuotes?: boolean;
}

/** Tags removed outright (with their contents) from pasted Office/Docs HTML. */
const DROP_TAGS = new Set(['STYLE', 'SCRIPT', 'META', 'LINK', 'TITLE', 'XML', 'BASE']);

/** Per-tag attribute allow-list; any element not listed has every attribute stripped. */
const KEEP_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = {
    A:   new Set(['href', 'title']),
    IMG: new Set(['src', 'alt', 'title']),
    TD:  new Set(['colspan', 'rowspan']),
    TH:  new Set(['colspan', 'rowspan']),
};

/**
 * Heuristic: does this clipboard HTML originate from MS Word or Google Docs?
 * Pure string check — safe to call in any environment and unit-testable
 * without a DOM.
 */
export function looksLikeOfficeOrDocs(html: string): boolean {
    return /(?:class=["']?Mso|mso-[a-z-]+\s*:|<\/?o:p|urn:schemas-microsoft-com|docs-internal-guid|<\/?w:|<\/?v:|panose-1)/i.test(html);
}

/**
 * Clean a pasted HTML string. Returns the input unchanged when it is not
 * recognisably from Word / Google Docs.
 */
export function cleanPastedHtml(html: string, options: PasteCleanupOptions = {}): string {
    if (html.trim() === '' || !looksLikeOfficeOrDocs(html)) return html;

    // Strip downlevel conditional comments (`<![if !supportLists]>…<![endif]>`)
    // up front — they are not real comment nodes and confuse the parser.
    const pre = html.replace(/<!\[(?:end)?if[^\]]*\]>/gi, '');

    const doc = new DOMParser().parseFromString(pre, 'text/html');
    const body = doc.body;

    dropCruftTags(body);
    dropComments(doc, body);
    convertAndUnwrapInlineWrappers(doc, body);
    stripAttributes(body);
    removeEmptyParagraphs(body);
    if (options.normalizeSmartQuotes === true) normalizeQuotes(doc, body);

    return body.innerHTML.trim();
}

/** Remove cruft tags + any namespaced element (`o:p`, `w:…`, `v:…`). */
function dropCruftTags(root: HTMLElement): void {
    for (const el of Array.from(root.querySelectorAll('*'))) {
        if (DROP_TAGS.has(el.tagName) || el.tagName.includes(':')) {
            el.remove();
        }
    }
}

function dropComments(doc: Document, root: HTMLElement): void {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
    const comments: Comment[] = [];
    let node = walker.nextNode();
    while (node) {
        comments.push(node as Comment);
        node = walker.nextNode();
    }
    for (const c of comments) c.remove();
}

/**
 * Convert style-encoded emphasis on `<span>`/`<font>` into semantic tags, then
 * unwrap the wrapper. Processes a static snapshot in document order; unwrapped
 * children stay in the tree, so nested wrappers are still handled.
 */
function convertAndUnwrapInlineWrappers(doc: Document, root: HTMLElement): void {
    for (const el of Array.from(root.querySelectorAll('span, font'))) {
        const parent = el.parentNode;
        if (!parent) continue;
        const tags = emphasisTags(el.getAttribute('style') ?? '');
        if (tags.length > 0) {
            let outer: HTMLElement | null = null;
            let inner: HTMLElement | null = null;
            for (const tag of tags) {
                const wrap = doc.createElement(tag);
                if (!outer) { outer = wrap; inner = wrap; } else { inner!.appendChild(wrap); inner = wrap; }
            }
            while (el.firstChild) inner!.appendChild(el.firstChild);
            parent.insertBefore(outer!, el);
        } else {
            while (el.firstChild) parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
    }
}

/** Semantic tags implied by an inline style string, outermost first. */
function emphasisTags(style: string): string[] {
    const decls = parseStyle(style);
    const tags: string[] = [];
    const weight = decls['font-weight'];
    // Number('') is 0 and Number('normal') is NaN, so a non-numeric / missing
    // weight never trips the >= 600 branch — no explicit undefined guard needed.
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) {
        tags.push('strong');
    }
    const fontStyle = decls['font-style'];
    if (fontStyle === 'italic' || fontStyle === 'oblique') tags.push('em');
    const deco = `${decls['text-decoration'] ?? ''} ${decls['text-decoration-line'] ?? ''}`;
    if (deco.includes('underline')) tags.push('u');
    if (deco.includes('line-through')) tags.push('s');
    return tags;
}

function parseStyle(style: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const decl of style.split(';')) {
        const idx = decl.indexOf(':');
        if (idx === -1) continue;
        const key = decl.slice(0, idx).trim().toLowerCase();
        const value = decl.slice(idx + 1).trim().toLowerCase();
        if (key !== '') out[key] = value;
    }
    return out;
}

/** Strip every attribute not on the per-tag allow-list; drop `javascript:` links. */
function stripAttributes(root: HTMLElement): void {
    for (const el of Array.from(root.querySelectorAll('*'))) {
        const keep = KEEP_ATTRS[el.tagName] ?? EMPTY_SET;
        for (const attr of Array.from(el.attributes)) {
            if (!keep.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
        }
        const href = el.getAttribute('href');
        if (href !== null && /^\s*javascript:/i.test(href)) el.removeAttribute('href');
    }
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** Remove paragraphs that hold only whitespace / `&nbsp;` and no element children. */
function removeEmptyParagraphs(root: HTMLElement): void {
    for (const p of Array.from(root.querySelectorAll('p'))) {
        if (p.children.length === 0 && p.textContent.replace(/ /g, '').trim() === '') {
            p.remove();
        }
    }
}

function normalizeQuotes(doc: Document, root: HTMLElement): void {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        node.nodeValue = (node.nodeValue ?? '')
            .replace(/[‘’‚‛]/g, "'")
            .replace(/[“”„‟]/g, '"');
        node = walker.nextNode();
    }
}
