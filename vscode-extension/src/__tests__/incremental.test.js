/**
 * Grimoire — Incremental description planning tests
 *
 * Verifies planDescriptions() reuses unchanged descriptions and only flags
 * new/changed paths for the model. Mirrors plan_descriptions() in grimoire.py.
 *
 * Run: node src/__tests__/incremental.test.js
 */

const { planDescriptions, collectDescriptions } = require('../incremental');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ FAIL: ${name}`); }
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function section(name) { console.log(`\n── ${name} ──`); }

const PREV = {
  plainEnglish: true,
  tree: {
    name: 'myapp',
    description: 'Project root',
    children: [
      {
        name: 'src',
        description: 'Application source code',
        files: [
          { name: 'a.ts', purpose: 'Does A', tags: [] },
          { name: 'b.ts', purpose: 'Does B', tags: [] },
        ],
      },
    ],
    files: [{ name: 'README.md', purpose: '\u2014', tags: [] }],
  },
  snippets: {
    'myapp/src/a.ts': 'import x',
    'myapp/src/b.ts': 'import y',
  },
};

const ALL_PATHS = ['myapp', 'myapp/src', 'myapp/src/a.ts', 'myapp/src/b.ts', 'myapp/src/c.ts', 'myapp/README.md'];
const NEXT_SNIPPETS = {
  'myapp/src/a.ts': 'import x',             // unchanged
  'myapp/src/b.ts': 'import y CHANGED',     // changed
  'myapp/src/c.ts': 'import z',             // new file
};

console.log('═══════════════════════════════════════════════════════');
console.log('  Grimoire Incremental — planDescriptions Tests');
console.log('═══════════════════════════════════════════════════════');

// ─── collectDescriptions ───
section('collectDescriptions');
const desc = collectDescriptions(PREV.tree);
assert(desc['myapp/src/a.ts'] === 'Does A', 'Collects file purpose');
assert(desc['myapp/src'] === 'Application source code', 'Collects directory description');
assert(desc['myapp'] === 'Project root', 'Collects root description');
assert(!('myapp/README.md' in desc), 'Skips em-dash placeholder purposes');

// ─── No previous map → describe everything ───
section('planDescriptions — no previous map');
const fresh = planDescriptions({ prev: null, allPaths: ALL_PATHS, nextSnippets: NEXT_SNIPPETS, plainEnglish: true });
assert(eq(fresh.toDescribe, ALL_PATHS), 'All paths flagged for description');
assert(eq(fresh.reuse, {}), 'Nothing reused');

// ─── Incremental reuse ───
section('planDescriptions — incremental');
const plan = planDescriptions({ prev: PREV, allPaths: ALL_PATHS, nextSnippets: NEXT_SNIPPETS, plainEnglish: true });
assert(plan.reuse['myapp/src/a.ts'] === 'Does A', 'Reuses unchanged file description');
assert(plan.reuse['myapp'] === 'Project root', 'Reuses root description (no snippet)');
assert(plan.reuse['myapp/src'] === 'Application source code', 'Reuses directory description (no snippet)');
assert(!('myapp/src/b.ts' in plan.reuse), 'Changed file is NOT reused');
assert(plan.toDescribe.includes('myapp/src/b.ts'), 'Changed file flagged for description');
assert(plan.toDescribe.includes('myapp/src/c.ts'), 'New file flagged for description');
assert(plan.toDescribe.includes('myapp/README.md'), 'Previously-undescribed file flagged');
assert(plan.toDescribe.length === 3 && Object.keys(plan.reuse).length === 3, 'Splits 3 reuse / 3 describe');

// ─── Style change invalidates everything ───
section('planDescriptions — description style change');
const switched = planDescriptions({ prev: PREV, allPaths: ALL_PATHS, nextSnippets: NEXT_SNIPPETS, plainEnglish: false });
assert(eq(switched.toDescribe, ALL_PATHS), 'Switching plain/technical re-describes all');
assert(eq(switched.reuse, {}), 'Nothing reused on style change');

// ═══════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════════════════════');

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n  All incremental tests passed!');
  process.exit(0);
}
