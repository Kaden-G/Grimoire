#!/usr/bin/env python3
"""
Grimoire token benchmark — measure how many tokens an AI agent spends to understand
a repo WITHOUT Grimoire vs WITH the Grimoire map / MCP server.

It reuses grimoire.py's real directory walk, exclusion rules, and map builder, then
counts tokens for two scenarios:

  Orientation (getting your bearings in the repo)
    - Without Grimoire : read the source of the whole repo
    - With Grimoire    : read the compact .grimoire-context.md map (what the MCP serves)

  Per-task ("where do I change X?")
    - Without Grimoire : grep + read the top matching files in full
    - With Grimoire    : a single find_files MCP response

Outputs a console summary plus screenshot-ready report.html and report.md.

Token counting:
  --method auto       (default) tiktoken if installed, else a ~4 chars/token heuristic
  --method tiktoken   exact cl100k_base counts (pip install tiktoken)
  --method anthropic  exact Claude counts via the (free) count_tokens API (needs a key)

Usage:
  python benchmark/token_benchmark.py .                 # benchmark this repo
  python benchmark/token_benchmark.py ../some-project --method tiktoken
  python benchmark/token_benchmark.py . --method anthropic --key sk-ant-...
"""

import argparse
import html
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Import the real Grimoire engine (walk, excludes, map builder) from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import grimoire as g  # noqa: E402

DEFAULT_QUERIES = ["auth", "database", "api", "config", "test", "state"]

# This tool's own generated outputs — never count them as repo source (keeps runs deterministic).
_BENCH_ARTIFACTS = {"report.md", "report.html"}


# ─────────────────────────── token counting ───────────────────────────
def _heuristic(text: str) -> int:
    return max(1, round(len(text) / 4)) if text else 0


def _anthropic_count(text: str, model: str, api_key: str) -> int:
    if not text:
        return 0
    payload = json.dumps({"model": model, "messages": [{"role": "user", "content": text}]}).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages/count_tokens",
        data=payload,
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return int(json.loads(resp.read())["input_tokens"])
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Anthropic count_tokens failed ({e.code}): {e.read().decode(errors='replace')[:300]}")


def make_counter(method: str, model: str, api_key: str):
    """Return (count_fn, human_label)."""
    if method == "anthropic":
        if not api_key:
            raise SystemExit("--method anthropic needs an API key (--key or ANTHROPIC_API_KEY).")
        return (lambda t: _anthropic_count(t, model, api_key)), f"Anthropic count_tokens ({model})"
    if method in ("auto", "tiktoken"):
        try:
            import tiktoken
            enc = tiktoken.get_encoding("cl100k_base")
            return (lambda t: len(enc.encode(t)) if t else 0), "tiktoken cl100k_base"
        except Exception:
            if method == "tiktoken":
                raise SystemExit("tiktoken not installed. Run: pip install tiktoken")
    return _heuristic, "heuristic (~4 chars/token)"


# ─────────────────────────── repo reading ───────────────────────────
def iter_source_files(root: Path, excludes: set):
    """Yield source files an agent would actually read, mirroring grimoire's walk."""
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not g.should_exclude(d, excludes)]
        for fn in filenames:
            if g.should_exclude(fn, excludes) or fn in _BENCH_ARTIFACTS:
                continue
            p = Path(dirpath) / fn
            if p.suffix.lower() in g.SCANNABLE_EXTENSIONS or fn in g.FILE_EXACT:
                yield p


def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except (OSError, UnicodeError):
        return ""


def get_map(repo: Path, excludes: set):
    """Return (context_markdown, entries, source_label)."""
    gj = repo / ".grimoire.json"
    if gj.exists():
        data = g.load_previous_map(str(gj))
        if data and data.get("tree"):
            tree = data["tree"]
            ctx = g.build_agent_context(data)
            return ctx, g._collect_context_entries(tree), "existing .grimoire.json (AI descriptions)"
    # No saved map — build a heuristic one (no API needed).
    tree = g.walk_directory(repo, excludes, scan_headers=True)
    readme = ""
    for name in ("README.md", "readme.md"):
        rp = repo / name
        if rp.exists():
            readme = read_text(rp)[:3000]
            break
    map_data = {"tree": tree, "readme": readme}
    return g.build_agent_context(map_data), g._collect_context_entries(tree), "heuristic scan (no AI)"


