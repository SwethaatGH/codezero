import { Octokit } from "@octokit/rest";
import type { Branch, ChangedFile, Commit, FileStatus, Repository } from "@code-zero/shared";
import { buildDemoHistory, demoFileAt, isBinaryPath } from "@code-zero/analysis";
import { env } from "./config";
import type { DB } from "./db";
import { ApiError } from "./errors";

export interface ListCommitsOptions {
  branch: string;
  limit: number;
  since: string | null;
  until: string | null;
}

/** Abstraction over where repository data comes from. Implemented for GitHub and the offline demo. */
export interface RepoSource {
  readonly isDemo: boolean;
  getRepository(): Promise<Repository>;
  listBranches(): Promise<Branch[]>;
  listCommits(opts: ListCommitsOptions): Promise<Commit[]>; // newest first, without file details
  getCommit(sha: string): Promise<Commit>; // with files and patches
  /** Commits reachable from head but not base, oldest → newest (capped). */
  commitsBetween(base: string, head: string, cap: number): Promise<{ commits: Commit[]; total: number }>;
  compareFiles(base: string, head: string): Promise<ChangedFile[]>;
  getFile(path: string, ref: string): Promise<string | null>;
  getTree(ref: string): Promise<{ paths: string[]; truncated: boolean }>;
}

// ─── GitHub ──────────────────────────────────────────────────────────

const HOUR = 3_600_000;

function toStatus(s: string | undefined): FileStatus {
  return (["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"].includes(s ?? "") ? s : "modified") as FileStatus;
}

interface GhFile {
  filename: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

function mapFiles(files: GhFile[] | undefined): ChangedFile[] {
  return (files ?? []).map((f) => {
    const binary = isBinaryPath(f.filename);
    const changes = (f.additions ?? 0) + (f.deletions ?? 0);
    return {
      path: f.filename,
      previousPath: f.previous_filename ?? null,
      status: toStatus(f.status),
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      patch: binary ? null : (f.patch ?? null),
      binary,
      truncated: !binary && f.patch === undefined && changes > 0,
    };
  });
}

interface GhCommit {
  sha: string;
  html_url?: string;
  commit: { message: string; author?: { name?: string; email?: string; date?: string } | null; committer?: { date?: string } | null };
  author?: { login?: string; avatar_url?: string } | null;
  parents?: { sha: string }[];
  stats?: { additions?: number; deletions?: number; total?: number };
  files?: GhFile[];
}

function mapCommit(c: GhCommit): Commit {
  return {
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: c.commit.message,
    author: {
      name: c.commit.author?.name ?? c.author?.login ?? "unknown",
      email: c.commit.author?.email ?? null,
      login: c.author?.login ?? null,
      avatarUrl: c.author?.avatar_url ?? null,
    },
    date: c.commit.author?.date ?? c.commit.committer?.date ?? new Date(0).toISOString(),
    parents: (c.parents ?? []).map((p) => p.sha),
    stats: c.stats ? { additions: c.stats.additions ?? 0, deletions: c.stats.deletions ?? 0, total: c.stats.total ?? 0 } : null,
    files: mapFiles(c.files),
    url: c.html_url ?? null,
  };
}

export function translateGitHubError(err: unknown, what: string): ApiError {
  const e = err as { status?: number; message?: string; response?: { headers?: Record<string, string> } };
  const headers = e.response?.headers ?? {};
  if ((e.status === 403 || e.status === 429) && (headers["x-ratelimit-remaining"] === "0" || /rate limit/i.test(e.message ?? ""))) {
    const reset = headers["x-ratelimit-reset"] ? new Date(Number(headers["x-ratelimit-reset"]) * 1000).toISOString() : null;
    return new ApiError(429, "GITHUB_RATE_LIMIT", `GitHub API rate limit exceeded${reset ? `; resets at ${reset}` : ""}. Set GITHUB_TOKEN in .env to raise the limit.`, { reset });
  }
  if (e.status === 404) return new ApiError(404, "GITHUB_NOT_FOUND", `${what} was not found on GitHub (or it is private).`);
  if (e.status === 422) return new ApiError(422, "GITHUB_UNPROCESSABLE", `GitHub could not process the request for ${what}: ${e.message ?? "invalid reference"}`);
  if (e.status === 401) return new ApiError(401, "GITHUB_UNAUTHORIZED", "GitHub rejected the configured GITHUB_TOKEN.");
  if (e.status === 409) return new ApiError(409, "GITHUB_EMPTY", `${what} is empty.`);
  if (!e.status) return new ApiError(502, "GITHUB_NETWORK", `Could not reach GitHub while fetching ${what}: ${e.message ?? "network error"}`);
  return new ApiError(502, "GITHUB_ERROR", `GitHub error ${e.status} while fetching ${what}: ${e.message ?? ""}`);
}

export function createOctokit() {
  return new Octokit({ auth: env.githubToken ?? undefined, userAgent: "code-zero/0.1", request: { timeout: 20_000 } });
}

export class GitHubSource implements RepoSource {
  readonly isDemo = false;
  private gh = createOctokit();
  constructor(
    private db: DB,
    private owner: string,
    private repo: string,
  ) {}

