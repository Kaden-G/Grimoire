#!/usr/bin/env node
/**
 * Grimoire — Conventional Commit Validator
 *
 * Checks that all commits in a PR follow the conventional commit format.
 * Runs in CI on pull requests to dev and master.
 *
 * Valid formats:
 *   feat: add erase command
 *   fix(annotator): handle empty files
 *   feat!: redesign comment system (breaking)
 *   chore(deps): update vsce
 *
 * Usage:
 *   node scripts/validate-commits.js              # validate HEAD vs base
 *   node scripts/validate-commits.js --base main  # custom base branch
 *   node scripts/validate-commits.js --last 1     # validate last N commits
 */

const { execSync } = require('child_process');

const VALID_TYPES = [
  'feat', 'fix', 'perf', 'refactor', 'docs', 'style',
  'test', 'chore', 'ci', 'build', 'revert',
];

const CONVENTIONAL_REGEX = /^(\w+)(?:\([^)]*\))?(!)?\s*:\s*.+$/;

function getCommitSubjects(base, count) {
  let cmd;
  if (count) {
    cmd = `git log -${count} --format="%s"`;
  } else if (base) {
    // Fetch base branch to ensure we have the ref
    try {
      execSync(`git fetch origin ${base} --depth=50 2>/dev/null`, { encoding: 'utf8' });
    } catch { /* already fetched or local */ }
    cmd = `git log origin/${base}..HEAD --format="%s"`;
  } else {
    cmd = `git log -1 --format="%s"`;
  }

  try {
    return execSync(cmd, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function validateSubject(subject) {
  const errors = [];

  // Check basic format
  if (!CONVENTIONAL_REGEX.test(subject)) {
    errors.push(`Does not match conventional commit format: type(scope): description`);
    return errors;
  }

  // Extract type
  const match = subject.match(/^(\w+)/);
  const type = match[1].toLowerCase();

  if (!VALID_TYPES.includes(type)) {
    errors.push(`Unknown type "${type}". Valid types: ${VALID_TYPES.join(', ')}`);
  }

  // Check description isn't empty or too short
  const descMatch = subject.match(/:\s*(.+)$/);
  if (descMatch) {
    const desc = descMatch[1].trim();
    if (desc.length < 5) {
      errors.push(`Description too short (${desc.length} chars). Be descriptive.`);
    }
    // Should not start with uppercase (convention)
    if (desc[0] === desc[0].toUpperCase() && desc[0] !== desc[0].toLowerCase()) {
      errors.push(`Description should start with lowercase: "${desc[0]}..." → "${desc[0].toLowerCase()}..."`);
    }
  }

  return errors;
}

// ─── Main ───

function main() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--base');
  const base = baseIdx !== -1 ? args[baseIdx + 1] : null;
  const lastIdx = args.indexOf('--last');
  const last = lastIdx !== -1 ? parseInt(args[lastIdx + 1], 10) : null;

  const subjects = getCommitSubjects(base, last);

  if (subjects.length === 0) {
    console.log('No commits to validate.');
    process.exit(0);
  }

  console.log(`Validating ${subjects.length} commit(s)...\n`);

  let hasErrors = false;

  for (const subject of subjects) {
    const errors = validateSubject(subject);
    if (errors.length > 0) {
      hasErrors = true;
      console.log(`  ✗ ${subject}`);
      for (const err of errors) {
        console.log(`    → ${err}`);
      }
    } else {
      console.log(`  ✓ ${subject}`);
    }
  }

  console.log('');

  if (hasErrors) {
    console.log('Commit validation failed. Please use conventional commit format:');
    console.log('  feat: add new feature');
    console.log('  fix: resolve bug in annotator');
    console.log('  feat(tagger): add rune-based comment detection');
    console.log('  fix!: breaking change to comment format');
    console.log('');
    console.log(`Valid types: ${VALID_TYPES.join(', ')}`);
    console.log('Spec: https://www.conventionalcommits.org/');
    process.exit(1);
  } else {
    console.log('All commits follow conventional format. ✓');
  }
}

main();
