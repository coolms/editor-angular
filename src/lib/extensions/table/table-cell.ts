import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

/**
 * Column-alignment cell extensions. The stock `@tiptap/extension-table-cell` /
 * `-table-header` carry `colspan` / `rowspan` / `colwidth`; we add one more
 * attribute, `align`, that round-trips a Bootstrap text-alignment class on the
 * `<td>` / `<th>`.
 *
 * Why a class and not inline `style`: the server-side HtmlProfileSanitizer
 * (`block:table` case) allows `class` on td/th but deliberately strips `style`
 * (it would reopen CSS injection). Bootstrap's reboot + `theme-default` already
 * style `.text-start` / `.text-center` / `.text-end`, so the alignment survives
 * the sanitizer AND renders identically on the public page.
 *
 * The bubble menu's align buttons drive this through Tiptap's generic
 * `setCellAttribute('align', …)` command (see {@link ./table-commands}) — no
 * custom command needed; the attribute's render/parse pair does the class
 * mapping. `setCellAttribute` writes the attr to every cell in the current
 * cell-selection, so selecting a column then "align center" aligns the column.
 */
export type CellAlign = 'start' | 'center' | 'end';

const ALIGN_TO_CLASS: Readonly<Record<CellAlign, string>> = {
    start:  'text-start',
    center: 'text-center',
    end:    'text-end',
};

const CLASS_TO_ALIGN: Readonly<Record<string, CellAlign>> = {
    'text-start':  'start',
    'text-center': 'center',
    'text-end':    'end',
};

/** Bootstrap alignment class for an align value (empty string when unset). */
export function alignClass(align: CellAlign | null): string {
    return align ? ALIGN_TO_CLASS[align] : '';
}

/** Recover the align value from a cell element's class list (null when none). */
function alignFromElement(el: HTMLElement): CellAlign | null {
    for (const cls of Array.from(el.classList)) {
        const align = CLASS_TO_ALIGN[cls];
        if (align) return align;
    }
    return null;
}

/**
 * The `align` attribute, shared by the cell + header extensions. `parseHTML`
 * reads the `text-*` class on load; `renderHTML` re-emits only it, so
 * `getHTML()` stores `<td class="text-center">` — sanitizer-clean + theme-styled.
 */
const alignAttribute = () => ({
    align: {
        default: null as CellAlign | null,
        parseHTML: (el: HTMLElement): CellAlign | null => alignFromElement(el),
        renderHTML: (attrs: Record<string, unknown>): Record<string, string> => {
            const cls = alignClass(attrs['align'] as CellAlign | null);
            return cls ? { class: cls } : {};
        },
    },
});

/** Stock TableCell + the `align` attribute. */
export const CmsTableCell = TableCell.extend({
    addAttributes() {
        return { ...this.parent?.(), ...alignAttribute() };
    },
});

/** Stock TableHeader + the `align` attribute (so a header column aligns too). */
export const CmsTableHeader = TableHeader.extend({
    addAttributes() {
        return { ...this.parent?.(), ...alignAttribute() };
    },
});
