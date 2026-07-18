import { MODEL_ID } from "../workers-ai/models";

export interface PublicModel {
  id: string;
  type: "model";
  display_name: string;
  created_at: string;
  input_token_limit: number;
  output_token_limit: number;
  internalModel: typeof MODEL_ID;
}

const aliases = ["moa-opus", "moa-sonnet", "moa-haiku"] as const;

export const PUBLIC_MODELS: Record<string, PublicModel> = Object.fromEntries(
  aliases.map((id) => [id, {
    id,
    type: "model",
    display_name: `${id} (Workers AI MoA)`,
    created_at: "2026-07-16T00:00:00Z",
    input_token_limit: 12000,
    output_token_limit: 12000,
    internalModel: MODEL_ID,
  } satisfies PublicModel]),
);

export function getPublicModel(id: string): PublicModel | undefined {
  return PUBLIC_MODELS[id];
}

export function listPublicModels(): PublicModel[] {
  return aliases.map((id) => PUBLIC_MODELS[id]);
}
