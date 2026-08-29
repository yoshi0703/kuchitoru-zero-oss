const PROVIDER_MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,200}$/;

export function isValidProviderModel(model: string): boolean {
  return PROVIDER_MODEL_PATTERN.test(model);
}
