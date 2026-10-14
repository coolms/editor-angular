import {
    ChangeDetectionStrategy, Component, computed, inject, signal,
} from '@angular/core';
import { Injector } from '@angular/core';
import {
    ConnectedPosition, Overlay, OverlayConfig, OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal, PortalModule } from '@angular/cdk/portal';
import type { Dimensions, DimensionsRequest } from '@coolms/editor-client';
import { take } from 'rxjs';

const PICKER_TOKEN = Symbol('GRID_PICKER_DATA') as unknown as { __brand: 'GridPickerToken' };
const PICKER_DATA = (PICKER_TOKEN as unknown);

interface PickerData {
    readonly noun: 'grid' | 'table';
    readonly maxRows: number;
    readonly maxCols: number;
    readonly resolve: (value: Dimensions | null) => void;
}

/**
 * Compact popup for picking a (rows, cols) pair, as large as the request's
 * bounds (12 x 12 for the built-in handlers). Mirrors the
 * Excel / Word "insert table" affordance: hover from the top-left
 * highlights an extending rectangle, click commits, click outside or
 * Escape cancels. Reused by both `gridLayout.insert` and `table.insert`
 * action handlers -- only the `noun` differs in the live label.
 */
@Component({
    selector: 'app-grid-picker',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="gp-host" (mouseleave)="onLeave()" tabindex="0" (keydown.escape)="onCancel()">
            <div class="gp-matrix">
                @for (r of rowIdx; track r) {
                    <div class="gp-row">
                        @for (c of colIdx; track c) {
                            <div class="gp-cell"
                                 [class.gp-cell--active]="isActive(r, c)"
                                 (mouseenter)="onHover(r, c)"
                                 (click)="onCommit(r, c)"></div>
                        }
                    </div>
                }
            </div>
            <div class="gp-label">
                {{ summary() }}
            </div>
        </div>
    `,
    styles: [`
        :host { display: block; }
        .gp-host {
            background: var(--cms-surface);
            border-radius: var(--cms-radius-md, 8px);
            padding: 8px;
            box-shadow: var(--cms-shadow-lg, 0 8px 24px rgba(0,0,0,.12));
            border: 1px solid var(--cms-border);
            outline: none;
            user-select: none;
        }
        .gp-matrix { display: flex; flex-direction: column; gap: 2px; }
        .gp-row { display: flex; gap: 2px; }
        .gp-cell {
            width: 16px;
            height: 16px;
            border: 1px solid var(--cms-btn-border);
            background: var(--cms-surface);
            border-radius: 2px;
            cursor: pointer;
        }
        .gp-cell--active {
            background: var(--cms-selected-light);
            border-color: var(--cms-selected);
        }
        .gp-label {
            margin-top: 8px;
            font-size: .8rem;
            color: var(--cms-text-body);
            text-align: center;
            min-height: 1.1rem;
        }
    `],
    imports: [PortalModule],
})
export class GridPickerComponent {
    private readonly data = inject<PickerData>(PICKER_DATA as never);

    readonly rowIdx = Array.from({ length: this.data.maxRows }, (_, i) => i);
    readonly colIdx = Array.from({ length: this.data.maxCols }, (_, i) => i);

    readonly hover = signal<{ r: number; c: number } | null>(null);

    readonly summary = computed<string>(() => {
        const h = this.hover();
        if (!h) return `Pick a ${this.data.noun} size`;
        return `${h.r + 1} × ${h.c + 1} ${this.data.noun}`;
    });

    isActive(r: number, c: number): boolean {
        const h = this.hover();
        return h !== null && r <= h.r && c <= h.c;
    }

    onHover(r: number, c: number): void {
        this.hover.set({ r, c });
    }

    onLeave(): void {
        this.hover.set(null);
    }

    onCommit(r: number, c: number): void {
        this.data.resolve({ rows: r + 1, cols: c + 1 });
    }

    onCancel(): void {
        this.data.resolve(null);
    }
}

/**
 * The Angular answer to the UI port's `requestDimensions`
 * ({@see AngularEditorUiPort}): open the size popup at `request.anchor` --
 * the rectangle of what triggered the action, in viewport coordinates -- or
 * centred when there is none. Resolves to the pick, or `null` on dismiss.
 *
 * Implementation notes:
 *   - CDK Overlay with FlexibleConnectedPositionStrategy connected to the
 *     rectangle, so the popup hugs its bottom-start, falling back to
 *     top-start when there's no room below. A rectangle is a point in time:
 *     unlike the element it replaced, it does not follow a scroll.
 *   - `hasBackdrop: true` with a transparent class means an outside
 *     click fires `backdropClick` and we treat that as cancel.
 *   - Picker resolution flows through `PICKER_DATA` injection; the
 *     component never touches OverlayRef so the same component shape
 *     would work in a Dialog mount if we ever want to embed it.
 */
export async function openGridPicker(
    overlay: Overlay,
    parentInjector: Injector,
    request: DimensionsRequest,
): Promise<Dimensions | null> {
    const anchor = request.anchor;
    const positions: ConnectedPosition[] = [
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
        { originX: 'start', originY: 'top',    overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    ];
    const positionStrategy = anchor
        ? overlay.position()
            .flexibleConnectedTo({ x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height })
            .withPositions(positions)
            .withPush(true)
        : overlay.position().global().centerHorizontally().centerVertically();

    const config = new OverlayConfig({
        positionStrategy,
        hasBackdrop: true,
        backdropClass: 'cdk-overlay-transparent-backdrop',
        scrollStrategy: overlay.scrollStrategies.reposition(),
    });

    const ref: OverlayRef = overlay.create(config);

    return new Promise<Dimensions | null>((resolve) => {
        const detach = (value: Dimensions | null): void => {
            if (!ref.hasAttached()) return;
            ref.detach();
            ref.dispose();
            resolve(value);
        };
        ref.backdropClick().pipe(take(1)).subscribe(() => detach(null));
        ref.keydownEvents().subscribe((event) => {
            if (event.key === 'Escape') detach(null);
        });

        const data: PickerData = {
            noun: request.noun,
            maxRows: request.maxRows,
            maxCols: request.maxCols,
            resolve: detach,
        };
        const childInjector = Injector.create({
            providers: [{ provide: PICKER_DATA as never, useValue: data }],
            parent: parentInjector,
        });
        ref.attach(new ComponentPortal(GridPickerComponent, null, childInjector));

        // Move keyboard focus into the popup so Escape works without
        // requiring the user to click first.
        queueMicrotask(() => {
            const host = ref.overlayElement.querySelector<HTMLElement>('.gp-host');
            host?.focus();
        });
    });
}
