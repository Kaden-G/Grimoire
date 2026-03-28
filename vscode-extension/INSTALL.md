# Grimoire — VS Code Extension

## Quick Install

1. **Open VS Code** and press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type **"Developer: Install Extension from Location..."**
   - If that's not available, use the method below instead
3. Select the `vscode-extension` folder

### Alternative: Symlink Install

```bash
# macOS/Linux
ln -s /path/to/Cartographer/vscode-extension ~/.vscode/extensions/grimoire

# Windows (PowerShell as admin)
New-Item -ItemType Junction -Path "$env:USERPROFILE\.vscode\extensions\grimoire" -Target "C:\path\to\Cartographer\vscode-extension"
```

Then **reload VS Code** (`Ctrl+Shift+P` → "Developer: Reload Window").

## Usage

Once installed, you'll see a **spellbook icon** in the Activity Bar (left sidebar).

### Commands (Ctrl+Shift+P)

| Command | What it does |
|---------|-------------|
| **Grimoire: Scan Project** | Maps your project in one guided flow — picks description style, optional inline comments, then scans everything |
| **Grimoire: Open Interactive Map** | Opens the visual codebase map with search, breadcrumb nav, and scrollable file/folder list |
| **Grimoire: Search by Tag** | Quick-pick filter to find all files tagged `api`, `auth`, `database`, etc. |
| **Grimoire: Annotate Current File** | Add AI-generated inline comments to the open file (choose from 4 modes) |
| **Grimoire: Annotate Entire Workspace** | Add AI comments to all source files (with git safety checks) |
| **Grimoire: Refresh** | Reloads from `.grimoire.json` |

### Sidebar Tree

The Grimoire sidebar shows your project tree with:
- **Smart icons** — files get icons based on their most interesting tag (lock for auth, database for ORM, beaker for tests, etc.)
- **Descriptions** — heuristic or AI-generated purpose for each file
- **Hover tooltips** — rich markdown tooltips with tags and code snippet previews
- **Click to open** — clicking any file opens it in the editor

### Interactive Map (Webview)

The full map view includes:
- **Scrollable list layout** — folders and files in full-width rows with complete descriptions visible
- **Breadcrumb navigation** — click any path segment to jump up
- **Search** — `Cmd+K` / `Ctrl+K` to search across file names, descriptions, tags, and paths
- **Color-coded tags** — inferred from imports (api=blue, auth=pink, database=green, ai=yellow)
- **Adjustable text size** — S (12px), M (14px), L (16px) via floating toolbar
- **Click to open** — click any file to open it in VS Code

### Annotate Current File

Open any source file and run `Grimoire: Annotate Current File` from the Command Palette (or right-click in the editor). You'll be prompted to choose a commenting style:

| Mode | Best For | Style |
|------|----------|-------|
| **Tutor** | Learning a codebase | Explains WHY, names patterns, warm teaching tone |
| **Minimal** | Quick orientation | Short signpost comments, no essays |
| **Technical** | Code review / senior devs | Precise terminology, complexity notes, edge cases |
| **Non-Technical** | Vibe coders / PMs / designers | Real-world analogies, zero jargon |

After annotation, you'll see a **diff view** comparing the original file with the annotated version. Then choose:
- **Apply to File** — overwrites the original with the annotated version
- **Copy to Clipboard** — copies the annotated code for pasting elsewhere
- **Dismiss** — close without changes

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `grim.anthropicApiKey` | `""` | Your Anthropic API key (or set `ANTHROPIC_API_KEY` env var) |
| `grim.model` | `claude-sonnet-4-20250514` | Claude model for AI descriptions |
| `grim.batchSize` | `20` | Files per AI batch request |
| `grim.exclude` | `[]` | Additional directories to exclude |
| `grim.scanHeaders` | `true` | Read file headers for better context |
| `grim.plainEnglish` | `true` | Use plain English for AI descriptions (no jargon) |
| `grim.defaultAnnotationMode` | `tutor` | Default mode for Annotate command (`tutor`, `minimal`, `technical`, `non-technical`) |

## No Build Step Required

This extension is plain JavaScript — no TypeScript compilation, no webpack, no bundling. Just install and go.
