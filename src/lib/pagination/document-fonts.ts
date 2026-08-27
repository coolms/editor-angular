import { FONT_MANIFEST_ASSET, FontCatalogue, type FontManifest } from '@coolms/document-engine';

/**
 * The vendored fonts, in the browser.
 *
 * ## The browser paints with the bytes the engine measured
 *
 * The files are fetched ONCE and handed to two consumers: the engine, which
 * measures them, and the FontFace API, which paints with them. Not a `@font-face`
 * rule pointing at the same URL — that is a second fetch, a second cache entry,
 * and a second chance for the two to be different files. Registering the buffer
 * makes "the same bytes" true by construction rather than by convention.
 *
 * It also sidesteps the bundler: a `url()` in a component stylesheet is resolved
 * at BUILD time, and these files are copied by the asset pipeline instead.
 */

const BASE = 'assets/document-fonts/';

/** Weight and slope for each face key the manifest uses. */
const DESCRIPTORS: Readonly<Record<string, FontFaceDescriptors | undefined>> = {
    regular:    { weight: '400', style: 'normal' },
    bold:       { weight: '700', style: 'normal' },
    italic:     { weight: '400', style: 'italic' },
    boldItalic: { weight: '700', style: 'italic' },
};

/**
 * Every face fetched so far, and the families they belong to.
 *
 * ⚠️ ACCUMULATED rather than replaced. The catalogue used to be built once
 * for one family and memoised, so a document naming a second face could never
 * get it -- the engine measured every character with the base one and the
 * canvas paginated a document nobody was looking at.
 *
 * Kept per family because the whole set is **7.2MB**: Carlito 2.7, Liberation
 * Sans 1.6, Liberation Serif 1.5, Liberation Mono 1.2, Caladea 0.3. Pulling all
 * of it on the chance a document names one is what the original comment here
 * was avoiding, and it was right to.
 */
const bytesByFile = new Map<string, Uint8Array<ArrayBuffer>>();
const loading = new Map<string, Promise<void>>();
let manifestOnce: Promise<FontManifest> | null = null;
let manifestNow: FontManifest | null = null;
let transport: DocumentFontTransport | null = null;

/**
 * Where the merged registry lives: the families the platform ships PLUS the
 * ones an operator installed.
 *
 * Only reachable through a {@link DocumentFontTransport}, because it is behind
 * the same authentication as everything else under `/api/v1` and this file
 * fetches with the bare `fetch` a package can rely on.
 */
const REGISTRY_URL = '/api/v1/document/fonts/manifest';

/**
 * How this file reaches the API, when it can.
 *
 * ⚠️ An indirection rather than a `fetch` call, and the reason is
 * authentication. The admin's HTTP stack stamps every `/api/v1` request through
 * interceptors -- the bearer token, the section header -- and a bare `fetch`
 * from inside a package carries none of it and gets a 401. So the APPLICATION
 * hands its own client in, and this file stays a package that can be dropped
 * into something with no Angular in it at all.
 */
