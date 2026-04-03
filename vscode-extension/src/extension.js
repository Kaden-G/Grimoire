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
const { exportToMarkdown } = require('./grimoireExporter');
const { createGist } = require('./gistShare');

let treeProvider;
let lastScanResult = null;

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
  const config = vscode.workspace.getConfiguration('grim');
  const hasKey = config.get('anthropicApiKey') || process.env.ANTHROPIC_API_KEY;

  if (!onboardingDone && !hasKey) {
    // Slight delay so VS Code finishes loading first
    setTimeout(() => {
      WelcomePanel.createOrShow(context);
    }, 1500);
  }

  // ─── Command: Scan Workspace (auto-includes AI descriptions when API key is available) ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.scan', async () => {
      const workspacePath = getWorkspacePath();
      if (!workspacePath) return;

      const config = vscode.workspace.getConfiguration('grim');
      let apiKey = config.get('anthropicApiKey') || process.env.ANTHROPIC_API_KEY;

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
              const descs = await callClaudeAPI(
                apiKey, result.allPaths, result.readme,
                config.get('model', 'claude-sonnet-4-20250514'),
                config.get('batchSize', 20),
                result.snippets, progress, token, plainEnglish
              );

              const applied = applyDescriptions(result.output.tree, descs);
              result.output.model = config.get('model', 'claude-sonnet-4-20250514');
              result.output.plainEnglish = plainEnglish;

              progress.report({ increment: 90, message: 'Saving...' });

              lastScanResult = result;
              treeProvider.setData(result.output.tree, workspacePath, result.snippets);

              const outputPath = path.join(workspacePath, '.grimoire.json');
              fs.writeFileSync(outputPath, JSON.stringify(result.output, null, 2));

              progress.report({ increment: 100, message: 'Done!' });

              const action = await vscode.window.showInformationMessage(
                `Grimoire: ${applied} AI descriptions applied to ${result.allPaths.length} items.`,
                'Open Map'
              );
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

      // Run inline annotation after scan completes (outside withProgress so it gets its own progress bar)
      if (annotationModeKey && apiKey) {
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
      let apiKey = config.get('anthropicApiKey') || process.env.ANTHROPIC_API_KEY;

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
      }

      const model = config.get('model', 'claude-sonnet-4-20250514');
      await annotateFile(apiKey, model);
    })
  );

  // ─── Command: Annotate Workspace (bulk) ───
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.annotateWorkspace', async () => {
      const config = vscode.workspace.getConfiguration('grim');
      let apiKey = config.get('anthropicApiKey') || process.env.ANTHROPIC_API_KEY;

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

  // ─── Command: Export as Markdown ───
  // Reads the current .grimoire.json and writes a clean GRIMOIRE_MAP.md alongside it.
  // Also available via the webview toolbar "Export .md" button.
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.exportMarkdown', async () => {
      const workspacePath = getWorkspacePath();
      if (!workspacePath) return;

      const jsonPath = path.join(workspacePath, '.grimoire.json');
      if (!fs.existsSync(jsonPath)) {
        vscode.window.showWarningMessage('No .grimoire.json found. Run "Grimoire: Scan Workspace" first.');
        return;
      }

      try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        const data = JSON.parse(raw);
        const projectName = path.basename(workspacePath);

        const markdown = exportToMarkdown(data, { projectName });
        const outputPath = path.join(workspacePath, 'GRIMOIRE_MAP.md');
        fs.writeFileSync(outputPath, markdown, 'utf8');

        // Open the generated markdown file for preview
        const doc = await vscode.workspace.openTextDocument(outputPath);
        await vscode.window.showTextDocument(doc, { preview: true });
        vscode.window.showInformationMessage(`Exported to ${path.basename(outputPath)}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Export failed: ${err.message}`);
      }
    })
  );

  // ─── Command: Share to GitHub Gist ───
  // Exports markdown, then pushes it (+ JSON) to a GitHub Gist.
  // Uses VS Code's built-in GitHub auth — works for free AND Pro users.
  // Returns a shareable URL. Stores the Gist ID in workspace state so
  // re-sharing updates the same Gist instead of creating duplicates.
  context.subscriptions.push(
    vscode.commands.registerCommand('grim.shareGist', async () => {
      const workspacePath = getWorkspacePath();
      if (!workspacePath) return;

      const jsonPath = path.join(workspacePath, '.grimoire.json');
      if (!fs.existsSync(jsonPath)) {
        vscode.window.showWarningMessage('No .grimoire.json found. Run "Grimoire: Scan Workspace" first.');
        return;
      }

      try {
        const raw = fs.readFileSync(jsonPath, 'utf8');
        const data = JSON.parse(raw);
        const projectName = path.basename(workspacePath);

        // Generate markdown
        const markdown = exportToMarkdown(data, { projectName });

        // Show progress notification
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Sharing to GitHub Gist...',
            cancellable: false,
          },
          async () => {
            const result = await createGist({
              markdown,
              json: raw,
              projectName,
            });

            // Store Gist ID for future updates
            context.workspaceState.update('grimoire.lastGistId', result.id);

            // Show success with clickable link
            const action = await vscode.window.showInformationMessage(
              `Gist created! ${result.url}`,
              'Open in Browser',
              'Copy URL'
            );

            if (action === 'Open in Browser') {
              vscode.env.openExternal(vscode.Uri.parse(result.url));
            } else if (action === 'Copy URL') {
              await vscode.env.clipboard.writeText(result.url);
              vscode.window.showInformationMessage('Gist URL copied to clipboard!');
            }
          }
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Share failed: ${err.message}`);
        throw err; // Re-throw so webview gets the failure signal
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

function addToGitignore(workspacePath) {
  const gitignorePath = path.join(workspacePath, '.gitignore');
  try {
    let content = '';
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, 'utf8');
    }
    if (!content.includes('.grimoire.json')) {
      const line = content.endsWith('\n') || !content ? '.grimoire.json\n' : '\n.grimoire.json\n';
      fs.appendFileSync(gitignorePath, line);
      vscode.window.showInformationMessage('Added .grimoire.json to .gitignore');
    } else {
      vscode.window.showInformationMessage('.grimoire.json is already in .gitignore');
    }
  } catch (err) {
    vscode.window.showWarningMessage(`Could not update .gitignore: ${err.message}`);
  }
}

// ─── AI API calls ───

async function callClaudeAPI(apiKey, allPaths, readme, model, batchSize, snippets, progress, token, plainEnglish = true) {
  const https = require('https');
  const allDescs = {};
  const effectiveBatch = snippets && Object.keys(snippets).length ? Math.min(batchSize, 20) : batchSize;
  const batches = [];
  for (let i = 0; i < allPaths.length; i += effectiveBatch) {
    batches.push(allPaths.slice(i, i + effectiveBatch));
  }

  for (let i = 0; i < batches.length; i++) {
    if (token?.isCancellationRequested) break;

    const batch = batches[i];
    const pct = Math.round((i / batches.length) * 60) + 30;
    progress.report({ increment: 0, message: `AI batch ${i + 1}/${batches.length}...` });

    const batchSnippets = {};
    if (snippets) {
      for (const p of batch) {
        if (snippets[p]) batchSnippets[p] = snippets[p];
      }
    }

    const prompt = buildPrompt(batch, readme, Object.keys(batchSnippets).length ? batchSnippets : null, plainEnglish);

    try {
      const response = await httpPost(apiKey, model, prompt);
      const text = response.content?.map(b => b.text || '').join('') || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const descs = JSON.parse(clean);
      Object.assign(allDescs, descs);
    } catch (err) {
      console.warn(`Grimoire: Batch ${i + 1} error:`, err.message);
    }
  }

  return allDescs;
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

function httpPost(apiKey, model, prompt) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model,
      max_tokens: 8192,
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
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(data);
    req.end();
  });
}

function deactivate() {
  console.log('Grimoire: deactivating');
}

module.exports = { activate, deactivate };
