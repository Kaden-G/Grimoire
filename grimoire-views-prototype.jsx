import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import * as d3 from "d3";

// ============================================================
// Grimoire View Mode Prototype
// Demonstrates 4 view modes for the same .grimoire.json data:
//   1. Treemap (existing) - spatial file/dir layout
//   2. Architecture Graph - dependency node graph
//   3. Capability Map - grouped by what files DO, not where they live
//   4. Onboarding Path - guided reading order for newcomers
// ============================================================

// --- Sample data modeled after a real Grimoire scan ---
// Files are ordered to match actual repo structure (not alphabetical).
// The "repoOrder" field preserves the filesystem ordering from the scan.
const SAMPLE_DATA = {
  files: [
    // Root-level files first (as they'd appear in a file explorer)
    { id: "grimoirePy", name: "grimoire.py", path: "grimoire.py", dir: "/", purpose: "Python CLI tool — scan repos from terminal, generate .grimoire.json without VS Code", tags: ["cli", "scanning", "api"], size: 300, imports: [], annotations: null, complexity: 3 },
    // server/ directory
    { id: "authRoute", name: "auth.ts", path: "server/src/routes/auth.ts", dir: "server/src/routes", purpose: "GitHub OAuth flow — state tokens, code exchange, session minting, user creation", tags: ["auth", "api", "security"], size: 200, imports: [], annotations: "technical", complexity: 4 },
    { id: "authTest", name: "auth.test.ts", path: "server/src/__tests__/auth.test.ts", dir: "server/src/__tests__", purpose: "Auth middleware tests — token validation, session expiry, error handling", tags: ["test", "auth"], size: 120, imports: ["authRoute"], annotations: null, complexity: 2 },
    { id: "billingTest", name: "billing.test.ts", path: "server/src/__tests__/billing.test.ts", dir: "server/src/__tests__", purpose: "Stripe billing webhook and checkout flow integration tests", tags: ["test", "billing"], size: 90, imports: [], annotations: null, complexity: 2 },
    // vscode-extension/ directory
    { id: "packageJson", name: "package.json", path: "vscode-extension/package.json", dir: "vscode-extension", purpose: "Extension manifest — commands, views, configuration schema, marketplace metadata", tags: ["config", "manifest"], size: 280, imports: [], annotations: null, complexity: 1 },
    { id: "ext", name: "extension.js", path: "vscode-extension/src/extension.js", dir: "vscode-extension/src", purpose: "Entry point — registers all commands, loads .grimoire.json, initializes tree provider", tags: ["entry", "commands", "lifecycle"], size: 420, imports: ["scanner", "annotator", "treeProvider", "webviewPanel", "welcomePanel"], annotations: "tutor", complexity: 4 },
    { id: "annotator", name: "annotator.js", path: "vscode-extension/src/annotator.js", dir: "vscode-extension/src", purpose: "Manages inline comment generation with 4 annotation modes (tutor, minimal, technical, non-technical)", tags: ["ai", "comments", "api"], size: 350, imports: ["commentTagger"], annotations: "tutor", complexity: 4 },
    { id: "commentTagger", name: "commentTagger.js", path: "vscode-extension/src/commentTagger.js", dir: "vscode-extension/src", purpose: "ᚲ rune tag detection, comment stripping, mode identification for Grimoire-generated comments", tags: ["comments", "parsing"], size: 140, imports: [], annotations: "minimal", complexity: 2 },
    { id: "scanner", name: "scanner.js", path: "vscode-extension/src/scanner.js", dir: "vscode-extension/src", purpose: "Walks workspace files, applies heuristic descriptions, calls Claude API for AI summaries", tags: ["ai", "api", "scanning"], size: 380, imports: [], annotations: "tutor", complexity: 3 },
    { id: "treeProvider", name: "treeProvider.js", path: "vscode-extension/src/treeProvider.js", dir: "vscode-extension/src", purpose: "VS Code sidebar tree view — renders file hierarchy with icons, descriptions, and tag badges", tags: ["ui", "sidebar", "tree"], size: 220, imports: [], annotations: "tutor", complexity: 3 },
    { id: "webviewPanel", name: "webviewPanel.js", path: "vscode-extension/src/webviewPanel.js", dir: "vscode-extension/src", purpose: "Interactive treemap webview with search, breadcrumbs, and squarified layout algorithm", tags: ["ui", "webview", "visualization"], size: 480, imports: [], annotations: null, complexity: 5 },
    { id: "welcomePanel", name: "welcomePanel.js", path: "vscode-extension/src/welcomePanel.js", dir: "vscode-extension/src", purpose: "Onboarding flow — API key setup, first-run guidance, configuration walkthrough", tags: ["ui", "onboarding", "config"], size: 180, imports: [], annotations: null, complexity: 2 },
  ],
  capabilities: {
    "Scanning & Mapping": { color: "#6366f1", icon: "🔍", files: ["scanner", "ext", "grimoirePy"] },
    "AI Annotation": { color: "#f59e0b", icon: "✨", files: ["annotator", "commentTagger"] },
    "Visualization": { color: "#10b981", icon: "📊", files: ["treeProvider", "webviewPanel"] },
    "Auth & Billing": { color: "#ef4444", icon: "🔐", files: ["authRoute", "authTest", "billingTest"] },
    "Onboarding & Config": { color: "#8b5cf6", icon: "⚙️", files: ["welcomePanel", "packageJson"] },
  },
  onboardingPath: [
    { fileId: "packageJson", reason: "Start here — understand what commands and config exist", milestone: "Know the extension's surface area" },
    { fileId: "ext", reason: "See how everything wires together on activation", milestone: "Understand the initialization flow" },
    { fileId: "scanner", reason: "Core feature #1 — how repos get mapped", milestone: "Understand scanning pipeline" },
    { fileId: "commentTagger", reason: "The ᚲ rune system — how Grimoire marks its comments", milestone: "Understand comment tagging" },
    { fileId: "annotator", reason: "Core feature #2 — how AI comments are generated and applied", milestone: "Understand annotation pipeline" },
    { fileId: "treeProvider", reason: "How scan results render in the sidebar", milestone: "Understand UI rendering" },
    { fileId: "webviewPanel", reason: "The interactive map — most complex UI component", milestone: "Understand the treemap view" },
    { fileId: "authRoute", reason: "Pro tier auth flow — GitHub OAuth implementation", milestone: "Understand the backend" },
  ],
};

