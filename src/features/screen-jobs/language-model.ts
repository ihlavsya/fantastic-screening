export type LanguageModel = {
  ask: (prompt: string, answerSchema: JsonSchema) => Promise<ModelReply>;
  checkHealth: () => Promise<ModelHealth>;
};

export type JsonSchema = Record<string, unknown>;

export type ModelReply = { isOk: true; answer: unknown } | { isOk: false; failure: ModelFailure };

export type ModelHealth = { isHealthy: true } | { isHealthy: false; failure: ModelFailure };

export type ModelFailure = {
  message: string;
  rawOutput: string;
};
