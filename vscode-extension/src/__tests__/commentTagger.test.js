/**
 * Grimoire — Comment Tagger Test Suite
 *
 * Tests the ᚲ (Kenaz) rune tagging system that enables Replace, Merge, and Erase
 * comment strategies. This is the foundation for the entire comment management feature.
 *
 * Run: node src/__tests__/commentTagger.test.js
 *
 * What we CAN test here (no VS Code dependency):
 *   - commentTagger.js: all detection, stripping, counting, and filtering logic
 *   - Prompt builders: verify ᚲ markers appear in generated prompts
 *   - End-to-end flow simulation: annotated code → strip → re-annotate → verify
 *
 * What we CANNOT test here (needs VS Code extension host):
 *   - QuickPick UI interactions (strategy picker)
 *   - grim.eraseComments command registration
 *   - Real Claude API annotation calls
 */

const {
  GRIMOIRE_RUNE,
  VALID_MODES,
  GRIMOIRE_LINE_PATTERN,
  GRIMOIRE_DETECT_PATTERN,
  hasGrimoireComments,
  detectModes,
  stripGrimoireComments,
  stripGrimoireCommentsByMode,
  countGrimoireComments,
} = require('../commentTagger');

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

function assertEqual(actual, expected, name) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}`);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual:   ${JSON.stringify(actual)}`);
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

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ═══════════════════════════════════════════════════════
// TEST DATA — Realistic annotated code samples
// ═══════════════════════════════════════════════════════

const JS_TUTOR_ANNOTATED = `// ᚲ [tutor] This module handles user authentication — the gatekeeper of the app
const express = require('express');
const jwt = require('jsonwebtoken');

// ᚲ [tutor] This is the middleware pattern — a function that runs BEFORE your route handler
function authMiddleware(req, res, next) {
  // Original developer comment — should NOT be touched
  const token = req.headers.authorization?.split(' ')[1];
  // ᚲ [tutor] Optional chaining (?.) prevents crashes if authorization header is missing
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  next();
}

module.exports = authMiddleware;`;

const PY_MINIMAL_ANNOTATED = `# ᚲ [minimal] Data loading utilities
import pandas as pd
import numpy as np

# ᚲ [minimal] Read and validate CSV
def load_data(path):
    # User's own comment about the business logic
    df = pd.read_csv(path)
    # ᚲ [minimal] Drop empty rows
    df = df.dropna()
    return df

# ᚲ [minimal] Feature scaling
def normalize(df, columns):
    for col in columns:
        df[col] = (df[col] - df[col].mean()) / df[col].std()
    return df`;

const SQL_TECHNICAL_ANNOTATED = `-- ᚲ [technical] CTE for O(n) deduplication via ROW_NUMBER window function
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at DESC) as rn
  FROM users
)
-- ᚲ [technical] Filters to most recent record per email; index on (email, created_at) recommended
SELECT id, email, name, created_at
FROM ranked
WHERE rn = 1;`;

const CSS_ANNOTATED = `/* ᚲ [non-technical] This sets up the basic look of the page — like choosing the wallpaper and furniture layout */
body {
  font-family: 'Inter', sans-serif;
  margin: 0;
  padding: 0;
}

/* ᚲ [non-technical] This makes the navigation bar stick to the top of the screen as you scroll */
.navbar {
  position: sticky;
  top: 0;
  z-index: 100;
}`;

const HTML_ANNOTATED = `<!DOCTYPE html>
<html>
<head>
  <!-- ᚲ [tutor] The meta viewport tag makes your page responsive on mobile devices -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
</head>
<body>
  <!-- ᚲ [tutor] This div is the "root" — React will take over this element and render the entire app inside it -->
  <div id="root"></div>
</body>
</html>`;

const MIXED_MODES = `// ᚲ [tutor] This is the main entry point
const app = express();

// ᚲ [minimal] Request logging
app.use(morgan('dev'));

// ᚲ [technical] CORS policy: allow credentialed cross-origin requests from whitelist
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

// ᚲ [non-technical] This starts the server — like opening the doors of the store for customers
app.listen(3000);`;

