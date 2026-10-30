import { describe, expect, it } from "vitest";
import { splitCommitMessage, toFileStatus } from "./mappers.ts";

describe("toFileStatus", () => {
  it.each([
    ["added", "added"],
    ["copied", "added"],
    ["removed", "removed"],
    ["renamed", "renamed"],
    ["modified", "modified"],
    ["changed", "modified"],
    ["unchanged", "modified"],
  ] as const)("%s -> %s", (github, domain) => {
    expect(toFileStatus(github)).toBe(domain);
  });
});

describe("splitCommitMessage", () => {
  it("separa título e corpo", () => {
    expect(splitCommitMessage("feat: login\n\nAdiciona OAuth.\nFecha #12")).toEqual({
      title: "feat: login",
      body: "Adiciona OAuth.\nFecha #12",
    });
  });

  it("retorna body null quando só há título", () => {
    expect(splitCommitMessage("fix: typo")).toEqual({ title: "fix: typo", body: null });
    expect(splitCommitMessage("fix: typo\n\n  \n")).toEqual({ title: "fix: typo", body: null });
  });
});
