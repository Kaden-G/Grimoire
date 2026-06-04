#!/usr/bin/env node
// @ts-nocheck
/**
 * Grimoire MCP Server — zero-dependency stdio JSON-RPC 2.0
 *
 * Exposes a scanned repo map (.grimoire.json) to AI coding agents (Cursor, Claude
 * Desktop/Code, Windsurf, ...) so they can ask "where does X live?" instead of
 * blindly grepping. Uses only Node builtins — no npm install required.
 *
 * MCP client config (e.g. Cursor's mcp.json / Claude Desktop config):
 *   {
 *     "mcpServers": {
 *       "grimoire": {
 *         "command": "node",
 *         "args": ["<abs-path>/grimoire-mcp-server.js", "<abs-path-to-repo>"]
 *       }
 *     }
 *   }
 * If no repo-path arg is given, GRIMOIRE_WORKSPACE or the current directory is used.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mapQuery = require('../src/mapQuery');

const SERVER_NAME = 'grimoire';
const SERVER_VERSION = '0.1.0';
const PROTOCOL_VERSION = '2024-11-05';

const workspace = process.argv[2] || process.env.GRIMOIRE_WORKSPACE || process.cwd();
const mapPath = path.join(workspace, '.grimoire.json');

// Cache the parsed map, reloading only when the file changes (re-scan).
let cache = { mtimeMs: -1, map: null };

function loadMap() {
  let stat;
  try { stat = fs.statSync(mapPath); } catch { return null; }
  if (cache.map && stat.mtimeMs === cache.mtimeMs) return cache.map;
  try {
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    cache = { mtimeMs: stat.mtimeMs, map };
    return map;
  } catch (err) {
    log(`Failed to parse ${mapPath}: ${err.message}`);
    return null;
  }
}

// Logs MUST go to stderr — stdout is reserved for JSON-RPC messages.
function log(msg) { process.stderr.write(`[grimoire-mcp] ${msg}\n`); }

// ─── Tool definitions ───
const TOOLS = [
  {
    name: 'repo_overview',
    description: 'Get a high-level map of the repository: project name, file/dir counts, the capability tags in use, and the top-level directories with what each does. Call this first to orient before reading files.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_files',
    description: 'Find where functionality lives. Searches file/dir paths, AI-written descriptions, and tags. Use it to answer "where do I change X?" before opening files.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What you are looking for, e.g. "login endpoint" or "rate limiting".' },
        limit: { type: 'number', description: 'Max results (default 15).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'file_purpose',
    description: 'Get the description and tags for a specific file or directory by its repo-relative path.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo-relative path, e.g. "src/auth/routes.ts".' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'files_with_tag',
    description: 'List all files carrying a given capability tag (e.g. "auth", "database", "api", "test").',
    inputSchema: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'A tag such as auth, database, api, state, test.' } },
      required: ['tag'],
      additionalProperties: false,
    },
  },
];

function fmtEntry(r) {
  const desc = r.description ? ` — ${r.description}` : '';
  const tags = r.tags && r.tags.length ? ` [${r.tags.join(', ')}]` : '';
  return `${r.path}${desc}${tags}`;
}

// ─── Tool execution → text result ───
function runTool(name, args) {
  const map = loadMap();
  if (!map) {
    return `No .grimoire.json found in ${workspace}. Run a Grimoire scan first ` +
      `(VS Code: "Grimoire: Scan Workspace", or \`python grimoire.py ${workspace}\`).`;
  }
  args = args || {};

  switch (name) {
    case 'repo_overview': {
      const o = mapQuery.overview(map);
      const lines = [
        `Project: ${o.project}${o.description ? ' — ' + o.description : ''}`,
        `${o.fileCount} files, ${o.dirCount} directories`,
      ];
      if (o.tags.length) lines.push(`Tags in use: ${o.tags.join(', ')}`);
      lines.push('', 'Top-level directories:');
      for (const d of o.directories) lines.push(`  ${d.path}${d.description ? ' — ' + d.description : ''}`);
      return lines.join('\n');
    }
    case 'find_files': {
      const results = mapQuery.find(map, args.query, args.limit || 15);
      if (!results.length) return `No matches for "${args.query}".`;
      return results.map(fmtEntry).join('\n');
    }
    case 'file_purpose': {
      const r = mapQuery.filePurpose(map, args.path);
      return r ? fmtEntry(r) : `No map entry for "${args.path}".`;
    }
    case 'files_with_tag': {
      const results = mapQuery.filesWithTag(map, args.tag);
      if (!results.length) return `No files tagged "${args.tag}".`;
      return results.map(fmtEntry).join('\n');
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC plumbing ───
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    case 'notifications/initialized':
    case 'initialized':
      return; // notification — no reply
    case 'ping':
      if (isRequest) reply(id, {});
      return;
    case 'tools/list':
      if (isRequest) reply(id, { tools: TOOLS });
      return;
    case 'tools/call': {
      if (!isRequest) return;
      const toolName = params && params.name;
      const toolArgs = (params && params.arguments) || {};
      try {
        reply(id, { content: [{ type: 'text', text: runTool(toolName, toolArgs) }] });
      } catch (err) {
        reply(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
      return;
    }
    default:
      if (isRequest) replyError(id, -32601, `Method not found: ${method}`);
      return;
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); }
  catch { log(`Ignoring non-JSON line: ${trimmed.slice(0, 80)}`); return; }
  try { handle(msg); } catch (err) { log(`Handler error: ${err.message}`); }
});

log(`started; workspace=${workspace}`);