# ─────────────────────────── query simulation ───────────────────────────
def mcp_find(entries, query: str, limit: int = 12) -> str:
    """Mirror the MCP server's find_files response (mapQuery.find scoring)."""
    q = query.lower().strip()
    scored = []
    for typ, path, desc, tags in entries:
        hay = f"{path} {desc} {' '.join(tags)}".lower()
        base = path.rstrip("/").split("/")[-1].lower()
        score = (1 if q in hay else 0) + (1 if q in base else 0)
        if score > 0:
            scored.append((score, len(path), path, desc, tags))
    scored.sort(key=lambda r: (-r[0], r[1]))
    lines = [f'Files matching "{query}":', ""]
    for _, _, path, desc, tags in scored[:limit]:
        tagstr = f" [{', '.join(tags)}]" if tags else ""
        lines.append(f"- {path}{(' — ' + desc) if desc else ''}{tagstr}")
    if not scored:
        lines.append("(no matches)")
    return "\n".join(lines)


def top_file_for_query(entries, query: str):
    """Path of the single best-matching FILE entry (where the map sends the agent)."""
    q = query.lower().strip()
    best, best_key = None, (1, 1e9)
    for typ, path, desc, tags in entries:
        if typ != "file":
            continue
        hay = f"{path} {desc} {' '.join(tags)}".lower()
        base = path.rsplit("/", 1)[-1].lower()
        score = (1 if q in hay else 0) + (1 if q in base else 0)
        if score > 0 and (-score, len(path)) < best_key:
            best_key, best = (-score, len(path)), path
    return best


def naive_find(files, query: str, k: int):
    """Simulate an agent without a map: grep, then read the top-k matching files in full."""
    q = query.lower()
    scored = []
    for p, text in files:
        hits = (str(p).lower() + "\n" + text.lower()).count(q)
        if hits:
            scored.append((hits, p, text))
    scored.sort(key=lambda r: -r[0])
    chosen = scored[:k]
    combined = "\n\n".join(t for _, _, t in chosen)
    return combined, [str(p) for _, p, _ in chosen]


# ─────────────────────────── reporting ───────────────────────────
def fmt(n: int) -> str:
    return f"{n:,}"


def ratio(without: int, with_: int) -> str:
    return f"{(without / with_):.0f}x" if with_ else "∞"


def pct_saved(without: int, with_: int) -> str:
    return f"{(1 - with_ / without) * 100:.1f}%" if without else "0%"


