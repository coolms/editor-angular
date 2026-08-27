import {
    type ConnectedPosition, Overlay, type OverlayRef,
    type FlexibleConnectedPositionStrategyOrigin,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { Injector, signal, type WritableSignal } from '@angular/core';
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { filterSlashItems, groupSlashItems } from './slash-command-filter';
import { SLASH_MENU_DATA, SlashMenuComponent, type SlashMenuData } from './slash-menu.component';
import type { SlashCommandGroup, SlashCommandItem, SlashMenuConfig } from './slash-menu-types';

const SLASH_KEY = new PluginKey<SlashTriggerState>('coolmsSlashMenu');

/** Caret-anchored, flips above when there's no room below. */
const MENU_POSITIONS: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top',    offsetY: 4 },
    { originX: 'start', originY: 'top',    overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
];

interface SlashTriggerState {
    /** A `/`-trigger is present at the caret. */
    readonly active:    boolean;
    /** Document range covering `/query` (inclusive of the slash). */
    readonly range:     { from: number; to: number } | null;
    /** Text typed after the slash. */
    readonly query:     string;
    /** User pressed Escape on this exact trigger — stay closed until it changes. */
    readonly dismissed: boolean;
}

const INACTIVE: SlashTriggerState = { active: false, range: null, query: '', dismissed: false };

/**
 * Inspect the selection for a live `/`-trigger: an empty caret in a non-code
 * textblock, immediately preceded by `/word` where the slash sits at the block
 * start or after whitespace. Returns the matched range + query, or INACTIVE.
 */
function readTrigger(state: EditorState): SlashTriggerState {
    const { selection } = state;
    if (!selection.empty) return INACTIVE;
    const { $from } = selection;
    const parent = $from.parent;
    if (!parent.isTextblock || parent.type.spec.code === true) return INACTIVE;

    // Text from the block start to the caret. Atoms count as one char
    // (￼ placeholder) so content offsets map 1:1 onto positions.
    const textBefore = parent.textBetween(0, $from.parentOffset, undefined, '￼');
    const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore);
    if (!match) return INACTIVE;

    const query = match[1];
    const slashOffset = match.index + match[0].indexOf('/');
    const from = $from.start() + slashOffset;
    return { active: true, range: { from, to: $from.pos }, query, dismissed: false };
}

/**
 * Reactive bridge between the ProseMirror plugin and the Angular popup. Owns
 * the CDK overlay + the signals the {@link SlashMenuComponent} renders from,
 * and runs the chosen command back through the host's action bridge.
 */
class SlashMenuController {
    private readonly overlay: Overlay;
    private overlayRef: OverlayRef | null = null;

    private readonly groupsSig: WritableSignal<ReadonlyArray<SlashCommandGroup>> = signal([]);
    private readonly activeSig: WritableSignal<number> = signal(0);
    /** Filtered items in display order — the flat list keyboard nav indexes into. */
    private flat: ReadonlyArray<SlashCommandItem> = [];

    constructor(
        private readonly editor: Editor,
        private readonly config: SlashMenuConfig,
    ) {
        this.overlay = config.injector.get(Overlay);
    }

    update(view: EditorView): void {
        const state = SLASH_KEY.getState(view.state);
        if (!this.editor.isEditable || !state || !state.active || state.dismissed || !state.range) {
            this.close();
            return;
        }
        const filtered = filterSlashItems(this.config.items(), state.query);
        if (filtered.length === 0) {
            // No match for the current query — hide rather than show an empty
            // box, so `/` followed by gibberish (or a literal path) lets Enter
            // and Space fall through to normal editing.
            this.close();
            return;
        }
        this.flat = filtered;
        this.groupsSig.set(groupSlashItems(filtered));
        this.activeSig.set(Math.min(this.activeSig(), filtered.length - 1));
        this.open(view, state.range.from);
    }

    destroy(): void {
        this.close();
    }

    isOpen(): boolean {
        return this.overlayRef !== null;
    }

    /** Arrow navigation: wraps around the flat list. */
    move(delta: number): void {
        const n = this.flat.length;
        if (n === 0) return;
        this.activeSig.set((this.activeSig() + delta + n) % n);
    }

    setActive(flatIndex: number): void {
        if (flatIndex >= 0 && flatIndex < this.flat.length) this.activeSig.set(flatIndex);
    }

    /** Enter / Tab: run the highlighted item. Returns false (passthrough) when
     *  there's nothing to run so the key keeps its normal behaviour. */
    confirm(): boolean {
        const idx = this.activeSig();
        if (idx < 0 || idx >= this.flat.length) return false;
        this.runItem(this.flat[idx]);
        return true;
    }

    /** Click handler from the popup. */
    pick(item: SlashCommandItem): void {
        this.runItem(item);
    }

    /** Escape: dismiss this trigger (text stays) via a plugin meta. */
    dismiss(view: EditorView): void {
        view.dispatch(view.state.tr.setMeta(SLASH_KEY, { dismiss: true }));
        this.close();
    }

