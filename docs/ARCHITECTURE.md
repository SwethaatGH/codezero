# Architecture

## Overview

CODE ZERO is an npm-workspaces monorepo written in TypeScript end to end.

```text
Browser (apps/web)  ──HTTP/SSE──▶  API (apps/api)  ──▶ GitHub REST (Octokit) + raw.githubusercontent.com
                                         │         ──▶ Ollama /api/chat  or  Gemini API (Gemma 4)
                                         │
                                         ├── packages/analysis  (pure analysis engine)
                                         ├── packages/shared    (types + Zod schemas)
                                         └── SQLite (better-sqlite3)
```

All GitHub calls, model inference and repository processing happen in the backend. The browser never sees a token.

## Packages

### `packages/shared`
- `types.ts`: the domain model (`Repository`, `Commit`, `ChangedFile`, `CodeFunction`, `DependencyNode`/`Edge`/`Graph`, `RiskSignal`, `RiskAssessment`, `RegressionFinding`, `EvidenceReference`, `Investigation`, `AIAnalysis`, `PatchSuggestion`, `VerificationResult`, `InvestigationReport`, `RepositoryHealth`, …). Unknown values are `null`, not invented defaults.
- `schemas.ts`: Zod schemas for every request body and for the AI output contract.

### `packages/analysis`
Pure functions, unit-tested:

| Module | Responsibility |
|---|---|
| `github-url.ts` | Parse URL / `owner/repo` / SSH forms |
| `diff.ts` | Unified-diff hunk parser with old/new line tracking |
| `classify.ts` | Language, test, manifest, config, binary, critical-path detection |
| `ast.ts` | TypeScript compiler AST: functions, classes, methods, arrow functions, imports (incl. `require`, dynamic, re-exports), identifier and namespace calls |
| `graph.ts` | Dependency graph (file + function nodes; import, call, contains edges, each with evidence), relative import resolution, Python regex imports, fan-in, blast radius |
| `risk.ts` | Signal detection and capped weights → score 0–100 |
| `ranking.ts` | Top-N findings with status and verification steps |
| `health.ts` | Activity, churn, hotspots, risk trend, summary sentences |
| `compare.ts` | `package.json` dependency diff, AST function diff |
| `patch.ts` | Unified patch creation and validation |
| `report.ts` | Report assembly and Markdown rendering |
| `demo/` | Simulated repository fixture, deterministic history builder, isolated verification harness and bisect |

## Analysis pipeline (`apps/api/src/pipeline.ts`)

| Stage | Work | Bounds |
|---|---|---|
| connect / metadata | `repos.get`, languages, contributor count | cached 10 min |
| commits | list / compare / single, by mode | `limit` ≤ 100 |
| diffs | `repos.getCommit` per SHA, 4 concurrent | cached forever by SHA |
| parse | changed JS/TS files at each commit via raw.githubusercontent.com → AST | ≤ 8 files/commit, ≤ 300 KB/file |
| dependencies | recursive tree at head → prioritized source files → graph | ≤ 250 files |
| risk | assess, rank, health; demo bisect | — |
| ai-context | Gemma status probe | — |

Progress events are persisted on the investigation and streamed via an `EventEmitter` → SSE. Analysis can be cancelled (`AbortController`). If the server restarts mid-analysis, the investigation is marked resumable.

## Risk scoring

Each signal has a cap and a detection type:

- **AST:** function modified, high fan-in.
- **Heuristic:** removed validation, error handling, control flow, critical path, import change, test assertions removed, symptom match.
- **Metadata:** manifests, config, large diff, missing tests.

The score is the sum of the signals, clamped to 100. To reduce false positives:

- a guard-like line counts as "removed" only when fewer than 70% of its tokens reappear in added lines;
- signals about changing existing behavior ignore newly added files;
- lockfiles don't count toward churn.

## Gemma integration (`apps/api/src/ai/`)

- `provider.ts` handles both providers:
  - **Ollama:** `/api/tags` plus a one-token probe, then `/api/chat` with `format: <JSON schema>` and `think: false`, falling back to a request without `think` if that's rejected.
  - **Gemini API:** `generateContent` and `streamGenerateContent`; system prompts are folded into the first user turn.
- JSON is extracted and validated with Zod; on failure the model gets one retry, told the exact validation error.
- `context.ts` builds a **bounded** context of about 14k diff characters plus signals. Every citable item carries an ID: signal evidence `<sha>-<n>`, diffs `diff:<path>`, demo test results `test:<sha>`.
- `service.ts` strips cited IDs that were not in the context and records them in `unknownEvidenceIds`.
- `prerecorded.ts` serves demo-only fallback content labeled `source: "prerecorded-demo"`. Its evidence IDs are looked up from the real assessment, so the citations stay valid.

## Persistence

SQLite tables: `repositories`, `investigations`, `analysis_results`, `ai_analyses`, `patches`, `reports`, `http_cache`, `settings`. Child rows cascade on investigation delete.

## Frontend

- **Routing:** each module is a lazy route. The selected investigation, commit and compare pair live in the URL (`?inv=&commit=&a=&b=`), so modules stay in sync and deep links and back/forward work.
- **Data:** TanStack Query, plus an SSE bridge that writes progress into the cache.
- **UI state:** Zustand, persisted (sidebar, motion, explanation level, notifications).
- **Rendering:** Monaco is bundled locally (no CDN), with syntax highlighting only. React Flow and dagre draw the graphs, Recharts the charts.
- **Design tokens:** defined in `index.css` via Tailwind v4 `@theme`.
