export interface EmbeddingProvider {
  readonly name: string;

  /**
   * Returns one vector per input text, in the same order as `texts`.
   */
  embed(texts: string[]): Promise<number[][]>;
}
