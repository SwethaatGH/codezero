export interface RepoRef {
  owner: string;
  name: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Parses a GitHub repository reference. Accepts:
 *  - owner/name
 *  - https://github.com/owner/name(.git)(/tree/...)
 *  - github.com/owner/name
 *  - git@github.com:owner/name.git
 * Returns null for anything else.
 */
export function parseRepoInput(raw: string): RepoRef | null {
  const input = raw.trim();
  if (!input) return null;

  let path: string | null = null;
  const ssh = /^git@github\.com:(.+)$/i.exec(input);
  if (ssh) {
    path = ssh[1];
  } else if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(input)) {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (url.hostname.replace(/^www\./, "").toLowerCase() !== "github.com") return null;
    path = url.pathname;
  } else if (/^[^/\s:]+\/[^/\s:]+\/?$/.test(input)) {
    path = input;
  } else {
    return null;
  }

  const parts = path.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, "");
  if (!SEGMENT.test(owner) || !SEGMENT.test(name) || name === "." || name === "..") return null;
  return { owner, name };
}
