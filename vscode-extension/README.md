# Grimoire — Your Codebase, Decoded

**AI-powered treemap visualization, inline annotation, and plain-English descriptions for any project.**

Grimoire maps your entire codebase into an interactive, zoomable treemap — like Google Maps, but for your repo. Every file gets a description of what it does, color-coded tags based on its imports, and one-click navigation to the source.

Built for **vibe coders**, non-technical teammates, and anyone who inherits a codebase and thinks "...where do I even start?"

---

## Features

### Interactive Treemap
See your entire project at a glance. Directories are proportionally sized rectangles — bigger directories take up more space. Click to zoom in, breadcrumbs to zoom back out.

### AI-Powered Descriptions
Every file and folder gets a 10-25 word description of what it actually does. Powered by Claude. Choose between **Plain English** (no jargon) or **Technical** mode.

### 4 Annotation Modes
Add AI-generated inline comments to any file — or your entire workspace at once:

| Mode | Best For | Style |
|------|----------|-------|
| **Tutor** | Learning a codebase | Explains WHY, names patterns, teaches |
| **Minimal** | Quick orientation | 5-10 word signposts only |
| **Technical** | Code review / senior devs | Precise terminology, edge cases |
| **Non-Technical** | PMs, designers, vibe coders | Real-world analogies, zero jargon |

### Smart Import Tags
Files are automatically tagged based on their imports — `api`, `auth`, `database`, `ai`, `state`, `routing`, and 80+ more patterns. Tags are color-coded in the treemap.

### Sidebar Tree View
Collapsible tree in the VS Code sidebar with smart icons, descriptions, and rich tooltips showing code snippets.

### Search
Find files by name, description, tag, or path. `Cmd+K` / `Ctrl+K` opens search from anywhere in the map.

### Floating Toolbar
Adjust text size (S / M / L) and toggle Plain English mode without leaving the map.

---

## Quick Start

1. Install the extension
2. Open a project in VS Code
3. `Cmd+Shift+P` → **"Grimoire: Scan Workspace"** (free, instant, no API key needed)
4. `Cmd+Shift+P` → **"Grimoire: Open Interactive Map"** to see your treemap

For AI-powered descriptions, add your Anthropic API key:
- `Cmd+Shift+P` → **"Grimoire: Setup / API Key"**
- Or go to Settings → search `grim.anthropicApiKey`

---

## Commands

| Command | Description |
|---------|-------------|
| **Grimoire: Scan Workspace** | Map your project with heuristic descriptions (no API key needed) |
| **Grimoire: Scan with AI Descriptions** | Map with Claude-powered descriptions for every file |
| **Grimoire: Open Interactive Map** | Open the visual treemap |
| **Grimoire: Annotate Current File** | Add AI comments to the open file (pick a mode) |
| **Grimoire: Annotate Entire Workspace** | Add AI comments to all source files (with git safety checks) |
| **Grimoire: Search by Tag** | Filter files by import-based tags |
| **Grimoire: Setup / API Key** | Configure your API key or join the Pro waitlist |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `grim.anthropicApiKey` | `""` | Your Anthropic API key |
| `grim.model` | `claude-sonnet-4-20250514` | Claude model to use |
| `grim.batchSize` | `20` | Files per AI batch request |
| `grim.exclude` | `[]` | Additional directories to exclude |
| `grim.scanHeaders` | `true` | Read file headers for better context |
| `grim.plainEnglish` | `true` | Use plain English descriptions (no jargon) |
| `grim.defaultAnnotationMode` | `tutor` | Default annotation mode |

---

## Privacy & Security

- Your API key is stored locally in VS Code settings. It is **never** sent to any server other than `api.anthropic.com`.
- Grimoire does **not** collect telemetry, analytics, or usage data.
- Your code is sent to the Anthropic API only when you explicitly run an AI command (Scan with AI, Annotate). It is **never** sent automatically.
- The `.grimoire.json` file stays in your project folder. You can `.gitignore` it.

---

## Pricing

**Free tier**: All features work with your own Anthropic API key. You pay Anthropic directly for API usage (typically $0.50-2.00 per project scan).

**Grimoire Pro** ($5/month, coming soon): No API key needed. Everything just works. Priority support and early access to new features.

---

## Requirements

- VS Code 1.80.0 or later
- For AI features: an [Anthropic API key](https://console.anthropic.com/settings/keys)

---

## Feedback & Issues

Found a bug? Have a feature request? Open an issue on the [GitHub repository](https://github.com/grimoire-dev/grimoire).

---

**Built with Claude by Anthropic.**
