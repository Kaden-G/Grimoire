import { useState, useMemo, useRef, useEffect, useCallback } from "react";

// ─── Colors ───
const C = {
  bg: "#0a0e17", surface: "#111827", surfaceHover: "#1a2236", surfaceActive: "#1e293b",
  border: "#1e2d44", borderHover: "#2d4a6f", accent: "#38bdf8", accentDim: "#0c4a6e",
  accentGlow: "rgba(56,189,248,0.15)", text: "#e2e8f0", textDim: "#94a3b8", textMuted: "#475569",
  file: "#a78bfa", folder: "#38bdf8", tag: "#334155", tagText: "#94a3b8",
  green: "#34d399", greenDim: "#064e3b", yellow: "#fbbf24", yellowBg: "rgba(251,191,36,0.12)",
  red: "#f87171", redDim: "#7f1d1d",
  aiDesc: "#cbd5e1",  // brighter for AI-generated descriptions
  aiAccent: "#fbbf24",
};

const MONO = "'JetBrains Mono','Fira Code',monospace";
const SANS = "'Inter','Segoe UI',system-ui,sans-serif";

const TEXT_SIZES = {
  small:  { name: 10.5, desc: 9.5,  tag: 8.5,  header: 12, cellName: 10, cellDesc: 9 },
  medium: { name: 13,   desc: 11.5, tag: 10,   header: 15, cellName: 12, cellDesc: 10.5 },
  large:  { name: 15.5, desc: 13.5, tag: 11.5, header: 18, cellName: 14, cellDesc: 12.5 },
};

// ─── Heuristics ───
const FILE_EXACT = {
  "package.json": "Project dependencies, scripts, and metadata",
  "package-lock.json": "Locked dependency versions (auto-generated)",
  "yarn.lock": "Locked dependency versions (auto-generated)",
  "tsconfig.json": "TypeScript compiler configuration",
  "jsconfig.json": "JavaScript project configuration and path aliases",
  "README.md": "Project documentation and setup guide",
  "readme.md": "Project documentation and setup guide",
  "LICENSE": "Software license terms",
  "LICENSE.md": "Software license terms",
  ".gitignore": "Files and directories excluded from version control",
  ".eslintrc.js": "ESLint code linting rules",
  ".eslintrc.json": "ESLint code linting rules",
  ".prettierrc": "Prettier code formatting config",
  "Dockerfile": "Container image build instructions",
  "docker-compose.yml": "Multi-container orchestration config",
  "docker-compose.yaml": "Multi-container orchestration config",
  "Makefile": "Build automation commands",
  ".env": "Environment variables (secrets, config values)",
  ".env.example": "Template for required environment variables",
  ".env.local": "Local environment overrides (not committed)",
  "vite.config.ts": "Vite bundler configuration",
  "vite.config.js": "Vite bundler configuration",
  "webpack.config.js": "Webpack bundler configuration",
  "next.config.js": "Next.js framework configuration",
  "next.config.mjs": "Next.js framework configuration",
  "tailwind.config.js": "Tailwind CSS theme and plugin config",
  "tailwind.config.ts": "Tailwind CSS theme and plugin config",
  "postcss.config.js": "PostCSS processing pipeline config",
  "jest.config.js": "Jest test runner configuration",
  "jest.config.ts": "Jest test runner configuration",
  "vitest.config.ts": "Vitest test runner configuration",
  "babel.config.js": "Babel transpiler configuration",
  ".babelrc": "Babel transpiler configuration",
  "Procfile": "Process types for deployment (Heroku/similar)",
  "netlify.toml": "Netlify deployment configuration",
  "vercel.json": "Vercel deployment configuration",
  "fly.toml": "Fly.io deployment configuration",
  "Cargo.toml": "Rust project dependencies and metadata",
  "Cargo.lock": "Locked Rust dependency versions",
  "go.mod": "Go module dependencies",
  "go.sum": "Go dependency checksums",
  "requirements.txt": "Python package dependencies",
  "setup.py": "Python package setup and metadata",
  "pyproject.toml": "Python project config and dependencies",
  "Pipfile": "Python dependencies (Pipenv)",
  "Gemfile": "Ruby gem dependencies",
  "Gemfile.lock": "Locked Ruby dependency versions",
  "composer.json": "PHP package dependencies",
  ".dockerignore": "Files excluded from Docker build context",
  "nginx.conf": "Nginx web server configuration",
  ".nvmrc": "Node.js version specification",
  ".node-version": "Node.js version specification",
  ".python-version": "Python version specification",
  "prefect.yaml": "Prefect workflow orchestration config",
  "dbt_project.yml": "dbt data transformation project config",
};

const FILE_PATTERNS = [
  [/\.test\.[jt]sx?$/, n => `Unit tests for ${n.replace(/\.test\.[jt]sx?$/, "")}`],
  [/\.spec\.[jt]sx?$/, n => `Test spec for ${n.replace(/\.spec\.[jt]sx?$/, "")}`],
  [/\.stories\.[jt]sx?$/, n => `Storybook stories for ${n.replace(/\.stories\.[jt]sx?$/, "")}`],
  [/\.module\.s?css$/, n => `Scoped styles for ${n.replace(/\.module\.s?css$/, "")}`],
  [/\.d\.ts$/, () => "TypeScript type declarations"],
  [/^use[A-Z].*\.[jt]sx?$/, n => `Custom React hook: ${n.replace(/\.[jt]sx?$/, "")}`],
  [/^[A-Z][a-zA-Z]+\.[jt]sx$/, n => `React component: ${n.replace(/\.[jt]sx$/, "")}`],
  [/^[A-Z][a-zA-Z]+\.vue$/, n => `Vue component: ${n.replace(/\.vue$/, "")}`],
  [/^[A-Z][a-zA-Z]+\.svelte$/, n => `Svelte component: ${n.replace(/\.svelte$/, "")}`],
  [/index\.[jt]sx?$/, () => "Module entry point / barrel exports"],
  [/types?\.[jt]s$/, () => "TypeScript type definitions"],
  [/constants?\.[jt]s$/, () => "Shared constant values"],
  [/config\.[jt]s$/, () => "Module configuration"],
  [/utils?\.[jt]sx?$/, () => "Utility / helper functions"],
  [/helpers?\.[jt]sx?$/, () => "Helper functions"],
  [/middleware\.[jt]s$/, () => "Request/response middleware"],
  [/schema\.[jt]s$/, () => "Data validation schema"],
  [/migration.*\.[jt]s$/, () => "Database migration"],
  [/seed.*\.[jt]s$/, () => "Database seed data"],
  [/\.sql$/, () => "SQL query or migration"],
  [/\.sh$/, () => "Shell script"],
  [/\.py$/, n => `Python module: ${n.replace(/\.py$/, "")}`],
  [/\.rs$/, n => `Rust module: ${n.replace(/\.rs$/, "")}`],
  [/\.go$/, () => "Go source file"],
  [/\.css$/, () => "Stylesheet"],
  [/\.scss$/, () => "SCSS stylesheet"],
  [/\.svg$/, () => "SVG vector graphic"],
  [/\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$/, () => "Image asset"],
  [/\.json$/, n => `JSON data: ${n.replace(/\.json$/, "")}`],
  [/\.ya?ml$/, n => `YAML config: ${n.replace(/\.ya?ml$/, "")}`],
  [/\.md$/, n => `Documentation: ${n.replace(/\.md$/, "")}`],
  [/\.txt$/, () => "Plain text file"],
];

