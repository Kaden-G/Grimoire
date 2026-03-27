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
| **Grimoire: Scan Workspace** | Walks your project, applies heuristic descriptions + import-based tags, saves `.grimoire.json` |
| **Grimoire: Scan with AI Descriptions** | Same as above but also calls Claude API for 10-word descriptions of every file |
| **Grimoire: Open Interactive Map** | Opens the visual treemap in a webview tab with search, breadcrumb nav, and code previews |
| **Grimoire: Search by Tag** | Quick-pick filter to find all files tagged `api`, `auth`, `database`, etc. |
| **Grimoire: Annotate Current File** | Add AI-generated inline comments to the open file (choose from 4 modes) |
| **Grimoire: Refresh** | Reloads from `.grimoire.json` |

### Sidebar Tree

The Grimoire sidebar shows your project tree with:
- **Smart icons** — files get icons based on their most interesting tag (lock for auth, database for ORM, beaker for tests, etc.)
- **Descriptions** — heuristic or AI-generated purpose for each file
- **Hover tooltips** — rich markdown tooltips with tags and code snippet previews
- **Click to open** — clicking any file opens it in the editor

### Interactive Map (Webview)

The full map view includes:
- **Treemap layout** — Miro-style proportional rectangles so you can see your whole project at once
- **Breadcrumb navigation** — click any path segment to jump up
- **Search** — search across file names, descriptions, tags, and paths
- **Color-coded tags** — inferred from imports (api=blue, auth=pink, database=green, ai=yellow)
- **Code preview** — click `▸ code` to see the first 20 lines of any source file
- **Click to open** — click any file card to open it in VS Code

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
