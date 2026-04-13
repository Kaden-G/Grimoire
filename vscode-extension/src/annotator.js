// @ts-nocheck
/**
 * Grimoire — Inline Code Annotator
 * Sends source files to Claude API for inline comment generation
 * with four distinct commenting modes.
 */

const vscode = require('vscode');
const {
  GRIMOIRE_RUNE,
  hasGrimoireComments,
  detectModes,
  stripGrimoireComments,
  stripGrimoireCommentsByMode,
  countGrimoireComments,
} = require('./commentTagger');

// ─── Annotation Mode Definitions ───

const ANNOTATION_MODES = {
  tutor: {
    label: '$(mortar-board) Tutor',
    description: 'Teaching mode — explains WHY things work, names patterns, builds understanding',
    detail: 'Best for: Learning a new codebase or language. Comments explain concepts, not just behavior.',
    prompt: buildTutorPrompt,
  },
  minimal: {
    label: '$(dash) Minimal',
    description: 'Just the essentials — one-line comments for each logical section',
    detail: 'Best for: Quick orientation. No essays, just landmarks.',
    prompt: buildMinimalPrompt,
  },
  technical: {
    label: '$(tools) Technical',
    description: 'Best-practice annotations with proper terminology and patterns',
    detail: 'Best for: Code review, onboarding senior devs, documentation-grade comments.',
    prompt: buildTechnicalPrompt,
  },
  'non-technical': {
    label: '$(heart) Non-Technical',
    description: 'Plain English — no jargon, explains what the code DOES in real-world terms',
    detail: 'Best for: Vibe coders, designers, PMs, or anyone who wants to understand without the alphabet soup.',
    prompt: buildNonTechnicalPrompt,
  },
};

// ─── Prompt Builders ───

function buildTutorPrompt(code, fileName, language) {
  return `You are a patient, encouraging coding tutor. Your job is to add inline comments to the following ${language} file that TEACH the reader what the code does and WHY.

RULES:
- Add comments directly above or beside the relevant lines of code
- Return the COMPLETE file with your comments added — do not remove or change ANY existing code
- Do NOT wrap the output in markdown code fences
- Do NOT add a preamble or explanation outside the code
- Preserve ALL original formatting, indentation, and whitespace exactly
- Keep existing comments intact (including any comments marked with ᚲ from previous runs); add yours as new lines
- CRITICAL: Every comment you add MUST begin with the marker "ᚲ [tutor]" immediately after the comment syntax.
  Examples:
    // ᚲ [tutor] This is the Observer pattern — it lets other parts react when this value changes
    # ᚲ [tutor] This loop processes each item in the queue one by one
    /* ᚲ [tutor] Entry point for the authentication flow */
  The ᚲ marker MUST appear on every single comment you generate, no exceptions.

COMMENTING STYLE — "Tutor":
- Explain the PURPOSE and REASONING behind each section, not just what it does
- Name design patterns when you see them (e.g., "This is the Observer pattern — it lets other parts of the code react when this value changes")
- Explain non-obvious language features (e.g., "The '...' here is called the spread operator — it copies all items from one array into a new one")
- Point out common gotchas or "why it's done this way" insights
- Use a warm, conversational tone — like a senior developer pair-programming with a junior
- For complex blocks, add a brief summary comment at the top explaining the overall goal
- Aim for roughly 1 comment per 3-5 lines of code, more for complex sections, fewer for obvious ones
- Use the comment syntax appropriate for ${language}

FILE: ${fileName}

${code}`;
}

