# Changelog

All notable changes to `@coolms/editor-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This file starts at the version named below, which is what the registry
currently serves. Earlier alphas are deliberately not reconstructed: entries are written
in the same commit as the work they describe, and inventing the ones that
predate this file would be a worse record than not having them.

## 2.0.0-alpha.2 — 2026-09-03

**A pre-release, carrying no compatibility promise.** Published under the
`alpha` dist-tag.

The rich-text editor: a Tiptap bridge with a pluggable action and extension
registry, paged layout, and DTMPL-aware widget transforms. The two registries
and the `ContentAdapter` seam are the public surface, so an application decides
what a toolbar button does and how content is stored without this package
knowing about media libraries or link pickers.

### Added

- `{comment}…{endcomment}` and `{comment:…}` in the DTMPL syntax
  highlighting, beside the existing verbatim handling.

### Fixed

- **`@coolms/document-engine` was declared an optional peer and imported
  unconditionally.** Paged layout is the only thing that needs it, and an
  editor used for ordinary rich text should not have to install a
  font-carrying layout engine to render a paragraph. It is now fetched when
  paged layout first runs; a consumer without it gets an unpaginated canvas
  rather than a package that will not build.
- `@tiptap/extension-image` and `@tiptap/extension-underline` were imported and
  never declared. They resolved inside the development tree and failed in a
  clean install.
