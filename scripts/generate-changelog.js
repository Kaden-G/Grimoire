#!/usr/bin/env node
/**
 * Grimoire — Changelog Generator from Conventional Commits
 *
 * Reads git history since the last version tag and generates a formatted
 * changelog entry. Prepends the new entry to CHANGELOG.md (preserving
 * existing entries) and also updates the README.md features section
 * with a "What's New" block when there are user-facing features.
 *
 * Usage:
 *   node scripts/generate-changelog.js                    # auto-generate
 *   node scripts/generate-changelog.js --dry-run          # preview only
 *   node scripts/generate-changelog.js --version 0.3.0    # override version
 *
 * Output format (CHANGELOG.md):
 *   ## 0.3.0 — 2026-03-31
 *
 *   ### Features
 *   - Add comment management with ᚲ Kenaz rune tagging (#12)
 *
 *   ### Fixes
 *   - Fix batch annotation silent failure (#8)
 *
 * Zero dependencies — Node builtins + git CLI only.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Paths ───

const ROOT = path.join(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'vscode-extension', 'CHANGELOG.md');
const README_PATH = path.join(ROOT, 'vscode-extension', 'README.md');
const PACKAGE_JSON_PATH = path.join(ROOT, 'vscode-extension', 'package.json');

// ─── Commit type → changelog section ───

const SECTION_MAP = {
  feat:     'Features',
  fix:      'Fixes',
  perf:     'Performance',
  refactor: 'Refactoring',
  docs:     'Documentation',
  style:    'Style',
  test:     'Testing',
  chore:    'Maintenance',
  ci:       'CI/CD',
  build:    'Build',
};

// Types that represent user-facing changes (shown in README "What's New")
const USER_FACING_TYPES = new Set(['feat', 'fix', 'perf']);

// ─── Helpers ───

function getVersion() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')).version;
}

function getLastVersionTag() {
  try {
    return execSync('git describe --tags --abbrev=0 --match "v*" 2>/dev/null', {
      encoding: 'utf8',
    }).trim() || null;
  } catch {
    return null;
  }
}

function getCommitsSince(ref) {
  const range = ref ? `${ref}..HEAD` : 'HEAD';
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

function parseConventionalCommit(subject) {
  const match = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?\s*:\s*(.+)$/);
  if (!match) return null;

  return {
    type: match[1].toLowerCase(),
    scope: match[2] || null,
    breaking: match[3] === '!',
    description: match[4].trim(),
  };
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

// ─── Changelog Generation ───

function generateChangelogEntry(version, commits) {
  const sections = {};
  const breakingChanges = [];

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit.subject);
    if (!parsed) continue;

    const section = SECTION_MAP[parsed.type] || 'Other';
    if (!sections[section]) sections[section] = [];

    const scope = parsed.scope ? `**${parsed.scope}**: ` : '';
    const shortHash = commit.hash.substring(0, 7);
    sections[section].push(`- ${scope}${parsed.description} (${shortHash})`);

    // Track breaking changes
    if (parsed.breaking || commit.body.includes('BREAKING CHANGE')) {
      const breakingNote = commit.body
        .split('\n')
        .find(l => l.startsWith('BREAKING CHANGE:') || l.startsWith('BREAKING-CHANGE:'));
      breakingChanges.push(breakingNote || `${parsed.description} (BREAKING)`);
    }
  }

  // Build the entry
  let entry = `## ${version} — ${getToday()}\n`;

  if (breakingChanges.length > 0) {
    entry += `\n### BREAKING CHANGES\n`;
    for (const bc of breakingChanges) {
      entry += `- ${bc}\n`;
    }
  }

  // Order: Features first, then Fixes, then everything else
  const sectionOrder = ['Features', 'Fixes', 'Performance', 'Refactoring',
    'Documentation', 'Testing', 'CI/CD', 'Build', 'Maintenance', 'Style', 'Other'];

  for (const section of sectionOrder) {
    if (sections[section] && sections[section].length > 0) {
      entry += `\n### ${section}\n`;
      for (const item of sections[section]) {
        entry += `${item}\n`;
      }
    }
  }

  return entry;
}

// ─── README "What's New" Update ───

function generateWhatsNew(version, commits) {
  const items = [];

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit.subject);
    if (!parsed || !USER_FACING_TYPES.has(parsed.type)) continue;
    items.push(parsed.description);
  }

  if (items.length === 0) return null;

  let block = `### What's New in ${version}\n\n`;
  for (const item of items) {
    block += `- ${item}\n`;
  }

  return block;
}

function updateReadme(whatsNewBlock) {
  if (!whatsNewBlock || !fs.existsSync(README_PATH)) return false;

  let readme = fs.readFileSync(README_PATH, 'utf8');

  // Look for existing "What's New" section and replace it,
  // or insert it after the first --- separator
  const whatsNewRegex = /### What's New in [\d.]+\n[\s\S]*?(?=\n---|\n## |\n### (?!What's New))/;

  if (whatsNewRegex.test(readme)) {
    // Replace existing What's New
    readme = readme.replace(whatsNewRegex, whatsNewBlock.trim() + '\n');
  } else {
    // Insert after the first horizontal rule (after the tagline)
    const firstHrIdx = readme.indexOf('\n---\n');
    if (firstHrIdx !== -1) {
      const insertPoint = firstHrIdx + 5; // after \n---\n
      readme = readme.slice(0, insertPoint) + '\n' + whatsNewBlock + '\n' + readme.slice(insertPoint);
    }
  }

  fs.writeFileSync(README_PATH, readme);
  return true;
}

// ─── Prepend to CHANGELOG.md ───

function updateChangelog(entry) {
  let existing = '';
  if (fs.existsSync(CHANGELOG_PATH)) {
    existing = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  }

  // If file starts with "# Changelog", insert after the heading
  if (existing.startsWith('# Changelog')) {
    const afterHeading = existing.indexOf('\n') + 1;
    const newContent = existing.slice(0, afterHeading) + '\n' + entry + existing.slice(afterHeading);
    fs.writeFileSync(CHANGELOG_PATH, newContent);
  } else {
    // Prepend
    fs.writeFileSync(CHANGELOG_PATH, `# Changelog\n\n${entry}\n${existing}`);
  }
}

// ─── Main ───

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const versionIdx = args.indexOf('--version');
  const overrideVersion = versionIdx !== -1 ? args[versionIdx + 1] : null;

  const version = overrideVersion || getVersion();
  const lastTag = getLastVersionTag();
  const commits = getCommitsSince(lastTag);

  console.log(`Generating changelog for v${version}`);
  console.log(`Last tag: ${lastTag || '(none)'}`);
  console.log(`Commits: ${commits.length}`);
  console.log('');

  if (commits.length === 0) {
    console.log('No commits found. Nothing to generate.');
    process.exit(0);
  }

  // Generate changelog entry
  const entry = generateChangelogEntry(version, commits);
  console.log('── CHANGELOG entry ──');
  console.log(entry);

  // Generate What's New for README
  const whatsNew = generateWhatsNew(version, commits);
  if (whatsNew) {
    console.log('── README "What\'s New" ──');
    console.log(whatsNew);
  } else {
    console.log('No user-facing changes for README update.');
  }

  if (dryRun) {
    console.log('\n(dry run — no files modified)');
  } else {
    updateChangelog(entry);
    console.log(`\nUpdated ${CHANGELOG_PATH}`);

    if (whatsNew) {
      const updated = updateReadme(whatsNew);
      if (updated) {
        console.log(`Updated ${README_PATH} with "What's New" section`);
      }
    }
  }
}

main();
