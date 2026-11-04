import { Dialog } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import type { Injector } from '@angular/core';
import type {
    AnchorRect, Dimensions, DimensionsRequest, EditorUiPort, EmbedAttrs, EmbedRequest,
    FormFieldAttrs, FormFieldRequest, LinkRequest, LinkResult, MathAttrs, MathRequest,
} from '@coolms/editor-client';
import { firstValueFrom } from 'rxjs';
import { EditorLinkDialogComponent } from '../actions/link-dialog.component';
import { EditorEmbedDialogComponent } from '../extensions/embed/embed-dialog.component';
import { FormFieldPickerComponent } from '../extensions/form-field/form-field-picker.component';
import { openGridPicker } from '../extensions/grid-layout/grid-picker';
import { EditorMathDialogComponent } from '../extensions/math/math-dialog.component';

const BACKDROP = 'cdk-overlay-dark-backdrop';

/**
 * The editor's UI port, answered by Angular: the CDK dialogs and the size
 * picker this package has always drawn, each given the port's request as its
 * data and closed with the port's result. Every method resolves `null` on a
 * cancel -- a closed dialog with no value included.
 *
 * The handlers that call it are framework-free (`@coolms/editor-client`); this
 * class is the only place in the editor where one of them meets Angular's DI.
 */
export class AngularEditorUiPort implements EditorUiPort {
    constructor(private readonly injector: Injector) {}

    async requestLink(request: LinkRequest): Promise<LinkResult | null> {
        const ref = this.dialog().open<string | null, LinkRequest>(EditorLinkDialogComponent, {
            data: request,
            backdropClass: BACKDROP,
        });
        const url = await firstValueFrom(ref.closed);

        return url ? { href: url } : null;
    }

    async requestEmbed(request: EmbedRequest): Promise<EmbedAttrs | null> {
        const ref = this.dialog().open<EmbedAttrs | null, EmbedRequest>(EditorEmbedDialogComponent, {
            data: request,
            backdropClass: BACKDROP,
        });

        return (await firstValueFrom(ref.closed)) ?? null;
    }

    async requestMath(request: MathRequest): Promise<MathAttrs | null> {
        const ref = this.dialog().open<MathAttrs | null, MathRequest>(EditorMathDialogComponent, {
            data: request,
            backdropClass: BACKDROP,
        });

        return (await firstValueFrom(ref.closed)) ?? null;
    }

    async requestFormField(request: FormFieldRequest): Promise<FormFieldAttrs | null> {
        const ref = this.dialog().open<FormFieldAttrs | null, FormFieldRequest>(FormFieldPickerComponent, {
            data: request,
            backdropClass: BACKDROP,
            disableClose: false,
        });

        return (await firstValueFrom(ref.closed)) ?? null;
    }

    requestDimensions(request: DimensionsRequest): Promise<Dimensions | null> {
        return openGridPicker(this.injector.get(Overlay), this.injector, request);
    }

    private dialog(): Dialog {
        return this.injector.get(Dialog);
    }
}

/**
 * An element's rectangle as the port carries an anchor: viewport coordinates,
 * which is what the CDK overlay positions against.
 */
export function anchorRectOf(element: HTMLElement): AnchorRect {
    const rect = element.getBoundingClientRect();

    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}