function buildMinimalPrompt(code, fileName, language) {
  return `Add concise inline comments to the following ${language} file.

RULES:
- Add comments directly above or beside the relevant lines of code
- Return the COMPLETE file with your comments added — do not remove or change ANY existing code
- Do NOT wrap the output in markdown code fences
- Do NOT add a preamble or explanation outside the code
- Preserve ALL original formatting, indentation, and whitespace exactly
- Keep existing comments intact (including any comments marked with ᚲ from previous runs); add yours as new lines
- CRITICAL: Every comment you add MUST begin with the marker "ᚲ [minimal]" immediately after the comment syntax.
  Examples:
    // ᚲ [minimal] Auth guard
    # ᚲ [minimal] Process queue items
    /* ᚲ [minimal] Entry point */
  The ᚲ marker MUST appear on every single comment you generate, no exceptions.

COMMENTING STYLE — "Minimal":
- One short line per logical section (5-10 words max per comment)
- Only comment on non-obvious behavior — skip things that are self-evident from the code
- Think of these as signposts, not explanations
- No prose, no teaching, just quick orientation landmarks
- Use the comment syntax appropriate for ${language}

FILE: ${fileName}

${code}`;
}

function buildTechnicalPrompt(code, fileName, language) {
  return `Add professional technical comments to the following ${language} file following current best practices.

RULES:
- Add comments directly above or beside the relevant lines of code
- Return the COMPLETE file with your comments added — do not remove or change ANY existing code
- Do NOT wrap the output in markdown code fences
- Do NOT add a preamble or explanation outside the code
- Preserve ALL original formatting, indentation, and whitespace exactly
- Keep existing comments intact (including any comments marked with ᚲ from previous runs); add yours as new lines
- CRITICAL: Every comment you add MUST begin with the marker "ᚲ [technical]" immediately after the comment syntax.
  Examples:
    // ᚲ [technical] O(n log n) sort via merge sort — stable, suitable for linked structures
    # ᚲ [technical] SHA-256 hash per RFC 6234; timing-safe comparison prevents oracle attacks
    /* ᚲ [technical] Thread-safe singleton via double-checked locking (JSR-133 compliant) */
  The ᚲ marker MUST appear on every single comment you generate, no exceptions.

COMMENTING STYLE — "Technical":
- Use precise technical terminology (name patterns, algorithms, data structures)
- Note time/space complexity for non-trivial operations
- Flag potential edge cases, race conditions, or error-handling gaps
- Reference relevant standards, protocols, or conventions (e.g., "Per RFC 7519, JWT tokens...")
- Document function signatures with @param/@returns style where missing
- Mention thread safety, immutability, or side effects where relevant
- Note any deviations from idiomatic ${language} patterns and why they might exist
- Use the comment syntax appropriate for ${language}

FILE: ${fileName}

${code}`;
}

function buildNonTechnicalPrompt(code, fileName, language) {
  return `Add plain-English comments to the following ${language} file for a NON-TECHNICAL reader.

RULES:
- Add comments directly above or beside the relevant lines of code
- Return the COMPLETE file with your comments added — do not remove or change ANY existing code
- Do NOT wrap the output in markdown code fences
- Do NOT add a preamble or explanation outside the code
- Preserve ALL original formatting, indentation, and whitespace exactly
- Keep existing comments intact (including any comments marked with ᚲ from previous runs); add yours as new lines
- CRITICAL: Every comment you add MUST begin with the marker "ᚲ [non-technical]" immediately after the comment syntax.
  Examples:
    // ᚲ [non-technical] This checks if the person is who they say they are, like showing ID at a door
    # ᚲ [non-technical] This saves the information so it's still there when you come back later
    /* ᚲ [non-technical] This is the starting point — like opening the front door of the app */
  The ᚲ marker MUST appear on every single comment you generate, no exceptions.

COMMENTING STYLE — "Non-Technical":
- Write as if explaining to someone who has NEVER programmed before
- NEVER use jargon: no API, middleware, schema, endpoint, payload, ORM, JWT, CRUD, REST, callback, async, promise, constructor, prototype, etc.
- Instead, use real-world analogies:
  - "This is like a to-do list that the program checks off one by one"
  - "This part checks if the person is who they say they are, like showing ID at a door"
  - "This saves the information so it's still there when you come back later"
- Describe WHAT the code accomplishes in the real world, not HOW it works mechanically
- Every section should be understandable by a designer, PM, or business stakeholder
- Use a friendly, clear tone
- Use the comment syntax appropriate for ${language}

FILE: ${fileName}

${code}`;
}

