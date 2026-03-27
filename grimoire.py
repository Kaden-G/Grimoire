#!/usr/bin/env python3
"""
Grimoire — CLI
Walks a project directory, generates AI-powered descriptions for every file
and folder, and outputs a .grimoire.json for the Grimoire UI.

Usage:
    python grimoire.py /path/to/your/project
    python grimoire.py /path/to/your/project --key sk-ant-...
    python grimoire.py /path/to/your/project --batch-size 30 --model claude-sonnet-4-20250514

The tool will:
  1. Walk the directory tree (respecting .gitignore-style exclusions)
  2. Read README.md if present for project context
  3. Apply heuristic descriptions based on file/folder naming conventions
  4. Call the Claude API to generate context-aware descriptions
  5. Save .grimoire.json in the project root
"""

import os
import sys
import json
import argparse
import time
import re
from pathlib import Path

try:
    import anthropic
    HAS_SDK = True
except ImportError:
    HAS_SDK = False
    try:
        import urllib.request
        import urllib.error
    except ImportError:
        pass

# ─── Default exclusions ───
DEFAULT_EXCLUDE = {
    "node_modules", ".git", "__pycache__", ".next", ".nuxt", "dist", "build",
    ".cache", ".vscode", ".idea", "coverage", ".pytest_cache", ".mypy_cache",
    "venv", ".venv", "env", ".env", ".tox", "htmlcov", ".eggs", "*.egg-info",
    ".DS_Store", "Thumbs.db", ".terraform", "vendor", "target",
}

# ─── Heuristic descriptions ───
FILE_EXACT = {
    "package.json": "Project dependencies, scripts, and metadata",
    "package-lock.json": "Locked dependency versions (auto-generated)",
    "yarn.lock": "Locked dependency versions (auto-generated)",
    "tsconfig.json": "TypeScript compiler configuration",
    "jsconfig.json": "JavaScript project config and path aliases",
    "README.md": "Project documentation and setup guide",
    "readme.md": "Project documentation and setup guide",
    "LICENSE": "Software license terms",
    ".gitignore": "Files excluded from version control",
    ".eslintrc.js": "ESLint linting rules",
    ".eslintrc.json": "ESLint linting rules",
    ".prettierrc": "Prettier formatting config",
    "Dockerfile": "Container image build instructions",
    "docker-compose.yml": "Multi-container orchestration config",
    "docker-compose.yaml": "Multi-container orchestration config",
    "Makefile": "Build automation commands",
    ".env": "Environment variables (secrets, config)",
    ".env.example": "Template for required environment variables",
    ".env.local": "Local environment overrides",
    "vite.config.ts": "Vite bundler configuration",
    "vite.config.js": "Vite bundler configuration",
    "webpack.config.js": "Webpack bundler configuration",
    "next.config.js": "Next.js framework configuration",
    "next.config.mjs": "Next.js framework configuration",
    "tailwind.config.js": "Tailwind CSS theme and plugin config",
    "tailwind.config.ts": "Tailwind CSS theme and plugin config",
    "jest.config.js": "Jest test runner configuration",
    "jest.config.ts": "Jest test runner configuration",
    "vitest.config.ts": "Vitest test runner configuration",
    "requirements.txt": "Python package dependencies",
    "setup.py": "Python package setup and metadata",
    "pyproject.toml": "Python project config and dependencies",
    "Pipfile": "Python dependencies (Pipenv)",
    "Cargo.toml": "Rust project dependencies and metadata",
    "go.mod": "Go module dependencies",
    "Gemfile": "Ruby gem dependencies",
    "composer.json": "PHP package dependencies",
    "prefect.yaml": "Prefect workflow orchestration config",
    "dbt_project.yml": "dbt data transformation project config",
}

FILE_PATTERNS = [
    (r"\.test\.[jt]sx?$", lambda n: f"Unit tests for {re.sub(r'.test.[jt]sx?$', '', n)}"),
    (r"\.spec\.[jt]sx?$", lambda n: f"Test spec for {re.sub(r'.spec.[jt]sx?$', '', n)}"),
    (r"\.stories\.[jt]sx?$", lambda n: f"Storybook stories for {re.sub(r'.stories.[jt]sx?$', '', n)}"),
    (r"\.module\.s?css$", lambda n: f"Scoped styles for {re.sub(r'.module.s?css$', '', n)}"),
    (r"\.d\.ts$", lambda _: "TypeScript type declarations"),
    (r"^use[A-Z].*\.[jt]sx?$", lambda n: f"Custom React hook: {re.sub(r'.[jt]sx?$', '', n)}"),
    (r"^[A-Z][a-zA-Z]+\.[jt]sx$", lambda n: f"React component: {re.sub(r'.[jt]sx$', '', n)}"),
    (r"^[A-Z][a-zA-Z]+\.vue$", lambda n: f"Vue component: {re.sub(r'.vue$', '', n)}"),
    (r"index\.[jt]sx?$", lambda _: "Module entry point / barrel exports"),
    (r"types?\.[jt]s$", lambda _: "TypeScript type definitions"),
    (r"constants?\.[jt]s$", lambda _: "Shared constant values"),
    (r"config\.[jt]s$", lambda _: "Module configuration"),
    (r"utils?\.[jt]sx?$", lambda _: "Utility / helper functions"),
    (r"middleware\.[jt]s$", lambda _: "Request/response middleware"),
    (r"schema\.[jt]s$", lambda _: "Data validation schema"),
    (r"\.sql$", lambda _: "SQL query or migration"),
    (r"\.sh$", lambda _: "Shell script"),
    (r"\.py$", lambda n: f"Python module: {re.sub(r'.py$', '', n)}"),
    (r"\.rs$", lambda n: f"Rust module: {re.sub(r'.rs$', '', n)}"),
    (r"\.go$", lambda _: "Go source file"),
    (r"\.css$", lambda _: "Stylesheet"),
    (r"\.scss$", lambda _: "SCSS stylesheet"),
    (r"\.svg$", lambda _: "SVG vector graphic"),
    (r"\.(png|jpg|jpeg|gif|webp)$", lambda _: "Image asset"),
    (r"\.json$", lambda n: f"JSON data: {re.sub(r'.json$', '', n)}"),
    (r"\.ya?ml$", lambda n: f"YAML config: {re.sub(r'.ya?ml$', '', n)}"),
    (r"\.md$", lambda n: f"Documentation: {re.sub(r'.md$', '', n)}"),
]

