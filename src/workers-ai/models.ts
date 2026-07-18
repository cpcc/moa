export const MODEL_ID = "@cf/openai/gpt-oss-120b" as const;

export type AllowedModel = typeof MODEL_ID;

export function isAllowedModel(value: string): value is AllowedModel {
  return value === MODEL_ID;
}