    private runItem(item: SlashCommandItem): void {
        const state = SLASH_KEY.getState(this.editor.view.state);
        const range = state?.range;
        this.close();
        // Remove the `/query` text, then dispatch the command at that spot so
        // headings/lists retype the now-empty block and inserts land cleanly.
        if (range) {
            this.editor.chain().focus().deleteRange(range).run();
        } else {
            this.editor.chain().focus().run();
        }
        this.config.onSelect(item.node);
    }

    /**
     * Open the popup (or, if already open, re-anchor it to the caret as the
     * query grows). The position strategy is built from the caret *before*
     * the overlay is created, so the popup never flashes at the viewport
     * origin on first open.
     */
    private open(view: EditorView, pos: number): void {
        const strategy = this.caretStrategy(view, pos);
        if (this.overlayRef) {
            this.overlayRef.updatePositionStrategy(strategy);
            return;
        }
        this.overlayRef = this.overlay.create({
            positionStrategy: strategy,
            hasBackdrop: false,
            scrollStrategy: this.overlay.scrollStrategies.reposition(),
        });
        this.activeSig.set(0);
        const data: SlashMenuData = {
            groups:      this.groupsSig.asReadonly(),
            activeIndex: this.activeSig.asReadonly(),
            pick:        (item) => this.pick(item),
            hover:       (i) => this.setActive(i),
        };
        const childInjector = Injector.create({
            providers: [{ provide: SLASH_MENU_DATA, useValue: data }],
            parent: this.config.injector,
        });
        this.overlayRef.attach(new ComponentPortal(SlashMenuComponent, null, childInjector));
    }

    /** Build a position strategy anchored to the caret's screen rectangle. */
    private caretStrategy(view: EditorView, pos: number) {
        const coords = view.coordsAtPos(pos);
        const origin: FlexibleConnectedPositionStrategyOrigin = {
            x: coords.left,
            y: coords.top,
            width: 1,
            height: Math.max(1, coords.bottom - coords.top),
        };
        return this.overlay.position()
            .flexibleConnectedTo(origin)
            .withPositions(MENU_POSITIONS)
            .withPush(true);
    }

    private close(): void {
        if (this.overlayRef) {
            this.overlayRef.dispose();
            this.overlayRef = null;
        }
        this.flat = [];
        this.groupsSig.set([]);
    }
}

/**
 * `slashMenu` extension — the `/`-triggered command palette (Track B #9). Not
 * declared by any single contributor: the CoolmsEditorComponent constructs it
 * once per mount with closures that expose the active profile's slashable
 * entries and route a pick through the same action bridge the toolbar uses, so
 * the palette is fully manifest-driven (no hardcoded command list).
 */
export function createSlashMenu(config: SlashMenuConfig): Extension {
    return Extension.create({
        name: 'coolmsSlashMenu',
        addProseMirrorPlugins() {
            const editor = this.editor;
            let controller: SlashMenuController | null = null;
            return [
                new Plugin<SlashTriggerState>({
                    key: SLASH_KEY,
                    state: {
                        init: () => INACTIVE,
                        // 4-arg form: ProseMirror hands `apply` the post-transaction
                        // `newState`, so the trigger is read from the up-to-date doc
                        // + selection (the `oldState` 3rd arg is unused here).
                        apply: (
                            tr: Transaction,
                            prev: SlashTriggerState,
                            _oldState: EditorState,
                            newState: EditorState,
                        ): SlashTriggerState => {
                            const next = readTrigger(newState);
                            const meta = tr.getMeta(SLASH_KEY) as { dismiss?: boolean } | undefined;
                            if (meta?.dismiss === true && next.active) {
                                return { ...next, dismissed: true };
                            }
                            // Carry a prior dismissal only while the same query
                            // is still showing; any change re-arms the trigger.
                            if (prev.dismissed && next.active && prev.query === next.query) {
                                return { ...next, dismissed: true };
                            }
                            return next;
                        },
                    },
                    view: (view: EditorView) => {
                        controller = new SlashMenuController(editor, config);
                        controller.update(view);
                        return {
                            update: (v: EditorView) => controller?.update(v),
                            destroy: () => { controller?.destroy(); controller = null; },
                        };
                    },
                    props: {
                        handleKeyDown: (view: EditorView, event: KeyboardEvent): boolean => {
                            const state = SLASH_KEY.getState(view.state);
                            if (state?.active !== true || controller?.isOpen() !== true) return false;
                            switch (event.key) {
                                case 'ArrowDown': controller.move(1);  return true;
                                case 'ArrowUp':   controller.move(-1); return true;
                                case 'Enter':
                                case 'Tab':       return controller.confirm();
                                case 'Escape':    controller.dismiss(view); return true;
                                default:          return false;
                            }
                        },
                    },
                }),
            ];
        },
    });
}
