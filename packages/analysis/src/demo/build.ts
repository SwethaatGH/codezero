import { createHash } from "node:crypto";
import type { ChangedFile, Commit, Repository } from "@code-zero/shared";
import { structuredPatch } from "diff";
import { DEMO_COMMITS, DEMO_REPO } from "./fixture";

export interface DemoHistory {
  repository: Repository;
  /** newest first, matching GitHub's commit listing order */
  commits: Commit[];
  snapshots: Map<string, Record<string, string>>;
}

let cached: DemoHistory | null = null;

function hunkText(oldStr: string, newStr: string): { patch: string; additions: number; deletions: number } {
  const p = structuredPatch("a", "b", oldStr, newStr, "", "", { context: 3 });
  let additions = 0;
  let deletions = 0;
  const out: string[] = [];
  for (const h of p.hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) {
      if (l.startsWith("\\")) continue;
      if (l[0] === "+") additions++;
      if (l[0] === "-") deletions++;
      out.push(l);
    }
  }
  return { patch: out.join("\n"), additions, deletions };
}

/** Builds the simulated demo history. Deterministic: same SHAs and diffs on every run. */
export function buildDemoHistory(): DemoHistory {
  if (cached) return cached;
  const snapshots = new Map<string, Record<string, string>>();
  const chronological: Commit[] = [];
  let tree: Record<string, string> = {};
  let parent: string | null = null;

  for (const spec of DEMO_COMMITS) {
    const next = { ...tree };
    const files: ChangedFile[] = [];
    for (const [path, content] of Object.entries(spec.changes)) {
      const before = tree[path] ?? null;
      if (content === null) delete next[path];
      else next[path] = content;
      const { patch, additions, deletions } = hunkText(before ?? "", content ?? "");
      files.push({
        path,
        previousPath: null,
        status: before === null ? "added" : content === null ? "removed" : "modified",
        additions,
        deletions,
        patch,
        binary: false,
        truncated: false,
      });
    }
    const sha: string = createHash("sha1")
      .update(`${parent ?? ""}\n${spec.message}\n${spec.date}\n${JSON.stringify(next)}`)
      .digest("hex");
    const additions = files.reduce((s, f) => s + f.additions, 0);
    const deletions = files.reduce((s, f) => s + f.deletions, 0);
    chronological.push({
      sha,
      shortSha: sha.slice(0, 7),
      message: spec.message,
      author: { name: spec.author.name, email: spec.author.email, login: spec.author.login, avatarUrl: null },
      date: spec.date,
      parents: parent ? [parent] : [],
      stats: { additions, deletions, total: additions + deletions },
      files,
      url: null,
    });
    snapshots.set(sha, next);
    tree = next;
    parent = sha;
  }

  const commits = [...chronological].reverse();
  const contributors = new Set(commits.map((c) => c.author.login)).size;
  cached = {
    repository: {
      id: `demo/${DEMO_REPO.name}`,
      owner: DEMO_REPO.owner,
      name: DEMO_REPO.name,
      fullName: `${DEMO_REPO.owner}/${DEMO_REPO.name}`,
      description: DEMO_REPO.description,
      primaryLanguage: "TypeScript",
      languages: DEMO_REPO.languages,
      stars: null,
      forks: null,
      openIssues: null,
      defaultBranch: DEMO_REPO.defaultBranch,
      htmlUrl: null,
      contributorsCount: contributors,
      latestCommitSha: commits[0].sha,
      isDemo: true,
      importedAt: new Date(0).toISOString(),
    },
    commits,
    snapshots,
  };
  return cached;
}

export function demoFileAt(sha: string, path: string): string | null {
  const snap = buildDemoHistory().snapshots.get(sha);
  return snap?.[path] ?? null;
}
