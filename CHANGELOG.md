# Changelog

All notable changes to `@coolms/editor-angular` are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2.0.0-alpha.3 (2026-11-20)

2.0.0-alpha.2's code with the changes below, and nothing else.

### Changed

- katex ^0.18.11 (was ^0.17.0): GHSA-238p-pmpm-9mq7 (low; prototype pollution that bypasses `trust`) is cleared.
  Formulas render as before: katex 0.18 renames five classes (`base`, `strut`, `sizing`, `root`, `stretchy` gain a
  `katex-` prefix), and the markup is otherwise the same. Stored content carries only the LaTeX source, so nothing
  stored changes. An application that loads `katex.min.css` itself must load the 0.18 stylesheet with this version.
- Code comments name the grid layout's schemas and the document adapters by what they are, not by internal
  milestone ids.

### Removed

- The form-field picker's data source tab no longer shows a hint about richer data sources. The tab's help line
  states the format it takes: one choice per line, `value=Label`.