const NO_GRIMOIRE_COMMENTS = `// Regular comment — nothing to do with Grimoire
const x = 42;

/* Block comment */
function hello() {
  // Another normal comment
  console.log("hello");
}`;

const RUNE_IN_STRING = `// Regular comment
const label = "The rune ᚲ means torch";
const regex = /ᚲ \\[(\\w+)\\]/;
console.log("ᚲ [tutor] this is a string, not a comment");`;

// ═══════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════');
console.log('  Grimoire Comment Tagger — Test Suite');
console.log('═══════════════════════════════════════════════════════');

// ─── 1. Constants ───
section('Constants');
assertEqual(GRIMOIRE_RUNE, 'ᚲ', 'GRIMOIRE_RUNE is the Kenaz rune');
assertDeepEqual(VALID_MODES, ['tutor', 'minimal', 'technical', 'non-technical'], 'VALID_MODES matches all 4 annotation modes');

// ─── 2. hasGrimoireComments ───
section('hasGrimoireComments — Detection');
assert(hasGrimoireComments(JS_TUTOR_ANNOTATED), 'Detects ᚲ [tutor] in JS code');
assert(hasGrimoireComments(PY_MINIMAL_ANNOTATED), 'Detects ᚲ [minimal] in Python code');
assert(hasGrimoireComments(SQL_TECHNICAL_ANNOTATED), 'Detects ᚲ [technical] in SQL code');
assert(hasGrimoireComments(CSS_ANNOTATED), 'Detects ᚲ [non-technical] in CSS code');
assert(hasGrimoireComments(HTML_ANNOTATED), 'Detects ᚲ [tutor] in HTML comments');
assert(hasGrimoireComments(MIXED_MODES), 'Detects mixed modes');
assert(!hasGrimoireComments(NO_GRIMOIRE_COMMENTS), 'Returns false for code with no Grimoire comments');
assert(!hasGrimoireComments(''), 'Returns false for empty string');
assert(!hasGrimoireComments('// just a comment with ᚲ but no mode brackets'), 'Returns false for bare rune without [mode]');
assert(!hasGrimoireComments(RUNE_IN_STRING), 'Returns false when rune appears only in strings, not comments');

// ─── 3. detectModes ───
section('detectModes — Mode Discovery');
assertDeepEqual(detectModes(JS_TUTOR_ANNOTATED), ['tutor'], 'Finds single tutor mode');
assertDeepEqual(detectModes(PY_MINIMAL_ANNOTATED), ['minimal'], 'Finds single minimal mode');
assertDeepEqual(detectModes(SQL_TECHNICAL_ANNOTATED), ['technical'], 'Finds single technical mode');
assertDeepEqual(detectModes(CSS_ANNOTATED), ['non-technical'], 'Finds single non-technical mode');

const mixedDetected = detectModes(MIXED_MODES).sort();
assertDeepEqual(mixedDetected, ['minimal', 'non-technical', 'technical', 'tutor'], 'Finds all 4 modes in mixed file');
assertDeepEqual(detectModes(NO_GRIMOIRE_COMMENTS), [], 'Returns empty array for unmarked code');
assertDeepEqual(detectModes(''), [], 'Returns empty array for empty string');

// ─── 4. stripGrimoireComments — JavaScript (//) ───
section('stripGrimoireComments — JavaScript (//)');

const jsResult = stripGrimoireComments(JS_TUTOR_ANNOTATED);
assert(!hasGrimoireComments(jsResult.stripped), 'Stripped JS has no Grimoire comments');
assertEqual(jsResult.count, 3, 'Removed exactly 3 Grimoire comments from JS');
assert(jsResult.stripped.includes('const express'), 'Preserved code lines');
assert(jsResult.stripped.includes('Original developer comment'), 'Preserved non-Grimoire comments');
assert(jsResult.stripped.includes('module.exports'), 'Preserved exports');
assert(!jsResult.stripped.includes('ᚲ [tutor]'), 'No tutor tags remain');

