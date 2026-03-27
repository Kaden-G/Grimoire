// @ts-nocheck
/**
 * Grimoire — Scanner
 * Walks a workspace directory, applies heuristic + import-based tags,
 * reads file headers for AI context, and produces a .grimoire.json.
 */

let vscode;
try { vscode = require('vscode'); } catch { vscode = null; }
const fs = require('fs');
const path = require('path');

// ─── Default exclusions ───
const DEFAULT_EXCLUDE = new Set([
  'node_modules', '.git', '__pycache__', '.next', '.nuxt', 'dist', 'build',
  '.cache', '.vscode', '.idea', 'coverage', '.pytest_cache', '.mypy_cache',
  'venv', '.venv', 'env', '.env', '.tox', 'htmlcov', '.eggs',
  '.DS_Store', 'Thumbs.db', '.terraform', 'vendor', 'target',
]);

// ─── Heuristic descriptions ───
const FILE_EXACT = {
  'package.json': 'Project dependencies, scripts, and metadata',
  'package-lock.json': 'Locked dependency versions (auto-generated)',
  'yarn.lock': 'Locked dependency versions (auto-generated)',
  'tsconfig.json': 'TypeScript compiler configuration',
  'jsconfig.json': 'JavaScript project config and path aliases',
  'README.md': 'Project documentation and setup guide',
  'readme.md': 'Project documentation and setup guide',
  'LICENSE': 'Software license terms',
  '.gitignore': 'Files excluded from version control',
  '.eslintrc.js': 'ESLint linting rules',
  '.eslintrc.json': 'ESLint linting rules',
  '.prettierrc': 'Prettier formatting config',
  'Dockerfile': 'Container image build instructions',
  'docker-compose.yml': 'Multi-container orchestration config',
  'docker-compose.yaml': 'Multi-container orchestration config',
  'Makefile': 'Build automation commands',
  '.env.example': 'Template for required environment variables',
  'vite.config.ts': 'Vite bundler configuration',
  'vite.config.js': 'Vite bundler configuration',
  'webpack.config.js': 'Webpack bundler configuration',
  'next.config.js': 'Next.js framework configuration',
  'next.config.mjs': 'Next.js framework configuration',
  'tailwind.config.js': 'Tailwind CSS theme and plugin config',
  'tailwind.config.ts': 'Tailwind CSS theme and plugin config',
  'jest.config.js': 'Jest test runner configuration',
  'jest.config.ts': 'Jest test runner configuration',
  'vitest.config.ts': 'Vitest test runner configuration',
  'requirements.txt': 'Python package dependencies',
  'setup.py': 'Python package setup and metadata',
  'pyproject.toml': 'Python project config and dependencies',
  'Pipfile': 'Python dependencies (Pipenv)',
  'Cargo.toml': 'Rust project dependencies and metadata',
  'go.mod': 'Go module dependencies',
  'Gemfile': 'Ruby gem dependencies',
  'composer.json': 'PHP package dependencies',
};