const DIR_HEURISTICS = {
  src: "Application source code", lib: "Shared library code",
  dist: "Compiled build output (generated)", build: "Build output (generated)",
  out: "Output directory (generated)", public: "Static assets served directly",
  static: "Static files", assets: "Media, images, fonts, and other assets",
  images: "Image files", img: "Image files", icons: "Icon assets", fonts: "Font files",
  components: "Reusable UI components", pages: "Page-level route components",
  views: "View/page templates", layouts: "Layout wrapper components",
  hooks: "Custom React hooks", composables: "Vue composable functions",
  utils: "Utility functions", utilities: "Utility functions", helpers: "Helper functions",
  services: "API and service layer", api: "API routes or client code",
  routes: "Route definitions", router: "Routing configuration",
  controllers: "Request handler logic", middleware: "Middleware functions",
  models: "Data models and schemas", schemas: "Validation/data schemas",
  types: "TypeScript type definitions", interfaces: "Interface definitions",
  store: "State management", state: "State management", stores: "State management stores",
  reducers: "Redux reducers", actions: "Redux/state actions", slices: "Redux toolkit slices",
  context: "React context providers", providers: "Context/service providers",
  config: "Configuration files", constants: "Constant values",
  styles: "Stylesheets", css: "CSS files",
  tests: "Test files", test: "Test files",
  __tests__: "Test files", spec: "Test specifications",
  __mocks__: "Mock implementations for testing", mocks: "Mock data and services",
  fixtures: "Test fixture data", e2e: "End-to-end tests", cypress: "Cypress E2E test suite",
  scripts: "Build and utility scripts", tools: "Developer tooling",
  docs: "Documentation", documentation: "Documentation",
  migrations: "Database migrations", seeds: "Database seed data",
  prisma: "Prisma ORM schema and migrations", db: "Database related files",
  database: "Database related files", templates: "Template files", emails: "Email templates",
  i18n: "Internationalization/translation files", locales: "Locale/translation files",
  auth: "Authentication logic", features: "Feature modules", modules: "Application modules",
  shared: "Shared/common code", common: "Common/shared utilities",
  core: "Core application logic", domain: "Domain/business logic",
  entities: "Domain entities", dtos: "Data transfer objects", guards: "Route/auth guards",
  pipes: "Data transformation pipes", decorators: "Custom decorators",
  plugins: "Plugin modules", vendor: "Third-party code",
  node_modules: "Installed npm packages (auto-generated)",
  ".github": "GitHub config (Actions, templates, etc.)",
  ".vscode": "VS Code workspace settings", ".husky": "Git hook scripts",
  __pycache__: "Python bytecode cache (auto-generated)",
  ".next": "Next.js build cache (auto-generated)", ".nuxt": "Nuxt.js build cache (auto-generated)",
};

function getHeuristicDesc(name, isDir) {
  if (isDir) return DIR_HEURISTICS[name] || null;
  if (FILE_EXACT[name]) return FILE_EXACT[name];
  for (const [pat, fn] of FILE_PATTERNS) { if (pat.test(name)) return fn(name); }
  return null;
}

// ─── Tree Parsing ───
function parseInput(text) {
  const lines = text.split("\n").filter(l => l.trim());
  if (!lines.length) return null;
  if (lines.some(l => /[├└│─]/.test(l))) return parseBoxTree(lines);
  return parsePathList(lines);
}

function parseBoxTree(lines) {
  const filtered = lines.filter(l => !/^\d+ director/.test(l.trim()));
  if (!filtered.length) return null;
  const rootName = filtered[0].replace(/[├└│─\s]/g, "").replace(/\/$/, "") || "project";
  const items = [];
  for (let i = 1; i < filtered.length; i++) {
    const match = filtered[i].match(/^(.*?)[├└]\s*─+\s*(.+)$/);
    if (!match) continue;
    const prefix = match[1];
    const name = match[2].trim().replace(/\/$/, "");
    const depth = Math.round(prefix.replace(/[^\s│]/g, "").length / 3) || Math.round(prefix.length / 4);
    items.push({ name, depth, explicitDir: match[2].trim().endsWith("/") });
  }
  for (let i = 0; i < items.length; i++) {
    const next = items[i + 1];
    items[i].isDir = items[i].explicitDir || (next && next.depth > items[i].depth);
  }
  return buildTree(rootName, items);
}

function parsePathList(lines) {
  const paths = lines.map(l => l.trim().replace(/^\.\//, "")).filter(l => l && !l.startsWith("#"));
  if (!paths.length) return null;
  const rootName = paths[0].split("/")[0] || "project";
  return buildTreeFromPaths(rootName, paths);
}

function buildTreeFromPaths(rootName, paths) {
  const root = { name: rootName, description: null, children: [], files: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    const start = parts[0] === rootName ? 1 : 0;
    for (let i = start; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const isFile = isLast && /\.\w{1,10}$/.test(name);
      if (isFile) {
        if (!node.files) node.files = [];
        if (!node.files.find(f => f.name === name)) {
          node.files.push({ name, purpose: getHeuristicDesc(name, false) || "\u2014", tags: guessTagsFromName(name) });
        }
      } else {
        if (!node.children) node.children = [];
        let child = node.children.find(c => c.name === name);
        if (!child) {
          child = { name, description: getHeuristicDesc(name, true) || "Directory", children: [], files: [] };
          node.children.push(child);
        }
        node = child;
      }
    }
  }
  cleanTree(root);
  return root;
}

function buildTree(rootName, items) {
  const root = { name: rootName, description: null, children: [], files: [] };
  const stack = [{ node: root, depth: -1 }];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= item.depth) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (item.isDir) {
      const dir = { name: item.name, description: getHeuristicDesc(item.name, true) || "Directory", children: [], files: [] };
      if (!parent.children) parent.children = [];
      parent.children.push(dir);
      stack.push({ node: dir, depth: item.depth });
    } else {
      if (!parent.files) parent.files = [];
      parent.files.push({ name: item.name, purpose: getHeuristicDesc(item.name, false) || "\u2014", tags: guessTagsFromName(item.name) });
    }
  }
  cleanTree(root);
  return root;
}

