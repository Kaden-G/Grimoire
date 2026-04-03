// @ts-nocheck
/**
 * Grimoire — Webview Panel (Treemap Edition)
 * Renders the interactive Miro-style treemap UI inside a VS Code webview tab.
 */

const vscode = require('vscode');

class GrimoirePanel {
  static currentPanel = null;
  static viewType = 'grimMap';

  constructor(panel, extensionUri, data, basePath, snippets) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._disposables = [];
    this._data = data;
    this._basePath = basePath;
    this._snippets = snippets || {};

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this._disposables
    );

    this._update();
  }

  static createOrShow(extensionUri, data, basePath, snippets) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GrimoirePanel.currentPanel) {
      GrimoirePanel.currentPanel._data = data;
      GrimoirePanel.currentPanel._basePath = basePath;
      GrimoirePanel.currentPanel._snippets = snippets || {};
      GrimoirePanel.currentPanel._update();
      GrimoirePanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      GrimoirePanel.viewType,
      'Grimoire',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      }
    );

    GrimoirePanel.currentPanel = new GrimoirePanel(
      panel, extensionUri, data, basePath, snippets
    );
  }

  _handleMessage(msg) {
    switch (msg.command) {
      case 'openFile':
        const filePath = msg.path;
        if (filePath) {
          const uri = vscode.Uri.file(filePath);
          vscode.workspace.openTextDocument(uri).then(
            (doc) => vscode.window.showTextDocument(doc),
            () => vscode.window.showWarningMessage(`Could not open: ${filePath}`)
          );
        }
        break;
      case 'showInfo':
        vscode.window.showInformationMessage(msg.text);
        break;
      case 'exportMarkdown':
        // Delegate to the registered command (keeps logic centralized in extension.js)
        vscode.commands.executeCommand('grim.exportMarkdown');
        break;
      case 'shareGist':
        // Delegate to the registered command; it will handle auth + API call
        vscode.commands.executeCommand('grim.shareGist').then(() => {
          // Reset button state in webview after completion
          this._panel.webview.postMessage({ command: 'gistComplete', success: true });
        }, () => {
          this._panel.webview.postMessage({ command: 'gistComplete', success: false });
        });
        break;
    }
  }

  _update() {
    this._panel.title = 'Grimoire';
    this._panel.webview.html = this._getHtml();
  }

  _getHtml() {
    const data = this._data;
    const basePath = this._basePath;
    const snippets = this._snippets;
    const plainEnglishSetting = vscode.workspace.getConfiguration('grim').get('plainEnglish', true);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
<style>
  :root {
    --bg: #0a0e17; --surface: #111827; --surface-hover: #1a2236;
    --border: #1e2d44; --border-hover: #2d4a6f;
    --accent: #38bdf8; --accent-dim: #0c4a6e; --accent-glow: rgba(56,189,248,0.15);
    --text: #e2e8f0; --text-dim: #94a3b8; --text-muted: #475569;
    --file-color: #a78bfa; --folder-color: #38bdf8;
    --ai-desc: #cbd5e1;
    --tag-bg: #334155; --tag-text: #94a3b8;
    --green: #34d399; --yellow: #fbbf24; --yellow-bg: rgba(251,191,36,0.12);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: var(--bg); color: var(--text);
    line-height: 1.5; overflow: hidden; height: 100vh; width: 100vw;
    display: flex; flex-direction: column;
  }
  #app {
    display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;
  }
  .mono { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace; }

  /* Header */
  .header {
    display: flex; align-items: center; gap: 10px; padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: rgba(17,24,39,0.85); flex-shrink: 0;
  }
  .header h1 { font-size: 20px; font-weight: 700; margin: 0; }
  .header .stats { font-size: 13px; color: var(--text-muted); margin-left: auto; }

  /* Breadcrumb */
  .breadcrumb {
    display: flex; align-items: center; gap: 4px; padding: 6px 16px; flex-wrap: wrap;
    border-bottom: 1px solid var(--border); background: rgba(17,24,39,0.5); flex-shrink: 0;
  }
  .breadcrumb-item {
    font-size: 14px; color: var(--accent); cursor: pointer; background: none;
    border: none; padding: 2px 6px; border-radius: 4px;
  }
  .breadcrumb-item:hover { background: var(--accent-dim); }
  .breadcrumb-sep { color: var(--text-muted); font-size: 13px; }
  .breadcrumb-current { font-size: 14px; color: var(--text); font-weight: 600; padding: 2px 6px; }
  .breadcrumb-desc { margin-left: 12px; font-size: 13px; color: var(--ai-desc); font-style: italic; opacity: 0.8; }

  /* Search */
  .search-wrap {
    display: flex; align-items: center; gap: 8px; background: var(--surface);
    border: 1px solid var(--border); border-radius: 8px; padding: 5px 10px;
    transition: 0.2s; max-width: 380px; flex: 1; margin-left: auto;
  }
  .search-wrap:focus-within { border-color: var(--border-hover); box-shadow: 0 0 0 3px var(--accent-glow); }
  .search-input {
    flex: 1; background: none; border: none; outline: none;
    color: var(--text); font-size: 12px;
  }
  .search-input::placeholder { color: var(--text-muted); }
  .search-results {
    position: absolute; top: calc(100% + 6px); left: 0; right: 0;
    background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 6px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5); max-height: 380px; overflow-y: auto; z-index: 20;
  }
  .search-result {
    display: flex; gap: 8px; padding: 8px 10px; width: 100%;
    background: transparent; border: none; border-radius: 6px; cursor: pointer; text-align: left;
  }
  .search-result:hover { background: var(--surface-hover); }

  /* Grid container */
  .treemap-container {
    flex: 1; overflow-y: auto; overflow-x: hidden; position: relative;
    background: radial-gradient(circle at 50% 50%, #0f1520 0%, var(--bg) 100%);
    padding: 12px 12px 60px;
  }
  .treemap-grid {
    display: flex; flex-direction: column; gap: 6px;
  }
  .grid-section-label {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
    color: var(--text-muted); padding: 12px 0 4px; border-bottom: 1px solid var(--border);
    margin-bottom: 2px;
  }
  .dir-grid {
    display: flex; flex-direction: column; gap: 6px;
  }

  /* Dir cell — full-width row like files */
  .dir-cell {
    border-radius: 6px; overflow: hidden; cursor: pointer;
    display: flex; flex-direction: row; align-items: flex-start; gap: 10px;
    transition: all 0.15s; position: relative;
    padding: 10px 14px; width: 100%;
  }
  .dir-cell:hover { box-shadow: 0 0 20px rgba(56,189,248,0.15); }
  .dir-info { flex: 1; min-width: 0; }
  .dir-children { display: flex; flex-wrap: wrap; gap: 3px; overflow: hidden; margin-top: 5px; }
  .dir-chip {
    font-size: 9px; padding: 2px 6px; border-radius: 4px; white-space: nowrap;
  }
  .zoom-hint {
    position: absolute; top: 10px; right: 10px; display: flex; align-items: center; gap: 3px;
    font-size: 10px; opacity: 0; transition: 0.15s;
  }
  .dir-cell:hover .zoom-hint { opacity: 0.7; }

  /* File cell — full-width list row */
  .file-cell {
    border-radius: 6px; overflow: hidden;
    display: flex; flex-direction: row; align-items: flex-start; gap: 10px;
    transition: all 0.15s;
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 10px 14px; position: relative; cursor: pointer;
    width: 100%;
  }
  .file-cell:hover {
    border-color: var(--border-hover);
    background: var(--surface-hover);
  }
  .file-cell .file-info { flex: 1; min-width: 0; }
  .file-open-hint {
    position: absolute; top: 8px; right: 10px; font-size: 10px; color: var(--accent);
    display: flex; align-items: center; gap: 2px; opacity: 0; transition: 0.15s;
  }
  .file-cell:hover .file-open-hint { opacity: 1; }

  /* Tags */
  .tags { display: flex; flex-wrap: wrap; gap: 2px; margin-top: auto; padding-top: 3px; }
  .tag {
    display: inline-block; padding: 1px 6px; border-radius: 99px;
    font-size: 10px; background: var(--tag-bg); color: var(--tag-text);
  }
  .tag-api { background: #1e3a5f; color: #60a5fa; font-weight: 600; }
  .tag-auth { background: #3b1f2b; color: #f472b6; font-weight: 600; }
  .tag-database { background: #1a2e1a; color: #4ade80; font-weight: 600; }
  .tag-graphql { background: #2d1b4e; color: #c084fc; font-weight: 600; }
  .tag-ai { background: #3d2e0a; color: #fbbf24; font-weight: 600; }
  .tag-data { background: #3d2e0a; color: #fbbf24; font-weight: 600; }
  .tag-routing { background: #1e3a5f; color: #38bdf8; font-weight: 600; }
  .tag-state { background: #2d1b4e; color: #a78bfa; font-weight: 600; }
  .tag-validation { background: #1a2e1a; color: #34d399; font-weight: 600; }
  .tag-websocket { background: #1e3a5f; color: #22d3ee; font-weight: 600; }
  .tag-logging { background: #2a2215; color: #fb923c; font-weight: 600; }
  .tag-monitoring { background: #2a2215; color: #fb923c; font-weight: 600; }
  .tag-ui-lib { background: #2d1b4e; color: #c084fc; font-weight: 600; }
  .tag-aws { background: #3d2e0a; color: #fb923c; font-weight: 600; }
  .tag-test { background: #1a2e1a; color: #34d399; font-weight: 600; }
  .tag-react { background: #1e3a5f; color: #60a5fa; font-weight: 600; }
  .tag-docker { background: #1e3a5f; color: #60a5fa; font-weight: 600; }

  /* Hover tooltip */
  .tooltip {
    position: absolute; width: 300px; max-height: 200px;
    background: rgba(17,24,39,0.96); border: 1px solid var(--border-hover);
    border-radius: 10px; padding: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    z-index: 30; pointer-events: none; overflow: hidden;
    animation: fadeSlideIn 0.15s ease;
  }
  .tooltip-name { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .tooltip pre {
    font-size: 10px; color: var(--text-dim); line-height: 1.4;
    background: var(--bg); border-radius: 6px; padding: 8px; margin: 4px 0 0;
    overflow: hidden; max-height: 80px; white-space: pre; tab-size: 2;
  }

  /* Toolbar — fixed bottom bar */
  .floating-toolbar {
    position: fixed; bottom: 12px; left: 12px; z-index: 50;
    display: flex; align-items: center; gap: 2px;
    background: rgba(17,24,39,0.95); backdrop-filter: blur(12px);
    border: 1px solid var(--border); border-radius: 12px;
    padding: 6px 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .size-btn {
    border-radius: 6px; cursor: pointer; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .size-btn.active { border: 2px solid var(--accent); background: var(--accent-dim); color: var(--accent); }
  .size-btn:not(.active) { border: 1px solid var(--border); background: transparent; color: var(--text-muted); }
  .toolbar-divider { width: 1px; height: 20px; background: var(--border); margin: 0 8px; }
  .pe-toggle {
    display: flex; align-items: center; gap: 5px; padding: 4px 10px;
    border-radius: 8px; cursor: pointer; font-size: 10.5px; font-weight: 600;
    transition: all 0.15s;
  }
  .pe-toggle.on { border: 1px solid rgba(56,189,248,0.4); background: var(--accent-dim); color: var(--accent); }
  .pe-toggle.off { border: 1px solid var(--border); background: transparent; color: var(--text-muted); }
  .toolbar-btn {
    display: flex; align-items: center; gap: 5px; padding: 4px 10px;
    border-radius: 8px; cursor: pointer; font-size: 10.5px; font-weight: 600;
    border: 1px solid var(--border); background: transparent; color: var(--text-muted);
    transition: all 0.15s;
  }
  .toolbar-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
  .toolbar-btn.success { border-color: rgba(34,197,94,0.5); color: #22c55e; background: rgba(34,197,94,0.1); }
  .toolbar-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Empty state */
  .empty { text-align: center; padding: 60px; color: var(--text-dim); }
  .empty-icon { font-size: 40px; margin-bottom: 12px; }

  @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
<div id="app"></div>
<script>
const vscodeApi = acquireVsCodeApi();
const DATA = ${JSON.stringify(data)};
const BASE_PATH = ${JSON.stringify(basePath)};
const SNIPPETS = ${JSON.stringify(snippets)};

// ─── State ───
let currentPath = [];
let searchQuery = '';
let textSize = 'medium';
let plainEnglish = ${JSON.stringify(plainEnglishSetting)};
let hoveredCell = null;
let containerW = 800;
let containerH = 500;

const TEXT_SIZES = {
  small:  { name: 12, desc: 10, tag: 9, header: 13, cellName: 12, cellDesc: 10 },
  medium: { name: 14, desc: 12, tag: 10.5, header: 15, cellName: 14, cellDesc: 12 },
  large:  { name: 16, desc: 14, tag: 12, header: 18, cellName: 16, cellDesc: 14 },
};

const DIR_PALETTE = [
  { bg: "#111d2e", header: "#162640", border: "#1e3a5f", accent: "#38bdf8" },
  { bg: "#131f13", header: "#1a2e1a", border: "#2d5f2d", accent: "#4ade80" },
  { bg: "#1a1228", header: "#231835", border: "#3d2766", accent: "#a78bfa" },
  { bg: "#1f1a0a", header: "#2a2210", border: "#4a3d1a", accent: "#fbbf24" },
  { bg: "#1f1018", header: "#2e1724", border: "#5f2d44", accent: "#f472b6" },
  { bg: "#0f1a20", header: "#152530", border: "#2d4a5f", accent: "#22d3ee" },
];

// ─── SVG Icons ───
const FOLDER_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
const FILE_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
const SEARCH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const ZOOM_SVG = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
const EXTERNAL_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const BACK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';

// ─── Helpers ───
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function countItems(node) {
  let files = (node.files || []).length;
  let dirs = (node.children || []).length;
  for (const c of node.children || []) {
    const sub = countItems(c);
    files += sub.files; dirs += sub.dirs;
  }
  return { files, dirs };
}

function getNodeAtPath(root, parts) {
  let node = root;
  for (const p of parts) {
    node = (node.children || []).find(c => c.name === p);
    if (!node) return null;
  }
  return node;
}

function totalWeight(node) {
  let w = (node.files || []).length;
  (node.children || []).forEach(c => { w += Math.max(totalWeight(c), 1); });
  return Math.max(w, 1);
}

function flattenItems(node, path) {
  path = path || '';
  let items = [];
  const cur = path ? path + '/' + node.name : node.name;
  (node.files || []).forEach(f => {
    items.push({ name: f.name, purpose: f.purpose, tags: f.tags, path: cur + '/' + f.name, parentPath: cur, type: 'file' });
  });
  (node.children || []).forEach(c => {
    items.push({ name: c.name, description: c.description, path: cur + '/' + c.name, parentPath: cur, type: 'folder' });
    items = items.concat(flattenItems(c, cur));
  });
  return items;
}

function searchItems(allItems, query) {
  if (!query.trim()) return [];
  const terms = query.toLowerCase().split(/\\s+/);
  return allItems
    .map(item => {
      const s = [item.name, item.purpose||'', item.description||'', ...(item.tags||[]), item.path||''].join(' ').toLowerCase();
      const score = terms.reduce((acc, t) => acc + (s.includes(t) ? 1 : 0), 0);
      return { ...item, score };
    })
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

function makeAbsPath(filePath) {
  if (!BASE_PATH) return null;
  const parts = filePath.split('/');
  parts.shift();
  return BASE_PATH + '/' + parts.join('/');
}

function openFile(filePath) {
  const abs = makeAbsPath(filePath);
  if (abs) vscodeApi.postMessage({ command: 'openFile', path: abs });
}

// ─── Squarified Treemap ───
function computeTreemap(items, container) {
  if (items.length === 0) return [];
  const totalValue = items.reduce((s, i) => s + i.value, 0);
  if (totalValue === 0) return [];
  const totalArea = container.w * container.h;
  const normalized = items
    .map(i => ({ ...i, area: (i.value / totalValue) * totalArea }))
    .sort((a, b) => b.area - a.area);
  return squarifyRecursive(normalized, [], { ...container });
}

function squarifyRecursive(remaining, row, rect) {
  if (remaining.length === 0) {
    return row.length > 0 ? layoutRow(row, rect) : [];
  }
  if (row.length === 0) {
    return squarifyRecursive(remaining.slice(1), [remaining[0]], rect);
  }
  const extended = [...row, remaining[0]];
  const w = Math.min(rect.w, rect.h);
  if (w <= 0) return layoutRow(row, rect);
  if (worstRatio(extended, w) <= worstRatio(row, w)) {
    return squarifyRecursive(remaining.slice(1), extended, rect);
  }
  const laid = layoutRow(row, rect);
  const newRect = cutRect(row, rect);
  return [...laid, ...squarifyRecursive(remaining, [], newRect)];
}

function worstRatio(row, w) {
  const s = row.reduce((sum, r) => sum + r.area, 0);
  if (s <= 0 || w <= 0) return Infinity;
  let worst = 0;
  for (const r of row) {
    const ratio = Math.max((w * w * r.area) / (s * s), (s * s) / (w * w * r.area));
    worst = Math.max(worst, ratio);
  }
  return worst;
}

function layoutRow(row, rect) {
  const s = row.reduce((sum, r) => sum + r.area, 0);
  if (s <= 0) return row.map(r => ({ ...r, layout: { x: rect.x, y: rect.y, w: 0, h: 0 } }));
  const isWide = rect.w >= rect.h;
  const shorter = isWide ? rect.h : rect.w;
  const rowThickness = shorter > 0 ? s / shorter : 0;
  const results = [];
  let pos = 0;
  for (const item of row) {
    const itemLen = rowThickness > 0 ? item.area / rowThickness : 0;
    if (isWide) {
      results.push({ ...item, layout: { x: rect.x, y: rect.y + pos, w: rowThickness, h: itemLen } });
    } else {
      results.push({ ...item, layout: { x: rect.x + pos, y: rect.y, w: itemLen, h: rowThickness } });
    }
    pos += itemLen;
  }
  return results;
}

function cutRect(row, rect) {
  const s = row.reduce((sum, r) => sum + r.area, 0);
  const isWide = rect.w >= rect.h;
  const shorter = isWide ? rect.h : rect.w;
  const thickness = shorter > 0 ? s / shorter : 0;
  if (isWide) return { x: rect.x + thickness, y: rect.y, w: rect.w - thickness, h: rect.h };
  return { x: rect.x, y: rect.y + thickness, w: rect.w, h: rect.h - thickness };
}

// ─── Tag rendering ───
function renderTag(tag, sz) {
  const tagClass = 'tag-' + tag.replace(/[^a-z0-9-]/gi, '');
  return '<span class="tag mono tag-' + esc(tag) + '" style="font-size:' + (sz || 10) + 'px">' + esc(tag) + '</span>';
}

function renderTags(tags, sz) {
  if (!tags || !tags.length) return '';
  return '<div class="tags">' + tags.map(t => renderTag(t, sz)).join('') + '</div>';
}

// ─── Render ───
function render() {
  const app = document.getElementById('app');
  const node = currentPath.length === 0 ? DATA : getNodeAtPath(DATA, currentPath);
  if (!node) { app.innerHTML = '<div class="empty"><div class="empty-icon">&#128506;</div>Node not found</div>'; return; }

  const { files: totalFiles, dirs: totalDirs } = countItems(DATA);
  const sz = TEXT_SIZES[textSize];
  const allItems = flattenItems(DATA);
  const results = searchItems(allItems, searchQuery);
  const showResults = searchQuery.trim().length > 0;

  let html = '';

  // ─── Header ───
  html += '<div class="header">';
  html += '<span style="font-size:18px; cursor:pointer" data-nav="[]">&#128506;</span>';
  html += '<h1 class="mono" style="cursor:pointer" data-nav="[]">Grimoire</h1>';
  html += '<div style="position:relative; flex:1; max-width:380px; margin-left:auto">';
  html += '<div class="search-wrap">';
  html += '<span style="color:var(--text-dim)">' + SEARCH_SVG + '</span>';
  html += '<input class="search-input mono" type="text" placeholder="Where do I change the..." value="' + esc(searchQuery) + '" />';
  html += '<span class="mono" style="font-size:10px; color:var(--text-muted); padding:1px 5px; background:var(--tag-bg); border-radius:3px">\\u2318K</span>';
  html += '</div>';
  if (showResults) {
    html += '<div class="search-results">';
    if (results.length === 0) {
      html += '<div style="padding:14px; text-align:center; color:var(--text-muted); font-size:12px">No matches</div>';
    } else {
      for (const item of results) {
        const icon = item.type === 'folder' ? '<span style="color:var(--folder-color)">' + FOLDER_SVG + '</span>' : '<span style="color:var(--file-color)">' + FILE_SVG + '</span>';
        const action = item.type === 'file'
          ? 'data-open="' + esc(item.path) + '"'
          : 'data-nav="' + esc(JSON.stringify(item.path.split('/').slice(1))) + '"';
        html += '<div class="search-result" ' + action + '>';
        html += '<div style="padding-top:1px; flex-shrink:0">' + icon + '</div>';
        html += '<div style="flex:1; min-width:0">';
        html += '<span class="mono" style="font-size:12px; font-weight:600; color:var(--text)">' + esc(item.name) + '</span>';
        html += '<div style="font-size:11px; color:var(--text-dim); line-height:1.3">' + esc(item.purpose || item.description || '') + '</div>';
        html += '<div class="mono" style="font-size:10px; color:var(--text-muted)">' + esc(item.path) + '</div>';
        html += '</div></div>';
      }
    }
    html += '</div>';
  }
  html += '</div>'; // close search container
  html += '<span class="stats mono">' + totalFiles + ' files &middot; ' + totalDirs + ' dirs</span>';
  html += '</div>';

  // ─── Breadcrumb ───
  html += '<div class="breadcrumb">';
  if (currentPath.length > 0) {
    const backPath = JSON.stringify(currentPath.slice(0, -1));
    html += '<button style="background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:3px 7px; cursor:pointer; display:flex; align-items:center; color:var(--text-dim)" data-nav="' + esc(backPath) + '">' + BACK_SVG + '</button>';
  }
  html += '<button class="breadcrumb-item mono" data-nav="[]">' + esc(DATA.name) + '</button>';
  for (let i = 0; i < currentPath.length; i++) {
    html += '<span class="breadcrumb-sep">&#9656;</span>';
    if (i < currentPath.length - 1) {
      html += '<button class="breadcrumb-item mono" data-nav="' + esc(JSON.stringify(currentPath.slice(0,i+1))) + '">' + esc(currentPath[i]) + '</button>';
    } else {
      html += '<span class="breadcrumb-current mono">' + esc(currentPath[i]) + '</span>';
    }
  }
  if (node.description) {
    html += '<span class="breadcrumb-desc">' + esc(node.description) + '</span>';
  }
  html += '</div>';

  // ─── Grid ───
  html += '<div class="treemap-container" id="treemap-container">';

  // Build grid items
  const treemapItems = [];
  (node.children || []).forEach((c, i) => {
    treemapItems.push({ type: 'dir', node: c, name: c.name, value: 1, index: i });
  });
  (node.files || []).forEach((f, i) => {
    treemapItems.push({ type: 'file', node: f, name: f.name, value: 1, index: i });
  });

  if (treemapItems.length === 0) {
    html += '<div style="display:flex; align-items:center; justify-content:center; height:200px; color:var(--text-muted)">This directory is empty</div>';
  }

  html += '<div class="treemap-grid" id="treemap-cells"></div>';

  // Tooltip placeholder
  html += '<div id="tooltip-container"></div>';

  // ─── Floating Toolbar ───
  html += '<div class="floating-toolbar">';
  html += '<span class="mono" style="font-size:10px; color:var(--text-muted); margin-right:4px">Aa</span>';
  ['small', 'medium', 'large'].forEach(sz => {
    const w = sz === 'small' ? 22 : sz === 'medium' ? 26 : 30;
    const fs = sz === 'small' ? 10 : sz === 'medium' ? 12 : 14;
    const active = textSize === sz ? ' active' : '';
    html += '<button class="size-btn mono' + active + '" data-size="' + sz + '" style="width:' + w + 'px; height:' + w + 'px; font-size:' + fs + 'px">' + sz[0].toUpperCase() + '</button>';
  });
  html += '<div class="toolbar-divider"></div>';
  const peClass = plainEnglish ? 'on' : 'off';
  const peEmoji = plainEnglish ? '\\uD83D\\uDDE3\\uFE0F' : '\\uD83D\\uDD27';
  const peLabel = plainEnglish ? 'Plain English' : 'Technical';
  html += '<button class="pe-toggle mono ' + peClass + '" id="pe-toggle"><span style="font-size:13px">' + peEmoji + '</span> ' + peLabel + '</button>';
  // ─── Export & Share buttons ───
  html += '<div class="toolbar-divider"></div>';
  html += '<button class="toolbar-btn mono" id="btn-export-md" title="Export as Markdown file"><span style="font-size:12px">\\uD83D\\uDCC4</span> Export .md</button>';
  html += '<button class="toolbar-btn mono" id="btn-share-gist" title="Share to GitHub Gist"><span style="font-size:12px">\\uD83D\\uDD17</span> Share Gist</button>';
  html += '</div>';

  html += '</div>'; // close treemap-container

  app.innerHTML = html;

  // ─── Render grid cells ───
  try {
    renderTreemapCells(treemapItems);
  } catch(e) {
    console.error('Grimoire render error:', e);
  }

  // Restore search focus
  if (searchQuery) {
    const input = document.querySelector('.search-input');
    if (input) { input.focus(); input.selectionStart = input.selectionEnd = input.value.length; }
  }
}

function renderTreemapCells(items) {
  const cellsDiv = document.getElementById('treemap-cells');
  if (!cellsDiv) return;

  const sz = TEXT_SIZES[textSize];

  const dirs = items.filter(i => i.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const files = items.filter(i => i.type !== 'dir').sort((a, b) => a.name.localeCompare(b.name));

  let html = '';

  // Folders section
  if (dirs.length > 0) {
    html += '<div class="grid-section-label mono">Folders (' + dirs.length + ')</div>';
    html += '<div class="dir-grid">';
    for (const item of dirs) {
      html += renderDirCell(item, sz);
    }
    html += '</div>';
  }

  // Files section — one per row
  if (files.length > 0) {
    html += '<div class="grid-section-label mono">Files (' + files.length + ')</div>';
    for (const item of files) {
      html += renderFileCell(item, sz);
    }
  }

  cellsDiv.innerHTML = html;
}

function renderDirCell(item, sz) {
  const node = item.node;
  const palette = DIR_PALETTE[item.index % DIR_PALETTE.length];
  const { files: fc, dirs: dc } = countItems(node);
  const dirPath = JSON.stringify([...currentPath, node.name]);

  let html = '<div class="dir-cell" data-nav="' + esc(dirPath) + '" data-hover-dir="' + esc(node.name) + '" ';
  html += 'style="border:1.5px solid ' + palette.border + '; background:' + palette.bg + ';">';

  // Folder icon
  html += '<span style="color:' + palette.accent + '; flex-shrink:0; margin-top:2px">' + FOLDER_SVG + '</span>';

  // Info column
  html += '<div class="dir-info">';

  // Name + meta
  html += '<div style="display:flex; align-items:center; gap:8px">';
  html += '<span class="mono" style="font-size:' + sz.cellName + 'px; font-weight:700; color:' + palette.accent + '">' + esc(node.name) + '/</span>';
  let meta = '';
  if (dc > 0) meta += dc + ' folders';
  if (dc > 0 && fc > 0) meta += ', ';
  if (fc > 0) meta += fc + ' files';
  html += '<span class="mono" style="font-size:10px; color:var(--text-muted)">' + meta + '</span>';
  html += '</div>';

  // Description
  if (node.description) {
    html += '<div style="font-size:' + sz.cellDesc + 'px; color:var(--ai-desc); line-height:1.5; margin-top:3px">';
    html += esc(node.description) + '</div>';
  }

  // Mini chips for children
  html += '<div class="dir-children">';
  (node.children || []).slice(0, 6).forEach(c => {
    html += '<span class="dir-chip mono" style="background:' + palette.border + '50; color:' + palette.accent + '">' + esc(c.name) + '/</span>';
  });
  (node.files || []).slice(0, 5).forEach(f => {
    html += '<span class="dir-chip mono" style="background:#1a1a2e50; color:var(--file-color); opacity:0.7">' + esc(f.name) + '</span>';
  });
  html += '</div>';

  html += '</div>'; // close dir-info

  // Zoom hint
  html += '<div class="zoom-hint mono" style="color:' + palette.accent + '">' + ZOOM_SVG + ' explore</div>';

  html += '</div>';
  return html;
}

function renderFileCell(item, sz) {
  const file = item.node;
  const fullPath = [DATA.name, ...currentPath, file.name].join('/');

  let html = '<div class="file-cell" data-open="' + esc(fullPath) + '" data-hover-file="' + esc(file.name) + '">';

  // File icon
  html += '<span style="color:var(--file-color); flex-shrink:0; margin-top:2px">' + FILE_SVG + '</span>';

  // Info column
  html += '<div class="file-info">';

  // File name
  html += '<span class="mono" style="font-size:' + sz.cellName + 'px; font-weight:600; color:var(--text)">' + esc(file.name) + '</span>';

  // Description — full width, no clamp
  if (file.purpose && file.purpose !== '\\u2014') {
    html += '<div style="font-size:' + sz.cellDesc + 'px; color:var(--ai-desc); line-height:1.5; margin-top:3px">';
    html += esc(file.purpose) + '</div>';
  }

  // Tags
  if ((file.tags || []).length > 0) {
    html += '<div class="tags" style="margin-top:5px">';
    (file.tags || []).slice(0, 5).forEach(t => { html += renderTag(t, sz.tag); });
    html += '</div>';
  }

  html += '</div>'; // close file-info

  // Open hint
  html += '<div class="file-open-hint mono"><span style="color:var(--accent)">' + EXTERNAL_SVG + '</span> open</div>';

  html += '</div>';
  return html;
}

function showTooltip(el, type) {
  const tooltipDiv = document.getElementById('tooltip-container');
  if (!tooltipDiv) return;
  const sz = TEXT_SIZES[textSize];

  const rect = el.getBoundingClientRect();
  const container = document.getElementById('treemap-container');
  const containerRect = container.getBoundingClientRect();
  const scrollTop = container.scrollTop;
  const cx = rect.left + rect.width / 2 - containerRect.left;
  const cy = rect.top - containerRect.top + scrollTop;

  let name, desc, tags, snippet;
  if (type === 'dir') {
    name = el.getAttribute('data-hover-dir');
    const node = findNodeByName(name, 'dir');
    desc = node ? node.description : '';
    tags = [];
  } else {
    name = el.getAttribute('data-hover-file');
    const node = findNodeByName(name, 'file');
    desc = node ? node.purpose : '';
    tags = node ? (node.tags || []) : [];
    const fullPath = [DATA.name, ...currentPath, name].join('/');
    snippet = SNIPPETS[fullPath];
  }

  const tooltipW = 300;
  const cW = container.clientWidth;
  let tooltipH = snippet ? 200 : desc && desc !== '\\u2014' ? 100 : 60;
  let left = cx - tooltipW / 2;
  let top = cy - tooltipH - 10;
  if (left < 10) left = 10;
  if (left + tooltipW > cW - 10) left = cW - tooltipW - 10;
  if (top < scrollTop + 10) top = cy + rect.height + 10;

  const icon = type === 'dir'
    ? '<span style="color:var(--folder-color)">' + FOLDER_SVG + '</span>'
    : '<span style="color:var(--file-color)">' + FILE_SVG + '</span>';

  let html = '<div class="tooltip" style="left:' + left + 'px; top:' + top + 'px">';
  html += '<div class="tooltip-name">' + icon + '<span class="mono" style="font-size:' + sz.name + 'px; font-weight:700; color:var(--text)">' + esc(name) + '</span></div>';
  if (desc && desc !== '\\u2014') {
    html += '<div style="font-size:' + sz.desc + 'px; color:var(--ai-desc); line-height:1.5; margin-bottom:4px">' + esc(desc) + '</div>';
  }
  if (tags.length > 0) {
    html += '<div style="display:flex; flex-wrap:wrap; gap:3px; margin-bottom:4px">';
    tags.forEach(t => { html += renderTag(t, sz.tag); });
    html += '</div>';
  }
  if (snippet) {
    const lines = snippet.split('\\n').slice(0, 6).join('\\n');
    html += '<pre class="mono">' + esc(lines) + '</pre>';
  }
  html += '</div>';
  tooltipDiv.innerHTML = html;
}

function hideTooltip() {
  const tooltipDiv = document.getElementById('tooltip-container');
  if (tooltipDiv) tooltipDiv.innerHTML = '';
}

function findNodeByName(name, type) {
  const node = currentPath.length === 0 ? DATA : getNodeAtPath(DATA, currentPath);
  if (!node) return null;
  if (type === 'dir') return (node.children || []).find(c => c.name === name);
  return (node.files || []).find(f => f.name === name);
}

// ─── Event Handling ───
document.addEventListener('input', function(e) {
  if (e.target.classList.contains('search-input')) {
    searchQuery = e.target.value;
    render();
  }
});

document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    const input = document.querySelector('.search-input');
    if (input) input.focus();
  }
  if (e.key === 'Escape') {
    searchQuery = '';
    render();
  }
});

document.addEventListener('click', function(e) {
  // Open file
  const openTarget = e.target.closest('[data-open]');
  if (openTarget) {
    e.stopPropagation();
    openFile(openTarget.getAttribute('data-open'));
    return;
  }

  // Navigate
  const navTarget = e.target.closest('[data-nav]');
  if (navTarget) {
    e.stopPropagation();
    try {
      currentPath = JSON.parse(navTarget.getAttribute('data-nav'));
      searchQuery = '';
      render();
    } catch(err) { console.error('nav error', err); }
    return;
  }

  // Text size
  const sizeTarget = e.target.closest('[data-size]');
  if (sizeTarget) {
    textSize = sizeTarget.getAttribute('data-size');
    render();
    return;
  }

  // Plain English toggle
  if (e.target.closest('#pe-toggle')) {
    plainEnglish = !plainEnglish;
    render();
    return;
  }

  // Export Markdown
  if (e.target.closest('#btn-export-md')) {
    vscodeApi.postMessage({ command: 'exportMarkdown' });
    return;
  }

  // Share to Gist
  const gistBtn = e.target.closest('#btn-share-gist');
  if (gistBtn) {
    gistBtn.disabled = true;
    gistBtn.innerHTML = '<span style="font-size:12px">\\u23F3</span> Sharing...';
    vscodeApi.postMessage({ command: 'shareGist' });
    return;
  }
});

// Hover events for tooltips
document.addEventListener('mouseenter', function(e) {
  const dirCell = e.target.closest('[data-hover-dir]');
  if (dirCell && dirCell.classList.contains('dir-cell')) {
    showTooltip(dirCell, 'dir');
    return;
  }
  const fileCell = e.target.closest('[data-hover-file]');
  if (fileCell && fileCell.classList.contains('file-cell')) {
    showTooltip(fileCell, 'file');
    return;
  }
}, true);

document.addEventListener('mouseleave', function(e) {
  if (e.target.closest('[data-hover-dir]') || e.target.closest('[data-hover-file]')) {
    hideTooltip();
  }
}, true);

// Listen for messages from the extension (e.g., gist completion feedback)
window.addEventListener('message', function(event) {
  const msg = event.data;
  if (msg.command === 'gistComplete') {
    const btn = document.getElementById('btn-share-gist');
    if (btn) {
      btn.disabled = false;
      if (msg.success) {
        btn.innerHTML = '<span style="font-size:12px">\\u2705</span> Shared!';
        btn.classList.add('success');
        setTimeout(() => {
          btn.innerHTML = '<span style="font-size:12px">\\uD83D\\uDD17</span> Share Gist';
          btn.classList.remove('success');
        }, 3000);
      } else {
        btn.innerHTML = '<span style="font-size:12px">\\uD83D\\uDD17</span> Share Gist';
      }
    }
  }
});

// Initial render
try {
  console.log('Grimoire: starting initial render, DATA has ' + (DATA.children || []).length + ' dirs, ' + (DATA.files || []).length + ' files');
  render();
} catch(e) {
  console.error('Grimoire init error:', e);
  document.getElementById('app').innerHTML = '<div style="padding:40px;color:#f87171;font-family:monospace"><h2>Grimoire Error</h2><pre>' + e.message + '\\n' + e.stack + '</pre></div>';
}
</script>
</body>
</html>`;
  }

  dispose() {
    GrimoirePanel.currentPanel = null;
    this._panel.dispose();
    while (this._disposables.length) {
      this._disposables.pop().dispose();
    }
  }
}

module.exports = { GrimoirePanel };
