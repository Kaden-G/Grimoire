/**
 * Grimoire — Agent Context export tests
 *
 * Verifies buildAgentContext() produces a compact, root-relative, token-budgeted
 * Markdown map. Mirrors the Python build_agent_context() checks in grimoire.py.
 *
 * Run: node src/__tests__/agentContext.test.js
 */

const { buildAgentContext, collectEntries, firstParagraph } = require('../agentContext');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ FAIL: ${name}`); }
}

function section(name) { console.log(`\n── ${name} ──`); }

const SAMPLE = {
  tree: {
    name: 'myapp',
    description: 'Project root',
    children: [
      {
        name: 'src',
        description: 'Application source code',
        children: [
          {
            name: 'auth',
            description: 'Authentication logic',
            files: [
              { name: 'middleware.ts', purpose: 'Checks logged-in users', tags: ['auth'] },
              { name: 'routes.ts', purpose: 'Handles login/logout', tags: ['auth', 'api'] },
            ],
          },
        ],
        files: [{ name: 'index.ts', purpose: 'Entry point', tags: [] }],
      },
    ],
    files: [{ name: 'README.md', purpose: '\u2014', tags: ['docs'] }],
  },
  readme: '# MyApp\n\nMyApp does cool things.\n\nMore details here.',
};

console.log('═══════════════════════════════════════════════════════');
console.log('  Grimoire Agent Context — buildAgentContext Tests');
console.log('═══════════════════════════════════════════════════════');

// ─── 1. Exports ───
section('Module exports');
assert(typeof buildAgentContext === 'function', 'buildAgentContext is exported');
assert(typeof collectEntries === 'function', 'collectEntries is exported');
assert(typeof firstParagraph === 'function', 'firstParagraph is exported');

// ─── 2. Entries (root-relative, DFS) ───
section('collectEntries');
const entries = collectEntries(SAMPLE.tree);
assert(entries.length === 6, 'Collects 6 entries (2 dirs + 4 files)');
assert(entries[0].path === 'src/' && entries[0].type === 'dir', 'First entry is src/ (dir)');
assert(entries.some(e => e.path === 'src/auth/routes.ts' && e.type === 'file'), 'Includes nested file path');
assert(!entries.some(e => e.path.startsWith('myapp/')), 'Paths are relative to repo root (no root name)');

// ─── 3. Full document ───
section('buildAgentContext — document shape');
const out = buildAgentContext(SAMPLE);
assert(out.startsWith('# myapp \u2014 Repo Map (Grimoire)'), 'Has title with project name');
assert(out.includes('## Overview\n\nMyApp does cool things.'), 'Includes README first paragraph as Overview');
assert(out.includes('## Map (6 entries)'), 'Reports entry count');
assert(out.includes('src/ \u2014 Application source code'), 'Directory line with description');
assert(out.includes('src/auth/routes.ts \u2014 Handles login/logout [auth, api]'), 'File line with description + tags');
assert(out.includes('README.md [docs]') && !out.includes('README.md \u2014 \u2014'), 'Em-dash placeholder purpose is stripped, tags kept');
assert(!out.includes('\nmyapp/'), 'Root folder is not emitted as a path');
assert(out.endsWith('\n'), 'Ends with a trailing newline');

// ─── 4. Budget truncation ───
section('buildAgentContext — token budget');
const small = buildAgentContext(SAMPLE, { maxChars: 200 });
assert(small.includes('additional files omitted'), 'Notes omitted files when over budget');
assert(small.includes('src/ \u2014 Application source code'), 'Keeps directory lines even when over budget');

// ─── 5. Edge cases ───
section('Edge cases');
assert(typeof buildAgentContext({ tree: { name: 'empty' } }) === 'string', 'Handles tree with no children/files');
assert(buildAgentContext({}).includes('## Map (0 entries)'), 'Handles missing tree gracefully');
assert(firstParagraph('') === '', 'firstParagraph empty string');
assert(firstParagraph('# Heading\n\nBody text.') === 'Body text.', 'firstParagraph skips heading');

// ═══════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════════════════════');

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n  All agent-context tests passed!');
  process.exit(0);
}
