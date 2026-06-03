/**
 * Grimoire — Map query tests
 *
 * Exercises the read-only query helpers the MCP server exposes to AI agents:
 * overview, find, file_purpose, files_with_tag.
 *
 * Run: node src/__tests__/mapQuery.test.js
 */

const { overview, find, filePurpose, filesWithTag, allEntries } = require('../mapQuery');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ FAIL: ${name}`); }
}

function section(name) { console.log(`\n── ${name} ──`); }

const MAP = {
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
              { name: 'middleware.ts', purpose: 'Checks logged-in users before protected pages', tags: ['auth'] },
              { name: 'routes.ts', purpose: 'Handles login and logout requests', tags: ['auth', 'api'] },
            ],
          },
        ],
        files: [{ name: 'index.ts', purpose: 'App entry point', tags: [] }],
      },
      {
        name: 'db',
        description: 'Database layer',
        files: [{ name: 'client.ts', purpose: 'Connects to the database', tags: ['database'] }],
      },
    ],
    files: [{ name: 'README.md', purpose: '\u2014', tags: ['docs'] }],
  },
};

console.log('═══════════════════════════════════════════════════════');
console.log('  Grimoire Map Query — Tests');
console.log('═══════════════════════════════════════════════════════');

// ─── overview ───
section('overview');
const o = overview(MAP);
assert(o.project === 'myapp', 'Reports project name');
assert(o.fileCount === 5, 'Counts 5 files');
assert(o.dirCount === 3, 'Counts 3 directories');
assert(JSON.stringify(o.tags) === JSON.stringify(['api', 'auth', 'database', 'docs']), 'Lists sorted unique tags');
assert(o.directories.some(d => d.path === 'src/' && d.description === 'Application source code'), 'Includes top-level dir with description');
assert(o.directories.some(d => d.path === 'src/auth/'), 'Includes second-level dir');

// ─── find ───
section('find');
const login = find(MAP, 'login');
assert(login.length >= 1 && login[0].path === 'src/auth/routes.ts', 'Finds the login route as top hit');
const authHits = find(MAP, 'auth');
assert(authHits.some(r => r.path === 'src/auth/'), 'Finds the auth directory');
assert(find(MAP, '').length === 0, 'Empty query returns nothing');
assert(find(MAP, 'nonexistentxyz').length === 0, 'No matches returns empty');
assert(find(MAP, 'database').some(r => r.path === 'db/client.ts'), 'Finds the db client by description');

// ─── filePurpose ───
section('filePurpose');
const fp = filePurpose(MAP, 'src/auth/routes.ts');
assert(fp && fp.description === 'Handles login and logout requests', 'Returns description for a file');
assert(fp && JSON.stringify(fp.tags) === JSON.stringify(['auth', 'api']), 'Returns tags for a file');
assert(filePurpose(MAP, '/src/auth/routes.ts') !== null, 'Tolerates a leading slash');
assert(filePurpose(MAP, 'src/auth/').path === 'src/auth/', 'Resolves a directory (trailing slash)');
assert(filePurpose(MAP, 'does/not/exist.ts') === null, 'Unknown path returns null');

// ─── filesWithTag ───
section('filesWithTag');
const authFiles = filesWithTag(MAP, 'auth');
assert(authFiles.length === 2, 'Two files tagged auth');
assert(authFiles.every(f => f.path.startsWith('src/auth/')), 'Auth files are under src/auth/');
assert(filesWithTag(MAP, 'database').length === 1, 'One file tagged database');
assert(filesWithTag(MAP, 'AUTH').length === 2, 'Tag match is case-insensitive');
assert(filesWithTag(MAP, 'nope').length === 0, 'Unknown tag returns empty');

// ─── raw tree (no wrapper) ───
section('Accepts a raw tree too');
assert(overview(MAP.tree).fileCount === 5, 'Works when passed the tree directly');
assert(allEntries(MAP).length === 8, 'allEntries returns 3 dirs + 5 files');

// ═══════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════════════════════');

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n  All map-query tests passed!');
  process.exit(0);
}
