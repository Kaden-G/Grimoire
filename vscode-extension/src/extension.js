// @ts-nocheck
/**
 * Grimoire — VS Code Extension Entry Point
 * Registers commands, sidebar tree view, and interactive map webview.
 */

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { scanWorkspace, applyDescriptions, collectPaths } = require('./scanner');
const { GrimoireTreeProvider } = require('./treeProvider');
const { GrimoirePanel } = require('./webviewPanel');
const { annotateFile, annotateWorkspace, eraseAllComments } = require('./annotator');
const { WelcomePanel } = require('./welcomePanel');
const { callAnthropic, parseJsonResponse } = require('./anthropic');
const { buildAgentContext } = require('./agentContext');
const { planDescriptions } = require('./incremental');

let treeProvider;
let lastScanResult = null;

// Secret-storage key for the Anthropic API key. Stored via VS Code SecretStorage
// (encrypted) — never in plaintext settings.
const API_KEY_SECRET = 'grim.anthropicApiKey';

function activate(context) {
  console.log('Grimoire: activating');

  // Create tree provider for sidebar
  treeProvider = new GrimoireTreeProvider();
  vscode.window.registerTreeDataProvider('grimTree', treeProvider);

  // Auto-load .grimoire.json if it exists
  autoLoadExisting();

  // ─── Command: Setup / Welcome ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.setup', () => {
      WelcomePanel.createOrShow(context);
    })
  );

  // Show welcome on first install (no key + never completed onboarding)
  const onboardingDone = context.globalState.get('grimoire.onboardingComplete', false);
  (async () => {
    const hasKey = await getApiKey(context);
    if (!onboardingDone && !hasKey) {
      // Slight delay so VS Code finishes loading first
      setTimeout(() => {
        WelcomePanel.createOrShow(context);
      }, 1500);
    }
  })();

  // ─── Command: Scan Workspace (auto-includes AI descriptions when API key is available) ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.scan', async () => {
      const workspacePath = getWorkspacePath();
      if (!workspacePath) return;

      const config = vscode.workspace.getConfiguration('grim');
      let apiKey = await getApiKey(context);

      // If no API key, prompt setup — AI descriptions are the core feature
      if (!apiKey) {
        const action = await vscode.window.showWarningMessage(
          'Grimoire uses AI to describe your codebase. Set up an API key to get started.',
          'Set Up Now',
          'Enter Key Manually',
          'Scan Without AI'
        );
        if (action === 'Set Up Now') {
          WelcomePanel.createOrShow(context);
          return;
        } else if (action === 'Enter Key Manually') {
          apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic API key',
            password: true,
            placeHolder: 'sk-ant-...',
          });
          if (!apiKey) return;
          await storeApiKey(context, apiKey);
        } else if (action !== 'Scan Without AI') {
          return; // dismissed
        }
      }

      const useAI = !!apiKey;

      // Ask description style every time for a new scan
      let plainEnglish = config.get('plainEnglish', true);
      let annotationModeKey = null;
      if (useAI) {
        const style = await vscode.window.showQuickPick(
          [
            { label: '$(book) Plain English', description: 'Friendly descriptions anyone can understand', value: true },
            { label: '$(code) Technical', description: 'Concise developer-oriented descriptions', value: false },
          ],
          { placeHolder: 'How should Grimoire describe your code?', title: 'Description Style' }
        );
        if (!style) return; // user cancelled
        plainEnglish = style.value;

        // Ask about inline comments
        const commentStyle = await vscode.window.showQuickPick(
          [
            { label: '$(mortar-board) Tutor', description: 'Teaching mode — explains WHY things work', _key: 'tutor' },
            { label: '$(dash) Minimal', description: 'Just the essentials — one-line comments per section', _key: 'minimal' },
            { label: '$(tools) Technical', description: 'Best-practice annotations with proper terminology', _key: 'technical' },
            { label: '$(heart) Non-Technical', description: 'Plain English — no jargon, real-world explanations', _key: 'non-technical' },
            { label: '$(circle-slash) None', description: 'Skip inline comments for now', _key: 'none' },
          ],
          { placeHolder: 'Add inline comments to your files? (You can always do this later via Command Palette)', title: 'Inline Comments' }
        );
        if (!commentStyle) return; // user cancelled
        if (commentStyle._key !== 'none') {
          annotationModeKey = commentStyle._key;
        }
      }

      let scanSucceeded = false;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: useAI ? 'Grimoire: Scanning with AI...' : 'Grimoire: Scanning workspace...',
          cancellable: true,
        },
        async (progress, token) => {
          progress.report({ increment: 0, message: 'Walking directory tree...' });

          const result = await scanWorkspace(workspacePath, {}, token);
          if (!result || token.isCancellationRequested) {
            vscode.window.showWarningMessage('Grimoire: Scan was cancelled.');
            return;
          }

          // If API key is available, automatically generate AI descriptions
          if (useAI) {
            progress.report({ increment: 30, message: 'Generating AI descriptions...' });

            try {
              // Incremental: reuse descriptions for unchanged paths from the previous
              // map and only send new/changed paths to the model (the "living map").
              const incremental = config.get('incremental', true);
              const prev = incremental ? loadPreviousMap(workspacePath) : null;
              const { toDescribe, reuse } = planDescriptions({
                prev,
                allPaths: result.allPaths,
                nextSnippets: result.snippets || {},
                plainEnglish,
              });
              const reusedCount = applyDescriptions(result.output.tree, reuse);

              let failedBatches = 0;
              let aiApplied = 0;
              if (toDescribe.length > 0) {
                const res = await callClaudeAPI(
                  apiKey, toDescribe, result.readme,
                  config.get('model', 'claude-sonnet-4-20250514'),
                  config.get('batchSize', 20),
                  result.snippets, progress, token, plainEnglish
                );
                failedBatches = res.failedBatches;
                aiApplied = applyDescriptions(result.output.tree, res.descs);
              }
              const applied = reusedCount + aiApplied;
              result.output.model = config.get('model', 'claude-sonnet-4-20250514');
              result.output.plainEnglish = plainEnglish;

              progress.report({ increment: 90, message: 'Saving...' });

              lastScanResult = result;
              treeProvider.setData(result.output.tree, workspacePath, result.snippets);

              const outputPath = path.join(workspacePath, '.grimoire.json');
              fs.writeFileSync(outputPath, JSON.stringify(result.output, null, 2));
              ensureGitignored(workspacePath);
              writeAgentContextIfEnabled(workspacePath, result.output);
              scanSucceeded = true;

              progress.report({ increment: 100, message: 'Done!' });

              let infoMsg = `Grimoire: ${applied} descriptions on ${result.allPaths.length} items`;
              infoMsg += reusedCount > 0 ? ` (${aiApplied} new/changed, ${reusedCount} reused).` : '.';
              if (failedBatches > 0) infoMsg += ` ${failedBatches} batch(es) failed — those items kept heuristic descriptions.`;
              const action = await vscode.window.showInformationMessage(infoMsg, 'Open Map');
              if (action === 'Open Map') vscode.commands.executeCommand('grim.openMap');
            } catch (err) {
              vscode.window.showErrorMessage(`Grimoire AI Error: ${err.message}`);
            }
          } else {
            // Heuristic-only fallback
            progress.report({ increment: 70, message: 'Building map...' });

            lastScanResult = result;
            treeProvider.setData(result.output.tree, workspacePath, result.snippets);

            const outputPath = path.join(workspacePath, '.grimoire.json');
            fs.writeFileSync(outputPath, JSON.stringify(result.output, null, 2));
            ensureGitignored(workspacePath);
            writeAgentContextIfEnabled(workspacePath, result.output);
            scanSucceeded = true;

            progress.report({ increment: 100, message: 'Done!' });

            const action = await vscode.window.showInformationMessage(
              `Grimoire: Mapped ${result.allPaths.length} items. Add an API key for AI descriptions!`,
              'Open Map',
              'Set Up API Key'
            );
            if (action === 'Open Map') vscode.commands.executeCommand('grim.openMap');
            else if (action === 'Set Up API Key') WelcomePanel.createOrShow(context);
          }
        }
      );

      // Run inline annotation after scan completes (outside withProgress so it gets its own progress bar).
      // Only proceed if the scan actually finished (not cancelled), and pass the
      // already-chosen mode so annotateWorkspace doesn't prompt for it again.
      if (scanSucceeded && annotationModeKey && apiKey) {
        await annotateWorkspace(apiKey, config.get('model', 'claude-sonnet-4-20250514'), annotationModeKey);
      }
    })
  );

  // ─── Command: Scan with AI (alias — just calls grim.scan) ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.scanWithAI', () => {
      vscode.commands.executeCommand('grim.scan');
    })
  );

  // ─── Command: Open Interactive Map ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.openMap', () => {
      const data = treeProvider.getData();
      if (!data) {
        vscode.window.showWarningMessage(
          'No map data yet. Run "Grimoire: Scan Workspace" first.',
          'Scan Now'
        ).then(action => {
          if (action === 'Scan Now') vscode.commands.executeCommand('grim.scan');
        });
        return;
      }

      const workspacePath = getWorkspacePath();
      GrimoirePanel.createOrShow(
        context.extensionUri,
        data,
        workspacePath,
        treeProvider.getSnippets()
      );
    })
  );

  // ─── Command: Refresh ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.refresh', () => {
      const workspacePath = getWorkspacePath();
      if (workspacePath) {
        autoLoadExisting();
        treeProvider.refresh();
      }
    })
  );

  // ─── Command: Open File ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.openFile', (filePath) => {
      if (!filePath) return;
      const uri = vscode.Uri.file(filePath);
      vscode.workspace.openTextDocument(uri).then(
        (doc) => vscode.window.showTextDocument(doc),
        () => vscode.window.showWarningMessage(`Could not open: ${filePath}`)
      );
    })
  );

  // ─── Command: Search by Tag ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.searchByTag', async () => {
      const data = treeProvider.getData();
      if (!data) {
        vscode.window.showWarningMessage('No map data yet. Scan your workspace first.');
        return;
      }

      // Collect all unique tags
      const tags = new Set();
      function collectTags(node) {
        for (const f of node.files || []) {
          for (const t of f.tags || []) tags.add(t);
        }
        for (const c of node.children || []) collectTags(c);
      }
      collectTags(data);

      const selected = await vscode.window.showQuickPick([...tags].sort(), {
        placeHolder: 'Select a tag to filter by',
      });
      if (!selected) return;

      // Find all files with this tag
      const matches = [];
      function findByTag(node, prefix = '') {
        const cur = prefix ? `${prefix}/${node.name}` : node.name;
        for (const f of node.files || []) {
          if (f.tags && f.tags.includes(selected)) {
            matches.push({ name: f.name, purpose: f.purpose, path: `${cur}/${f.name}` });
          }
        }
        for (const c of node.children || []) findByTag(c, cur);
      }
      findByTag(data);

      if (!matches.length) {
        vscode.window.showInformationMessage(`No files found with tag "${selected}"`);
        return;
      }

      const items = matches.map(m => ({
        label: `$(file) ${m.name}`,
        description: m.purpose,
        detail: m.path,
        _filePath: m.path,
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: `${matches.length} files tagged "${selected}"`,
      });

      if (pick) {
        const workspacePath = getWorkspacePath();
        if (workspacePath) {
          const parts = pick._filePath.split('/');
          parts.shift();
          const absPath = path.join(workspacePath, ...parts);
          vscode.commands.executeCommand('grim.openFile', absPath);
        }
      }
    })
  );

  // ─── Command: Annotate Current File ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.annotateFile', async () => {
      const config = vscode.workspace.getConfiguration('grim');
      let apiKey = await getApiKey(context);

      if (!apiKey) {
        const action = await vscode.window.showWarningMessage(
          'Grimoire needs an API key for AI annotation.',
          'Set Up Now',
          'Enter Key Manually'
        );
        if (action === 'Set Up Now') {
          WelcomePanel.createOrShow(context);
          return;
        } else if (action === 'Enter Key Manually') {
          apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic API key',
            password: true,
            placeHolder: 'sk-ant-...',
          });
        }
        if (!apiKey) return;
        await storeApiKey(context, apiKey);
      }

      const model = config.get('model', 'claude-sonnet-4-20250514');
      await annotateFile(apiKey, model);
    })
  );

  // ─── Command: Annotate Workspace (bulk) ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.annotateWorkspace', async () => {
      const config = vscode.workspace.getConfiguration('grim');
      let apiKey = await getApiKey(context);

      if (!apiKey) {
        const action = await vscode.window.showWarningMessage(
          'Grimoire needs an API key for AI annotation.',
          'Set Up Now',
          'Enter Key Manually'
        );
        if (action === 'Set Up Now') {
          WelcomePanel.createOrShow(context);
          return;
        } else if (action === 'Enter Key Manually') {
          apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic API key',
            password: true,
            placeHolder: 'sk-ant-...',
          });
        }
        if (!apiKey) return;
        await storeApiKey(context, apiKey);
      }

      const model = config.get('model', 'claude-sonnet-4-20250514');
      await annotateWorkspace(apiKey, model);
    })
  );

  // ─── Command: Erase All Grimoire Comments ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.eraseComments', async () => {
      await eraseAllComments();
    })
  );

  // ─── Command: Export Agent Context (.grimoire-context.md for AI coding agents) ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.exportContext', async () => {
      const workspacePath = getWorkspacePath();
      if (!workspacePath) return;

      let mapData;
      const jsonPath = path.join(workspacePath, '.grimoire.json');
      if (fs.existsSync(jsonPath)) {
        try { mapData = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { /* fall through to tree provider */ }
      }
      if (!mapData) {
        const tree = treeProvider.getData();
        if (!tree) {
          vscode.window.showWarningMessage('Grimoire: No map yet. Run "Grimoire: Scan Workspace" first.');
          return;
        }
        mapData = { tree };
      }

      const outPath = writeAgentContext(workspacePath, mapData);
      if (outPath) {
        const action = await vscode.window.showInformationMessage(
          'Grimoire: Wrote .grimoire-context.md — a compact repo map your AI coding agent can load.',
          'Open'
        );
        if (action === 'Open') {
          vscode.workspace.openTextDocument(vscode.Uri.file(outPath)).then(doc => vscode.window.showTextDocument(doc));
        }
      } else {
        vscode.window.showErrorMessage('Grimoire: Could not write .grimoire-context.md.');
      }
    })
  );

  // Watch for .grimoire.json changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/.grimoire.json');
  watcher.onDidChange(() => autoLoadExisting());
  watcher.onDidCreate(() => autoLoadExisting());
  context.subscriptions.push(watcher);
}