// ─── Language Detection ───

const LANGUAGE_MAP = {
  'javascript': 'JavaScript',
  'javascriptreact': 'JavaScript (React/JSX)',
  'typescript': 'TypeScript',
  'typescriptreact': 'TypeScript (React/TSX)',
  'python': 'Python',
  'java': 'Java',
  'csharp': 'C#',
  'cpp': 'C++',
  'c': 'C',
  'go': 'Go',
  'rust': 'Rust',
  'ruby': 'Ruby',
  'php': 'PHP',
  'swift': 'Swift',
  'kotlin': 'Kotlin',
  'scala': 'Scala',
  'html': 'HTML',
  'css': 'CSS',
  'scss': 'SCSS',
  'sql': 'SQL',
  'shellscript': 'Bash/Shell',
  'yaml': 'YAML',
  'json': 'JSON',
  'markdown': 'Markdown',
  'dart': 'Dart',
  'lua': 'Lua',
  'r': 'R',
  'perl': 'Perl',
  'elixir': 'Elixir',
  'haskell': 'Haskell',
  'vue': 'Vue',
  'svelte': 'Svelte',
};

function getLanguageName(languageId) {
  return LANGUAGE_MAP[languageId] || languageId;
}

// ─── Main Annotation Function ───

async function annotateFile(apiKey, model) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Grimoire: No file is open. Open a file first, then run Annotate.');
    return;
  }

  const document = editor.document;
  const code = document.getText();
  const fileName = document.fileName.split(/[\\/]/).pop();
  const language = getLanguageName(document.languageId);

  if (code.length > 100000) {
    vscode.window.showWarningMessage(
      'Grimoire: This file is very large (>100KB). Annotation may be slow or hit token limits. Consider annotating individual sections.'
    );
  }

  // Show mode picker — includes annotation modes + erase option
  const modeItems = Object.entries(ANNOTATION_MODES).map(([key, mode]) => ({
    label: mode.label,
    description: mode.description,
    detail: mode.detail,
    _key: key,
  }));

  // Add separator + erase option so it's discoverable alongside modes
  const existingCount = countGrimoireComments(code);
  if (existingCount > 0) {
    modeItems.push({
      label: '$(trash) Strip All Grimoire Comments',
      description: `Remove all ${existingCount} ᚲ comments from this file`,
      detail: 'Removes every Grimoire-generated comment. Your code and non-Grimoire comments are preserved.',
      _key: '_erase',
    });
  }

  const selected = await vscode.window.showQuickPick(modeItems, {
    placeHolder: existingCount > 0
      ? `Choose annotation style (${existingCount} ᚲ comments detected)`
      : 'Choose annotation style',
    title: `Annotate: ${fileName}`,
  });

  if (!selected) return;

  // Handle erase: strip all ᚲ comments from this single file and return early
  if (selected._key === '_erase') {
    const { stripped, count } = stripGrimoireComments(code);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(code.length)
    );
    edit.replace(document.uri, fullRange, stripped);
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage(
      `Grimoire: Stripped ${count} ᚲ comments from ${fileName}. Clean slate.`
    );
    return;
  }

  const mode = ANNOTATION_MODES[selected._key];

  // ─── Comment Strategy: Replace vs Merge ───
  let codeToAnnotate = code;
  const existingModes = detectModes(code);

  if (existingModes.length > 0) {
    const config = vscode.workspace.getConfiguration('grim');
    const strategy = config.get('commentStrategy', 'replace');

    if (strategy === 'ask') {
      const existingLabel = existingModes.join(', ');
      const commentCount = countGrimoireComments(code);
      const strategyPick = await vscode.window.showQuickPick(
        [
          {
            label: '$(replace) Replace',
            description: `Remove ${commentCount} existing ᚲ [${existingLabel}] comments, then annotate fresh`,
            _strategy: 'replace',
          },
          {
            label: '$(add) Merge',
            description: `Keep existing ᚲ comments and add new [${selected._key}] comments alongside`,
            _strategy: 'merge',
          },
          {
            label: '$(close) Cancel',
            description: 'Do nothing',
            _strategy: 'cancel',
          },
        ],
        {
          placeHolder: `This file has ${commentCount} Grimoire [${existingLabel}] comments. Replace or merge?`,
          title: 'Comment Strategy',
        }
      );

      if (!strategyPick || strategyPick._strategy === 'cancel') return;

      if (strategyPick._strategy === 'replace') {
        const { stripped } = stripGrimoireComments(code);
        codeToAnnotate = stripped;
      }
    } else if (strategy === 'replace') {
      const { stripped } = stripGrimoireComments(code);
      codeToAnnotate = stripped;
    }
  }

  const prompt = mode.prompt(codeToAnnotate, fileName, language);

  let annotatedCode;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Grimoire: Annotating ${fileName} (${selected._key} mode)...`,
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ increment: 0, message: 'Sending to Claude...' });

      try {
        annotatedCode = await callAnnotationAPI(apiKey, model, prompt, token);
      } catch (err) {
        vscode.window.showErrorMessage(`Grimoire Annotate Error: ${err.message}`);
        return;
      }

      progress.report({ increment: 100, message: 'Done!' });
    }
  );

  if (!annotatedCode) return;

  annotatedCode = annotatedCode
    .replace(/^```[\w]*\n?/, '')
    .replace(/\n?```\s*$/, '');

  const originalUri = document.uri;
  const annotatedUri = vscode.Uri.parse(
    `grimoire-annotated:${fileName}?mode=${selected._key}&ts=${Date.now()}`
  );

  const provider = new AnnotatedContentProvider(annotatedCode);
  const disposable = vscode.workspace.registerTextDocumentContentProvider('grimoire-annotated', provider);

  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    annotatedUri,
    `${fileName} ↔ Annotated (${selected._key})`,
    { preview: true }
  );

  const action = await vscode.window.showInformationMessage(
    `Annotated ${fileName} with ${selected._key} comments. Apply changes?`,
    'Apply to File',
    'Copy to Clipboard',
    'Dismiss'
  );

  if (action === 'Apply to File') {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(code.length)
    );
    edit.replace(document.uri, fullRange, annotatedCode);
    await vscode.workspace.applyEdit(edit);
    vscode.window.showInformationMessage(`Grimoire: Applied ${selected._key} annotations to ${fileName}`);
  } else if (action === 'Copy to Clipboard') {
    await vscode.env.clipboard.writeText(annotatedCode);
    vscode.window.showInformationMessage('Annotated code copied to clipboard!');
  }

  disposable.dispose();
}

// ─── Content Provider for Diff View ───

class AnnotatedContentProvider {
  constructor(content) {
    this._content = content;
  }

  provideTextDocumentContent(uri) {
    return this._content;
  }
}

// ─── API Call ───

async function callAnnotationAPI(apiKey, model, prompt, token) {
  return new Promise((resolve, reject) => {
    if (token?.isCancellationRequested) {
      reject(new Error('Cancelled'));
      return;
    }

    const data = JSON.stringify({
      model,
      max_tokens: 16384,
      messages: [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = require('https').request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'API error'));
            return;
          }
          const text = parsed.content?.map(b => b.text || '').join('') || '';
          if (!text) {
            reject(new Error('Empty response from Claude'));
            return;
          }
          resolve(text);
        } catch (e) {
          reject(new Error(`Invalid response: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('Request timed out (3 min)')); });

    if (token) {
      token.onCancellationRequested(() => { req.destroy(); reject(new Error('Cancelled')); });
    }

    req.write(data);
    req.end();
  });
}

