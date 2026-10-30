import { describe, expect, it } from "vitest";
import { GitProviderError, RepositoryNotFoundError } from "../../domain/errors.ts";
import type { ChangeQuery } from "../../domain/ports/git-provider.ts";
import { createGitHubClient } from "./github-client.ts";
import { GitHubGitProvider } from "./github-git-provider.ts";

type Handler = (url: URL) => unknown;

function fakeGitHub(handler: Handler) {
  const requests: URL[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url);
    const body = handler(url);
    return body === undefined
      ? Response.json({ message: "Not Found" }, { status: 404 })
      : Response.json(body);
  };
  const provider = new GitHubGitProvider(createGitHubClient({ fetch }));
  const listPages = () =>
    requests.filter((url) => url.pathname.endsWith("/pulls")).map((url) => url.searchParams.get("page"));
  return { provider, requests, listPages };
}

function pr(number: number, mergedAt: string | null, updatedAt = mergedAt ?? "2026-10-01T00:00:00Z") {
  return {
    number,
    title: `PR ${number}`,
    body: "",
    html_url: `https://github.com/acme/app/pull/${number}`,
    user: { login: "dev" },
    merged_at: mergedAt,
    updated_at: updatedAt,
  };
}

const sampleFile = {
  filename: "src/app.ts",
  status: "modified",
  additions: 2,
  deletions: 1,
  patch: "@@ -1 +1,2 @@\n-a\n+b\n+c",
};

const hoursBefore = (iso: string, hours: number) =>
  new Date(Date.parse(iso) - hours * 3_600_000).toISOString();

const repo = { owner: "acme", name: "app" };
const prQuery = (range: ChangeQuery["range"]): ChangeQuery => ({ repo, range, source: "pr" });