function cleanTree(node) {
  if (node.children?.length === 0) delete node.children;
  if (node.files?.length === 0) delete node.files;
  node.children?.forEach(cleanTree);
}

function guessTagsFromName(name) {
  const tags = [];
  if (/\.test\.|\.spec\./.test(name)) tags.push("test");
  if (/\.[jt]sx$/.test(name)) tags.push("react");
  if (/\.vue$/.test(name)) tags.push("vue");
  if (/\.svelte$/.test(name)) tags.push("svelte");
  if (/\.py$/.test(name)) tags.push("python");
  if (/\.rs$/.test(name)) tags.push("rust");
  if (/\.go$/.test(name)) tags.push("go");
  if (/\.s?css$/.test(name)) tags.push("styles");
  if (/config/i.test(name)) tags.push("config");
  if (/\.sql$/.test(name)) tags.push("sql");
  if (/\.ya?ml$/.test(name)) tags.push("yaml");
  if (/\.md$/.test(name)) tags.push("docs");
  return tags;
}

// ─── Helpers ───
function flattenItems(node, path = "") {
  let items = [];
  const cur = path ? `${path}/${node.name}` : node.name;
  if (node.files) node.files.forEach(f => items.push({ ...f, path: `${cur}/${f.name}`, parentPath: cur, type: "file" }));
  if (node.children) node.children.forEach(c => {
    items.push({ name: c.name, description: c.description, path: `${cur}/${c.name}`, parentPath: cur, type: "folder" });
    items = items.concat(flattenItems(c, cur));
  });
  return items;
}

