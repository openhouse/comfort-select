import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { Decision } from "../types.js";
import { buildDecisionSchema } from "./schema.js";

export interface OpenAIDeciderConfig {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  curatorLabels: string[];
}

export async function decideWithOpenAI(
  cfg: OpenAIDeciderConfig,
  prompt: string
): Promise<{ decision: Decision; responseId?: string }> {
  const client = new OpenAI({ apiKey: cfg.apiKey, timeout: cfg.timeoutMs });
  const schema = buildDecisionSchema(cfg.curatorLabels);

  // Use the SDK's structured-output parsing. This enforces the Zod schema.
  const response = await client.responses.parse({
    model: cfg.model,
    input: [
      {
        role: "system",
        content:
          "Return ONLY JSON that matches the provided schema. Never claim to be real people; treat named experts as an imagined panel."
      },
      { role: "user", content: prompt }
    ],
    text: {
      format: zodTextFormat(schema, "comfort_decision")
    },
    store: false
  });

  const parsed = (response as any).output_parsed as unknown;
  if (!parsed) {
    // When the model refuses, some SDKs surface a 'refusal' field.
    const refusal = (response as any).refusal ?? (response as any).output_text;
    throw new Error(`OpenAI did not return a parsed decision. Refusal/output: ${String(refusal ?? "")}`);
  }

  return { decision: parsed as Decision, responseId: (response as any).id as string | undefined };
}
