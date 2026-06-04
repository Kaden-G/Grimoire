// @ts-nocheck
/**
 * Grimoire — Agent Context export
 *
 * Turns a scanned map (the .grimoire.json shape) into a compact, token-budgeted
 * Markdown file (.grimoire-context.md) that AI coding agents can load for instant
 * repo orientation — "where does X live?" — instead of rediscovering the codebase
 * with repeated grep/read calls.
 *
 * No `vscode` dependency, so it is unit-testable in plain Node. The output format
 * is mirrored by build_agent_context() in grimoire.py — keep them in sync.
 */

const DEFAULT_MAX_CHARS = 120000; // ~30k tokens

const EM_DASH = '\u2014';

// First meaningful paragraph of the README (skips headings/blank lines), capped.
function firstParagraph(readme) {
  if (!readme) return '';
  const out = [];
  for (const line of String(readme).split('\n')) {
    const t = line.trim();
    if (!t) { if (out.length) break; else continue; }
    if (t.startsWith('#')) { if (out.length) break; else continue; }
    out.push(t);
  }
  return out.join(' ').slice(0, 500);
}

// Depth-first walk producing entries with paths RELATIVE to the repo root
// (the root node's own name is dropped). Dirs are emitted before their contents.
function collectEntries(root) {
  const entries = [];
  function walk(node, prefix) {
    for (const c of node.children || []) {
      const p = prefix ? `${prefix}/${c.name}` : c.name;
      entries.push({ type: 'dir', path: `${p}/`, desc: c.description || '', tags: [] });
      walk(c, p);
    }
    for (const f of node.files || []) {
      const p = prefix ? `${prefix}/${f.name}` : f.name;
      let purpose = f.purpose || '';
      if (purpose === EM_DASH) purpose = '';
      entries.push({ type: 'file', path: p, desc: purpose, tags: f.tags || [] });
    }
  }
  if (root) walk(root, '');
  return entries;
}

/**
 * Build the agent-context Markdown.
 * @param {object} mapData - the .grimoire.json object ({ tree, readme, ... }) or a raw tree node.
 * @param {object} [options] - { maxChars }
 * @returns {string}
 */
function buildAgentContext(mapData, options = {}) {
  const maxChars = options.maxChars || DEFAULT_MAX_CHARS;
  const tree = mapData && mapData.tree ? mapData.tree : mapData;
  const readme = (mapData && mapData.readme) || '';
  const projectName = (tree && tree.name) || 'project';

  const entries = collectEntries(tree);

  const headerLines = [
    `# ${projectName} — Repo Map (Grimoire)`,
    '',
    '> Auto-generated semantic map for AI coding agents. Each line is `path — what it does [tags]`.',
    '> Use it to find where functionality lives before reading files. Regenerate after big changes',
    '> via the "Grimoire: Export Agent Context" command (or `python grimoire.py <dir>`).',
    '',
  ];

  const overview = firstParagraph(readme);
  if (overview) headerLines.push('## Overview', '', overview, '');

  headerLines.push(`## Map (${entries.length} entries)`, '');
  const headerStr = headerLines.join('\n');

  let budget = maxChars - headerStr.length;
  const lines = [];
  let omitted = 0;
  for (const e of entries) {
    const tagStr = e.tags && e.tags.length ? ` [${e.tags.join(', ')}]` : '';
    const descStr = e.desc ? ` — ${e.desc}` : '';
    const line = `${e.path}${descStr}${tagStr}`;
    // Directories are always kept (cheap, high-signal); files yield to the budget.
    if (e.type === 'file' && budget - (line.length + 1) < 0) {
      omitted++;
      continue;
    }
    lines.push(line);
    budget -= line.length + 1;
  }

  let body = lines.join('\n');
  if (omitted > 0) {
    body += `\n\n_(${omitted} additional files omitted to stay within the context budget; see .grimoire.json for the full map.)_`;
  }

  return `${headerStr}\n${body}\n`;
}

module.exports = { buildAgentContext, collectEntries, firstParagraph, DEFAULT_MAX_CHARS };
