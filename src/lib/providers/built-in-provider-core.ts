type BasicBuiltInProviderConfig = {
  apiKey: string;
  baseUrl: string;
  creditCost: number;
  model: string;
  models: string[];
  name: string;
};

type StoredBuiltInProviderConfig = {
  apiKeyEncrypted: string;
  baseUrl: string;
  creditCost: number;
  model: string;
  models: string[];
  name: string;
};

type BuiltInProviderInput = {
  apiKey: string;
  baseUrl: string;
  creditCost: number;
  model: string;
  models: string[];
  name: string;
};

export function resolveBuiltInProviderConfig(
  envConfig: BasicBuiltInProviderConfig,
  dbConfig: BasicBuiltInProviderConfig | null,
) {
  return dbConfig ?? envConfig;
}

export function mergeBuiltInProviderConfigInput(
  input: BuiltInProviderInput,
  _current: StoredBuiltInProviderConfig | null,
) {
  void _current;

  return {
    apiKey: input.apiKey.trim() ? input.apiKey.trim() : null,
    baseUrl: input.baseUrl,
    creditCost: input.creditCost,
    model: input.model,
    models: input.models,
    name: input.name,
  };
}