const getFileById = (id) => SAMPLE_DATA.files.find((f) => f.id === id);

// --- Color utilities ---
const TAG_COLORS = {
  ai: "#f59e0b", api: "#3b82f6", ui: "#10b981", auth: "#ef4444",
  security: "#ef4444", test: "#8b5cf6", config: "#6b7280", comments: "#f59e0b",
  scanning: "#6366f1", cli: "#06b6d4", entry: "#ec4899", commands: "#ec4899",
  lifecycle: "#ec4899", sidebar: "#10b981", tree: "#10b981", webview: "#10b981",
  visualization: "#10b981", onboarding: "#8b5cf6", billing: "#ef4444",
  parsing: "#f59e0b", manifest: "#6b7280",
};

const ANNOTATION_COLORS = {
  tutor: "#6366f1", minimal: "#10b981", technical: "#f59e0b", "non-technical": "#ec4899",
};

// ============================================================
// View 1: Repo Tree (directory-grouped, repo order, equal cards)
// ============================================================
function TreemapView({ files, onSelect, selected }) {
  // Group files by directory, preserving array order (which IS repo order)
  const grouped = useMemo(() => {
    const groups = [];
    const seen = new Set();
    files.forEach((f) => {
      const dir = f.dir || "/";
      if (!seen.has(dir)) {
        seen.add(dir);
        groups.push({ dir, files: [] });
      }
      groups.find((g) => g.dir === dir).files.push(f);
    });
    return groups;
  }, [files]);

  const [collapsedDirs, setCollapsedDirs] = useState(new Set());

  const toggleDir = (dir) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  return (
    <div style={{ background: "#0f172a", borderRadius: "12px", padding: "16px", maxHeight: "520px", overflowY: "auto" }}>
      {grouped.map((group) => {
        const isCollapsed = collapsedDirs.has(group.dir);
        const annotatedCount = group.files.filter((f) => f.annotations).length;
        // Pick a representative color from the first file's primary tag
        const dirColor = TAG_COLORS[group.files[0]?.tags?.[0]] || "#64748b";

        return (
          <div key={group.dir} style={{ marginBottom: "16px" }}>
            {/* Directory header */}
            <div
              onClick={() => toggleDir(group.dir)}
              style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 12px", cursor: "pointer",
                borderRadius: "8px", background: "#1e293b",
                marginBottom: isCollapsed ? 0 : "8px",
              }}
            >
              <span style={{
                color: "#64748b", fontSize: "12px", fontWeight: 600,
                transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                transition: "transform 0.2s", display: "inline-block",
              }}>
                ▾
              </span>
              <span style={{ color: "#94a3b8", fontSize: "13px", fontWeight: 600, fontFamily: "monospace" }}>
                {group.dir === "/" ? "/ (root)" : group.dir}
              </span>
              <span style={{ color: "#475569", fontSize: "11px", marginLeft: "auto" }}>
                {group.files.length} file{group.files.length !== 1 ? "s" : ""}
                {annotatedCount > 0 && ` · ${annotatedCount} annotated`}
              </span>
            </div>

            {/* File cards — equal size grid, repo order */}
            {!isCollapsed && (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: "8px", paddingLeft: "12px",
              }}>
                {group.files.map((f) => {
                  const isSelected = selected?.id === f.id;
                  const mainTag = f.tags?.[0];
                  const color = TAG_COLORS[mainTag] || "#64748b";

                  return (
                    <div
                      key={f.id}
                      onClick={() => onSelect(f)}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        background: isSelected ? `${color}15` : "#1e293b",
                        border: `1.5px solid ${isSelected ? color : "#334155"}`,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        display: "flex", flexDirection: "column",
                        minHeight: "90px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#e2e8f0" }}>
                          {f.name}
                        </span>
                        {f.annotations && (
                          <span style={{
                            width: "8px", height: "8px", borderRadius: "50%",
                            background: ANNOTATION_COLORS[f.annotations],
                            flexShrink: 0,
                          }} />
                        )}
                      </div>
                      <span style={{
                        fontSize: "11px", color: "#94a3b8", lineHeight: "1.4",
                        overflow: "hidden", textOverflow: "ellipsis",
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                        flex: 1,
                      }}>
                        {f.purpose}
                      </span>
                      <div style={{ display: "flex", gap: "4px", marginTop: "8px", flexWrap: "wrap" }}>
                        {f.tags.slice(0, 3).map((tag) => (
                          <span key={tag} style={{
                            fontSize: "9px", padding: "1px 5px", borderRadius: "3px",
                            background: `${TAG_COLORS[tag] || "#64748b"}15`,
                            color: `${TAG_COLORS[tag] || "#64748b"}`,
                          }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Architecture groupings — defines clusters and their
// inter-group dependency relationships.
// In production, these would be derived from import analysis.
// ============================================================
const ARCH_GROUPS = [
  {
    id: "orchestration",
    label: "Orchestration",
    desc: "Entry point & command registration",
    color: "#ec4899",
    files: ["ext"],
    dependsOn: ["core-engine", "ui-layer", "config"],
  },
  {
    id: "core-engine",
    label: "Core Engine",
    desc: "Scanning, annotation, and comment tagging",
    color: "#f59e0b",
    files: ["scanner", "annotator", "commentTagger"],
    dependsOn: [],
  },
  {
    id: "ui-layer",
    label: "UI Layer",
    desc: "Tree view, webview map, onboarding panel",
    color: "#10b981",
    files: ["treeProvider", "webviewPanel", "welcomePanel"],
    dependsOn: [],
  },
  {
    id: "server",
    label: "Pro Backend",
    desc: "Auth, billing, API proxy (independent)",
    color: "#ef4444",
    files: ["authRoute", "authTest", "billingTest"],
    dependsOn: [],
  },
  {
    id: "config",
    label: "Config & CLI",
    desc: "Manifest, CLI entry, standalone tooling",
    color: "#6b7280",
    files: ["packageJson", "grimoirePy"],
    dependsOn: [],
  },
];

// Compute group-level dependencies with file-level detail
// Returns: { source, target, label, details: [{from, to}] }
function computeGroupDeps(groups, allFiles) {
  const fileToGroup = {};
  groups.forEach((g) => g.files.forEach((fId) => { fileToGroup[fId] = g.id; }));

  // Collect file-level cross-group imports
  const edgeMap = new Map(); // "src->tgt" -> [{from, to}]
  allFiles.forEach((f) => {
    const srcGroup = fileToGroup[f.id];
    (f.imports || []).forEach((imp) => {
      const tgtGroup = fileToGroup[imp];
      if (tgtGroup && tgtGroup !== srcGroup) {
        const key = `${srcGroup}->${tgtGroup}`;
        if (!edgeMap.has(key)) edgeMap.set(key, []);
        edgeMap.get(key).push({ from: f.id, to: imp });
      }
    });
  });

  // Include manually declared dependsOn for edges with no import data yet
  groups.forEach((g) => {
    (g.dependsOn || []).forEach((dep) => {
      const key = `${g.id}->${dep}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
    });
  });

  // Generate human-readable summary labels per edge
  const labelMap = {
    "orchestration->core-engine": "loads & invokes",
    "orchestration->ui-layer": "renders views",
    "orchestration->config": "reads config",
    "core-engine->core-engine": "internal",
  };

  return Array.from(edgeMap.entries()).map(([key, details]) => {
    const [source, target] = key.split("->");
    const srcLabel = groups.find((g) => g.id === source)?.label || source;
    const tgtLabel = groups.find((g) => g.id === target)?.label || target;
    return {
      source, target,
      label: labelMap[key] || `uses`,
      details: details.map((d) => ({
        from: getFileById(d.from)?.name || d.from,
        to: getFileById(d.to)?.name || d.to,
        fromId: d.from,
        toId: d.to,
      })),
    };
  });
}

// ============================================================
// View 2: Architecture Graph
// Zoomed-out cluster view with labeled dependency arrows.
// Click an arrow label to expand file-level import details.
// ============================================================
function ArchitectureGraphView({ files, onSelect, selected }) {
  const [hoveredGroup, setHoveredGroup] = useState(null);
  const [expandedEdge, setExpandedEdge] = useState(null); // "source->target" or null

  const groupDeps = useMemo(() => computeGroupDeps(ARCH_GROUPS, files), [files]);

  // Compact group nodes — positioned for a zoomed-out feel
  // Using a wider viewport with smaller nodes and more whitespace
  const GROUP_W = 150;
  const GROUP_H = 64;

  // Positions: layered top-down architecture
  //   Orchestration at top (the "brain")
  //   Core Engine + UI Layer in the middle (the "workers")
  //   Server + Config at bottom (the "foundation / standalone")
  const groupPositions = {
    "orchestration": { x: 400, y: 40 },
    "core-engine":   { x: 200, y: 180 },
    "ui-layer":      { x: 600, y: 180 },
    "server":        { x: 140, y: 330 },
    "config":        { x: 540, y: 330 },
  };

  const getGroupCenter = (gId) => {
    const pos = groupPositions[gId];
    if (!pos) return { x: 0, y: 0 };
    return { x: pos.x, y: pos.y + GROUP_H / 2 };
  };

  // Clip line from center-to-center to box edges
  const getEdgePoints = (sourceId, targetId) => {
    const sc = getGroupCenter(sourceId);
    const tc = getGroupCenter(targetId);
    const dx = tc.x - sc.x;
    const dy = tc.y - sc.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;

    const clipToBox = (cx, cy, ddx, ddy) => {
      const hw = GROUP_W / 2 + 4; // small margin
      const hh = GROUP_H / 2 + 4;
      const ratioW = Math.abs(ddx) > 0.01 ? hw / Math.abs(ddx) : Infinity;
      const ratioH = Math.abs(ddy) > 0.01 ? hh / Math.abs(ddy) : Infinity;
      const r = Math.min(ratioW, ratioH, 1);
      return { x: cx + ddx * r, y: cy + ddy * r };
    };

    const s = clipToBox(sc.x, sc.y, dx, dy);
    const t = clipToBox(tc.x, tc.y, -dx, -dy);
    return { sx: s.x, sy: s.y, tx: t.x, ty: t.y };
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "500px", background: "#0f172a", borderRadius: "12px", overflow: "visible" }}>
      {/* SVG layer for arrows */}
      <svg width="100%" height="500" viewBox="0 0 800 500" style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}>
        <defs>
          <marker id="ga-active" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
          </marker>
          <marker id="ga-dim" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="8" markerHeight="6" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#475569" />
          </marker>
        </defs>

        {groupDeps.map((dep, i) => {
          const pts = getEdgePoints(dep.source, dep.target);
          if (!pts) return null;

          const edgeKey = `${dep.source}->${dep.target}`;
          const isExpanded = expandedEdge === edgeKey;
          const isRelated = hoveredGroup === dep.source || hoveredGroup === dep.target;
          const isDimmedByHover = hoveredGroup && !isRelated;
          const isActive = isExpanded || isRelated;

          // Curve control point
          const mx = (pts.sx + pts.tx) / 2;
          const my = (pts.sy + pts.ty) / 2;
          const perpX = -(pts.ty - pts.sy) * 0.12;
          const perpY = (pts.tx - pts.sx) * 0.12;

          return (
            <path
              key={i}
              d={`M ${pts.sx} ${pts.sy} Q ${mx + perpX} ${my + perpY} ${pts.tx} ${pts.ty}`}
              fill="none"
              stroke={isActive ? "#60a5fa" : "#334155"}
              strokeWidth={isActive ? 2.5 : 1.5}
              strokeDasharray={isActive ? "none" : "6 3"}
              markerEnd={isActive ? "url(#ga-active)" : "url(#ga-dim)"}
              opacity={isDimmedByHover ? 0.2 : 1}
              style={{ transition: "all 0.25s" }}
            />
          );
        })}
      </svg>

      {/* Group nodes (compact) */}
      {ARCH_GROUPS.map((group) => {
        const pos = groupPositions[group.id];
        if (!pos) return null;
        const isHovered = hoveredGroup === group.id;
        const isConnected = hoveredGroup && groupDeps.some(
          (d) => (d.source === hoveredGroup && d.target === group.id) ||
                 (d.target === hoveredGroup && d.source === group.id)
        );
        const isDimmed = hoveredGroup && !isHovered && !isConnected;
        const fileCount = group.files.length;

        return (
          <div
            key={group.id}
            onMouseEnter={() => setHoveredGroup(group.id)}
            onMouseLeave={() => setHoveredGroup(null)}
            onClick={() => {
              // Click group to select its first file
              const f = getFileById(group.files[0]);
              if (f) onSelect(f);
            }}
            style={{
              position: "absolute",
              left: pos.x - GROUP_W / 2,
              top: pos.y,
              width: GROUP_W,
              height: GROUP_H,
              background: isHovered ? `${group.color}20` : `${group.color}12`,
              border: `2px solid ${isHovered ? group.color : isConnected ? `${group.color}50` : `${group.color}30`}`,
              borderRadius: "10px",
              cursor: "pointer",
              opacity: isDimmed ? 0.3 : 1,
              transition: "all 0.2s ease",
              boxShadow: isHovered ? `0 0 24px ${group.color}15` : "none",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: group.color, flexShrink: 0 }} />
              <span style={{ color: "#f1f5f9", fontSize: "13px", fontWeight: 700, whiteSpace: "nowrap" }}>
                {group.label}
              </span>
            </div>
            <div style={{ color: "#64748b", fontSize: "10px", marginTop: "3px", paddingLeft: "16px" }}>
              {fileCount} file{fileCount !== 1 ? "s" : ""} · {group.desc}
            </div>
          </div>
        );
      })}

      {/* Arrow labels (clickable, expand to show file-level details) */}
      {groupDeps.map((dep, i) => {
        const pts = getEdgePoints(dep.source, dep.target);
        if (!pts) return null;

        const edgeKey = `${dep.source}->${dep.target}`;
        const isExpanded = expandedEdge === edgeKey;
        const isRelated = hoveredGroup === dep.source || hoveredGroup === dep.target;
        const isDimmedByHover = hoveredGroup && !isRelated;

        // Position label at midpoint of the curve
        const mx = (pts.sx + pts.tx) / 2;
        const my = (pts.sy + pts.ty) / 2;
        const perpX = -(pts.ty - pts.sy) * 0.12;
        const perpY = (pts.tx - pts.sx) * 0.12;
        const labelX = mx + perpX;
        const labelY = my + perpY;

        const srcGroup = ARCH_GROUPS.find((g) => g.id === dep.source);
        const tgtGroup = ARCH_GROUPS.find((g) => g.id === dep.target);

        return (
          <div
            key={`label-${i}`}
            style={{
              position: "absolute",
              left: labelX,
              top: labelY - 12,
              transform: "translateX(-50%)",
              zIndex: isExpanded ? 20 : 10,
              opacity: isDimmedByHover ? 0.15 : 1,
              transition: "opacity 0.2s",
            }}
          >
            {/* Clickable pill label */}
            <div
              onClick={(e) => { e.stopPropagation(); setExpandedEdge(isExpanded ? null : edgeKey); }}
              style={{
                padding: "3px 10px",
                borderRadius: "10px",
                background: isExpanded ? "#1e3a5f" : "#1e293b",
                border: `1px solid ${isExpanded ? "#60a5fa" : "#334155"}`,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
              }}
            >
              <span style={{ fontSize: "10px", color: isExpanded ? "#60a5fa" : "#94a3b8", fontWeight: 500 }}>
                {dep.label}
              </span>
              <span style={{
                fontSize: "8px", color: "#475569",
                transform: isExpanded ? "rotate(180deg)" : "none",
                transition: "transform 0.2s",
              }}>
                ▾
              </span>
            </div>

            {/* Expanded dropdown with file-level details */}
            {isExpanded && (
              <div style={{
                marginTop: "4px",
                padding: "10px 12px",
                borderRadius: "8px",
                background: "#1e293b",
                border: "1px solid #334155",
                minWidth: "200px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}>
                <div style={{ fontSize: "10px", color: "#64748b", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  <span style={{ color: srcGroup?.color }}>{srcGroup?.label}</span>
                  {" → "}
                  <span style={{ color: tgtGroup?.color }}>{tgtGroup?.label}</span>
                </div>
                {dep.details.length === 0 ? (
                  <div style={{ fontSize: "11px", color: "#475569", fontStyle: "italic" }}>
                    Declared dependency (no direct imports in sample)
                  </div>
                ) : (
                  dep.details.map((d, j) => (
                    <div
                      key={j}
                      onClick={(e) => {
                        e.stopPropagation();
                        const f = getFileById(d.fromId);
                        if (f) onSelect(f);
                      }}
                      style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        padding: "5px 8px", borderRadius: "5px",
                        cursor: "pointer", marginBottom: "2px",
                        background: selected?.id === d.fromId ? "#60a5fa15" : "transparent",
                        transition: "background 0.1s",
                      }}
                    >
                      <span style={{ fontSize: "11px", color: srcGroup?.color, fontWeight: 500 }}>{d.from}</span>
                      <span style={{ fontSize: "10px", color: "#475569" }}>→</span>
                      <span style={{ fontSize: "11px", color: tgtGroup?.color, fontWeight: 500 }}>{d.to}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Legend */}
      <div style={{
        position: "absolute", bottom: "10px", left: "12px", right: "12px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {ARCH_GROUPS.map((g) => (
            <div key={g.id} style={{
              padding: "4px 10px",
              borderRadius: "6px",
              background: `${g.color}15`,
              border: `1px solid ${g.color}30`,
            }}>
              <span style={{ fontSize: "10px", color: g.color, fontWeight: 600 }}>{g.label}</span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: "10px", color: "#475569", fontStyle: "italic" }}>
          Click arrow labels for import details
        </span>
      </div>
    </div>
  );
}

// ============================================================
// View 3: Capability Map (grouped by what files DO)
// ============================================================
function CapabilityMapView({ files, onSelect, selected }) {
  const [expandedCap, setExpandedCap] = useState(null);
  const capabilities = SAMPLE_DATA.capabilities;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px", padding: "4px" }}>
      {Object.entries(capabilities).map(([capName, cap]) => {
        const capFiles = cap.files.map(getFileById).filter(Boolean);
        const isExpanded = expandedCap === capName;
        const annotatedCount = capFiles.filter((f) => f.annotations).length;

        return (
          <div
            key={capName}
            style={{
              background: "#1e293b",
              border: `2px solid ${cap.color}30`,
              borderRadius: "12px",
              overflow: "hidden",
              transition: "all 0.3s ease",
            }}
          >
            {/* Capability header */}
            <div
              onClick={() => setExpandedCap(isExpanded ? null : capName)}
              style={{
                padding: "16px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: isExpanded ? `1px solid ${cap.color}20` : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "24px" }}>{cap.icon}</span>
                <div>
                  <div style={{ color: "#f1f5f9", fontWeight: 600, fontSize: "15px" }}>{capName}</div>
                  <div style={{ color: "#64748b", fontSize: "12px", marginTop: "2px" }}>
                    {capFiles.length} files · {annotatedCount} annotated
                  </div>
                </div>
              </div>
              <div style={{
                width: "28px", height: "28px", borderRadius: "6px",
                background: `${cap.color}20`, display: "flex", alignItems: "center", justifyContent: "center",
                color: cap.color, fontSize: "14px", fontWeight: "bold",
                transform: isExpanded ? "rotate(90deg)" : "none",
                transition: "transform 0.2s",
              }}>
                ›
              </div>
            </div>

            {/* Annotation coverage bar */}
            <div style={{ padding: "0 16px", paddingBottom: isExpanded ? "0" : "12px" }}>
              <div style={{ height: "4px", background: "#0f172a", borderRadius: "2px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(annotatedCount / capFiles.length) * 100}%`, background: cap.color, borderRadius: "2px", transition: "width 0.5s ease" }} />
              </div>
            </div>

            {/* Expanded file list */}
            {isExpanded && (
              <div style={{ padding: "8px 12px 12px" }}>
                {capFiles.map((f) => {
                  const isSelected = selected?.id === f.id;
                  return (
                    <div
                      key={f.id}
                      onClick={(e) => { e.stopPropagation(); onSelect(f); }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "8px",
                        cursor: "pointer",
                        background: isSelected ? `${cap.color}15` : "transparent",
                        border: `1px solid ${isSelected ? cap.color + "40" : "transparent"}`,
                        marginBottom: "4px",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ color: "#e2e8f0", fontSize: "13px", fontWeight: 500 }}>{f.name}</span>
                        {f.annotations && (
                          <span style={{
                            fontSize: "10px", padding: "2px 6px", borderRadius: "4px",
                            background: `${ANNOTATION_COLORS[f.annotations]}20`,
                            color: ANNOTATION_COLORS[f.annotations],
                          }}>
                            ᚲ {f.annotations}
                          </span>
                        )}
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "4px", lineHeight: "1.4" }}>
                        {f.purpose}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// View 4: Onboarding Path (guided reading order)
// ============================================================
function OnboardingPathView({ files, onSelect, selected }) {
  const [activeStep, setActiveStep] = useState(0);
  const path = SAMPLE_DATA.onboardingPath;

  return (
    <div style={{ display: "flex", gap: "24px", height: "500px" }}>
      {/* Path timeline */}
      <div style={{ flex: "0 0 380px", overflowY: "auto", paddingRight: "8px" }}>
        {path.map((step, i) => {
          const file = getFileById(step.fileId);
          if (!file) return null;
          const isActive = activeStep === i;
          const isPast = i < activeStep;
          const mainTag = file.tags?.[0];
          const color = TAG_COLORS[mainTag] || "#64748b";

          return (
            <div key={i} style={{ display: "flex", gap: "16px", marginBottom: "4px" }}>
              {/* Vertical connector */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "32px", flexShrink: 0 }}>
                <div
                  onClick={() => { setActiveStep(i); onSelect(file); }}
                  style={{
                    width: "32px", height: "32px", borderRadius: "50%",
                    background: isActive ? color : isPast ? `${color}60` : "#1e293b",
                    border: `2px solid ${isActive ? color : isPast ? color : "#334155"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: isActive || isPast ? "#fff" : "#64748b",
                    fontSize: "13px", fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.3s ease",
                    boxShadow: isActive ? `0 0 12px ${color}40` : "none",
                  }}
                >
                  {isPast ? "✓" : i + 1}
                </div>
                {i < path.length - 1 && (
                  <div style={{
                    width: "2px", height: "48px",
                    background: isPast ? `${color}40` : "#1e293b",
                    transition: "background 0.3s",
                  }} />
                )}
              </div>

              {/* Step content */}
              <div
                onClick={() => { setActiveStep(i); onSelect(file); }}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: "10px",
                  background: isActive ? `${color}10` : "#1e293b",
                  border: `1px solid ${isActive ? `${color}40` : "#1e293b"}`,
                  cursor: "pointer",
                  marginBottom: "4px",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ color: "#f1f5f9", fontWeight: 600, fontSize: "14px" }}>{file.name}</span>
                  <span style={{ color: "#64748b", fontSize: "11px" }}>{file.path}</span>
                </div>
                <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "4px", lineHeight: "1.5" }}>
                  {step.reason}
                </div>
                {isActive && step.milestone && (
                  <div style={{
                    marginTop: "8px", padding: "6px 10px", borderRadius: "6px",
                    background: `${color}15`, border: `1px solid ${color}25`,
                    fontSize: "11px", color: color, fontWeight: 500,
                  }}>
                    🏁 Milestone: {step.milestone}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* File detail panel */}
      <div style={{ flex: 1, background: "#1e293b", borderRadius: "12px", padding: "24px", overflow: "auto" }}>
        {(() => {
          const step = path[activeStep];
          const file = step ? getFileById(step.fileId) : null;
          if (!file) return <div style={{ color: "#64748b" }}>Select a step</div>;
          const mainTag = file.tags?.[0];
          const color = TAG_COLORS[mainTag] || "#64748b";

          return (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: `${color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", color }}>
                  {activeStep + 1}
                </div>
                <div>
                  <div style={{ color: "#f1f5f9", fontSize: "18px", fontWeight: 700 }}>{file.name}</div>
                  <div style={{ color: "#64748b", fontSize: "12px" }}>{file.path}</div>
                </div>
              </div>

              <div style={{ color: "#cbd5e1", fontSize: "14px", lineHeight: "1.6", marginBottom: "20px" }}>
                {file.purpose}
              </div>

              {/* Tags */}
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
                {file.tags.map((tag) => (
                  <span key={tag} style={{
                    fontSize: "11px", padding: "3px 8px", borderRadius: "4px",
                    background: `${TAG_COLORS[tag] || "#64748b"}20`,
                    color: TAG_COLORS[tag] || "#64748b",
                    fontWeight: 500,
                  }}>
                    {tag}
                  </span>
                ))}
              </div>

              {/* Stats row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                {[
                  ["Lines", file.size],
                  ["Complexity", "●".repeat(file.complexity) + "○".repeat(5 - file.complexity)],
                  ["Annotated", file.annotations ? `ᚲ ${file.annotations}` : "Not yet"],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: "#0f172a", borderRadius: "8px", padding: "10px 12px" }}>
                    <div style={{ color: "#64748b", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                    <div style={{ color: "#e2e8f0", fontSize: "14px", fontWeight: 600, marginTop: "4px" }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Imports */}
              {file.imports?.length > 0 && (
                <div>
                  <div style={{ color: "#64748b", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>Depends on</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {file.imports.map((imp) => {
                      const impFile = getFileById(imp);
                      return (
                        <span
                          key={imp}
                          onClick={() => {
                            const idx = path.findIndex((s) => s.fileId === imp);
                            if (idx >= 0) { setActiveStep(idx); onSelect(impFile); }
                          }}
                          style={{
                            fontSize: "12px", padding: "4px 10px", borderRadius: "6px",
                            background: "#0f172a", color: "#60a5fa",
                            cursor: path.find((s) => s.fileId === imp) ? "pointer" : "default",
                            border: "1px solid #1e3a5f",
                          }}
                        >
                          {impFile?.name || imp}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #334155" }}>
                <button
                  onClick={() => { if (activeStep > 0) { setActiveStep(activeStep - 1); onSelect(getFileById(path[activeStep - 1].fileId)); } }}
                  disabled={activeStep === 0}
                  style={{
                    padding: "8px 16px", borderRadius: "8px", border: "1px solid #334155",
                    background: activeStep === 0 ? "#0f172a" : "#1e293b",
                    color: activeStep === 0 ? "#475569" : "#e2e8f0",
                    cursor: activeStep === 0 ? "default" : "pointer", fontSize: "13px",
                  }}
                >
                  ← Previous
                </button>
                <span style={{ color: "#64748b", fontSize: "12px", alignSelf: "center" }}>
                  {activeStep + 1} of {path.length}
                </span>
                <button
                  onClick={() => { if (activeStep < path.length - 1) { setActiveStep(activeStep + 1); onSelect(getFileById(path[activeStep + 1].fileId)); } }}
                  disabled={activeStep === path.length - 1}
                  style={{
                    padding: "8px 16px", borderRadius: "8px", border: "none",
                    background: activeStep === path.length - 1 ? "#1e293b" : color,
                    color: "#fff",
                    cursor: activeStep === path.length - 1 ? "default" : "pointer", fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  Next →
                </button>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ============================================================
// File Detail Sidebar (shared across views)
// ============================================================
function FileDetailSidebar({ file, onClose }) {
  if (!file) return null;
  const mainTag = file.tags?.[0];
  const color = TAG_COLORS[mainTag] || "#64748b";

  return (
    <div style={{
      width: "300px", background: "#1e293b", borderRadius: "12px",
      padding: "20px", overflow: "auto", flexShrink: 0,
      border: "1px solid #334155",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "16px" }}>
        <div style={{ color: "#f1f5f9", fontSize: "16px", fontWeight: 700 }}>{file.name}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "18px", padding: 0 }}>×</button>
      </div>

      <div style={{ color: "#64748b", fontSize: "12px", marginBottom: "12px", fontFamily: "monospace" }}>{file.path}</div>
      <div style={{ color: "#cbd5e1", fontSize: "13px", lineHeight: "1.6", marginBottom: "16px" }}>{file.purpose}</div>

      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "16px" }}>
        {file.tags?.map((tag) => (
          <span key={tag} style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "4px", background: `${TAG_COLORS[tag] || "#64748b"}20`, color: TAG_COLORS[tag] || "#64748b" }}>
            {tag}
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "16px" }}>
        <div style={{ background: "#0f172a", borderRadius: "8px", padding: "8px 10px" }}>
          <div style={{ color: "#64748b", fontSize: "10px", textTransform: "uppercase" }}>Lines</div>
          <div style={{ color: "#e2e8f0", fontSize: "16px", fontWeight: 700 }}>{file.size}</div>
        </div>
        <div style={{ background: "#0f172a", borderRadius: "8px", padding: "8px 10px" }}>
          <div style={{ color: "#64748b", fontSize: "10px", textTransform: "uppercase" }}>Complexity</div>
          <div style={{ color: color, fontSize: "14px", fontWeight: 700 }}>{"●".repeat(file.complexity || 0)}{"○".repeat(5 - (file.complexity || 0))}</div>
        </div>
      </div>

      {file.annotations && (
        <div style={{ padding: "8px 12px", borderRadius: "8px", background: `${ANNOTATION_COLORS[file.annotations]}10`, border: `1px solid ${ANNOTATION_COLORS[file.annotations]}25`, marginBottom: "16px" }}>
          <div style={{ fontSize: "12px", color: ANNOTATION_COLORS[file.annotations], fontWeight: 600 }}>ᚲ {file.annotations} mode</div>
        </div>
      )}

      {file.imports?.length > 0 && (
        <div>
          <div style={{ color: "#64748b", fontSize: "10px", textTransform: "uppercase", marginBottom: "6px" }}>Dependencies</div>
          {file.imports.map((imp) => (
            <div key={imp} style={{ color: "#60a5fa", fontSize: "12px", padding: "2px 0" }}>→ {getFileById(imp)?.name || imp}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main App — View Mode Switcher
// ============================================================
const VIEW_MODES = [
  { id: "treemap", label: "Repo Tree", icon: "▦", desc: "Files in repo order by directory" },
  { id: "architecture", label: "Architecture", icon: "◉", desc: "Dependency graph" },
  { id: "capability", label: "Capabilities", icon: "⬡", desc: "Grouped by function" },
  { id: "onboarding", label: "Onboarding", icon: "→", desc: "Guided reading path" },
];

export default function GrimoireViewPrototype() {
  const [activeView, setActiveView] = useState("architecture");
  const [selectedFile, setSelectedFile] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const files = SAMPLE_DATA.files;

  const handleSelect = useCallback((file) => {
    setSelectedFile(file);
    if (activeView !== "onboarding") setShowSidebar(true);
  }, [activeView]);

  const handleClose = useCallback(() => {
    setShowSidebar(false);
    setSelectedFile(null);
  }, []);

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "#0f172a", minHeight: "100vh", color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px", fontWeight: 800, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              ᚲ Grimoire
            </span>
            <span style={{ fontSize: "12px", padding: "2px 8px", borderRadius: "4px", background: "#6366f120", color: "#818cf8" }}>
              View Modes Prototype
            </span>
          </div>
          <div style={{ color: "#64748b", fontSize: "12px", marginTop: "4px" }}>
            {files.length} files mapped · {files.filter((f) => f.annotations).length} annotated
          </div>
        </div>
      </div>

      {/* View Mode Tabs */}
      <div style={{ padding: "16px 24px", display: "flex", gap: "8px" }}>
        {VIEW_MODES.map((mode) => {
          const isActive = activeView === mode.id;
          return (
            <button
              key={mode.id}
              onClick={() => { setActiveView(mode.id); setShowSidebar(false); }}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: `1.5px solid ${isActive ? "#6366f1" : "#1e293b"}`,
                background: isActive ? "#6366f115" : "#1e293b",
                color: isActive ? "#818cf8" : "#94a3b8",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: "8px",
                transition: "all 0.2s",
                fontSize: "13px",
              }}
            >
              <span style={{ fontSize: "16px" }}>{mode.icon}</span>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontWeight: 600 }}>{mode.label}</div>
                <div style={{ fontSize: "10px", color: isActive ? "#6366f1" : "#64748b", marginTop: "1px" }}>{mode.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Content Area */}
      <div style={{ padding: "0 24px 24px", display: "flex", gap: "16px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeView === "treemap" && <TreemapView files={files} onSelect={handleSelect} selected={selectedFile} />}
          {activeView === "architecture" && <ArchitectureGraphView files={files} onSelect={handleSelect} selected={selectedFile} />}
          {activeView === "capability" && <CapabilityMapView files={files} onSelect={handleSelect} selected={selectedFile} />}
          {activeView === "onboarding" && <OnboardingPathView files={files} onSelect={handleSelect} selected={selectedFile} />}
        </div>

        {/* Sidebar (not shown for onboarding — it has its own detail panel) */}
        {showSidebar && activeView !== "onboarding" && (
          <FileDetailSidebar file={selectedFile} onClose={handleClose} />
        )}
      </div>
    </div>
  );
}