DIR_HEURISTICS = {
    "src": "Application source code",
    "lib": "Shared library code",
    "dist": "Compiled build output",
    "build": "Build output",
    "public": "Static assets served directly",
    "static": "Static files",
    "assets": "Media, images, fonts, and other assets",
    "components": "Reusable UI components",
    "pages": "Page-level route components",
    "views": "View/page templates",
    "layouts": "Layout wrapper components",
    "hooks": "Custom React hooks",
    "utils": "Utility functions",
    "helpers": "Helper functions",
    "services": "API and service layer",
    "api": "API routes or client code",
    "routes": "Route definitions",
    "router": "Routing configuration",
    "controllers": "Request handler logic",
    "middleware": "Middleware functions",
    "models": "Data models and schemas",
    "schemas": "Validation/data schemas",
    "types": "TypeScript type definitions",
    "store": "State management",
    "state": "State management",
    "stores": "State management stores",
    "config": "Configuration files",
    "constants": "Constant values",
    "styles": "Stylesheets",
    "tests": "Test files",
    "test": "Test files",
    "__tests__": "Test files",
    "e2e": "End-to-end tests",
    "scripts": "Build and utility scripts",
    "docs": "Documentation",
    "migrations": "Database migrations",
    "seeds": "Database seed data",
    "prisma": "Prisma ORM schema and migrations",
    "db": "Database related files",
    "templates": "Template files",
    "i18n": "Internationalization/translation files",
    "locales": "Locale/translation files",
    "auth": "Authentication logic",
    "features": "Feature modules",
    "modules": "Application modules",
    "shared": "Shared/common code",
    "common": "Common/shared utilities",
    "core": "Core application logic",
    ".github": "GitHub config (Actions, templates, etc.)",
}


def get_heuristic(name: str, is_dir: bool) -> str | None:
    if is_dir:
        return DIR_HEURISTICS.get(name)
    if name in FILE_EXACT:
        return FILE_EXACT[name]
    for pattern, fn in FILE_PATTERNS:
        if re.search(pattern, name):
            return fn(name)
    return None


def guess_tags(name: str) -> list[str]:
    tags = []
    if re.search(r"\.test\.|\.spec\.", name): tags.append("test")
    if re.search(r"\.[jt]sx$", name): tags.append("react")
    if name.endswith(".vue"): tags.append("vue")
    if name.endswith(".py"): tags.append("python")
    if name.endswith(".rs"): tags.append("rust")
    if name.endswith(".go"): tags.append("go")
    if re.search(r"\.s?css$", name): tags.append("styles")
    if "config" in name.lower(): tags.append("config")
    if name.endswith(".sql"): tags.append("sql")
    if re.search(r"\.ya?ml$", name): tags.append("yaml")
    if name.endswith(".md"): tags.append("docs")
    return tags


