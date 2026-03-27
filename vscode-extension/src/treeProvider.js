// @ts-nocheck
/**
 * Grimoire — TreeDataProvider
 * Renders the scanned project tree in the VS Code sidebar.
 */

const vscode = require('vscode');
const path = require('path');

// Tag → icon mapping using VS Code codicons
const TAG_ICONS = {
  api: 'globe',
  auth: 'lock',
  database: 'database',
  graphql: 'graph',
  ai: 'sparkle',
  data: 'graph-line',
  routing: 'arrow-swap',
  state: 'layers',
  validation: 'check-all',
  websocket: 'radio-tower',
  logging: 'output',
  monitoring: 'pulse',
  'ui-lib': 'library',
  react: 'symbol-misc',
  vue: 'symbol-misc',
  svelte: 'symbol-misc',
  nextjs: 'symbol-misc',
  test: 'beaker',
  config: 'gear',
  styles: 'symbol-color',
  docs: 'book',
  python: 'symbol-method',
  rust: 'symbol-method',
  go: 'symbol-method',
  aws: 'cloud',
  docker: 'package',
};

class GrimoireTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._data = null;
    this._basePath = '';
    this._snippets = {};
  }

  setData(data, basePath, snippets) {
    this._data = data;
    this._basePath = basePath || '';
    this._snippets = snippets || {};
    this._onDidChangeTreeData.fire();
  }

  getData() {
    return this._data;
  }

  getSnippets() {
    return this._snippets;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!this._data) {
      return [
        new vscode.TreeItem(
          'Click the scan button (🔍) to map your workspace',
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }

    // Root level
    if (!element) {
      return this._buildChildren(this._data, '');
    }

    // Child level
    const node = element._grimNode;
    if (!node) return [];
    return this._buildChildren(node, element._grimPath);
  }

  _buildChildren(node, parentPath) {
    const items = [];
    const curPath = parentPath ? `${parentPath}/${node.name}` : node.name;

    // Directories first
    if (node.children) {
      for (const child of node.children) {
        const childPath = `${curPath}/${child.name}`;
        const hasChildren = (child.children?.length || 0) + (child.files?.length || 0) > 0;

        const item = new vscode.TreeItem(
          child.name,
          hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        item.iconPath = new vscode.ThemeIcon('folder');
        item.description = child.description || '';
        item.tooltip = this._buildTooltip(child.name, child.description, null, childPath);
        item.contextValue = 'directory';
        item._grimNode = child;
        item._grimPath = curPath;

        items.push(item);
      }
    }

    // Files
    if (node.files) {
      for (const file of node.files) {
        const filePath = `${curPath}/${file.name}`;
        const item = new vscode.TreeItem(file.name, vscode.TreeItemCollapsibleState.None);

        // Pick icon based on most interesting tag
        const tagIcon = this._getTagIcon(file.tags);
        item.iconPath = new vscode.ThemeIcon(tagIcon || 'file');

        // Show purpose as description
        item.description = file.purpose !== '\u2014' ? file.purpose : '';

        // Rich tooltip
        item.tooltip = this._buildTooltip(file.name, file.purpose, file.tags, filePath);

        // Click to open file
        if (this._basePath) {
          const parts = filePath.split('/');
          parts.shift(); // remove root name
          const absPath = path.join(this._basePath, ...parts);
          item.command = {
            command: 'grim.openFile',
            title: 'Open File',
            arguments: [absPath],
          };
        }

        item.contextValue = 'file';
        items.push(item);
      }
    }

    return items;
  }

  _getTagIcon(tags) {
    if (!tags || !tags.length) return null;
    // Prefer more interesting tags (non-extension ones) first
    const priority = ['ai', 'auth', 'database', 'api', 'graphql', 'websocket',
      'state', 'routing', 'validation', 'monitoring', 'logging',
      'test', 'ui-lib', 'aws', 'docker'];
    for (const p of priority) {
      if (tags.includes(p)) return TAG_ICONS[p] || null;
    }
    for (const t of tags) {
      if (TAG_ICONS[t]) return TAG_ICONS[t];
    }
    return null;
  }

  _buildTooltip(name, desc, tags, filePath) {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${name}**\n\n`);
    if (desc && desc !== '\u2014') md.appendMarkdown(`${desc}\n\n`);
    if (tags && tags.length) {
      md.appendMarkdown(`$(tag) ${tags.map(t => `\`${t}\``).join(' ')}\n\n`);
    }
    md.appendMarkdown(`\`${filePath}\``);

    // Add snippet preview if available
    const snippet = this._snippets[filePath];
    if (snippet) {
      const preview = snippet.split('\n').slice(0, 10).join('\n');
      md.appendMarkdown(`\n\n---\n`);
      md.appendCodeblock(preview, this._guessLanguage(name));
    }

    return md;
  }

  _guessLanguage(name) {
    const ext = path.extname(name).toLowerCase();
    const map = {
      '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
      '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
      '.rb': 'ruby', '.php': 'php', '.css': 'css', '.scss': 'scss',
      '.html': 'html', '.sql': 'sql', '.sh': 'shell', '.yaml': 'yaml', '.yml': 'yaml',
    };
    return map[ext] || 'plaintext';
  }
}

module.exports = { GrimoireTreeProvider };
