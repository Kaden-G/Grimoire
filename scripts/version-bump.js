#!/usr/bin/env node
/**
 * Grimoire — Semantic Version Bump via Conventional Commits
 *
 * Reads git log since the last version tag (or all history if no tags exist),
 * determines the bump type from commit prefixes, and updates package.json.
 *
 * Conventional commit prefixes → bump type:
 *   feat:     → minor  (new feature)
 *   fix:      → patch  (bug fix)
 *   perf:     → patch  (performance improvement)
 *   refactor: → patch  (code restructure, no behavior change)
 *   docs:     → patch  (documentation only)
 *   style:    → patch  (formatting, no code change)
 *   test:     → patch  (adding/updating tests)
 *   chore:    → patch  (maintenance, deps, CI)
 *   ci:       → patch  (CI/CD changes)
 *   build:    → patch  (build system changes)
 *
 *   BREAKING CHANGE in commit body, or feat!:/fix!: → major
 *
 * Usage:
 *   node scripts/version-bump.js              # auto-detect from commits
 *   node scripts/version-bump.js --dry-run    # show what would happen
 *   node scripts/version-bump.js --type minor # force a specific bump type
 *
 * Design decision: Zero dependencies — uses only Node builtins + git CLI.
 * Why: This runs in CI where we don't want to npm install just for versioning.
 * Trade-off: Less feature-rich than semantic-release, but fully transparent
 * and debuggable. For a solo/small-team project, this is the right call.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Config ───

const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'vscode-extension', 'package.json');

// Commit type → minimum bump level (highest wins)
const BUMP_MAP = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  refactor: 'patch',
  docs: 'patch',
  style: 'patch',
  test: 'patch',
  chore: 'patch',
  ci: 'patch',
  build: 'patch',
};

// ─── Helpers ───

function getCurrentVersion() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  return pkg.version;
}

function setVersion(newVersion) {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  pkg.version = newVersion;
  fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n');
}

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`Unknown bump type: ${type}`);
  }
}

/**
 * Gets the most recent version tag (vX.Y.Z format).
 * Returns null if no tags exist.
 */
function getLastVersionTag() {
  try {
    const tag = execSync('git describe --tags --abbrev=0 --match "v*" 2>/dev/null', {
      encoding: 'utf8',
    }).trim();
    return tag || null;
  } catch {
    return null;
  }
}

/**
 * Gets commit messages since a given ref (or all commits if ref is null).
 * Returns array of { hash, subject, body }.
 */
function getCommitsSince(ref) {
  const range = ref ? `${ref}..HEAD` : 'HEAD';
  // Use a delimiter that won't appear in commit messages
  const SEP = '---GRIMOIRE-COMMIT-SEP---';
  const FORMAT = `%H%n%s%n%b${SEP}`;

  try {
    const raw = execSync(`git log ${range} --format="${FORMAT}"`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();

    if (!raw) return [];

    return raw.split(SEP).filter(Boolean).map(block => {
      const lines = block.trim().split('\n');
      return {
        hash: lines[0] || '',
        subject: lines[1] || '',
        body: lines.slice(2).join('\n').trim(),
      };
    });
  } catch {
    return [];
  }
}

/**
 * Parses a conventional commit subject line.
 * Returns { type, scope, breaking, description } or null if not conventional.
 */
function parseConventionalCommit(subject) {
  // Match: type(scope)!: description  OR  type!: description  OR  type: description
  const match = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?\s*:\s*(.+)$/);
  if (!match) return null;

  return {
    type: match[1].toLowerCase(),
    scope: match[2] || null,
    breaking: match[3] === '!',
    description: match[4].trim(),
  };
}

/**
 * Determines the bump type from an array of commits.
 * Returns 'major', 'minor', 'patch', or null (no bumpable commits).
 */
function determineBumpType(commits) {
  let maxBump = null; // null < patch < minor < major
  const bumpOrder = { patch: 1, minor: 2, major: 3 };

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit.subject);
    if (!parsed) continue;

    // Check for breaking changes
    const isBreaking = parsed.breaking ||
      commit.body.includes('BREAKING CHANGE') ||
      commit.body.includes('BREAKING-CHANGE');

    let bump;
    if (isBreaking) {
      bump = 'major';
    } else if (BUMP_MAP[parsed.type]) {
      bump = BUMP_MAP[parsed.type];
    } else {
      // Unknown type — skip
      continue;
    }

    if (!maxBump || bumpOrder[bump] > bumpOrder[maxBump]) {
      maxBump = bump;
    }

    // Short-circuit: can't go higher than major
    if (maxBump === 'major') break;
  }

  return maxBump;
}

// ─── Main ───

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const forceTypeIdx = args.indexOf('--type');
  const forceType = forceTypeIdx !== -1 ? args[forceTypeIdx + 1] : null;

  const currentVersion = getCurrentVersion();
  const lastTag = getLastVersionTag();
  const commits = getCommitsSince(lastTag);

  console.log(`Current version: ${currentVersion}`);
  console.log(`Last tag: ${lastTag || '(none)'}`);
  console.log(`Commits since: ${commits.length}`);
  console.log('');

  // Show parsed commits
  let conventionalCount = 0;
  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit.subject);
    if (parsed) {
      const breakingFlag = parsed.breaking ? ' [BREAKING]' : '';
      console.log(`  ${parsed.type}: ${parsed.description}${breakingFlag}`);
      conventionalCount++;
    } else {
      console.log(`  (non-conventional) ${commit.subject}`);
    }
  }
  console.log('');

  // Determine bump
  let bumpType;
  if (forceType) {
    if (!['major', 'minor', 'patch'].includes(forceType)) {
      console.error(`Invalid bump type: ${forceType}. Use major, minor, or patch.`);
      process.exit(1);
    }
    bumpType = forceType;
    console.log(`Forced bump type: ${bumpType}`);
  } else {
    bumpType = determineBumpType(commits);
    if (!bumpType) {
      console.log('No conventional commits found that warrant a version bump.');
      console.log('Use --type patch|minor|major to force a bump.');
      process.exit(0);
    }
    console.log(`Detected bump type: ${bumpType} (from ${conventionalCount} conventional commits)`);
  }

  const newVersion = bumpVersion(currentVersion, bumpType);
  console.log(`Version: ${currentVersion} → ${newVersion}`);

  if (dryRun) {
    console.log('\n(dry run — no files modified)');
  } else {
    setVersion(newVersion);
    console.log(`\nUpdated ${PACKAGE_JSON_PATH}`);
  }

  // Output for GitHub Actions (set as step output)
  // Usage in workflow: ${{ steps.bump.outputs.new_version }}
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_version=${newVersion}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `bump_type=${bumpType}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `old_version=${currentVersion}\n`);
  }
}

main();