describe("GitHubGitProvider — PRs", () => {
  it("retorna os N PRs merged mais recentes por data de merge, ignorando os não merged", async () => {
    const { provider } = fakeGitHub((url) => {
      if (url.pathname === "/repos/acme/app/pulls") {
        return [
          pr(3, "2026-10-03T00:00:00Z", "2026-10-05T00:00:00Z"),
          pr(2, null, "2026-10-04T12:00:00Z"),
          pr(1, "2026-10-04T00:00:00Z"),
        ];
      }
      if (/\/pulls\/\d+\/files$/.test(url.pathname)) return [sampleFile];
    });

    const units = await provider.fetchChangeUnits(prQuery({ type: "last", count: 2 }));

    expect(units.map((unit) => unit.ref)).toEqual(["#1", "#3"]);
    expect(units[0]).toMatchObject({
      kind: "pr",
      url: "https://github.com/acme/app/pull/1",
      body: null,
      author: "dev",
      date: new Date("2026-10-04T00:00:00Z"),
      files: [{ path: "src/app.ts", previousPath: null, status: "modified", additions: 2, deletions: 1 }],
    });
  });

  it("para de paginar quando os PRs restantes não podem entrar no resultado", async () => {
    const page = Array.from({ length: 100 }, (_, i) => pr(1000 - i, hoursBefore("2026-10-20T00:00:00Z", i)));
    const { provider, requests, listPages } = fakeGitHub((url) => {
      if (url.pathname === "/repos/acme/app/pulls") return url.searchParams.get("page") === "1" ? page : [];
      if (url.pathname.endsWith("/files")) return [];
    });

    const units = await provider.fetchChangeUnits(prQuery({ type: "last", count: 5 }));

    expect(units.map((unit) => unit.ref)).toEqual(["#1000", "#999", "#998", "#997", "#996"]);
    expect(listPages()).toEqual(["1"]);
    expect(requests).toHaveLength(1 + 5);
  });

  it("continua para a próxima página quando ainda faltam PRs merged", async () => {
    const unmergedPage = Array.from({ length: 100 }, (_, i) => pr(500 - i, null));
    const { provider, listPages } = fakeGitHub((url) => {
      if (url.pathname === "/repos/acme/app/pulls") {
        return url.searchParams.get("page") === "1" ? unmergedPage : [pr(1, "2026-09-01T00:00:00Z")];
      }
      if (url.pathname.endsWith("/files")) return [];
    });

    const units = await provider.fetchChangeUnits(prQuery({ type: "last", count: 1 }));

    expect(units.map((unit) => unit.ref)).toEqual(["#1"]);
    expect(listPages()).toEqual(["1", "2"]);
  });

  it("filtra por intervalo de datas e para quando a página passa de 'since'", async () => {
    const page = Array.from({ length: 100 }, (_, i) => pr(i + 1, hoursBefore("2026-10-20T00:00:00Z", i + 1)));
    const { provider, listPages } = fakeGitHub((url) => {
      if (url.pathname === "/repos/acme/app/pulls") return page;
      if (url.pathname.endsWith("/files")) return [];
    });

    const units = await provider.fetchChangeUnits(
      prQuery({ type: "date", since: new Date("2026-10-18T00:00:00Z"), until: new Date("2026-10-19T00:00:00Z") }),
    );

    expect(units).toHaveLength(25);
    expect(units.at(0)?.ref).toBe("#24");
    expect(units.at(-1)?.ref).toBe("#48");
    expect(listPages()).toEqual(["1"]);
  });

  it("mapeia arquivos renomeados e binários sem patch", async () => {
    const { provider } = fakeGitHub((url) => {
      if (url.pathname === "/repos/acme/app/pulls") return [pr(1, "2026-10-01T00:00:00Z")];
      if (url.pathname.endsWith("/files")) {
        return [
          { ...sampleFile, filename: "src/new.ts", previous_filename: "src/old.ts", status: "renamed" },
          { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
        ];
      }
    });

    const [unit] = await provider.fetchChangeUnits(prQuery({ type: "last", count: 1 }));

    expect(unit?.files).toEqual([
      expect.objectContaining({ path: "src/new.ts", previousPath: "src/old.ts", status: "renamed" }),
      expect.objectContaining({ path: "logo.png", status: "added", patch: null }),
    ]);
  });
});

describe("GitHubGitProvider — commits", () => {
  const listed = (sha: string, parents = 1) => ({ sha, parents: Array.from({ length: parents }, () => ({ sha: "p" })) });

  it("ignora merge commits e separa título e corpo da mensagem", async () => {
    const { provider } = fakeGitHub((url) => {
      if (url.pathname === "/repos/acme/app/commits") {
        return [listed("merge000", 2), listed("aaaaaaa111"), listed("bbbbbbb222"), listed("ccccccc333")];
      }
      const sha = url.pathname.match(/\/commits\/(\w+)$/)?.[1];
      if (sha) {
        return {
          sha,
          html_url: `https://github.com/acme/app/commit/${sha}`,
          author: null,
          commit: {
            message: `feat: ${sha}\n\nDetalhes`,
            author: { name: "Fulano", date: "2026-10-01T10:00:00Z" },
          },
          files: [sampleFile],
        };
      }
    });

    const units = await provider.fetchChangeUnits({ repo, range: { type: "last", count: 2 }, source: "commit" });

    expect(units.map((unit) => unit.ref)).toEqual(["aaaaaaa", "bbbbbbb"]);
    expect(units[0]).toMatchObject({
      kind: "commit",
      title: "feat: aaaaaaa111",
      body: "Detalhes",
      author: "Fulano",
      date: new Date("2026-10-01T10:00:00Z"),
    });
  });

  it("envia since e until para a API quando o intervalo é por data", async () => {
    const { provider, requests } = fakeGitHub((url) => (url.pathname.endsWith("/commits") ? [] : undefined));

    await provider.fetchChangeUnits({
      repo,
      range: { type: "date", since: new Date("2026-10-01T00:00:00Z") },
      source: "commit",
    });

    const params = requests[0]?.searchParams;
    expect(params?.get("since")).toBe("2026-10-01T00:00:00.000Z");
    expect(params?.has("until")).toBe(false);
  });
});

describe("GitHubGitProvider — erros", () => {
  it("traduz 404 em RepositoryNotFoundError", async () => {
    const { provider } = fakeGitHub(() => undefined);

    await expect(provider.fetchChangeUnits(prQuery({ type: "last", count: 1 }))).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    );
  });

  it("traduz dados inesperados do GitHub em GitProviderError", async () => {
    const { provider } = fakeGitHub((url) => {
      if (url.pathname === "/repos/acme/app/pulls") return [{ ...pr(1, "2026-10-01T00:00:00Z"), html_url: "não-é-url" }];
      if (url.pathname.endsWith("/files")) return [];
    });

    await expect(provider.fetchChangeUnits(prQuery({ type: "last", count: 1 }))).rejects.toBeInstanceOf(
      GitProviderError,
    );
  });
});
