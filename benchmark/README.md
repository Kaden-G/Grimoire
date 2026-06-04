# Grimoire Token Benchmark

`token_benchmark.py` measures how many tokens an AI coding agent spends to understand
a repo **without** Grimoire vs **with** the Grimoire map / MCP server, and writes a
screenshot-ready `report.html` (plus `report.md`) you can drop on the Marketplace page.

It reuses the real engine in `grimoire.py` — the same directory walk, exclusion rules,
and map builder the extension uses — so the numbers reflect actual behavior.

## What it measures

**Orientation — "help me understand this repo"** (the headline metric)
- *Without Grimoire:* tokens to read the full source of every file in the repo.
- *With Grimoire:* tokens to read the compact `.grimoire-context.md` map (exactly what the MCP server serves).

**Per task — "where do I change X?"**
- *Without Grimoire:* grep for the term, then read the top-K matching files in full (an agent can't be sure which is right).
- *With Grimoire:* one `find_files` response **plus** reading the single file the map points to.

## Usage

> Requires **Python 3.10+** (both `grimoire.py` and this benchmark use 3.10+ syntax).

```bash
# Benchmark this repo (uses .grimoire.json if present, else a heuristic scan)
python benchmark/token_benchmark.py .

# Benchmark another project — for the best per-task numbers, scan it first so it
# has an AI-described .grimoire.json:
python grimoire.py ../my-app --key sk-ant-...
python benchmark/token_benchmark.py ../my-app

# Custom questions and counter
python benchmark/token_benchmark.py ../my-app \
  --queries "checkout,email,login,upload" --top-k 5 --method tiktoken
```

Open `benchmark/report.html` in a browser and screenshot it for the Marketplace.

## Token counting (`--method`)

| Method | Notes |
|---|---|
| `auto` (default) | Uses `tiktoken` if installed, otherwise a ~4-chars/token heuristic |
| `tiktoken` | Exact `cl100k_base` counts — `pip install tiktoken` |
| `anthropic` | Exact Claude counts via the (free) `count_tokens` API — needs `--key`/`ANTHROPIC_API_KEY` |

The report always states which method produced the numbers.

## Sample (this repo, exact `tiktoken` counts)

| Scenario | Tokens |
|---|---:|
| Read the whole repo source | 105,871 |
| Read the Grimoire map | 681 |
| **Savings** | **99.4% — 155x fewer** |

So an agent gets fully oriented for **~0.6%** of the cost of ingesting the repo, then
reads only the 1–3 files a `find_files` lookup points to.

## Honesty notes

- **Orientation is the bulletproof number.** It's a fair "what does it cost to load this
  repo into context" comparison and scales with repo size (bigger repos → bigger wins).
- **Per-task numbers are strongest on AI-scanned repos.** With real descriptions in
  `.grimoire.json`, `find_files` reliably points at the right file. On a heuristic-only
  map (no API key used), a query with no tag/path match returns "no matches" — which is
  itself useful (the map tells the agent *"there's no such code here"* in a handful of
  tokens instead of reading thousands), but makes those rows less illustrative.
- Reports are regenerated on each run; the benchmark excludes its own `report.*` outputs
  from the corpus so results are deterministic.