// ─── Helpers ───

function getWorkspacePath() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) {
    vscode.window.showWarningMessage('No workspace folder open.');
    return null;
  }
  return folders[0].uri.fsPath;
}

function autoLoadExisting() {
  const workspacePath = getWorkspacePath();
  if (!workspacePath) return;

  const jsonPath = path.join(workspacePath, '.grimoire.json');
  if (!fs.existsSync(jsonPath)) return;

  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    if (data.tree) {
      treeProvider.setData(data.tree, data.basePath || workspacePath, data.snippets || {});
      console.log('Grimoire: Loaded existing .grimoire.json');
    }
  } catch (err) {
    console.warn('Grimoire: Could not parse .grimoire.json:', err.message);
  }
}

// Ensure .grimoire.json is gitignored. It can contain source-code snippets, so it
// should not be committed. Silent when already present (called after every scan).
function ensureGitignored(workspacePath) {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8');
    }
    if (content.includes('.grimoire.json')) return; // already ignored — stay quiet
    const line = !content || content.endsWith('\n') ? '.grimoire.json\n' : '\n.grimoire.json\n';
    fs.appendFileSync(gitignorePath, line);
    vscode.window.showInformationMessage('Grimoire: Added .grimoire.json to .gitignore (it can contain code snippets).');
  } catch (err) {
    console.warn('Grimoire: Could not update .gitignore:', err.message);
  }
}

