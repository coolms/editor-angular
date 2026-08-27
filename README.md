# @coolms/editor-angular

The CoolMS rich-text editor for Angular: a Tiptap bridge with a pluggable
action and extension registry, paged layout, and DTMPL-aware widget transforms.

## Install

```bash
npm install @coolms/editor-angular @coolms/core-angular
```

Angular 22, RxJS 7 and `@angular/cdk` are peers. Tiptap and its extensions are
ordinary dependencies rather than peers: they are this package's implementation,
and a consumer should not have to name two dozen of them to render an editor.

`@coolms/document-engine` is an **optional** peer, needed only for paged layout.

## Use

```ts
import { CoolmsEditorComponent, provideCoolmsEditor } from '@coolms/editor-angular';
```

The whole public surface is `src/public-api.ts`. Beyond the component itself it
exposes the two registries the host fills in — `EditorActionRegistry` and
`EditorExtensionRegistry` — plus the `ContentAdapter` seam, so an application
decides what a toolbar button does and how content is stored without this
package knowing about media libraries, link pickers or DTMPL.

## Where it sits

    @coolms/core-angular      session, manifest, theme, the loader mark
        └── @coolms/editor-angular
                └── @coolms/ui-angular       (its richtext form field mounts this)
                        └── the application

The editor is BELOW the UI kit, which is worth stating because it was briefly
above it: the editor showed the platform loader by importing it from the kit,
while the kit's richtext field imported the editor — a cycle that stopped either
from being a package. The loader moved down into core, which is the lowest layer
that needs it.

## Building it

```bash
npm --prefix ../core-angular run build
npm --prefix ../document-engine run build   # only if paged layout is in play
npm run build
```

Peers are consumed as BUILT output, never as sources: compiling a peer's sources
into this bundle would ship a second copy of it to any application that installs
both.

## Status

Not published, and no repository yet — `tools/publish-guard.sh` reports "no
tracked files" for it, which is the guard refusing to certify what it cannot
read rather than a clean result.

## Licence

MIT.
