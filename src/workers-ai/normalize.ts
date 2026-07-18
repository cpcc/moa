export interface NormalizedModelResponse {
  text: string;
}

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

export function normalizeModelResponse(value: unknown): NormalizedModelResponse {
  const direct = nonEmptyText(value);
  if (direct) return { text: direct };

  if (typeof value !== "object" || value === null) {
    throw new Error("Workers AI returned no text");
  }
  const record = value as Record<string, unknown>;
  const outputText = nonEmptyText(record.output_text);
  if (outputText) return { text: outputText };

  const choices = record.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (typeof first === "object" && first !== null) {
      const message = (first as Record<string, unknown>).message;
      if (typeof message === "object" && message !== null) {
        const content = nonEmptyText((message as Record<string, unknown>).content);
        if (content) return { text: content };
      }
    }
  }

  for (const key of ["response", "result", "text"]) {
    const text = nonEmptyText(record[key]);
    if (text) return { text };
  }
  throw new Error("Workers AI returned no usable text");
}
