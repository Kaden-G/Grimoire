// @ts-nocheck
/**
 * Grimoire — Incremental description planning
 *
 * A file/dir's AI description is a pure function of its path + header snippet +
 * description style. So on a re-scan we can reuse the previous description for any
 * path whose snippet is unchanged, and only send genuinely new/changed paths to the
 * model. This keeps the map (and the exported agent context) fresh for a fraction of
 * the cost — the "living map".
 *
 * Pure + node-safe (no vscode), so it is unit-testable and mirrored in grimoire.py.
 */

const EM_DASH = '\u2014';

// Walk a tree producing { "root/rel/path": description } for every node/file that
// has a real (non-placeholder) description. Paths match collectPaths().
function collectDescriptions(node, prefix = '') {
  const out = {};
  if (!node) return out;
  const cur = prefix ? `${prefix}/${node.name}` : node.name;
  if (node.description && node.description !== EM_DASH) out[cur] = node.description;
  for (const f of node.files || []) {
    if (f.purpose && f.purpose !== EM_DASH) out[`${cur}/${f.name}`] = f.purpose;
  }
  for (const c of node.children || []) Object.assign(out, collectDescriptions(c, cur));
  return out;
}

/**
 * Decide which paths actually need (re)describing.
 * @param {object} args
 * @param {object|null} args.prev - previously saved .grimoire.json ({ tree, snippets, plainEnglish }) or null
 * @param {string[]} args.allPaths - all paths in the freshly scanned tree
 * @param {object} args.nextSnippets - { path: snippet } from the fresh scan
 * @param {boolean} args.plainEnglish - current description style
 * @returns {{ toDescribe: string[], reuse: Object<string,string> }}
 */
function planDescriptions({ prev, allPaths, nextSnippets, plainEnglish }) {
  const reuse = {};
  // No prior map, or the description style changed → everything is "new".
  if (!prev || !prev.tree || prev.plainEnglish !== plainEnglish) {
    return { toDescribe: (allPaths || []).slice(), reuse };
  }

  const prevDesc = collectDescriptions(prev.tree);
  const prevSnips = prev.snippets || {};
  const snips = nextSnippets || {};
  const toDescribe = [];

  for (const p of allPaths || []) {
    const cached = prevDesc[p];
    // Reuse when we have a cached description AND the snippet is identical
    // (both undefined — for dirs / non-scanned files — also counts as identical).
    if (cached && prevSnips[p] === snips[p]) {
      reuse[p] = cached;
    } else {
      toDescribe.push(p);
    }
  }
  return { toDescribe, reuse };
}

module.exports = { planDescriptions, collectDescriptions };
