# Grimoire MCP Server

Expose your Grimoire repo map to AI coding agents (Cursor, Claude Desktop/Code,
Windsurf, …) so they can answer **"where does X live?"** from a compact semantic
index instead of blindly grepping and reading files.

It's a single, **zero-dependency** Node script (Node 18+) that speaks MCP over
stdio — no `npm install` required.

## Prerequisite

Generate a map first so there's a `.grimoire.json` to serve:

- **VS Code:** run **Grimoire: Scan Workspace**, or
- **CLI:** `python grimoire.py /path/to/repo`

The server reads `<repo>/.grimoire.json` and automatically reloads it whenever you
re-scan.

## Tools

| Tool | What it does |
| --- | --- |
| `repo_overview` | Project name, file/dir counts, tags in use, and top-level directories with descriptions. Good first call. |
| `find_files` | Search paths + AI descriptions + tags. Answers "where do I change X?" |
| `file_purpose` | Description + tags for a specific repo-relative path. |
| `files_with_tag` | All files carrying a capability tag (`auth`, `database`, `api`, `test`, …). |

## Setup

Point your MCP client at the server, passing the **absolute path to your repo** as
the first argument (or set `GRIMOIRE_WORKSPACE`; it falls back to the current
working directory).

### Cursor — `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global)

```json
{
  "mcpServers": {
    "grimoire": {
      "command": "node",
      "args": [
        "/abs/path/to/grimoire-mcp-server.js",
        "/abs/path/to/your/repo"
      ]
    }
  }
}
```

### Claude Desktop — `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "grimoire": {
      "command": "node",
      "args": ["/abs/path/to/grimoire-mcp-server.js"],
      "env": { "GRIMOIRE_WORKSPACE": "/abs/path/to/your/repo" }
    }
  }
}
```

### Windsurf / Claude Code

Use the same `command` + `args` shape in their MCP config. Claude Code:

```bash
claude mcp add grimoire -- node /abs/path/to/grimoire-mcp-server.js /abs/path/to/your/repo
```

> The script ships inside the installed VS Code extension under
> `mcp/grimoire-mcp-server.js`, or you can run it straight from a checkout of this repo.

## Why this helps agents

A 500-file repo is ~1M+ tokens to read fully; the Grimoire map of it is roughly
**15–25k tokens**. The agent gets oriented for ~2% of the cost, then reads only the
1–3 files a query points to — fewer tool calls, lower cost, fewer mistakes.

## Quick manual check

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"repo_overview","arguments":{}}}' \
  | node mcp/grimoire-mcp-server.js /abs/path/to/your/repo
```

You should see an `initialize` result, the tool list, and an overview of your repo.
