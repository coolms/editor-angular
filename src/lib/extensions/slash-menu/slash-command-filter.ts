import type { EditorToolbarNodeManifest, EditorTranslate } from '../../editor.types';
import type { SlashCommandGroup, SlashCommandItem } from './slash-menu-types';

/**
 * Pure, framework-free helpers behind the `/`-command palette. Kept separate
 * from the ProseMirror plugin + Angular popup so the filtering / grouping /
 * fuzzy-match contract is unit-testable in isolation (see
 * `slash-command-filter.spec.ts`).
 *
 * The palette is built straight from the editor manifest — there is no
 * hardcoded command list anywhere. `buildSlashItems` keeps only the entries
 * the backend marked `slashable` (block-structure + insert-widget groups;
 * ledger #805) and resolves their labels for display.
 */

/** Display headings for the known manifest groups; falls back to a capitalised key. */
const GROUP_HEADINGS: Readonly<Record<string, string>> = {
    block:  'Blocks',
    insert: 'Insert',
    format: 'Format',
    meta:   'Actions',
};

export function humaniseGroup(key: string): string {
    return GROUP_HEADINGS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
}

/**
 * Map the slashable subset of a profile's contributors to palette items.
 * Order is preserved (the resolver already sorted by group/priority).
 */
export function buildSlashItems(
    contributors: ReadonlyArray<EditorToolbarNodeManifest>,
    translate: EditorTranslate,
): ReadonlyArray<SlashCommandItem> {
    return contributors
        .filter((c) => c.slashable === true)
        .map((node) => ({
            id:       node.id,
            group:    node.group,
            label:    translate(node.label),
            icon:     node.icon,
            keywords: node.keywords ?? [],
            node,
        }));
}

/**
 * Score an item against a lowercased query. Returns a higher number for a
 * better match, or `null` when it doesn't match at all. Ranking, best first:
 *   exact field            > prefix on the label
 *   prefix on a keyword/id  > substring anywhere
 *   subsequence (loose fuzzy, e.g. "bq" → "blockquote")
 *
 * The label is weighted above keywords/id so the most human-meaningful match
 * wins ties. An empty query matches everything (score 0) — the palette shows
 * the full list before the user types.
 */
export function scoreSlashItem(item: SlashCommandItem, query: string): number | null {
    const q = query.toLowerCase().trim();
    if (q === '') return 0;

    // The id's last namespace segment ('block:h1' → 'h1') is a useful alias.
    const idAlias = item.id.toLowerCase().split(':').pop() ?? '';
    const label = item.label.toLowerCase();
    const aliases = [idAlias, ...item.keywords.map((k) => k.toLowerCase())];

    let best: number | null = null;
    const bump = (n: number): void => { if (best === null || n > best) best = n; };

    if (label === q) bump(100);
    else if (label.startsWith(q)) bump(85);
    else if (label.includes(q)) bump(60);
    else if (isSubsequence(q, label)) bump(40);

    for (const a of aliases) {
        if (a === q) bump(90);
        else if (a.startsWith(q)) bump(75);
        else if (a.includes(q)) bump(50);
        else if (isSubsequence(q, a)) bump(30);
    }
    return best;
}

/**
 * Filter + rank items for a query, preserving the manifest's original order
 * as a stable tiebreaker among equal scores.
 */
export function filterSlashItems(
    items: ReadonlyArray<SlashCommandItem>,
    query: string,
): ReadonlyArray<SlashCommandItem> {
    if (query.trim() === '') return items;
    const scored = items
        .map((item, index) => ({ item, index, score: scoreSlashItem(item, query) }))
        .filter((s): s is { item: SlashCommandItem; index: number; score: number } => s.score !== null);
    scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
    return scored.map((s) => s.item);
}

/** Group an already-filtered, ordered item list by `group` for display. */
export function groupSlashItems(
    items: ReadonlyArray<SlashCommandItem>,
): ReadonlyArray<SlashCommandGroup> {
    const order: string[] = [];
    const map = new Map<string, SlashCommandItem[]>();
    for (const item of items) {
        let bucket = map.get(item.group);
        if (!bucket) {
            bucket = [];
            map.set(item.group, bucket);
            order.push(item.group);
        }
        bucket.push(item);
    }
    return order.map((key) => ({ key, heading: humaniseGroup(key), items: map.get(key)! }));
}

/** True when every char of `needle` appears in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
    if (needle === '') return true;
    let i = 0;
    for (let j = 0; j < haystack.length && i < needle.length; j++) {
        if (haystack[j] === needle[i]) i++;
    }
    return i === needle.length;
}
