import { Injectable } from '@angular/core';
import type { EditorActionContext, EditorActionHandler } from '../editor.types';

/**
 * Singleton registry mapping `actionType` strings -> handler implementations.
 *
 * Built-in handlers (Tiptap chains, source toggle, link dialog) are seeded
 * by `provideCoolmsEditor()`'s APP_INITIALIZER. Module-supplied handlers
 * register the same way from each Angular feature module's bootstrap.
 *
 * Duplicate registration throws — collisions surface at app boot, never
 * silently shadow each other (matches the PHP-side `(treeSlug, path)`
 * uniqueness in NaviGraph).
 */
@Injectable({ providedIn: 'root' })
export class EditorActionRegistry {
    private readonly handlers = new Map<string, EditorActionHandler>();

    register(actionType: string, handler: EditorActionHandler): void {
        if (this.handlers.has(actionType)) {
            throw new Error(`EditorActionRegistry: duplicate action type "${actionType}"`);
        }
        this.handlers.set(actionType, handler);
    }

    /**
     * Dispatch a registered handler. Logs a warning + no-ops when the
     * action type is unknown so a misconfigured manifest doesn't crash
     * the editor (per design doc Risk #4 — graceful degradation).
     */
    async dispatch(
        actionType: string,
        params: Readonly<Record<string, unknown>>,
        ctx: EditorActionContext,
    ): Promise<void> {
        const handler = this.handlers.get(actionType);
        if (!handler) {
             
            console.warn(`[coolms-editor] No handler registered for action type "${actionType}"`);
            return;
        }
        try {
            await handler.execute(params, ctx);
        } catch (err) {
             
            console.error(`[coolms-editor] Handler "${actionType}" threw:`, err);
        }
    }

    /** Test-only — purely diagnostic. */
    has(actionType: string): boolean {
        return this.handlers.has(actionType);
    }
}