  private async cached<T>(key: string, ttl: number | null, what: string, fn: () => Promise<T>): Promise<T> {
    const full = `gh:${this.owner}/${this.repo}:${key}`;
    const hit = this.db.cacheGet<T>(full);
    if (hit !== null) return hit;
    try {
      const v = await fn();
      this.db.cacheSet(full, v, ttl);
      return v;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw translateGitHubError(err, what);
    }
  }

  getRepository(): Promise<Repository> {
    return this.cached("repo", 10 * 60_000, `${this.owner}/${this.repo}`, async () => {
      const { data } = await this.gh.repos.get({ owner: this.owner, repo: this.repo });
      const [languages, contributors, latest] = await Promise.all([
        this.gh.repos.listLanguages({ owner: this.owner, repo: this.repo }).then((r) => r.data as Record<string, number>).catch(() => null),
        this.gh.repos
          .listContributors({ owner: this.owner, repo: this.repo, per_page: 1, anon: "true" })
          .then((r) => {
            const link = r.headers.link ?? "";
            const m = /[?&]page=(\d+)>; rel="last"/.exec(link);
            return m ? Number(m[1]) : r.data.length;
          })
          .catch(() => null),
        this.gh.repos.listCommits({ owner: this.owner, repo: this.repo, per_page: 1 }).then((r) => r.data[0]?.sha ?? null).catch(() => null),
      ]);
      return {
        id: data.full_name,
        owner: data.owner.login,
        name: data.name,
        fullName: data.full_name,
        description: data.description,
        primaryLanguage: data.language ?? null,
        languages,
        stars: data.stargazers_count,
        forks: data.forks_count,
        openIssues: data.open_issues_count,
        defaultBranch: data.default_branch,
        htmlUrl: data.html_url,
        contributorsCount: contributors,
        latestCommitSha: latest,
        isDemo: false,
        importedAt: new Date().toISOString(),
      } satisfies Repository;
    });
  }

  listBranches(): Promise<Branch[]> {
    return this.cached("branches", 5 * 60_000, "branches", async () => {
      const { data } = await this.gh.repos.listBranches({ owner: this.owner, repo: this.repo, per_page: 100 });
      return data.map((b) => ({ name: b.name, sha: b.commit.sha, protected: b.protected ?? null }));
    });
  }

