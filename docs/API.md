# API Reference

Base URL: `http://localhost:8787`. The dev web server proxies `/api` to it.

All errors have the shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "goodSha: Regression Hunt needs a known working commit", "details": [] } }
```

Common codes: `VALIDATION_ERROR`, `NOT_FOUND`, `INVALID_REPOSITORY_INPUT`, `GITHUB_RATE_LIMIT` (429), `GITHUB_NOT_FOUND`, `GITHUB_NETWORK`, `ANALYSIS_INCOMPLETE` (409), `AI_UNAVAILABLE` (503), `AI_INVALID_OUTPUT` (502), `VERIFICATION_UNSUPPORTED`, `PATCH_DOES_NOT_APPLY`.

## System

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/ai/status[?refresh=1]` | Gemma provider status (`connected`, `unavailable`, `model-missing`, `error`), including a generation probe |
| GET / PUT | `/api/settings` | Runtime settings: provider, endpoint, model, defaults |
| POST | `/api/settings/reset` | Reset to environment defaults |
| GET | `/api/github/status` | Reachability and rate limit |
| POST | `/api/data/clear` | `{ "confirm": "DELETE", "scope": "all" \| "cache" }` |
| GET | `/api/search?q=` | Commits, files, functions, findings, investigations |

## Repositories

| Method | Path | Body / Query |
|---|---|---|
| POST | `/api/repositories/import` | `{ "input": "owner/repo" \| URL \| "demo" }` → `{ repository, branches }` |
| GET | `/api/repositories/:owner/:name` | |
| GET | `/api/repositories/:owner/:name/branches` | |
| GET | `/api/repositories/:owner/:name/commits` | `?branch=&limit=` |
| POST | `/api/demo/launch` | Creates and starts the demo AI-guided investigation |

## Investigations

| Method | Path | Notes |
|---|---|---|
| POST | `/api/investigations` | `{ repositoryId, branch, mode, limit?, since?, until?, goodSha?, badSha?, commitSha?, symptoms?, name? }`. Starts analysis unless `?start=false` |
| GET | `/api/investigations` | List |
| GET | `/api/investigations/:id` | Includes progress, findings, notes, bookmarks |
| PATCH | `/api/investigations/:id` | `name`, `selectedCommitSha`, `knownGoodSha`, `knownBadSha`, `bookmarks`, `notes` |
| DELETE | `/api/investigations/:id` | Cascades |
| POST | `/api/investigations/:id/duplicate` | |
| POST | `/api/investigations/:id/analyze` | Start or resume |
| POST | `/api/investigations/:id/cancel` | |
| GET | `/api/investigations/:id/progress` | **SSE**: `{type:"progress", progress, status}` … `{type:"done", status, error}` |
| GET | `/api/investigations/:id/findings` | `{ findings, bisect }` |
| GET | `/api/investigations/:id/timeline` | `{ commits, assessments, bisect }` |
| GET | `/api/investigations/:id/graph` | Dependency graph |
| GET | `/api/investigations/:id/impact?sha=` | `{ graph, blastRadius }` |
| GET | `/api/investigations/:id/health` | Repository health |
| POST | `/api/compare` | `{ investigationId, base, head }` → files, commits, dependency/config/function changes |
| POST | `/api/files` | `{ investigationId, path, ref }` → file contents |

## AI

| Method | Path | Body |
|---|---|---|
| POST | `/api/ai/analyze` | `{ investigationId, task, commitSha?, compareBase?, level }`. `task` is one of `root-cause`, `semantic-diff`, `impact`, `tests`, `fix`, `alternatives`, `commit-investigation` |
| POST | `/api/ai/tests` | Same as above, with `task: "tests"` |
| POST | `/api/ai/chat` | `{ investigationId?, commitSha?, level, messages[] }`. **SSE** of `meta`, `token`, `done` or `error`. Closing the connection stops generation |
| POST | `/api/ai/fix` | `{ investigationId, commitSha, strategy: "minimal" \| "revert" \| "preventive" }` → `PatchSuggestion` |
| GET | `/api/investigations/:id/ai` | Saved analyses |
| GET | `/api/investigations/:id/patches` | Saved treatments |
| POST | `/api/investigations/:id/patches/:patchId/verify` | Demo only: applies the patch and runs the harness |

## Reports

| Method | Path | Notes |
|---|---|---|
| POST | `/api/reports` | `{ investigationId }`. Builds and stores a report |
| GET | `/api/reports[?investigationId=]` | List |
| GET | `/api/reports/:id` | |
| GET | `/api/reports/:id/export?format=markdown\|json` | Download |
