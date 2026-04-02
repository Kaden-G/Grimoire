// @ts-nocheck
/**
 * Grimoire — Comment Tagging System
 *
 * Core utility for detecting, stripping, and managing Grimoire-generated comments.
 * Uses the Elder Futhark rune ᚲ (Kenaz — "torch", illumination) as a machine-readable
 * marker to distinguish Grimoire comments from user-authored comments.
 *
 * Tag format:  // ᚲ [mode] Comment text here
 * Regex match: Captures the mode (tutor|minimal|technical|non-technical) and the comment body.
 *
 * Design decision: Inline markers over metadata files.
 * Why: Metadata files (.grimoire.json line mappings) go stale the moment a user edits
 * code — line numbers shift, comments reference stale logic. Inline tags travel with the
 * comment itself, surviving refactors, reformats, and partial edits. The trade-off is a
 * small visual footprint in the source file, which we consider acceptable given the rune
 * is a single Unicode character and signals "this comment was AI-generated."
 *
 * Three comment strategies depend on this module:
 *   1. Replace — strip existing ᚲ comments, then re-annotate (default)
 *   2. Merge   — keep existing ᚲ comments, add new ones alongside
 *   3. Erase   — strip all ᚲ comments and delete .grimoire.json (full clean slate)
 */

// ─── Constants ───

// The Kenaz rune — our Grimoire comment fingerprint
const GRIMOIRE_RUNE = 'ᚲ';

// Valid annotation modes (must stay in sync with ANNOTATION_MODES in annotator.js)
const VALID_MODES = ['tutor', 'minimal', 'technical', 'non-technical'];

// ─── Regex Patterns ───

// Matches a FULL LINE that is a Grimoire-tagged comment.
// Captures: (1) leading whitespace, (2) comment syntax, (3) mode, (4) comment body
//
// Supports single-line comment styles:
//   //  → JS, TS, Java, C, C++, Go, Rust, Swift, Kotlin, Scala, Dart, PHP
//   #   → Python, Ruby, Perl, Bash, R, Elixir, YAML
//   --  → SQL, Lua, Haskell
//   /*  → CSS, SCSS (block-style, single line)
//   <!--→ HTML (single line)
//
// Why we match the full line: When stripping, we want to remove the entire comment line
// (including its newline) to avoid leaving blank lines that accumulate over multiple
// replace cycles. Matching just the tag would leave orphan whitespace.
const GRIMOIRE_LINE_PATTERN = /^([ \t]*)(\/\/|#|--|\/\*|<!--)\s*ᚲ\s*\[(\w[\w-]*)\]\s*(.*?)(?:\s*\*\/|\s*-->)?\s*$/;

// Simpler pattern for quick detection — does this file have ANY Grimoire comments?
// Used for the strategy picker decision: if no existing tags, skip the Replace/Merge prompt.
const GRIMOIRE_DETECT_PATTERN = /ᚲ\s*\[(?:tutor|minimal|technical|non-technical)\]/;

// ─── Core Functions ───

/**
 * Checks whether a string (file content) contains any Grimoire-tagged comments.
 * Uses line-level matching to avoid false positives from runes inside string literals.
 *
 * @param {string} content - File content to check
 * @returns {boolean} True if at least one ᚲ [mode] tagged COMMENT LINE is found
 */
function hasGrimoireComments(content) {
  // Quick bail: if the rune isn't anywhere in the content, skip line-by-line check
  if (!GRIMOIRE_DETECT_PATTERN.test(content)) return false;

  // Line-level check to avoid false positives from runes in strings
  const lines = content.split('\n');
  return lines.some(line => GRIMOIRE_LINE_PATTERN.test(line));
}

/**
 * Detects which Grimoire annotation mode(s) are present in a file.
 * Useful for informing the user what's already there before they re-annotate.
 *
 * @param {string} content - File content to scan
 * @returns {string[]} Array of unique mode names found (e.g., ['tutor', 'minimal'])
 */
function detectModes(content) {
  const modes = new Set();
  const globalPattern = /ᚲ\s*\[(tutor|minimal|technical|non-technical)\]/g;
  let match;
  while ((match = globalPattern.exec(content)) !== null) {
    modes.add(match[1]);
  }
  return [...modes];
}

/**
 * Strips ALL Grimoire-tagged comment lines from file content.
 * Removes the entire line (including newline) to prevent blank-line accumulation.
 *
 * Edge case handling:
 * - Preserves non-Grimoire comments on the same line (rare but possible in block comments)
 * - Handles mixed indentation (tabs and spaces)
 * - Handles files with Windows-style line endings (\r\n)
 * - Does NOT touch inline comments that happen to contain the rune in user-authored strings
 *   (the regex requires the rune to follow a comment syntax token, so `const x = "ᚲ"` is safe)
 *
 * @param {string} content - File content to strip
 * @returns {{ stripped: string, count: number }} Cleaned content and number of lines removed
 */
function stripGrimoireComments(content) {
  const lines = content.split('\n');
  const result = [];
  let count = 0;

  for (const line of lines) {
    if (GRIMOIRE_LINE_PATTERN.test(line)) {
      count++;
      // Skip this line entirely — don't push to result
    } else {
      result.push(line);
    }
  }

  return {
    stripped: result.join('\n'),
    count,
  };
}

/**
 * Strips only Grimoire comments from a SPECIFIC mode, leaving other modes' comments intact.
 * Enables targeted replacement: strip [tutor] comments, then re-annotate with [minimal].
 *
 * @param {string} content - File content to process
 * @param {string} mode - The mode to strip (e.g., 'tutor')
 * @returns {{ stripped: string, count: number }} Cleaned content and number of lines removed
 */
function stripGrimoireCommentsByMode(content, mode) {
  const lines = content.split('\n');
  const result = [];
  let count = 0;

  // Build a mode-specific pattern
  const modePattern = new RegExp(
    `^([ \\t]*)(//|#|--|/\\*|<!--)\\s*ᚲ\\s*\\[${escapeRegex(mode)}\\]\\s*(.*?)(?:\\s*\\*/|\\s*-->)?\\s*$`
  );

  for (const line of lines) {
    if (modePattern.test(line)) {
      count++;
    } else {
      result.push(line);
    }
  }

  return {
    stripped: result.join('\n'),
    count,
  };
}

/**
 * Counts Grimoire-tagged comments in file content, optionally filtered by mode.
 *
 * @param {string} content - File content to scan
 * @param {string} [mode] - Optional mode filter
 * @returns {number} Number of Grimoire comments found
 */
function countGrimoireComments(content, mode) {
  const lines = content.split('\n');
  let count = 0;

  for (const line of lines) {
    if (GRIMOIRE_LINE_PATTERN.test(line)) {
      if (!mode) {
        count++;
      } else {
        const match = GRIMOIRE_LINE_PATTERN.exec(line);
        if (match && match[3] === mode) count++;
      }
    }
  }

  return count;
}

// ─── Helpers ───

/**
 * Escapes special regex characters in a string.
 * Needed for mode names with hyphens (e.g., 'non-technical').
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Exports ───

module.exports = {
  GRIMOIRE_RUNE,
  VALID_MODES,
  GRIMOIRE_LINE_PATTERN,
  GRIMOIRE_DETECT_PATTERN,
  hasGrimoireComments,
  detectModes,
  stripGrimoireComments,
  stripGrimoireCommentsByMode,
  countGrimoireComments,
};