// ─── Bulk Workspace Annotation ───

const ANNOTATABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.cs', '.cpp', '.c', '.h',
  '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala', '.dart', '.lua',
  '.r', '.pl', '.ex', '.exs', '.hs', '.vue', '.svelte', '.css', '.scss',
  '.sql', '.sh', '.bash', '.zsh',
]);

async function annotateWorkspace(apiKey, model) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || !workspaceFolders.length) {
    vscode.window.showWarningMessage('Grimoire: No workspace folder open.');
    return;
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;
  const fs = require('fs');
  const path = require('path');

  // ─── Git safety check ───
  let hasGit = false;
  let hasDirtyFiles = false;
  try {
    const { execSync } = require('child_process');
    execSync('git rev-parse --is-inside-work-tree', { cwd: workspacePath, stdio: 'pipe' });
    hasGit = true;
    const status = execSync('git status --porcelain', { cwd: workspacePath, stdio: 'pipe' }).toString().trim();
    hasDirtyFiles = status.length > 0;
  } catch {
    // Not a git repo or git not available
  }

  if (hasGit && hasDirtyFiles) {
    const proceed = await vscode.window.showWarningMessage(
      'Grimoire: You have uncommitted changes. Bulk annotation will modify files in-place. Commit or stash first so you can easily revert.',
      { modal: true },
      'Annotate Anyway',
      'Cancel'
    );
    if (proceed !== 'Annotate Anyway') return;
  } else if (!hasGit) {
    const proceed = await vscode.window.showWarningMessage(
      'Grimoire: This folder is not a git repo. Bulk annotation modifies files in-place with no easy undo. Consider initializing git first.',
      { modal: true },
      'Annotate Anyway',
      'Cancel'
    );
    if (proceed !== 'Annotate Anyway') return;
  }

  // ─── Mode selection ───
  const modeItems = Object.entries(ANNOTATION_MODES).map(([key, mode]) => ({
    label: mode.label,
    description: mode.description,
    detail: mode.detail,
    _key: key,
  }));

  modeItems.push({
    label: '$(trash) Strip All Grimoire Comments',
    description: 'Remove all ᚲ comments from every file in this workspace',
    detail: 'Walks the workspace, strips every Grimoire-generated comment, and deletes .grimoire.json. Your code is preserved.',
    _key: '_erase_all',
  });

  const selected = await vscode.window.showQuickPick(modeItems, {
    placeHolder: 'Choose annotation style for all files',
    title: 'Bulk Annotate Workspace',
  });
  if (!selected) return;

  if (selected._key === '_erase_all') {
    await eraseAllComments();
    return;
  }

  const mode = ANNOTATION_MODES[selected._key];

  // ─── Collect annotatable files ───
  const config = vscode.workspace.getConfiguration('grim');
  const excludeDirs = new Set([
    'node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next', '__pycache__',
    'venv', '.venv', 'env', '.env', 'vendor', 'target', 'coverage',
    '.grimoire', ...(config.get('exclude', []) || []),
  ]);

  const files = [];
  function walkDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // FIX: log walkDir failures instead of silently swallowing them
      console.error(`[Grimoire] walkDir failed on "${dir}": ${err.message}`);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) walkDir(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ANNOTATABLE_EXTENSIONS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size < 100000 && stat.size > 10) {
              files.push(fullPath);
            } else {
              // FIX: log why files are being skipped at the collection stage
              console.warn(`[Grimoire] Skipping "${fullPath}" — size ${stat.size} bytes (limit: 10–100000)`);
            }
          } catch (err) {
            // FIX: log stat failures instead of silently swallowing them
            console.error(`[Grimoire] statSync failed on "${fullPath}": ${err.message}`);
          }
        }
      }
    }
  }
  walkDir(workspacePath);

  if (files.length === 0) {
    vscode.window.showInformationMessage('Grimoire: No annotatable source files found in this workspace.');
    return;
  }

  const confirm = await vscode.window.showInformationMessage(
    `Grimoire will annotate ${files.length} files in-place using "${selected._key}" mode. This will call the Claude API for each file.`,
    { modal: true },
    `Annotate ${files.length} Files`,
    'Cancel'
  );
  if (confirm !== `Annotate ${files.length} Files`) return;

  // ─── Process files ───
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // FIX: track per-file failure reasons so we can surface them in the summary
  const failureLog = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Grimoire: Annotating workspace...',
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < files.length; i++) {
        if (token.isCancellationRequested) {
          skipped = files.length - i;
          break;
        }

        const filePath = files[i];
        const fileName = path.basename(filePath);
        const relPath = path.relative(workspacePath, filePath);
        progress.report({
          increment: (1 / files.length) * 100,
          message: `(${i + 1}/${files.length}) ${relPath}`,
        });

        try {
          let code = fs.readFileSync(filePath, 'utf8');

          const bulkConfig = vscode.workspace.getConfiguration('grim');
          const bulkStrategy = bulkConfig.get('commentStrategy', 'replace');
          if (bulkStrategy === 'replace' && hasGrimoireComments(code)) {
            const { stripped } = stripGrimoireComments(code);
            code = stripped;
          }

          const ext = path.extname(fileName).toLowerCase();
          const langMap = {
            '.js': 'JavaScript', '.jsx': 'JavaScript (React)', '.ts': 'TypeScript',
            '.tsx': 'TypeScript (React)', '.py': 'Python', '.java': 'Java',
            '.cs': 'C#', '.cpp': 'C++', '.c': 'C', '.h': 'C/C++ Header',
            '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby', '.php': 'PHP',
            '.swift': 'Swift', '.kt': 'Kotlin', '.scala': 'Scala',
            '.dart': 'Dart', '.lua': 'Lua', '.r': 'R', '.pl': 'Perl',
            '.ex': 'Elixir', '.exs': 'Elixir', '.hs': 'Haskell',
            '.vue': 'Vue', '.svelte': 'Svelte', '.css': 'CSS', '.scss': 'SCSS',
            '.sql': 'SQL', '.sh': 'Bash', '.bash': 'Bash', '.zsh': 'Zsh',
          };
          const language = langMap[ext] || ext.slice(1);

          const prompt = mode.prompt(code, fileName, language);
          let annotated = await callAnnotationAPI(apiKey, model, prompt, token);

          annotated = annotated.replace(/^```[\w]*\n?/, '').replace(/\n?```\s*$/, '');

          fs.writeFileSync(filePath, annotated, 'utf8');
          succeeded++;
        } catch (err) {
          // FIX: log the full error (not just message) and collect for summary
          console.error(`[Grimoire] FAILED: "${relPath}" — ${err.message}`, err);
          failureLog.push({ relPath, reason: err.message });
          failed++;
        }

        if (i < files.length - 1) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
  );

  // ─── Summary ───
  let summary = `Grimoire: Annotated ${succeeded} files with "${selected._key}" comments.`;
  if (failed > 0) summary += ` ${failed} failed.`;
  if (skipped > 0) summary += ` ${skipped} skipped (cancelled).`;

  // FIX: if there were failures, offer to show details instead of silently moving on
  if (failed > 0) {
    const failDetails = failureLog
      .map(f => `• ${f.relPath}: ${f.reason}`)
      .join('\n');

    const action = await vscode.window.showWarningMessage(
      summary + ' Check the Output panel (Grimoire) for details, or click below.',
      'Show Failed Files',
      'OK'
    );

    if (action === 'Show Failed Files') {
      const doc = await vscode.workspace.openTextDocument({
        content: `Grimoire — Annotation Failures\n${'─'.repeat(40)}\n\n${failDetails}`,
        language: 'plaintext',
      });
      await vscode.window.showTextDocument(doc);
    }
  } else if (hasGit && succeeded > 0) {
    const action = await vscode.window.showInformationMessage(
      summary + ' You can review changes with `git diff` and revert with `git checkout .` if needed.',
      'View Git Diff',
      'OK'
    );
    if (action === 'View Git Diff') {
      const terminal = vscode.window.createTerminal('Grimoire Diff');
      terminal.show();
      terminal.sendText('git diff --stat');
    }
  } else {
    vscode.window.showInformationMessage(summary);
  }
}