# ─── Import-based tag inference ───
# Maps import patterns → semantic tags. Each entry is (regex_pattern, tag).
# Patterns match against the raw import text from file headers.
IMPORT_TAG_RULES = [
    # ── Frameworks ──
    (r"""(?:from\s+['"]react|import\s+.*\breact\b|require\(['"]react)""", "react"),
    (r"""(?:from\s+['"]vue|import\s+.*\bvue\b|require\(['"]vue)""", "vue"),
    (r"""(?:from\s+['"]svelte|import\s+.*\bsvelte\b)""", "svelte"),
    (r"""(?:from\s+['"]next[/'"]|import\s+.*\bnext\b)""", "nextjs"),
    (r"""(?:from\s+['"]nuxt|import\s+.*\bnuxt\b)""", "nuxt"),
    (r"""(?:from\s+['"]angular|import\s+.*@angular)""", "angular"),
    (r"""(?:from\s+flask|import\s+flask)""", "flask"),
    (r"""(?:from\s+django|import\s+django)""", "django"),
    (r"""(?:from\s+fastapi|import\s+fastapi)""", "fastapi"),

    # ── API / HTTP ──
    (r"""(?:from\s+['"]express|require\(['"]express|import\s+express)""", "api"),
    (r"""(?:from\s+['"]axios|require\(['"]axios|import\s+axios)""", "api"),
    (r"""(?:from\s+['"]node-fetch|import\s+.*\bfetch\b)""", "api"),
    (r"""(?:import\s+requests|from\s+requests\b)""", "api"),
    (r"""(?:from\s+['"]@trpc|import\s+.*trpc)""", "api"),
    (r"""(?:from\s+['"]graphql|import\s+.*graphql|from\s+['"]@apollo)""", "graphql"),
    (r"""(?:from\s+['"]hono|import\s+.*\bHono\b)""", "api"),

    # ── Routing ──
    (r"""(?:from\s+['"]react-router|import\s+.*react-router)""", "routing"),
    (r"""(?:from\s+['"]@tanstack/react-router)""", "routing"),
    (r"""(?:from\s+['"]vue-router|import\s+.*vue-router)""", "routing"),

    # ── State management ──
    (r"""(?:from\s+['"]redux|import\s+.*redux|from\s+['"]@reduxjs)""", "state"),
    (r"""(?:from\s+['"]zustand|import\s+.*zustand)""", "state"),
    (r"""(?:from\s+['"]mobx|import\s+.*mobx)""", "state"),
    (r"""(?:from\s+['"]recoil|import\s+.*recoil)""", "state"),
    (r"""(?:from\s+['"]jotai|import\s+.*jotai)""", "state"),
    (r"""(?:from\s+['"]pinia|import\s+.*pinia)""", "state"),

    # ── Database / ORM ──
    (r"""(?:from\s+['"]prisma|import\s+.*@prisma)""", "database"),
    (r"""(?:from\s+['"]mongoose|import\s+.*mongoose|require\(['"]mongoose)""", "database"),
    (r"""(?:from\s+['"]sequelize|import\s+.*sequelize)""", "database"),
    (r"""(?:from\s+['"]typeorm|import\s+.*typeorm)""", "database"),
    (r"""(?:from\s+['"]drizzle|import\s+.*drizzle)""", "database"),
    (r"""(?:from\s+sqlalchemy|import\s+sqlalchemy)""", "database"),
    (r"""(?:import\s+sqlite3|from\s+sqlite3)""", "database"),
    (r"""(?:from\s+['"]knex|require\(['"]knex)""", "database"),
    (r"""(?:from\s+['"]redis|import\s+redis)""", "database"),

    # ── Auth ──
    (r"""(?:from\s+['"]jsonwebtoken|import\s+.*jwt|require\(['"]jsonwebtoken)""", "auth"),
    (r"""(?:from\s+['"]passport|require\(['"]passport)""", "auth"),
    (r"""(?:from\s+['"]next-auth|import\s+.*next-auth)""", "auth"),
    (r"""(?:from\s+['"]@auth0|import\s+.*auth0)""", "auth"),
    (r"""(?:from\s+['"]bcrypt|import\s+.*bcrypt|require\(['"]bcrypt)""", "auth"),
    (r"""(?:from\s+['"]@clerk|import\s+.*clerk)""", "auth"),

    # ── Testing ──
    (r"""(?:from\s+['"]jest|import\s+.*jest|require\(['"]jest)""", "test"),
    (r"""(?:from\s+['"]vitest|import\s+.*vitest)""", "test"),
    (r"""(?:from\s+['"]@testing-library|import\s+.*@testing-library)""", "test"),
    (r"""(?:from\s+['"]cypress|import\s+.*cypress)""", "test"),
    (r"""(?:from\s+['"]playwright|import\s+.*playwright)""", "test"),
    (r"""(?:import\s+pytest|from\s+pytest)""", "test"),
    (r"""(?:import\s+unittest|from\s+unittest)""", "test"),

    # ── AI / ML ──
    (r"""(?:from\s+['"]openai|import\s+openai)""", "ai"),
    (r"""(?:from\s+['"]anthropic|import\s+anthropic)""", "ai"),
    (r"""(?:from\s+['"]langchain|import\s+.*langchain)""", "ai"),
    (r"""(?:import\s+torch|from\s+torch)""", "ai"),
    (r"""(?:import\s+tensorflow|from\s+tensorflow)""", "ai"),
    (r"""(?:import\s+transformers|from\s+transformers)""", "ai"),
    (r"""(?:import\s+numpy|from\s+numpy)""", "data"),
    (r"""(?:import\s+pandas|from\s+pandas)""", "data"),
    (r"""(?:import\s+sklearn|from\s+sklearn)""", "ai"),

    # ── Styling ──
    (r"""(?:from\s+['"]tailwind|import\s+.*tailwind)""", "tailwind"),
    (r"""(?:from\s+['"]styled-components|import\s+styled)""", "styles"),
    (r"""(?:from\s+['"]@emotion|import\s+.*emotion)""", "styles"),
    (r"""(?:from\s+['"]@mui|import\s+.*@mui|from\s+['"]@material-ui)""", "ui-lib"),
    (r"""(?:from\s+['"]@chakra-ui|import\s+.*chakra)""", "ui-lib"),
    (r"""(?:from\s+['"]antd|import\s+.*\bantd\b)""", "ui-lib"),
    (r"""(?:from\s+['"]@shadcn|from\s+['"]@/components/ui)""", "ui-lib"),

    # ── DevOps / Infra ──
    (r"""(?:from\s+['"]aws-sdk|import\s+.*aws-sdk|from\s+['"]@aws-sdk)""", "aws"),
    (r"""(?:from\s+['"]@google-cloud|import\s+.*google\.cloud)""", "gcp"),
    (r"""(?:from\s+['"]@azure|import\s+.*azure)""", "azure"),
    (r"""(?:import\s+boto3|from\s+boto3)""", "aws"),
    (r"""(?:import\s+docker|from\s+docker)""", "docker"),

    # ── Validation / Schema ──
    (r"""(?:from\s+['"]zod|import\s+.*\bzod\b)""", "validation"),
    (r"""(?:from\s+['"]yup|import\s+.*\byup\b)""", "validation"),
    (r"""(?:from\s+['"]joi|require\(['"]joi)""", "validation"),
    (r"""(?:from\s+pydantic|import\s+pydantic)""", "validation"),

    # ── Logging / Monitoring ──
    (r"""(?:from\s+['"]winston|require\(['"]winston)""", "logging"),
    (r"""(?:from\s+['"]pino|require\(['"]pino)""", "logging"),
    (r"""(?:from\s+['"]@sentry|import\s+.*sentry)""", "monitoring"),
    (r"""(?:import\s+logging|from\s+logging)""", "logging"),

    # ── WebSocket / Realtime ──
    (r"""(?:from\s+['"]socket\.io|import\s+.*socket\.io|require\(['"]socket\.io)""", "websocket"),
    (r"""(?:from\s+['"]ws\b|require\(['"]ws['"]\))""", "websocket"),
]

