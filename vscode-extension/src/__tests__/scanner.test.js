/**
 * Grimoire — Scanner Test Suite
 *
 * Tests the secret-redaction logic that runs on every file-header snippet before
 * it is written to .grimoire.json or sent to the Claude API.
 *
 * Run: node src/__tests__/scanner.test.js
 *
 * scanner.js requires('vscode') inside a try/catch and falls back to null, so it
 * can be imported in plain Node (no extension host needed).
 */

const { redactSecrets } = require('../scanner');

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

function section(name) {
  console.log(`\n── ${name} ──`);
}

const REDACTED = '***REDACTED***';

console.log('═══════════════════════════════════════════════════════');
console.log('  Grimoire Scanner — Secret Redaction Test Suite');
console.log('═══════════════════════════════════════════════════════');

// ─── 1. Known token formats ───
section('redactSecrets — Known token formats');

const anthropic = 'const k = "sk-ant-api03-AbcD1234EfgH5678IjkL90mnOpQ";';
assert(!redactSecrets(anthropic).includes('sk-ant-api03'), 'Redacts Anthropic sk-ant- key');
assert(redactSecrets(anthropic).includes(REDACTED), 'Anthropic key replaced with marker');

const openai = 'OPENAI_KEY = "sk-1234567890abcdefABCDEFGHIJ"';
assert(!redactSecrets(openai).includes('sk-1234567890abcdef'), 'Redacts OpenAI-style sk- key');

const aws = 'aws_id = AKIAIOSFODNN7EXAMPLE';
assert(!redactSecrets(aws).includes('AKIAIOSFODNN7EXAMPLE'), 'Redacts AWS access key id');

const github = 'token: ghp_1234567890abcdefghij1234567890abcd';
assert(!redactSecrets(github).includes('ghp_1234567890abcdefghij'), 'Redacts GitHub token');

const slack = 'const s = "xoxb-12345678901-abcdEFGHijkl";';
assert(!redactSecrets(slack).includes('xoxb-12345678901'), 'Redacts Slack token');

const google = 'key=AIzaSyA1234567890_abcdefghijklmnopqrstu';
assert(!redactSecrets(google).includes('AIzaSyA1234567890'), 'Redacts Google API key');

const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...';
assert(!redactSecrets(pem).includes('BEGIN RSA PRIVATE KEY'), 'Redacts private key header');

// ─── 2. Quoted secret assignments ───
section('redactSecrets — Quoted assignments');

assertEqual(
  redactSecrets('const password = "hunter2supersecret";'),
  'const password = "***REDACTED***";',
  'Redacts quoted password, preserves identifier + quotes'
);
assertEqual(
  redactSecrets('api_key: "abcdef123456"'),
  'api_key: "***REDACTED***"',
  'Redacts colon-style api_key assignment'
);
assertEqual(
  redactSecrets("const secret = 'mySuperSecretValue'"),
  "const secret = '***REDACTED***'",
  'Redacts single-quoted secret'
);
assert(
  redactSecrets('CLIENT_SECRET="abcdef123456"').includes(REDACTED),
  'Redacts client secret without spaces around ='
);

// ─── 3. No false positives on ordinary code ───
section('redactSecrets — No false positives');

assertEqual(
  redactSecrets('const token = getToken();'),
  'const token = getToken();',
  'Leaves unquoted function call (getToken()) untouched'
);
assertEqual(
  redactSecrets('let pwd = "abc";'),
  'let pwd = "abc";',
  'Leaves short quoted value (<6 chars) untouched'
);
assertEqual(
  redactSecrets('function authToken(req) { return req.headers; }'),
  'function authToken(req) { return req.headers; }',
  'Leaves identifier usage without assignment untouched'
);

// ─── 4. Context preservation ───
section('redactSecrets — Context preservation');

const multiline = [
  'import os',
  'API_KEY = "sk-1234567890abcdefABCDEFGHIJ"',
  'def main():',
  '    return API_KEY',
].join('\n');
const redactedMultiline = redactSecrets(multiline);
assert(redactedMultiline.includes('import os'), 'Preserves surrounding import line');
assert(redactedMultiline.includes('def main():'), 'Preserves surrounding function line');
assert(redactedMultiline.includes(REDACTED), 'Secret line is redacted');
assert(!redactedMultiline.includes('sk-1234567890abcdef'), 'Raw key no longer present');

// ─── 5. Falsy inputs ───
section('redactSecrets — Falsy inputs');

assertEqual(redactSecrets(''), '', 'Empty string returned unchanged');
assertEqual(redactSecrets(null), null, 'null returned unchanged');
assertEqual(redactSecrets(undefined), undefined, 'undefined returned unchanged');

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
  console.log('\n  All redaction tests passed! Secrets stay secret.');
  process.exit(0);
}