const FILE_PATTERNS = [
  [/\.test\.[jt]sx?$/, n => `Unit tests for ${n.replace(/\.test\.[jt]sx?$/, '')}`],
  [/\.spec\.[jt]sx?$/, n => `Test spec for ${n.replace(/\.spec\.[jt]sx?$/, '')}`],
  [/\.stories\.[jt]sx?$/, n => `Storybook stories for ${n.replace(/\.stories\.[jt]sx?$/, '')}`],
  [/\.module\.s?css$/, n => `Scoped styles for ${n.replace(/\.module\.s?css$/, '')}`],
  [/\.d\.ts$/, () => 'TypeScript type declarations'],
  [/^use[A-Z].*\.[jt]sx?$/, n => `Custom React hook: ${n.replace(/\.[jt]sx?$/, '')}`],
  [/^[A-Z][a-zA-Z]+\.[jt]sx$/, n => `React component: ${n.replace(/\.[jt]sx$/, '')}`],
  [/^[A-Z][a-zA-Z]+\.vue$/, n => `Vue component: ${n.replace(/\.vue$/, '')}`],
  [/index\.[jt]sx?$/, () => 'Module entry point / barrel exports'],
  [/types?\.[jt]s$/, () => 'TypeScript type definitions'],
  [/constants?\.[jt]s$/, () => 'Shared constant values'],
  [/config\.[jt]s$/, () => 'Module configuration'],
  [/utils?\.[jt]sx?$/, () => 'Utility / helper functions'],
  [/middleware\.[jt]s$/, () => 'Request/response middleware'],
  [/schema\.[jt]s$/, () => 'Data validation schema'],
  [/\.sql$/, () => 'SQL query or migration'],
  [/\.sh$/, () => 'Shell script'],
  [/\.py$/, n => `Python module: ${n.replace(/\.py$/, '')}`],
  [/\.rs$/, n => `Rust module: ${n.replace(/\.rs$/, '')}`],
  [/\.go$/, () => 'Go source file'],
  [/\.css$/, () => 'Stylesheet'],
  [/\.scss$/, () => 'SCSS stylesheet'],
  [/\.svg$/, () => 'SVG vector graphic'],
  [/\.(png|jpg|jpeg|gif|webp)$/, () => 'Image asset'],
  [/\.json$/, n => `JSON data: ${n.replace(/\.json$/, '')}`],
  [/\.ya?ml$/, n => `YAML config: ${n.replace(/\.ya?ml$/, '')}`],
  [/\.md$/, n => `Documentation: ${n.replace(/\.md$/, '')}`],
];

const DIR_HEURISTICS = {
  src: 'Application source code', lib: 'Shared library code',
  dist: 'Compiled build output', build: 'Build output',
  public: 'Static assets served directly', static: 'Static files',
  assets: 'Media, images, fonts, and other assets',
  components: 'Reusable UI components', pages: 'Page-level route components',
  views: 'View/page templates', layouts: 'Layout wrapper components',
  hooks: 'Custom React hooks', utils: 'Utility functions',
  helpers: 'Helper functions', services: 'API and service layer',
  api: 'API routes or client code', routes: 'Route definitions',
  router: 'Routing configuration', controllers: 'Request handler logic',
  middleware: 'Middleware functions', models: 'Data models and schemas',
  schemas: 'Validation/data schemas', types: 'TypeScript type definitions',
  store: 'State management', state: 'State management',
  stores: 'State management stores', config: 'Configuration files',
  constants: 'Constant values', styles: 'Stylesheets',
  tests: 'Test files', test: 'Test files', __tests__: 'Test files',
  e2e: 'End-to-end tests', scripts: 'Build and utility scripts',
  docs: 'Documentation', migrations: 'Database migrations',
  seeds: 'Database seed data', prisma: 'Prisma ORM schema and migrations',
  db: 'Database related files', templates: 'Template files',
  i18n: 'Internationalization/translation files',
  locales: 'Locale/translation files', auth: 'Authentication logic',
  features: 'Feature modules', modules: 'Application modules',
  shared: 'Shared/common code', common: 'Common/shared utilities',
  core: 'Core application logic',
  '.github': 'GitHub config (Actions, templates, etc.)',
};

function getHeuristic(name, isDir) {
  if (isDir) return DIR_HEURISTICS[name] || null;
  if (FILE_EXACT[name]) return FILE_EXACT[name];
  for (const [pattern, fn] of FILE_PATTERNS) {
    if (pattern.test(name)) return fn(name);
  }
  return null;
}

// ─── Extension-based tags ───
function guessTags(name) {
  const tags = [];
  if (/\.test\.|\.spec\./.test(name)) tags.push('test');
  if (/\.[jt]sx$/.test(name)) tags.push('react');
  if (name.endsWith('.vue')) tags.push('vue');
  if (name.endsWith('.py')) tags.push('python');
  if (name.endsWith('.rs')) tags.push('rust');
  if (name.endsWith('.go')) tags.push('go');
  if (/\.s?css$/.test(name)) tags.push('styles');
  if (/config/i.test(name)) tags.push('config');
  if (name.endsWith('.sql')) tags.push('sql');
  if (/\.ya?ml$/.test(name)) tags.push('yaml');
  if (name.endsWith('.md')) tags.push('docs');
  return tags;
}

