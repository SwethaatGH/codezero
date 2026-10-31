const EXT_LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", rb: "Ruby", php: "PHP",
  cs: "C#", cpp: "C++", cc: "C++", c: "C", h: "C", swift: "Swift", scala: "Scala",
  vue: "Vue", svelte: "Svelte", css: "CSS", scss: "SCSS", html: "HTML", md: "Markdown",
  json: "JSON", yml: "YAML", yaml: "YAML", toml: "TOML", sh: "Shell", sql: "SQL",
};

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|so|dylib|dll|exe|bin|wasm|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|ogg|wav|flac|psd|sketch|fig|node|pyc|lockb)$/i;

const MANIFESTS = new Set([
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "npm-shrinkwrap.json",
  "requirements.txt", "pipfile", "pipfile.lock", "pyproject.toml", "poetry.lock", "setup.py", "setup.cfg",
  "go.mod", "go.sum", "cargo.toml", "cargo.lock", "gemfile", "gemfile.lock", "composer.json", "composer.lock",
  "pom.xml", "build.gradle", "build.gradle.kts", "mix.exs", "pubspec.yaml",
]);

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function extension(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i + 1).toLowerCase();
}

export function languageOf(path: string): string | null {
  const b = basename(path).toLowerCase();
  if (b === "dockerfile") return "Dockerfile";
  return EXT_LANG[extension(path)] ?? null;
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.test(path);
}

export function isManifest(path: string): boolean {
  return MANIFESTS.has(basename(path).toLowerCase());
}

export function isLockfile(path: string): boolean {
  return /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock|gemfile\.lock|composer\.lock|go\.sum|pipfile\.lock|npm-shrinkwrap\.json)$/i.test(path);
}

export function isTestPath(path: string): boolean {
  return (
    /(^|\/)(__tests__|tests?|spec|specs|e2e|cypress|playwright)\//i.test(path) ||
    /\.(test|spec|e2e)\.[a-z]+$/i.test(path) ||
    /(^|\/)test_[^/]+\.py$/i.test(path) ||
    /_test\.(go|py|rb)$/i.test(path)
  );
}

export function isConfigPath(path: string): boolean {
  if (isManifest(path) || /\.(md|mdx|rst|txt)$/i.test(path)) return false;
  const b = basename(path).toLowerCase();
  return (
    /^\.env(\..+)?$/.test(b) ||
    /\.config\.[cm]?[jt]s$/.test(b) ||
    /^(tsconfig.*\.json|\.eslintrc.*|\.prettierrc.*|\.babelrc.*|dockerfile|docker-compose.*\.ya?ml|makefile|\.npmrc|\.nvmrc|vercel\.json|netlify\.toml|fly\.toml|procfile)$/.test(b) ||
    /(^|\/)(config|configs|\.github|\.circleci|deploy|k8s|helm)\//.test(path.toLowerCase()) ||
    /(^|\/)config\.[a-z]+$/.test(path.toLowerCase()) ||
    /\.(ya?ml|toml|ini)$/.test(b)
  );
}

export function isDocsPath(path: string): boolean {
  return /\.(md|mdx|rst|txt)$/i.test(path) || /(^|\/)docs?\//i.test(path) || /^license/i.test(basename(path));
}

export function isJsTs(path: string): boolean {
  return /\.(m|c)?(t|j)sx?$/i.test(path) && !/\.d\.ts$/i.test(path) && !/\.min\.js$/i.test(path);
}

export function isSourcePath(path: string): boolean {
  const lang = languageOf(path);
  if (!lang) return false;
  if (["Markdown", "JSON", "YAML", "TOML", "HTML", "CSS", "SCSS"].includes(lang)) return false;
  return !isDocsPath(path) && !isConfigPath(path);
}

export function isIgnoredForGraph(path: string): boolean {
  return /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|\.nuxt|\.git)\//.test(path) || /\.min\.js$/.test(path);
}

const CRITICAL_RE = /(auth|login|session|token|secur|crypt|password|permission|acl|payment|billing|checkout|invoice|price|pricing|discount|tax|money|currency|transaction|migration|schema|database|db\/)/i;
export function criticalPathKeyword(path: string): string | null {
  const m = CRITICAL_RE.exec(path);
  return m ? m[1].toLowerCase() : null;
}

/** Top-level grouping used by the Infection Map. */
export function moduleOf(path: string): string {
  const parts = path.split("/");
  if (parts.length === 1) return "(root)";
  if (["src", "lib", "app", "packages", "apps", "pkg", "internal", "cmd"].includes(parts[0]) && parts.length > 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}
