import { Overlay, type ConnectedPosition, type OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Injector } from '@angular/core';
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import {
    TABLE_BUBBLE_MENU_DATA, TableBubbleMenuComponent, type TableBubbleMenuData,
} from './table-bubble-menu.component';

const TABLE_CONTROLS_KEY = new PluginKey('coolmsTableControls');

/** Centered above the table, flipping below when there's no room. */
const MENU_POSITIONS: ConnectedPosition[] = [
    { originX: 'center', originY: 'top',    overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
    { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top',    offsetY:  8 },
];

/**
 * ProseMirror plugin view that shows {@link TableBubbleMenuComponent} in a CDK
 * overlay while the selection sits inside a table, and tears it down when it
 * leaves.
 *
 * A custom overlay (not `@tiptap/extension-bubble-menu`) keeps us off a new
 * tippy dependency and reuses the same CDK Overlay the grid / table pickers
 * already use. No backdrop — the user keeps typing in the table with the menu
 * open; the menu re-anchors only when the selection moves to a *different*
 * table, so adding rows/columns doesn't flicker it.
 */
class TableBubbleMenuController {
    private readonly overlay: Overlay;
    private overlayRef: OverlayRef | null = null;
    private anchorEl: HTMLElement | null = null;

    constructor(private readonly editor: Editor, private readonly injector: Injector) {
        this.overlay = injector.get(Overlay);
    }

    update(view: EditorView): void {
        const anchor = this.editor.isEditable ? this.findTableElement(view) : null;
        if (!anchor) {
            this.close();
            return;
        }
        if (this.overlayRef && this.anchorEl === anchor) {
            return; // same table, already shown
        }
        this.close(); // first show, or the selection jumped to another table
        this.open(anchor);
    }

    destroy(): void {
        this.close();
    }

    private open(anchor: HTMLElement): void {
        const positionStrategy = this.overlay.position()
            .flexibleConnectedTo(anchor)
            .withPositions(MENU_POSITIONS)
            .withPush(true);

        this.overlayRef = this.overlay.create({
            positionStrategy,
            hasBackdrop: false,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
        });

        const data: TableBubbleMenuData = { editor: this.editor };
        const childInjector = Injector.create({
            providers: [{ provide: TABLE_BUBBLE_MENU_DATA, useValue: data }],
            parent: this.injector,
        });
        this.overlayRef.attach(new ComponentPortal(TableBubbleMenuComponent, null, childInjector));
        this.anchorEl = anchor;
    }

    private close(): void {
        if (this.overlayRef) {
            this.overlayRef.dispose();
            this.overlayRef = null;
        }
        this.anchorEl = null;
    }

    /**
     * The DOM element bounding the table the selection is in, or null. Tiptap's
     * resizable table renders a `.tableWrapper` div around the `<table>`;
     * `nodeDOM(pos)` returns that wrapper, which is a stable overlay anchor
     * (the wrapper NodeView persists across in-table edits).
     */
    private findTableElement(view: EditorView): HTMLElement | null {
        const { $from } = view.state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
            if ($from.node(depth).type.name === 'table') {
                const dom = view.nodeDOM($from.before(depth));
                if (dom instanceof HTMLElement) {
                    return dom;
                }
            }
        }
        return null;
    }
}

/**
 * `tableControls` extension — declared by the `block:table` contributor so it
 * loads exactly when tables are enabled for a profile. Adds the bubble-menu
 * plugin; carries no schema of its own. The Angular `injector` (captured by
 * `provideCoolmsEditor`) lets the plugin reach CDK Overlay without coupling the
 * generic editor host to table-specific logic.
 */
export function createTableControls(injector: Injector): Extension {
    return Extension.create({
        name: 'tableControls',
        addProseMirrorPlugins() {
            const editor = this.editor;
            return [
                new Plugin({
                    key: TABLE_CONTROLS_KEY,
                    view: (view: EditorView) => {
                        const controller = new TableBubbleMenuController(editor, injector);
                        controller.update(view);
                        return controller;
                    },
                }),
            ];
        },
    });
}