// ─── Import-based tag inference ───
const IMPORT_TAG_RULES = [
  [/(?:from\s+['"]react|import\s+.*\breact\b|require\(['"]react)/i, 'react'],
  [/(?:from\s+['"]vue|import\s+.*\bvue\b|require\(['"]vue)/i, 'vue'],
  [/(?:from\s+['"]svelte|import\s+.*\bsvelte\b)/i, 'svelte'],
  [/(?:from\s+['"]next[/'"]\b|import\s+.*\bnext\b)/i, 'nextjs'],
  [/(?:from\s+['"]angular|import\s+.*@angular)/i, 'angular'],
  [/(?:from\s+flask|import\s+flask)/i, 'flask'],
  [/(?:from\s+django|import\s+django)/i, 'django'],
  [/(?:from\s+fastapi|import\s+fastapi)/i, 'fastapi'],
  [/(?:from\s+['"]express|require\(['"]express)/i, 'api'],
  [/(?:from\s+['"]axios|require\(['"]axios)/i, 'api'],
  [/(?:import\s+requests|from\s+requests\b)/i, 'api'],
  [/(?:from\s+['"]graphql|from\s+['"]@apollo)/i, 'graphql'],
  [/(?:from\s+['"]react-router|import\s+.*react-router)/i, 'routing'],
  [/(?:from\s+['"]vue-router|import\s+.*vue-router)/i, 'routing'],
  [/(?:from\s+['"]redux|from\s+['"]@reduxjs)/i, 'state'],
  [/(?:from\s+['"]zustand|import\s+.*zustand)/i, 'state'],
  [/(?:from\s+['"]mobx|import\s+.*mobx)/i, 'state'],
  [/(?:from\s+['"]jotai|import\s+.*jotai)/i, 'state'],
  [/(?:from\s+['"]pinia|import\s+.*pinia)/i, 'state'],
  [/(?:from\s+['"]prisma|import\s+.*@prisma)/i, 'database'],
  [/(?:from\s+['"]mongoose|require\(['"]mongoose)/i, 'database'],
  [/(?:from\s+['"]sequelize|import\s+.*sequelize)/i, 'database'],
  [/(?:from\s+['"]typeorm|import\s+.*typeorm)/i, 'database'],
  [/(?:from\s+['"]drizzle|import\s+.*drizzle)/i, 'database'],
  [/(?:from\s+sqlalchemy|import\s+sqlalchemy)/i, 'database'],
  [/(?:from\s+['"]knex|require\(['"]knex)/i, 'database'],
  [/(?:from\s+['"]redis|import\s+redis)/i, 'database'],
  [/(?:from\s+['"]jsonwebtoken|require\(['"]jsonwebtoken)/i, 'auth'],
  [/(?:from\s+['"]passport|require\(['"]passport)/i, 'auth'],
  [/(?:from\s+['"]next-auth|import\s+.*next-auth)/i, 'auth'],
  [/(?:from\s+['"]bcrypt|require\(['"]bcrypt)/i, 'auth'],
  [/(?:from\s+['"]@clerk|import\s+.*clerk)/i, 'auth'],
  [/(?:from\s+['"]jest|require\(['"]jest)/i, 'test'],
  [/(?:from\s+['"]vitest|import\s+.*vitest)/i, 'test'],
  [/(?:from\s+['"]@testing-library)/i, 'test'],
  [/(?:from\s+['"]playwright|import\s+.*playwright)/i, 'test'],
  [/(?:import\s+pytest|from\s+pytest)/i, 'test'],
  [/(?:from\s+['"]openai|import\s+openai)/i, 'ai'],
  [/(?:from\s+['"]anthropic|import\s+anthropic)/i, 'ai'],
  [/(?:from\s+['"]langchain|import\s+.*langchain)/i, 'ai'],
  [/(?:import\s+torch|from\s+torch)/i, 'ai'],
  [/(?:import\s+tensorflow|from\s+tensorflow)/i, 'ai'],
  [/(?:import\s+numpy|from\s+numpy)/i, 'data'],
  [/(?:import\s+pandas|from\s+pandas)/i, 'data'],
  [/(?:from\s+['"]zod|import\s+.*\bzod\b)/i, 'validation'],
  [/(?:from\s+['"]yup|import\s+.*\byup\b)/i, 'validation'],
  [/(?:from\s+pydantic|import\s+pydantic)/i, 'validation'],
  [/(?:from\s+['"]@mui|from\s+['"]@material-ui)/i, 'ui-lib'],
  [/(?:from\s+['"]@chakra-ui)/i, 'ui-lib'],
  [/(?:from\s+['"]@shadcn|from\s+['"]@\/components\/ui)/i, 'ui-lib'],
  [/(?:from\s+['"]aws-sdk|from\s+['"]@aws-sdk|import\s+boto3|from\s+boto3)/i, 'aws'],
  [/(?:from\s+['"]socket\.io|require\(['"]socket\.io)/i, 'websocket'],
  [/(?:import\s+logging|from\s+logging)/i, 'logging'],
  [/(?:from\s+['"]winston|require\(['"]winston)/i, 'logging'],
  [/(?:from\s+['"]@sentry|import\s+.*sentry)/i, 'monitoring'],
];

function inferTagsFromSnippet(snippet) {
  if (!snippet) return [];
  const tags = new Set();
  for (const [pattern, tag] of IMPORT_TAG_RULES) {
    if (pattern.test(snippet)) tags.add(tag);
  }
  return [...tags].sort();
}

// ─── File header scanning ───
const SCANNABLE_EXTENSIONS = new Set([
  '.py', '.js', '.ts', '.jsx', '.tsx', '.rs', '.go', '.java', '.c', '.cpp',
  '.h', '.hpp', '.cs', '.rb', '.php', '.swift', '.kt', '.scala', '.vue',
  '.svelte', '.sh', '.bash', '.zsh', '.sql', '.r', '.lua', '.zig',
  '.ex', '.exs', '.erl', '.hs', '.ml', '.clj', '.dart', '.tf', '.hcl',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.bmp',
  '.mp3', '.mp4', '.wav', '.mov', '.avi', '.mkv', '.flac',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.pyc', '.pyo',
  '.lock', '.map',
]);

const MAX_SCAN_LINES = 40;
const MAX_SCAN_BYTES = 4096;

function scanFileHeader(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return null;
  if (!SCANNABLE_EXTENSIONS.has(ext) && !FILE_EXACT[path.basename(filePath)]) return null;

  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(MAX_SCAN_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, MAX_SCAN_BYTES, 0);
    fs.closeSync(fd);
    const content = buffer.toString('utf8', 0, bytesRead);
    const lines = content.split('\n').slice(0, MAX_SCAN_LINES);
    const snippet = lines.join('\n').trim();
    return snippet || null;
  } catch {
    return null;
  }
}

// ─── Directory walking ───
function shouldExclude(name, extraExcludes) {
  if (DEFAULT_EXCLUDE.has(name)) return true;
  if (extraExcludes && extraExcludes.has(name)) return true;
  if (name.startsWith('.') && name !== '.github' && name !== '.env.example') return true;
  return false;
}

function walkDirectory(dirPath, rootName, excludes, scanHeaders, token) {
  if (token?.isCancellationRequested) return null;

  const name = path.basename(dirPath);
  const tree = {
    name: rootName || name,
    description: getHeuristic(name, true) || 'Project root',
    children: [],
    files: [],
  };

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  } catch {
    return tree;
  }

  for (const entry of entries) {
    if (token?.isCancellationRequested) break;
    if (shouldExclude(entry.name, excludes)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const child = walkDirectory(fullPath, entry.name, excludes, scanHeaders, token);
      if (child && (child.children?.length || child.files?.length)) {
        tree.children.push(child);
      }
    } else if (entry.isFile()) {
      const extTags = guessTags(entry.name);
      const fileInfo = {
        name: entry.name,
        purpose: getHeuristic(entry.name, false) || '\u2014',
        tags: extTags,
      };

      if (scanHeaders) {
        const snippet = scanFileHeader(fullPath);
        if (snippet) {
          fileInfo.snippet = snippet;
          const importTags = inferTagsFromSnippet(snippet);
          if (importTags.length) {
            const merged = [...new Set([...extTags, ...importTags])];
            fileInfo.tags = merged;
          }
        }
      }

      tree.files.push(fileInfo);
    }
  }

  if (!tree.children.length) delete tree.children;
  if (!tree.files.length) delete tree.files;
  return tree;
}

// ─── Collect helpers ───
function collectPaths(node, prefix = '') {
  const paths = [];
  const cur = prefix ? `${prefix}/${node.name}` : node.name;
  paths.push(cur);
  for (const f of node.files || []) paths.push(`${cur}/${f.name}`);
  for (const c of node.children || []) paths.push(...collectPaths(c, cur));
  return paths;
}

function collectSnippets(node, prefix = '') {
  const snippets = {};
  const cur = prefix ? `${prefix}/${node.name}` : node.name;
  for (const f of node.files || []) {
    if (f.snippet) snippets[`${cur}/${f.name}`] = f.snippet;
  }
  for (const c of node.children || []) Object.assign(snippets, collectSnippets(c, cur));
  return snippets;
}

function stripSnippets(node) {
  for (const f of node.files || []) delete f.snippet;
  for (const c of node.children || []) stripSnippets(c);
}

function applyDescriptions(node, descs, prefix = '') {
  let count = 0;
  const cur = prefix ? `${prefix}/${node.name}` : node.name;
  if (descs[cur]) { node.description = descs[cur]; count++; }
  for (const f of node.files || []) {
    const fp = `${cur}/${f.name}`;
    if (descs[fp]) { f.purpose = descs[fp]; count++; }
  }
  for (const c of node.children || []) count += applyDescriptions(c, descs, cur);
  return count;
}

// ─── Main scan function ───
async function scanWorkspace(workspacePath, options = {}, token) {
  const config = vscode?.workspace?.getConfiguration('grim');
  const scanHeaders = options.scanHeaders ?? (config ? config.get('scanHeaders', true) : true);
  const extraExcludes = new Set(config ? config.get('exclude', []) : []);

  const rootName = path.basename(workspacePath);

  // Walk directory
  const tree = walkDirectory(workspacePath, rootName, extraExcludes, scanHeaders, token);
  if (!tree) return null;

  const allPaths = collectPaths(tree);
  const snippets = scanHeaders ? collectSnippets(tree) : {};

  // Read README
  let readme = '';
  for (const name of ['README.md', 'readme.md', 'Readme.md']) {
    const readmePath = path.join(workspacePath, name);
    if (fs.existsSync(readmePath)) {
      try { readme = fs.readFileSync(readmePath, 'utf8').slice(0, 3000); } catch {}
      break;
    }
  }

  // Strip snippets from tree (stored separately)
  stripSnippets(tree);

  const output = {
    tree,
    basePath: workspacePath,
    readme: readme.slice(0, 1500),
    generatedAt: new Date().toISOString(),
    model: 'heuristics-only',
    hasSnippets: Object.keys(snippets).length > 0,
  };
  if (Object.keys(snippets).length) output.snippets = snippets;

  return { output, allPaths, snippets, readme };
}

module.exports = {
  scanWorkspace,
  applyDescriptions,
  collectPaths,
  getHeuristic,
  guessTags,
  inferTagsFromSnippet,
  DEFAULT_EXCLUDE,
};
