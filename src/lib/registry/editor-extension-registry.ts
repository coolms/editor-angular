import { Injectable } from '@angular/core';
import type { Extension, Mark, Node } from '@tiptap/core';

type TiptapUnit = Extension | Node | Mark;

/**
 * Singleton registry mapping wire-string extension names → Tiptap factory
 * functions. The backend manifest carries strings ('bold', 'mediaWidget')
 * — this registry resolves them to actual Tiptap units when the editor
 * mounts.
 *
 * Built-in StarterKit units are seeded by `provideCoolmsEditor()` under
 * their canonical Tiptap names. Module-supplied extensions (MediaWidget,
 * future Taxonomy link decoration) register the same way from each
 * feature module's bootstrap.
 *
 * Factories return a fresh instance per call (no shared state across
 * editor mounts) — ProseMirror plugins keep instance-local state and
 * sharing them across editors causes subtle re-render bugs.
 */
@Injectable({ providedIn: 'root' })
export class EditorExtensionRegistry {
    private readonly factories = new Map<string, () => TiptapUnit>();

    register(name: string, factory: () => TiptapUnit): void {
        if (this.factories.has(name)) {
            throw new Error(`EditorExtensionRegistry: duplicate extension "${name}"`);
        }
        this.factories.set(name, factory);
    }

    /**
     * Resolve a wire-string list to actual Tiptap units. Unknown names
     * log a warning and are dropped — keeps the editor mounted with the
     * extensions it does know, even if a manifest references something
     * stale (e.g. uninstalled module's still-cached entries).
     */
    resolve(names: ReadonlyArray<string>): ReadonlyArray<TiptapUnit> {
        const out: TiptapUnit[] = [];
        for (const name of names) {
            const factory = this.factories.get(name);
            if (!factory) {
                 
                console.warn(`[coolms-editor] No factory registered for extension "${name}"`);
                continue;
            }
            out.push(factory());
        }
        return out;
    }
}
