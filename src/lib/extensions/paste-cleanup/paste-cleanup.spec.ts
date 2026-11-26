import { type Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { cleanPastedHtml, looksLikeOfficeOrDocs } from './paste-cleanup';
import { parsePastedText } from './paste-text';

/**
 * Spec for the Word / Google-Docs paste cleanup.
 *
 * The `cleanPastedHtml` cases need a DOM (`DOMParser`) and so pin real browser
 * behaviour; `looksLikeOfficeOrDocs` is a pure string check.
 *
 * Key invariants:
 *   - only Word / Docs HTML is rewritten; everything else (incl. intra-editor
 *     widget copies) passes through untouched;
 *   - mso cruft, conditional comments, empty filler paragraphs are removed;
 *   - Google-Docs style-encoded bold/italic/underline survive as <strong>/
 *     <em>/<u>; spans are unwrapped; presentational attributes are stripped;
 *   - headings / lists / links are preserved.
 */

describe('looksLikeOfficeOrDocs', () => {
    it('flags Word markup', () => {
        expect(looksLikeOfficeOrDocs('<p class="MsoNormal">x</p>')).toBe(true);
        expect(looksLikeOfficeOrDocs('<o:p></o:p>')).toBe(true);
        expect(looksLikeOfficeOrDocs('<span style="mso-bidi-font-weight:bold">x</span>')).toBe(true);
    });

    it('flags Google Docs markup', () => {
        expect(looksLikeOfficeOrDocs('<b id="docs-internal-guid-abc"><span>x</span></b>')).toBe(true);
    });

    it('leaves ordinary / intra-editor HTML alone', () => {
        expect(looksLikeOfficeOrDocs('<p>hello <strong>world</strong></p>')).toBe(false);
        expect(looksLikeOfficeOrDocs('<div class="callout callout-note">note</div>')).toBe(false);
    });
});

describe('cleanPastedHtml', () => {
    it('returns non-Office HTML unchanged', () => {
        const html = '<div data-widget="media" class="cms-grid"><p>x</p></div>';
        expect(cleanPastedHtml(html)).toBe(html);
    });

    it('strips mso styles, classes and empty filler paragraphs from Word', () => {
        const word = `
            <p class="MsoNormal" style="margin:0in;mso-pagination:none">Hello <b>bold</b></p>
            <p class="MsoNormal" style="mso-pagination:none">&nbsp;</p>
            <o:p></o:p>`;
        const out = cleanPastedHtml(word);
        expect(out).toContain('Hello');
        expect(out).toContain('<b>bold</b>');
        expect(out).not.toContain('Mso');
        expect(out).not.toContain('mso-');
        expect(out).not.toContain('class=');
        expect(out).not.toContain('o:p');
        // The &nbsp;-only filler paragraph is gone.
        expect(out.match(/<p>/g) ?? []).toHaveSize(1);
    });

    it('converts Google-Docs style-encoded emphasis to semantic tags', () => {
        const docs = `<b id="docs-internal-guid-1">
            <span style="font-weight:700">heavy</span>
            <span style="font-style:italic">slanted</span>
            <span style="text-decoration:underline">under</span>
            <span style="font-weight:400">plain</span>
        </b>`;
        const out = cleanPastedHtml(docs);
        expect(out).toContain('<strong>heavy</strong>');
        expect(out).toContain('<em>slanted</em>');
        expect(out).toContain('<u>under</u>');
        expect(out).toContain('plain');
        expect(out).not.toContain('<span');
        expect(out).not.toContain('style=');
    });

    it('preserves headings, lists and links', () => {
        const word = `<div class="MsoNormal">
            <h2 style="mso-pagination:none">Title</h2>
            <ul style="mso-list:l0"><li class="MsoListParagraph">one</li><li>two</li></ul>
            <a href="https://example.com" style="color:#06c">link</a>
        </div>`;
        const out = cleanPastedHtml(word);
        expect(out).toContain('<h2>Title</h2>');
        expect(out).toContain('<li>one</li>');
        expect(out).toContain('<li>two</li>');
        expect(out).toContain('href="https://example.com"');
        expect(out).not.toContain('style=');
    });

    it('drops javascript: hrefs', () => {
        const word = '<p class="MsoNormal"><a href="javascript:alert(1)">x</a></p>';
        const out = cleanPastedHtml(word);
        expect(out).toContain('<a>x</a>');
        expect(out).not.toContain('javascript:');
    });

    it('normalises smart quotes only when asked', () => {
        const word = '<p class="MsoNormal">“hi” ‘there’</p>';
        expect(cleanPastedHtml(word)).toContain('“hi”');
        expect(cleanPastedHtml(word, { normalizeSmartQuotes: true })).toContain('"hi" \'there\'');
    });
});

describe('parsePastedText', () => {
    const schema = new Schema({
        nodes: {
            doc: { content: 'block+' },
            paragraph: { group: 'block', content: 'inline*' },
            codeBlock: { group: 'block', content: 'text*', code: true, marks: '' },
            text: { group: 'inline' },
            hardBreak: { group: 'inline', inline: true },
        },
    });
    const doc = schema.node('doc', null, [schema.node('paragraph'), schema.node('codeBlock')]);
    const inParagraph = doc.resolve(1);
    const inCode = doc.resolve(doc.child(0).nodeSize + 1);
    /** The slice as text: a paragraph per line of the answer, a line break as |. */
    const shape = (text: string): string[] => {
        const slice = parsePastedText(text, schema, inParagraph)!;
        const out: string[] = [];
        slice.content.forEach((p: ProseMirrorNode) => {
            let line = '';
            p.forEach(n => { line += n.type.name === 'hardBreak' ? '|' : n.text; });
            out.push(p.type.name + ':' + line);
        });
        return out;
    };

    it('keeps a single line break as a line break, in one paragraph', () => {
        expect(shape('Pasted one\nsame paragraph')).toEqual(['paragraph:Pasted one|same paragraph']);
    });

    it('starts a new paragraph at a blank line, a line of spaces or several blank lines being one', () => {
        expect(shape('Pasted one\nsame paragraph\n\nnext paragraph')).toEqual(['paragraph:Pasted one|same paragraph', 'paragraph:next paragraph']);
        expect(shape('a\n \t\nb')).toEqual(['paragraph:a', 'paragraph:b']);
        expect(shape('a\n\n\n\nb')).toEqual(['paragraph:a', 'paragraph:b']);
    });

    it('reads Windows and old Mac line ends as line breaks, and drops blank lines at either end', () => {
        expect(shape('\r\n\r\na\r\nb\r\rc\n\n')).toEqual(['paragraph:a|b', 'paragraph:c']);
    });

    it('keeps an empty line inside a paragraph out of it: two breaks only come from a typed one', () => {
        expect(shape('a\n\nb')).not.toContain('paragraph:a||b');
    });

    it('opens the slice, so the first and last paragraphs join the ones the paste lands in', () => {
        const slice = parsePastedText('a\n\nb', schema, inParagraph)!;
        expect([slice.openStart, slice.openEnd]).toEqual([1, 1]);
    });

    it('puts text into a code block as it is, line breaks and blank lines included', () => {
        const slice = parsePastedText('a\n\nb', schema, inCode)!;
        expect(slice.content.childCount).toBe(1);
        expect(slice.content.firstChild!.text).toBe('a\n\nb');
    });

    it('answers nothing for an empty paste, and leaves a schema without paragraphs to the editor', () => {
        expect(parsePastedText('\n\n', schema, inParagraph)!.size).toBe(0);
        const bare = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
        expect(parsePastedText('a', bare, bare.node('doc').resolve(0))).toBeNull();
    });
});
