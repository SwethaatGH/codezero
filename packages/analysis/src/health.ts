import type { Commit, Repository, RepositoryHealth, RiskAssessment } from "@code-zero/shared";
import { isConfigPath, isDocsPath, isLockfile, isManifest, isSourcePath, isTestPath } from "./classify";

/** Repository health metrics computed only from analyzed commits and (optionally) the file tree. */
export function computeHealth(
  commits: Commit[],
  assessments: RiskAssessment[],
  opts: { languages?: Repository["languages"]; treePaths?: string[] | null } = {},
): RepositoryHealth {
  const riskBySha = new Map(assessments.map((a) => [a.commitSha, a.score]));
  const chronological = [...commits].sort((a, b) => a.date.localeCompare(b.date));

  const byDay = new Map<string, { commits: number; additions: number; deletions: number }>();
  for (const c of chronological) {
    const day = c.date.slice(0, 10);
    const d = byDay.get(day) ?? { commits: 0, additions: 0, deletions: 0 };
    d.commits++;
    d.additions += c.stats?.additions ?? c.files.reduce((s, f) => s + f.additions, 0);
    d.deletions += c.stats?.deletions ?? c.files.reduce((s, f) => s + f.deletions, 0);
    byDay.set(day, d);
  }

  const contributors = new Map<string, { commits: number; additions: number; deletions: number }>();
  for (const c of commits) {
    const key = c.author.login ?? c.author.name;
    const d = contributors.get(key) ?? { commits: 0, additions: 0, deletions: 0 };
    d.commits++;
    for (const f of c.files) {
      if (isLockfile(f.path)) continue;
      d.additions += f.additions;
      d.deletions += f.deletions;
    }
    contributors.set(key, d);
  }

  const fileStats = new Map<string, { changes: number; churn: number; risks: number[]; byCommit: Map<string, number> }>();
  type FileStat = { changes: number; churn: number; risks: number[]; byCommit: Map<string, number> };
  for (const c of commits) {
    for (const f of c.files) {
      if (isLockfile(f.path)) continue;
      const s: FileStat = fileStats.get(f.path) ?? { changes: 0, churn: 0, risks: [], byCommit: new Map() };
      s.changes++;
      s.churn += f.additions + f.deletions;
      s.risks.push(riskBySha.get(c.sha) ?? 0);
      s.byCommit.set(c.sha, f.additions + f.deletions);
      fileStats.set(f.path, s);
    }
  }
  const hotspots = [...fileStats]
    .map(([path, s]) => ({
      path,
      changes: s.changes,
      churn: s.churn,
      avgRisk: Math.round(s.risks.reduce((a, b) => a + b, 0) / s.risks.length),
      maxRisk: Math.max(...s.risks),
    }))
    .sort((a, b) => b.changes * 10 + b.avgRisk - (a.changes * 10 + a.avgRisk))
    .slice(0, 15);

  const heatFiles = [...fileStats].sort((a, b) => b[1].churn - a[1].churn).slice(0, 12);
  const churnHeatmap = heatFiles.map(([path, s]) => ({
    path,
    byCommit: chronological.map((c) => ({ sha: c.sha, churn: s.byCommit.get(c.sha) ?? 0 })),
  }));

  const manifestChanges: RepositoryHealth["manifestChanges"] = [];
  const testChanges: RepositoryHealth["testChanges"] = [];
  const configChanges: RepositoryHealth["configChanges"] = [];
  for (const c of commits)
    for (const f of c.files) {
      if (isManifest(f.path)) manifestChanges.push({ sha: c.sha, path: f.path });
      if (isTestPath(f.path)) testChanges.push({ sha: c.sha, path: f.path });
      if (isConfigPath(f.path)) configChanges.push({ sha: c.sha, path: f.path });
    }

  const tree = opts.treePaths ?? null;
  const testFileCount = tree ? tree.filter(isTestPath).length : new Set(testChanges.map((t) => t.path)).size;
  const sourceFileCount = tree ? tree.filter((p) => isSourcePath(p) && !isTestPath(p)).length : 0;

  const languageBreakdown = opts.languages
    ? Object.entries(opts.languages).map(([language, bytes]) => ({ language, bytes })).sort((a, b) => b.bytes - a.bytes)
    : null;

  const riskTrend = chronological.map((c) => ({ sha: c.sha, shortSha: c.shortSha, date: c.date, score: riskBySha.get(c.sha) ?? 0 }));

  // Summary sentences — every number below is derived from the data above.
  const summary: string[] = [];
  const days = byDay.size;
  if (commits.length) {
    summary.push(`${commits.length} commits analyzed across ${days} active day(s) by ${contributors.size} contributor(s).`);
    const totalChurn = [...fileStats.values()].reduce((s, f) => s + f.churn, 0);
    const top3 = hotspots.slice(0, 3);
    const top3Churn = top3.reduce((s, h) => s + h.churn, 0);
    if (totalChurn > 0 && top3.length)
      summary.push(`Change concentration: the top ${top3.length} file(s) account for ${Math.round((top3Churn / totalChurn) * 100)}% of non-lockfile churn (${top3.map((h) => h.path).join(", ")}).`);
    const risky = hotspots.filter((h) => h.maxRisk >= 40 && !isDocsPath(h.path));
    if (risky.length) summary.push(`Potential risk hotspots (changed in a commit scoring ≥ 40): ${risky.slice(0, 5).map((h) => h.path).join(", ")}.`);
    const commitsWithTests = new Set(testChanges.map((t) => t.sha)).size;
    summary.push(`Testing signals: ${commitsWithTests} of ${commits.length} commits modified test files. This is not a coverage measurement.`);
    if (manifestChanges.length) summary.push(`${new Set(manifestChanges.map((m) => m.sha)).size} commit(s) changed dependency manifests.`);
    const review = hotspots.filter((h) => h.changes >= 2 && h.avgRisk >= 25 && !isDocsPath(h.path));
    if (review.length) summary.push(`Areas requiring review: ${review.slice(0, 4).map((h) => h.path).join(", ")} (repeatedly changed with elevated heuristic risk).`);
  } else {
    summary.push("No commits analyzed yet.");
  }

  return {
    commitActivity: [...byDay].map(([date, d]) => ({ date, ...d })),
    contributors: [...contributors].map(([name, d]) => ({ name, ...d })).sort((a, b) => b.commits - a.commits),
    hotspots,
    churnHeatmap,
    riskTrend,
    languageBreakdown,
    manifestChanges,
    testChanges,
    configChanges,
    testFileCount,
    sourceFileCount,
    summary,
  };
}
