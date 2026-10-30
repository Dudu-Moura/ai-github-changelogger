export class RepositoryNotFoundError extends Error {
  override name = "RepositoryNotFoundError";

  constructor(readonly repo: string) {
    super(`Repository ${repo} not found. Check the name and make sure it is public.`);
  }
}

export class GitProviderError extends Error {
  override name = "GitProviderError";
}
