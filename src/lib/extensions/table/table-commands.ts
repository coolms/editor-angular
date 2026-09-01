import type { Editor } from '@tiptap/core';
import type { CellAlign } from './table-cell';

/**
 * Generic in-table command vocabulary. The bubble-menu buttons and the
 * `tiptap.tableCommand` action handler both route through {@link runTableCommand}
 * so the command -> Tiptap-chain mapping lives in exactly one place.
 */
export type TableCommand =
    | 'addRowBefore' | 'addRowAfter'
    | 'addColumnBefore' | 'addColumnAfter'
    | 'deleteRow' | 'deleteColumn' | 'deleteTable'
    | 'toggleHeaderRow' | 'mergeCells' | 'splitCell'
    | 'alignLeft' | 'alignCenter' | 'alignRight';

/**
 * Minimal typed view of the Tiptap chain after the table extensions augment
 * it. The stock `@tiptap/extension-table` commands aren't reliably visible on
 * `editor.chain()`'s base type (mirrors TableInsertHandler's local cast for
 * `insertTable`), so we name just the subset we call.
 */
interface TableChain {
    focus(): TableChain;
    run(): boolean;
    addRowBefore(): TableChain;
    addRowAfter(): TableChain;
    addColumnBefore(): TableChain;
    addColumnAfter(): TableChain;
    deleteRow(): TableChain;
    deleteColumn(): TableChain;
    deleteTable(): TableChain;
    toggleHeaderRow(): TableChain;
    mergeCells(): TableChain;
    splitCell(): TableChain;
    setCellAttribute(name: string, value: unknown): TableChain;
}

const ALIGN_BY_COMMAND: Partial<Record<TableCommand, CellAlign>> = {
    alignLeft:   'start',
    alignCenter: 'center',
    alignRight:  'end',
};

/**
 * Run a table command by name against the editor's current selection. Returns
 * the Tiptap command's own boolean (`false` = not applicable here, e.g. merge
 * with no multi-cell selection). Unknown commands warn + no-op.
 *
 * `.focus()` re-asserts the editor selection the bubble menu deliberately kept
 * (its buttons `preventDefault` mousedown), so cell-selection commands like
 * `mergeCells` still see the selected range.
 */
export function runTableCommand(editor: Editor, command: string): boolean {
    const chain = (editor.chain() as unknown as TableChain).focus();

    const align = ALIGN_BY_COMMAND[command as TableCommand];
    if (align) {
        return chain.setCellAttribute('align', align).run();
    }

    switch (command) {
        case 'addRowBefore':    return chain.addRowBefore().run();
        case 'addRowAfter':     return chain.addRowAfter().run();
        case 'addColumnBefore': return chain.addColumnBefore().run();
        case 'addColumnAfter':  return chain.addColumnAfter().run();
        case 'deleteRow':       return chain.deleteRow().run();
        case 'deleteColumn':    return chain.deleteColumn().run();
        case 'deleteTable':     return chain.deleteTable().run();
        case 'toggleHeaderRow': return chain.toggleHeaderRow().run();
        case 'mergeCells':      return chain.mergeCells().run();
        case 'splitCell':       return chain.splitCell().run();
        default:
            console.warn(`[coolms-editor] Unknown table command "${command}"`);
            return false;
    }
}

/** The node name a row height lives on — see {@link ../table/table-row}. */
const TABLE_ROW = 'tableRow';

/**
 * The height stated on the row the caret is in, in points, or null for none.
 *
 * Walks OUT from the selection rather than searching the table: a nested table
 * puts two `tableRow` ancestors on the path, and the caret belongs to the
 * innermost, which is the first one found going up.
 */
export function currentRowHeight(editor: Editor): number | null {
    const $from = editor.state.selection.$from;
    for (let depth = $from.depth; depth > 0; depth--) {
        if (TABLE_ROW === $from.node(depth).type.name) {
            const height = ($from.node(depth).attrs as { height?: number | null }).height;

            return 'number' === typeof height && height > 0 ? height : null;
        }
    }

    return null;
}