STYLE = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin:0; background:#0a0e17; color:#e6edf3; font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif; padding:40px; }
.wrap { max-width:860px; margin:0 auto; }
h1 { font-size:26px; margin:0 0 4px; }
h2 { font-size:17px; margin:34px 0 12px; color:#cdd6e0; border-bottom:1px solid #1d2533; padding-bottom:7px; }
.sub { color:#8b97a7; margin:0 0 22px; font-size:13px; }
.hero { display:flex; gap:18px; margin:18px 0 8px; }
.stat { flex:1; background:#111726; border:1px solid #1d2533; border-radius:12px; padding:18px 20px; }
.stat .big { font-size:34px; font-weight:700; color:#e0b34a; }
.stat .lbl { color:#8b97a7; font-size:12px; text-transform:uppercase; letter-spacing:.05em; margin-top:4px; }
.bar-row { display:flex; align-items:center; gap:14px; margin:12px 0; }
.bar-label { width:230px; font-size:13px; color:#cdd6e0; text-align:right; flex-shrink:0; }
.bar-track { flex:1; background:#0e1420; border-radius:6px; overflow:hidden; height:30px; }
.bar-fill { height:100%; display:flex; align-items:center; padding:0 10px; font-size:12px; font-weight:600; white-space:nowrap; border-radius:6px; }
.bar-without { background:linear-gradient(90deg,#3a2a2a,#7a3b3b); color:#ffd9d9; }
.bar-with { background:linear-gradient(90deg,#2a3a2f,#3b7a55); color:#d9ffe6; }
table { width:100%; border-collapse:collapse; margin-top:10px; font-size:13.5px; }
th,td { text-align:left; padding:9px 12px; border-bottom:1px solid #1d2533; }
th { color:#8b97a7; font-weight:600; font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; }
td.num { text-align:right; font-variant-numeric:tabular-nums; }
.save { color:#5fd08a; font-weight:600; }
.foot { margin-top:26px; color:#5d6a7a; font-size:12px; }
code { background:#0e1420; padding:1px 6px; border-radius:5px; color:#e0b34a; font-size:12.5px; }
"""


def _bar(label: str, value: int, maxval: int, kind: str) -> str:
    width = max(2.0, (value / maxval * 100) if maxval else 2.0)
    return (
        f'<div class="bar-row"><div class="bar-label">{html.escape(label)}</div>'
        f'<div class="bar-track"><div class="bar-fill bar-{kind}" style="width:{width:.1f}%">'
        f'{fmt(value)} tokens</div></div></div>'
    )


def write_html(out: Path, ctx: dict):
    q_rows = "".join(
        f"<tr><td>{html.escape(r['query'])}</td>"
        f"<td class='num'>{fmt(r['naive'])}</td>"
        f"<td class='num'>{fmt(r['mcp'])}</td>"
        f"<td class='num save'>{pct_saved(r['naive'], r['mcp'])} ({ratio(r['naive'], r['mcp'])})</td></tr>"
        for r in ctx["queries"]
    )
    orient_max = max(ctx["corpus_tokens"], ctx["context_tokens"], 1)
    html_doc = f"""<!doctype html><html><head><meta charset="utf-8">
<title>Grimoire — Token Savings</title><style>{STYLE}</style></head>
<body><div class="wrap">
<h1>Grimoire cuts the tokens agents burn on your repo</h1>
<p class="sub">Repo: <code>{html.escape(ctx['repo'])}</code> &nbsp;·&nbsp; {fmt(ctx['file_count'])} source files &nbsp;·&nbsp;
{ctx['entry_count']} map entries &nbsp;·&nbsp; tokens via {html.escape(ctx['method'])}</p>

<div class="hero">
  <div class="stat"><div class="big">{pct_saved(ctx['corpus_tokens'], ctx['context_tokens'])}</div>
    <div class="lbl">Fewer tokens to get oriented</div></div>
  <div class="stat"><div class="big">{ratio(ctx['corpus_tokens'], ctx['context_tokens'])}</div>
    <div class="lbl">Repo source vs Grimoire map</div></div>
  <div class="stat"><div class="big">{fmt(ctx['corpus_tokens'] - ctx['context_tokens'])}</div>
    <div class="lbl">Tokens saved per orientation</div></div>
</div>

<h2>Orientation — understanding the repo</h2>
{_bar('Read the whole repo source', ctx['corpus_tokens'], orient_max, 'without')}
{_bar('Read the Grimoire map', ctx['context_tokens'], orient_max, 'with')}

<h2>Per task — "where do I change X?"</h2>
<table><thead><tr><th>Question</th><th class="num">Without (grep + read files)</th>
<th class="num">With Grimoire (map &rarr; 1 file)</th><th class="num">Saved</th></tr></thead>
<tbody>{q_rows}</tbody></table>

<p class="foot">Without Grimoire = full source of the top {ctx['top_k']} files matching the query.
With Grimoire = one <code>find_files</code> response plus reading the single file it points to. Map source: {html.escape(ctx['map_source'])}.
Generated by <code>benchmark/token_benchmark.py</code>.</p>
</div></body></html>"""
    out.write_text(html_doc, encoding="utf-8")


def write_md(out: Path, ctx: dict):
    lines = [
        "# Grimoire Token Savings",
        "",
        f"- **Repo:** `{ctx['repo']}` ({fmt(ctx['file_count'])} source files, {ctx['entry_count']} map entries)",
        f"- **Token counter:** {ctx['method']}",
        f"- **Map source:** {ctx['map_source']}",
        "",
        "## Orientation (understanding the repo)",
        "",
        "| Scenario | Tokens |",
        "|---|---:|",
        f"| Read the whole repo source | {fmt(ctx['corpus_tokens'])} |",
        f"| Read the Grimoire map | {fmt(ctx['context_tokens'])} |",
        f"| **Savings** | **{pct_saved(ctx['corpus_tokens'], ctx['context_tokens'])} "
        f"({ratio(ctx['corpus_tokens'], ctx['context_tokens'])} fewer)** |",
        "",
        f"## Per task (read top {ctx['top_k']} candidate files vs map → read 1 file)",
        "",
        "| Question | Without Grimoire | With Grimoire | Saved |",
        "|---|---:|---:|---:|",
    ]
    for r in ctx["queries"]:
        lines.append(
            f"| {r['query']} | {fmt(r['naive'])} | {fmt(r['mcp'])} | "
            f"{pct_saved(r['naive'], r['mcp'])} ({ratio(r['naive'], r['mcp'])}) |"
        )
    lines.append("")
    out.write_text("\n".join(lines), encoding="utf-8")


# ─────────────────────────── main ───────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Measure token savings from the Grimoire map / MCP server.")
    ap.add_argument("path", nargs="?", default=".", help="Repo to benchmark (default: current dir)")
    ap.add_argument("--method", choices=["auto", "heuristic", "tiktoken", "anthropic"], default="auto")
    ap.add_argument("--model", default="claude-sonnet-4-20250514")
    ap.add_argument("--key", help="Anthropic API key (or set ANTHROPIC_API_KEY)")
    ap.add_argument("--queries", help="Comma-separated questions to simulate")
    ap.add_argument("--top-k", type=int, default=5, help="Files an unaided agent reads per query (default: 5)")
    ap.add_argument("--exclude", help="Comma-separated extra directories to exclude")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent), help="Output dir for report.html/report.md")
    args = ap.parse_args()

    # Windows consoles default to cp1252; allow the unicode in our summary.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    repo = Path(args.path).resolve()
    if not repo.is_dir():
        raise SystemExit(f"Not a directory: {repo}")

    excludes = set(g.DEFAULT_EXCLUDE)
    if args.exclude:
        excludes.update(e.strip() for e in args.exclude.split(","))

    api_key = args.key or os.environ.get("ANTHROPIC_API_KEY")
    count, method_label = make_counter(args.method, args.model, api_key)
    queries = [q.strip() for q in args.queries.split(",")] if args.queries else DEFAULT_QUERIES

    print(f"Benchmarking {repo}\n  token method: {method_label}")

    # Load all source files once (reused for corpus + per-query grep).
    print("  reading source files...")
    files = [(p, read_text(p)) for p in iter_source_files(repo, excludes)]
    corpus_tokens = sum(count(t) for _, t in files)
    files_by_rel = {}
    for p, t in files:
        try:
            rel = str(p.relative_to(repo)).replace(os.sep, "/")
        except ValueError:
            rel = p.name
        files_by_rel[rel] = t

    context_md, entries, map_source = get_map(repo, excludes)
    context_tokens = count(context_md)

    print(f"  {len(files)} files, {fmt(corpus_tokens)} corpus tokens, {fmt(context_tokens)} map tokens")

    query_rows = []
    for q in queries:
        naive_text, _ = naive_find(files, q, args.top_k)
        resp_tokens = count(mcp_find(entries, q))
        target = top_file_for_query(entries, q)
        file_tokens = count(files_by_rel.get(target, "")) if target else 0
        query_rows.append({"query": q, "naive": count(naive_text), "mcp": resp_tokens + file_tokens})

    ctx = {
        "repo": str(repo),
        "method": method_label,
        "map_source": map_source,
        "file_count": len(files),
        "entry_count": len(entries),
        "corpus_tokens": corpus_tokens,
        "context_tokens": context_tokens,
        "top_k": args.top_k,
        "queries": query_rows,
    }

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    write_html(out_dir / "report.html", ctx)
    write_md(out_dir / "report.md", ctx)

    # Console summary
    print("\n── Orientation ──")
    print(f"  Without Grimoire (read repo) : {fmt(corpus_tokens)} tokens")
    print(f"  With Grimoire (read map)     : {fmt(context_tokens)} tokens")
    print(f"  Savings                      : {pct_saved(corpus_tokens, context_tokens)} "
          f"({ratio(corpus_tokens, context_tokens)} fewer)")
    print("\n── Per task ──")
    for r in query_rows:
        print(f"  {r['query']:<22} without {fmt(r['naive']):>9}  with {fmt(r['mcp']):>6}  "
              f"saved {pct_saved(r['naive'], r['mcp'])}")
    print(f"\nReports written to {out_dir / 'report.html'} and {out_dir / 'report.md'}")


if __name__ == "__main__":
    main()