// ─── 5. stripGrimoireComments — Python (#) ───
section('stripGrimoireComments — Python (#)');

const pyResult = stripGrimoireComments(PY_MINIMAL_ANNOTATED);
assert(!hasGrimoireComments(pyResult.stripped), 'Stripped Python has no Grimoire comments');
assertEqual(pyResult.count, 4, 'Removed exactly 4 Grimoire comments from Python');
assert(pyResult.stripped.includes('import pandas'), 'Preserved imports');
assert(pyResult.stripped.includes("User's own comment"), 'Preserved user comments');
assert(pyResult.stripped.includes('def load_data'), 'Preserved function definitions');
assert(pyResult.stripped.includes('def normalize'), 'Preserved all functions');

// ─── 6. stripGrimoireComments — SQL (--) ───
section('stripGrimoireComments — SQL (--)');

const sqlResult = stripGrimoireComments(SQL_TECHNICAL_ANNOTATED);
assert(!hasGrimoireComments(sqlResult.stripped), 'Stripped SQL has no Grimoire comments');
assertEqual(sqlResult.count, 2, 'Removed exactly 2 Grimoire comments from SQL');
assert(sqlResult.stripped.includes('WITH ranked AS'), 'Preserved CTE');
assert(sqlResult.stripped.includes('ROW_NUMBER()'), 'Preserved window function');

// ─── 7. stripGrimoireComments — CSS (/* */) ───
section('stripGrimoireComments — CSS (/* */)');

const cssResult = stripGrimoireComments(CSS_ANNOTATED);
assert(!hasGrimoireComments(cssResult.stripped), 'Stripped CSS has no Grimoire comments');
assertEqual(cssResult.count, 2, 'Removed exactly 2 Grimoire comments from CSS');
assert(cssResult.stripped.includes('font-family'), 'Preserved CSS properties');
assert(cssResult.stripped.includes('.navbar'), 'Preserved selectors');

// ─── 8. stripGrimoireComments — HTML (<!-- -->) ───
section('stripGrimoireComments — HTML (<!-- -->)');

const htmlResult = stripGrimoireComments(HTML_ANNOTATED);
assert(!hasGrimoireComments(htmlResult.stripped), 'Stripped HTML has no Grimoire comments');
assertEqual(htmlResult.count, 2, 'Removed exactly 2 Grimoire comments from HTML');
assert(htmlResult.stripped.includes('<!DOCTYPE html>'), 'Preserved doctype');
assert(htmlResult.stripped.includes('<div id="root">'), 'Preserved HTML elements');

// ─── 9. stripGrimoireComments — No-op on clean code ───
section('stripGrimoireComments — No-op on clean code');

const cleanResult = stripGrimoireComments(NO_GRIMOIRE_COMMENTS);
assertEqual(cleanResult.count, 0, 'Zero comments removed from clean code');
assertEqual(cleanResult.stripped, NO_GRIMOIRE_COMMENTS, 'Clean code passes through unchanged');

// ─── 10. stripGrimoireComments — String safety ───
section('stripGrimoireComments — String safety');

const stringResult = stripGrimoireComments(RUNE_IN_STRING);
assertEqual(stringResult.count, 0, 'Zero comments removed when rune is only in strings');
assertEqual(stringResult.stripped, RUNE_IN_STRING, 'Code with rune in strings passes through unchanged');

// ─── 11. stripGrimoireCommentsByMode — Selective stripping ───
section('stripGrimoireCommentsByMode — Selective stripping');