# Pre-compile patterns for performance
_COMPILED_IMPORT_RULES = [(re.compile(pat, re.IGNORECASE), tag) for pat, tag in IMPORT_TAG_RULES]


def infer_tags_from_snippet(snippet: str) -> list[str]:
    """Analyze a code snippet's imports/requires to infer semantic tags."""
    if not snippet:
        return []

    tags = set()
    for pattern, tag in _COMPILED_IMPORT_RULES:
        if pattern.search(snippet):
            tags.add(tag)

    return sorted(tags)


# ─── File header scanning ───
# Extensions we'll try to read the first N lines from
SCANNABLE_EXTENSIONS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".rs", ".go", ".java", ".c", ".cpp",
    ".h", ".hpp", ".cs", ".rb", ".php", ".swift", ".kt", ".scala", ".vue",
    ".svelte", ".sh", ".bash", ".zsh", ".sql", ".r", ".R", ".lua", ".zig",
    ".ex", ".exs", ".erl", ".hs", ".ml", ".clj", ".dart", ".tf", ".hcl",
}

# Binary/large file extensions we should never try to read
BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".bmp",
    ".mp3", ".mp4", ".wav", ".mov", ".avi", ".mkv", ".flac",
    ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".pptx",
    ".exe", ".dll", ".so", ".dylib", ".pyc", ".pyo",
    ".lock", ".map",
}

MAX_SCAN_LINES = 40
MAX_SCAN_BYTES = 4096  # Don't read more than 4KB per file


def scan_file_header(file_path: Path) -> str | None:
    """Read the first N lines of a file for context (imports, classes, docstrings)."""
    ext = file_path.suffix.lower()

    # Skip binary/non-code files
    if ext in BINARY_EXTENSIONS:
        return None

    # Only scan known code extensions + config files
    if ext not in SCANNABLE_EXTENSIONS and file_path.name not in FILE_EXACT:
        return None

    try:
        with open(file_path, "r", errors="replace") as f:
            content = f.read(MAX_SCAN_BYTES)
        lines = content.split("\n")[:MAX_SCAN_LINES]
        snippet = "\n".join(lines).strip()
        return snippet if snippet else None
    except (PermissionError, OSError):
        return None


def should_exclude(name: str, excludes: set) -> bool:
    if name in excludes:
        return True
    if name.startswith(".") and name not in (".github", ".env.example"):
        return True
    return False


