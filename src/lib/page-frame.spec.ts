import { pageMarginsOf, type PageGeometry } from './editor.component';

/**
 * The frame the paged canvas writes on.
 *
 * Until #2293 it was a fixed 20mm whatever the document said, so a `.ddoc` with
 * one-inch margins — the default a new document is minted with — paginated on
 * screen against a writing width 9mm wider than the one its `.docx` gives it.
 * Nothing on a single page; a line by the end of a long one, and the difference
 * grows with every page because each one starts from the previous page's error.
 *
 * ⚠️ The fallback is what these assertions are really about. It has to exist
 * (page content and document templates state no margins, and their pagination
 * must not move) and it has to happen in ONE place, or the browser lays the
 * text out to one frame while the engine measures another.
 */
describe('the paged canvas frame', () => {
    const a4 = (margins?: PageGeometry['margins']): PageGeometry =>
        ({ width: '210mm', height: '297mm', margins });

    it('is the document\'s own margins when it states them', () => {
        const margins = { top: '25.4mm', right: '19.05mm', bottom: '25.4mm', left: '19.05mm' };

        expect(pageMarginsOf(a4(margins))).toEqual(margins);
    });

    /**
     * Word's default, and what every page and template paginated against before
     * margins were expressible. Changing this number moves the page boundaries
     * of content nobody edited.
     */
    it('is 20mm all round for a document that states none', () => {
        expect(pageMarginsOf(a4())).toEqual({
            top: '20mm', right: '20mm', bottom: '20mm', left: '20mm',
        });
    });

    /**
     * ⚠️ The sides are NOT interchangeable. Word's Moderate preset is an inch
     * top and bottom and three quarters left and right, and a frame that
     * mirrored the wrong pair would give the author a writing width the file
     * does not have — the exact failure a fixed frame already was.
     */
    it('keeps each side on its own side', () => {
        const frame = pageMarginsOf(a4({
            top: '1mm', right: '2mm', bottom: '3mm', left: '4mm',
        }));

        expect(frame.top).toBe('1mm');
        expect(frame.right).toBe('2mm');
        expect(frame.bottom).toBe('3mm');
        expect(frame.left).toBe('4mm');
    });
});
