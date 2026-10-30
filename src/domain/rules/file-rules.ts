const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
]);

const OUTPUT_DIRS = new Set(["dist", "build", "out", ".next", ".nuxt", "coverage", "node_modules", "vendor"]);

const GENERATED_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.map$/,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.generated\.\w+$/,
  /\.pb\.go$/,
];

/**
 * Returns why a file should be left out of the analysis, or null when it is relevant.
 */
export function noiseReason(path: string): string | null {
  const segments = path.split("/");
  const fileName = segments.at(-1) ?? path;
  const directories = segments.slice(0, -1);

  if (LOCKFILES.has(fileName)) return "lockfile";
  if (directories.some((dir) => OUTPUT_DIRS.has(dir))) return "build output or vendored code";
  if (GENERATED_PATTERNS.some((pattern) => pattern.test(path))) return "generated or minified file";
  return null;
}

const TEST_PATTERNS = [
  /(^|\/)(__tests__|tests?|specs?)\//,
  /(^|\/)(tests?|specs?)\.\w+$/,
  /\.(test|spec)(-d)?\.\w+$/,
  /_test\.(go|py)$/,
  /(^|\/)test_\w+\.py$/,
];

export const FilePriority = { Source: 0, Test: 1, Docs: 2 } as const;
export type FilePriority = (typeof FilePriority)[keyof typeof FilePriority];

/**
 * Ranks files so the token budget is spent on source code before tests and docs.
 */
export function filePriority(path: string): FilePriority {
  if (TEST_PATTERNS.some((pattern) => pattern.test(path))) {
    return FilePriority.Test;
  }
  if (/\.(md|mdx|rst|txt)$/i.test(path) || /^docs?\//.test(path)) {
    return FilePriority.Docs;
  }
  return FilePriority.Source;
}