const mixedByTutor = stripGrimoireCommentsByMode(MIXED_MODES, 'tutor');
assertEqual(mixedByTutor.count, 1, 'Removed 1 tutor comment from mixed file');
assert(mixedByTutor.stripped.includes('ᚲ [minimal]'), 'Preserved minimal comments');
assert(mixedByTutor.stripped.includes('ᚲ [technical]'), 'Preserved technical comments');
assert(mixedByTutor.stripped.includes('ᚲ [non-technical]'), 'Preserved non-technical comments');
assert(!mixedByTutor.stripped.includes('ᚲ [tutor]'), 'Tutor comments removed');

const mixedByMinimal = stripGrimoireCommentsByMode(MIXED_MODES, 'minimal');
assertEqual(mixedByMinimal.count, 1, 'Removed 1 minimal comment from mixed file');
assert(mixedByMinimal.stripped.includes('ᚲ [tutor]'), 'Tutor preserved when stripping minimal');

const mixedByNonTech = stripGrimoireCommentsByMode(MIXED_MODES, 'non-technical');
assertEqual(mixedByNonTech.count, 1, 'Removed 1 non-technical comment from mixed file');

const noMatch = stripGrimoireCommentsByMode(JS_TUTOR_ANNOTATED, 'minimal');
assertEqual(noMatch.count, 0, 'Zero removed when target mode not present');
assert(noMatch.stripped.includes('ᚲ [tutor]'), 'Non-matching mode comments preserved');

// ─── 12. countGrimoireComments ───
section('countGrimoireComments');

assertEqual(countGrimoireComments(JS_TUTOR_ANNOTATED), 3, 'Counts 3 tutor comments in JS');
assertEqual(countGrimoireComments(PY_MINIMAL_ANNOTATED), 4, 'Counts 4 minimal comments in Python');
assertEqual(countGrimoireComments(MIXED_MODES), 4, 'Counts 4 total in mixed file');
assertEqual(countGrimoireComments(MIXED_MODES, 'tutor'), 1, 'Counts 1 tutor in mixed file');
assertEqual(countGrimoireComments(MIXED_MODES, 'minimal'), 1, 'Counts 1 minimal in mixed file');
assertEqual(countGrimoireComments(MIXED_MODES, 'technical'), 1, 'Counts 1 technical in mixed file');
assertEqual(countGrimoireComments(MIXED_MODES, 'non-technical'), 1, 'Counts 1 non-technical in mixed file');
assertEqual(countGrimoireComments(NO_GRIMOIRE_COMMENTS), 0, 'Counts 0 in clean code');
assertEqual(countGrimoireComments(RUNE_IN_STRING), 0, 'Counts 0 when rune in strings');

// ─── 13. Edge cases — Indentation ───
section('Edge cases — Indentation');

const indentedCode = `function nested() {
  if (true) {
    // ᚲ [tutor] Two-space indented comment
    console.log("a");
      // ᚲ [tutor] Four-space indented comment (weird but possible)
      doSomething();
\t// ᚲ [tutor] Tab-indented comment
\tother();
  }
}`;

const indentResult = stripGrimoireComments(indentedCode);
assertEqual(indentResult.count, 3, 'Strips all indented Grimoire comments');
assert(indentResult.stripped.includes('console.log("a")'), 'Preserves code between indented comments');
assert(indentResult.stripped.includes('doSomething()'), 'Preserves deeply indented code');
assert(indentResult.stripped.includes('other()'), 'Preserves tab-indented code');

// ─── 14. Edge cases — Windows line endings ───
section('Edge cases — Windows line endings');

const windowsCode = "// ᚲ [tutor] Windows comment\r\nconst x = 1;\r\n// ᚲ [tutor] Another one\r\nconst y = 2;";
const winResult = stripGrimoireComments(windowsCode);
assertEqual(winResult.count, 2, 'Strips Grimoire comments with \\r\\n line endings');
assert(winResult.stripped.includes('const x = 1;'), 'Preserves code with Windows endings');
assert(winResult.stripped.includes('const y = 2;'), 'Preserves all code lines');