// ─── Erase All Grimoire Comments ───

/**
 * Strips all ᚲ-tagged comments from every source file in the workspace
 * and deletes .grimoire.json. Full clean slate — as if Grimoire was never run.
 */
async function eraseAllComments() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || !workspaceFolders.length) {
    vscode.window.showWarningMessage('Grimoire: No workspace folder open.');
    return;
  }

  const workspacePath = workspaceFolders[0].uri.fsPath;
  const fs = require('fs');
  const path = require('path');

  const config = vscode.workspace.getConfiguration('grim');
  const excludeDirs = new Set([
    'node_modules', '.git', '.svn', 'dist', 'build', 'out', '.next', '__pycache__',
    'venv', '.venv', 'env', '.env', 'vendor', 'target', 'coverage',
    '.grimoire', ...(config.get('exclude', []) || []),
  ]);

  const filesToClean = [];

  function walkDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.error(`[Grimoire] walkDir failed on "${dir}": ${err.message}`);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) walkDir(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (ANNOTATABLE_EXTENSIONS.has(ext)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (hasGrimoireComments(content)) {
              filesToClean.push(fullPath);
            }
          } catch (err) {
            console.error(`[Grimoire] Could not read "${fullPath}" during erase scan: ${err.message}`);
          }
        }
      }
    }
  }
  walkDir(workspacePath);

  const grimoireJsonPath = path.join(workspacePath, '.grimoire.json');
  const hasGrimoireJson = fs.existsSync(grimoireJsonPath);

  if (filesToClean.length === 0 && !hasGrimoireJson) {
    vscode.window.showInformationMessage('Grimoire: No ᚲ comments or .grimoire.json found. Nothing to erase.');
    return;
  }

  const parts = [];
  if (filesToClean.length > 0) parts.push(`${filesToClean.length} files with ᚲ comments`);
  if (hasGrimoireJson) parts.push('.grimoire.json');

  const confirm = await vscode.window.showWarningMessage(
    `Grimoire: Erase all? This will clean ${parts.join(' and ')}. This cannot be undone (unless you have git).`,
    { modal: true },
    'Erase Everything',
    'Cancel'
  );

  if (confirm !== 'Erase Everything') {
    vscode.window.showInformationMessage('Grimoire: Erase cancelled.');
    return;
  }

  let cleaned = 0;
  let totalRemoved = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Grimoire: Erasing comments...',
      cancellable: false,
    },
    async (progress) => {
      for (let i = 0; i < filesToClean.length; i++) {
        const filePath = filesToClean[i];
        const relPath = path.relative(workspacePath, filePath);
        progress.report({
          increment: (1 / filesToClean.length) * 90,
          message: `(${i + 1}/${filesToClean.length}) ${relPath}`,
        });

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const { stripped, count } = stripGrimoireComments(content);
          fs.writeFileSync(filePath, stripped, 'utf8');
          cleaned++;
          totalRemoved += count;
        } catch (err) {
          console.error(`[Grimoire] Failed to clean "${relPath}": ${err.message}`);
        }
      }

      if (hasGrimoireJson) {
        try {
          fs.unlinkSync(grimoireJsonPath);
          progress.report({ increment: 10, message: 'Deleted .grimoire.json' });
        } catch (err) {
          console.error(`[Grimoire] Failed to delete .grimoire.json: ${err.message}`);
        }
      }
    }
  );

  let summary = `Grimoire: Erased ${totalRemoved} comments from ${cleaned} files.`;
  if (hasGrimoireJson) summary += ' Deleted .grimoire.json.';
  summary += ' Clean slate.';

  vscode.window.showInformationMessage(summary, 'OK');
}

module.exports = { annotateFile, annotateWorkspace, eraseAllComments, ANNOTATION_MODES };
