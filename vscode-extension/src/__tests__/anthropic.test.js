/**
 * Grimoire — Anthropic client test suite
 *
 * Tests the tolerant JSON parser used to read description batches from model
 * responses. The HTTP/retry layer is not exercised here (it needs a real network
 * + API key); anthropic.js is import-safe in plain Node (no vscode dependency).
 *
 * Run: node src/__tests__/anthropic.test.js
 */

const { parseJsonResponse, callAnthropic } = require('../anthropic');

// ─── Test Harness ───

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}`);
  }
}

function assertDeepEqual(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}`);
    console.log(`    Expected: ${e}`);
    console.log(`    Actual:   ${a}`);
  }
}

function assertThrows(fn, name) {
  try {
    fn();
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name} (expected a throw)`);
  } catch {
    passed++;
    console.log(`  ✓ ${name}`);
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

console.log('═══════════════════════════════════════════════════════');
console.log('  Grimoire Anthropic Client — parseJsonResponse Tests');
console.log('═══════════════════════════════════════════════════════');

// ─── 1. Exports ───
section('Module exports');
assert(typeof callAnthropic === 'function', 'callAnthropic is exported as a function');
assert(typeof parseJsonResponse === 'function', 'parseJsonResponse is exported as a function');

// ─── 2. Clean JSON ───
section('parseJsonResponse — clean JSON');
assertDeepEqual(
  parseJsonResponse('{"src/a.js":"does a thing"}'),
  { 'src/a.js': 'does a thing' },
  'Parses a plain JSON object'
);
assertDeepEqual(
  parseJsonResponse('   \n {"x": 1, "y": 2}  \n  '),
  { x: 1, y: 2 },
  'Trims surrounding whitespace'
);

// ─── 3. Fenced JSON ───
section('parseJsonResponse — code fences');
assertDeepEqual(
  parseJsonResponse('```json\n{"a":"b"}\n```'),
  { a: 'b' },
  'Strips ```json fences'
);
assertDeepEqual(
  parseJsonResponse('```\n{"a":"b"}\n```'),
  { a: 'b' },
  'Strips bare ``` fences'
);

// ─── 4. Stray prose (fallback extraction) ───
section('parseJsonResponse — tolerates stray prose');
assertDeepEqual(
  parseJsonResponse('Here are the descriptions:\n{"a":"b","c":"d"}'),
  { a: 'b', c: 'd' },
  'Extracts JSON after a preamble'
);
assertDeepEqual(
  parseJsonResponse('Sure!\n{"a":"b"}\nHope that helps.'),
  { a: 'b' },
  'Extracts JSON with preamble and trailing prose'
);
assertDeepEqual(
  parseJsonResponse('{"path":"uses a {brace} inside a value"}'),
  { path: 'uses a {brace} inside a value' },
  'Handles braces inside string values'
);

// ─── 5. Invalid input throws ───
section('parseJsonResponse — invalid input');
assertThrows(() => parseJsonResponse('no json here at all'), 'Throws when there is no JSON object');
assertThrows(() => parseJsonResponse(''), 'Throws on empty string');
assertThrows(() => parseJsonResponse(null), 'Throws on null');
assertThrows(() => parseJsonResponse(undefined), 'Throws on undefined');

// ═══════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════════════════════');

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n  All parser tests passed!');
  process.exit(0);
}