// ─── 15. Edge cases — Empty file ───
section('Edge cases — Empty file');

const emptyResult = stripGrimoireComments('');
assertEqual(emptyResult.count, 0, 'Zero comments in empty file');
assertEqual(emptyResult.stripped, '', 'Empty file stays empty');

// ─── 16. Edge cases — File with ONLY Grimoire comments ───
section('Edge cases — File with only Grimoire comments');

const onlyComments = `// ᚲ [tutor] First comment
// ᚲ [tutor] Second comment
// ᚲ [tutor] Third comment`;

const onlyResult = stripGrimoireComments(onlyComments);
assertEqual(onlyResult.count, 3, 'Strips all 3 comments');
assertEqual(onlyResult.stripped.trim(), '', 'File is essentially empty after stripping');

// ─── 17. End-to-end flow: Replace cycle simulation ───
section('End-to-end — Replace cycle simulation');

// Simulate: User annotates with tutor → switches to minimal → Replace should give clean code
const originalCode = `const express = require('express');

function handleRequest(req, res) {
  const data = processInput(req.body);
  res.json({ result: data });
}

module.exports = handleRequest;`;

// Step 1: Simulate tutor annotation (Claude would add these)
const tutorAnnotated = `// ᚲ [tutor] This imports Express — the most popular web framework for Node.js
const express = require('express');

// ᚲ [tutor] This function handles incoming web requests — like a receptionist routing visitors
function handleRequest(req, res) {
  // ᚲ [tutor] Process the data sent by the client before responding
  const data = processInput(req.body);
  // ᚲ [tutor] Send back a JSON response — the standard format for web APIs
  res.json({ result: data });
}

module.exports = handleRequest;`;

assert(hasGrimoireComments(tutorAnnotated), 'Tutor-annotated code has Grimoire comments');
assertEqual(countGrimoireComments(tutorAnnotated), 4, 'Tutor added 4 comments');

// Step 2: User switches to minimal — Replace strips tutor comments first
const { stripped: cleanForMinimal, count: tutorStripped } = stripGrimoireComments(tutorAnnotated);
assertEqual(tutorStripped, 4, 'Replace cycle stripped all 4 tutor comments');
assert(!hasGrimoireComments(cleanForMinimal), 'Code is clean after strip');
assert(cleanForMinimal.includes('const express'), 'Original code intact after strip');
assert(cleanForMinimal.includes('function handleRequest'), 'Function preserved');
assert(cleanForMinimal.includes('module.exports'), 'Exports preserved');

// Step 3: Simulate minimal annotation on stripped code
const minimalAnnotated = `const express = require('express');

// ᚲ [minimal] Request handler
function handleRequest(req, res) {
  // ᚲ [minimal] Process + respond
  const data = processInput(req.body);
  res.json({ result: data });
}

module.exports = handleRequest;`;

assertDeepEqual(detectModes(minimalAnnotated), ['minimal'], 'After replace, only minimal mode present');
assertEqual(countGrimoireComments(minimalAnnotated), 2, 'Minimal added fewer comments (as expected)');

// Step 4: Another Replace cycle — minimal → technical
const { stripped: cleanForTechnical } = stripGrimoireComments(minimalAnnotated);
assert(!hasGrimoireComments(cleanForTechnical), 'Clean again after stripping minimal');

// ─── 18. End-to-end flow: Merge cycle simulation ───
section('End-to-end — Merge cycle simulation');

// Merge means: keep existing tutor comments AND add minimal alongside
// This test verifies that hasGrimoireComments + detectModes work on merged output
const mergedAnnotation = `// ᚲ [tutor] This imports Express — the most popular web framework for Node.js
const express = require('express');

// ᚲ [tutor] This function handles incoming web requests
// ᚲ [minimal] Request handler
function handleRequest(req, res) {
  const data = processInput(req.body);
  res.json({ result: data });
}

module.exports = handleRequest;`;

