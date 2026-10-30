import { describe, expect, it } from "vitest";
import { FilePriority, filePriority, noiseReason } from "./file-rules.ts";

describe("noiseReason", () => {
  it.each([
    ["package-lock.json", "lockfile"],
    ["apps/web/pnpm-lock.yaml", "lockfile"],
    ["go.sum", "lockfile"],
    ["dist/index.js", "build output or vendored code"],
    ["packages/core/build/out.js", "build output or vendored code"],
    ["vendor/github.com/pkg/errors/errors.go", "build output or vendored code"],
    ["public/app.min.js", "generated or minified file"],
    ["src/index.js.map", "generated or minified file"],
    ["src/__snapshots__/button.test.tsx.snap", "generated or minified file"],
    ["src/api/client.generated.ts", "generated or minified file"],
  ])("%s é ruído (%s)", (path, reason) => {
    expect(noiseReason(path)).toBe(reason);
  });

  it.each(["src/index.ts", "src/build-utils.ts", "docs/distribution.md", "scripts/build.sh", "README.md"])(
    "%s não é ruído",
    (path) => {
      expect(noiseReason(path)).toBeNull();
    },
  );
});

describe("filePriority", () => {
  it.each([
    ["src/auth/token.ts", FilePriority.Source],
    ["src/auth/token.test.ts", FilePriority.Test],
    ["tests/auth.py", FilePriority.Test],
    ["src/__tests__/token.ts", FilePriority.Test],
    ["test.js", FilePriority.Test],
    ["index.test-d.ts", FilePriority.Test],
    ["pkg/auth/token_test.go", FilePriority.Test],
    ["app/test_models.py", FilePriority.Test],
    ["src/testing-utils.ts", FilePriority.Source],
    ["src/latest.ts", FilePriority.Source],
    ["README.md", FilePriority.Docs],
    ["docs/setup.html", FilePriority.Docs],
  ])("%s -> %i", (path, priority) => {
    expect(filePriority(path)).toBe(priority);
  });
});
