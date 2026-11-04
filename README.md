# @coolms/editor-angular

The CoolMS rich-text editor for Angular: a Tiptap bridge with a pluggable
action and extension registry, paged layout, and DTMPL-aware widget transforms.

## Install

```bash
npm install @coolms/editor-angular @coolms/core-angular
```

Angular, NGXS, RxJS and `@angular/cdk` are peers; the supported ranges are declared in `package.json`, which is what an install actually checks. Tiptap and its extensions are
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
        └-- @coolms/editor-angular
                └-- @coolms/ui-angular       (its richtext form field mounts this)
                        └-- the application

The editor is BELOW the UI kit, which is worth stating because it was briefly
above it: the editor showed the platform loader by importing it from the kit,
while the kit's richtext field imported the editor — a cycle that stopped either
from being a package. The loader moved down into core, which is the lowest layer
that needs it.

## Building it

```bash
npm --prefix ../core-angular run build
npm run build
```

Build the document engine first as well if paged layout is in play — it is an
optional peer, and only the pagination code imports it.

Peers are consumed as BUILT output, never as sources: compiling a peer's sources
into this bundle would ship a second copy of it to any application that installs
both.

## Tests

This package has no test runner of its own, so CI finds no tests in it: only typecheck, lint and build guard it here, and a check of "the same number of tests before and after" proves nothing for it. Its 11 spec files run in the admin suite of [coolms/theme-admin](https://github.com/coolms/theme-admin), which compiles this package from source. A change here is tested there, not by this repository's CI.

## Status

A pre-release: the shape is still moving and it carries no
compatibility promise.

## Licence

MIT.
