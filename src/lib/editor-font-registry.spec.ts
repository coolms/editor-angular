import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { type FontManifest } from '@coolms/document-engine';
import { useDocumentFontTransport } from '@coolms/editor-client';

import { CoolmsEditorComponent, type PageGeometry } from './editor.component';
import { EDITOR_MANIFEST_PROVIDER } from './editor.types';
import { provideCoolmsEditor } from './providers/provide-coolms-editor';

/**
 * The names a document's fonts answer to.
 *
 *  Stated here rather than read from the shipped manifest. The mapping is
 * the thing under test; reading the real file would make this pass for a
 * manifest that had lost every substitute it has.
 */
const MANIFEST = {
    version: 1,
    defaults: { family: 'Carlito', sizePt: 11 },
    families: {
        Carlito: {
            substitutes: ['Calibri', 'Carlito'],
            fallback: 'sans-serif',
            files: { regular: { file: 'Carlito-Regular.ttf', sha256: '', bytes: 1 } },
        },
        Caladea: {
            substitutes: ['Cambria', 'Caladea'],
            fallback: 'serif',
            files: { regular: { file: 'Caladea-Regular.ttf', sha256: '', bytes: 1 } },
        },
        'Liberation Mono': {
            substitutes: ['Courier New', 'Courier', 'Liberation Mono'],
            fallback: 'monospace',
            files: { regular: { file: 'LiberationMono-Regular.ttf', sha256: '', bytes: 1 } },
        },
    },
} as unknown as FontManifest;

/**
 * The editor component's side of the document fonts: the list, the faces and their names are
 * @coolms/editor-client's (pagination/document-fonts), tested there; who asks for the list is the component's.
 */
describe('CoolmsEditorComponent -- the document font registry', () => {
    describe('who asks for the registry', () => {
        // The registry sits behind the API's authorization: a caller it refuses
        // collects a 403. So only an editor that OFFERS fonts may ask -- a
        // mount that shows no font select (every inline, comment and page
        // profile) asks for nothing, and the paged one asks when its paper
        // arrives, which a host may hand over after the first render.
        const REGISTRY = '/api/v1/document/fonts/manifest';
        const PAPER: PageGeometry = { width: '210mm', height: '297mm' };
        // The faces never arrive: these cases are about the REQUEST for the list,
        // and a paged editor whose faces load goes on to paginate, which wants
        // real font bytes. So the fonts stay pending and nothing paginates.
        const NEVER = new Promise<never>(() => undefined);

        let asked: string[];
        let fetched: string[];
        let originalFetch: typeof fetch;
        let originalResizeObserver: typeof ResizeObserver;

        beforeEach(() => {
            asked = [];
            fetched = [];
            originalFetch = window.fetch;
            // The sheet refits on a ResizeObserver; when the paper arrives mid-test the browser may report
            // "ResizeObserver loop completed with undelivered notifications", which jasmine counts as an
            // uncaught error. Fitting is not what these cases are about, so it observes nothing here.
            originalResizeObserver = window.ResizeObserver;
            window.ResizeObserver = class {
                observe(): void { /* nothing to fit in a spec */ }
                unobserve(): void { /* nothing observed */ }
                disconnect(): void { /* nothing observed */ }
            } as unknown as typeof ResizeObserver;
            window.fetch = ((url: string): Promise<Response> => {
                fetched.push(String(url));
                if (String(url).endsWith('.ttf')) {
                    return NEVER;
                }

                return Promise.resolve(new Response(JSON.stringify(MANIFEST), {
                    headers: { 'Content-Type': 'application/json' },
                }));
            }) as unknown as typeof fetch;
            // Also clears the memoised registry, so each case starts unasked.
            useDocumentFontTransport({
                json: <T>(url: string): Promise<T> => {
                    asked.push(url);

                    return Promise.resolve(MANIFEST as T);
                },
                bytes: (): Promise<Uint8Array<ArrayBuffer>> => NEVER,
            });
            TestBed.configureTestingModule({
                providers: [
                    provideCoolmsEditor(),
                    {
                        provide: EDITOR_MANIFEST_PROVIDER,
                        useValue: { getProfile: () => ({ contributors: [], allowedWidgets: [] }) },
                    },
                ],
            });
        });

        afterEach(() => {
            window.fetch = originalFetch;
            window.ResizeObserver = originalResizeObserver;
            useDocumentFontTransport(null);
        });

        async function settle(fixture: ComponentFixture<CoolmsEditorComponent>): Promise<void> {
            fixture.detectChanges();
            await fixture.whenStable();
            // The request is two awaits deep (the engine's import, then the registry).
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        async function mount(paper: PageGeometry | null): Promise<ComponentFixture<CoolmsEditorComponent>> {
            const fixture = TestBed.createComponent(CoolmsEditorComponent);
            fixture.componentRef.setInput('profile', 'any');
            fixture.componentRef.setInput('pageGeometry', paper);
            await settle(fixture);

            return fixture;
        }

        it('is never a mount that offers no font', async () => {
            const fixture = await mount(null);

            expect(fixture.componentInstance.offersFonts()).withContext('the subject: no font select').toBeFalse();
            expect(asked).withContext('the registry').toEqual([]);
            expect(fetched.filter(url => url.includes('font'))).withContext('nor the shipped list').toEqual([]);
            fixture.destroy();
        });

        it('is the paged editor, once -- the same instrument, seeing the request', async () => {
            const fixture = await mount(PAPER);

            expect(fixture.componentInstance.offersFonts()).withContext('the subject: a font select').toBeTrue();
            expect(asked).toEqual([REGISTRY]);
            fixture.destroy();
        });

        it('is the editor whose paper arrives after the first render, when it arrives', async () => {
            const fixture = await mount(null);
            expect(asked).withContext('before the paper').toEqual([]);

            fixture.componentRef.setInput('pageGeometry', PAPER);
            await settle(fixture);

            expect(asked).withContext('after it').toEqual([REGISTRY]);
            fixture.destroy();
        });
    });
});