const mergedModes = detectModes(mergedAnnotation).sort();
assertDeepEqual(mergedModes, ['minimal', 'tutor'], 'Merged file shows both modes');
assertEqual(countGrimoireComments(mergedAnnotation), 3, 'Total count includes both modes');
assertEqual(countGrimoireComments(mergedAnnotation, 'tutor'), 2, 'Can count tutor subset');
assertEqual(countGrimoireComments(mergedAnnotation, 'minimal'), 1, 'Can count minimal subset');

// Selective strip: remove only tutor, keep minimal
const { stripped: tutorRemoved } = stripGrimoireCommentsByMode(mergedAnnotation, 'tutor');
assertDeepEqual(detectModes(tutorRemoved), ['minimal'], 'After selective strip, only minimal remains');
assert(tutorRemoved.includes('ᚲ [minimal]'), 'Minimal comment survived selective strip');

// ─── 19. Regex edge case — comment with special characters ───
section('Edge cases — Special characters in comments');

const specialChars = `// ᚲ [tutor] Arrow functions (=>) are shorthand for function() {} — think of them as "fat arrows"
// ᚲ [technical] O(n²) complexity due to nested iteration; consider using a Set for O(n) lookup
// ᚲ [non-technical] This is like a "vending machine" — you put in a request, it gives back data
const x = 1;`;

const specialResult = stripGrimoireComments(specialChars);
assertEqual(specialResult.count, 3, 'Strips comments with special chars (=>, ², quotes)');
assertEqual(specialResult.stripped.trim(), 'const x = 1;', 'Only code remains');

// ─── 20. Prompt verification (mock-free) ───
section('Prompt verification — ᚲ markers in prompt templates');

// We can't require annotator.js (needs vscode), but we can verify the file content
const fs = require('fs');
const path = require('path');
const annotatorSource = fs.readFileSync(path.join(__dirname, '..', 'annotator.js'), 'utf8');

assert(annotatorSource.includes('ᚲ [tutor]'), 'Tutor prompt contains ᚲ [tutor] marker');
assert(annotatorSource.includes('ᚲ [minimal]'), 'Minimal prompt contains ᚲ [minimal] marker');
assert(annotatorSource.includes('ᚲ [technical]'), 'Technical prompt contains ᚲ [technical] marker');
assert(annotatorSource.includes('ᚲ [non-technical]'), 'Non-technical prompt contains ᚲ [non-technical] marker');
assert(annotatorSource.includes("commentStrategy"), 'annotator.js references commentStrategy setting');
assert(annotatorSource.includes('eraseAllComments'), 'annotator.js exports eraseAllComments');
assert(annotatorSource.includes('stripGrimoireComments'), 'annotator.js uses stripGrimoireComments');

// Verify each prompt has the CRITICAL instruction
const criticalCount = (annotatorSource.match(/CRITICAL: Every comment you add MUST begin with the marker/g) || []).length;
assertEqual(criticalCount, 4, 'All 4 prompts have the CRITICAL marker instruction');

// ─── 21. Extension + package.json verification ───
section('Extension + package.json verification');

const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
assert(extensionSource.includes('eraseAllComments'), 'extension.js imports eraseAllComments');
assert(extensionSource.includes("'grim.eraseComments'"), 'extension.js registers grim.eraseComments command');

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const commandNames = packageJson.contributes.commands.map(c => c.command);
assert(commandNames.includes('grim.eraseComments'), 'package.json has grim.eraseComments command');

const settings = packageJson.contributes.configuration.properties;
assert('grim.commentStrategy' in settings, 'package.json has grim.commentStrategy setting');
assertEqual(settings['grim.commentStrategy'].default, 'replace', 'commentStrategy defaults to replace');
assertDeepEqual(settings['grim.commentStrategy'].enum, ['replace', 'merge', 'ask'], 'commentStrategy has correct enum values');

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
  console.log('\n  All tests passed! ᚲ The torch burns bright.');
  process.exit(0);
}