  listCommits(o: ListCommitsOptions): Promise<Commit[]> {
    return this.cached(`commits:${o.branch}:${o.limit}:${o.since}:${o.until}`, 2 * 60_000, `commits on ${o.branch}`, async () => {
      const { data } = await this.gh.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        sha: o.branch,
        per_page: Math.min(100, o.limit),
        since: o.since ?? undefined,
        until: o.until ?? undefined,
      });
      return (data as GhCommit[]).map(mapCommit);
    });
  }

  getCommit(sha: string): Promise<Commit> {
    // Commits are immutable: cache by full SHA forever.
    return this.cached(`commit:${sha}`, sha.length === 40 ? null : HOUR, `commit ${sha.slice(0, 7)}`, async () => {
      const { data } = await this.gh.repos.getCommit({ owner: this.owner, repo: this.repo, ref: sha });
      return mapCommit(data as GhCommit);
    });
  }

  async commitsBetween(base: string, head: string, cap: number) {
    return this.cached(`between:${base}:${head}:${cap}`, HOUR, `${base.slice(0, 7)}...${head.slice(0, 7)}`, async () => {
      const { data } = await this.gh.repos.compareCommitsWithBasehead({ owner: this.owner, repo: this.repo, basehead: `${base}...${head}`, per_page: 100 });
      if (data.status === "behind") throw new ApiError(422, "INVALID_RANGE", "The 'broken' commit is older than the 'working' commit. Swap them.");
      const commits = (data.commits as GhCommit[]).map(mapCommit);
      return { commits: commits.slice(-cap), total: data.total_commits };
    });
  }

  async compareFiles(base: string, head: string): Promise<ChangedFile[]> {
    return this.cached(`compare:${base}:${head}`, HOUR, `comparison ${base.slice(0, 7)}...${head.slice(0, 7)}`, async () => {
      const { data } = await this.gh.repos.compareCommitsWithBasehead({ owner: this.owner, repo: this.repo, basehead: `${base}...${head}`, per_page: 1 });
      return mapFiles(data.files as GhFile[]);
    });
  }

  async getFile(path: string, ref: string): Promise<string | null> {
    const key = `gh:${this.owner}/${this.repo}:file:${ref}:${path}`;
    const hit = this.db.cacheGet<{ content: string | null }>(key);
    if (hit) return hit.content;
    if (isBinaryPath(path)) return null;
    // raw.githubusercontent.com does not consume REST API quota.
    const url = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: env.githubToken ? { Authorization: `token ${env.githubToken}` } : {}, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new ApiError(502, "GITHUB_NETWORK", `Could not fetch ${path}@${ref.slice(0, 7)}: ${(err as Error).message}`);
    }
    if (res.status === 404) {
      this.db.cacheSet(key, { content: null }, ref.length === 40 ? null : HOUR);
      return null;
    }
    if (!res.ok) throw new ApiError(502, "GITHUB_ERROR", `raw.githubusercontent.com returned ${res.status} for ${path}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > env.maxFileBytes) throw new ApiError(413, "FILE_TOO_LARGE", `${path} is ${len} bytes; limit is ${env.maxFileBytes}`);
    const text = await res.text();
    if (text.length > env.maxFileBytes) throw new ApiError(413, "FILE_TOO_LARGE", `${path} exceeds ${env.maxFileBytes} bytes`);
    if (text.includes("\u0000")) return null; // binary content
    this.db.cacheSet(key, { content: text }, ref.length === 40 ? null : HOUR);
    return text;
  }

  getTree(ref: string) {
    return this.cached(`tree:${ref}`, ref.length === 40 ? null : HOUR, `file tree at ${ref.slice(0, 7)}`, async () => {
      const { data } = await this.gh.git.getTree({ owner: this.owner, repo: this.repo, tree_sha: ref, recursive: "1" });
      return { paths: data.tree.filter((t) => t.type === "blob" && t.path).map((t) => t.path!), truncated: data.truncated };
    });
  }
}

// ─── Demo (offline, simulated) ───────────────────────────────────────

export class DemoSource implements RepoSource {
  readonly isDemo = true;
  private h = buildDemoHistory();

  private find(ref: string): Commit {
    const c = this.h.commits.find((x) => x.sha.startsWith(ref.toLowerCase())) ?? (ref === "main" || ref === "HEAD" ? this.h.commits[0] : undefined);
    if (!c) throw new ApiError(404, "COMMIT_NOT_FOUND", `Commit ${ref} does not exist in the demo repository`);
    return c;
  }

  async getRepository() {
    return { ...this.h.repository, importedAt: new Date().toISOString() };
  }
  async listBranches() {
    return [{ name: "main", sha: this.h.commits[0].sha, protected: true }];
  }
  async listCommits(o: ListCommitsOptions) {
    if (o.branch !== "main") throw new ApiError(404, "BRANCH_NOT_FOUND", `Branch ${o.branch} does not exist in the demo repository`);
    return this.h.commits
      .filter((c) => (!o.since || c.date >= o.since) && (!o.until || c.date <= o.until))
      .slice(0, o.limit)
      .map((c) => ({ ...c, files: [] }));
  }
  async getCommit(sha: string) {
    return this.find(sha);
  }
  async commitsBetween(base: string, head: string, cap: number) {
    const chrono = [...this.h.commits].reverse();
    const b = chrono.indexOf(this.find(base));
    const hd = chrono.indexOf(this.find(head));
    if (hd <= b) throw new ApiError(422, "INVALID_RANGE", "The 'broken' commit must be newer than the 'working' commit.");
    const commits = chrono.slice(b + 1, hd + 1);
    return { commits: commits.slice(-cap), total: commits.length };
  }
  async compareFiles(base: string, head: string): Promise<ChangedFile[]> {
    const { createUnifiedPatch, parsePatch, countPatch } = await import("@code-zero/analysis");
    const a = this.h.snapshots.get(this.find(base).sha)!;
    const b = this.h.snapshots.get(this.find(head).sha)!;
    const paths = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const out: ChangedFile[] = [];
    for (const p of paths) {
      if (a[p] === b[p]) continue;
      const full = createUnifiedPatch(p, a[p] ?? "", b[p] ?? "");
      const patch = full.slice(full.indexOf("@@"));
      const { additions, deletions } = countPatch(parsePatch(patch));
      out.push({ path: p, previousPath: null, status: a[p] === undefined ? "added" : b[p] === undefined ? "removed" : "modified", additions, deletions, patch, binary: false, truncated: false });
    }
    return out;
  }
  async getFile(path: string, ref: string) {
    return demoFileAt(this.find(ref).sha, path);
  }
  async getTree(ref: string) {
    return { paths: Object.keys(this.h.snapshots.get(this.find(ref).sha) ?? {}), truncated: false };
  }
}

export function sourceFor(db: DB, repositoryId: string): RepoSource {
  if (repositoryId.startsWith("demo/")) return new DemoSource();
  const [owner, repo] = repositoryId.split("/");
  if (!owner || !repo) throw new ApiError(400, "INVALID_REPOSITORY", `Invalid repository id: ${repositoryId}`);
  return new GitHubSource(db, owner, repo);
}