function searchItems(all, q) {
  if (!q.trim()) return [];
  const terms = q.toLowerCase().split(/\s+/);
  return all
    .map(item => {
      const s = [item.name, item.purpose || "", item.description || "", ...(item.tags || []), item.path || ""].join(" ").toLowerCase();
      const score = terms.reduce((acc, t) => acc + (s.includes(t) ? 1 : 0), 0);
      return { ...item, score };
    })
    .filter(i => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

function getNodeAtPath(root, parts) {
  let node = root;
  for (const p of parts) { node = node.children?.find(c => c.name === p); if (!node) return null; }
  return node;
}

function countItems(node) {
  let files = node.files?.length || 0;
  let dirs = node.children?.length || 0;
  node.children?.forEach(c => { const sub = countItems(c); files += sub.files; dirs += sub.dirs; });
  return { files, dirs };
}

function totalWeight(node) {
  let w = node.files?.length || 0;
  node.children?.forEach(c => { w += Math.max(totalWeight(c), 1); });
  return Math.max(w, 1);
}

// ─── AI Helpers ───
function buildPromptForTree(tree, readme, plainEnglish = true) {
  const allPaths = [];
  function collect(node, path = "") {
    const cur = path ? `${path}/${node.name}` : node.name;
    if (node.children) { allPaths.push(cur); node.children.forEach(c => collect(c, cur)); }
    if (node.files) node.files.forEach(f => allPaths.push(`${cur}/${f.name}`));
  }
  collect(tree);
  const pathList = allPaths.join("\n");
  const ctx = readme ? ` Project context: ${readme.slice(0, 1200)}` : "";

  if (plainEnglish) {
    return `Describe each file/directory path below in 15-25 words using plain, everyday English. Write for someone who is NOT a professional developer. NEVER use jargon like API, ORM, middleware, schema, endpoint, payload, serialization, JWT, CRUD, REST, GraphQL, webhook, or similar technical terms. Instead, describe what the file does in terms of its REAL-WORLD effect.${ctx}\n\nPaths:\n${pathList}\n\nRespond ONLY with a JSON object mapping each path to its description. No markdown fences, no preamble.\nExample: {"src/auth/middleware.ts": "Checks that someone is logged in before letting them access protected pages, using a secure token system"}`;
  }
  return `Describe each file/directory path below in 15-25 words. Be specific about what it DOES, not just what it IS. Mention key technologies, patterns, and behaviors.${ctx}\n\nPaths:\n${pathList}\n\nRespond ONLY with a JSON object mapping each path to its description. No markdown fences, no preamble.\nExample: {"src/auth/middleware.ts": "Express middleware that validates JWT tokens from Authorization header and attaches decoded user payload to request object"}`;
}

function parseAIDescriptions(jsonText) { return JSON.parse(jsonText.replace(/```json|```/g, "").trim()); }

function applyDescriptions(node, descs, path = "") {
  const cur = path ? `${path}/${node.name}` : node.name;
  if (descs[cur]) node.description = descs[cur];
  if (node.files) node.files.forEach(f => { const fp = `${cur}/${f.name}`; if (descs[fp]) f.purpose = descs[fp]; });
  node.children?.forEach(c => applyDescriptions(c, descs, cur));
}

// ─── Squarified Treemap Layout ───
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

// ─── Icons ───
const Icon = ({ d, size = 18, color = C.textDim, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {typeof d === "string" ? <path d={d} /> : d}
  </svg>
);
const FolderIcon = ({ size = 18, color = C.folder }) => <Icon size={size} color={color} d={<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />} />;
const FileIcon = ({ size = 16, color = C.file }) => <Icon size={size} color={color} d={<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>} />;
const SearchIcon = () => <Icon d={<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>} />;
const BackIcon = () => <Icon size={16} d={<><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>} />;
const ChevronRight = () => <Icon size={14} color={C.textMuted} d="M9 18l6-6-6-6" />;
const ExternalIcon = () => <Icon size={13} color={C.accent} d={<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>} />;
const SparkleIcon = () => <Icon size={16} color={C.yellow} d={<><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" /><path d="M19 13l.75 2.25L22 16l-2.25.75L19 19l-.75-2.25L16 16l2.25-.75z" /></>} />;
const DownloadIcon = () => <Icon size={15} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>} />;
const UploadIcon = () => <Icon size={15} d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>} />;
const MapPinIcon = () => <Icon size={20} color={C.accent} d={<><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></>} />;
const ZoomInIcon = () => <Icon size={15} d={<><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></>} />;

// ─── Tag colors ───
const TAG_COLORS = {
  api: { bg: "#1e3a5f", text: "#60a5fa" }, auth: { bg: "#3b1f2b", text: "#f472b6" },
  database: { bg: "#1a2e1a", text: "#4ade80" }, graphql: { bg: "#2d1b4e", text: "#c084fc" },
  ai: { bg: "#3d2e0a", text: "#fbbf24" }, data: { bg: "#3d2e0a", text: "#fbbf24" },
  routing: { bg: "#1e3a5f", text: "#38bdf8" }, state: { bg: "#2d1b4e", text: "#a78bfa" },
  validation: { bg: "#1a2e1a", text: "#34d399" }, websocket: { bg: "#1e3a5f", text: "#22d3ee" },
  logging: { bg: "#2a2215", text: "#fb923c" }, monitoring: { bg: "#2a2215", text: "#fb923c" },
  "ui-lib": { bg: "#2d1b4e", text: "#c084fc" }, nextjs: { bg: "#1a1a2e", text: "#e2e8f0" },
  flask: { bg: "#1a2e1a", text: "#34d399" }, django: { bg: "#1a2e1a", text: "#4ade80" },
  fastapi: { bg: "#1a2e1a", text: "#22d3ee" }, aws: { bg: "#3d2e0a", text: "#fb923c" },
  docker: { bg: "#1e3a5f", text: "#60a5fa" },
};

// Directory colors for treemap cells (cycling palette)
const DIR_PALETTE = [
  { bg: "#111d2e", header: "#162640", border: "#1e3a5f", accent: "#38bdf8" },
  { bg: "#131f13", header: "#1a2e1a", border: "#2d5f2d", accent: "#4ade80" },
  { bg: "#1a1228", header: "#231835", border: "#3d2766", accent: "#a78bfa" },
  { bg: "#1f1a0a", header: "#2a2210", border: "#4a3d1a", accent: "#fbbf24" },
  { bg: "#1f1018", header: "#2e1724", border: "#5f2d44", accent: "#f472b6" },
  { bg: "#0f1a20", header: "#152530", border: "#2d4a5f", accent: "#22d3ee" },
];

// ─── Small components ───
const Tag = ({ label, sz }) => {
  const colors = TAG_COLORS[label];
  return (
    <span style={{
      display: "inline-block", padding: "1px 6px", borderRadius: 99, fontSize: sz || 10,
      fontFamily: MONO, marginRight: 2, lineHeight: 1.5,
      background: colors ? colors.bg : C.tag,
      color: colors ? colors.text : C.tagText,
      fontWeight: colors ? 600 : 400,
    }}>{label}</span>
  );
};

const Btn = ({ children, onClick, style, primary, small, danger, ...p }) => {
  const [h, setH] = useState(false);
  return (
    <button style={{
      display: "inline-flex", alignItems: "center", gap: 6, border: "none", borderRadius: 8,
      cursor: "pointer", fontFamily: MONO, fontSize: small ? 11 : 12.5, fontWeight: 500,
      transition: "all 0.15s", padding: small ? "5px 10px" : "8px 16px",
      background: primary ? C.accent : danger ? C.redDim : C.surface,
      color: primary ? C.bg : danger ? C.red : C.text,
      outline: h ? `2px solid ${C.accent}40` : "none", opacity: h ? 1 : 0.9, ...style,
    }} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} {...p}>{children}</button>
  );
};

// ─── Floating Toolbar ───
function FloatingToolbar({ textSize, setTextSize, plainEnglish, setPlainEnglish }) {
  return (
    <div style={{
      position: "fixed", bottom: 20, left: 20, zIndex: 50,
      display: "flex", alignItems: "center", gap: 2,
      background: "rgba(17,24,39,0.92)", backdropFilter: "blur(12px)",
      border: `1px solid ${C.border}`, borderRadius: 12,
      padding: "6px 10px", boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      {/* Text size */}
      <span style={{ fontSize: 10, color: C.textMuted, fontFamily: MONO, marginRight: 4 }}>Aa</span>
      {["small", "medium", "large"].map(sz => (
        <button key={sz} onClick={() => setTextSize(sz)} style={{
          width: sz === "small" ? 22 : sz === "medium" ? 26 : 30,
          height: sz === "small" ? 22 : sz === "medium" ? 26 : 30,
          borderRadius: 6, border: textSize === sz ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
          background: textSize === sz ? C.accentDim : "transparent",
          color: textSize === sz ? C.accent : C.textMuted,
          cursor: "pointer", fontFamily: MONO, fontWeight: 700,
          fontSize: sz === "small" ? 10 : sz === "medium" ? 12 : 14,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}>{sz[0].toUpperCase()}</button>
      ))}

      {/* Divider */}
      <div style={{ width: 1, height: 20, background: C.border, margin: "0 8px" }} />

      {/* Plain English toggle */}
      <button onClick={() => setPlainEnglish(!plainEnglish)} style={{
        display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
        borderRadius: 8, border: `1px solid ${plainEnglish ? C.accent + "60" : C.border}`,
        background: plainEnglish ? C.accentDim : "transparent",
        color: plainEnglish ? C.accent : C.textMuted,
        cursor: "pointer", fontFamily: MONO, fontSize: 10.5, fontWeight: 600,
        transition: "all 0.15s",
      }}>
        <span style={{ fontSize: 13 }}>{plainEnglish ? "\uD83D\uDDE3\uFE0F" : "\uD83D\uDD27"}</span>
        {plainEnglish ? "Plain English" : "Technical"}
      </button>
    </div>
  );
}

// ─── Import Screen ───
function ImportScreen({ onImport }) {
  const [treeText, setTreeText] = useState("");
  const [readme, setReadme] = useState("");
  const [basePath, setBasePath] = useState("");
  const [showReadme, setShowReadme] = useState(false);
  const [error, setError] = useState(null);
  const [jsonImport, setJsonImport] = useState(false);
  const fileRef = useRef(null);

  function handleMap() {
    setError(null);
    if (jsonImport) {
      try {
        const data = JSON.parse(treeText);
        onImport(data.tree || data, data.basePath || basePath, data.readme || readme, data.snippets || null);
      } catch { setError("Invalid JSON. Paste a .grimoire.json file."); }
      return;
    }
    const tree = parseInput(treeText);
    if (!tree) { setError("Couldn't parse that input. Try `tree`, `find .`, or path-per-line format."); return; }
    tree.description = tree.description || "Project root";
    onImport(tree, basePath, readme, null);
  }

  const sampleTree = `my-app\n\u251C\u2500\u2500 src\n\u2502   \u251C\u2500\u2500 components\n\u2502   \u2502   \u251C\u2500\u2500 Header.tsx\n\u2502   \u2502   \u2514\u2500\u2500 Footer.tsx\n\u2502   \u251C\u2500\u2500 hooks\n\u2502   \u2502   \u2514\u2500\u2500 useAuth.ts\n\u2502   \u251C\u2500\u2500 utils\n\u2502   \u2502   \u2514\u2500\u2500 api.ts\n\u2502   \u251C\u2500\u2500 App.tsx\n\u2502   \u2514\u2500\u2500 main.tsx\n\u251C\u2500\u2500 public\n\u2502   \u2514\u2500\u2500 index.html\n\u251C\u2500\u2500 package.json\n\u2514\u2500\u2500 README.md`;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: SANS }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::placeholder { color: ${C.textMuted}; }
        textarea:focus, input:focus { outline: none; border-color: ${C.borderHover} !important; box-shadow: 0 0 0 3px ${C.accentGlow}; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div style={{ maxWidth: 680, width: "100%", animation: "fadeIn 0.4s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <MapPinIcon />
          <h1 style={{ fontSize: 24, fontWeight: 700, color: C.text, margin: 0, fontFamily: MONO }}>Grimoire</h1>
        </div>
        <p style={{ color: C.textDim, fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
          Paste your project's file tree below and get an interactive, zoomable treemap of every file and what it does. Like Google Maps, but for your codebase.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Btn small onClick={() => setJsonImport(false)} style={{ background: !jsonImport ? C.accentDim : C.surface, color: !jsonImport ? C.accent : C.textDim }}>Paste Tree / Paths</Btn>
          <Btn small onClick={() => setJsonImport(true)} style={{ background: jsonImport ? C.accentDim : C.surface, color: jsonImport ? C.accent : C.textDim }}>Import .grimoire.json</Btn>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textDim, fontFamily: MONO }}>
              {jsonImport ? "PASTE JSON" : "FILE TREE OR PATH LIST"}
            </label>
            {!jsonImport && (
              <Btn small onClick={() => setTreeText(sampleTree)}>sample tree</Btn>
            )}
          </div>
          <textarea value={treeText} onChange={e => setTreeText(e.target.value)}
            placeholder={jsonImport ? 'Paste .grimoire.json contents...' : 'Paste output of `tree`, `find . -type f`, or one path per line...'}
            style={{
              width: "100%", minHeight: 220, padding: 14, borderRadius: 10, border: `1px solid ${C.border}`,
              background: C.surface, color: C.text, fontSize: 12.5, fontFamily: MONO, lineHeight: 1.6, resize: "vertical",
            }}
          />
          {!jsonImport && (
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, fontFamily: MONO }}>
              Run <span style={{ color: C.accent }}>tree -F</span> or <span style={{ color: C.accent }}>find . -not -path '*/node_modules/*' -not -path '*/.git/*'</span>
            </div>
          )}
        </div>

        {!jsonImport && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: C.textDim, fontFamily: MONO, display: "block", marginBottom: 6 }}>
              PROJECT BASE PATH <span style={{ fontWeight: 400, color: C.textMuted }}>(for VS Code links)</span>
            </label>
            <input value={basePath} onChange={e => setBasePath(e.target.value)}
              placeholder="/Users/kaden/projects/my-app"
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${C.border}`,
                background: C.surface, color: C.text, fontSize: 13, fontFamily: MONO,
              }}
            />
          </div>
        )}

        {!jsonImport && (
          <div style={{ marginBottom: 20 }}>
            <button onClick={() => setShowReadme(!showReadme)}
              style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", fontSize: 12, fontFamily: MONO, display: "flex", alignItems: "center", gap: 6, padding: 0 }}>
              <span style={{ transform: showReadme ? "rotate(90deg)" : "none", transition: "0.15s", display: "inline-block" }}>\u25B6</span>
              README content (optional)
            </button>
            {showReadme && (
              <textarea value={readme} onChange={e => setReadme(e.target.value)}
                placeholder="Paste your README.md content here..."
                style={{
                  width: "100%", minHeight: 120, padding: 14, borderRadius: 10, border: `1px solid ${C.border}`,
                  background: C.surface, color: C.text, fontSize: 12.5, fontFamily: MONO, lineHeight: 1.6, resize: "vertical", marginTop: 8,
                }}
              />
            )}
          </div>
        )}

        {error && <div style={{ color: C.red, fontSize: 13, marginBottom: 12, fontFamily: MONO }}>{error}</div>}

        <Btn primary onClick={handleMap} style={{ width: "100%", justifyContent: "center", padding: "12px 20px", fontSize: 14, fontWeight: 600 }}>
          <MapPinIcon /> Map It
        </Btn>
      </div>
    </div>
  );
}

// ─── Treemap View ───
function TreemapView({ tree, basePath, readme, snippets, onReset }) {
  const [path, setPath] = useState([]);
  const [search, setSearch] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [treeState, setTreeState] = useState(tree);
  const [toast, setToast] = useState(null);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [aiJsonInput, setAiJsonInput] = useState("");
  const [textSize, setTextSize] = useState("medium");
  const [plainEnglish, setPlainEnglish] = useState(true);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 500 });
  const searchRef = useRef(null);
  const containerRef = useRef(null);

  const sz = TEXT_SIZES[textSize];
  const allItems = useMemo(() => flattenItems(treeState), [treeState]);
  const results = useMemo(() => searchItems(allItems, search), [allItems, search]);
  const showResults = search.trim().length > 0;

  const node = path.length === 0 ? treeState : getNodeAtPath(treeState, path);
  const counts = useMemo(() => countItems(treeState), [treeState]);

  // Measure the treemap container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setContainerSize({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Build treemap items from current node
  const treemapItems = useMemo(() => {
    if (!node) return [];
    const items = [];
    (node.children || []).forEach((c, i) => {
      items.push({ type: "dir", node: c, name: c.name, value: totalWeight(c), index: i });
    });
    (node.files || []).forEach((f, i) => {
      items.push({ type: "file", node: f, name: f.name, value: 1, index: i });
    });
    return items;
  }, [node]);

  // Compute the treemap layout
  const GAP = 3;
  const treemapLayout = useMemo(() => {
    if (treemapItems.length === 0) return [];
    const padded = { x: GAP, y: GAP, w: containerSize.w - GAP * 2, h: containerSize.h - GAP * 2 };
    if (padded.w <= 0 || padded.h <= 0) return [];
    return computeTreemap(treemapItems, padded);
  }, [treemapItems, containerSize]);

  const vscodeUri = useCallback((filePath) => {
    if (!basePath) return null;
    const clean = basePath.replace(/\/$/, "");
    const parts = filePath.split("/");
    if (parts[0] === treeState.name) parts.shift();
    return `vscode://file/${clean}/${parts.join("/")}`;
  }, [basePath, treeState.name]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 6000);
  }

  async function handleCopyPrompt() {
    const prompt = buildPromptForTree(treeState, readme, plainEnglish);
    try {
      await navigator.clipboard.writeText(prompt);
      showToast("success", "Prompt copied! Paste it into a Claude chat, then paste the JSON response back here.");
      setShowAIPanel(true);
    } catch {
      setAiJsonInput(prompt);
      setShowAIPanel(true);
      showToast("warn", "Couldn't auto-copy. Select the prompt text manually.");
    }
  }

  function handleApplyAIJson() {
    try {
      const descs = parseAIDescriptions(aiJsonInput);
      const count = Object.keys(descs).length;
      if (count === 0) { showToast("error", "Parsed JSON but found 0 descriptions."); return; }
      const updated = JSON.parse(JSON.stringify(treeState));
      applyDescriptions(updated, descs);
      setTreeState(updated);
      showToast("success", `Applied ${count} AI descriptions!`);
      setShowAIPanel(false);
      setAiJsonInput("");
    } catch (err) { showToast("error", `Invalid JSON: ${err.message}`); }
  }

  function handleExport() {
    const data = JSON.stringify({ tree: treeState, basePath, readme, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = ".grimoire.json"; a.click();
    URL.revokeObjectURL(url);
  }

  function handleResultClick(item) {
    const parts = item.parentPath?.split("/").filter(Boolean) || [];
    if (parts[0] === treeState.name) parts.shift();
    setPath(parts);
    setSearch("");
  }

  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "Escape") { setSearch(""); searchRef.current?.blur(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text, fontFamily: SANS, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
        @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        ::placeholder { color: ${C.textMuted}; }
      `}</style>

      {/* ─── Header ─── */}
      <div style={{
        borderBottom: `1px solid ${C.border}`, padding: "8px 16px",
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        background: "rgba(17,24,39,0.85)", backdropFilter: "blur(12px)", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => setPath([])}>
          <MapPinIcon />
          <span style={{ fontSize: sz.header, fontWeight: 700, fontFamily: MONO, letterSpacing: -0.5 }}>{treeState.name}</span>
          <span style={{ fontSize: 11, color: C.textMuted, fontFamily: MONO }}>{counts.dirs}d \u00B7 {counts.files}f</span>
        </div>

        {/* Search */}
        <div style={{ flex: 1, maxWidth: 380, marginLeft: "auto", position: "relative" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, background: C.surface,
            border: `1px solid ${searchFocus ? C.borderHover : C.border}`, borderRadius: 8, padding: "5px 10px",
            boxShadow: searchFocus ? `0 0 0 3px ${C.accentGlow}` : "none", transition: "0.2s",
          }}>
            <SearchIcon />
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              onFocus={() => setSearchFocus(true)} onBlur={() => setTimeout(() => setSearchFocus(false), 150)}
              placeholder="Where do I change the..."
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: C.text, fontSize: 12, fontFamily: MONO }}
            />
            <span style={{ fontSize: 10, color: C.textMuted, padding: "1px 5px", background: C.tag, borderRadius: 3, fontFamily: MONO }}>\u2318K</span>
          </div>
          {showResults && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 6,
              boxShadow: "0 12px 40px rgba(0,0,0,0.5)", maxHeight: 380, overflowY: "auto", zIndex: 20,
            }}>
              {results.length === 0 ? (
                <div style={{ padding: 14, textAlign: "center", color: C.textMuted, fontSize: 12 }}>No matches</div>
              ) : results.map((item, i) => (
                <button key={i} onClick={() => handleResultClick(item)} style={{
                  display: "flex", gap: 8, padding: "8px 10px", width: "100%", background: "transparent",
                  border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left",
                }}>
                  <div style={{ paddingTop: 1, flexShrink: 0 }}>{item.type === "file" ? <FileIcon size={13} /> : <FolderIcon size={13} />}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: MONO }}>{item.name}</span>
                    <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.3 }}>{item.purpose || item.description}</div>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: MONO }}>{item.path}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6 }}>
          <Btn small onClick={handleCopyPrompt}><SparkleIcon /> AI</Btn>
          <Btn small onClick={handleExport}><DownloadIcon /></Btn>
          <Btn small onClick={onReset} style={{ color: C.textMuted }}>New</Btn>
        </div>
      </div>

      {/* ─── Breadcrumb ─── */}
      <div style={{
        padding: "6px 16px", display: "flex", alignItems: "center", gap: 8,
        borderBottom: `1px solid ${C.border}`, background: "rgba(17,24,39,0.5)", flexShrink: 0,
      }}>
        {path.length > 0 && (
          <button onClick={() => setPath(path.slice(0, -1))} style={{
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 7px",
            cursor: "pointer", display: "flex", alignItems: "center",
          }}><BackIcon /></button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <BreadBtn label="root" active={path.length === 0} onClick={() => setPath([])} />
          {path.map((p, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <ChevronRight />
              <BreadBtn label={p} active={i === path.length - 1} onClick={() => setPath(path.slice(0, i + 1))} />
            </span>
          ))}
        </div>
        {node && (
          <span style={{ marginLeft: 12, fontSize: sz.desc, color: C.aiDesc, fontStyle: "italic", opacity: 0.8 }}>
            {node.description || ""}
          </span>
        )}
      </div>

      {/* ─── Treemap Canvas ─── */}
      <div ref={containerRef} style={{
        flex: 1, position: "relative", overflow: "hidden",
        background: `radial-gradient(circle at 50% 50%, #0f1520 0%, ${C.bg} 100%)`,
      }}>
        {/* Subtle grid background */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.04,
          backgroundImage: `radial-gradient(${C.textMuted} 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
          pointerEvents: "none",
        }} />

        {treemapLayout.length === 0 && node && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted }}>
            This directory is empty
          </div>
        )}

        {treemapLayout.map((item) => {
          const { layout: L } = item;
          const PAD = 2;
          const style = {
            position: "absolute",
            left: L.x + PAD,
            top: L.y + PAD,
            width: Math.max(L.w - PAD * 2, 0),
            height: Math.max(L.h - PAD * 2, 0),
          };

          if (item.type === "dir") {
            return (
              <DirCell
                key={`d-${item.name}`}
                item={item} style={style} sz={sz}
                onClick={() => setPath([...path, item.name])}
                onHover={setHoveredCell}
              />
            );
          }
          const fp = [treeState.name, ...path, item.name].join("/");
          return (
            <FileCell
              key={`f-${item.name}`}
              item={item} style={style} sz={sz}
              vscodeUri={vscodeUri(fp)}
              snippet={snippets?.[fp]}
              onHover={setHoveredCell}
            />
          );
        })}

        {/* Hover tooltip */}
        {hoveredCell && (
          <HoverTooltip cell={hoveredCell} sz={sz} containerSize={containerSize} />
        )}
      </div>

      {/* Floating Toolbar */}
      <FloatingToolbar textSize={textSize} setTextSize={setTextSize} plainEnglish={plainEnglish} setPlainEnglish={setPlainEnglish} />

      {/* AI paste panel */}
      {showAIPanel && (
        <div style={{
          position: "fixed", bottom: 70, right: 16, width: 420,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)", zIndex: 40, overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 14px", borderBottom: `1px solid ${C.border}`, background: C.bg,
          }}>
            <span style={{ color: C.text, fontWeight: 600, fontSize: 12, fontFamily: MONO }}>
              <SparkleIcon /> Paste AI Descriptions {plainEnglish ? "(Plain English)" : "(Technical)"}
            </span>
            <button onClick={() => setShowAIPanel(false)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 16 }}>\u00D7</button>
          </div>
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, lineHeight: 1.5 }}>
              <strong style={{ color: C.accent }}>1.</strong> Prompt copied to clipboard. Paste into Claude.
              <br /><strong style={{ color: C.accent }}>2.</strong> Paste the JSON response below.
            </div>
            <textarea value={aiJsonInput} onChange={e => setAiJsonInput(e.target.value)}
              placeholder='{"path": "description", ...}'
              style={{
                width: "100%", minHeight: 100, padding: 8, borderRadius: 8,
                border: `1px solid ${C.border}`, background: C.bg, color: C.text,
                fontSize: 11, fontFamily: MONO, lineHeight: 1.5, resize: "vertical",
              }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <Btn primary onClick={handleApplyAIJson} style={{ flex: 1, justifyContent: "center" }}>Apply</Btn>
              <Btn small onClick={handleCopyPrompt}>Re-copy</Btn>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 70, left: "50%", transform: "translateX(-50%)",
          padding: "10px 18px", borderRadius: 10, display: "flex", alignItems: "center", gap: 8,
          fontFamily: MONO, fontSize: 12, zIndex: 50, animation: "fadeSlideIn 0.3s ease",
          background: toast.type === "success" ? C.greenDim : toast.type === "error" ? C.redDim : C.surface,
          color: toast.type === "success" ? C.green : toast.type === "error" ? C.red : C.yellow,
          border: `1px solid ${toast.type === "success" ? C.green + "40" : toast.type === "error" ? C.red + "40" : C.yellow + "40"}`,
          boxShadow: "0 8px 30px rgba(0,0,0,0.4)", maxWidth: 480,
        }}>
          <span>{toast.type === "success" ? "\u2713" : toast.type === "error" ? "\u2717" : "\u26A0"}</span>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "0 0 0 6px", fontSize: 14, lineHeight: 1 }}>\u00D7</button>
        </div>
      )}
    </div>
  );
}

// ─── Directory Cell ───
function DirCell({ item, style: posStyle, sz, onClick, onHover }) {
  const [h, setH] = useState(false);
  const { node, index } = item;
  const palette = DIR_PALETTE[index % DIR_PALETTE.length];
  const { files: fc, dirs: dc } = countItems(node);
  const W = posStyle.width;
  const H = posStyle.height;
  const isSmall = W < 80 || H < 50;
  const isTiny = W < 45 || H < 30;
  const headerH = isTiny ? 0 : isSmall ? 22 : 28;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => {
        setH(true);
        onHover({ type: "dir", node, x: posStyle.left + W / 2, y: posStyle.top, name: node.name, desc: node.description });
      }}
      onMouseLeave={() => { setH(false); onHover(null); }}
      style={{
        ...posStyle, borderRadius: 8, overflow: "hidden", cursor: "pointer",
        border: `1.5px solid ${h ? palette.accent + "90" : palette.border}`,
        background: h ? palette.header : palette.bg,
        transition: "all 0.15s",
        boxShadow: h ? `0 0 20px ${palette.accent}25, inset 0 0 30px ${palette.accent}08` : "none",
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Header */}
      {!isTiny && (
        <div style={{
          height: headerH, padding: isSmall ? "2px 6px" : "4px 10px",
          background: palette.header, borderBottom: `1px solid ${palette.border}40`,
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0, overflow: "hidden",
        }}>
          <FolderIcon size={isSmall ? 12 : 14} color={palette.accent} />
          <span style={{
            fontSize: sz.cellName, fontWeight: 700, color: palette.accent,
            fontFamily: MONO, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>{node.name}/</span>
          {W > 120 && (
            <span style={{ marginLeft: "auto", fontSize: 9, color: C.textMuted, fontFamily: MONO, flexShrink: 0 }}>
              {dc > 0 && `${dc}d`}{dc > 0 && fc > 0 && " \u00B7 "}{fc > 0 && `${fc}f`}
            </span>
          )}
        </div>
      )}

      {/* Body — mini preview of children */}
      {!isTiny && H > 60 && (
        <div style={{ flex: 1, padding: isSmall ? 4 : 8, overflow: "hidden" }}>
          {W > 100 && node.description && (
            <div style={{
              fontSize: sz.cellDesc, color: C.aiDesc, lineHeight: 1.3, marginBottom: 4,
              overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>{node.description}</div>
          )}
          {/* Mini child chips */}
          {H > 90 && W > 110 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 2, overflow: "hidden", maxHeight: H - headerH - 40 }}>
              {(node.children || []).slice(0, 6).map(c => (
                <span key={c.name} style={{
                  fontSize: 9, fontFamily: MONO, padding: "1px 5px", borderRadius: 4,
                  background: palette.border + "50", color: palette.accent, whiteSpace: "nowrap",
                }}>{c.name}/</span>
              ))}
              {(node.files || []).slice(0, 4).map(f => (
                <span key={f.name} style={{
                  fontSize: 9, fontFamily: MONO, padding: "1px 5px", borderRadius: 4,
                  background: "#1a1a2e50", color: C.file, whiteSpace: "nowrap", opacity: 0.7,
                }}>{f.name}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tiny fallback — just colored box */}
      {isTiny && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <FolderIcon size={10} color={palette.accent} />
        </div>
      )}

      {/* Zoom hint on hover */}
      {h && !isTiny && (
        <div style={{
          position: "absolute", bottom: 4, right: 6, display: "flex", alignItems: "center", gap: 3,
          fontSize: 9, color: palette.accent, fontFamily: MONO, opacity: 0.7,
        }}>
          <ZoomInIcon /> click to explore
        </div>
      )}
    </div>
  );
}

// ─── File Cell ───
function FileCell({ item, style: posStyle, sz, vscodeUri, snippet, onHover }) {
  const [h, setH] = useState(false);
  const { node: file } = item;
  const W = posStyle.width;
  const H = posStyle.height;
  const isTiny = W < 50 || H < 28;
  const isSmall = W < 100 || H < 45;

  return (
    <div
      onMouseEnter={() => {
        setH(true);
        onHover({ type: "file", node: file, x: posStyle.left + W / 2, y: posStyle.top, name: file.name, desc: file.purpose, tags: file.tags, snippet });
      }}
      onMouseLeave={() => { setH(false); onHover(null); }}
      style={{
        ...posStyle, borderRadius: 6, overflow: "hidden",
        border: `1px solid ${h ? C.borderHover : C.border}`,
        background: h ? C.surfaceHover : C.surface,
        transition: "all 0.15s", cursor: vscodeUri ? "pointer" : "default",
        display: "flex", flexDirection: "column", padding: isTiny ? 2 : isSmall ? 4 : 8,
      }}
      onClick={() => { if (vscodeUri) window.open(vscodeUri, "_blank"); }}
    >
      {/* File name */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4, overflow: "hidden", flexShrink: 0,
      }}>
        {!isTiny && <FileIcon size={isSmall ? 10 : 13} />}
        <span style={{
          fontSize: isTiny ? 8 : sz.cellName, fontWeight: 600, color: C.text, fontFamily: MONO,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{file.name}</span>
      </div>

      {/* Description */}
      {!isSmall && H > 40 && file.purpose && file.purpose !== "\u2014" && (
        <div style={{
          fontSize: sz.cellDesc, color: C.aiDesc, lineHeight: 1.3, marginTop: 3,
          overflow: "hidden", display: "-webkit-box", WebkitLineClamp: Math.floor((H - 30) / 14), WebkitBoxOrient: "vertical",
        }}>{file.purpose}</div>
      )}

      {/* Tags */}
      {!isSmall && H > 55 && file.tags?.length > 0 && W > 80 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, marginTop: "auto", paddingTop: 3 }}>
          {file.tags.slice(0, 3).map(t => <Tag key={t} label={t} sz={sz.tag} />)}
        </div>
      )}

      {/* VS Code link on hover */}
      {h && vscodeUri && !isTiny && (
        <div style={{
          position: "absolute", top: 3, right: 5, fontSize: 9, color: C.accent,
          fontFamily: MONO, display: "flex", alignItems: "center", gap: 2,
        }}>
          <ExternalIcon /> open
        </div>
      )}
    </div>
  );
}

// ─── Hover Tooltip ───
function HoverTooltip({ cell, sz, containerSize }) {
  const tooltipW = 300;
  const tooltipH = cell.snippet ? 200 : cell.desc ? 100 : 60;
  let left = cell.x - tooltipW / 2;
  let top = cell.y - tooltipH - 10;
  if (left < 10) left = 10;
  if (left + tooltipW > containerSize.w - 10) left = containerSize.w - tooltipW - 10;
  if (top < 10) top = cell.y + 40;

  return (
    <div style={{
      position: "absolute", left, top, width: tooltipW, maxHeight: tooltipH,
      background: "rgba(17,24,39,0.96)", border: `1px solid ${C.borderHover}`,
      borderRadius: 10, padding: 12, boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
      zIndex: 30, pointerEvents: "none", overflow: "hidden",
      animation: "fadeSlideIn 0.15s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        {cell.type === "dir" ? <FolderIcon size={14} /> : <FileIcon size={13} />}
        <span style={{ fontSize: sz.name, fontWeight: 700, color: C.text, fontFamily: MONO }}>{cell.name}</span>
      </div>
      {cell.desc && cell.desc !== "\u2014" && (
        <div style={{ fontSize: sz.desc, color: C.aiDesc, lineHeight: 1.5, marginBottom: 4 }}>
          {cell.desc}
        </div>
      )}
      {cell.tags?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 4 }}>
          {cell.tags.map(t => <Tag key={t} label={t} sz={sz.tag} />)}
        </div>
      )}
      {cell.snippet && (
        <pre style={{
          fontSize: 10, fontFamily: MONO, color: C.textDim, lineHeight: 1.4,
          background: C.bg, borderRadius: 6, padding: 8, margin: 0,
          overflow: "hidden", maxHeight: 80, whiteSpace: "pre", tabSize: 2,
        }}>{cell.snippet.split("\n").slice(0, 6).join("\n")}</pre>
      )}
    </div>
  );
}

// ─── Breadcrumb Button ───
function BreadBtn({ label, active, onClick }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: "none", border: "none", color: active || h ? C.accent : C.textDim,
        cursor: "pointer", fontSize: 12, fontFamily: MONO, padding: "2px 3px",
        borderRadius: 3, fontWeight: active ? 600 : 400,
      }}>
      {label}
    </button>
  );
}

// ─── Root ───
export default function App() {
  const [state, setState] = useState({ phase: "import", tree: null, basePath: "", readme: "", snippets: null });

  if (state.phase === "import") {
    return <ImportScreen onImport={(tree, basePath, readme, snippets) => setState({ phase: "map", tree, basePath, readme, snippets })} />;
  }
  return (
    <TreemapView
      tree={state.tree} basePath={state.basePath} readme={state.readme} snippets={state.snippets}
      onReset={() => setState({ phase: "import", tree: null, basePath: "", readme: "", snippets: null })}
    />
  );
}
