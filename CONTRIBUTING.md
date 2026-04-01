# Contributing to Grimoire

## Branch Strategy

```
feature/*  ──PR──▶  dev  ──PR──▶  master
  (build)        (test)        (publish)
```

| Branch | Purpose | Protected | Auto-deploys |
|--------|---------|-----------|-------------|
| `feature/*` | Individual features/fixes | No | — |
| `dev` | Integration + local testing | Yes (CI must pass) | Builds .vsix artifact |
| `master` | Production — marketplace releases | Yes (CI must pass) | Manual publish only |

## Workflow

### 1. Start a feature

```bash
git checkout dev
git pull origin dev
git checkout -b feature/my-feature
# ... do work ...
git push -u origin feature/my-feature
```

### 2. PR into dev

Open a PR from `feature/my-feature` → `dev`. CI runs automatically:
- Syntax check (all source files)
- Test suite (commentTagger + integration checks)

Merge when green.

### 3. Test locally

After merging to `dev`, test the extension in your actual VS Code:

```bash
git checkout dev
git pull origin dev
./scripts/dev-test.sh
```

This builds a `.vsix`, installs it in VS Code, and prompts you to reload. Test the feature manually.

Alternatively, download the `.vsix` artifact from the **Dev Build** GitHub Action run.

### 4. Promote to production

When `dev` is stable and tested:
1. Open a PR from `dev` → `master`
2. CI runs again on the PR
3. Merge when green
4. Go to **Actions → "Publish to Marketplace" → Run workflow**
5. Choose dry run = `true` first to verify, then `false` to publish

### Quick reference

```bash
# Run tests locally
cd vscode-extension && npm run test

# Syntax check
cd vscode-extension && npm run lint

# Build .vsix without installing
./scripts/dev-test.sh --build

# Build + install locally
./scripts/dev-test.sh
```

## CI/CD Pipelines

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **CI** (`ci.yml`) | PR or push to `dev`/`master` | Lint + test |
| **Dev Build** (`dev-build.yml`) | Push to `dev` | Lint + test + build .vsix artifact (30-day retention) |
| **Publish** (`publish.yml`) | Manual trigger from `master` | Lint + test + build + publish to marketplace |

## Setting up marketplace publishing

1. Create a Personal Access Token at https://dev.azure.com
   - Organization: `godinez-llc` (must match your publisher)
   - Scopes: Marketplace → Manage
2. Add it as a GitHub secret: **Settings → Secrets → Actions → `VSCE_PAT`**
3. The Publish workflow will use this token automatically

## Test suite

Tests live in `vscode-extension/src/__tests__/` and run without any dependencies (no VS Code host needed). Currently 109 tests covering:

- Comment tagging (detect, strip, count, filter by mode)
- All 5 comment syntaxes (JS, Python, SQL, CSS, HTML)
- Edge cases (indentation, Windows line endings, rune-in-strings)
- End-to-end Replace and Merge cycle simulations
- Integration checks (prompts, package.json, extension.js wiring)