export interface DocumentFontTransport {
    json<T>(url: string): Promise<T>;
    bytes(url: string): Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * Give this file a way to reach the API, or take it away again.
 *
 * ⚠️ Clears the memoised manifest. Without that, an editor that mounted
 * before the application wired its transport would hold the shipped asset for
 * the life of the page and never see an installed family.
 */
export function useDocumentFontTransport(next: DocumentFontTransport | null): void {
    transport = next;
    manifestOnce = null;
}

/**
 * Forget the registry, so the next caller asks for it again.
 *
 * For the surface that INSTALLS a font: the list it just changed is memoised
 * here, and a page reload is not an acceptable way to see your own upload. The
 * fetched BYTES are kept -- they are keyed by a file id that does not change
 * meaning, and re-fetching megabytes to learn about a new family would be
 * throwing away the thing that made per-family loading worth doing.
 */
export function refreshDocumentFonts(): void {
    manifestOnce = null;
}

/**
 * Is this family's regular face IN HAND right now?
 *
 * ⚠️ Not the same question as {@link FontCatalogue.knows}. That resolves a
 * name through the manifest whether or not the bytes were ever fetched, and the
 * reader below then THROWS -- deliberately, so a missing face is never silently
 * swapped for one with different metrics. On the canvas that exception lands in
 * the middle of the layout and the document loses its page breaks ENTIRELY, so
 * a caller has to know before it names a face.
 *
 * MEASURED 2026-08-24: a document naming Courier New laid out with no gaps at
 * all and `Font "LiberationMono-Regular.ttf" was not preloaded` in the console,
 * because the layout named the face in the same pass that asked for it.
 */
export function faceIsLoaded(family: string): boolean {
    const manifest = manifestNow;
    if (null === manifest) {
        return false;
    }

    const vendoredName = familyOf(manifest, family);
    if (null === vendoredName) {
        return false;
    }

    const regular = manifest.families[vendoredName]?.files['regular']?.file;

    return undefined !== regular && bytesByFile.has(regular);
}

/**
 * The manifest on its own, for a caller that wants the NAMES and not the bytes.
 *
 * The toolbar is that caller: it needs to know what the platform can measure
 * before an author picks anything, and pulling 7.2MB of faces to populate a
 * select would defeat the per-family fetching the rest of this file exists for.
 *
 * Shares `manifestOnce` with {@link loadDocumentFonts}, so asking here first
 * costs one small JSON and the fonts still arrive on their own schedule.
 */
export async function loadFontManifest(): Promise<FontManifest> {
    const manifest = await (manifestOnce ??= readRegistry());
    manifestNow = manifest;

    return manifest;
}

/**
 * The merged registry if the application gave us a way to ask for it, and the
 * SHIPPED asset otherwise.
 *
 * ⚠️ The fallback is not belt and braces. This package is used outside the
 * admin -- and inside it before the transport is wired -- and a font list that
 * throws would take the paper down with it. The vendored families are the ones
 * the renderer holds anyway, so falling back loses installed fonts and nothing
 * else.
 */
async function readRegistry(): Promise<FontManifest> {
    if (null !== transport) {
        try {
            return await transport.json<FontManifest>(REGISTRY_URL);
        } catch {
            // Deliberately swallowed: see above. The asset answers next.
        }
    }

    return fetchJson<FontManifest>(FONT_MANIFEST_ASSET);
}

/**
 * Which vendored family a document's font name resolves to, or null.
 *
 * The manifest states that mapping once, in `substitutes`, and
 * {@link FontCatalogue} reads the same list -- so nothing here can drift from
 * what the engine will resolve at measuring time. Exported so the mapping can
 * be tested on a manifest the test states, rather than on the one that ships.
 */
export function familyOf(manifest: FontManifest, name: string): string | null {
    const wanted = name.trim().toLowerCase();
    for (const [family, entry] of Object.entries(manifest.families)) {
        if (undefined === entry) {
            continue;
        }

        const matches = family.toLowerCase() === wanted
            || entry.substitutes.some((alias) => alias.toLowerCase() === wanted);

        if (matches) {
            return family;
        }
    }

    return null;
}

/**
 * The catalogue, holding every family asked for so far.
 *
 * Names arrive as a DOCUMENT writes them -- `Courier New`, not
 * `Liberation Mono` -- so each is resolved through the manifest's own
 * `substitutes` before anything is fetched. A name nobody ships is dropped
 * here, and the catalogue then substitutes it the way it already documents.
 */
export async function loadDocumentFonts(families?: readonly string[]): Promise<FontCatalogue> {
    const manifest = await loadFontManifest();
    const wanted = vendored(manifest, families ?? [manifest.defaults.family]);

    await Promise.all(wanted.map(async (family) => {
        const entry = manifest.families[family];
        if (undefined === entry) {
            return;
        }

        // One promise per family, so two callers asking at once fetch once.
        loading.set(family, loading.get(family) ?? (async (): Promise<void> => {
            await Promise.all(Object.entries(entry.files).map(async ([key, file]) => {
                if (undefined === file) {
                    return;
                }

                const bytes = await readFace(file);
                bytesByFile.set(file.file, bytes);
                await register(paintedAs(family, entry), key, bytes);
            }));
        })());

        return loading.get(family);
    }));

    // Rebuilt each time rather than cached: it is a thin object over the bytes,
    // and a stale one would not know about a family that has just arrived.
    return FontCatalogue.load(manifest, (file) => {
        const bytes = bytesByFile.get(file);
        if (undefined === bytes) {
            // Loud rather than silent: an unloaded face would otherwise be
            // substituted by whatever the browser felt like, and the engine's
            // measurements would describe a font nobody is looking at.
            throw new Error(`Font "${file}" was not preloaded; ask loadDocumentFonts for its family.`);
        }

        return bytes;
    });
}

/**
 * The manifest families behind a set of names a document used.
 *
 * The default family is always in the set: it is the paper's own face, and the
 * canvas measures every block with it before a document's own faces arrive.
 */
function vendored(manifest: FontManifest, families: readonly string[]): string[] {
    const out = new Set<string>([manifest.defaults.family]);
    for (const name of families) {
        const found = familyOf(manifest, name);
        if (null !== found) {
            out.add(found);
        }
    }

    return [...out];
}

/**
 * Every name this face should answer to.
 *
 * ⚠️ The manifest's SUBSTITUTES, not just the real family name. A document
 * writes the name Word wrote -- `Calibri`, `Courier New`, `Cambria` -- and the
 * engine resolves it through this same list before it measures. Registering
 * only `Carlito` left the CSS side of that name unresolved, so the browser
 * painted whatever the machine happened to have under `Calibri` while the
 * engine measured Carlito: two fonts, one document.
 *
 * MEASURED 2026-08-24 in Chrome on Windows, which has the genuine Microsoft
 * fonts. A `Cambria` run painted a line box **17.90px** tall and, once Caladea
 * answered to the name, **18.70** -- and the same sentence measured 992.09px
 * against Caladea's 923.80 at 40px, **7.4% apart**. The other four aliases
 * happened to agree, because Liberation and Carlito are metric-compatible with
 * the fonts Windows ships; that is luck, not design. On a machine holding none
 * of them the name falls through to the browser's default serif -- which is
 * what `Liberation Mono` itself did here before its own bytes arrived.
 *
 * The real name is already in `substitutes` for every family the manifest
 * ships. It is added anyway, so a manifest that omitted it could not stop a
 * document naming the vendored font directly from being painted with it.
 */
export function paintedAs(family: string, entry: { readonly substitutes: readonly string[] }): string[] {
    return [...new Set([family, ...entry.substitutes])];
}

/**
 * Register one face under every name a document may ask for it by.
 *
 * A face added this way takes precedence over a system font of the same name,
 * which is what stops a machine with its own copy from quietly painting
 * different metrics.
 *
 * ⚠️ One `FontFace` per name over the SAME bytes, because the browser has
 * no aliasing of its own. The shorter-looking alternative -- rewriting the
 * document's `font-family` to the vendored name -- would change what the mark
 * RENDERS, and `TextMapper::inlineStyle()` reads that markup on the way into a
 * .docx. The document has to keep saying `Calibri`.
 */
async function register(
    families: readonly string[],
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
    // The manifest may carry face keys this editor has no descriptor for; those
    // are still measurable by the engine, just not paintable here.
    const descriptors = DESCRIPTORS[key];
    if (undefined === descriptors) {
        return;
    }

    // Browser-only by contract: the caller is a component that has already
    // mounted a DOM, so there is no server-side path into here to guard.
    await Promise.all(families.map(async (family) => {
        const face = new FontFace(family, bytes, descriptors);
        document.fonts.add(await face.load());
    }));
}

/**
 * One face's bytes, from wherever its entry says they are.
 *
 * A vendored face is a file beside the manifest and stays on the static path --
 * cacheable, no session, no PHP. An installed one states a `url`, and that is
 * behind the API's authentication, so it goes through the transport.
 */
async function readFace(file: { readonly file: string; readonly url?: string }): Promise<Uint8Array<ArrayBuffer>> {
    if (undefined !== file.url && null !== transport) {
        return transport.bytes(file.url);
    }

    return fetchBytes(BASE + file.file);
}

async function fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load ${url}: HTTP ${response.status}`);
    }

    return await response.json() as T;
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load ${url}: HTTP ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
}