// Load the previously saved .grimoire.json (for incremental re-scans). Returns null if absent/invalid.
function loadPreviousMap(workspacePath) {
  try {
    const p = path.join(workspacePath, '.grimoire.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.warn('Grimoire: could not load previous map for incremental scan:', err.message);
    return null;
  }
}

// Write the agent-context Markdown (.grimoire-context.md). Returns the path on success.
function writeAgentContext(workspacePath, mapData) {
  try {
    const md = buildAgentContext(mapData);
    const outPath = path.join(workspacePath, '.grimoire-context.md');
    fs.writeFileSync(outPath, md);
    return outPath;
  } catch (err) {
    console.warn('Grimoire: Could not write agent context:', err.message);
    return null;
  }
}

// Auto-export the agent context after a scan, unless disabled via grim.agentContext.
function writeAgentContextIfEnabled(workspacePath, mapData) {
  if (!vscode.workspace.getConfiguration('grim').get('agentContext', true)) return;
  writeAgentContext(workspacePath, mapData);
}

// ─── API key (SecretStorage) ───

// Resolve the Anthropic API key from the most secure source available:
//   1. VS Code SecretStorage (encrypted, preferred)
//   2. ANTHROPIC_API_KEY environment variable
//   3. Legacy plaintext setting — migrated into SecretStorage, then cleared
async function getApiKey(context) {
  const fromSecret = await context.secrets.get(API_KEY_SECRET);
  if (fromSecret) return fromSecret;

  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;

  const config = vscode.workspace.getConfiguration('grim');
  const legacy = config.get('anthropicApiKey');
  if (legacy) {
    try {
      await context.secrets.store(API_KEY_SECRET, legacy);
      await config.update('anthropicApiKey', undefined, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('Grimoire: Moved your API key into VS Code Secret Storage for safer, encrypted storage.');
    } catch (err) {
      console.warn('Grimoire: API key migration failed:', err.message);
    }
    return legacy;
  }

  return undefined;
}

// Persist a key (e.g. one entered manually via the command palette) to SecretStorage.
async function storeApiKey(context, key) {
  if (!key) return;
  try {
    await context.secrets.store(API_KEY_SECRET, key);
  } catch (err) {
    console.warn('Grimoire: Could not store API key in SecretStorage:', err.message);
  }
}

// ─── AI API calls ───

async function callClaudeAPI(apiKey, allPaths, readme, model, batchSize, snippets, progress, token, plainEnglish = true) {
  const allDescs = {};
  const effectiveBatch = snippets && Object.keys(snippets).length ? Math.min(batchSize, 20) : batchSize;
  const batches = [];
  for (let i = 0; i < allPaths.length; i += effectiveBatch) {
    batches.push(allPaths.slice(i, i + effectiveBatch));
  }
  if (batches.length === 0) return { descs: allDescs, failedBatches: 0 };

  // Run batches through a bounded concurrency pool. Retry/backoff is handled by the
  // shared client; failed batches are counted (not silently dropped) so the caller
  // can tell the user those items kept heuristic descriptions.
  const concurrency = Math.max(1, Math.min(vscode.workspace.getConfiguration('grim').get('maxConcurrency', 5), 12));
  let nextIndex = 0;
  let completed = 0;
  let failedBatches = 0;

  const runBatch = async (batch) => {
    const batchSnippets = {};
    if (snippets) {
      for (const p of batch) {
        if (snippets[p]) batchSnippets[p] = snippets[p];
      }
    }
    const prompt = buildPrompt(batch, readme, Object.keys(batchSnippets).length ? batchSnippets : null, plainEnglish);
    const text = await callAnthropic({ apiKey, model, prompt, maxTokens: 8192 }, token);
    Object.assign(allDescs, parseJsonResponse(text));
  };

  const worker = async () => {
    while (true) {
      if (token?.isCancellationRequested) return;
      const i = nextIndex++;
      if (i >= batches.length) return;
      try {
        await runBatch(batches[i]);
      } catch (err) {
        if (err.message === 'Cancelled') return;
        console.warn(`Grimoire: description batch ${i + 1} failed:`, err.message);
        failedBatches++;
      } finally {
        completed++;
        // Spread the 30→90 progress band across batches as they finish.
        progress.report({ increment: (1 / batches.length) * 60, message: `AI descriptions: ${completed}/${batches.length} batches...` });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { descs: allDescs, failedBatches };
}

function buildPrompt(paths, readme, snippets, plainEnglish = true) {
  const context = readme ? ` Project context: ${readme.slice(0, 1500)}` : '';
  let pathList;
  if (snippets) {
    pathList = paths.map(p => {
      if (snippets[p]) {
        const lines = snippets[p].split('\n').slice(0, 6);
        const preview = lines.map(l => `  | ${l}`).join('\n');
        return `${p}\n${preview}`;
      }
      return p;
    }).join('\n');
  } else {
    pathList = paths.join('\n');
  }

  let instructions, example;
  if (plainEnglish) {
    instructions = `Describe each file/directory path below in 15-25 words using plain, everyday English. Write for someone who is NOT a professional developer. NEVER use jargon like API, ORM, middleware, schema, endpoint, payload, serialization, JWT, CRUD, REST, GraphQL, webhook, or similar technical terms. Instead, describe what the file does in terms of its REAL-WORLD effect: 'checks that users are who they say they are' instead of 'JWT auth middleware', 'saves and retrieves user data from the database' instead of 'Prisma ORM client'. Use the code snippets (indented with |) to understand the file's actual purpose.${context}`;
    example = `{"src/auth/middleware.ts": "Checks that someone is logged in before letting them access protected pages, using a secure token system"}`;
  } else {
    instructions = `Describe each file/directory path below in 15-25 words. Be specific about what it DOES, not just what it IS. Mention key technologies, patterns, and behaviors. Use the code snippets (indented with |) to understand the file's actual purpose — imports, classes, and functions reveal intent better than filenames alone.${context}`;
    example = `{"src/auth/middleware.ts": "Express middleware that validates JWT tokens from Authorization header and attaches decoded user payload to request object"}`;
  }

  return `${instructions}\n\nPaths:\n${pathList}\n\nRespond ONLY with a JSON object mapping each path to its description. No markdown fences, no preamble.\nExample: ${example}`;
}

function deactivate() {
  console.log('Grimoire: deactivating');
}

module.exports = { activate, deactivate };
