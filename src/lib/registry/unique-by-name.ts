import type { Extension, Mark, Node } from '@tiptap/core';

type TiptapUnit = Extension | Node | Mark;

/**
 * One unit per extension name, in the order given: the FIRST unit of a name is
 * kept and every later one of the same name is dropped. TipTap loads a repeated
 * name twice and warns, so a list two sources contribute to goes through this.
 */
export function uniqueByName<T extends TiptapUnit>(units: ReadonlyArray<T>): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const unit of units) {
        if (seen.has(unit.name)) continue;
        seen.add(unit.name);
        out.push(unit);
    }

    return out;
}
