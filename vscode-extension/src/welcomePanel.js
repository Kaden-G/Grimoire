// @ts-nocheck
/**
 * Grimoire — Welcome / Setup Panel
 * Beautiful onboarding webview for first-time users.
 * Two paths: BYO API key (free) or Grimoire Pro (coming soon).
 */

const vscode = require('vscode');
const https = require('https');

class WelcomePanel {
  static currentPanel = null;
  static viewType = 'grimWelcome';

  constructor(panel, context) {
    this._panel = panel;
    this._context = context;
    this._disposables = [];

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    this._panel.webview.html = this._getHtml();
  }

  static createOrShow(context) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (WelcomePanel.currentPanel) {
      WelcomePanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      WelcomePanel.viewType,
      'Welcome to Grimoire',
      column || vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false }
    );

    WelcomePanel.currentPanel = new WelcomePanel(panel, context);
  }

  async _handleMessage(msg) {
    switch (msg.command) {
      case 'validateKey': {
        const key = msg.key?.trim();
        if (!key) {
          this._panel.webview.postMessage({ command: 'validationResult', success: false, error: 'Please enter an API key' });
          return;
        }

        try {
          const result = await this._testApiKey(key);
          if (result.success) {
            // Save the key to settings
            await vscode.workspace.getConfiguration('grim').update('anthropicApiKey', key, vscode.ConfigurationTarget.Global);
            this._panel.webview.postMessage({ command: 'validationResult', success: true });

            // Mark onboarding complete
            this._context.globalState.update('grimoire.onboardingComplete', true);
          } else {
            this._panel.webview.postMessage({ command: 'validationResult', success: false, error: result.error });
          }
        } catch (err) {
          this._panel.webview.postMessage({ command: 'validationResult', success: false, error: err.message });
        }
        break;
      }

      case 'skipSetup': {
        this._context.globalState.update('grimoire.onboardingComplete', true);
        this._panel.dispose();
        break;
      }

      case 'openExternal': {
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      }

      case 'startScan': {
        this._panel.dispose();
        vscode.commands.executeCommand('grim.scan');
        break;
      }

      case 'startAIScan': {
        this._panel.dispose();
        vscode.commands.executeCommand('grim.scanWithAI');
        break;
      }

      case 'joinWaitlist': {
        // For now, open a link. Later this would hit your server.
        vscode.env.openExternal(vscode.Uri.parse('https://grimoire.dev/pro'));
        this._panel.webview.postMessage({ command: 'waitlistConfirmed' });
        break;
      }
    }
  }

  _testApiKey(apiKey) {
    return new Promise((resolve) => {
      const data = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
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

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ success: true });
          } else if (res.statusCode === 401) {
            resolve({ success: false, error: 'Invalid API key. Double-check you copied the full key starting with sk-ant-...' });
          } else if (res.statusCode === 403) {
            resolve({ success: false, error: 'API key is valid but doesn\'t have permission. Check your Anthropic account settings.' });
          } else if (res.statusCode === 429) {
            // Rate limited but key is valid!
            resolve({ success: true });
          } else {
            try {
              const parsed = JSON.parse(body);
              resolve({ success: false, error: parsed.error?.message || `API returned status ${res.statusCode}` });
            } catch {
              resolve({ success: false, error: `API returned status ${res.statusCode}` });
            }
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: `Network error: ${err.message}. Check your internet connection.` });
      });

      req.setTimeout(15000, () => {
        req.destroy();
        resolve({ success: false, error: 'Request timed out. Check your internet connection.' });
      });

      req.write(data);
      req.end();
    });
  }

  _getHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  :root {
    --bg: #0a0e17; --surface: #111827; --surface-hover: #1a2236;
    --border: #1e2d44; --border-hover: #2d4a6f;
    --accent: #38bdf8; --accent-dim: #0c4a6e; --accent-glow: rgba(56,189,248,0.15);
    --text: #e2e8f0; --text-dim: #94a3b8; --text-muted: #475569;
    --green: #34d399; --green-dim: #064e3b;
    --yellow: #fbbf24; --yellow-dim: #422006;
    --red: #f87171; --red-dim: #7f1d1d;
    --purple: #a78bfa; --purple-dim: #2d1b4e;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6;
    display: flex; justify-content: center; padding: 40px 24px;
    min-height: 100vh;
  }
  .mono { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace; }
  .container { max-width: 620px; width: 100%; }

  /* Hero */
  .hero { text-align: center; margin-bottom: 40px; animation: fadeIn 0.5s ease; }
  .hero-icon { font-size: 48px; margin-bottom: 12px; }
  .hero h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
  .hero p { color: var(--text-dim); font-size: 15px; max-width: 460px; margin: 0 auto; }

  /* Steps */
  .step-indicator {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin-bottom: 32px;
  }
  .step-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--border); transition: all 0.3s;
  }
  .step-dot.active { background: var(--accent); box-shadow: 0 0 12px var(--accent-glow); width: 12px; height: 12px; }
  .step-dot.done { background: var(--green); }
  .step-line { width: 40px; height: 2px; background: var(--border); }

  /* Cards */
  .choice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .choice-card {
    padding: 24px; border-radius: 14px; cursor: pointer;
    border: 2px solid var(--border); background: var(--surface);
    transition: all 0.2s; text-align: left; position: relative;
  }
  .choice-card:hover { border-color: var(--border-hover); background: var(--surface-hover); transform: translateY(-2px); }
  .choice-card.selected { border-color: var(--accent); background: var(--accent-dim); }
  .choice-card .card-badge {
    display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px;
    border-radius: 99px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .choice-card .card-title { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
  .choice-card .card-desc { font-size: 12.5px; color: var(--text-dim); line-height: 1.5; }
  .choice-card .card-price { font-size: 20px; font-weight: 700; margin-top: 12px; }
  .choice-card .card-price span { font-size: 12px; font-weight: 400; color: var(--text-muted); }

  /* API key input area */
  .setup-section { animation: slideUp 0.3s ease; }
  .input-group { margin-bottom: 16px; }
  .input-group label {
    display: block; font-size: 12px; font-weight: 600; color: var(--text-dim);
    margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .api-input {
    width: 100%; padding: 12px 14px; border-radius: 10px;
    border: 1.5px solid var(--border); background: var(--surface);
    color: var(--text); font-size: 13px; font-family: 'JetBrains Mono', monospace;
    outline: none; transition: all 0.2s;
  }
  .api-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
  .api-input::placeholder { color: var(--text-muted); }
  .api-input.error { border-color: var(--red); }
  .api-input.success { border-color: var(--green); }

  .input-hint {
    display: flex; align-items: center; gap: 6px; margin-top: 8px;
    font-size: 11.5px; color: var(--text-muted);
  }
  .input-hint a { color: var(--accent); text-decoration: none; cursor: pointer; }
  .input-hint a:hover { text-decoration: underline; }

  /* Buttons */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 24px; border-radius: 10px; font-size: 14px; font-weight: 600;
    cursor: pointer; transition: all 0.2s; border: none; width: 100%;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: var(--bg); }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
  .btn-secondary { background: var(--surface); color: var(--text); border: 1.5px solid var(--border); }
  .btn-secondary:hover { background: var(--surface-hover); border-color: var(--border-hover); }
  .btn-ghost { background: none; color: var(--text-muted); border: none; font-size: 12px; padding: 8px; }
  .btn-ghost:hover { color: var(--text); }

  /* Status messages */
  .status {
    display: flex; align-items: center; gap: 8px; padding: 10px 14px;
    border-radius: 8px; font-size: 12.5px; margin-top: 12px;
  }
  .status.loading { background: var(--accent-dim); color: var(--accent); }
  .status.success { background: var(--green-dim); color: var(--green); }
  .status.error { background: var(--red-dim); color: var(--red); }

  /* Spinner */
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner {
    width: 14px; height: 14px; border: 2px solid currentColor;
    border-top-color: transparent; border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  /* Success screen */
  .success-screen { text-align: center; animation: fadeIn 0.5s ease; }
  .success-icon { font-size: 56px; margin-bottom: 16px; }
  .success-screen h2 { font-size: 22px; margin-bottom: 8px; }
  .success-screen p { color: var(--text-dim); margin-bottom: 24px; }
  .next-steps { text-align: left; margin: 24px 0; }
  .next-step {
    display: flex; gap: 12px; padding: 14px 16px; border-radius: 10px;
    background: var(--surface); border: 1px solid var(--border);
    margin-bottom: 8px; cursor: pointer; transition: all 0.15s;
  }
  .next-step:hover { background: var(--surface-hover); border-color: var(--border-hover); }
  .next-step .step-num {
    width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700;
    background: var(--accent-dim); color: var(--accent);
  }
  .next-step .step-text { flex: 1; }
  .next-step .step-title { font-size: 13px; font-weight: 600; }
  .next-step .step-desc { font-size: 11.5px; color: var(--text-dim); }

  /* Pro section */
  .pro-section { animation: slideUp 0.3s ease; }
  .pro-features { margin: 20px 0; }
  .pro-feature {
    display: flex; gap: 10px; align-items: flex-start; padding: 8px 0;
  }
  .pro-feature .check { color: var(--green); font-weight: 700; flex-shrink: 0; }
  .pro-feature .feat-text { font-size: 13px; }
  .pro-feature .feat-text strong { color: var(--text); }
  .pro-feature .feat-text span { color: var(--text-dim); }

  .waitlist-badge {
    display: inline-block; padding: 4px 12px; border-radius: 99px;
    background: var(--purple-dim); color: var(--purple);
    font-size: 11px; font-weight: 700; margin-top: 16px;
  }

  /* Hide/show */
  .hidden { display: none !important; }

  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
<div class="container">
  <!-- Step Indicator -->
  <div class="step-indicator" id="stepIndicator">
    <div class="step-dot active" id="dot1"></div>
    <div class="step-line"></div>
    <div class="step-dot" id="dot2"></div>
    <div class="step-line"></div>
    <div class="step-dot" id="dot3"></div>
  </div>

  <!-- ─── Step 1: Hero + Choose Path ─── -->
  <div id="step1">
    <div class="hero">
      <div class="hero-icon">\uD83D\uDCD6\u2728</div>
      <h1 class="mono">Welcome to Grimoire</h1>
      <p>Your codebase, decoded. Grimoire maps your entire project into a visual, searchable treemap with AI-powered descriptions — so you always know what every file does.</p>
    </div>

    <div style="font-size:13px; font-weight:600; color:var(--text-dim); margin-bottom:12px; text-align:center; text-transform:uppercase; letter-spacing:1px">Choose your setup</div>

    <div class="choice-grid">
      <div class="choice-card" id="choiceFree" onclick="selectPath('free')">
        <span class="card-badge" style="background:var(--green-dim); color:var(--green)">Free Forever</span>
        <div class="card-title">Bring Your Own Key</div>
        <div class="card-desc">Use your Anthropic API key. You pay Anthropic directly for AI usage. Full access to all features.</div>
        <div class="card-price">$0 <span>+ API usage</span></div>
      </div>
      <div class="choice-card" id="choicePro" onclick="selectPath('pro')">
        <span class="card-badge" style="background:var(--purple-dim); color:var(--purple)">Coming Soon</span>
        <div class="card-title">Grimoire Pro</div>
        <div class="card-desc">No API key needed. Everything just works. Priority support and early access to new features.</div>
        <div class="card-price">$5<span>/month</span></div>
      </div>
    </div>

    <button class="btn-ghost" onclick="skipSetup()" style="display:block; margin:0 auto">
      Skip for now (heuristic descriptions only, no AI)
    </button>
  </div>

  <!-- ─── Step 2a: BYO Key Setup ─── -->
  <div id="step2free" class="hidden setup-section">
    <div style="text-align:center; margin-bottom:28px">
      <div style="font-size:32px; margin-bottom:8px">\uD83D\uDD11</div>
      <h2 style="font-size:20px; font-weight:700; margin-bottom:4px">Enter Your API Key</h2>
      <p style="color:var(--text-dim); font-size:13px">This is stored locally in your VS Code settings. Never sent anywhere except Anthropic's API.</p>
    </div>

    <div class="input-group">
      <label class="mono">Anthropic API Key</label>
      <input type="password" class="api-input mono" id="apiKeyInput"
        placeholder="sk-ant-api03-..."
        spellcheck="false" autocomplete="off"
      />
      <div class="input-hint">
        <span>\uD83D\uDCA1</span>
        <span>Don't have one? <a onclick="openExternal('https://console.anthropic.com/settings/keys')">Get a key from Anthropic Console</a> — takes 30 seconds.</span>
      </div>
    </div>

    <button class="btn btn-primary" id="validateBtn" onclick="validateKey()">
      \u2713 Validate & Save
    </button>

    <div id="validationStatus" class="hidden"></div>

    <div style="display:flex; gap:8px; margin-top:16px">
      <button class="btn btn-secondary" onclick="goBack()" style="flex:1">\u2190 Back</button>
      <button class="btn-ghost" onclick="skipSetup()">Skip for now</button>
    </div>
  </div>

  <!-- ─── Step 2b: Pro Waitlist ─── -->
  <div id="step2pro" class="hidden pro-section">
    <div style="text-align:center; margin-bottom:24px">
      <div style="font-size:32px; margin-bottom:8px">\u2728</div>
      <h2 style="font-size:20px; font-weight:700; margin-bottom:4px">Grimoire Pro</h2>
      <p style="color:var(--text-dim); font-size:13px">The zero-config AI experience. Coming soon.</p>
    </div>

    <div class="pro-features">
      <div class="pro-feature">
        <span class="check">\u2713</span>
        <div class="feat-text"><strong>No API key needed</strong> <span>— everything just works out of the box</span></div>
      </div>
      <div class="pro-feature">
        <span class="check">\u2713</span>
        <div class="feat-text"><strong>Unlimited AI descriptions</strong> <span>— scan as many projects as you want</span></div>
      </div>
      <div class="pro-feature">
        <span class="check">\u2713</span>
        <div class="feat-text"><strong>All 4 annotation modes</strong> <span>— tutor, minimal, technical, non-technical</span></div>
      </div>
      <div class="pro-feature">
        <span class="check">\u2713</span>
        <div class="feat-text"><strong>Priority support</strong> <span>— direct line to the developer</span></div>
      </div>
      <div class="pro-feature">
        <span class="check">\u2713</span>
        <div class="feat-text"><strong>Early access</strong> <span>— get new features before anyone else</span></div>
      </div>
    </div>

    <button class="btn btn-primary" id="waitlistBtn" onclick="joinWaitlist()" style="background:var(--purple)">
      \uD83D\uDD14 Join the Waitlist
    </button>
    <div id="waitlistStatus" class="hidden" style="text-align:center; margin-top:12px"></div>

    <div style="text-align:center; margin-top:20px">
      <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px">Want to use Grimoire right now? You can use the free tier with your own API key.</p>
      <button class="btn btn-secondary" onclick="selectPath('free')">\uD83D\uDD11 Set Up Free Tier Instead</button>
    </div>

    <div style="margin-top:16px">
      <button class="btn btn-secondary" onclick="goBack()" style="width:100%">\u2190 Back</button>
    </div>
  </div>

  <!-- ─── Step 3: Success ─── -->
  <div id="step3" class="hidden success-screen">
    <div class="success-icon">\uD83C\uDF89</div>
    <h2 class="mono">You're All Set!</h2>
    <p>Your API key is saved and verified. Grimoire is ready to map your codebase.</p>

    <div class="next-steps">
      <div class="next-step" onclick="startScan()">
        <div class="step-num">1</div>
        <div class="step-text">
          <div class="step-title">\uD83D\uDDFA\uFE0F Quick Scan (no AI)</div>
          <div class="step-desc">Map your project in seconds using smart heuristics. Free, instant, no API calls.</div>
        </div>
      </div>
      <div class="next-step" onclick="startAIScan()">
        <div class="step-num">2</div>
        <div class="step-text">
          <div class="step-title">\u2728 AI Scan (recommended)</div>
          <div class="step-desc">Get Claude-powered descriptions for every file. Takes ~30 seconds for most projects.</div>
        </div>
      </div>
    </div>

    <button class="btn-ghost" onclick="skipSetup()" style="display:block; margin:12px auto 0">
      I'll scan later
    </button>
  </div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let selectedPath = null;

  function selectPath(path) {
    selectedPath = path;
    document.getElementById('step1').classList.add('hidden');
    document.getElementById('step2free').classList.add('hidden');
    document.getElementById('step2pro').classList.add('hidden');

    // Update step dots
    document.getElementById('dot1').classList.remove('active');
    document.getElementById('dot1').classList.add('done');
    document.getElementById('dot2').classList.add('active');

    if (path === 'free') {
      document.getElementById('step2free').classList.remove('hidden');
      setTimeout(() => document.getElementById('apiKeyInput').focus(), 100);
    } else {
      document.getElementById('step2pro').classList.remove('hidden');
    }
  }

  function goBack() {
    document.getElementById('step1').classList.remove('hidden');
    document.getElementById('step2free').classList.add('hidden');
    document.getElementById('step2pro').classList.add('hidden');
    document.getElementById('step3').classList.add('hidden');

    document.getElementById('dot1').classList.add('active');
    document.getElementById('dot1').classList.remove('done');
    document.getElementById('dot2').classList.remove('active');
    document.getElementById('dot2').classList.remove('done');
  }

  function validateKey() {
    const input = document.getElementById('apiKeyInput');
    const btn = document.getElementById('validateBtn');
    const status = document.getElementById('validationStatus');
    const key = input.value.trim();

    if (!key) {
      input.classList.add('error');
      status.className = 'status error';
      status.innerHTML = '\u2717 Please enter your API key';
      status.classList.remove('hidden');
      return;
    }

    // Show loading
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Validating...';
    input.classList.remove('error', 'success');
    status.className = 'status loading';
    status.innerHTML = '<div class="spinner"></div> Testing your API key with a quick ping to Claude...';
    status.classList.remove('hidden');

    vscode.postMessage({ command: 'validateKey', key: key });
  }

  function skipSetup() {
    vscode.postMessage({ command: 'skipSetup' });
  }

  function openExternal(url) {
    vscode.postMessage({ command: 'openExternal', url: url });
  }

  function startScan() {
    vscode.postMessage({ command: 'startScan' });
  }

  function startAIScan() {
    vscode.postMessage({ command: 'startAIScan' });
  }

  function joinWaitlist() {
    const btn = document.getElementById('waitlistBtn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Joining...';
    vscode.postMessage({ command: 'joinWaitlist' });
  }

  // Listen for messages from extension
  window.addEventListener('message', function(event) {
    const msg = event.data;

    if (msg.command === 'validationResult') {
      const input = document.getElementById('apiKeyInput');
      const btn = document.getElementById('validateBtn');
      const status = document.getElementById('validationStatus');

      if (msg.success) {
        input.classList.remove('error');
        input.classList.add('success');
        status.className = 'status success';
        status.innerHTML = '\u2713 API key is valid! Saving to your settings...';
        btn.innerHTML = '\u2713 Saved!';

        // Transition to step 3
        setTimeout(() => {
          document.getElementById('step2free').classList.add('hidden');
          document.getElementById('step3').classList.remove('hidden');
          document.getElementById('dot2').classList.remove('active');
          document.getElementById('dot2').classList.add('done');
          document.getElementById('dot3').classList.add('active');
        }, 800);
      } else {
        input.classList.add('error');
        input.classList.remove('success');
        status.className = 'status error';
        status.innerHTML = '\u2717 ' + (msg.error || 'Validation failed');
        btn.disabled = false;
        btn.innerHTML = '\u2713 Validate & Save';
      }
    }

    if (msg.command === 'waitlistConfirmed') {
      const btn = document.getElementById('waitlistBtn');
      const status = document.getElementById('waitlistStatus');
      btn.innerHTML = '\u2713 You\\'re on the list!';
      btn.style.background = 'var(--green-dim)';
      btn.style.color = 'var(--green)';
      status.classList.remove('hidden');
      status.innerHTML = '<span class="waitlist-badge">\uD83C\uDF89 We\\'ll email you when Pro launches!</span>';
    }
  });

  // Allow Enter key to validate
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !document.getElementById('step2free').classList.contains('hidden')) {
      validateKey();
    }
  });
</script>
</body>
</html>`;
  }

  dispose() {
    WelcomePanel.currentPanel = null;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop().dispose();
    }
  }
}

module.exports = { WelcomePanel };