# ─── Directory walking ───
def walk_directory(root_path: Path, excludes: set, scan_headers: bool = True) -> dict:
    root_name = root_path.name
    tree = {
        "name": root_name,
        "description": get_heuristic(root_name, True) or "Project root",
        "children": [],
        "files": [],
    }

    try:
        entries = sorted(root_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return tree

    for entry in entries:
        if should_exclude(entry.name, excludes):
            continue

        if entry.is_dir():
            child = walk_directory(entry, excludes, scan_headers=scan_headers)
            if child.get("children") or child.get("files"):  # skip empty dirs
                tree["children"].append(child)
        elif entry.is_file():
            ext_tags = guess_tags(entry.name)
            file_info = {
                "name": entry.name,
                "purpose": get_heuristic(entry.name, False) or "—",
                "tags": ext_tags,
            }
            if scan_headers:
                snippet = scan_file_header(entry)
                if snippet:
                    file_info["snippet"] = snippet
                    # Infer additional tags from imports in the code
                    import_tags = infer_tags_from_snippet(snippet)
                    if import_tags:
                        # Merge without duplicates, extension tags first
                        merged = list(dict.fromkeys(ext_tags + import_tags))
                        file_info["tags"] = merged
            tree["files"].append(file_info)

    # Clean empties
    if not tree["children"]:
        del tree["children"]
    if not tree["files"]:
        del tree["files"]

    return tree


def collect_paths(node: dict, prefix: str = "") -> list[str]:
    paths = []
    cur = f"{prefix}/{node['name']}" if prefix else node["name"]
    paths.append(cur)
    for f in node.get("files", []):
        paths.append(f"{cur}/{f['name']}")
    for c in node.get("children", []):
        paths.extend(collect_paths(c, cur))
    return paths


def collect_snippets(node: dict, prefix: str = "") -> dict[str, str]:
    """Collect file path → snippet mapping from the tree."""
    snippets = {}
    cur = f"{prefix}/{node['name']}" if prefix else node["name"]
    for f in node.get("files", []):
        if f.get("snippet"):
            snippets[f"{cur}/{f['name']}"] = f["snippet"]
    for c in node.get("children", []):
        snippets.update(collect_snippets(c, cur))
    return snippets


def count_inferred_tags(node: dict) -> int:
    """Count total number of import-inferred tags across all files."""
    count = 0
    ext_only_tags = {"test", "react", "vue", "svelte", "python", "rust", "go",
                     "styles", "config", "sql", "yaml", "docs"}
    for f in node.get("files", []):
        for tag in f.get("tags", []):
            if tag not in ext_only_tags:
                count += 1
    for c in node.get("children", []):
        count += count_inferred_tags(c)
    return count


def apply_descriptions(node: dict, descs: dict, prefix: str = "") -> int:
    count = 0
    cur = f"{prefix}/{node['name']}" if prefix else node["name"]
    if cur in descs:
        node["description"] = descs[cur]
        count += 1
    for f in node.get("files", []):
        fp = f"{cur}/{f['name']}"
        if fp in descs:
            f["purpose"] = descs[fp]
            count += 1
    for c in node.get("children", []):
        count += apply_descriptions(c, descs, cur)
    return count


# ─── API calls ───
def call_claude_sdk(client, paths: list[str], readme: str, model: str, snippets: dict = None, plain_english: bool = True) -> dict:
    """Call Claude using the official Python SDK."""
    prompt = build_prompt(paths, readme, snippets, plain_english=plain_english)
    message = client.messages.create(
        model=model,
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in message.content if hasattr(b, "text"))
    return parse_response(text)


def call_claude_http(api_key: str, paths: list[str], readme: str, model: str, snippets: dict = None, plain_english: bool = True) -> dict:
    """Call Claude using raw HTTP (no SDK needed)."""
    prompt = build_prompt(paths, readme, snippets, plain_english=plain_english)
    payload = json.dumps({
        "model": model,
        "max_tokens": 8192,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode())

    text = "".join(b.get("text", "") for b in data.get("content", []))
    return parse_response(text)


def build_prompt(paths: list[str], readme: str, snippets: dict = None, plain_english: bool = True) -> str:
    context = f" Project context: {readme[:1500]}" if readme else ""

    # Build path listing with inline code snippets where available
    if snippets:
        path_entries = []
        for p in paths:
            if p in snippets:
                # Truncate snippet to ~6 lines for the prompt to keep batches within token limits
                snip_lines = snippets[p].split("\n")[:6]
                snip_preview = "\n".join(f"  | {line}" for line in snip_lines)
                path_entries.append(f"{p}\n{snip_preview}")
            else:
                path_entries.append(p)
        path_list = "\n".join(path_entries)
    else:
        path_list = "\n".join(paths)

    if plain_english:
        instructions = (
            f"Describe each file/directory path below in 15-25 words using plain, everyday English. "
            f"Write for someone who is NOT a professional developer. "
            f"NEVER use jargon like API, ORM, middleware, schema, endpoint, payload, serialization, JWT, "
            f"CRUD, REST, GraphQL, webhook, or similar technical terms. "
            f"Instead, describe what the file does in terms of its REAL-WORLD effect: "
            f"'checks that users are who they say they are' instead of 'JWT auth middleware', "
            f"'saves and retrieves user data from the database' instead of 'Prisma ORM client'. "
            f"Use the code snippets (indented with |) to understand the file's actual purpose.{context}"
        )
        example = '{"src/auth/middleware.ts": "Checks that someone is logged in before letting them access protected pages, using a secure token system"}'
    else:
        instructions = (
            f"Describe each file/directory path below in 15-25 words. "
            f"Be specific about what it DOES, not just what it IS. "
            f"Mention key technologies, patterns, and behaviors. "
            f"Use the code snippets (indented with |) to understand the file's actual purpose — "
            f"imports, classes, and functions reveal intent better than filenames alone.{context}"
        )
        example = '{"src/auth/middleware.ts": "Express middleware that validates JWT tokens from Authorization header and attaches decoded user payload to request object"}'

    return (
        f"{instructions}\n\n"
        f"Paths:\n{path_list}\n\n"
        f"Respond ONLY with a JSON object mapping each path to its description. "
        f"No markdown fences, no preamble.\n"
        f"Example: {example}"
    )


def parse_response(text: str) -> dict:
    clean = re.sub(r"```json|```", "", text).strip()
    return json.loads(clean)


def generate_descriptions(
    tree: dict,
    readme: str,
    api_key: str,
    model: str = "claude-sonnet-4-20250514",
    batch_size: int = 30,
    snippets: dict = None,
    plain_english: bool = True,
) -> dict:
    all_paths = collect_paths(tree)
    total = len(all_paths)
    mode_label = "plain English" if plain_english else "technical"
    print(f"\n🔍 Found {total} items to describe ({mode_label} mode)")

    if snippets:
        snip_count = sum(1 for p in all_paths if p in snippets)
        print(f"📝 File headers scanned: {snip_count} files have code snippets")

    # Batch (use smaller batches when snippets are present since prompts are larger)
    effective_batch = min(batch_size, 20) if snippets else batch_size
    batches = [all_paths[i:i + effective_batch] for i in range(0, total, effective_batch)]
    print(f"📦 Splitting into {len(batches)} batch(es) of up to {effective_batch}")

    all_descs = {}

    # Choose SDK or HTTP
    client = None
    if HAS_SDK:
        client = anthropic.Anthropic(api_key=api_key)
        print("🔗 Using anthropic SDK")
    else:
        print("🔗 Using raw HTTP (install `anthropic` package for SDK)")

    for i, batch in enumerate(batches):
        # Filter snippets to only those in this batch
        batch_snippets = {p: snippets[p] for p in batch if snippets and p in snippets} if snippets else None

        snip_info = f", {len(batch_snippets)} with code" if batch_snippets else ""
        print(f"\n  Batch {i + 1}/{len(batches)} ({len(batch)} items{snip_info})...", end=" ", flush=True)
        start = time.time()

        try:
            if client:
                descs = call_claude_sdk(client, batch, readme, model, snippets=batch_snippets, plain_english=plain_english)
            else:
                descs = call_claude_http(api_key, batch, readme, model, snippets=batch_snippets, plain_english=plain_english)

            elapsed = time.time() - start
            print(f"✅ {len(descs)} descriptions ({elapsed:.1f}s)")
            all_descs.update(descs)

        except json.JSONDecodeError as e:
            print(f"⚠️  JSON parse error: {e}")
        except Exception as e:
            print(f"❌ Error: {e}")

    return all_descs


# ─── Annotation Prompts ───

ANNOTATION_PROMPTS = {
    "tutor": (
        "You are a patient, encouraging coding tutor. Your job is to add inline comments to the following "
        "{language} file that TEACH the reader what the code does and WHY.\n\n"
        "RULES:\n"
        "- Add comments directly above or beside the relevant lines of code\n"
        "- Return the COMPLETE file with your comments added — do not remove or change ANY existing code\n"
        "- Do NOT wrap the output in markdown code fences\n"
        "- Do NOT add a preamble or explanation outside the code\n"
        "- Preserve ALL original formatting, indentation, and whitespace exactly\n"
        "- Keep existing comments intact; add yours as new lines\n\n"
        "COMMENTING STYLE — \"Tutor\":\n"
        "- Explain the PURPOSE and REASONING behind each section, not just what it does\n"
        "- Name design patterns when you see them\n"
        "- Explain non-obvious language features\n"
        "- Point out common gotchas or \"why it's done this way\" insights\n"
        "- Use a warm, conversational tone — like a senior developer pair-programming with a junior\n"
        "- For complex blocks, add a brief summary comment at the top explaining the overall goal\n"
        "- Aim for roughly 1 comment per 3-5 lines of code, more for complex sections\n"
        "- Use the comment syntax appropriate for {language}\n\n"
        "FILE: {filename}\n\n{code}"
    ),
    "minimal": (
        "Add concise inline comments to the following {language} file.\n\n"
        "RULES:\n"
        "- Add comments directly above or beside the relevant lines of code\n"
        "- Return the COMPLETE file with your comments added — do not remove or change ANY existing code\n"
        "- Do NOT wrap the output in markdown code fences\n"
        "- Do NOT add a preamble or explanation outside the code\n"
        "- Preserve ALL original formatting, indentation, and whitespace exactly\n"
        "- Keep existing comments intact; add yours as new lines\n\n"
        "COMMENTING STYLE — \"Minimal\":\n"
        "- One short line per logical section (5-10 words max per comment)\n"
        "- Only comment on non-obvious behavior — skip things that are self-evident\n"
        "- Think of these as signposts, not explanations\n"
        "- No prose, no teaching, just quick orientation landmarks\n"
        "- Use the comment syntax appropriate for {language}\n\n"
        "FILE: {filename}\n\n{code}"
    ),
    "technical": (
        "Add professional technical comments to the following {language} file following current best practices.\n\n"
        "RULES:\n"
        "- Add comments directly above or beside the relevant lines of code\n"
        "- Return the COMPLETE file with your comments added — do not remove or change ANY existing code\n"
        "- Do NOT wrap the output in markdown code fences\n"
        "- Do NOT add a preamble or explanation outside the code\n"
        "- Preserve ALL original formatting, indentation, and whitespace exactly\n"
        "- Keep existing comments intact; add yours as new lines\n\n"
        "COMMENTING STYLE — \"Technical\":\n"
        "- Use precise technical terminology (name patterns, algorithms, data structures)\n"
        "- Note time/space complexity for non-trivial operations\n"
        "- Flag potential edge cases, race conditions, or error-handling gaps\n"
        "- Reference relevant standards, protocols, or conventions\n"
        "- Document function signatures with @param/@returns style where missing\n"
        "- Mention thread safety, immutability, or side effects where relevant\n"
        "- Use the comment syntax appropriate for {language}\n\n"
        "FILE: {filename}\n\n{code}"
    ),
    "non-technical": (
        "Add plain-English comments to the following {language} file for a NON-TECHNICAL reader.\n\n"
        "RULES:\n"
        "- Add comments directly above or beside the relevant lines of code\n"
        "- Return the COMPLETE file with your comments added — do not remove or change ANY existing code\n"
        "- Do NOT wrap the output in markdown code fences\n"
        "- Do NOT add a preamble or explanation outside the code\n"
        "- Preserve ALL original formatting, indentation, and whitespace exactly\n"
        "- Keep existing comments intact; add yours as new lines\n\n"
        "COMMENTING STYLE — \"Non-Technical\":\n"
        "- Write as if explaining to someone who has NEVER programmed before\n"
        "- NEVER use jargon: no API, middleware, schema, endpoint, ORM, JWT, CRUD, REST, callback, async, etc.\n"
        "- Instead, use real-world analogies:\n"
        "  - \"This is like a to-do list that the program checks off one by one\"\n"
        "  - \"This part checks if the person is who they say they are, like showing ID at a door\"\n"
        "  - \"This saves the information so it's still there when you come back later\"\n"
        "- Describe WHAT the code accomplishes in the real world, not HOW it works mechanically\n"
        "- Use a friendly, clear tone\n"
        "- Use the comment syntax appropriate for {language}\n\n"
        "FILE: {filename}\n\n{code}"
    ),
}

LANGUAGE_BY_EXT = {
    ".py": "Python", ".js": "JavaScript", ".ts": "TypeScript", ".jsx": "JavaScript (React)",
    ".tsx": "TypeScript (React)", ".java": "Java", ".cs": "C#", ".cpp": "C++", ".c": "C",
    ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP", ".swift": "Swift",
    ".kt": "Kotlin", ".scala": "Scala", ".html": "HTML", ".css": "CSS", ".scss": "SCSS",
    ".sql": "SQL", ".sh": "Bash", ".yaml": "YAML", ".yml": "YAML", ".dart": "Dart",
    ".lua": "Lua", ".r": "R", ".pl": "Perl", ".ex": "Elixir", ".hs": "Haskell",
    ".vue": "Vue", ".svelte": "Svelte",
}


def detect_language(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    return LANGUAGE_BY_EXT.get(ext, ext.lstrip(".") or "text")


def annotate_file_content(code: str, filename: str, language: str, mode: str, api_key: str, model: str) -> str:
    """Send a file to Claude and return the annotated version."""
    template = ANNOTATION_PROMPTS.get(mode)
    if not template:
        raise ValueError(f"Unknown annotation mode: {mode}. Choose from: {', '.join(ANNOTATION_PROMPTS)}")

    prompt = template.format(language=language, filename=filename, code=code)

    # Try SDK first, fall back to HTTP
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=model,
            max_tokens=16384,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in message.content if hasattr(b, "text"))
    except ImportError:
        payload = json.dumps({
            "model": model,
            "max_tokens": 16384,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode())
        text = "".join(b.get("text", "") for b in data.get("content", []))

    # Clean up any accidental markdown fences
    text = re.sub(r"^```[\w]*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    return text


def annotate_command(args):
    """Handle the `annotate` subcommand."""
    file_path = Path(args.file).resolve()
    if not file_path.is_file():
        print(f"❌ Not a file: {file_path}")
        sys.exit(1)

    api_key = args.key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("❌ No API key. Set ANTHROPIC_API_KEY or use --key")
        sys.exit(1)

    code = file_path.read_text(errors="replace")
    language = detect_language(str(file_path))
    mode = args.mode

    print(f"🗺️  Grimoire — Annotate")
    print(f"📄 File: {file_path.name}  ({language})")
    print(f"🎨 Mode: {mode}")
    print(f"⏳ Sending to Claude...")

    annotated = annotate_file_content(code, file_path.name, language, mode, api_key, args.model)

    if args.output:
        out_path = Path(args.output)
    elif args.in_place:
        out_path = file_path
    else:
        stem = file_path.stem
        suffix = file_path.suffix
        out_path = file_path.parent / f"{stem}.annotated{suffix}"

    out_path.write_text(annotated)
    print(f"✅ Annotated file saved: {out_path}")

    if not args.in_place and str(out_path) != str(file_path):
        print(f"💡 Tip: Use --in-place to overwrite the original, or diff with:")
        print(f"   diff {file_path.name} {out_path.name}")


# ─── Main ───
def main():
    parser = argparse.ArgumentParser(
        description="🗺️  Grimoire — Map your codebase with AI-powered descriptions",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python grimoire.py ./my-project
  python grimoire.py ./my-project --key sk-ant-api03-...
  python grimoire.py ./my-project --no-ai          # heuristics only
  python grimoire.py ./my-project --batch-size 40
  python grimoire.py ./my-project --exclude "logs,tmp,data"

  # Annotate a single file with inline comments:
  python grimoire.py annotate ./src/app.js --mode tutor
  python grimoire.py annotate ./src/app.js --mode non-technical --in-place
        """,
    )

    subparsers = parser.add_subparsers(dest="command")

    # ─── Annotate subcommand ───
    ann_parser = subparsers.add_parser("annotate", help="Add AI-generated inline comments to a file")
    ann_parser.add_argument("file", help="Path to the file to annotate")
    ann_parser.add_argument("--mode", choices=["tutor", "minimal", "technical", "non-technical"],
                            default="tutor", help="Annotation style (default: tutor)")
    ann_parser.add_argument("--key", help="Anthropic API key (or set ANTHROPIC_API_KEY env var)")
    ann_parser.add_argument("--model", default="claude-sonnet-4-20250514", help="Claude model to use")
    ann_parser.add_argument("--output", help="Output file path (default: <file>.annotated.<ext>)")
    ann_parser.add_argument("--in-place", action="store_true", help="Overwrite the original file")

    # ─── Scan (default) arguments ───
    parser.add_argument("path", nargs="?", help="Path to the project directory")
    parser.add_argument("--key", help="Anthropic API key (or set ANTHROPIC_API_KEY env var)")
    parser.add_argument("--model", default="claude-sonnet-4-20250514", help="Claude model to use")
    parser.add_argument("--batch-size", type=int, default=30, help="Items per API batch (default: 30)")
    parser.add_argument("--no-ai", action="store_true", help="Skip AI — use only heuristic descriptions")
    parser.add_argument("--exclude", help="Comma-separated additional directories to exclude")
    parser.add_argument("--no-scan", action="store_true", help="Skip reading file headers (imports, classes) for AI context")
    parser.add_argument("--plain-english", action="store_true", default=True,
                        help="Write descriptions in plain English, no jargon (default: on, recommended)")
    parser.add_argument("--technical", action="store_true",
                        help="Write descriptions using technical terminology (overrides --plain-english)")
    parser.add_argument("--output", help="Output file path (default: <project>/.grimoire.json)")

    args = parser.parse_args()

    # Route to annotate subcommand if used
    if args.command == "annotate":
        annotate_command(args)
        return

    if not args.path:
        parser.print_help()
        return

    project_path = Path(args.path).resolve()
    if not project_path.is_dir():
        print(f"❌ Not a directory: {project_path}")
        sys.exit(1)

    print(f"🗺️  Grimoire")
    print(f"📂 Scanning: {project_path}")

    # Exclusions
    excludes = set(DEFAULT_EXCLUDE)
    if args.exclude:
        excludes.update(e.strip() for e in args.exclude.split(","))

    # Walk directory (with optional file header scanning)
    scan_headers = not args.no_scan
    tree = walk_directory(project_path, excludes, scan_headers=scan_headers)
    all_paths = collect_paths(tree)
    print(f"📊 Found {len(all_paths)} files and directories")

    # Collect code snippets for AI context
    snippets = {}
    if scan_headers:
        snippets = collect_snippets(tree)
        if snippets:
            print(f"🔬 Scanned headers from {len(snippets)} source files")
        # Count inferred tags
        inferred_count = count_inferred_tags(tree)
        if inferred_count:
            print(f"🏷️  Inferred {inferred_count} tags from imports (api, auth, database, etc.)")
    else:
        print("⏭️  Skipping file header scanning (--no-scan flag)")

    # Read README
    readme = ""
    readme_path = project_path / "README.md"
    if not readme_path.exists():
        readme_path = project_path / "readme.md"
    if readme_path.exists():
        readme = readme_path.read_text(errors="replace")[:3000]
        print(f"📖 Read README.md ({len(readme)} chars)")

    # AI descriptions
    if not args.no_ai:
        api_key = args.key or os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            print("\n⚠️  No API key provided. Set ANTHROPIC_API_KEY or use --key")
            print("   Falling back to heuristic descriptions only.\n")
        else:
            use_plain = args.plain_english and not args.technical
            descs = generate_descriptions(
                tree, readme, api_key,
                model=args.model,
                batch_size=args.batch_size,
                snippets=snippets if snippets else None,
                plain_english=use_plain,
            )
            applied = apply_descriptions(tree, descs)
            print(f"\n✨ Applied {applied} AI descriptions")
    else:
        print("⏭️  Skipping AI (--no-ai flag)")

    # Output — strip snippets from tree to keep JSON clean, store separately
    def strip_snippets(node):
        """Remove snippet fields from tree (they're stored separately)."""
        for f in node.get("files", []):
            f.pop("snippet", None)
        for c in node.get("children", []):
            strip_snippets(c)

    strip_snippets(tree)

    output_path = args.output or str(project_path / ".grimoire.json")
    output_data = {
        "tree": tree,
        "basePath": str(project_path),
        "readme": readme[:1500] if readme else "",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": args.model if not args.no_ai else "heuristics-only",
        "hasSnippets": bool(snippets),
    }
    # Include snippets in output so the UI can show code previews
    if snippets:
        output_data["snippets"] = snippets

    with open(output_path, "w") as f:
        json.dump(output_data, f, indent=2)

    print(f"\n💾 Saved: {output_path}")
    print(f"📎 Import this file into the Grimoire UI to explore your project map.")
    print(f"\n   Tip: Add .grimoire.json to your .gitignore")


if __name__ == "__main__":
    main()
