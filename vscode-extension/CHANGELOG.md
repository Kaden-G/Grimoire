# Changelog

## 0.3.1 — 2026-04-01

### CI/CD
- add auto-versioning, changelog generation, and conventional commit enforcement (ce8d482)

### Maintenance
- bump to v0.2.0, optimize vsix packaging, update changelog (9378883)
- bump version to 0.1.1 and update changelog [skip ci] (7714ddc)

## 0.3.0 — 2026-04-01

### Features
- Comment management system with ᚲ (Kenaz) rune tagging
- Replace, Merge, and Erase All comment strategies
- New `grim.eraseComments` command for full clean slate
- New `grim.commentStrategy` setting (replace/merge/ask)

### CI/CD
- Conventional commit enforcement on PRs
- Auto version bumping from commit prefixes
- Auto changelog generation
- Dev build workflow with .vsix artifact
- Manual publish workflow with dry-run option
- Optimized .vsix packaging (764KB → 78KB)

## 0.2.1 — Marketplace Launch

- Optimized keywords and metadata for VS Code Marketplace discoverability
- Updated README with accurate feature descriptions and quick start flow
- Reduced package size by excluding large media originals

## 0.2.0 — Unified Scan Flow & Layout Overhaul

- **Smart Scan**: One command now handles everything — project scan, AI descriptions, and optional inline comments in a single guided flow
- **Description Style Picker**: Choose between Plain English or Technical descriptions before each scan
- **Inline Comments Picker**: Select an annotation mode (Tutor, Minimal, Technical, Non-Technical, or None) directly during scan
- **New layout**: Replaced proportional treemap grid with a clean, scrollable list — folders and files in full-width rows with complete descriptions visible
- **Enlarged header text**: Map title, stats, and breadcrumbs are now larger and more legible
- **Fixed toolbar positioning**: Toolbar now stays anchored at the bottom of the viewport instead of floating mid-page
- **Adjustable text sizes**: S (12px), M (14px), L (16px) with consistent sizing across all elements

## 0.1.1 — Fixes & Polish

- Fixed inline annotation not running after scan when selected during flow
- Standardized cell sizes so file and folder icons are uniform
- Fixed tooltip positioning in scrollable map container

## 0.1.0 — Initial Release

- Interactive codebase map with zoom and breadcrumb navigation
- AI-powered descriptions for every file and folder (Plain English or Technical)
- 4 inline annotation modes: Tutor, Minimal, Technical, Non-Technical
- Bulk workspace annotation with git safety checks
- Smart import-based tagging (80+ patterns)
- Sidebar tree view with icons, descriptions, and code snippet tooltips
- Search by name, description, tag, or path (`Cmd+K` / `Ctrl+K`)
- Floating toolbar with text size and Plain English toggle
- First-run welcome/setup wizard with API key validation
- Grimoire Pro waitlist ($5/mo, coming soon)