/** Whether the caret's row repeats at the top of every page. */
export function currentRowRepeatsHeader(editor: Editor): boolean {
    const $from = editor.state.selection.$from;
    for (let depth = $from.depth; depth > 0; depth--) {
        if (TABLE_ROW === $from.node(depth).type.name) {
            return true === ($from.node(depth).attrs as { repeatHeader?: boolean }).repeatHeader;
        }
    }

    return false;
}

/**
 * Turn the caret's row into one that repeats on every page, or back.
 *
 * On the ROW, like the height and for the same reason: `w:tblHeader` is one
 * fact about the whole row, and `setCellAttribute` would write it to each cell
 * of the selection instead — a place the model has nowhere to put it.
 */
export function setRowRepeatHeader(editor: Editor, repeat: boolean): boolean {
    const { state, view } = editor;
    const $from = state.selection.$from;

    for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (TABLE_ROW !== node.type.name) {
            continue;
        }

        view.dispatch(state.tr.setNodeMarkup($from.before(depth), undefined, {
            ...node.attrs,
            repeatHeader: repeat,
        }));

        return true;
    }

    return false;
}

/**
 * Set or clear the caret's row height, in points.
 *
 * Not a `setCellAttribute`: that writes to every cell of the selection, and a
 * height belongs to the ROW — one number for the whole of it, which is also how
 * `w:trHeight` is stated. `setNodeMarkup` on the row node is the equivalent one
 * level up.
 */
export function setRowHeight(editor: Editor, points: number | null): boolean {
    const { state, view } = editor;
    const $from = state.selection.$from;

    for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (TABLE_ROW !== node.type.name) {
            continue;
        }

        view.dispatch(state.tr.setNodeMarkup($from.before(depth), undefined, {
            ...node.attrs,
            // Null CLEARS, which is the only way back to "as tall as the
            // tallest cell" — there is no separate button for unset.
            height: null !== points && points > 0 ? points : null,
        }));

        return true;
    }

    return false;
}

/** One bubble-menu button. `icon` is a bootstrap-icons class suffix. */
export interface TableMenuButton {
    readonly command: TableCommand;
    readonly icon:    string;
    readonly label:   string;
}

/** Buttons rendered as one separated group in the bubble menu. */
export interface TableMenuGroup {
    readonly key:     string;
    readonly buttons: ReadonlyArray<TableMenuButton>;
}

/**
 * The bubble-menu layout: rows · columns · cells · alignment · table, each a
 * separated group. Labels double as tooltip + aria-label (the toolbar's i18n
 * layer isn't wired for these yet — English fallback, matching the editor's
 * BUILTIN_LABEL_FALLBACKS convention).
 */
export const TABLE_MENU_GROUPS: ReadonlyArray<TableMenuGroup> = [
    {
        key: 'rows',
        buttons: [
            { command: 'addRowBefore', icon: 'bi-arrow-bar-up',   label: 'Insert row above' },
            { command: 'addRowAfter',  icon: 'bi-arrow-bar-down', label: 'Insert row below' },
            { command: 'deleteRow',    icon: 'bi-x-square',       label: 'Delete row' },
        ],
    },
    {
        key: 'cols',
        buttons: [
            { command: 'addColumnBefore', icon: 'bi-arrow-bar-left',  label: 'Insert column left' },
            { command: 'addColumnAfter',  icon: 'bi-arrow-bar-right', label: 'Insert column right' },
            { command: 'deleteColumn',    icon: 'bi-x-square',        label: 'Delete column' },
        ],
    },
    {
        key: 'cells',
        buttons: [
            { command: 'mergeCells',      icon: 'bi-union',        label: 'Merge cells' },
            { command: 'splitCell',       icon: 'bi-layout-split', label: 'Split cell' },
            { command: 'toggleHeaderRow', icon: 'bi-border-top',   label: 'Toggle header row' },
        ],
    },
    {
        key: 'align',
        buttons: [
            { command: 'alignLeft',   icon: 'bi-text-left',   label: 'Align column left' },
            { command: 'alignCenter', icon: 'bi-text-center', label: 'Align column center' },
            { command: 'alignRight',  icon: 'bi-text-right',  label: 'Align column right' },
        ],
    },
    {
        key: 'table',
        buttons: [
            { command: 'deleteTable', icon: 'bi-trash', label: 'Delete table' },
        ],
    },
];
