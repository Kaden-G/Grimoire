// @ts-nocheck
/**
 * Grimoire — Map query helpers
 *
 * Pure, read-only query functions over a loaded map (the .grimoire.json shape).
 * Shared by the MCP server (so AI agents can ask "where is X?") and unit tests.
 * No vscode/network deps — node-safe and testable.
 */

const { collectEntries } = require('./agentContext');

// Normalize input: accept the full .grimoire.json object or a raw tree node.
function getTree(map) {
  if (!map) return null;
  return map.tree ? map.tree : map;
}

// All entries (dirs + files) with repo-root-relative paths.
function allEntries(map) {
  return collectEntries(getTree(map));
}

/**
 * High-level orientation: project name, counts, and the top two levels of
 * directories with their descriptions. Cheap context for an agent's first call.
 */
function overview(map) {
  const tree = getTree(map);
  const entries = collectEntries(tree);
  const files = entries.filter(e => e.type === 'file');
  const dirs = entries.filter(e => e.type === 'dir');

  // Top-level + second-level dirs only (depth <= 2 relative to root).
  const topDirs = dirs
    .filter(d => d.path.replace(/\/$/, '').split('/').length <= 2)
    .map(d => ({ path: d.path, description: d.desc }));

  // Collect the set of tags in use.
  const tagSet = new Set();
  for (const f of files) for (const t of f.tags || []) tagSet.add(t);

  return {
    project: (tree && tree.name) || 'project',
    description: (tree && tree.description) || '',
    fileCount: files.length,
    dirCount: dirs.length,
    tags: [...tagSet].sort(),
    directories: topDirs,
  };
}

/**
 * Keyword search across path, description, and tags. Returns the best matches
 * (mirrors the webview's scoring) so an agent can locate where something lives.
 */
function find(map, query, limit = 15) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const entries = allEntries(map);

  return entries
    .map(e => {
      const hay = [e.path, e.desc || '', ...(e.tags || [])].join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (!t) continue;
        if (hay.includes(t)) score += 1;
        // Bonus when the term appears in the file/dir name itself.
        const base = e.path.replace(/\/$/, '').split('/').pop().toLowerCase();
        if (base.includes(t)) score += 1;
      }
      return { type: e.type, path: e.path, description: e.desc || '', tags: e.tags || [], score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    .slice(0, Math.max(1, limit));
}

/**
 * Look up a single file/dir by its repo-relative path (tolerates a leading
 * slash or a trailing slash on directories).
 */
function filePurpose(map, queryPath) {
  if (!queryPath) return null;
  const norm = String(queryPath).replace(/^\.?\//, '').replace(/\/+$/, '');
  for (const e of allEntries(map)) {
    if (e.path.replace(/\/+$/, '') === norm) {
      return { type: e.type, path: e.path, description: e.desc || '', tags: e.tags || [] };
    }
  }
  return null;
}

// All files carrying a given tag (e.g. "auth", "database").
function filesWithTag(map, tag) {
  const t = String(tag || '').trim().toLowerCase();
  if (!t) return [];
  return allEntries(map)
    .filter(e => e.type === 'file' && (e.tags || []).some(x => String(x).toLowerCase() === t))
    .map(e => ({ path: e.path, description: e.desc || '', tags: e.tags || [] }));
}

module.exports = { overview, find, filePurpose, filesWithTag, allEntries };
